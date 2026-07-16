/**
 * Unit tests for src/vision.ts — the model vision-capability gate that
 * decides whether screenshots become model-visible image blocks (loop.ts)
 * or degrade to text (provider adapters). Pure logic, no browser/network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isVisionCapableModel } from "../src/vision.js";

// pass an explicit env so the real process env (which may carry
// LAKSHX_VISION in a dev shell) can never flip these assertions
const noEnv = {} as NodeJS.ProcessEnv;

test("vision gate: allowlisted model families are vision-capable", () => {
  assert.equal(isVisionCapableModel("claude-sonnet-5", noEnv), true);
  assert.equal(isVisionCapableModel("claude-opus-4-1", noEnv), true);
  assert.equal(isVisionCapableModel("gpt-5", noEnv), true);
  assert.equal(isVisionCapableModel("gpt-5-mini", noEnv), true);
  assert.equal(isVisionCapableModel("gpt-4o", noEnv), true);
  assert.equal(isVisionCapableModel("gpt-4o-mini", noEnv), true);
  assert.equal(isVisionCapableModel("gemini-2.5-pro", noEnv), true);
});

test("vision gate: matching is case-insensitive and tolerates routed provider prefixes", () => {
  // OpenRouter-style ids: the provider segment is stripped before matching
  assert.equal(isVisionCapableModel("anthropic/claude-sonnet-4.5", noEnv), true);
  assert.equal(isVisionCapableModel("openai/gpt-4o", noEnv), true);
  assert.equal(isVisionCapableModel("google/gemini-2.0-flash", noEnv), true);
  assert.equal(isVisionCapableModel("Claude-Sonnet-5", noEnv), true);
});

test("vision gate: unknown/non-vision models are conservatively excluded", () => {
  assert.equal(isVisionCapableModel("deepseek-chat", noEnv), false);
  assert.equal(isVisionCapableModel("llama-3.3-70b", noEnv), false);
  assert.equal(isVisionCapableModel("gpt-3.5-turbo", noEnv), false);
  assert.equal(isVisionCapableModel("mistral-large", noEnv), false);
  // prefix must anchor at the start of the bare name, not appear anywhere
  assert.equal(isVisionCapableModel("not-claude-sonnet", noEnv), false);
  assert.equal(isVisionCapableModel("", noEnv), false);
  assert.equal(isVisionCapableModel(undefined, noEnv), false);
});

test("vision gate: LAKSHX_VISION=0 force-disables even for allowlisted models", () => {
  assert.equal(isVisionCapableModel("claude-sonnet-5", { LAKSHX_VISION: "0" } as NodeJS.ProcessEnv), false);
  assert.equal(isVisionCapableModel("gpt-4o", { LAKSHX_VISION: "false" } as NodeJS.ProcessEnv), false);
});

test("vision gate: LAKSHX_VISION=1 force-enables unknown models", () => {
  assert.equal(isVisionCapableModel("deepseek-chat", { LAKSHX_VISION: "1" } as NodeJS.ProcessEnv), true);
  assert.equal(isVisionCapableModel("some-local-vision-model", { LAKSHX_VISION: "true" } as NodeJS.ProcessEnv), true);
});

test("vision gate: unrecognized override values fall back to the heuristic", () => {
  assert.equal(isVisionCapableModel("claude-sonnet-5", { LAKSHX_VISION: "yes-please" } as NodeJS.ProcessEnv), true);
  assert.equal(isVisionCapableModel("deepseek-chat", { LAKSHX_VISION: "" } as NodeJS.ProcessEnv), false);
});
