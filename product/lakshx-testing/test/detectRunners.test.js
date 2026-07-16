// Unit tests for the pure runner-detection/notification-decision logic —
// the one piece of this extension's activation-time behavior that's
// testable without a real extension host. See extension.js's
// checkAndNotify() for how vscode.workspace.fs/vscode.extensions.all feed
// into this, and the final report's VERIFY section for why the live
// notification/settings behavior itself is inspection-only, not exercised
// end-to-end here.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RUNNERS, detectJsRunner, pytestConfigPresent, detectRunners, needsNotification } = require("../lib/detectRunners.js");

// ---------------------------------------------------------------------------
// detectJsRunner
// ---------------------------------------------------------------------------

test("detectJsRunner: finds jest in a script command", () => {
  const r = detectJsRunner({ test: "jest --coverage" });
  assert.equal(r, RUNNERS.jest);
});

test("detectJsRunner: finds vitest in a script command", () => {
  const r = detectJsRunner({ test: "vitest run" });
  assert.equal(r, RUNNERS.vitest);
});

test("detectJsRunner: jest takes precedence over generic when both signals present", () => {
  const r = detectJsRunner({ test: "jest", unit: "jest --watch" });
  assert.equal(r, RUNNERS.jest);
});

test("detectJsRunner: falls back to generic when only a plain 'test' script exists", () => {
  const r = detectJsRunner({ test: "node --test" });
  assert.equal(r, RUNNERS.jsGeneric);
});

test("detectJsRunner: generic entry carries no extensionId (no confident recommendation)", () => {
  assert.equal(RUNNERS.jsGeneric.extensionId, null);
});

test("detectJsRunner: null when scripts is missing/empty/not an object", () => {
  assert.equal(detectJsRunner(undefined), null);
  assert.equal(detectJsRunner(null), null);
  assert.equal(detectJsRunner({}), null);
  assert.equal(detectJsRunner("not an object"), null);
});

test("detectJsRunner: ignores non-string script values without throwing", () => {
  const r = detectJsRunner({ test: 123, build: null });
  // "test" key exists but its value isn't a string; hasOwnProperty("test") still makes this generic
  assert.equal(r, RUNNERS.jsGeneric);
});

test("detectJsRunner: does not false-positive on substrings (e.g. 'jestful', 'digest')", () => {
  const r = detectJsRunner({ lint: "run-jestful-thing", other: "digest-check" });
  assert.equal(r, null);
});

// ---------------------------------------------------------------------------
// pytestConfigPresent
// ---------------------------------------------------------------------------

test("pytestConfigPresent: true when pytest.ini exists", () => {
  assert.equal(pytestConfigPresent({ pytestIniExists: true }), true);
});

test("pytestConfigPresent: true when pyproject.toml has [tool.pytest.ini_options]", () => {
  const text = `[build-system]\nrequires = ["setuptools"]\n\n[tool.pytest.ini_options]\naddopts = "-ra"\n`;
  assert.equal(pytestConfigPresent({ pyprojectText: text }), true);
});

test("pytestConfigPresent: true when setup.cfg has [tool:pytest]", () => {
  assert.equal(pytestConfigPresent({ setupCfgText: "[tool:pytest]\ntestpaths = tests\n" }), true);
});

test("pytestConfigPresent: false when nothing matches", () => {
  assert.equal(pytestConfigPresent({ pyprojectText: "[tool.black]\nline-length = 88\n" }), false);
  assert.equal(pytestConfigPresent({}), false);
  assert.equal(pytestConfigPresent(), false);
});

// ---------------------------------------------------------------------------
// detectRunners
// ---------------------------------------------------------------------------

test("detectRunners: detects multiple ecosystems at once", () => {
  const detected = detectRunners({
    packageJsonScripts: { test: "jest" },
    pytestIniExists: true,
    cargoTomlExists: true,
    goModExists: true,
  });
  assert.deepEqual(
    detected.map((r) => r.id),
    ["jest", "pytest", "cargo", "go"],
  );
});

test("detectRunners: empty input detects nothing", () => {
  assert.deepEqual(detectRunners({}), []);
  assert.deepEqual(detectRunners(), []);
});

test("detectRunners: only the signals present are detected", () => {
  const detected = detectRunners({ cargoTomlExists: true });
  assert.deepEqual(
    detected.map((r) => r.id),
    ["cargo"],
  );
});

// ---------------------------------------------------------------------------
// needsNotification
// ---------------------------------------------------------------------------

test("needsNotification: recommends installing when extension is missing and not yet notified", () => {
  const detected = [RUNNERS.jest, RUNNERS.pytest];
  const result = needsNotification(detected, [], []);
  assert.deepEqual(
    result.map((r) => r.id),
    ["jest", "pytest"],
  );
});

test("needsNotification: skips runners whose extension is already installed", () => {
  const detected = [RUNNERS.jest, RUNNERS.pytest];
  const result = needsNotification(detected, ["orta.vscode-jest"], []);
  assert.deepEqual(
    result.map((r) => r.id),
    ["pytest"],
  );
});

test("needsNotification: installed-id match is case-insensitive", () => {
  const result = needsNotification([RUNNERS.go], ["GoLang.Go"], []);
  assert.deepEqual(result, []);
});

test("needsNotification: skips runners already notified before", () => {
  const detected = [RUNNERS.jest, RUNNERS.cargo];
  const result = needsNotification(detected, [], ["jest"]);
  assert.deepEqual(
    result.map((r) => r.id),
    ["cargo"],
  );
});

test("needsNotification: never recommends the generic JS entry (no extensionId)", () => {
  const result = needsNotification([RUNNERS.jsGeneric], [], []);
  assert.deepEqual(result, []);
});

test("needsNotification: empty when nothing detected", () => {
  assert.deepEqual(needsNotification([], [], []), []);
});
