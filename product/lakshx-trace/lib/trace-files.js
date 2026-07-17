// Direct reads of ~/.lakshx/traces/*.jsonl — the SAME directory
// agent/src/trace-store.ts's always-on local trace recorder writes to.
//
// Deliberately NOT going through an ACP request/lakshx-chat/the agent
// process at all: this mirrors product/lakshx-tab and product/lakshx-search,
// which already read ~/.lakshx/providers.json directly rather than routing
// through agent/src or lakshx-chat — this extension has no runtime
// relationship to a live agent process (there may not even be one running),
// so it just reads the shared, already-on-disk state the same way those two
// do. See extension.js's module doc for the fuller reasoning.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function tracesDir() {
  return path.join(os.homedir(), ".lakshx", "traces");
}

/** List every recorded session's trace file — key (session id), last-modified time, byte size. Newest first. `[]` (never throws) if the directory doesn't exist yet, e.g. the agent has never run. */
function listSessions() {
  const dir = tracesDir();
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        return { key: f.slice(0, -".jsonl".length), mtimeMs: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

/** Same key-sanitizing rule as agent/src/trace-store.ts's `sanitizeKey` — defensive, since a key ultimately becomes part of a filesystem path. */
function sanitizeKey(key) {
  const cleaned = String(key).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
  return cleaned || "unknown";
}

/** Raw file contents for one session's trace file, or "" if it doesn't exist / can't be read. */
function readSessionRaw(key) {
  const file = path.join(tracesDir(), `${sanitizeKey(key)}.jsonl`);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

module.exports = { tracesDir, listSessions, readSessionRaw };
