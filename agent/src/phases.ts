/**
 * Royal Mode 2.0 — Stage B: phase-machine state + pure helpers.
 *
 * Design source: `docs/research/12-royal-mode-2-agentic-architecture.md`
 * ("Target architecture" / "Phase enforcement mechanics" / "Pitfalls"
 * sections). This module deliberately holds only TYPES and PURE FUNCTIONS —
 * no I/O, no provider calls, no tool execution. The actual orchestration
 * (calling `runPromptLoop` per phase, wiring the special-cased phase tools
 * into the dispatch loop, checkpoint/rewind, live UI notifications) lives in
 * `loop.ts`'s `runRoyalPhaseTurn`, mirroring how `verify.ts` holds the pure
 * VerificationSpec/runVerification primitives while `loop.ts` owns the
 * `declare_done` orchestration built on top of them.
 *
 * Scope, precisely, per the task this was built for:
 *  - REAL: INTAKE's trivial/non-trivial short-circuit, the RECON+PLAN
 *    artifacts (planDoc, task list, VerificationSpec via Stage A's
 *    `set_verification_spec`), sequential EXECUTE task iteration
 *    (dependency-ordered), the VERIFY/FIX(<=2 rounds)/REWIND(<=2 plan
 *    re-entries) loop with a real, checkpoint-based file revert on rewind.
 *  - STUBBED/DEFERRED (documented, not silently skipped): parallel
 *    implementer subagents in EXECUTE (the design doc explicitly allows this
 *    to remain sequential-only for this pass — git-worktree isolation for
 *    concurrent writers is a separate, harder problem called out in doc 12);
 *    the `amend_verification_spec` tamper-watch tool (not in this pass's
 *    required build list — the freeze is instead enforced by simply never
 *    offering `set_verification_spec` in the schema once a spec exists,
 *    except for the one exception below).
 *  - DELIBERATE, DOCUMENTED SOFTENING (not a silent gap): the INTAKE-trivial
 *    short-circuit is allowed to reach VERIFY with NO VerificationSpec ever
 *    set (mirroring the doc's own "don't force planning overhead on small
 *    tasks" principle onto verification overhead for the same tiny tasks) —
 *    see `PhaseState.viaTrivialIntake` and `verifyOutcomeForNoSpec` below.
 *    Every OTHER path (RECON->PLAN) makes a VerificationSpec mandatory:
 *    `validateSubmitPlanInput` refuses `submit_plan` if none is set yet.
 */

export type PhaseName = "intake" | "recon" | "plan" | "execute" | "verify" | "fix" | "rewind" | "done";

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export interface PhaseTask {
  id: string;
  title: string;
  files: string[];
  dependsOn: string[];
  doneWhen: string;
  status: TaskStatus;
  /** Set once EXECUTE has processed this task (whether via complete_task or a silent non-confirmation). */
  summary?: string;
}

/** Cap on tasks a single `submit_plan` call may introduce — mirrors `dispatch_subtasks`' MAX_SUBTASKS_PER_CALL-style bound, keeping EXECUTE (and thus the whole phase machine) provably finite. */
export const MAX_PLAN_TASKS = 12;
/** Hard cap on FIX rounds against the SAME failing verification result before REWIND — the primary runaway-loop defense (doc 12 "Pitfalls"). */
export const MAX_FIX_ROUNDS = 2;
/** Hard cap on total PLAN re-entries (i.e. REWIND events) before the turn ends with an honest failure report instead of looping forever. */
export const MAX_PLAN_REENTRIES = 2;

export interface PhaseVerificationResult {
  passed: boolean;
  results: { cmd: string; passed: boolean; exitCode: number | null; durationMs: number; output: string }[];
  /** Set when this result was synthesized by the phase machine itself rather than a real `runVerification` call (e.g. "no spec set" cases) — never set for a real check run. */
  note?: string;
}

export interface PhaseState {
  phase: PhaseName;
  taskList: PhaseTask[];
  currentTaskId?: string;
  planDoc?: string;
  /** True iff EXECUTE was entered via INTAKE's trivial short-circuit (no RECON/PLAN ever ran) — see this module's doc comment on the VERIFY softening this enables. */
  viaTrivialIntake: boolean;
  fixRound: number;
  planReentries: number;
  /** Shadow-git sha captured immediately before EXECUTE's first task starts (whichever phase led there) — the REWIND target and the "diff since plan" baseline for the final evidence report. `null` when the checkpoint mechanism itself failed/was unavailable (large-repo guard etc.) — REWIND is then a no-op-but-honest "cannot revert" rather than a crash. */
  planBaselineSha: string | null;
  /** Plain-text failure summaries carried across FIX rounds and REWIND->PLAN re-entries, newest last — injected into the next relevant phase turn's directive so it "learns" instead of repeating the same failure blind. */
  failureHistory: string[];
  lastVerification?: PhaseVerificationResult;
}

