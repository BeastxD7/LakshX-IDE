// Koder agent panel UI. No frameworks — small, fast, ours.
const vscode = acquireVsCodeApi();

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const modelEl = document.getElementById("model");
const settingsBtn = document.getElementById("settings");
const permissionBar = document.getElementById("permissionBar");

let streamEl = null; // current streaming agent message
let streamRaw = "";
let busy = false;

function showEmpty() {
  messagesEl.innerHTML = `<div class="empty">
    <div class="mark">✦</div>
    <div class="title">Koder Agent</div>
    <div class="hint">Your code, your keys, your agent.</div>
    <button id="ctaProviders" class="cta">⚙ Configure AI Providers</button>
    <div class="hint"><kbd>⌘L</kbd> open · <kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> newline</div>
  </div>`;
  document.getElementById("ctaProviders")?.addEventListener("click", () =>
    vscode.postMessage({ type: "openSettings" }),
  );
}
showEmpty();

function clearEmpty() {
  messagesEl.querySelector(".empty")?.remove();
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMsg(cls, text) {
  clearEmpty();
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollBottom();
  return el;
}

// minimal safe markdown: escape everything, then bold/inline-code/fences
function renderMd(raw) {
  let s = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/```([\s\S]*?)(```|$)/g, (_, code) => `<pre>${code.replace(/^\w*\n/, "")}</pre>`);
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  return s;
}

let renderTimer = null;
function streamText(text) {
  clearEmpty();
  if (!streamEl) {
    streamEl = document.createElement("div");
    streamEl.className = "msg agent";
    messagesEl.appendChild(streamEl);
    streamRaw = "";
  }
  streamRaw += text;
  if (!renderTimer) {
    renderTimer = setTimeout(() => {
      renderTimer = null;
      streamEl.innerHTML = renderMd(streamRaw);
      scrollBottom();
    }, 60); // debounced re-render — no per-token thrash
  }
}

function endStream() {
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  if (streamEl) streamEl.innerHTML = renderMd(streamRaw);
  streamEl = null;
  streamRaw = "";
  scrollBottom();
}

const tools = new Map();
function addTool(t) {
  endStream();
  const el = document.createElement("div");
  el.className = "tool running";
  el.innerHTML = `<span class="dot"></span><span class="title"></span>`;
  el.querySelector(".title").textContent = t.title;
  messagesEl.appendChild(el);
  tools.set(t.id, el);
  scrollBottom();
}

function setBusy(b) {
  busy = b;
  sendBtn.disabled = b;
  stopBtn.hidden = !b;
  if (b) {
    clearEmpty();
    const th = document.createElement("div");
    th.className = "thinking";
    th.id = "thinking";
    th.innerHTML = "<i></i><i></i><i></i>";
    messagesEl.appendChild(th);
    scrollBottom();
  } else {
    document.getElementById("thinking")?.remove();
  }
}

function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;
  addMsg("user", text);
  inputEl.value = "";
  vscode.postMessage({ type: "send", text });
}

// ---------- BYOK settings panel ----------
const settingsPanel = document.getElementById("settingsPanel");
const settingsBody = document.getElementById("settingsBody");
const PROVIDER_LABELS = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  openrouter: "OpenRouter — 400+ models",
  gemini: "Google Gemini",
  deepseek: "DeepSeek",
  groq: "Groq",
  xai: "xAI (Grok)",
};

function showSettings(state) {
  settingsBody.innerHTML = "";
  const dm = document.createElement("div");
  dm.className = "field";
  dm.innerHTML = `<label>Default model <span class="muted">provider/model</span></label>
    <input id="defaultModel" placeholder="anthropic/claude-sonnet-5">`;
  dm.querySelector("input").value = state.defaultModel || "";
  settingsBody.appendChild(dm);

  for (const [id, label] of Object.entries(PROVIDER_LABELS)) {
    const f = document.createElement("div");
    f.className = "field";
    const isSet = state.set?.[id];
    f.innerHTML = `<label>${label} ${isSet ? '<span class="pill">key saved</span>' : ""}</label>
      <input type="password" data-provider="${id}" placeholder="${isSet ? "•••••••• (leave blank to keep)" : "API key"}">`;
    settingsBody.appendChild(f);
  }
  settingsPanel.hidden = false;
}

document.getElementById("settingsClose").addEventListener("click", () => (settingsPanel.hidden = true));
document.getElementById("settingsFile").addEventListener("click", () => vscode.postMessage({ type: "openSettingsFile" }));
document.getElementById("settingsSave").addEventListener("click", () => {
  const keys = {};
  for (const input of settingsBody.querySelectorAll("input[data-provider]")) {
    if (input.value.trim()) keys[input.dataset.provider] = input.value.trim();
  }
  const defaultModel = document.getElementById("defaultModel").value.trim();
  vscode.postMessage({ type: "saveProviders", keys, defaultModel });
  settingsPanel.hidden = true;
});

sendBtn.addEventListener("click", send);
stopBtn.addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
settingsBtn.addEventListener("click", () => vscode.postMessage({ type: "openSettings" }));
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
modelEl.addEventListener("change", () =>
  vscode.postMessage({ type: "setModel", model: modelEl.value }),
);

window.addEventListener("message", (e) => {
  const m = e.data;
  switch (m.type) {
    case "ready": {
      modelEl.innerHTML = "";
      const def = m.models.defaultModel;
      const opts = new Set([def]);
      const suggestions = {
        anthropic: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"],
        openai: ["gpt-5.5"],
        openrouter: ["deepseek/deepseek-chat"],
        gemini: ["gemini-3-flash"],
        deepseek: ["deepseek-chat"],
        groq: [],
        xai: [],
      };
      for (const p of m.models.providers) {
        for (const model of suggestions[p] ?? []) opts.add(`${p}/${model}`);
      }
      for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        if (o === def) opt.selected = true;
        modelEl.appendChild(opt);
      }
      if (m.models.providers.length === 0) {
        // BYOK front and center: open the provider sheet automatically
        vscode.postMessage({ type: "openSettings" });
      } else {
        addMsg("system", `Ready — ${m.models.providers.length} provider(s) configured.`);
      }
      break;
    }
    case "chunk":
      document.getElementById("thinking")?.remove();
      streamText(m.text);
      break;
    case "tool":
      document.getElementById("thinking")?.remove();
      addTool(m);
      break;
    case "toolUpdate": {
      const el = tools.get(m.id);
      if (el) el.className = `tool ${m.status === "completed" ? "done" : m.status === "failed" ? "failed" : "running"}`;
      break;
    }
    case "permission": {
      permissionBar.hidden = false;
      permissionBar.innerHTML = `<span>🔐</span><span class="title"></span>`;
      permissionBar.querySelector(".title").textContent = m.title;
      for (const o of m.options) {
        const b = document.createElement("button");
        b.className = o.kind.startsWith("allow") ? "allow" : "deny";
        b.textContent = o.name;
        b.addEventListener("click", () => {
          permissionBar.hidden = true;
          vscode.postMessage({ type: "permissionChoice", id: m.id, optionId: o.id });
        });
        permissionBar.appendChild(b);
      }
      break;
    }
    case "turnStart":
      setBusy(true);
      break;
    case "turnEnd":
      endStream();
      setBusy(false);
      permissionBar.hidden = true;
      break;
    case "showSettings":
      showSettings(m.providers);
      break;
    case "system":
      addMsg("system", m.text);
      break;
    case "clear":
      messagesEl.innerHTML = "";
      tools.clear();
      endStream();
      setBusy(false);
      showEmpty();
      break;
  }
});

vscode.postMessage({ type: "boot" });
