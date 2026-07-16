// Pure detection/decision logic for LakshX Testing's "suggest the right test
// explorer extension" helper. Zero dependency on the `vscode` module so it's
// directly unit-testable with plain `node --test` — the same rationale
// product/lakshx-welcome's lib/shouldShowWelcome.js and product/lakshx-chat's
// commands.js/diagnostics.js use for their own pure-logic extraction.
//
// extension.js is the only caller that touches real filesystem/vscode APIs:
// it reads workspace files, builds the plain-object `input` this module
// expects, and separately asks `vscode.extensions.all` for what's installed.
// This module never does I/O and never talks to vscode.
"use strict";

// Known ecosystem -> recommended test explorer extension. These are the
// well-known, real Marketplace/Open VSX extension ids for each ecosystem's
// test explorer support (none of them ship inside VS Code itself — this
// extension does NOT bundle any of them, only detects + suggests). Kept as a
// small, explicit table rather than anything fetched/dynamic.
const RUNNERS = Object.freeze({
  jest: Object.freeze({ id: "jest", label: "Jest", extensionId: "orta.vscode-jest" }),
  vitest: Object.freeze({ id: "vitest", label: "Vitest", extensionId: "vitest.explorer" }),
  // A plain npm "test" script with no recognized framework keyword: we can
  // detect this, but there is no single confident extension recommendation
  // for an unknown runner (could be mocha/ava/tap/node --test/etc), so this
  // entry deliberately carries no extensionId. needsNotification() below
  // never recommends installing anything for it — it only participates in
  // detectRunners()'s output for callers that want to know it's there.
  jsGeneric: Object.freeze({ id: "js-generic", label: 'a JavaScript/Node "test" script', extensionId: null }),
  pytest: Object.freeze({ id: "pytest", label: "pytest", extensionId: "ms-python.python" }),
  cargo: Object.freeze({ id: "cargo", label: "Rust (Cargo)", extensionId: "rust-lang.rust-analyzer" }),
  go: Object.freeze({ id: "go", label: "Go", extensionId: "golang.go" }),
});

/**
 * @param {unknown} scripts - the `scripts` object from a package.json, or undefined.
 * @returns {object|null} one of RUNNERS.jest/vitest/jsGeneric, or null if no JS test runner signal found.
 */
function detectJsRunner(scripts) {
  if (!scripts || typeof scripts !== "object") return null;
  const values = Object.values(scripts)
    .filter((v) => typeof v === "string")
    .join(" \n ")
    .toLowerCase();
  if (/\bjest\b/.test(values)) return RUNNERS.jest;
  if (/\bvitest\b/.test(values)) return RUNNERS.vitest;
  if (Object.prototype.hasOwnProperty.call(scripts, "test")) return RUNNERS.jsGeneric;
  return null;
}

/**
 * @param {{pytestIniExists?: boolean, pyprojectText?: string, setupCfgText?: string}} input
 * @returns {boolean} true if a pytest config was found in any of the usual places.
 */
function pytestConfigPresent(input = {}) {
  if (input.pytestIniExists) return true;
  if (typeof input.pyprojectText === "string" && /\[tool\.pytest\.ini_options\]/.test(input.pyprojectText)) return true;
  if (typeof input.setupCfgText === "string" && /\[tool:pytest\]/.test(input.setupCfgText)) return true;
  return false;
}

/**
 * @param {{
 *   packageJsonScripts?: Record<string, unknown>,
 *   pytestIniExists?: boolean,
 *   pyprojectText?: string,
 *   setupCfgText?: string,
 *   cargoTomlExists?: boolean,
 *   goModExists?: boolean,
 * }} input
 * @returns {object[]} the RUNNERS entries detected in this workspace, in a stable order.
 */
function detectRunners(input = {}) {
  const detected = [];
  const js = detectJsRunner(input.packageJsonScripts);
  if (js) detected.push(js);
  if (pytestConfigPresent(input)) detected.push(RUNNERS.pytest);
  if (input.cargoTomlExists) detected.push(RUNNERS.cargo);
  if (input.goModExists) detected.push(RUNNERS.go);
  return detected;
}

/**
 * Which detected runners should trigger a (one-time) notification: has a
 * recommended extension, that extension isn't already installed, and we
 * haven't already notified about this runner id before.
 *
 * @param {object[]} detected - output of detectRunners().
 * @param {string[]} installedExtensionIds - e.g. vscode.extensions.all.map(e => e.id).
 * @param {string[]} alreadyNotifiedIds - runner ids previously notified (persisted in workspaceState).
 * @returns {object[]} the subset of `detected` worth notifying about now.
 */
function needsNotification(detected, installedExtensionIds, alreadyNotifiedIds) {
  const installed = new Set((installedExtensionIds || []).map((id) => String(id).toLowerCase()));
  const notified = new Set(alreadyNotifiedIds || []);
  return (detected || []).filter((r) => r.extensionId && !installed.has(r.extensionId.toLowerCase()) && !notified.has(r.id));
}

module.exports = { RUNNERS, detectJsRunner, pytestConfigPresent, detectRunners, needsNotification };
