"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseUnifiedDiff } = require("../lib/diff.js");

const SAMPLE_DIFF = [
  "diff --git a/config.env b/config.env",
  "index 1234567..89abcde 100644",
  "--- a/config.env",
  "+++ b/config.env",
  "@@ -1,2 +1,3 @@",
  " EXISTING_VAR=keepme",
  "-OLD_VAR=removed",
  "+AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
  "+ANOTHER_VAR=fine",
  "",
].join("\n");

test("parseUnifiedDiff: extracts only added (+) lines, with correct new-file line numbers", () => {
  const added = parseUnifiedDiff(SAMPLE_DIFF);
  assert.equal(added.length, 2);
  assert.equal(added[0].file, "config.env");
  assert.equal(added[0].content, "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
  assert.equal(added[0].line, 2);
  assert.equal(added[1].content, "ANOTHER_VAR=fine");
  assert.equal(added[1].line, 3);
});

test("parseUnifiedDiff: ignores removed (-) lines entirely", () => {
  const added = parseUnifiedDiff(SAMPLE_DIFF);
  assert.ok(!added.some((a) => a.content.includes("removed")));
});

test("parseUnifiedDiff: handles multiple files in one diff", () => {
  const twoFiles = [
    "diff --git a/one.env b/one.env",
    "--- a/one.env",
    "+++ b/one.env",
    "@@ -0,0 +1 @@",
    "+SECRET_ONE=AKIAIOSFODNN7EXAMPLE",
    "diff --git a/two.env b/two.env",
    "--- a/two.env",
    "+++ b/two.env",
    "@@ -0,0 +1 @@",
    "+SECRET_TWO=fine",
    "",
  ].join("\n");
  const added = parseUnifiedDiff(twoFiles);
  assert.equal(added.length, 2);
  assert.equal(added[0].file, "one.env");
  assert.equal(added[1].file, "two.env");
});

test("parseUnifiedDiff: a new file (added from /dev/null) is handled", () => {
  const newFileDiff = [
    "diff --git a/new.env b/new.env",
    "new file mode 100644",
    "index 0000000..1234567",
    "--- /dev/null",
    "+++ b/new.env",
    "@@ -0,0 +1,2 @@",
    "+LINE_ONE=hello",
    "+LINE_TWO=world",
    "",
  ].join("\n");
  const added = parseUnifiedDiff(newFileDiff);
  assert.equal(added.length, 2);
  assert.equal(added[0].line, 1);
  assert.equal(added[1].line, 2);
});

test("parseUnifiedDiff: empty/undefined input returns an empty array, not a throw", () => {
  assert.deepEqual(parseUnifiedDiff(""), []);
  assert.deepEqual(parseUnifiedDiff(undefined), []);
});

test("parseUnifiedDiff: a pure deletion (no +++ target) contributes no added lines", () => {
  const deletionDiff = [
    "diff --git a/gone.env b/gone.env",
    "deleted file mode 100644",
    "--- a/gone.env",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-OLD_ONE=bye",
    "-OLD_TWO=bye",
    "",
  ].join("\n");
  assert.deepEqual(parseUnifiedDiff(deletionDiff), []);
});
