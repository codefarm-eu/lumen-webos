# Lumen

A tvOS-style launcher for a rooted LG webOS TV. `app/` is the Preact app (a fork of partridgeworks/webos-launcher, never sent upstream). `tools/` holds the build scripts and the TV-side scripts. `README.md` covers build and install.

## The TV

The target TV is an LG 43UT91006LA on webOS 25 (Chromium 120). The repo was first written for a webOS 22 TV, so any rule tuned for that TV is an assumption until it is seen working on this one. `PLAN.md` holds the roadmap and the **Verify on the TV** list; read its "Where things stand" section before starting work.

- Code that needs a TV answer is written defensively (harmless if the answer is no) and marked **(verify)** in `PLAN.md` until Sam has seen it work.
- This fork (ovsteenb) targets `chrome53` (an LG C8 on webOS 4) and a classic script, with core-js polyfills and fake glass where `backdrop-filter` is missing: see `docs/webos4.md`. Feature-test, never sniff versions.
- The TV's graphics chip is weak. Animate only `transform` and `opacity`; glass is a pre-blurred wallpaper copy, not live blur. The reasons are in `RESEARCH.md` section 4.
- Every root command goes through `app/src/lib/root.ts`, one fixed command per export, with each value checked against a list or pattern. Add new root commands there, in the same shape.

## Getting a build onto the TV

**Hard rule: DevTools first, build last.** Put every change Sam is to try into the live page over DevTools (`cdp.mjs css` or `eval`, the `tv` skill), and let him judge it there. That includes JS changes such as a duration: patch them live with `eval`. Write the change into source as you go. Run `npm run deploy:home` only when Sam says it feels right, or tells you to build. Never install a build per try. If a change truly cannot be made live, say so and ask before building.

A dev build is a local build that you install on the TV over SSH: `npm run deploy:home`. Do not push a branch only to get a build onto the TV, and do not ask Sam to update in the Homebrew Channel.

A push to a branch other than `main` also publishes a Channel dev build (`1.0.9xxx`, `.github/workflows/release.yml`). That happens when Sam asks for a commit and push, not as a test step. A Channel update replaces a local install. A `v*` tag makes a stable release.

This Mac has SSH and DevTools access to the TV. With it you can install a build, read the log, run JS or CSS in the live page, take screenshots, or develop live while Sam watches. The `tv` skill (`.claude/skills/tv/SKILL.md`) has the steps and quirks.

Dev builds write a "boot" timeline line to `/var/lib/homehook/lumen.log` after each launch. `docs/startup-perf.md` explains how to read it.

## Checking work locally

- Type check and build: `npm --prefix app run build`.
- Preview: build, then start the `app-dist` entry in `.claude/launch.json` (port 5198). The `app` entry (Vite) fails on this Mac with `EPERM uv_cwd`, because macOS does not let the preview start Node in Documents. There is no test suite; the preview and the TV are the checks.
- `app/private/` (icons, wallpapers, font) is gitignored and may be absent. The app must still work without it, since the public release is built that way.

## Docs

Feature plans and findings live in `docs/` (`live-tv.md`, `live-tv-build.md`, `settings-redesign.md`, `startup-perf.md`, `frame-rate.md`, `immich.md`, `spikes.md`, `keep-alive.md`). Read the one for the area you touch before changing it, and update it when a finding changes.

## Commits

Subject lines name the area, then say what changed for the user, in plain words: `Live TV: channel logos fill the tile, clear of the progress bar`. Docs-only commits start with `docs/<file>:`.
