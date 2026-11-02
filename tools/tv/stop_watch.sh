#!/bin/sh
# Stops every running copy of the Home-button watcher (matching the exact command line, so it never kills the shell that runs this).
P=${HOMEHOOK_PROC:-/proc}
watchers() {
  for p in "$P"/[0-9]*; do
    # a process can end between the glob and the read: the braces send the shell's own "can't open" to /dev/null too
    c=$({ tr "\0" " " < "$p/cmdline"; } 2>/dev/null)
    case "$c" in "/bin/sh /var/lib/homehook/watch.sh"*|"sh /var/lib/homehook/watch.sh"*) kill -0 "${p##*/}" 2>/dev/null && echo "${p##*/}" ;; esac
  done
}
for pid in $(watchers); do kill "$pid" 2>/dev/null; done
# and waits until none is left, so a pass that was writing /etc/hosts has ended before the lines below change it (then hosts_sync takes the
# watcher's own lock as well): 10 s, then KILL, then 3 s more
i=0
while [ -n "$(watchers)" ]; do
  i=$((i + 1))
  [ "$i" -eq 11 ] && for pid in $(watchers); do kill -9 "$pid" 2>/dev/null; done
  [ "$i" -gt 13 ] && { echo "a watcher is still running: $(watchers | tr '\n' ' ')"; break; }
  sleep 1
done
# and takes the watcher's Home key bind out of LG Input Hook, so Home reaches LG's home again. The removal is watch.sh's own
# (homekey_unbind), so there is one copy of it: the installed watcher is sourced for its functions only (WATCH_SH_LIB), not run.
W=${HOMEHOOK_WATCH_SH:-/var/lib/homehook/watch.sh}
WATCH_SH_LIB=1 . "$W" 2>/dev/null || { echo "no $W: the Home key bind (if any) is left in Input Hook"; exit 0; }
# and the port 9998 rule (debugger_guard), which no running watcher puts back now: every copy, -D until -C says it is not there
# (ipt_rule_out, each call with the watcher's 5 s limit). A -C that does not answer is never read as "removed".
if command -v ipt_rule_out >/dev/null 2>&1; then
  for t in $(ipt_tools); do
    ipt_rule_out "$t"
    case $? in
      0) [ "$iro_gone" -gt 0 ] && echo "port 9998 rule removed ($t)" ;;
      2) echo "port 9998 rule still in $t: it could not be deleted" ;;
      *) [ -e "$(ipt_table "$t")" ] && echo "port 9998 rule: $t did not answer, it may still be there" ;;
    esac
  done
fi
# and the watcher's lines in /etc/hosts (hosts_sync wanting nothing: its block goes, in place, or its own bind comes off); the TV's country
# is not asked for, as nothing is written
if command -v hosts_sync >/dev/null 2>&1; then
  HOSTS_ALL_OFF=1; lgcountrytries=3
  run_dir && hosts_sync && echo "LG hosts block removed from $HOSTS (if it was there)"
fi
K=${HOMEHOOK_KEYBINDS:-$KEYBINDS}
if [ -f "$K" ] && grep -qF "$HOMEKEY_BIND" "$K"; then
  if command -v homekey_unbind >/dev/null 2>&1; then
    homekey_unbind < "$K" > "$K.tmp" && mv "$K.tmp" "$K" && echo "Home key bind removed"
  else
    echo "$W is an older watcher: open Lumen once (it updates the watcher), then run this again to remove the Home key bind"
  fi
fi
