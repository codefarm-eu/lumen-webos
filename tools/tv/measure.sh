#!/bin/sh
# One keep-alive run (docs/keep-alive.md): reboots the TV, waits until it has been up 150 s, saves the memory configs and the running apps,
# then runs memwatch.sh 2 beside switchtest.sh: sh tools/tv/measure.sh <out-dir> <name>. Writes <name>-config-after-boot.txt,
# <name>-mem.txt and <name>-switch.txt to <out-dir>, and prints the switch result. It reboots the TV and opens apps on screen.
# SWITCH_SEQ passes through to switchtest.sh. Uses LUMEN_TV_HOST from .env, or root@192.168.0.20.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/tools/env.sh"
HOST=${LUMEN_TV_HOST:-root@192.168.0.20}
OUT=$1; NAME=$2
[ -n "$OUT" ] && [ -n "$NAME" ] || { echo "usage: measure.sh <out-dir> <name>" >&2; exit 1; }
mkdir -p "$OUT"
S="ssh -o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=3 $HOST"

$S 'sync; (sleep 1; reboot) >/dev/null 2>&1 &'
sleep 25
until $S true 2>/dev/null; do sleep 5; done
# the memory manager and the preload manager settle in the first two minutes after boot
until [ "$($S 'cut -d. -f1 /proc/uptime')" -ge 150 ]; do sleep 10; done

# luna-send prints nothing without a tty, hence -tt; the tty adds \r, which tr removes.
ssh -tt -o BatchMode=yes -o LogLevel=ERROR "$HOST" 'luna-send -n 1 luna://com.webos.service.config/getConfigs "{\"configNames\":[\"com.webos.memorymanager.clearBackgroundApp\",\"com.webos.memorymanager.KeepOnLaunchEx\",\"com.webos.memorymanager.KeepAlive\",\"com.webos.memorymanager.HomeGroup\",\"com.webos.applicationManager.keepAliveApps\",\"com.webos.applicationManager.restrictedKeepAliveApps\",\"com.webos.service.preloadmanager.supportAppList\",\"com.webos.memorymanager.KeepAppHib\",\"com.webos.memorymanager.InputList\"]}"; luna-send -n 1 luna://com.webos.applicationManager/running "{}"' | tr -d '\r' > "$OUT/$NAME-config-after-boot.txt"

sh "$ROOT/tools/tv/memwatch.sh" 2 > "$OUT/$NAME-mem.txt" 2>&1 &
MW=$!
sh "$ROOT/tools/tv/switchtest.sh" > "$OUT/$NAME-switch.txt" 2>&1 || true
kill $MW 2>/dev/null || true
cat "$OUT/$NAME-switch.txt"
