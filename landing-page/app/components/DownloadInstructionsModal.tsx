"use client";

import { useEffect, useState } from "react";
import { X, Check, Copy } from "lucide-react";
import type { DownloadKey } from "@/lib/downloads";

/**
 * Fires right after a download link is clicked (see DownloadCta's onClick),
 * not as a permanently-visible text note. A note sitting under the button
 * blended into the busy hero photo and was reported as unreadable — this
 * is a solid, high-contrast card that only appears exactly when it's
 * relevant (the moment someone has actually started the download), so it
 * can't be missed and doesn't clutter the page for everyone else.
 */

function CodeBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable (very old browser, insecure context) —
      // the command is still selectable/copyable by hand from the <code>.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-ink-navy px-3 py-2.5 font-mono text-sm text-white">
      <code className="flex-1 overflow-x-auto whitespace-pre">{command}</code>
      <button
        type="button"
        onClick={copy}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-medium transition hover:bg-white/20"
        aria-label={copied ? "Copied" : "Copy command"}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const CONTENT: Partial<Record<DownloadKey, { title: string; body: React.ReactNode }>> = {
  macArm: {
    title: "Your download has started",
    body: (
      <>
        <p className="text-sm leading-relaxed text-ink-navy/70">
          LakshX isn&rsquo;t Apple-notarized yet, so macOS will likely say the app{" "}
          <span className="font-medium text-ink-navy">&ldquo;is damaged and can&rsquo;t be opened&rdquo;</span> the
          first time you try to launch it. This is a false alarm, not a broken download — here&rsquo;s the fix.
        </p>
        <div className="mt-5 space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-navy">1. Install it</p>
            <p className="text-sm text-ink-navy/70">Open the downloaded .dmg and drag LakshX into Applications.</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-navy">2. Clear the &ldquo;damaged&rdquo; warning</p>
            <p className="mb-2 text-sm text-ink-navy/70">
              Open Terminal and run:
            </p>
            <CodeBlock command="xattr -cr /Applications/LakshX.app" />
            <p className="mt-2 text-xs text-ink-navy/50">
              Or: right-click LakshX in Applications and choose <span className="font-medium">Open</span> instead of
              double-clicking.
            </p>
          </div>
        </div>
      </>
    ),
  },
  macIntel: {
    title: "Your download has started",
    body: (
      <>
        <p className="text-sm leading-relaxed text-ink-navy/70">
          LakshX isn&rsquo;t Apple-notarized yet, so macOS will likely say the app{" "}
          <span className="font-medium text-ink-navy">&ldquo;is damaged and can&rsquo;t be opened&rdquo;</span> the
          first time you try to launch it. This is a false alarm, not a broken download — here&rsquo;s the fix.
        </p>
        <div className="mt-5 space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-navy">1. Install it</p>
            <p className="text-sm text-ink-navy/70">Open the downloaded .dmg and drag LakshX into Applications.</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-navy">2. Clear the &ldquo;damaged&rdquo; warning</p>
            <p className="mb-2 text-sm text-ink-navy/70">
              Open Terminal and run:
            </p>
            <CodeBlock command="xattr -cr /Applications/LakshX.app" />
            <p className="mt-2 text-xs text-ink-navy/50">
              Or: right-click LakshX in Applications and choose <span className="font-medium">Open</span> instead of
              double-clicking.
            </p>
          </div>
        </div>
      </>
    ),
  },
  windows: {
    title: "Your download has started",
    body: (
      <>
        <p className="text-sm leading-relaxed text-ink-navy/70">
          LakshX isn&rsquo;t a Microsoft-verified publisher yet, so Windows may show a{" "}
          <span className="font-medium text-ink-navy">&ldquo;Windows protected your PC&rdquo;</span> SmartScreen
          warning when you run the installer. This is expected for a new app, not a sign anything&rsquo;s wrong.
        </p>
        <div className="mt-5">
          <p className="mb-1.5 text-sm font-medium text-ink-navy">To continue:</p>
          <p className="text-sm text-ink-navy/70">
            Click <span className="font-medium text-ink-navy">More info</span>, then{" "}
            <span className="font-medium text-ink-navy">Run anyway</span>.
          </p>
        </div>
      </>
    ),
  },
};

export default function DownloadInstructionsModal({
  downloadKey,
  onClose,
}: {
  downloadKey: DownloadKey | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!downloadKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [downloadKey, onClose]);

  if (!downloadKey) return null;
  const content = CONTENT[downloadKey];
  if (!content) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-navy/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-paper p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-ink-navy/40 transition hover:bg-ink-navy/5 hover:text-ink-navy"
          aria-label="Close"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <h2 id="download-modal-title" className="pr-8 text-lg font-semibold text-ink-navy">
          {content.title}
        </h2>
        <div className="mt-3">{content.body}</div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-full bg-ink-navy py-2.5 text-sm font-medium text-white transition hover:brightness-110"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
