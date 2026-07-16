"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const scanner = require("../lib/scanner.js");

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

test("redact: shows first 4 + last 4 chars + length, never the middle", () => {
  const secret = "AKIAIOSFODNN7EXAMPLE";
  const redacted = scanner.redact(secret);
  assert.equal(redacted, "AKIA…MPLE (20 chars)");
  assert.ok(!redacted.includes("IOSFODNN7EXA"));
});

test("redact: short values (<=8 chars) are fully masked, not partially revealed", () => {
  assert.equal(scanner.redact("abcd1234"), "********");
  assert.equal(scanner.redact(""), "");
});

// ---------------------------------------------------------------------------
// Line-number mapping
// ---------------------------------------------------------------------------

test("lineForOffset: maps offsets to correct 1-based line numbers", () => {
  const text = "line1\nline2\nline3";
  const idx = scanner.buildLineIndex(text);
  assert.equal(scanner.lineForOffset(idx, 0), 1); // start of line1
  assert.equal(scanner.lineForOffset(idx, 6), 2); // start of line2
  assert.equal(scanner.lineForOffset(idx, 12), 3); // start of line3
  assert.equal(scanner.lineForOffset(idx, 16), 3); // last char of line3
});

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

test("isLikelyBinary: a buffer with a NUL byte is binary", () => {
  assert.equal(scanner.isLikelyBinary(Buffer.from([0x48, 0x65, 0x00, 0x6c])), true);
});

test("isLikelyBinary: plain UTF-8 text is not binary", () => {
  assert.equal(scanner.isLikelyBinary(Buffer.from("hello world\nsecond line", "utf8")), false);
});

test("isLikelyBinary: empty buffer is not binary", () => {
  assert.equal(scanner.isLikelyBinary(Buffer.alloc(0)), false);
});

// ---------------------------------------------------------------------------
// scanText — end-to-end per-file scan, one realistic sample per rule
// ---------------------------------------------------------------------------

const SAMPLE_FILE = [
  "# config.env",
  "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
  "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "GITHUB_TOKEN=ghp_aB3dE6fG9hJ2kL5mN8pQ1rS4tU7vW0xY2zA5cD8x",
  "STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc",
  "DATABASE_URL=postgres://myuser:hunter2pass@db.example.com:5432/prod",
  "SLACK_TOKEN=xoxb-111222333-444555666-abcDEFghiJKLmnoPQR",
  "# a normal comment, not a secret",
  "-----BEGIN RSA PRIVATE KEY-----",
].join("\n");

test("scanText: finds all seven confirmed rules in a realistic multi-secret file, with correct line numbers", () => {
  const findings = scanner.scanText(SAMPLE_FILE, "config.env");
  const byRule = new Map(findings.map((f) => [f.rule, f]));

  assert.equal(byRule.get("aws-access-key-id").line, 2);
  assert.equal(byRule.get("aws-secret-access-key").line, 3);
  assert.equal(byRule.get("github-token").line, 4);
  assert.equal(byRule.get("stripe-key").line, 5);
  assert.equal(byRule.get("db-connection-string").line, 6);
  assert.equal(byRule.get("slack-token").line, 7);
  assert.equal(byRule.get("private-key-header").line, 9);

  for (const f of findings) {
    assert.equal(f.confidence, "confirmed");
    assert.equal(f.file, "config.env");
    assert.ok(f.hash && f.hash.length === 64, "sha256 hex digest is 64 chars");
    assert.ok(!f.redacted.includes(f.rawValue.slice(8, -4) || "\0"), "redacted form must not leak the middle of the secret");
  }
});

test("scanText: normal application code produces no findings", () => {
  const code = [
    "function computeTotal(items) {",
    "  return items.reduce((sum, item) => sum + item.price * item.qty, 0);",
    "}",
    "module.exports = { computeTotal };",
  ].join("\n");
  assert.deepEqual(scanner.scanText(code, "totals.js"), []);
});

test("scanText: empty/non-string input returns no findings without throwing", () => {
  assert.deepEqual(scanner.scanText("", "empty.txt"), []);
  assert.deepEqual(scanner.scanText(null, "empty.txt"), []);
  assert.deepEqual(scanner.scanText(undefined, "empty.txt"), []);
});

test("scanText: same secret value produces the same hash regardless of file/line (stable identity)", () => {
  const a = scanner.scanText("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "a.env")[0];
  const b = scanner.scanText("\n\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "a.env")[0];
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.line, b.line);
});

test("scanFiles: aggregates findings across multiple files with correct `file` tagging", () => {
  const files = [
    { path: "one.env", text: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" },
    { path: "two.js", text: "function safe() { return 1; }" },
  ];
  const findings = scanner.scanFiles(files);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "one.env");
});
