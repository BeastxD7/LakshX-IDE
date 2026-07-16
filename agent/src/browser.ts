/**
 * `browser_preview` tool implementation — lets the agent load a LOCALHOST-ONLY
 * dev server/webview it just built in a real Chrome/Edge and get back text
 * signals (HTTP status, title, console errors/warnings, page text), PLUS the
 * screenshot itself so a human watching the chat can see the agent's visual
 * verification happen live (loop.ts/server.ts carry it to the client as a
 * separate `image` attachment alongside the text — see `ToolRunResult` in
 * tools.ts). The MODEL still only ever sees the text summary below: no
 * screenshot bytes are fed back to the model as vision input (see
 * `runBrowserPreview`'s doc comment below) — that's a separately scoped
 * future phase (a real `image` ContentBlock variant + provider adapter
 * support + a model-capability gate).
 *
 * Uses `playwright-core` (NOT the full `playwright` package, which downloads
 * ~170-300MB of bundled Chromium binaries via postinstall — incompatible
 * with this repo's dependency-free philosophy and single-file
 * `esbuild --bundle` packaging, see `package.json`'s `bundle` script).
 * `playwright-core` ships no browser at all; it drives whatever's already
 * installed via `{ channel: "chrome" }` / `{ channel: "msedge" }`, falling
 * back cleanly (see `launchBrowser`) instead of crashing when neither exists.
 *
 * SECURITY — this is the load-bearing part of this module, read before
 * touching it:
 *
 * `floor.ts`'s `floorCheck()` is completely skipped in royal mode (`loop.ts`'s
 * royal branch only calls the separate, much narrower `royalTamperCheck()`).
 * That means ANY loopback-only restriction placed in floor.ts would be
 * silently void in the one mode with zero permission prompts and the highest
 * blast radius. So the loopback enforcement here is NOT a floor.ts rule —
 * it's a hard, unconditional check inside this tool's own code, on every
 * code path, regardless of which mode invoked it:
 *
 *  1. `validateInitialUrl` rejects anything whose hostname isn't the LITERAL
 *     string `127.0.0.1`, `::1`, or `localhost` (case-insensitive only for
 *     the hostname string itself), and rejects `file:` (and any non-http(s))
 *     scheme outright. Deliberately no DNS resolution here — resolving the
 *     hostname and checking the resolved IP would open a DNS-rebinding hole:
 *     the check could pass against a first resolution that points at
 *     127.0.0.1, then the actual connection re-resolves to something else.
 *     Matching the literal, pre-resolution hostname string closes that gap.
 *  2. Every subsequent in-page navigation (JS `location = ...`, a 30x
 *     response, a `<meta refresh>`) is intercepted via `context.route()`
 *     BEFORE it reaches the network and aborted if it isn't loopback — a
 *     page that starts on localhost can still try to redirect elsewhere
 *     mid-session, and the disallowed host must never actually be contacted.
 *  3. `page.on("framenavigated")` is a second, independent check — defense
 *     in depth in case a disallowed navigation ever committed despite (2),
 *     which should be impossible. If it ever fires, the whole call fails
 *     loudly instead of silently extracting/screenshotting untrusted content.
 *  4. Every call gets a fresh, isolated `browser.newContext()` — never the
 *     browser's default context — so no cookies/localStorage/session state
 *     persists across calls, and this never touches the user's real,
 *     logged-in browser profile.
 *
 * See test/browser.test.ts for regression coverage of all four.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { summarizeText } from "./audit.js";

export interface BrowserPreviewInput {
  url: string;
  wait_for_selector?: string;
  timeout_ms?: number;
}

/**
 * `runBrowserPreview`'s result: `text` is the same model-facing summary this
 * tool has always returned (HTTP status, title, console entries, page text,
 * ...) — untouched by this. `image`, when a screenshot was actually
 * captured, is an ADDITIVE side-channel for the UI layer only (see
 * `tools.ts`'s `ToolRunResult`) — `base64` is the exact bytes already
 * written to `path` on disk, re-used from `page.screenshot()`'s own return
 * value rather than reading the file back a second time.
 */
