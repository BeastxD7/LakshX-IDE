/**
 * Provider-level unit tests for `onToolInputDelta` (reliability roadmap:
 * live tool-input streaming) — proves both adapters surface the provider's
 * own incremental JSON-argument fragments as they arrive on the wire,
 * BEFORE the turn resolves, without changing the final `TurnResult.toolCalls`
 * the dispatch path reads.
 *
 * Drives `AnthropicAdapter`/`OpenAICompatAdapter` directly against a fake
 * `fetch` returning a hand-built SSE stream — no real HTTP server needed
 * (both adapters only ever call the global `fetch`), which keeps these fast
 * and focused on the adapter's own event-parsing logic rather than network
 * plumbing (that's what `test/helpers/fake-openai.ts`-based e2e tests are
 * for).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicAdapter } from "../src/providers/anthropic.js";
import { OpenAICompatAdapter } from "../src/providers/openai-compat.js";

/** Build a `Response` whose body is an SSE stream of the given already-formatted `data:` lines. */
function sseResponse(events: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const ev of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      controller.enqueue(enc.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function withFakeFetch<T>(events: unknown[], run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => sseResponse(events)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("AnthropicAdapter: onToolInputDelta fires per input_json_delta fragment, in order, with id/name from content_block_start", async () => {
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 10 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "write_file" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"a.txt",' } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"content":"hello ' } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'world"}' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
  ];

  const deltas: Array<{ index: number; id: string; name: string; delta: string }> = [];
  const adapter = new AnthropicAdapter({ baseUrl: "http://fake", apiKey: "k" } as any);

  const result = await withFakeFetch(events, () =>
    adapter.runTurn({
      model: "m",
      system: "s",
      messages: [],
      tools: [],
      onToolInputDelta: (ev) => deltas.push(ev),
    }),
  );

  // every fragment surfaced, in order, concatenating back to the exact JSON sent
  assert.equal(deltas.map((d) => d.delta).join(""), '{"path":"a.txt","content":"hello world"}');
  assert.ok(deltas.every((d) => d.id === "call_1" && d.name === "write_file"));
  assert.ok(deltas.every((d) => d.index === 0));

  // the FINAL assembled tool call is entirely unaffected by whether onToolInputDelta was wired
  assert.equal(result.toolCalls.length, 1);
  assert.deepEqual(result.toolCalls[0].input, { path: "a.txt", content: "hello world" });
  assert.equal(result.stopReason, "tool_use");
});

test("AnthropicAdapter: onToolInputDelta is a no-op to omit — runTurn works identically without it", async () => {
  const events = [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "bash" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"command":"echo hi"}' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ];
  const adapter = new AnthropicAdapter({ baseUrl: "http://fake", apiKey: "k" } as any);
  const result = await withFakeFetch(events, () => adapter.runTurn({ model: "m", system: "s", messages: [], tools: [] }));
  assert.deepEqual(result.toolCalls[0].input, { command: "echo hi" });
});

test("OpenAICompatAdapter: onToolInputDelta fires per tool_calls[].function.arguments fragment, id/name from the slot once known", async () => {
  const events = [
    {
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, id: "call_9", type: "function", function: { name: "edit_file", arguments: '{"path":"a.ts",' } }] } },
      ],
    },
    {
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"old_string":"x",' } }] } },
      ],
    },
    {
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"new_string":"y"}' } }] } },
      ],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];

  const deltas: Array<{ index: number; id: string; name: string; delta: string }> = [];
  const adapter = new OpenAICompatAdapter({ baseUrl: "http://fake/v1", apiKey: "k" } as any);
  const result = await withFakeFetch(events, () =>
    adapter.runTurn({
      model: "m",
      system: "s",
      messages: [],
      tools: [],
      onToolInputDelta: (ev) => deltas.push(ev),
    }),
  );

  assert.equal(deltas.map((d) => d.delta).join(""), '{"path":"a.ts","old_string":"x","new_string":"y"}');
  assert.ok(deltas.every((d) => d.id === "call_9" && d.name === "edit_file"));

  assert.equal(result.toolCalls.length, 1);
  assert.deepEqual(result.toolCalls[0].input, { path: "a.ts", old_string: "x", new_string: "y" });
});

test("OpenAICompatAdapter: onToolInputDelta still fires (with a synthesized id) even when the provider never sends a call id mid-stream", async () => {
  // Some OpenAI-compatible providers omit `id` on every delta chunk except
  // (sometimes) the very first — this fakes the worst case: never.
  const events = [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "write_file", arguments: '{"path":"x",' } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"z"}' } }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];
  const deltas: Array<{ index: number; id: string; name: string; delta: string }> = [];
  const adapter = new OpenAICompatAdapter({ baseUrl: "http://fake/v1", apiKey: "k" } as any);
  const result = await withFakeFetch(events, () =>
    adapter.runTurn({ model: "m", system: "s", messages: [], tools: [], onToolInputDelta: (ev) => deltas.push(ev) }),
  );

  // synthesized id is non-empty and stable across fragments for the same index
  assert.ok(deltas[0].id, "expected a non-empty synthesized id");
  assert.equal(new Set(deltas.map((d) => d.id)).size, 1, "same synthesized id across all fragments for one call");
  // and it matches the fallback the FINAL toolCalls id gets too, so a UI
  // correlating a live card by delta.id can find the same id in the final tool_call
  assert.equal(deltas[0].id, result.toolCalls[0].id);
});
