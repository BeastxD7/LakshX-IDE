// Unit tests for crash-context.js — the "Explain this crash" pure
// prompt-assembly module (docs/research/15-ide-feature-roadmap.md item #8).
// This is the one part of the feature that's actually exercisable outside a
// running Extension Host: given a mock DAP exceptionInfo/stackTrace result
// plus a pre-read file excerpt, it must produce an exact, deterministic
// prompt block. The real DAP integration (extension.js's tracker actually
// firing during a live debug session) is NOT covered here — see the PR
// report for what remains inspection-only.
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  normalizeFrames,
  formatStackFrames,
  buildCodeExcerpt,
  buildCrashDisplayText,
  buildExceptionPromptBlock,
  buildCrashContext,
  MAX_CRASH_FRAMES,
} = require("../crash-context.js");

// ---------------- buildCrashDisplayText ----------------

test("buildCrashDisplayText includes the exception type when known", () => {
  assert.equal(buildCrashDisplayText("TypeError"), "Explain this crash: TypeError");
});

test("buildCrashDisplayText falls back to a plain label with no colon when typeName is missing", () => {
  assert.equal(buildCrashDisplayText(undefined), "Explain this crash");
  assert.equal(buildCrashDisplayText(""), "Explain this crash");
});

// ---------------- normalizeFrames ----------------

test("normalizeFrames extracts name/path/line and tolerates missing source/fields", () => {
  const out = normalizeFrames([
    { name: "foo", source: { path: "/repo/src/bar.js" }, line: 42, column: 3 },
    { name: "baz" }, // no source at all
    { source: { path: "/repo/x.js" }, line: 5 }, // no name
    null, // garbage entry
  ]);
  assert.deepEqual(out, [
    { name: "foo", path: "/repo/src/bar.js", line: 42 },
    { name: "baz", path: undefined, line: undefined },
    { name: undefined, path: "/repo/x.js", line: 5 },
    { name: undefined, path: undefined, line: undefined },
  ]);
});

test("normalizeFrames returns [] for non-array input rather than throwing", () => {
  assert.deepEqual(normalizeFrames(undefined), []);
  assert.deepEqual(normalizeFrames(null), []);
  assert.deepEqual(normalizeFrames("not an array"), []);
});

// ---------------- formatStackFrames ----------------

test("formatStackFrames renders each frame as 'at name (path:line)'", () => {
  const frames = normalizeFrames([
    { name: "foo", source: { path: "src/bar.js" }, line: 42 },
    { name: "baz", source: { path: "src/qux.js" }, line: 10 },
  ]);
  assert.equal(formatStackFrames(frames), "  at foo (src/bar.js:42)\n  at baz (src/qux.js:10)");
});

test("formatStackFrames says '(no stack trace available)' for an empty/missing trace", () => {
  assert.equal(formatStackFrames([]), "(no stack trace available)");
  assert.equal(formatStackFrames(undefined), "(no stack trace available)");
});

test("formatStackFrames degrades a frame with no name/path to placeholders", () => {
  const frames = normalizeFrames([{}]);
  assert.equal(formatStackFrames(frames), "  at (anonymous) (unknown location)");
});

test("formatStackFrames caps at maxFrames and notes how many were omitted", () => {
  const frames = normalizeFrames(
    Array.from({ length: MAX_CRASH_FRAMES + 5 }, (_, i) => ({ name: `f${i}`, source: { path: "a.js" }, line: i })),
  );
  const out = formatStackFrames(frames, MAX_CRASH_FRAMES);
  const lines = out.split("\n");
  assert.equal(lines.length, MAX_CRASH_FRAMES + 1); // + the "omitted" note
  assert.equal(lines[lines.length - 1], "  … 5 more frame(s) omitted");
});

// ---------------- buildCodeExcerpt ----------------

function makeFile(nLines) {
  return Array.from({ length: nLines }, (_, i) => `line${i + 1}`).join("\n");
}

test("buildCodeExcerpt centers on the crash line with a '>' marker and caps context lines", () => {
  const text = makeFile(20);
  const out = buildCodeExcerpt(text, 10, 2);
  assert.equal(
    out,
    [
      "      8 | line8",
      "      9 | line9",
      ">    10 | line10",
      "     11 | line11",
      "     12 | line12",
    ].join("\n"),
  );
});

test("buildCodeExcerpt clamps the window at file start/end", () => {
  const text = makeFile(5);
  const out = buildCodeExcerpt(text, 1, 3);
  assert.equal(out, [">     1 | line1", "      2 | line2", "      3 | line3", "      4 | line4"].join("\n"));
});

test("buildCodeExcerpt returns null for unusable input instead of throwing", () => {
  assert.equal(buildCodeExcerpt("", 1), null);
  assert.equal(buildCodeExcerpt(null, 1), null);
  assert.equal(buildCodeExcerpt("a\nb", 0), null); // line numbers are 1-based
  assert.equal(buildCodeExcerpt("a\nb", -1), null);
  assert.equal(buildCodeExcerpt("a\nb", 1.5), null);
});

