// "Explain this crash" (docs/research/15-ide-feature-roadmap.md item #8) —
// pure prompt-assembly for an unhandled-exception debug stop. Zero vscode/fs
// dependency, directly unit-testable with plain `node --test` (same reason
// diagnostics.js was extracted: extension.js itself can't be exercised
// without a running Extension Host, this can).
//
// extension.js's DAP tracker does all the vscode/session/fs work (watching
// `onDidSendMessage` for a `stopped` event with `body.reason === "exception"`,
// calling `session.customRequest("exceptionInfo"/"stackTrace", ...)`, reading
// a workspace-relative source file for the crash-line excerpt) and hands the
// raw, already-resolved results in here. This module only turns that data
// into the two strings the rest of the flow needs:
//
//   - `displayText`  — short, goes in the persisted/rendered "user" bubble
//                      (e.g. "Explain this crash: TypeError"), exactly like
//                      how an attachment chip's fallback display text
//                      ("@path/to/file.js") stays short in extension.js's
//                      sendPrompt().
//   - `promptBlock`  — the full `<exception>...</exception>` context block,
//                      folded into the OUTGOING prompt text only (never
//                      shown/persisted as the user message) — the same
//                      "display stays clean, model gets the full context"
//                      split extension.js's `buildFileBlock`/`<file>` chip
//                      expansion already uses for @-mention attachments.
"use strict";

// Caps mirror the spirit of extension.js's MAX_ATTACH_LINES/MAX_ATTACH_CHARS
// (never hand the model more than a bounded, cheap-to-read slice) but sized
// for a small crash-line excerpt rather than a whole attached file.
const MAX_CRASH_FRAMES = 12;
const DEFAULT_EXCERPT_CONTEXT_LINES = 12; // lines of context above/below the crash line
const MAX_EXCERPT_CHARS = 4_000;

/** Minimal attribute-value escaping for the `<exception ...>` tag — exception messages/type names are arbitrary debuggee text. */
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Normalize a DAP `stackTrace` response's `stackFrames` (each frame is
 * `{name, source: {path, ...}, line, column, ...}`, largely optional per the
 * DAP spec and adapter-dependent in practice) into the flat
 * `{name, path, line}` shape the rest of this module works with. Never
 * throws; a non-array input yields `[]`.
 */
function normalizeFrames(stackFrames) {
  if (!Array.isArray(stackFrames)) return [];
  return stackFrames.map((f) => ({
    name: f && typeof f.name === "string" ? f.name : undefined,
    path: f && f.source && typeof f.source.path === "string" ? f.source.path : undefined,
    line: f && typeof f.line === "number" ? f.line : undefined,
  }));
}

/**
 * Render up to `maxFrames` normalized stack frames as `at name (path:line)`
 * lines, with a trailing "N more frame(s) omitted" note if the real trace is
 * longer. `"(no stack trace available)"` if there are no frames at all —
 * this is the DAP `stackTrace` customRequest failing/returning nothing,
 * which extension.js is expected to tolerate (task requirement: degrade
 * gracefully rather than assume a rigid schema).
 */
function formatStackFrames(frames, maxFrames = MAX_CRASH_FRAMES) {
  const list = Array.isArray(frames) ? frames : [];
  if (!list.length) return "(no stack trace available)";
  const shown = list.slice(0, maxFrames);
  const lines = shown.map((f) => {
    const name = f?.name || "(anonymous)";
    const loc = f?.path ? `${f.path}${f.line != null ? `:${f.line}` : ""}` : "unknown location";
    return `  at ${name} (${loc})`;
  });
  if (list.length > shown.length) {
    lines.push(`  … ${list.length - shown.length} more frame(s) omitted`);
  }
  return lines.join("\n");
}

/**
 * Build a small, capped source excerpt centered on `lineNumber` (1-based).
 * Returns `null` for any unusable input (no text, bad line number) rather
 * than throwing — callers (extension.js) already only call this when a file
 * was actually read successfully, but this stays defensive on its own.
 */
function buildCodeExcerpt(fileText, lineNumber, contextLines = DEFAULT_EXCERPT_CONTEXT_LINES) {
  if (typeof fileText !== "string" || !fileText) return null;
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  const lines = fileText.split("\n");
  const start = Math.max(1, lineNumber - contextLines);
  const end = Math.min(lines.length, lineNumber + contextLines);
  if (start > lines.length) return null;
  const out = [];
  for (let n = start; n <= end; n++) {
    const marker = n === lineNumber ? ">" : " ";
    out.push(`${marker} ${String(n).padStart(5)} | ${lines[n - 1]}`);
  }
  let text = out.join("\n");
  if (text.length > MAX_EXCERPT_CHARS) text = text.slice(0, MAX_EXCERPT_CHARS) + "\n… (truncated)";
  return text;
}

