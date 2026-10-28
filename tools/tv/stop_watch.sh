#!/bin/sh
# Stops every running copy of the Home-button watcher (matching the exact command line, so it never kills the shell that runs this).
for p in /proc/[0-9]*; do
  # a process can end between the glob and the read: the braces send the shell's own "can't open" to /dev/null too
  c=$({ tr "\0" " " < $p/cmdline; } 2>/dev/null)
  case "$c" in "/bin/sh /var/lib/homehook/watch.sh"*|"sh /var/lib/homehook/watch.sh"*) kill ${p#/proc/} 2>/dev/null;; esac
done
# and takes the watcher's Home key bind out of LG Input Hook, so Home reaches LG's home again
K=/home/root/.config/lginputhook/keybinds.json
B='"773":{"action":"exec","command":"/bin/sh /var/lib/homehook/home-key.sh"}'
if [ -f "$K" ] && grep -qF "$B" "$K"; then
  awk -v b="$B" '{ while ((i = index($0, b ",")) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b) + 1);
    while ((i = index($0, "," b)) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b) + 1);
    while ((i = index($0, b)) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b)); print }' "$K" > "$K.tmp" && mv "$K.tmp" "$K"
fi
