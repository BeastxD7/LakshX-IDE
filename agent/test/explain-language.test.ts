/**
 * Regional-language / Hinglish explain toggle (docs/research/16 round 2,
 * "Differentiation for the Indian/global vibecoder audience"): a
 * near-zero-complexity system-prompt block, opt-in via
 * `lakshx.explainLanguage` (default "english" = no-op).
 *
 * This file is a code-correctness regression guard only:
 *  - the "english"/unset path produces BYTE-IDENTICAL output to what
 *    `systemPrompt()` produced before this feature existed (asserted here by
 *    the default parameter and the omitted-vs-explicit-"english" equality —
 *    the real guard against a future edit accidentally making the default
 *    non-trivial),
 *  - each supported non-"english" value adds exactly one well-formed block
 *    that names the code/identifiers-stay-English carve-out,
 *  - `normalizeExplainLanguage` fails safe to "english" for any value off
 *    the wire it doesn't recognize.
 *
 * What this file deliberately does NOT and CANNOT test: whether a live model
 * actually follows the register-shift instruction. That's a prompt-following
 * behavioral question that needs a real LLM call to observe, not something a
 * unit test over prompt-assembly code can prove either way.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeExplainLanguage, systemPrompt } from "../src/loop.js";

async function withTmpCwd<T>(fn: (cwd: string) => Promise<T> | T): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "lakshx-explain-lang-"));
  try {
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// ---------- byte-identical-when-english regression guard ----------

test("systemPrompt: omitting explainLanguage is byte-identical to passing \"english\" explicitly", async () => {
  await withTmpCwd((cwd) => {
    const omitted = systemPrompt(cwd, "auto");
    const explicit = systemPrompt(cwd, "auto", "english");
    assert.equal(omitted, explicit);
  });
});

test("systemPrompt: \"english\" output never mentions the explain-language block, across every mode", async () => {
  await withTmpCwd((cwd) => {
    for (const mode of ["review", "approve", "auto", "royal"] as const) {
      const prompt = systemPrompt(cwd, mode, "english");
      assert.ok(!prompt.includes("Explain-language preference"), `mode ${mode} leaked the explain-language block into the english/default path`);
    }
  });
});

test("systemPrompt: \"english\" output has no stray blank block at the seam (empty-string-join regression)", async () => {
  // Guards against a future refactor of systemPrompt() that pushes an EMPTY
  // string for the english case (e.g. `stableParts.push(lang === "english" ?
  // "" : explainLanguageBlock(lang))`) instead of conditionally not pushing
  // at all. That bug would still pass the two tests above (an empty string
  // contains neither "Explain-language preference" nor anything else) but
  // would corrupt the ANTI_INJECTION/rules-env seam with a quadruple newline
  // where a correct join always has exactly a double newline. Only reliable
  // in a controlled, empty tmpdir outside any git repo (as `withTmpCwd`
  // gives us) — a real CLAUDE.md with blank lines could legitimately contain
  // "\n\n\n\n" and would make this assertion meaningless there.
  await withTmpCwd((cwd) => {
    const prompt = systemPrompt(cwd, "auto", "english");
    assert.ok(!prompt.includes("\n\n\n\n"), "english path introduced a stray blank block at a join seam");
  });
});

test("systemPrompt: an undefined session.explainLanguage (a session that never had it pushed) behaves like \"english\"", async () => {
  await withTmpCwd((cwd) => {
    const withUndefined = systemPrompt(cwd, "review", undefined as unknown as "english");
    const withEnglish = systemPrompt(cwd, "review", "english");
    assert.equal(withUndefined, withEnglish);
  });
});

// ---------- non-english blocks are well-formed ----------

for (const lang of ["hinglish", "tanglish", "benglish"] as const) {
  test(`systemPrompt: "${lang}" adds a well-formed block with the code/identifiers-stay-English carve-out`, async () => {
    await withTmpCwd((cwd) => {
      const english = systemPrompt(cwd, "auto", "english");
      const withLang = systemPrompt(cwd, "auto", lang);

      assert.notEqual(withLang, english);
      assert.ok(withLang.includes("Explain-language preference"), "missing the explain-language block header");
      assert.ok(withLang.includes(lang), "block doesn't name the chosen language");
      // The precise, load-bearing instruction: prose shifts register, code/
      // commands/paths/identifiers never do.
      assert.ok(
        withLang.includes("fenced code blocks") && withLang.includes("terminal/shell commands") && withLang.includes("file paths"),
        "block is missing the explicit list of things that must stay English",
      );
      assert.ok(withLang.includes("stays exactly as it would in English, unchanged"), "block doesn't state the identifiers/code carve-out plainly");

      // Everything ELSE about the prompt is untouched — identity block still present verbatim.
      assert.ok(withLang.includes("You are LakshX, the agent inside the LakshX IDE"));
      assert.ok(english.includes("You are LakshX, the agent inside the LakshX IDE"));
    });
  });
}

test("systemPrompt: the three supported languages each produce a distinct block", async () => {
  await withTmpCwd((cwd) => {
    const hinglish = systemPrompt(cwd, "auto", "hinglish");
    const tanglish = systemPrompt(cwd, "auto", "tanglish");
    const benglish = systemPrompt(cwd, "auto", "benglish");
    assert.notEqual(hinglish, tanglish);
    assert.notEqual(hinglish, benglish);
    assert.notEqual(tanglish, benglish);
  });
});

// ---------- normalizeExplainLanguage ----------

test("normalizeExplainLanguage: passes through every known value", () => {
  for (const lang of ["english", "hinglish", "tanglish", "benglish"] as const) {
    assert.equal(normalizeExplainLanguage(lang), lang);
  }
});

test("normalizeExplainLanguage: falls back to \"english\" for anything unrecognized", () => {
  assert.equal(normalizeExplainLanguage("french"), "english");
  assert.equal(normalizeExplainLanguage(undefined), "english");
  assert.equal(normalizeExplainLanguage(null), "english");
  assert.equal(normalizeExplainLanguage(""), "english");
  assert.equal(normalizeExplainLanguage(42), "english");
  assert.equal(normalizeExplainLanguage({}), "english");
});
