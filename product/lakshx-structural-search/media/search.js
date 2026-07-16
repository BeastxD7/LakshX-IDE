// LakshX Structural Search webview client. Vanilla DOM, no framework/CDN
// (same "no libs" convention as lakshx-graph's canvas webview) — this panel
// is a form + a checkbox list, which doesn't need one.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();

  const patternInput = document.getElementById("pattern");
  const replacementInput = document.getElementById("replacement");
  const searchBtn = document.getElementById("searchBtn");
  const selectAllBtn = document.getElementById("selectAllBtn");
  const selectNoneBtn = document.getElementById("selectNoneBtn");
  const applyBtn = document.getElementById("applyBtn");
  const selCountEl = document.getElementById("selCount");
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");

  /** @type {Map<string, object>} id -> match record currently rendered */
  let matchesById = new Map();
  const selected = new Set();

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = kind || "";
  }

  function updateApplyButton() {
    selCountEl.textContent = String(selected.size);
    applyBtn.disabled = selected.size === 0;
  }

  function doSearch() {
    const p = patternInput.value.trim();
    if (!p) {
      setStatus("Enter a pattern first.", "warn");
      return;
    }
    setStatus("Searching…");
    resultsEl.innerHTML = "";
    matchesById = new Map();
    selected.clear();
    updateApplyButton();
    vscode.postMessage({ type: "search", pattern: p, replacement: replacementInput.value });
  }

  searchBtn.addEventListener("click", doSearch);
  patternInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
  replacementInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  selectAllBtn.addEventListener("click", () => {
    for (const id of matchesById.keys()) selected.add(id);
    for (const cb of resultsEl.querySelectorAll('input[type="checkbox"][data-id]')) cb.checked = true;
    updateApplyButton();
  });
  selectNoneBtn.addEventListener("click", () => {
    selected.clear();
    for (const cb of resultsEl.querySelectorAll('input[type="checkbox"][data-id]')) cb.checked = false;
    updateApplyButton();
  });

  applyBtn.addEventListener("click", () => {
    if (selected.size === 0) return;
    vscode.postMessage({ type: "apply", ids: [...selected], replacement: replacementInput.value });
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function groupByPath(matches) {
    const groups = new Map();
    for (const m of matches) {
      if (!groups.has(m.path)) groups.set(m.path, []);
      groups.get(m.path).push(m);
    }
    return groups;
  }

  function renderResults(matches, truncated, filesScanned) {
    resultsEl.innerHTML = "";
    matchesById = new Map(matches.map((m) => [m.id, m]));
    selected.clear();
    for (const m of matches) selected.add(m.id); // default: all matches pre-selected
    updateApplyButton();

    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.id = "empty";
      empty.textContent = `No matches in ${filesScanned} scanned file${filesScanned === 1 ? "" : "s"}.`;
      resultsEl.appendChild(empty);
      return;
    }

    const groups = groupByPath(matches);
    for (const [filePath, fileMatches] of groups) {
      const group = document.createElement("div");
      group.className = "fileGroup";

      const header = document.createElement("div");
      header.className = "fileHeader";
      header.innerHTML = `<span>${escapeHtml(filePath)}</span><span class="count">${fileMatches.length} match${fileMatches.length === 1 ? "" : "es"}</span>`;
      group.appendChild(header);

      for (const m of fileMatches) {
        const row = document.createElement("div");
        row.className = "matchRow";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.dataset.id = m.id;
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(m.id);
          else selected.delete(m.id);
          updateApplyButton();
        });
        row.appendChild(cb);

        const body = document.createElement("div");
        body.className = "matchBody";

        const loc = document.createElement("div");
        loc.className = "matchLoc";
        loc.textContent = `${m.path}:${m.startLine + 1}:${m.startChar + 1}`;
        loc.addEventListener("click", () => vscode.postMessage({ type: "openMatch", id: m.id }));
        body.appendChild(loc);

        const before = document.createElement("div");
        before.className = "diffLine before";
        before.textContent = m.text;
        body.appendChild(before);

        if (m.preview != null && m.preview !== m.text) {
          const after = document.createElement("div");
          after.className = "diffLine after";
          after.textContent = m.preview;
          body.appendChild(after);
        }

        row.appendChild(body);
        group.appendChild(row);
      }
      resultsEl.appendChild(group);
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "results": {
        const note = msg.truncated ? ` (truncated at ${msg.matches.length} — narrow your pattern for the full set)` : "";
        setStatus(`${msg.matches.length} match${msg.matches.length === 1 ? "" : "es"} across ${msg.filesScanned} file${msg.filesScanned === 1 ? "" : "s"}${note}.`);
        renderResults(msg.matches, msg.truncated, msg.filesScanned);
        break;
      }
      case "error":
        setStatus(msg.message, "error");
        break;
      case "applyResult": {
        if (msg.cancelled) {
          setStatus("Apply cancelled.", "warn");
          break;
        }
        let text = `Applied ${msg.applied} replacement${msg.applied === 1 ? "" : "s"}.`;
        if (msg.skipped) {
          text += ` Skipped ${msg.skipped} (stale — file changed since scan; re-run search).`;
          // Mark skipped rows visibly instead of silently vanishing them.
          for (const s of msg.skippedReasons) {
            if (!s.id) continue;
            const cb = resultsEl.querySelector(`input[data-id="${CSS.escape(s.id)}"]`);
            if (cb) {
              const row = cb.closest(".matchRow");
              if (row) row.style.opacity = "0.5";
              cb.checked = false;
              cb.disabled = true;
              selected.delete(s.id);
            }
          }
        }
        // Applied rows are now stale against disk too (their offsets no
        // longer reflect the file) — grey them out and uncheck so the user
        // doesn't accidentally double-apply; re-search to see fresh state.
        for (const id of [...selected]) {
          const cb = resultsEl.querySelector(`input[data-id="${CSS.escape(id)}"]`);
          if (cb) {
            const row = cb.closest(".matchRow");
            if (row) row.style.opacity = "0.5";
            cb.checked = false;
            cb.disabled = true;
          }
        }
        selected.clear();
        updateApplyButton();
        setStatus(text, msg.skipped ? "warn" : "");
        break;
      }
    }
  });

  // Restore any previously-entered field values (webview may be hidden/shown
  // repeatedly; retainContextWhenHidden keeps this script instance alive, but
  // this is a harmless no-op safety net if VS Code ever recreates it).
  const prevState = vscode.getState();
  if (prevState) {
    if (prevState.pattern) patternInput.value = prevState.pattern;
    if (prevState.replacement) replacementInput.value = prevState.replacement;
  }
  for (const el of [patternInput, replacementInput]) {
    el.addEventListener("input", () => vscode.setState({ pattern: patternInput.value, replacement: replacementInput.value }));
  }
})();