export interface BrowserPreviewResult {
  text: string;
  image?: { mimeType: string; base64: string; path: string };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PAGE_TEXT_CHARS = 4_000;
const MAX_CONSOLE_ENTRIES = 30;
const MAX_CONSOLE_ENTRY_CHARS = 500;

/**
 * Literal-string-only loopback allowlist — see module doc comment §1.
 * Strips surrounding `[...]` brackets first: WHATWG `URL.hostname` renders
 * an IPv6 literal WITH brackets (`new URL("https://[::1]/").hostname ===
 * "[::1]"`), so without this normalization a bracketed `::1` would be
 * silently rejected even though it's the exact host this allowlist means to
 * accept.
 */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

/**
 * Validate the tool's `url` input before ANY browser/network activity.
 * Throws a plain Error with a message suitable for surfacing straight back
 * to the model as a tool error. Exported for direct unit testing of the
 * pure validation logic without spinning up a browser.
 */
export function validateInitialUrl(raw: string, toolName = "browser_preview"): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${toolName}: "${raw}" is not a valid URL.`);
  }
  if (u.protocol === "file:") {
    throw new Error(`${toolName}: file:// URLs are not allowed — this tool is loopback-HTTP(S) only.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      `${toolName}: unsupported protocol "${u.protocol}" — only http/https loopback URLs are allowed.`,
    );
  }
  if (!isLoopbackHost(u.hostname)) {
    throw new Error(
      `${toolName}: hostname "${u.hostname}" is not allowed. Only the literal hosts 127.0.0.1, ::1, or ` +
        `localhost are permitted (no DNS resolution is performed before this check, so this also blocks ` +
        `DNS-rebinding attempts hiding behind those hostnames).`,
    );
  }
  return u;
}

/** True if a URL string is safe to navigate/route to under the loopback allowlist. */
function isAllowedNavigationTarget(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "file:") return false;
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

async function launchBrowser(toolName = "browser_preview") {
  const errors: string[] = [];
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (err: any) {
      errors.push(`${channel}: ${err?.message ?? String(err)}`);
    }
  }
  throw new Error(
    `${toolName}: no system Chrome or Edge browser found (playwright-core drives the system browser, it ` +
      `does not bundle one). Install Google Chrome or Microsoft Edge, then retry.\n${errors.join("\n")}`,
  );
}

/**
 * Run one `browser_preview` tool call: load `input.url` in an isolated
 * browser context, capture load-time signals, save a screenshot to disk, and
 * return a text summary PLUS the screenshot as a UI-only `image` attachment
 * (see `BrowserPreviewResult` above). The returned `text` never contains
 * image data and is exactly what the model sees — no provider/ContentBlock
 * changes happen here, by design (that's the separately scoped "vision
 * input" phase).
 */
