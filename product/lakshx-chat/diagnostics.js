// Diagnostic session report builder for the "copy diagnostics" composer
// button. Extracted out of extension.js into its own zero-vscode-dependency
// module for two reasons:
//
//  1. It was the site of a real, deterministic production bug: the
//     chronological-log renderer called `safeJson(...)` / `indentBlock(...)`
//     on every TOOL CALL block (and a few rarer event kinds), but neither
//     function was ever defined or imported anywhere in extension.js — a
//     plain `ReferenceError: safeJson is not defined` the instant a report
//     covering a session with ANY tool call (i.e. virtually every real
//     coding session) tried to render one. copyDiagnostics's try/catch
//     caught it and surfaced exactly "Copy failed" with no further detail —
//     the bug this module fixes.
//  2. Being vscode-free makes it directly unit-testable with plain
//     `node --test`, instead of only being exercisable inside a running
//     extension host — see test/diagnostics.test.js.
"use strict";

// ---- size guards -----------------------------------------------------
//
// Tool call OUTPUT is already capped at 4000 characters upstream
// (agent/src/server.ts's onToolEnd, shared with the live tool-call card)
// before it ever reaches this transcript, so it can't blow up the report.
// Thinking/assistant text has no such upstream cap — a session that got
// stuck because the model streamed a long, continuous run of thinking
// tokens (the exact "stuck at thinking" failure mode this report exists to
// diagnose) can accumulate a multi-megabyte `thought` block, and a report
// built from it can be large enough that the clipboard write itself fails
// (a real, platform-dependent limitation — e.g. pipe-based clipboard
// backends used by some Linux/remote setups reject writes past a few MB;
// verified empirically against this machine's own clipboard tooling during
// this fix: writes above ~1MB through a small-buffer pipe already fail with
// ENOBUFS). So thinking/assistant blocks are capped here too, block-by-block:
//
//   - BLOCK_HEAD_CHARS / BLOCK_TAIL_CHARS characters are kept from each end
//     of an oversized block, with a `... N characters trimmed ...` marker
//     in between. 8,000 characters is roughly 1,500-2,000 words — enough to
//     read real, substantial context of how the block started and how it
//     currently stands (the two things a "why did this get stuck" read
//     actually needs), while keeping any single block to at most ~16KB.
//   - This is a PER-BLOCK cap, not a global one: the pathological case this
//     exists for is exactly one huge trailing `thought` block (a runaway
//     reasoning loop that never stopped), so capping each block already
//     bounds the report's total size to something dominated by the number
//     of blocks, not the size of any one of them — comfortably under any
//     realistic clipboard limit even for a long session with many blocks.
const BLOCK_HEAD_CHARS = 8000;
const BLOCK_TAIL_CHARS = 8000;

/**
 * Cap `text` to its first `head` and last `tail` characters, with a marker
 * in between showing how many characters were trimmed. No-ops (returns the
 * original string) when `text` already fits within `head + tail`.
 */
function capText(text, head = BLOCK_HEAD_CHARS, tail = BLOCK_TAIL_CHARS) {
  const s = text ?? "";
  if (s.length <= head + tail) return s;
  const trimmed = s.length - head - tail;
  return (
    s.slice(0, head) +
    `\n\n... [${trimmed.toLocaleString("en-US")} characters trimmed — block was ${s.length.toLocaleString("en-US")} chars total] ...\n\n` +
    s.slice(s.length - tail)
  );
}

/**
 * Safely render any JS value (tool input, an unrecognized raw event, a
 * subagent result payload, ...) as pretty-printed JSON for the report.
 * Never throws: circular structures, BigInts, or anything else
 * `JSON.stringify` chokes on degrade to a readable placeholder instead of
 * blowing up report generation.
 */
function safeJson(value) {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch (err) {
    return `(could not stringify: ${err.message})`;
  }
}

/** Indent every line of `text` by `indent` (default 2 spaces). */
function indentBlock(text, indent = "  ") {
  return String(text ?? "")
    .split("\n")
    .map((line) => indent + line)
    .join("\n");
}

