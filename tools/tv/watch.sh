#!/bin/sh
# Home button -> custom launcher, and screensaver -> Frame (art mode). Once a second, checks which app is in front.
#  - Only with /var/lib/homehook/home-takeover present (off by default: LG Input Hook owns the Home button on this TV): when LG's own Home has just
#    come up, opens the launcher instead (polling, because luna-send buffers a subscription's output when it is piped). The launcher's own
#    "LG Home" button touches /tmp/allow_lg_home first, so LG Home can still be opened on purpose (it then stays until you leave it).
#  - After the TV wakes (power state seen leaving Active for standby or off, not the screensaver, or the CPU's ticks stopping
#    while the wall clock moves, including inside a slow Luna call) and after a boot
#    (from upstream 3f26515): opens Lumen as soon as the screen is on, whatever the TV opened itself (LG Home after the remote's power button,
#    Live TV after Wake-on-LAN), even without home-takeover. During a wake the loop ticks every 0.5 s and opens Lumen again each tick until it
#    has stayed in front for WAKE_SETTLE seconds, or WAKE_SECS (90 s after a boot) have passed; then the wake ends (also for the NL_HOME_SHOWN
#    path and Home shows the bar, through WAKEFILE) and apps are left alone. Switch off with /var/lib/homehook/no-wake-launch.
#  - About a minute after a boot, if no Lumen build is open, starts Lumen hidden (a preload launch), so the first Home press after a boot into
#    Live TV is warm, not a cold start. Switch off with /var/lib/homehook/no-boot-preload.
#  - Keeps /var/lib/homehook/recent: the last eight apps that were in front (not Lumen, not LG Home), newest first, one id per line. Lumen reads
#    it for its Recent row, so apps opened from anywhere show there.
#  - When the TV's power state becomes "Screen Saver" and /var/lib/homehook/ambient-screensaver exists (Settings > Options > Screensaver):
#    opens Lumen with {"view":"ambient"} (your Immich photos) and ends LG's screensaver. The video wallpaper, when on and in front, wins.
#    When another app was in front (a paused film in Moonfin or YouTube) and Lumen bar is installed, the screensaver is Lumen bar's overlay
#    ({"saver":true}) instead: the app stays in front under it, untouched, and a key closes the overlay. (A full-screen Lumen sent the app to
#    the background, and Moonfin answers the relaunch back with its home screen, its player gone.) Without Lumen bar, or with
#    /var/lib/homehook/no-saver-overlay, full-screen Lumen gets the app as "back" and relaunches it when the screensaver is dismissed.
#  - When the TV's power state becomes "Screen Saver" (LG's screensaver is not a foreground app, so the power state is what shows it) and
#    /var/lib/homehook/frame-screensaver exists: opens Frame in screensaver mode, then ends LG's screensaver (turnOnScreen) so Frame is what shows.
#  - What counts as LG Home: com.webos.app.home (webOS 3 to 6: the launcher bar and its Recent list, whatever brought it up: Home, a long
#    press, Back out of an app to the top level, power on) and com.webos.app.launcher, seen in front or in the extraInfo list of foreground
#    windows (where webOS 4 also reports the launcher bar while it overlays another app). With /var/lib/homehook/livetv-to-lumen (Lumen sets
#    it while its own Live TV is off): Live TV coming to the front from another app (Back out of an app falls back to it) counts too, unless
#    Lumen itself was in front just before (you picked Live TV there) or /tmp/allow_lg_home is fresh.
#  - webOS 4 (this C8): LG Home is not an app at all. It is a surface-manager window (_WEBOS_WINDOW_TYPE_HOME) drawn over the app in front, so
#    getForegroundAppInfo keeps reporting that app (or Lumen) while it is up, and launching com.webos.app.home answers "notexist". The surface
#    manager logs every time it comes up ("NL_HOME_SHOWN" in /var/log/messages: Home, long press, Back out of an app, power on), so that line
#    is what counts here: each new one is LG Home coming up once. A second loop (home_reader) checks the log every 0.25 s. When the bar came up over
#    another app, Lumen is launched, which usually takes the bar down. When it came up over Lumen itself (or is still up 1.5 s after the
#    launch), a Back key is sent through LG's network input service (what the LG phone app's remote uses), which closes the bar. Back is only
#    sent while the log says the bar is visible, so it never reaches an app.
#  - With /var/lib/homehook/home-bar (Lumen: Settings > Home Screen > Home shows the bar) and Lumen bar (com.ovsteenb.lumen.bar) installed:
#    LG's bar over another app is closed with Back and Lumen bar, an overlay window, comes up over the app instead. Over Lumen, and within
#    the wake window, as above.
#  - The Home key itself (webOS 4 and any TV with LG Input Hook injected): with home-takeover on, the watcher adds one key bind to LG Input Hook
#    (/home/root/.config/lginputhook/keybinds.json): key 773 (IR_KEY_HOME, Qt Key_Super_L) runs /var/lib/homehook/home-key.sh instead of
#    reaching the surface manager, so LG's home bar never comes up for a Home press. home-key.sh runs this file as watch-key (home_key below):
#    with Lumen bar (home-bar) it launches the bar over any app or Lumen, with {"home":true} so a press while the bar is up closes it (bar.js);
#    without the bar it launches Lumen over another app, and over Lumen does nothing. Without the watcher it sends LG's own Home
#    (networkinput, which Input Hook does not see). The bind is removed again when home-takeover goes, with /var/lib/homehook/no-home-key, or
#    by stop_watch.sh. A bind on 773 that is not ours is never touched. If Input Hook stops working, Home reaches LG again and the log
#    path (NL_HOME_SHOWN) below takes over as before.
#  - Input Hook injects itself into lginput2 once per boot; if lginput2 restarts, the hook is gone. Every 5 s the watcher checks lginput2 for
#    the hook (libphp in its maps) and re-injects it (inputhook_check: at most once a minute, 5 times a boot), logging "Input Hook
#    re-injected". LG's bar shown with no Home key before it is logged as a warning, with lginput2's hook state.
#  - After a Homebrew Channel update of Lumen the watcher refreshes itself (self_update), so the new watch.sh and 60-homehook run without
#    opening Lumen first: about every 30 s it compares the copies packaged in the Lumen build's folder (homehook/) with the installed ones and,
#    once the packaged pair has read the same on two checks in a row (the install has finished), installs it and re-execs itself. The re-exec
#    keeps this pid, so the lock stays its own and the boot hook still sees it, and it is not a boot: no wake window and no hidden preload.
# Never spins: reacts only when the app changes, and at most once every 3 s. Does nothing if the app is not installed.
# ME lists every Lumen build (stable, dev). Home opens the one that was last in front, or the first installed one in this list. The flag files in
# /var/lib/homehook/ are shared by all of them, which is fine while only one is in front at a time.
ME="com.ovsteenb.lumen com.ovsteenb.lumen.dev"
FRAME=com.ammar027.lumen.gallery
BAR=com.ovsteenb.lumen.bar
BAR_FLAG=/var/lib/homehook/home-bar
LGHOME=com.webos.app.home
LGHOMES="com.webos.app.home com.webos.app.launcher"
LIVETV=com.webos.app.livetv
LIVETV_FLAG=/var/lib/homehook/livetv-to-lumen
SYSLOG=/var/log/messages
FLAG=/tmp/allow_lg_home
SAVER_FLAG=/var/lib/homehook/frame-screensaver
VIDEO_FLAG=/var/lib/homehook/video-wallpaper
AMBIENT_FLAG=/var/lib/homehook/ambient-screensaver
AMBIENT_ON=/tmp/lumen-ambient-on
NOSAVEROVERLAY_FLAG=/var/lib/homehook/no-saver-overlay   # the screensaver over an app is full-screen Lumen again (returns with a relaunch)
APPS=/media/developer/apps/usr/palm/applications
EXTRA=/var/lib/homehook/hosts-extra
HOSTS=${HOMEHOOK_HOSTS:-/etc/hosts}
HOSTS_TABLE=${HOMEHOOK_HOSTS_TABLE:-/var/lib/homehook/hosts}   # bound over /etc/hosts only where /etc/hosts cannot be written (hosts_sync)
NOLGBLOCK_FLAG=${HOMEHOOK_NOLGBLOCK_FLAG:-/var/lib/homehook/no-lg-block}
DEBUGGER_FLAG=${HOMEHOOK_DEBUGGER_FLAG:-/var/lib/homehook/debugger-open}
DEVMODE_FLAG=${HOMEHOOK_DEVMODE_FLAG:-/var/luna/preferences/devmode_enabled}
IPT_DIRS=${HOMEHOOK_IPT_DIRS:-/usr/sbin /sbin}
TAKEOVER_FLAG=/var/lib/homehook/home-takeover
NOWAKE_FLAG=/var/lib/homehook/no-wake-launch
WAKE_SECS=30
WAKE_SETTLE=3
NOPRELOAD_FLAG=/var/lib/homehook/no-boot-preload
RECENT=/var/lib/homehook/recent
KEYBINDS=/home/root/.config/lginputhook/keybinds.json
NOHOMEKEY_FLAG=/var/lib/homehook/no-home-key
HOMEKEY_SH=/var/lib/homehook/home-key.sh
HOMEKEY_RUN=/var/lib/homehook/watch-key
# the bind, exactly as written (and looked for) in keybinds.json
HOMEKEY_BIND='"773":{"action":"exec","command":"/bin/sh /var/lib/homehook/home-key.sh"}'
# The watcher's own state and its log, written as root: in RUN, a folder only root can write (run_dir), never as a name in /tmp itself, where
# any user could have put a link first and had root write through it (truncating or appending to a root file).
# this watcher's uid (root's 0 on the TV; the tests run it as themselves). A busybox without id: 0, as the watcher only ever runs as root
MYUID=$(id -u 2>/dev/null || echo 0)
RUN=${HOMEHOOK_RUN:-/tmp/homehook.run}
LOG=${HOMEHOOK_LOG:-$RUN/homehook.log}
LASTME=${HOMEHOOK_LASTME:-$RUN/lumen-lastme}
# LG Input Hook re-injection (inputhook_check): its service injects lginput2 once per boot only (/tmp/inputhook marks it done), so when
# lginput2 restarts (seen on the C8 on 24 Oct 2026, 41 min after a boot) the new process has no hook and Home reaches LG's bar again
IH_DIR=${HOMEHOOK_IH_DIR:-/media/developer/apps/usr/palm/services/org.webosbrew.inputhook.service/inputhook}
IH_MARK=${HOMEHOOK_IH_MARK:-/tmp/inputhook}
IH_STATE=${HOMEHOOK_IH_STATE:-$RUN/homehook-reinject}   # one line per re-injection (epoch seconds), so a restarted watcher keeps the limits
IH_GAP=60          # at most one re-injection a minute
IH_MAX=5           # and at most 5 per boot, so a lginput2 crash loop is not fed
IH_LOG=${HOMEHOOK_IH_LOG:-$LOG}
HOMEKEY_AT=${HOMEHOOK_HOMEKEY_AT:-$RUN/lumen-homekey-at}   # epoch of the last Home key from Input Hook (home_key)
BAR_CLOSED_AT=${HOMEHOOK_BAR_CLOSED_AT:-$RUN/lumen-bar-closed-at}   # uptime (centiseconds) when Home last closed Lumen bar (home_key)
BAR_DEBOUNCE_CS=30     # Home within 0.3 s of the bar window coming up (about 0.5 s after the press) is ignored: a quick double press leaves it open
BAR_REOPEN_CS=200      # LG's bar showing within 2 s of a Home close does not bring Lumen bar back (on_home_shown)
ihlast=""         # lginput2 pid found last (lginput_pid tries it first)
ihpid=""          # lginput2 pid seen without the hook at the last check (it is re-injected only when seen so twice in a row)
ihgaveup=0
prev=""
prevapp=""
prevxhome=1   # no launch for a launcher window already listed when the watcher starts
last=0
okhome=0
ticks=0
hostslast=""      # what hosts_sync last logged
dbglast=""        # what debugger_guard last logged
saverlast=0
pwprev=""
lastme=""
pwlast=""
mesince=0
launchpid=0
tick=$(date +%s)
slept=$tick
own=0
mono_ok=0
mtick=""
wakeuntil=$((tick + 90))   # a boot counts as a wake; LG Home may take a while to come up
# but only a boot: a watcher (re)started later (Lumen refreshing it, stop/start by hand) must not open Lumen over the app in front
booted=$(cut -d. -f1 "${HOMEHOOK_UPTIME:-/proc/uptime}" 2>/dev/null)
[ -n "$booted" ] && [ "$booted" -gt 300 ] 2>/dev/null && wakeuntil=0
preloadat=$((tick + 60))   # once, after the boot rush; 0 when done
# likewise only after a boot: a watcher that re-execs itself after a Lumen update (self_update) does not start Lumen hidden
[ "$wakeuntil" -eq 0 ] && preloadat=0
WATCH_LOCK=${HOMEHOOK_WATCH_LOCK:-/tmp/homehook-watch.lock}
# self_update re-execs this same pid, which still holds the lock. That is not a boot, even in the first 5 minutes (uptime under
# 300 would otherwise open Lumen over the app in front and preload again). HOMEHOOK_UPTIME is /proc/uptime; tests point it elsewhere.
if [ -f "$WATCH_LOCK/pid" ] && [ ! -h "$WATCH_LOCK" ] && [ "$(stat -c %u "$WATCH_LOCK" 2>/dev/null)" = "$MYUID" ] \
  && [ "$(cat "$WATCH_LOCK/pid" 2>/dev/null)" = "$$" ]; then wakeuntil=0; preloadat=0; fi