export function initialPhaseState(): PhaseState {
  return {
    phase: "intake",
    taskList: [],
    viaTrivialIntake: false,
    fixRound: 0,
    planReentries: 0,
    planBaselineSha: null,
    failureHistory: [],
  };
}

/** `lakshx/phase_state` notification payload — see `LoopCallbacks.onPhaseState` (loop.ts). */
export interface PhaseStateSnapshot {
  phase: PhaseName;
  taskList: PhaseTask[];
  currentTaskId?: string;
  fixRound: number;
  planReentries: number;
  verificationResult?: PhaseVerificationResult;
  note?: string;
}

export function snapshotPhaseState(state: PhaseState, note?: string): PhaseStateSnapshot {
  return {
    phase: state.phase,
    taskList: state.taskList,
    currentTaskId: state.currentTaskId,
    fixRound: state.fixRound,
    planReentries: state.planReentries,
    verificationResult: state.lastVerification,
    note,
  };
}

// ---------------------------------------------------------------------------
// submit_intake
// ---------------------------------------------------------------------------

export type SubmitIntakeInput =
  | { ok: true; trivial: false; reason: string }
  | { ok: true; trivial: true; onelinePlan: string; reason: string }
  | { ok: false; error: string };

export function parseSubmitIntakeInput(input: any): SubmitIntakeInput {
  if (!input || typeof input !== "object" || typeof input.trivial !== "boolean") {
    return { ok: false, error: '"trivial" must be a boolean.' };
  }
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : "(no reason given)";
  if (!input.trivial) return { ok: true, trivial: false, reason };
  const onelinePlan = typeof input.onelinePlan === "string" ? input.onelinePlan.trim() : "";
  if (!onelinePlan) {
    return { ok: false, error: 'trivial=true requires a non-empty "onelinePlan" — the one-line plan EXECUTE will carry out.' };
  }
  return { ok: true, trivial: true, onelinePlan, reason };
}

/** Deterministic id for the single task an INTAKE-trivial short-circuit creates. */
export const TRIVIAL_TASK_ID = "t1";

export function taskListForTrivialIntake(onelinePlan: string): PhaseTask[] {
  return [{ id: TRIVIAL_TASK_ID, title: onelinePlan, files: [], dependsOn: [], doneWhen: "the change satisfies the request", status: "pending" }];
}

// ---------------------------------------------------------------------------
// submit_plan
// ---------------------------------------------------------------------------

export type SubmitPlanInput =
  | { ok: true; planDoc: string; tasks: PhaseTask[]; truncatedNote?: string }
  | { ok: false; error: string };

/** `hasVerificationSpec` — the caller (loop.ts) passes `!!session.verificationSpec` so this stays a pure function. */
export function parseSubmitPlanInput(input: any, hasVerificationSpec: boolean): SubmitPlanInput {
  if (!hasVerificationSpec) {
    return {
      ok: false,
      error: "No VerificationSpec is set yet — call set_verification_spec first to establish what \"done\" means, then call submit_plan again. The plan and its verification bar are established together.",
    };
  }
  if (!input || typeof input !== "object" || typeof input.planDoc !== "string" || !input.planDoc.trim()) {
    return { ok: false, error: '"planDoc" must be a non-empty string.' };
  }
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    return { ok: false, error: '"tasks" must be a non-empty array.' };
  }
  let truncatedNote: string | undefined;
  let rawTasks = input.tasks;
  if (rawTasks.length > MAX_PLAN_TASKS) {
    truncatedNote = `Note: ${rawTasks.length} tasks were submitted but only the first ${MAX_PLAN_TASKS} are kept (task-list cap) — break the rest into a follow-up plan if needed.`;
    rawTasks = rawTasks.slice(0, MAX_PLAN_TASKS);
  }
  const seen = new Set<string>();
  const tasks: PhaseTask[] = [];
  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i];
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !t.id.trim()) {
      return { ok: false, error: `tasks[${i}]: "id" must be a non-empty string.` };
    }
    if (typeof t.title !== "string" || !t.title.trim()) {
      return { ok: false, error: `tasks[${i}]: "title" must be a non-empty string.` };
    }
    if (typeof t.doneWhen !== "string" || !t.doneWhen.trim()) {
      return { ok: false, error: `tasks[${i}]: "doneWhen" must be a non-empty string.` };
    }
    if (seen.has(t.id)) return { ok: false, error: `tasks[${i}]: duplicate task id "${t.id}".` };
    seen.add(t.id);
    tasks.push({
      id: t.id,
      title: t.title,
      files: Array.isArray(t.files) ? t.files.filter((f: unknown) => typeof f === "string") : [],
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d: unknown) => typeof d === "string") : [],
      doneWhen: t.doneWhen,
      status: "pending",
    });
  }
  return { ok: true, planDoc: input.planDoc, tasks, truncatedNote };
}