/**
 * Assembles a full, human-readable diagnostic dump of a chat session for
 * the "copy diagnostics" composer button — every REPLAYABLE event in
 * `ctx.transcript`, chronologically, with timestamps/durations, full tool
 * inputs/outputs, thinking/assistant text (capped per-block, see above),
 * mode changes, checkpoints, and subagent activity.
 *
 * Deliberately synchronous and side-effect-free (pure function of `ctx`) —
 * the whole point of this report is to capture a session that's HUNG (the
 * "stuck and cut off at thinking phase" complaint this was built for). A
 * stalled provider stream never fires `turnEnd`, so there is nothing safe
 * to await here; this must never grow an async/network dependency, or it
 * will hang exactly when someone needs it most.
 *
 * Consecutive same-type "chunk" (assistant text) / "thought" (thinking)
 * events are coalesced into one block each — they arrive one small
 * streamed delta at a time, so a raw one-line-per-delta dump would be
 * hundreds of near-empty lines. Concatenating loses no content (every
 * character is preserved, subject to the head/tail cap above) and turns
 * the run into exactly the datum a "how long did thinking/generation take"
 * question needs: first-chunk ts to last-chunk ts.
 *
 * @param {object} ctx
 * @param {Array<object>} ctx.transcript - this.transcript from AgentViewProvider
 * @param {string} ctx.workspace - workspace folder name, or "(no workspace)"
 * @param {string|null} ctx.chatTitle
 * @param {string} ctx.chatId
 * @param {string|null} ctx.sessionId
 * @param {string|null} ctx.currentModel
 * @param {string} ctx.mode
 * @param {number} [ctx.now] - injectable for tests; defaults to Date.now()
 */