# moves folder $1 (a name in /tmp that is not as it should be) aside whole, into a fresh folder of this user's own next to it, so the name is
# free again. Not removed: busybox rm -r walks a folder by name, so a link its owner puts inside it meanwhile would have root delete files
# elsewhere. Nobody else can rename or remove the new folder in sticky /tmp, and mv renames: a link swapped in at $1 is moved, not followed.
run_aside() {
  ra=$(mktemp -d "$1.old.XXXXXX" 2>/dev/null) || return 1
  mv -f "$1" "$ra/" 2>/dev/null
}
# makes RUN: a folder of this user's own (root on the TV), mode 700, not a link. Anything else at that name (a link, or a folder another user
# made first) is taken away (a folder moved aside) and the folder made again; mkdir fails if something got there in between, and then the
# check runs again.
run_dir() {
  for try in 1 2 3; do
    if [ -d "$RUN" ] && [ ! -h "$RUN" ] && [ "$(stat -c '%u %a' "$RUN" 2>/dev/null)" = "$MYUID 700" ]; then return 0; fi
    if [ -d "$RUN" ] && [ ! -h "$RUN" ]; then run_aside "$RUN"; else rm -f "$RUN" 2>/dev/null; fi
    mkdir -m 700 "$RUN" 2>/dev/null
  done
  return 1
}
# luna-send with a time limit: a hung Luna hub (seen after an exec restart, 60-homehook) must not stop the loop or the Home key for good.
# 10 s: right after a wake a launch can take seconds. busybox timeout takes "timeout 10" on newer builds, "timeout -t 10" on older ones; without either, luna-send runs as before.
if timeout 1 true 2>/dev/null; then LS_TO="timeout ${HOMEHOOK_LUNA_SECS:-10}"
elif timeout -t 1 true 2>/dev/null; then LS_TO="timeout -t ${HOMEHOOK_LUNA_SECS:-10}"
else LS_TO=""; fi
lsend() { $LS_TO luna-send -n 1 "$@"; }
# prints the newest "LG Home shown" line's timestamp from the surface manager's log (webOS 4), or nothing
home_shown_stamp() {
  [ -f "$SYSLOG" ] || return 0
  grep -F NL_HOME_SHOWN "$SYSLOG" 2>/dev/null | tail -n 1 | cut -d' ' -f1
}
WAKEFILE=${HOMEHOOK_WAKEFILE:-$RUN/lumen-wakeuntil}
# true while the surface manager's log says LG's home bar is up (its newest _WEBOS_WINDOW_TYPE_HOME line); false when unknown
home_visible() {
  grep -F _WEBOS_WINDOW_TYPE_HOME "$SYSLOG" 2>/dev/null | tail -n 1 | grep -q '"visible": *true'
}
# closes LG's home bar with a Back key (network input service), only while it is up
hide_home() {
  home_visible || return 0
  r=$(lsend luna://com.webos.service.networkinput/sendSpecialKey '{"key":"BACK"}' </dev/null 2>&1 | tr -d ' \n')
  echo "$(date +%T) LG Home bar closed with Back ($1): $r" >> "$LOG"
}
# one new NL_HOME_SHOWN line ($1): answer it as the main loop would (home-takeover, or the wake window; not when LG Home was asked for)
on_home_shown() {
  now=$(date +%s)
  # home_reader is a fork made before the main loop ran, so its own lastme is always empty: the main loop's choice is in LASTME
  lastme=$(cat "$LASTME" 2>/dev/null)
  fg=$(printf '%s' "$1" | sed -n 's/.*"foregroundId": *"\([^"]*\)".*/\1/p')
  echo "$(date +%T) LG Home shown (over ${fg:-?})" >> "$LOG"
  home_key_missed "$now"
  t=0
  [ -f "$TAKEOVER_FLAG" ] && t=1
  wu=$(cat "$WAKEFILE" 2>/dev/null)
  [ ! -f "$NOWAKE_FLAG" ] && [ -n "$wu" ] && [ "$now" -lt "$wu" ] 2>/dev/null && t=1
  # Home over Lumen bar's screensaver, with Home shows the bar off: the screensaver ends, as any key ends it (with the bar on, the bar's
  # relaunch below ends it). Done whatever the takeover says, since the watcher put the screensaver there.
  if [ ! -f "$BAR_FLAG" ] && bar_saver_up && bar_saver_close "LG Home shown"; then
    [ "$t" -eq 1 ] && hide_home "Lumen bar's screensaver closed"
    return 0
  fi
  [ "$t" -eq 1 ] || return 0
  if [ -f "$FLAG" ]; then
    age=$((now - $(stat -c %Y "$FLAG")))
    [ "$age" -ge 0 ] && [ "$age" -lt 30 ] && { echo "$(date +%T) left alone (asked for from Lumen)" >> "$LOG"; return 0; }
  fi
  target=$(me_target) || return 0
  if me_in_front "\"appId\":\"$fg\"" >/dev/null; then
    # over Lumen: launching it again changes nothing on screen, the bar stays
    usleep 300000 2>/dev/null || sleep 1
    hide_home "over Lumen"
    return 0
  fi
  # Home shows the bar (home-bar, and Lumen bar installed), not right after a wake: LG's bar is closed with Back first (Back would otherwise
  # go to Lumen bar once it has the focus), then Lumen bar comes up over the app, which keeps playing
  if [ -f "$BAR_FLAG" ] && [ -f "$TAKEOVER_FLAG" ] && [ -d "$APPS/$BAR" ] && { [ -z "$wu" ] || [ "$now" -ge "$wu" ] 2>/dev/null; }; then
    if bar_just_closed; then
      # Home has just closed Lumen bar: never bring it back from here; only LG's bar is closed
      hide_home "Lumen bar just closed with Home"
      return 0
    fi
    hide_home "for Lumen bar"
    i=0
    while [ "$i" -lt 8 ] && home_visible; do usleep 100000 2>/dev/null || sleep 1; i=$((i + 1)); done
    r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$BAR\"}" </dev/null 2>&1 | tr -d ' \n')
    echo "$(date +%T) LG Home -> $BAR over ${fg:-?}: $r" >> "$LOG"
    return 0
  fi
  r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$target\"}" </dev/null 2>&1 | tr -d ' \n')
  echo "$(date +%T) LG Home -> $target: $r" >> "$LOG"
  i=0
  while [ "$i" -lt 6 ]; do
    usleep 250000 2>/dev/null || sleep 1
    home_visible || return 0
    i=$((i + 1))
  done
  hide_home "still up after the launch"
}
# webOS 4: watches the log for LG's home bar, 4 times a second (only greps when the file changed)
home_reader() {
  stamp=$(home_shown_stamp)   # entries from before the watcher started are not answered
  sig=""
  while true; do
    usleep 250000 2>/dev/null || sleep 1
    s=$(stat -c '%i %s' "$SYSLOG" 2>/dev/null)
    [ "$s" = "$sig" ] && continue
    sig=$s
    l=$(grep -F NL_HOME_SHOWN "$SYSLOG" 2>/dev/null | tail -n 1)
    st=${l%% *}
    if [ -n "$st" ] && [ "$st" != "$stamp" ]; then stamp=$st; on_home_shown "$l"; fi
  done
}
# true when LG Home (any of LGHOMES) is in $1
lg_home_in() {
  for id in $LGHOMES; do case "$1" in *'"appId":"'$id'"'*) return 0 ;; esac; done
  return 1
}
# prints the Lumen build in front, if any
me_in_front() {
  for id in $ME; do case "$1" in *'"appId":"'$id'"'*) echo "$id"; return 0 ;; esac; done
  return 1
}
# prints the launch parameters for Lumen's screensaver: {"view":"ambient"}, with "back" when the TV's screensaver came up over another app ($1, the
# app in front): Lumen returns to it when the screensaver is dismissed (app.tsx leaveAmbient), so a paused film in Moonfin or YouTube is where
# it was. No "back" for Lumen itself, Lumen bar, LG Home or its launcher, or anything that is not a plain app id.
saver_params() {
  b=$1
  case "$b" in ''|*[!A-Za-z0-9._-]*) b="" ;; esac
  [ -n "$b" ] && me_in_front "\"appId\":\"$b\"" >/dev/null && b=""
  for id in $LGHOMES $BAR; do [ "$b" = "$id" ] && b=""; done
  if [ -n "$b" ]; then printf '{"view":"ambient","back":"%s"}' "$b"; else printf '{"view":"ambient"}'; fi
}
# true when the screensaver over another app is Lumen bar's overlay ($1: saver_params' output, which names the app as "back"): Lumen bar
# installed in a build that has the screensaver (its index.html has the saver element), and not switched off with no-saver-overlay
saver_overlay() {
  case "$1" in *'"back"'*) ;; *) return 1 ;; esac
  [ -f "$NOSAVEROVERLAY_FLAG" ] && return 1
  grep -q 'id="saver"' "$APPS/$BAR/index.html" 2>/dev/null
}
# Lumen bar's screensaver pictures. They ship only in Lumen (app/public/wallpapers/default-N.jpg). A webOS 4 web app can't load another
# app's files, so root copies them into the bar's own data/wallpapers/ (bar.js saverFind), with a "list" of their names. $1: the Lumen build
# (one of ME) to copy from; empty means the first one installed. Only plain files are copied, never through a link. A picture whose size
# changed is copied again, and one Lumen no longer has is removed. Quiet and quick when nothing changed. (A fresh bar with no copy yet shows
# black with the clock.)
# The bar's folder is writable by others on the C8, so a link can be put at data or data/wallpapers between any check and the next step.
# All the work is therefore done inside data/wallpapers by relative names: each folder is entered with cd -P and must then be where it should
# be (pwd -P), and the last one must be root's own, so nobody else can add a name in it. A link swapped in later can't move a folder already
# entered, so root's copies, chmods and removals stay in it. A picture is copied to .new with cp -RP (a link or a fifo is copied as one, never
# followed or read) and only a plain file is kept. Sizes are read with stat, which opens nothing.
bar_pictures() {
  bpl=""
  for bpi in $1 $ME; do case " $ME " in *" $bpi "*) [ -d "$APPS/$bpi/wallpapers" ] && { bpl=$bpi; break; } ;; esac; done
  [ -n "$bpl" ] && [ -d "$APPS/$BAR" ] || return 0
  bpr="$(cd -P "$APPS" 2>/dev/null && pwd -P)/$BAR"
  ( cd -P "$APPS/$BAR" 2>/dev/null && [ "$(pwd -P)" = "$bpr" ] || exit 0
    for bpx in data wallpapers; do
      [ -L "$bpx" ] && rm -f "$bpx"
      # someone else's wallpapers folder is left as it is, and nothing is copied: busybox rm -r walks a folder by name, so a link put inside
      # it while root removes it would have root delete files elsewhere, and moving it anywhere could land it in a link's target
      if [ "$bpx" = wallpapers ] && [ -d "$bpx" ] && [ ! -L "$bpx" ] && [ "$(stat -c %u "$bpx" 2>/dev/null)" != "$MYUID" ]; then
        echo "$(date +%T) Lumen bar: data/wallpapers is not root's own folder, no screensaver pictures copied" >> "$LOG"; exit 0
      fi
      mkdir -p "$bpx" 2>/dev/null
      bpw=$(pwd -P)
      cd -P "$bpx" 2>/dev/null && [ "$(pwd -P)" = "$bpw/$bpx" ] || exit 0
      chmod 755 . 2>/dev/null
    done
    [ "$(stat -c %u . 2>/dev/null)" = "$MYUID" ] || exit 0
    rm -rf .new .list
    bpn=""; bpc=0
    for bpf in "$APPS/$bpl"/wallpapers/default-[0-9].jpg "$APPS/$bpl"/wallpapers/default-[0-9][0-9].jpg; do
      [ -f "$bpf" ] && [ ! -L "$bpf" ] || continue
      bpb=${bpf##*/}
      bpn="$bpn$bpb
"
      if [ ! -f "$bpb" ] || [ -L "$bpb" ] || [ "$(stat -c %s "$bpf" 2>/dev/null)" != "$(stat -c %s "$bpb" 2>/dev/null)" ]; then
        cp -RP "$bpf" .new 2>/dev/null
        if [ -f .new ] && [ ! -L .new ] && chmod 644 .new && mv -f .new "$bpb"; then bpc=$((bpc + 1)); else rm -rf .new; fi
      fi
    done
    for bpf in *; do
      [ -e "$bpf" ] || [ -L "$bpf" ] || continue
      [ "$bpf" = list ] && continue
      case "
$bpn" in *"
$bpf
"*) ;; *) rm -rf "$bpf" ;; esac
    done
    if [ "$(cat list 2>/dev/null)" != "$(printf '%s' "$bpn")" ]; then
      printf '%s' "$bpn" > .list && chmod 644 .list && mv -f .list list
      echo "$(date +%T) Lumen bar: screensaver pictures from $bpl ($(printf '%s' "$bpn" | grep -c .) pictures, $bpc copied)" >> "$LOG"
    fi
  )
  return 0
}
# prints "open", "closed", or "unknown" when the app manager did not answer (or answered no running list)
bar_state() {
  bsr=$(lsend luna://com.webos.applicationManager/running '{}' </dev/null 2>/dev/null)
  case "$bsr" in *'"running"'*) ;; *) echo unknown; return 0 ;; esac
  if printf '%s' "$bsr" | grep -q '"id": *"'$BAR'"'; then echo open; else echo closed; fi
}
# true while Lumen bar is open (its screensaver may be up); an unknown answer counts as open, so nothing is undone on a hiccup
bar_running() {
  [ "$(bar_state)" != closed ]
}
# AMBIENT_ON names who set it: "bar" (Lumen bar's screensaver, bar.js) or "lumen" (Lumen's, lib/root.ts; empty from older builds)
ambient_owner() { cat "$AMBIENT_ON" 2>/dev/null; }
# true when AMBIENT_ON is left over, its owner showing no screensaver (its remove never reached the TV: the Homebrew Channel hung, or Lumen
# was closed mid-screensaver). Left there, it made the watcher only end LG's screensaver, so with Lumen in front no screensaver ever showed.
# Lumen bar's is stale once the bar is closed, whatever is in front (it is only ever shown over another app). Lumen's only when Lumen is not
# in front either ($front); Lumen in front clears its own when it starts and when it leaves the screensaver.
ambient_stale() {
  [ -f "$AMBIENT_ON" ] || return 1
  case "$(ambient_owner)" in
    bar) [ "$(bar_state)" = closed ] ;;
    *) [ -z "$front" ] && [ "$(bar_state)" = closed ] ;;
  esac
}
# true while Lumen bar's screensaver is up (its flag, and the bar open)
bar_saver_up() {
  [ "$(ambient_owner)" = bar ] && [ -d "$APPS/$BAR" ] && [ "$(bar_state)" = open ]
}
# The backlight Lumen bar's screensaver lowered (bar.js saverDim keeps the value before in SAVER_BACKLIGHT): put back and the file removed.
# Done when the watcher closes the bar (bar.js can not, closed from outside) and when it finds the bar gone with the file still there.
SAVER_BACKLIGHT=${HOMEHOOK_SAVER_BACKLIGHT:-/var/lib/homehook/saver-backlight}
sbl_next=0; sbl_wait=5; sbl_said=""
saver_backlight_restore() {
  [ -f "$SAVER_BACKLIGHT" ] || return 0
  sbt=$(date +%s)
  # the periodic retry (saver_leftover) backs off after a failure: 5 s, then twice as long each time, up to 5 minutes
  [ "$1" = periodic ] && [ "$sbt" -lt "$sbl_next" ] && return 1
  # emptied first: a read that can't open the file (the bar put it back and removed it just now) leaves both as they were, and c is shared
  # with other functions here (lginput_is reads a process name into it, inputhook_check sets it to 1 or 2: a backlight of 1)
  c=""; sbm=""
  read -r c sbm < "$SAVER_BACKLIGHT" 2>/dev/null
  case "$c" in ''|*[!0-9]*) rm -f "$SAVER_BACKLIGHT"; return 0 ;; esac
  [ "$c" -le 100 ] || { rm -f "$SAVER_BACKLIGHT"; return 0; }
  case "$sbm" in *[!A-Za-z0-9]*) sbm="" ;; esac
  # the backlight belongs to the picture mode it was read in (bar.js saves "<backlight> <mode>"): put back only into that one. An HDR film
  # started meanwhile keeps its own backlight, and this waits until the mode is back. A mode that can't be read doesn't hold it up.
  if [ -n "$sbm" ]; then
    sbc=$(lsend luna://com.webos.settingsservice/getSystemSettings '{"category":"picture","keys":["pictureMode"]}' </dev/null 2>/dev/null \
      | sed -n 's/.*"pictureMode": *"\([A-Za-z0-9]*\)".*/\1/p')
    # not a failure: no back-off (one cheap query per leftover pass), so the backlight is back within seconds of the mode; logged once
    if [ -n "$sbc" ] && [ "$sbc" != "$sbm" ]; then sbl_note "waits for picture mode $sbm (now $sbc)"; return 1; fi
  fi
  r=$(lsend luna://com.webos.settingsservice/setSystemSettings '{"category":"picture","settings":{"backlight":"'"$c"'"}}' </dev/null 2>&1 | tr -d ' \n')
  case "$r" in
    *'"returnValue":true'*) rm -f "$SAVER_BACKLIGHT"; sbl_next=0; sbl_wait=5; sbl_said=""; echo "$(date +%T) screensaver backlight put back to $c" >> "$LOG"; return 0 ;;
  esac
  sbl_backoff "$sbt" "not put back (settings service: ${r:-no answer})"
  return 1
}
# the next periodic try after a failed restore ($1: now, $2: why, logged once until it changes)
sbl_backoff() {
  sbl_next=$(($1 + sbl_wait))
  sbl_wait=$((sbl_wait * 2)); [ "$sbl_wait" -gt 300 ] && sbl_wait=300
  sbl_note "$2"
}
# logs "$1" about the saved backlight once, until the reason changes
sbl_note() {
  [ "$1" != "$sbl_said" ] && { sbl_said=$1; echo "$(date +%T) screensaver backlight $1; tried again later" >> "$LOG"; }
  return 0
}
# A backlight Lumen bar's screensaver lowered, with the bar closed some other way (the TV switched off under it, the bar ended without its
# own close): put back. Its "bar" flag goes too, as ambient_stale would drop it: a closed bar shows no screensaver. That flag is left behind
# exactly when the bar was closed from outside, and kept, it held this off until LG's next screensaver, so the panel stayed dim meanwhile.
# A leftover flag of Lumen's own (or an older build's empty one) goes by the same check, by ambient_stale's rule: with no Lumen build in
# front and the bar closed, nothing shows a screensaver (Lumen was closed mid-screensaver, or its remove was lost). Kept, it made the
# watcher only end LG's screensaver. An unknown running list changes nothing. Every 5 ticks (main loop).
saver_leftover() {
  if [ -f "$AMBIENT_ON" ]; then
    slo=$(ambient_owner)
    # Lumen's own (or an older build's empty one) is judged on the foreground app ($front), and only on a real answer ($main), so a
    # foreground query that failed never takes the flag from a screensaver Lumen is showing
    [ "$slo" = bar ] || case "$main" in *'"appId"'*) ;; *) return 0 ;; esac
    ambient_stale || return 0
    rm -f "$AMBIENT_ON"
    echo "$(date +%T) leftover screensaver flag (${slo:-old build}) removed: nothing shows a screensaver" >> "$LOG"
  fi
  [ -f "$SAVER_BACKLIGHT" ] || return 0
  [ "$(bar_state)" = closed ] || return 0
  saver_backlight_restore periodic
}
# closes Lumen bar, and with it its screensaver (which can not clear its flag when closed from here); $1 says why, for the log
bar_saver_close() {
  r=$(lsend luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$BAR\"}" </dev/null 2>&1 | tr -d ' \n')
  case "$r" in
    *'"returnValue":true'*) rm -f "$AMBIENT_ON"; saver_backlight_restore; echo "$(date +%T) $1: Lumen bar's screensaver closed" >> "$LOG"; return 0 ;;
  esac
  echo "$(date +%T) $1: Lumen bar's screensaver close failed ($r)" >> "$LOG"
  return 1
}
# prints the Lumen build Home should open: the last one in front if still installed, else the first installed one
me_target() {
  if [ -n "$lastme" ] && [ -d "$APPS/$lastme" ]; then echo "$lastme"; return 0; fi
  for id in $ME; do [ -d "$APPS/$id" ] && { echo "$id"; return 0; }; done
  return 1
}

