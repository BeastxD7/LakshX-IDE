import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";

export const metadata: Metadata = {
  title: "Checkpoints & Undo",
  description: "Per-message, per-file, and session-wide undo with a diff view.",
};

export default function CheckpointsPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Rewind & Checkpoints" title="Checkpoints & Undo">
        LakshX quietly checkpoints your files before the agent edits them, so any change is reversible —
        one file, one message, or the whole session. You never have to trust the agent not to make a mess;
        you can just undo it.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Per message", value: "Files changed card" },
          { label: "Session", value: "undo bar by the composer" },
          { label: "Shortcut", value: "/undo" },
        ]}
      />

      <h2>How checkpoints work</h2>
      <p>
        Before each prompt runs — and before each mutation — LakshX snapshots the affected files into a
        private shadow history kept outside your repo. Undoing is a precise restore from that snapshot, so
        it doesn&rsquo;t touch your real git state or anything the agent didn&rsquo;t change.
      </p>

      <h2>Per-message: the Files changed card</h2>
      <p>Every response that edits files gets a <strong>Files changed</strong> card. On it you can:</p>
      <ul>
        <li>Click a file path to <strong>open the diff</strong> and see exactly what changed.</li>
        <li>Hit <strong>Undo</strong> on any single row to revert just that file.</li>
        <li>Use <strong>Undo all N files</strong> to revert everything that message did.</li>
      </ul>
      <p>The same per-file undo also sits next to the thumbs-up / thumbs-down / retry controls.</p>

      <h2>Session-wide undo bar</h2>
      <p>
        Anchored near the composer, the session bar aggregates every file the agent has changed across the
        whole conversation (latest change wins), with the same open-diff and undo controls. It&rsquo;s the
        fastest way to walk back an entire session.
      </p>

      <Callout variant="note" title="It notices conflicts">
        If you edited a file yourself since the agent touched it — or a later prompt also changed it — undo
        asks before overwriting, with <strong>Cancel</strong> and <strong>Overwrite and Undo</strong>. It
        won&rsquo;t silently clobber your own work.
      </Callout>

      <h2>Works in every mode — including Royal</h2>
      <p>
        Checkpoints run in all modes. Even in <Link href="/docs/royal-mode">Royal mode</Link>, where the
        agent has full autonomy, workspace edits are still checkpointed and reversible. (Undo covers your
        workspace; changes Royal makes outside it aren&rsquo;t checkpointed.)
      </p>

      <Callout variant="tip" title="Undo vs. rewind">
        Reach for <strong>undo</strong> to surgically revert specific files while keeping the conversation.
        Reach for <Link href="/docs/rewind">rewind</Link> to roll the whole conversation back to an earlier
        message.
      </Callout>
    </DocArticle>
  );
}
