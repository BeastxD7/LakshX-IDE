#!/usr/bin/env bash
# assets/icon.svg → Koder.icns; installs into upstream resources (future builds)
# and the live dev app bundle (immediate effect).
set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# render SVG → 1024px PNG (qlmanage ships with macOS)
qlmanage -t -s 1024 -o "$TMP" assets/icon.svg >/dev/null
PNG="$TMP/icon.svg.png"
[ -f "$PNG" ] || { echo "SVG render failed" >&2; exit 1; }

ICONSET="$TMP/koder.iconset"
mkdir "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$PNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$PNG" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$TMP/koder.icns"

# future builds
cp "$TMP/koder.icns" upstream/resources/darwin/code.icns
# live dev bundle (both the app icon and any cached name)
APP=upstream/.build/electron/Koder.app
if [ -d "$APP" ]; then
  for f in "$APP"/Contents/Resources/*.icns; do
    cp "$TMP/koder.icns" "$f"
  done
  touch "$APP"
fi
echo "Koder icon installed"
