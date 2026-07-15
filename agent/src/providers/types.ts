/** Provider-neutral chat types. Anthropic-flavored: richest superset. */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema
}

export interface StreamEvent {
  type: "text";
  text: string;
}

export interface TurnResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface TurnRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** streamed text deltas for live UI */
  onText?: (text: string) => void;
  /** streamed reasoning/thinking deltas, when the model emits them */
  onThinking?: (text: string) => void;
}

export interface ChatAdapter {
  runTurn(req: TurnRequest): Promise<TurnResult>;
}

/**
 * Idle timeout for streaming SSE reads, in ms: how long we'll wait between
 * bytes before declaring the connection dead. Overridable for tests.
 *
 * This is deliberately an IDLE timeout, not a total-request timeout: a
 * `AbortSignal.timeout(N)` on the fetch would have to be set to several
 * minutes to avoid killing legitimately long generations, which makes
 * stall-detection slow. Providers (Anthropic sends SSE `ping` events; most
 * others keep bytes flowing while generating) emit *something* on the wire
 * every few seconds while alive, so a stalled-but-open connection — a real
 * failure mode for long-lived HTTPS streams behind proxies/VPNs/flaky wifi,
 * or an overloaded free-tier upstream — is reliably distinguishable from a
 * merely slow one by silence, not by total elapsed time.
 */
export function streamIdleMs(): number {
  const v = Number(process.env.LAKSHX_STREAM_IDLE_MS);
  return Number.isFinite(v) && v > 0 ? v : 45_000;
}

/**
 * Hard ceiling on a SINGLE `sseLines()` stream's total wall-clock duration,
 * in ms, regardless of how much data is still arriving. Overridable for
 * tests via `LAKSHX_STREAM_MAX_MS`.
 *
 * Complements (does not replace) `streamIdleMs()`: the idle timer only
 * fires on SILENCE, so it never catches a model that keeps emitting
 * `thinking_delta`/`reasoning_content` tokens continuously without ever
 * going idle — a genuine reasoning loop that never stops is, from the idle
 * timer's point of view, indistinguishable from a healthy long generation,
 * because bytes never stop arriving. This is exactly the "stuck at
 * thinking" report this timeout exists to catch: the session isn't dead,
 * it's just never finishing.
 *
 * 10 minutes default: comfortably above any realistic single generation —
 * even a generous extended-thinking budget plus an 8k-token response
 * finishes in well under a minute at typical provider throughput — while
 * still bounded, so a runaway stream fails loudly (via the same
 * `session/prompt` error path idle timeouts already use) instead of
 * hanging the UI forever. A multi-tool-call turn is unaffected: each
 * `adapter.runTurn()` call gets its own fresh `sseLines()` (and thus its
 * own fresh 10-minute budget) per loop iteration, so this bounds a single
 * generation span, not the whole agentic turn.
 */
export function streamMaxMs(): number {
  const v = Number(process.env.LAKSHX_STREAM_MAX_MS);
  return Number.isFinite(v) && v > 0 ? v : 10 * 60_000;
}

/** Minimal SSE line parser shared by both adapters. */
export async function* sseLines(
  body: ReadableStream<Uint8Array>,
  idleMs: number = streamIdleMs(),
  maxMs: number = streamMaxMs(),
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  // One deadline for the WHOLE stream, armed once and reused across every
  // iteration of the read loop below — unlike the idle timer (which resets
  // on every byte received), this keeps counting down regardless of how
  // much data keeps arriving, so a continuously-streaming-but-never-done
  // connection still gets cut off.
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  const maxDeadline = new Promise<never>((_, reject) => {
    maxTimer = setTimeout(
      () =>
        reject(
          new Error(
            `provider stream exceeded max duration of ${maxMs}ms while still receiving data — ` +
              `likely a runaway/continuous generation (e.g. thinking that never stops), not a stalled connection`,
          ),
        ),
      maxMs,
    );
  });
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout>;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`provider stream stalled: no data for ${idleMs}ms`)),
          idleMs,
        );
      });
      let done: boolean, value: Uint8Array | undefined;
      try {
        ({ done, value } = await Promise.race([reader.read(), idle, maxDeadline]));
      } finally {
        clearTimeout(timer!);
      }
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  } finally {
    clearTimeout(maxTimer);
    // on early exit (idle timeout, max-duration timeout, break, or the
    // consumer stopping iteration) release the underlying connection
    // instead of leaking it
    await reader.cancel().catch(() => {});
  }
}
