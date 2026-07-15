/**
 * Regression test for the OTHER half of the "agent gets stuck mid-thinking
 * forever" bug family: `stream-idle-timeout.test.ts` covers a connection
 * that goes SILENT without closing; this covers a connection that never
 * goes silent — the model just keeps emitting `reasoning_content` deltas
 * continuously, forever, without ever finishing. The idle timer resets on
 * every byte received, so a truly continuous stream never trips it no
 * matter how long it runs; only a hard total-duration ceiling
 * (`streamMaxMs()` / `LAKSHX_STREAM_MAX_MS`, agent/src/providers/types.ts)
 * catches this.
 *
 * This spins up the real server (ACP over stdio) against a scripted fake
 * OpenAI-compatible server that streams a `reasoning_content` delta every
 * few milliseconds, forever (`enqueueContinuous`) — exactly the "chat
 * stopped in thought" symptom reported, where thinking output is visibly
 * still flowing, not stalled — and asserts the runtime now cuts the stream
 * off once it's run too long and surfaces a clear error instead of hanging
 * indefinitely. Both `LAKSHX_STREAM_IDLE_MS` and `LAKSHX_STREAM_MAX_MS` are
 * set so the max-duration ceiling fires well before the idle timer ever
 * could, proving this is the max-duration path, not a disguised idle
 * timeout.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { PRESETS } from "../src/config.js";
import { FakeOpenAI, reasoningDelta } from "./helpers/fake-openai.js";

const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = join(agentDir, "node_modules", ".bin", "tsx");
const serverPath = join(agentDir, "src", "server.ts");

test(
  "a continuously-streaming (never-idle) generation times out via the max-duration ceiling instead of hanging forever",
  { timeout: 30_000 },
  async () => {
    const fake = new FakeOpenAI();
    await fake.start();

    const home = await mkdtemp(join(tmpdir(), "lakshx-maxdur-home-"));
    const workspace = await mkdtemp(join(tmpdir(), "lakshx-maxdur-ws-"));
    await mkdir(join(home, ".lakshx"), { recursive: true });
    await writeFile(
      join(home, ".lakshx", "providers.json"),
      JSON.stringify({
        defaultModel: "fake/test-model",
        providers: {
          fake: { kind: "openai", baseUrl: `http://127.0.0.1:${fake.port}/v1`, apiKey: "test-key-123" },
        },
      }),
    );

    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      // a byte arrives every 50ms (see enqueueContinuous below), so a naive
      // idle timeout would never fire — set it generously above the
      // per-event interval so it genuinely never trips during this test
      LAKSHX_STREAM_IDLE_MS: "5000",
      // ...but the max-duration ceiling fires quickly regardless of the
      // continuous byte flow
      LAKSHX_STREAM_MAX_MS: "500",
    };
    for (const preset of Object.values(PRESETS)) delete env[preset.envKey];
    delete env.LAKSHX_ENABLE_OLLAMA;

    const child = spawn(tsxBin, [serverPath], {
      cwd: workspace,
      env: env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let childStderr = "";
    child.stderr!.on("data", (d) => (childStderr += d));

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!),
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );

    try {
      await acp
        .client({ name: "lakshx-max-duration-test" })
        .onRequest(acp.methods.client.session.requestPermission, async () => ({
          outcome: { outcome: "selected", optionId: "allow" },
        }))
        .connectWith(stream, async (ctx) => {
          await ctx.request(acp.methods.agent.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {},
          });

          return ctx.buildSession(workspace).withSession(async (session: any) => {
            // model keeps "thinking" forever — one delta every 50ms, no stall,
            // no [DONE] — a genuine reasoning loop that never stops
            fake.enqueueContinuous(50, (i) => reasoningDelta(`token${i} `));

            const start = Date.now();
            const done = session.prompt("hello");

            let sawThinking = false;
            let stopMsg: any;
            for (;;) {
              const msg = await session.nextUpdate();
              if (msg.kind === "stop") {
                stopMsg = msg;
                break;
              }
              const u: any = msg.update;
              if (u.sessionUpdate === "agent_thought_chunk" && u.content?.type === "text") {
                sawThinking = true;
              }
            }
            const elapsedMs = Date.now() - start;
            const response = await done;

            // thinking output really was streaming (matches the reported
            // symptom: not a dead connection, an unstoppable one)
            assert.ok(sawThinking, "expected at least one agent_thought_chunk before the cutoff");

            // must resolve well under the 30s test timeout, and specifically
            // bounded by the max-duration ceiling (500ms) plus normal
            // overhead — not by the much longer idle timeout (5000ms) we
            // deliberately set high enough to never fire here
            assert.ok(
              elapsedMs < 5_000,
              `expected the max-duration ceiling to cut the stream off quickly, took ${elapsedMs}ms`,
            );

            // a max-duration cutoff is not a user cancellation — it must
            // surface as a real, user-visible error, exactly like the idle
            // timeout does, not be silently classified as "cancelled" or
            // "end_turn" with no explanation
            assert.equal(response.stopReason, "refusal");
            assert.equal(stopMsg.response.stopReason, "refusal");
          });
        });
    } finally {
      child.kill();
      // the fake server's continuous stream is never closed by the script
      // itself (that's the whole point) — without this, its still-writing
      // interval + still-listening http.Server keep the event loop alive
      // and the test process hangs forever after the assertions pass.
      await fake.stop();
    }
  },
);
