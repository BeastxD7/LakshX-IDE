"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildGraph } = require("../lib/depgraph.js");
const { buildTour, explainNode, generateBlurb, tierFor, TIERS } = require("../lib/tour.js");

// ---------------------------------------------------------------------------
// Synthetic fixture, run through the REAL buildGraph() so the tour is tested
// against real graph shapes rather than hand-rolled node objects:
//
//   main.ts ------------> app.ts --------> router.ts -------> services/user.ts -> db.ts -> utils/logger.ts
//   (entry,               (orchestrates,    (orchestrates,     (balanced)          (balanced)  (widely used)
//    fanIn 0, fanOut 1)     also -> express)  also -> cycle/a)
//
//   utils/formatter.ts -> utils/logger.ts   (a second, independent entry point)
//
//   cycle/a.ts -> cycle/b.ts -> cycle/c.ts -> cycle/a.ts (circular),
//   cycle/c.ts also -> utils/logger.ts (boundary out-edge)
//   router.ts -> cycle/a.ts (boundary in-edge)
//
// So the cyclic cluster nets fanIn=1 (from router), fanOut=1 (to logger) —
// a "Core business logic" stop, same tier as user.ts/db.ts.
// ---------------------------------------------------------------------------
function sampleFiles() {
  return [
    { path: "src/main.ts", text: `import { run } from "./app";` },
    { path: "src/app.ts", text: `import { Router } from "./router"; import express from "express";` },
    { path: "src/router.ts", text: `import { userService } from "./services/user"; import "./cycle/a";` },
    { path: "src/services/user.ts", text: `import { db } from "../db";` },
    { path: "src/db.ts", text: `import { logger } from "./utils/logger";` },
    { path: "src/utils/logger.ts", text: `` },
    { path: "src/utils/formatter.ts", text: `import { logger } from "./logger";` },
    { path: "src/cycle/a.ts", text: `import "./b";` },
    { path: "src/cycle/b.ts", text: `import "./c";` },
    { path: "src/cycle/c.ts", text: `import "./a"; import { logger } from "../utils/logger";` },
  ];
}

function sampleGraph() {
  return buildGraph(sampleFiles());
}

// ---------------------------------------------------------------------------
// Ordering / tiering
// ---------------------------------------------------------------------------
test("buildTour: low-fan-in/high-fan-out nodes lead, high-fan-in/low-fan-out nodes trail", () => {
  const { stops } = buildTour(sampleGraph());
  const byPath = Object.fromEntries(stops.map((s, i) => [s.path, i]));

  // main.ts (fanIn 0, fanOut 1) is a pure entry point — must come first overall.
  assert.equal(stops[0].path, "src/main.ts");
  // logger.ts (fanIn 3, fanOut 0) is the most widely-depended-on node — must come last.
  assert.equal(stops[stops.length - 1].path, "src/utils/logger.ts");

  // Entry points precede orchestration, which precedes core logic, which
  // precedes shared utilities, for every representative pair.
  assert.ok(byPath["src/main.ts"] < byPath["src/app.ts"]);
  assert.ok(byPath["src/app.ts"] < byPath["src/services/user.ts"]);
  assert.ok(byPath["src/services/user.ts"] < byPath["src/utils/logger.ts"]);
});

test("buildTour: groups stops into tiers (3-5), correctly bucketed", () => {
  const { tiers } = buildTour(sampleGraph());
  assert.ok(tiers.length >= 3 && tiers.length <= 5);
  assert.deepEqual(
    tiers.map((t) => t.name),
    ["Entry points", "Orchestration / API layer", "Core business logic", "Shared utilities & persistence"],
  );

  const byTier = Object.fromEntries(tiers.map((t) => [t.name, t.stops.map((s) => s.path)]));
  assert.deepEqual(new Set(byTier["Entry points"]), new Set(["src/main.ts", "src/utils/formatter.ts"]));
  assert.deepEqual(new Set(byTier["Orchestration / API layer"]), new Set(["src/app.ts", "src/router.ts"]));
  assert.ok(byTier["Core business logic"].includes("src/services/user.ts"));
  assert.ok(byTier["Core business logic"].includes("src/db.ts"));
  assert.deepEqual(byTier["Shared utilities & persistence"], ["src/utils/logger.ts"]);
});

