#!/bin/sh
# Read-only look at Lumen bar's icons on the TV. Run as root. The only files it
# writes are under /tmp, and it removes them. It does not change the bar.
#
# luna-send prints nothing when its stdout is not a tty. A piped ssh is not a
# tty, which is why `luna-send -n 1 -f luna://com.webos.applicationManager/listLaunchPoints '{}'`
# came back empty. Give the session a tty, and do not pass -f (Lumen does not):
#
#   ssh -tt root@<tv> 'sh -s' < tools/tv-bar-diag.sh
#
# Or copy the script onto the TV and run it in a shell that has a tty:
#
#   sh /tmp/tv-bar-diag.sh
#
# Prints which listLaunchPoints URI answered, that JSON, the installed bar's
# data/bar.json, data/sig and data/icons, and recent bar lines from lumen.log.

# Lumen's own call (app/src/lib/root.ts) and the names other webOS versions use.
URIS="luna://com.webos.applicationManager/listLaunchPoints
luna://com.webos.service.applicationmanager/listLaunchPoints
palm://com.palm.applicationManager/listLaunchPoints"
OUT=/tmp/lumen-bar-diag.$$
ERR=/tmp/lumen-bar-diag.$$.err
rm -f "$OUT" "$ERR"
trap 'rm -f "$OUT" "$ERR"' EXIT INT TERM

# One luna-send. Prints the reply (CR stripped) or nothing. Uses a pty when
# stdout is not a tty and busybox script can make one.
luna() {
	extra=$1
	uri=$2
	: > "$OUT"
	if [ -t 1 ]; then
		# shellcheck disable=SC2086
		luna-send -n 1 $extra "$uri" '{}' > "$OUT" 2>"$ERR"
	elif command -v script >/dev/null 2>&1; then
		# busybox script: -q -c, and the older -qc form if that prints nothing
		script -q -c "luna-send -n 1 $extra '$uri' '{}'" /dev/null > "$OUT" 2>"$ERR"
		if ! grep -q . "$OUT" 2>/dev/null; then
			script -qc "luna-send -n 1 $extra '$uri' '{}'" /dev/null > "$OUT" 2>"$ERR"
		fi
	else
		luna-send -n 1 $extra "$uri" '{}' > "$OUT" 2>"$ERR"
	fi
	tr -d '\r' < "$OUT" 2>/dev/null
}

echo "=== listLaunchPoints ==="
found=0
# no -a first: that is the command Lumen runs. Then the two callers a firmware may require.
for uri in $URIS; do
	for extra in "" "-a com.ovsteenb.lumen" "-a org.webosbrew.hbchannel"; do
		if [ -n "$extra" ]; then label="$uri $extra"; else label="$uri"; fi
		reply=$(luna "$extra" "$uri")
		if printf '%s\n' "$reply" | grep -q launchPoints; then
			echo "--- answered: $label ---"
			printf '%s\n' "$reply"
			found=1
			break
		fi
		echo "--- empty or no launchPoints: $label ---"
	done
	[ "$found" = 1 ] && break
done
if [ "$found" != 1 ]; then
	echo "(no listLaunchPoints reply; stderr of the last try follows)"
	if [ -f "$ERR" ]; then cat "$ERR"; fi
fi

# barDir() is the app folder with the last segment replaced by com.ovsteenb.lumen.bar
# (app/src/lib/root.ts). Homebrew installs under /media/developer/apps.
echo "=== bar data ==="
bars=0
for base in \
	/media/developer/apps/usr/palm/applications \
	/media/cryptofs/apps/usr/palm/applications \
	/usr/palm/applications \
	/mnt/otncabi/usr/palm/applications \
	/mnt/otycabi/usr/palm/applications
do
	d="$base/com.ovsteenb.lumen.bar"
	if [ -d "$d" ] && [ ! -L "$d" ]; then
		bars=1
		echo "--- $d ---"
		if [ -f "$d/data/sig" ] && [ ! -L "$d/data/sig" ]; then echo "sig: $(cat "$d/data/sig")"; else echo "sig: (none)"; fi
		if [ -f "$d/data/bar.json" ] && [ ! -L "$d/data/bar.json" ]; then
			echo "bar.json:"
			cat "$d/data/bar.json"
			echo
		else
			echo "bar.json: (none)"
		fi
		echo "icons:"
		if [ -d "$d/data/icons" ] && [ ! -L "$d/data/icons" ]; then ls -l "$d/data/icons"; else echo "(no icons dir)"; fi
	fi
done
[ "$bars" = 1 ] || echo "(no com.ovsteenb.lumen.bar folder under the app roots)"

echo "=== lumen.log bar lines ==="
LOG=/var/lib/homehook/lumen.log
if [ -f "$LOG" ] && [ ! -L "$LOG" ]; then
	grep -e 'bar:' -e 'icon skipped' "$LOG" | tail -n 80
else
	echo "(no $LOG)"
fi
