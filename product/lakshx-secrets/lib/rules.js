// LakshX Secrets — detection rules. Pure/vscode-free by design (mirrors
// lakshx-graph/lib/vuln-check.js and lakshx-graph/lib/depgraph.js: all
// correctness-critical logic lives here with zero `vscode` import, so it's
// directly coverable by `node --test`). extension.js is the only side that
// touches vscode (editors, diagnostics, decorations, the workspace file walk).
//
// SCOPE / HONESTY NOTE (see also README.md): this is regex + Shannon-entropy
// pattern matching over raw text, the same class of technique Gitleaks/
// detect-secrets use. It is a safety net, not a guarantee — see README for
// the false-positive/false-negative discussion. In particular the generic
// high-entropy heuristic is a deliberately lower-confidence, clearly labeled
// "possible" signal: high entropy alone is noisy (random-looking hex like a
// git commit SHA is indistinguishable from a real hex secret by entropy
// alone), so callers must never treat "possible" findings as equivalent to
// the named-pattern "confirmed" rules below.
"use strict";

// ---------------------------------------------------------------------------
// Shannon entropy
// ---------------------------------------------------------------------------

/**
 * Shannon entropy in bits/char of a string, over its own observed character
 * distribution (not a fixed alphabet size). Pure math, no I/O:
 *   H(s) = -sum_i p_i * log2(p_i)
 * Known values used by tests: entropy("aaaa") === 0 (single symbol, zero
 * uncertainty); entropy of a string with n distinct symbols each occurring
 * once === log2(n) (uniform distribution) — e.g. "abcdefgh" (8 distinct
 * chars) === log2(8) === 3 exactly.
 */
function shannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  const len = str.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ---------------------------------------------------------------------------
// Named-pattern rules — "confirmed" confidence. Each rule's `find(text)`
// returns an array of {index, length, value} spans (byte/char offsets into
// `text`, 0-based). Regexes are compiled fresh per call (via a factory) so
// concurrent scans never share `lastIndex` state.
// ---------------------------------------------------------------------------

/** Build a `find` fn from a global regex whose match is the whole finding. */
function fromGlobalRegex(pattern) {
  return function find(text) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      out.push({ index: m.index, length: m[0].length, value: m[0] });
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width matches
    }
    return out;
  };
}

/**
 * AWS-style 40-char base64-ish secret near an "aws"/"secret"/"access key"
 * context word on the same line. A bare 40-char base64 run is far too noisy
 * to call "confirmed" on its own (that's what the entropy heuristic is for);
 * requiring a context word on the same line is the standard Gitleaks
 * heuristic for this rule. Matches an EXACT 40-char run (not the prefix of a
 * longer run) so a 60-char blob isn't misreported as an AWS secret — longer
 * high-entropy blobs are still caught by the generic entropy rule.
 */
const AWS_CONTEXT_RE = /aws|secret[_-]?access|access[_-]?key/i;
const AWS_SECRET_TOKEN_RE = /(^|[^A-Za-z0-9/+=])([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])/g;

function findAwsSecretKeys(text) {
  const out = [];
  const lines = text.split("\n");
  let offset = 0;
  for (const line of lines) {
    if (AWS_CONTEXT_RE.test(line)) {
      AWS_SECRET_TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = AWS_SECRET_TOKEN_RE.exec(line))) {
        const value = m[2];
        const localIndex = m.index + m[1].length;
        out.push({ index: offset + localIndex, length: value.length, value });
      }
    }
    offset += line.length + 1; // +1 accounts for the split-out "\n"
  }
  return out;
}

