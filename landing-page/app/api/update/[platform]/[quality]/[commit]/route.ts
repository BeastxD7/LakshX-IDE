import { NextRequest } from "next/server";
import { LATEST_RELEASE } from "../../../../../../lib/release-manifest";

export const runtime = "nodejs";

/**
 * The endpoint VSCode's built-in updater polls directly (createUpdateURL,
 * upstream/src/vs/platform/update/electron-main/abstractUpdateService.ts) —
 * `product.overrides.json`'s `updateUrl` points here. URL shape and every
 * response contract below (204 = no update, else IUpdate JSON) is fixed by
 * that client code, not something this route gets to redesign; see
 * upstream/src/vs/platform/update/common/update.ts's `IUpdate` interface
 * for the exact JSON shape expected.
 *
 * `:commit` is the requesting client's OWN build identity — round-tripped
 * from `product.json.commit`, which BUILD_SOURCEVERSION (build.yml /
 * OS-Build/*.sh|.ps1) stamps with the LakshX repo's real SHA specifically
 * so this comparison means something (upstream/'s own commit is constant
 * across every LakshX build otherwise). `:platform`/`:quality` are
 * unused beyond routing — there's only ever one `quality` ("stable") and
 * `:platform` is read from the path via `params` below, not needed
 * separately.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ platform: string; quality: string; commit: string }> }) {
  const { platform, commit } = await params;

  // macOS updates are deliberately never advertised yet: Squirrel.Mac
  // (electron.autoUpdater, updateService.darwin.ts) validates the signing
  // identity between the installed and downloaded app before it will
  // apply an update, and our .dmg is ad-hoc signed only (`codesign
  // --force --deep -s -`, no real Developer ID / Team ID) — the likely
  // outcome is Squirrel surfacing an "update is improperly signed" error
  // in the user's face instead of a working update. Unlike Linux (which
  // falls back to just opening the downloads page — see
  // updateService.linux.ts's doDownloadUpdate), Darwin has no such
  // graceful fallback built in. 204 here means "no update available" —
  // silent, not broken — until real Developer ID + notarization exists.
  const platformEntry = platform === "darwin-arm64" ? undefined : LATEST_RELEASE.platforms[platform as keyof typeof LATEST_RELEASE.platforms];

  if (!platformEntry || commit === LATEST_RELEASE.commit) {
    return new Response(null, { status: 204 });
  }

  return Response.json({
    version: LATEST_RELEASE.commit,
    productVersion: LATEST_RELEASE.productVersion,
    timestamp: LATEST_RELEASE.timestamp,
    url: platformEntry.url,
    ...(platformEntry.sha256 ? { sha256hash: platformEntry.sha256 } : {}),
  });
}
