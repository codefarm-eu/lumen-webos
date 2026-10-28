#!/bin/sh
# Makes a test copy of a built .ipk with extra appinfo.json keys, for TV spikes (docs/keep-alive.md): sh tools/tv/variant.sh <in.ipk> '<json>' <out-dir>
# Example: sh tools/tv/variant.sh build/dev/com.ovsteenb.lumen_1.0.9158_all.ipk '{"noSplashOnLaunch":true}' build/variant-a
# Everything else in the app stays byte for byte as built, so the copy differs from the installed build only in those keys.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IN=$1; KEYS=$2; OUT=$3
[ -f "$IN" ] && [ -n "$KEYS" ] && [ -n "$OUT" ] || { echo "usage: variant.sh <in.ipk> '<json>' <out-dir>" >&2; exit 1; }
IN=$(cd "$(dirname "$IN")" && pwd)/$(basename "$IN")
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
ar x "$IN"
mkdir data && tar -xzf data.tar.gz -C data
APP=$(ls -d data/usr/palm/applications/*/ | head -1)
python3 -I - "$APP/appinfo.json" "$KEYS" <<'EOF'
import json, sys
path, keys = sys.argv[1], json.loads(sys.argv[2])
info = json.load(open(path))
info.update(keys)
json.dump(info, open(path, "w"), indent=2)
print("appinfo.json +", ", ".join(f"{k}={json.dumps(v)}" for k, v in keys.items()))
EOF
rm -f "$OUT"/*.ipk
"$ROOT/app/node_modules/.bin/ares-package" "$APP" --no-minify -o "$OUT"
