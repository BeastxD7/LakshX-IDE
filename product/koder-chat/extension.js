// Koder Agent panel — ACP client + webview UI. Plain CJS, zero dependencies:
// a minimal ndjson JSON-RPC client speaks ACP to the Koder Agent Runtime.
const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ---------- minimal ACP (JSON-RPC over ndjson/stdio) client ----------
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
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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

// ---------- runtime discovery ----------
const isWin = process.platform === "win32";

function runtimeEnv() {
  // point the agent's grep tool at the editor's bundled ripgrep so it works
  // on machines without rg installed (all platforms)
  const rg = path.join(vscode.env.appRoot, "node_modules", "@vscode", "ripgrep", "bin", isWin ? "rg.exe" : "rg");
  const env = { ...process.env };
  if (fs.existsSync(rg)) env.KODER_RG_PATH = rg;
  return env;
}

function agentSpawnSpec(context) {
  const custom = vscode.workspace.getConfiguration("koder").get("agent.command");
  if (custom) {
    return isWin
      ? { command: "cmd.exe", args: ["/d", "/c", custom], env: runtimeEnv() }
      : { command: "/bin/zsh", args: ["-lc", custom], env: runtimeEnv() };
  }
  // dev layout: <repo>/upstream/extensions/koder-chat → runtime at <repo>/agent
  const candidates = [
    path.resolve(context.extensionPath, "..", "..", "..", "agent"),
    path.resolve(context.extensionPath, "..", "..", "agent"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "src", "server.ts")) && fs.existsSync(path.join(dir, "node_modules"))) {
      return { command: isWin ? "npx.cmd" : "npx", args: ["tsx", "src/server.ts"], cwd: dir, env: runtimeEnv() };
    }
  }
  // packaged: bundled runtime, run with the app's own Electron-as-Node —
  // works on machines with no Node.js installed
  const bundled = path.join(context.extensionPath, "agent", "server.cjs");
  if (fs.existsSync(bundled)) {
    return {
      command: process.execPath,
      args: [bundled],
      cwd: undefined,
      env: { ...runtimeEnv(), ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return null;
}

const PROVIDERS_TEMPLATE = `{
  // Koder BYOK — add API keys for any provider you use.
  // Model strings are "provider/model", e.g. "anthropic/claude-sonnet-5",
  // "openrouter/deepseek/deepseek-chat", "ollama/qwen3-coder".
  "defaultModel": "anthropic/claude-sonnet-5",
  "providers": {
    "anthropic":  { "apiKey": "" },
    "openai":     { "apiKey": "" },
    "openrouter": { "apiKey": "" },
    "gemini":     { "apiKey": "" },
    "deepseek":   { "apiKey": "" },
    "groq":       { "apiKey": "" },
    "xai":        { "apiKey": "" }
  }
}
`;

// ---------- BYOK provider state (~/.koder/providers.json) ----------
const PROVIDER_IDS = ["anthropic", "openai", "openrouter", "gemini", "deepseek", "groq", "xai"];

function providersFile() {
  return path.join(os.homedir(), ".koder", "providers.json");
}

function readProvidersJson() {
  try {
    return JSON.parse(fs.readFileSync(providersFile(), "utf8"));
  } catch {
    return { defaultModel: "anthropic/claude-sonnet-5", providers: {} };
  }
}

/** For the settings UI: which providers have keys (never send the keys). */
function readProviderState() {
  const cfg = readProvidersJson();
  const state = { defaultModel: cfg.defaultModel ?? "anthropic/claude-sonnet-5", set: {} };
  for (const id of PROVIDER_IDS) {
    state.set[id] = Boolean(cfg.providers?.[id]?.apiKey);
  }
  return state;
}

function saveProviderState(keys, defaultModel) {
  const cfg = readProvidersJson();
  cfg.providers = cfg.providers ?? {};
  for (const [id, key] of Object.entries(keys)) {
    if (!key) continue; // empty input = leave existing key untouched
    cfg.providers[id] = { ...(cfg.providers[id] ?? {}), apiKey: key.trim() };
  }
  if (defaultModel) cfg.defaultModel = defaultModel.trim();
  fs.mkdirSync(path.dirname(providersFile()), { recursive: true });
  fs.writeFileSync(providersFile(), JSON.stringify(cfg, null, 2));
}

// ---------- webview view ----------
// transcript events that get replayed when the webview is rebuilt
const REPLAYABLE = new Set(["user", "chunk", "thought", "tool", "toolUpdate", "system", "modeChanged", "turnEnd"]);

function chatsDir() {
  const dir = path.join(os.homedir(), ".koder", "chats");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------- local feedback log (~/.koder/feedback/<yyyy-mm>.jsonl) ----------
// Intentionally 100% local: no network calls, no telemetry, no cloud sync of
// any kind. This is the entire mechanism — nothing here phones home, and
// nothing here is a stub or hook for a future sync feature. If cloud sync is
// ever built, it will be a separate, explicit feature, not an extension of
// this file.
function feedbackDir() {
  const dir = path.join(os.homedir(), ".koder", "feedback");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function feedbackFile(date = new Date()) {
  const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return path.join(feedbackDir(), `${ym}.jsonl`);
}

/** Best-effort text extraction from a tool_call_update's ACP `content` array. */
function extractToolOutputText(u) {
  try {
    const c = u.content?.[0]?.content;
    return c?.type === "text" ? c.text : undefined;
  } catch {
    return undefined;
  }
}

class AgentViewProvider {
  constructor(context) {
    this.context = context;
    this.acp = null;
    this.sessionId = null;
    this.permissionWaiters = new Map();
    this.log = vscode.window.createOutputChannel("Koder Agent");
    this.transcript = [];
    this.chatId = `chat-${Date.now()}`;
    this.chatTitle = null;
    this.mode = "review";
    this.currentModel = null; // best-effort, for feedback-log context only
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onWebviewMessage(m));
  }

  post(msg) {
    if (REPLAYABLE.has(msg.type)) {
      this.transcript.push(msg);
      this.persistSoon();
    }
    this.view?.webview.postMessage(msg);
  }

  persistSoon() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      // never persist a chat that has no real user message yet — a session
      // spawned/opened but never prompted (or one that only hit a "system"
      // error/notice before the user typed anything) must not show up in
      // history as an "Untitled chat"
      if (!this.transcript.some((e) => e.type === "user")) return;
      const title =
        this.chatTitle ??
        this.transcript.find((e) => e.type === "user")?.text?.slice(0, 48) ??
        "Untitled chat";
      const file = path.join(chatsDir(), `${this.chatId}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify({
          id: this.chatId,
          title,
          updatedAt: Date.now(),
          mode: this.mode,
          sessionId: this.sessionId, // lets "open old chat" resume real agent memory, not just the view
          events: this.transcript,
        }),
      );
    }, 400);
  }

  listChats() {
    try {
      return fs.readdirSync(chatsDir())
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            const j = JSON.parse(fs.readFileSync(path.join(chatsDir(), f), "utf8"));
            const userEvent = j.events?.find((e) => e.type === "user");
            // stale/leftover chats with no real prompt (e.g. from before this
            // fix, or a system-error-only session) shouldn't show up at all
            if (!userEvent) return null;
            let title = j.title;
            if (!title || title === "Untitled chat") {
              title = userEvent.text?.slice(0, 48) ?? "Untitled chat";
            }
            return { id: j.id, title, updatedAt: j.updatedAt };
          } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 50);
    } catch { return []; }
  }

  /**
   * Connect to the runtime if needed, then either resume `resumeSessionId`
   * (real agent memory restored server-side) or open a fresh session.
   * Already-connected + already-on-the-right-session is the fast path.
   */
  async ensureAgent(resumeSessionId) {
    if (this.acp && this.sessionId && (!resumeSessionId || resumeSessionId === this.sessionId)) return true;

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();

    if (this.acp) {
      // already connected, just switching which chat's session is active
      await this.loadOrNewSession(resumeSessionId, cwd);
      return true;
    }

    const spec = agentSpawnSpec(this.context);
    if (!spec) {
      this.post({ type: "system", text: "Koder Agent Runtime not found. Set koder.agent.command in settings." });
      return false;
    }
    this.log.appendLine(`spawning agent: ${spec.command} ${spec.args.join(" ")}`);
    this.acp = new AcpClient(spec.command, spec.args, spec.cwd ?? cwd, spec.env, {
      onLog: (line) => this.log.append(line),
      onError: (err) => {
        this.log.appendLine(`SPAWN ERROR: ${err.message}`);
        this.post({ type: "system", text: `agent failed to start: ${err.message}` });
        this.acp = null;
      },
      onExit: (code) => {
        this.log.appendLine(`agent exited (${code})`);
        this.post({ type: "system", text: `agent exited (${code}) — will restart on next message` });
        this.acp = null;
        this.sessionId = null;
      },
      onNotification: (method, params) => {
        if (method === "session/update") this.onSessionUpdate(params.update);
        if (method === "koder/plan_saved") this.onPlanSaved(params.path);
        if (method === "koder/plan_ready") this.onPlanReady(params.path);
        if (method === "koder/usage") this.post({ type: "usage", ...params });
      },
      onRequest: async (method, params) => {
        if (method === "session/request_permission") return this.onPermissionRequest(params);
        throw new Error(`unhandled ${method}`);
      },
    });
    await this.acp.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const models = await this.acp.request("koder/models", {});
    this.currentModel ??= models.defaultModel;
    await this.loadOrNewSession(resumeSessionId, cwd);
    this.post({ type: "ready", models });
    return true;
  }

  /** Resume a saved session's real history, falling back to a fresh one if it's gone/corrupt. */
  async loadOrNewSession(resumeSessionId, cwd) {
    if (resumeSessionId) {
      try {
        const res = await this.acp.request("session/load", { sessionId: resumeSessionId, cwd, mcpServers: [] });
        this.sessionId = resumeSessionId;
        if (res?.modes?.currentModeId) this.mode = res.modes.currentModeId;
        return;
      } catch (err) {
        this.log.appendLine(`session/load failed for ${resumeSessionId}, starting fresh: ${err.message}`);
      }
    }
    const s = await this.acp.request("session/new", { cwd, mcpServers: [] });
    this.sessionId = s.sessionId;
  }

  onSessionUpdate(u) {
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content?.type === "text") this.post({ type: "chunk", text: u.content.text });
        break;
      case "agent_thought_chunk":
        if (u.content?.type === "text") this.post({ type: "thought", text: u.content.text });
        break;
      case "current_mode_update":
        this.mode = u.currentModeId;
        this.post({ type: "modeChanged", mode: u.currentModeId, auto: true });
        break;
      case "tool_call":
        // rawInput is carried through (previously dropped) so the feedback
        // log can show what a tool was actually called with, not just its
        // display title.
        this.post({ type: "tool", id: u.toolCallId, title: u.title, kind: u.kind, status: u.status, input: u.rawInput });
        break;
      case "tool_call_update":
        this.post({ type: "toolUpdate", id: u.toolCallId, status: u.status, output: extractToolOutputText(u) });
        break;
    }
  }

  async onPlanReady(planPath) {
    this.pendingPlan = planPath;
    const rel = path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", planPath);
    this.post({ type: "system", text: `Plan saved: ${rel}` });
    this.view?.webview.postMessage({ type: "planReady", path: rel });
    try {
      const doc = await vscode.workspace.openTextDocument(planPath);
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
    } catch {}
  }

  async planDecision(decision) {
    this.pendingPlan = null;
    if (decision === "approve") {
      this.mode = "approve";
      if (this.acp && this.sessionId) {
        await this.acp.request("session/set_mode", { sessionId: this.sessionId, modeId: "approve" });
      }
      this.post({ type: "modeChanged", mode: "approve", auto: true });
      await this.onWebviewMessage({ type: "send", text: "The plan is approved. Implement it step by step, verifying as you go." });
    } else if (decision === "reject") {
      await this.onWebviewMessage({ type: "send", text: "I am rejecting this plan. Ask me what direction you should take instead — do not start over on your own." });
    }
    // "enhance" is handled entirely in the webview (prefills the input)
  }

  async onPlanSaved(planPath) {
    this.post({ type: "system", text: `Plan saved: ${path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", planPath)}` });
    try {
      const doc = await vscode.workspace.openTextDocument(planPath);
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
    } catch {}
  }

  onPermissionRequest(params) {
    const id = params.toolCall.toolCallId;
    this.post({
      type: "permission",
      id,
      title: params.toolCall.title,
      options: params.options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
    });
    return new Promise((resolve) => {
      this.permissionWaiters.set(id, (optionId) =>
        resolve({ outcome: { outcome: "selected", optionId } }),
      );
    });
  }

  /**
   * Send a prompt as a brand-new turn (used by both the composer's "send"
   * and the retry button — retry is just this replayed with the recovered
   * original prompt text).
   */
  async sendPrompt(text) {
    if (!(await this.ensureAgent())) return;
    this.post({ type: "user", text });
    if (!this.chatTitle) this.chatTitle = text.slice(0, 48);
    this.post({ type: "turnStart" });
    try {
      const res = await this.acp.request("session/prompt", {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }],
      });
      this.post({ type: "turnEnd", stopReason: res.stopReason });
    } catch (err) {
      this.post({ type: "system", text: `error: ${err.message}` });
      this.post({ type: "turnEnd", stopReason: "error" });
    }
  }

  /**
   * v1 turn correlation for feedback/retry: there is no formal promptId
   * system yet (a separate, later feature), so "the response being rated"
   * is approximated as everything in the transcript after the most recent
   * "user" event. Good enough for now, but it means feedback/retry always
   * refers to the latest turn even if the user clicks controls on an older
   * message further up in a long session — worth revisiting once turns
   * carry real IDs.
   */
  turnContext() {
    let uIdx = -1;
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      if (this.transcript[i].type === "user") { uIdx = i; break; }
    }
    const userPromptText = uIdx >= 0 ? this.transcript[uIdx].text : "";
    const after = uIdx >= 0 ? this.transcript.slice(uIdx + 1) : [];
    const assistantResponseText = after.filter((e) => e.type === "chunk").map((e) => e.text).join("");
    const toolsById = new Map();
    for (const e of after) {
      if (e.type === "tool") {
        toolsById.set(e.id, { name: e.title, kind: e.kind, input: e.input, isError: false, outputSummary: undefined });
      } else if (e.type === "toolUpdate") {
        const t = toolsById.get(e.id);
        if (t) {
          t.isError = e.status === "failed";
          if (e.output) t.outputSummary = String(e.output).slice(0, 500);
        }
      }
    }
    return { userPromptText, assistantResponseText, toolCalls: [...toolsById.values()] };
  }

  /** Append one structured entry to this month's local feedback JSONL. */
  logFeedback(fields) {
    const entry = {
      ts: new Date().toISOString(),
      chatId: this.chatId,
      sessionId: this.sessionId,
      model: this.currentModel,
      mode: this.mode,
      ...fields,
    };
    try {
      fs.appendFileSync(feedbackFile(), JSON.stringify(entry) + "\n");
    } catch (err) {
      this.log.appendLine(`feedback log write failed: ${err.message}`);
    }
    return entry;
  }

  async onWebviewMessage(m) {
    switch (m.type) {
      case "send":
        await this.sendPrompt(m.text);
        break;
      case "permissionChoice": {
        const w = this.permissionWaiters.get(m.id);
        if (w) {
          this.permissionWaiters.delete(m.id);
          w(m.optionId);
        }
        break;
      }
      case "setModel":
        this.currentModel = m.model;
        if (this.acp && this.sessionId) {
          await this.acp.request("koder/set_model", { sessionId: this.sessionId, model: m.model });
        }
        break;
      case "setMode":
        this.mode = m.mode;
        if (this.acp && this.sessionId) {
          await this.acp.request("session/set_mode", { sessionId: this.sessionId, modeId: m.mode });
        }
        this.post({ type: "modeChanged", mode: m.mode, auto: false });
        break;
      case "history":
        this.view?.webview.postMessage({ type: "historyList", chats: this.listChats() });
        break;
      case "loadChat": {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(chatsDir(), `${m.id}.json`), "utf8"));
          this.chatId = j.id;
          this.chatTitle = j.title;
          this.mode = j.mode ?? "review";
          this.transcript = j.events ?? [];
          this.view?.webview.postMessage({ type: "replay", events: this.transcript });
          this.view?.webview.postMessage({ type: "modeChanged", mode: this.mode, auto: false });
          const resumed = await this.ensureAgent(j.sessionId);
          this.view?.webview.postMessage({
            type: "system",
            text: resumed && this.sessionId === j.sessionId
              ? "Chat restored — agent memory resumed."
              : "Chat restored (agent memory could not be resumed — starting fresh from here).",
          });
        } catch (err) {
          this.view?.webview.postMessage({ type: "system", text: `could not load chat: ${err.message}` });
        }
        break;
      }
      case "replayRequest":
        if (this.transcript.length) this.view?.webview.postMessage({ type: "replay", events: this.transcript });
        if (this.pendingPlan) {
          const rel = path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", this.pendingPlan);
          this.view?.webview.postMessage({ type: "planReady", path: rel });
        }
        break;
      case "planDecision":
        await this.planDecision(m.decision);
        break;
      case "feedback": {
        // thumbs up/down submitted from the review form under a message.
        const ctx = this.turnContext();
        this.logFeedback({
          rating: m.rating, // "up" | "down"
          comment: m.comment,
          expected: m.expected,
          wentWrong: m.wentWrong,
          ...ctx,
        });
        break;
      }
      case "retryMessage": {
        // Log what the retry is reacting to, then resend the original user
        // prompt as a fresh turn. v1 scope only: this does NOT remove the
        // prior (unhelpful) response from history/context, it just appends
        // a new attempt after it — a real "regenerate that rewinds history"
        // is a separate, larger feature (docs/research/07, P0.6).
        const ctx = this.turnContext();
        this.logFeedback({ rating: "retry", ...ctx });
        if (ctx.userPromptText) {
          await this.sendPrompt(ctx.userPromptText);
        } else {
          this.post({ type: "system", text: "Nothing to retry yet." });
        }
        break;
      }
      case "openFeedbackLog":
        vscode.commands.executeCommand("koder.openFeedbackLog");
        break;
      case "cancel":
        this.acp?.notify("session/cancel", { sessionId: this.sessionId });
        break;
      case "newChat":
        this.newChat();
        break;
      case "openSettings":
        this.post({ type: "showSettings", providers: readProviderState() });
        break;
      case "saveProviders": {
        saveProviderState(m.keys, m.defaultModel);
        if (!this.acp) await this.ensureAgent();
        // validate the key that was just saved, live against the provider
        const savedProvider = Object.keys(m.keys)[0];
        if (savedProvider && this.acp) {
          this.post({ type: "system", text: `checking ${savedProvider} key…` });
          const result = await this.acp.request("koder/validate", { provider: savedProvider });
          if (result.ok) {
            this.post({ type: "system", text: `✓ ${savedProvider} key valid — ${result.models?.length ?? 0} models available` });
            this.post({ type: "providerModels", provider: savedProvider, models: result.models ?? [] });
          } else {
            this.post({ type: "system", text: `✗ ${savedProvider}: ${result.error}. Check the key and save again.` });
          }
        }
        if (this.acp) {
          const models = await this.acp.request("koder/models", {});
          this.post({ type: "ready", models });
        }
        break;
      }
      case "validateProvider": {
        if (!this.acp) await this.ensureAgent();
        if (!this.acp) break;
        const result = await this.acp.request("koder/validate", { provider: m.provider });
        this.post({ type: "providerStatus", provider: m.provider, ...result });
        break;
      }
      case "openSettingsFile":
        vscode.commands.executeCommand("koder.openProviderSettings");
        break;
      case "openLink": {
        const href = String(m.href ?? "");
        if (/^https?:/.test(href)) vscode.env.openExternal(vscode.Uri.parse(href));
        else if (href && !href.includes("..")) {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) {
            vscode.workspace.openTextDocument(path.join(root, href)).then(
              (doc) => vscode.window.showTextDocument(doc),
              () => {},
            );
          }
        }
        break;
      }
      case "boot": {
        // Do NOT spawn the agent runtime just because the panel loaded —
        // that used to call ensureAgent() unconditionally on every webview
        // boot, which spun up the runtime process and issued session/new
        // before the user had typed anything. If that spawn (or the
        // session it opened) ever emitted so much as a "system" notice, it
        // would land in the transcript and get persisted as a titleless
        // "Untitled chat". Instead, populate the model dropdown from a
        // cheap local read of ~/.koder/providers.json (no process spawn),
        // and defer the real runtime connection + live model list to the
        // first actual "send" (which already calls ensureAgent()) or to
        // opening the settings sheet.
        const state = readProviderState();
        const providers = PROVIDER_IDS.filter((id) => state.set[id]);
        this.currentModel ??= state.defaultModel;
        this.post({ type: "ready", models: { defaultModel: state.defaultModel, providers } });
        break;
      }
    }
  }

  async newChat() {
    this.transcript = [];
    this.chatId = `chat-${Date.now()}`;
    this.chatTitle = null;
    this.mode = "review";
    if (this.acp) {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
      const s = await this.acp.request("session/new", { cwd, mcpServers: [] });
      this.sessionId = s.sessionId;
    }
    this.view?.webview.postMessage({ type: "clear" });
  }

  html(webview) {
    // webviews cache resources by URL — version the URLs by file mtime so
    // every extension update is picked up immediately
    const stamp = (f) => {
      try { return Math.round(fs.statSync(path.join(this.context.extensionPath, "media", f)).mtimeMs); }
      catch { return Date.now(); }
    };
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "panel.css")) + "?v=" + stamp("panel.css");
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "panel.js")) + "?v=" + stamp("panel.js");
    const mdjs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "markdown.js")) + "?v=" + stamp("markdown.js");
    const mdcss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "markdown.css")) + "?v=" + stamp("markdown.css");
    const hasMd = fs.existsSync(path.join(this.context.extensionPath, "media", "markdown.js"));
    return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource}; font-src ${webview.cspSource};">
