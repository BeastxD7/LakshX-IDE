# LakshX Secrets

Offline, Gitleaks-style secret scanning: regex + entropy detection, a
baseline/allowlist file, inline editor warnings, and an **opt-in** real git
pre-commit hook. Fully local — this extension makes **zero network calls**,
ever.

See `docs/research/16-ide-feature-roadmap-round2.md`'s security section for
the pitch this was built from.

## Honest scope note — read this first

This is regex + Shannon-entropy pattern matching over raw text, the same
class of technique Gitleaks and detect-secrets use. **It is a safety net,
not a guarantee.** Concretely:

- **False negatives are real.** Anything that isn't one of the named
  patterns below (a custom internal token format, a secret split across
  string concatenation, a secret loaded from an obfuscated/encoded literal)
  will not be caught. A clean scan is not proof a change is secret-free.
- **False positives are real**, especially from the generic entropy
  heuristic. Known, concrete sources: git commit SHAs and other hash
  digests of public content (random-looking hex is indistinguishable from a
  real hex secret by entropy alone), minified/bundled JS blobs, lockfile
  content hashes (`package-lock.json`, `yarn.lock`), base64-encoded data
  URIs, and UUIDs/session ids that happen to clear the length+entropy bar.
  This is why every entropy-heuristic finding is labeled **"possible"**,
  never "confirmed" — treat it as a prompt to look, not as proof.
- Use this alongside — not instead of — secret rotation discipline, repo
  history scrubbing after a real leak, and your org's existing scanning (if
  any). It catches the common, careless case cheaply and offline; it is not
  a substitute for a dedicated security review.

## The rule set

| Rule | Confidence | Pattern |
| --- | --- | --- |
| `aws-access-key-id` | confirmed | `AKIA[0-9A-Z]{16}` |
| `aws-secret-access-key` | confirmed | a 40-char base64-ish token, **only when** an `aws`/`secret access`/`access key` context word appears on the same line |
| `github-token` | confirmed | `gh[oprsu]_` + 36+ alphanumeric chars (`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`) |
| `stripe-key` | confirmed | `sk_live_` / `pk_live_` / `rk_live_` + alphanumeric (test-mode `sk_test_` keys are intentionally out of scope) |
| `private-key-header` | confirmed | `-----BEGIN (RSA \|EC \|OPENSSH \|DSA )?PRIVATE KEY-----` |
| `slack-token` | confirmed | `xox[baprs]-...` |
| `db-connection-string` | confirmed | `postgres(ql)?://`, `mysql://`, or `mongodb(+srv)://` **with embedded `user:password@`** (a connection string with no credentials in it does not fire) |
| `generic-high-entropy` | **possible** (secondary signal) | base64-ish (len ≥ 20) or hex-ish (len ≥ 32) tokens whose Shannon entropy clears 4.3 / 3.0 bits/char respectively; excludes spans already claimed by a confirmed rule |

All rules live in `lib/rules.js`, which has zero `vscode` dependency and is
directly covered by `node --test`.

## Redaction

