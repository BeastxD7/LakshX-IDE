// LakshX Secrets — offline pre-commit secret scanning, Gitleaks-style.
//
// All detection/scanning/baseline logic lives in the vscode-free lib/*.js
// modules (unit-tested with `node --test test/*.test.js`) — see lib/rules.js,
// lib/scanner.js, lib/baseline.js, lib/diff.js, lib/precommit.js,
// lib/hook-template.js for design notes. This file is the ONLY place that
// touches vscode: the workspace file walk, editor diagnostics/decorations,
// status bar, commands, and the (opt-in, explicitly warned) real git hook
// install. Mirrors the pure-lib/thin-shell split lakshx-graph and
// lakshx-structural-search already use.
//
// HONESTY NOTE (see also README.md): this is regex + entropy pattern
// matching over raw text — a safety net, not a guarantee. It will miss
// secrets it doesn't have a rule for and can false-positive on high-entropy
// non-secrets. Never treat a clean scan as proof a change is secret-free.
"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

const scanner = require("./lib/scanner.js");
const baselineLib = require("./lib/baseline.js");
const { scanStagedDiff } = require("./lib/precommit.js");
const { buildPreCommitHookScript, isOurHook } = require("./lib/hook-template.js");

// ---- workspace-scan bounds — same conventions/values as lakshx-graph's
// SCAN_MAX_FILES/SCAN_MAX_BYTES/SCAN_EXCLUDE (see lib/scanner.js re-exports) ----
const SCAN_INCLUDE = "**/*"; // secrets can hide in any file type, not just source
const SCAN_EXCLUDE = scanner.EXCLUDE_GLOB;
const SCAN_MAX_FILES = scanner.MAX_FILES;
const SCAN_MAX_BYTES = scanner.MAX_BYTES;

const BASELINE_REL_PATH = ".lakshx/secrets-baseline.json";
const DIAGNOSTIC_SOURCE = "LakshX Secrets";

let secretsDiagnostics = null;
let secretsDecorationType = null;
let outputChannel = null;
let baselineWatcher = null;
let cachedBaseline = null; // invalidated by baselineWatcher / explicit reload

function relPathOf(uri) {
  return vscode.workspace.asRelativePath(uri, false).split(path.sep).join("/");
}

function primaryFolder() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0] : undefined;
}

// ---------------------------------------------------------------------------
// Baseline load/save (workspace-relative .lakshx/secrets-baseline.json)
// ---------------------------------------------------------------------------

async function loadBaseline() {
  if (cachedBaseline) return cachedBaseline;
  const folder = primaryFolder();
  if (!folder) return baselineLib.emptyBaseline();
  try {
    const uri = vscode.Uri.joinPath(folder.uri, ...BASELINE_REL_PATH.split("/"));
    const bytes = await vscode.workspace.fs.readFile(uri);
    cachedBaseline = baselineLib.parseBaseline(Buffer.from(bytes).toString("utf8"));
  } catch {
    cachedBaseline = baselineLib.emptyBaseline(); // no baseline file yet — normal/common
  }
  return cachedBaseline;
}

async function saveBaseline(baseline) {
  const folder = primaryFolder();
  if (!folder) throw new Error("no workspace folder open");
  const dirUri = vscode.Uri.joinPath(folder.uri, ".lakshx");
  const fileUri = vscode.Uri.joinPath(folder.uri, ...BASELINE_REL_PATH.split("/"));
  try {
    await vscode.workspace.fs.createDirectory(dirUri);
  } catch {
    // already exists — fine
  }
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(baselineLib.serializeBaseline(baseline), "utf8"));
  cachedBaseline = baseline;
}

// ---------------------------------------------------------------------------
// Per-file (on-save) scan: diagnostics + gutter decoration
// ---------------------------------------------------------------------------

function severityFor(confidence) {
  return confidence === "confirmed" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
}

// Diagnostic.code is set to the plain rule id (readable in the Problems
// panel's "code" column, same convention lakshx-graph's vuln diagnostics use
// for advisory ids). The extra metadata the "acknowledge" quick-fix needs
// (content hash + redacted display string — NEVER the raw secret value) is
// kept out-of-band in this per-document index instead of stuffed into
// diag.code as JSON, so the Problems panel keeps showing a clean rule id.
// uriString -> Map<"line:ruleId", {file, rule, hash, redacted, line}>
const findingsIndex = new Map();

function indexKey(line, ruleId) {
  return `${line}:${ruleId}`;
}

