// Minimal ACP (JSON-RPC over ndjson/stdio) client — talks to the LakshX
// Agent Runtime child process. Extracted out of extension.js into its own
// zero-vscode-dependency module so it's directly unit-testable with plain
// `node --test` (spawning a real, small, scripted child process) instead of
// only being exercisable inside a running extension host — see
// test/acp-client.test.js, in particular the request-timeout regression
// test for the "chat stopped in thought" investigation: if the runtime
// child process itself gets wedged (not just the upstream provider SSE
// stream, which agent/src/providers/types.ts's sseLines() now bounds with
// its own idle + max-duration timeouts), nothing used to recover the
// extension host's side of the pipe — `request()` had no timeout of its
// own, so a pending promise just sat in `this.pending` forever.
"use strict";

const cp = require("child_process");

// Two tiers, since "how long is legitimate" differs wildly by call:
//  - PROMPT_REQUEST_TIMEOUT_MS (30 min) for "session/prompt": a single
//    agentic turn can legitimately run many tool calls in sequence (up to
//    MAX_ITERATIONS in agent/src/loop.ts), each with its own generation +
//    tool-execution time, so this must stay generous — it's a last-resort
//    "the process is definitely wedged" backstop, not a normal-turn budget.
//  - DEFAULT_REQUEST_TIMEOUT_MS (30s) for everything else (session/new,
//    set_mode, validate, undo, ...) — these are simple administrative
//    round-trips that should never legitimately take anywhere near that
//    long, so a much tighter bound is safe and catches a wedged process
//    much faster for the actions a user is most likely to retry next (new
//    chat, switching mode, etc.) after a stuck turn.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const PROMPT_REQUEST_TIMEOUT_MS = 30 * 60_000;

class AcpClient {
  constructor(command, args, cwd, env, handlers) {
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = handlers;
    this.child = cp.spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.on("data", (d) => handlers.onLog?.(String(d)));
    this.child.on("error", (err) => handlers.onError?.(err));
    this.child.on("exit", (code) => handlers.onExit?.(code));
    let buf = "";
    this.child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this._onMessage(JSON.parse(line));
      }
    });
  }
  _send(msg) {
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }
  /**
   * `timeoutMs` is optional — defaults to PROMPT_REQUEST_TIMEOUT_MS for
   * "session/prompt" and DEFAULT_REQUEST_TIMEOUT_MS for every other method,
   * so existing call sites (`this.acp.request("session/new", ...)` etc.)
   * don't need to change to get a sane bound. On timeout, rejects the
   * caller's promise with a clear message instead of leaving it pending
   * forever, and drops the entry from `this.pending` so a late response
   * (the process wasn't actually dead, just very slow) is harmlessly
   * ignored rather than resolving/rejecting a promise nobody's awaiting
   * anymore.
   */
  request(method, params, timeoutMs) {
    const id = this.nextId++;
    const effectiveTimeout = timeoutMs ?? (method === "session/prompt" ? PROMPT_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(
            new Error(
              `request "${method}" timed out after ${effectiveTimeout}ms with no response from the agent runtime — it may be wedged`,
            ),
          );
        }
      }, effectiveTimeout);
      timer.unref?.(); // never keep the extension host process alive just for this
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this._send({ jsonrpc: "2.0", id, method, params });
    });
  }
  notify(method, params) {
    this._send({ jsonrpc: "2.0", method, params });
  }
  async _onMessage(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    } else if (msg.method && msg.id !== undefined) {
      try {
        const result = await this.handlers.onRequest(msg.method, msg.params);
        this._send({ jsonrpc: "2.0", id: msg.id, result });
      } catch (err) {
        this._send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(err?.message ?? err) } });
      }
    } else if (msg.method) {
      this.handlers.onNotification(msg.method, msg.params);
    }
  }
  kill() {
    try { this.child.kill(); } catch {}
  }
}

module.exports = { AcpClient, DEFAULT_REQUEST_TIMEOUT_MS, PROMPT_REQUEST_TIMEOUT_MS };
