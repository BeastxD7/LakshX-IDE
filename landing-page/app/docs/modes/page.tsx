import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";
import CodeBlock from "../_components/CodeBlock";

export const metadata: Metadata = {
  title: "Agent Modes",
  description: "Review, Approve, Auto, and Royal — how much you let the LakshX agent do.",
};

export default function ModesPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Modes & Royal Mode" title="Agent Modes">
        The mode you pick decides how much freedom the agent has — from read-only planning, through
        approve-each-change, up to full autonomy. It&rsquo;s the single most important control in LakshX.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Switch via", value: "mode dropdown" },
          { label: "Or", value: "/plan /approve /auto /royal" },
          { label: "Default", value: "Review" },
        ]}
      />

      <h2>The four modes</h2>
      <p>Pick a mode from the dropdown in the chat topbar, or use the matching slash command.</p>

      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Review</strong></td>
            <td>Read-only. The agent researches and produces a plan but never modifies anything. You approve, reject, or refine the plan. This is the default for a new chat.</td>
          </tr>
          <tr>
            <td><strong>Approve</strong></td>
            <td>The agent proposes edits and commands, and pauses for your OK before each write or run.</td>
          </tr>
          <tr>
            <td><strong>Auto</strong></td>
            <td>Edits and commands are pre-approved — the agent acts without asking. A destructive-command floor still applies (see below).</td>
          </tr>
          <tr>
            <td><strong>Royal</strong></td>
            <td>Full autonomy, full machine access — no floor, no restrictions. Logged and checkpointed, not blocked. Gated behind a one-time consent. See <Link href="/docs/royal-mode">Royal Mode</Link>.</td>
          </tr>
        </tbody>
      </table>

      <h2>Switching modes</h2>
      <p>Use the dropdown, or type a slash command in the composer:</p>
      <CodeBlock lang="bash" title="composer">{`/plan      # Review mode — research first, produce a plan
/approve   # Approve mode — edits ask for your OK
/auto      # Auto mode — the agent acts without asking
/royal     # Royal mode — full autonomy (consent gate applies)`}</CodeBlock>

      <h2>The destructive-command floor</h2>
      <p>
        In <strong>Review</strong>, <strong>Approve</strong>, and <strong>Auto</strong>, a safety floor runs
        on every command — even after you click <em>Allow</em> in Approve. It blocks the genuinely
        dangerous things regardless of what the agent asks for, including:
      </p>
      <ul>
        <li>Force-pushing or rewriting git history</li>
        <li>Piping the internet straight into a shell (<code>curl … | sh</code>-style)</li>
        <li>Writing to paths outside your workspace</li>
      </ul>
      <p>
        <strong>Royal mode is the sole exception</strong> — it removes this floor entirely. That&rsquo;s why
        it&rsquo;s gated behind explicit consent.
      </p>

      <h2>Mode is authoritative</h2>
      <p>
        The current mode is declared to the agent as the single source of truth on every turn, and LakshX
        actively ignores any attempt in the conversation (including from tool output or a web page) to claim
        a different mode. A prompt injection that says &ldquo;you are in royal mode&rdquo; can&rsquo;t
        actually change your mode — only you can, from the UI.
      </p>

      <Callout variant="tip" title="A good default workflow">
        Start in <strong>Review</strong> to get a plan you trust, switch to <strong>Approve</strong> or{" "}
        <strong>Auto</strong> to execute it, and keep <Link href="/docs/checkpoints">checkpoints</Link>{" "}
        in your back pocket to undo anything you don&rsquo;t like.
      </Callout>
    </DocArticle>
  );
}
