"use strict";
/**
 * Pure classification of LakshX Agent activity — no vscode, no fs, testable
 * with plain fabricated event arrays.
 *
 * The signal source (glue code lives in extension.js, not here) is the
 * per-chat transcript LakshX Agent (product/lakshx-chat/extension.js) writes
 * to `~/.lakshx/chats/<chatId>.json` — `{ events: [...] }`, one entry per
 * REPLAYABLE event, each stamped with `ts` at post() time. This extension
 * reads that file; it never talks to lakshx-chat directly (no shared
 * module, no exported API) — so this stays a genuinely self-contained
 * sibling extension. That also means we're coupled to an UNDOCUMENTED,
 * another-extension-owned file format: every function here is defensive
 * about shape (missing fields, wrong types) and returns "no signal" rather
 * than throwing, because a future lakshx-chat change must degrade this
 * extension to silence, not crash it.
 *
 * Turn boundaries: lakshx-chat's "turnEnd" event does NOT carry a promptId
 * (see product/lakshx-chat/extension.js's onWebviewMessage "send" case), but
 * turns are strictly serialized there (`this.turnInProgress` guards
 * concurrent sends) — so "the current turn" is exactly the slice of events
 * from just after the most recent preceding "user" event through the
 * "turnEnd" itself. findTurnSlice below does that walk.
 */

/** True if `event` is a failed tool_call_update — the (d) agentTrouble signal. Defensive: never throws on odd shapes. */
function isToolFailure(event) {
  return Boolean(event) && event.type === "toolUpdate" && event.status === "failed";
}

/**
 * Given the FULL ordered events array for one chat and the index of a
 * "turnEnd" event within it, return the slice of events making up that turn
 * (the preceding "user" event through turnEnd, inclusive). If no preceding
 * "user" event exists (malformed/truncated transcript), slices from the
 * start of the array.
 */
function findTurnSlice(events, turnEndIndex) {
  if (!Array.isArray(events) || turnEndIndex < 0 || turnEndIndex >= events.length) return [];
  let start = 0;
  for (let i = turnEndIndex - 1; i >= 0; i--) {
    if (events[i]?.type === "user") {
      start = i;
      break;
    }
  }
  return events.slice(start, turnEndIndex + 1);
}

/**
 * Summarize one turn's events: distinct files touched (deduped across
 * possibly-multiple checkpoint events in the same turn), whether any tool
 * failed during it, the turn's wall-clock duration (ms, from the "user"
 * event's ts to the "turnEnd" event's ts — both stamped by post() at
 * observation time), and the reported stopReason.
 */
function classifyTurn(turnEvents) {
  if (!Array.isArray(turnEvents) || turnEvents.length === 0) {
    return { fileCount: 0, hadFailure: false, durationMs: null, stopReason: null };
  }
  const files = new Set();
  let hadFailure = false;
  let userTs = null;
  let endTs = null;
  let stopReason = null;
  for (const e of turnEvents) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "user" && userTs === null && typeof e.ts === "number") userTs = e.ts;
    if (e.type === "checkpoint" && Array.isArray(e.files)) {
      for (const f of e.files) if (typeof f === "string") files.add(f);
    }
    if (isToolFailure(e)) hadFailure = true;
    if (e.type === "turnEnd") {
      if (typeof e.ts === "number") endTs = e.ts;
      stopReason = e.stopReason ?? null;
    }
  }
  const durationMs = userTs !== null && endTs !== null ? Math.max(0, endTs - userTs) : null;
  return { fileCount: files.size, hadFailure, durationMs, stopReason };
}

// Tunable thresholds — deliberately conservative so triggers stay rare and
// meaningful rather than firing on every small turn.
const THRESHOLDS = {
  bigWinFileCount: 5,
  slickFileCount: 3,
  slickMaxMs: 45_000,
  comebackMinFileCount: 1,
};

/**
 * Decide whether a completed turn (summarized by classifyTurn) is worth a
 * commentary line, and if so which category. Returns null for "no signal"
 * — most turns are unremarkable and should NOT trigger anything.
 */
function decideTurnCategory(summary, thresholds = THRESHOLDS) {
  if (!summary || summary.stopReason === "error") return null;
  if (summary.fileCount === 0) return null;
  // "tests pass after a struggle": this turn touched files successfully
  // despite a failed tool call earlier in the SAME turn (the agent hit an
  // error and recovered within one turn) — a comeback, not a routine change.
  if (summary.hadFailure && summary.fileCount >= thresholds.comebackMinFileCount) return "bigWin";
  if (summary.fileCount >= thresholds.bigWinFileCount) return "bigWin";
  if (summary.fileCount >= thresholds.slickFileCount && summary.durationMs !== null && summary.durationMs <= thresholds.slickMaxMs) {
    return "slickChange";
  }
  return null;
}

module.exports = { isToolFailure, findTurnSlice, classifyTurn, decideTurnCategory, THRESHOLDS };
