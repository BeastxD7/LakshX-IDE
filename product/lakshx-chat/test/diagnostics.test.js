// Regression tests for the "copy diagnostics" report builder
// (diagnostics.js), covering the real production bug reported as "Copy
// failed" from the composer's diagnostic report icon.
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildDiagnosticReport, capText, safeJson, indentBlock, BLOCK_HEAD_CHARS, BLOCK_TAIL_CHARS } = require("../diagnostics.js");

const baseCtx = () => ({
  transcript: [],
  workspace: "test-workspace",
  chatTitle: "Test chat",
  chatId: "chat-1",
  sessionId: "sess-1",
  currentModel: "anthropic/claude-sonnet-5",
  mode: "review",
  now: 1_000_000,
});

test("ROOT CAUSE: a transcript containing a tool call does not throw (safeJson/indentBlock were previously undefined)", () => {
  // This is the exact shape that triggered `ReferenceError: safeJson is not
  // defined` in production: any transcript with a tool call hits the "tool"
  // block branch, which calls safeJson()/indentBlock() on the tool input —
  // neither function was ever defined in extension.js. Since nearly every
  // real coding session includes at least one tool call, this reproduced
  // "Copy failed" for essentially all real users, not just the
  // huge-thinking-blob edge case.
  const ctx = {
    ...baseCtx(),
    transcript: [
      { type: "user", ts: 1000, text: "read this file" },
      {
        type: "tool",
        ts: 1010,
        id: "t1",
        title: "Read file",
        kind: "read",
        input: { path: "foo.ts" },
      },
      { type: "toolUpdate", ts: 1020, id: "t1", status: "completed", output: "file contents" },
      { type: "turnEnd", ts: 1030, stopReason: "end_turn" },
    ],
  };
  let report;
  assert.doesNotThrow(() => {
    report = buildDiagnosticReport(ctx);
  });
  assert.match(report, /TOOL CALL: Read file/);
  assert.match(report, /"path": "foo\.ts"/); // safeJson pretty-prints the input
  assert.match(report, /file contents/);
});

test("unrecognized/legacy event kinds (default branch) also do not throw", () => {
  const ctx = {
    ...baseCtx(),
    transcript: [{ type: "someFutureEventType", ts: 1000, weird: { nested: true } }],
  };
  let report;
  assert.doesNotThrow(() => {
    report = buildDiagnosticReport(ctx);
  });
  assert.match(report, /SOMEFUTUREEVENTTYPE/);
});

test("subagentsEnd results (also uses safeJson) does not throw", () => {
  const ctx = {
    ...baseCtx(),
    transcript: [
      { type: "subagentsStart", ts: 1000, batchId: "b1", tasks: [{ id: "t1" }] },
      { type: "subagentsEnd", ts: 1100, batchId: "b1", results: [{ id: "t1", ok: true }] },
    ],
  };
  let report;
  assert.doesNotThrow(() => {
    report = buildDiagnosticReport(ctx);
  });
  assert.match(report, /SUBAGENTS END/);
  assert.match(report, /"ok": true/);
});

test("capText leaves short text untouched", () => {
  const s = "hello world";
  assert.equal(capText(s), s);
});

test("capText trims oversized text with a head/tail marker", () => {
  const head = "H".repeat(20);
  const middle = "M".repeat(50_000);
  const tail = "T".repeat(20);
  const s = head + middle + tail;
  const capped = capText(s, 20, 20);
  assert.ok(capped.startsWith(head), "keeps the head");
  assert.ok(capped.endsWith(tail), "keeps the tail");
  assert.match(capped, /characters trimmed/);
  assert.ok(capped.length < s.length, "capped output is smaller than the original");
});

