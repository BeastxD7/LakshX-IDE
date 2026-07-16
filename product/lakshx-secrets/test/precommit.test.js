"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { scanStagedDiff } = require("../lib/precommit.js");
const baselineLib = require("../lib/baseline.js");

const DIFF_WITH_SECRET = [
  "diff --git a/config.env b/config.env",
  "--- a/config.env",
  "+++ b/config.env",
  "@@ -1,1 +1,2 @@",
  " EXISTING=keepme",
  "+AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
  "",
].join("\n");

const DIFF_CLEAN = [
  "diff --git a/app.js b/app.js",
  "--- a/app.js",
  "+++ b/app.js",
  "@@ -1,1 +1,2 @@",
  " const x = 1;",
  "+const y = x + 1;",
  "",
].join("\n");

test("scanStagedDiff: finds a secret introduced in staged changes", () => {
  const findings = scanStagedDiff(DIFF_WITH_SECRET);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "aws-access-key-id");
  assert.equal(findings[0].file, "config.env");
});

test("scanStagedDiff: clean staged changes produce no findings", () => {
  assert.deepEqual(scanStagedDiff(DIFF_CLEAN), []);
});

test("scanStagedDiff: baseline-filters an acknowledged finding out of the staged scan", () => {
  const findings = scanStagedDiff(DIFF_WITH_SECRET);
  const baseline = baselineLib.addToBaseline(baselineLib.emptyBaseline(), findings[0]);
  assert.deepEqual(scanStagedDiff(DIFF_WITH_SECRET, baseline), []);
});

test("scanStagedDiff: does not silently swallow a secret on a context-requiring rule split across diff lines", () => {
  // aws-secret-access-key needs its context word ("aws"/"secret") on the SAME
  // line as the token — since each diff line is scanned independently, a
  // context word on one added line and the token on the next added line is a
  // known limitation (not a false suppression of a same-line case).
  const diffText = [
    "diff --git a/config.env b/config.env",
    "--- a/config.env",
    "+++ b/config.env",
    "@@ -1,0 +1,1 @@",
    "+aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "",
  ].join("\n");
  const findings = scanStagedDiff(diffText);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "aws-secret-access-key");
});
