// LakshX Guided Tour — pure, vscode-free ordering/tiering over an existing
// depgraph.js buildGraph() output. No new graph analysis: this reuses the
// fan-in/fan-out metrics and Tarjan-SCC cycle list that lib/depgraph.js
// already computes, and just answers "what order should I walk these files
// in?" — a dependency-ordered path (API/entry layer -> business logic ->
// shared utilities/persistence), not a bigger or prettier graph.
//
// Unit-tested directly with `node --test` (see test/tour.test.js), same
// pattern as lib/depgraph.js.
"use strict";

// ---------------------------------------------------------------------------
// Tiers — evaluated top-to-bottom, first match wins. Order here is also the
// tour's tier order (Entry points walked first, Shared utilities last).
// Rules operate on NET fan-in/fan-out (see buildTour below): for a singleton
// stop this is identical to the node's own depgraph fanIn/fanOut; for a
// cyclic cluster it's the edges crossing the cluster's boundary only (intra-
// cluster edges are excluded so the cluster is scored as one unit instead of
// being inflated by its own internal cross-links).
// ---------------------------------------------------------------------------
const TIERS = [
  {
    name: "Entry points",
    description: "Nothing else in the workspace imports these — likely mains, CLIs, or top-level entry files.",
    test: (fanIn) => fanIn === 0,
  },
  {
    name: "Orchestration / API layer",
    description: "Depended on by some files, but pull in more than depend on them — likely controllers/orchestration.",
    test: (fanIn, fanOut) => fanOut > fanIn,
  },
  {
    name: "Core business logic",
    description: "Roughly as many dependents as dependencies — the balanced middle of the graph.",
    test: (fanIn, fanOut) => fanOut === fanIn,
  },
  {
    name: "Shared utilities & persistence",
    description: "Depended on by more files than they depend on — widely-used utilities/models/persistence.",
    test: () => true, // catch-all: fanIn > fanOut
  },
];

