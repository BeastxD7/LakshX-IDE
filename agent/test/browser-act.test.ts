/**
 * Unit + e2e tests for src/browser.ts's `browser_act` — the session-scoped
 * interactive browser (Royal Mode 2.0 Stage 1a).
 *
 * Pure tests (ref validation, snapshot capping, bounded drain buffers,
 * action validation) never launch a browser. The e2e tests drive a real
 * system Chrome/Edge against a local loopback HTTP server and are skipped
 * (not failed) when neither browser exists — same discipline as
 * browser.test.ts. Every security invariant browser_preview enforces is
 * re-asserted here on the persistent session: loopback-only navigate,
 * blocked mid-session redirects, isolated context.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { chromium } from "playwright-core";
import {
  BoundedBuffer,
  capSnapshot,
  closeAllBrowserActSessions,
  refToSelector,
  runBrowserAct,
} from "../src/browser.js";

after(async () => {
  await closeAllBrowserActSessions();
});

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "lakshx-browser-act-"));
  try {
    return await fn(dir);
  } finally {
    await closeAllBrowserActSessions(); // sessions are keyed by cwd — drop before the dir goes away
    await rm(dir, { recursive: true, force: true });
  }
}

function serveHtml(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("expected a network address");
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

let browserAvailable: Promise<boolean> | undefined;
function canLaunchBrowser(): Promise<boolean> {
  if (!browserAvailable) {
    browserAvailable = (async () => {
      for (const channel of ["chrome", "msedge"] as const) {
        try {
          const b = await chromium.launch({ channel, headless: true });
          await b.close();
          return true;
        } catch {
          /* try next channel */
        }
      }
      return false;
    })();
  }
  return browserAvailable;
}

/* ==================== pure — no browser required ==================== */

test("refToSelector accepts snapshot-shaped refs and rejects selector/JS smuggling", () => {
  assert.equal(refToSelector("e1"), "aria-ref=e1");
  assert.equal(refToSelector("e142"), "aria-ref=e142");
  assert.throws(() => refToSelector("body"), /not a valid element ref/);
  assert.throws(() => refToSelector("e1, #pwn"), /not a valid element ref/);
  assert.throws(() => refToSelector("aria-ref=e1"), /not a valid element ref/);
  assert.throws(() => refToSelector(""), /not a valid element ref/);
  assert.throws(() => refToSelector(undefined), /not a valid element ref/);
  assert.throws(() => refToSelector(5 as unknown), /not a valid element ref/);
});

test("capSnapshot passes small snapshots through and head-truncates large ones with a note", () => {
  assert.equal(capSnapshot("- button \"Go\" [ref=e2]"), '- button "Go" [ref=e2]');
  const big = "x".repeat(50_000);
  const capped = capSnapshot(big, 1000);
  assert.ok(capped.length < 1200);
  assert.ok(capped.startsWith("x".repeat(1000)));
  assert.match(capped, /snapshot truncated: 49,000 more chars/);
});

test("BoundedBuffer drains since-last-read, caps entries, and counts drops instead of evicting", () => {
  const buf = new BoundedBuffer(3, 10);
  buf.push("one");
  buf.push("a-very-long-entry-that-exceeds-the-entry-cap");
  assert.deepEqual(buf.drain(), { items: ["one", "a-very-lon…"], dropped: 0 });
  // after a drain, the buffer starts fresh
  assert.deepEqual(buf.drain(), { items: [], dropped: 0 });
  for (const n of ["1", "2", "3", "4", "5"]) buf.push(n);
  assert.equal(buf.size, 3);
  assert.deepEqual(buf.drain(), { items: ["1", "2", "3"], dropped: 2 });
});

test("runBrowserAct rejects unknown actions without touching a browser", async () => {
  await withTmp(async (dir) => {
    await assert.rejects(runBrowserAct({ action: "detonate" }, dir), /unknown action "detonate"/);
  });
});

