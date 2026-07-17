// Tests for lib/trace-parse.js — pure JSONL parsing, no I/O.
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseTraceJsonl } = require("../lib/trace-parse.js");

test("parseTraceJsonl: empty/undefined input yields []", () => {
  assert.deepEqual(parseTraceJsonl(""), []);
  assert.deepEqual(parseTraceJsonl(undefined), []);
  assert.deepEqual(parseTraceJsonl(null), []);
});

test("parseTraceJsonl: parses multiple valid lines in order", () => {
  const raw = [
    JSON.stringify({ promptId: "p1", startedAt: 1 }),
    JSON.stringify({ promptId: "p2", startedAt: 2 }),
  ].join("\n");
  const turns = parseTraceJsonl(raw);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].promptId, "p1");
  assert.equal(turns[1].promptId, "p2");
});

test("parseTraceJsonl: skips a malformed trailing line (simulating a kill mid-append) without losing earlier valid lines", () => {
  const raw = `${JSON.stringify({ promptId: "good", startedAt: 1 })}\n{not valid json\n`;
  const turns = parseTraceJsonl(raw);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].promptId, "good");
});

test("parseTraceJsonl: drops lines that parse but aren't turn-shaped (no string promptId)", () => {
  const raw = [
    JSON.stringify({ promptId: "ok", startedAt: 1 }),
    JSON.stringify({ notATurn: true }),
    JSON.stringify(42),
    JSON.stringify(null),
  ].join("\n");
  const turns = parseTraceJsonl(raw);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].promptId, "ok");
});

test("parseTraceJsonl: ignores blank lines between records", () => {
  const raw = `${JSON.stringify({ promptId: "a" })}\n\n\n${JSON.stringify({ promptId: "b" })}\n`;
  const turns = parseTraceJsonl(raw);
  assert.equal(turns.length, 2);
});
