// LakshX Secrets — scanner. Pure/vscode-free (mirrors lib/rules.js and the
// depgraph.js/vuln-check.js split used by lakshx-graph): given file text +
// path, run every rule from lib/rules.js and return findings. extension.js is
// the only place that touches vscode (the workspace file walk via
// vscode.workspace.findFiles, editor decorations, and the DiagnosticCollection).
//
// A finding never carries the raw secret value in its public/serializable
// shape beyond what's needed to (a) redact for display and (b) hash for the
// baseline — see lib/hash.js. `scanText` DOES return `rawValue` on each
// finding (callers need it once, to hash/redact/act on) but callers must
// never persist or log `rawValue` verbatim; only `redacted` and `hash` are
// safe to write to disk or show in UI.
"use strict";

const rules = require("./rules.js");
const { hashSecret } = require("./hash.js");

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Redact a matched secret span: first 4 + last 4 chars only, length noted.
 * Never returns enough of the original value to reconstruct it. */
function redact(value) {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

// ---------------------------------------------------------------------------
// Offset -> line number (1-based), via a precomputed line-start index so a
// file with many findings doesn't re-walk the whole text per finding.
// ---------------------------------------------------------------------------

function buildLineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** Binary search: last line-start offset <= index. */
function lineForOffset(lineStarts, index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based line number
}

// ---------------------------------------------------------------------------
// Binary-file detection — same heuristic git/most scanners use: a NUL byte
// in the first chunk of the file means "treat as binary, don't scan".
// ---------------------------------------------------------------------------

const BINARY_SNIFF_BYTES = 8000;

/** @param {Buffer} buffer */
function isLikelyBinary(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const len = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-file scan
// ---------------------------------------------------------------------------

/**
 * Scan one file's text against every rule.
 * @param {string} text file content
 * @param {string} filePath workspace-relative path (used only for the return
 *   shape's `file` field — callers own path resolution)
 * @returns {Array<{file, rule, label, confidence, line, redacted, hash, rawValue, entropy?}>}
 */
function scanText(text, filePath) {
  if (typeof text !== "string" || text.length === 0) return [];
  const lineStarts = buildLineIndex(text);
  const findings = [];
  const confirmedSpans = [];

  for (const rule of rules.PATTERN_RULES) {
    let spans;
    try {
      spans = rule.find(text) || [];
    } catch {
      spans = []; // a malformed/pathological input must never crash a whole scan
    }
    for (const span of spans) {
      confirmedSpans.push(span);
      findings.push({
        file: filePath,
        rule: rule.id,
        label: rule.label,
        confidence: "confirmed",
        line: lineForOffset(lineStarts, span.index),
        redacted: redact(span.value),
        hash: hashSecret(rule.id, span.value),
        rawValue: span.value,
      });
    }
  }

  let entropySpans;
  try {
    entropySpans = rules.findHighEntropyStrings(text, confirmedSpans) || [];
  } catch {
    entropySpans = [];
  }
  for (const span of entropySpans) {
    findings.push({
      file: filePath,
      rule: rules.ENTROPY_RULE_ID,
      label: rules.ENTROPY_RULE_LABEL,
      confidence: "possible",
      line: lineForOffset(lineStarts, span.index),
      redacted: redact(span.value),
      hash: hashSecret(rules.ENTROPY_RULE_ID, span.value),
      rawValue: span.value,
      entropy: Number(span.entropy.toFixed(2)),
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Multi-file scan (workspace/staged-diff orchestration). Callers do the
// actual file-walk (extension.js reuses vscode.workspace.findFiles' existing
// exclude/cap conventions — see EXCLUDE_GLOB/MAX_FILES/MAX_BYTES below, which
// mirror lakshx-graph's SCAN_EXCLUDE/SCAN_MAX_FILES/SCAN_MAX_BYTES exactly)
// and just hand this an array of {path, text}.
// ---------------------------------------------------------------------------

const MAX_FILES = 2000;
const MAX_BYTES = 512 * 1024;
const EXCLUDE_GLOB = "**/{node_modules,.git,dist,build,out,.next,.venv,venv,__pycache__,coverage,vendor}/**";

/** @param {Array<{path: string, text: string}>} files */
function scanFiles(files) {
  const findings = [];
  for (const f of files || []) {
    if (!f || typeof f.text !== "string") continue;
    findings.push(...scanText(f.text, f.path));
  }
  return findings;
}

module.exports = {
  redact,
  buildLineIndex,
  lineForOffset,
  isLikelyBinary,
  scanText,
  scanFiles,
  MAX_FILES,
  MAX_BYTES,
  EXCLUDE_GLOB,
};
