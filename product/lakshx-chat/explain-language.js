// Regional-language / Hinglish explain toggle (docs/research/16-ide-feature-
// roadmap-round2.md, "Differentiation for the Indian/global vibecoder
// audience"): the `lakshx.explainLanguage` setting's value space, labels for
// the settings-panel dropdown, and normalization. Extracted into its own
// zero-vscode-dependency module — same rationale as commands.js/diagnostics.js
// — so it's directly unit-testable with plain `node --test` (see
// test/explain-language.test.js) instead of only exercisable inside a running
// extension host. extension.js requires this for both the live wire value
// (pushExplainLanguage) and the labels sent to the webview for the dropdown;
// the agent side keeps its own mirror of the same small value set in
// agent/src/loop.ts's `normalizeExplainLanguage` (the two ends of one wire
// naturally validate independently, same as this codebase's AgentMode ids).
"use strict";

/** id → dropdown label. "english" first/default, per docs/research/16's "keep the initial set SMALL" guidance. */
const EXPLAIN_LANGUAGES = {
  english: "English (default)",
  hinglish: "Hinglish — Hindi + English, code-mixed",
  tanglish: "Tanglish — Tamil + English, code-mixed",
  benglish: "Benglish — Bengali + English, code-mixed",
};

/** Coerce anything (a raw `lakshx.explainLanguage` config read, a webview postMessage value) to a known key, defaulting to "english" for anything unrecognized — never throws on a stale/manually-edited settings.json value. */
function normalizeExplainLanguage(value) {
  return Object.prototype.hasOwnProperty.call(EXPLAIN_LANGUAGES, value) ? value : "english";
}

module.exports = { EXPLAIN_LANGUAGES, normalizeExplainLanguage };