function storeFindingsForDoc(uriString, findings) {
  const perDoc = new Map();
  for (const f of findings) {
    perDoc.set(indexKey(f.line, f.rule), { file: f.file, rule: f.rule, hash: f.hash, redacted: f.redacted, line: f.line });
  }
  if (perDoc.size > 0) findingsIndex.set(uriString, perDoc);
  else findingsIndex.delete(uriString);
}

function isVulnScannableDoc(doc) {
  return doc.uri.scheme === "file";
}

// DELIBERATE gitignore divergence from the bulk workspace scan (see
// gatherWorkspaceFiles below): this per-file on-save scan does NOT consult
// .gitignore at all. If a file is open in the editor and the user is
// actively saving it, that's exactly the moment a warning is most useful —
// including the common case of a gitignored `.env`/`local.settings.json`
// the user is hand-editing, where "it's gitignored so we won't tell you"
// would be actively unhelpful. The bulk scan excludes gitignored files to
// avoid flooding the Problems panel with noise from build output/vendor
// dirs that happen to be git-ignored; this one scans whatever's open,
// unconditionally.
async function scanDocument(doc) {
  if (!isVulnScannableDoc(doc)) return;
  const text = doc.getText();
  const relPath = relPathOf(doc.uri);
  let findings;
  try {
    findings = scanner.scanText(text, relPath);
  } catch (err) {
    outputChannel.appendLine(`Scan failed for ${relPath}: ${err && err.message ? err.message : err}`);
    return;
  }
  const baseline = await loadBaseline();
  findings = baselineLib.filterFindings(findings, baseline);

  const diagnostics = [];
  const decorations = [];
  for (const f of findings) {
    const line = Math.max(0, f.line - 1);
    const lineLen = doc.lineCount > line ? doc.lineAt(line).text.length : 0;
    const range = new vscode.Range(line, 0, line, lineLen);
    const diag = new vscode.Diagnostic(
      range,
      `LakshX: possible ${f.label} (${f.confidence}) — ${f.redacted}`,
      severityFor(f.confidence),
    );
    diag.source = DIAGNOSTIC_SOURCE;
    diag.code = f.rule;
    diagnostics.push(diag);
    if (f.confidence === "confirmed") decorations.push({ range });
  }

  secretsDiagnostics.set(doc.uri, diagnostics);
  storeFindingsForDoc(doc.uri.toString(), findings);
  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === doc.uri.toString());
  if (editor) editor.setDecorations(secretsDecorationType, decorations);
}

// ---------------------------------------------------------------------------
// gitignore filtering — IMPORTANT: vscode.workspace.findFiles does NOT
// consult .gitignore. That's a Search-viewlet-only behavior gated by the
// `search.useIgnoreFiles` setting; the findFiles API has no such option
// (VS Code added a separate `findFiles2({ useIgnoreFiles })` precisely
// because the classic API doesn't do this). Without an explicit filter here,
// a bulk scan would flood the Problems panel with exactly the
// secret-bearing files projects gitignore on purpose (local.env,
// secrets.yaml, terraform.tfstate, ...) and burn through the file-count cap
// on them. We filter the findFiles result set through `git check-ignore`
// (fed candidate paths over stdin, NUL-separated) and drop anything it
// reports as ignored. Requires `git` on PATH and the workspace folder to be
// inside a git repo; if either isn't true, this fails OPEN (no gitignore
// filtering applied, only the fixed SCAN_EXCLUDE dir list still applies) —
// documented in README rather than silently pretended away.
// ---------------------------------------------------------------------------

function gitCheckIgnore(repoRoot, relPaths) {
  return new Promise((resolve) => {
    if (relPaths.length === 0) {
      resolve({ ignored: new Set(), ok: true });
      return;
    }
    let child;
    try {
      child = spawn("git", ["check-ignore", "--stdin", "-z"], { cwd: repoRoot });
    } catch {
      resolve({ ignored: new Set(), ok: false });
      return;
    }
    let out = "";
    let spawnFailed = false;
    child.on("error", () => {
      spawnFailed = true;
      resolve({ ignored: new Set(), ok: false }); // git not found etc. — fail open
    });
    child.stdout.on("data", (d) => {
      out += d.toString("utf8");
    });
    child.on("close", (code) => {
      if (spawnFailed) return;
      // check-ignore exits 1 when NONE of the inputs are ignored (not an
      // error) and 0 when at least one is; anything else (128, ...) means it
      // couldn't run against a real repo at all.
      if (code !== 0 && code !== 1) {
        resolve({ ignored: new Set(), ok: false });
        return;
      }
      const ignored = out.split("\0").filter(Boolean);
      resolve({ ignored: new Set(ignored), ok: true });
    });
    child.stdin.write(relPaths.join("\0"));
    child.stdin.end();
  });
}

