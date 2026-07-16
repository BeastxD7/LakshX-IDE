"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildPreCommitHookScript, isOurHook, MARKER } = require("../lib/hook-template.js");

test("buildPreCommitHookScript: is a valid #!/bin/sh script that calls node with the given absolute path", () => {
  const script = buildPreCommitHookScript("/abs/path/to/bin/precommit-scan.js");
  assert.ok(script.startsWith("#!/bin/sh\n"));
  assert.ok(script.includes('node "/abs/path/to/bin/precommit-scan.js"'));
  assert.ok(script.includes("exit $?"));
});

test("isOurHook: recognizes a script we generated, rejects an arbitrary existing hook", () => {
  const ours = buildPreCommitHookScript("/abs/path.js");
  assert.equal(isOurHook(ours), true);
  assert.equal(isOurHook("#!/bin/sh\nnpm test\n"), false);
  assert.equal(isOurHook(undefined), false);
});

test("buildPreCommitHookScript: always contains the marker isOurHook checks for", () => {
  assert.ok(buildPreCommitHookScript("/x.js").includes(MARKER));
});
