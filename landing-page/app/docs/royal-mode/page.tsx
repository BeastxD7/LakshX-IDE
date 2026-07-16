import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";
import CodeBlock from "../_components/CodeBlock";

export const metadata: Metadata = {
  title: "Royal Mode",
  description: "Full autonomy with a hard consent gate, an audit log, and checkpoints.",
};

export default function RoyalModePage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Modes & Royal Mode" title="Royal Mode">
        Royal mode gives the agent full autonomy and full machine access — no approval prompts, no
        destructive-command floor. It&rsquo;s the most powerful mode, so it&rsquo;s the most carefully gated.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Enable", value: "/royal or the mode dropdown" },
          { label: "Consent", value: "one-time, per workspace" },
        ]}
      />

      <h2>What Royal mode changes</h2>
      <p>Compared to Auto mode, Royal removes the last guardrails:</p>
      <ul>
        <li>No permission prompts — every edit and command runs as issued.</li>
        <li>No destructive-command floor — force-push, history rewrites, and broad deletes are allowed.</li>
        <li>Access isn&rsquo;t confined to your workspace.</li>
      </ul>
      <p>
        &ldquo;Royal mode means no approval prompts, not no limits&rdquo; — it&rsquo;s still bounded by
        token, time, and iteration budgets, and a no-progress detector stops runaway loops.
      </p>

      <h2>The consent gate</h2>
      <p>
        The first time you switch a workspace into Royal mode, LakshX shows a warning dialog explaining the
        power you&rsquo;re handing over. You confirm with:
      </p>
      <CodeBlock lang="text" title="dialog">{`I understand — enable Royal mode`}</CodeBlock>
      <p>
        Consent is remembered per workspace, so you approve once per project. Declining reverts you to the
        previous mode. Because the gate lives in the IDE — not in the agent — a prompt injection
        can&rsquo;t auto-enable Royal mode on your behalf.
      </p>

      <Callout variant="warning" title="Only in a repo you can afford to lose">
        Royal mode can do anything you can do at a terminal, including irreversible git operations and
        deletes outside the workspace. Use it on projects under version control that you&rsquo;re prepared
        to reset, and prefer a non-production machine.
      </Callout>

      <h2>The safety net it keeps</h2>
      <p>Royal isn&rsquo;t a blind free-for-all. Two protections stay on:</p>
      <ul>
        <li><strong>Append-only audit log</strong> — every action Royal takes is recorded machine-wide, and Royal can&rsquo;t erase its own audit or checkpoint storage.</li>
        <li><strong>Checkpoints &amp; undo</strong> — LakshX still checkpoints before mutations, so workspace changes remain reversible (see <Link href="/docs/checkpoints">Checkpoints &amp; Undo</Link>). Note that undo covers your workspace, not edits Royal makes outside it.</li>
      </ul>

      <h2>Royal Mode 2.0 — coming</h2>
      <p>
        A phased, self-verifying architecture for Royal mode is designed and in progress. It wraps the
        run in an explicit state machine — <code>plan → execute → verify → fix</code> — where the agent
        can&rsquo;t declare a task done until the harness re-runs a frozen verification spec (build, tests,
        browser checks, and a fresh-context critic) server-side. This is documented as designed, not yet
        shipped as the default loop.
      </p>

      <Callout variant="note" title="Available today vs. coming">
        Royal mode itself — autonomy, the consent gate, the audit log, and checkpoints — ships today. The
        phased verification state machine (Royal Mode 2.0) is a designed, staged upgrade.
      </Callout>
    </DocArticle>
  );
}
