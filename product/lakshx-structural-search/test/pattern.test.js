"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { tokenize, compilePattern, findMatches, searchFiles, substitute } = require("../lib/pattern.js");

// Small helper: match + flatten captures to plain strings for easy asserting.
function matchTexts(src, pattern) {
  return findMatches(src, pattern).map((m) => m.text);
}
function matchCaptures(src, pattern) {
  return findMatches(src, pattern).map((m) => {
    const out = {};
    for (const [k, v] of Object.entries(m.captures)) out[k] = v.text;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Tokenizer basics
// ---------------------------------------------------------------------------

test("tokenize: identifiers, punct, strings, numbers, comments stripped", () => {
  const toks = tokenize("foo(1, 'a', \"b\") // trailing\n/* block */ bar");
  const kinds = toks.map((t) => `${t.type}:${t.text}`);
  assert.deepEqual(kinds, [
    "ident:foo", "punct:(", "number:1", "punct:,", "string:'a'", "punct:,",
    "string:\"b\"", "punct:)", "ident:bar",
  ]);
});

test("tokenize: pattern mode recognizes $Name and $$Name; source mode does not", () => {
  const patToks = tokenize("$FN($$ARGS)", { allowPlaceholders: true });
  assert.deepEqual(patToks.map((t) => t.type), ["placeholder", "punct", "placeholder-variadic", "punct"]);

  // `$foo` is a legal real JS identifier (jQuery-style) — source tokenizing
  // must NOT treat it as a placeholder.
  const srcToks = tokenize("$foo(1)", { allowPlaceholders: false });
  assert.equal(srcToks[0].type, "ident");
  assert.equal(srcToks[0].text, "$foo");
});

test("tokenize: regex-vs-division heuristic", () => {
  const a = tokenize("return /abc/.test(x);");
  assert.equal(a.find((t) => t.type === "regex").text, "/abc/");
  const b = tokenize("a / b / c;");
  assert.ok(b.filter((t) => t.type === "regex").length === 0);
  assert.ok(b.filter((t) => t.type === "punct" && t.text === "/").length === 2);
});

// ---------------------------------------------------------------------------
// 1. Simple call-shape matches
// ---------------------------------------------------------------------------

test("simple call-shape: exact literal call matches only that call", () => {
  const src = "foo(1); bar(1); foo(2);";
  assert.deepEqual(matchTexts(src, "foo(1)"), ["foo(1)"]);
});

test("simple call-shape: $FN($$ARGS) matches any call regardless of callee name", () => {
  const src = "alpha(1); beta(2, 3); gamma();";
  const caps = matchCaptures(src, "$FN($$ARGS)");
  assert.deepEqual(caps, [
    { FN: "alpha", ARGS: "1" },
    { FN: "beta", ARGS: "2, 3" },
    { FN: "gamma", ARGS: "" },
  ]);
});

test("method call shape: $OBJ.$METHOD($$ARGS)", () => {
  const src = "req.log('hi'); res.send();";
  const caps = matchCaptures(src, "$OBJ.$METHOD($$ARGS)");
  assert.deepEqual(caps, [
    { OBJ: "req", METHOD: "log", ARGS: "'hi'" },
    { OBJ: "res", METHOD: "send", ARGS: "" },
  ]);
});

// ---------------------------------------------------------------------------
// 2. Argument-count-agnostic matches
// ---------------------------------------------------------------------------

test("argument-count-agnostic: $$ARGS matches 0, 1, and many args", () => {
  const src = "f(); f(1); f(1, 2, 3, 4);";
  const caps = matchCaptures(src, "f($$ARGS)").map((c) => c.ARGS);
  assert.deepEqual(caps, ["", "1", "1, 2, 3, 4"]);
});

test("single (non-variadic) placeholder requires exactly one argument slot", () => {
  const src = "log(1); log(1, 2); log();";
  // log($X) should match ONLY the exactly-one-argument call.
  assert.deepEqual(matchTexts(src, "log($X)"), ["log(1)"]);
});

// ---------------------------------------------------------------------------
// 3. Whitespace / quote-style normalization
// ---------------------------------------------------------------------------

test("whitespace normalization: arbitrary spacing/newlines/tabs don't affect matching", () => {
  const src = "foo(\n  1,\t2 ,\n3\n);";
  assert.deepEqual(matchTexts(src, "foo($$ARGS)"), ["foo(\n  1,\t2 ,\n3\n)"]);
  assert.deepEqual(matchTexts(src, "foo(   $$ARGS   )"), matchTexts(src, "foo($$ARGS)"));
});

test("quote-style normalization: pattern with single quotes matches double-quoted source and vice versa", () => {
  const src = "t('a'); t(\"a\"); t('b');";
  assert.deepEqual(matchTexts(src, "t('a')"), ["t('a')", "t(\"a\")"]);
});

test("quote-style normalization also applies inside placeholder back-references", () => {
  const src = "eq('x', 'x'); eq('x', \"x\"); eq('x', 'y');";
  // $A used twice must capture equal VALUES, regardless of quote character.
  const caps = matchCaptures(src, "eq($A, $A)");
  assert.deepEqual(caps, [{ A: "'x'" }, { A: "'x'" }]);
});

// ---------------------------------------------------------------------------
// 4. Multi-placeholder capture-and-substitute round trips
// ---------------------------------------------------------------------------

test("substitute: round-trips a single placeholder", () => {
  const [m] = findMatches("risky();", "$FN($$ARGS)");
  assert.equal(substitute("await $FN($ARGS)", m.captures), "await risky()");
});

test("substitute: round-trips multiple distinct placeholders in a template", () => {
  const [m] = findMatches("assert.equal(got, want);", "assert.equal($A, $B)");
  assert.equal(substitute("assert.strictEqual($A, $B)", m.captures), "assert.strictEqual(got, want)");
  // swapped order in the replacement is honored too (proves substitution is
  // driven by name, not positional order)
  assert.equal(substitute("assert.strictEqual($B, $A)", m.captures), "assert.strictEqual(want, got)");
});

test("substitute: an unknown placeholder name in the template is left literally", () => {
  const [m] = findMatches("f(1);", "f($$ARGS)");
  assert.equal(substitute("g($ARGS, $NOPE)", m.captures), "g(1, $NOPE)");
});

test("end-to-end search+replace across multiple files (searchFiles + substitute)", () => {
  const files = [
    { path: "a.js", text: "db.query(sql); other();" },
    { path: "b.js", text: "db.query(sql, cb);" },
  ];
  const { matches } = searchFiles(files, "db.query($$ARGS)");
  assert.equal(matches.length, 2);
  const rewritten = matches.map((m) => ({ path: m.path, before: m.text, after: substitute("await db.query($ARGS)", m.captures) }));
  assert.deepEqual(rewritten, [
    { path: "a.js", before: "db.query(sql)", after: "await db.query(sql)" },
    { path: "b.js", before: "db.query(sql, cb)", after: "await db.query(sql, cb)" },
  ]);
});

// ---------------------------------------------------------------------------
// 5. Deliberately tricky cases
// ---------------------------------------------------------------------------

test("tricky: nested calls inside a variadic capture are treated as one unit, not split on their inner commas", () => {
  const src = "outer(inner(1, 2), other(3, 4, 5));";
  const caps = matchCaptures(src, "$FN($$ARGS)");
  assert.deepEqual(caps, [{ FN: "outer", ARGS: "inner(1, 2), other(3, 4, 5)" }]);
});

test("tricky: nested call as a single-slot argument is captured whole, not just its first token", () => {
  const src = "log(compute(a, b));";
  const caps = matchCaptures(src, "log($X)");
  assert.deepEqual(caps, [{ X: "compute(a, b)" }]);
});

test("tricky: repeated placeholder name requires consistent capture (back-reference)", () => {
  const src = "if (a === a) {} if (a === b) {} if (fn(1) === fn(1)) {} if (fn(1) === fn(2)) {}";
  const caps = matchCaptures(src, "$X === $X");
  assert.deepEqual(caps, [{ X: "a" }, { X: "fn(1)" }]);
});

test("tricky: deeply nested + repeated placeholder together", () => {
  const src = "assertEqual(wrap(f(x)), wrap(f(x))); assertEqual(wrap(f(x)), wrap(f(y)));";
  const caps = matchCaptures(src, "assertEqual($X, $X)");
  assert.deepEqual(caps, [{ X: "wrap(f(x))" }]);
});

// ---------------------------------------------------------------------------
// Bounds / non-overlap / degenerate patterns
// ---------------------------------------------------------------------------

test("matches don't overlap: scanning resumes after the previous match end", () => {
  const src = "foo(1); foo(2); foo(3);";
  assert.equal(matchTexts(src, "foo($X)").length, 3);
});

test("a bare single placeholder pattern doesn't run away to end-of-file", () => {
  // No enclosing bracket/next literal to bound it -> falls back to "one token,
  // or one balanced group if it opens a bracket" per README/design comments.
  // A bare `$X` is a degenerate pattern (matches literally any single token,
  // one match per token, including operators/punctuation) — worth pinning so
  // the fallback rule's actual behavior doesn't silently drift.
  const src = "a + b;";
  const texts = matchTexts(src, "$X");
  assert.deepEqual(texts, ["a", "+", "b", ";"]);
});

test("a bare single placeholder captures a whole balanced group when it opens a bracket", () => {
  // First token ("call") has no bracket to open, so it's its own 1-token
  // match; scanning then resumes at "(" itself, which DOES open a bracket,
  // so that match is the whole balanced "(a, b)" group, not just "(".
  const src = "call(a, b);";
  const texts = matchTexts(src, "$X");
  assert.deepEqual(texts, ["call", "(a, b)", ";"]);
});

test("scanning across a statement boundary (;) never bleeds into an unrelated call's callee", () => {
  // Regression: an earlier version of extentOf let $FN swallow the trailing
  // `;` of the PREVIOUS statement before hitting its own `(`.
  const src = "foo(1, 2, 3); bar();";
  const caps = matchCaptures(src, "$FN($$ARGS)");
  assert.deepEqual(caps, [{ FN: "foo", ARGS: "1, 2, 3" }, { FN: "bar", ARGS: "" }]);
});

test("searchFiles reports truncation honestly when maxMatches is hit", () => {
  const files = [{ path: "a.js", text: "f(1); f(2); f(3);" }];
  const { matches, truncated } = searchFiles(files, "f($X)", { maxMatches: 2 });
  assert.equal(matches.length, 2);
  assert.equal(truncated, true);
});

// ---------------------------------------------------------------------------
// Known limitations, pinned as tests so they can't silently "fix themselves"
// into an overclaim without a test update (see README "Known limitations").
// ---------------------------------------------------------------------------

test("KNOWN LIMITATION: argument order is positional, not semantically commutative", () => {
  // foo($A, $B) does NOT recognize foo(y, x) as an order-swapped equivalent of
  // foo(x, y) -- it just captures A=y, B=x positionally. There is no check
  // here that it's "equal to the reordered pattern"; that's exactly the gap.
  const caps = matchCaptures("foo(y, x);", "foo($A, $B)");
  assert.deepEqual(caps, [{ A: "y", B: "x" }]); // matches structurally, but not "same call, reordered"
});

test("KNOWN LIMITATION: no alpha-equivalence / variable-renaming awareness", () => {
  // A literal (non-placeholder) identifier in the pattern must match that
  // exact text. `function foo(x){ return x+1 }` and the y-renamed version are
  // structurally identical modulo renaming, but this matcher can't see that
  // without the caller expressing every occurrence as the SAME placeholder.
  const src = "function foo(y){ return y+1; }";
  assert.deepEqual(matchTexts(src, "function foo(x){ return x+1; }"), []);
});

test("KNOWN LIMITATION: no control-flow / semantic equivalence (De Morgan, ternary vs if/else)", () => {
  const src = "if (!a) { y(); } else { x(); }";
  // Semantically equivalent to `if (a) { x(); } else { y(); }` but the token
  // matcher has no notion of boolean equivalence.
  assert.deepEqual(matchTexts(src, "if (a) { x(); } else { y(); }"), []);
});
