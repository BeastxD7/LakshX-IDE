# IDE feature roadmap — round 2 (post-shipment)

All 10 round-1 recommendations (doc 15) are shipped and verified in git log.
This round goes deeper: revisits explicit round-1 cuts, surveys 2026 H2
developments, and adds a security/collaboration/differentiation angle.

## Explicitly-cut items, revisited

- **Zed-style GPU rendering** — still architecturally blocked. GPUI replaces
  the DOM entirely; not droppable into an Electron fork. No change from
  round 1.
- **Multiplayer co-editing** — Live Share bundling still right for raw
  co-editing, but there's a richer, on-brand alternative: **sharing a live
  agent session**, not the editor buffer. `docs/architecture.md` §8's remote
  control (SSE mirror + control endpoints routed through the same
  `AgentViewProvider` the desktop panel uses) is already 80% of "a second
  client watches/steers a live session" — it's just LAN-local/QR-paired.
  Two tiers: **v1 async share link** (serialize a finished/snapshot
  conversation to a static unlisted-by-URL viewer, Amp-thread-style, no new
  transport) — cheap, buildable now. **v2 live Warp-style steering** reuses
  the SSE/control pattern verbatim but needs an internet-reachable relay +
  real auth beyond LAN QR — the one item in this report needing new
  infrastructure; not a tonight-sized task.

## Validation for Royal Mode 2.0 (fold into doc 12, not a new build item)

Anthropic's Claude Code `/goal` (May 2026): a Stop-hook where a **separate,
smaller model** judges a user-written completion condition against the
transcript. Explicit principle: "the writer is not also the grader." But
their evaluator **only reads the transcript — it doesn't run tools/commands**,
so a worker that fabricates "tests passed" in its own text could fool it.
LakshX's Phase 5 design — `declare_done` re-running verification
**server-side, harness-executed** — is strictly more rigorous. State this in
doc 12 as validated-and-superior, not something to weaken toward parity.
Anthropic's June 2026 subagent grader-revise loop also independently
converges on doc 12's typed-role (explorer/implementer/verifier/critic)
design. Strong external corroboration the phase-machine direction is right.

## Other findings

- **Codebase "Guided Tour"**: a thin, high-leverage extension of
  `lakshx-graph` — an ordering/traversal algorithm over the existing
  dependency graph (API → business logic → persistence) plus a tour UI and
  a graph-grounded "explain this file" chat entry. Not a bigger graph, a
  guided walkthrough of the one that already exists.
- **Agent trace/observability inspector** — keep the name distinct from
  `lakshx-db`: this traces the AGENT's own tool-call behavior (timing,
  token spend), not the user's database. Zero overlap with lakshx-db;
  easy to confuse, name it carefully. Medium complexity, can visually reuse
  lakshx-db's webview panel plumbing.
- **PR walkthrough auto-generator** — grounds a diff narrative in the
  dependency graph LakshX already has ("this touches computeTotals, called
  from 6 sites, 2 with no test coverage") — richer than diff-only
  competitor tools. Reuses crash-explanation's "compose rich context into
  one prompt" pattern without duplicating it.

## Security angle

- **SAST-lite pattern scanning (SQLi/XSS-class)** — directly reuses
  `lakshx-structural-search/lib/pattern.js` (same token-level-not-AST
  tradeoff it already documents and defends). Concrete rules expressible
  today: `$DB.query($SQL)`, `$EL.innerHTML = $X`, `eval($X)`,
  `child_process.exec($CMD)`. Real gap: needs a "capture is not a string
  literal" predicate added to the matcher (a literal arg is safe, a
  concatenated/variable one is the signal) — small, scoped extension, not
  a rewrite. **Must be marketed honestly as shape-matching, not taint/
  dataflow analysis** — will miss anything flowing through an intermediate
  variable or helper function. Given LakshX just finished a security audit,
  overselling this would be actively misleading.
- **Offline pre-commit secret scanning** — Gitleaks-style regex+entropy,
  fully local, zero network calls, baseline/allowlist file so
  previously-acknowledged strings don't re-fire. A sibling in philosophy to
  structural-search (pattern-over-heavy-infra) but NOT a reuse of the same
  engine — secret detection is regex+entropy over raw text, not token-shape
  matching. New, small, self-contained module.

## Differentiation for the Indian/global vibecoder audience

- **Regional-language / Hinglish explain toggle** — near-zero build
  complexity (a system-prompt/localization layer, not new infra). Web
  research found nothing shipping this concretely yet despite India being
  cited as the fastest-growing dev market in 2026 — genuinely unclaimed
  space, not a catch-up feature.
- **Text-only commentary flourish over the background-task tray** (opt-in,
  no audio/TTS) — reuses the removed cricket-commentary *concept*, not its
  audio pipeline, as flavor text over the already-shipped
  subagent-activity event stream. **Caveat, not a green light**: the
  architecture doc only records that the audio experiment was removed —
  it doesn't record whether the owner rejected the whole concept or just
  the TTS mechanism. Surface for an explicit decision, don't build on
  assumption.
- Secondary: a "weekly agent recap" share card (turns run, tasks completed,
  LOC touched) — ties the share-link infra (v1 above) to the vibecoder
  social-flex instinct.

## Ranked top 8

1. SAST-lite pattern scanning (reuses structural-search, ties to the audit)
2. Offline pre-commit secret scanning (Gitleaks-style)
3. Shared agent session v1 (async export/share link, no relay needed)
4. PR walkthrough auto-generator (graph-grounded)
5. Codebase "Guided Tour" mode (extends lakshx-graph)
6. Regional-language / Hinglish explain toggle (near-zero complexity)
7. Agent trace/observability inspector (name distinct from lakshx-db)
8. Shared agent session v2 (live steering — flagged as needing new relay
   infrastructure, not a tonight-sized task)

None of these need the disk-space-blocked Electron rebuild voice mode
needs, except where explicitly noted (#8 needs relay infra, a different
kind of blocker).