// ---------------------------------------------------------------------------
// complete_task
// ---------------------------------------------------------------------------

export type CompleteTaskInput = { ok: true; taskId: string; summary?: string } | { ok: false; error: string };

export function parseCompleteTaskInput(input: any): CompleteTaskInput {
  if (!input || typeof input !== "object" || typeof input.taskId !== "string" || !input.taskId.trim()) {
    return { ok: false, error: '"taskId" must be a non-empty string.' };
  }
  return { ok: true, taskId: input.taskId, summary: typeof input.summary === "string" ? input.summary : undefined };
}

// ---------------------------------------------------------------------------
// EXECUTE task ordering
// ---------------------------------------------------------------------------

/**
 * Dependency-respecting order for EXECUTE: a simple repeated-pass topological
 * sort (Kahn's algorithm without the queue optimization — the task lists
 * here are capped at MAX_PLAN_TASKS, so an O(n^2) pass is irrelevant). Falls
 * back to the plan's own array order for any tasks left over once no more
 * progress can be made (an unsatisfiable/cyclic dependsOn graph, or a
 * dependsOn referencing an id outside this list) — provably terminates
 * either way, never hangs waiting for a dependency that can't resolve.
 */
export function orderTasks(tasks: PhaseTask[]): PhaseTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const done = new Set<string>();
  const remaining = new Map(tasks.map((t) => [t.id, t]));
  const ordered: PhaseTask[] = [];
  while (remaining.size > 0) {
    let progressed = false;
    for (const t of tasks) {
      if (!remaining.has(t.id)) continue;
      const blockers = t.dependsOn.filter((d) => byId.has(d) && !done.has(d));
      if (blockers.length === 0) {
        ordered.push(t);
        done.add(t.id);
        remaining.delete(t.id);
        progressed = true;
      }
    }
    if (!progressed) {
      // Cycle (or otherwise unsatisfiable) — append whatever's left in its
      // original relative order rather than looping forever.
      for (const t of tasks) if (remaining.has(t.id)) ordered.push(t);
      break;
    }
  }
  return ordered;
}

export function nextPendingTask(state: PhaseState): PhaseTask | undefined {
  const ordered = orderTasks(state.taskList);
  return ordered.find((t) => t.status === "pending");
}

export function allTasksSettled(state: PhaseState): boolean {
  return state.taskList.every((t) => t.status !== "pending" && t.status !== "in_progress");
}

// ---------------------------------------------------------------------------
// VERIFY outcome for the "no spec was ever set" case (INTAKE-trivial path)
// ---------------------------------------------------------------------------

/**
 * What VERIFY reports when `session.verificationSpec` is unset. Per this
 * module's doc comment: ONLY the INTAKE-trivial short-circuit can reach
 * VERIFY without a spec (`submit_plan` refuses to run without one on every
 * other path), so this is a narrow, explicit softening, not a general
 * "missing spec = pass" rule — `passed` is `viaTrivialIntake` verbatim, never
 * unconditionally `true`.
 */
export function verifyOutcomeForNoSpec(viaTrivialIntake: boolean): PhaseVerificationResult {
  return {
    passed: viaTrivialIntake,
    results: [],
    note: viaTrivialIntake
      ? "No verification spec was set (trivial request, short-circuited to EXECUTE) — task completion accepted as-is, no mechanical re-check ran."
      : "No verification spec was set for this session — cannot confirm the work is done.",
  };
}

// ---------------------------------------------------------------------------
// Directive text builders — the harness-authored, phase-scoped instructions
// injected as this phase-turn's user message. Framed with the SAME bracketed
// "[System note — ...]" convention loop.ts's own mode-switch reminder uses
// (not bare prepended prose) so the model reads these as harness-authored
// directives, never as the human's own words.
// ---------------------------------------------------------------------------

