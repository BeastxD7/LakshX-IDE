#!/usr/bin/env node
/**
 * Koder Agent Runtime — ACP agent server over stdio.
 * Any ACP client (the Koder panel, Zed, JetBrains, neovim) can drive it.
 */
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { availableProviders, loadConfig } from "./config.js";
import { runPrompt, type AgentSession } from "./loop.js";

interface Session extends AgentSession {
  pending?: AbortController;
}

const sessions = new Map<string, Session>();

acp
  .agent({ name: "koder-agent" })
  .onRequest("initialize", async () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
  }))
  .onRequest("authenticate", async () => ({}))
  .onRequest("session/new", async (ctx) => {
    const sessionId = randomUUID();
    sessions.set(sessionId, { cwd: ctx.params.cwd, history: [] });
    return { sessionId };
  })
  .onRequest("session/set_mode", async () => ({}))
  // Koder extension: list configured providers + current default model
  .onRequest("koder/models", (v: unknown) => v as Record<string, never>, async () => {
    const cfg = loadConfig();
    return { defaultModel: cfg.defaultModel, providers: availableProviders(cfg) };
  })
  // Koder extension: set the model for a session ("provider/model")
  .onRequest(
    "koder/set_model",
    (v: unknown) => v as { sessionId: string; model: string },
    async (ctx) => {
      const s = sessions.get(ctx.params.sessionId);
      if (s) s.model = ctx.params.model;
      return {};
    },
  )
  .onRequest("session/prompt", async (ctx) => {
    const { sessionId, prompt } = ctx.params;
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`unknown session ${sessionId}`);

    session.pending?.abort();
    const abort = new AbortController();
    session.pending = abort;

    const text = prompt
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    const notify = (update: any) =>
      ctx.client.notify(acp.methods.client.session.update, { sessionId, update });

    try {
      const stop = await runPrompt(
        session,
        text,
        {
          onText: (t) =>
            void notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } }),
          onToolStart: (c) =>
            void notify({
              sessionUpdate: "tool_call",
              toolCallId: c.id,
              title: c.title,
              kind: c.kind,
              status: "in_progress",
              rawInput: c.input,
            }),
          onToolEnd: (c) =>
            void notify({
              sessionUpdate: "tool_call_update",
              toolCallId: c.id,
              status: c.isError ? "failed" : "completed",
              content: [{ type: "content", content: { type: "text", text: c.output.slice(0, 4000) } }],
            }),
          onPermission: async (c) => {
            const res = await ctx.client.request(acp.methods.client.session.requestPermission, {
              sessionId,
              toolCall: { toolCallId: c.id, title: c.title, kind: c.kind, status: "pending", rawInput: c.input },
              options: [
                { kind: "allow_once", name: "Allow", optionId: "allow" },
                { kind: "reject_once", name: "Deny", optionId: "deny" },
              ],
            });
            return res.outcome.outcome === "selected" && res.outcome.optionId === "allow";
          },
        },
        abort.signal,
      );
      return { stopReason: abort.signal.aborted ? "cancelled" : stop };
    } catch (err: any) {
      if (abort.signal.aborted) return { stopReason: "cancelled" };
      await notify({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `\n\n⚠️ ${err?.message ?? err}` },
      });
      return { stopReason: "refusal" };
    } finally {
      if (session.pending === abort) session.pending = undefined;
    }
  })
  .onNotification("session/cancel", async (ctx) => {
    sessions.get(ctx.params.sessionId)?.pending?.abort();
  })
  .connect(
    acp.ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    ),
  );

process.stderr.write("koder-agent ready (ACP over stdio)\n");
