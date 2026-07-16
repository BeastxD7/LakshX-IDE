import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";
import CodeBlock from "../_components/CodeBlock";

export const metadata: Metadata = {
  title: "Slash Commands",
  description: "Built-in and custom slash commands for the LakshX chat composer.",
};

export default function SlashCommandsPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Slash Commands" title="Slash Commands">
        Type <code>/</code> in the composer to open a command popover. Slash commands switch modes, manage
        the conversation, and run your own reusable prompts — without leaving the keyboard.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Open", value: "type / in the composer" },
          { label: "Custom", value: ".lakshx/commands/*.md" },
        ]}
      />

      <h2>Built-in commands</h2>
      <table>
        <thead>
          <tr>
            <th>Command</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>/plan</code></td><td>Switch to Review mode — research first, produce a plan.</td></tr>
          <tr><td><code>/approve</code></td><td>Switch to Approve mode — edits ask for your OK.</td></tr>
          <tr><td><code>/auto</code></td><td>Switch to Auto mode — the agent acts without asking.</td></tr>
          <tr><td><code>/royal</code></td><td>Switch to Royal mode — full autonomy (the consent gate still applies).</td></tr>
          <tr><td><code>/model</code></td><td><code>/model &lt;name&gt;</code> switches model; bare <code>/model</code> focuses the picker.</td></tr>
          <tr><td><code>/new</code></td><td>Start a new chat.</td></tr>
          <tr><td><code>/undo</code></td><td>Rewind to the last message — revert its file changes and remove it from the conversation.</td></tr>
          <tr><td><code>/report</code></td><td>Copy the full diagnostic session report to the clipboard.</td></tr>
          <tr><td><code>/help</code></td><td>List all slash commands.</td></tr>
        </tbody>
      </table>

      <Callout variant="note" title="The mode commands respect the gate">
        <code>/royal</code> still triggers the <Link href="/docs/royal-mode">consent gate</Link> — a slash
        command can&rsquo;t bypass it. Switching mode shows a brief confirmation toast.
      </Callout>

      <h2>Custom commands</h2>
      <p>
        Drop a markdown file into <code>.lakshx/commands/</code> in your workspace (or{" "}
        <code>~/.lakshx/commands/</code> for a personal command that follows you everywhere) and its name
        becomes a slash command. Workspace commands win name clashes with personal ones; built-in names
        always win over both.
      </p>

      <p>A minimal custom command — <code>.lakshx/commands/review.md</code>:</p>
      <CodeBlock lang="text" title=".lakshx/commands/review.md">{`---
description: Review a file for bugs and clarity
---
Carefully review $ARGUMENTS for correctness bugs, unclear
naming, and missing error handling. List concrete fixes.`}</CodeBlock>

      <p>Now in the composer:</p>
      <CodeBlock lang="bash" title="composer">{`/review src/auth/login.ts`}</CodeBlock>

      <h3>How it expands</h3>
      <ul>
        <li>The optional frontmatter block only reads <code>description:</code> — it&rsquo;s what shows in the popover. The rest of the file is the prompt body.</li>
        <li><code>$ARGUMENTS</code> is replaced by whatever you type after the command name — every occurrence.</li>
        <li>If the body has no <code>$ARGUMENTS</code>, your typed arguments are appended on a new line instead.</li>
      </ul>

      <Callout variant="tip" title="Naming rules">
        Command names start with a letter and may contain letters, digits, and <code>. _ -</code>. Matching
        is case-insensitive, and empty or frontmatter-only files are skipped.
      </Callout>
    </DocArticle>
  );
}
