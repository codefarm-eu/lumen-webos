# Lumen on webOS 4 (LG OLED55C8PLA, Chromium 53)

This fork ([codefarm-eu/lumen-webos](https://github.com/codefarm-eu/lumen-webos)) makes Lumen run on a 2018 LG C8: webOS 4.x, whose web engine
is Chromium 53, rooted with the Homebrew Channel. Upstream ([samrenfrew/lumen-webos](https://github.com/samrenfrew/lumen-webos)) targets
webOS 6 (Chrome 79) and is tested on webOS 25 (Chromium 120). Every change below is a feature test, never a version or user-agent test, so the
same build still gets the upstream look on a newer TV.

## Install

Add this repository URL in the Homebrew Channel's settings, then install **Lumen** from its list:

    https://codefarm-eu.github.io/lumen-webos/dev/apps.json

The same index is also at `https://raw.githubusercontent.com/codefarm-eu/lumen-webos/hbc-repo/dev/apps.json`. A `v*` tag publishes
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
Seen on the C8 (28 Oct 2026): **a webOS 4 web app may not load another app's files as `file://`.** From Lumen, an `<img>` of Lumen bar's
`icon.png` and an XHR of its `appinfo.json` both failed, while Lumen's own files loaded; from Lumen bar, every one of Lumen's
`wallpapers/default-N.jpg` failed. The root read covers the icons. Lumen bar's screensaver gets a root copy of the pictures in its own data folder (below).

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

The running watcher also refreshes itself after a Homebrew Channel update of Lumen, without Lumen being opened. About every 30 s it
compares the `homehook/` pair in the folder of the Lumen build Home opens with the installed copies. A pair that differs and reads the same
on two checks in a row (the install has finished) is copied into root's own temporary files, at most 256 KB, and only if the packaged file
is still that same plain file afterwards (a symlink, or a file swapped mid-read, is not installed). The copies are checked there (they must
parse in `sh` and look like the watcher and its hook), moved into place, and the watcher re-execs itself. The re-exec keeps the watcher's
pid, so its lock stays its own and the boot hook still sees the same command line. It is not a boot: no wake window and no hidden preload,
including in the first 5 minutes. `home_reader` is stopped first, because it is a fork of the same script and would otherwise handle Home
a second time. A refresh runs at most once a minute and 5 times a boot. The count is a plain file in the watcher's own `/tmp/homehook.run` (root's,
mode 700). Each refresh is logged in `/tmp/homehook.run/homehook.log`. The app folder is world-writable and owned by the
developer user on the C8, so the packaged files can't be checked for root ownership. Only the installed copies are checked that way. A boot
hook that was removed by hand stays removed.

What the refresh checks, and what it can't (trade-off, 28 Oct 2026 review):
- Only a `com.ovsteenb.lumen` or `com.ovsteenb.lumen.dev` build is a source; an upstream Lumen id is never one.
- The build writes `homehook/SHA256SUMS` (`app/vite.config.ts`) next to the pair. The watcher refreshes only when both copies match it, and
  Settings > Home opens Lumen does the same check (`lib/root.ts` `setHomeTakeover`). A half-written install, or one file changed on its own,
  is refused. Each file's hash is worked out and compared on its own, with `sha256sum`, or `openssl dgst -sha256` where there is none
  (never `sha256sum -c`, which a busybox build may leave out). On a TV with neither tool the watcher does not refresh itself at all. Opening
  Lumen still installs it, because that install starts from the same folder it would check, and checking a folder against itself proves
  nothing.
- This is an integrity check, not authentication: `SHA256SUMS` sits in the same developer-writable folder. Real authentication would need a
  signature made by the release workflow (a signing key held as a GitHub secret) and checked on the TV with a public key built into the
  installed watcher, and an `openssl` that can verify it on webOS 4. That was left out: it can't be tested without the TV, and a check that
  fails there stops every refresh. It would also not close the hole on its own, because anything that can write Lumen's folder can change
  Lumen's own code, which runs root commands through the Homebrew Channel whenever Lumen is opened.
- The watcher's own state and its log are in `/tmp/homehook.run` (made by root, mode 700, re-made if anything else is at that name; a
  folder someone else made there is moved aside whole, never removed with `rm -r`), so a
  link someone puts in `/tmp` can't make the root watcher write through it. The flags Lumen and Lumen bar write in `/tmp`
  (`lumen-ambient-on`, `allow_lg_home`) are written by rename (`mktemp` and `mv`), and Lumen bar's log is `/tmp/homehook.run/lumen-bar.log`, inside the watcher's root-only folder.

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

Each step is logged to `/tmp/homehook.run/homehook.log` (`LG Home shown (over <id>)`, `LG Home -> <id>`, `LG Home bar closed with Back (...)`).

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
  (the glass bar's apps), Lumen's recent list, every app's title and colour, and Lumen's id. The bar copies the same picture the tile shows:
  a bundled icon or an icon-pack file when that is what Lumen draws, and the TV's file only when the tile's picture is a `data:` URI, a
  `file://` URL, or there is no picture. On this C8, 1.0.9044 (`ce2d8a2`, `data/sig` `l9d5e4`) wrote icons for four apps only. The files in
  `data/icons/` are Lumen's catalogue PNGs: YouTube 4689 bytes, Prime Video 6488, the Browser 2539, Homebrew 5246. The dock also has Moonfin,
  Amazon Music, BBC iPlayer and Netflix, and `listLaunchPoints` has a safe file for each (`org.moonfin.webos/icon-130.png`, Amazon Music
  `largeIcon.png`, `bbc.iplayer.3.0/bbc_130x130.png`, Netflix `LARGE_APP_ICON.png`). That signature is the hash of the dock, the recent list,
  the style and an app list whose `file` is set only for those four catalogue icons
  (`/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen/icons/apps/…`). Recomputing that hash with each app's `largeIcon` does not
  give `l9d5e4`. The 9044 write ran with no TV path for any app whose tile is a `data:` picture. The icon cache in the log is already full
  (328–333KB, and `icons-file` is not run for them), the colours in `bar.json` are sampled `rgb()`, and a direct `listApps` of those points does
  return each `largeIcon`. What put an empty path
  list into that write was not in `lumen.log` (there is no boot line for it; Lumen was closed before the 20s flush). Two states of `main`'s
  `iconFile` both hash to `l9d5e4`, and neither was seen: a saved list that still holds the raw `data:` pictures (`iconPaths` empty, and
  `sameApps` does not count a path, so the effect keeps the list it froze at the start), or a saved list of `@icon:` refs whose icon cache is
  missing (`cachedApps` then has no picture, and `iconFile` returns before it looks at the stored path). Boots on 23–26 Oct do log `iconcache`
  before `listLaunchPoints`, which happens only when the saved list contains `@icon:` and the cache is read. TV Settings is separate: it is not
  a launch point, and on 9044 `addSystemApps` never stored a path.
  `tools/tv-bar-diag.sh` prints the TV's launch points, `bar.json` and the bar lines in `lumen.log`. Run it as root the way the script's header
  says (`ssh -tt` with the script decoded on the TV; `sh -s` over the pty hangs, and `timeout 90` is not this busybox). A copied file has to be
  a PNG, JPEG or WebP of at most 1 MiB, and still under the app folders after `readlink -f`. `bar.json` names an
  icon when that copy is a plain file. A failed re-copy leaves the previous good file in place and keeps naming it; with no previous file the
  field is `null`. A missing file, and a copy that failed while writing, are not signed, so the next start tries them again. A path that
  resolves outside the app folders, a file that is too big, or a file that is not a real image is signed as the signature plus `-p`, so the
  same list then answers `same` and is not logged again, and a changed list still rewrites. An icon that is not a PNG, JPEG or WebP is not
  sent to the copy. The signature includes
  `BAR_EPOCH`, so an update rewrites a bar left by 1.0.9044. It is
  written again only when a signature in `data/sig` changes, so an update of Lumen bar,
  which empties its folder, is refilled at Lumen's next start. The bar's folder is writable by others, so this write does not use a full
  path (a redirect or a recursive remove would follow a link). It enters the bar folder and then `data/` with `cd -P`, and each must be
  that directory (`pwd -P`). A `data/` or `data/icons/` that is not root's own is left as it is and nothing is written (`lumen.log`: `bar
  data/ not written: refused`, as the bar then shows no icons or titles). A link at `data`,
  `data/icons`, `bar.json` or `sig` is removed or replaced, not written through, and `bar.json` and `sig` are written to a temp file there
  and moved into place. `data/wallpapers/` is not touched. Lumen bar also reads `/var/lib/homehook/recent` and shows up to 4 recent
  apps that are not in the dock, after a divider.
- **Screensaver** (`{"saver":true}`, the TV's screensaver over another app): Lumen's bundled pictures and a clock, opaque, over the app.
  The pictures ship only in Lumen. The bar can't load Lumen's folder (in 1.0.9036 it tried, and was black with only the clock: "saver:
  open, 0 pictures", 28 Oct 2026), so the watcher copies Lumen's `wallpapers/default-N.jpg` as root into the bar's own
  `data/wallpapers/`, with a `list` of their names (`watch.sh bar_pictures`). This happens when the watcher starts and again just before each
  overlay screensaver opens. Only plain files are copied, a changed picture is copied again, and a dropped one is removed. The bar's
  folder is writable by others, so the copy works inside `data/wallpapers/` by relative names: each folder is entered with `cd -P` and must
  then be where it should be (`pwd -P`), `wallpapers/` must be root's own (one that isn't is left alone and nothing is copied), and a picture is copied with `cp -RP` to `.new` and kept only as a
  plain file. A link put at `data`, `data/wallpapers` or a picture mid-run can't send root's copy, `chmod` or removal anywhere else.
  `syncBar` leaves `data/wallpapers/` alone. The bar reads the `list`. Without it, the bar tries each `default-N.jpg` and stops after two
  misses in a row. A bar with no copy yet (installed, but no screensaver since the watcher started) shows black with the clock and logs
  "saver: open, no pictures yet". The bar package went from about 2.5 MB to about 70 KB. Over another app this screensaver always shows
  Lumen's pictures, even with Use my photos on; the Settings text says so. Immich in the overlay would need the bar to list and fetch
  album assets itself, which can't be checked without the TV and the server. The picture time and brightness come from
  `/var/lib/homehook/lumen-config.json`, read as root when the plain read is refused.
- **Look:** tinted glass. A dark translucent fill with a light rim and a shadow, and no blur: an overlay cannot see the video, so the
  blurred-wallpaper glass cannot be used.
- **No preload:** the bar is about 10 KB with no framework. It is drawn about 0.4 s after the launch from cold, so it is not preloaded.

Checked on the C8 (webOS 4.4.3), 24 Oct 2026, 00:07-00:12 BST, with a dev build of Lumen bar and data written as Lumen would. The keys were
sent through networkinput:
- **Over YouTube:** LG's bar came up, Back closed it 0.46 s later, and Lumen bar was visible 0.93 s after the Home press. The app list
  stayed `youtube.leanback.v4` (card) + `com.ovsteenb.lumen.bar` (overlay). Back reached the bar and closed it, and YouTube was alone in front again.
  The dock showed the real icons (YouTube, Moonfin, Prime Video, Amazon Music, ..., Netflix), plus Live TV as recent.
- **Over Moonfin:** the same, and Back closed it.
- **Over Netflix:** the same. After Back, a Down key changed Netflix's screen, so the remote works in the app again. OK on the YouTube tile
  opened YouTube and closed the bar.
- **com.sammysco.avoverlay:** its watcher launches it after each app (card) launch. It did not launch after Lumen bar (an overlay), and it
  did not take the bar's keys. When Lumen bar opens YouTube, avoverlay comes up as usual for that launch.

- **Recent tiles need an icon (1.0.9013):** a recent app with no icon file in `data/icons/` (TV Settings, `com.palm.app.settings`, and other
  system apps Lumen draws with its own glyph) is left out, as in the first hand-installed test build, where the bar showed the dock plus
  Live TV only. A missing file, and a copy that fails while writing, are tried again next start. A path outside the app folders, a file that is
  too big, or a file that is not a real image stays off the recent row, and that result is signed so it is not retried on every start. A failed re-copy of an icon that was already there keeps the
  previous file, so the recent app stays. 1.0.9007-1.0.9012 drew TV Settings as a grey "T" tile. The bar's code and CSS were otherwise byte-identical between the
  hand build and the published ones (only the version differs); the change came from Lumen's own data, refilled at its next start.
  Test: `tools/test/bar.test.mjs` (bar.js in a vm with a fake DOM and Luna bridge).
- **Looks like Lumen's home bar (1.0.9014):** `bar/bar.css` uses the home bar's own values (`app/src/theme/global.css`,
  `.rows > .row:first-child` and the glass `::before`): tiles 206x124 with radius 34 and 38px apart (for 7 a row), 40px of glass round them
  with radius 74 at 0.74, the tinted fallback glass (an overlay can't blur the video), the bright rim line, the tile light and shadows, the
  focused tile grown with `translateY(-7.5px)`, its shine, and its name under it in the glass (19px, 600). The glass bottom is 70px above
  the screen's bottom, so it sits where Lumen's does (y 806 to 1010). Lumen writes its first row's `style` (tile size, height, gap, tiles per row,
  focus scale for subtle/normal/strong) into `data/bar.json`, so the bar follows Settings; without it the bar uses the 7-a-row values. Past
  that many tiles the row scrolls to keep the focused one in view. Fonts are Lumen's own (`../com.ovsteenb.lumen/fonts/sf.woff2`, then Geist).
  Checked headless against the TV's data: glass at x 85 to 1835, y 806 to 1010, the same box as Lumen's home bar.
- **Magic Remote pointer (1.0.9015):** 1.0.9014 and earlier only listened for keys, so pointing and clicking did nothing. Now pointing
  at a tile (`mousemove`/`mouseover`, the target can be the tile's img) focuses it and names it, without scrolling the row under the pointer.
  A click opens the tile, and the house opens full Lumen. The wheel moves along the bar. A click on the glass between tiles does nothing,
  and a click off the glass closes the bar, so the app underneath gets the remote back. Each pointer move restarts the 10 s auto close.
  `cursorStateChange` tracks whether the pointer is showing, and an arrow key counts as 5-way mode again. With the pointer showing, OK may arrive as
  a click, as keydown 13, or as both: the first one opens the tile and closes the bar (`closing`), so the other is ignored. A keydown 13
  with the pointer on no tile does nothing, because its click decides. There is no appinfo setting for the pointer (`supportTouchMode` is only for
  StanbyME touch screens). Whether webOS 4 sends pointer events to an `overlay` window could not be checked remotely: the bar writes the
  first `mousemove`, `mouseover`, `click` and `wheel` it gets, the cursor shown/hidden changes and `webOSMouse` to `/tmp/homehook.run/lumen-bar.log`
  as `pointer: ...`. Lumen's home screen already handled the pointer (Tile `onMouseEnter`/`onClick`). It could act twice on one OK (the
  click and the Enter key-up; on a folder, the second one opened the folder's first app), so `lib/okClick.ts` now lets only the first of
  the two act within 400 ms. Tests: `tools/test/bar.test.mjs` (pointer cases) and `tools/test/okclick.test.mjs`.
- **Screenshots from the TV:** `luna://com.webos.service.tv.capture/executeOneShot {"path":"/tmp/x.jpg","method":"DISPLAY","format":"JPEG",
  "width":1920,"height":1080}` writes video plus graphics (YouTube was not blank); `"method":"GRAPHIC"` gives the overlays only, on black.
  `com.webos.service.capture` does not exist on webOS 4.

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
  `home_key`: one `getForegroundAppInfo`, then with `home-bar` on it launches Lumen bar with `{"home":true}`, over any app and over
  Lumen itself; without the bar it launches Lumen over another app and does nothing over Lumen. Lumen bar is an overlay, never the app in
  front, so `home_key` reads the surface manager's newest `NL_VSC` line for the bar in `/var/log/messages` (stamped with the uptime). If it
  says visible, Home closes the bar with `closeByAppId` (no relaunch), except within 0.3 s of its window coming up, about 0.8 s after the first press (double press). If the line is
  missing (log rotated) or the close fails, the bar is launched with `{"home":true}` and `bar.js` closes it on that relaunch. Checked on
  the C8, 24 Oct 2026: the relaunch path alone failed, because webOS 4 delivered each relaunch to the bar twice (closed, then opened again:
  the bar twitched and stayed up); `bar.js` now drops a relaunch within 250 ms of the previous one. After a Home close, `on_home_shown`
  does not bring the bar back for 2 s (`/tmp/lumen-bar-closed-at`, uptime in centiseconds, digits checked). If `watch.sh` is gone, or takeover is off, it sends LG's own Home with
  networkinput, which has its own uinput device (`UInputWriter` in `network-input-service`) and so is not seen by Input Hook. That is also
  why Lumen's **LG Home** button still opens LG's bar, and from there LG's Settings and inputs, as before. The Settings and Inputs keys
  are not bound.
- **Fallbacks:** before Input Hook is injected after a boot, or if its binds stop (reported for 1.4.0 on some webOS 4 TVs), Home reaches LG
  again and the `NL_HOME_SHOWN` path above answers it as in 1.0.9007. Power on and Back out of an app still use that path.
- **lginput2 restarts drop the hook (seen on the C8, 24 Oct 2026):** `lginput2` restarted at 17:25 BST, 41 min after a boot. Input Hook
  injects only once per boot (its service marks it done in `/tmp/inputhook`), so the new process had no hook: every Home press opened LG's
  bar first and the `NL_HOME_SHOWN` path then put Lumen bar over it. The watcher now checks every 5 s that `lginput2` has Input Hook's
  `libphp.so` mapped and, if the same unhooked pid is seen twice in a row, runs the service's own `ezinject` command for `lginput2` only
  (at most once a minute and 5 times a boot, counted in `/tmp/homehook.run/homehook-reinject`), logging `Input Hook re-injected into lginput2`. LG's bar
  shown with our bind in place but no Home key in the 3 s before is logged as `warning: LG Home shown with no Home key ...` with the hook
  state (Back out of an app, long press and power on log it too, with `hooked: yes`).
  Hardened after review: lginput2 must be a root process (found without a fork per process), nothing runs while lginput2 is being traced
  (an injection under way), Input Hook 1.5.0's `libinputhookpp.so` is detected and injected with the service's own command, nothing runs if
  Input Hook's files are missing or are not root's own plain files, `ezinject` gets `chmod go-w` (the service makes it 777) and runs in the
  background (never killed, waited for 10 s at most), and `/tmp/homehook.run/homehook.log` is cut to its last 2000 lines past 512 KB.
- **Lost:** Home long press (LG's recents).
- **Checked on the C8, 24 Oct 2026 00:28 BST:** the bind was added and Input Hook logged `Keybinds reloaded` in `lginput2` and `tvservice`.
  `home-key.sh` over YouTube launched Lumen bar 0.11 s after it started, and the bar window was visible 0.38 s after it started
  (`NL_VSC ... lumen.bar visible: true`), with no `_WEBOS_WINDOW_TYPE_HOME` line at all. A press on the real remote was not made from
  here: on the TV, `/tmp/lginput-hook-lginput2.log` shows `773: execing...` and `/tmp/homehook.run/homehook.log` shows `Home key [...] over ...`.
- **Undo:** `touch /var/lib/homehook/no-home-key` (the watcher takes its bind out within 5 s), or turn off Home opens Lumen, or run
  `tools/tv/stop_watch.sh`, which also removes it.

## Control Center: Sound and Picture

The choices come from the TV. At the first Control Center opening in a session, `getSystemSettingDesc` (as root) is read for `pictureMode`
and `soundMode`, and `getSystemSettings` for `pictureMode`, `soundMode` and `soundOutput` each time. Read from the C8 on 23 Oct 2026:

| | C8 reply | What Lumen offers |
|---|---|---|
| `pictureMode` | current `hdrEffect` (dimension `dynamicRange: sdr`). 28 values, all `active`. `visible` only for vivid, normal, eco, cinema, sports, game, hdrEffect, technicolor, expert1, expert2. `photo` and every hdr*/dolbyHdr*/technicolorHdr* mode are `visible: false` | SDR: exactly those 10 visible ones (no FILMMAKER, which the C8 does not have) |
| HDR, Dolby Vision | the desc is not per signal: the HDR and Dolby Vision modes stay `visible: false` while such a picture plays | the menu of the current mode's group: HDR (Vivid, Standard, Cinema Home, Cinema, Game, Technicolor Expert), Dolby Vision (Vivid, Standard, Cinema Home, Cinema, Game), Technicolor HDR, filtered on `active`. They only appear while such content plays |
| `soundMode` | current `movie`. Values standard, movie, news, sports, music, game (pagode, sertaWego, brazilianPunk inactive). `ui.active: false` | |
| `soundOutput` | `external_arc` (Denon over HDMI ARC) | |

The sound modes only apply to the TV's own speakers, and the C8 greys them out (`ui.active: false`) for HDMI ARC. So with the Denon,
Sound shows "HDMI ARC" and opening it says "Sound modes are off: the sound goes to HDMI ARC. Set the sound mode on that device." With
the speakers it offers the 6 modes. A mode the TV refuses (`returnValue: false`) is put back on screen, dropped from the list and
remembered (`lumen-refused-modes-v1`). Lumen never sets sound output.

Tested in Chromium 53 and current Chrome with a fake Luna that replays the C8's own desc replies. Scenario A (HDMI ARC, Cinema): the
message shows and the 10 SDR modes appear. A refused mode is put back and gone at the next opening. Scenario B (Dolby Vision Cinema, TV
speaker): 5 Dolby Vision modes and 6 sound modes.

## How it was tested (off the TV)

- `npm --prefix app run build` (type check and build) and `python3 tools/build_release.py` (the `.ipk`) run clean.
- The bundle parses as ES2016 (acorn, `es-check es2016`). The CSS after PostCSS was checked with doiuse for `chrome 53`: what remains is
  the grid (fallback in place), prefixed masks, and `backdrop-filter`/`clamp()` inside the live-blur rules only.
- A real Chromium 53.0.2785.0 Linux build (Chromium snapshot 403380, the M53 branch point) under Xvfb loaded `app/dist` over HTTP and the
  packaged app from `file://`, at 1920x1080 with a webOS user agent, driven over DevTools: home, glass bar, lower rows, Control Center and
  its Sound list, Inputs, Settings and the Apps grid all draw with no script errors, side by side with current Chrome. The upstream build
  (target chrome79) shows only a black screen there (`SyntaxError: Unexpected token {`), and a plain `chrome53` retarget without the
  polyfills fails at start-up too (`TypeError: ... is not a function`).

Not tested: the TV itself (its GPU, memory, Luna services and the Homebrew Channel install), Live TV, Immich, the screensaver and video
wallpapers.

## Screensaver without Immich (1.0.9009)

Screensaver in Control Center used to say "Set up Immich first" when no Immich server was set up. Now Lumen's screensaver
(`components/Ambient.tsx`) has two sources (`lib/screensaver.ts`): your Immich photos only when Settings > Screensaver > **Use my photos**
is on *and* an Immich server is set up; otherwise a slow crossfade of Lumen's bundled pictures (`LOCAL_WALLPAPERS`, `public/wallpapers/
default-N.jpg`, or your own from `app/private/`), random order, never the same one twice running, with the clock and weather. They are in the
app, so no network is used. Upstream (samrenfrew/lumen-webos) has only Immich or LG's screensaver here.
- **Control Center > Screensaver:** always Lumen's screensaver (Immich or the bundled pictures). Never the Immich prompt.
- **Use my photos / Use Lumen's screensaver** (the label depends on whether Immich is set up): on, the TV's screensaver and the home-screen
  idle timer open Lumen's screensaver with the same rule; off, they open LG's, as before.
- **Time on each photo, Brightness, Print look** now show without Immich too, since they apply to the bundled pictures.
- Test: `npm test` (`tools/test/screensaver.test.mjs`, also run by the release workflow).

## Screensaver burn-in protection

Settings > Screensaver > **Move clock to prevent burn-in**, on by default (`ambientMove`). The screensaver's clock and its date/weather block
are the only things that stay still (the pictures crossfade and zoom), so on an OLED they would mark the panel over the hours. Every 60 s
both fade out (1.5 s), move to a new random place and fade back in (`lib/burnin.ts`, used by `components/Ambient.tsx`, Immich and
built-in pictures alike):
- The clock stays in the left half and the date/weather in the right half of the safe area (5 % of the width and 6 % of the height kept
  clear at 1920x1080, a 2 % gap in the middle), so they never overlap or leave the screen. A new place is at least a third of the free
  range away from the last one. Offsets are whole pixels, so the text stays sharp.
- Only `opacity` and `transform` change (one transition per block per minute), which Chromium 53 composites without repainting the photos.
- While it is on, the shade under the text covers the whole picture (darker at the bottom), so the clock is readable at the top too. The
  Print look and Brightness layers sit under the text as before.
- Off, the clock sits bottom left and the date/weather bottom right, as before.
- Test: `tools/test/burnin.test.mjs`. Checked in headless Chrome at 1920x1080: after the first minute the clock moved from (119, 894) to
  (152, 334) and the weather from (1509, 917) to (1397, 468), both inside their halves, and the built-in pictures kept changing.

## Wallpaper dimming (port of upstream e296505)

Settings > Wallpaper > **Dim the wallpaper**: Off, At night (19:00 to 06:00) or Always. The older on/off setting `nightDim` becomes At night
(`lib/dim.ts`, `wallpaperDimFrom`). With the dock hiding on, Settings > Home Screen > **Dim when the dock is hidden** fades a black layer
(opacity only) over the wallpaper while the dock is away. Unlike upstream, the screensaver's own night layer (`.ambient__night`) follows
the hours only (`html.night-hours`), also with Always, so that a screensaver lowered by Settings > Screensaver > Brightness is not darker
all day as well. Settings' unpicked wallpaper tiles are grey instead of faded, with their names in full white, and the Re-order button is a glass pill.
Test: `tools/test/dim.test.mjs`.

## Home edit mode and more (port of upstream bb94320)

- **Edit mode:** hold OK on an app and it lifts and wobbles. Left and Right move it one place, Up and Down a row, and OK puts it down.
  Hold OK again while it is lifted for a menu: Uninstall App (only apps the TV lets go; it asks for a second OK), Remove from Home Screen,
  and Add to Folder. `uninstallApp` in `lib/root.ts` tries the developer-mode remover, then the store's. It checks `getAppInfo` before and after.
  Here it matches `"returnValue": *true`, since luna-send prints the space on some firmware. Never offered: `KEEP_INSTALLED`, which here
  covers every `com.ovsteenb.lumen*` build (Lumen bar and the dev copy included), the upstream Lumen ids, LG's system apps and the Homebrew Channel.
- **Number keys:** 1 to 6 open the glass bar's apps at those places, on the home screen and (added here) in Lumen bar, where the Home tile and
  recent apps are not counted.
- **Resting pointer:** a mouse-over that comes only because the rows slid under a pointer that did not move no longer takes the focus.
  It works with this fork's one-OK guard (`lib/okClick.ts`), which is unchanged.
- **Screensaver started by the TV:** Lumen's first frame is the screensaver (`view: ambient` and Use Lumen's screensaver on), on the last
  picture it showed. That picture is only reused by its own source: a bundled picture for the built-in slideshow, an Immich UUID for Immich
  (`lastPictureFits`). Any key fades it out while the clock slides back to the home screen's clock. The slide starts from where burn-in
  protection last moved the clock.
- **Wallpaper with nothing picked** shows the default picture.
- **Settings lists:** the end of a long list shows its last row whole. Settings > Apps keeps this fork's grid, which already shows whole rows
  only (see "Settings > Apps grid"), so upstream's `Grid.tsx` change was not taken.

## Lumen on any wake (port of upstream 3f26515)

Wake-on-LAN resumes the TV into Live TV and skips LG's home, so "replace LG's home during a wake" did nothing for it. Now, from the moment
the watcher sees a wake (the power state back to Active, or a gap in its ticks) and for the first 90 s after a boot, it opens Lumen over
whatever is in front (`wake_open`, in the background so a slow launch right after a wake does not stall the loop). It ticks every 0.5 s
(`usleep`, because webOS 4's busybox `sleep` takes whole seconds) and opens Lumen again each tick until Lumen has stayed in front for 3 s
(`WAKE_SETTLE`). Then the wake ends, and `WAKEFILE` is set to 0 so the `NL_HOME_SHOWN` path and Home shows the bar end their wake handling as well.
That makes the old "about 90 s after a boot, Home opens full Lumen" window much shorter. The boot window only applies when the TV booted in the last
5 minutes (`/proc/uptime`): a watcher restarted later (Lumen refreshing it, or by hand) no longer opens Lumen over the app in front.
Added in this fork: an app other than LG's home or Live TV that comes up straight after Lumen was in front was opened from Lumen, so the
wake ends there and that app is not covered by Lumen again. The LG Home branch no longer takes over during a wake on its own, because
`wake_tick` does that. Undo: `touch /var/lib/homehook/no-wake-launch` (as before), or `stop_watch.sh`. The Home key bind and Home shows the
bar are unchanged. Test: `tools/test/watch.test.mjs` sources `watch.sh` with `WATCH_SH_LIB=1` and runs `wake_tick` with a stub launcher.

## Restart (port of upstream ad6eac5)

Control Center > Restart now runs the shell's `reboot` as root, detached (`(sleep 1; reboot) >/dev/null 2>&1 &`), so the Homebrew Channel's
exec call returns before the TV goes down. Upstream found on webOS 25 that every `tvpower/power/reboot` reason comes back in Active Standby
(screen off), while the shell's `reboot` comes back on. **C8, 24 Oct 2026:** the same detached `reboot` (run over ssh, because the Channel's
exec was hung that day) came back **on**: first the last input (HDMI 2), then the watcher's wake rule opened Lumen within seconds.

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
A push to `main` (pull requests are checked by `ci.yml` and publish nothing) adds a dev build (`1.0.9xxx`) to the rolling `dev` release, which keeps the last five; Actions > release >
Run workflow does the same by hand. A `v*` tag makes a stable release and `stable/apps.json`.

## Review follow-ups, part 2

- **Leaving the screensaver over an app** (`lib/screensaver.ts leaveAmbientFlow`): Lumen reads the running list first and brings the app
  forward straight from the screensaver. Lumen's home is shown only after the launch settles, or when there is nothing to return to, or after
  1.5 s without an answer. Before, Lumen's home flashed in between.
- **Video wallpaper:** it stands in for a screensaver only up to a long cap (`idleDelay`), which is 3x the idle time, or 30 minutes when the
  idle screensaver is off. Then Lumen's own screensaver opens, so tiles over a looping clip don't stay up for hours.
- **Icon cache:** only the icons of the apps installed now are kept (`checks.ts keepOnly`).
- **One copy of shared shell:** `stop_watch.sh` sources the installed watcher for `homekey_unbind`. `root.ts` builds both of its watcher
  scans with `forEachWatcher`. `60-homehook` keeps its own short `/proc` loop: it runs at boot, before anything else, and sharing a sourced file
  with it is a boot-path change that can't be checked without the TV.
- **Immich key in preview URLs: kept on purpose.** Moving previews to the `x-api-key` header means a root `curl` and a base64 reply through
  Luna for every 1080p photo, which is a heavy load on the C8 that can't be measured without it. The server is now checked
  (`immichServer`) before a URL is built, so the key only goes to the server you configured.

## Review follow-ups, part 3 (after #27)

- **Wake gap:** measured from the top of one loop to the next, minus the loop's own long waits (`owned`: the Input Hook check, the
  self-refresh, the bar's picture copy). A re-injection wait is not a wake, while a suspend anywhere else in the loop still is (`wake_gap`).
  Changed again after review, see part 4: slow Luna answers counted as a wake that way.
- **Screensaver backlight:** saved as `<backlight> <picture mode>` and put back only into that mode (bar.js, the watcher, and Lumen's own
  `backlightSaver`). If an HDR film started meanwhile, its backlight is not touched, and the restore waits until the mode is back. A mode
  that can't be read doesn't hold it up. The saved value is removed only once the settings service answers `returnValue: true`. After a
  failure, the watcher's periodic retry backs off (5 s, doubling, up to 5 minutes) and logs once.
- **Lumen bar's root queue:** a lowering that is only slow (past the 3 s call timeout) no longer lets the restore run beside it. The queue
  waits up to 30 s for the real answer.
- **Leftover flags:** `saver_leftover` also removes a leftover flag of Lumen's own, by `ambient_stale`'s rule: no Lumen in front, on a real
  foreground answer, and the bar closed.
- **Environment:** every path the watcher can be pointed elsewhere by is read from a `HOMEHOOK_` name only (`HOMEHOOK_RUN`,
  `HOMEHOOK_LOG`, `HOMEHOOK_SELF`...). A generic `LOG` or `SELF` in the environment the watcher inherits can never move where root writes.
- **Icon paths as root:** `readlink -f`, or `cd -P` + `pwd -P` (the file itself not a link) where busybox was built without it.
- **Icon cache:** pruned once per listing, against the icon paths of both lists (the TV's launch points and the system apps). Pruning in
  each list dropped the other's icons, so every start read them all again as root. A listing that looked nothing up prunes nothing.
- **Lumen bar's log** moved to `/tmp/homehook.run/lumen-bar.log` and is written only when that folder is root's own. At `/tmp/lumen-bar.log`
  a link could be put back between the bar's "remove a link" step and its root append. Its size is read with `stat`.
- **Kept as is:** the log trims (Lumen bar's log, `homehook.log`, Lumen's `lumen.log`) can race a second writer between reading the size and
  the rename. The worst case is a few lines lost or the file briefly over its cap. Each log is in a folder only root writes, and nothing acts
  on its contents. The video wallpaper cap (3x the idle time, or 30 minutes with the idle screensaver off) is intentional.

## Review follow-ups, part 4 (after #28)

- **Wake gap:** the sleep counts in full. A slow Luna call does not: `/proc/stat`'s CPU ticks (`mono_s`) advance while the process runs and
  stop across suspend, so a minute's suspend inside a call (an app launching, the bar's screensaver launch) is a wake, and the same minute of
  the call merely being slow is not. The tick clock is used once a pass has shown it moving with the wall clock, and also on a pass whose ticks
  did move but far less than the wall clock. The pass's own work also counts on its own past `WAKE_WORK_MAX` (120 s), with or without the tick
  clock: no awake pass takes that long (each Luna call is cut off at 10 s), so past it this process was held while the kernel ran. That is what
  a standby that freezes processes without suspending the kernel looks like (the ticks keep going), and it is the only rule besides the sleep
  that sees such a standby; below 120 s during the work it is missed, as is a suspend during the work when `/proc/stat` can't be read. The
  power state does not cover that miss. It fires only when a sample actually saw a state other than Active and other than Screen Saver, and
  the next sample is Active. A freeze never takes that sample, and coming back from the screensaver (Screen Saver, then Active) is not a wake.
  The ticks are the first core's (`cpu0`, or the one `cpu` line of a kernel without per-core lines), not the average over the cores listed: a
  core the kernel switches off or on between two passes would move that average on its own. Each count is split as text into seconds and
  hundredths before anything is added, because a busybox built with 32-bit shell arithmetic (`strtoul`, so a count past 2^32 reads as -1)
  holds a core's idle ticks for 248 days only, and the old four-core sum for 62. The wake line in `homehook.log` shows the pass's wall and
  tick seconds (`wake (gap 61s, power Active > Active, wall 62s, ticks 1)`), so the log tells which clock saw the wake. **(verify)** on the C8 that
  those ticks pause while the TV is off: power off for a minute during a slow launch, and Lumen still opens, with `ticks` far below `wall`
  in that line. `ticks` keeping up with `wall` after a minute off means the ticks do not pause on this TV, and only the sleep and the 120 s
  rule see a wake there.
- **Screensaver backlight across picture modes:** a lowering that finds a value still saved for another mode (or can't read the mode) leaves
  the panel as it is (bar.js and Lumen's `backlightSaver`). Before, the TV switched off under an HDR film's screensaver left "100 hdrCinema"
  waiting, the next screensaver over a cinema film lowered cinema without saving it, and its restore then waited for hdrCinema: cinema
  stayed dim. The same mode as the saved value, or an older build's plain number, is lowered as before. A saved file that can't be read, or
  whose new value can't be written, is not lowered either. A lowering the settings service refused no longer answers "dimmed" (it did, and
  then neither the panel nor the pictures were dark): the bar darkens the pictures, and the value saved first stays for the restore. Lumen
  asks again whether the screensaver is still up after the picture mode comes back, and does not save a value when it has already ended.
- **Watcher restore:** `c` and the mode are emptied before the saved file is read. A file removed between the check and the read (the bar put
  the backlight back meanwhile) left `c` as another function had set it (`inputhook_check` sets 1 or 2), and that was sent as the backlight.
- **No `rm -r` on folders other users own:** busybox `rm -r` walks a folder by name, so a link put inside one while root removes it has root
  delete files elsewhere. `bar_pictures` leaves a `data/wallpapers/` that is not root's own as it is and copies nothing (logged). In `/tmp`,
  a folder someone else made at `/tmp/homehook.run` or at the watcher's lock is moved aside whole into a fresh root folder next to it
  (`run_aside`), and a lock that is not root's own is never read, so its pid can't keep the watcher out. The lock is created mode 700. A dead
  lock (the watcher was killed) is moved aside the same way, not removed: an older build's lock was mode 755, so another user could already
  have put a link inside it.
- **Not changed here:** `root.ts syncBar` still writes `data/icons`, `data/bar.json` and `data/sig` in the bar's folder by full paths, as
  `bar_pictures` did before #27, and reads `data/sig` with `cat`. It is Lumen's root command, not the watcher's, and is left for its own change.