<link rel="stylesheet" href="${css}">
${hasMd ? `<link rel="stylesheet" href="${mdcss}">` : ""}
</head><body>
<div id="app">
  <div id="settingsPanel" hidden>
    <div class="settings-head">
      <span>AI Providers</span>
      <button id="settingsClose" class="ghost" title="Close">&#10005;</button>
    </div>
    <div class="settings-body" id="settingsBody"></div>
    <div class="settings-foot">
      <button id="settingsFile" class="ghost">Edit JSON</button>
      <div class="spacer"></div>
      <button id="settingsSave">Save</button>
    </div>
  </div>
  <div id="historyPanel" hidden>
    <div class="settings-head">
      <span>Chat history</span>
      <button id="historyClose" class="ghost" title="Close">&#10005;</button>
    </div>
    <div class="settings-body" id="historyBody"></div>
  </div>
  <div id="topbar">
    <div id="modes" role="tablist">
      <button data-mode="review" class="mode active" title="Read-only: research and produce a plan">Review</button>
      <button data-mode="approve" class="mode" title="Edits ask for approval">Approve</button>
      <button data-mode="auto" class="mode" title="Agent acts without asking">Auto</button>
    </div>
    <div class="spacer"></div>
    <button id="historyBtn" class="ghost" title="Chat history">&#9776;</button>
  </div>
  <div id="messages"></div>
  <div id="composer">
    <div id="planBar" hidden></div>
    <div id="permissionBar" hidden></div>
    <textarea id="input" rows="3" placeholder="Describe a task. Review mode plans first; Approve executes with your OK."></textarea>
    <div id="toolbar">
      <select id="model" title="Model"></select>
      <div class="spacer"></div>
      <button id="settings" class="ghost" title="Configure providers">&#8942;</button>
      <button id="stop" class="ghost" hidden>Stop</button>
      <button id="send">Send</button>
    </div>
  </div>
