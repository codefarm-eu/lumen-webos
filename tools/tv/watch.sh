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
# Never spins: reacts only when the app changes, and at most once every 3 s. Does nothing if the app is not installed.
# ME lists every Lumen build (stable, dev). Home opens the one that was last in front, or the first installed one in this list. The flag files in
# /var/lib/homehook/ are shared by all of them, which is fine while only one is in front at a time.
ME="com.ovsteenb.lumen com.ovsteenb.lumen.dev com.samrenfrew.lumen com.samrenfrew.lumen.dev com.ammar027.lumen com.ammar027.lumen.dev"
FRAME=com.ammar027.lumen.gallery
LGHOME=com.webos.app.home
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
  case "$1" in ''|$LGHOME|$FRAME) return ;; esac
  for id in $ME; do [ "$1" = "$id" ] && return; done
  printf '%s' "$1" | grep -qE '^[A-Za-z0-9._-]+$' || return
  { echo "$1"; [ -f "$RECENT" ] && grep -vxF "$1" "$RECENT"; } | head -n 8 > "$RECENT.tmp" && mv "$RECENT.tmp" "$RECENT"
}

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
    echo "$(date +%T) wake (gap ${gap}s, power $pwstate)" >> /tmp/homehook.log
  fi
  out=$(luna-send -n 1 luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null)
  front=$(me_in_front "$out") && lastme=$front
  app=$(printf '%s' "$out" | sed -n 's/.*"appId":"\([^"]*\)".*/\1/p')
  if [ -n "$app" ] && [ "$app" != "$prevapp" ]; then prevapp=$app; note_recent "$app"; fi
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
        luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$target\"}" </dev/null >/dev/null 2>&1
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
