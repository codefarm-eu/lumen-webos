#!/bin/sh
# Home button -> custom launcher, and screensaver -> Frame (art mode). Once a second, checks which app is in front.
#  - Only with /var/lib/homehook/home-takeover present (off by default: LG Input Hook owns the Home button on this TV): when LG's own Home has just
#    come up, opens the launcher instead (polling, because luna-send buffers a subscription's output when it is piped). The launcher's own
#    "LG Home" button touches /tmp/allow_lg_home first, so LG Home can still be opened on purpose (it then stays until you leave it).
#  - After the TV wakes (power state back to Active, or a gap in this loop's once-a-second ticks, which means it was suspended) and after a boot:
#    for WAKE_SECS, LG Home coming up is replaced by Lumen even without home-takeover, because the power button opens LG Home. Switch off with
#    /var/lib/homehook/no-wake-launch.
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
NOPRELOAD_FLAG=/var/lib/homehook/no-boot-preload
RECENT=/var/lib/homehook/recent
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
tick=$(date +%s)
wakeuntil=$((tick + 90))   # a boot counts as a wake; LG Home may take a while to come up
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

echo "$wakeuntil" > "$WAKEFILE"
home_reader &

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
  fi
  # the foreground app ("appId"), and with extraInfo every foreground window (webOS 4 lists the launcher bar there while it overlays an app);
  # spaces after the colons dropped, as luna-send prints them on some firmware and not on others
  main=$(luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null | sed 's/": *"/":"/g')
  extra=$(luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{"extraInfo":true}' </dev/null 2>/dev/null | sed 's/": *"/":"/g')
  case "$extra" in *'"returnValue":true'*|*'"returnValue": true'*) ;; *) extra="" ;; esac
  out=$main
  front=$(me_in_front "$main") && lastme=$front
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
      [ ! -f "$NOWAKE_FLAG" ] && [ "$now" -lt "$wakeuntil" ] && takeover=1
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
  if [ $((ticks % 30)) -eq 1 ] && [ -f "$EXTRA" ]; then
    # only "0.0.0.0 <name>" or ":: <name>" lines are ever copied, so a stray line in the file cannot point a name somewhere real
    grep -E '^(0\.0\.0\.0|::)[[:space:]]+[A-Za-z0-9.-]+[[:space:]]*$' "$EXTRA" | while IFS= read -r l; do
      ! grep -qF "$l" /etc/hosts 2>/dev/null && echo "$l" >> /etc/hosts
    done
  fi
  sleep 1
done