# remembers an app that came to the front in $RECENT (plain app ids only; Lumen, Frame and LG Home are left out)
note_recent() {
  case "$1" in ''|$LGHOME|$FRAME|$BAR) return ;; esac
  for id in $ME; do [ "$1" = "$id" ] && return; done
  printf '%s' "$1" | grep -qE '^[A-Za-z0-9._-]+$' || return
  { echo "$1"; [ -f "$RECENT" ] && grep -vxF "$1" "$RECENT"; } | head -n 8 > "$RECENT.tmp" && mv "$RECENT.tmp" "$RECENT"
}

# uptime with centiseconds, for timing in the log
up() { cut -d' ' -f1 /proc/uptime; }
# uptime in centiseconds (digits only), or nothing
up_cs() {
  u=$(up); u=${u%%.*}${u#*.}
  case "$u" in ''|*[!0-9]*) return 1 ;; esac
  # no leading zeros (ash reads 012 as octal and 08 as an error), e.g. 0.50 s after a boot
  u=${u#"${u%%[!0]*}"}; echo "${u:-0}"
}
# Lumen bar's window as the surface manager last logged it (webOS 4: "LSM NL_VSC {... "app_id": "<bar>", "visible": true ...}", stamped with
# the uptime in brackets). Prints that uptime in centiseconds when the newest line says visible; false when hidden or unknown (no line: the
# log was rotated, or another firmware), and then the caller falls back to relaunching the bar.
bar_shown_at() {
  [ -f "$SYSLOG" ] || return 1
  l=$(grep -F NL_VSC "$SYSLOG" 2>/dev/null | grep -F "\"$BAR\"" | tail -n 1 | tr -d ' ')
  case "$l" in *'"visible":true'*) ;; *) return 1 ;; esac
  u=$(printf '%s' "$l" | sed -n 's/^[^[]*\[\([0-9][0-9]*\)\.\([0-9][0-9]\).*/\1\2/p')
  case "$u" in ''|*[!0-9]*) return 1 ;; esac
  u=${u#"${u%%[!0]*}"}; echo "${u:-0}"
}
# true when Home closed Lumen bar less than BAR_REOPEN_CS ago (BAR_CLOSED_AT checked to be digits: ash arithmetic on anything else is fatal)
bar_just_closed() {
  c=$(cat "$BAR_CLOSED_AT" 2>/dev/null)
  case "$c" in ''|*[!0-9]*) return 1 ;; esac
  c=${c#"${c%%[!0]*}"}; c=${c:-0}
  n=$(up_cs) || return 1
  [ $((n - c)) -ge 0 ] && [ $((n - c)) -lt "$BAR_REOPEN_CS" ]
}
# the Home key, from LG Input Hook (home-key.sh -> watch-key): LG's bar never came up, so only Lumen bar or Lumen has to be opened
home_key() {
  export PATH="/bin:/sbin:/usr/bin:/usr/sbin:$PATH"
  run_dir
  t0=$(up)
  now=$(date +%s)
  echo "$now" > "$HOMEKEY_AT"
  wu=$(cat "$WAKEFILE" 2>/dev/null)
  lastme=$(cat "$LASTME" 2>/dev/null)
  t=0
  [ -f "$TAKEOVER_FLAG" ] && t=1
  [ ! -f "$NOWAKE_FLAG" ] && [ -n "$wu" ] && [ "$now" -lt "$wu" ] 2>/dev/null && t=1
  if [ "$t" -eq 0 ] || ! target=$(me_target); then
    # takeover off (the bind is about to go) or no Lumen installed: LG's own Home, through networkinput, which Input Hook does not see
    lsend luna://com.webos.service.networkinput/sendSpecialKey '{"key":"HOME"}' </dev/null >/dev/null 2>&1
    echo "$(date +%T) Home key [$t0] -> LG Home (takeover off)" >> "$LOG"
    return 0
  fi
  main=$(lsend luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null | sed 's/": *"/":"/g')
  fg=$(printf '%s' "$main" | sed -n 's/.*"appId":"\([^"]*\)".*/\1/p')
  # a real Home press is never the power-on Home, so the wake window does not apply to the bar here
  bar=0
  [ -f "$BAR_FLAG" ] && [ -f "$TAKEOVER_FLAG" ] && [ -d "$APPS/$BAR" ] && bar=1
  # Lumen bar's screensaver is shown over an app whether or not Home shows the bar. With the bar off, Home used to launch Lumen under that
  # opaque overlay; it ends the screensaver instead, as any key does, and the app is in front as it was. (With the bar on, see below.)
  if [ "$bar" -eq 0 ] && bar_saver_up && bar_saver_close "Home key [$t0] over ${fg:-?}"; then
    up_cs > "$BAR_CLOSED_AT"
    return 0
  fi
  # Lumen's own screensaver (full screen, Lumen in front): Home leaves it for Lumen's home screen, bar or not. A plain launch is a relaunch
  # with no "view", which app.tsx answers with the home screen (with the bar on, the bar used to come up over the photos instead).
  if [ -f "$AMBIENT_ON" ] && [ "$(ambient_owner)" != bar ] && f=$(me_in_front "$main"); then
    r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$f\"}" </dev/null 2>&1 | tr -d ' \n')
    echo "$(date +%T) Home key [$t0] over Lumen's screensaver -> $f home screen: $r" >> "$LOG"
    return 0
  fi
  if [ "$bar" -eq 0 ] && me_in_front "$main" >/dev/null; then
    # no bar: as before, Home over Lumen closed LG's bar and left Lumen as it was
    echo "$(date +%T) Home key [$t0] over $fg: nothing to do" >> "$LOG"
    return 0
  fi
  # Lumen bar up (an overlay, so it is never the app in front; the surface manager's log says): Home closes it, as Back does. Closed from
  # here (closeByAppId), not by relaunching it: on the C8 a relaunch reached bar.js twice, so it closed and opened again (24 Oct 2026).
  # Within BAR_DEBOUNCE_CS of it coming up the press is ignored. If the close fails (the log was stale), the bar is launched as below.
  if [ "$bar" -eq 1 ] && shown=$(bar_shown_at) && n=$(up_cs); then
    if [ $((n - shown)) -ge 0 ] && [ $((n - shown)) -lt "$BAR_DEBOUNCE_CS" ]; then
      echo "$(date +%T) Home key [$t0] over ${fg:-?}: Lumen bar came up $((n - shown))0 ms ago, ignored" >> "$LOG"
      return 0
    fi
    r=$(lsend luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$BAR\"}" </dev/null 2>&1 | tr -d ' \n')
    case "$r" in
      *'"returnValue":true'*)
        up_cs > "$BAR_CLOSED_AT"
        # the bar may have been showing its screensaver, which can not clear its flag when closed from here
        me_in_front "$main" >/dev/null || { rm -f "$AMBIENT_ON"; saver_backlight_restore; }
        echo "$(date +%T) Home key [$t0] over ${fg:-?}: Lumen bar closed [$(up)]: $r" >> "$LOG"
        return 0 ;;
    esac
    echo "$(date +%T) Home key [$t0]: Lumen bar close failed ($r), launching it" >> "$LOG"
  fi
  # with the bar, over any app and over Lumen itself. {"home":true}: a relaunch while the bar is up (the log above unknown) closes it (bar.js)
  if [ "$bar" -eq 1 ]; then id=$BAR; launch='{"id":"'$BAR'","params":{"home":true}}'; else id=$target; launch='{"id":"'$target'"}'; fi
  r=$(lsend luna://com.webos.applicationManager/launch "$launch" </dev/null 2>&1 | tr -d ' \n')
  echo "$(date +%T) Home key [$t0] over ${fg:-?} -> $id [$(up)]: $r" >> "$LOG"
}
# opens Lumen without waiting (a launch can take seconds right after a wake), unless the last one is still in flight; $1 is the app in front
wake_open() {
  [ "$launchpid" -gt 0 ] && [ -d "/proc/$launchpid" ] && return 0
  target=$(me_target) || return 0
  ( r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$target\"}" </dev/null 2>&1 | tr -d '\n')
    echo "$(date +%T) wake: open $target over ${1:-nothing}: $r" >> "$LOG" ) &
  launchpid=$!
}
# The seconds of a pass that mean the TV was suspended. $1 the last loop top, $2 when that pass went to sleep, $3 this top, $4 the seconds
# spent in the pass's own long waits (owned: an Input Hook re-injection, a self-refresh, the bar's picture copy). $5 and $6, when both are
# set, are a monotonic clock (mono_s) at $1 and at $3: it advances while this process runs and stops across suspend, so a slow Luna call
# (the app manager busy with a launch, the bar's screensaver launch, a hub at its 10 s cutoff) is not a wake, and a suspend inside one is,
# however short. The sleep counts in full either way. The pass's own work counts on its own only past WAKE_WORK_MAX: an awake pass can not
# take that long (each Luna call is cut off at 10 s), so past it this process was held for most of the pass, whatever the ticks say. The
# ticks go on when only this process is held and not the kernel (a standby that freezes processes, or no readable /proc/stat), and the
# power state does not see such a pass either: the process never sampled the off state, and a return from Screen Saver is not a wake.
# Below WAKE_WORK_MAX, and without the tick clock, a suspend during the work is missed.
WAKE_WORK_MAX=120   # with no timeout applet a hung Luna call can still take a pass past this
wake_gap() {
  wg=$(($3 - $2))
  [ "$wg" -lt 0 ] && wg=0
  ww=$(($2 - $1 - $4))
  [ "$ww" -lt 0 ] && ww=0
  # what the wall clock alone says: the sleep, and the work too once it is past what an awake pass can take
  [ "$ww" -gt "$WAKE_WORK_MAX" ] && wg=$((wg + ww))
  if [ -n "$5" ] && [ -n "$6" ] && [ "$6" -ge "$5" ] 2>/dev/null; then
    # wall clock ahead of the monotonic clock: the CPU was not running for the difference (suspend, or the clock stepped)
    ws=$(($3 - $1 - ($6 - $5)))
    [ "$ws" -gt "$wg" ] && wg=$ws
  fi
  echo "$wg"
}
# seconds this CPU has been running, from /proc/stat: the first core's ticks (user+nice+system+idle+iowait+irq+softirq+steal at USER_HZ
# 100; guest is already inside user), or the one "cpu" line of a kernel without per-core lines. Those ticks stop across suspend; a slow call
# advances them with the wall clock. Empty when the file can't be read. One core, not the average over the cores listed: a core the kernel
# switches off or on between two passes moves that average on its own, and the first core is never switched off. Each count is split as
# text into whole seconds and the hundredths after them, and the two are added up apart, so no count itself goes through the shell's
# arithmetic: a busybox built with 32-bit arithmetic holds a core's idle ticks for 248 days, and the sum over four cores for 62.
# (verify) the C8's ticks pause while the TV is off (the wake line in the log shows wall and ticks).
mono_s() {
  ms_all=""; ms_one=""
  while IFS=' ' read -r ms_name ms_a ms_b ms_c ms_d ms_e ms_f ms_g ms_h _; do
    case "$ms_name" in
      cpu) ms_all="$ms_a $ms_b $ms_c $ms_d $ms_e $ms_f $ms_g $ms_h" ;;
      cpu0) ms_one="$ms_a $ms_b $ms_c $ms_d $ms_e $ms_f $ms_g $ms_h"; break ;;
      cpu[0-9]*) ;;
      *) break ;;
    esac
  done < "${HOMEHOOK_PROC_STAT:-/proc/stat}"
  [ -n "$ms_one" ] || ms_one=$ms_all
  [ -n "$ms_one" ] || return 1
  ms_s=0; ms_r=0
  for ms_v in $ms_one; do
    case "$ms_v" in ''|*[!0-9]*) return 1 ;; esac
    if [ ${#ms_v} -gt 2 ]; then ms_s=$((ms_s + ${ms_v%??})); ms_v=${ms_v#"${ms_v%??}"}; fi
    ms_v=${ms_v#0}
    ms_r=$((ms_r + ${ms_v:-0}))
  done
  echo $((ms_s + ms_r / 100))
}
# 1 when power returning to Active is a wake: the off state was actually seen, and it was not the screensaver ending.
# Active with the previous sample still Active (or empty, or Screen Saver) is not one. A suspend that froze this process is wake_gap's job:
# this never samples the off state, and Screen Saver -> Active is the screensaver ending, not the remote's power button.
wake_edge() {
  if [ "$2" = Active ] && [ -n "$1" ] && [ "$1" != Active ] && [ "$1" != "Screen Saver" ]; then echo 1; else echo 0; fi
}
# sets $use to 1 when this pass may compare the wall clock to mono_s. $1 wall then, $2 wall now, $3 mono then, $4 mono now.
# The tick clock is trusted once a pass shows the two moving together (a stuck /proc/stat must not look like a suspend). Before that, a pass
# whose ticks did move, but far less than the wall clock, is still a suspend: a slow Luna call moves both.
# Leaves the pass's wall seconds in $wd and its tick seconds in $md (empty without the clock), for the wake line in the log.
wake_use_mono() {
  use=0; wd=$(($2 - $1)); md=""
  [ -n "$3" ] && [ -n "$4" ] && [ "$4" -ge "$3" ] 2>/dev/null || return 0
  md=$(($4 - $3))
  if [ "$wd" -ge 1 ] && [ "$md" -ge 1 ] && [ $((wd - md)) -ge -2 ] && [ $((wd - md)) -le 2 ]; then mono_ok=1; fi
  if [ "$mono_ok" -eq 1 ] || { [ "$md" -ge 1 ] && [ $((wd - md)) -gt 5 ]; }; then use=1; fi
}
# runs "$@" and adds the seconds it took to own (see wake_gap)
owned() { ot0=$(date +%s); "$@"; otr=$?; own=$((own + $(date +%s) - ot0)); return $otr; }
# one tick of a wake (uses front, app, now, pwstate): Lumen in front as soon as the screen is on, whatever the TV opened; the TV can still put
# its own app over Lumen in the first seconds, so the wake ends only once Lumen has stayed up WAKE_SETTLE seconds
# (this fork) An app other than LG Home or Live TV straight after Lumen was in front was picked in Lumen: the wake ends there too, so an app
# opened in the first seconds is not covered by Lumen again.
wake_tick() {
  wasme=$mesince
  if [ -n "$front" ]; then [ "$mesince" -eq 0 ] && mesince=$now; else mesince=0; fi
  [ ! -f "$NOWAKE_FLAG" ] && [ "$now" -lt "$wakeuntil" ] && [ "$pwstate" = Active ] || return 0
  if [ -z "$front" ] && [ "$wasme" -gt 0 ] && [ -n "$app" ] && [ "$app" != "$LIVETV" ] && ! lg_home_in "\"appId\":\"$app\""; then
    wakeuntil=0
    echo 0 > "$WAKEFILE"
    echo "$(date +%T) wake ended: $app opened from Lumen" >> "$LOG"
    return 0
  fi
  if [ -n "$front" ]; then
    if [ $((now - mesince)) -ge "$WAKE_SETTLE" ]; then
      wakeuntil=0
      echo 0 > "$WAKEFILE"
      echo "$(date +%T) wake settled: $front in front" >> "$LOG"
    fi
  else
    wake_open "$app"
  fi
}
# adds or removes the Home key bind in LG Input Hook's keybinds.json (only ours: a 773 bind someone else made is left alone)
sync_home_key() {
  [ -f "$KEYBINDS" ] || return 0
  want=0
  [ -f "$TAKEOVER_FLAG" ] && [ ! -f "$NOHOMEKEY_FLAG" ] && want=1
  cur=$(cat "$KEYBINDS" 2>/dev/null)
  case "$cur" in *"$HOMEKEY_BIND"*) have=1 ;; *) have=0 ;; esac
  if [ "$want" -eq 1 ]; then
    # home-key.sh: runs this file as watch-key; if the watcher was removed (watch.sh gone), the key does LG's own Home
    if [ ! -f "$HOMEKEY_SH" ] || [ ! -L "$HOMEKEY_RUN" ]; then
      ln -sf watch.sh "$HOMEKEY_RUN"
      printf '%s\n' '#!/bin/sh' '# LG Input Hook runs this for the Home key (bind added by watch.sh; undo: touch /var/lib/homehook/no-home-key).' \
        'export PATH="/bin:/sbin:/usr/bin:/usr/sbin:$PATH"' \
        '[ -f /var/lib/homehook/watch-key ] && exec /bin/sh /var/lib/homehook/watch-key' \
        "exec luna-send -n 1 luna://com.webos.service.networkinput/sendSpecialKey '{\"key\":\"HOME\"}'" > "$HOMEKEY_SH.tmp" \
        && chmod 755 "$HOMEKEY_SH.tmp" && mv "$HOMEKEY_SH.tmp" "$HOMEKEY_SH"
    fi
    [ "$have" -eq 1 ] && return 0
    case "$cur" in *'"773"'*) return 0 ;; esac
    if [ -z "$(printf '%s' "$cur" | tr -d ' \t\r\n{}')" ]; then
      new="{$HOMEKEY_BIND}"
    else
      new=$(printf '%s' "$cur" | awk -v b="$HOMEKEY_BIND" 'BEGIN { d = 0 } { if (!d && (i = index($0, "{")) > 0) { $0 = substr($0, 1, i) b "," substr($0, i + 1); d = 1 } print }')
    fi
    printf '%s\n' "$new" > "$KEYBINDS.tmp" && mv "$KEYBINDS.tmp" "$KEYBINDS" && echo "$(date +%T) Home key bind added (LG Input Hook)" >> "$LOG"
  elif [ "$have" -eq 1 ]; then
    new=$(printf '%s' "$cur" | homekey_unbind)
    printf '%s\n' "$new" > "$KEYBINDS.tmp" && mv "$KEYBINDS.tmp" "$KEYBINDS" && echo "$(date +%T) Home key bind removed" >> "$LOG"
  fi
}