function buildDiagnosticReport(ctx) {
  const events = ctx.transcript ?? [];
  const workspace = ctx.workspace ?? "(no workspace)";
  const hasTs = events.some((e) => typeof e.ts === "number");
  const firstTs = hasTs ? events.find((e) => typeof e.ts === "number").ts : null;
  const lastTsEvent = hasTs ? [...events].reverse().find((e) => typeof e.ts === "number") : null;
  const lastTs = lastTsEvent ? lastTsEvent.ts : null;
  const now = ctx.now ?? Date.now();

  const fmtAbs = (ts) => (typeof ts === "number" ? new Date(ts).toISOString() : "unknown time");
  const fmtRel = (ts) =>
    typeof ts === "number" && firstTs != null ? `+${((ts - firstTs) / 1000).toFixed(3)}s` : "";
  const fmtDur = (ms) => (typeof ms === "number" && !Number.isNaN(ms) ? `${(ms / 1000).toFixed(2)}s` : "unknown");
  const tag = (ts) => `[${fmtAbs(ts)} ${fmtRel(ts)}]`.replace(" ]", "]");

  // ---- coalesce chunk/thought runs; pair tool -> toolUpdate(s) ----
  const blocks = [];
  const openTools = new Map(); // toolCallId -> its block, so a later toolUpdate (possibly several) attaches
  for (let i = 0; i < events.length; ) {
    const e = events[i];
    if (e.type === "chunk" || e.type === "thought") {
      let j = i;
      let text = "";
      while (j < events.length && events[j].type === e.type) {
        text += events[j].text ?? "";
        j++;
      }
      blocks.push({ kind: e.type, startTs: e.ts, endTs: events[j - 1].ts, count: j - i, text });
      i = j;
      continue;
    }
    if (e.type === "tool") {
      const block = { kind: "tool", id: e.id, title: e.title, toolKind: e.kind, input: e.input, startTs: e.ts, updates: [] };
      openTools.set(e.id, block);
      blocks.push(block);
      i++;
      continue;
    }
    if (e.type === "toolUpdate") {
      const block = openTools.get(e.id);
      if (block) block.updates.push({ status: e.status, output: e.output, ts: e.ts });
      else blocks.push({ kind: "toolUpdateOrphan", raw: e });
      i++;
      continue;
    }
    blocks.push({ kind: e.type, raw: e });
    i++;
  }

  const lines = [];
  const push = (s = "") => lines.push(s);
  const rule = (ch = "=") => ch.repeat(72);

  // ---------------- header ----------------
  push(rule());
  push("LakshX Diagnostic Session Report");
  push(rule());
  push(`Workspace:        ${workspace}`);
  push(`Chat title:       ${ctx.chatTitle ?? "(untitled)"}`);
  push(`Chat id:          ${ctx.chatId}`);
  push(`Session id:       ${ctx.sessionId ?? "(none)"}`);
  push(`Current model:    ${ctx.currentModel ?? "(unknown)"}`);
  const modes = new Set([ctx.mode]);
  for (const e of events) if (e.type === "modeChanged") modes.add(e.mode);
  push(`Mode(s) used:     ${[...modes].join(", ")}`);
  push(`Session started:  ${hasTs ? fmtAbs(firstTs) : "unknown (session predates diagnostic timestamps)"}`);
  push(`Report generated: ${new Date(now).toISOString()}`);
  push(`Total duration:   ${hasTs ? fmtDur((lastTs ?? now) - firstTs) : "unknown"}`);
  push(`Total events:     ${events.length}`);

  // ---------------- stuck/incomplete-turn detection ----------------
  // A hung turn never posts turnEnd (server.ts only posts it after
  // session/prompt resolves — see sendPrompt in extension.js), so the
  // transcript just stops. Same signature for a tool call with no matching
  // toolUpdate. Surface both explicitly rather than making whoever reads
  // this infer it from a chronology that just ends. This detection is
  // based on event TYPES and TIMESTAMPS only, never on block text content —
  // so it keeps working unchanged even though thought/chunk text is now
  // capped above; a trimmed thought block still trips the "ends
  // mid-THINKING" check below exactly as an uncapped one would.
  const warnings = [];
  let openUserTs = null;
  for (const e of events) {
    if (e.type === "user") openUserTs = e.ts;
    if (e.type === "turnEnd") openUserTs = null;
  }
  if (openUserTs != null) {
    warnings.push(
      `The last turn never completed (no turnEnd event) — stuck for ${hasTs ? fmtDur(now - openUserTs) : "unknown"}.`,
    );
  }
  for (const b of blocks) {
    if (b.kind === "tool" && b.updates.length === 0) {
      warnings.push(`Tool call "${b.title}" (id ${b.id}) started at ${fmtAbs(b.startTs)} and never returned (no toolUpdate).`);
    }
  }
  if (blocks.length) {
    const last = blocks[blocks.length - 1];
    if (last.kind === "thought") {
      warnings.push(
        `Session ends mid-THINKING (${last.count} thought chunk(s), last at ${fmtAbs(last.endTs)}) with no further activity — the "stuck at thinking" signature.`,
      );
    }
  }
  if (warnings.length) {
    push("");
    push(rule("-"));
    push("ANOMALIES DETECTED");
    push(rule("-"));
    for (const w of warnings) push(`  - ${w}`);
  }

  push("");
  push(
    "NOTE: tool call OUTPUT is capped at 4000 characters upstream (agent/src/server.ts onToolEnd,",
  );
  push(
    "shared with the live tool-call card) before it ever reaches this transcript — this report",
  );
  push(
    `cannot show more than that. Thinking and assistant text blocks are capped at the first ${BLOCK_HEAD_CHARS.toLocaleString("en-US")}`,
  );
  push(
    `and last ${BLOCK_TAIL_CHARS.toLocaleString("en-US")} characters (marked when trimmed) — enough to see how a block started and how`,
  );
  push(
    "it currently stands, without risking a report too large for the clipboard to actually copy.",
  );

  push("");
  push(rule());
  push("CHRONOLOGICAL EVENT LOG");
  push(rule());

  for (const b of blocks) {
    push("");
    switch (b.kind) {
      case "thought": {
        const total = (b.text || "").length;
        const capped = capText(b.text);
        const trimmedNote = capped.length < total ? `, ${total.toLocaleString("en-US")} chars total` : "";
        push(`${tag(b.startTs)} THINKING  (${b.count} chunk(s), duration ${fmtDur(b.endTs - b.startTs)}${trimmedNote})`);
        push(rule("-").slice(0, 50));
        push(capped || "(empty)");
        break;
      }
      case "chunk": {
        const total = (b.text || "").length;
        const capped = capText(b.text);
        const trimmedNote = capped.length < total ? `, ${total.toLocaleString("en-US")} chars total` : "";
        push(`${tag(b.startTs)} ASSISTANT TEXT  (${b.count} chunk(s), duration ${fmtDur(b.endTs - b.startTs)}${trimmedNote})`);
        push(rule("-").slice(0, 50));
        push(capped || "(empty)");
        break;
      }
      case "tool": {
        const last = b.updates[b.updates.length - 1];
        push(`${tag(b.startTs)} TOOL CALL: ${b.title}  (id: ${b.id}, kind: ${b.toolKind ?? "?"})`);
        push(rule("-").slice(0, 50));
        push("Input:");
        push(indentBlock(safeJson(b.input)));
        if (last) {
          push(`Result (${last.status}, duration ${fmtDur(last.ts - b.startTs)}):`);
          push(indentBlock(last.output ?? "(no output text)"));
          if (b.updates.length > 1) push(`(${b.updates.length} status updates received; showing the final one)`);
        } else {
          push("Result: *** NEVER RETURNED — no toolUpdate event followed this call ***");
        }
        break;
      }
      case "toolUpdateOrphan":
        push(`${tag(b.raw.ts)} TOOL RESULT (no matching tool-call event in this transcript): id ${b.raw.id}, status ${b.raw.status}`);
        push(indentBlock(b.raw.output ?? ""));
        break;
      case "user":
        push(`${tag(b.raw.ts)} USER PROMPT`);
        push(rule("-").slice(0, 50));
        push(b.raw.text ?? "");
        break;
      case "system":
        push(`${tag(b.raw.ts)} SYSTEM NOTICE`);
        push(`  ${b.raw.text ?? ""}`);
        break;
      case "modeChanged":
        push(`${tag(b.raw.ts)} MODE CHANGED -> ${b.raw.mode}${b.raw.auto ? " (auto)" : " (user)"}`);
        break;
      case "turnEnd":
        push(`${tag(b.raw.ts)} TURN END  (stopReason: ${b.raw.stopReason ?? "?"})`);
        break;
      case "checkpoint":
        push(`${tag(b.raw.ts)} CHECKPOINT  tool: ${b.raw.toolName}, sha: ${b.raw.sha}`);
        push(`  files: ${(b.raw.files ?? []).join(", ")}`);
        break;
      case "checkpointReverted":
        push(`${tag(b.raw.ts)} CHECKPOINT REVERTED`);
        push(`  files: ${(b.raw.paths ?? []).join(", ")}`);
        break;
      case "subagentsStart":
        push(`${tag(b.raw.ts)} SUBAGENTS START  batch ${b.raw.batchId}`);
        push(`  tasks: ${(b.raw.tasks ?? []).map((t) => t.id ?? t).join(", ")}`);
        break;
      case "subagentActivity":
        push(
          `${tag(b.raw.ts)} SUBAGENT ACTIVITY  batch ${b.raw.batchId}, task ${b.raw.taskId}, kind ${b.raw.kind}${b.raw.isError ? " (ERROR)" : ""}`,
        );
        push(`  ${b.raw.detail ?? ""}${b.raw.path ? ` (${b.raw.path})` : ""}`);
        break;
      case "subagentsEnd":
        push(`${tag(b.raw.ts)} SUBAGENTS END  batch ${b.raw.batchId}`);
        push(indentBlock(safeJson(b.raw.results)));
        break;
      default:
        push(`${tag(b.raw?.ts)} ${String(b.kind).toUpperCase()}`);
        push(indentBlock(safeJson(b.raw)));
    }
  }

  push("");
  push(rule());
  push("END OF REPORT");
  push(rule());
  return lines.join("\n");
}

module.exports = { buildDiagnosticReport, safeJson, indentBlock, capText, BLOCK_HEAD_CHARS, BLOCK_TAIL_CHARS };
