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
| Apps, inputs, launch | `applicationManager`, `eim` | expected to work (present since webOS 3) |
| Volume, mute, network chip | `com.webos.audio`, `connectionmanager` | expected to work |
| Picture, sound, backlight, Eye Comfort | `settingsservice` through root | expected to work; the C8 has no "FILMMAKER" mode (2020+), so that choice may show an error toast |
| Screen off, restart, LG screensaver | `tvpower` through root | expected to work |
| Live TV row and guide | `iepg`, `epgdb`, `apiadapter/tv/openChannel` | **unknown**: if the calls fail, the row is empty and hidden |
| Sleep timer chip | `tvReservationAgent` through root | **unknown**: if it fails there is simply no chip |
| Home button takeover, wake launch, Recent row from other apps | `tools/tv/watch.sh`, installed over SSH only (not by the Channel) | not set up by the `.ipk`. `watch.sh` now lists `com.ovsteenb.lumen`. |
| LG Input Hook | — | **uncertain on webOS 4**: its issue tracker has reports of key binds stopping after minutes (v1.4.0, webOS 4.x) and of v1.5.0 freezing `tvservice` on webOS 4.10 and losing the picture after standby on webOS 4.5. Not needed by Lumen. |

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
