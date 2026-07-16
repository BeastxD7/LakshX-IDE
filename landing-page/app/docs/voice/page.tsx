import type { Metadata } from "next";
import DocArticle from "../_components/DocArticle";
import DocHeader, { AccessRow } from "../_components/DocHeader";
import Callout from "../_components/Callout";

export const metadata: Metadata = {
  title: "Voice Mode",
  description: "Offline push-to-talk dictation into the composer — designed, not yet shipped.",
};

export default function VoicePage() {
  return (
    <DocArticle>
      <DocHeader eyebrow="Coming Soon" title="Voice Mode">
        Push-to-talk dictation straight into the composer, offline and free. The design is locked; this page
        describes what it will do. It is <strong>not shipped yet</strong>.
      </DocHeader>

      <AccessRow items={[{ label: "Status", value: "design locked" }, { label: "Shipped?", value: "not yet" }]} />

      <Callout variant="warning" title="Not available in the current build">
        Voice mode is a designed feature that hasn&rsquo;t been built into a shipping release. It&rsquo;s
        documented here for transparency about the roadmap — you won&rsquo;t find a mic button in the app
        today.
      </Callout>

      <h2>The plan</h2>
      <ul>
        <li><strong>Hold to talk</strong> — press and hold a mic button next to Send; release to transcribe. Your words are inserted at the caret for you to review, never auto-sent.</li>
        <li><strong>Fully offline</strong> — transcription runs locally via a Whisper model, downloaded on first use and cached under <code>.lakshx/</code>. Audio never leaves your machine.</li>
        <li><strong>Free, no signup</strong> — no cloud STT, no API key, no per-use cost.</li>
        <li><strong>Tuned for code</strong> — recognition is biased toward code and technical terms, so identifiers and library names come through cleanly.</li>
        <li><strong>One stack on every OS</strong> — the same engine on macOS, Windows, and Linux, rather than three inconsistent native ones (Linux has no built-in STT at all).</li>
      </ul>

      <h2>Why it&rsquo;s gated</h2>
      <p>
        Microphone capture is blocked in stock editor webviews. Because LakshX is a fork it <em>can</em>{" "}
        unblock it, but that requires patching and rebuilding the underlying Electron shell and verifying
        the permission actually propagates. Rather than ship something unverified, voice is held behind that
        spike — hence &ldquo;design locked&rdquo; rather than &ldquo;available.&rdquo;
      </p>

      <Callout variant="note" title="Privacy is the headline">
        When it lands, the selling point is that dictation is entirely local: the audio is transcribed on
        your machine and thrown away — nothing is uploaded.
      </Callout>
    </DocArticle>
  );
}