test("runBrowserAct rejects a non-loopback navigate before any browser launches", async () => {
  await withTmp(async (dir) => {
    await assert.rejects(runBrowserAct({ action: "navigate", url: "https://example.com" }, dir), /not allowed/);
    await assert.rejects(runBrowserAct({ action: "navigate", url: "file:///etc/passwd" }, dir), /file:\/\//);
  });
});

test("runBrowserAct requires an existing session for non-navigate actions", async () => {
  await withTmp(async (dir) => {
    await assert.rejects(runBrowserAct({ action: "snapshot" }, dir), /no active browser session/);
    // close with no session is a soft no-op, not an error
    const res = await runBrowserAct({ action: "close" }, dir);
    assert.match(res.text, /no active browser session to close/);
  });
});

/* ==================== e2e — real Chrome/Edge ==================== */

const INTERACTIVE_PAGE = `<!doctype html>
<html><head><title>Act Test</title></head>
<body>
  <h1>Counter App</h1>
  <button id="inc" onclick="
    const n = Number(document.getElementById('count').textContent) + 1;
    document.getElementById('count').textContent = String(n);
    console.log('count is now ' + n);
  ">Increment</button>
  <span id="count">0</span>
  <input aria-label="Your name" id="name" />
  <div id="typed"></div>
  <script>
    document.getElementById('name').addEventListener('input', (e) => {
      document.getElementById('typed').textContent = e.target.value;
    });
  </script>
</body></html>`;

test("e2e: full interactive flow — navigate, snapshot, click via ref, console, network, evaluate, type, screenshot", { timeout: 120_000 }, async (t) => {
  if (!(await canLaunchBrowser())) {
    t.skip("no system Chrome/Edge available in this environment");
    return;
  }
  const page = await serveHtml(INTERACTIVE_PAGE);
  try {
    await withTmp(async (dir) => {
      // navigate
      const nav = await runBrowserAct({ action: "navigate", url: page.url }, dir);
      assert.match(nav.text, /HTTP status: 200/);
      assert.match(nav.text, /Page title: Act Test/);

      // snapshot carries refs for the interactive elements
      const snap = await runBrowserAct({ action: "snapshot" }, dir);
      assert.match(snap.text, /Accessibility snapshot of/);
      const buttonRef = snap.text.match(/button "Increment" \[ref=(e\d+)\]/)?.[1];
      const inputRef = snap.text.match(/textbox "Your name" \[ref=(e\d+)\]/)?.[1];
      assert.ok(buttonRef, `expected a ref for the Increment button in:\n${snap.text}`);
      assert.ok(inputRef, `expected a ref for the name textbox in:\n${snap.text}`);

      // click mutates the DOM — the SAME page across calls (session-scoped)
      await runBrowserAct({ action: "click", ref: buttonRef! }, dir);
      await runBrowserAct({ action: "click", ref: buttonRef! }, dir);
      const count = await runBrowserAct({ action: "evaluate", js: "document.getElementById('count').textContent" }, dir);
      assert.match(count.text, /Result: "2"/);

      // console buffer picked up the click handler's logs; drains on read
      const consoleRead = await runBrowserAct({ action: "read_console" }, dir);
      assert.match(consoleRead.text, /count is now 1/);
      assert.match(consoleRead.text, /count is now 2/);
      const consoleAgain = await runBrowserAct({ action: "read_console" }, dir);
      assert.match(consoleAgain.text, /no console output since last read/);

      // network buffer saw the page load
      const network = await runBrowserAct({ action: "read_network" }, dir);
      assert.match(network.text, /200 GET http:\/\/127\.0\.0\.1:/);

      // type into the input via its ref
      await runBrowserAct({ action: "type", ref: inputRef!, text: "LakshX" }, dir);
      const typed = await runBrowserAct({ action: "evaluate", js: "document.getElementById('typed').textContent" }, dir);
      assert.match(typed.text, /Result: "LakshX"/);

      // screenshot: saved to .lakshx/tmp AND returned as a real PNG attachment
      const shot = await runBrowserAct({ action: "screenshot" }, dir);
      assert.match(shot.text, /Screenshot of http:\/\/127\.0\.0\.1:/);
      assert.ok(shot.image, "expected an image attachment");
      const bytes = Buffer.from(shot.image!.base64, "base64");
      assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const shots = await readdir(join(dir, ".lakshx", "tmp"));
      assert.equal(shots.filter((f) => /^act-\d+\.png$/.test(f)).length, 1);

      // wait_for both modes
      const found = await runBrowserAct({ action: "wait_for", selector: "#count", ms: 2000 }, dir);
      assert.match(found.text, /found/);
      const missing = await runBrowserAct({ action: "wait_for", selector: "#nope", ms: 500 }, dir);
      assert.match(missing.text, /NOT found within 500ms/);

      // explicit close ends the session; further actions need a new navigate
      const closed = await runBrowserAct({ action: "close" }, dir);
      assert.match(closed.text, /Browser session closed/);
      await assert.rejects(runBrowserAct({ action: "snapshot" }, dir), /no active browser session/);
    });
  } finally {
    await page.close();
  }
});

test("e2e SECURITY: a mid-session redirect out of the loopback allowlist is blocked on the persistent session", { timeout: 120_000 }, async (t) => {
  if (!(await canLaunchBrowser())) {
    t.skip("no system Chrome/Edge available in this environment");
    return;
  }
  const page = await serveHtml(`<!doctype html>
<html><head><title>Escape Attempt</title></head>
<body><button id="go" onclick="window.location.href='http://evil.invalid.test/steal'">Go</button></body></html>`);
  try {
    await withTmp(async (dir) => {
      await runBrowserAct({ action: "navigate", url: page.url }, dir);
      const snap = await runBrowserAct({ action: "snapshot" }, dir);
      const ref = snap.text.match(/button "Go" \[ref=(e\d+)\]/)?.[1];
      assert.ok(ref, `expected a ref for the Go button in:\n${snap.text}`);

      // the click triggers a navigation the route guard must abort
      const clicked = await runBrowserAct({ action: "click", ref: ref! }, dir).catch((err) => ({ text: String(err?.message ?? err) }));
      // give the aborted navigation a beat, then confirm we never left
      await runBrowserAct({ action: "wait_for", ms: 300 }, dir).catch(() => {});
      const stillThere = await runBrowserAct({ action: "evaluate", js: "document.title" }, dir).catch((err) => ({
        text: String(err?.message ?? err),
      }));
      const evidence = `${clicked.text}\n${stillThere.text}`;
      // acceptable outcomes: the guard reported the block, or the fatal
      // framenavigated defense closed the session loudly — NEVER a silent
      // arrival at the disallowed host
      assert.match(evidence, /SECURITY: blocked|blocked — the page navigated outside|Escape Attempt/);
      assert.ok(!/steal/.test(stillThere.text) || /blocked/.test(evidence), "must never actually reach the disallowed host");
    });
  } finally {
    await page.close();
  }
});

test("e2e: state persists across calls within a session (same context, same page)", { timeout: 120_000 }, async (t) => {
  if (!(await canLaunchBrowser())) {
    t.skip("no system Chrome/Edge available in this environment");
    return;
  }
  const page = await serveHtml(`<!doctype html><html><head><title>State</title></head><body></body></html>`);
  try {
    await withTmp(async (dir) => {
      await runBrowserAct({ action: "navigate", url: page.url }, dir);
      await runBrowserAct({ action: "evaluate", js: "window.__marker = 'still-here', 'set'" }, dir);
      // a second call sees the SAME page (launch-per-session, not per-call)
      const check = await runBrowserAct({ action: "evaluate", js: "window.__marker" }, dir);
      assert.match(check.text, /Result: "still-here"/);
      await runBrowserAct({ action: "close" }, dir);
    });
  } finally {
    await page.close();
  }
});

test("e2e: an aborted in-flight action closes the session", { timeout: 120_000 }, async (t) => {
  if (!(await canLaunchBrowser())) {
    t.skip("no system Chrome/Edge available in this environment");
    return;
  }
  // a server that never responds — the goto hangs until aborted
  const server = createServer(() => {
    /* never respond */
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a network address");
  const hangUrl = `http://127.0.0.1:${address.port}/`;
  try {
    await withTmp(async (dir) => {
      const ac = new AbortController();
      const inFlight = runBrowserAct({ action: "navigate", url: hangUrl, timeout_ms: 30_000 }, dir, ac.signal);
      setTimeout(() => ac.abort(), 500);
      // the action either rejects (browser died under it) or resolves with a
      // navigation error — both fine; the invariant is the SESSION is gone
      await inFlight.catch(() => {});
      await assert.rejects(runBrowserAct({ action: "snapshot" }, dir), /no active browser session/);
    });
  } finally {
    await new Promise((res) => server.close(() => res(undefined)));
  }
});
