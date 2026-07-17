# LakshX Graph — design notes

This extension now ships **three** views in one webview panel:

1. **Call graph** (pre-existing) — function call hierarchy seeded from the
   cursor, driven by VS Code's own `vscode.prepareCallHierarchy` /
   `provideIncoming|OutgoingCalls` LSP surface. Layered left→right tree.
2. **Dependency graph** — a workspace-wide, interactive map of file,
   module and package **import** dependencies. Force-directed.
3. **Guided Tour** (new, §5 below) — a sequential, dependency-ordered
   walkthrough of the SAME dependency graph (API/entry layer → business
   logic → shared utilities/persistence), reusing its canvas verbatim and
   just adding an ordering pass (`lib/tour.js`) plus a step panel.

A segmented toggle in the toolbar switches between them; each mode owns its
own legend, controls and render path. Guided Tour reuses dep-mode's canvas
and view state (`depNodes`/`depEdges`) directly — it is not a fourth
rendering system — while call-mode state (`nodesById`/`edges`/`parentOf`) is
never touched by either, so the existing call graph keeps working unchanged.

## 1. Dependency extraction

VS Code has no built-in import-graph API, so we scan the workspace ourselves.
All parsing lives in `lib/depgraph.js`, which is **vscode-free** and unit-tested
directly with `node --test` (`test/depgraph.test.js`, 25 tests).

- **Languages (v1):**
  - JS/TS/JSX/TSX (`.js .jsx .mjs .cjs .ts .tsx .mts .cts`):
    `import … from "x"`, bare `import "x"`, `export … from "x"`,
    `export * from "x"`, dynamic `import("x")`, `require("x")`.
  - Python (`.py .pyi`): `import a`, `import a.b.c as d`, `import a, b`,
    `from x import y`, and relative `from . / .mod / ..pkg import y`.
- **Regex/line-based, not AST** — deliberate tradeoff: robust, dependency-free,
  fast over thousands of files, and easy to extend per language. Cost: import-
  like text inside comments/strings can false-positive. We mitigate the common
  case by stripping `/* … */` block comments (JS) and `#`/`//` line comments
  before matching, and by skipping template-literal `import(\`…${x}\`)` cleanly
  rather than crashing. A full multi-language parser is out of scope for v1.
- **Resolution** (`resolveImport`):
  - JS relative specifiers resolve against a real file set with an extension
    try-order (`.ts .tsx .d.ts .js .jsx .mjs .cjs .json`) and `index.*` folder
    resolution. TS is tried before JS so source wins over compiled output.
  - Python relative imports resolve by dot-level against the importing file's
    package dir, incl. `__init__.py` packages.
  - Bare/package imports become **external** nodes, grouped by clean package
    name (`react-dom/client` → `react-dom`, `@scope/pkg/sub` → `@scope/pkg`).
- **Bounded static scan** (extension.js): `vscode.workspace.findFiles` with an
  include glob + an exclude glob (`node_modules,.git,dist,build,out,.next,
  .venv,venv,__pycache__,coverage,vendor`), capped at **2000 files** and
  **512 KB/file**. No code is ever executed.

## 2. Graph model & metrics

- **Nodes**: `internal` (a workspace file) and `external` (a package).
- **Edges**: directed "imports" (`from` → `to`), carrying the import `kind`.
- **Metrics**: per-node **fan-in** / **fan-out**; **orphan** files (no edges
  either way); **circular dependencies** via **Tarjan's SCC** (iterative, so it
  survives large graphs) — every strongly-connected component with >1 node (or a
  self-loop) is a cycle cluster. Externals are sinks and never cyclic.
- **Render cap**: payload capped at ~600 nodes — all cyclic nodes kept, then
  highest-degree internals, then attached externals. `stats` always reflects the
  **full** graph so the numbers stay honest even when the view is truncated.

## 3. UI / UX

Primary layout for the dependency graph is **force-directed**
(Fruchterman-Reingold: O(n²) repulsion + link attraction + mild gravity), on the
existing vanilla-canvas stack (no libs, no CDN). It runs a **fixed** number of
pre-settle iterations then freezes, so the layout is **deterministic** (stable
screenshots, no perpetual jitter). Above 400 nodes it falls back to a
deterministic golden-angle spiral instead of the O(n²) sim.

Features: zoom/pan (shared with call-mode), **click-to-focus** (lights a node +
its direct neighbors, dims the rest; second click on a focused file opens it),
**hover tooltip** (path, type, fan-in/out, cycle flag), **search/filter** box
(Enter jumps to first match), **legend**, **cycle highlighting** (red nodes +
red edges), **hide externals** and **collapse externals** (fold all packages
into one aggregate node — the "grouped/collapsed" external treatment), and a
live **stats bar**. Theme: dark, same VS Code CSS-variable palette as the
sibling webviews; CSP stays `default-src 'none'` with scoped script/style/font
(canvas needs no `img-src`).

## 4. Entry points

- Command **`lakshx.showDependencyGraph`** ("LakshX: Show Dependency Graph"),
  in the command palette, alongside the existing `lakshx.showCallGraph`.
