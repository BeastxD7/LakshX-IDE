# LakshX Terminal Blocks

A side-panel view (in the bottom panel, next to Terminal/Output/Problems)
that mirrors your integrated terminal's command history as discrete,
addressable "blocks": command text, terminal name, start time, duration, and
exit code — each with rerun and copy actions. A captured output preview
(bounded to the last 20 lines) is shown as the block's expandable children
when the running VS Code build supports it.

## What this actually is (read this before filing a "why doesn't it look like Warp" issue)

This is **not** a rewrite of the terminal's rendering. VS Code gives
extensions no API to redraw, restyle, or inject visual grouping into the
terminal's own `xterm.js` buffer — that surface is private to the platform's
terminal contribution. So the real, honest v1 capability is a **panel that
mirrors the terminal's command history**, built entirely on VS Code's
existing (stable, non-proposed) shell-integration API:

- `vscode.window.onDidStartTerminalShellExecution` — fires when a command
  starts; gives you the `TerminalShellExecution` and the originating
  `Terminal`.
- `vscode.window.onDidEndTerminalShellExecution` — fires when it finishes;
  `event.exitCode` is the shell-reported exit code (`number | undefined`).
- `TerminalShellExecution.commandLine.value` — the command line text (a
  structured `{ value, isTrusted, confidence }`, not a plain string, as of
  the version of this API vendored in this fork's own `vscode.d.ts`).
- `TerminalShellExecution.cwd` — the working directory the shell reported
  for that command, when available.
- `TerminalShellExecution.read()` — an `AsyncIterable<string>` of the raw
  data (including ANSI escape sequences) written to the terminal for that
  command. Must be called synchronously in the start-event handler to not
  miss data; this extension does exactly that.

All of the above were confirmed directly against
`upstream/src/vscode-dts/vscode.d.ts` in this repository (i.e. this fork's
own committed, stable API surface — not a `.proposed.d.ts` file), so
confidence these are real and stable is **high**. Nothing in this extension
guesses at an unconfirmed API.

## What you get

- A **Command Blocks** view in the bottom panel. Each terminal command you
  run becomes one entry: command text (truncated for display, full text
  preserved for copy), terminal name, duration, and a color-coded status
  icon (green check / red error / gray "unknown" / spinning "running").
- Expand a block to see up to the **last 20 captured output lines** (ANSI
  escape sequences stripped for readability), if output capture is
  available (see limitation below).
- Inline per-block actions: **rerun** (re-sends the command text to the
  *same* terminal via `terminal.sendText`, only if that terminal is still
  open) and **copy command**; **copy output** appears only on blocks that
  captured output.
- Commands: `LakshX: Show Terminal Command Blocks`
  (`lakshx.terminal.showHistory`), `LakshX: Rerun Last Terminal Command`
  (`lakshx.terminal.rerunLast`), `LakshX: Clear Terminal Command History`
  (`lakshx.terminal.clearHistory`).
- A status bar item (bottom right) showing the most recent command's exit
  status; click it to open the panel.
- History is kept in memory only, bounded to the last **200** commands
  across the session (oldest dropped first). Nothing is persisted to disk.

## Honest limitations

- **The terminal buffer itself is untouched.** There is no in-terminal
  visual grouping, no collapse arrows drawn over the real xterm.js output,
  no "block" borders inside the terminal panel. That capability does not
  exist for extensions in VS Code today — this is a platform limitation,
  not a shortcut taken in this implementation. The Command Blocks *panel* is
  the real, addressable surface.
- **Requires shell integration to be active.** If a terminal's shell
  doesn't support (or hasn't activated) VS Code's shell integration script
  — for example Command Prompt on Windows, or a shell/config that disables
  it — `Terminal.shellIntegration` stays `undefined` and no start/end events
  fire for commands run in it. Those commands simply won't appear here;
  there's no fallback detection path.
- **Command-line text accuracy depends on shell integration's own
  confidence.** VS Code annotates each captured command line with a
  `confidence` (`Low`/`Medium`/`High`) based on how it was obtained; this
  extension always uses the reported value as-is and does not second-guess
  it, so unusual cases (multi-line commands, commands starting in column 0)
  may occasionally show an imprecise command line.
- **Output preview is best-effort, not a full log.** It's a bounded sliding
  window of the last 20 lines, assembled from a raw ANSI-including stream
  with a conservative escape-sequence stripper — interactive/full-screen
  programs (editors, `top`, progress bars) may leave odd artifacts rather
  than clean lines.
- **Rerun requires the original terminal to still be open.** This
  extension does not spawn a replacement terminal or guess at a "closest
  equivalent" — if the terminal was closed, rerun fails with an explicit
  message rather than silently doing something different from what was
  asked.

## Files

- `extension.js` — activation, the `TerminalShellExecution` event wiring,
  the `TreeDataProvider`, and command/status-bar registration. All
  `vscode`-touching code lives here.
- `lib/history.js` — pure logic with no `vscode` dependency: duration
  formatting, exit-status classification, bounded history/output-line
  storage, ANSI stripping, command-text truncation, and the
  label/description/icon shaping for a tree item. Covered by
  `test/history.test.js` (`npm run test:unit`, i.e. `node --test
  test/*.test.js`).
- `media/terminal.svg` — the view container icon (VS Code's own `terminal`
  codicon, vendored elsewhere in this repo under
  `upstream/extensions/*/node_modules/@vscode/codicons`, CC-BY-4.0).

## Verification performed

- `node --check extension.js` and a `JSON.parse` of `package.json` — both
  pass (syntax/structural validity only).
- `node --test test/*.test.js` — 32 unit tests over every pure function in
  `lib/history.js`, all passing.
- **Not verified**: live behavior against a real running integrated
  terminal. That requires an actual Extension Host (`F5` / Extension
  Development Host) driving a real shell with shell integration active,
  which this environment does not have. Everything above the `lib/`
  boundary (the event wiring, the TreeDataProvider, command handlers) is
  inspected for API correctness against `vscode.d.ts`, not exercised at
  runtime.
