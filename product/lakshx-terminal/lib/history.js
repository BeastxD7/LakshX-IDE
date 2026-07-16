// Pure logic for LakshX Terminal's command-block history: duration formatting,
// bounded history/output storage, ANSI stripping, and the label/description/
// icon shaping used to render a TreeItem for one command block. Nothing in
// this file touches the `vscode` module or any I/O, so it's fully unit
// testable with plain node --test (see ../test/history.test.js).
"use strict";

/** Hard cap on how many command blocks we keep in memory across the session. */
const DEFAULT_MAX_HISTORY = 200;
/** Hard cap on how many captured output lines we keep per command block. */
const DEFAULT_MAX_OUTPUT_LINES = 20;
/** Command text longer than this is elided in the tree label (full text stays in the tooltip/copy). */
const DEFAULT_MAX_LABEL_LEN = 80;

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

/**
 * Format a millisecond duration as a short human string, e.g. "420ms",
 * "1.2s", "1m 05s". Returns "" for a non-finite/negative input so callers can
 * decide what to show instead (e.g. "running…").
 */
function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    // one decimal under a minute, e.g. "12.3s"; drop the decimal for exact seconds
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
  }
  const totalWholeSeconds = Math.round(totalSeconds);
  const minutes = Math.floor(totalWholeSeconds / 60);
  const seconds = totalWholeSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// Exit-status classification
// ---------------------------------------------------------------------------

/**
 * Classify a command block's status from its endTime/exitCode.
 * - "running": no endTime yet (onDidEndTerminalShellExecution hasn't fired)
 * - "success": exitCode === 0
 * - "failure": exitCode is a defined non-zero number
 * - "unknown": ended but exitCode is undefined (VS Code docs: can happen on
 *   Ctrl+C, an empty Enter press, or a misbehaving shell integration script)
 */
function classifyStatus(endTime, exitCode) {
  if (endTime === undefined || endTime === null) return "running";
  if (exitCode === 0) return "success";
  if (exitCode === undefined || exitCode === null) return "unknown";
  return "failure";
}

// ---------------------------------------------------------------------------
// Bounded history storage
// ---------------------------------------------------------------------------

/**
 * Return a NEW array with `item` inserted at the front of `list`, trimmed to
 * at most `maxLen` entries (oldest/last entries dropped first). Pure — does
 * not mutate `list`.
 */
function boundedUnshift(list, item, maxLen = DEFAULT_MAX_HISTORY) {
  const next = [item, ...list];
  if (next.length > maxLen) next.length = maxLen;
  return next;
}

// ---------------------------------------------------------------------------
// ANSI stripping + bounded output capture
// ---------------------------------------------------------------------------

// Matches common ANSI/VT escape sequences (CSI, OSC terminated by BEL/ST, and
// bare Esc-prefixed sequences) so a raw shell-integration data stream can be
// reduced to plain text for a readable preview. Deliberately conservative
// (covers what real shells emit for color/cursor control) rather than a
// from-scratch VT parser.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[a-zA-Z]|\x1b[@-Z\\-_]/g;

function stripAnsi(input) {
  if (typeof input !== "string" || input.length === 0) return "";
  return input.replace(ANSI_PATTERN, "");
}

/**
 * Incrementally fold a raw (possibly ANSI-laden, possibly partial-line) chunk
 * of terminal output into a bounded sliding window of complete lines.
 *
 * `state` is `{ lines: string[], partial: string }` (start with
 * `{ lines: [], partial: "" }`). Returns a NEW state object; does not mutate
 * the input. Only the last `maxLines` completed lines are retained — this is
 * what keeps a command block's stored output preview small regardless of how
 * chatty the command was.
 */
