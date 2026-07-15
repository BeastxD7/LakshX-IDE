"use client";

import { useEffect, useState } from "react";
import { Monitor, Terminal, Download } from "lucide-react";
import AppleLogo from "./AppleLogo";
import CtaButton from "./CtaButton";
import DownloadInstructionsModal from "./DownloadInstructionsModal";
import { DOWNLOADS, isDownloadConfigured, type DownloadKey } from "@/lib/downloads";
import { detectPlatform, type DetectedPlatform } from "@/lib/detect-platform";

const PLATFORM_ICON: Record<DownloadKey, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  macArm: AppleLogo,
  macIntel: AppleLogo,
  windows: Monitor,
  linux: Terminal,
};

/**
 * The primary "Download for {OS}" CTA. Server-rendered state is always the
 * neutral "unknown" state (no `navigator` on the server) — detection runs
 * once on mount in an effect, so there is no hydration mismatch: first
 * client render matches the server render, then upgrades a beat later.
 */
export default function DownloadCta() {
  const [platform, setPlatform] = useState<DetectedPlatform>("unknown");
  // Which download was just clicked, so the post-download modal shows the
  // right platform's instructions — set on click, not on a timer/poll, so
  // it appears the instant the download actually starts.
  const [activeDownload, setActiveDownload] = useState<DownloadKey | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const primaryKey: DownloadKey | null =
    platform === "mac" ? "macArm" : platform === "windows" ? "windows" : platform === "linux" ? "linux" : null;

  const primaryTarget = primaryKey ? DOWNLOADS[primaryKey] : null;
  const primaryConfigured = primaryTarget ? isDownloadConfigured(primaryTarget) : false;
  const PrimaryIcon = primaryKey ? PLATFORM_ICON[primaryKey] : Download;

  return (
    <div className="flex flex-col items-center gap-3">
      {primaryTarget ? (
        <CtaButton
          variant="primary"
          size="lg"
          href={primaryTarget.url}
          disabled={!primaryConfigured}
          className="min-w-[15rem]"
          onClick={() => primaryConfigured && primaryKey && setActiveDownload(primaryKey)}
        >
          <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
          Download for {platform === "mac" ? "macOS" : platform === "windows" ? "Windows" : "Linux"}
        </CtaButton>
      ) : platform === "unsupported" ? (
        <p className="max-w-xs text-center text-sm text-white/70">
          LakshX is available for macOS, Windows, and Linux — visit from your computer to download.
        </p>
      ) : null}

      {!primaryConfigured && primaryTarget && (
        <p className="text-xs text-white/70">Downloads aren&rsquo;t hosted yet — coming soon.</p>
      )}

      <DownloadInstructionsModal downloadKey={activeDownload} onClose={() => setActiveDownload(null)} />
    </div>
  );
}
