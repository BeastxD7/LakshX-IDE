// Custom slash-command discovery + templating (Royal Mode 2.0 Stage 1b —
// docs/research/12 §"slash commands"). Extracted into its own
// zero-vscode-dependency module, same rationale as diagnostics.js: everything
// here is pure file/string work, so it's directly unit-testable with plain
// `node --test` (see test/commands.test.js) instead of only being
// exercisable inside a running extension host.
//
// A custom command is a markdown file: `<name>.md` inside
// `<workspace>/.lakshx/commands/` or `~/.lakshx/commands/`, with an optional
// YAML-ish frontmatter block (only `description:` is read today) followed by
// the prompt-body template. `$ARGUMENTS` in the body is replaced by whatever
// the user typed after the command name; a body with no `$ARGUMENTS` gets
// the args appended on a new line instead (so `/cmd extra context` never
// silently drops the extra context).
"use strict";

const fs = require("fs");
const path = require("path");

// Same clip the composer's attachment chips use (extension.js
// MAX_ATTACH_CHARS) — a runaway command file must not be able to stuff more
// prompt into a turn than an attached file could.
const MAX_BODY_CHARS = 48_000;

// Command names must be typeable as a single `/token` in the composer —
// a filename with spaces or shell-ish characters can never be matched by
// the `/name args` parse, so it's skipped at discovery time, not surfaced
// as a dead popover entry.
const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;

/**
 * Parse one command file's content into { description, body }.
 * Frontmatter is the optional leading block:
 *
 *   ---
 *   description: one line shown in the popover
 *   ---
 *   body template…
 *
 * Deliberately not a YAML parser — plain `key: value` lines only, unknown
 * keys ignored, so a file that pastes richer frontmatter from elsewhere
 * still yields its body instead of an error.
 */
function parseCommandFile(content) {
  let body = String(content ?? "");
  let description = "";
  const fm = body.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (fm) {
    body = body.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
      if (kv && kv[1].toLowerCase() === "description") description = kv[2].trim();
    }
  }
  body = body.trim();
  if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS);
  return { description, body };
}

/**
 * Expand a command body against the args the user typed after the name.
 * - body contains `$ARGUMENTS` (any number of times): every occurrence is
 *   replaced with the args (empty string if none were given).
 * - body has no `$ARGUMENTS` but args were given: args are appended on a
 *   new line, so typed context is never dropped.
 */
function expandCommandBody(body, args) {
  const a = String(args ?? "").trim();
  const b = String(body ?? "");
  if (b.includes("$ARGUMENTS")) return b.split("$ARGUMENTS").join(a).trim();
  return a ? `${b}\n${a}` : b;
}

/**
 * Scan the given source directories for `*.md` command files.
 * `sources` is an ordered array of `{ dir, source }` — FIRST source wins a
 * name clash (callers pass workspace before home, per the spec: a project
 * command overrides a same-named personal one). Name matching is
 * case-insensitive so `Fix.md` and `fix.md` can't both surface as separate,
 * ambiguous popover entries. Missing/unreadable dirs and files are skipped
 * silently — an empty result, never a throw.
 *
 * Returns [{ name, description, source, body }] sorted by name.
 */
function discoverCommands(sources) {
  const byName = new Map();
  for (const { dir, source } of sources ?? []) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue; // dir doesn't exist (the common case) or isn't readable
    }
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const name = f.slice(0, -3);
      if (!NAME_RE.test(name)) continue;
      const key = name.toLowerCase();
      if (byName.has(key)) continue; // earlier (higher-precedence) source already claimed it
      let content;
      try {
        content = fs.readFileSync(path.join(dir, f), "utf8");
      } catch {
        continue;
      }
      const { description, body } = parseCommandFile(content);
      if (!body) continue; // frontmatter-only / empty file — nothing to send
      byName.set(key, { name, description, source, body });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { parseCommandFile, expandCommandBody, discoverCommands, MAX_BODY_CHARS };