# keybinds.json text (stdin) without our Home bind and its comma (stdout). Also used by tools/tv/stop_watch.sh, which sources this file.
homekey_unbind() {
  awk -v b="$HOMEKEY_BIND" '{ while ((i = index($0, b ",")) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b) + 1);
    while ((i = index($0, "," b)) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b) + 1);
    while ((i = index($0, b)) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b)); print }'
}
# true when our Home bind is in Input Hook's keybinds.json (takeover on, so a Home press should come through home_key)
home_bind_on() {
  [ -f "$KEYBINDS" ] && grep -qF "$HOMEKEY_BIND" "$KEYBINDS" 2>/dev/null
}
# LG's bar came up ($1: now) with our Home bind in place but no Home key from Input Hook in the 3 s before: either Back out of an app, a long
# press or power on (which never go through the bind), or Input Hook no longer hooked into lginput2. Logged with lginput2's hook state.
# HOMEKEY_AT is checked to be digits first: in busybox ash, arithmetic on anything else ("1x") is a fatal error that would end home_reader.
home_key_missed() {
  home_bind_on || return 0
  k=$(cat "$HOMEKEY_AT" 2>/dev/null)
  case "$k" in ''|*[!0-9]*) ;; *) [ $(($1 - k)) -ge 0 ] && [ $(($1 - k)) -le 3 ] && return 0 ;; esac
  h=unknown
  p=$(lginput_pid) && { if lginput_hooked "$p"; then h=yes; else h=no; fi; }
  echo "$(date +%T) warning: LG Home shown with no Home key from Input Hook before it (Back, long press or power on; or Input Hook lost: lginput2 hooked: $h)" >> "$IH_LOG"
}
# prints lginput2's pid (the remote's key path, where Input Hook hooks in). Only a root process counts, so a process that merely names itself
# lginput2 is never taken for it. The last pid is tried first and comm is read with the read builtin: no fork per process every 5 s.
lginput_is() {
  { read -r c < "/proc/$1/comm"; } 2>/dev/null && [ "$c" = lginput2 ] && [ "$(stat -c %u "/proc/$1" 2>/dev/null)" = 0 ]
}
lginput_pid() {
  [ -n "$ihlast" ] && lginput_is "$ihlast" && { echo "$ihlast"; return 0; }
  for p in /proc/[0-9]*; do
    { read -r c < "$p/comm"; } 2>/dev/null || continue
    [ "$c" = lginput2 ] && lginput_is "${p#/proc/}" && { ihlast=${p#/proc/}; echo "$ihlast"; return 0; }
  done
  return 1
}
# true when Input Hook is loaded in process $1: libphp.so (Input Hook up to 1.4.x) or libinputhookpp.so (1.5.0 on)
lginput_hooked() {
  grep -qE 'libphp|libinputhookpp' "/proc/$1/maps" 2>/dev/null
}
# true while something (an ezinject, Input Hook's own boot injection included) is attached to process $1 with ptrace
lginput_traced() {
  t=$(sed -n 's/^TracerPid:[[:space:]]*//p' "/proc/$1/status" 2>/dev/null)
  [ -n "$t" ] && [ "$t" != 0 ]
}
# true when file $1 is a plain file (not a link) owned by the watcher's own user (root on the TV), so it is not one a non-root app put there
ih_own() {
  [ -f "$1" ] && [ ! -h "$1" ] && [ "$(stat -c %u "$1" 2>/dev/null)" = "$MYUID" ]
}
# Re-injects LG Input Hook into lginput2 when it lost the hook (lginput2 restarted), as the service does once at boot. Only with our Home bind
# on, Input Hook installed and its boot injection done (/tmp/inputhook), only when the same unhooked pid is seen on two checks in a row (so
# the service's own boot injection, still running, is never doubled), never while lginput2 is being traced (an injection under way), at most
# once every IH_GAP s and IH_MAX times a boot. Uses the service's own command for the installed Input Hook (1.5.0's inputhookpp or 1.4.x's
# PHP) and does nothing if neither is there. ezinject runs in the background and is never killed (that would leave lginput2 mid-call); the
# loop waits for it 10 s at most. $1: now.
inputhook_check() {
  [ "$ihgaveup" -eq 1 ] && return 0
  home_bind_on || return 0
  [ -x "$IH_DIR/ezinject" ] && [ -f "$IH_MARK" ] || return 0
  p=$(lginput_pid) || { ihpid=""; return 0; }
  if lginput_hooked "$p"; then ihpid=""; return 0; fi
  lginput_traced "$p" && return 0
  [ "$ihpid" = "$p" ] || { ihpid=$p; return 0; }
  # the same files and arguments the service uses
  if [ -f "$IH_DIR/libinputhookpp.so" ]; then
    set -- "$1" "$IH_DIR/libinputhookpp.so"
    ih_own "$IH_DIR/ezinject" && ih_own "$2" || { ih_refuse "$p"; return 0; }
    set -- "$1" -l "$RUN/lginput-hook-lginput2.log" "$p" "$2"
  else
    c=1; [ -e /usr/lib/libcrypt.so.2 ] && c=2
    set -- "$1" "$IH_DIR/libcrypt$c/libphp.so" "$IH_DIR/lginput-hook.php"
    [ -f "$2" ] && [ -f "$3" ] || return 0
    ih_own "$IH_DIR/ezinject" && ih_own "$2" && ih_own "$3" || { ih_refuse "$p"; return 0; }
    set -- "$1" "$p" "$2" "$3" lginput2
  fi
  n=0; lastinj=0
  [ -f "$IH_STATE" ] && { n=$(grep -c . "$IH_STATE"); lastinj=$(tail -n 1 "$IH_STATE"); }
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  case "$lastinj" in ''|*[!0-9]*) lastinj=0 ;; esac
  if [ "$n" -ge "$IH_MAX" ]; then
    ihgaveup=1
    echo "$(date +%T) Input Hook: lginput2 (pid $p) unhooked again, not re-injected ($n re-injections this boot already)" >> "$IH_LOG"
    return 0
  fi
  [ $(($1 - lastinj)) -ge "$IH_GAP" ] 2>/dev/null || [ $(($1 - lastinj)) -lt 0 ] 2>/dev/null || return 0
  echo "$1" >> "$IH_STATE"
  shift
  # Input Hook's service makes ezinject mode 777 at each start; take write away from others before root runs it
  chmod go-w "$IH_DIR/ezinject" 2>/dev/null
  "$IH_DIR/ezinject" "$@" > "$RUN/ezinject-lginput2.log" 2>&1 </dev/null &
  e=$!
  i=0
  while kill -0 "$e" 2>/dev/null && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$e" 2>/dev/null; then
    r="ezinject still running after 10 s, left alone"
  else
    wait "$e"; rc=$?
    if lginput_hooked "$p"; then r=ok; else r="failed (ezinject $rc, see $RUN/ezinject-lginput2.log)"; fi
  fi
  echo "$(date +%T) Input Hook re-injected into lginput2 (pid $p): $r" >> "$IH_LOG"
  ihpid=""
}
# Input Hook's files are not root's own plain files: never run or inject them as root (logged once per watcher)
ih_refuse() {
  ihgaveup=1
  echo "$(date +%T) Input Hook: lginput2 (pid $1) unhooked, not re-injected: Input Hook's ezinject or library is not a plain file owned by root" >> "$IH_LOG"
}
# keeps the log in /tmp (RAM) under about 512 KB: the last 2000 lines are kept
trim_log() {
  [ "$(stat -c %s "$1" 2>/dev/null || echo 0)" -gt 524288 ] || return 0
  tl=$(mktemp "$1.XXXXXX") || return 0
  tail -n 2000 "$1" > "$tl" && mv -f "$tl" "$1" || rm -f "$tl"
}

# Self-refresh after a Homebrew Channel update of Lumen (Lumen itself only refreshes the watcher when it is opened). About every 30 s:
#  - the packaged pair is $APPS/<build>/homehook/{watch.sh,60-homehook} for the build me_target names (the one Home opens). The app folder
#    belongs to the developer user and is world-writable on the C8, so the packaged files cannot be checked for root ownership: they are read
#    once into root's own temporary files next to the installed ones (mktemp, mode 600), at most SU_MAXSIZE bytes, and every check below is
#    made on those copies. A symlink, an empty file, anything over SU_MAXSIZE, or a file that is no longer the same plain file after the
#    read, is refused. There is no stat cache: a same-size rewrite in the same second would otherwise be skipped for the rest of the run.
#  - the installed watcher (and the boot hook, when it is replaced) must be root's own plain files (ih_own), checked again just before the
#    move. A boot hook that is not installed is not recreated.
#  - an install must have finished: the copies' md5 has to be the same on two checks in a row. An empty or failed checksum is not a match.
#  - the copies must parse in sh and look like the watcher and its hook; a pair that fails is logged once and not tried again until it changes.
#  - at most one refresh every SU_GAP s and SU_MAX a boot. SU_STATE in /tmp keeps the count across the re-exec. It is only ever a plain file
#    of our own: a symlink or someone else's file is replaced by rename, never read or written through, so it cannot reset the count or
#    append a line onto the watcher.
# Then the copies are moved over the installed files (mv: the running shell keeps reading its old file), home_reader is stopped and the
# watcher re-execs itself: the same pid, so the single_instance lock stays its own, and the same command line, so 60-homehook still sees it.
# home_reader is a fork of this script, so its command line matches too; it has to be gone before the new copy starts, or Home is handled
# twice (the bar would close and open again). A re-exec is not a boot. A hook-only change updates the hook without a re-exec.
SELF=${HOMEHOOK_SELF:-/var/lib/homehook/watch.sh}
INIT_HOOK=${HOMEHOOK_INIT_HOOK:-/var/lib/webosbrew/init.d/60-homehook}
SU_STATE=${HOMEHOOK_SU_STATE:-$RUN/homehook-selfupdate}   # one line per refresh (epoch seconds)
SU_GAP=60
SU_MAX=5
SU_MAXSIZE=262144
supend=""      # checksum of the packaged pair seen at the last check (it is installed only when seen the same twice)
sufail=""      # checksum of a pair that was refused (logged once)
sugaveup=0
hrpid=""       # home_reader's pid, stopped before a re-exec
# prints the packaged homehook/ folder of the Lumen build Home opens; false when there is none (or it is reached through a symlink)
su_src() {
  sut=$(me_target) || return 1
  case "$sut" in com.ovsteenb.lumen|com.ovsteenb.lumen.dev) ;; *) return 1 ;; esac
  [ -d "$APPS/$sut/homehook" ] && [ ! -h "$APPS/$sut" ] && [ ! -h "$APPS/$sut/homehook" ] || return 1
  echo "$APPS/$sut/homehook"
}
# true when $1 is a plain file (not a symlink) of 1 to SU_MAXSIZE bytes
su_plain() {
  [ -f "$1" ] && [ ! -h "$1" ] || return 1
  suz=$(stat -c %s "$1" 2>/dev/null)
  case "$suz" in ''|*[!0-9]*) return 1 ;; esac
  [ "$suz" -gt 0 ] && [ "$suz" -le "$SU_MAXSIZE" ]
}
su_log() { echo "$(date +%T) watcher refresh: $*" >> "$IH_LOG"; }
# true when pid $1 is still a shell running this watcher, and not this process
su_reader_alive() {
  [ -n "$1" ] && [ "$1" != "$$" ] || return 1
  case "$(cat "/proc/$1/cmdline" 2>/dev/null | tr '\0' ' ')" in
    "/bin/sh $SELF"*|"sh $SELF"*) return 0 ;;
  esac
  return 1
}
# home_reader is a fork, so its command line is this script's. Stop that pid only, and wait until it is gone, so the re-exec does not
# leave a second reader handling Home (a second Home then closes the bar and opens it again). A reused pid is left alone.
su_stop_reader() {
  su_reader_alive "$hrpid" || return 0
  kill "$hrpid" 2>/dev/null || return 0
  sui=0
  while su_reader_alive "$hrpid" && [ "$sui" -lt 20 ]; do
    usleep 100000 2>/dev/null || { sleep 1; break; }
    sui=$((sui + 1))
  done
  su_reader_alive "$hrpid" && kill -9 "$hrpid" 2>/dev/null
}
su_reexec() {
  su_stop_reader
  exec /bin/sh "$SELF"
  su_log "could not re-exec $SELF"
}
# copy $1 into $2 (our own file). At most SU_MAXSIZE bytes, so a swap to a huge file or /dev/zero cannot fill the disk, and only when $1
# is still the same plain file afterwards. ulimit -f is 512-byte blocks; SIGXFSZ stays in the subshell.
su_snap() {
  su_plain "$1" || return 1
  smeta=$(stat -c '%d %i %s' "$1" 2>/dev/null) || return 1
  ( ulimit -f $((SU_MAXSIZE / 512)) && cat "$1" > "$2" ) 2>/dev/null
  su_plain "$2" || return 1
  [ ! -h "$1" ] || return 1
  [ "$(stat -c '%d %i %s' "$1" 2>/dev/null)" = "$smeta" ] || return 1
  [ "$(stat -c %s "$2" 2>/dev/null)" = "${smeta##* }" ]
}
# prints the md5 of the two copies, or fails. Empty output is not a checksum: it must not compare equal to a pair not seen yet.
su_sum() {
  sline=$(cat "$1" "$2" | md5sum 2>/dev/null) || return 1
  suhash=${sline%% *}
  case "$suhash" in *[!0-9a-f]*) return 1 ;; esac
  [ "${#suhash}" -eq 32 ] || return 1
  printf '%s\n' "$suhash"
}
# append epoch $1 to SU_STATE. A symlink or a file we do not own is replaced by rename, not followed.
su_note() {
  nt=$(mktemp "$SU_STATE.XXXXXX" 2>/dev/null) || return 1
  if [ ! -h "$SU_STATE" ] && [ -f "$SU_STATE" ] && [ "$(stat -c %u "$SU_STATE" 2>/dev/null)" = "$MYUID" ]; then
    cat "$SU_STATE" > "$nt" || { rm -f "$nt"; return 1; }
  fi
  printf '%s\n' "$1" >> "$nt" || { rm -f "$nt"; return 1; }
  mv -f "$nt" "$SU_STATE" || { rm -f "$nt"; return 1; }
}
# file $1's sha256: sha256sum, else openssl dgst; nothing (and false) when the TV has neither. Never sha256sum -c, which a busybox build
# may leave out. The same rule as Lumen's Settings install (app/src/lib/checks.ts shaCheck).
su_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then ssh_h=$(sha256sum "$1" 2>/dev/null) || return 1; echo "${ssh_h%% *}"
  elif command -v openssl >/dev/null 2>&1; then ssh_h=$(openssl dgst -sha256 "$1" 2>/dev/null) || return 1; echo "${ssh_h##*= }"
  else return 1; fi
}
# true when file $1's sha256 is the one SHA256SUMS ($3) gives for name $2. With neither tool on the TV: false, so there is no unattended
# refresh from here. Opening Lumen still installs the watcher (lib/root.ts setHomeTakeover goes ahead there, since that install is
# started from the same folder it would check).
su_sha_ok() {
  ssh_want=$(sed -n "s/^\([0-9a-f]\{64\}\)  $2\$/\1/p" "$3" 2>/dev/null | head -n 1)
  [ "${#ssh_want}" -eq 64 ] || return 1
  ssh_have=$(su_sha256 "$1") || return 1
  [ "$ssh_have" = "$ssh_want" ]
}
# $1: now (digits; busybox ash exits the whole watcher on arithmetic with anything else)
self_update() {
  [ "$sugaveup" -eq 1 ] && return 0
  case "$1" in ''|*[!0-9]*) return 0 ;; esac
  ih_own "$SELF" || return 0
  sud=$(su_src) || return 0
  su_plain "$sud/watch.sh" && su_plain "$sud/60-homehook" && su_plain "$sud/SHA256SUMS" || return 0
  # root's own copies, read once; everything from here on looks only at them
  nw=$(mktemp "$SELF.new.XXXXXX" 2>/dev/null) || return 0
  nh=$(mktemp "$SELF.hook.XXXXXX" 2>/dev/null) || { rm -f "$nw"; return 0; }
  ns=$(mktemp "$SELF.sums.XXXXXX" 2>/dev/null) || { rm -f "$nw" "$nh"; return 0; }
  if ! su_snap "$sud/watch.sh" "$nw" || ! su_snap "$sud/60-homehook" "$nh" || ! su_snap "$sud/SHA256SUMS" "$ns"; then
    rm -f "$nw" "$nh" "$ns"; return 0
  fi
  # the pair must match the SHA256SUMS the build put next to it (app/vite.config.ts), read the same way: a half-written install, or one file
  # changed on its own, is never installed as root. This proves the pair is the one the build made, not who made the build: the app folder is
  # writable by the developer user, and anything that can write it can also run root commands through the Homebrew Channel (docs/webos4.md).
  su_sha_ok "$nw" watch.sh "$ns" && su_sha_ok "$nh" 60-homehook "$ns"; sushaok=$?
  rm -f "$ns"
  # the boot hook is replaced only where it is installed as root's own plain file (removed by hand: left removed)
  suhook=0
  ih_own "$INIT_HOOK" && suhook=1
  if cmp -s "$nw" "$SELF" && { [ "$suhook" -eq 0 ] || cmp -s "$nh" "$INIT_HOOK"; }; then
    rm -f "$nw" "$nh"; supend=""; return 0
  fi
  susum=$(su_sum "$nw" "$nh") || { rm -f "$nw" "$nh"; return 0; }
  if [ "$susum" = "$sufail" ]; then rm -f "$nw" "$nh"; return 0; fi
  # an install may still be writing the files: only a pair read the same twice in a row is taken
  if [ "$susum" != "$supend" ]; then supend=$susum; rm -f "$nw" "$nh"; return 0; fi
  if [ "$sushaok" -ne 0 ]; then
    sufail=$susum; supend=""; rm -f "$nw" "$nh"
    su_log "the watcher packaged in $sud does not match its SHA256SUMS (or this TV has no sha256sum), not installed; opening Lumen installs it"
    return 0
  fi
  if ! sh -n "$nw" 2>/dev/null || ! sh -n "$nh" 2>/dev/null || [ "$(head -n 1 "$nw")" != '#!/bin/sh' ] || [ "$(head -n 1 "$nh")" != '#!/bin/sh' ] \
    || ! grep -q '^single_instance()' "$nw" || ! grep -q '^home_key()' "$nw" || ! grep -qF '/var/lib/homehook/watch.sh' "$nh"; then
    sufail=$susum; supend=""; rm -f "$nw" "$nh"
    su_log "the watcher packaged in $sud does not look right (does not parse, or is not watch.sh and 60-homehook), not installed"
    return 0
  fi
  sun=0; lastsu=0
  if [ ! -h "$SU_STATE" ] && [ -f "$SU_STATE" ] && [ "$(stat -c %u "$SU_STATE" 2>/dev/null)" = "$MYUID" ]; then
    sun=$(grep -c . "$SU_STATE")
    lastsu=$(tail -n 1 "$SU_STATE")
  fi
  case "$sun" in ''|*[!0-9]*) sun=0 ;; esac
  case "$lastsu" in ''|*[!0-9]*) lastsu=0 ;; esac
  if [ "$sun" -ge "$SU_MAX" ]; then
    sugaveup=1; rm -f "$nw" "$nh"
    su_log "not refreshed from $sud ($sun refreshes this boot already)"
    return 0
  fi
  if ! { [ $(($1 - lastsu)) -ge "$SU_GAP" ] || [ $(($1 - lastsu)) -lt 0 ]; }; then rm -f "$nw" "$nh"; return 0; fi
  # again, immediately before the files change: a swap of the installed path must not be written through
  ih_own "$SELF" || { rm -f "$nw" "$nh"; return 0; }
  if [ "$suhook" -eq 1 ] && ! ih_own "$INIT_HOOK"; then suhook=0; fi
  chmod 755 "$nw" "$nh" || { rm -f "$nw" "$nh"; return 0; }
  su_note "$1" || { rm -f "$nw" "$nh"; su_log "could not record the refresh, not installed"; return 0; }
  if [ "$suhook" -eq 1 ] && ! cmp -s "$nh" "$INIT_HOOK"; then
    mv -f "$nh" "$INIT_HOOK" || { rm -f "$nw" "$nh"; su_log "could not replace $INIT_HOOK"; return 0; }
  else
    rm -f "$nh"
  fi
  [ "$suhook" -eq 0 ] && { [ -e "$INIT_HOOK" ] || [ -h "$INIT_HOOK" ]; } && su_log "$INIT_HOOK is not root's own plain file, left as it is"
  if cmp -s "$nw" "$SELF"; then rm -f "$nw"; supend=""; su_log "boot hook updated from $sud"; return 0; fi
  mv -f "$nw" "$SELF" || { rm -f "$nw"; su_log "could not replace $SELF"; return 0; }
  su_log "updated from $sud (Lumen was updated), restarting"
  su_reexec
}