async function gatherWorkspaceFiles(progress) {
  const folder = primaryFolder();
  // Ask for more raw candidates than SCAN_MAX_FILES so that filtering out
  // gitignored paths afterward doesn't starve the final scanned-file count —
  // findFiles' own maxResults would otherwise truncate BEFORE we know which
  // of those candidates are even supposed to be excluded.
  const uris = await vscode.workspace.findFiles(SCAN_INCLUDE, SCAN_EXCLUDE, SCAN_MAX_FILES * 3);

  let ignoredSet = new Set();
  let gitignoreApplied = false;
  if (folder) {
    const relPaths = uris.map((u) => relPathOf(u));
    const result = await gitCheckIgnore(folder.uri.fsPath, relPaths);
    ignoredSet = result.ignored;
    gitignoreApplied = result.ok;
  }
  if (!gitignoreApplied) {
    outputChannel.appendLine(
      "gitignore filtering skipped for this scan (no git on PATH or workspace folder isn't a git repository) — only the fixed exclude list (node_modules/.git/dist/build/...) applies.",
    );
  }

  const files = [];
  for (const uri of uris) {
    if (files.length >= SCAN_MAX_FILES) break;
    const rel = relPathOf(uri);
    if (ignoredSet.has(rel)) continue;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > SCAN_MAX_BYTES) continue;
      const bytes = await vscode.workspace.fs.readFile(uri);
      const buf = Buffer.from(bytes);
      if (scanner.isLikelyBinary(buf)) continue;
      files.push({ path: rel, text: buf.toString("utf8") });
    } catch {
      continue; // unreadable/vanished — skip
    }
    if (progress && files.length % 200 === 0) progress.report({ message: `scanned ${files.length} files…` });
  }
  return files;
}

