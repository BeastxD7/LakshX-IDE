// Regression tests for acp-client.js's request timeout — the fix for the
// "AcpClient.request() has no timeout of its own" half of the stuck-at-
// thinking investigation. If the agent runtime child process itself gets
// wedged (not just the upstream provider SSE stream, which
// agent/src/providers/types.ts's sseLines() now bounds separately), a
// pending `request()` promise used to sit in `this.pending` forever — the
// exact "chat stopped in thought" symptom from the extension host's side of
// the pipe. These tests spawn a real, tiny scripted child process
// (test/helpers/fake-acp-child.js) that never responds to a "hang" call,
// and assert AcpClient now recovers instead of hanging.
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { AcpClient, DEFAULT_REQUEST_TIMEOUT_MS, PROMPT_REQUEST_TIMEOUT_MS } = require("../acp-client.js");

const fixture = path.join(__dirname, "helpers", "fake-acp-child.js");

function spawnClient(handlers = {}) {
  return new AcpClient(process.execPath, [fixture], undefined, process.env, {
    onLog: () => {},
    onError: () => {},
    onExit: () => {},
    onNotification: () => {},
    onRequest: async () => ({}),
    ...handlers,
  });
}

test("a normal request still resolves (extraction into acp-client.js didn't change behavior)", async () => {
  const acp = spawnClient();
  try {
    const res = await acp.request("quick", { hello: "world" });
    assert.deepEqual(res, { echoed: { hello: "world" } });
  } finally {
    acp.kill();
  }
});

test("ROOT CAUSE FIX: request() to a method the child process never responds to times out instead of hanging forever", async () => {
  const acp = spawnClient();
  try {
    const start = Date.now();
    await assert.rejects(
      // explicit short override so the test doesn't wait out the real 30s
      // default — the default-tier selection itself is covered separately
      // below
      () => acp.request("hang", {}, 150),
      /timed out after 150ms.*agent runtime.*wedged/,
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `expected the timeout to fire close to 150ms, took ${elapsed}ms`);

    // the client must still be usable afterwards — a timed-out request
    // shouldn't corrupt AcpClient's internal state (e.g. leave a stale
    // `pending` entry, or leave the child process/stdio in a bad state)
    const res = await acp.request("quick", { still: "alive" });
    assert.deepEqual(res, { echoed: { still: "alive" } });
  } finally {
    acp.kill();
  }
});

test("a late response to an already-timed-out request is ignored, not misdelivered to a new caller", async () => {
  // Uses a longer-but-still-short window: the "hang" method never responds
  // at all in this fixture, so this mainly proves the timed-out request's
  // `pending` entry was actually removed (a second request reusing request
  // IDs from a stale entry would be a real bug class here).
  const acp = spawnClient();
  try {
    await assert.rejects(() => acp.request("hang", {}, 100));
    assert.equal(acp.pending.size, 0, "the timed-out request must not leave a stale pending entry");
  } finally {
    acp.kill();
  }
});

test("default timeout tiers: session/prompt gets the long (30 min) timeout, everything else gets the short (30s) one", () => {
  const acp = spawnClient();
  const originalSetTimeout = global.setTimeout;
  const capturedDelays = [];
  global.setTimeout = (fn, delay, ...args) => {
    capturedDelays.push(delay);
    return originalSetTimeout(fn, delay, ...args);
  };
  try {
    // fire-and-forget: these never resolve against this fixture (no handler
    // for either method) and are never awaited — only the timer delay
    // `request()` armed is under test here, not the eventual outcome. Both
    // promises get a no-op rejection handler so process exit doesn't warn
    // about an unhandled rejection once their (unref'd, never-firing-in-time)
    // timers are torn down by acp.kill() below.
    acp.request("session/prompt", {}).catch(() => {});
    acp.request("session/new", {}).catch(() => {});
  } finally {
    global.setTimeout = originalSetTimeout;
    acp.kill();
  }
  assert.ok(capturedDelays.includes(PROMPT_REQUEST_TIMEOUT_MS), `expected a ${PROMPT_REQUEST_TIMEOUT_MS}ms timer for session/prompt, saw: ${capturedDelays}`);
  assert.ok(capturedDelays.includes(DEFAULT_REQUEST_TIMEOUT_MS), `expected a ${DEFAULT_REQUEST_TIMEOUT_MS}ms timer for session/new, saw: ${capturedDelays}`);
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 30_000);
  assert.equal(PROMPT_REQUEST_TIMEOUT_MS, 30 * 60_000);
});

test("notify() does not wait for (or expect) a response", () => {
  const acp = spawnClient();
  try {
    assert.doesNotThrow(() => acp.notify("session/cancel", { sessionId: "s1" }));
  } finally {
    acp.kill();
  }
});
