"use strict";
/**
 * Tier 2 — OFF by default, hard-rate-limited: one real LLM call for
 * genuinely rare/special moments, generating a custom quip instead of
 * picking a canned line.
 *
 * Reuses the SAME config surface the main agent resolves its provider from
 * (agent/src/config.ts's loadConfig/resolveModel, and
 * agent/src/providers/anthropic.ts + openai-compat.ts's wire formats) —
 * `~/.lakshx/providers.json`, `defaultModel`, the same PRESETS list. There
 * is deliberately no separate provider config for this feature.
 *
 * This file re-implements (rather than `require()`s) that logic because
 * agent/src is TypeScript compiled/run via tsx/esbuild as a SEPARATE Node
 * process (see agent/package.json, product/lakshx-chat/extension.js's
 * agentSpawnSpec) — this extension is plain CJS with no build step, like
 * every other product/lakshx-* extension, so it cannot `require()` a `.ts`
 * file directly. The algorithm and the on-disk config file are identical;
 * only the call site is duplicated. If agent/src/config.ts's PRESETS list
 * or resolution order ever changes, mirror the change here too.
 *
 * Non-streaming, single short completion (max_tokens ~60) — no SSE parsing
 * needed for a one-line quip, unlike the agent's own streaming turns.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Same built-in presets as agent/src/config.ts's PRESETS (kind, baseUrl, env var) — kept in sync by hand, see file doc above. */
const PRESETS = {
  anthropic: { kind: "anthropic", baseUrl: "https://api.anthropic.com", envKey: "ANTHROPIC_API_KEY" },
  openai: { kind: "openai", baseUrl: "https://api.openai.com/v1", envKey: "OPENAI_API_KEY" },
  openrouter: { kind: "openai", baseUrl: "https://openrouter.ai/api/v1", envKey: "OPENROUTER_API_KEY" },
  deepseek: { kind: "openai", baseUrl: "https://api.deepseek.com/v1", envKey: "DEEPSEEK_API_KEY" },
  groq: { kind: "openai", baseUrl: "https://api.groq.com/openai/v1", envKey: "GROQ_API_KEY" },
  xai: { kind: "openai", baseUrl: "https://api.x.ai/v1", envKey: "XAI_API_KEY" },
  mistral: { kind: "openai", baseUrl: "https://api.mistral.ai/v1", envKey: "MISTRAL_API_KEY" },
  gemini: { kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", envKey: "GEMINI_API_KEY" },
  cerebras: { kind: "openai", baseUrl: "https://api.cerebras.ai/v1", envKey: "CEREBRAS_API_KEY" },
  ollama: { kind: "openai", baseUrl: "http://localhost:11434/v1", envKey: "OLLAMA_API_KEY" },
};

function providersFile() {
  return path.join(os.homedir(), ".lakshx", "providers.json");
}

/** Mirrors agent/src/config.ts's loadConfig(): file config, falling back to env-only mode if the file is missing/invalid. */
function loadConfig(readFileFn = (f) => fs.readFileSync(f, "utf8")) {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileFn(providersFile()));
  } catch {
    /* no config file / invalid JSON — env-only mode, same as config.ts */
  }
  const providers = {};
  for (const [id, preset] of Object.entries(PRESETS)) {
    const user = fileCfg.providers?.[id] ?? {};
    const apiKey = user.apiKey ?? process.env[preset.envKey] ?? (id === "ollama" ? "ollama" : undefined);
    providers[id] = { kind: user.kind ?? preset.kind, baseUrl: user.baseUrl ?? preset.baseUrl, apiKey, headers: user.headers };
  }
  for (const [id, user] of Object.entries(fileCfg.providers ?? {})) {
    if (!providers[id]) providers[id] = user;
  }
  return { defaultModel: fileCfg.defaultModel ?? "anthropic/claude-sonnet-5", providers };
}

