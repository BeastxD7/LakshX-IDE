// Koder Agent panel — ACP client + webview UI. Plain CJS, zero dependencies:
// a minimal ndjson JSON-RPC client speaks ACP to the Koder Agent Runtime.
const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ---------- minimal ACP (JSON-RPC over ndjson/stdio) client ----------
class AcpClient {
  constructor(command, args, cwd, handlers) {
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = handlers;
    this.child = cp.spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.on("data", (d) => console.log(`[koder-agent] ${d}`));
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
function agentSpawnSpec(context) {
  const custom = vscode.workspace.getConfiguration("koder").get("agent.command");
  if (custom) return { command: "/bin/zsh", args: ["-lc", custom], cwd: undefined };
  // dev layout: <repo>/upstream/extensions/koder-chat → runtime at <repo>/agent
  const candidates = [
    path.resolve(context.extensionPath, "..", "..", "..", "agent"),
    path.resolve(context.extensionPath, "..", "..", "agent"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "src", "server.ts"))) {
      return { command: "npx", args: ["tsx", "src/server.ts"], cwd: dir };
    }
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

// ---------- webview view ----------
class AgentViewProvider {
  constructor(context) {
    this.context = context;
    this.acp = null;
    this.sessionId = null;
    this.permissionWaiters = new Map();
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onWebviewMessage(m));
  }

  post(msg) {
    this.view?.webview.postMessage(msg);
  }

  async ensureAgent() {
    if (this.acp && this.sessionId) return true;
    const spec = agentSpawnSpec(this.context);
    if (!spec) {
      this.post({ type: "system", text: "Koder Agent Runtime not found. Set koder.agent.command in settings." });
      return false;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    this.acp = new AcpClient(spec.command, spec.args, spec.cwd ?? cwd, {
      onExit: (code) => {
        this.post({ type: "system", text: `agent exited (${code}) — will restart on next message` });
        this.acp = null;
        this.sessionId = null;
      },
      onNotification: (method, params) => {
        if (method === "session/update") this.onSessionUpdate(params.update);
      },
      onRequest: async (method, params) => {
        if (method === "session/request_permission") return this.onPermissionRequest(params);
        throw new Error(`unhandled ${method}`);
      },
    });
    await this.acp.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const models = await this.acp.request("koder/models", {});
    const s = await this.acp.request("session/new", { cwd, mcpServers: [] });
    this.sessionId = s.sessionId;
    this.post({ type: "ready", models });
    return true;
  }

  onSessionUpdate(u) {
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content?.type === "text") this.post({ type: "chunk", text: u.content.text });
        break;
      case "tool_call":
        this.post({ type: "tool", id: u.toolCallId, title: u.title, kind: u.kind, status: u.status });
        break;
      case "tool_call_update":
        this.post({ type: "toolUpdate", id: u.toolCallId, status: u.status });
        break;
    }
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

  async onWebviewMessage(m) {
    switch (m.type) {
      case "send": {
        if (!(await this.ensureAgent())) return;
        this.post({ type: "turnStart" });
        try {
          const res = await this.acp.request("session/prompt", {
            sessionId: this.sessionId,
            prompt: [{ type: "text", text: m.text }],
          });
          this.post({ type: "turnEnd", stopReason: res.stopReason });
        } catch (err) {
          this.post({ type: "system", text: `error: ${err.message}` });
          this.post({ type: "turnEnd", stopReason: "error" });
        }
        break;
      }
      case "permissionChoice": {
        const w = this.permissionWaiters.get(m.id);
        if (w) {
          this.permissionWaiters.delete(m.id);
          w(m.optionId);
        }
        break;
      }
      case "setModel":
        if (this.acp && this.sessionId) {
          await this.acp.request("koder/set_model", { sessionId: this.sessionId, model: m.model });
        }
        break;
      case "cancel":
        this.acp?.notify("session/cancel", { sessionId: this.sessionId });
        break;
      case "newChat":
        this.newChat();
        break;
      case "openSettings":
        vscode.commands.executeCommand("koder.openProviderSettings");
        break;
      case "boot":
        this.ensureAgent();
        break;
    }
  }

  async newChat() {
    if (this.acp) {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
      const s = await this.acp.request("session/new", { cwd, mcpServers: [] });
      this.sessionId = s.sessionId;
    }
    this.post({ type: "clear" });
  }

  html(webview) {
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "panel.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "panel.js"));
    return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource}; font-src ${webview.cspSource};">
<link rel="stylesheet" href="${css}">
</head><body>
<div id="app">
  <div id="messages"></div>
  <div id="composer">
    <div id="permissionBar" hidden></div>
    <textarea id="input" rows="3" placeholder="Ask Koder to build, fix, or explain anything…"></textarea>
    <div id="toolbar">
      <select id="model" title="Model"></select>
      <div class="spacer"></div>
      <button id="settings" class="ghost" title="Configure providers (BYOK)">⚙</button>
      <button id="stop" class="ghost" hidden>Stop</button>
      <button id="send">Send</button>
    </div>
  </div>
</div>
<script src="${js}"></script>
</body></html>`;
  }
}

function activate(context) {
  const provider = new AgentViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("koder.agentView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("koder.newChat", () => provider.newChat()),
    vscode.commands.registerCommand("koder.openProviderSettings", async () => {
      const dir = path.join(os.homedir(), ".koder");
      const file = path.join(dir, "providers.json");
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, PROVIDERS_TEMPLATE);
      const doc = await vscode.workspace.openTextDocument(file);
      vscode.window.showTextDocument(doc);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
