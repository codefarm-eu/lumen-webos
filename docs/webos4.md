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
| LG Input Hook | — | **uncertain on webOS 4**: its issue tracker has reports of key binds stopping after minutes (v1.4.0, webOS 4.x) and of v1.5.0 freezing `tvservice` on webOS 4.10 and losing the picture after standby on webOS 4.5. Not needed by Lumen. |

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

Lumen's own LG Home button still opens LG's home (`/tmp/allow_lg_home`).

Not covered:
- LG's home shows for up to about a second before Lumen replaces it, because the watcher polls. Only a key remap (LG Input Hook) could
  avoid that, and it is unreliable on webOS 4 (above).
- Launcher ids other than the two above, if the C8's firmware uses another. Check `/tmp/homehook.log` and `getForegroundAppInfo`.
- Overlays that are not apps (the volume and settings side panels, the Q-menu) are not LG's home and are left alone.

Off-TV tests: a simulation of the watcher with a fake `luna-send` covered Home in front, the bar over an app, a launcher listed all the
time (no bounce), Back to Live TV with and without the flag, Live TV picked from Lumen, the LG Home button and takeover off. The
captured install command, run as root on a Linux box, reported installed, then same, then updated, with one watcher running.

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

## Risks

- **Speed**: `background-attachment: fixed` glass is not composited, so a glass shape that moves or scales (focus zoom, Control Center
  opening) is repainted on each frame. It is what Lumen first shipped on a webOS 22 TV (RESEARCH.md section 4), but the C8's alpha9 GPU and
  Chromium 53 are older. If it stutters: Settings > Appearance > Reduce motion.
- **Memory**: the blurred copies are small (960x540 and 480x270), and the static fonts load only on webOS 4, one cut per weight in use
  (about 33 KB each). Chromium 53 on a 2018 TV has less room for decoded images, so cloud and Immich wallpapers may load more slowly.
- The core-js scan works on the minified bundle by property name, so a polyfill could in theory be missed; the app has no other
  dependencies beyond Preact.

## Publishing

`.github/workflows/release.yml` builds the public `.ipk` and updates the Channel index on the `hbc-repo` branch, which GitHub Pages serves.
A push to `main` (or any branch) adds a dev build (`1.0.9xxx`) to the rolling `dev` release, which keeps the last five; Actions > release >
Run workflow does the same by hand. A `v*` tag makes a stable release and `stable/apps.json`.
