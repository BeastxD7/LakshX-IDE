// LakshX Terminal Blocks — a side-panel view that mirrors the integrated
// terminal's command history as discrete, addressable "blocks": command
// text, terminal name, start time, duration, and exit code, with
// rerun/copy actions. Built entirely on VS Code's own (stable, non-proposed)
// shell-integration API:
//
//   - vscode.window.onDidStartTerminalShellExecution
//   - vscode.window.onDidEndTerminalShellExecution
//   - TerminalShellExecution.commandLine / .cwd / .read()
//   - TerminalShellExecutionEndEvent.exitCode
//
// This is explicitly NOT a Warp-style terminal renderer: VS Code gives
// extensions no way to redraw or restyle the terminal's own xterm.js buffer,
// so command "blocks" live in this panel (a TreeView), not inside the
// terminal itself. See README.md for the honest capability/limitation
// writeup.
"use strict";

const vscode = require("vscode");
const history = require("./lib/history.js");

const MAX_HISTORY = history.DEFAULT_MAX_HISTORY;
const MAX_OUTPUT_LINES = history.DEFAULT_MAX_OUTPUT_LINES;

/** @typedef {{id:number, terminal: import("vscode").Terminal, commandText:string, terminalName:string, startTime:number, endTime:number|undefined, exitCode:number|undefined, cwd:string|undefined, outputLines:string[], outputState:{lines:string[],partial:string}|undefined, outputOmittedReason:string|undefined}} CommandEntry */

let nextId = 1;
/** @type {CommandEntry[]} newest-first, bounded to MAX_HISTORY */
let entries = [];
/** Maps an in-flight TerminalShellExecution -> entry id, so the matching end event can find it. Cleared as soon as each execution ends (bounded by construction, not by history size). */
const executionToEntryId = new Map();

function findEntry(id) {
  return entries.find((e) => e.id === id);
}

/** Project a live CommandEntry down to the plain-data shape lib/history.js's pure functions expect. */
function entryToPlain(entry) {
  return {
    commandText: entry.commandText,
    terminalName: entry.terminalName,
    startTime: entry.startTime,
    endTime: entry.endTime,
    exitCode: entry.exitCode,
    cwd: entry.cwd,
    outputLines: entry.outputLines,
    outputOmittedReason: entry.outputOmittedReason,
  };
}

// ---------------------------------------------------------------------------
// TreeDataProvider — the addressable command-block list
// ---------------------------------------------------------------------------

class TerminalHistoryProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    if (element.kind === "entry") {
      const entry = findEntry(element.id);
      if (!entry) {
        const gone = new vscode.TreeItem("(removed)", vscode.TreeItemCollapsibleState.None);
        return gone;
      }
      const shaped = history.shapeCommandEntry(entryToPlain(entry));
      const item = new vscode.TreeItem(shaped.label, shaped.collapsible ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.description = shaped.description;
      item.tooltip = shaped.tooltip;
      item.iconPath = shaped.iconColorKey ? new vscode.ThemeIcon(shaped.iconId, new vscode.ThemeColor(shaped.iconColorKey)) : new vscode.ThemeIcon(shaped.iconId);
      item.contextValue = shaped.collapsible ? "lakshx.commandEntryWithOutput" : "lakshx.commandEntry";
      return item;
    }
    // element.kind === "outputLine"
    const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
    item.tooltip = element.text;
    item.contextValue = "lakshx.outputLine";
    return item;
  }

  getChildren(element) {
    if (!element) {
      return entries.map((e) => ({ kind: "entry", id: e.id }));
    }
    if (element.kind === "entry") {
      const entry = findEntry(element.id);
      if (!entry || !entry.outputLines || entry.outputLines.length === 0) return [];
      return entry.outputLines.map((text, index) => ({ kind: "outputLine", entryId: entry.id, index, text }));
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rerun / copy actions
// ---------------------------------------------------------------------------

async function rerunEntry(entry) {
  if (!entry) return;
  if (!entry.commandText) {
    vscode.window.showWarningMessage("LakshX Terminal Blocks: no command text was captured for this block, so it can't be rerun.");
    return;
  }
  if (!vscode.window.terminals.includes(entry.terminal)) {
    vscode.window.showWarningMessage(`LakshX Terminal Blocks: the "${entry.terminalName}" terminal this command ran in is no longer open, so it can't be rerun there.`);
    return;
  }
  entry.terminal.show();
  entry.terminal.sendText(entry.commandText, true);
}

async function copyEntryCommand(entry) {
  if (!entry) return;
  if (!entry.commandText) {
    vscode.window.showWarningMessage("LakshX Terminal Blocks: no command text was captured for this block.");
    return;
  }
  await vscode.env.clipboard.writeText(entry.commandText);
  vscode.window.setStatusBarMessage("$(check) LakshX: command copied", 2000);
}

async function copyEntryOutput(entry) {
  if (!entry) return;
  if (!entry.outputLines || entry.outputLines.length === 0) {
    vscode.window.showInformationMessage("LakshX Terminal Blocks: no output was captured for this block.");
    return;
  }
  await vscode.env.clipboard.writeText(entry.outputLines.join("\n"));
  vscode.window.setStatusBarMessage("$(check) LakshX: output preview copied", 2000);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

function activate(context) {
  const provider = new TerminalHistoryProvider();
  const treeView = vscode.window.createTreeView("lakshx.terminalHistoryView", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  // Status bar entry point showing the last recorded command's exit status.
  // Priority 995 — below LakshX Graph's cluster (996-1000, see that
  // extension's activate() for the numbering convention) so this sits at the
  // outer edge of the same right-aligned group rather than colliding with it.
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 995);
  statusItem.command = "lakshx.terminal.showHistory";
  context.subscriptions.push(statusItem);

  function updateStatusBar() {
    if (entries.length === 0) {
      statusItem.text = "$(terminal) —";
      statusItem.tooltip = "LakshX Terminal Blocks: no commands recorded yet";
      statusItem.backgroundColor = undefined;
      statusItem.show();
      return;
    }
    const shaped = history.shapeCommandEntry(entryToPlain(entries[0]));
    const glyph = shaped.status === "success" ? "$(check)" : shaped.status === "failure" ? "$(error)" : shaped.status === "running" ? "$(sync~spin)" : "$(circle-slash)";
    statusItem.text = `${glyph} ${shaped.label}`;
    statusItem.tooltip = `LakshX Terminal Blocks — last command:\n${shaped.tooltip}`;
    statusItem.backgroundColor = shaped.status === "failure" ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
    statusItem.show();
  }
  updateStatusBar();

  function addEntry(entry) {
    entries = history.boundedUnshift(entries, entry, MAX_HISTORY);
    provider.refresh();
    updateStatusBar();
  }

  function finalizeEntry(id, endTime, exitCode, execution) {
    const entry = findEntry(id);
    if (!entry) return;
    entry.endTime = endTime;
    entry.exitCode = exitCode;
    // VS Code's docs note commandLine's value "may become more accurate
    // after onDidEndTerminalShellExecution is fired" (the shell integration
    // script can revise low/medium-confidence values once the command
    // fully completes) — re-read it here rather than trusting only the
    // start-time snapshot.
    const refreshed = execution && execution.commandLine && execution.commandLine.value;
    if (refreshed) entry.commandText = refreshed;
    provider.refresh();
    updateStatusBar();
  }

  const hasShellIntegrationEvents = typeof vscode.window.onDidStartTerminalShellExecution === "function" && typeof vscode.window.onDidEndTerminalShellExecution === "function";

  if (!hasShellIntegrationEvents) {
    // Defensive fallback: we're confident this API is stable on the engines.vscode
    // this extension declares, but if it's ever missing at runtime, fail
    // honestly (empty panel + a one-time notice) instead of throwing.
    vscode.window.showWarningMessage("LakshX Terminal Blocks: this VS Code build doesn't expose the terminal shell-integration events this extension needs, so command blocks can't be recorded.");
  } else {
    const startSub = vscode.window.onDidStartTerminalShellExecution((e) => {
      const id = nextId++;
      /** @type {CommandEntry} */
      const entry = {
        id,
        terminal: e.terminal,
        commandText: (e.execution.commandLine && e.execution.commandLine.value) || "",
        terminalName: e.terminal.name,
        startTime: Date.now(),
        endTime: undefined,
        exitCode: undefined,
        cwd: e.execution.cwd ? e.execution.cwd.fsPath || e.execution.cwd.path : undefined,
        outputLines: [],
        outputState: undefined,
        outputOmittedReason: undefined,
      };

      if (typeof e.execution.read === "function") {
        // Per VS Code's docs, read() must be called synchronously here (right
        // when the execution starts) to not miss any output; consumption of
        // the resulting async iterable can then happen in the background.
        entry.outputState = { lines: [], partial: "" };
        const stream = e.execution.read();
        (async () => {
          try {
            for await (const chunk of stream) {
              entry.outputState = history.appendOutputChunk(entry.outputState, chunk, MAX_OUTPUT_LINES);
              entry.outputLines = history.finalizeOutputLines(entry.outputState, MAX_OUTPUT_LINES);
              provider.refresh();
            }
          } catch (err) {
            entry.outputOmittedReason = `Output capture stopped early: ${err && err.message ? err.message : err}`;
            provider.refresh();
          }
        })();
      } else {
        // Gracefully omit output capture rather than guess at an API that
        // isn't present on this VS Code build — metadata (command/exit
        // code/duration/rerun) still works fully without it.
        entry.outputOmittedReason = "Output capture isn't available in this VS Code build (TerminalShellExecution.read() was not found); showing command metadata only.";
      }

      executionToEntryId.set(e.execution, id);
      addEntry(entry);
    });

    const endSub = vscode.window.onDidEndTerminalShellExecution((e) => {
      const id = executionToEntryId.get(e.execution);
      executionToEntryId.delete(e.execution);
      if (id === undefined) return; // no matching start event seen (shouldn't normally happen)
      finalizeEntry(id, Date.now(), e.exitCode, e.execution);
    });

    context.subscriptions.push(startSub, endSub);
  }

  context.subscriptions.push(
    treeView,

    vscode.commands.registerCommand("lakshx.terminal.showHistory", async () => {
      try {
        await vscode.commands.executeCommand("lakshx.terminalHistoryView.focus");
      } catch {
        // Fall back silently — the view is still reachable from the panel's
        // tab strip even if the auto-generated focus command is unavailable.
      }
    }),

    vscode.commands.registerCommand("lakshx.terminal.rerunLast", () => rerunEntry(entries[0])),

    vscode.commands.registerCommand("lakshx.terminal.clearHistory", () => {
      entries = [];
      executionToEntryId.clear();
      provider.refresh();
      updateStatusBar();
    }),

    vscode.commands.registerCommand("lakshx.terminal.rerunEntry", (item) => rerunEntry(item && findEntry(item.id))),
    vscode.commands.registerCommand("lakshx.terminal.copyCommand", (item) => copyEntryCommand(item && findEntry(item.id))),
    vscode.commands.registerCommand("lakshx.terminal.copyOutput", (item) => copyEntryOutput(item && findEntry(item.id))),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