test("buildCodeExcerpt truncates an oversized excerpt at MAX_EXCERPT_CHARS", () => {
  const text = Array.from({ length: 5000 }, (_, i) => `a very long line number ${i}`).join("\n");
  const out = buildCodeExcerpt(text, 2500, 2000); // huge window, forces the char cap
  assert.ok(out.length < text.length);
  assert.match(out, /… \(truncated\)$/);
});

// ---------------- buildExceptionPromptBlock (the exact-text contract) ----------------

test("buildExceptionPromptBlock produces the exact wrapped prompt text for a full mock crash", () => {
  const frames = normalizeFrames([
    { name: "foo", source: { path: "src/bar.js" }, line: 42 },
    { name: "baz", source: { path: "src/qux.js" }, line: 10 },
  ]);
  const excerpt = buildCodeExcerpt(makeFile(50), 42, 2);
  const block = buildExceptionPromptBlock({
    typeName: "TypeError",
    message: "Cannot read properties of undefined (reading 'foo')",
    description: "Uncaught TypeError",
    breakMode: "unhandled",
    frames,
    excerpt,
    excerptPath: "src/bar.js",
    excerptLine: 42,
  });

  const expected = [
    '<exception type="TypeError" breakMode="unhandled">',
    "Cannot read properties of undefined (reading 'foo')",
    "",
    "Stack trace:",
    "  at foo (src/bar.js:42)",
    "  at baz (src/qux.js:10)",
    "",
    "Code around src/bar.js:42:",
    "```",
    "     40 | line40",
    "     41 | line41",
    ">    42 | line42",
    "     43 | line43",
    "     44 | line44",
    "```",
    "</exception>",
  ].join("\n");

  assert.equal(block, expected);
});

test("buildExceptionPromptBlock falls back to placeholders with a minimal/empty input", () => {
  const block = buildExceptionPromptBlock({});
  assert.equal(
    block,
    ["<exception>", "(no exception description available)", "", "Stack trace:", "(no stack trace available)", "</exception>"].join(
      "\n",
    ),
  );
});

test("buildExceptionPromptBlock omits the code-excerpt section entirely when there is no excerpt", () => {
  const block = buildExceptionPromptBlock({ typeName: "Error", message: "boom", frames: [] });
  assert.doesNotMatch(block, /Code around/);
  assert.doesNotMatch(block, /```/);
});

test("buildExceptionPromptBlock escapes quotes/angle-brackets in attribute values", () => {
  const block = buildExceptionPromptBlock({ typeName: 'Weird"<Type>' });
  assert.match(block, /type="Weird&quot;&lt;Type&gt;"/);
});

// ---------------- buildCrashContext (the extension.js-facing entry point) ----------------

test("buildCrashContext assembles displayText + promptBlock from raw exceptionInfo/stackTrace-shaped input, including the excerpt", () => {
  const exceptionInfo = {
    description: "Uncaught TypeError",
    breakMode: "unhandled",
    details: { typeName: "TypeError", message: "Cannot read properties of undefined (reading 'foo')" },
  };
  const stackFrames = [
    { name: "foo", source: { path: "src/bar.js" }, line: 42, column: 3 },
    { name: "baz", source: { path: "src/qux.js" }, line: 10 },
  ];
  const excerptText = makeFile(50);

  const { displayText, promptBlock } = buildCrashContext({
    exceptionInfo,
    stackFrames,
    excerptText,
    excerptContextLines: 2,
  });

  assert.equal(displayText, "Explain this crash: TypeError");
  assert.match(promptBlock, /^<exception type="TypeError" breakMode="unhandled">/);
  assert.match(promptBlock, /Cannot read properties of undefined \(reading 'foo'\)/);
  assert.match(promptBlock, /at foo \(src\/bar\.js:42\)/);
  assert.match(promptBlock, /Code around src\/bar\.js:42:/);
  assert.match(promptBlock, />    42 \| line42/);
  assert.match(promptBlock, /<\/exception>$/);
});

test("buildCrashContext with no excerptText (e.g. top frame outside the workspace) omits the excerpt but keeps everything else", () => {
  const { displayText, promptBlock } = buildCrashContext({
    exceptionInfo: { details: { typeName: "RangeError", message: "bad index" } },
    stackFrames: [{ name: "f", source: { path: "/outside/lib.js" }, line: 3 }],
    excerptText: null,
  });
  assert.equal(displayText, "Explain this crash: RangeError");
  assert.match(promptBlock, /bad index/);
  assert.doesNotMatch(promptBlock, /Code around/);
});

test("buildCrashContext degrades to placeholders when both DAP requests failed (null exceptionInfo/stackFrames)", () => {
  const { displayText, promptBlock } = buildCrashContext({ exceptionInfo: null, stackFrames: null, excerptText: null });
  assert.equal(displayText, "Explain this crash");
  assert.match(promptBlock, /\(no exception description available\)/);
  assert.match(promptBlock, /\(no stack trace available\)/);
});
