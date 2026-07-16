/**
 * Unit tests for the provider adapters' toWire image mapping (Royal Mode
 * 2.0 Stage 1a — model-facing vision). Pure message-shape tests, no
 * network: both toWire functions are exported for exactly this.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { toWire as toAnthropicWire } from "../src/providers/anthropic.js";
import { toWire as toOpenAIWire } from "../src/providers/openai-compat.js";
import type { ChatMessage } from "../src/providers/types.js";
import { toolResultText } from "../src/providers/types.js";
import { IMAGE_UNSUPPORTED_PLACEHOLDER } from "../src/vision.js";

const PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");

/** A user turn carrying one rich tool_result: text part + screenshot part. */
function richToolResultMessage(): ChatMessage {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        content: [
          { type: "text", text: "Screenshot saved." },
          { type: "image", mimeType: "image/png", base64: PNG_B64, path: "/ws/.lakshx/tmp/act-1.png" },
        ],
      },
    ],
  };
}

/* ==================== shared helper ==================== */

test("toolResultText flattens rich content to its text parts and passes strings through", () => {
  assert.equal(toolResultText("plain"), "plain");
  assert.equal(
    toolResultText([
      { type: "text", text: "a" },
      { type: "image", mimeType: "image/png", base64: PNG_B64 },
      { type: "text", text: "b" },
    ]),
    "a\nb",
  );
});

/* ==================== anthropic ==================== */

test("anthropic toWire: rich tool_result maps to a content array with a base64 image source block", () => {
  const wire = toAnthropicWire(richToolResultMessage(), true);
  assert.equal(wire.role, "user");
  const tr = wire.content[0] as any;
  assert.equal(tr.type, "tool_result");
  assert.equal(tr.tool_use_id, "tu_1");
  assert.deepEqual(tr.content, [
    { type: "text", text: "Screenshot saved." },
    { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } },
  ]);
});

test("anthropic toWire: plain string tool_result is unchanged (pre-existing contract)", () => {
  const msg: ChatMessage = {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "tu_2", content: "ok", is_error: false }],
  };
  const wire = toAnthropicWire(msg, true);
  assert.deepEqual(wire.content[0], { type: "tool_result", tool_use_id: "tu_2", content: "ok", is_error: false });
});

test("anthropic toWire: image degrades to the honest placeholder when not vision-capable", () => {
  const wire = toAnthropicWire(richToolResultMessage(), false);
  const tr = wire.content[0] as any;
  assert.deepEqual(tr.content, [
    { type: "text", text: "Screenshot saved." },
    { type: "text", text: IMAGE_UNSUPPORTED_PLACEHOLDER },
  ]);
  // no image bytes anywhere on the wire
  assert.ok(!JSON.stringify(wire).includes(PNG_B64));
});

/* ==================== openai-compat ==================== */

test("openai toWire: rich tool_result emits a tool message plus a user message with a data: image_url", () => {
  const wire = toOpenAIWire([richToolResultMessage()], true);
  assert.equal(wire.length, 2);

  const toolMsg = wire[0];
  assert.equal(toolMsg.role, "tool");
  assert.equal(toolMsg.tool_call_id, "tu_1");
  assert.match(toolMsg.content, /Screenshot saved\./);
  assert.match(toolMsg.content, /attached in the next user message/);

  const userMsg = wire[1];
  assert.equal(userMsg.role, "user");
  const imagePart = userMsg.content.find((p: any) => p.type === "image_url");
  assert.ok(imagePart, "expected an image_url part");
  assert.equal(imagePart.image_url.url, `data:image/png;base64,${PNG_B64}`);
});

test("openai toWire: degrades to honest text (and NO image message) when not vision-capable", () => {
  const wire = toOpenAIWire([richToolResultMessage()], false);
  assert.equal(wire.length, 1, "no follow-up user image message may be emitted");
  assert.equal(wire[0].role, "tool");
  assert.ok(wire[0].content.includes(IMAGE_UNSUPPORTED_PLACEHOLDER));
  assert.ok(!JSON.stringify(wire).includes(PNG_B64), "no image bytes may reach a non-vision wire");
});

test("openai toWire: plain string tool_results and user text are unchanged (pre-existing contract)", () => {
  const messages: ChatMessage[] = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "running it" },
        { type: "tool_use", id: "tu_3", name: "bash", input: { command: "ls" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_3", content: "file.txt", is_error: false },
        { type: "text", text: "now what?" },
      ],
    },
  ];
  const wire = toOpenAIWire(messages, true);
  assert.deepEqual(wire[0].tool_calls, [
    { id: "tu_3", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
  ]);
  assert.deepEqual(wire[1], { role: "tool", tool_call_id: "tu_3", content: "file.txt" });
  assert.deepEqual(wire[2], { role: "user", content: "now what?" });
});

test("openai toWire: is_error tool_result with image keeps the [tool failed] prefix", () => {
  const msg: ChatMessage = {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "tu_4",
        is_error: true,
        content: [
          { type: "text", text: "boom" },
          { type: "image", mimeType: "image/png", base64: PNG_B64 },
        ],
      },
    ],
  };
  const wire = toOpenAIWire([msg], true);
  assert.match(wire[0].content, /^\[tool failed\] boom/);
});
