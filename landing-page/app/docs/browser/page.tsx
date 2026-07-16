import type { Metadata } from "next";
import Link from "next/link";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";
import CodeBlock from "../_components/CodeBlock";

export const metadata: Metadata = {
  title: "Interactive Browser",
  description: "The LakshX agent drives a real browser and sees the screenshots it takes.",
};

export default function BrowserPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Browser & Visual Verification" title="Interactive Browser">
        The agent can open a real browser, click and type through your running app, read the console — and,
        on vision-capable models, actually <em>see</em>{" "}
        the screenshots it takes. That&rsquo;s how it verifies
        that a change works, not just that it compiled.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Tool", value: "browser_act" },
          { label: "Scope", value: "localhost only" },
          { label: "Vision", value: "screenshots go to the model" },
        ]}
      />

      <h2>What it can do</h2>
      <p>
        The agent uses a single persistent browser session per workspace and drives it with a set of
        actions:
      </p>
      <ul>
        <li><strong>navigate</strong> — load a local URL.</li>
        <li><strong>snapshot</strong> — read the accessibility tree, with a <code>[ref]</code> for each element to act on.</li>
        <li><strong>click / type / press / scroll</strong> — interact with elements by ref.</li>
        <li><strong>wait_for</strong> — wait for a selector or condition.</li>
        <li><strong>screenshot</strong> — capture the page; the image is attached to the result.</li>
        <li><strong>read_console / read_network</strong> — inspect logs and requests.</li>
        <li><strong>evaluate</strong> — run a small script in the page.</li>
      </ul>

      <h2>How you use it</h2>
      <p>
        You don&rsquo;t call it directly — you ask. Start your app, then tell the agent to check it. For
        example:
      </p>
      <CodeBlock lang="text" title="composer">{`Run the dev server, open the login page, sign in with a
test account, and confirm the dashboard renders with no
console errors. Show me a screenshot.`}</CodeBlock>
      <p>
        The agent navigates, drives the flow, checks the console, and drops the screenshot into the chat so
        you both see the result.
      </p>

      <Callout variant="warning" title="Localhost only, by design">
        The browser tool only connects to loopback hosts — <code>127.0.0.1</code>, <code>::1</code>, and{" "}
        <code>localhost</code>. There&rsquo;s no DNS resolution and no <code>file://</code>, and a guard
        blocks any mid-session redirect off loopback. It&rsquo;s built to verify the app you&rsquo;re
        working on, not to browse the internet.
      </Callout>

      <h2>Screenshots you can see too</h2>
      <p>
        Every screenshot the agent takes is rendered inline in the chat, so visual verification is something
        you can eyeball alongside the agent — even when the agent&rsquo;s model can&rsquo;t see images, you
        can. Page content is always treated as untrusted data, never as instructions.
      </p>

      <Callout variant="note" title="Part of the bigger picture">
        This interactive browser is the behavioral-verification layer behind{" "}
        <Link href="/docs/royal-mode">Royal Mode 2.0</Link>&rsquo;s self-checking loop — the agent proving,
        in a real browser, that what it built actually works.
      </Callout>
    </DocArticle>
  );
}