export function intakeDirective(userText: string): string {
  return (
    `[System note — ROYAL MODE PHASE MACHINE: INTAKE. Classify this request cheaply — at most a couple of quick ` +
    `read_file/list_dir/grep calls if you genuinely need them — then call submit_intake exactly once. Do not start ` +
    `implementing anything yet.]\n\n${userText}`
  );
}

export function reconPlanDirective(userText: string, failureHistory: string[]): string {
  const history = failureHistory.length
    ? `\n\nPrior attempt(s) at this request failed verification and were rewound — learn from them:\n${failureHistory.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
    : "";
  return (
    `[System note — ROYAL MODE PHASE MACHINE: RECON + PLAN (read-only). Research the codebase (dispatch_subtasks is ` +
    `available for parallel read-only exploration — reach for it for genuinely independent investigations). Then call ` +
    `set_verification_spec with the real verify command(s) for this project, and submit_plan with your rationale and a ` +
    `dependency-ordered task list. No writes or commands execute in this phase beyond dispatch_subtasks' own children ` +
    `(which run in whatever mode you gave them, but read-only tools are what's offered here).]${history}\n\n${userText}`
  );
}

export function executeDirective(task: PhaseTask, needsSpec: boolean): string {
  const files = task.files.length ? ` Files likely involved: ${task.files.join(", ")}.` : "";
  const specNote = needsSpec
    ? " You have not set a VerificationSpec yet — call set_verification_spec with the real verify command(s) for this project before (or right after) implementing this task."
    : "";
  return (
    `[System note — ROYAL MODE PHASE MACHINE: EXECUTE, task ${task.id}. Implement: ${task.title}.${files} Done when: ` +
    `${task.doneWhen}. Run a quick relevant check if it's cheap (typecheck/lint/a focused test). When finished (or ` +
    `genuinely blocked), call complete_task {taskId: "${task.id}", summary}.${specNote}]`
  );
}

export function fixDirective(round: number, verification: PhaseVerificationResult): string {
  const lines = verification.results.map(
    (r) => `- ${r.cmd}: ${r.passed ? "PASS" : "FAIL"} (exit ${r.exitCode ?? "?"}, ${r.durationMs}ms)${r.passed ? "" : `\n  output:\n${r.output}`}`,
  );
  return (
    `[System note — ROYAL MODE PHASE MACHINE: FIX, round ${round}/${MAX_FIX_ROUNDS}. Verification against the frozen ` +
    `spec failed:\n${lines.join("\n") || verification.note || "(no detail)"}\n\nFix the failure(s) above. The ` +
    `verification spec is frozen for this round — you cannot change what "done" means, only make the real checks pass. ` +
    `This is round ${round} of ${MAX_FIX_ROUNDS} before the harness reverts to the plan baseline and re-plans.]`
  );
}

export function rewindNote(round: number, verification: PhaseVerificationResult): string {
  const failing = verification.results.filter((r) => !r.passed).map((r) => r.cmd);
  const what = failing.length ? failing.join(", ") : verification.note ?? "verification";
  return `Attempt ${round}: after ${MAX_FIX_ROUNDS} fix round(s), still failing (${what}) — reverted to the plan baseline and re-planning.`;
}

export function terminalFailureReport(state: PhaseState): string {
  const v = state.lastVerification;
  const lines = (v?.results ?? []).map((r) => `- ${r.cmd}: ${r.passed ? "PASS" : "FAIL"}`);
  return (
    `Could not verify a working solution after ${state.planReentries} re-plan attempt(s) (cap reached).\n` +
    `Last verification result:\n${lines.join("\n") || v?.note || "(none)"}\n\n` +
    `Failure history:\n${state.failureHistory.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n` +
    `Files were reverted to the last plan baseline on each rewind — the workspace is at that state now.`
  );
}

export function successReport(state: PhaseState, changedFiles: string[]): string {
  const v = state.lastVerification!;
  const lines = v.results.map((r) => `- ${r.cmd}: PASS (exit ${r.exitCode ?? 0}, ${r.durationMs}ms)`);
  const filesLine = changedFiles.length ? `Files changed: ${changedFiles.join(", ")}` : "No files changed.";
  const checkLines = lines.length ? lines.join("\n") : v.note ?? "(no mechanical checks ran)";
  return `Verification passed. ${filesLine}\n${checkLines}`;
}