test("buildTour: a cyclic cluster becomes ONE grouped stop, not one per member", () => {
  const { stops } = buildTour(sampleGraph());
  const cycleStops = stops.filter((s) => s.kind === "cycle");
  assert.equal(cycleStops.length, 1, "exactly one stop represents the whole cyclic cluster");
  assert.deepEqual(cycleStops[0].members, ["src/cycle/a.ts", "src/cycle/b.ts", "src/cycle/c.ts"]);

  // none of the individual cycle members appear as their own separate stop
  for (const m of cycleStops[0].members) {
    assert.ok(!stops.some((s) => s.kind === "single" && s.path === m));
  }
  // net boundary metrics: router->cycle/a (in), cycle/c->logger (out); the
  // internal a->b->c->a edges are excluded from both.
  assert.equal(cycleStops[0].fanIn, 1);
  assert.equal(cycleStops[0].fanOut, 1);
  assert.equal(cycleStops[0].tier, "Core business logic");
});

test("buildTour: total stop count = singleton files + one stop per cycle (no duplication/blow-up)", () => {
  const graph = sampleGraph();
  const { stops } = buildTour(graph);
  const internalCount = graph.nodes.filter((n) => n.type === "internal").length;
  // 10 internal files total; 3 collapse into 1 cycle stop => 10 - 3 + 1 = 8 stops
  assert.equal(internalCount, 10);
  assert.equal(stops.length, 8);
});

test("buildTour: handles a graph with no cycles at all", () => {
  const files = [
    { path: "a.ts", text: `import "./b";` },
    { path: "b.ts", text: `` },
  ];
  const { stops, tiers } = buildTour(buildGraph(files));
  assert.equal(stops.length, 2);
  assert.ok(stops.every((s) => s.kind === "single"));
  assert.equal(tiers.reduce((n, t) => n + t.stops.length, 0), 2);
});

test("buildTour: empty graph produces empty stops/tiers without throwing", () => {
  const { stops, tiers } = buildTour({ nodes: [], edges: [], cycles: [] });
  assert.deepEqual(stops, []);
  assert.equal(tiers.length, 4);
  assert.ok(tiers.every((t) => t.stops.length === 0));
});

// ---------------------------------------------------------------------------
// tierFor
// ---------------------------------------------------------------------------
test("tierFor: exact bucket boundaries", () => {
  assert.equal(tierFor(0, 0), "Entry points");
  assert.equal(tierFor(0, 5), "Entry points");
  assert.equal(tierFor(2, 5), "Orchestration / API layer");
  assert.equal(tierFor(3, 3), "Core business logic");
  assert.equal(tierFor(5, 1), "Shared utilities & persistence");
  assert.equal(TIERS.length, 4);
});

// ---------------------------------------------------------------------------
// Blurb generation — exact text, not a vibe check
// ---------------------------------------------------------------------------
test("generateBlurb: entry point, singular dependency", () => {
  assert.equal(
    generateBlurb({ fanIn: 0, fanOut: 1, kind: "single", members: ["x"] }),
    "Entry point — no internal file imports it; it depends on 1 other.",
  );
});

test("generateBlurb: entry point, plural dependencies", () => {
  assert.equal(
    generateBlurb({ fanIn: 0, fanOut: 4, kind: "single", members: ["x"] }),
    "Entry point — no internal file imports it; it depends on 4 others.",
  );
});

