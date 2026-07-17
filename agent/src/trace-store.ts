/**
 * Local, ALWAYS-ON agent trace/observability store — independent of
 * tracing.ts's Langfuse hook.
 *
 * docs/architecture.md §10 item 1 shipped `tracing.ts`'s `getTracer()`, but
 * it is a strict no-op unless the user has fully configured a self-hosted
 * Langfuse instance (all three of LANGFUSE_PUBLIC_KEY/SECRET_KEY/BASE_URL —
 * see that file's module doc for why there's deliberately no default
 * endpoint). That means most users — anyone who hasn't stood up Langfuse —
 * get ZERO visibility into what their agent actually did turn to turn: no
 * timing, no token spend, no tool-call trace. That's the gap this file
 * closes, with no external dependency and no configuration required.
 *
 * Design mirrors two existing `~/.lakshx/*` stores rather than inventing a
 * new convention:
 *  - `store.ts` (sessions): plain JSON(L) files under `~/.lakshx/<name>/`,
 *    atomic-ish writes, age/count-bounded pruning (`pruneSessions` →
 *    `pruneTraces` here, same signature shape).
 *  - `audit.ts` (Royal audit log): JSONL, append-only, every write wrapped
 *    in try/catch so a storage failure can never break or slow the agent
 *    loop, and — the key reuse — the exact same `summarizeText`/
 *    `summarizeInput` redaction+capping helpers, so tool/generation input
 *    and output are scrubbed of secret-shaped strings and size-capped
 *    before they ever touch disk here too.
 *
 * `wrapWithLocalTrace()` is the one integration point `loop.ts` calls: it
 * decorates the `PromptTrace` `tracing.ts` already returns (real Langfuse
 * trace or `NOOP_TRACE`) with a second, always-on recording path that reuses
 * the EXACT SAME `generation()`/`tool()`/`end()` call sites — this is a
 * parallel side effect, never a new call site, never a restructuring of the
 * loop, and never something that can make the loop itself slower or less
 * reliable (every recording step is try/catch-wrapped; the real tracer's
 * own call always still happens, even if local recording throws).
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { summarizeInput, summarizeText } from "./audit.js";
import type { PromptTrace } from "./tracing.js";

/** One `adapter.runTurn()` round-trip within a prompt — a prompt can span several when the model makes tool calls before finishing. */
export interface LocalGenerationRecord {
  startedAt: number;
  endedAt: number;
  model: string;
  inputSummary: string;
  outputSummary: string;
  isError: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** One tool execution within a prompt. */
export interface LocalToolCallRecord {
  name: string;
  startedAt: number;
  endedAt: number;
  inputSummary: string;
  outputSummary: string;
  isError: boolean;
}

/** One `runPrompt()` call, start to finish — the unit this store records and the viewer renders one row per. */
export interface LocalTurnRecord {
  promptId: string;
  /** ACP session id when available (top-level prompts); absent for subtask/background children that share their parent's promptId instead — see loop.ts's `runPrompt` doc comment. Also the key this store files the turn under (falls back to `promptId` when absent, so nothing is silently dropped). */
  sessionId?: string;
  startedAt: number;
  endedAt: number;
  model: string;
  generations: LocalGenerationRecord[];
  toolCalls: LocalToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number };
}

const MAX_TURNS_IN_MEMORY = 50;
/** Cap on lines kept per JSONL file — checked periodically (not every append) so a hot loop of tool calls never pays a read+rewrite per turn. */
const MAX_LINES_PER_FILE = 1000;
const COMPACT_CHECK_EVERY = 25;

/** In-memory ring buffers, keyed by session id (or promptId when no session id is available). Empty after a process restart — the JSONL file is what survives that. */
const ringBuffers = new Map<string, LocalTurnRecord[]>();
const appendCounts = new Map<string, number>();