export async function runBrowserPreview(
  input: BrowserPreviewInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<BrowserPreviewResult> {
  if (signal?.aborted) throw new Error("browser_preview: cancelled before starting");

  // §1 — hard, unconditional, pre-browser check. Nothing below this line
  // runs unless the INITIAL url is already loopback-literal.
  const targetUrl = validateInitialUrl(input.url);
  const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  const browser = await launchBrowser();
  const onAbort = () => {
    browser.close().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    // §4 — fresh, isolated context per call: no shared cookies/localStorage,
    // never the browser's default/real user profile.
    const context = await browser.newContext();
    try {
      const page = await context.newPage();

      const consoleEntries: string[] = [];
      page.on("console", (msg) => {
        const type = msg.type();
        if ((type === "error" || type === "warning") && consoleEntries.length < MAX_CONSOLE_ENTRIES) {
          consoleEntries.push(`[${type}] ${msg.text()}`);
        }
      });
      page.on("pageerror", (err) => {
        if (consoleEntries.length < MAX_CONSOLE_ENTRIES) {
          consoleEntries.push(`[error] uncaught exception: ${err.message}`);
        }
      });

      // §2 — block any in-page navigation that would leave the loopback
      // allowlist, BEFORE it reaches the network. This also covers the very
      // first navigation (page.goto below), which is harmless since it was
      // already validated by validateInitialUrl above and will simply pass
      // through.
      const blockedNavigations: string[] = [];
      await context.route("**/*", async (route) => {
        const req = route.request();
        if (req.isNavigationRequest() && req.frame() === page.mainFrame() && !isAllowedNavigationTarget(req.url())) {
          blockedNavigations.push(req.url());
          await route.abort("blockedbyclient").catch(() => {});
          return;
        }
        await route.continue().catch(() => {});
      });

      // §3 — defense in depth: independent check, should never fire given
      // §2, but if it does, treat it as fatal rather than trusting the page.
      let escapedLoopback: string | null = null;
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        const url = frame.url();
        if (url === "about:blank") return;
        if (!isAllowedNavigationTarget(url)) escapedLoopback = url;
      });

      let status: number | null = null;
      let gotoError: string | null = null;
      try {
        const response = await page.goto(targetUrl.toString(), { waitUntil: "load", timeout: timeoutMs });
        status = response?.status() ?? null;
      } catch (err: any) {
        gotoError = err?.message ?? String(err);
      }

      if (escapedLoopback) {
        throw new Error(
          `browser_preview: blocked — the page navigated outside the loopback allowlist to "${escapedLoopback}" mid-session.`,
        );
      }

      let selectorFound: boolean | null = null;
      if (input.wait_for_selector) {
        try {
          await page.waitForSelector(input.wait_for_selector, { timeout: Math.min(timeoutMs, 10_000) });
          selectorFound = true;
        } catch {
          selectorFound = false;
        }
      }

      const title = await page.title().catch(() => "");
      const pageText = await page
        .evaluate(() => document.body?.innerText ?? "")
        .catch(() => "");

      // Screenshot saved to a workspace-scoped path — never sent to the
      // model (v1a is text-signals-only for the model), but now ALSO
      // returned to the caller as `image` below so the UI can render it
      // inline for a human. `page.screenshot({ path })` both writes the
      // file AND resolves with the identical bytes, so this reuses that one
      // buffer rather than reading the file back a second time.
      const shotDir = resolve(cwd, ".lakshx", "tmp");
      await mkdir(shotDir, { recursive: true });
      const shotPath = resolve(shotDir, `preview-${Date.now()}.png`);
      const screenshotBuf = await page.screenshot({ path: shotPath }).catch(() => null);

      const lines: string[] = [];
      lines.push(`URL: ${targetUrl.toString()}`);
      lines.push(`HTTP status: ${status ?? "(none — navigation did not complete)"}`);
      if (gotoError) lines.push(`Navigation error: ${summarizeText(gotoError, 300)}`);
      lines.push(`Page title: ${title || "(empty)"}`);
      if (input.wait_for_selector) {
        lines.push(
          `wait_for_selector "${input.wait_for_selector}": ${selectorFound ? "found" : "NOT found within timeout"}`,
        );
      }
      if (blockedNavigations.length) {
        lines.push(
          `SECURITY: blocked ${blockedNavigations.length} in-page navigation attempt(s) outside the loopback ` +
            `allowlist: ${blockedNavigations.slice(0, 5).map((u) => summarizeText(u, 200)).join(", ")}`,
        );
      }
      lines.push(`Console errors/warnings (${consoleEntries.length}):`);
      lines.push(
        consoleEntries.length
          ? consoleEntries.map((e) => `  ${summarizeText(e, MAX_CONSOLE_ENTRY_CHARS)}`).join("\n")
          : "  (none)",
      );
      lines.push(
        screenshotBuf
          ? `Screenshot saved (shown to the human in chat, not sent to you): ${shotPath}`
          : `Screenshot: capture failed — none saved.`,
      );
      lines.push(`Page text (capped):\n${summarizeText(pageText, MAX_PAGE_TEXT_CHARS) || "(empty)"}`);

      return {
        text: lines.join("\n"),
        image: screenshotBuf ? { mimeType: "image/png", base64: screenshotBuf.toString("base64"), path: shotPath } : undefined,
      };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await browser.close().catch(() => {});
  }
}