/** Short display text for the persisted/rendered "user" bubble — never carries the full context. */
function buildCrashDisplayText(typeName) {
  return typeName ? `Explain this crash: ${typeName}` : "Explain this crash";
}

/**
 * Assemble the full `<exception>` prompt block from already-normalized
 * pieces. Every field is optional and degrades to a placeholder rather than
 * omitting the tag or throwing — an adapter that only implements part of the
 * DAP exception-info surface still produces a usable, well-formed block.
 *
 * @param {object} p
 * @param {string} [p.typeName] - exceptionInfo.details.typeName, e.g. "TypeError"
 * @param {string} [p.message] - exceptionInfo.details.message
 * @param {string} [p.description] - exceptionInfo.description
 * @param {string} [p.breakMode] - exceptionInfo.breakMode, e.g. "unhandled" | "always" | "userUnhandled"
 * @param {Array}  [p.frames] - normalized frames, see normalizeFrames()
 * @param {number} [p.maxFrames]
 * @param {string|null} [p.excerpt] - pre-built excerpt text (buildCodeExcerpt()'s return), or null/undefined if none
 * @param {string} [p.excerptPath] - top frame's path, only used to label the excerpt
 * @param {number} [p.excerptLine] - top frame's line, only used to label the excerpt
 */
function buildExceptionPromptBlock({
  typeName,
  message,
  description,
  breakMode,
  frames,
  maxFrames = MAX_CRASH_FRAMES,
  excerpt,
  excerptPath,
  excerptLine,
} = {}) {
  const lines = [];
  const typeAttr = typeName ? ` type="${escapeAttr(typeName)}"` : "";
  const modeAttr = breakMode ? ` breakMode="${escapeAttr(breakMode)}"` : "";
  lines.push(`<exception${typeAttr}${modeAttr}>`);
  const desc = message || description;
  lines.push(desc ? desc : "(no exception description available)");
  lines.push("");
  lines.push("Stack trace:");
  lines.push(formatStackFrames(frames, maxFrames));
  if (excerpt) {
    lines.push("");
    lines.push(`Code around ${excerptPath ?? "top frame"}${excerptLine != null ? `:${excerptLine}` : ""}:`);
    lines.push("```");
    lines.push(excerpt);
    lines.push("```");
  }
  lines.push("</exception>");
  return lines.join("\n");
}

/**
 * Top-level entry point: normalize raw (but already-fetched) DAP results
 * into `{displayText, promptBlock}` — everything extension.js's sendPrompt()
 * needs. Pure — `excerptText`, if any, must already have been read from disk
 * by the caller (this module never touches fs).
 *
 * @param {object} input
 * @param {object} [input.exceptionInfo] - result of `session.customRequest("exceptionInfo", {threadId})`, or null/undefined if that call failed
 * @param {Array}  [input.stackFrames] - the `stackFrames` array from `session.customRequest("stackTrace", {threadId})`'s result, or null/undefined if that call failed
 * @param {string|null} [input.excerptText] - full text of the top frame's file, only if it resolved to a readable, in-workspace path; null/undefined otherwise
 * @param {number} [input.maxFrames]
 * @param {number} [input.excerptContextLines]
 */
function buildCrashContext({
  exceptionInfo,
  stackFrames,
  excerptText,
  maxFrames = MAX_CRASH_FRAMES,
  excerptContextLines = DEFAULT_EXCERPT_CONTEXT_LINES,
} = {}) {
  const typeName = exceptionInfo?.details?.typeName;
  const message = exceptionInfo?.details?.message;
  const description = exceptionInfo?.description;
  const breakMode = exceptionInfo?.breakMode;

  const frames = normalizeFrames(stackFrames);
  const topFrame = frames[0];

  const excerpt =
    excerptText && topFrame?.line != null ? buildCodeExcerpt(excerptText, topFrame.line, excerptContextLines) : null;

  const promptBlock = buildExceptionPromptBlock({
    typeName,
    message,
    description,
    breakMode,
    frames,
    maxFrames,
    excerpt,
    excerptPath: topFrame?.path,
    excerptLine: topFrame?.line,
  });

  return { displayText: buildCrashDisplayText(typeName), promptBlock };
}

module.exports = {
  MAX_CRASH_FRAMES,
  DEFAULT_EXCERPT_CONTEXT_LINES,
  MAX_EXCERPT_CHARS,
  normalizeFrames,
  formatStackFrames,
  buildCodeExcerpt,
  buildCrashDisplayText,
  buildExceptionPromptBlock,
  buildCrashContext,
};