# One watcher at a time. Two Lumen starts close together can each refresh the watcher; each kills the running copy, then starts one through
# 60-homehook, whose "already running?" check can miss a copy that is still starting (seen on the C8 on 24 Oct: two watcher trees, so every
# action could happen twice). The lock is a directory (mkdir is atomic) holding the owner's pid; a lock whose owner is gone is taken over.
# A self-refresh re-exec keeps this pid, so a lock that already names us is kept: deleting it would let another start take it and this copy
# would exit, and nothing would be left to answer Home.
single_instance() {
  for try in 1 2 3; do
    # mode 700 from the start: a 755 lock in sticky /tmp can have a link put inside it, and the takeover below would then
    # walk that link if it removed the folder with rm -r
    if mkdir -m 700 "$WATCH_LOCK" 2>/dev/null; then echo $$ > "$WATCH_LOCK/pid"; return 0; fi
    # the lock is a name in /tmp: one that is not this user's own folder was not made by a watcher. It is never read (its pid could name any
    # process called watch.sh, and keep every watcher out) nor removed with rm -r (run_aside), only taken away.
    if [ -h "$WATCH_LOCK" ] || [ ! -d "$WATCH_LOCK" ]; then rm -f "$WATCH_LOCK" 2>/dev/null; continue; fi
    if [ "$(stat -c %u "$WATCH_LOCK" 2>/dev/null)" != "$MYUID" ]; then run_aside "$WATCH_LOCK"; continue; fi
    old=$(cat "$WATCH_LOCK/pid" 2>/dev/null)
    # the other copy may not have written its pid yet
    [ -z "$old" ] && { sleep 1; old=$(cat "$WATCH_LOCK/pid" 2>/dev/null); }
    if [ -n "$old" ] && [ "$old" = "$$" ]; then return 0; fi
    if [ -n "$old" ] && kill -0 "$old" 2>/dev/null \
      && tr '\0' ' ' < "/proc/$old/cmdline" 2>/dev/null | grep -q 'watch\.sh'; then return 1; fi
    # our own lock, but its owner is gone. Moved aside whole, not rm -r: busybox rm -r walks by name, so a link already inside
    # (a lock made mode 755 by an older build) would have root delete files elsewhere
    run_aside "$WATCH_LOCK"
  done
  return 1
}