- A second **status bar item** `$(type-hierarchy) Dep Graph` at priority **996**
  (right beside Call Graph's 997, same right-aligned cluster), registered in the
  same `activate()` path under `onStartupFinished`. Unlike Call Graph it needs
  no cursor, so it's always actionable.
- In-panel **toggle** between "Dependencies" and "Call graph". Each view is
  populated by its own command/scan; switching to an empty view shows a hint +
  "Scan workspace" button rather than guessing at the cursor.

## 5. Guided Tour

A third webview mode: a sequential, dependency-ordered walkthrough built on
the SAME scan as the dependency graph — not a new analysis, an ordering pass
over data that already exists.

- **Ordering** (`lib/tour.js`, pure/vscode-free, unit-tested with
  `node --test`): every cyclic cluster from `graph.cycles` (Tarjan SCCs
  `depgraph.js` already computes) collapses into ONE tour stop, so a circular
  dependency can't produce an infinite/duplicated walk — it becomes a single
  "N files, circular" stop. Every other internal file is its own stop. Each
  stop gets a **net** fan-in/fan-out (edges crossing its boundary only —
  intra-cluster edges are excluded so a cyclic cluster scores as one unit).
  Stops bucket into four tiers, evaluated in order:
  1. **Entry points** — net fan-in 0 (nothing imports it)
  2. **Orchestration / API layer** — fan-out > fan-in
  3. **Core business logic** — fan-out === fan-in
  4. **Shared utilities & persistence** — fan-in > fan-out
  Within a tier, stops sort by `(fanOut - fanIn)` descending (ties: fanOut
  desc, then id asc) so the most entry-point-shaped stops in a tier lead.
- **Blurb generation**: every sentence is built from the stop's own
  fanIn/fanOut/kind — no invented prose. E.g. `fanIn=0` → "Entry point — no
  internal file imports it; it depends on N others."; `fanIn > fanOut` →
  "Widely-used utility — imported by N files, depending on …"; a cycle stop
  gets a "Circular dependency cluster of N files — " prefix, then the same
  accurate sentence for its net metrics.
- **UI**: reuses the dependency graph's force-directed canvas verbatim — the
  tour only drives which node(s) are highlighted (`tourFocusIds`, a superset
  of the click-to-focus `depFocus` so a cyclic cluster's stop lights every
  member at once) and adds a step panel (`#tourPanel`) with tier badge, "Stop
  N of M" counter, title, blurb, and Prev/Next/"Jump to file" controls. No
  second rendering system. Clicking a node while touring jumps straight to
  that node's stop (find-a-file-in-context, without a separate lookup UI).
- **Entry points**: command **`lakshx.showGuidedTour`** + a status bar item
  `$(list-ordered) Guided Tour` at priority **994**. The host computes the
  tour alongside the dependency scan (`extension.js`'s `scanDependencyGraph`)
  and ships both in the same `depInit` payload, so one scan feeds all three
  modes — switching tabs never re-scans unless the user hits Re-scan.

## 6. "Explain this file"

Command **`lakshx.graph.explainFile`** ("LakshX: Explain This File") looks up
the ACTIVE editor's file in the dependency graph (scanning first if nothing's
cached) via `lib/tour.js`'s `explainNode(graph, path)`: real fan-in/fan-out,
direct dependents/dependencies, and cycle membership, straight from the
static scan — nothing invented. Surfaced as a `showInformationMessage`
summary (QuickInfo-style) with an optional **"Show in Guided Tour"** action
that reuses the tour panel for deeper visual context, jumping straight to
that file's stop. Entirely self-contained within `lakshx-graph` — no
cross-extension dependency on `lakshx-chat`.

## Verification & honesty

- `node --check` passes on `extension.js`, `media/graph.js`, `lib/depgraph.js`,
  `lib/tour.js`.
- `node --test` — 70 passing tests total: 25 for extraction/resolution/
  `buildGraph`/cycle detection, 26 for the vulnerability checker, and 19 new
  ones for `lib/tour.js` (ordering/tiering on a real `buildGraph()` fixture
  with an entry point, orchestration, core-logic, a widely-used utility, and
  a 3-file cycle; exact blurb text for every tier; `explainNode` on both a
  plain file and one inside a cycle).
- Renderer + all dep interactions verified in `test/harness.html` via a headless
  Chrome pass (force layout, cycle highlight, search, click-to-focus, hover
  tooltip, collapse-externals), plus a call-graph regression render. **Guided
  Tour** verified the same way: stepping Next through all 13 stops of the
  harness's sample graph (entry point → orchestration → core logic → the
  3-file cycle collapsing into one highlighted stop → the widely-used
  logger.ts utility as the final stop, with Next correctly disabled), the
  "Jump to file" button emitting the right `openPath` message, and
  click-a-node-to-jump landing on the correct stop. No console or CSP errors
  observed.
- **Not verified live**: the `vscode.workspace.findFiles` scan path (shared by
  the dependency graph, Guided Tour, and "Explain this file") runs only
  inside a real extension host, which isn't available here. That wiring is
  code-reviewed and inspection-only; the extraction/model and tour/blurb
  logic it feeds are fully tested in isolation.
