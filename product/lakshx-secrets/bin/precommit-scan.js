#!/usr/bin/env node
// LakshX Secrets — standalone pre-commit scanner.
//
// This is the small bundled script the OPT-IN real `.git/hooks/pre-commit`
// (installed only via the `lakshx.secrets.installPreCommitHook` command, and
// only after that command's explicit warning — see README.md and
// extension.js's `installPreCommitHook`) shells out to. It runs with plain
// Node, no vscode API available at all, which is why all the logic it needs
// (lib/diff.js, lib/scanner.js, lib/baseline.js, lib/precommit.js) is kept
// vscode-free — the exact same modules extension.js's
// `lakshx.secrets.scanStaged` command calls from inside VS Code.
//
// Exit codes: 0 = clean (or baselined-only) / scanner-internal-error
// (fail-open — see below); 1 = one or more un-baselined findings, commit is
// blocked.
//
// FAIL-OPEN ON INTERNAL ERRORS, BY DESIGN: if git itself fails, or the
// baseline file is unreadable/corrupt, or an unexpected exception is thrown,
// this script prints a warning and exits 0 rather than blocking every commit
// on a scanner bug. This is a deliberate tradeoff (same one detect-secrets/
// Gitleaks pre-commit integrations make) — a scanner that can brick commits
// on its own internal errors gets uninstalled, not trusted. It only ever
// fails CLOSED (exit 1) when it actually found un-baselined secrets.
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const baselineLib = require("../lib/baseline.js");
const { scanStagedDiff } = require("../lib/precommit.js");

const BASELINE_REL_PATH = path.join(".lakshx", "secrets-baseline.json");

function readBaseline(repoRoot) {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, BASELINE_REL_PATH), "utf8");
    return baselineLib.parseBaseline(raw);
  } catch {
    return baselineLib.emptyBaseline(); // no baseline file yet is the normal/common case
  }
}

function main() {
  const repoRoot = process.cwd(); // git runs hooks with cwd = repo top level
  let diffText;
  try {
    diffText = execFileSync("git", ["diff", "--cached", "--unified=0", "--no-color"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    process.stderr.write(
      `LakshX Secrets: couldn't read staged diff (${err && err.message ? err.message : err}) — skipping scan, NOT blocking commit.\n`,
    );
    process.exit(0);
    return;
  }

  let findings;
  try {
    const baseline = readBaseline(repoRoot);
    findings = scanStagedDiff(diffText, baseline);
  } catch (err) {
    process.stderr.write(
      `LakshX Secrets: internal scan error (${err && err.message ? err.message : err}) — skipping scan, NOT blocking commit.\n`,
    );
    process.exit(0);
    return;
  }

  if (findings.length === 0) {
    process.exit(0);
    return;
  }

  process.stderr.write(`LakshX Secrets: blocked commit — ${findings.length} possible secret(s) in staged changes:\n\n`);
  for (const f of findings) {
    process.stderr.write(
      `  [${f.confidence.toUpperCase()}] ${f.file}:${f.line}  ${f.label}  ${f.redacted}\n`,
    );
  }
  process.stderr.write(
    `\nIf any of these are false positives, review them and run "LakshX: Acknowledge Secret Finding" ` +
      `(or the equivalent command) in VS Code to add them to ${BASELINE_REL_PATH}, then re-commit.\n` +
      `To bypass this check for one commit: git commit --no-verify (use sparingly).\n`,
  );
  process.exit(1);
}

main();
