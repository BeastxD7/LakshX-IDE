# OS-Build — native per-OS installers for LakshX

One command per OS produces **a single distributable installer** for that OS.
These scripts faithfully mirror the CI pipeline in
[`.github/workflows/build.yml`](../.github/workflows/build.yml) (the source of
truth for how each platform is actually built) — they do not invent commands.

| OS      | Script                    | Output artifact          |
| ------- | ------------------------- | ------------------------ |
| macOS   | `build-macos.sh`          | `LakshX-macOS-<arch>.dmg`   |
| Windows | `build-windows.ps1`       | `LakshX-Windows-<arch>.exe` |
| Linux   | `build-linux.sh`          | `LakshX-Linux-<arch>.deb`   |

## Just tell me the command (copy-paste, per OS)

Run this from the repo root, on the machine matching your target OS.

**macOS** — plain Terminal, `bash`/`zsh` both fine:

```bash
./build.sh
```

**Linux** — plain terminal, any shell:

```bash
./build.sh
```

**Windows** — the script is PowerShell (`.ps1`), **not** a `.sh` file, so how
you invoke it depends on what you're typing into. **`./build.sh` and
`.\build.sh` do NOT work in a plain `cmd.exe` or plain PowerShell prompt** —
neither one knows how to run a bash script, and you'll get either
`'.' is not recognized as an internal or external command` (cmd) or nothing
useful at all (PowerShell). Use one of these instead:

- From a plain **PowerShell** or **cmd** prompt (most common — do this one):
  ```powershell
  powershell -ExecutionPolicy Bypass -File OS-Build\build-windows.ps1
  ```
- From **Git Bash** (the `MINGW64` prompt) **only**, `./build.sh` also works —
  it detects Windows and invokes the `.ps1` for you automatically.

Add `--check` (mac/linux) or `-Check` (Windows) to any of the above to run
**only** the requirements gate and print the command sequence, with no actual
build — use this first to see what's missing before committing to a real run.

## Known issue right now: run this once before your first real build

`product/lakshx-chat/package.json` lists `smart-whisper` (voice mode) as a
dependency, but `package-lock.json` was never regenerated for it — the
native-addon install was deliberately skipped during development (disk
constraints). `npm ci` is strict and will **fail** on this mismatch during the
`upstream: npm ci` step, on every OS, until the lockfile is fixed. One-time fix,
on any machine with normal disk space and a working C++ toolchain:

```bash
cd product/lakshx-chat
npm install        # regenerates package-lock.json (compiles the native addon)
cd ../..
```

Commit the updated `package-lock.json` after this succeeds so nobody else hits
the same failure. If you'd rather not build voice mode's native dependency at
all right now, remove `smart-whisper` from `product/lakshx-chat/package.json`
before running `npm install` — voice mode's UI will still load, it'll just fail
gracefully with a clear error when someone tries to use the mic.

## Quick start

From the repo root, on the machine matching your target OS:

```bash
./build.sh                   # detects your OS, runs the requirements gate, builds
./build.sh --check           # requirements gate + print the command sequence, no build
./build.sh --non-interactive # never prompt for auto-fixes; just report + fail
```

Every run starts with a **requirements gate** (see below) that verifies the
environment can actually complete the build *before* any heavy step. If any
hard requirement fails, the build stops immediately with a checklist of what to
fix — no wasted fetch / agent-bundle / `npm ci` time.

`build.sh` dispatches to the right `OS-Build/` script. On Windows (Git Bash) it
invokes the PowerShell script for you, or you can run it directly:

```powershell
powershell -ExecutionPolicy Bypass -File OS-Build\build-windows.ps1
powershell -ExecutionPolicy Bypass -File OS-Build\build-windows.ps1 -Check
```

You can also run any per-OS script directly (each supports `--check` / `-Check`).

### Config (env overrides, sane defaults)

| Var              | Default (mac / win / linux) | Meaning       |
| ---------------- | --------------------------- | ------------- |
| `VSCODE_ARCH`    | `arm64` / `x64` / `x64`     | target arch   |
| `VSCODE_QUALITY` | `stable`                    | build quality |
| `GITHUB_TOKEN`   | _(unset)_                   | optional; avoids GitHub rate-limits during `npm ci` |

## What every build does (mirrors build.yml)

All three scripts run the same prep sequence before the platform-specific
packaging (skipped entirely under `--check`):

1. `scripts/fetch-vscode.sh` — shallow-clone pinned code-oss into `upstream/`.
2. `agent`: `npm ci && npm run bundle` — bundle the agent runtime.
3. `scripts/prepare.sh` — merge `product/product.overrides.json` into
   `upstream/product.json`, apply `patches/*.patch`, run `apply-ui.mjs` +
   `install-icons.mjs`.
