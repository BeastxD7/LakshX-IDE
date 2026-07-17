// Tests for lib/trace-files.js — real file I/O against a tmpdir HOME
// (cheap, more honest than mocking fs), same pattern the agent side's own
// trace-store.test.ts uses.
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function withTmpHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lakshx-trace-files-home-"));
  const realHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn(home);
  } finally {
    process.env.HOME = realHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("listSessions: [] when ~/.lakshx/traces/ doesn't exist yet", () => {
  withTmpHome(() => {
    delete require.cache[require.resolve("../lib/trace-files.js")];
    const { listSessions } = require("../lib/trace-files.js");
    assert.deepEqual(listSessions(), []);
  });
});

test("listSessions + readSessionRaw: round-trips a written trace file, newest first", () => {
  withTmpHome((home) => {
    const dir = path.join(home, ".lakshx", "traces");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session-a.jsonl"), `${JSON.stringify({ promptId: "p1" })}\n`);
    // ensure a distinct, later mtime for the second file
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(dir, "session-b.jsonl"), `${JSON.stringify({ promptId: "p2" })}\n`);
    fs.utimesSync(path.join(dir, "session-b.jsonl"), later, later);

    delete require.cache[require.resolve("../lib/trace-files.js")];
    const { listSessions, readSessionRaw } = require("../lib/trace-files.js");

    const sessions = listSessions();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].key, "session-b", "newest mtime sorts first");
    assert.ok(sessions.every((s) => typeof s.size === "number"));

    const raw = readSessionRaw("session-a");
    assert.match(raw, /"p1"/);
  });
});

test("readSessionRaw: returns '' (never throws) for a key with no file", () => {
  withTmpHome(() => {
    delete require.cache[require.resolve("../lib/trace-files.js")];
    const { readSessionRaw } = require("../lib/trace-files.js");
    assert.equal(readSessionRaw("does-not-exist"), "");
  });
});

test("readSessionRaw: sanitizes a hostile key instead of escaping the traces directory", () => {
  withTmpHome((home) => {
    delete require.cache[require.resolve("../lib/trace-files.js")];
    const { readSessionRaw } = require("../lib/trace-files.js");
    // A path-traversal-shaped key must not read outside ~/.lakshx/traces/.
    const result = readSessionRaw("../../etc/passwd");
    assert.equal(result, "");
  });
});
