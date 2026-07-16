"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  formatDuration,
  classifyStatus,
  boundedUnshift,
  stripAnsi,
  appendOutputChunk,
  finalizeOutputLines,
  truncateCommandText,
  shapeCommandEntry,
} = require("../lib/history.js");

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
test("formatDuration: sub-second durations render as ms", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(1), "1ms");
  assert.equal(formatDuration(999), "999ms");
});

test("formatDuration: sub-minute durations render as seconds with 1 decimal, dropped when exact", () => {
  assert.equal(formatDuration(1000), "1s");
  assert.equal(formatDuration(1234), "1.2s");
  assert.equal(formatDuration(59900), "59.9s");
});

test("formatDuration: minute-plus durations render as Nm SSs", () => {
  assert.equal(formatDuration(60000), "1m 00s");
  assert.equal(formatDuration(65000), "1m 05s");
  assert.equal(formatDuration(3661000), "61m 01s");
});

test("formatDuration: invalid input returns empty string", () => {
  assert.equal(formatDuration(undefined), "");
  assert.equal(formatDuration(NaN), "");
  assert.equal(formatDuration(-5), "");
});

// ---------------------------------------------------------------------------
// classifyStatus
// ---------------------------------------------------------------------------
test("classifyStatus: no endTime is running", () => {
  assert.equal(classifyStatus(undefined, undefined), "running");
});

test("classifyStatus: exitCode 0 is success", () => {
  assert.equal(classifyStatus(100, 0), "success");
});

test("classifyStatus: non-zero exitCode is failure", () => {
  assert.equal(classifyStatus(100, 1), "failure");
  assert.equal(classifyStatus(100, 127), "failure");
});

test("classifyStatus: ended with undefined exitCode is unknown", () => {
  assert.equal(classifyStatus(100, undefined), "unknown");
});

// ---------------------------------------------------------------------------
// boundedUnshift
// ---------------------------------------------------------------------------
test("boundedUnshift: prepends and does not mutate the input array", () => {
  const original = [1, 2, 3];
  const next = boundedUnshift(original, 0, 10);
  assert.deepEqual(next, [0, 1, 2, 3]);
  assert.deepEqual(original, [1, 2, 3]); // unchanged
});

test("boundedUnshift: drops oldest (tail) entries once over the cap", () => {
  const list = [1, 2, 3];
  const next = boundedUnshift(list, 0, 3);
  assert.deepEqual(next, [0, 1, 2]); // "3" fell off the end
});

test("boundedUnshift: default cap is 200", () => {
  const list = Array.from({ length: 200 }, (_, i) => i);
  const next = boundedUnshift(list, -1);
  assert.equal(next.length, 200);
  assert.equal(next[0], -1);
});

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------
test("stripAnsi: removes SGR color codes", () => {
  assert.equal(stripAnsi("\x1b[31mHello\x1b[0m"), "Hello");
});

test("stripAnsi: removes OSC sequences terminated by BEL", () => {
  assert.equal(stripAnsi("\x1b]0;My Title\x07visible"), "visible");
});

test("stripAnsi: leaves plain text untouched", () => {
  assert.equal(stripAnsi("plain text, no escapes"), "plain text, no escapes");
});

test("stripAnsi: handles empty/non-string input", () => {
  assert.equal(stripAnsi(""), "");
  assert.equal(stripAnsi(undefined), "");
});

// ---------------------------------------------------------------------------
// appendOutputChunk / finalizeOutputLines
// ---------------------------------------------------------------------------
test("appendOutputChunk: splits complete lines and holds back the trailing partial", () => {
  let state = { lines: [], partial: "" };
  state = appendOutputChunk(state, "line one\nline two\npartial");
  assert.deepEqual(state.lines, ["line one", "line two"]);
  assert.equal(state.partial, "partial");
});

test("appendOutputChunk: completes a partial line across chunk boundaries", () => {
  let state = { lines: [], partial: "" };
  state = appendOutputChunk(state, "line one\nhalf");
  state = appendOutputChunk(state, "-line-done\nnext");
  assert.deepEqual(state.lines, ["line one", "half-line-done"]);
  assert.equal(state.partial, "next");
});

test("appendOutputChunk: strips ANSI before splitting", () => {
  let state = { lines: [], partial: "" };
  state = appendOutputChunk(state, "\x1b[32mok\x1b[0m\nnext line\n");
  assert.deepEqual(state.lines, ["ok", "next line"]);
});

