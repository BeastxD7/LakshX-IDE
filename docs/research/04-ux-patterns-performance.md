# Research: UI/UX Patterns + Perceived Performance (July 2026)

## 1. Agent UX in shipping products

### Cursor
- **Agent-first shell (2.0→3.x)**: sidebar of agents/plans, up to 8 parallel agents in isolated worktrees/remote machines; files as inline "pills"; removed most manual @-mentions.
- Praised: Composer speed ("users no longer hesitate to rerun refactors"); agents panel changes the unit of work.
- Hated: agent hangs/"zombie revert" bugs; token burn; humans "falling behind the approval queue."
- **Lesson: the approval queue is the bottleneck, not generation speed. Design for review throughput.**

### Windsurf Cascade
- Autonomy-first: auto-pulls context, asks only on ambiguity. "Windsurf does the work for you; Cursor does it with you."
- **Best-in-class: in-IDE live preview** — click element in rendered app → "Send element" pipes DOM node + errors into agent context; one-click deploys. Closes the see-it/fix-it loop best.
- Onboards in ~1 week vs 2–3 weeks for Cursor's agent-first UI (feels like "Copilot plus more").

### Claude Code
- Same engine, four surfaces (CLI/desktop/web/IDE) — match interface to where attention sits.
- **Best-in-class: permission-mode ladder** — Plan (read-only) → ask → accept-edits → Auto (classifier-approved) → bypass. Shift+Tab cycles.
- **Key datapoint: 93% of permission prompts get approved → approval fatigue is real.** Auto mode: server-side prompt-injection probe on inputs + reasoning-blind transcript classifier on actions; tiered allowlists; blocked actions return to agent with reasoning; escalate to human after 3 consecutive / 20 total blocks. ~17% dangerous actions blocked at 0.4% false-positive rate.

### Zed
- Threads sidebar; per-thread folder/repo permissions; 120fps under multi-agent load.
- **Best-in-class: follow-the-agent mode** — viewport tracks agent as it reads/edits; turns agent work into something you *watch*.
- **Best-in-class review: multi-buffer** — all edited hunks from every file in one editable unified diff, accept/reject per hunk. Cleanest large-diff review UX.

### GitHub Copilot
- Agent mode (sync in-IDE) vs coding agent (async cloud → PR). The 👀 emoji ack on issue assignment praised as trust-building. Criticism: agent "wanders" without repo instructions.

### Devin
- Plan-first UX: editable plan before execution; machine snapshots as named save-states; "Devin is typing…" activity cues make autonomy legible. Failure mode: infinite edit-run-fail loops.

### Replit Agent
- Warning list: credit "bill shock," unsolicited changes to untouched code, context loss on big projects.

## 2. The review problem — consensus best practice

1. **Plan → diff → approve** as canonical loop.
2. **Multi-buffer / unified changeset review beats per-file popups** (Zed is the reference implementation).
3. **Streamed edits for visibility, atomic apply for safety** — stream so user can interrupt; gate changeset commit atomically with checkpoint restore underneath.
4. **Checkpoints via shadow git** (Cline commits at every file modification; restore files-only or conversation-only). Table stakes.
5. **Every action needs a "receipt"**: what changed, where, which permission, diff + rollback hook; offer **"tell the agent what to do instead"** as third button beyond accept/reject.
6. **Trust levels as ladder, not toggle**: risk-tier actions — in-project edits ≈ free, shell/network/out-of-tree ≈ classified or asked.

## 3. Multi-agent / parallel-work UX

- **Git worktrees are the settled substrate** (Cursor, Zed, Claude Code, Conductor).
- Conductor (Melty Labs): native macOS orchestrator with real diff-review panel — best current reference.
- Vibe Kanban: kanban-of-agents. Terragon (cloud-VM agents) is **defunct** — cautionary for cloud-only.
- Metaphor war: sidebar-of-threads (Zed), agents-panel (Cursor), kanban, PR-queue (Copilot). Shared failure: **human review bandwidth is the scarce resource** — N agents without a triage surface = approval-queue debt.
- Notifications: distinct classes for "agent finished / blocked / needs decision."

## 4. Why Zed/Linear/Arc/Warp feel premium

- **Zed/GPUI**: UI rendered like a game, 120fps, ~2ms input latency vs ~25ms VS Code. Eliminating DOM/compositor is *the* feel differentiator.
- **Linear**: "UI responsiveness must not depend on network latency." Local-first: IndexedDB → in-memory object pool; optimistic mutations, durable queue, WebSocket delta sync; sub-50ms interactions. Speed as a *design decision*.
- **Warp**: custom Rust UI, whole-app theming, block-based commands, restrained typography.
- **Common denominators**: command palette + keyboard-first everything (every action bindable); real theming *system* (semantic tokens, both modes designed together); motion only to explain state changes.

## 5. Perceived performance techniques

