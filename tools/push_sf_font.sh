#!/bin/sh
# Copies the private SF font (tools/make_sf_font.py) to /var/lib/homehook/fonts/ on the TV, from where Lumen copies it into its own folder after each update: npm run push-font
# Needs LUMEN_TV_HOST in .env, as for npm run deploy. Run it again only when the font changes; Channel updates leave it in place.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/tools/env.sh"
[ -n "$LUMEN_TV_HOST" ] || { echo "LUMEN_TV_HOST is not set. Copy .env.example to .env and set it." >&2; exit 1; }
FONT="$ROOT/app/private/fonts/sf.woff2"
[ -f "$FONT" ] || { echo "Not found: $FONT. Run tools/make_sf_font.py first." >&2; exit 1; }
ssh "$LUMEN_TV_HOST" "mkdir -p /var/lib/homehook/fonts"
scp -q "$FONT" "$LUMEN_TV_HOST:/var/lib/homehook/fonts/sf.woff2"
echo "Copied sf.woff2 to $LUMEN_TV_HOST. Relaunch Lumen to pick it up."