async function runFullWorkspaceScan() {
  if (!primaryFolder()) {
    vscode.window.showInformationMessage("LakshX Secrets: open a folder/workspace to scan.");
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "LakshX Secrets: scanning workspace for secrets…", cancellable: false },
    async (progress) => {
      const files = await gatherWorkspaceFiles(progress);
      const baseline = await loadBaseline();

      // Clear stale diagnostics/index entries for files no longer under any
      // findings, then set fresh ones per-file so the Problems panel (and the
      // acknowledge quick-fix's lookup index) reflect this run.
      secretsDiagnostics.clear();
      findingsIndex.clear();
      let total = 0;
      let confirmedTotal = 0;
      for (const f of files) {
        let findings;
        try {
          findings = scanner.scanText(f.text, f.path);
        } catch (err) {
          outputChannel.appendLine(`Scan failed for ${f.path}: ${err && err.message ? err.message : err}`);
          continue;
        }
        findings = baselineLib.filterFindings(findings, baseline);
        if (findings.length === 0) continue;
        const uri = vscode.Uri.joinPath(primaryFolder().uri, ...f.path.split("/"));
        const diagnostics = findings.map((finding) => {
          const line = Math.max(0, finding.line - 1);
          const range = new vscode.Range(line, 0, line, 200);
          const diag = new vscode.Diagnostic(
            range,
            `LakshX: possible ${finding.label} (${finding.confidence}) — ${finding.redacted}`,
            severityFor(finding.confidence),
          );
          diag.source = DIAGNOSTIC_SOURCE;
          diag.code = finding.rule;
          return diag;
        });
        secretsDiagnostics.set(uri, diagnostics);
        storeFindingsForDoc(uri.toString(), findings);
        total += findings.length;
        confirmedTotal += findings.filter((x) => x.confidence === "confirmed").length;
      }

      outputChannel.appendLine(
        `[${new Date().toISOString()}] Full workspace scan: ${files.length} file(s) scanned, ${total} finding(s) (${confirmedTotal} confirmed, ${total - confirmedTotal} possible).`,
      );
      vscode.window.showInformationMessage(
        total > 0
          ? `LakshX Secrets: found ${total} possible secret(s) (${confirmedTotal} confirmed) across ${files.length} file(s). See the Problems panel.`
          : `LakshX Secrets: no findings across ${files.length} file(s) scanned. Regex+entropy scanning is a safety net, not a guarantee — see README.`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Staged-diff scan (pre-commit-style, run manually from the command palette)
// ---------------------------------------------------------------------------

function runGitDiffCached(cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["diff", "--cached", "--unified=0", "--no-color"],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

async function runScanStaged() {
  const folder = primaryFolder();
  if (!folder) {
    vscode.window.showInformationMessage("LakshX Secrets: open a folder/workspace to scan staged changes.");
    return;
  }
  let diffText;
  try {
    diffText = await runGitDiffCached(folder.uri.fsPath);
  } catch (err) {
    vscode.window.showWarningMessage(
      `LakshX Secrets: couldn't read staged changes (${err && err.message ? err.message : err}). Is this a git repository?`,
    );
    return;
  }

  const baseline = await loadBaseline();
  let findings;
  try {
    findings = scanStagedDiff(diffText, baseline);
  } catch (err) {
    outputChannel.appendLine(`Staged-diff scan failed: ${err && err.message ? err.message : err}`);
    vscode.window.showWarningMessage(`LakshX Secrets: staged-diff scan failed (${err && err.message ? err.message : err}).`);
    return;
  }

  if (findings.length === 0) {
    vscode.window.showInformationMessage("LakshX Secrets: no findings in staged changes. Safe to commit (scanner is a safety net, not a guarantee).");
    return;
  }

  outputChannel.show(true);
  outputChannel.appendLine(`\n[${new Date().toISOString()}] Staged-changes scan: ${findings.length} finding(s):`);
  for (const f of findings) {
    outputChannel.appendLine(`  [${f.confidence.toUpperCase()}] ${f.file}:${f.line}  ${f.label}  ${f.redacted}`);
  }
  vscode.window.showWarningMessage(
    `LakshX Secrets: found ${findings.length} possible secret(s) in staged changes. See the "LakshX: Secrets Scan" output channel before committing.`,
  );
}

// ---------------------------------------------------------------------------
// Acknowledge (quick-fix -> baseline)
// ---------------------------------------------------------------------------

class SecretsCodeActionProvider {
  provideCodeActions(document, _range, context) {
    const actions = [];
    const perDoc = findingsIndex.get(document.uri.toString());
    if (!perDoc) return actions;
    for (const diag of context.diagnostics) {
      if (diag.source !== DIAGNOSTIC_SOURCE) continue;
      const finding = perDoc.get(indexKey(diag.range.start.line + 1, diag.code));
      if (!finding) continue;
      const action = new vscode.CodeAction(
        `LakshX: Acknowledge "${finding.redacted}" as a known/false-positive finding (add to baseline)`,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diag];
      action.command = {
        command: "lakshx.secrets.acknowledgeFinding",
        title: "Acknowledge in secrets baseline",
        arguments: [finding],
      };
      actions.push(action);
    }
    return actions;
  }
}

async function acknowledgeFinding(arg) {
  if (!arg || !arg.file || !arg.rule || !arg.hash) return;
  if (!primaryFolder()) return;
  const baseline = await loadBaseline();
  const updated = baselineLib.addToBaseline(baseline, arg);
  await saveBaseline(updated);
  vscode.window.showInformationMessage(`LakshX Secrets: acknowledged "${arg.redacted}" in ${arg.file} — added to ${BASELINE_REL_PATH}.`);
  const doc = vscode.workspace.textDocuments.find((d) => relPathOf(d.uri) === arg.file);
  if (doc) await scanDocument(doc);
}

// ---------------------------------------------------------------------------
// Opt-in real git pre-commit hook install/uninstall — CONSEQUENTIAL ACTION:
// this writes to .git/hooks/pre-commit on the local filesystem, outside
// vscode's own undo/workspace-edit model. Never run without an explicit,
// separate confirmation from the user; never triggered automatically.
// ---------------------------------------------------------------------------

function gitHooksDir(repoRoot) {
  // Standard non-worktree layout only (documented limitation — see README).
  return path.join(repoRoot, ".git", "hooks");
}

async function installPreCommitHook(context) {
  const folder = primaryFolder();
  if (!folder) {
    vscode.window.showInformationMessage("LakshX Secrets: open a folder/workspace first.");
    return;
  }
  const repoRoot = folder.uri.fsPath;
  if (!fs.existsSync(path.join(repoRoot, ".git"))) {
    vscode.window.showWarningMessage("LakshX Secrets: no .git directory found at the workspace root — is this a git repository (and not a worktree/submodule)?");
    return;
  }

  const proceed = await vscode.window.showWarningMessage(
    "LakshX Secrets will write a real git hook to .git/hooks/pre-commit in this repository. " +
      "This is a LOCAL, machine-specific change outside VS Code's own settings — it is not committed or shared with " +
      "collaborators, and it will run on every `git commit` from this working copy (including from the terminal) " +
      "until you uninstall it. It shells out to a small bundled Node script; it does not send anything over the network.",
    { modal: true },
    "Install Hook",
  );
  if (proceed !== "Install Hook") return;

  const hooksDir = gitHooksDir(repoRoot);
  const hookPath = path.join(hooksDir, "pre-commit");
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf8");
    if (!isOurHook(existing)) {
      const overwrite = await vscode.window.showWarningMessage(
        `LakshX Secrets: a pre-commit hook already exists at ${hookPath} that LakshX did not install. Overwriting it will DISABLE whatever it currently does.`,
        { modal: true },
        "Overwrite",
      );
      if (overwrite !== "Overwrite") return;
    }
  }

  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    const scriptPath = path.join(context.extensionUri.fsPath, "bin", "precommit-scan.js");
    fs.writeFileSync(hookPath, buildPreCommitHookScript(scriptPath), { mode: 0o755 });
    fs.chmodSync(hookPath, 0o755);
    vscode.window.showInformationMessage(`LakshX Secrets: pre-commit hook installed at ${hookPath}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`LakshX Secrets: failed to install hook (${err && err.message ? err.message : err}).`);
  }
}

async function uninstallPreCommitHook() {
  const folder = primaryFolder();
  if (!folder) return;
  const hookPath = path.join(gitHooksDir(folder.uri.fsPath), "pre-commit");
  if (!fs.existsSync(hookPath)) {
    vscode.window.showInformationMessage("LakshX Secrets: no pre-commit hook installed.");
    return;
  }
  const existing = fs.readFileSync(hookPath, "utf8");
  if (!isOurHook(existing)) {
    vscode.window.showWarningMessage("LakshX Secrets: the existing pre-commit hook wasn't installed by LakshX — leaving it alone.");
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Remove the LakshX pre-commit secret-scan hook at ${hookPath}?`,
    { modal: true },
    "Remove Hook",
  );
  if (confirm !== "Remove Hook") return;
  fs.unlinkSync(hookPath);
  vscode.window.showInformationMessage("LakshX Secrets: pre-commit hook removed.");
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("LakshX: Secrets Scan");
  secretsDiagnostics = vscode.languages.createDiagnosticCollection("lakshxSecrets");
  secretsDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, "media", "secret-gutter.svg"),
    gutterIconSize: "contain",
    overviewRulerColor: new vscode.ThemeColor("editorWarning.foreground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  // Status bar entry point for the manual full-workspace scan — same
  // right-aligned cluster as lakshx-graph's Call Graph (997)/Dep Graph
  // (996)/Vuln Scan (995) and the other 995-priority items; 994 is the next
  // free slot in that cluster (see those files' own numbering notes).
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 994);
  statusItem.text = "$(shield) Secrets Scan";
  statusItem.tooltip = "LakshX: Scan workspace for secrets (offline, regex + entropy)";
  statusItem.command = "lakshx.secrets.scanWorkspace";
  statusItem.show();

  if (primaryFolder()) {
    const pattern = new vscode.RelativePattern(primaryFolder(), BASELINE_REL_PATH);
    baselineWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    const invalidate = () => {
      cachedBaseline = null;
    };
    baselineWatcher.onDidChange(invalidate);
    baselineWatcher.onDidCreate(invalidate);
    baselineWatcher.onDidDelete(invalidate);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("lakshx.secrets.scanWorkspace", () => runFullWorkspaceScan()),
    vscode.commands.registerCommand("lakshx.secrets.scanStaged", () => runScanStaged()),
    vscode.commands.registerCommand("lakshx.secrets.acknowledgeFinding", (arg) => acknowledgeFinding(arg)),
    vscode.commands.registerCommand("lakshx.secrets.installPreCommitHook", () => installPreCommitHook(context)),
    vscode.commands.registerCommand("lakshx.secrets.uninstallPreCommitHook", () => uninstallPreCommitHook()),
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new SecretsCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => scanDocument(doc)),
    statusItem,
    outputChannel,
    secretsDiagnostics,
    secretsDecorationType,
    ...(baselineWatcher ? [baselineWatcher] : []),
  );

  // Scan whatever's already open once on startup (save-only re-scans after this).
  for (const doc of vscode.workspace.textDocuments) {
    if (isVulnScannableDoc(doc)) scanDocument(doc);
  }
}

function deactivate() {
  // no timers/persistent state to flush
}

module.exports = { activate, deactivate };