</div>
${hasMd ? `<script src="${mdjs}"></script>` : ""}
<script src="${js}"></script>
</body></html>`;
  }
}

async function activate(context) {
  const provider = new AgentViewProvider(context);

  // Koder ships its own agent — make sure the leftover built-in chat surfaces
  // stay off even where extension configurationDefaults don't reach (packaged
  // builds' setup views). One-time, respects later manual changes.
  if (!context.globalState.get("koder.chatDisabled.v1")) {
    const cfg = vscode.workspace.getConfiguration();
    try {
      await cfg.update("chat.disableAIFeatures", true, vscode.ConfigurationTarget.Global);
      await cfg.update("chat.commandCenter.enabled", false, vscode.ConfigurationTarget.Global);
    } catch {}
    context.globalState.update("koder.chatDisabled.v1", true);
  }

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  statusItem.text = "✦ Koder";
  statusItem.tooltip = "Open Koder Agent (⌘L)";
  statusItem.command = "koder.openAgent";
  statusItem.show();

  // agent-first IDE: the agent panel is part of the default layout — open it
  // on every startup unless the user turned that off
  if (vscode.workspace.getConfiguration("koder").get("agent.openOnStartup", true)) {
    setTimeout(() => vscode.commands.executeCommand("koder.chatView.focus"), 900);
  }

  context.subscriptions.push(
    statusItem,
    vscode.window.registerWebviewViewProvider("koder.chatView", provider, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
    vscode.commands.registerCommand("koder.openAgent", () =>
      vscode.commands.executeCommand("koder.chatView.focus"),
    ),
    vscode.commands.registerCommand("koder.newChat", () => provider.newChat()),
    vscode.commands.registerCommand("koder.configureProviders", async () => {
      await vscode.commands.executeCommand("koder.chatView.focus");
      provider.post({ type: "showSettings", providers: readProviderState() });
    }),
    vscode.commands.registerCommand("koder.openProviderSettings", async () => {
      const dir = path.join(os.homedir(), ".koder");
      const file = path.join(dir, "providers.json");
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, PROVIDERS_TEMPLATE);
      const doc = await vscode.workspace.openTextDocument(file);
      vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand("koder.openFeedbackLog", async () => {
      // Opens this month's local feedback JSONL — the "give you the log
      // file" step from a one-click command, no file-hunting required.
      const file = feedbackFile();
      if (!fs.existsSync(file)) fs.writeFileSync(file, "");
      const doc = await vscode.workspace.openTextDocument(file);
      vscode.window.showTextDocument(doc);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
