/**
 * Unit tests for src/trace-store.ts — the ALWAYS-ON local trace recorder
 * (docs/architecture.md §10 item 1's Langfuse hook has a real, documented
 * gap: it's a strict no-op unless the user self-hosts Langfuse — see
 * tracing.ts's module doc). These tests use REAL file I/O against a tmpdir
 * `HOME` (the same pattern session-persistence.test.ts and
 * dispatch-subtasks.test.ts use for `~/.lakshx/*` stores) rather than mocking
 * `node:fs` — cheap here, and more honest about what actually lands on disk.
 *
 * A separate loop-level test (trace-store-loop.test.ts) drives a real
 * `runPrompt()` call through a FakeOpenAI provider and asserts the shape of
 * what `wrapWithLocalTrace` records for a real 2-tool-call turn.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  getTrace,
  getTurnsFromMemory,
  listTraceKeys,
  pruneTraces,
  readTraceFile,
  recordTurn,
  wrapWithLocalTrace,
  type LocalTurnRecord,
} from "../src/trace-store.js";
import { NOOP_TRACER } from "../src/tracing.js";

/** `tracing.ts` exports `NOOP_TRACER` (a `Tracer`, whose `startTrace()` returns the inert `PromptTrace` these tests want) — there's no separately-exported `NOOP_TRACE`. */
const NOOP_TRACE = NOOP_TRACER.startTrace({ id: "unused", name: "unused" });

async function withTmpHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "lakshx-trace-store-home-"));
  const realHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn(home);
  } finally {
    process.env.HOME = realHome;
    await rm(home, { recursive: true, force: true });
  }
}

function makeTurn(over: Partial<LocalTurnRecord> = {}): LocalTurnRecord {
  const now = Date.now();
  return {
    promptId: randomUUID(),
    sessionId: randomUUID(),
    startedAt: now,
    endedAt: now + 10,
    model: "fake/test-model",
    generations: [],
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1 },
    ...over,
  };
}

test("recordTurn: ring buffer is bounded to the newest 50 turns per key", async () => {
  await withTmpHome(async () => {
    const key = randomUUID();
    for (let i = 0; i < 60; i++) {
      recordTurn(makeTurn({ sessionId: key, promptId: `p${i}`, startedAt: i }));
    }
    const mem = getTurnsFromMemory(key);
    assert.equal(mem.length, 50, "ring buffer must cap at 50 turns");
    // oldest 10 dropped — the newest 50 (startedAt 10..59) must remain, in order
    assert.equal(mem[0].startedAt, 10);
    assert.equal(mem[mem.length - 1].startedAt, 59);
  });
});

test("recordTurn: JSONL append + read round-trip survives a 'process restart' (fresh read from disk)", async () => {
  await withTmpHome(async (home) => {
    const key = randomUUID();
    const t1 = makeTurn({ sessionId: key, promptId: "p1" });
    const t2 = makeTurn({ sessionId: key, promptId: "p2" });
    recordTurn(t1);
    recordTurn(t2);

    // Read the raw file directly, independent of this module's own reader,
    // to prove the on-disk format is genuinely plain JSONL under the
    // documented ~/.lakshx/traces/<key>.jsonl path.
    const raw = await readFile(join(home, ".lakshx", "traces", `${key}.jsonl`), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]).promptId, "p1");
    assert.deepEqual(JSON.parse(lines[1]).promptId, "p2");

    // And via the module's own reader (used as the ACP/viewer fallback path).
    const fromFile = readTraceFile(key);
    assert.equal(fromFile.length, 2);
    assert.equal(fromFile[0].promptId, "p1");
    assert.equal(fromFile[1].promptId, "p2");
  });
});

