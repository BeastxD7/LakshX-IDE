/**
 * Persistence safety for image-bearing tool_results (Royal Mode 2.0 Stage
 * 1a): a session whose in-memory history carries a screenshot's base64 must
 * persist WITHOUT writing those megabytes to disk — the image part is
 * flattened to a small path-bearing marker string (see store.ts's
 * scrubToolResultContent). Redirects HOME to a temp dir (os.homedir()
 * honors $HOME on POSIX; node --test runs each file in its own process, so
 * the mutation can't leak into other test files).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadSessionFile, saveSessionSoon } from "../src/store.js";
import type { ChatMessage } from "../src/providers/types.js";

test("session save drops screenshot base64, keeps a path marker, and stays loadable", async () => {
  const home = await mkdtemp(join(tmpdir(), "lakshx-store-img-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const bigBase64 = Buffer.alloc(512 * 1024, 7).toString("base64"); // ~512KB raw, ~700KB base64
    const history: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "screenshot the app" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tu_1", name: "browser_act", input: { action: "screenshot" } }],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: [
              { type: "text", text: "Screenshot of http://localhost:3000/ saved." },
              { type: "image", mimeType: "image/png", base64: bigBase64, path: "/ws/.lakshx/tmp/act-42.png" },
            ],
          },
        ],
      },
    ];

    saveSessionSoon({ id: "img-scrub-test", cwd: "/ws", mode: "auto", history });
    // saveSessionSoon debounces 300ms — wait past it
    await new Promise((r) => setTimeout(r, 600));

    const rawOnDisk = await readFile(join(home, ".lakshx", "sessions", "img-scrub-test.json"), "utf8");
    assert.ok(!rawOnDisk.includes(bigBase64.slice(0, 100)), "no screenshot base64 may reach disk");
    assert.ok(rawOnDisk.length < 10_000, `session JSON should be small, got ${rawOnDisk.length} bytes`);
    assert.match(rawOnDisk, /screenshot omitted from saved session: \/ws\/\.lakshx\/tmp\/act-42\.png/);

    // and the file round-trips through the normal loader with flat string content
    const loaded = loadSessionFile("img-scrub-test");
    assert.ok(loaded, "expected the session file to load");
    const toolResult = loaded!.history[2].content[0] as any;
    assert.equal(toolResult.type, "tool_result");
    assert.equal(typeof toolResult.content, "string");
    assert.match(toolResult.content, /Screenshot of http:\/\/localhost:3000\/ saved\./);
    assert.match(toolResult.content, /screenshot omitted/);

    // the in-memory history object must be untouched by the save (scrub
    // works on copies) — the live model keeps seeing the image this session
    const liveContent = history[2].content[0] as any;
    assert.ok(Array.isArray(liveContent.content), "live history must keep its rich content");
    assert.equal(liveContent.content[1].base64, bigBase64);
  } finally {
    process.env.HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  }
});
