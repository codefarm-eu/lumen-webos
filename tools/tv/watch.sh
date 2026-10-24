#!/bin/sh
# Home button -> custom launcher, and screensaver -> Frame (art mode). Once a second, checks which app is in front.
#  - Only with /var/lib/homehook/home-takeover present (off by default: LG Input Hook owns the Home button on this TV): when LG's own Home has just
#    come up, opens the launcher instead (polling, because luna-send buffers a subscription's output when it is piped). The launcher's own
#    "LG Home" button touches /tmp/allow_lg_home first, so LG Home can still be opened on purpose (it then stays until you leave it).
#  - After the TV wakes (power state back to Active, or a gap in this loop's once-a-second ticks, which means it was suspended) and after a boot
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
#    once the packaged pair has read the same on two checks in a row (the install has finished), installs it and re-execs itself.
# Never spins: reacts only when the app changes, and at most once every 3 s. Does nothing if the app is not installed.
# ME lists every Lumen build (stable, dev). Home opens the one that was last in front, or the first installed one in this list. The flag files in
# /var/lib/homehook/ are shared by all of them, which is fine while only one is in front at a time.
ME="com.ovsteenb.lumen com.ovsteenb.lumen.dev com.samrenfrew.lumen com.samrenfrew.lumen.dev com.ammar027.lumen com.ammar027.lumen.dev"
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
APPS=/media/developer/apps/usr/palm/applications
EXTRA=/var/lib/homehook/hosts-extra
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
LASTME=/tmp/lumen-lastme
# LG Input Hook re-injection (inputhook_check): its service injects lginput2 once per boot only (/tmp/inputhook marks it done), so when
# lginput2 restarts (seen on the C8 on 24 Oct 2026, 41 min after a boot) the new process has no hook and Home reaches LG's bar again
IH_DIR=${IH_DIR:-/media/developer/apps/usr/palm/services/org.webosbrew.inputhook.service/inputhook}
IH_MARK=${IH_MARK:-/tmp/inputhook}
IH_STATE=${IH_STATE:-/tmp/homehook-reinject}   # one line per re-injection (epoch seconds), so a restarted watcher keeps the limits
IH_GAP=60          # at most one re-injection a minute
IH_MAX=5           # and at most 5 per boot, so a lginput2 crash loop is not fed
IH_LOG=${IH_LOG:-/tmp/homehook.log}
HOMEKEY_AT=${HOMEKEY_AT:-/tmp/lumen-homekey-at}   # epoch of the last Home key from Input Hook (home_key)
BAR_CLOSED_AT=${BAR_CLOSED_AT:-/tmp/lumen-bar-closed-at}   # uptime (centiseconds) when Home last closed Lumen bar (home_key)
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
saverlast=0
pwprev=""
lastme=""
pwlast=""
mesince=0
launchpid=0
tick=$(date +%s)
wakeuntil=$((tick + 90))   # a boot counts as a wake; LG Home may take a while to come up
# but only a boot: a watcher (re)started later (Lumen refreshing it, stop/start by hand) must not open Lumen over the app in front
booted=$(cut -d. -f1 /proc/uptime 2>/dev/null)
[ -n "$booted" ] && [ "$booted" -gt 300 ] 2>/dev/null && wakeuntil=0
preloadat=$((tick + 60))   # once, after the boot rush; 0 when done
# prints the newest "LG Home shown" line's timestamp from the surface manager's log (webOS 4), or nothing
home_shown_stamp() {
  [ -f "$SYSLOG" ] || return 0
  grep -F NL_HOME_SHOWN "$SYSLOG" 2>/dev/null | tail -n 1 | cut -d' ' -f1
}
WAKEFILE=/tmp/lumen-wakeuntil
# true while the surface manager's log says LG's home bar is up (its newest _WEBOS_WINDOW_TYPE_HOME line); false when unknown
home_visible() {
  grep -F _WEBOS_WINDOW_TYPE_HOME "$SYSLOG" 2>/dev/null | tail -n 1 | grep -q '"visible": *true'
}
# closes LG's home bar with a Back key (network input service), only while it is up
hide_home() {
  home_visible || return 0
  r=$(luna-send -n 1 luna://com.webos.service.networkinput/sendSpecialKey '{"key":"BACK"}' </dev/null 2>&1 | tr -d ' \n')
  echo "$(date +%T) LG Home bar closed with Back ($1): $r" >> /tmp/homehook.log
}
# one new NL_HOME_SHOWN line ($1): answer it as the main loop would (home-takeover, or the wake window; not when LG Home was asked for)
on_home_shown() {
  now=$(date +%s)
  fg=$(printf '%s' "$1" | sed -n 's/.*"foregroundId": *"\([^"]*\)".*/\1/p')
  echo "$(date +%T) LG Home shown (over ${fg:-?})" >> /tmp/homehook.log
  home_key_missed "$now"
  t=0
  [ -f "$TAKEOVER_FLAG" ] && t=1
  wu=$(cat "$WAKEFILE" 2>/dev/null)
  [ ! -f "$NOWAKE_FLAG" ] && [ -n "$wu" ] && [ "$now" -lt "$wu" ] 2>/dev/null && t=1
  [ "$t" -eq 1 ] || return 0
  if [ -f "$FLAG" ]; then
    age=$((now - $(stat -c %Y "$FLAG")))
    [ "$age" -ge 0 ] && [ "$age" -lt 30 ] && { echo "$(date +%T) left alone (asked for from Lumen)" >> /tmp/homehook.log; return 0; }
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
    r=$(luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$BAR\"}" </dev/null 2>&1 | tr -d ' \n')
    echo "$(date +%T) LG Home -> $BAR over ${fg:-?}: $r" >> /tmp/homehook.log
    return 0
  fi
  r=$(luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$target\"}" </dev/null 2>&1 | tr -d ' \n')
  echo "$(date +%T) LG Home -> $target: $r" >> /tmp/homehook.log
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
    luna-send -n 1 luna://com.webos.service.networkinput/sendSpecialKey '{"key":"HOME"}' </dev/null >/dev/null 2>&1
    echo "$(date +%T) Home key [$t0] -> LG Home (takeover off)" >> /tmp/homehook.log
    return 0
  fi
  main=$(luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null | sed 's/": *"/":"/g')
  fg=$(printf '%s' "$main" | sed -n 's/.*"appId":"\([^"]*\)".*/\1/p')
  # a real Home press is never the power-on Home, so the wake window does not apply to the bar here
  bar=0
  [ -f "$BAR_FLAG" ] && [ -f "$TAKEOVER_FLAG" ] && [ -d "$APPS/$BAR" ] && bar=1
  if [ "$bar" -eq 0 ] && me_in_front "$main" >/dev/null; then
    # no bar: as before, Home over Lumen closed LG's bar and left Lumen as it was
    echo "$(date +%T) Home key [$t0] over $fg: nothing to do" >> /tmp/homehook.log
    return 0
  fi
  # Lumen bar up (an overlay, so it is never the app in front; the surface manager's log says): Home closes it, as Back does. Closed from
  # here (closeByAppId), not by relaunching it: on the C8 a relaunch reached bar.js twice, so it closed and opened again (24 Oct 2026).
  # Within BAR_DEBOUNCE_CS of it coming up the press is ignored. If the close fails (the log was stale), the bar is launched as below.
  if [ "$bar" -eq 1 ] && shown=$(bar_shown_at) && n=$(up_cs); then
    if [ $((n - shown)) -ge 0 ] && [ $((n - shown)) -lt "$BAR_DEBOUNCE_CS" ]; then
      echo "$(date +%T) Home key [$t0] over ${fg:-?}: Lumen bar came up $((n - shown))0 ms ago, ignored" >> /tmp/homehook.log
      return 0
    fi
    r=$(luna-send -n 1 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$BAR\"}" </dev/null 2>&1 | tr -d ' \n')
    case "$r" in
      *'"returnValue":true'*)
        up_cs > "$BAR_CLOSED_AT"
        echo "$(date +%T) Home key [$t0] over ${fg:-?}: Lumen bar closed [$(up)]: $r" >> /tmp/homehook.log
        return 0 ;;
    esac
    echo "$(date +%T) Home key [$t0]: Lumen bar close failed ($r), launching it" >> /tmp/homehook.log
  fi
  # with the bar, over any app and over Lumen itself. {"home":true}: a relaunch while the bar is up (the log above unknown) closes it (bar.js)
  if [ "$bar" -eq 1 ]; then id=$BAR; launch='{"id":"'$BAR'","params":{"home":true}}'; else id=$target; launch='{"id":"'$target'"}'; fi
  r=$(luna-send -n 1 luna://com.webos.applicationManager/launch "$launch" </dev/null 2>&1 | tr -d ' \n')
  echo "$(date +%T) Home key [$t0] over ${fg:-?} -> $id [$(up)]: $r" >> /tmp/homehook.log
}
# opens Lumen without waiting (a launch can take seconds right after a wake), unless the last one is still in flight; $1 is the app in front
wake_open() {
  [ "$launchpid" -gt 0 ] && [ -d "/proc/$launchpid" ] && return 0
  target=$(me_target) || return 0
  ( r=$(luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$target\"}" </dev/null 2>&1 | tr -d '\n')
    echo "$(date +%T) wake: open $target over ${1:-nothing}: $r" >> /tmp/homehook.log ) &
  launchpid=$!
}
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
    echo "$(date +%T) wake ended: $app opened from Lumen" >> /tmp/homehook.log
    return 0
  fi
  if [ -n "$front" ]; then
    if [ $((now - mesince)) -ge "$WAKE_SETTLE" ]; then
      wakeuntil=0
      echo 0 > "$WAKEFILE"
      echo "$(date +%T) wake settled: $front in front" >> /tmp/homehook.log
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
    printf '%s\n' "$new" > "$KEYBINDS.tmp" && mv "$KEYBINDS.tmp" "$KEYBINDS" && echo "$(date +%T) Home key bind added (LG Input Hook)" >> /tmp/homehook.log
  elif [ "$have" -eq 1 ]; then
    new=$(printf '%s' "$cur" | awk -v b="$HOMEKEY_BIND" '{ while ((i = index($0, b ",")) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b) + 1);
      while ((i = index($0, "," b)) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b) + 1);
      while ((i = index($0, b)) > 0) $0 = substr($0, 1, i - 1) substr($0, i + length(b)); print }')
    printf '%s\n' "$new" > "$KEYBINDS.tmp" && mv "$KEYBINDS.tmp" "$KEYBINDS" && echo "$(date +%T) Home key bind removed" >> /tmp/homehook.log
  fi
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
  [ -f "$1" ] && [ ! -h "$1" ] && [ "$(stat -c %u "$1" 2>/dev/null)" = "$(id -u)" ]
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
    set -- "$1" -l /tmp/lginput-hook-lginput2.log "$p" "$2"
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
  "$IH_DIR/ezinject" "$@" > /tmp/ezinject-lginput2.log 2>&1 </dev/null &
  e=$!
  i=0
  while kill -0 "$e" 2>/dev/null && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$e" 2>/dev/null; then
    r="ezinject still running after 10 s, left alone"
  else
    wait "$e"; rc=$?
    if lginput_hooked "$p"; then r=ok; else r="failed (ezinject $rc, see /tmp/ezinject-lginput2.log)"; fi
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
  tail -n 2000 "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}

