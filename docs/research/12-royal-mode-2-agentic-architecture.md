# Royal Mode 2.0 — Phased Agentic Loop Architecture

Synthesis of three research passes (July 2026): competitive feature survey
(Claude Code / Cursor / Windsurf / Devin / Antigravity / Jules / Amp / Aider),
a full map of our current loop (`agent/src/`), and the state of the art in
autonomous agent-loop design (Anthropic multi-agent research system,
Cognition's "Don't Build Multi-Agents", Claude Code's Stop-gate pattern,
deterministic UI verification).

## The three findings that drive everything

1. **The 2026 baseline stack is converged**: subagents + slash commands +
   plan mode + checkpoints + memory. We have subagents and checkpoints;
   we lack slash commands, a real plan phase, and memory. Differentiation
   now lives in *verification* (browser proof, critics, judges) and
   *supervision UX* (live plans, artifacts, evidence reports).
2. **Our loop has no code-enforced phases.** "Plan" is a regex on a
   markdown heading; "verify before done" is prompt prose. The loop ends
   whenever the model stops calling tools. The model also never sees a
   browser screenshot (no image ContentBlock in the provider layer), and
   the browser tool is single-shot look-only.
3. **Parallelize reads, serialize writes.** Anthropic's 90% multi-agent
   win is on parallel *research*; Cognition's multi-agent failures are all
   parallel *writes*. Fan out explorer/verifier subagents freely; keep
   edits on the main thread unless the plan proves disjoint file sets
   (then: worktrees + integration task).

## Target architecture

A harness-owned state machine that wraps the existing `runPromptLoop`
(loop.ts:625) — royal mode only; other modes keep today's flat loop:

```
INTAKE → RECON → PLAN → [checkpoint: plan-ready] → EXECUTE (task loop)
      → VERIFY → { green → REPORT/DONE
                 | red   → FIX (≤2 rounds) → VERIFY
                 | still red → REWIND to last green checkpoint → PLAN(revise) }
```

- **INTAKE**: one cheap classification turn. Trivial request → skip
  straight to EXECUTE with a one-line plan (planning overhead on small
  tasks is pure waste).
- **RECON**: read-only tools + parallel `explorer` subagents answering
  framed questions; structured summaries only, raw dumps stay out of the
  orchestrator context.
- **PLAN**: three artifacts — PlanDoc (rationale), Task list
  (`{id, title, files[], dependsOn[], doneWhen}`), and a
  **VerificationSpec** frozen by content hash. Royal mode auto-approves,
  but the artifacts still stream to the UI and stay user-editable.
- **EXECUTE**: sequential task loop, micro-verify per task (typecheck /
  targeted tests), todo status streamed live, checkpoint per task.
  Parallel implementer subagents only for provably-disjoint DAG branches.
- **VERIFY**: the spec runs in cost order —
  1. *mechanical*: `{cmd, expect}` — build/tests/lint, pure code;
  2. *behavioral*: interactive browser drives the app deterministically
     (navigate/click/type/assert selectors/console clean vs allowlist);
  3. *visual*: screenshot + rubric → fresh-context critic subagent that
     never saw the implementation reasoning;
  4. *adversarial diff review*: reviewer subagent, correctness/requirement
     gaps only (style findings are noise).
  `declare_done` is a tool whose handler re-runs the verifier server-side —
  the model cannot assert green; only the harness observes it.
- **FIX**: max 2 rounds against the same failure set, then rewind to the
  last green checkpoint and re-plan with failure history injected. This is
  the runaway-loop defense.
- **REPORT**: evidence bundle over ACP — diff summary, test output,
  screenshots, critic verdicts, budget consumption.

### Phase enforcement mechanics

- `phase` field on the session; tool availability is phase-filtered using
  the same mechanism review mode already uses (loop.ts:603).
- Transitions happen via dedicated tools (`submit_plan`, `complete_task`,
  `declare_done`) validated by the dispatcher — the model cannot skip a
  phase because the tools to do so aren't in its schema.
- Plan state re-injected as a system reminder every N tool results
  (Claude Code's TodoWrite reinforcement trick — cheap, prevents drift).
- Budgets: global token/time/iteration caps + per-subagent budgets +
  no-progress detector (same failure N times → forced re-plan).
  Royal mode means no approval prompts, not no limits.
- Spec tamper watch: EXECUTE-phase edits that weaken the frozen
  VerificationSpec (test deletion, assertion removal) only via an explicit
  `amend_verification_spec` tool that logs justification.

### Subagent contract (upgrade of dispatch_subtasks)

`{id, role: explorer|implementer|verifier|critic, objective, boundaries,
expectedOutput (JSON schema), toolAllowlist, budget: {maxToolCalls},
worktree?}` — workers end with a `report_result` call validated against
the schema; large artifacts go to disk, only summaries return.

### Background subagents (Claude Code-style, user-requested)

Today `dispatch_subtasks` blocks the parent turn (`Promise.all`). Target:
non-blocking dispatch — the tool returns task ids immediately; the main
agent stays interactive (and the user can keep chatting) while children
run; completions land in a per-session notification queue drained into
the next turn as clearly-framed non-user context (or auto-wake an idle
session, budget-capped). Companion tools: `check_tasks`, `send_to_task`
(mid-flight steering), `wait_for_tasks` (explicit join). UI: persistent
running-agents tray generalizing the existing subagent batch cards.
Dedicated research pass in flight; design lands in Stage 2.

### Interactive browser (prerequisite)

Persistent browser session per prompt (not launch-per-call), keeping
browser.ts's loopback allowlist + route-guard unchanged. Action set
(a11y-tree-first, pixels for judgment): `navigate, snapshot (a11y tree
with element refs), click(ref), type(ref, text), scroll, screenshot,
read_console, read_network, evaluate, wait_for`. Screenshots become
model-visible via a new image ContentBlock (vision-capable models only).

## Implementation stages

1. **Stage 1a — browser interactivity + vision** (agent/src/browser.ts,
   tools.ts, providers/*): session-scoped browser, `browser_act` verbs,
   image ContentBlock through both provider adapters, model-capability
   gate. Independent of the frontend.
2. **Stage 1b — slash commands** (product/lakshx-chat/): `/` autocomplete
   popover cloned from the existing `@`-mention machinery; built-ins
   (/plan /royal /model /compact-style) + custom `.lakshx/commands/*.md`
   with $ARGUMENTS templating. Independent of agent/src.
3. **Stage 2 — the phase machine** (loop.ts, server.ts, store.ts,
   extension.js, panel.js): royal-mode state machine, VerificationSpec +
   verifier module, phase-filtered tools, transition tools, live plan
   surface (`lakshx/plan_state` notifications + webview checklist),
   subagent roles/contracts, budgets + no-progress detector, evidence
   report. Builds on Stage 1a's browser verbs for the behavioral tier.

Stages 1a and 1b touch disjoint files and run in parallel; Stage 2 is
sequential after 1a.

## Pitfalls we are explicitly defending against

Over-orchestration (INTAKE short-circuit), parallel writers without
isolation (worktrees or don't), context explosion (summaries only, phase-
boundary compaction), runaway verify-fix loops (2-round cap + rewind),
self-grading (fresh-context critics), verification gaming (frozen spec
hash + tamper watch), flaky gates (built server, console allowlists,
deterministic waits), critic over-engineering (correctness-only rubric).
