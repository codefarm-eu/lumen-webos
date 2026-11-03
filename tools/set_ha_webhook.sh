#!/bin/sh
# Puts the Home Assistant webhook id for the remote's colour keys on the TV, in /var/lib/homehook/ha-webhook-id (root only, mode 600). The
# watcher binds red, green, yellow and blue within 5 s of it being there (tools/tv/watch.sh sync_remote_keys). The id is a secret and never
# goes into this repo: give it in HA_WEBHOOK_ID, or type or pipe it in (it is not echoed). It reaches the TV on ssh's stdin, never on a
# command line. Needs LUMEN_TV_HOST in .env, as for npm run deploy.
#   HA_WEBHOOK_ID=... sh tools/set_ha_webhook.sh      or      sh tools/set_ha_webhook.sh < file
# Remove it (the colour keys are unbound within 5 s): sh tools/set_ha_webhook.sh --remove
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/tools/env.sh"
[ -n "$LUMEN_TV_HOST" ] || { echo "LUMEN_TV_HOST is not set. Copy .env.example to .env and set it." >&2; exit 1; }
F=/var/lib/homehook/ha-webhook-id
if [ "$1" = --remove ]; then
  ssh "$LUMEN_TV_HOST" "rm -f $F"
  echo "Removed the webhook id from $LUMEN_TV_HOST."
  exit 0
fi
id=${HA_WEBHOOK_ID-}
if [ -z "$id" ]; then
  if [ -t 0 ]; then
    printf 'Webhook id (not shown): ' >&2
    stty -echo; trap 'stty echo' EXIT INT TERM
    IFS= read -r id || true
    stty echo; trap - EXIT INT TERM; echo >&2
  else
    IFS= read -r id || true
  fi
fi
case "$id" in ''|*[!A-Za-z0-9_-]*) echo "The webhook id is empty or has characters other than letters, digits, - and _." >&2; exit 1 ;; esac
printf '%s\n' "$id" | ssh "$LUMEN_TV_HOST" "umask 077; mkdir -p /var/lib/homehook && cat > $F.tmp && chmod 600 $F.tmp && mv $F.tmp $F"
echo "Webhook id written to $F on $LUMEN_TV_HOST. The colour keys are bound within 5 s."
