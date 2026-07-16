import type { Metadata } from "next";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";

export const metadata: Metadata = {
  title: "Remote Access",
  description: "Pair your phone by QR and drive the LakshX agent from anywhere on your network.",
};

export default function RemoteAccessPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Remote Access" title="Remote Access">
        Kick off a long agent run at your desk, then keep an eye on it from the couch. Remote Access serves
        the chat to your phone over your local network — you can watch it work, send prompts, approve
        permissions, and switch modes, all from the browser on your phone.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Enable", value: "LakshX: Enable Remote Access" },
          { label: "Status bar", value: "$(radio-tower) Remote: <port>" },
        ]}
      />

      <h2>Turning it on</h2>
      <ul>
        <li>Run <strong>LakshX: Enable Remote Access</strong> from the command palette (it&rsquo;s off by default).</li>
        <li>Confirm the warning — this grants <em>view and control</em>, not just viewing.</li>
        <li>Scan the QR code that appears with your phone&rsquo;s camera.</li>
      </ul>
      <p>
        The status bar shows <strong>Remote: &lt;port&gt;</strong>{" "}
        while it&rsquo;s on; click it to bring the QR back. Run <strong>LakshX: Disable Remote Access</strong> to stop the server.
      </p>

      <Callout variant="warning" title="View AND control">
        Anyone who scans the QR can send prompts, approve permission requests, and switch modes — exactly as
        if they were sitting at your keyboard. Only share the QR with people (and on networks) you trust,
        and disable it when you&rsquo;re done.
      </Callout>

      <h2>How it works</h2>
      <ul>
        <li>LakshX starts a small HTTP server on your local network.</li>
        <li>Pairing is protected by a random token generated per session, held in memory only — nothing is written to disk.</li>
        <li>The QR encodes the pairing URL with that token; control actions are token-gated with timing-safe checks.</li>
      </ul>

      <h2>Permission sync</h2>
      <p>
        Permission prompts stay in sync across every surface. If a prompt is waiting and you approve it on
        your phone, it resolves on the desktop too (and vice-versa) — you&rsquo;ll never have the same
        request hanging in two places.
      </p>

      <Callout variant="note" title="Built for mobile">
        The phone view is a real mobile composer — it auto-grows, keeps the input above the keyboard, and
        escalates reconnects — so steering a run from your phone actually feels usable, not like a shrunken
        desktop page.
      </Callout>
    </DocArticle>
  );
}