# Self-refresh after a Homebrew Channel update of Lumen (Lumen itself only refreshes the watcher when it is opened). About every 30 s:
#  - the packaged pair is $APPS/<build>/homehook/{watch.sh,60-homehook} for the build me_target names (the one Home opens). The app folder
#    belongs to the developer user and is world-writable on the C8, so the packaged files cannot be checked for root ownership: they are read
#    once into root's own temporary files next to the installed ones (mktemp, mode 600), and every check below is made on those copies, never
#    on the packaged files again (no check-then-use window). Symlinks, empty files and anything over SU_MAXSIZE are refused.
#  - the installed watcher (and the boot hook, when it is replaced) must be root's own plain files (ih_own), as before.
#  - an install must have finished: the copies' checksum has to be the same on two checks in a row; a half-written file never gets in.
#  - the copies must parse in sh and look like the watcher and its hook; a pair that fails is logged once and not tried again until it changes.
#  - at most one refresh every SU_GAP s and SU_MAX a boot (SU_STATE in /tmp keeps the count across the re-exec), so two builds with
#    different watchers cannot make it loop.
# Then the copies are moved over the installed files (mv: the running shell keeps reading its old file), home_reader is stopped and the
# watcher re-execs itself: the same pid, so the single_instance lock stays its own, and the same command line, so 60-homehook still sees it.
SELF=${SELF:-/var/lib/homehook/watch.sh}
INIT_HOOK=${INIT_HOOK:-/var/lib/webosbrew/init.d/60-homehook}
SU_STATE=${SU_STATE:-/tmp/homehook-selfupdate}   # one line per refresh (epoch seconds)
SU_GAP=60
SU_MAX=5
SU_MAXSIZE=262144
susig=""       # stat of the packaged pair at the last check that found it the same as the installed pair (skips the compare while unchanged)
supend=""      # checksum of the packaged pair seen at the last check (it is installed only when seen the same twice)
sufail=""      # checksum of a pair that was refused (logged once)
sugaveup=0
hrpid=""       # home_reader's pid, stopped before a re-exec
# prints the packaged homehook/ folder of the Lumen build Home opens; false when there is none (or it is reached through a symlink)
su_src() {
  sut=$(me_target) || return 1
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
su_reexec() {
  [ -n "$hrpid" ] && kill "$hrpid" 2>/dev/null
  exec /bin/sh "$SELF"
}
# $1: now
self_update() {
  [ "$sugaveup" -eq 1 ] && return 0
  ih_own "$SELF" || return 0
  sud=$(su_src) || return 0
  su_plain "$sud/watch.sh" && su_plain "$sud/60-homehook" || return 0
  suss=$(stat -c '%i %s %Y' "$sud/watch.sh" "$sud/60-homehook" 2>/dev/null | tr '\n' ' ')
  [ -n "$susig" ] && [ "$suss" = "$susig" ] && return 0
  # root's own copies, read once; everything from here on looks only at them
  nw=$(mktemp "$SELF.new.XXXXXX" 2>/dev/null) || return 0
  nh=$(mktemp "$SELF.hook.XXXXXX" 2>/dev/null) || { rm -f "$nw"; return 0; }
  if ! cat "$sud/watch.sh" > "$nw" 2>/dev/null || ! cat "$sud/60-homehook" > "$nh" 2>/dev/null || ! su_plain "$nw" || ! su_plain "$nh"; then
    rm -f "$nw" "$nh"; return 0
  fi
  # the boot hook is replaced only where it is installed as root's own plain file (removed by hand: left removed)
  suhook=0
  ih_own "$INIT_HOOK" && suhook=1
  if cmp -s "$nw" "$SELF" && { [ "$suhook" -eq 0 ] || cmp -s "$nh" "$INIT_HOOK"; }; then
    rm -f "$nw" "$nh"; supend=""; susig=$suss; return 0
  fi
  susum=$(cat "$nw" "$nh" | md5sum)
  if [ "$susum" = "$sufail" ]; then rm -f "$nw" "$nh"; return 0; fi
  # an install may still be writing the files: only a pair read the same twice in a row is taken
  if [ "$susum" != "$supend" ]; then supend=$susum; rm -f "$nw" "$nh"; return 0; fi
  if ! sh -n "$nw" 2>/dev/null || ! sh -n "$nh" 2>/dev/null || [ "$(head -n 1 "$nw")" != '#!/bin/sh' ] || [ "$(head -n 1 "$nh")" != '#!/bin/sh' ] \
    || ! grep -q '^single_instance()' "$nw" || ! grep -q '^home_key()' "$nw" || ! grep -qF '/var/lib/homehook/watch.sh' "$nh"; then
    sufail=$susum; supend=""; rm -f "$nw" "$nh"
    su_log "the watcher packaged in $sud does not look right (does not parse, or is not watch.sh and 60-homehook), not installed"
    return 0
  fi
  sun=0; lastsu=0
  [ -f "$SU_STATE" ] && { sun=$(grep -c . "$SU_STATE"); lastsu=$(tail -n 1 "$SU_STATE"); }
  case "$sun" in ''|*[!0-9]*) sun=0 ;; esac
  case "$lastsu" in ''|*[!0-9]*) lastsu=0 ;; esac
  if [ "$sun" -ge "$SU_MAX" ]; then
    sugaveup=1; rm -f "$nw" "$nh"
    su_log "not refreshed from $sud ($sun refreshes this boot already)"
    return 0
  fi
  if ! { [ $(($1 - lastsu)) -ge "$SU_GAP" ] 2>/dev/null || [ $(($1 - lastsu)) -lt 0 ] 2>/dev/null; }; then rm -f "$nw" "$nh"; return 0; fi
  echo "$1" >> "$SU_STATE"
  chmod 755 "$nw" "$nh"
  if [ "$suhook" -eq 1 ] && ! cmp -s "$nh" "$INIT_HOOK"; then
    mv -f "$nh" "$INIT_HOOK" || { rm -f "$nw" "$nh"; su_log "could not replace $INIT_HOOK"; return 0; }
  else
    rm -f "$nh"
  fi
  [ "$suhook" -eq 0 ] && { [ -e "$INIT_HOOK" ] || [ -h "$INIT_HOOK" ]; } && su_log "$INIT_HOOK is not root's own plain file, left as it is"
  if cmp -s "$nw" "$SELF"; then rm -f "$nw"; susig=$suss; supend=""; su_log "boot hook updated from $sud"; return 0; fi
  mv -f "$nw" "$SELF" || { rm -f "$nw"; su_log "could not replace $SELF"; return 0; }
  su_log "updated from $sud (Lumen was updated), restarting"
  su_reexec
}

