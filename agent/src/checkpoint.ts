/**
 * Shadow-git checkpointing — the single mechanism serving BOTH Royal mode's
 * passive safety net (doc 09 §3.3, `checkpointBeforeMutation`) and the
 * prompt-ID-granular checkpoint/undo feature (doc 11,
 * `docs/research/11-prompt-checkpoints-undo.md`).
 *
 * History: Royal mode landed first and needed a checkpoint primitive before
 * doc 11's fuller system existed, so `checkpointBeforeMutation` below was
 * originally written as a deliberately minimal, standalone version (single
 * commit per mutating tool call, no prompt-ID granularity, no locking, no
 * undo). Doc 11's implementation (this revision) extends the SAME module —
 * same `~/.koder/checkpoints/<hash>/shadow.git` location, same git-plumbing
 * helpers (`shadowPaths`, `git`, `ensureShadowRepo`) — rather than
 * duplicating a second shadow-git implementation. `checkpointBeforeMutation`
 * is untouched (Royal mode's tests already cover it); everything below is
 * additive.
 *
 * Two-kind commit model (doc 11 §2.3), for non-royal modes:
 *  1. `checkpointBaseline(cwd, promptId)` — once per prompt, before its first
 *     mutating tool runs.
 *  2. `commitAfterTool(cwd, promptId, toolCallId, toolName, path?)` — after
 *     every successful mutating tool call; returns `{sha, files}` where
 *     `files` is derived from `git diff --raw` against the previous shadow
 *     HEAD (doc 11 §2.4 — never from the tool's declared input path), with
 *     gitlink entries (mode 160000) filtered out (doc 11 §2.2/§2.4).
 *
 * Undo (doc 11 §4/§5): `undoFile`/`undoPaths` are path-scoped `git checkout
 * <sha> -- <paths>` calls, gated by `hasConflict` unless `force` is passed.
 * These are never called by the model — only by `koder/undo_file` /
 * `koder/undo_prompt` request handlers in `server.ts`, dispatched from a
 * user action.
 *
 * Safety guards carried in from doc 11: an exclusive lock file per workspace
 * (§2.5, cross-*process* concern — two windows on the same workspace, NOT an
 * intra-process concern since tool calls are already sequential) and a
 * >50k-tracked-files probe (§2.2) that disables checkpointing entirely for
 * huge workspaces rather than silently eating an unbounded per-call `git add
 * -A` cost.
 *
 * Failure here is always best-effort: a checkpoint/undo failure must never
 * crash a turn. Every exported function catches its own errors.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Same `~/.koder/checkpoints/<hash>/shadow.git` location doc 11 §2.1 specifies. */
function shadowPaths(cwd: string): { dir: string; gitDir: string } {
  const hash = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
  const dir = join(homedir(), ".koder", "checkpoints", hash);
  return { dir, gitDir: join(dir, "shadow.git") };
}

