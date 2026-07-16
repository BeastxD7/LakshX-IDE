# LakshX Testing

Makes VS Code's own **native Testing UI** — the inline pass/fail gutter, the
error Peek view, the Test Results panel, and coverage highlighting — genuinely
on by default and well-configured, instead of leaving a good experience to
per-project discovery of `testing.*` settings almost nobody finds on their
own.

## Scope: what this is, and what it explicitly is NOT

**This is a configuration/enablement layer over VS Code's built-in Testing
API.** It is **not** a custom test runner, does not implement
`vscode.tests.createTestController`/`TestRun`/`TestRunProfile` itself, and
does not execute any tests. All actual test discovery and execution still
comes from whatever ecosystem-specific test extension is installed (Python
extension, Go extension, rust-analyzer, Jest/Vitest extensions, etc.) — this
extension exists to make sure that whatever those extensions surface through
VS Code's Testing UI is switched on and configured sensibly by default.

It does two things:

1. **Ships `configurationDefaults`** that flip a set of built-in `testing.*`
   settings to better defaults (see table below).
2. **A one-time-per-workspace notification**: on activation, if the
   workspace looks like it uses Jest, Vitest, pytest, Cargo (Rust), or Go,
   and the matching test explorer extension isn't installed, it suggests
   installing it — it never bundles or auto-installs anything.

## Configuration defaults

Every key below was verified against this exact checkout's
`upstream/src/vs/workbench/contrib/testing/common/configuration.ts` (this
fork's actual shipped VS Code source), not guessed from memory. The "stock
default" column is what that file registers if this extension's
`configurationDefaults` didn't override it.

| Setting | This extension sets | Stock default (this build) | Why |
|---|---|---|---|
| `testing.automaticallyOpenPeekView` | `"failureInVisibleDocument"` | `"never"` | The headline fix: this fork's upstream ships with the failure Peek view **off**, unlike the "inline pass/fail" experience the roadmap asks for. Turning it on for failures in the visible document (not "anywhere", to avoid stealing focus from unrelated files) is the core lever. |
| `testing.defaultGutterClickAction` | `"runWithCoverage"` | `"run"` | Makes coverage the default gutter action instead of a separate opt-in click — the second core lever for "coverage highlighting genuinely on by default." Only has an effect if the active test extension/profile actually offers a Coverage run kind. |
| `testing.coverageToolbarEnabled` | `true` | `false` (shipped with a `// todo@connor4312: disabled by default until UI sync` comment) | The in-editor coverage toolbar is off by default even in this build; there's no reason to hide it once coverage is the default gutter action above. |
| `testing.automaticallyOpenTestResults` | `"openOnTestFailure"` | `"openOnTestStart"` | Opens the Test Results panel on failure rather than on every run start — same "make results visible" goal with less noise on green runs. |
| `testing.followRunningTest` | `true` | `false` | Test Explorer auto-reveals whatever's currently running, so you can see progress without having to go look for it. |
| `testing.gutterEnabled` | `true` | `true` | Already on; pinned explicitly so a future upstream change can't silently turn gutter decorations off. |
| `testing.showCoverageInExplorer` | `true` | `true` | Already on; pinned explicitly (see above). |
| `testing.coverageMinimapEnabled` | `true` | `true` | Already on; pinned explicitly (see above). |
| `testing.displayedCoveragePercent` | `"totalCoverage"` | `"totalCoverage"` | Already the default; pinned explicitly. |
| `testing.coverageBarThresholds` | `{red:0,yellow:60,green:90}` | same | Already the default; pinned explicitly so the color bands stay predictable. |
| `testing.countBadge` | `"failed"` | `"failed"` | Already the default; pinned explicitly. |
| `testing.saveBeforeTest` | `true` | `true` | Already the default; pinned explicitly (tests should run against saved content). |

Confidence: **certain** for every key and enum value above — each is copied
from the actual `TestingConfigKeys`/`AutoOpenTesting`/`AutoOpenPeekViewWhen`/
`DefaultGutterClickAction` enums in this checkout's
`upstream/src/vs/workbench/contrib/testing/common/configuration.ts`, not
invented. In particular, the Coverage gutter-click value is the string
`"runWithCoverage"` (not `"coverage"` — a plausible-looking wrong guess this
verification step ruled out).

These 12 keys break into three tiers, worth telling apart when deciding
whether to veto anything:

1. **The headline fix** — `automaticallyOpenPeekView` was shipped genuinely
   *off* (`"never"`) in this fork; turning it on is unambiguously the core
   ask.
2. **Zero-risk pins** — `gutterEnabled`, `showCoverageInExplorer`,
   `coverageMinimapEnabled`, `displayedCoveragePercent`,
   `coverageBarThresholds`, `countBadge`, `saveBeforeTest`,
   `followRunningTest` already match (or are low-risk improvements on) the
   stock default; pinning them just guards against a future upstream change.
3. **Opinionated flips against a deliberate upstream default** — two keys
   deserve explicit attention before anyone treats this as "just enabling
   what was already intended":
   - `defaultGutterClickAction: "runWithCoverage"` makes the *primary*
     single-click gutter action always run instrumented (slower, and a
     no-op/degrade in ecosystems whose test extension exposes no Coverage
     run profile). It's the most direct lever available for "coverage
     highlighting on by default" — VS Code has no separate "always compute
     coverage automatically" toggle — but it does change the default click
     behavior, not just unhide something.
   - `coverageToolbarEnabled: true` overrides a default VS Code's own team
     set to `false` with an explicit `// todo@connor4312: disabled by
     default until UI sync` comment in the source — i.e. a default gated off
     on purpose, possibly because the toolbar wasn't considered finished at
     the time. Flipping it on fits this extension's "flip the good defaults
     on" mandate, but it's worth knowing it's not merely restoring an
     oversight.

### What was deliberately left out

- **A status bar aggregate test-run indicator** was considered (item #3 of
  the brief) and dropped. `vscode.tests` only exposes
  `createTestController()` — there is no public API for an extension to read
  an aggregate "last run pass/fail count" across whatever
  TestController(s) other extensions registered; that data lives inside the
  Test Results view internal to VS Code core, not in the extension API
  surface (confirmed by reading `upstream/src/vscode-dts/vscode.d.ts`'s
  `namespace tests` block directly). Per the brief's own guidance, an
  unclear/guessed API shape here was worse than skipping it.

## Auto-detection helper

On `onStartupFinished`, this extension does a bounded, best-effort read of
the first workspace folder's **root-level** files only (no recursive scan):

- `package.json` → its `scripts` object is scanned for `jest`/`vitest`
  keywords, or a plain `"test"` script with neither keyword (a generic
  "some JS test runner exists" signal with no confident extension
  recommendation attached).
- `pytest.ini` (existence), or `pyproject.toml` containing
  `[tool.pytest.ini_options]`, or `setup.cfg` containing `[tool:pytest]`.
- `Cargo.toml` (existence) → Rust.
- `go.mod` (existence) → Go.

For each ecosystem detected, if a recommended extension exists and isn't
already installed (checked via `vscode.extensions.all`), and this workspace
hasn't already been notified about that ecosystem before (tracked in
`context.workspaceState`, so it survives reloads but is genuinely one-time
per workspace, not per session), it shows **one** combined
`showInformationMessage` naming what was detected, with a "Show
Extension(s)" action that opens the Extensions view pre-filtered to the
recommended extension id(s) via the built-in
`workbench.extensions.action.showExtensionsWithIds` command. Dismissing or
acting on it both mark the ecosystem as notified — this is a single nudge,
not a recurring one.

