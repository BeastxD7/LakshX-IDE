/**
 * End-to-end test for `lakshx/tool_input_delta` (reliability roadmap: live
 * tool-input streaming) through the REAL server (ACP over stdio), same
 * spawn-a-subprocess-against-a-fake-provider style as
 * checkpoint.test.ts/server-e2e.test.ts — this is the layer the loop-level
 * test (test/tool-input-delta.test.ts) can't cover: server.ts's own
 * throttling (`toolDeltaThrottle`) and the notification actually crossing
 * the ACP wire.
 *
 * Per-event-count assertions would be flaky here (the throttle makes count
 * nondeterministic depending on real wall-clock timing) — this only asserts
 * on CONTENT (at least one notification arrived, for the right tool call,
 * and the LAST one carries the true final value) and on the invariant that
 * matters: the standard `tool_call`/`tool_call_update` sequence still
 * completes correctly and in order, exactly as it did before this feature.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { FakeOpenAI, textTurn } from "./helpers/fake-openai.js";

const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = join(agentDir, "node_modules", ".bin", "tsx");
const serverPath = join(agentDir, "src", "server.ts");

function spawnServer(home: string, workspace: string) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home };
  return spawn(tsxBin, [serverPath], { cwd: workspace, env: env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
}

async function setupHome(fake: FakeOpenAI): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "lakshx-tid-e2e-home-"));
  await mkdir(join(home, ".lakshx"), { recursive: true });
  await writeFile(
    join(home, ".lakshx", "providers.json"),
    JSON.stringify({
      defaultModel: "fake/test-model",
      providers: { fake: { kind: "openai", baseUrl: `http://127.0.0.1:${fake.port}/v1`, apiKey: "test-key-123" } },
    }),
  );
  return home;
}

/** A raw OpenAI-compat SSE event carrying one fragment of a single tool call's arguments. */
function argFragment(id: string | undefined, name: string | undefined, argsFragment: string) {
  const fn: Record<string, unknown> = { arguments: argsFragment };
  if (name) fn.name = name;
  return { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, function: fn }] } }] };
}

test("lakshx/tool_input_delta streams write_file's content live through the real server, without disturbing tool_call/tool_call_update", { timeout: 60_000 }, async (t) => {
  const fake = new FakeOpenAI();
  await fake.start();
  const home = await setupHome(fake);
  const workspace = await mkdtemp(join(tmpdir(), "lakshx-tid-e2e-ws-"));

  const child = spawnServer(home, workspace);
  let childStderr = "";
  child.stderr!.on("data", (d) => (childStderr += d));
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);

  const deltas: any[] = [];

  try {
    await acp
      .client({ name: "lakshx-tool-input-delta-test" })
      .onRequest(acp.methods.client.session.requestPermission, async () => ({
        outcome: { outcome: "selected", optionId: "allow" },
      }))
      .onNotification("lakshx/tool_input_delta", (v: unknown) => v as any, async (ctx) => void deltas.push(ctx.params))
      .connectWith(stream, async (ctx) => {
        await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });

        await ctx.buildSession(workspace).withSession(async (session: any) => {
          const sessionId = session.sessionId;
          await ctx.request(acp.methods.agent.session.setMode, { sessionId, modeId: "auto" });

          // fragmented write_file call, split across several SSE chunks —
          // real providers rarely emit an entire JSON object in one chunk
          // for anything beyond a trivial input.
          fake.enqueue([
            argFragment("call_e2e1", "write_file", '{"path":"e2e.txt","content":"alpha '),
            argFragment(undefined, undefined, "beta "),
            argFragment(undefined, undefined, 'gamma"}'),
            { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
          ]);
          fake.enqueue(textTurn("wrote it"));

          const sessionUpdates: any[] = [];
          const done = session.prompt("write a file");
          for (;;) {
            const msg = await session.nextUpdate();
            if (msg.kind === "stop") {
              await done;
              break;
            }
            sessionUpdates.push(msg.update);
          }

          // the standard tool_call -> tool_call_update sequence is intact,
          // unchanged by this feature — one of each, in order, for this call
          const toolCallIdx = sessionUpdates.findIndex((u) => u.sessionUpdate === "tool_call" && u.toolCallId === "call_e2e1");
          const toolUpdateIdx = sessionUpdates.findIndex((u) => u.sessionUpdate === "tool_call_update" && u.toolCallId === "call_e2e1");
          assert.ok(toolCallIdx !== -1, "expected a tool_call notification");
          assert.ok(toolUpdateIdx !== -1, "expected a tool_call_update notification");
          assert.ok(toolCallIdx < toolUpdateIdx, "tool_call must precede tool_call_update");

          // the real dispatch produced the correct file, exactly as before this feature
          const written = await readFile(join(workspace, "e2e.txt"), "utf8");
          assert.equal(written, "alpha beta gamma");

          // and the new live-streaming notification arrived at least once,
          // for the right tool call, its LAST value being the true final
          // content — never asserting an exact count (throttle timing is not
          // deterministic across machines/CI load).
          await new Promise((r) => setTimeout(r, 150)); // let a still-pending throttle timer flush/settle before we read
          assert.ok(deltas.length >= 1, "expected at least one lakshx/tool_input_delta notification");
          assert.ok(deltas.every((d) => d.toolCallId === "call_e2e1" && d.name === "write_file" && d.field === "content"));
          assert.equal(deltas[deltas.length - 1].value, "alpha beta gamma");
        });
      });
  } finally {
    child.kill();
    await fake.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
    if (process.exitCode && childStderr) console.error("--- server stderr ---\n" + childStderr);
  }
});