function appendOutputChunk(state, rawChunk, maxLines = DEFAULT_MAX_OUTPUT_LINES) {
  const prev = state || { lines: [], partial: "" };
  const clean = stripAnsi(rawChunk || "");
  const combined = prev.partial + clean;
  // Split on \r\n, \r, or \n so carriage-return-only redraws (progress bars,
  // etc.) don't get glued onto the next real line.
  const parts = combined.split(/\r\n|\r|\n/);
  const partial = parts.pop(); // last part has no trailing newline yet
  let lines = prev.lines.concat(parts.filter((l) => l.length > 0));
  if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);
  return { lines, partial };
}

/** Flatten an output-capture state into the finalized line list for storage/display (includes a trailing partial line, if any, as-is). */
function finalizeOutputLines(state, maxLines = DEFAULT_MAX_OUTPUT_LINES) {
  if (!state) return [];
  const all = state.partial ? state.lines.concat([state.partial]) : state.lines.slice();
  return all.length > maxLines ? all.slice(all.length - maxLines) : all;
}

// ---------------------------------------------------------------------------
// Command-text shaping
// ---------------------------------------------------------------------------

/** Elide a long single-line command for display; full text is preserved separately for copy/tooltip. */
function truncateCommandText(text, maxLen = DEFAULT_MAX_LABEL_LEN) {
  const value = typeof text === "string" ? text : "";
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;
  return `${singleLine.slice(0, maxLen - 1)}…`; // trailing ellipsis
}

// ---------------------------------------------------------------------------
// TreeItem-shaping (still pure: takes/returns plain data, no vscode.* calls)
// ---------------------------------------------------------------------------

const STATUS_ICON = {
  // "sync" (not "sync~spin"): the ~spin modifier reliably animates in text
  // contexts ($(sync~spin) in a status bar string) but whether it resolves
  // as a ThemeIcon *id* for a TreeItem.iconPath is version-dependent, so the
  // tree uses the plain, unambiguous icon id and leaves the animated glyph
  // to the status bar (see extension.js's updateStatusBar).
  running: { id: "sync", colorKey: undefined },
  success: { id: "pass", colorKey: "testing.iconPassed" },
  failure: { id: "error", colorKey: "testing.iconFailed" },
  unknown: { id: "circle-slash", colorKey: "disabledForeground" },
};

/**
 * Shape a plain command-block entry into the fields a TreeItem needs: label,
 * description, tooltip, icon id/color key, and whether it should render as
 * collapsible (only when we have a captured output preview to show as
 * children).
 *
 * `entry` shape: { commandText, terminalName, startTime, endTime, exitCode,
 * cwd, outputLines, outputOmittedReason }
 */
function shapeCommandEntry(entry) {
  const status = classifyStatus(entry.endTime, entry.exitCode);
  const icon = STATUS_ICON[status];
  const duration = status === "running" ? "running…" : formatDuration(entry.endTime - entry.startTime);
  const label = truncateCommandText(entry.commandText);
  const descriptionParts = [entry.terminalName, duration].filter(Boolean);
  const description = descriptionParts.join(" · ");

  const tooltipLines = [entry.commandText || "(unknown command)", `Terminal: ${entry.terminalName || "unknown"}`, `Status: ${status}${typeof entry.exitCode === "number" ? ` (exit ${entry.exitCode})` : ""}`, `Duration: ${duration}`];
  if (entry.cwd) tooltipLines.push(`Cwd: ${entry.cwd}`);
  if (entry.outputOmittedReason) tooltipLines.push(entry.outputOmittedReason);

  const hasOutput = Array.isArray(entry.outputLines) && entry.outputLines.length > 0;

  return {
    status,
    label,
    fullCommandText: entry.commandText || "",
    description,
    tooltip: tooltipLines.join("\n"),
    iconId: icon.id,
    iconColorKey: icon.colorKey,
    collapsible: hasOutput,
  };
}

module.exports = {
  DEFAULT_MAX_HISTORY,
  DEFAULT_MAX_OUTPUT_LINES,
  DEFAULT_MAX_LABEL_LEN,
  formatDuration,
  classifyStatus,
  boundedUnshift,
  stripAnsi,
  appendOutputChunk,
  finalizeOutputLines,
  truncateCommandText,
  shapeCommandEntry,
};
