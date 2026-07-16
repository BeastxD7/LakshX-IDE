// Unit tests for the custom slash-command module (commands.js): frontmatter
// parsing, $ARGUMENTS templating, and directory discovery with
// workspace-over-home precedence. Pure node --test, no vscode host needed —
// same extraction pattern as diagnostics.js/diagnostics.test.js.
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseCommandFile, expandCommandBody, discoverCommands, MAX_BODY_CHARS } = require("../commands.js");

// ---------- parseCommandFile ----------

test("frontmatter description is extracted and stripped from the body", () => {
  const { description, body } = parseCommandFile("---\ndescription: Fix a GitHub issue\n---\nFix issue $ARGUMENTS following our conventions");
  assert.equal(description, "Fix a GitHub issue");
  assert.equal(body, "Fix issue $ARGUMENTS following our conventions");
});

test("no frontmatter: whole file is the body, empty description", () => {
  const { description, body } = parseCommandFile("Just do the thing.\nSecond line.");
  assert.equal(description, "");
  assert.equal(body, "Just do the thing.\nSecond line.");
});

test("unknown frontmatter keys are ignored; CRLF tolerated", () => {
  const { description, body } = parseCommandFile("---\r\nauthor: someone\r\ndescription: Desc here\r\n---\r\nBody");
  assert.equal(description, "Desc here");
  assert.equal(body, "Body");
});

test("a '---' later in the body is not treated as frontmatter", () => {
  const { description, body } = parseCommandFile("Intro\n---\nnot: frontmatter\n---\nrest");
  assert.equal(description, "");
  assert.equal(body, "Intro\n---\nnot: frontmatter\n---\nrest");
});

test("oversized body is clipped to MAX_BODY_CHARS", () => {
  const { body } = parseCommandFile("x".repeat(MAX_BODY_CHARS + 5000));
  assert.equal(body.length, MAX_BODY_CHARS);
});

// ---------- expandCommandBody ----------

test("$ARGUMENTS is replaced with the typed args (every occurrence)", () => {
  assert.equal(expandCommandBody("Fix issue $ARGUMENTS per $ARGUMENTS", "123"), "Fix issue 123 per 123");
});

test("$ARGUMENTS with no args expands to empty (and trims)", () => {
  assert.equal(expandCommandBody("Fix issue $ARGUMENTS", ""), "Fix issue");
});

test("no $ARGUMENTS but args given: appended on a new line", () => {
  assert.equal(expandCommandBody("Run the standup checklist.", "focus on CI"), "Run the standup checklist.\nfocus on CI");
});

test("no $ARGUMENTS, no args: body unchanged", () => {
  assert.equal(expandCommandBody("Run the standup checklist.", ""), "Run the standup checklist.");
});

// ---------- discoverCommands ----------

function tmpCommandsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakshx-cmd-test-"));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test("discovers .md files; name = filename without extension; sorted", () => {
  const dir = tmpCommandsDir({
    "zeta.md": "z body",
    "alpha.md": "---\ndescription: A thing\n---\na body",
    "notes.txt": "ignored — not markdown",
  });
  const cmds = discoverCommands([{ dir, source: "workspace" }]);
  assert.deepEqual(cmds.map((c) => c.name), ["alpha", "zeta"]);
  assert.equal(cmds[0].description, "A thing");
  assert.equal(cmds[0].body, "a body");
  assert.equal(cmds[0].source, "workspace");
});

test("workspace wins a name clash over user (first source in the list wins)", () => {
  const ws = tmpCommandsDir({ "deploy.md": "workspace version" });
  const home = tmpCommandsDir({ "deploy.md": "home version", "only-home.md": "home only" });
  const cmds = discoverCommands([
    { dir: ws, source: "workspace" },
    { dir: home, source: "user" },
  ]);
  const deploy = cmds.find((c) => c.name === "deploy");
  assert.equal(deploy.body, "workspace version");
  assert.equal(deploy.source, "workspace");
  assert.ok(cmds.find((c) => c.name === "only-home"));
});

test("name clash is case-insensitive", () => {
  const ws = tmpCommandsDir({ "Deploy.md": "workspace version" });
  const home = tmpCommandsDir({ "deploy.md": "home version" });
  const cmds = discoverCommands([
    { dir: ws, source: "workspace" },
    { dir: home, source: "user" },
  ]);
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].body, "workspace version");
});

test("missing directories are skipped silently; empty/invalid files dropped", () => {
  const dir = tmpCommandsDir({
    "empty.md": "",
    "frontmatter-only.md": "---\ndescription: nothing to send\n---\n",
    "has space.md": "untypeable as /token — skipped",
    "good.md": "ok",
  });
  const cmds = discoverCommands([
    { dir: path.join(dir, "does-not-exist"), source: "workspace" },
    { dir, source: "user" },
  ]);
  assert.deepEqual(cmds.map((c) => c.name), ["good"]);
});
