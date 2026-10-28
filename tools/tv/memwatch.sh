#!/bin/sh
# Prints the TV's memory once every N seconds while apps are opened and closed: sh tools/tv/memwatch.sh [seconds] [count]. Read only.
# Each line: time, app in front, the memory manager's level and usable MB, MemAvailable, swap used, then every running app as id=RSS+swap MB.
# Ctrl-C stops it. Uses LUMEN_TV_HOST from .env, or root@192.168.0.20.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/tools/env.sh"
HOST=${LUMEN_TV_HOST:-root@192.168.0.20}
SECS=${1:-1}
COUNT=${2:-0}
case "$SECS$COUNT" in *[!0-9]*) echo "usage: memwatch.sh [seconds] [count]" >&2; exit 1 ;; esac

# luna-send prints nothing without a tty, hence -tt; the tty adds \r, which tr removes.
ssh -tt -o BatchMode=yes -o LogLevel=ERROR "$HOST" "
n=0
while [ $COUNT -eq 0 ] || [ \$n -lt $COUNT ]; do
  n=\$((n + 1))
  fg=\$(luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' | sed -n 's/.*\"appId\":\"\([^\"]*\)\".*/\1/p')
  st=\$(luna-send -n 1 luna://com.webos.memorymanager/getCurrentMemState '{}')
  lvl=\$(echo \"\$st\" | sed -n 's/.*\"currentLevel\":\"\([^\"]*\)\".*/\1/p')
  use=\$(echo \"\$st\" | sed -n 's/.*\"usable\":\([0-9]*\).*/\1/p')
  mem=\$(awk '/^MemAvailable/{a=\$2} /^SwapTotal/{t=\$2} /^SwapFree/{f=\$2} END{printf \"avail=%d swap=%d\", a/1024, (t-f)/1024}' /proc/meminfo)
  apps=\$(luna-send -n 1 luna://com.webos.applicationManager/running '{}' | tr '{' '\n' | sed -n 's/.*\"id\":\"\([^\"]*\)\".*\"processid\":\"\([0-9]*\)\".*/\1 \2/p' |
    while read id pid; do
      awk -v id=\"\$id\" '/^VmRSS/{r=\$2} /^VmSwap/{s=\$2} END{printf \" %s=%d+%d\", id, r/1024, s/1024}' /proc/\$pid/status 2>/dev/null
    done)
  echo \"\$(date +%H:%M:%S) fg=\$fg level=\$lvl usable=\$use \$mem |\$apps\"
  sleep $SECS
done
" | tr -d '\r'
