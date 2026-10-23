# Lumen on webOS 4 (LG OLED55C8PLA, Chromium 53)

This fork ([ovsteenb/lumen-webos](https://github.com/ovsteenb/lumen-webos)) makes Lumen run on a 2018 LG C8: webOS 4.x, whose web engine
is Chromium 53, rooted with the Homebrew Channel. Upstream ([samrenfrew/lumen-webos](https://github.com/samrenfrew/lumen-webos)) targets
webOS 6 (Chrome 79) and is tested on webOS 25 (Chromium 120). Every change below is a feature test, never a version or user-agent test, so the
same build still gets the upstream look on a newer TV.

## Install

Add this repository URL in the Homebrew Channel's settings, then install **Lumen** from its list:

    https://ovsteenb.github.io/lumen-webos/dev/apps.json

The same index is also at `https://raw.githubusercontent.com/ovsteenb/lumen-webos/hbc-repo/dev/apps.json`. A `v*` tag publishes
`.../stable/apps.json`. The app id is `com.ovsteenb.lumen` and the tile is called **Lumen**, so it installs beside any other Lumen build.

## What changed for Chromium 53

| Area | Chromium 53 lacks | What the fork does |
|---|---|---|
| Script syntax | async functions (55), object spread (60), optional chaining and `??` (80) | Vite/esbuild target `chrome53` (`app/vite.config.ts`). The bundle parses as ES2016 (checked with acorn and es-check). |
| Built-ins | `String#padStart` (57), `globalThis` (71), `Array#at` and more | `polyfills()` in `vite.config.ts` scans the finished bundle with Babel's core-js plugin (usage only, no syntax change) and puts the needed core-js modules (13) in front of the app. Native RegExp, URL, JSON, Promise and typed arrays are kept. |
| Glass | `backdrop-filter` (76) | **Fake glass**: `html.fakeglass` instead of `html.liveblur` (`index.html`, `lib/compat.ts`). Each glass shape (glass bar, top buttons, Control Center, Inputs, menus) shows the pre-blurred wallpaper copy (`--wp-blur`) with `background-attachment: fixed` at 1920x1080, so it lines up with the wallpaper's own cover crop, under the sheen, rim lights and shadow. In the dark look the Control Center controls also get the live glass's dark tint, so text stays readable. The copy is made once per wallpaper: bundled pictures ship a `-blur.jpg`, cloud pictures come blurred from the resizer, Immich photos are blurred on a canvas. This is Lumen's original "lite glass", the look in the README screenshots. |
| Canvas blur | `ctx.filter` is honoured in this build, but not on every TV | `canvasFilterWorks()` draws a test pixel; without a filter, `lib/stackBlur.ts` (a three-pass box blur) blurs the Immich thumbnail instead. |
| Fonts | variable fonts (62), font weights other than 100..900 steps (62) | Five static Geist cuts (300 to 700, made with fontTools' instancer) as family "Geist Static", named in the font token only when `font-variation-settings` is not supported. A PostCSS step puts a rounded weight (600) before each odd one (650). |
| CSS | CSS grid (57), unprefixed `user-select` (54) | Autoprefixer for `chrome 53`; the Settings picker grid falls back to a wrapping flex row of the same size (`@supports not (display: grid)`). Screenshots of both engines match. |
| Animations | partial keyframes, some options | Every `Element.animate` call goes through `safeAnimate()`, which skips the animation instead of throwing. |
| Settings | — | **Dock blur** and **Liquid glass dock** are hidden without `backdrop-filter` (they have nothing to change), and the Liquid glass dock never starts without `ResizeObserver` (64). |

Video wallpapers keep upstream's tinted panel: the blurred copy is made from a still picture and would not match a video.

## TV services on webOS 4

All of these already fail quietly in upstream's code (a rejected Luna call shows no chip, an empty row, or a toast), so nothing was removed:

| Feature | Service | On webOS 4 |
|---|---|---|
| Apps, inputs, launch | `applicationManager`, `eim` | works on the C8 (1.0.9002). App icons: see below |
| Volume, mute, network chip | `com.webos.audio`, `connectionmanager` | expected to work |
| Picture, sound, backlight, Eye Comfort | `settingsservice` through root | expected to work; the C8 has no "FILMMAKER" mode (2020+), so that choice may show an error toast |
| Screen off, restart, LG screensaver | `tvpower` through root | expected to work |
| Live TV row and guide | `iepg`, `epgdb`, `apiadapter/tv/openChannel` | **off by default** (see below); if turned on and the calls fail, the row is empty and hidden |
| Sleep timer chip | `tvReservationAgent` through root | **unknown**: if it fails there is simply no chip |
| Home button takeover, wake launch, Recent row from other apps | `tools/tv/watch.sh` | installed from the `.ipk` by Settings > Home Screen > **Home opens Lumen** (see below), or over SSH as upstream |
| LG Input Hook | — | **uncertain on webOS 4**: its issue tracker has reports of key binds stopping after minutes (v1.4.0, webOS 4.x) and of v1.5.0 freezing `tvservice` on webOS 4.10 and losing the picture after standby on webOS 4.5. Lumen does not need it; on this C8 (1.4.0, injected since boot) the watcher uses it for the Home key when it is there (see "Home key bind"), and works without it. |

## Live TV setting

Settings > Home Screen > **Live TV**, off by default. Off, Lumen renders no channel row, opens no Guide (the Guide button and the
`{"view":"guide"}` relaunch do nothing in Lumen), hides the Channels settings page, and makes no `iepg`/`epgdb` calls and reads no cached
channel list at start. The code is still in the bundle: the build is a single classic script (iife, `inlineDynamicImports`), so it cannot be
lazy-loaded, and `lib/livetv.ts` has no top-level side effects, so gating the hook is enough. Turned on, it starts at once (no relaunch).
It is stored as `liveTv` in `launcher-config-v2`. Upstream's `liveTvRow` key is not read, so a config saved by an older build starts off.
Tested with a fake `PalmServiceBridge` that logs every Luna call: off makes 0 Live TV calls; on asks `iepg/getChannelList` as expected.

## App icons from the TV

Apps without a bundled logo used to show a letter. Now each app's own icon comes from the TV's launch points (`listLaunchPoints` through root,
or directly when the firmware allows it; `getAppInfo` through root for the system apps in Settings > Apps that are not launch points).
`largeIcon` is used first, then `mediumLargeIcon`, then `icon`. Each icon is loaded as a `file://` URL first, because Lumen runs from `file://`.
Any icon that will not load that way is read as root in batches of 8 and turned into a `data:` URI. The tile colour comes from the icon's own
edge, else LG's `iconColor`/`bgColor` (white counts as unset). If the icon still fails, the tile falls back to the letter. Icon packs and
bundled logos still win. Everything is cached by path in `launcher-icon-cache-v1`.

Tested off the TV only: Chromium 53 from `file://` with `--allow-file-access-from-files`, a fake Luna listing 25 apps with webOS 4 paths
(`/media/cryptofs/apps/usr/palm/applications/<id>/largeIcon.png`, `/usr/palm/applications/<id>/...`) and real files at those paths.
**Whether a webOS 4 app may read other apps' files as `file://` was not verified.** If it may not, the root read covers it.

## Settings > Apps grid

On Chromium 53 the tile label is 68 px tall, not the 60 px the grid assumed. Three rows were then taller than the 720 px window, so the
bottom row was cut. The grid now measures its own row step, tile height and columns. The window holds whole rows only (3 at 1920x1080),
with room above and below for the focus zoom. It ends by y 990, inside the title-safe area. The first visible row moves only when the
focus would leave the window. The rightmost column ends at x 1757 with the zoom, and the screen is 1920 wide.

## Weather by postcode

Settings > Weather > **Postcode or place**: press OK, type with the on-screen keyboard, then press OK again (or press Down for Look up,
Remove or Cancel). A full UK postcode (`CF10 3AT`) goes to `api.postcodes.io/postcodes`, and the place shown is the ward plus the
district. An outward code (`CF10`) goes to `/outcodes`. Anything else (a town, another country's postal code) goes to Open-Meteo's
geocoder. The lookup happens once. The result's name, label, lat and lon are kept in `weatherPlace`, and `weatherCity` becomes
`@postcode` (it is also listed in Weather city). Remove goes back to Auto. Without a postcode, the place works as before: a picked city,
or Auto (`ipwho.is`, by IP address). postcodes.io chains to GlobalSign Root CA, like `ipwho.is`, which already works on the TV.

## Home opens Lumen

Settings > Home Screen > **Home opens Lumen**, off by default. On, Lumen uses the Homebrew Channel (root) to copy `homehook/watch.sh`
and `homehook/60-homehook` from its own folder into `/var/lib/homehook/` and `/var/lib/webosbrew/init.d/`. It also sets `home-takeover`
and starts the watcher, and at each start it refreshes the watcher if this build carries a newer one. Off removes `home-takeover` and
`livetv-to-lumen` and sets `no-wake-launch`. The watcher keeps running for the Recent row. While off, Lumen never touches a watcher that
was set up over SSH.

Once a second the watcher checks for LG's home and opens Lumen in its place:
- `com.webos.app.home` or `com.webos.app.launcher` as the foreground app. This covers the Home key (short or long press), Back out of an
  app to the top level, and power on.
- The same ids appearing in `getForegroundAppInfo {"extraInfo":true}`, where webOS 4 can list the launcher bar over another app. Only
  the moment it appears counts, so a hidden launcher window can never bounce apps.
- With Lumen's Live TV off (`livetv-to-lumen`): Live TV coming to the front straight after another app, which is where Back out of an
  app lands, or within 30 s of a wake. Live TV picked from Lumen is left alone.

Lumen's own LG Home button sets `/tmp/allow_lg_home` so the watcher leaves LG's home alone. On this C8 it does not open LG's home,
though: `launch {"id":"com.webos.app.home"}` answers `notexist` (see below).

### What LG's home is on webOS 4 (checked on the C8, 4.4.3)

1.0.9003 did nothing on the TV. The watcher was installed, running and polling, but LG's home never showed in `getForegroundAppInfo`.
On webOS 4 the home/launcher bar is not an app. No `com.webos.app.home` is installed and launching it gives `notexist`. It is a surface
manager window (`_WEBOS_WINDOW_TYPE_HOME`) drawn over the app in front. While it is up, `getForegroundAppInfo`, plain and with
`extraInfo`, and the surface manager's own `getForegroundAppInfo` keep reporting that app (YouTube, Netflix or Lumen itself).
`com.webos.surfacemanager/getCurrentState` says `none`. The one trace is in `/var/log/messages`, once per appearance:

    LSM NL_VSC {"app_id": "com.webos.app.home", "visible": true, "window_type": "_WEBOS_WINDOW_TYPE_HOME"}
    LSM NL_HOME_SHOWN {"CLOCK": 18773.395, "foregroundId": "com.ovsteenb.lumen", "params": ""}

The watcher runs a second loop (`home_reader`) that checks the log 4 times a second, and greps it only when the file has changed. Every new
`NL_HOME_SHOWN` line counts as LG's home. Lines from before the watcher started do not count. The file rotates about every 10 min
(`messages.0.gz` and so on), and a new file simply has no line yet. What it does then, checked on the C8 on 23 Oct 2026 (the Home key was
sent with `com.webos.service.networkinput/sendSpecialKey {"key":"HOME"}`):
- **Bar over another app** (YouTube, Moonfin): Lumen is launched about 0.06 s after the bar comes up. The launch takes the bar down
  (`visible: false` about 0.5 s later). If the bar is still up 1.5 s after the launch, Back is sent, as below.
- **Bar over Lumen itself**: launching Lumen again changes nothing, and the bar stayed up (seen at 22:18:08 UTC, 23 s until it was closed
  by hand). The watcher sends Back through `com.webos.service.networkinput/sendSpecialKey {"key":"BACK"}`, which is what LG's phone
  remote uses, and the bar closes about 0.75 s after it came up. Back is only sent while the log's newest `_WEBOS_WINDOW_TYPE_HOME` line
  says `visible: true`, so it never reaches an app.
- Lumen also calls `webOSSystem.activate()` on every relaunch, as LG asks of apps.

Each step is logged to `/tmp/homehook.log` (`LG Home shown (over <id>)`, `LG Home -> <id>`, `LG Home bar closed with Back (...)`).

Lumen's own **LG Home** button (glass bar menu, Control Center): launching `com.webos.app.home` fails with `notexist` on webOS 4, so it then
sends the Home key the same way, as root. `/tmp/allow_lg_home` is set first, so the watcher leaves that bar alone.

Tried and not working on the C8: writing key events into `/dev/input/event1` (the remote's device is grabbed, so injected events are
dropped), a key from a new `/dev/uinput` device (ignored), and the raw `/tmp/netinput.pointer.sock` socket (it closes at once).

Not covered:
- The bar still flashes for a moment, about 0.5 to 0.8 s (1.0.9007; from 1.0.9008 the Home key itself no longer shows it, see below).
- Overlays that are not LG's home (the volume and settings side panels, the Q-menu) are left alone.

Off-TV tests: a simulation of the watcher with a fake `luna-send` covered Home in front, the bar over an app, a launcher listed all the
time (no bounce), Back to Live TV with and without the flag, Live TV picked from Lumen, the LG Home button and takeover off. The
captured install command, run as root on a Linux box, reported installed, then same, then updated, with one watcher running.

## Lumen bar (Home shows the bar)

A second app, **Lumen bar** (`com.ovsteenb.lumen.bar`, folder `bar/`, plain ES5 with no build step), shows Lumen's dock as an overlay window
over the app that is playing, as LG's own launcher bar does. Its `appinfo.json` sets `"defaultWindowType": "overlay"`, `"transparent": true`,
`"handlesRelaunch": true`, `"noSplashOnLaunch": true`, `"spinnerOnLaunch": false` and `"visible": false` (it is not in LG's app list).
The same settings are used by `com.sammysco.avoverlay`.

- **Turn on:** Lumen Settings > Home Screen > **Home shows the bar** (off by default). This turns on Home opens Lumen too, and sets
  `/var/lib/homehook/home-bar`. Off, everything is as in 1.0.9005.
- **The watcher:** when LG's home bar comes up over another app (not over Lumen, and not in the wake window after power on or after the
  watcher starts, about 90 s), it closes LG's bar with Back (networkinput, only while it is visible) and launches Lumen bar.
- **Keys:** Left and Right move. OK opens the app and closes the bar. Up, or the house tile at the left, opens full Lumen. Back or Esc closes
  the bar, and the app underneath has the focus again. After 10 s without a key the bar closes by itself. A relaunch (Home pressed again)
  starts it over.
- **Data:** an app cannot read another app's storage, so Lumen fills `data/` in Lumen bar's folder, as root. `data/bar.json` holds the dock
  (the glass bar's apps), Lumen's recent list, every app's title and colour, and Lumen's id. `data/icons/<id>.png` are copied from the TV
  icon paths or from Lumen's bundled icons. It is written again only when a signature in `data/sig` changes, so an update of Lumen bar,
  which empties its folder, is refilled at Lumen's next start. Lumen bar also reads `/var/lib/homehook/recent` and shows up to 4 recent
  apps that are not in the dock, after a divider.
- **Look:** tinted glass. A dark translucent fill with a light rim and a shadow, and no blur: an overlay cannot see the video, so the
  blurred-wallpaper glass cannot be used.
- **No preload:** the bar is about 10 KB with no framework. It is drawn about 0.4 s after the launch from cold, so it is not preloaded.

Checked on the C8 (webOS 4.4.3), 24 Oct 2026, 00:07-00:12 BST, with a dev build of Lumen bar and data written as Lumen would. The keys were
sent through networkinput:
- **Over YouTube:** LG's bar came up, Back closed it 0.46 s later, and Lumen bar was visible 0.93 s after the Home press. The app list
  stayed `youtube.leanback.v4` (card) + `com.ovsteenb.lumen.bar` (overlay). Back reached the bar and closed it, and YouTube was alone in front again.
  The dock showed the real icons from Olivier's dock (YouTube, Moonfin, Prime Video, Amazon Music, ..., Netflix), plus Live TV as recent.
- **Over Moonfin:** the same, and Back closed it.
- **Over Netflix:** the same. After Back, a Down key changed Netflix's screen, so the remote works in the app again. OK on the YouTube tile
  opened YouTube and closed the bar.
- **com.sammysco.avoverlay:** its watcher launches it after each app (card) launch. It did not launch after Lumen bar (an overlay), and it
  did not take the bar's keys. When Lumen bar opens YouTube, avoverlay comes up as usual for that launch.

Known issues (1.0.9007):
- LG's bar flashed for about 0.5 s before it was closed, in bar mode 1.5 to 1.75 s (surface-manager log, 23 Oct, 23:16-23:17 UTC: `visible`
  true to false 1.64 s, 1.55 s, 1.75 s over YouTube). Fixed in 1.0.9008 by the Home key bind below.
- Within about 90 s of a boot, or of the watcher (re)starting, Home opened full Lumen, not the bar (the wake window). With the key bind a
  real Home press always opens the bar; power on still opens full Lumen.
- Live TV and HDMI inputs underneath were not tested.

### Home key bind (1.0.9008): LG's bar never comes up

The flash came from reacting after the fact: Home release, LG's bar animates in, the surface manager logs `NL_HOME_SHOWN`, the watcher
sees it (0.25 s poll), sends Back (a Luna call on a TV with a load average of 11), waits for the bar to go, then launches Lumen bar.
Now the Home key never reaches the surface manager.

- **Where Home is handled:** `/usr/lib/qt5/qml/KeyFilters/systemUi.js` (`Qt.Key_Super_L`: `global.goHome()` on release, recents on a 1 s
  long press). It is read-only and loaded once by `surface-manager-starfish` 1.7 s into a boot, long before webosbrew's `init.d` runs, so
  a bind-mounted copy would need a surface manager restart at every boot (black screen, and `lsm-ready` restarts WebAppMgr). Not used.
- **What is used:** LG Input Hook 1.4.0, already installed and injected into `lginput2` (the remote's key path) at boot by
  `init.d/inputhook`. Its `keybinds.json` maps uinput codes to actions; `exec` runs a command on key down and swallows the key (down and
  up). Home is code 773 (`IR_KEY_HOME` = 781 in `/usr/share/X11/xkb/keycodes/lg`, minus 8). The watcher adds
  `"773":{"action":"exec","command":"/bin/sh /var/lib/homehook/home-key.sh"}` while `home-takeover` is set (checked every 5 s; Input Hook
  reloads the file within 1 s). A 773 bind that is not this exact one is never touched, and other binds are kept.
- **`/var/lib/homehook/home-key.sh`** (written by the watcher) runs `watch.sh` through the symlink `watch-key`, which only runs
  `home_key`: one `getForegroundAppInfo`, then over another app it launches Lumen bar (`home-bar` on) or Lumen; over Lumen it does
  nothing (as before: the bar was closed and Lumen left as it was). If `watch.sh` is gone, or takeover is off, it sends LG's own Home with
  networkinput, which has its own uinput device (`UInputWriter` in `network-input-service`) and so is not seen by Input Hook. That is also
  why Lumen's **LG Home** button still opens LG's bar, and from there LG's Settings and inputs, as before. The Settings and Inputs keys
  are not bound.
- **Fallbacks:** before Input Hook is injected after a boot, or if its binds stop (reported for 1.4.0 on some webOS 4 TVs), Home reaches LG
  again and the `NL_HOME_SHOWN` path above answers it as in 1.0.9007. Power on and Back out of an app still use that path.
- **Lost:** Home long press (LG's recents).
- **Checked on the C8, 24 Oct 2026 00:28 BST:** the bind was added and Input Hook logged `Keybinds reloaded` in `lginput2` and `tvservice`.
  `home-key.sh` over YouTube launched Lumen bar 0.11 s after it started, and the bar window was visible 0.38 s after it started
  (`NL_VSC ... lumen.bar visible: true`), with no `_WEBOS_WINDOW_TYPE_HOME` line at all. A press on the real remote was not made from
  here: on the TV, `/tmp/lginput-hook-lginput2.log` shows `773: execing...` and `/tmp/homehook.log` shows `Home key [...] over ...`.
- **Undo:** `touch /var/lib/homehook/no-home-key` (the watcher takes its bind out within 5 s), or turn off Home opens Lumen, or run
  `tools/tv/stop_watch.sh`, which also removes it.

## Risks

- **Speed**: `background-attachment: fixed` glass is not composited, so a glass shape that moves or scales (focus zoom, Control Center
  opening) is repainted on each frame. It is what Lumen first shipped on a webOS 22 TV (RESEARCH.md section 4), but the C8's alpha9 GPU and
  Chromium 53 are older. If it stutters: Settings > Appearance > Reduce motion.
- **Memory**: the blurred copies are small (960x540 and 480x270), and the static fonts load only on webOS 4, one cut per weight in use
  (about 33 KB each). Chromium 53 on a 2018 TV has less room for decoded images, so cloud and Immich wallpapers may load more slowly.
- The core-js scan works on the minified bundle by property name, so a polyfill could in theory be missed; the app has no other
  dependencies beyond Preact.

## Publishing

Each build publishes two packages to the same Homebrew Channel index: `com.ovsteenb.lumen` and `com.ovsteenb.lumen.bar` (`tools/build_bar.sh`, same
version). `tools/gen_hbc_repo.py` takes several .ipk files and reads each one's id, version and icon from the .ipk itself.


`.github/workflows/release.yml` builds the public `.ipk` and updates the Channel index on the `hbc-repo` branch, which GitHub Pages serves.
A push to `main` (or any branch) adds a dev build (`1.0.9xxx`) to the rolling `dev` release, which keeps the last five; Actions > release >
Run workflow does the same by hand. A `v*` tag makes a stable release and `stable/apps.json`.
