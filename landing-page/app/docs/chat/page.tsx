import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";
import CodeBlock from "../_components/CodeBlock";

export const metadata: Metadata = {
  title: "The Chat Panel",
  description: "Talk to the LakshX agent, attach files, @-mention, and steer a run.",
};

export default function ChatPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Chat & Agent" title="The Chat Panel">
        The chat panel is where you talk to the agent. Describe a task in plain language and LakshX plans,
        edits files, and runs commands across your repo — showing every change as it goes.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Open", value: "LakshX chat panel" },
          { label: "Mode", value: "dropdown in the composer" },
          { label: "Commands", value: "type / in the composer" },
        ]}
      />

      <h2>Composing a message</h2>
      <p>
        Type what you want in the composer and send. You can enrich a prompt several ways:
      </p>
      <ul>
        <li><strong>@-mention files</strong> — start typing <code>@</code> to autocomplete a path and pin it into context.</li>
        <li><strong>Attach the current file</strong> — add the file you&rsquo;re looking at with one click.</li>
        <li><strong>Drag &amp; drop</strong> — drop files straight onto the composer to attach them.</li>
        <li><strong>Slash commands</strong> — type <code>/</code> for built-in and custom commands (see below).</li>
      </ul>

      <h2>Steering a run</h2>
      <p>
        As the agent works, tool calls and its thinking stream live into the transcript, so you can watch
        exactly what it&rsquo;s doing. If it heads the wrong way, hit <strong>Stop</strong>{" "}
        and send a
        correction — you don&rsquo;t have to wait for it to finish.
      </p>

      <Callout variant="note" title="Modes decide how much it can do">
        A brand-new chat starts in <strong>Review</strong> mode — read-only, plan-first. Switch to{" "}
        <Link href="/docs/modes">Approve, Auto, or Royal</Link> when you want it to actually make changes.
      </Callout>

      <h2>Slash commands at a glance</h2>
      <p>
        Type <code>/</code> to open the command popover. For example, to flip the agent into read-only
        planning mode:
      </p>
      <CodeBlock lang="bash" title="composer">{`/plan
# Switch to Review mode — research first, produce a plan`}</CodeBlock>
      <p>
        See the full list, plus how to write your own, on the{" "}
        <Link href="/docs/slash-commands">Slash Commands</Link> page.
      </p>

      <h2>Every change is reversible</h2>
      <p>
        LakshX checkpoints your files before it edits them. Each response carries a{" "}
        <strong>Files changed</strong> card with per-file <strong>Undo</strong>, and you can{" "}
        <Link href="/docs/rewind">rewind the whole conversation</Link> to any earlier message. Nothing the
        agent does is one-way.
      </p>

      <h2>Multiple agents in parallel</h2>
      <p>
        For research-heavy work the agent can fan out subtasks to parallel subagents and stream their
        progress back into the chat — reads are parallelized while writes stay serialized on the main
        thread for safety.
      </p>
    </DocArticle>
  );
}
