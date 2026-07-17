// Tests for lib/trace-aggregate.js — pagination/capping and aggregate-stat
// logic, no I/O. This is the code responsible for the "don't render 10,000
// tool calls at once" requirement, so it's tested directly against that
// scale rather than assumed safe.
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  computeStats,
  paginateTurns,
  capToolCalls,
  DEFAULT_PAGE_SIZE,
  MAX_TOOL_CALLS_PER_TURN_RENDERED,
} = require("../lib/trace-aggregate.js");

function makeTurn(over) {
  return {
    promptId: "p",
    startedAt: 0,
    endedAt: 10,
    model: "m",
    generations: [],
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    ...over,
  };
}

// ---------- computeStats ----------

test("computeStats: sums tokens and tool-call counts across turns", () => {
  const turns = [
    makeTurn({ usage: { inputTokens: 100, outputTokens: 20 }, toolCalls: [{ name: "a", startedAt: 0, endedAt: 5, isError: false }] }),
    makeTurn({ usage: { inputTokens: 50, outputTokens: 10 }, toolCalls: [{ name: "b", startedAt: 0, endedAt: 3, isError: true }] }),
  ];
  const stats = computeStats(turns);
  assert.equal(stats.totalTurns, 2);
  assert.equal(stats.totalInputTokens, 150);
  assert.equal(stats.totalOutputTokens, 30);
  assert.equal(stats.totalToolCalls, 2);
  assert.equal(stats.totalErrors, 1);
});

test("computeStats: slowestToolCalls is sorted descending by duration and capped at 10", () => {
  const toolCalls = [];
  for (let i = 0; i < 25; i++) toolCalls.push({ name: `t${i}`, startedAt: 0, endedAt: i, isError: false });
  const stats = computeStats([makeTurn({ toolCalls })]);
  assert.equal(stats.slowestToolCalls.length, 10);
  assert.equal(stats.slowestToolCalls[0].durationMs, 24);
  for (let i = 1; i < stats.slowestToolCalls.length; i++) {
    assert.ok(stats.slowestToolCalls[i - 1].durationMs >= stats.slowestToolCalls[i].durationMs);
  }
});

test("computeStats: tolerates missing/malformed usage and toolCalls fields", () => {
  const stats = computeStats([{ promptId: "p" }, { promptId: "p2", usage: null, toolCalls: null }]);
  assert.equal(stats.totalInputTokens, 0);
  assert.equal(stats.totalOutputTokens, 0);
  assert.equal(stats.totalToolCalls, 0);
});

// ---------- paginateTurns ----------

test("paginateTurns: default page size, newest-first ordering", () => {
  const turns = [makeTurn({ promptId: "old", startedAt: 1 }), makeTurn({ promptId: "new", startedAt: 100 })];
  const { page, hasMore, total } = paginateTurns(turns, 0);
  assert.equal(total, 2);
  assert.equal(hasMore, false);
  assert.equal(page[0].promptId, "new");
  assert.equal(page[1].promptId, "old");
});

test("paginateTurns: caps a large session's turns to pageSize and reports hasMore correctly across pages", () => {
  const turns = [];
  for (let i = 0; i < 250; i++) turns.push(makeTurn({ promptId: `p${i}`, startedAt: i }));

  const page1 = paginateTurns(turns, 0, DEFAULT_PAGE_SIZE);
  assert.equal(page1.page.length, DEFAULT_PAGE_SIZE);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.total, 250);
  // newest turn (startedAt 249) is first
  assert.equal(page1.page[0].promptId, "p249");

  const page2 = paginateTurns(turns, DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  assert.equal(page2.page.length, DEFAULT_PAGE_SIZE);
  // no overlap between page1 and page2
  const ids1 = new Set(page1.page.map((t) => t.promptId));
  for (const t of page2.page) assert.ok(!ids1.has(t.promptId));

  const lastPage = paginateTurns(turns, 240, DEFAULT_PAGE_SIZE);
  assert.equal(lastPage.hasMore, false, "the final page must report hasMore=false");
});

test("paginateTurns: empty input", () => {
  const { page, hasMore, total } = paginateTurns([], 0);
  assert.deepEqual(page, []);
  assert.equal(hasMore, false);
  assert.equal(total, 0);
});

// ---------- capToolCalls ----------

test("capToolCalls: passes through a small list unchanged with hiddenCount 0", () => {
  const toolCalls = [{ name: "a" }, { name: "b" }];
  const { shown, hiddenCount } = capToolCalls(toolCalls);
  assert.equal(shown.length, 2);
  assert.equal(hiddenCount, 0);
});

test("capToolCalls: caps a pathologically large tool-call list (the '10,000 tool calls' scenario) and reports the hidden count", () => {
  const toolCalls = Array.from({ length: 10_000 }, (_, i) => ({ name: `t${i}` }));
  const { shown, hiddenCount } = capToolCalls(toolCalls);
  assert.equal(shown.length, MAX_TOOL_CALLS_PER_TURN_RENDERED);
  assert.equal(hiddenCount, 10_000 - MAX_TOOL_CALLS_PER_TURN_RENDERED);
  assert.equal(shown[0].name, "t0", "keeps the earliest calls, not a random slice");
});

test("capToolCalls: non-array input degrades to an empty shown list rather than throwing", () => {
  assert.deepEqual(capToolCalls(undefined), { shown: [], hiddenCount: 0 });
  assert.deepEqual(capToolCalls(null), { shown: [], hiddenCount: 0 });
});