/* ======================================================================
 * `browser_act` — session-scoped INTERACTIVE browser (Royal Mode 2.0
 * Stage 1a, docs/research/12 §"Interactive browser").
 *
 * Unlike `runBrowserPreview` above (single-shot: launch → look → close,
 * kept fully independent so its contract can't regress), `browser_act`
 * keeps ONE Chromium + ONE isolated context + ONE page alive across calls
 * so the model can navigate → snapshot → click → observe iteratively.
 *
 * Session keying: by `cwd` (the workspace root every tool call already
 * receives). The loop does NOT thread a promptId/sessionId into
 * `ToolSpec.run`, and cwd-keying is deliberately the better fit anyway —
 * the browser survives across prompts in the same workspace ("now click
 * the other tab" as a follow-up prompt keeps working). Lifetime control
 * that replaces launch-per-call teardown:
 *   - explicit `{action: "close"}`;
 *   - idle auto-close after BROWSER_SESSION_IDLE_MS (~3 min) without any
 *     action (timer is unref'd — never holds the process alive);
 *   - the per-prompt AbortSignal closes the whole session if it fires
 *     WHILE an action is in flight (kills a hung goto/click dead instead
 *     of orphaning it). The listener is attached per-action and removed
 *     in `finally` — it must NOT persist between actions, because
 *     server.ts aborts the PREVIOUS prompt's controller at the start of
 *     every new prompt (session.pending?.abort()), which would otherwise
 *     tear the browser down right before each follow-up prompt runs;
 *   - browser crash/external close self-heals: the map entry is dropped
 *     on "disconnected" and the next navigate starts a fresh session.
 *
 * SECURITY — every invariant from the module doc comment above holds
 * per-session exactly as it held per-call:
 *   §1 initial-URL literal-loopback validation on every `navigate`;
 *   §2 context.route() guard aborting non-loopback main-frame navigations
 *      before they touch the network, on the session's one context;
 *   §3 framenavigated defense-in-depth — if it EVER fires the session is
 *      closed and the action fails loudly;
 *   §4 a fresh, isolated newContext() per session — never the user's real
 *      profile; state persists across ACTIONS (that's the point) but dies
 *      with the session.
 *
 * Concurrency: actions for the same cwd are serialized through a promise
 * chain (`actLocks`) — dispatch_subtasks children share the parent's cwd,
 * and two agents interleaving clicks on one page is never meaningful.
 * ====================================================================== */

export interface BrowserActInput {
  action: string;
  url?: string;
  ref?: string;
  text?: string;
  key?: string;
  dy?: number;
  selector?: string;
  ms?: number;
  js?: string;
  timeout_ms?: number;
}

export const BROWSER_ACT_ACTIONS = [
  "navigate",
  "snapshot",
  "click",
  "type",
  "press",
  "scroll",
  "wait_for",
  "screenshot",
  "read_console",
  "read_network",
  "evaluate",
  "close",
] as const;

/** Idle auto-close for a browser_act session. Env-overridable for tests. */
export function browserSessionIdleMs(): number {
  const v = Number(process.env.LAKSHX_BROWSER_IDLE_MS);
  return Number.isFinite(v) && v > 0 ? v : 3 * 60_000;
}

const ACTION_TIMEOUT_MS = 5_000;
const MAX_SNAPSHOT_CHARS = 30_000;
const MAX_EVAL_RESULT_CHARS = 10_000;
const MAX_BUFFERED_CONSOLE = 200;
const MAX_BUFFERED_NETWORK = 300;

/**
 * Bounded FIFO string buffer with drain semantics — backs `read_console` /
 * `read_network` ("messages since last read"). Past `max` entries, new
 * pushes are counted as dropped rather than evicting old ones: for debug
 * signals the EARLIEST entries after a page load (first error, first failed
 * request) are usually the load-bearing ones. Exported for unit tests.
 */
