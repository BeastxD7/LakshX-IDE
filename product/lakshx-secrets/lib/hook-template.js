// LakshX Secrets — pre-commit hook shell script template. Pure/vscode-free
// (just string templating) so its output is directly assertable in tests.
//
// extension.js's `lakshx.secrets.installPreCommitHook` command (opt-in only,
// gated behind an explicit confirmation warning — see README.md and that
// command's implementation) writes this exact content to
// `.git/hooks/pre-commit`. The hook just shells out to bin/precommit-scan.js
// via an ABSOLUTE path into wherever this extension happens to be installed
// — that's an inherent tradeoff of "a git hook calls back into a VS Code
// extension's bundled script" (the hook stops working if the extension is
// uninstalled/moved; README calls this out explicitly).
"use strict";

const MARKER = "# lakshx-secrets-precommit-hook";

/**
 * @param {string} scriptAbsPath absolute path to bin/precommit-scan.js
 * @returns {string} full pre-commit hook shell script content
 */
function buildPreCommitHookScript(scriptAbsPath) {
  return [
    "#!/bin/sh",
    MARKER,
    "# Installed by the LakshX Secrets extension (lakshx.secrets.installPreCommitHook).",
    "# Safe to delete this file at any time to remove the hook; it does not",
    "# modify anything else about your git configuration.",
    `node "${scriptAbsPath}"`,
    "exit $?",
    "",
  ].join("\n");
}

/** Whether an existing pre-commit hook file was installed by us (so the
 * install command can safely detect/offer to overwrite a hook it created
 * itself, vs. warning loudly before clobbering someone else's hook). */
function isOurHook(existingContent) {
  return typeof existingContent === "string" && existingContent.includes(MARKER);
}

module.exports = { MARKER, buildPreCommitHookScript, isOurHook };
