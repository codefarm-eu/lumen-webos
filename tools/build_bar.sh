#!/bin/sh
# Packages Lumen bar (bar/: plain files, no build step) as an .ipk in $LUMEN_BUILD_DIR (default: build/). Its version follows
# app/public/appinfo.json (the release workflow rewrites that one first), so both apps of a build share one version.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${LUMEN_BUILD_DIR:-$ROOT/build}
case "$OUT" in /*) ;; *) OUT="$(pwd)/$OUT" ;; esac   # ares-package runs from app/
TMP=$(mktemp -d)
cp -R "$ROOT/bar/." "$TMP/"
mkdir -p "$TMP/licenses" && cp "$ROOT/LICENSE" "$TMP/licenses/LICENSE.txt"
# the bar's label font (bar.css): Geist, from Lumen's sources, with its licence
mkdir -p "$TMP/fonts" && cp "$ROOT/app/src/assets/geist-static-600.woff2" "$TMP/fonts/" && cp "$ROOT/app/public/licenses/Geist-OFL.txt" "$TMP/licenses/"
# no screensaver pictures here: they ship only in Lumen, and the watcher copies them into the bar's data/wallpapers/ (watch.sh bar_pictures)
python3 - "$ROOT/app/public/appinfo.json" "$TMP/appinfo.json" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))['version']
p = sys.argv[2]; d = json.load(open(p)); d['version'] = v
json.dump(d, open(p, 'w'), indent=2); print('Lumen bar', v)
PY
mkdir -p "$OUT"
rm -f "$OUT/com.ovsteenb.lumen.bar_"*.ipk
cd "$ROOT/app" && npx ares-package "$TMP" --no-minify -o "$OUT"
rm -rf "$TMP"
echo "Packaged: $(ls "$OUT/com.ovsteenb.lumen.bar_"*.ipk)"