function tierFor(fanIn, fanOut) {
  for (const t of TIERS) if (t.test(fanIn, fanOut)) return t.name;
  return TIERS[TIERS.length - 1].name;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/**
 * Auto-generate a short, metric-grounded blurb for a stop. Every number in
 * the output is read straight from the stop's fanIn/fanOut — nothing here is
 * invented prose. `stop` needs {fanIn, fanOut, kind, members}.
 */
function generateBlurb(stop) {
  const { fanIn, fanOut, kind, members } = stop;
  const prefix = kind === "cycle" ? `Circular dependency cluster of ${members.length} files — ` : "";
  let body;
  if (fanIn === 0 && fanOut === 0) {
    body = "Standalone — no other internal file imports it, and it has no recorded imports of its own.";
  } else if (fanIn === 0) {
    body = `Entry point — no internal file imports it; it depends on ${fanOut} ${plural(fanOut, "other", "others")}.`;
  } else if (fanOut > fanIn) {
    body = `Orchestration layer — depends on ${fanOut} ${plural(fanOut, "other", "others")}, used by ${fanIn} ${plural(fanIn, "file", "files")}.`;
  } else if (fanOut === fanIn) {
    body = `Core logic — depends on ${fanOut} ${plural(fanOut, "other", "others")} and is used by ${fanIn} ${plural(fanIn, "file", "files")}.`;
  } else {
    const depPart = fanOut === 0 ? "nothing else" : `${fanOut} ${plural(fanOut, "other", "others")}`;
    body = `Widely-used utility — imported by ${fanIn} ${plural(fanIn, "file", "files")}, depending on ${depPart}.`;
  }
  return prefix + body;
}

/**
 * Build the Guided Tour: an ordered, tiered walk over a depgraph.js
 * buildGraph() result ({nodes, edges, cycles, stats}).
 *
 * - Only internal (workspace file) nodes get stops; external package nodes
 *   are sinks and never part of the walk.
 * - Every cyclic cluster from `graph.cycles` (already Tarjan-SCC-detected by
 *   depgraph.js) collapses into ONE stop, so a circular dependency can never
 *   produce an infinite or duplicated walk — it just becomes a single
 *   "N files, circular" stop scored by its net boundary edges.
 * - Stops are bucketed into the TIERS above, then sorted within a tier by
 *   (fanOut - fanIn) descending (ties broken by fanOut desc, then id asc for
 *   determinism) so the most entry-point/orchestration-shaped stops in a
 *   tier still lead.
 *
 * @param {{nodes:Array, edges:Array, cycles:Array<Array<string>>}} graph
 * @returns {{stops:Array, tiers:Array<{name:string, description:string, stops:Array}>}}
 */
function buildTour(graph) {
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  const cycles = (graph && graph.cycles) || [];

  const internalNodes = nodes.filter((n) => n.type === "internal");
  const nodeById = new Map(internalNodes.map((n) => [n.id, n]));

  // clusterKey -> { members: [ids] }. Cyclic clusters first (so their members
  // get claimed before the singleton pass), then every remaining internal
  // node becomes its own singleton cluster.
  const clusterOf = new Map(); // nodeId -> clusterKey
  const clusters = new Map(); // clusterKey -> { members }

  for (const cyc of cycles) {
    const members = cyc.filter((id) => nodeById.has(id));
    if (members.length === 0) continue;
    const key = "cycle:" + [...members].sort().join(",");
    if (clusters.has(key)) continue;
    clusters.set(key, { members: [...members] });
    for (const id of members) clusterOf.set(id, key);
  }
  for (const n of internalNodes) {
    if (clusterOf.has(n.id)) continue;
    const key = "single:" + n.id;
    clusters.set(key, { members: [n.id] });
    clusterOf.set(n.id, key);
  }

  // Net fan-in/fan-out per cluster: only edges that cross the cluster
  // boundary count. An edge with both endpoints in the same cluster (e.g. two
  // members of a cyclic cluster calling each other) is intentionally excluded
  // so the cluster is scored as a single unit, not inflated by its own
  // internal cross-links.
  const netIn = new Map();
  const netOut = new Map();
  for (const key of clusters.keys()) {
    netIn.set(key, 0);
    netOut.set(key, 0);
  }
  for (const e of edges) {
    const fromCluster = clusterOf.get(e.from); // undefined only if e.from isn't internal (shouldn't happen — only files import)
    const toCluster = clusterOf.get(e.to); // undefined when e.to is an external package node
    if (fromCluster && fromCluster === toCluster) continue; // intra-cluster edge
    if (fromCluster) netOut.set(fromCluster, netOut.get(fromCluster) + 1);
    if (toCluster) netIn.set(toCluster, netIn.get(toCluster) + 1);
  }

  const stops = [];
  for (const [key, { members }] of clusters) {
    const fanIn = netIn.get(key);
    const fanOut = netOut.get(key);
    const sortedMembers = [...members].sort();
    const isCycle = members.length > 1;
    const head = nodeById.get(sortedMembers[0]);
    const stop = {
      id: key,
      kind: isCycle ? "cycle" : "single",
      members: sortedMembers,
      label: isCycle ? `${members.length} files (circular)` : head ? head.label : sortedMembers[0],
      path: head ? head.path : sortedMembers[0],
      fanIn,
      fanOut,
      tier: tierFor(fanIn, fanOut),
    };
    stop.blurb = generateBlurb(stop);
    stops.push(stop);
  }

  const tierIndex = new Map(TIERS.map((t, i) => [t.name, i]));
  stops.sort((a, b) => {
    const ta = tierIndex.get(a.tier);
    const tb = tierIndex.get(b.tier);
    if (ta !== tb) return ta - tb;
    const netA = a.fanOut - a.fanIn;
    const netB = b.fanOut - b.fanIn;
    if (netB !== netA) return netB - netA;
    if (b.fanOut !== a.fanOut) return b.fanOut - a.fanOut;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const tiers = TIERS.map((t) => ({
    name: t.name,
    description: t.description,
    stops: stops.filter((s) => s.tier === t.name),
  }));

  return { stops, tiers };
}

/**
 * "Explain this file": look up one internal file's real position in the
 * graph. Grounded entirely in depgraph.js's own data — fan-in/fan-out,
 * direct dependents/dependencies (raw, not net-of-cluster, so the numbers
 * match what the dependency-graph hover tooltip already shows for the same
 * file), and cycle membership.
 *
 * @param {{nodes:Array, edges:Array, cycles:Array<Array<string>>}} graph
 * @param {string} filePath workspace-relative POSIX path (a depgraph node id
 *   for internal files)
 * @returns {null | {path, label, fanIn, fanOut, dependents, dependencies,
 *   inCycle, cycleMembers, tier, blurb}}
 */
function explainNode(graph, filePath) {
  const nodes = (graph && graph.nodes) || [];
  const edges = (graph && graph.edges) || [];
  const cycles = (graph && graph.cycles) || [];

  const node = nodes.find((n) => n.type === "internal" && n.path === filePath);
  if (!node) return null;

  const dependents = edges.filter((e) => e.to === node.id).map((e) => e.from);
  const dependencies = edges.filter((e) => e.from === node.id).map((e) => e.to);
  const cycleMembers = cycles.find((c) => c.includes(node.id));
  const tier = tierFor(node.fanIn, node.fanOut);
  const blurb = generateBlurb({ fanIn: node.fanIn, fanOut: node.fanOut, kind: "single", members: [node.id] });

  return {
    path: node.path,
    label: node.label,
    fanIn: node.fanIn,
    fanOut: node.fanOut,
    dependents,
    dependencies,
    inCycle: !!cycleMembers,
    cycleMembers: cycleMembers ? [...cycleMembers] : [],
    tier,
    blurb,
  };
}

const api = { buildTour, explainNode, generateBlurb, tierFor, TIERS };
// Node (extension host, `node --test`): the normal CommonJS surface.
if (typeof module !== "undefined" && module.exports) module.exports = api;
// Plain browser (test/harness.html, which loads this file directly via a
// <script> tag with no bundler/CommonJS shim available): same API on a
// global, so the harness can build a real tour from its sample graph instead
// of hand-faking one.
if (typeof window !== "undefined") window.LakshxTour = api;
