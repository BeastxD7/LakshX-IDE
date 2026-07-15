// Installs LakshX icons into upstream resources for whichever platforms the
// assets exist for. Called from prepare.sh — cross-platform (pure Node).
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = join(root, "upstream");
const assets = join(root, "assets");

const installs = [
  ["koder.icns", "resources/darwin/code.icns"],
  ["koder.ico", "resources/win32/code.ico"],
  ["koder-512.png", "resources/linux/code.png"],
];
for (const [asset, dest] of installs) {
  const src = join(assets, asset);
  const dst = join(upstream, dest);
  if (existsSync(src) && existsSync(dirname(dst))) {
    copyFileSync(src, dst);
    console.log(`icon: ${asset} → ${dest}`);
  }
}

// Inno Setup wizard imagery (the big page-side image + small corner icon
// shown during Windows install, at 7 DPI scales each) is a SEPARATE asset
// pair from code.ico above — code.iss references resources/win32/inno-
// {big,small}-<scale>.bmp directly (see build/win32/code.iss's
// WizardImageFile/WizardSmallImageFile), and code.ico only covers the
// installer .exe's own file icon, not what the wizard UI itself displays.
// Without this, the wizard silently falls back to Microsoft's stock VS Code
// wizard bitmaps — exactly the bug this closes (real report: installer
// screenshots showing a generic icon that was never actually branded).
// Pre-rendered (not regenerated per-build) — see assets/win32/README.md for
// how these were produced; keeps CI from needing a Python/Pillow toolchain
// on the Windows runner just to composite 14 bitmaps.
const win32AssetsDir = join(assets, "win32");
const win32Dest = join(upstream, "resources", "win32");
if (existsSync(win32AssetsDir) && existsSync(win32Dest)) {
  let count = 0;
  for (const f of readdirSync(win32AssetsDir).filter((f) => f.endsWith(".bmp"))) {
    copyFileSync(join(win32AssetsDir, f), join(win32Dest, f));
    count++;
  }
  console.log(`icon: ${count} Inno Setup wizard bitmaps → resources/win32/`);
}

// live dev bundle on macOS, if present
const app = join(upstream, ".build/electron/Koder.app/Contents/Resources");
if (existsSync(app) && existsSync(join(assets, "koder.icns"))) {
  for (const f of readdirSync(app).filter((f) => f.endsWith(".icns"))) {
    copyFileSync(join(assets, "koder.icns"), join(app, f));
  }
  console.log("icon: refreshed dev bundle");
}