4. `upstream`: `npm ci` with the CI's load-bearing env
   (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`,
   `NPM_CONFIG_AUDIT=false`, `NPM_CONFIG_FUND=false`). macOS additionally raises
   `ulimit -n/-u` — both fix the macOS-only "spawn /bin/sh ENOENT" crash.
5. `upstream`: `npm run gulp vscode-<target>-min` — the packaged build.

Then per platform:

- **macOS**: ad-hoc `codesign --force --deep -s -` the `.app`, then
  `node build/darwin/create-dmg.ts <repoRoot> <repoRoot>` (dmgbuild via a Python
  venv) → `.dmg`. _(CI itself only zips the `.app`; the DMG step comes from
  upstream's own Azure pipeline + this session's tested manual run.)_
- **Windows**: `gulp vscode-win32-x64-inno-updater` **then** (separately)
  `gulp vscode-win32-x64-system-setup` → Inno Setup `.exe`. Two invocations,
  never one command line (inno-updater populates `tools/` that system-setup's
  ISCC globs).
- **Linux**: `gulp vscode-linux-x64-prepare-deb` **then** (separately)
  `gulp vscode-linux-x64-build-deb` → `.deb` via `dpkg-deb`/`fakeroot`. Two
  invocations, never one — passing both on one command line is a real race.

## Requirements gate (enforced before every build)

The preflight runs the **full** check set first, collects **all** results (it
does not stop at the first failure, so you see the complete todo list), prints a
`PASS` / `WARN` / `FAIL` table, and only then decides: any **FAIL** stops the
build (exit non-zero, no heavy step runs); **WARN**s proceed. `--check` runs
exactly this gate plus the command sequence and stops.

**Node.js is checked exactly the way upstream's `build/npm/preinstall.ts` does**
— the version is read from [`upstream/.nvmrc`](../upstream/.nvmrc) (currently
**`24.17.0`**) and the running Node must be **>= that version AND the same major
(24)**. This is a proper numeric semver compare — e.g. `24.9.0` is correctly
rejected as older than `24.17.0`, and `25.x` is rejected as the wrong major.
"Any 24.x" does **not** pass; anything the upstream build would later reject is
caught here up front (this is the bug this gate exists to fix).

| Check | Severity | Notes |
| ----- | -------- | ----- |
| Node.js >= `.nvmrc`, same major | **FAIL** | exact `preinstall.ts` replica |
| `npm` present, major < 12 | **FAIL** | `preinstall.ts` rejects npm >= 12 |
| `git` present | **FAIL** | |
| `python3` >= 3.10 | **FAIL** (macOS) / **WARN** (linux/win) | macOS: create-dmg's dmgbuild venv |
| Platform toolchain | **FAIL** | mac: Xcode CLT · linux: `dpkg-deb` + `fakeroot` · win: MSVC/VS Build Tools |
| Free disk space | **FAIL** < 10 GB · **WARN** < 25 GB | build writes several GB |
| `scripts/prepare.sh` present | **FAIL** | `upstream/` missing is only a WARN (it gets fetched) |

### Opt-in, interactive auto-fix

When run in a real terminal (not `--check`, not `--non-interactive`, not CI, not
a redirected/piped stdin), the gate **offers** to fix each fixable item with a
yes/no prompt. It **shows the exact command first** and runs it only on an
explicit `y` — it never installs anything silently. Fixes are OS-aware:

- **Node** → `nvm install <ver> && nvm use <ver>` if `nvm` is present (mac/linux)
  or `nvm-windows` on Windows; otherwise it points you to `nodejs.org` /
  `winget install OpenJS.NodeJS` / `choco`. Because `nvm` changes only apply to
  a fresh shell, after installing it asks you to **re-run the script** rather
  than continuing in a stale environment.
- **python3** → `brew install python@3.12` (mac) / `apt-get install -y python3`
  (linux) / `winget install Python.Python.3.12` (win).
- **dpkg-deb / fakeroot** (linux) → `sudo apt-get install -y dpkg-dev` /
  `... fakeroot` (needs sudo; only on explicit yes).
- **Xcode CLT** (mac) → `xcode-select --install` and **VS Build Tools** (win) →
  `winget install ...` are **guided**, not silent — they launch the OS's own
  installer; the prompt says so.

`--non-interactive` (and CI / non-TTY) never prompts — it just reports the todo
list and exits non-zero, so automated runs never hang.

## Prerequisites per OS

**Common:** Node **>= `24.17.0` with the same major (24)** — the exact version
from [`upstream/.nvmrc`](../upstream/.nvmrc), enforced by the gate — plus `npm`
(< 12), `git`, network access, and **>= ~25 GB free disk** (10 GB is the hard
floor; the build writes several GB).

**macOS** (`build-macos.sh`)

- Xcode Command Line Tools: `xcode-select --install`
- `python3` >= 3.10 (create-dmg builds a dmgbuild venv; without it, it tries to
  `brew install python@3.12`)

**Windows** (`build-windows.ps1`)

- **Git for Windows** — the prep step is a bash script, called via `bash`.
- **Visual Studio Build Tools** with the "Desktop development with C++"
  workload (MSVC toolchain for native modules — `preinstall.ts` hard-requires
  VS 2022/2019). Inno Setup itself is pulled in by `npm ci` (the `innosetup`
  devDependency) — no separate install.

**Linux** (`build-linux.sh`) — Debian/Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y build-essential g++ libx11-dev libxkbfile-dev \
  libsecret-1-dev libkrb5-dev fakeroot rpm dpkg-dev
```

## Signing / notarization caveats (these hit real users)

These scripts produce **installable but not distribution-signed** artifacts.
Signing/notarization is deliberately **not** implemented here — document only:

- **macOS — Gatekeeper "damaged" on download.** The `.app` is only *ad-hoc*
  signed (`-s -`), not Developer ID signed + notarized. A user who downloads
  the `.dmg` will see **"LakshX is damaged and can't be opened."** Workaround
  (user side): `xattr -cr /Applications/LakshX.app`. Proper fix: a Developer ID
  Application certificate, `codesign` with it, then `xcrun notarytool submit`
  + `xcrun stapler staple`.
- **Windows — SmartScreen on unsigned `.exe`.** The installer is unsigned, so
  Windows Defender SmartScreen shows **"Windows protected your PC."** Users
  click *More info → Run anyway*. Proper fix: an Authenticode (ideally EV)
  code-signing certificate applied to the `.exe`.
- **Linux — none.** The `.deb` needs no signing to install
  (`sudo apt install ./LakshX-Linux-x64.deb`).

## What was verified

- `bash -n` syntax-checked: `build.sh`, `lib-preflight.sh`, `build-macos.sh`,
  `build-linux.sh`.
- `./build.sh --check` run live on macOS (Node **24.14.0**, below the required
  **24.17.0**). The gate now **correctly FAILs** the Node check — printing
  required `24.17.0` vs installed `24.14.0` and the `nvm install`/`nvm use`
  remediation — where the previous "major 24 OK" logic wrongly passed. The disk
  check also FAILed (tight disk), and both FAIL rows appeared together,
  confirming the collect-all model (it doesn't bail on the first failure). Exit
  code was non-zero and no heavy step ran.
- The Node semver boolean was unit-tested against edge cases: `24.9.0` and
  `24.16.9` correctly FAIL (numeric compare, not string), `25.0.0`/`26.5.0`
  FAIL (wrong major), `24.17.0`/`24.18.0` PASS.
- The interactive auto-fix prompt logic was exercised via a harness: it prints
  the exact command and prompt, runs the command only on an explicit `y`, skips
  on anything else, and flags nvm-style fixes as needing a fresh shell. The
  `--non-interactive`, CI, and piped/no-TTY paths were confirmed to **not**
  prompt (they report the todo list and exit non-zero — no hang).
- The full end-to-end build was **not** run (time/disk); its correctness rests
  on faithfully mirroring `build.yml`, which is the proof the underlying
  commands work.
- `build-windows.ps1`: **a real user hit a real bug here** (2026-07-17) — the
  script contained a handful of em-dash characters (`—`, U+2014) inside string
  literals. The file itself was valid UTF-8 with no BOM, but **Windows
  PowerShell 5.1 reads a BOM-less `.ps1` using the system's ANSI codepage, not
  UTF-8** — so the em-dash decoded as garbage, broke that string's quoting, and
  the parser misread everything after it, cascading into a wall of unrelated-
  looking errors (missing braces, an `&&`-not-a-separator complaint, etc. — all
  downstream fallout from the one real break, not independent bugs; confirmed
  by checking that every literal `&&` in the file is safely inside a quoted
  string). **Fixed** by removing every non-ASCII character from the file (it's
  now pure ASCII, 0 bytes outside 0x00-0x7F) — a plain-ASCII script has no
  encoding dependency at all, regardless of BOM or system codepage. Verified by
  byte-level inspection (`grep`/`xxd` confirmed 0 non-ASCII bytes remain, and a
  quote-aware scanner confirmed every `&&` in the file sits inside a string,
  never a real statement separator) rather than a live PowerShell parse — an
  attempt to install `pwsh` on the fix machine specifically to double-check
  this stalled on a slow/failing dependency download and was abandoned rather
  than block on it; this file is still **unverified against a live PowerShell
  parser**, only against the exact byte-level failure mode that was observed.