A finding never carries enough of the matched text to reconstruct it. Display
form is first 4 + last 4 characters + length, e.g. `AKIA…MPLE (20 chars)`
(see `lib/scanner.js`'s `redact()`). The full matched value is only ever held
in memory transiently, to compute the redacted form and the content hash
below — it is never written to disk, logged, or included in a command
argument.

## Baseline / allowlist — `.lakshx/secrets-baseline.json`

Standard detect-secrets/Gitleaks UX: acknowledge a finding once, and it stops
firing on later scans.

- Click the lightbulb / quick-fix on a flagged line and choose **"Acknowledge
  ... as a known/false-positive finding (add to baseline)"**, or run
  `lakshx.secrets.acknowledgeFinding` programmatically.
- This appends an entry to `.lakshx/secrets-baseline.json` in the workspace
  root: `{ file, rule, hash, line, redacted, addedAt }`.
- **The baseline file never stores the plaintext secret** — only a SHA-256
  hash of `"<ruleId>::<matchedText>"` (`lib/hash.js`), the same discipline
  detect-secrets' `hashed_secret` field uses.

**Identity is `(file, rule, content-hash)` — deliberately NOT `(file, rule,
line)`.** This matters in one specific, tested way (see
`test/baseline.test.js`'s "CRITICAL" test): if you edit a line so the secret
*value* changes but it happens to stay on the same line number, the hash
changes and the new finding is **not** suppressed — an edited line never
silently inherits an old baseline entry just because the line number matched.
Line number is stored on the entry only for human reference when reading the
baseline file; it plays no part in matching.

Identity is scoped to `(file, rule)`, not global-by-hash: the same secret
string appearing in a *different* file is still flagged there and needs its
own acknowledgment. This mirrors Gitleaks' path-aware fingerprinting and is
safer than a fully global baseline, which would silently blanket-approve a
leaked value anywhere it turns up.

## Pre-commit integration

Two ways to use this before committing, in increasing order of automation:

### 1. Manual staged-diff scan (no local git config changes)

Command: **"LakshX: Scan Staged Changes for Secrets (Pre-Commit)"**
(`lakshx.secrets.scanStaged`). Runs `git diff --cached --unified=0` in the
workspace root, scans only the **added** lines (via `lib/diff.js`'s unified
diff parser), filters against the baseline, and shows results in the
"LakshX: Secrets Scan" output channel before you commit. Nothing about your
git configuration changes; this is just a command you can run (or bind to a
keystroke) whenever you want.

### 2. A real git pre-commit hook — **opt-in, consequential action**

Command: **"LakshX: Install Real Git Pre-Commit Hook for Secret Scanning
(Opt-In)"** (`lakshx.secrets.installPreCommitHook`).

**This is never run automatically.** It is a separate command you must
invoke, and invoking it shows an explicit modal warning first:

> LakshX Secrets will write a real git hook to `.git/hooks/pre-commit` in
> this repository. This is a LOCAL, machine-specific change outside VS
> Code's own settings — it is not committed or shared with collaborators,
> and it will run on every `git commit` from this working copy (including
> from the terminal) until you uninstall it. It shells out to a small
> bundled Node script; it does not send anything over the network.

If an existing `pre-commit` hook is already present and wasn't installed by
LakshX, a **second** confirmation warns that overwriting it will disable
whatever it currently does.

What gets installed is a tiny POSIX shell script
(`lib/hook-template.js`'s `buildPreCommitHookScript`) that shells out to
`bin/precommit-scan.js` — a standalone Node CLI (no vscode dependency at all)
that:

1. runs `git diff --cached --unified=0`,
2. parses added lines and scans them (reusing the exact same
   `lib/diff.js` + `lib/scanner.js` + `lib/baseline.js` modules the in-editor
   `scanStaged` command uses — one tested implementation backs both
   surfaces),
3. reads `.lakshx/secrets-baseline.json` if present,
4. prints any un-baselined findings (redacted) and **exits 1**, blocking the
   commit, or exits 0 if clean/baselined.

**Fail-open on internal errors, by design:** if `git` itself fails, the
baseline file is unreadable/corrupt, or an unexpected exception is thrown,
the script prints a warning and exits **0** rather than blocking every commit
on a scanner bug. It only ever fails **closed** (exit 1, blocking) when it
actually found un-baselined secrets. A scanner that can brick commits on its
own internal errors gets uninstalled, not trusted — same tradeoff
Gitleaks'/detect-secrets' own pre-commit integrations make. `git commit
--no-verify` always bypasses the hook if you need to.

**Uninstall:** "LakshX: Uninstall LakshX Git Pre-Commit Hook"
(`lakshx.secrets.uninstallPreCommitHook`) — refuses to touch a hook file it
didn't install itself, and asks for confirmation before removing one it did.

**Known limitation:** the installed hook's shell wrapper points at an
*absolute path* into wherever this extension is currently installed. If the
extension is uninstalled, updated to a version that moves `bin/`, or the
workspace is opened on a different machine, the hook stops working (or needs
reinstalling). This is an inherent tradeoff of "a git hook calls back into a
VS Code extension's bundled script." It also only supports the standard
`.git/hooks` layout — not worktrees/submodules with a `.git` *file* pointing
elsewhere.

## Editor-save decoration

On save, the just-saved file is scanned incrementally (fast — no full
workspace walk) and results show as:

- Problems-panel diagnostics (source `"LakshX Secrets"`, code = the rule id),
  confirmed findings at Warning severity, possible/entropy findings at
  Information severity;
- a gutter icon (`media/secret-gutter.svg`) on confirmed-finding lines.

**Deliberate divergence from the bulk workspace scan:** this on-save scan
does **not** consult `.gitignore`. If a file is open in the editor and you're
actively saving it, a warning is useful regardless of its git status — most
notably for hand-edited `.env`/`local.settings.json` files, which are
routinely gitignored but still worth flagging if something risky lands in
them. The bulk workspace scan (below) *does* respect `.gitignore`, for the
opposite reason: without it, a full scan floods the Problems panel with
build output and vendor directories that happen to be ignored.

## Manual full-workspace scan

Status bar item **"$(shield) Secrets Scan"**, or command **"LakshX: Scan
Workspace for Secrets"** (`lakshx.secrets.scanWorkspace`). Bounded the same
way lakshx-graph's dependency scan is: max 2000 files, 512 KB per file,
excludes `node_modules/.git/dist/build/out/.next/.venv/venv/__pycache__/
coverage/vendor`. Binary files are skipped via a NUL-byte sniff (same
heuristic git itself uses).

**`.gitignore` is respected for this scan**, via `git check-ignore --stdin`
against the candidate file list. This requires `git` on `PATH` and the
workspace folder to actually be a git repository; if either isn't true, this
fails **open** (a message is logged to the output channel, and only the
fixed directory-exclude list above still applies) rather than silently
pretending gitignore was honored.

Note: `vscode.workspace.findFiles` — the API this and every other LakshX
extension's workspace scan is built on — does **not** honor `.gitignore` on
its own; that's a Search-viewlet-only behavior (`search.useIgnoreFiles`), not
part of the `findFiles` API. This extension is the one place in the LakshX
suite that layers an explicit `git check-ignore` pass on top for that
reason — worth knowing if you're comparing scan coverage against
`lakshx-graph`/`lakshx-structural-search`, which don't do this.

## Design notes for maintainers

- `lib/rules.js`, `lib/scanner.js`, `lib/baseline.js`, `lib/diff.js`,
  `lib/precommit.js`, `lib/hash.js`, `lib/hook-template.js` are all
  `vscode`-free and unit-tested (`npm run test:unit` /
  `node --test test/*.test.js`). `extension.js` is the only file that
  touches the `vscode` API, mirroring the split `lakshx-graph` and
  `lakshx-structural-search` already use.
- `bin/precommit-scan.js` is a standalone CLI (also `vscode`-free) that the
  installed git hook invokes directly with plain Node — it shares
  `lib/precommit.js`'s `scanStagedDiff` with the in-editor `scanStaged`
  command rather than duplicating the diff-to-findings logic.

## Central registration

This extension is **not** wired into `scripts/apply-ui.mjs` — per this
build's file-lane instructions, that file was left untouched. To enable it
alongside the other LakshX extensions, add `"lakshx-secrets"` to the
extension-directory array near the top of `scripts/apply-ui.mjs` (the same
array `lakshx-graph`, `lakshx-structural-search`, etc. are already listed
in).
