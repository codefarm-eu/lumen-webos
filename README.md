# Lumen for webOS 4

Lumen is a tvOS-style home screen for rooted LG webOS TVs. This repository is a fork of
[samrenfrew/lumen-webos](https://github.com/samrenfrew/lumen-webos) that makes Lumen run on **webOS 4 (Chromium 53)**. It is built
and tested on a 2018 **LG OLED C8** (webOS 4.4) rooted with the [Homebrew Channel](https://www.webosbrew.org/).

- **Where else it may run:** the build targets Chromium 53, and every webOS 4 workaround is chosen by a feature test, not by a version
  check. Newer TVs (webOS 5 and later) should get upstream's look, with live blur where the engine has `backdrop-filter`. This fork only
  tests on the C8. Firmware older than webOS 4 (Chromium 38) is not supported.
- **Full details:** what changed for Chromium 53, how each feature was tested on the TV, and what is still unknown are in
  [docs/webos4.md](docs/webos4.md).

## Install

1. Root the TV and install the Homebrew Channel.
2. In the Homebrew Channel's settings, add this repository:

       https://ovsteenb.github.io/lumen-webos/dev/apps.json

3. Install **Lumen**. To use Home over apps, also install **Lumen bar**.

Both apps update from the Channel. Each build is also on the [`dev` release](https://github.com/ovsteenb/lumen-webos/releases/tag/dev)
as an `.ipk`, for Dev Manager or `ares-install`. The public build does not include third-party app logos or the SF font. Lumen uses the
TV's own app icons and the Geist font instead.

## The two apps

| App | Id | What it does |
|---|---|---|
| **Lumen** | `com.ovsteenb.lumen` | The home screen: a glass dock and rows of apps, folders, inputs, the Control Center, Settings, wallpapers and the screensaver. |
| **Lumen bar** | `com.ovsteenb.lumen.bar` | Lumen's dock as an overlay over the app that is playing. The app keeps playing underneath. Plain ES5 in `bar/`, with no build step. It is filled by Lumen and is not listed in LG's app list. |

## Features on webOS 4

- **Faked glass.** Chromium 53 has no `backdrop-filter`. Each glass shape shows a pre-blurred copy of the wallpaper lined up behind it.
  Dock blur and Liquid glass dock are hidden on this engine.
- **Real app icons.** Each app's icon comes from the TV and is read as root if the app can't load it directly. If no icon loads, the tile
  shows a letter.
- **Weather by postcode.** Settings > Weather > **Postcode or place** takes a UK postcode, an outward code or a place name. The default
  is still a picked city or Auto, which finds the place from the internet connection.
- **Live TV.** Settings > Home Screen > **Live TV** is off by default. Off, Lumen makes no channel or guide calls.
- **Control Center Sound and Picture.** The picture and sound modes are the ones the TV reports. On the C8 that is the 10 SDR picture
  modes, or the HDR or Dolby Vision ones while that content plays. Sound modes are greyed out when the sound goes to HDMI ARC.
- **Home opens Lumen.** This is in Settings > Home Screen and is off by default. It installs a small watcher that opens Lumen in place of
  LG's home: Home over an app, Back out of an app, and power on.
- **Home shows the bar.** This is in Settings > Home Screen, is off by default, and needs Lumen bar. Over an app, Home shows Lumen bar
  instead of opening Lumen.
  - In the bar, Left and Right move, OK opens, and Up or the house tile opens full Lumen.
  - Back closes the bar, and so does 10 s without a key.
  - Recent apps follow a divider.
- **Home key bind.** With [LG Input Hook](https://github.com/Simon34545/lginputhook) installed, the watcher binds the Home key so it opens
  Lumen or the bar directly, and LG's bar never flashes up. Without Input Hook, Home still works, but the watcher only reacts once LG's home has appeared, so LG's bar shows for a moment. Lumen's
  **LG Home** button still opens LG's own home, for LG's Settings and inputs.
- **Screensaver.** It starts after a set time on the home screen or from the Control Center. It can also replace the TV's own
  screensaver: turn on **Use Lumen's screensaver**, which reads **Use my photos** once Immich is set up. Without Immich it shows Lumen's
  built-in wallpapers. With an [Immich](docs/immich.md) server it can show your photos instead.
- **Burn-in protection.** Settings > Screensaver > **Move clock to prevent burn-in** is on by default. Every minute the clock and the
  date and weather fade out and back in at a new place.
- **Magic Remote pointer.** Lumen and Lumen bar both take the pointer: point to focus, click to open. On the home screen and in the
  bar, one OK press never acts twice, even if the TV sends it as both a click and an Enter. In the bar, the wheel moves along, and a click
  off the glass closes it.

Upstream's other features are still here: folders, the second and Recent rows, wallpapers (pictures, paintings and video),
nine languages, and Settings in the Apple TV layout.

## Root, the watcher, and how to undo it

Lumen runs root commands through the Homebrew Channel. It uses them for TV settings, app icons, filling Lumen bar's data and installing the
watcher. There is no separate setup.

The watcher is [tools/tv/watch.sh](tools/tv/watch.sh). It is copied to `/var/lib/homehook/` and started at boot by
`/var/lib/webosbrew/init.d/60-homehook`. It keeps the Recent list, replaces LG's home, launches the screensaver, and manages the
Home key bind.

To undo:

- **Turn off the Home key bind only:** `touch /var/lib/homehook/no-home-key`. The bind is gone within 5 s.
- **Give LG's home back:** turn off Settings > Home Screen > **Home opens Lumen**.
- **Stop the watcher altogether:** run [tools/tv/stop_watch.sh](tools/tv/stop_watch.sh). It also removes the key bind.

## Known limitations

- After power on, Lumen is opened over whatever the TV shows (LG's home, or Live TV after Wake-on-LAN) until it has stayed in front
  for 3 s, for at most 90 s after a boot or 30 s after a wake (`no-wake-launch` turns this off). Until then, Home over an app can open full
  Lumen instead of the bar, but only if LG's bar comes up, for example when the key bind isn't active yet.
- The key bind takes the Home key, so **holding Home** no longer opens LG's recents.
- Lumen bar is a transparent overlay and **cannot blur the video** under it. Its glass is a tint.
- LG Input Hook 1.4.0 binds have been reported to **stop after a while on some webOS 4 TVs**. Home then reaches LG again, and the
  watcher's fallback takes over, with LG's bar showing briefly.
- Untested here: Live TV and HDMI inputs under Lumen bar, and the sleep timer chip on webOS 4.

## Development

You need Node 22, Python 3, and SSH as root to the TV for the TV scripts.

1. Install the app's packages: `npm --prefix app install`.
2. Copy `.env.example` to `.env` and set `LUMEN_TV_HOST` to an SSH alias or `root@<tv-ip>`.

Commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the unit tests in `tools/test/`: the bar, OK and click handling, the screensaver and burn-in. Uses esbuild from `app/node_modules`. |
| `npm --prefix app run build` | Type checks and builds the app. |
| `npm run deploy:home` | Builds `com.ovsteenb.lumen` with the dev tools on and installs it on the TV over SSH. A Channel update replaces it. |
| `npm run deploy` | Installs a separate `com.ovsteenb.lumen.dev` ("Lumen Dev") next to it. |
| `npm run release` | Builds the public `.ipk` into `release/`. `sh tools/build_bar.sh` builds Lumen bar. |

[tools/tv/cdp.mjs](tools/tv/cdp.mjs) drives the running page over the TV's DevTools port, through an SSH tunnel. It can add CSS, run
JavaScript, take screenshots and press keys.

### Pull requests and releases

- **Branches:** work goes on a branch and lands through a pull request. Nobody pushes to `main` directly.
- **PR check:** [ci.yml](.github/workflows/ci.yml) builds and tests every pull request on Node 22, the same build as a release.
  It publishes nothing.
- **Publishing:** only `main` publishes, through [release.yml](.github/workflows/release.yml). Each push to `main` adds a dev build of
  both apps to the `dev` release and updates the Channel index on the `hbc-repo` branch, served by GitHub Pages.
- **Versioning:** a dev build's version is `1.0.9xxx`, where `xxx` is the release run number. A failed run still uses up its number. A `v*`
  tag makes a stable release and `stable/apps.json`, and a tag with a hyphen makes a prerelease.

More on the code and the TV: [docs/webos4.md](docs/webos4.md), [docs/frame-rate.md](docs/frame-rate.md),
[docs/startup-perf.md](docs/startup-perf.md), [docs/keep-alive.md](docs/keep-alive.md), [docs/live-tv.md](docs/live-tv.md),
[RESEARCH.md](RESEARCH.md) and [PLAN.md](PLAN.md).

## Credits and licence

- **Fork chain:** this is a fork of [samrenfrew/lumen-webos](https://github.com/samrenfrew/lumen-webos), which forks
  [ammar027/lumen-webos](https://github.com/ammar027/lumen-webos). That project is built on
  [partridgeworks/webos-launcher](https://github.com/partridgeworks/webos-launcher).
- **Upstream:** changes here are not sent upstream.
- **Third-party notices:** see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **No affiliation:** this project is not affiliated with LG, Apple or any app vendor.

Licence: [MIT](LICENSE).