async function git(gitDir: string, worktree: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", [`--git-dir=${gitDir}`, `--work-tree=${worktree}`, ...args], {
    cwd: worktree,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** Idempotent: creates + configures the shadow repo on first use, no-ops after. */
async function ensureShadowRepo(cwd: string): Promise<string> {
  const worktree = resolve(cwd);
  const { dir, gitDir } = shadowPaths(worktree);
  if (existsSync(gitDir)) return gitDir;
  mkdirSync(dir, { recursive: true });
  // Explicit --git-dir only (matching doc 11 §2.2's explicit-flags style) — deliberately NOT
  // --separate-git-dir, which would drop a `.git` file into the user's own workspace.
  await execFileAsync("git", [`--git-dir=${gitDir}`, "init", "-q"]);
  await git(gitDir, worktree, ["config", "user.email", "royal-checkpoints@koder.local"]);
  await git(gitDir, worktree, ["config", "user.name", "koder-royal-checkpoints"]);
  return gitDir;
}

export interface CheckpointResult {
  sha: string | null;
}

/**
 * Commit the current workspace state to the shadow repo. Call this BEFORE a
 * mutating tool runs, in royal mode only. `label` is a short, human-readable
 * description of the upcoming action (tool name + a fragment of its input),
 * used only as the commit message — not parsed back by anything.
 *
 * Never throws: on any git/filesystem failure this returns `{ sha: null }`
 * so the caller can proceed with the (unblocked, per Royal's design) tool
 * call regardless.
 */
export async function checkpointBeforeMutation(cwd: string, label: string): Promise<CheckpointResult> {
  try {
    const worktree = resolve(cwd);
    const gitDir = await ensureShadowRepo(worktree);
    // Magic pathspec exclude, matching doc 11 §2.2's verified-safe alternative to Cline's
    // nested-.git rename trick — never touches any real or nested .git directory.
    await git(gitDir, worktree, ["add", "-A", "--", ".", ":!**/.git", ":!**/.git/**"]);
    // --allow-empty: a checkpoint must exist at every mutation boundary even if the
    // previous tool call produced no net diff (e.g. a no-op edit), so "the commit
    // immediately before this tool call" is always a well-defined target.
    await git(gitDir, worktree, ["commit", "-q", "--allow-empty", "-m", `royal-checkpoint: ${label}`.slice(0, 500)]);
    const { stdout } = await git(gitDir, worktree, ["rev-parse", "HEAD"]);
    return { sha: stdout.trim() || null };
  } catch {
    return { sha: null };
  }
}

/** Exposed for tests: resolve the shadow git-dir a given cwd would use, without creating it. */
export function shadowGitDirFor(cwd: string): string {
  return shadowPaths(cwd).gitDir;
}

// ---------------------------------------------------------------------------
// Doc 11: prompt-ID-granular checkpoint/undo, built on the primitives above.
// ---------------------------------------------------------------------------

const MAX_TRACKED_FILES = 50_000;
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", ".venv", "venv", "__pycache__", ".next", ".turbo", "coverage",
]);

/** Capped readdir walk for non-git workspaces — bails as soon as the cap is crossed. */
async function countFilesWalk(dir: string, cap: number): Promise<number> {
  let n = 0;
  const stack = [dir];
  while (stack.length && n < cap) {
    const d = stack.pop()!;
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (n >= cap) break;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(join(d, e.name));
      } else {
        n++;
      }
    }
  }
  return n;
}

async function countTrackedFiles(worktree: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", worktree, "ls-files"], { maxBuffer: 64 * 1024 * 1024 });
    const n = stdout.split("\n").filter(Boolean).length;
    if (n > 0) return n;
  } catch {
    /* not a git workspace (or git failed) — fall through to the walk */
  }
  return countFilesWalk(worktree, MAX_TRACKED_FILES + 1);
}

export interface ShadowInitResult {
  ok: boolean;
  reason?: string;
}

// cwd -> allowed; probed once per process per workspace, not on every call
const guardCache = new Map<string, boolean>();

/**
 * Probe + initialize the shadow repo for a workspace. Must be called (and
 * checked) before any baseline/tool commit — a workspace over the 50k-file
 * threshold gets `{ok:false}` so the caller can surface "undo not available
 * here" once instead of silently paying an unbounded per-call scan cost.
 */
export async function initShadowRepo(cwd: string): Promise<ShadowInitResult> {
  const worktree = resolve(cwd);
  const reason = "workspace has more than 50,000 files — checkpointing/undo is disabled here to avoid an unbounded per-call scan cost";
  const cached = guardCache.get(worktree);
  if (cached !== undefined) return cached ? { ok: true } : { ok: false, reason };
  try {
    const n = await countTrackedFiles(worktree);
    const ok = n <= MAX_TRACKED_FILES;
    guardCache.set(worktree, ok);
    if (!ok) return { ok: false, reason };
    await ensureShadowRepo(worktree);
    return { ok: true };
  } catch {
    // probe itself failed — best-effort: don't hard-disable the feature over a transient error
    guardCache.set(worktree, true);
    return { ok: true };
  }
}

/** Test-only: reset the per-workspace large-repo guard cache between fixtures. */
export function _resetGuardCacheForTests(): void {
  guardCache.clear();
}