export class BoundedBuffer {
  private items: string[] = [];
  private dropped = 0;
  constructor(private readonly max: number, private readonly maxEntryChars = 500) {}
  push(s: string): void {
    if (this.items.length >= this.max) {
      this.dropped++;
      return;
    }
    this.items.push(s.length > this.maxEntryChars ? s.slice(0, this.maxEntryChars) + "…" : s);
  }
  get size(): number {
    return this.items.length;
  }
  /** Returns everything buffered since the last drain, and resets. */
  drain(): { items: string[]; dropped: number } {
    const out = { items: this.items, dropped: this.dropped };
    this.items = [];
    this.dropped = 0;
    return out;
  }
}

/**
 * Cap an accessibility snapshot's text. Head-keep truncation (not
 * head+tail): refs are assigned top-down, so the head is where the
 * navigation/controls of a typical page live — and a split tail would risk
 * bisecting a `[ref=eNN]` marker into a plausible-looking wrong ref.
 * Exported for unit tests.
 */
export function capSnapshot(s: string, max = MAX_SNAPSHOT_CHARS): string {
  if (s.length <= max) return s;
  return (
    s.slice(0, max) +
    `\n…[snapshot truncated: ${(s.length - max).toLocaleString()} more chars — page is large; scroll or use a narrower evaluate to inspect deeper content]`
  );
}

/**
 * Validate a model-supplied element ref and turn it into playwright's
 * `aria-ref=` selector (the engine `ariaSnapshot({ mode: "ai" })` refs
 * resolve through — verified against the pinned playwright-core 1.61.1).
 * Strict shape check so an arbitrary selector/JS can't be smuggled in
 * through the `ref` parameter. Exported for unit tests.
 */
export function refToSelector(ref: unknown): string {
  if (typeof ref !== "string" || !/^e\d+$/.test(ref)) {
    throw new Error(
      `browser_act: ${JSON.stringify(String(ref ?? ""))} is not a valid element ref — refs look like "e12" and come from the most recent {action:"snapshot"} result.`,
    );
  }
  return `aria-ref=${ref}`;
}

interface ActSession {
  key: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  console: BoundedBuffer;
  network: BoundedBuffer;
  /** Non-loopback main-frame navigations the route guard aborted since last reported. */
  blockedNavigations: string[];
  /** §3 defense-in-depth — set if a disallowed navigation ever COMMITTED. */
  escapedLoopback: string | null;
  idleTimer?: ReturnType<typeof setTimeout>;
  closed: boolean;
}

const actSessions = new Map<string, ActSession>();
const actLocks = new Map<string, Promise<unknown>>();

/** Serialize all browser_act work per workspace — see module block comment. */
function withCwdLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = actLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  actLocks.set(
    key,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

function touchActSession(s: ActSession): void {
  if (s.idleTimer) clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => {
    void closeBrowserActSession(s.key);
  }, browserSessionIdleMs());
  // never keep the agent process alive just for an idle browser
  s.idleTimer.unref?.();
}

/** Close and forget one workspace's browser_act session. Idempotent. */
export async function closeBrowserActSession(key: string): Promise<boolean> {
  const s = actSessions.get(key);
  if (!s) return false;
  actSessions.delete(key);
  if (s.closed) return false;
  s.closed = true;
  if (s.idleTimer) clearTimeout(s.idleTimer);
  await s.browser.close().catch(() => {});
  return true;
}

/** Test/shutdown helper: close every live browser_act session. */
export async function closeAllBrowserActSessions(): Promise<void> {
  await Promise.all([...actSessions.keys()].map((k) => closeBrowserActSession(k)));
}

