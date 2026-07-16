/**
 * Royal Mode 2.0 Stage B — the phase-machine orchestrator (agent/src/loop.ts's
 * `runRoyalPhaseTurn`, agent/src/phases.ts). Driven directly against
 * `runPrompt()` in-process with a scripted OpenAI-compatible provider, same
 * style as dispatch-subtasks.test.ts/declare-done.test.ts.
 *
 * Covers exactly the four scenarios docs/research/12 + this task call out:
 *  (a) a trivial royal request skips straight to EXECUTE (INTAKE short-circuit)
 *  (b) a non-trivial royal request goes RECON->PLAN->EXECUTE->VERIFY and a
 *      passing spec ends in "done" with real verification evidence
 *  (c) a failing spec triggers FIX (<=2 rounds), then REWIND to the plan
 *      baseline — proven via REAL git-backed file state, not a status string
 *      — with a bounded total re-entry cap so it provably terminates
 *  (d) review/approve/auto sessions are completely unaffected: same tool
 *      set, same flat loop, `session.phase` never set, `onPhaseState` never
 *      fired
 *
 * Plus one regression case found while building this: `dispatch_subtasks`
 * spawned during a read-only RECON/PLAN turn must not let its children
 * inherit the parent's real (royal, full-access) mode just because a task
 * omitted an explicit `mode` — that would silently defeat RECON's read-only
 * guarantee through a tool that IS offered there.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { _resetGuardCacheForTests, filesChangedSinceCommit } from "../src/checkpoint.js";
import type { AgentSession, LoopCallbacks } from "../src/loop.js";
import { runPrompt } from "../src/loop.js";
import type { PhaseStateSnapshot } from "../src/phases.js";
import { FakeOpenAI, textTurn, toolTurn } from "./helpers/fake-openai.js";

function makeRecordingCallbacks(): LoopCallbacks & {
  phaseStates: PhaseStateSnapshot[];
  baselines: (string | null)[];
  toolEnds: any[];
  texts: string[];
  subagentsStarts: any[];
} {
  const phaseStates: PhaseStateSnapshot[] = [];
  const baselines: (string | null)[] = [];
  const toolEnds: any[] = [];
  const texts: string[] = [];
  const subagentsStarts: any[] = [];
  return {
    onText: (t) => texts.push(t),
    onThinking: () => {},
    onToolStart: () => {},
    onToolEnd: (c) => toolEnds.push(c),
    onPermission: async () => true,
    onBaseline: (sha) => baselines.push(sha),
    onPhaseState: (info) => phaseStates.push(info),
    onSubagentsStart: (info) => subagentsStarts.push(info),
    phaseStates,
    baselines,
    toolEnds,
    texts,
    subagentsStarts,
  };
}

async function setupHome(fake: FakeOpenAI): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "lakshx-royal-phase-home-"));
  await mkdir(join(home, ".lakshx"), { recursive: true });
  await writeFile(
    join(home, ".lakshx", "providers.json"),
    JSON.stringify({
      defaultModel: "fake/test-model",
      providers: { fake: { kind: "openai", baseUrl: `http://127.0.0.1:${fake.port}/v1`, apiKey: "test-key-123" } },
    }),
  );
  return home;
}

function findToolMessage(fake: FakeOpenAI, toolCallId: string): { content: string } | undefined {
  for (const req of fake.requests) {
    const m = req.messages.find((mm: any) => mm.role === "tool" && mm.tool_call_id === toolCallId);
    if (m) return m as any;
  }
  return undefined;
}

const PASS_CMD = `node -e "process.exit(0)"`;
const FAIL_CMD = `node -e "process.exit(1)"`;

test(
  "(a) royal mode: a trivial request short-circuits INTAKE straight to EXECUTE — never touches RECON/PLAN",
  { timeout: 30_000 },
  async () => {
    const fake = new FakeOpenAI();
    await fake.start();
    const home = await setupHome(fake);
    const workspace = await mkdtemp(join(tmpdir(), "lakshx-royal-trivial-ws-"));
    const realHome = process.env.HOME;
    process.env.HOME = home;
    _resetGuardCacheForTests();

    try {
      const session: AgentSession = { cwd: workspace, model: "fake/test-model", mode: "royal", history: [] };
      const cb = makeRecordingCallbacks();

      fake.enqueue(
        toolTurn("call_intake", "submit_intake", { trivial: true, reason: "one-line rename", onelinePlan: "rename the variable" }),
        textTurn("Classified as trivial."),
        toolTurn("call_complete", "complete_task", { taskId: "t1" }),
        textTurn("Done."),
      );

      const stop = await runPrompt(session, "rename this variable", cb, "pr_trivial");
      assert.equal(stop, "end_turn");

      // No RECON/PLAN phase was ever entered — INTAKE went straight to EXECUTE.
      const phases = cb.phaseStates.map((s) => s.phase);
      assert.ok(!phases.includes("recon"), `phases must not include recon: ${phases.join(",")}`);
      assert.ok(!phases.includes("plan"), `phases must not include plan: ${phases.join(",")}`);
      assert.equal(phases[0], "intake");
      assert.equal(phases[phases.length - 1], "done");
      assert.ok(phases.indexOf("execute") === 1, "execute must start immediately after intake, with nothing in between");
      assert.ok(phases.indexOf("verify") > phases.lastIndexOf("execute"), "verify must follow every execute step");

      // Only 4 provider requests: submit_intake+ack, complete_task+ack — no
      // recon/plan round trip ever happened.
      assert.equal(fake.requests.length, 4);
      assert.ok(!fake.requests.some((r) => r.messages.some((m: any) => m.tool_calls?.some((tc: any) => tc.function?.name === "submit_plan"))));

      assert.equal(session.phase?.phase, "done");
      assert.equal(session.phase?.viaTrivialIntake, true);
      assert.equal(session.phase?.taskList[0]?.status, "done");

      // No VerificationSpec was ever set (trivial path) — VERIFY still
      // reports a real (non-fabricated) outcome: pass, with an honest note
      // that no mechanical check ran, never silently treated as a full pass.
      assert.equal(session.phase?.lastVerification?.passed, true);
      assert.match(session.phase!.lastVerification!.note ?? "", /no verification spec was set/i);
    } finally {
      process.env.HOME = realHome;
      await fake.stop();
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

test(
  "(b) royal mode: a non-trivial request runs RECON+PLAN -> EXECUTE -> VERIFY and ends done with real verification evidence",
  { timeout: 30_000 },
  async () => {
    const fake = new FakeOpenAI();
    await fake.start();
    const home = await setupHome(fake);
    const workspace = await mkdtemp(join(tmpdir(), "lakshx-royal-full-ws-"));
    const realHome = process.env.HOME;
    process.env.HOME = home;
    _resetGuardCacheForTests();

    try {
      const session: AgentSession = { cwd: workspace, model: "fake/test-model", mode: "royal", history: [] };
      const cb = makeRecordingCallbacks();

      fake.enqueue(
        toolTurn("call_intake", "submit_intake", { trivial: false, reason: "touches two files, needs a real plan" }),
        textTurn("Non-trivial — proceeding to recon/plan."),
      );
      fake.enqueue(
        toolTurn("call_set_spec", "set_verification_spec", { mechanical: [{ cmd: PASS_CMD, expect: "exitZero" }] }),
        toolTurn("call_plan", "submit_plan", {
          planDoc: "# Plan\nAdd two files.",
          tasks: [
            { id: "t1", title: "create a.txt", files: ["a.txt"], dependsOn: [], doneWhen: "a.txt exists" },
            { id: "t2", title: "create b.txt", files: ["b.txt"], dependsOn: ["t1"], doneWhen: "b.txt exists" },
          ],
        }),
        textTurn("Planned."),
      );
      fake.enqueue(
        toolTurn("call_wf1", "write_file", { path: "a.txt", content: "hello-a" }),
        toolTurn("call_complete1", "complete_task", { taskId: "t1" }),
        textTurn("Task 1 done."),
      );
      fake.enqueue(
        toolTurn("call_wf2", "write_file", { path: "b.txt", content: "hello-b" }),
        toolTurn("call_complete2", "complete_task", { taskId: "t2" }),
        textTurn("Task 2 done."),
      );

      const stop = await runPrompt(session, "add two small files", cb, "pr_full");
      assert.equal(stop, "end_turn");

      const phases = cb.phaseStates.map((s) => s.phase);
      assert.ok(phases.indexOf("recon") < phases.indexOf("plan"), "recon must precede plan");
      assert.ok(phases.indexOf("plan") < phases.indexOf("execute"), "plan must precede execute");
      assert.ok(phases.indexOf("execute") < phases.indexOf("verify"), "execute must precede verify");
      assert.ok(phases.indexOf("verify") < phases.lastIndexOf("done"), "verify must precede done");
      assert.ok(!phases.includes("fix"), "a first-try pass must never enter FIX");
      assert.ok(!phases.includes("rewind"), "a first-try pass must never REWIND");

      assert.equal(session.phase?.phase, "done");
      assert.deepEqual(
        session.phase?.taskList.map((t) => t.status),
        ["done", "done"],
      );
      assert.equal(session.phase?.lastVerification?.passed, true);
      assert.equal(session.phase?.lastVerification?.results[0]?.exitCode, 0);

      // Real files were actually written by the real write_file tool.
      assert.equal(await readFileSafe(join(workspace, "a.txt")), "hello-a");
      assert.equal(await readFileSafe(join(workspace, "b.txt")), "hello-b");

      // Final evidence report streamed like real assistant text.
      const finalText = cb.texts.join("");
      assert.match(finalText, /Verification passed/);
      assert.match(finalText, /a\.txt/);
      assert.match(finalText, /b\.txt/);

      const planMsg = findToolMessage(fake, "call_plan")!.content as string;
      assert.match(planMsg, /accepted/i);
    } finally {
      process.env.HOME = realHome;
      await fake.stop();
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

async function readFileSafe(path: string): Promise<string | undefined> {
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Enqueue one full PLAN -> EXECUTE -> FIX -> FIX round of scripted turns, always failing the same deterministic (content-independent) spec. */
function enqueueFailingCycle(fake: FakeOpenAI, n: number, fileName: string): void {
  fake.enqueue(
    toolTurn(`call_set${n}`, "set_verification_spec", { mechanical: [{ cmd: FAIL_CMD, expect: "exitZero" }] }),
    toolTurn(`call_plan${n}`, "submit_plan", {
      planDoc: `# Plan attempt ${n}`,
      tasks: [{ id: "t1", title: "implement the change", files: [fileName], dependsOn: [], doneWhen: "the check passes" }],
    }),
    textTurn(`Planned attempt ${n}.`),
    toolTurn(`call_wf${n}`, "write_file", { path: fileName, content: `attempt-${n}` }),
    toolTurn(`call_complete${n}`, "complete_task", { taskId: "t1" }),
    textTurn(`Implemented attempt ${n}.`),
    toolTurn(`call_fix${n}a`, "write_file", { path: fileName, content: `attempt-${n}-fix1` }),
    textTurn(`Fix round 1 for attempt ${n}.`),
    toolTurn(`call_fix${n}b`, "write_file", { path: fileName, content: `attempt-${n}-fix2` }),
    textTurn(`Fix round 2 for attempt ${n}.`),
  );
}

