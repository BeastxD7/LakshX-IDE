// LakshX Secrets — staged-diff scan orchestration. Pure/vscode-free.
//
// Combines lib/diff.js (unified-diff -> added lines) + lib/scanner.js
// (added-line text -> findings) + lib/baseline.js (drop acknowledged
// findings). Shared by BOTH `lakshx.secrets.scanStaged` in extension.js (fed
// `git diff --cached` run via child_process from inside VS Code) and
// bin/precommit-scan.js (the standalone script the opt-in real git hook
// shells out to, run via plain Node with no vscode at all) — one tested
// implementation backs both surfaces instead of duplicating the "diff to
// findings" logic in each.
"use strict";

const scanner = require("./scanner.js");
const { parseUnifiedDiff } = require("./diff.js");
const { filterFindings } = require("./baseline.js");

/**
 * Scan added diff lines for secrets. Each line is scanned in isolation (as
 * its own one-line "file") so a rule like aws-secret-access-key that needs a
 * context word "on the same line" still works correctly; the isolated
 * scan's line number (always 1) is then overwritten with the diff's real
 * new-file line number so findings point at the right place.
 * @param {Array<{file:string, line:number, content:string}>} addedLines
 */
function scanAddedLines(addedLines) {
  const findings = [];
  for (const { file, line, content } of addedLines || []) {
    const perLine = scanner.scanText(content, file);
    for (const f of perLine) findings.push({ ...f, line });
  }
  return findings;
}

/**
 * @param {string} diffText raw `git diff --cached` (or `--unified=0`) output
 * @param {object} [baseline] parsed baseline (lib/baseline.js shape); when
 *   given, already-acknowledged findings are dropped
 * @returns {Array} findings, baseline-filtered if a baseline was passed
 */
function scanStagedDiff(diffText, baseline) {
  const added = parseUnifiedDiff(diffText);
  const findings = scanAddedLines(added);
  return baseline ? filterFindings(findings, baseline) : findings;
}

module.exports = { scanAddedLines, scanStagedDiff };
