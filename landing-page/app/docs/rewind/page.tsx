import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";

export const metadata: Metadata = {
  title: "Conversation Rewind",
  description: "Accept or rewind to any point in the conversation, reverting file changes.",
};

export default function RewindPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Rewind & Checkpoints" title="Conversation Rewind">
        Changed your mind three messages ago? Rewind puts a control on every message you sent, so you can
        roll the conversation — and the files it changed — back to any earlier point.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Where", value: "each user-message bubble" },
          { label: "Actions", value: "Rewind to here / Accept" },
        ]}
      />

      <h2>The two buttons</h2>
      <p>Every message you sent carries a small rewind row with two choices:</p>
      <ul>
        <li>
          <strong>↩ Rewind to here</strong> — reverts all file changes made since that message and removes
          it, and everything after it, from the conversation. It reverts the union of files touched by that
          prompt and every later one.
        </li>
        <li>
          <strong>✓ Accept</strong> — keep everything and just dismiss the row. It&rsquo;s a lightweight
          &ldquo;yes, this is good&rdquo; that tidies the UI; it changes no files.
        </li>
      </ul>

      <h2>How to rewind</h2>
      <ul>
        <li>Scroll to the message you want to go back to.</li>
        <li>Click <strong>Rewind to here</strong> and confirm.</li>
        <li>LakshX reverts the affected files and trims the conversation back to that point.</li>
      </ul>
      <p>
        You can then take a different path from there. The shortcut{" "}
        <code>/undo</code> rewinds to the most recent message specifically.
      </p>

      <Callout variant="note" title="Rewind vs. undo">
        <strong>Rewind</strong> moves the whole conversation back to a chosen message. Per-file and
        per-message <Link href="/docs/checkpoints">undo</Link> surgically reverts individual changes without
        rewinding the chat. Use whichever fits.
      </Callout>

      <Callout variant="tip" title="Older chats degrade gracefully">
        The rewind row appears on messages that carry a prompt id. Very old conversations simply
        don&rsquo;t show the row rather than showing a broken control.
      </Callout>
    </DocArticle>
  );
}