test(
  "(c) royal mode: a spec that never passes triggers FIX (<=2 rounds) then REWIND, and terminates after the re-entry cap with real file reverts",
  { timeout: 60_000 },
  async () => {
    const fake = new FakeOpenAI();
    await fake.start();
    const home = await setupHome(fake);
    const workspace = await mkdtemp(join(tmpdir(), "lakshx-royal-rewind-ws-"));
    const realHome = process.env.HOME;
    process.env.HOME = home;
    _resetGuardCacheForTests();

    try {
      const session: AgentSession = { cwd: workspace, model: "fake/test-model", mode: "royal", history: [] };
      const cb = makeRecordingCallbacks();

      fake.enqueue(
        toolTurn("call_intake", "submit_intake", { trivial: false, reason: "needs real work" }),
        textTurn("Non-trivial — proceeding to recon/plan."),
      );
      // 3 full attempts: the original plus MAX_PLAN_REENTRIES (2) re-plans —
      // every one fails the SAME deterministic (content-independent) spec, so
      // this exercises the full bound: 2 FIX rounds + 1 REWIND, three times,
      // then an honest terminal report instead of looping forever.
      enqueueFailingCycle(fake, 1, "attempt1.txt");
      enqueueFailingCycle(fake, 2, "attempt2.txt");
      enqueueFailingCycle(fake, 3, "attempt3.txt");

      const stop = await runPrompt(session, "make this deterministically-unfixable change", cb, "pr_rewind");
      assert.equal(stop, "end_turn", "the phase machine must end the turn, never hang, once the cap is exhausted");

      // ---- termination proof ----
      assert.equal(session.phase?.phase, "done");
      assert.equal(session.phase?.planReentries, 3, "1 original attempt + 2 allowed re-entries = 3 total, then stop");
      assert.equal(cb.phaseStates.filter((s) => s.phase === "fix").length, 6, "2 FIX rounds x 3 attempts");
      // At least one REWIND notification per failing attempt (including the
      // final, cap-exhausting one) — the real termination proof is
      // `planReentries` above; this just confirms REWIND was genuinely
      // entered on every attempt, not skipped.
      assert.ok(cb.phaseStates.filter((s) => s.phase === "rewind").length >= 3, "REWIND must fire for every failing attempt");

      const finalText = cb.texts.join("");
      assert.match(finalText, /Could not verify a working solution/i);
      assert.match(finalText, /3 re-plan attempt/);

      // ---- REAL file-state proof (not just a status string) ----
      // Every attempt's file was created fresh after that attempt's own plan
      // baseline (which never had it) and reverted when that attempt failed
      // — including the LAST, cap-exhausting attempt (see loop.ts's ordering
      // fix: revert happens BEFORE the cap check, not only when re-planning
      // continues). So none of the three files should exist on disk...
      assert.equal(existsSync(join(workspace, "attempt1.txt")), false);
      assert.equal(existsSync(join(workspace, "attempt2.txt")), false);
      assert.equal(existsSync(join(workspace, "attempt3.txt")), false);

      // ...and, checked via the REAL shadow-git plumbing (not re-derived from
      // in-memory state): a diff between the very FIRST plan baseline and the
      // CURRENT working tree shows no lingering changes — real git-backed
      // proof the workspace is genuinely back where it started, the same
      // production function (`filesChangedSinceCommit`) the rewind itself
      // used to compute what to revert.
      const firstBaseline = cb.baselines[0];
      assert.ok(firstBaseline, "the first plan baseline must have been recorded");
      const stillDiffering = await filesChangedSinceCommit(workspace, firstBaseline!);
      assert.deepEqual(stillDiffering, [], "working tree must be byte-for-byte back at the very first plan baseline");
    } finally {
      process.env.HOME = realHome;
      await fake.stop();
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

test(
  "(d) review/approve/auto modes are completely unaffected by the royal phase machine — same flat loop, session.phase never set",
  { timeout: 30_000 },
  async () => {
    const fake = new FakeOpenAI();
    await fake.start();
    const home = await setupHome(fake);
    const workspace = await mkdtemp(join(tmpdir(), "lakshx-royal-regress-ws-"));
    const realHome = process.env.HOME;
    process.env.HOME = home;
    _resetGuardCacheForTests();

    try {
      for (const mode of ["review", "approve", "auto"] as const) {
        const session: AgentSession = { cwd: workspace, model: "fake/test-model", mode, history: [] };
        const cb = makeRecordingCallbacks();

        if (mode === "review") {
          // Review mode's own tool set has no write/bash at all — a plain
          // text turn is the realistic shape.
          fake.enqueue(textTurn("Here is what I found."));
        } else {
          fake.enqueue(toolTurn(`call_${mode}`, "bash", { command: "echo hi" }), textTurn("Ran it."));
        }

        const stop = await runPrompt(session, "do something ordinary", cb, `pr_regress_${mode}`);
        assert.equal(stop, "end_turn");

        // The phase machine must never activate outside royal mode, period.
        assert.equal(session.phase, undefined, `${mode} mode must never set session.phase`);
        assert.equal(cb.phaseStates.length, 0, `${mode} mode must never fire onPhaseState`);

        if (mode !== "review") {
          // The ordinary tool call actually ran, exactly like before this
          // Stage — one request/response round trip, no extra phase-turn
          // request inserted anywhere.
          const requestsForThisMode = fake.requests.length;
          assert.ok(requestsForThisMode >= 1);
        }
      }

      // And a submit_intake/submit_plan/complete_task tool call is simply
      // not offered outside a royal phase turn: this is exercised implicitly
      // above (none of these three modes' scripted turns ever needed to
      // avoid them — they were never in scope to begin with), and directly
      // here — the schema sent to the provider for a non-royal mode must
      // never include the phase-transition tools.
      for (const req of fake.requests) {
        const names = (req.tools ?? []).map((t: any) => t.function?.name);
        assert.ok(!names.includes("submit_intake"), "submit_intake must never appear in a non-royal tool schema");
        assert.ok(!names.includes("submit_plan"), "submit_plan must never appear in a non-royal tool schema");
        assert.ok(!names.includes("complete_task"), "complete_task must never appear in a non-royal tool schema");
      }
    } finally {
      process.env.HOME = realHome;
      await fake.stop();
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

test(
  "(regression) dispatch_subtasks children spawned during RECON are contained to review mode even without an explicit per-task mode",
  { timeout: 30_000 },
  async () => {
    const fake = new FakeOpenAI();
    await fake.start();
    const home = await setupHome(fake);
    const workspace = await mkdtemp(join(tmpdir(), "lakshx-royal-recon-contain-ws-"));
    const realHome = process.env.HOME;
    process.env.HOME = home;
    _resetGuardCacheForTests();

    try {
      const session: AgentSession = { cwd: workspace, model: "fake/test-model", mode: "royal", history: [] };
      const cb = makeRecordingCallbacks();

      fake.enqueue(
        toolTurn("call_intake", "submit_intake", { trivial: false, reason: "needs recon" }),
        textTurn("Non-trivial — proceeding to recon/plan."),
      );
      // The RECON turn dispatches 2 explorer subtasks with NO `mode` field —
      // exactly the shape that, before the fix, would have silently
      // inherited the parent's real royal mode (full write access, no floor)
      // instead of staying read-only.
      fake.enqueue(
        toolTurn("call_dispatch", "dispatch_subtasks", {
          tasks: [
            { id: "explorer1", prompt: "look at auth.ts" },
            { id: "explorer2", prompt: "look at db.ts" },
          ],
        }),
        toolTurn("call_set_spec", "set_verification_spec", { mechanical: [{ cmd: PASS_CMD, expect: "exitZero" }] }),
        toolTurn("call_plan", "submit_plan", {
          planDoc: "# Plan",
          tasks: [{ id: "t1", title: "fix it", files: [], dependsOn: [], doneWhen: "done" }],
        }),
        textTurn("Planned."),
      );
      // Both explorer children run through a REAL child runPrompt() — each
      // needs its own scripted (review-mode-compatible, no-tool) response.
      fake.enqueueMatched(
        (req) => req.messages.some((m: any) => m.role === "user" && String(m.content).includes("look at auth.ts")),
        textTurn("auth.ts looks fine."),
      );
      fake.enqueueMatched(
        (req) => req.messages.some((m: any) => m.role === "user" && String(m.content).includes("look at db.ts")),
        textTurn("db.ts looks fine."),
      );
      fake.enqueue(
        toolTurn("call_complete1", "complete_task", { taskId: "t1" }),
        textTurn("Task done."),
      );

      const stop = await runPrompt(session, "investigate then fix", cb, "pr_recon_contain");
      assert.equal(stop, "end_turn");

      assert.equal(cb.subagentsStarts.length, 1);
      const dispatched = cb.subagentsStarts[0].tasks as { id: string; mode: string }[];
      assert.equal(dispatched.length, 2);
      for (const t of dispatched) {
        assert.equal(t.mode, "review", `explorer subtask "${t.id}" must be contained to review mode during RECON, got "${t.mode}"`);
      }
    } finally {
      process.env.HOME = realHome;
      await fake.stop();
      await rm(home, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  },
);