test("generateBlurb: standalone (zero fan-in and fan-out)", () => {
  assert.equal(
    generateBlurb({ fanIn: 0, fanOut: 0, kind: "single", members: ["x"] }),
    "Standalone — no other internal file imports it, and it has no recorded imports of its own.",
  );
});

test("generateBlurb: orchestration layer", () => {
  assert.equal(
    generateBlurb({ fanIn: 1, fanOut: 2, kind: "single", members: ["x"] }),
    "Orchestration layer — depends on 2 others, used by 1 file.",
  );
});

test("generateBlurb: core logic (balanced)", () => {
  assert.equal(
    generateBlurb({ fanIn: 1, fanOut: 1, kind: "single", members: ["x"] }),
    "Core logic — depends on 1 other and is used by 1 file.",
  );
});

test("generateBlurb: widely-used utility, matches the roadmap pitch's own phrasing", () => {
  assert.equal(
    generateBlurb({ fanIn: 12, fanOut: 0, kind: "single", members: ["x"] }),
    "Widely-used utility — imported by 12 files, depending on nothing else.",
  );
});

test("generateBlurb: widely-used utility that itself has some dependencies", () => {
  assert.equal(
    generateBlurb({ fanIn: 3, fanOut: 2, kind: "single", members: ["x"] }),
    "Widely-used utility — imported by 3 files, depending on 2 others.",
  );
});

test("generateBlurb: cyclic cluster gets a prefix, then the same accurate metric sentence", () => {
  assert.equal(
    generateBlurb({ fanIn: 1, fanOut: 1, kind: "cycle", members: ["a.ts", "b.ts", "c.ts"] }),
    "Circular dependency cluster of 3 files — Core logic — depends on 1 other and is used by 1 file.",
  );
});

// ---------------------------------------------------------------------------
// explainNode — "Explain this file"
// ---------------------------------------------------------------------------
test("explainNode: returns null for a file not present in the graph", () => {
  assert.equal(explainNode(sampleGraph(), "src/nope.ts"), null);
});

test("explainNode: entry point file — exact fan-in/out, dependents/dependencies, blurb", () => {
  const info = explainNode(sampleGraph(), "src/main.ts");
  assert.equal(info.fanIn, 0);
  assert.equal(info.fanOut, 1);
  assert.deepEqual(info.dependents, []);
  assert.deepEqual(info.dependencies, ["src/app.ts"]);
  assert.equal(info.inCycle, false);
  assert.deepEqual(info.cycleMembers, []);
  assert.equal(info.tier, "Entry points");
  assert.equal(info.blurb, "Entry point — no internal file imports it; it depends on 1 other.");
});

test("explainNode: widely-used utility — dependents list all three importers", () => {
  const info = explainNode(sampleGraph(), "src/utils/logger.ts");
  assert.equal(info.fanIn, 3);
  assert.equal(info.fanOut, 0);
  assert.deepEqual(
    new Set(info.dependents),
    new Set(["src/db.ts", "src/utils/formatter.ts", "src/cycle/c.ts"]),
  );
  assert.deepEqual(info.dependencies, []);
  assert.equal(info.tier, "Shared utilities & persistence");
  assert.equal(info.blurb, "Widely-used utility — imported by 3 files, depending on nothing else.");
});

test("explainNode: a file inside a cyclic cluster reports its OWN raw fan-in/out plus cycle membership", () => {
  const info = explainNode(sampleGraph(), "src/cycle/a.ts");
  assert.equal(info.inCycle, true);
  assert.deepEqual(new Set(info.cycleMembers), new Set(["src/cycle/a.ts", "src/cycle/b.ts", "src/cycle/c.ts"]));
  // a.ts's own raw fanIn/fanOut include the intra-cluster edges (router->a, a->b),
  // unlike the tour cluster's NET metrics — these are two different, both-honest views.
  assert.equal(info.fanIn, 2); // from router.ts AND from cycle/c.ts (the cyclic edge back to a)
  assert.equal(info.fanOut, 1); // to cycle/b.ts
});
