// LakshX Trace — agent trace/observability inspector. Renders a webview
// timeline of what the LAKSHX AGENT ITSELF did turn-to-turn: per-turn
// timing, token spend, and an expandable tool-call trace (name, duration,
// truncated input/output, pass/fail).
//
// NOT lakshx-db. lakshx-db visualizes the USER's connected database schema
// and lets them browse their own rows. This extension has zero overlap with
// that: it never opens a database connection, never reads a connection
// string, and never shows the user's data. What it shows is the agent's OWN
// behavior — reused visual plumbing (createWebviewPanel, the toolbar/CSP
// pattern), never reused subject matter. Keeping the names/framing distinct
// (docs/research/16-ide-feature-roadmap-round2.md's "Agent trace/
// observability inspector" pitch) is deliberate, not an oversight — pick
// this file up expecting database code and you're in the wrong extension.
//
// Design decision worth recording here, not just in a commit message: this
// extension does NOT call any ACP request to reach a live agent process.
// agent/src/trace-store.ts's recorder is always-on and writes directly to
// ~/.lakshx/traces/<sessionId>.jsonl regardless of whether any IDE panel is
// open — so the simplest, most consistent design (matching how lakshx-tab
// and lakshx-search already read ~/.lakshx/providers.json directly, with NO
// dependency on lakshx-chat or the agent process being active) is to read
// those JSONL files straight off disk. That avoids inventing a new
// cross-extension coupling this codebase doesn't otherwise have, and it
// means this panel works even when no agent session is currently running —
// arguably the more useful case for "what did my agent do earlier".
"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { listSessions, readSessionRaw } = require("./lib/trace-files.js");
const { parseTraceJsonl } = require("./lib/trace-parse.js");
const { computeStats, paginateTurns, capToolCalls, DEFAULT_PAGE_SIZE } = require("./lib/trace-aggregate.js");

let currentPanel = null;

function panelHtml(context, webview) {
  const stamp = (f) => {
    try {
      return Math.round(fs.statSync(path.join(context.extensionPath, "media", f)).mtimeMs);
    } catch {
      return Date.now();
    }
  };
  const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", f)) + "?v=" + stamp(f);
  const css = uri("trace.css");
  const js = uri("trace.js");
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
<link rel="stylesheet" href="${css}">
</head><body>
<div id="app">
  <div id="toolbar">
    <span id="title">Agent Trace</span>
    <select id="sessionPicker" title="Pick a recorded agent session"></select>
    <div class="spacer"></div>
    <button id="refresh" class="ghost" title="Re-scan ~/.lakshx/traces/ for sessions">Refresh</button>
  </div>

  <div id="empty" class="msg">No recorded agent sessions yet. Run a prompt in LakshX chat, then come back here.</div>
  <div id="error" class="msg" hidden></div>

  <div id="content" hidden>
    <div id="stats">
      <div class="stat"><span class="statLabel">Turns</span><span id="statTurns" class="statValue">0</span></div>
      <div class="stat"><span class="statLabel">Input tokens</span><span id="statInputTokens" class="statValue">0</span></div>
      <div class="stat"><span class="statLabel">Output tokens</span><span id="statOutputTokens" class="statValue">0</span></div>
      <div class="stat"><span class="statLabel">Tool calls</span><span id="statToolCalls" class="statValue">0</span></div>
      <div class="stat"><span class="statLabel">Tool errors</span><span id="statErrors" class="statValue">0</span></div>
    </div>
    <div id="slowest">
      <h3>Slowest tool calls</h3>
      <ul id="slowestList"></ul>
    </div>
    <h3 class="timelineHeading">Timeline</h3>
    <ul id="timeline"></ul>
    <button id="showMore" class="ghost" hidden>Show more</button>
  </div>
</div>
<script src="${js}"></script>
</body></html>`;
}

/** Handle one `loadSession` request from the webview: read the file, parse, aggregate, paginate, and cap — never hand the webview more than one page's worth of turns, or more than the tool-call cap within a turn. */
function loadSessionPage(key, offset, pageSize) {
  const raw = readSessionRaw(key);
  const turns = parseTraceJsonl(raw);
  const stats = computeStats(turns);
  const { page, hasMore, total } = paginateTurns(turns, offset, pageSize || DEFAULT_PAGE_SIZE);
  const shapedPage = page.map((t) => {
    const capped = capToolCalls(t.toolCalls);
    return { ...t, toolCalls: capped.shown, hiddenToolCallCount: capped.hiddenCount };
  });
  return { key, turns: shapedPage, hasMore, offset, total, stats };
}

function postSessions(panel) {
  panel.webview.postMessage({ type: "sessions", sessions: listSessions() });
}

async function showPanel(context) {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside, true);
    postSessions(currentPanel);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    "lakshxTrace",
    "LakshX Trace",
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    },
  );
  currentPanel.onDidDispose(() => {
    currentPanel = null;
  });
  currentPanel.webview.html = panelHtml(context, currentPanel.webview);
  currentPanel.webview.onDidReceiveMessage((m) => {
    try {
      if (m.type === "listSessions") {
        postSessions(currentPanel);
      } else if (m.type === "loadSession" && typeof m.key === "string") {
        const result = loadSessionPage(m.key, Number(m.offset) || 0, Number(m.pageSize) || DEFAULT_PAGE_SIZE);
        currentPanel.webview.postMessage({ type: "sessionPage", ...result });
      }
    } catch (err) {
      currentPanel.webview.postMessage({ type: "error", message: String((err && err.message) || err) });
    }
  });
}

function activate(context) {
  // Status bar entry point — same discoverability convention every other
  // LakshX panel extension uses (see lakshx-db/lakshx-graph's activate()).
  // Priority 993: right after lakshx-graph's lowest-priority item (994,
  // "Guided Tour") in the same right-aligned status bar group.
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 993);
  statusItem.text = "$(pulse) Trace";
  statusItem.tooltip = "Open LakshX Agent Trace — the agent's own tool-call timing/token/trace inspector (not your database)";
  statusItem.command = "lakshx.trace.showPanel";
  statusItem.show();

  context.subscriptions.push(
    vscode.commands.registerCommand("lakshx.trace.showPanel", () => showPanel(context)),
    statusItem,
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