# One watcher at a time. Two Lumen starts close together can each refresh the watcher; each kills the running copy, then starts one through
# 60-homehook, whose "already running?" check can miss a copy that is still starting (seen on the C8 on 24 Oct: two watcher trees, so every
# action could happen twice). The lock is a directory (mkdir is atomic) holding the owner's pid; a lock whose owner is gone is taken over.
WATCH_LOCK=${WATCH_LOCK:-/tmp/homehook-watch.lock}
single_instance() {
  for try in 1 2 3; do
    if mkdir "$WATCH_LOCK" 2>/dev/null; then echo $$ > "$WATCH_LOCK/pid"; return 0; fi
    old=$(cat "$WATCH_LOCK/pid" 2>/dev/null)
    # the other copy may not have written its pid yet
    [ -z "$old" ] && { sleep 1; old=$(cat "$WATCH_LOCK/pid" 2>/dev/null); }
    if [ -n "$old" ] && [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null \
      && tr '\0' ' ' < "/proc/$old/cmdline" 2>/dev/null | grep -q 'watch\.sh'; then return 1; fi
    rm -rf "$WATCH_LOCK"
  done
  return 1
}

case "$0" in */watch-key) home_key; exit 0 ;; esac
# tools/test/watch.test.mjs sources this file for its functions only
[ -n "$WATCH_SH_LIB" ] && return 0
single_instance || { echo "$(date +%T) watcher: another copy is running, this one exits" >> /tmp/homehook.log; exit 0; }

