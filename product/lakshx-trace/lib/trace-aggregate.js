// Pure aggregation, pagination, and rendering-cap logic over a session's
// already-parsed turn records (see lib/trace-parse.js). No I/O, no vscode —
// node --test-able on its own. extension.js composes these with the actual
// file read; media/trace.js never sees more than one page's worth of data.
"use strict";

const DEFAULT_PAGE_SIZE = 20;
const MAX_TOOL_CALLS_PER_TURN_RENDERED = 200;
const MAX_SLOWEST_TOOL_CALLS = 10;

/** Aggregate stats across every turn in a session — total token spend and the slowest individual tool calls, regardless of which page is currently shown. */
function computeStats(turns) {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalToolCalls = 0;
  let totalErrors = 0;
  const allToolCalls = [];

  for (const t of turns) {
    totalInputTokens += (t.usage && Number(t.usage.inputTokens)) || 0;
    totalOutputTokens += (t.usage && Number(t.usage.outputTokens)) || 0;
    for (const tc of t.toolCalls || []) {
      totalToolCalls++;
      if (tc.isError) totalErrors++;
      allToolCalls.push({
        promptId: t.promptId,
        name: tc.name,
        durationMs: Math.max(0, (Number(tc.endedAt) || 0) - (Number(tc.startedAt) || 0)),
        isError: !!tc.isError,
      });
    }
  }

  allToolCalls.sort((a, b) => b.durationMs - a.durationMs);

  return {
    totalTurns: turns.length,
    totalInputTokens,
    totalOutputTokens,
    totalToolCalls,
    totalErrors,
    slowestToolCalls: allToolCalls.slice(0, MAX_SLOWEST_TOOL_CALLS),
  };
}

/**
 * A newest-first page of turns. `offset` counts from the newest turn (0 =
 * the most recent), so repeated "Show more" clicks walk backward through
 * history without ever needing the whole file in memory on the webview
 * side. Never renders more than `pageSize` turns per call — the bounded-
 * render requirement (a session can have thousands of recorded turns over
 * its lifetime; nothing here ever hands the webview all of them at once).
 */
function paginateTurns(turns, offset = 0, pageSize = DEFAULT_PAGE_SIZE) {
  const sorted = turns.slice().sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0));
  const page = sorted.slice(offset, offset + pageSize);
  return { page, hasMore: offset + pageSize < sorted.length, total: sorted.length };
}

/** Cap how many tool calls are rendered for a single turn — a pathological turn with hundreds of tool calls must not blow up the DOM. Returns the visible slice plus a count of how many were hidden. */
function capToolCalls(toolCalls, max = MAX_TOOL_CALLS_PER_TURN_RENDERED) {
  if (!Array.isArray(toolCalls)) return { shown: [], hiddenCount: 0 };
  if (toolCalls.length <= max) return { shown: toolCalls, hiddenCount: 0 };
  return { shown: toolCalls.slice(0, max), hiddenCount: toolCalls.length - max };
}

module.exports = {
  computeStats,
  paginateTurns,
  capToolCalls,
  DEFAULT_PAGE_SIZE,
  MAX_TOOL_CALLS_PER_TURN_RENDERED,
  MAX_SLOWEST_TOOL_CALLS,
};
