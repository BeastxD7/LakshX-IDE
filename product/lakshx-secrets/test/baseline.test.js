"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const baselineLib = require("../lib/baseline.js");
const scanner = require("../lib/scanner.js");
const { hashSecret } = require("../lib/hash.js");

test("parseBaseline: tolerates missing/corrupt input, never throws", () => {
  assert.deepEqual(baselineLib.parseBaseline(undefined), baselineLib.emptyBaseline());
  assert.deepEqual(baselineLib.parseBaseline("not json"), baselineLib.emptyBaseline());
  assert.deepEqual(baselineLib.parseBaseline("{}"), baselineLib.emptyBaseline());
  assert.deepEqual(baselineLib.parseBaseline({ entries: "not an array" }), baselineLib.emptyBaseline());
});

test("parseBaseline/serializeBaseline: round-trips entries", () => {
  const baseline = baselineLib.addToBaseline(baselineLib.emptyBaseline(), {
    file: "a.env",
    rule: "aws-access-key-id",
    hash: "deadbeef",
    line: 3,
    redacted: "AKIA…MPLE (20 chars)",
  });
  const roundTripped = baselineLib.parseBaseline(baselineLib.serializeBaseline(baseline));
  assert.equal(roundTripped.entries.length, 1);
  assert.equal(roundTripped.entries[0].hash, "deadbeef");
});

test("serializeBaseline: never contains the raw secret value, only the hash", () => {
  const rawSecret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const finding = scanner.scanText(`aws_secret_access_key = ${rawSecret}`, "a.env")[0];
  const baseline = baselineLib.addToBaseline(baselineLib.emptyBaseline(), finding);
  const json = baselineLib.serializeBaseline(baseline);
  assert.ok(!json.includes(rawSecret), "baseline JSON must never contain the plaintext secret");
  assert.ok(json.includes(finding.hash), "baseline JSON should contain the content hash");
});

test("addToBaseline: acknowledging the same finding twice does not duplicate the entry (idempotent)", () => {
  const finding = { file: "a.env", rule: "r", hash: "h1", line: 1, redacted: "x" };
  let baseline = baselineLib.emptyBaseline();
  baseline = baselineLib.addToBaseline(baseline, finding);
  baseline = baselineLib.addToBaseline(baseline, finding);
  assert.equal(baseline.entries.length, 1);
});

test("filterFindings: a baselined finding is suppressed on the next scan", () => {
  const text = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
  const finding = scanner.scanText(text, "a.env")[0];
  const baseline = baselineLib.addToBaseline(baselineLib.emptyBaseline(), finding);

  // Re-scan the SAME unchanged content — the finding recomputes to the same
  // hash, so it must be filtered out.
  const rescanned = scanner.scanText(text, "a.env");
  const remaining = baselineLib.filterFindings(rescanned, baseline);
  assert.deepEqual(remaining, []);
});

test("filterFindings: CRITICAL — a NEW finding at the same file+line is NOT suppressed once the secret VALUE changes (content-hash, not line-based)", () => {
  const originalLine = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
  const originalFinding = scanner.scanText(originalLine, "a.env")[0];
  const baseline = baselineLib.addToBaseline(baselineLib.emptyBaseline(), originalFinding);

  // Same file, same line NUMBER (line 1), but the secret's VALUE is edited —
  // a different (but still valid-shaped) AWS access key id.
  const editedLine = "AWS_ACCESS_KEY_ID=AKIABBBBBBBBBBBBBBBB";
  const editedFinding = scanner.scanText(editedLine, "a.env")[0];

  assert.notEqual(editedFinding.hash, originalFinding.hash, "different secret values must hash differently");
  assert.equal(editedFinding.line, originalFinding.line, "sanity check: this is genuinely the same line number");

  const remaining = baselineLib.filterFindings([editedFinding], baseline);
  assert.equal(remaining.length, 1, "the edited-line finding must NOT inherit the old baseline entry");
  assert.equal(remaining[0].hash, editedFinding.hash);
});

test("isBaselined: true only for an exact (file, rule, hash) match", () => {
  const finding = { file: "a.env", rule: "aws-access-key-id", hash: "abc123" };
  const baseline = baselineLib.addToBaseline(baselineLib.emptyBaseline(), { ...finding, line: 1, redacted: "x" });

  assert.equal(baselineLib.isBaselined(baseline, finding), true);
  assert.equal(baselineLib.isBaselined(baseline, { ...finding, file: "b.env" }), false, "different file is not baselined");
  assert.equal(baselineLib.isBaselined(baseline, { ...finding, rule: "other-rule" }), false, "different rule is not baselined");
  assert.equal(baselineLib.isBaselined(baseline, { ...finding, hash: "different" }), false, "different hash is not baselined");
});

test("identityFor: produces the same hash lib/scanner.js would compute for the same (rule, value)", () => {
  const value = "AKIAIOSFODNN7EXAMPLE";
  const viaScanner = scanner.scanText(`AWS_ACCESS_KEY_ID=${value}`, "a.env")[0];
  const viaIdentityFor = baselineLib.identityFor("a.env", "aws-access-key-id", value);
  assert.equal(viaIdentityFor.hash, viaScanner.hash);
  assert.equal(viaIdentityFor.hash, hashSecret("aws-access-key-id", value));
});
