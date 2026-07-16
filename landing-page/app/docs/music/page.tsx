import type { Metadata } from "next";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";
import CodeBlock from "../_components/CodeBlock";

export const metadata: Metadata = {
  title: "LakshX FM",
  description: "Free background music and cheeky cricket-style commentary while you code.",
};

export default function MusicPage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Music" title="LakshX FM & Commentary">
        Two little morale features live in the status bar: <strong>LakshX FM</strong> for background music,
        and <strong>Commentary</strong> for cheeky cricket-style play-by-play of your coding session. Both
        are free, need no signup, and work on all three platforms.
      </DocHeader>

      <AccessRow
        items={[
          { label: "Music", value: "$(play) LakshX FM" },
          { label: "Commentary", value: "$(unmute) Commentary" },
        ]}
      />

      <h2>LakshX FM (background music)</h2>
      <p>
        Click <strong>LakshX FM</strong> in the status bar to play or pause. The item shows the current
        station while playing. Commands:
      </p>
      <ul>
        <li><strong>LakshX FM: Toggle Background Music (Play/Pause)</strong></li>
        <li><strong>LakshX FM: Pick Station / Add Custom Stream</strong></li>
      </ul>
      <p>
        It streams internet radio through a hidden audio element. Built-in stations include{" "}
        <em>Radio Paradise — Main Mix</em> and <em>Mellow Mix</em>, plus a local-tracks station you can fill
        by dropping audio files into the extension&rsquo;s tracks folder.
      </p>

      <Callout variant="note" title="Custom streams must be HTTPS">
        You can paste your own stream URL via <em>Pick Station / Add Custom Stream</em>, but only{" "}
        <code>https://</code> streams work — plain <code>http://</code> is blocked as mixed content inside
        the IDE&rsquo;s webview.
      </Callout>

      <h2>Commentary</h2>
      <p>
        Commentary narrates your session in a light, cricket-commentator voice. Control it from the status
        bar or these commands:
      </p>
      <ul>
        <li><strong>LakshX Commentary: Toggle Mute</strong></li>
        <li><strong>LakshX Commentary: Toggle Voice (Text Only Mode)</strong></li>
        <li><strong>LakshX Commentary: Show a Test Line</strong></li>
      </ul>

      <h2>Free, offline voice</h2>
      <p>
        Spoken commentary uses your operating system&rsquo;s built-in text-to-speech — no API key, no
        account, nothing leaves your machine:
      </p>
      <CodeBlock lang="bash">{`# macOS      -> say
# Windows    -> PowerShell speech
# Linux      -> espeak / spd-say  (auto-detected)`}</CodeBlock>
      <p>Prefer it silent? Switch to text-only mode and it&rsquo;ll print lines instead of speaking them.</p>
    </DocArticle>
  );
}
