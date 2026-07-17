/**
 * Loop-level test for the always-on local trace recorder (trace-store.ts),
 * driven through a REAL `runPrompt()` call against a scripted OpenAI-
 * compatible provider — same harness style as dispatch-subtasks.test.ts
 * (no ACP framing, just loop.ts + FakeOpenAI). Proves the hook actually
 * fires from the real loop, not just from a hand-built PromptTrace stub
 * (that's what trace-store.test.ts already covers in isolation).
 *
 * FakeOpenAI's SSE builders never emit a `usage` field (see helpers/fake-
 * openai.ts), so `result.usage` is `undefined` for every generation here —
 * this test intentionally asserts SHAPE AND COUNTS (the thing docs asked
 * for: "a trace record with the right shape/counts"), not token values.
 * Usage summation itself is covered by trace-store.test.ts's decorator test,
 * which feeds known usage numbers directly.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { _resetGuardCacheForTests } from "../src/checkpoint.js";
import type { AgentSession, LoopCallbacks } from "../src/loop.js";
import { runPrompt } from "../src/loop.js";
import { getTrace } from "../src/trace-store.js";
import { FakeOpenAI, textTurn, toolTurn } from "./helpers/fake-openai.js";

function makeCallbacks(): LoopCallbacks {
  return {
    onText: () => {},
    onThinking: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onPermission: async () => true,
  };
}

async function setupHome(fake: FakeOpenAI): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "lakshx-trace-loop-home-"));
  await mkdir(join(home, ".lakshx"), { recursive: true });
  await writeFile(
    join(home, ".lakshx", "providers.json"),
    JSON.stringify({
      defaultModel: "fake/test-model",
      providers: { fake: { kind: "openai", baseUrl: `http://127.0.0.1:${fake.port}/v1`, apiKey: "test-key-123" } },
    }),
  );
  return home;
}

test("a real turn with 2 tool calls produces a local trace record with the right shape/counts", { timeout: 30_000 }, async () => {
  const fake = new FakeOpenAI();
  await fake.start();
  const home = await setupHome(fake);
  const workspace = await mkdtemp(join(tmpdir(), "lakshx-trace-loop-ws-"));
  const realHome = process.env.HOME;
  process.env.HOME = home;
  _resetGuardCacheForTests();

  try {
    await writeFile(join(workspace, "a.txt"), "file A contents\n");
    await writeFile(join(workspace, "b.txt"), "file B contents\n");

    // Two round-trips, each a single read_file tool call, then a final
    // plain-text turn that ends the prompt.
    fake.enqueue(toolTurn("call_a", "read_file", { path: "a.txt" }));
    fake.enqueue(toolTurn("call_b", "read_file", { path: "b.txt" }));
    fake.enqueue(textTurn("Read both files."));

    const session: AgentSession = { cwd: workspace, model: "fake/test-model", mode: "review", history: [] };
    const sessionId = randomUUID();
    const promptId = "pr_trace_test";

    const stop = await runPrompt(session, "read both files", makeCallbacks(), promptId, undefined, sessionId);
    assert.equal(stop, "end_turn");

    const turns = getTrace(sessionId);
    assert.equal(turns.length, 1, "one runPrompt() call must record exactly one turn");
    const turn = turns[0];

    assert.equal(turn.promptId, promptId);
    assert.equal(turn.sessionId, sessionId);
    assert.equal(turn.model, "test-model");
    assert.ok(turn.startedAt > 0 && turn.endedAt >= turn.startedAt);

    assert.equal(turn.toolCalls.length, 2, "both read_file calls must be recorded");
    assert.deepEqual(turn.toolCalls.map((t) => t.name), ["read_file", "read_file"]);
    for (const tc of turn.toolCalls) {
      assert.equal(tc.isError, false);
      assert.ok(tc.endedAt >= tc.startedAt);
      assert.ok(tc.inputSummary.includes(".txt"));
      assert.ok(tc.outputSummary.length > 0);
    }

    // 3 provider round-trips (2 tool-call turns + 1 final text turn) → 3 generation spans.
    assert.equal(turn.generations.length, 3);
    assert.ok(turn.generations.every((g) => g.model === "test-model"));
    assert.ok(turn.generations.every((g) => g.endedAt >= g.startedAt));

    // usage is a well-formed object even though FakeOpenAI reports no usage
    // (see this file's module doc) — shape, not value, is what's asserted.
    assert.equal(typeof turn.usage.inputTokens, "number");
    assert.equal(typeof turn.usage.outputTokens, "number");

    // Survives being read back from the JSONL file alone (simulating a
    // process restart / fresh reader), independent of the in-memory ring buffer.
    const raw = await readFile(join(home, ".lakshx", "traces", `${sessionId}.jsonl`), "utf8");
    const fromDisk = raw.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(fromDisk.length, 1);
    assert.equal(fromDisk[0].toolCalls.length, 2);
  } finally {
    process.env.HOME = realHome;
    await fake.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
