/**
 * Scriptable fake OpenAI-compatible /chat/completions server (SSE).
 * Each incoming request pops the next scripted turn (a list of stream events)
 * and replays it as `data: {...}` SSE chunks followed by `data: [DONE]`.
 * Every request body is recorded for assertions.
 */
import { once } from "node:events";
import { createServer, type Server } from "node:http";

export type SseEvent = Record<string, unknown>;
export type ScriptedTurn = SseEvent[];

export interface RecordedRequest {
  model: string;
  messages: Array<Record<string, any>>;
  tools: Array<Record<string, any>>;
  [k: string]: unknown;
}

export class FakeOpenAI {
  /** Parsed JSON bodies of every /chat/completions request, in order. */
  requests: RecordedRequest[] = [];
  /** Authorization header of every request, in order. */
  authHeaders: Array<string | undefined> = [];
  port = 0;

  private script: ScriptedTurn[] = [];
  private stallScript: ScriptedTurn[] = [];
  private server: Server | undefined;

  /** Queue one or more turns; each request consumes one turn FIFO. */
  enqueue(...turns: ScriptedTurn[]): void {
    this.script.push(...turns);
  }

  /**
   * Queue a turn that streams the given events, then goes silent forever —
   * the connection is deliberately left open (no `[DONE]`, no `res.end()`),
   * simulating a stalled-but-not-closed SSE stream (dead proxy/VPN/upstream,
   * TCP alive, no more bytes ever). Checked ahead of the normal script so a
   * test can queue exactly one of these without disturbing `enqueue()`
   * ordering for everyone else. The connection is force-closed by `stop()`.
   */
  enqueueStall(events: ScriptedTurn): void {
    this.stallScript.push(events);
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let parsed: RecordedRequest;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400).end("bad json");
          return;
        }
        this.requests.push(parsed);
        this.authHeaders.push(req.headers.authorization);

        const stall = this.stallScript.shift();
        if (stall) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          for (const ev of stall) res.write(`data: ${JSON.stringify(ev)}\n\n`);
          // deliberately no [DONE], no res.end() — the socket stays open and silent
          return;
        }

        const turn = this.script.shift();
        if (!turn) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "fake-openai: script exhausted" } }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const ev of turn) res.write(`data: ${JSON.stringify(ev)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    this.port = (this.server.address() as { port: number }).port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    // `close()`'s callback only fires once every connection has ended — for
    // a deliberately-stalled (never-closed) connection that would deadlock,
    // so force-close sockets first/concurrently rather than awaiting close()
    // before reaching for closeAllConnections().
    const closed = new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server.closeAllConnections?.();
    await closed;
  }
}

/* ---------- SSE event builders (OpenAI streaming wire shapes) ---------- */

export const textDelta = (text: string): SseEvent => ({
  choices: [{ index: 0, delta: { content: text } }],
});

export const reasoningDelta = (text: string): SseEvent => ({
  choices: [{ index: 0, delta: { reasoning_content: text } }],
});

export const toolCallDelta = (id: string, name: string, args: object): SseEvent => ({
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } },
        ],
      },
    },
  ],
});

export const finish = (reason = "stop"): SseEvent => ({
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
});

/** A complete plain-text assistant turn. */
export const textTurn = (text: string): ScriptedTurn => [textDelta(text), finish("stop")];

/** A complete single-tool-call turn. */
export const toolTurn = (id: string, name: string, args: object): ScriptedTurn => [
  toolCallDelta(id, name, args),
  finish("tool_calls"),
];