echo "$wakeuntil" > "$WAKEFILE"
home_reader &
hrpid=$!

while true; do
  # wake: the power state goes back to Active from standby or off (not from the screensaver), or the loop missed its ticks (suspended)
  now=$(date +%s)
  gap=$((now - tick)); tick=$now
  pw=$(luna-send -n 1 luna://com.webos.service.tvpower/power/getPowerState '{}' </dev/null 2>/dev/null)
  # webOS 25 answers "state": "Active", with a space
  pwstate=$(printf '%s' "$pw" | sed -n 's/.*"state": *"\([^"]*\)".*/\1/p')
  woke=0
  [ "$gap" -gt 5 ] && woke=1
  if [ "$pwstate" = Active ] && [ -n "$pwlast" ] && [ "$pwlast" != Active ] && [ "$pwlast" != "Screen Saver" ]; then woke=1; fi
  [ -n "$pwstate" ] && pwlast=$pwstate
  if [ "$woke" -eq 1 ]; then
    wakeuntil=$((now + WAKE_SECS)); last=0
    echo "$wakeuntil" > "$WAKEFILE"
    echo "$(date +%T) wake (gap ${gap}s, power $pwstate)" >> /tmp/homehook.log
    # before the foreground query: right after a wake each query can take seconds
    [ ! -f "$NOWAKE_FLAG" ] && [ "$pwstate" = Active ] && wake_open ""
  fi
  # the foreground app ("appId"), and with extraInfo every foreground window (webOS 4 lists the launcher bar there while it overlays an app);
  # spaces after the colons dropped, as luna-send prints them on some firmware and not on others
  main=$(luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null | sed 's/": *"/":"/g')
  extra=$(luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{"extraInfo":true}' </dev/null 2>/dev/null | sed 's/": *"/":"/g')
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
        r=$(luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$target\"}" </dev/null 2>&1 | tr -d '\n')
        echo "$(date +%T) LG Home -> $target: $r" >> /tmp/homehook.log
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
      *'"Screen Saver"'*) luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreen '{}' </dev/null >/dev/null 2>&1; echo "$(date +%T) ended screensaver (video wallpaper)" >> /tmp/homehook.log ;;
    esac
  elif [ -f "$AMBIENT_FLAG" ] && target=$(me_target); then
    # Lumen's ambient screen (your photos) instead of LG's screensaver. While it is up, LG's screensaver still starts after its timer (nothing
    # is pressed), so it is only ended, not answered by opening Lumen again.
    case "$pw" in
      *'"Screen Saver"'*)
        if [ -n "$front" ] && [ -f "$AMBIENT_ON" ]; then
          luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreen '{}' </dev/null >/dev/null 2>&1
        elif [ "$pwprev" != "saver" ] && [ $((now - saverlast)) -ge 5 ]; then
          saverlast=$now
          r=$(luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$target\",\"params\":{\"view\":\"ambient\"}}" </dev/null 2>&1)
          echo "$(date +%T) screensaver: ambient ($target): $r" >> /tmp/homehook.log
          sleep 1
          luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreen '{}' </dev/null >/dev/null 2>&1
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
            echo "$(date +%T) screensaver seen; foreground: $out" >> /tmp/homehook.log
            case "$out" in
              *'"appId":"'$FRAME'"'*) ;;
              *) r=$(luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$FRAME\",\"params\":{\"mode\":\"screensaver\"}}" </dev/null 2>&1); echo "$(date +%T) launch Frame: $r" >> /tmp/homehook.log; sleep 1 ;;
            esac
            luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreen '{}' </dev/null >/dev/null 2>&1
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
      run=$(luna-send -n 1 luna://com.webos.applicationManager/running '{}' </dev/null 2>/dev/null)
      open=0
      for id in $ME; do case "$run" in *'"id":"'$id'"'*) open=1 ;; esac; done
      if [ "$open" -eq 0 ]; then
        r=$(luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$target\",\"preload\":\"full\"}" </dev/null 2>&1)
        echo "$(date +%T) boot preload ($target): $r" >> /tmp/homehook.log
      fi
    fi
  fi
  # keep the extra blocked names in /etc/hosts (about every 30 s; the dashboard rewrites the table at boot)
  ticks=$((ticks + 1))
  [ $((ticks % 5)) -eq 1 ] && { sync_home_key; inputhook_check "$now"; }
  [ $((ticks % 300)) -eq 2 ] && trim_log "$IH_LOG"
  [ $((ticks % 30)) -eq 15 ] && self_update "$now"
  if [ $((ticks % 30)) -eq 1 ] && [ -f "$EXTRA" ]; then
    # only "0.0.0.0 <name>" or ":: <name>" lines are ever copied, so a stray line in the file cannot point a name somewhere real
    grep -E '^(0\.0\.0\.0|::)[[:space:]]+[A-Za-z0-9.-]+[[:space:]]*$' "$EXTRA" | while IFS= read -r l; do
      ! grep -qF "$l" /etc/hosts 2>/dev/null && echo "$l" >> /etc/hosts
    done
  fi
  # faster ticks while a wake is open, so Lumen goes up as soon as the TV lets it (webOS 4's busybox sleep takes whole seconds: usleep)
  if [ "$now" -lt "$wakeuntil" ]; then usleep 500000 2>/dev/null || sleep 1; else sleep 1; fi
done
