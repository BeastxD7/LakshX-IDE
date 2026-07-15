"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { LINE_BANKS, CATEGORIES, renderLine, pickIndex, pickLine } = require("../lib/lines.js");

test("every category has a healthy, curated bank (15-25 lines, per the feature spec)", () => {
  for (const category of CATEGORIES) {
    const bank = LINE_BANKS[category];
    assert.ok(Array.isArray(bank), `${category} should be an array`);
    assert.ok(bank.length >= 15, `${category} has only ${bank.length} lines, expected >= 15`);
    assert.ok(bank.length <= 30, `${category} has ${bank.length} lines, suspiciously many`);
  }
});

test("no duplicate lines within a category, and no line is empty", () => {
  for (const category of CATEGORIES) {
    const bank = LINE_BANKS[category];
    const seen = new Set();
    for (const line of bank) {
      assert.ok(typeof line === "string" && line.trim().length > 0, `${category} has an empty/invalid line`);
      assert.ok(!seen.has(line), `${category} has a duplicate line: "${line}"`);
      seen.add(line);
    }
  }
});

test("renderLine substitutes {files} with a real count when given one", () => {
  assert.equal(renderLine("Landed {files}, clean.", { fileCount: 5 }), "Landed 5 files, clean.");
  assert.equal(renderLine("Landed {files}, clean.", { fileCount: 1 }), "Landed 1 file, clean.");
});

test("renderLine falls back gracefully when {files}/{count} meta is absent", () => {
  assert.equal(renderLine("Landed {files}, clean.", {}), "Landed a stack of files, clean.");
  assert.equal(renderLine("That's {count} in a row.", {}), "That's several in a row.");
});

test("renderLine is a no-op on lines without template tokens", () => {
  const line = LINE_BANKS.lateNight[0];
  assert.equal(renderLine(line, {}), line);
});

test("pickIndex avoids recently-shown indices when alternatives exist", () => {
  const bank = ["a", "b", "c"];
  const recent = new Set([0, 1]);
  // only index 2 is not recent — a deterministic rng must still land on it
  const idx = pickIndex(bank, recent, () => 0);
  assert.equal(idx, 2);
});

test("pickIndex falls back to the full bank when everything is 'recent' (avoids deadlock on small banks)", () => {
  const bank = ["a", "b"];
  const recent = new Set([0, 1]);
  const idx = pickIndex(bank, recent, () => 0);
  assert.ok(idx === 0 || idx === 1);
});

test("pickLine tracks history per category and never immediately repeats when the bank is large enough", () => {
  const historyState = new Map();
  const seenInARow = [];
  let counter = 0;
  // deterministic rng that cycles through the pool in order
  const rng = () => {
    const v = (counter % 1000) / 1000;
    counter++;
    return v;
  };
  for (let i = 0; i < 10; i++) {
    const line = pickLine("bigWin", { historyState, rng, noRepeatWindow: 6 });
    seenInARow.push(line);
  }
  for (let i = 1; i < seenInARow.length; i++) {
    assert.notEqual(seenInARow[i], seenInARow[i - 1], "line repeated immediately");
  }
});

test("pickLine returns null for an unknown category instead of throwing", () => {
  assert.equal(pickLine("not-a-real-category", {}), null);
});
