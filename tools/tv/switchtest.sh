#!/bin/sh
# Runs a fixed sequence of app switches on the TV and reports which apps survived each one, so runs before and after a change compare
# like for like (docs/keep-alive.md): sh tools/tv/switchtest.sh [dwell-seconds]. It opens apps on screen, so ask Sam first.
# Per step: the app opened, warm (it was still running) or cold, seconds until it was in front, the apps still running, and usable MB.
# "In front" is the app manager's view, not content drawn. Launches go through applicationManager/launch, as the Home button's remap does.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/tools/env.sh"
HOST=${LUMEN_TV_HOST:-root@192.168.0.20}
DWELL=${1:-20}
case "$DWELL" in ''|*[!0-9]*) echo "usage: switchtest.sh [dwell-seconds]" >&2; exit 1 ;; esac
# Home, Plex, BBC iPlayer, YouTube, Channel 4, Channel 5: the apps in daily use, with Home between them as it is used. SWITCH_SEQ replaces it.
SEQ=${SWITCH_SEQ:-"com.ovsteenb.lumen com.beb.plxnative com.ovsteenb.lumen bbc.iplayer.3.0 com.beb.plxnative youtube.leanback.v4 com.ovsteenb.lumen com.fvp.ch4 com.beb.plxnative demand5 youtube.leanback.v4 com.ovsteenb.lumen com.beb.plxnative"}

# luna-send prints nothing without a tty, hence -tt; the tty adds \r, which tr removes.
ssh -tt -o BatchMode=yes -o LogLevel=ERROR "$HOST" "
running() { luna-send -n 1 luna://com.webos.applicationManager/running '{}' | tr '{' '\n' | sed -n 's/.*\"id\":\"\([^\"]*\)\".*/\1/p' | tr '\n' ' '; }
front() { luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' | sed -n 's/.*\"appId\":\"\([^\"]*\)\".*/\1/p'; }
usable() { luna-send -n 1 luna://com.webos.memorymanager/getCurrentMemState '{}' | sed -n 's/.*\"usable\":\([0-9]*\).*/\1/p'; }
now() { cut -d' ' -f1 /proc/uptime; }
n=0; warm=0; minuse=99999
echo \"step app start secs-to-front usable | running after\"
for id in $SEQ; do
  n=\$((n + 1))
  case \" \$(running) \" in *\" \$id \"*) start=warm; warm=\$((warm + 1)) ;; *) start=cold ;; esac
  t0=\$(now)
  luna-send -n 1 luna://com.webos.applicationManager/launch \"{\\\"id\\\":\\\"\$id\\\"}\" >/dev/null
  i=0
  while [ \"\$(front)\" != \"\$id\" ] && [ \$i -lt 75 ]; do sleep 0.2; i=\$((i + 1)); done
  t1=\$(now)
  sleep $DWELL
  u=\$(usable); [ -n \"\$u\" ] && [ \"\$u\" -lt \$minuse ] && minuse=\$u
  echo \"\$n \$id \$start \$(awk -v a=\$t0 -v b=\$t1 'BEGIN{printf \"%.1f\", b-a}') \$u | \$(running)\"
done
echo \"summary: \$warm of \$n opens were warm, lowest usable \${minuse} MB\"
luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"com.ovsteenb.lumen\"}' >/dev/null
" | tr -d '\r'
