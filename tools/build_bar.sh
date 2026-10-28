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
# the screensaver's pictures (bar.js saverFind): Lumen's bundled default-N.jpg, without the -bg and -blur copies. The bar's own copy, because a
# webOS 4 web app may not load files from another app's folder (C8, 28 Oct 2026: from the bar every one of Lumen's failed, so it was black)
mkdir -p "$TMP/wallpapers"
for f in "$ROOT"/app/public/wallpapers/default-[0-9].jpg "$ROOT"/app/public/wallpapers/default-[0-9][0-9].jpg; do
  if [ -f "$f" ]; then cp "$f" "$TMP/wallpapers/"; fi
done
echo "Lumen bar: $(ls "$TMP/wallpapers" | wc -l | tr -d ' ') screensaver pictures"
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