test("readTraceFile: skips a malformed trailing line instead of failing the whole read", async () => {
  await withTmpHome(async (home) => {
    const key = randomUUID();
    recordTurn(makeTurn({ sessionId: key, promptId: "good" }));
    const dir = join(home, ".lakshx", "traces");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${key}.jsonl`);
    const existing = await readFile(file, "utf8");
    const fs = await import("node:fs/promises");
    await fs.writeFile(file, existing + "{not valid json\n");

    const turns = readTraceFile(key);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].promptId, "good");
  });
});

test("getTrace: prefers the in-memory ring buffer, falls back to the JSONL file when memory is empty", async () => {
  await withTmpHome(async () => {
    const key = randomUUID();
    recordTurn(makeTurn({ sessionId: key, promptId: "from-memory-and-disk" }));
    assert.equal(getTrace(key).length, 1);

    // A key that was never recorded in THIS process (simulating a restart)
    // has an empty ring buffer but nothing on disk either — must return [].
    assert.deepEqual(getTrace(randomUUID()), []);
  });
});

test("listTraceKeys: lists recorded session keys, newest first", async () => {
  await withTmpHome(async () => {
    const a = randomUUID();
    const b = randomUUID();
    recordTurn(makeTurn({ sessionId: a }));
    await new Promise((r) => setTimeout(r, 5));
    recordTurn(makeTurn({ sessionId: b }));
    const keys = listTraceKeys();
    assert.ok(keys.includes(a) && keys.includes(b));
    assert.equal(keys[0], b, "most recently written file should sort first");
  });
});

test("pruneTraces: keeps only the newest N files", async () => {
  await withTmpHome(async () => {
    for (let i = 0; i < 5; i++) {
      recordTurn(makeTurn({ sessionId: `session-${i}` }));
    }
    pruneTraces(2, 60);
    const keys = listTraceKeys();
    assert.equal(keys.length, 2, "pruneTraces(2, ...) must leave exactly 2 files");
  });
});

test("pruneTraces: drops files older than maxAgeDays regardless of count", async () => {
  await withTmpHome(async (home) => {
    const key = randomUUID();
    recordTurn(makeTurn({ sessionId: key }));
    const file = join(home, ".lakshx", "traces", `${key}.jsonl`);
    const oldTime = new Date(Date.now() - 90 * 86_400_000);
    const fs = await import("node:fs/promises");
    await fs.utimes(file, oldTime, oldTime);
    pruneTraces(200, 60);
    assert.deepEqual(listTraceKeys(), []);
  });
});

test("wrapWithLocalTrace: records generation + tool timing/usage and forwards every call to the real tracer", async () => {
  await withTmpHome(async () => {
    let realGenerationEnded: any = null;
    let realToolEnded: any = null;
    let realTraceEnded = false;
    const fakeReal = {
      generation: () => ({ end: (r: any) => { realGenerationEnded = r; } }),
      tool: () => ({ end: (r: any) => { realToolEnded = r; } }),
      end: () => { realTraceEnded = true; },
    };

    const sessionId = randomUUID();
    const trace = wrapWithLocalTrace(fakeReal as any, { promptId: "p1", sessionId, model: "fake/test-model" });

    const gen = trace.generation({ name: "adapter.runTurn", model: "fake/test-model", input: { messageCount: 3 } });
    gen.end({ output: "hello world", usage: { inputTokens: 100, outputTokens: 20 } });

    const tool = trace.tool({ name: "read_file", input: JSON.stringify({ path: "a.txt" }) });
    tool.end({ output: "file contents", isError: false });

    trace.end({ output: "done" });

    // the real (Langfuse-shaped) tracer's own handles must still be called —
    // local recording is additive, never a replacement.
    assert.deepEqual(realGenerationEnded, { output: "hello world", usage: { inputTokens: 100, outputTokens: 20 } });
    assert.deepEqual(realToolEnded, { output: "file contents", isError: false });
    assert.equal(realTraceEnded, true);

    const recorded = getTrace(sessionId);
    assert.equal(recorded.length, 1);
    const turn = recorded[0];
    assert.equal(turn.promptId, "p1");
    assert.equal(turn.model, "fake/test-model");
    assert.equal(turn.generations.length, 1);
    assert.equal(turn.toolCalls.length, 1);
    assert.equal(turn.toolCalls[0].name, "read_file");
    assert.equal(turn.usage.inputTokens, 100, "usage must be summed from generation.end() calls");
    assert.equal(turn.usage.outputTokens, 20);
    assert.ok(turn.endedAt >= turn.startedAt);
  });
});

test("wrapWithLocalTrace: caps oversized output and scrubs secret-shaped strings before they hit disk", async () => {
  await withTmpHome(async () => {
    // No sessionId here on purpose — exercises the "sessionId ?? promptId"
    // fallback key (subtask/background children hit this same path in
    // production, per loop.ts's runPrompt doc comment on its sessionId param).
    const trace = wrapWithLocalTrace(NOOP_TRACE, { promptId: "p1", model: "fake/test-model" });

    const bigOutput = "x".repeat(2000);
    const tool = trace.tool({ name: "bash", input: "echo hi" });
    tool.end({ output: bigOutput, isError: false });

    const secretOutput = "here is my key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const gen = trace.generation({ name: "adapter.runTurn", model: "fake/test-model", input: "system prompt" });
    gen.end({ output: secretOutput });

    trace.end({});

    const [turn] = getTrace("p1"); // keyed by promptId since no sessionId was passed
    assert.ok(turn, "turn should have been recorded under its promptId fallback key");
    assert.ok(turn.toolCalls[0].outputSummary.length < bigOutput.length, "oversized output must be capped");
    assert.match(turn.toolCalls[0].outputSummary, /…$/, "capped output ends with the summarizeText ellipsis marker");
    assert.doesNotMatch(turn.generations[0].outputSummary, /sk-ant-api03-[A-Za-z0-9]+/, "secret-shaped strings must be scrubbed");
    assert.match(turn.generations[0].outputSummary, /\[redacted\]/);
  });
});