# ---- LG ad and telemetry hosts (hosts_sync) -------------------------------------------------------------------------------------------
# Ported from Glasshouse's ads tier (server/lib/privacy.js ADBLOCK_ADS and ADBLOCK_REGIONAL, https://github.com/rorygallagher2024/glasshouse,
# MIT licence, Copyright (c) 2026 Rory Gallagher: see THIRD_PARTY_NOTICES.md). That tier is the one Glasshouse documents as leaving LG's
# service platform reachable, so the Content Store, app installs and updates, app launching and the streaming apps keep working.
# Left out on purpose, with Glasshouse's reasons (docs/dashboard/privacy.md "Everything tier", docs/IMPLEMENTATION.md):
#  - its Everything tier (ADBLOCK_PLATFORM: lgtvsdp.com and its country hosts, ngfts.lge.com, cdplauncher/lgchhomeapp.lgtvcommon.com,
#    lgtviot.com, ueiwsp.com, avsxappcaptiveportal.com): the Content Store, app updates, LG Channels, LG search, ThinQ and Alexa stop, and
#    Netflix was reported interrupted after a cold boot with ngfts blocked;
#  - nextlgsdp.com and tv.wiselg.com (ADBLOCK_SDP), and rdx2.nextlgsdp.com: the TV sets its clock from those servers, and blocked before the
#    clock is valid every TLS connection fails. Glasshouse only blocks them after the clock has synced; a static list cannot wait, so not here.
# LG's firmware update servers (the four names the Homebrew Channel's "Block system updates" sends to 127.0.0.1; a firmware update can take
# root away) are blocked only while that checkbox is on (its flag file, as Glasshouse checks it), so unticking it lets updates through again.
# Country-prefixed names: LG's regional prefixes, the countries LG is seen using, and the TV's own country, read once from the settings
# service as Glasshouse does (smartServiceCountryCode2).
LG_BLOCK_ADS="ad.lgsmartad.com ibis.lgappstv.com ibs.lgappstv.com lgsmartad.com rdx.lgtvcommon.com aic.lgtvcommon.com smartad.lge.com
 smartclip.com smartclip-services.com yumenetworks.com
 alphonso.tv prov-lg.alphonso.tv prov.alphonso.tv eulacheck.alphonso.tv bl-server.alphonso.tv clockskew.alphonso.tv acrdb.alphonso.tv
 ads.alphonso.tv api.alphonso.tv tvads.alphonso.tv sync.alphonso.tv tr.alphonso.tv tn.alphonso.tv insights.alphonso.tv bwlkup.alphonso.tv
 eu-acr86.alphonso.tv
 rone-aic.lge.com rone-eic.lge.com rone-kic.lge.com rone-saic.lge.com rone-tv-aic.lge.com rone-tv-cic.lge.com rone-tv-eic.lge.com
 rone-tv-kic.lge.com rone-tv-saic.lge.com"
# blocked bare and with each prefix in front (the firmware builds gb.info.lgsmartad.com, aic.cdpbeacon.lgtvcommon.com ...)
LG_BLOCK_REGIONAL="info.lgsmartad.com rdx2.lgtvsdp.com elastic.lgwebostv.com ibs.lgappstv.com ibsstat.lgappstv.com cdpbeacon.lgtvcommon.com
 cdpsvc.lgtvcommon.com wau.lgtvcommon.com api.adts.lgtvcommon.com"
LG_BLOCK_PREFIXES="aic eic kic eu"           # Glasshouse's ADBLOCK_REGION_PREFIXES
LG_BLOCK_COUNTRIES="us gb au br ca de fr"    # its ADBLOCK_FALLBACK_COUNTRIES, always kept; the TV's own country is added to them
LG_BLOCK_FIRMWARE="snu.lge.com su-dev.lge.com su.lge.com su-ssl.lge.com"
HBC_BLOCK_FLAG=${HOMEHOOK_HBC_BLOCK_FLAG:-/var/luna/preferences/webosbrew_block_updates}
HOSTS_BOUND_MARK=${HOMEHOOK_HOSTS_BOUND_MARK:-$RUN/hosts-bound}   # in memory, like the bind: this watcher made the bind over $HOSTS
HOSTS_BEGIN="# >>> Lumen watcher (watch.sh hosts_sync): rebuilt about every 30 s, edits between these lines are lost"
HOSTS_END="# <<< Lumen watcher"
HOSTS_RETRY=1800  # seconds before a bind that failed is tried again (each try would write the table on flash)
HOSTS_OURS=${HOMEHOOK_HOSTS_OURS:-$RUN/hosts.ours}   # the block's lines as this watcher last wrote them (hosts_build)
HOSTS_BAK=$RUN/hosts.bak      # /etc/hosts as it was before this watcher's last rewrite of it (hosts_write)
HOSTS_LOCK=$RUN/hosts.lock    # one writer of /etc/hosts at a time (hosts_lock)
HOSTS_LOCK_SECS=${HOMEHOOK_HOSTS_LOCK_SECS:-10}   # how long a pass waits for that lock before it skips
HOSTS_LOCK_STALE=60           # a mkdir lock older than this is left over (a pass holds it for a second or two)
HOSTS_FLOCK=${HOMEHOOK_FLOCK-$(command -v flock 2>/dev/null)}   # flock where busybox has it, else the mkdir lock
lgcountry=""; lgcountrytries=0; hostsfailat=0

# a command with a 5 s limit (the same busybox "timeout N" or "timeout -t N" test as LS_TO above): a wedged iptables or settings service
# must not stop the loop; without timeout it runs as is
IPT_SECS=${HOMEHOOK_IPT_SECS:-5}
if timeout 1 true 2>/dev/null; then T5="timeout $IPT_SECS"; elif timeout -t 1 true 2>/dev/null; then T5="timeout -t $IPT_SECS"; else T5=""; fi
to5() { $T5 "$@"; }

# the TV's country (two letters, lower case) from the settings service, once per watcher run: at most 3 tries, one a pass, then the fallback
# countries alone
lg_country() {
  [ -n "$lgcountry" ] && return 0
  [ "$lgcountrytries" -ge 3 ] && return 0
  lgcountrytries=$((lgcountrytries + 1))
  c=$(to5 luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings '{"category":"option","keys":["smartServiceCountryCode2"]}' \
    </dev/null 2>/dev/null | sed -n 's/.*"smartServiceCountryCode2"[[:space:]]*:[[:space:]]*"\([A-Za-z][A-Za-z]\)".*/\1/p' | tr 'A-Z' 'a-z')
  case "$c" in [a-z][a-z]) lgcountry=$c; echo "$(date +%T) hosts: TV country $c" >> "$LOG" ;; esac
  return 0
}

# the LG names this list blocks now, one per line, no duplicates: the firmware servers only while the Homebrew Channel blocks updates.
# With "all", every name it may ever write (the firmware servers too), which is what it owns and takes out again.
lg_block_names() {
  { for n in $LG_BLOCK_ADS; do echo "$n"; done
    if [ "$1" = all ] || [ -e "$HBC_BLOCK_FLAG" ]; then for n in $LG_BLOCK_FIRMWARE; do echo "$n"; done; fi
    for n in $LG_BLOCK_REGIONAL; do echo "$n"; for p in $LG_BLOCK_PREFIXES $LG_BLOCK_COUNTRIES $lgcountry; do echo "$p.$n"; done; done
  } | awk '!s[$0]++'
}

# the owner's hosts-extra lines: only "0.0.0.0 <name>" or ":: <name>" are ever taken, so a stray line cannot point a name somewhere real
hosts_extra() {
  [ -f "$EXTRA" ] && grep -E '^(0\.0\.0\.0|::)[[:space:]]+[A-Za-z0-9.-]+[[:space:]]*$' "$EXTRA" | awk '{print $1" "$2}'
  return 0
}

# every line the block should hold: "0.0.0.0 <name>" and ":: <name>" for each LG name (none with no-lg-block), then hosts-extra.
# HOSTS_ALL_OFF (stop_watch.sh) wants nothing at all.
hosts_want() {
  [ -n "$HOSTS_ALL_OFF" ] && return 0
  { if [ ! -e "$NOLGBLOCK_FLAG" ]; then lg_block_names | while IFS= read -r n; do echo "0.0.0.0 $n"; echo ":: $n"; done; fi
    hosts_extra; } | awk '!s[$0]++'
}