const PATTERN_RULES = [
  {
    id: "aws-access-key-id",
    label: "AWS Access Key ID",
    confidence: "confirmed",
    find: fromGlobalRegex(/AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/),
  },
  {
    id: "aws-secret-access-key",
    label: "AWS Secret Access Key (context-matched)",
    confidence: "confirmed",
    find: findAwsSecretKeys,
  },
  {
    id: "github-token",
    label: "GitHub Token",
    confidence: "confirmed",
    // ghp_/gho_/ghu_/ghs_/ghr_ prefixes per GitHub's own token format.
    find: fromGlobalRegex(/gh[oprsu]_[A-Za-z0-9]{36,255}(?![A-Za-z0-9])/),
  },
  {
    id: "stripe-key",
    label: "Stripe API Key",
    confidence: "confirmed",
    find: fromGlobalRegex(/(?:sk|pk|rk)_live_[A-Za-z0-9]{16,99}(?![A-Za-z0-9])/),
  },
  {
    id: "private-key-header",
    label: "Private Key Header",
    confidence: "confirmed",
    find: fromGlobalRegex(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/),
  },
  {
    id: "slack-token",
    label: "Slack Token",
    confidence: "confirmed",
    find: fromGlobalRegex(/xox[baprs]-[A-Za-z0-9-]{10,72}(?![A-Za-z0-9-])/),
  },
  {
    id: "db-connection-string",
    label: "Database Connection String with Embedded Credentials",
    confidence: "confirmed",
    find: fromGlobalRegex(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:/\s@]+:[^@/\s]+@[^/\s]+/),
  },
];

// ---------------------------------------------------------------------------
// Generic high-entropy heuristic — "possible" confidence, secondary signal.
// Extracts base64-ish and hex-ish candidate tokens above a length floor and
// flags ones whose Shannon entropy clears a threshold. Deliberately NOT
// merged with the named rules above: it is noisier by construction (see
// module header) and every finding it produces must carry confidence
// "possible", never "confirmed".
// ---------------------------------------------------------------------------

const ENTROPY_RULE_ID = "generic-high-entropy";
const ENTROPY_RULE_LABEL = "High-entropy string (possible secret)";

const BASE64_CANDIDATE_RE = /[A-Za-z0-9+/]{20,}={0,2}/g;
const HEX_CANDIDATE_RE = /[0-9a-fA-F]{32,}/g;

const BASE64_MIN_LEN = 20;
const BASE64_ENTROPY_THRESHOLD = 4.3; // bits/char; see rules.test.js for the calibration samples
const HEX_MIN_LEN = 32;
const HEX_ENTROPY_THRESHOLD = 3.0; // bits/char; hex's max possible is log2(16) = 4.0

/**
 * Scan `text` for high-entropy base64/hex-looking tokens. `exclude` is an
 * optional array of already-claimed {index, length} spans (from the
 * confirmed rules) so the same substring isn't double-reported once as
 * "confirmed" and again as "possible".
 */
function findHighEntropyStrings(text, exclude) {
  const claimed = (exclude || []).map((s) => [s.index, s.index + s.length]);
  const isClaimed = (index, length) => claimed.some(([a, b]) => index < b && index + length > a);

  const out = [];
  const seen = new Set(); // dedupe same span found by both candidate regexes

  const consider = (index, value, minLen, threshold) => {
    if (value.length < minLen) return;
    if (isClaimed(index, value.length)) return;
    const key = index + ":" + value.length;
    if (seen.has(key)) return;
    const entropy = shannonEntropy(value);
    if (entropy >= threshold) {
      seen.add(key);
      out.push({ index, length: value.length, value, entropy });
    }
  };

  let m;
  BASE64_CANDIDATE_RE.lastIndex = 0;
  while ((m = BASE64_CANDIDATE_RE.exec(text))) consider(m.index, m[0], BASE64_MIN_LEN, BASE64_ENTROPY_THRESHOLD);
  HEX_CANDIDATE_RE.lastIndex = 0;
  while ((m = HEX_CANDIDATE_RE.exec(text))) consider(m.index, m[0], HEX_MIN_LEN, HEX_ENTROPY_THRESHOLD);

  return out;
}

module.exports = {
  shannonEntropy,
  PATTERN_RULES,
  ENTROPY_RULE_ID,
  ENTROPY_RULE_LABEL,
  BASE64_MIN_LEN,
  BASE64_ENTROPY_THRESHOLD,
  HEX_MIN_LEN,
  HEX_ENTROPY_THRESHOLD,
  findHighEntropyStrings,
  findAwsSecretKeys, // exported for direct unit testing
};
