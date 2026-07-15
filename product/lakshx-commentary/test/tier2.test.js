"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadConfig, resolveModel, describeMoment, sanitizeQuip, generateQuip, PRESETS } = require("../lib/tier2.js");

test("loadConfig falls back to env-only defaults when the providers file is missing/unreadable", () => {
  const cfg = loadConfig(() => {
    throw new Error("ENOENT");
  });
  assert.equal(cfg.defaultModel, "anthropic/claude-sonnet-5");
  assert.ok(cfg.providers.anthropic);
  assert.ok(cfg.providers.openrouter);
});

test("loadConfig honors an on-disk providers.json the same way agent/src/config.ts does", () => {
  const fileJson = JSON.stringify({
    defaultModel: "openai/gpt-5",
    providers: { openai: { apiKey: "sk-test" } },
  });
  const cfg = loadConfig(() => fileJson);
  assert.equal(cfg.defaultModel, "openai/gpt-5");
  assert.equal(cfg.providers.openai.apiKey, "sk-test");
  // presets for providers not mentioned in the file still resolve (env-var fallback path)
  assert.equal(cfg.providers.groq.baseUrl, PRESETS.groq.baseUrl);
});

test("resolveModel splits 'provider/model' and resolves to the provider's config", () => {
  const cfg = { defaultModel: "anthropic/claude-sonnet-5", providers: { anthropic: { kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "key" } } };
  const resolved = resolveModel(cfg);
  assert.equal(resolved.providerId, "anthropic");
  assert.equal(resolved.model, "claude-sonnet-5");
});

test("resolveModel throws (never silently no-ops) when there's no API key configured", () => {
  const cfg = { defaultModel: "anthropic/claude-sonnet-5", providers: { anthropic: { kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: undefined } } };
  assert.throws(() => resolveModel(cfg), /No API key/);
});

test("resolveModel throws on an unknown provider or a malformed model string", () => {
  const cfg = { defaultModel: "anthropic/claude-sonnet-5", providers: {} };
  assert.throws(() => resolveModel(cfg), /Unknown provider/);
  assert.throws(() => resolveModel({ providers: {} }, "not-a-valid-spec"), /must be/);
});

test("describeMoment produces a short factual context string per category, no source code ever included", () => {
  const s = describeMoment("bigWin", { fileCount: 6, hadFailure: true });
  assert.match(s, /6/);
  assert.match(s, /recover/i);
});

test("sanitizeQuip strips control characters, newlines, and wrapping quotes, and caps length", () => {
  assert.equal(sanitizeQuip('"That\'s out!"\n'), "That's out!");
  assert.equal(sanitizeQuip("line1\nline2\tline3"), "line1 line2 line3");
  const long = "x".repeat(500);
  const cleaned = sanitizeQuip(long);
  assert.ok(cleaned.length <= 221);
  assert.ok(cleaned.endsWith("…"));
});

test("sanitizeQuip returns null for empty/non-string input instead of throwing", () => {
  assert.equal(sanitizeQuip(""), null);
  assert.equal(sanitizeQuip("   "), null);
  assert.equal(sanitizeQuip(undefined), null);
  assert.equal(sanitizeQuip(42), null);
});

test("generateQuip calls the anthropic wire shape correctly and sanitizes the result", async () => {
  const cfg = { defaultModel: "anthropic/claude-sonnet-5", providers: { anthropic: { kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "key" } } };
  let capturedUrl, capturedBody, capturedHeaders;
  const fetchImpl = async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    capturedHeaders = opts.headers;
    return {
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "  \"That's a six!\"  \n" }] }),
    };
  };
  const quip = await generateQuip("bigWin", { fileCount: 3 }, { fetchImpl, cfg });
  assert.equal(quip, "That's a six!");
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedHeaders["x-api-key"], "key");
  assert.equal(capturedHeaders["anthropic-version"], "2023-06-01");
  assert.equal(capturedBody.stream, false);
  assert.equal(capturedBody.model, "claude-sonnet-5");
});

test("generateQuip calls the openai-compat wire shape for openai-kind providers", async () => {
  const cfg = { defaultModel: "openrouter/deepseek/deepseek-chat", providers: { openrouter: { kind: "openai", baseUrl: "https://openrouter.ai/api/v1", apiKey: "key" } } };
  let capturedUrl, capturedHeaders;
  const fetchImpl = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Howzat!" } }] }) };
  };
  const quip = await generateQuip("slickChange", {}, { fetchImpl, cfg });
  assert.equal(quip, "Howzat!");
  assert.equal(capturedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(capturedHeaders.authorization, "Bearer key");
});

test("generateQuip propagates a clear error when misconfigured, so callers can fall back to Tier 1", async () => {
  const cfg = { defaultModel: "anthropic/claude-sonnet-5", providers: { anthropic: { kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: undefined } } };
  await assert.rejects(() => generateQuip("bigWin", {}, { cfg, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }));
});

test("generateQuip rejects on a non-ok HTTP response instead of returning garbage", async () => {
  const cfg = { defaultModel: "anthropic/claude-sonnet-5", providers: { anthropic: { kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "key" } } };
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "unauthorized" });
  await assert.rejects(() => generateQuip("bigWin", {}, { cfg, fetchImpl }), /401/);
});