function tracesDir(): string {
  const dir = join(homedir(), ".lakshx", "traces");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Session/prompt ids are already opaque `randomUUID()`-shaped strings in practice, but this is a defensive filesystem-safety net against any key ever containing a path separator or other filesystem-hostile character. */
function sanitizeKey(key: string): string {
  const cleaned = key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
  return cleaned || "unknown";
}

function traceFilePath(key: string): string {
  return join(tracesDir(), `${sanitizeKey(key)}.jsonl`);
}

/** Cap+redact an already-known-shape value the same way audit.ts's Royal log does: strings go through `summarizeText` directly (no double JSON-encoding); anything else is JSON-stringified and capped via `summarizeInput`. Most callers here (loop.ts) already pass pre-summarized values (the same `summarizeText`/`summarizeInput` calls Langfuse's own spans use) — this is a defense-in-depth re-cap, not the only line of defense. */
function capUnknown(value: unknown, max = 500): string {
  if (typeof value === "string") return summarizeText(value, max);
  try {
    return summarizeInput(value);
  } catch {
    return "(unserializable)";
  }
}

function pushRing(key: string, turn: LocalTurnRecord): void {
  const buf = ringBuffers.get(key) ?? [];
  buf.push(turn);
  while (buf.length > MAX_TURNS_IN_MEMORY) buf.shift();
  ringBuffers.set(key, buf);
}

/** Keep only the newest MAX_LINES_PER_FILE lines — bounds a single long-lived session's trace file the same way `pruneTraces` bounds the whole directory. Best-effort: a compaction failure just leaves the file over-cap until the next check, never fatal. */
function compactFileIfNeeded(file: string): void {
  try {
    const raw = readFileSync(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length > MAX_LINES_PER_FILE) {
      writeFileSync(file, lines.slice(-MAX_LINES_PER_FILE).join("\n") + "\n");
    }
  } catch {
    /* best-effort */
  }
}

function appendTraceLine(key: string, turn: LocalTurnRecord): void {
  try {
    const file = traceFilePath(key);
    appendFileSync(file, JSON.stringify(turn) + "\n");
    const count = (appendCounts.get(key) ?? 0) + 1;
    appendCounts.set(key, count);
    if (count % COMPACT_CHECK_EVERY === 0) compactFileIfNeeded(file);
  } catch {
    /* best-effort — a trace-store write failure must never break a turn */
  }
}

/**
 * Record one completed turn: push to the in-memory ring buffer AND append to
 * the durable JSONL file. Never throws — callers (the `wrapWithLocalTrace`
 * decorator below) rely on this being safe to call unconditionally from a
 * `trace.end()` hook.
 */
export function recordTurn(turn: LocalTurnRecord): void {
  const key = turn.sessionId ?? turn.promptId;
  try {
    pushRing(key, turn);
  } catch {
    /* ignore — the JSONL append below is the durable path anyway */
  }
  appendTraceLine(key, turn);
}

/** In-memory ring buffer only (fast path) — `[]` after a process restart or for a key that was never recorded in this process. */
export function getTurnsFromMemory(key: string): LocalTurnRecord[] {
  return ringBuffers.get(key) ?? [];
}

/** Read every recorded turn for `key` straight from its JSONL file. Malformed lines are skipped rather than failing the whole read — a partially-written last line (process killed mid-append) must not poison every earlier, valid line. */
export function readTraceFile(key: string): LocalTurnRecord[] {
  try {
    const raw = readFileSync(traceFilePath(key), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as LocalTurnRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is LocalTurnRecord => r !== null);
  } catch {
    return [];
  }
}

/** Ring buffer first (fresher, cheaper), JSONL file fallback (survives restarts) — the shape a hypothetical live query needs. */
export function getTrace(key: string): LocalTurnRecord[] {
  const mem = getTurnsFromMemory(key);
  if (mem.length) return mem;
  return readTraceFile(key);
}

/** List every trace file's key (basename minus `.jsonl`) — what a session picker would enumerate. Newest first. */
export function listTraceKeys(): string[] {
  try {
    const dir = tracesDir();
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ key: f.slice(0, -".jsonl".length), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((f) => f.key);
  } catch {
    return [];
  }
}

/** Keep the newest N trace files and drop anything older than maxAgeDays — same discipline and same default numbers as `store.ts`'s `pruneSessions`. */
export function pruneTraces(keepNewest = 200, maxAgeDays = 60): void {
  try {
    const dir = tracesDir();
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const full = join(dir, f);
        return { full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    files.forEach((f, i) => {
      if (i >= keepNewest || f.mtime < cutoff) {
        try {
          unlinkSync(f.full);
        } catch {
          /* ignore */
        }
      }
    });
  } catch {
    /* best-effort housekeeping, never fatal */
  }
}

/**
 * Decorate an existing `PromptTrace` (real Langfuse trace or `NOOP_TRACE` —
 * `wrapWithLocalTrace` doesn't know or care which) with always-on local
 * recording, at the SAME `generation()`/`tool()`/`end()` call sites loop.ts
 * already calls for Langfuse. The real trace's own handle is always invoked
 * too (outside the try/catch, so local-recording errors can't suppress it) —
 * this never replaces or short-circuits the existing tracing.ts behavior.
 */
export function wrapWithLocalTrace(trace: PromptTrace, meta: { promptId: string; sessionId?: string; model: string }): PromptTrace {
  const turn: LocalTurnRecord = {
    promptId: meta.promptId,
    sessionId: meta.sessionId,
    startedAt: Date.now(),
    endedAt: 0,
    model: meta.model,
    generations: [],
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  return {
    generation(params) {
      const real = trace.generation(params);
      const startedAt = Date.now();
      return {
        end(result) {
          try {
            turn.generations.push({
              startedAt,
              endedAt: Date.now(),
              model: params.model,
              inputSummary: capUnknown(params.input),
              outputSummary: capUnknown(result.output ?? ""),
              isError: !!result.isError,
              usage: result.usage,
            });
            turn.usage.inputTokens += result.usage?.inputTokens ?? 0;
            turn.usage.outputTokens += result.usage?.outputTokens ?? 0;
          } catch {
            /* recording must never break the loop */
          }
          real.end(result);
        },
      };
    },
    tool(params) {
      const real = trace.tool(params);
      const startedAt = Date.now();
      return {
        end(result) {
          try {
            turn.toolCalls.push({
              name: params.name,
              startedAt,
              endedAt: Date.now(),
              inputSummary: capUnknown(params.input),
              outputSummary: capUnknown(result.output ?? ""),
              isError: !!result.isError,
            });
          } catch {
            /* best-effort */
          }
          real.end(result);
        },
      };
    },
    end(result) {
      try {
        turn.endedAt = Date.now();
        recordTurn(turn);
      } catch {
        /* best-effort */
      }
      trace.end(result);
    },
  };
}