# writes to $1 what $HOSTS should hold: every line of it that is not this watcher's, as it is (localhost, the Homebrew Channel's 127.0.0.1
# update lines, another tool's or hook's lines, a 0.0.0.0 line added by hand), each ended with a newline (a file whose last line has none is
# not glued to the next), then the block of wanted lines between HOSTS_BEGIN and HOSTS_END. This watcher's lines are the block, and nothing
# outside it, whatever name it holds: only when the file has no whole block left (its markers were edited away) does a line outside it that
# is exactly one this watcher last wrote ($HOSTS_OURS) count as ours. A wanted name that a line of another family-mate already answers
# (127.0.0.1 for a v4 name) is left out: the first line wins in a hosts file, so ours would do nothing.
# Returns 3 when the file holds nothing of this watcher's and nothing is wanted: then it is not touched.
hosts_build() {
  HH_WANT=$(hosts_want) HH_OURS=$(cat "$HOSTS_OURS" 2>/dev/null) HH_B=$HOSTS_BEGIN HH_E=$HOSTS_END \
  awk 'BEGIN { B = ENVIRON["HH_B"]; E = ENVIRON["HH_E"]; n = split(ENVIRON["HH_OURS"], o, "\n"); for (i = 1; i <= n; i++) if (o[i] != "") ours[o[i]] = 1 }
    FNR == NR { if ($0 == B) b = 1; else if (b && $0 == E) closed = 1; next }
    $0 == B && closed { inb = 1; drop++; next }
    inb { if ($0 == E) inb = 0; drop++; next }
    !closed && ($0 in ours) { drop++; next }
    { l = $0; sub(/#.*/, "", l); k = split(l, f, /[ \t]+/); m = 0
      for (i = 1; i <= k; i++) if (f[i] != "") g[++m] = f[i]
      for (i = 2; i <= m; i++) seen[((g[1] ~ /:/) ? 6 : 4) " " g[i]] = 1
      keep[++nk] = $0 }
    END { n = split(ENVIRON["HH_WANT"], w, "\n"); nw = 0
      for (i = 1; i <= n; i++) { if (w[i] == "") continue; split(w[i], x, " "); if (!((((x[1] ~ /:/) ? 6 : 4) " " x[2]) in seen)) out[++nw] = w[i] }
      if (!drop && !nw) exit 3
      printf "" > OUT
      for (i = 1; i <= nk; i++) print keep[i] > OUT
      if (nw) { print B > OUT; for (i = 1; i <= nw; i++) print out[i] > OUT; print E > OUT } }' OUT="$1" "$HOSTS" "$HOSTS"
}

# the lines of the block in $1 (what hosts_build wrote), for $HOSTS_OURS
hosts_block_of() {
  HH_B=$HOSTS_BEGIN HH_E=$HOSTS_END awk 'inb && $0 == ENVIRON["HH_E"] { exit } inb { print } $0 == ENVIRON["HH_B"] { inb = 1 }' "$1" 2>/dev/null
}

# exact match on the mount point (field 2), not a pattern, so a bind is never taken for another and never stacked
hosts_bound() { awk -v p="$HOSTS" '$2 == p { f = 1 } END { exit !f }' "${HOMEHOOK_MOUNTS:-/proc/mounts}" 2>/dev/null; }

# the file on $HOSTS is $HOSTS_TABLE itself (the same device and inode), which is what this watcher's bind gives. /proc/mounts cannot say
# whose a bind is: for a bind its first field is the device the table lives on (/dev/mmcblk0p.. for /var), never the table's path.
hosts_is_table() {
  hit_a=$(stat -L -c '%d:%i' "$HOSTS" 2>/dev/null) && hit_b=$(stat -L -c '%d:%i' "$HOSTS_TABLE" 2>/dev/null) && [ "$hit_a" = "$hit_b" ]
}

hosts_log() { [ "$hostslast" = "$1" ] || echo "$(date +%T) hosts: $2" >> "$LOG"; hostslast=$1; }

# one writer of $HOSTS at a time: a watcher's pass, and stop_watch.sh (which waits for the watcher to be gone, then takes this lock too).
# With flock, a lock on $HOSTS_LOCK.f held on fd 9, let go when it is closed or its holder dies. Without it, a folder (mkdir is atomic)
# holding the holder's pid, taken over when that pid is gone or the folder is older than HOSTS_LOCK_STALE. Waits at most HOSTS_LOCK_SECS.
hosts_lock() {
  hl_end=$(( $(date +%s) + HOSTS_LOCK_SECS ))
  while :; do
    if [ -n "$HOSTS_FLOCK" ]; then
      # a failed redirection on exec would end the shell: the file is made first, and a folder that cannot hold it gives up here
      { : >> "$HOSTS_LOCK.f"; } 2>/dev/null || return 1
      exec 9>> "$HOSTS_LOCK.f"
      "$HOSTS_FLOCK" -n 9 2>/dev/null && return 0
      exec 9>&-
    elif mkdir "$HOSTS_LOCK" 2>/dev/null; then
      echo $$ > "$HOSTS_LOCK/pid"; return 0
    else
      hl_pid=$(cat "$HOSTS_LOCK/pid" 2>/dev/null)
      hl_at=$(stat -c %Y "$HOSTS_LOCK" 2>/dev/null) || hl_at=0
      if { [ -n "$hl_pid" ] && ! kill -0 "$hl_pid" 2>/dev/null; } || [ $(( $(date +%s) - hl_at )) -gt "$HOSTS_LOCK_STALE" ]; then
        rm -rf "$HOSTS_LOCK"; continue
      fi
    fi
    [ "$(date +%s)" -lt "$hl_end" ] || return 1
    sleep 1
  done
}
hosts_unlock() { if [ -n "$HOSTS_FLOCK" ]; then exec 9>&-; else rm -rf "$HOSTS_LOCK"; fi; }

# every line of $HOSTS_BAK that names localhost is still a line of $HOSTS
hosts_localhost_kept() {
  awk 'FILENAME == ARGV[1] { l = $0; sub(/#.*/, "", l); if (l ~ /[ \t]localhost([ \t]|$)/) want[$0] = 1; next }
    { delete want[$0] } END { for (k in want) exit 1; exit 0 }' "$HOSTS_BAK" "$HOSTS" 2>/dev/null
}

# $1 into $HOSTS in place (cat >: the same inode, never mv, as app jails bind /etc/hosts into themselves), after a copy of it in $HOSTS_BAK.
# The result must be $1 byte for byte and keep every localhost line the copy had; if not (a short write, a full disk), the copy is written
# back. Then sync, so a power cut does not leave it half written. 0 written; 1 it cannot be written (not opened: nothing changed);
# 2 written wrong and put back; 3 written wrong and not even put back ($HOSTS_BAK holds it); 4 no copy could be made, nothing written.
hosts_write() {
  { cat "$HOSTS" > "$HOSTS_BAK"; } 2>/dev/null || return 4
  { cat "$1" > "$HOSTS"; } 2>/dev/null; hw_r=$?
  [ "$hw_r" -ne 0 ] && cmp -s "$HOSTS_BAK" "$HOSTS" && return 1
  if [ "$hw_r" -eq 0 ] && cmp -s "$1" "$HOSTS" && hosts_localhost_kept; then sync; return 0; fi
  if { cat "$HOSTS_BAK" > "$HOSTS"; } 2>/dev/null && cmp -s "$HOSTS_BAK" "$HOSTS"; then sync; return 2; fi
  sync; return 3
}

# keeps /etc/hosts as hosts_build says (from the main loop, about every 30 s, and so again after every boot), under hosts_lock. Written in
# place (hosts_write) and only when its bytes would change, so a table on flash is not written every pass. Where /etc/hosts can be written
# (the Homebrew Channel's table on /var bound over it, a tmpfs bind, a writable rootfs), that is all: lines this list no longer wants
# (no-lg-block, a name gone from hosts-extra) go on the next pass. Where it cannot (the read-only rootfs, nothing bound), the new content
# goes into $HOSTS_TABLE, bound over it, as Glasshouse and the Homebrew Channel do; the bind lives in memory, so a reboot gives the stock
# file back. A failed bind is tried again only after HOSTS_RETRY. When nothing is wanted any more and the mount on /etc/hosts is still this
# watcher's own bind (hosts_is_table), it is taken off (umount), which gives back what was under it; a mount there that is not (someone
# else's, over or instead of ours) is never taken off: the mark is dropped and that file is rebuilt in place like any other.
hosts_sync() {
  lg_country
  hosts_lock || { hosts_log locked "$HOSTS is being written by another (lock $HOSTS_LOCK), this pass skipped"; return 1; }
  hosts_sync_locked; hs_r=$?
  hosts_unlock
  return $hs_r
}
hosts_sync_locked() {
  unbind=""
  if [ -f "$HOSTS_BOUND_MARK" ]; then
    if ! hosts_bound || ! hosts_is_table; then
      rm -f "$HOSTS_BOUND_MARK"
      hosts_bound && hosts_log foreign "the mount on $HOSTS is not this watcher's bind of $HOSTS_TABLE: left as it is"
    elif [ -z "$(hosts_want)" ]; then
      if umount "$HOSTS" 2>/dev/null; then rm -f "$HOSTS_BOUND_MARK" "$HOSTS_OURS"; hosts_log unbound "nothing to block, $HOSTS_TABLE taken off $HOSTS"; return 0; fi
      unbind=failed   # the mark stays, so the next pass tries the umount again
    fi
  fi
  tmp=$RUN/hosts.new
  hosts_build "$tmp" 2>/dev/null; r=$?
  if [ "$r" -eq 3 ] || { [ "$r" -eq 0 ] && cmp -s "$tmp" "$HOSTS"; }; then
    rm -f "$tmp"
    if [ "$r" -eq 3 ]; then rm -f "$HOSTS_OURS"; elif [ ! -f "$HOSTS_OURS" ]; then hosts_block_of "$HOSTS" > "$HOSTS_OURS"; fi
    if [ -n "$unbind" ]; then hosts_log unbindfail "could not take $HOSTS_TABLE off $HOSTS; nothing of this watcher's is left in it"
    elif [ "$r" -eq 0 ]; then hostslast=ok; fi
    return 0
  fi
  if [ "$r" -ne 0 ]; then rm -f "$tmp"; hosts_log buildfail "could not read $HOSTS or write $tmp"; return 1; fi
  hosts_write "$tmp"; w=$?
  case "$w" in
    0) hosts_block_of "$tmp" > "$HOSTS_OURS"; rm -f "$tmp"
       if [ -n "$unbind" ]; then hosts_log unbindfail "could not take $HOSTS_TABLE off $HOSTS, emptied it in place instead"
       else hosts_log written "$HOSTS rebuilt in place"; fi
       return 0 ;;
    2) rm -f "$tmp"; hosts_log restored "$HOSTS came out wrong (short, or a localhost line gone): put back as it was"; return 1 ;;
    3) rm -f "$tmp"; hosts_log broken "$HOSTS came out wrong and could not be put back: the old file is in $HOSTS_BAK"; return 1 ;;
    4) rm -f "$tmp"; hosts_log nobackup "could not copy $HOSTS to $HOSTS_BAK, so it is not rewritten"; return 1 ;;
  esac
  if [ -n "$unbind" ]; then
    rm -f "$tmp"; hosts_log unbindstuck "could not take $HOSTS_TABLE off $HOSTS, nor rewrite it (read-only): its lines stay, tried again in 30 s"
    return 1
  fi
  if hosts_bound; then rm -f "$tmp"; hosts_log stuck "$HOSTS is bound and cannot be written, left as it is"; return 1; fi
  now5=$(date +%s)
  if [ "$hostsfailat" -gt 0 ] && [ $((now5 - hostsfailat)) -lt "$HOSTS_RETRY" ]; then rm -f "$tmp"; return 1; fi
  { cmp -s "$tmp" "$HOSTS_TABLE" || { cat "$tmp" > "$HOSTS_TABLE" && sync; }; } 2>/dev/null && chmod 644 "$HOSTS_TABLE" 2>/dev/null \
    && mount --bind "$HOSTS_TABLE" "$HOSTS" 2>/dev/null
  r=$?
  if [ "$r" -eq 0 ]; then
    hosts_block_of "$tmp" > "$HOSTS_OURS"; : > "$HOSTS_BOUND_MARK"; hostsfailat=0; hosts_log bound "$HOSTS read-only, $HOSTS_TABLE bound over it"
  else hostsfailat=$now5; hosts_log failed "could not bind $HOSTS_TABLE over $HOSTS, next try in $HOSTS_RETRY s"; fi
  rm -f "$tmp"
  return $r
}

# ---- the web app debugger (debugger_guard) ----------------------------------------------------------------------------------------------
# Developer Mode, which the root keeps on (its boot script starts the Homebrew Channel), opens WebAppMgr's DevTools on port 9998 to the whole
# network with no login, and through it anyone on the network can run code in an app on screen, the Homebrew Channel's included, whose
# service runs as root. Copied from Glasshouse (server/lib/devtools.js, MIT): one rule drops the port on every interface but loopback, so
# ssh -L 19998:127.0.0.1:9998 (tools/tv/cdp.mjs, ares-inspect through a tunnel) still reaches it, and nothing else (ssh on 22, Luna, the
# Homebrew Channel) is touched. The rule lives in memory: checked with -C, and added (-I) only when -C says it is not there (exit 1), so a
# pass never stacks a second copy, and added again after a boot by the first pass. Any other answer from -C (a timeout, the xtables lock,
# no table) says nothing: nothing is added, and the family is logged as not known, never as closed. With /var/lib/homehook/debugger-open
# every copy of the rule is taken out instead (ares-inspect straight from a computer).
# Each call has the 5 s limit. A family whose call fails while the kernel has no filter table for it (/proc/net/ip_tables_names,
# ip6_tables_names, as Glasshouse checks) has no firewall: it is not tried again until the watcher restarts. IPv4 closed with IPv6 open is
# "partial" in the log, never "closed".
DEBUGGER_RULE="INPUT -p tcp --dport 9998 ! -i lo -j DROP"
PROC_NET=${HOMEHOOK_PROC_NET:-/proc/net}
dbgnofw=""        # families found with no firewall in this kernel
ipt_tools() {
  for n in iptables ip6tables; do for d in $IPT_DIRS; do [ -x "$d/$n" ] && { echo "$d/$n"; break; }; done; done
}
ipt_fam() { case "${1##*/}" in ip6tables) echo IPv6 ;; *) echo IPv4 ;; esac; }
ipt_table() { if [ "$(ipt_fam "$1")" = IPv6 ]; then echo "$PROC_NET/ip6_tables_names"; else echo "$PROC_NET/ip_tables_names"; fi; }
# -C as xtables answers it: 0 the rule is in $1, 1 it is not. Anything else (124 or 143 a timeout, 4 the lock, 3 no table) is neither.
ipt_check() { to5 $1 -C $DEBUGGER_RULE 2>/dev/null; }
# every copy of the rule out of $1 (one stacked by an older build is taken too): -D until -C says 1. 0 none left (iro_gone: how many
# were taken out), 2 a -D failed, 3 -C gave no answer (a copy may still be there)
ipt_rule_out() {
  iro_gone=0
  while [ "$iro_gone" -lt 32 ]; do
    ipt_check $1; iro_c=$?
    [ "$iro_c" -eq 1 ] && return 0
    [ "$iro_c" -eq 0 ] || return 3
    to5 $1 -D $DEBUGGER_RULE 2>/dev/null || return 2
    iro_gone=$((iro_gone + 1))
  done
  return 2
}
debugger_guard() {
  tools=$(ipt_tools)
  if [ -e "$DEBUGGER_FLAG" ]; then
    st=open
    for t in $tools; do
      ipt_rule_out $t
      case $? in
        0) ;;
        2) st="open, but the rule is still in $t" ;;
        *) [ -e "$(ipt_table $t)" ] && st="open, but $t did not answer: the rule may still be in it" ;;
      esac
    done
  elif [ ! -e "$DEVMODE_FLAG" ]; then
    st=off   # without Developer Mode webOS does not open the port (a file or, on some TVs, a folder)
  else
    held=""; failed=""; nofw=""; unk=""
    for f in IPv4 IPv6; do
      t=""; for x in $tools; do [ "$(ipt_fam "$x")" = "$f" ] && t=$x; done
      case " $dbgnofw " in *" $f "*) nofw="$nofw $f"; continue ;; esac
      [ "$f" = IPv6 ] && tbl=$PROC_NET/ip6_tables_names || tbl=$PROC_NET/ip_tables_names
      if [ -z "$t" ]; then dbgnofw="$dbgnofw $f"; nofw="$nofw $f"; continue; fi
      ipt_check $t; dg_c=$?
      if [ "$dg_c" -eq 0 ] || { [ "$dg_c" -eq 1 ] && to5 $t -I $DEBUGGER_RULE 2>/dev/null; }; then held="$held $f"
      elif [ ! -e "$tbl" ]; then dbgnofw="$dbgnofw $f"; nofw="$nofw $f"
      elif [ "$dg_c" -eq 1 ]; then failed="$failed $f"
      else unk="$unk $f"; fi
    done
    open="$failed$nofw"
    if [ -z "$open$unk" ]; then st=closed
    elif [ -z "$held$failed$unk" ]; then st="nofirewall (no iptables, or no ip_tables in this kernel: port 9998 stays OPEN to the network)"
    elif [ -z "$held$open" ]; then st="unknown (iptables did not answer on$unk; tried again in 30 s)"
    elif [ -z "$held" ]; then st="failed (still OPEN on$open${unk:+, not known on$unk}; tried again in 30 s)"
    else st="partial (closed on$held${open:+, still OPEN on$open}${nofw:+, no firewall for$nofw}${unk:+, not known on$unk: iptables did not answer})"; fi
  fi
  [ "$st" = "$dbglast" ] || echo "$(date +%T) debugger: port 9998 $st" >> "$LOG"
  dbglast=$st
}