test("appendOutputChunk: bounds to maxLines, dropping oldest lines", () => {
  let state = { lines: [], partial: "" };
  const chunk = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n") + "\n";
  state = appendOutputChunk(state, chunk, 3);
  assert.deepEqual(state.lines, ["line7", "line8", "line9"]);
});

test("finalizeOutputLines: includes a non-empty trailing partial", () => {
  const state = { lines: ["a", "b"], partial: "c" };
  assert.deepEqual(finalizeOutputLines(state), ["a", "b", "c"]);
});

test("finalizeOutputLines: omits an empty trailing partial", () => {
  const state = { lines: ["a", "b"], partial: "" };
  assert.deepEqual(finalizeOutputLines(state), ["a", "b"]);
});

test("finalizeOutputLines: re-bounds after adding the partial", () => {
  const state = { lines: ["a", "b", "c"], partial: "d" };
  assert.deepEqual(finalizeOutputLines(state, 2), ["c", "d"]);
});

test("finalizeOutputLines: handles null state", () => {
  assert.deepEqual(finalizeOutputLines(null), []);
});

// ---------------------------------------------------------------------------
// truncateCommandText
// ---------------------------------------------------------------------------
test("truncateCommandText: short command passes through unchanged", () => {
  assert.equal(truncateCommandText("git status"), "git status");
});

test("truncateCommandText: collapses internal whitespace/newlines to single spaces", () => {
  assert.equal(truncateCommandText("git   status\n--short"), "git status --short");
});

test("truncateCommandText: elides long commands with a trailing ellipsis", () => {
  const long = "x".repeat(100);
  const out = truncateCommandText(long, 80);
  assert.equal(out.length, 80);
  assert.ok(out.endsWith("…"));
});

test("truncateCommandText: non-string input becomes empty string", () => {
  assert.equal(truncateCommandText(undefined), "");
});

// ---------------------------------------------------------------------------
// shapeCommandEntry
// ---------------------------------------------------------------------------
test("shapeCommandEntry: running command", () => {
  const shaped = shapeCommandEntry({
    commandText: "npm run dev",
    terminalName: "bash",
    startTime: 1000,
    endTime: undefined,
    exitCode: undefined,
    cwd: "/repo",
    outputLines: [],
  });
  assert.equal(shaped.status, "running");
  assert.equal(shaped.iconId, "sync");
  assert.equal(shaped.collapsible, false);
  assert.match(shaped.description, /running…/);
});

test("shapeCommandEntry: successful command shows check icon and duration", () => {
  const shaped = shapeCommandEntry({
    commandText: "echo hi",
    terminalName: "zsh",
    startTime: 1000,
    endTime: 1200,
    exitCode: 0,
    cwd: "/repo",
    outputLines: ["hi"],
  });
  assert.equal(shaped.status, "success");
  assert.equal(shaped.iconId, "pass");
  assert.equal(shaped.iconColorKey, "testing.iconPassed");
  assert.equal(shaped.collapsible, true);
  assert.match(shaped.description, /200ms/);
});

test("shapeCommandEntry: failing command shows error icon and exit code in tooltip", () => {
  const shaped = shapeCommandEntry({
    commandText: "false",
    terminalName: "zsh",
    startTime: 1000,
    endTime: 1050,
    exitCode: 1,
    cwd: undefined,
    outputLines: [],
  });
  assert.equal(shaped.status, "failure");
  assert.equal(shaped.iconId, "error");
  assert.match(shaped.tooltip, /exit 1/);
});

test("shapeCommandEntry: unknown-exit command (e.g. Ctrl+C) shows circle-slash", () => {
  const shaped = shapeCommandEntry({
    commandText: "sleep 100",
    terminalName: "zsh",
    startTime: 1000,
    endTime: 1050,
    exitCode: undefined,
    cwd: undefined,
    outputLines: [],
  });
  assert.equal(shaped.status, "unknown");
  assert.equal(shaped.iconId, "circle-slash");
});

test("shapeCommandEntry: outputOmittedReason surfaces in tooltip", () => {
  const shaped = shapeCommandEntry({
    commandText: "ls",
    terminalName: "zsh",
    startTime: 1000,
    endTime: 1010,
    exitCode: 0,
    outputLines: [],
    outputOmittedReason: "Output capture not available in this VS Code version.",
  });
  assert.match(shaped.tooltip, /Output capture not available/);
});
