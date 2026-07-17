// Unit tests for explain-language.js: the `lakshx.explainLanguage` value
// space (labels for the settings dropdown) and normalization. Pure node
// --test, no vscode host needed — same extraction pattern as
// commands.js/diagnostics.js.
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EXPLAIN_LANGUAGES, normalizeExplainLanguage } = require("../explain-language.js");

test("EXPLAIN_LANGUAGES keeps the initial set small: English default + exactly 3 code-mixed options", () => {
  const keys = Object.keys(EXPLAIN_LANGUAGES);
  assert.equal(keys.length, 4);
  assert.deepEqual(keys, ["english", "hinglish", "tanglish", "benglish"]);
});

test("EXPLAIN_LANGUAGES: every value is a non-empty label", () => {
  for (const [id, label] of Object.entries(EXPLAIN_LANGUAGES)) {
    assert.ok(typeof label === "string" && label.length > 0, `${id} has no label`);
  }
});

test("normalizeExplainLanguage: passes every known key through unchanged", () => {
  for (const id of Object.keys(EXPLAIN_LANGUAGES)) {
    assert.equal(normalizeExplainLanguage(id), id);
  }
});

test("normalizeExplainLanguage: falls back to \"english\" for unknown/missing/malformed values", () => {
  assert.equal(normalizeExplainLanguage("french"), "english");
  assert.equal(normalizeExplainLanguage(undefined), "english");
  assert.equal(normalizeExplainLanguage(null), "english");
  assert.equal(normalizeExplainLanguage(""), "english");
  assert.equal(normalizeExplainLanguage(42), "english");
  assert.equal(normalizeExplainLanguage({}), "english");
  // must not be fooled by inherited Object.prototype properties
  assert.equal(normalizeExplainLanguage("toString"), "english");
  assert.equal(normalizeExplainLanguage("hasOwnProperty"), "english");
});