async function stageAll(gitDir: string, worktree: string): Promise<void> {
  try {
    await git(gitDir, worktree, ["add", "-A", "--", ".", ":!**/.git", ":!**/.git/**"]);
  } catch {
    /* best-effort */
  }
}

async function currentHead(gitDir: string, worktree: string): Promise<string | null> {
  try {
    const { stdout } = await git(gitDir, worktree, ["rev-parse", "HEAD"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** True if staging produced a diff vs the shadow repo's current HEAD (empty repo counts as dirty). */
async function hasStagedChanges(gitDir: string, worktree: string): Promise<boolean> {
  try {
    await git(gitDir, worktree, ["diff", "--cached", "--quiet"]);
    return false; // exit 0 = no diff
  } catch {
    return true; // non-zero exit = there is a diff (or no HEAD yet)
  }
}

/**
 * File list between two shadow-repo SHAs, derived from `git diff --raw` (not
 * from any tool's declared input path — doc 11 §2.4) with gitlink entries
 * (mode 160000, submodule/nested-repo references) filtered out (§2.2/§2.4) so
 * neither UI surface can ever offer a no-op "undo" on a path that was never
 * really captured.
 */
async function diffFiles(gitDir: string, worktree: string, a: string, b: string): Promise<string[]> {
  try {
    const { stdout } = await git(gitDir, worktree, ["diff", "--raw", "--no-renames", a, b]);
    const files: string[] = [];
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const m = line.match(/^:(\d+) (\d+) [0-9a-f]+\.* [0-9a-f]+\.* \S+\t(.+)$/);
      if (!m) continue;
      const [, oldMode, newMode, path] = m;
      if (oldMode === "160000" || newMode === "160000") continue; // gitlink — never surfaced
      files.push(path);
    }
    return files;
  } catch {
    return [];
  }
}

/** `git diff --name-only <a> <b>` filtered for gitlinks — the primitive both UI surfaces read from (doc 11 §2.4). */
export async function fileListBetween(cwd: string, a: string, b: string): Promise<string[]> {
  const worktree = resolve(cwd);
  const gitDir = shadowPaths(worktree).gitDir;
  return diffFiles(gitDir, worktree, a, b);
}

// ---- cross-process lock (doc 11 §2.5) --------------------------------------

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exclusive lock via atomic `mkdirSync` (EEXIST on contention). Guards
 * against two windows on the same workspace racing shadow-git commands —
 * NOT an intra-process concern (tool calls in one `runPrompt()` are already
 * sequential). Steals a stale lock (dead pid) immediately; otherwise retries
 * with backoff for ~2s, then proceeds anyway with a swallowed warning rather
 * than hanging the caller's tool call indefinitely.
 */
async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(dir, "koder.lock");
  const deadline = Date.now() + 2000;
  let acquired = false;
  for (;;) {
    try {
      mkdirSync(lockPath, { recursive: false });
      writeFileSync(join(lockPath, "info.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      acquired = true;
      break;
    } catch (err: any) {
      if (err?.code !== "EEXIST") break; // unexpected fs error — proceed unlocked rather than hang
      try {
        const info = JSON.parse(readFileSync(join(lockPath, "info.json"), "utf8"));
        if (typeof info.pid === "number" && !isAlive(info.pid)) {
          rmSync(lockPath, { recursive: true, force: true }); // stale — steal it
          continue;
        }
      } catch {
        /* unreadable lock info — treat as contention, fall through to backoff */
      }
      if (Date.now() > deadline) break; // give up waiting, proceed without the lock
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    if (acquired) {
      try {
        rmSync(lockPath, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}

export interface BaselineResult {
  sha: string | null;
}

/**
 * Once per prompt, before its first mutating tool call: commit whatever the
 * worktree currently looks like (captures any out-of-band/manual edit made
 * between turns as part of the record). No-op (HEAD reused) if there is no
 * diff vs the shadow repo's current HEAD.
 */
export async function checkpointBaseline(cwd: string, promptId: string): Promise<BaselineResult> {
  try {
    const worktree = resolve(cwd);
    const init = await initShadowRepo(worktree);
    if (!init.ok) return { sha: null };
    const { dir, gitDir } = shadowPaths(worktree);
    return await withLock(dir, async () => {
      await stageAll(gitDir, worktree);
      const dirty = await hasStagedChanges(gitDir, worktree);
      if (!dirty) {
        const head = await currentHead(gitDir, worktree);
        if (head) return { sha: head };
      }
      await git(gitDir, worktree, ["commit", "-q", "--allow-empty", "-m", `baseline:${promptId}`]);
      return { sha: await currentHead(gitDir, worktree) };
    });
  } catch {
    return { sha: null };
  }
}

export interface ToolCommitResult {
  sha: string | null;
  files: string[];
}

/**
 * After a successful mutating tool call: commit and return `{sha, files}`,
 * `files` derived from the diff against the shadow repo's PREVIOUS head
 * (doc 11 §2.4), not from `path`. `path`, when given (write_file/edit_file's
 * own known single path), narrows the `git add` to just that path — faster,
 * though it does not fully sidestep the nested-repo gitlink gap (doc 11
 * §2.2). Omit `path` for tools with no static path relationship to what they
 * touched (bash) — those stage the whole tree.
 */
export async function commitAfterTool(
  cwd: string,
  promptId: string,
  toolCallId: string,
  toolName: string,
  path?: string,
): Promise<ToolCommitResult> {
  try {
    const worktree = resolve(cwd);
    const init = await initShadowRepo(worktree);
    if (!init.ok) return { sha: null, files: [] };
    const { dir, gitDir } = shadowPaths(worktree);
    return await withLock(dir, async () => {
      const prevHead = await currentHead(gitDir, worktree);
      if (path) {
        try {
          await git(gitDir, worktree, ["add", "--", path]);
        } catch {
          await stageAll(gitDir, worktree); // fall back to a full scan rather than silently miss the edit
        }
      } else {
        await stageAll(gitDir, worktree);
      }
      await git(gitDir, worktree, ["commit", "-q", "--allow-empty", "-m", `tool:${promptId}:${toolCallId}:${toolName}`]);
      const sha = await currentHead(gitDir, worktree);
      const files = prevHead && sha ? await diffFiles(gitDir, worktree, prevHead, sha) : [];
      return { sha, files };
    });
  } catch {
    return { sha: null, files: [] };
  }
}

async function diffQuiet(gitDir: string, worktree: string, ref: string, path: string): Promise<boolean> {
  try {
    await git(gitDir, worktree, ["diff", "--quiet", ref, "--", path]);
    return true; // exit 0 — clean, disk matches ref's content for this path
  } catch (err: any) {
    if (err?.code === 1) return false; // genuine diff
    return true; // can't tell (e.g. ref doesn't exist yet) — don't block undo on an inconclusive check
  }
}

/**
 * True if `path` has a genuine manual edit that undoing to `targetSha` would
 * silently discard — doc 11 §5, corrected: checking disk only against shadow
 * HEAD is wrong, because undo itself (a path-scoped checkout that never
 * moves the branch pointer) legitimately leaves disk at an OLDER sha while
 * HEAD still points at the last tool commit. A naive HEAD-only check would
 * misreport that expected divergence as a "manual edit" on every repeat/retry
 * of the same undo — a false positive, not a real conflict.
 *
 * Two-step check instead:
 *   1. disk vs `targetSha` clean → already at the target state; a no-op,
 *      never a conflict, regardless of what HEAD says.
 *   2. only if (1) is dirty: disk vs HEAD clean → disk still holds exactly
 *      what the agent itself last wrote (or an earlier, expected checkpoint
 *      state) — not an external edit, safe to overwrite. Dirty here too →
 *      disk matches neither the target nor the checkpoint mechanism's own
 *      last known state, i.e. something external (the user) changed it.
 */
export async function hasConflict(cwd: string, path: string, targetSha: string): Promise<boolean> {
  const worktree = resolve(cwd);
  const { gitDir } = shadowPaths(worktree);
  if (await diffQuiet(gitDir, worktree, targetSha, path)) return false; // already at target — no-op
  if (await diffQuiet(gitDir, worktree, "HEAD", path)) return false; // matches the checkpoint mechanism's own last write
  return true; // matches neither — genuine external edit
}

export type UndoResult = { ok: true; reverted: string[] } | { ok: false; conflict: { paths: string[] } };

/**
 * Path-scoped `git checkout <targetSha> -- <paths>` — one invocation for all
 * paths, so it's atomic at the git level (doc 11 §4.2). Unless `force`, every
 * path is checked for a manual-edit conflict first and the whole call is
 * refused (nothing reverted) if any path conflicts — never a partial/silent
 * overwrite. Idempotent: undoing the same prompt twice in a row is a safe
 * no-op, not a false-positive conflict (see `hasConflict` above).
 */
export async function undoPaths(cwd: string, paths: string[], targetSha: string, force = false): Promise<UndoResult> {
  const worktree = resolve(cwd);
  const { dir, gitDir } = shadowPaths(worktree);
  if (paths.length === 0) return { ok: true, reverted: [] };
  if (!force) {
    const conflicts: string[] = [];
    for (const p of paths) if (await hasConflict(worktree, p, targetSha)) conflicts.push(p);
    if (conflicts.length) return { ok: false, conflict: { paths: conflicts } };
  }
  return withLock(dir, async () => {
    await git(gitDir, worktree, ["checkout", targetSha, "--", ...paths]);
    return { ok: true, reverted: paths };
  });
}

/** Undo a single file — same primitive as `undoPaths`, one path (doc 11 §4.1). */
export async function undoFile(cwd: string, path: string, targetSha: string, force = false): Promise<UndoResult> {
  return undoPaths(cwd, [path], targetSha, force);
}

// ---- size-triggered orphan-root compaction (doc 11 §2.6) -------------------

const COMPACT_THRESHOLD_BYTES = 250 * 1024 * 1024;

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  const { stat } = await import("node:fs/promises");
  while (stack.length) {
    const d = stack.pop()!;
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          total += (await stat(full)).size;
        } catch {
          /* ignore races with concurrent writers */
        }
      }
    }
  }
  return total;
}

/**
 * Opportunistic, called after a prompt's checkpoint commits land. Only fires
 * past the size threshold; this is the ONLY thing that actually bounds
 * shadow-repo disk growth (doc 11 §2.6 — `git gc`/reflog-expire alone do not,
 * since nothing is ever unreachable in this design until this runs). Destroys
 * the ability to undo anything before the compaction point — an explicit,
 * logged tradeoff, never silent; callers should surface the returned
 * `compacted` flag as a `system` transcript note.
 */
export async function maybeCompact(cwd: string): Promise<{ compacted: boolean }> {
  try {
    const worktree = resolve(cwd);
    const { dir, gitDir } = shadowPaths(worktree);
    if (!existsSync(gitDir)) return { compacted: false };
    const size = await dirSizeBytes(gitDir);
    if (size < COMPACT_THRESHOLD_BYTES) return { compacted: false };
    return await withLock(dir, async () => {
      // capture the real current branch name (whatever `init.defaultBranch` gave
      // it) rather than assume "main" — this repo is never user-facing but we
      // still shouldn't hardcode a name git itself didn't choose.
      const { stdout: curBranchOut } = await git(gitDir, worktree, ["symbolic-ref", "--short", "HEAD"]).catch(() => ({
        stdout: "master",
      }));
      const mainBranch = curBranchOut.trim() || "master";
      const tmpBranch = `koder-compact-${Date.now()}`;
      await git(gitDir, worktree, ["checkout", "--orphan", tmpBranch]);
      await git(gitDir, worktree, ["commit", "-q", "--allow-empty", "-m", "checkpoint history compacted"]);
      // -M with a single arg renames the CURRENT branch (tmpBranch) to that name,
      // forcing overwrite of the previous branch ref of the same name — this is
      // the actual moment old commits become unreachable.
      await git(gitDir, worktree, ["branch", "-M", mainBranch]);
      await git(gitDir, worktree, ["reflog", "expire", "--expire=now", "--all"]);
      await git(gitDir, worktree, ["gc", "--prune=now", "--quiet"]);
      return { compacted: true };
    });
  } catch {
    return { compacted: false };
  }
}