- **Streaming without thrash**: debounce markdown re-parse 50–100ms; buffer incomplete markdown (half-open fences break layout); incremental block-tracking parsers avoid O(n²); `contain: layout`; memoize sibling messages; pin scroll without full relayout.
- **Skeletons vs spinners**: skeletons rated ~20–30% faster for same wait. Spinner <1s discrete ops; skeleton for content/panels; nothing <100ms.
- **Optimistic UI** (Linear pattern): apply locally, queue durably, roll back visibly on failure — file-tree ops, thread creation, checkpoint restores.
- **Virtualization**: file trees, thread lists, diff hunks, terminal scrollback — O(visible rows). VS Code's piece-tree buffer is the reference.
- **GPU text in browser**: Google Docs moved to canvas 2021; WebGPU in all major browsers; **HTML-in-Canvas API** (I/O 2026) renders DOM into WebGPU textures preserving a11y — first credible GPUI-like path on web.
- **Why latency matters**: Dan Luu — latency causes typos and worse code via cognitive load. Nielsen: 0.1s instant, 1s flow kept, 10s attention lost.

## 6. Onboarding + trust

- **Cursor**: "Import VS Code Settings" wizard (extensions, settings, keybindings, themes) in <2 min — the migration-cost killer, most-copied onboarding move.
- **BYOK reality**: Cursor BYOK unlocks chat only (community grievance); VS Code shipped first-party BYOK June 2026; open alternatives win users on transparent per-token BYOK. Replit: opaque credits → bill shock is #1 complaint.
- **Trust arc**: read-only exploration → plan approval → supervised edits → auto-accept → classifier-backed autonomy; climb per-project; show *why* each rung is safe (checkpoints, receipts, escalation backstops).

## Common failure modes to avoid

1. Approval fatigue → rubber-stamping (93% approval rate). Don't prompt for in-project edits.
2. Review-queue debt in multi-agent. Cap default parallelism; build triage inbox before fleets.
3. Agent hangs with no visible state — always-visible per-agent state machine + hard stop.
4. Unsolicited changes — show file-touch set live; out-of-scope edits escalate.
5. Context confusion between parallel agents — hard isolation (worktrees) + per-thread permissions.
6. Opaque credit pricing → bill shock; crippled BYOK → backlash.
7. Hiding the editor too aggressively — keep one-keystroke path to a plain fast editor.
8. Naive token streaming — quadratic re-parse jank.
9. Infinite edit-run-fail loops — loop detection + "agent is stuck" escalation after N cycles.

## Recommended UX architecture

**Three-zone shell (agent-first but editor-preserving):**
- **Left — Agent Threads sidebar**: threads grouped by project/worktree; state badge (planning/working/blocked/awaiting-review/done); per-thread folder permissions; doubles as multi-agent inbox with "needs me" queue at top.
- **Center — Editor + Review multi-buffer**: real editor always one keystroke away; changesets open as editable unified multi-buffer with per-hunk accept / reject / "instruct instead"; follow-the-agent toggle; interrupt anytime.
- **Right — Context rail (collapsible)**: editable plan, tool-call receipts (command, diff, permission tier, rollback link), live preview with click-element-to-context, terminal.
- **Command palette as spine**: every action bindable; agent ops are first-class commands.
- **Safety substrate**: shadow-git checkpoints; worktree per agent; 5-mode permission ladder cycled by one chord.
- **Async tier**: background agents deliver changesets into the same review multi-buffer; OS notifications only for done/blocked/needs-decision.

## Latency & perf budgets

| Interaction | Budget |
|---|---|
| Keystroke → glyph | ≤8ms render (120Hz frame); ≤16ms worst case |
| Frame budget under multi-agent load | 8.33ms (120fps target, 60fps floor) |
| Palette open, tab switch, panel toggle | <50ms |
| Any local action feedback (optimistic) | <100ms |
| First streamed token after send | <1s (else skeleton) |
| Markdown re-parse cadence | 50–100ms debounce, incremental |
| File tree / thread list / diff scroll | virtualized, O(visible rows) |
| Checkpoint restore | <500ms perceived (optimistic + background git) |
| Loading states | none <100ms; spinner <1s; skeleton for panels |

**Strategic reads**: (1) generation speed is largely solved — the moat is **review throughput UX**; (2) permissions = classifier-backed ladder with receipts; (3) native GPU rendering is the biggest feel differentiator; on web, canvas/WebGPU is now viable; (4) trust is built with legible agent state, editable plans, checkpoints — destroyed by hangs, wandering edits, opaque billing.

## Key sources

cursor.com/blog/2-0 · zed.dev/blog/parallel-agents · zed.dev/docs/ai/agent-panel · anthropic.com/engineering/claude-code-auto-mode · code.claude.com/docs/en/permission-modes · docs.windsurf.com/windsurf/previews · zed.dev/blog/videogame · zed.dev/blog/120fps · performance.dev Linear breakdown · developer.chrome.com/docs/ai/render-llm-responses · nngroup.com response-time limits · danluu.com/term-latency · pavelfatin.com/typing-with-pleasure · cursor.com/docs/configuration/migrations/vscode · code.visualstudio.com/blogs/2026/06/18/byok-vscode
