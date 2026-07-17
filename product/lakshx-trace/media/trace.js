// Webview-side script for the LakshX Trace panel. Receives already-parsed,
// already-paginated, already-capped turn data from extension.js via
// postMessage — this script never touches the filesystem and never talks to
// the agent process directly (see extension.js's module doc for why).
//
// Rendering is itself capped on top of what the host already caps: a turn's
// tool-call list only ever renders the page it was given (host-side cap),
// and "Show more" is the only way more turns enter the DOM — there is no
// path that renders every recorded turn at once.
(function () {
  const vscodeApi = acquireVsCodeApi();
  const PAGE_SIZE = 20;

  const el = {
    sessionPicker: document.getElementById("sessionPicker"),
    refresh: document.getElementById("refresh"),
    empty: document.getElementById("empty"),
    error: document.getElementById("error"),
    content: document.getElementById("content"),
    statTurns: document.getElementById("statTurns"),
    statInputTokens: document.getElementById("statInputTokens"),
    statOutputTokens: document.getElementById("statOutputTokens"),
    statToolCalls: document.getElementById("statToolCalls"),
    statErrors: document.getElementById("statErrors"),
    slowestList: document.getElementById("slowestList"),
    timeline: document.getElementById("timeline"),
    showMore: document.getElementById("showMore"),
  };

  const state = {
    sessions: [],
    currentKey: null,
    offset: 0,
    hasMore: false,
    turns: [], // accumulated across pages for the currently selected session
  };

  function fmtMs(ms) {
    if (!Number.isFinite(ms)) return "?";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function fmtTokens(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(1)}k`;
  }

  function fmtTime(ms) {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return String(ms);
    }
  }

  function showView(name) {
    el.empty.hidden = name !== "empty";
    el.error.hidden = name !== "error";
    el.content.hidden = name !== "content";
  }

  function populateSessionPicker() {
    const prev = state.currentKey;
    el.sessionPicker.innerHTML = "";
    for (const s of state.sessions) {
      const opt = document.createElement("option");
      opt.value = s.key;
      const shortKey = s.key.length > 12 ? `${s.key.slice(0, 8)}…` : s.key;
      opt.textContent = `${shortKey} — ${fmtTime(s.mtimeMs)}`;
      el.sessionPicker.appendChild(opt);
    }
    if (prev && state.sessions.some((s) => s.key === prev)) {
      el.sessionPicker.value = prev;
    } else if (state.sessions.length) {
      el.sessionPicker.value = state.sessions[0].key;
    }
  }

  function requestSession(key, offset) {
    state.currentKey = key;
    state.offset = offset;
    if (offset === 0) state.turns = [];
    vscodeApi.postMessage({ type: "loadSession", key, offset, pageSize: PAGE_SIZE });
  }

  el.sessionPicker.addEventListener("change", () => {
    const key = el.sessionPicker.value;
    if (key) requestSession(key, 0);
  });
  el.refresh.addEventListener("click", () => {
    vscodeApi.postMessage({ type: "listSessions" });
  });
  el.showMore.addEventListener("click", () => {
    if (state.currentKey && state.hasMore) requestSession(state.currentKey, state.offset + PAGE_SIZE);
  });

  function renderStats(stats) {
    el.statTurns.textContent = String(stats.totalTurns);
    el.statInputTokens.textContent = fmtTokens(stats.totalInputTokens);
    el.statOutputTokens.textContent = fmtTokens(stats.totalOutputTokens);
    el.statToolCalls.textContent = String(stats.totalToolCalls);
    el.statErrors.textContent = String(stats.totalErrors);
  }

  function renderSlowest(slowest) {
    el.slowestList.innerHTML = "";
    if (!slowest || !slowest.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No tool calls recorded yet.";
      el.slowestList.appendChild(li);
      return;
    }
    for (const tc of slowest) {
      const li = document.createElement("li");
      const badge = document.createElement("span");
      badge.className = tc.isError ? "badge fail" : "badge ok";
      badge.textContent = tc.isError ? "fail" : "ok";
      const name = document.createElement("span");
      name.className = "toolName";
      name.textContent = tc.name;
      const dur = document.createElement("span");
      dur.className = "duration";
      dur.textContent = fmtMs(tc.durationMs);
      li.append(badge, name, dur);
      el.slowestList.appendChild(li);
    }
  }

  const TEXT_PREVIEW_LEN = 300;
  function renderTruncatable(text) {
    const wrap = document.createElement("div");
    wrap.className = "truncatable";
    const str = String(text || "");
    if (str.length <= TEXT_PREVIEW_LEN) {
      wrap.textContent = str || "(empty)";
      return wrap;
    }
    const span = document.createElement("span");
    span.textContent = str.slice(0, TEXT_PREVIEW_LEN);
    const more = document.createElement("button");
    more.className = "moreBtn";
    more.textContent = "…more";
    let expanded = false;
    more.addEventListener("click", () => {
      expanded = !expanded;
      span.textContent = expanded ? str : str.slice(0, TEXT_PREVIEW_LEN);
      more.textContent = expanded ? "less" : "…more";
    });
    wrap.append(span, more);
    return wrap;
  }

  function renderToolCallRow(tc) {
    const li = document.createElement("li");
    li.className = "toolCallRow";

    const header = document.createElement("div");
    header.className = "toolCallHeader";
    const badge = document.createElement("span");
    badge.className = tc.isError ? "badge fail" : "badge ok";
    badge.textContent = tc.isError ? "fail" : "ok";
    const name = document.createElement("span");
    name.className = "toolName";
    name.textContent = tc.name;
    const dur = document.createElement("span");
    dur.className = "duration";
    dur.textContent = fmtMs(Math.max(0, (tc.endedAt || 0) - (tc.startedAt || 0)));
    header.append(badge, name, dur);
    li.appendChild(header);

    const body = document.createElement("div");
    body.className = "toolCallBody";
    const inLabel = document.createElement("div");
    inLabel.className = "fieldLabel";
    inLabel.textContent = "Input";
    const outLabel = document.createElement("div");
    outLabel.className = "fieldLabel";
    outLabel.textContent = "Output";
    body.append(inLabel, renderTruncatable(tc.inputSummary), outLabel, renderTruncatable(tc.outputSummary));
    li.appendChild(body);

    header.addEventListener("click", () => li.classList.toggle("expanded"));
    return li;
  }

  function renderTurn(turn) {
    const li = document.createElement("li");
    li.className = "turnRow";

    const header = document.createElement("div");
    header.className = "turnHeader";
    const time = document.createElement("span");
    time.className = "turnTime";
    time.textContent = fmtTime(turn.startedAt);
    const model = document.createElement("span");
    model.className = "turnModel";
    model.textContent = turn.model || "?";
    const dur = document.createElement("span");
    dur.className = "duration";
    dur.textContent = fmtMs(Math.max(0, (turn.endedAt || 0) - (turn.startedAt || 0)));
    const tokens = document.createElement("span");
    tokens.className = "turnTokens";
    const usage = turn.usage || {};
    tokens.textContent = `${fmtTokens(usage.inputTokens)} in / ${fmtTokens(usage.outputTokens)} out`;
    const toolCount = document.createElement("span");
    toolCount.className = "turnToolCount";
    toolCount.textContent = `${(turn.toolCalls || []).length} tool call(s)`;
    header.append(time, model, dur, tokens, toolCount);
    li.appendChild(header);

    const toolList = document.createElement("ul");
    toolList.className = "toolCallList";
    toolList.hidden = true;
    for (const tc of turn.toolCalls || []) {
      toolList.appendChild(renderToolCallRow(tc));
    }
    if (turn.hiddenToolCallCount) {
      const note = document.createElement("li");
      note.className = "muted";
      note.textContent = `…and ${turn.hiddenToolCallCount} more tool call(s) not shown.`;
      toolList.appendChild(note);
    }
    li.appendChild(toolList);

    header.addEventListener("click", () => {
      toolList.hidden = !toolList.hidden;
      li.classList.toggle("expanded", !toolList.hidden);
    });

    return li;
  }

  function renderTimeline() {
    el.timeline.innerHTML = "";
    if (!state.turns.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No turns recorded for this session yet.";
      el.timeline.appendChild(li);
      return;
    }
    for (const turn of state.turns) {
      el.timeline.appendChild(renderTurn(turn));
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "sessions": {
        state.sessions = msg.sessions || [];
        if (!state.sessions.length) {
          showView("empty");
          return;
        }
        populateSessionPicker();
        showView("content");
        if (!state.currentKey || !state.sessions.some((s) => s.key === state.currentKey)) {
          requestSession(el.sessionPicker.value, 0);
        }
        break;
      }
      case "sessionPage": {
        if (msg.key !== state.currentKey) break; // stale response from a since-abandoned selection
        if (msg.offset === 0) state.turns = msg.turns;
        else state.turns = state.turns.concat(msg.turns);
        state.hasMore = !!msg.hasMore;
        renderStats(msg.stats);
        renderSlowest(msg.stats && msg.stats.slowestToolCalls);
        renderTimeline();
        el.showMore.hidden = !state.hasMore;
        showView("content");
        break;
      }
      case "error": {
        showView("error");
        el.error.textContent = msg.message || "Something went wrong reading the trace files.";
        break;
      }
    }
  });

  vscodeApi.postMessage({ type: "listSessions" });
})();
