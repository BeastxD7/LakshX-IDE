"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { isToolFailure, findTurnSlice, classifyTurn, decideTurnCategory, THRESHOLDS } = require("../lib/agent-signal.js");

test("isToolFailure only matches a toolUpdate event with status 'failed'", () => {
  assert.equal(isToolFailure({ type: "toolUpdate", status: "failed" }), true);
  assert.equal(isToolFailure({ type: "toolUpdate", status: "completed" }), false);
  assert.equal(isToolFailure({ type: "tool", status: "failed" }), false);
  assert.equal(isToolFailure(null), false);
  assert.equal(isToolFailure(undefined), false);
  assert.equal(isToolFailure("not an event"), false);
});

test("findTurnSlice slices from the preceding 'user' event through 'turnEnd', inclusive", () => {
  const events = [
    { type: "user", ts: 0 },
    { type: "chunk", ts: 1 },
    { type: "turnEnd", ts: 2 },
    { type: "user", ts: 10 },
    { type: "tool", ts: 11 },
    { type: "checkpoint", ts: 12, files: ["a.js"] },
    { type: "turnEnd", ts: 13 },
  ];
  const slice = findTurnSlice(events, 6);
  assert.deepEqual(
    slice.map((e) => e.type),
    ["user", "tool", "checkpoint", "turnEnd"],
  );
});

test("findTurnSlice falls back to slicing from index 0 if no preceding 'user' event exists", () => {
  const events = [{ type: "system", ts: 0 }, { type: "turnEnd", ts: 1 }];
  const slice = findTurnSlice(events, 1);
  assert.equal(slice.length, 2);
});

test("findTurnSlice is defensive about out-of-range indices", () => {
  assert.deepEqual(findTurnSlice([], 0), []);
  assert.deepEqual(findTurnSlice([{ type: "user" }], 5), []);
  assert.deepEqual(findTurnSlice(null, 0), []);
});

test("classifyTurn dedupes files across multiple checkpoints in the same turn", () => {
  const turn = [
    { type: "user", ts: 1000 },
    { type: "checkpoint", files: ["a.js", "b.js"] },
    { type: "checkpoint", files: ["b.js", "c.js"] },
    { type: "turnEnd", ts: 1500, stopReason: "end_turn" },
  ];
  const summary = classifyTurn(turn);
  assert.equal(summary.fileCount, 3);
  assert.equal(summary.hadFailure, false);
  assert.equal(summary.durationMs, 500);
  assert.equal(summary.stopReason, "end_turn");
});

test("classifyTurn detects a failed tool call within the turn", () => {
  const turn = [
    { type: "user", ts: 0 },
    { type: "toolUpdate", status: "failed" },
    { type: "checkpoint", files: ["a.js"] },
    { type: "turnEnd", ts: 100, stopReason: "end_turn" },
  ];
  assert.equal(classifyTurn(turn).hadFailure, true);
});

test("classifyTurn is defensive: missing ts, missing files array, non-object entries never throw", () => {
  const turn = [{ type: "user" }, "garbage", null, { type: "checkpoint", files: "not-an-array" }, { type: "turnEnd" }];
  const summary = classifyTurn(turn);
  assert.equal(summary.fileCount, 0);
  assert.equal(summary.durationMs, null);
});

test("classifyTurn on an empty/invalid input returns a safe default instead of throwing", () => {
  assert.deepEqual(classifyTurn([]), { fileCount: 0, hadFailure: false, durationMs: null, stopReason: null });
  assert.deepEqual(classifyTurn(null), { fileCount: 0, hadFailure: false, durationMs: null, stopReason: null });
});

test("decideTurnCategory: a large clean multi-file turn is a bigWin", () => {
  const summary = { fileCount: THRESHOLDS.bigWinFileCount, hadFailure: false, durationMs: 120_000, stopReason: "end_turn" };
  assert.equal(decideTurnCategory(summary), "bigWin");
});

test("decideTurnCategory: a comeback (failure then success in the same turn) is a bigWin regardless of file count", () => {
  const summary = { fileCount: 1, hadFailure: true, durationMs: 5000, stopReason: "end_turn" };
  assert.equal(decideTurnCategory(summary), "bigWin");
});

test("decideTurnCategory: a fast, moderate multi-file turn with no failure is a slickChange", () => {
  const summary = { fileCount: THRESHOLDS.slickFileCount, hadFailure: false, durationMs: 10_000, stopReason: "end_turn" };
  assert.equal(decideTurnCategory(summary), "slickChange");
});

test("decideTurnCategory: same file count but slow is neither bigWin nor slickChange", () => {
  const summary = { fileCount: THRESHOLDS.slickFileCount, hadFailure: false, durationMs: THRESHOLDS.slickMaxMs + 1, stopReason: "end_turn" };
  assert.equal(decideTurnCategory(summary), null);
});

test("decideTurnCategory: a single-file routine turn is not commentary-worthy", () => {
  const summary = { fileCount: 1, hadFailure: false, durationMs: 2000, stopReason: "end_turn" };
  assert.equal(decideTurnCategory(summary), null);
});

test("decideTurnCategory: an error-terminated turn never triggers a win, even with files touched", () => {
  const summary = { fileCount: 10, hadFailure: true, durationMs: 1000, stopReason: "error" };
  assert.equal(decideTurnCategory(summary), null);
});

test("decideTurnCategory: no files touched at all is never a signal", () => {
  assert.equal(decideTurnCategory({ fileCount: 0, hadFailure: false, durationMs: 1000, stopReason: "end_turn" }), null);
});

test("decideTurnCategory is defensive against a null/undefined summary", () => {
  assert.equal(decideTurnCategory(null), null);
  assert.equal(decideTurnCategory(undefined), null);
});