Recommended extensions (none of these are bundled — install is always the
user's choice):

| Ecosystem | Suggested extension | Confidence |
|---|---|---|
| Jest | `orta.vscode-jest` | Certain — long-standing, well-known id. |
| Vitest | `vitest.explorer` | Fairly confident, not verified against a live Marketplace/Open VSX lookup (no network access in this task) — lowest-confidence id in this table. |
| pytest | `ms-python.python` | Certain — Microsoft's own Python extension, bundles pytest/unittest test discovery. |
| Rust (Cargo) | `rust-lang.rust-analyzer` | Certain — the standard Rust extension. |
| Go | `golang.go` | Certain — the standard Go extension. |

One known limitation of the "is it installed" check: `vscode.extensions.all`
lists extensions VS Code knows about, which may not distinguish "installed
but disabled" from "not installed" in every case — worst case this nudges
someone to reinstall something they deliberately disabled. Acceptable given
this is a single, one-time, best-effort nudge, not a repeated warning.

The pure decision logic (which ecosystems were detected, which of those
warrant a notification) lives in `lib/detectRunners.js` and has no
dependency on `vscode` — see `test/detectRunners.test.js` (`node --test`,
21 passing assertions covering keyword matching, false-positive avoidance,
config-file detection, and the notify/skip decision matrix). `extension.js`
is the thin, untested-by-necessity layer that does the actual
`vscode.workspace.fs` reads and `vscode.window.showInformationMessage` call.

## Honest verification limits

- `package.json` is valid JSON (`JSON.parse` succeeds) and `extension.js`/
  `lib/detectRunners.js` pass `node --check`.
- The pure detection/notification logic has full `node --test` coverage.
- **What was NOT verified, and can't be without a running Extension Host**:
  that the `configurationDefaults` actually take effect in a live LakshX
  window, that the Peek view/coverage toolbar/gutter actually render as
  described, or that the one-time notification actually fires and its
  "Show Extension(s)" button actually opens the Extensions view correctly.
  Every setting key and enum value was cross-checked against this exact
  checkout's upstream source as the closest available substitute for that,
  but that is static verification, not a live behavioral test.
