// LakshX Testing — makes VS Code's own native Testing API (test-run gutter
// decorations, inline pass/fail, and coverage highlighting) genuinely on by
// default and well-configured, instead of leaving it to per-project
// discovery of settings most people never find.
//
// This is explicitly NOT a custom test runner and does NOT implement the
// Testing API's TestController/TestRun/TestRunProfile surface itself — it
// does two things, both scoped to the achievable, low-risk 80% win:
//
//   1. Ship configurationDefaults (package.json) that flip VS Code's own
//      testing.* settings to good, discoverable-by-default values. Every
//      key was verified against this exact checkout's
//      upstream/src/vs/workbench/contrib/testing/common/configuration.ts —
//      not guessed — see README.md for the full list + before/after
//      defaults + confidence notes.
//   2. A best-effort, one-time-per-workspace notification: if this
//      workspace looks like it uses Jest/Vitest/pytest/Cargo/Go and the
//      matching test explorer extension isn't installed, suggest it (never
//      bundles/installs anything itself).
//
// See lib/detectRunners.js for the pure (vscode-independent, unit-tested)
// detection/decision logic; this file only wires real vscode/filesystem I/O
// to it.
"use strict";

const vscode = require("vscode");
const { detectRunners, needsNotification } = require("./lib/detectRunners.js");

// workspaceState key: array of runner ids (see lib/detectRunners.js RUNNERS)
// we've already shown a one-time notification for in this workspace. A
// runner is added to this list the moment its notification is shown,
// regardless of whether the user installs the suggested extension — this is
// meant to be a single nudge, not a recurring nag.
const NOTIFIED_KEY = "lakshx.testing.notifiedRunners";

/**
 * Best-effort, bounded read of the handful of top-level files that signal a
 * test runner/ecosystem. Only looks at the first workspace folder's root —
 * deliberately not a recursive scan (this is a lightweight hint, not
 * lakshx-graph's bounded-but-real workspace scan). Missing files are not
 * errors; every read fails soft to `undefined`/`false`.
 */
async function readWorkspaceDetectionInput() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) return null;
  const root = folder.uri;

  const readIfExists = async (name) => {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name));
      return Buffer.from(bytes).toString("utf8");
    } catch {
      return undefined;
    }
  };
  const exists = async (name) => {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, name));
      return true;
    } catch {
      return false;
    }
  };

  const [pkgText, pyprojectText, setupCfgText, pytestIniExists, cargoTomlExists, goModExists] = await Promise.all([
    readIfExists("package.json"),
    readIfExists("pyproject.toml"),
    readIfExists("setup.cfg"),
    exists("pytest.ini"),
    exists("Cargo.toml"),
    exists("go.mod"),
  ]);

  let packageJsonScripts;
  if (pkgText) {
    try {
      packageJsonScripts = JSON.parse(pkgText).scripts;
    } catch {
      packageJsonScripts = undefined; // malformed package.json — not this extension's problem to fix
    }
  }

  return { packageJsonScripts, pytestIniExists, pyprojectText, setupCfgText, cargoTomlExists, goModExists };
}

async function checkAndNotify(context) {
  const input = await readWorkspaceDetectionInput();
  if (!input) return; // no workspace folder open

  const detected = detectRunners(input);
  if (detected.length === 0) return;

  const installedIds = vscode.extensions.all.map((e) => e.id);
  const alreadyNotified = context.workspaceState.get(NOTIFIED_KEY) || [];
  const toNotify = needsNotification(detected, installedIds, alreadyNotified);
  if (toNotify.length === 0) return;

  const names = toNotify.map((r) => r.label).join(", ");
  const plural = toNotify.length > 1 ? "s" : "";
  const pick = await vscode.window.showInformationMessage(
    `LakshX Testing detected ${names} in this workspace, but no matching test explorer extension${plural} ` +
      `${toNotify.length > 1 ? "are" : "is"} installed. Installing it gets you inline gutter results and coverage ` +
      `highlighting via VS Code's native Testing UI.`,
    "Show Extension(s)",
    "Dismiss",
  );
  if (pick === "Show Extension(s)") {
    const ids = toNotify.map((r) => r.extensionId).filter(Boolean);
    try {
      await vscode.commands.executeCommand("workbench.extensions.action.showExtensionsWithIds", ids);
    } catch (err) {
      console.error("LakshX Testing: couldn't open the Extensions view", err);
    }
  }

  // Mark all of them notified regardless of the user's choice — one nudge, not a nag.
  const updated = [...new Set([...alreadyNotified, ...toNotify.map((r) => r.id)])];
  await context.workspaceState.update(NOTIFIED_KEY, updated);
}

function activate(context) {
  // Fire-and-forget: detection is best-effort and must never block/slow
  // startup or throw into the extension host.
  checkAndNotify(context).catch((err) => {
    console.error("LakshX Testing: runner detection failed", err);
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