/** Mirrors agent/src/config.ts's resolveModel(): "provider/model" -> resolved provider config + bare model id. Throws (caller must catch) on any misconfiguration — same contract as the agent's own resolveModel. */
function resolveModel(cfg, modelString) {
  const spec = modelString ?? cfg.defaultModel;
  const slash = spec.indexOf("/");
  if (slash === -1) throw new Error(`Model "${spec}" must be "provider/model"`);
  const providerId = spec.slice(0, slash);
  const model = spec.slice(slash + 1);
  const provider = cfg.providers[providerId];
  if (!provider) throw new Error(`Unknown provider "${providerId}"`);
  if (!provider.apiKey) throw new Error(`No API key for "${providerId}"`);
  return { providerId, provider, model };
}

/** One human-readable line describing what just happened, fed to the model as the only context it gets. Kept short and factual — no source code, no file contents, ever. */
function describeMoment(category, meta = {}) {
  switch (category) {
    case "bigWin":
      return meta.hadFailure
        ? `The coding agent hit an error mid-task, recovered, and cleanly finished changing ${meta.fileCount ?? "several"} file(s) in the same turn.`
        : `The coding agent just landed a large, clean change touching ${meta.fileCount ?? "several"} files in one turn.`;
    case "slickChange":
      return `The coding agent just made a fast, clean multi-file change (${meta.fileCount ?? "several"} files) in under a minute.`;
    case "agentTrouble":
      return `The coding agent's tool call just failed or was denied permission (${meta.count ?? "one"} time(s) recently).`;
    default:
      return `Something notable just happened in the developer's IDE (category: ${category}).`;
  }
}

const SYSTEM_PROMPT =
  "You are a cheeky, warm, cricket-commentary-style color commentator reacting to a software " +
  "developer's IDE activity. Write exactly ONE short one-liner (max 20 words), full of cricket-commentary " +
  "energy and personality, playful and encouraging — never mean, never demotivating, even when reacting " +
  "to a failure or a struggle. Respond with ONLY the line itself: no quotes, no preamble, no explanation.";

/** Trim to one clean line, strip control characters, cap length — the model's output is less trusted than the curated bank, so it gets sanitized before ever reaching TTS or the UI. */
function sanitizeQuip(raw) {
  if (typeof raw !== "string") return null;
  let out = raw
    .replace(/[\r\n\t]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .trim();
  out = out.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (out.length === 0) return null;
  const MAX_LEN = 220;
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN).trim() + "…";
  return out;
}

async function callAnthropic(resolved, prompt, signal, fetchImpl) {
  const res = await fetchImpl(`${resolved.provider.baseUrl}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": resolved.provider.apiKey,
      "anthropic-version": "2023-06-01",
      ...resolved.provider.headers,
    },
    body: JSON.stringify({
      model: resolved.model,
      max_tokens: 60,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const block = json?.content?.find((b) => b.type === "text");
  return block?.text ?? "";
}

async function callOpenAiCompat(resolved, prompt, signal, fetchImpl) {
  const res = await fetchImpl(`${resolved.provider.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${resolved.provider.apiKey}`,
      ...resolved.provider.headers,
    },
    body: JSON.stringify({
      model: resolved.model,
      max_tokens: 60,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`${resolved.provider.baseUrl} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

/**
 * Generate one custom quip for `category`/`meta`. Never throws to the
 * caller in normal operation paths it controls, EXCEPT it deliberately lets
 * resolveModel()'s "not configured" errors and network/timeout errors
 * propagate — callers (extension.js) must wrap this in try/catch and fall
 * back to a Tier-1 canned line on ANY failure, per the feature's cost
 * contract ("never crash, silently fall back").
 */
async function generateQuip(category, meta = {}, { fetchImpl = globalThis.fetch, timeoutMs = 8000, cfg } = {}) {
  const resolved = resolveModel(cfg ?? loadConfig());
  const prompt = describeMoment(category, meta);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw =
      resolved.provider.kind === "anthropic"
        ? await callAnthropic(resolved, prompt, controller.signal, fetchImpl)
        : await callOpenAiCompat(resolved, prompt, controller.signal, fetchImpl);
    const clean = sanitizeQuip(raw);
    if (!clean) throw new Error("empty/unusable Tier-2 response");
    return clean;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { PRESETS, loadConfig, resolveModel, describeMoment, sanitizeQuip, generateQuip, SYSTEM_PROMPT };