async function createActSession(key: string): Promise<ActSession> {
  const browser = await launchBrowser("browser_act");
  // §4 — isolated context, never the default/real profile. State persists
  // across ACTIONS within this session by design; dies with the session.
  const context = await browser.newContext();
  const page = await context.newPage();

  const s: ActSession = {
    key,
    browser,
    context,
    page,
    console: new BoundedBuffer(MAX_BUFFERED_CONSOLE),
    network: new BoundedBuffer(MAX_BUFFERED_NETWORK),
    blockedNavigations: [],
    escapedLoopback: null,
    closed: false,
  };

  page.on("console", (msg) => s.console.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => s.console.push(`[error] uncaught exception: ${err.message}`));
  page.on("response", (res) => {
    s.network.push(`${res.status()} ${res.request().method()} ${summarizeText(res.url(), 300)}`);
  });
  page.on("requestfailed", (req) => {
    s.network.push(`FAILED ${req.method()} ${summarizeText(req.url(), 300)} (${req.failure()?.errorText ?? "?"})`);
  });

  // §2 — same route guard as runBrowserPreview: any main-frame navigation
  // out of the loopback allowlist is aborted BEFORE it reaches the network.
  await context.route("**/*", async (route) => {
    const req = route.request();
    if (req.isNavigationRequest() && req.frame() === s.page.mainFrame() && !isAllowedNavigationTarget(req.url())) {
      s.blockedNavigations.push(req.url());
      await route.abort("blockedbyclient").catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  });

  // §3 — defense in depth; should be unreachable given §2. If it ever
  // fires, the next action check closes the whole session loudly.
  page.on("framenavigated", (frame) => {
    if (frame !== s.page.mainFrame()) return;
    const url = frame.url();
    if (url === "about:blank") return;
    if (!isAllowedNavigationTarget(url)) s.escapedLoopback = url;
  });

  // self-heal: crash or external close drops the map entry so the next
  // navigate starts fresh instead of erroring on a dead CDP connection
  browser.on("disconnected", () => {
    const cur = actSessions.get(key);
    if (cur === s) {
      actSessions.delete(key);
      if (cur.idleTimer) clearTimeout(cur.idleTimer);
      cur.closed = true;
    }
  });

  actSessions.set(key, s);
  return s;
}

/** §3 enforcement point — checked before AND after every action. */
async function assertStillLoopback(s: ActSession): Promise<void> {
  if (!s.escapedLoopback) return;
  const url = s.escapedLoopback;
  await closeBrowserActSession(s.key);
  throw new Error(
    `browser_act: blocked — the page navigated outside the loopback allowlist to "${url}" mid-session. The browser session has been closed.`,
  );
}

/** One-line SECURITY note if the route guard blocked anything since last reported. */
function drainBlockedNote(s: ActSession): string {
  if (!s.blockedNavigations.length) return "";
  const blocked = s.blockedNavigations.splice(0);
  return (
    `\nSECURITY: blocked ${blocked.length} navigation attempt(s) outside the loopback allowlist: ` +
    blocked.slice(0, 5).map((u) => summarizeText(u, 200)).join(", ")
  );
}

/** Trim playwright's multi-line error logs to the load-bearing first line. */
function firstLine(msg: string): string {
  return msg.split("\n")[0].trim();
}

/**
 * Run one `browser_act` action against the workspace's persistent browser
 * session. Every action resolves to a concise text result; `screenshot`
 * also carries the image (UI side-channel AND — new in Stage 1a —
 * model-visible via loop.ts's vision-gated tool_result embedding).
 */
export async function runBrowserAct(
  input: BrowserActInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<BrowserPreviewResult> {
  if (signal?.aborted) throw new Error("browser_act: cancelled before starting");
  const action = String(input.action ?? "");
  if (!(BROWSER_ACT_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`browser_act: unknown action "${action}". Valid actions: ${BROWSER_ACT_ACTIONS.join(", ")}.`);
  }
  return withCwdLock(cwd, () => runActAction(action, input, cwd, signal));
}

async function runActAction(
  action: string,
  input: BrowserActInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<BrowserPreviewResult> {
  if (signal?.aborted) throw new Error("browser_act: cancelled before starting");

  if (action === "close") {
    const closed = await closeBrowserActSession(cwd);
    return { text: closed ? "Browser session closed." : "(no active browser session to close)" };
  }

  // §1 — validate BEFORE any browser exists/launches, hard and unconditional.
  const targetUrl = action === "navigate" ? validateInitialUrl(String(input.url ?? ""), "browser_act") : undefined;

  // Abort-while-in-flight closes the whole session (kills a hung goto/click
  // dead); removed in `finally` — see the module block comment for why the
  // listener must not outlive the action. Attached BEFORE session
  // lookup/creation: Chrome launch itself takes >500ms, and an abort landing
  // inside that window must not leave a freshly-launched orphan behind (the
  // listener alone isn't enough for that — it fires against an empty map —
  // hence the explicit aborted re-check right after the session exists).
  const onAbort = () => {
    void closeBrowserActSession(cwd);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  let session: ActSession | undefined;
  try {
    let s = actSessions.get(cwd);
    if (s && (s.closed || s.page.isClosed() || !s.browser.isConnected())) {
      await closeBrowserActSession(cwd);
      s = undefined;
    }
    if (!s) {
      if (action !== "navigate") {
        throw new Error(
          `browser_act: no active browser session for this workspace — start one with {action: "navigate", url: "http://localhost:..."} first.`,
        );
      }
      s = await createActSession(cwd);
    }
    session = s;
    touchActSession(session);
    if (signal?.aborted) {
      // the abort listener may have raced createActSession (see above) —
      // close deterministically here so a cancelled prompt never leaves a
      // browser it launched
      await closeBrowserActSession(cwd);
      throw new Error("browser_act: cancelled");
    }

    await assertStillLoopback(session);
    const page = session.page;

    // every non-navigate action needs a loaded page to make sense
    if (action !== "navigate" && page.url() === "about:blank") {
      throw new Error(`browser_act: no page loaded in this session yet — use {action: "navigate", url: ...} first.`);
    }

    let result: BrowserPreviewResult;
    switch (action) {
      case "navigate": {
        const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
        let status: number | null = null;
        let gotoError: string | null = null;
        try {
          const response = await page.goto(targetUrl!.toString(), { waitUntil: "load", timeout: timeoutMs });
          status = response?.status() ?? null;
        } catch (err: any) {
          gotoError = firstLine(err?.message ?? String(err));
        }
        await assertStillLoopback(session);
        const title = await page.title().catch(() => "");
        const lines = [
          `URL: ${page.url()}`,
          `HTTP status: ${status ?? "(none — navigation did not complete)"}`,
          ...(gotoError ? [`Navigation error: ${summarizeText(gotoError, 300)}`] : []),
          `Page title: ${title || "(empty)"}`,
          `Console: ${session.console.size} message(s) buffered (use {action:"read_console"}). Use {action:"snapshot"} to see interactive elements.`,
        ];
        result = { text: lines.join("\n") + drainBlockedNote(session) };
        break;
      }
      case "snapshot": {
        // AI-mode aria snapshot: includes [ref=eN] markers resolvable via
        // the aria-ref= selector engine (click/type below).
        const snap = await page.locator("body").ariaSnapshot({ mode: "ai", timeout: ACTION_TIMEOUT_MS * 2 });
        result = {
          text:
            `Accessibility snapshot of ${page.url()} — [ref=eN] markers are element refs for {action:"click"|"type", ref:"eN"}:\n` +
            (capSnapshot(snap) || "(empty page)"),
        };
        break;
      }
      case "click": {
        const selector = refToSelector(input.ref);
        try {
          await page.locator(selector).click({ timeout: ACTION_TIMEOUT_MS });
        } catch (err: any) {
          throw new Error(
            `browser_act: click on ${input.ref} failed: ${firstLine(err?.message ?? String(err))} — the ref may be stale; take a fresh {action:"snapshot"}.`,
          );
        }
        await assertStillLoopback(session);
        result = { text: `Clicked ${input.ref}. Page URL is now ${page.url()}.${drainBlockedNote(session)}` };
        break;
      }
      case "type": {
        const selector = refToSelector(input.ref);
        const text = String(input.text ?? "");
        try {
          await page.locator(selector).fill(text, { timeout: ACTION_TIMEOUT_MS });
        } catch (err: any) {
          throw new Error(
            `browser_act: type into ${input.ref} failed: ${firstLine(err?.message ?? String(err))} — the ref may be stale or not an editable element; take a fresh {action:"snapshot"}.`,
          );
        }
        result = { text: `Typed ${JSON.stringify(summarizeText(text, 200))} into ${input.ref}.` };
        break;
      }
      case "press": {
        const key = String(input.key ?? "");
        if (!key) throw new Error(`browser_act: press requires a "key", e.g. "Enter", "Tab", "ArrowDown".`);
        await page.keyboard.press(key);
        await assertStillLoopback(session);
        result = { text: `Pressed ${key}. Page URL is now ${page.url()}.${drainBlockedNote(session)}` };
        break;
      }
      case "scroll": {
        const dy = Number(input.dy ?? 600) || 0;
        await page.mouse.wheel(0, dy);
        const scrollY = await page.evaluate(() => window.scrollY).catch(() => null);
        result = { text: `Scrolled vertically by ${dy}px${scrollY === null ? "" : `; window.scrollY is now ${scrollY}`}.` };
        break;
      }
      case "wait_for": {
        if (input.selector) {
          const timeoutMs = Math.min(input.ms ?? 10_000, 15_000);
          try {
            await page.waitForSelector(String(input.selector), { timeout: timeoutMs });
            result = { text: `Selector "${input.selector}" found.` };
          } catch {
            result = { text: `Selector "${input.selector}" NOT found within ${timeoutMs}ms.` };
          }
        } else if (input.ms) {
          const ms = Math.min(Number(input.ms) || 0, 10_000);
          await page.waitForTimeout(ms);
          result = { text: `Waited ${ms}ms.` };
        } else {
          throw new Error(`browser_act: wait_for requires "selector" (CSS) and/or "ms".`);
        }
        break;
      }
      case "screenshot": {
        const shotDir = resolve(cwd, ".lakshx", "tmp");
        await mkdir(shotDir, { recursive: true });
        const shotPath = resolve(shotDir, `act-${Date.now()}.png`);
        const buf = await page.screenshot({ path: shotPath });
        const title = await page.title().catch(() => "");
        result = {
          text: `Screenshot of ${page.url()} (title: ${title || "(empty)"}) saved to ${shotPath}.`,
          image: { mimeType: "image/png", base64: buf.toString("base64"), path: shotPath },
        };
        break;
      }
      case "read_console": {
        const { items, dropped } = session.console.drain();
        result = {
          text: items.length
            ? `Console messages since last read (${items.length}${dropped ? `, +${dropped} dropped over buffer cap` : ""}):\n` +
              items.map((e) => `  ${e}`).join("\n")
            : "(no console output since last read)",
        };
        break;
      }
      case "read_network": {
        const { items, dropped } = session.network.drain();
        result = {
          text: items.length
            ? `Network requests since last read (${items.length}${dropped ? `, +${dropped} dropped over buffer cap` : ""}):\n` +
              items.map((e) => `  ${e}`).join("\n")
            : "(no network requests since last read)",
        };
        break;
      }
      case "evaluate": {
        const js = String(input.js ?? "");
        if (!js.trim()) throw new Error(`browser_act: evaluate requires "js" (an expression evaluated in the page).`);
        let value: unknown;
        try {
          value = await page.evaluate(js);
        } catch (err: any) {
          throw new Error(`browser_act: evaluate failed: ${firstLine(err?.message ?? String(err))}`);
        }
        let rendered: string;
        try {
          rendered = value === undefined ? "undefined" : JSON.stringify(value);
        } catch {
          rendered = String(value);
        }
        result = { text: `Result: ${summarizeText(rendered ?? "undefined", MAX_EVAL_RESULT_CHARS)}` };
        break;
      }
      default:
        // unreachable — runBrowserAct validated the action name already
        throw new Error(`browser_act: unknown action "${action}".`);
    }

    await assertStillLoopback(session);
    // an abort mid-action closed the session under us — report cancellation
    // rather than a half-true success built from a dying page
    if (signal?.aborted) throw new Error("browser_act: cancelled — the browser session was closed.");
    return result;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // reset idle countdown from the END of the action too (a long goto
    // shouldn't eat into the idle budget)
    if (session && !session.closed) touchActSession(session);
  }
}
