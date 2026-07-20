/**
 * Single source of truth for the "latest LakshX build" the in-app updater
 * (app/api/update/[platform]/[quality]/[commit]/route.ts) checks against —
 * same hand-maintained-on-publish pattern as lib/downloads.ts's
 * BLOB_VERSION, and updated in the same step: every time a fresh build is
 * uploaded to the koder-downloads blob store, bump this alongside it.
 *
 * `commit` MUST match the full 40-char BUILD_SOURCEVERSION the build was
 * stamped with (.github/workflows/build.yml's Package step, or the
 * equivalent OS-Build/*.sh|.ps1 local-build step) — VSCode's own commit
 * (upstream/'s pinned code-oss checkout) is useless here since it's
 * constant across every LakshX build; BUILD_SOURCEVERSION is what makes
 * this a real per-release identifier. The update-check route 204s when the
 * requesting client's own commit already equals this value.
 */
export interface ReleaseManifest {
  /** Full 40-char git SHA of the LakshX repo commit this build was made from. */
  commit: string;
  /** Display version shown in the "update available" UI — not a strict semver, just date-based. */
  productVersion: string;
  /** Unix ms timestamp of the build. */
  timestamp: number;
  platforms: {
    "darwin-arm64"?: { url: string; sha256?: string };
    "linux-x64"?: { url: string; sha256?: string };
    "win32-x64"?: { url: string; sha256?: string };
  };
}

// PLACEHOLDER — deliberately not a real commit: this repo's HEAD at the
// moment this file was authored isn't yet the commit any CI build was
// actually stamped with (BUILD_SOURCEVERSION is set from whatever gets
// pushed and then built, which happens strictly after this file is
// committed — a real value can't exist before that). `platforms` stays
// empty until it's updated, so the update route always 204s (equivalent
// to "no update available") rather than ever advertising a URL that
// doesn't exist yet. Update this whole object for real once a CI build
// succeeds and its artifacts are uploaded to the blob store (same step as
// downloads.ts's BLOB_VERSION bump): commit = that build's actual
// BUILD_SOURCEVERSION, productVersion = a display date, platforms = the
// uploaded blob URLs.
export const LATEST_RELEASE: ReleaseManifest = {
  commit: "0000000000000000000000000000000000000000",
  productVersion: "unreleased",
  timestamp: 0,
  platforms: {},
};
