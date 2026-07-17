// Pure JSONL parsing for LakshX agent trace files
// (agent/src/trace-store.ts's `LocalTurnRecord` — one JSON object per line,
// written to ~/.lakshx/traces/<sessionId>.jsonl by the agent's always-on
// local trace recorder). No vscode or fs dependency here on purpose: this
// module is directly `node --test`-able, and extension.js is the only place
// in this extension that touches the filesystem.
//
// NOT related to lakshx-db in any way — this parses the AGENT's own
// tool-call trace (timing, token spend, per-turn tool calls), never the
// user's database. Kept in its own file/module so that distinction stays
// obvious in the source, not just in prose.
"use strict";

/**
 * Parse a raw JSONL string into an array of turn records. A malformed or
 * partially-written line (e.g. the process was killed mid-`appendFileSync`)
 * is skipped, not fatal — every other valid line still parses. Anything
 * that isn't a plain object with a string `promptId` is dropped too, so a
 * stray blank/garbage line can never corrupt the rendered timeline.
 */
function parseTraceJsonl(raw) {
  if (!raw) return [];
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const turns = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // malformed line — skip, keep going
    }
    if (parsed && typeof parsed === "object" && typeof parsed.promptId === "string") {
      turns.push(parsed);
    }
  }
  return turns;
}

module.exports = { parseTraceJsonl };