case "$0" in */watch-key) home_key; exit 0 ;; esac
# tools/test/watch.test.mjs sources this file for its functions only
[ -n "$WATCH_SH_LIB" ] && return 0
run_dir || exit 0
single_instance || { echo "$(date +%T) watcher: another copy is running, this one exits" >> "$LOG"; exit 0; }
bar_pictures "$(cat "$LASTME" 2>/dev/null)"   # a bar installed before this watcher started has its pictures before its first screensaver

echo "$wakeuntil" > "$WAKEFILE"
home_reader &
hrpid=$!
# startup (the picture copy, the lock) is this process's own work, not a sleep. Measured from here, a slow start is not a wake that
# opens Lumen over the app in front when the watcher was only restarted.
tick=$(date +%s)
slept=$tick
mtick=$(mono_s 2>/dev/null)
mono_ok=0

while true; do
  # wake: the power state was seen leaving Active for standby or off (not the screensaver) and is Active again, or the CPU's ticks
  # stopped while the wall clock moved (suspended), including inside a Luna call. The sleep alone missing its second counts too, and
  # so does a pass's own work past what an awake pass can take (wake_gap).
  now=$(date +%s)
  mono=$(mono_s 2>/dev/null)
  wake_use_mono "$tick" "$now" "$mtick" "$mono"
  if [ "$use" = 1 ]; then gap=$(wake_gap "$tick" "$slept" "$now" "$own" "$mtick" "$mono"); else gap=$(wake_gap "$tick" "$slept" "$now" "$own"); fi
  tick=$now; own=0; mtick=$mono
  pw=$(lsend luna://com.webos.service.tvpower/power/getPowerState '{}' </dev/null 2>/dev/null)
  # webOS 25 answers "state": "Active", with a space
  pwstate=$(printf '%s' "$pw" | sed -n 's/.*"state": *"\([^"]*\)".*/\1/p')
  woke=0
  [ "$gap" -gt 5 ] && woke=1
  [ "$(wake_edge "$pwlast" "$pwstate")" = 1 ] && woke=1
  pwfrom=$pwlast
  [ -n "$pwstate" ] && pwlast=$pwstate
  if [ "$woke" -eq 1 ]; then
    wakeuntil=$((now + WAKE_SECS)); last=0
    echo "$wakeuntil" > "$WAKEFILE"
    # power: the sample before this one, then this one (an off state seen there means this process ran while the TV was off). wall and
    # ticks: the pass's wall seconds and the CPU's own. Ticks far behind the wall means they paused while the TV was off (the tick clock
    # saw the suspend); ticks keeping up with a long wall means only the sleep or the work length saw it
    echo "$(date +%T) wake (gap ${gap}s, power ${pwfrom:-none} > ${pwstate:-none}, wall ${wd}s, ticks ${md:-none})" >> "$LOG"
    # before the foreground query: right after a wake each query can take seconds
    [ ! -f "$NOWAKE_FLAG" ] && [ "$pwstate" = Active ] && wake_open ""
  fi
  # the foreground app ("appId"), and with extraInfo every foreground window (webOS 4 lists the launcher bar there while it overlays an app);
  # spaces after the colons dropped, as luna-send prints them on some firmware and not on others
  main=$(lsend luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null | sed 's/": *"/":"/g')
  extra=$(lsend luna://com.webos.applicationManager/getForegroundAppInfo '{"extraInfo":true}' </dev/null 2>/dev/null | sed 's/": *"/":"/g')
  case "$extra" in *'"returnValue":true'*|*'"returnValue": true'*) ;; *) extra="" ;; esac
  out=$main
  front=$(me_in_front "$main") && lastme=$front
  [ -n "$front" ] && [ "$front" != "$(cat "$LASTME" 2>/dev/null)" ] && echo "$front" > "$LASTME"
  app=$(printf '%s' "$main" | sed -n 's/.*"appId":"\([^"]*\)".*/\1/p')
  homeup=0
  lg_home_in "$main" && homeup=1
  # the launcher bar over another app: only when it has just appeared (edge, not level), so a firmware that keeps listing a hidden launcher
  # window can never bounce every app back to Lumen
  xhome=0
  [ -n "$extra" ] && lg_home_in "$extra" && xhome=1
  [ "$homeup" -eq 0 ] && [ "$xhome" -eq 1 ] && [ "$prevxhome" -eq 0 ] && homeup=1
  prevxhome=$xhome
  if [ "$homeup" -eq 0 ] && [ -f "$LIVETV_FLAG" ] && [ "$app" = "$LIVETV" ]; then
    # Live TV straight after another app (not Lumen): what Back out of an app falls back to. Or right after a wake (the TV powers on into it).
    if [ "$prevapp" != "$LIVETV" ] && [ -n "$prevapp" ] && [ -z "$(me_in_front "\"appId\":\"$prevapp\"")" ]; then homeup=1; fi
    if [ ! -f "$NOWAKE_FLAG" ] && [ "$now" -lt "$wakeuntil" ]; then homeup=1; fi
  fi
  if [ -n "$app" ] && [ "$app" != "$prevapp" ]; then prevapp=$app; note_recent "$app"; fi
  wake_tick
  [ "$homeup" -eq 1 ] && out="\"appId\":\"$LGHOME\""
  case "$out" in
    *'"appId":"'$LGHOME'"'*)
      # LG Home is in front. Unless the launcher's own LG Home button just asked for it, send it to the launcher, and keep trying (every 3 s) until it
      # works: right after a cold boot LG Home is the first thing on screen and the launcher may not be ready yet.
      now=$(date +%s)
      if [ "$prev" != "$LGHOME" ]; then
        okhome=0
        if [ -f "$FLAG" ]; then
          age=$((now - $(stat -c %Y "$FLAG")))
          [ "$age" -ge 0 ] && [ "$age" -lt 30 ] && okhome=1
        fi
      fi
      takeover=0
      [ -f "$TAKEOVER_FLAG" ] && takeover=1
      if [ "$takeover" -eq 1 ] && [ "$okhome" -eq 0 ] && target=$(me_target) && { [ $((now - last)) -ge 3 ] || [ $((now - last)) -lt 0 ]; }; then
        last=$now
        r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$target\"}" </dev/null 2>&1 | tr -d '\n')
        echo "$(date +%T) LG Home -> $target: $r" >> "$LOG"
      fi
      prev=$LGHOME
      ;;
    *) prev="other" ;;
  esac
  # video wallpaper on and the launcher in front: no screensaver, LG's is ended as soon as it starts
  vid=0
  if [ -f "$VIDEO_FLAG" ] && [ -n "$front" ]; then vid=1; fi
  if [ "$vid" -eq 1 ]; then
    case "$pw" in
      *'"Screen Saver"'*) lsend luna://com.webos.service.tvpower/power/turnOnScreen '{}' </dev/null >/dev/null 2>&1; echo "$(date +%T) ended screensaver (video wallpaper)" >> "$LOG" ;;
    esac
  elif [ -f "$AMBIENT_FLAG" ] && target=$(me_target); then
    # Lumen's ambient screen (your photos) instead of LG's screensaver. While it is up, LG's screensaver still starts after its timer (nothing
    # is pressed), so it is only ended, not answered by opening Lumen again.
    case "$pw" in
      *'"Screen Saver"'*)
        [ "$pwprev" != "saver" ] && ambient_stale && { rm -f "$AMBIENT_ON"; saver_backlight_restore; }
        if [ -f "$AMBIENT_ON" ] && { [ -n "$front" ] || bar_running; }; then
          lsend luna://com.webos.service.tvpower/power/turnOnScreen '{}' </dev/null >/dev/null 2>&1
        elif [ "$pwprev" != "saver" ] && [ $((now - saverlast)) -ge 5 ]; then
          saverlast=$now
          # the app in front (LG's screensaver is not an app), unless LG's bar is up over it
          over=$app; [ "$homeup" -eq 1 ] && over=""
          sp=$(saver_params "$over")
          if saver_overlay "$sp"; then
            # over another app: Lumen bar's screensaver, an overlay, so the app stays in front with its player as it was (a full-screen
            # Lumen sent it to the background, and the relaunch back made Moonfin drop its player). Shown at once, without the wait below.
            owned bar_pictures "$target"
            r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$BAR\",\"params\":{\"saver\":true,\"lumen\":\"$target\"}}" </dev/null 2>&1)
            echo "$(date +%T) screensaver: Lumen bar over $over: $r" >> "$LOG"
          else
            r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$target\",\"params\":$sp}" </dev/null 2>&1)
            echo "$(date +%T) screensaver: ambient ($target, over ${over:-nothing}): $r" >> "$LOG"
            sleep 1
          fi
          lsend luna://com.webos.service.tvpower/power/turnOnScreen '{}' </dev/null >/dev/null 2>&1
        fi
        pwprev="saver"
        ;;
      *) pwprev="other" ;;
    esac
  elif [ -f "$SAVER_FLAG" ] && [ -d "$APPS/$FRAME" ]; then
    case "$pw" in
      *'"Screen Saver"'*)
        if [ "$pwprev" != "saver" ]; then
          now=$(date +%s)
          if [ $((now - saverlast)) -ge 5 ]; then
            saverlast=$now
            echo "$(date +%T) screensaver seen; foreground: $out" >> "$LOG"
            case "$out" in
              *'"appId":"'$FRAME'"'*) ;;
              *) r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$FRAME\",\"params\":{\"mode\":\"screensaver\"}}" </dev/null 2>&1); echo "$(date +%T) launch Frame: $r" >> "$LOG"; sleep 1 ;;
            esac
            lsend luna://com.webos.service.tvpower/power/turnOnScreen '{}' </dev/null >/dev/null 2>&1
          fi
        fi
        pwprev="saver"
        ;;
      *) pwprev="other" ;;
    esac
  fi
  # boot: start Lumen hidden once, so the first Home press is warm. Tried once only, and only with the screen on.
  if [ "$preloadat" -gt 0 ] && [ "$now" -ge "$preloadat" ] && [ "$pwstate" = Active ]; then
    preloadat=0
    if [ ! -f "$NOPRELOAD_FLAG" ] && target=$(me_target); then
      run=$(lsend luna://com.webos.applicationManager/running '{}' </dev/null 2>/dev/null)
      open=0
      for id in $ME; do case "$run" in *'"id":"'$id'"'*) open=1 ;; esac; done
      if [ "$open" -eq 0 ]; then
        r=$(lsend luna://com.webos.applicationManager/launch "{\"id\":\"$target\",\"preload\":\"full\"}" </dev/null 2>&1)
        echo "$(date +%T) boot preload ($target): $r" >> "$LOG"
      fi
    fi
  fi
  ticks=$((ticks + 1))
  [ $((ticks % 5)) -eq 1 ] && { sync_home_key; owned inputhook_check "$now"; }
  [ $((ticks % 300)) -eq 2 ] && trim_log "$IH_LOG"
  [ $((ticks % 5)) -eq 3 ] && saver_leftover
  [ $((ticks % 30)) -eq 15 ] && owned self_update "$now"
  # LG's ad and telemetry hosts and hosts-extra kept in /etc/hosts, and port 9998 closed to the network: the first pass after a boot, then
  # about every 30 s, so a table or a rule something else took away comes back
  [ $((ticks % 30)) -eq 1 ] && { owned hosts_sync; owned debugger_guard; }
  # faster ticks while a wake is open, so Lumen goes up as soon as the TV lets it (webOS 4's busybox sleep takes whole seconds: usleep)
  slept=$(date +%s)
  if [ "$now" -lt "$wakeuntil" ]; then usleep 500000 2>/dev/null || sleep 1; else sleep 1; fi
done
