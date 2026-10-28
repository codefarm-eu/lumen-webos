#!/bin/sh
# Stops every running copy of the Home-button watcher (matching the exact command line, so it never kills the shell that runs this).
for p in /proc/[0-9]*; do
  # a process can end between the glob and the read: the braces send the shell's own "can't open" to /dev/null too
  c=$({ tr "\0" " " < $p/cmdline; } 2>/dev/null)
  case "$c" in "/bin/sh /var/lib/homehook/watch.sh"*|"sh /var/lib/homehook/watch.sh"*) kill ${p#/proc/} 2>/dev/null;; esac
done
# and takes the watcher's Home key bind out of LG Input Hook, so Home reaches LG's home again. The removal is watch.sh's own
# (homekey_unbind), so there is one copy of it: the installed watcher is sourced for its functions only (WATCH_SH_LIB), not run.
W=${WATCH_SH:-/var/lib/homehook/watch.sh}
WATCH_SH_LIB=1 . "$W" 2>/dev/null || { echo "no $W: the Home key bind (if any) is left in Input Hook"; exit 0; }
K=${STOP_KEYBINDS:-$KEYBINDS}
if [ -f "$K" ] && grep -qF "$HOMEKEY_BIND" "$K"; then
  if command -v homekey_unbind >/dev/null 2>&1; then
    homekey_unbind < "$K" > "$K.tmp" && mv "$K.tmp" "$K" && echo "Home key bind removed"
  else
    echo "$W is an older watcher: open Lumen once (it updates the watcher), then run this again to remove the Home key bind"
  fi
fi
