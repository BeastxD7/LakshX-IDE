// LakshX Secrets — minimal unified-diff parser. Pure/vscode-free.
//
// Shared by two callers that both need "which lines are being ADDED by this
// commit": extension.js's `lakshx.secrets.scanStaged` command (fed the
// output of `git diff --cached`) and bin/precommit-scan.js, the standalone
// script the opt-in real git hook shells out to (fed the same command run
// from a plain Node process with no vscode available at all). Keeping this
// parser here — instead of duplicating "git diff --cached" handling in both
// places — is what lets both surfaces share one tested implementation.
//
// Deliberately narrow: we only care about added-content lines (git diff's
// `+`-prefixed lines, excluding the `+++ b/path` file header), because a
// pre-commit secret scan should flag what's being INTRODUCED, not pre-existing
// lines that happen to sit inside the same hunk. Not a general-purpose diff
// library — no rename/binary-diff/combined-diff support.
"use strict";

/**
 * @param {string} diffText raw output of `git diff --cached --unified=0` (or
 *   any unified diff with `diff --git a/... b/...` file headers)
 * @returns {Array<{file: string, line: number, content: string}>} one entry
 *   per added line, `line` = 1-based line number in the NEW file.
 */
function parseUnifiedDiff(diffText) {
  if (!diffText) return [];
  const lines = diffText.split("\n");
  const added = [];
  let currentFile = null;
  let newLineNo = null;

  const FILE_HEADER_RE = /^diff --git a\/.* b\/(.*)$/;
  const PLUS_HEADER_RE = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/;
  const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

  for (const line of lines) {
    const fileHeaderMatch = FILE_HEADER_RE.exec(line);
    if (fileHeaderMatch) {
      currentFile = fileHeaderMatch[1];
      newLineNo = null;
      continue;
    }
    const plusHeaderMatch = PLUS_HEADER_RE.exec(line);
    if (plusHeaderMatch) {
      // `+++ b/path` confirms/refines the target path (handles the rare case
      // where the file-header path and the +++ path differ, e.g. renames);
      // `+++ /dev/null` (a deletion) means there's no new-file content to scan.
      currentFile = plusHeaderMatch[1] || currentFile;
      continue;
    }
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      newLineNo = Number(hunkMatch[1]);
      continue;
    }
    if (newLineNo === null || !currentFile) continue; // outside any hunk yet
    if (line.startsWith("+")) {
      added.push({ file: currentFile, line: newLineNo, content: line.slice(1) });
      newLineNo++;
    } else if (line.startsWith("-")) {
      // removed line: doesn't exist in the new file, doesn't consume a new-line number
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — not a content line
    } else {
      // context line (only appears with non-zero unified context)
      newLineNo++;
    }
  }

  return added;
}

module.exports = { parseUnifiedDiff };