test("a multi-megabyte thinking block (simulated runaway reasoning loop) is capped, keeping the report small", () => {
  // Simulates the exact scenario the bug report described: the session got
  // stuck because the model streamed a very large amount of continuous
  // thinking text. Each `thought` event is a small streamed delta (as they
  // arrive in production), coalesced by buildDiagnosticReport into one
  // block — here we synthesize ~5MB of accumulated thinking across many
  // small deltas, ending the transcript mid-thought with no turnEnd, the
  // "stuck at thinking" signature.
  const events = [{ type: "user", ts: 0, text: "do something hard" }];
  const CHUNK = "x".repeat(1000);
  const NUM_CHUNKS = 5000; // ~5,000,000 chars total
  for (let i = 0; i < NUM_CHUNKS; i++) {
    events.push({ type: "thought", ts: 1000 + i, text: CHUNK });
  }
  const ctx = { ...baseCtx(), transcript: events, now: 1000 + NUM_CHUNKS + 60_000 };

  const report = buildDiagnosticReport(ctx);

  // the report must stay well under the multi-megabyte range that caused
  // the original clipboard-write failure to reproduce empirically (pipe-based
  // clipboard writes on this machine started failing at ~5MB) — a single
  // capped block tops out at BLOCK_HEAD_CHARS + BLOCK_TAIL_CHARS + a short
  // marker, so the whole report should be a small fraction of the raw
  // 5,000,000-character thinking text.
  assert.ok(
    report.length < 100_000,
    `expected the capped report to be well under 100,000 chars, got ${report.length}`,
  );
  assert.ok(report.length < NUM_CHUNKS * CHUNK.length / 10, "report is dramatically smaller than the raw thinking text");

  // still visibly a "trimmed" block, and still shows real head/tail content
  assert.match(report, /characters trimmed/);
  assert.match(report, new RegExp(`chars total`));

  // the "stuck at thinking" anomaly detection must still fire even though
  // the thought block's TEXT is now trimmed — it's driven by block kind/ts,
  // not text length
  assert.match(report, /ANOMALIES DETECTED/);
  assert.match(report, /stuck at thinking.* signature/);
});

test("assistant text (chunk) blocks are capped the same way as thinking blocks", () => {
  const events = [
    { type: "user", ts: 0, text: "hi" },
    { type: "chunk", ts: 10, text: "A".repeat(30_000) },
    { type: "turnEnd", ts: 20, stopReason: "end_turn" },
  ];
  const report = buildDiagnosticReport({ ...baseCtx(), transcript: events });
  assert.match(report, /ASSISTANT TEXT/);
  assert.match(report, /characters trimmed/);
  assert.ok(report.length < 30_000, "capped chunk block keeps the report much smaller than the raw text");
});

test("small thinking/assistant blocks are NOT marked as trimmed", () => {
  const events = [
    { type: "user", ts: 0, text: "hi" },
    { type: "thought", ts: 10, text: "just thinking a little" },
    { type: "chunk", ts: 20, text: "a short reply" },
    { type: "turnEnd", ts: 30, stopReason: "end_turn" },
  ];
  const report = buildDiagnosticReport({ ...baseCtx(), transcript: events });
  assert.doesNotMatch(report, /characters trimmed/);
  assert.match(report, /just thinking a little/);
  assert.match(report, /a short reply/);
});

test("header still reports basic session metadata correctly", () => {
  const report = buildDiagnosticReport(baseCtx());
  assert.match(report, /Workspace:\s+test-workspace/);
  assert.match(report, /Chat title:\s+Test chat/);
  assert.match(report, /Current model:\s+anthropic\/claude-sonnet-5/);
});

test("safeJson never throws, even on values JSON.stringify chokes on", () => {
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => safeJson(circular));
  assert.match(safeJson(circular), /could not stringify/);
  assert.doesNotThrow(() => safeJson(undefined));
  assert.doesNotThrow(() => safeJson(10n)); // BigInt also throws in JSON.stringify
});

test("indentBlock indents every line", () => {
  const out = indentBlock("a\nb\nc");
  assert.equal(out, "  a\n  b\n  c");
});

test("BLOCK_HEAD_CHARS/BLOCK_TAIL_CHARS are sane, documented constants", () => {
  assert.equal(typeof BLOCK_HEAD_CHARS, "number");
  assert.equal(typeof BLOCK_TAIL_CHARS, "number");
  assert.ok(BLOCK_HEAD_CHARS > 0 && BLOCK_TAIL_CHARS > 0);
});
