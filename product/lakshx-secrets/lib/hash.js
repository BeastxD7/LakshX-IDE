// LakshX Secrets — shared content-hash helper. Pure/vscode-free.
//
// Used by both lib/scanner.js (to compute a finding's identity) and
// lib/baseline.js (to compare a finding's identity against acknowledged
// entries). Kept as its own tiny module so neither of those files has to
// require the other just for this one function.
//
// IMPORTANT: this hashes the RAW matched secret text. The hash itself is a
// one-way SHA-256 digest — the baseline file on disk stores only this hex
// digest, never the plaintext secret (same discipline as detect-secrets'
// baseline format).
"use strict";

const crypto = require("crypto");

/**
 * Content hash for a finding, scoped by rule id so the same substring
 * matched by two different rules never collides.
 */
function hashSecret(ruleId, rawValue) {
  return crypto.createHash("sha256").update(`${ruleId}::${rawValue}`, "utf8").digest("hex");
}

module.exports = { hashSecret };
