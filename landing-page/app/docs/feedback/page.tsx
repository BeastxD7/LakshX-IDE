import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";
import CodeBlock from "../_components/CodeBlock";

export const metadata: Metadata = {
  title: "Feedback & What's New",
  description: "Thumbs, retry, the diagnostic report, and the changelog panel in the LakshX chat.",
};

export default function FeedbackPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Chat & Agent" title="Feedback & What's New">
        A handful of small tools in the chat make each answer better and help you report problems: rate a
        response, retry it, copy a full diagnostic report, and see what changed in the latest build.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Per answer", value: "thumbs · retry" },
          { label: "Diagnostics", value: "/report" },
          { label: "Changelog", value: "What's new (★)" },
        ]}
      />

      <h2>Rate and retry</h2>
      <p>Each agent response has a small action row:</p>
      <ul>
        <li><strong>Thumbs up / down</strong> — mark a good or needs-work answer. Rating opens an inline form so you can add a note; feedback is logged locally.</li>
        <li><strong>Retry</strong> — re-run the same prompt to get a fresh attempt.</li>
        <li><strong>Undo</strong> — revert that message&rsquo;s file changes (see <Link href="/docs/checkpoints">Checkpoints &amp; Undo</Link>).</li>
      </ul>
      <p>Your feedback log is reachable via <strong>LakshX: Open Feedback Log</strong>.</p>

      <h2>Diagnostic session report</h2>
      <p>
        Hit a bug worth reporting? Click the diagnostics icon in the chat topbar — &ldquo;Copy full
        diagnostic session report to clipboard&rdquo; — or run the slash command:
      </p>
      <CodeBlock lang="bash" title="composer">{`/report`}</CodeBlock>
      <p>
        LakshX assembles the whole session transcript and copies it to your clipboard, ready to paste into a
        bug report. It shows the character count on success so you know it worked.
      </p>

      <h2>What&rsquo;s New</h2>
      <p>
        The star button in the chat topbar opens the <strong>What&rsquo;s New</strong>{" "}
        panel — a curated changelog drawn from the project&rsquo;s own history. It shows an indicator when there are updates
        you haven&rsquo;t seen yet, so you can catch up on new features after an update.
      </p>

      <Callout variant="tip" title="Reporting a problem?">
        <code>/report</code>{" "}
        gives maintainers the full context of what happened in one paste — it&rsquo;s the fastest way to get a bug looked at.
      </Callout>
    </DocArticle>
  );
}
