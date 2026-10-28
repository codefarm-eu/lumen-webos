# Lumen roadmap

Target TV: LG 43UT91006LA, webOS 25 (Chromium 120), rooted, Homebrew Channel installed, Home button remapped with LG Input Hook.
Apps in daily use: PlxNative (Plex), youtube-webos, BBC iPlayer, Channel 4, Channel 5.

This repo was written for a different TV (LG 65UQ8040PSB, webOS 22, Chromium 87, in India). Everything in it that was tuned for that TV, from the
clock fix to the no-live-blur rule, is an assumption here until it has been tested on this one. Phase 2 is where those assumptions get tested.

This is a personal fork. Nothing goes back to partridgeworks/webos-launcher. Features are tried against this TV first and kept only if they work here.

Work is split in two: what can be built without the TV, and what needs someone at the TV. Code that needs a TV answer is still written when it
can be written defensively (it does nothing harmful if the answer is no), and is marked **(verify)** until it has been seen working on the TV.
The agent installs each change on the TV over SSH (`npm run deploy:home`), so "verify" means: Sam tries it on the TV and reports back.

---

## Where things stand (2026-10-15)

- Phase 0 and Phase 1 are done apart from the TV-side items below. The app is built from this repo and installed on the TV from the Homebrew
  Channel (`com.samrenfrew.lumen`, dev channel). LG Input Hook owns the Home button.
- Built without the TV, waiting to be checked on it: everything in **Verify on the TV** below.
- Next without the TV: the rest of **No TV needed**.
- Live TV spike done (2026-10-17): channel list, logos, guide and tuning all work as root. Next: build the Live TV row and the Now and
  Next guide from `docs/live-tv-build.md` (plan, calls, mockups).

---

## On the TV

### Verify on the TV (built, not yet seen working)

Update Lumen in the Homebrew Channel first (dev build from commit 8e2bd15 or later).
- [ ] Down and Up at about 40 fps (verify after the next build; measured live 2026-10-23, in source, `docs/down-up-lag-review.md`): the backdrop behind the lower rows is a canvas (`components/LowerVeil.tsx`) and looks as before, with night dimming too; the bar and first grid row tiles keep a layer each. Up slides in 340 ms, Down in 276 ms. The grid's focused tile grows 1.14x. Check that the backdrop changes with the wallpaper, and that a Down within 4 s of coming back from an app still shows the backdrop (`screen--plainglass` is no longer set under Live blur, so the `settled` rule now also checks `screen--lower`).
- [ ] Settings and Guide backdrop, Guide rows, Back from the grid (verify after the next build; tried live 2026-10-23, in source): Settings and the Guide draw the blurred picture as a canvas (`ScreenBackdrop`, `lib/blurCanvas.ts`) and look as before; each Guide row has its own layer. Back in the grid returns to the glass bar, on the app it left from.
- [ ] Settings > Appearance > Dock blur replaces Live blur (verify after the next build; tried live 2026-10-23): off by default, the glass bar keeps its look with no blur; on, it blurs 2px with saturation, and left and right are a little slower. Live blur is now always on underneath, so the pre-blurred copy for the glass is no longer a choice.
- [ ] Settings > Home > Show recents indicator (verify after the next build): on by default; off hides the open-app dots.
- [x] Running dot (seen 2026-10-22; dots match the open apps, checked over DevTools, and Sam says it looks fine): a small white dot sits above each app that is open in the background, inside the glass, and rises with the app when it has focus. It is read when Lumen comes to the front and again 5 s later. A folder has a dot when an app inside it is open. Apps the TV opens itself in the background get a dot too (YouTube no longer opens at start-up: its preload is off).
- [ ] Glass sheen and focus lift (verify, branch `home/dock-names`; seen live over DevTools, now in source): the glass bar's rim has a faint blue fringe top left and a weaker pink one bottom right. A highlight on the bar's top edge sits over the focused app, slides with focus, stops short of the rounded ends, and fades when focus leaves the bar. The glass bar, Control Center and Inputs blur 3px; the top buttons stay at 2px. A focused app lifts 7.5px as it grows (it was 3px), on the bar and the grid, and its name rises with it.
- [ ] Immich Recent window and stacks (verify, branch `home/dock-names`): Settings > Wallpaper > Recent photos from offers Last month to Last year, set to Last 6 months by default, and the Recent photos change to match. Once the API key has `stack.read`, only the cover photo of a stack shows; within 6 hours of adding the permission (the empty answer is kept that long).
- [ ] Inputs exit and top bar order (verify, branch `home/dock-names`): in the Inputs list, Down twice within a second on the last input closes it and returns the focus to the glass bar. The top bar reads Control Center, Settings, Inputs, and the first Up from the bar lands on Control Center.
- [ ] Screensaver layout (verify, branch `home/dock-names`): the clock stays bottom left; the weather, with the date under it, sits bottom right, aligned right. Opened from the home screen, the clock still slides into place and the date and weather fade in.
- [ ] Cold start glass (verify, branch `home/dock-names`): after a restart, the glass bar and top buttons appear with the light live blur at once, with no change a moment later.
- [ ] Glass bar focus and Control Center exit (verify, branch `home/dock-names`): the bar's focus grows 1.12x (1.06 subtle, 1.16 strong), and the focused app's name shows under its icon inside the glass, with the grid not moved. A picture's credit sits above its title, and the title is a little smaller. A channel with no guide data still shows an empty progress bar.
- [ ] One guide read (verify, branch `home/dock-names`): a few seconds after the home screen, the row's channels show what is on, even with the TV's now and next part filled. Open the Guide on Now and Next: the first channels show at once, and any channel further down shows "Loading…" and then fills, without opening the Full guide. The Full guide opens full. After a switch-off and on, the row draws from the cache before the TV answers. `grep guide /var/lib/homehook/lumen.log` shows one `events:` line at start-up (2 calls) and one when the Guide opens. In Control Center, Down twice within a second on the bottom row (backlight or Eye Comfort) closes it and focuses the first app on the bar.
- [ ] Immich crop on faces (verify): add `face.read` to the Immich API key first. A photo with people keeps the faces in view, a little above the middle, on the wallpaper and the screensaver, pairs too. A photo with no faces keeps more of its top. Without `face.read`, every photo is placed as if it had no faces.
- [ ] Sharper channel logos (verify): on the Live TV row and in the Guide, logos have crisp edges, focused too. The first launch reads every logo from the TV again, once. If thin strokes look jagged or a soft logo looks harsh, widen the alpha range in `crispLogo` (lib/livetv.ts).
- [ ] Wallpaper settings redesign (verify): Settings > Wallpaper has Wallpaper type (Pictures, Video, Immich photos, Plain), New picture on startup, and Change wallpaper automatically. Your old choice carried over once: a shuffle became its category picked, a fixed picture became the only pick, video stayed video, Immich stayed Immich. Choose wallpaper shows only the current type: for Pictures, categories with a Select all tile first and a tick on each picked picture; for Immich, the sources and albums, several at once. Art pictures get the Print look on the home screen.
- [ ] Darker live glass (verify): 2px blur, 30% black tint, sheen and rims at half strength; the glass bar's sheen only near its ends. Focused buttons and the brightness slider are softer too.
- [ ] Settings > Appearance > Liquid glass dock (verify): the glass bar bends the picture at its rim; goes plain while the rows are down; survives a restart. Over a video it only tints.
- [ ] Control Center and Inputs (verify): Up from the top row closes them, back to where they opened from.
- [ ] Home caption (verify): no credit puts the title on the credit's line; a long credit wraps to two lines, then stops with an ellipsis. The date and weather are 26px.
- [ ] Wallpaper captions and the new Art and Landscapes sources (verify): a cloud picture shows its title and credit bottom right, just above the dock, and slides down with the clock when the dock goes; nothing for the bundled defaults, Immich, plain or video. Art (Cleveland) and Landscapes (Wikimedia Commons, their 1920-wide copies) load through the resizer like the Reddit ones; check the Landscapes and Art shuffles work.
- [ ] Full guide blurb (verify): the focused programme's description shows under its time, two lines at most, without the "[S]" flags. Comes from the guide service; the fallback (the TV's schedule table) has none, so then nothing shows.
- [ ] Lighter live blur (verify): the glass bar, top buttons and panels blur 10px, not 30px. Text on the glass still reads from the sofa; if not, try 14px (`--live-glass` in global.css).
- [ ] Screensaver from the home screen opens on the wallpaper (verify): Art mode, or the home screen idle timer, fades the home screen away over the wallpaper already showing, slides the clock from top left to bottom left, and fades in the first new photo a few seconds later. No pause or stutter at the start. The TV's own screensaver (watch.sh) still opens on black and loads a photo.
- [ ] Screensaver Print look (verify): with Settings > Screensaver > Print look on, photos have softer blacks, slightly greyer whites and a darker bottom-right corner, and the crossfade stays smooth.
- [ ] Screensaver brightness (verify): with Brightness at Dim, the backlight drops to 30 while the photos show and goes back to its old
      value on any key. Lumen closed mid-screensaver: the next launch puts the old value back after about 3 s.
- [ ] Lumen bar's screensaver backlight after a switch-off (verify): with Brightness at Dim, let the TV's screensaver come up over a paused
      film (Lumen bar's overlay), then switch the TV off with the remote and on again. Within about 5 s of the watcher running the backlight is
      back at its old value, and the log says `screensaver backlight put back to <n>`, even if the bar's `lumen-ambient-on` flag was left in /tmp.
- [ ] Screensaver backlight and picture mode (verify): with Brightness at Dim and Lumen bar's screensaver up in one picture mode, switch to another
      (e.g. start an HDR film) before dismissing it. The new mode's backlight is left alone; back in the first mode, its old backlight returns
      within a few seconds (`homehook.log`: `waits for picture mode ...`, then `put back to <n>`).
- [ ] Lumen bar's log is now `/tmp/homehook.run/lumen-bar.log` (verify it is written: "saver: open ..." when the overlay screensaver opens).
- [ ] Screensaver flag owner and video wallpaper (verify): with the video wallpaper on but no clip playing (Settings open, or the video failed), LG's screensaver or Lumen's photos still start. Close Lumen bar mid-screensaver some other way: the next screensaver still shows with Lumen in front. With "Home shows the bar" off, Home over Lumen bar's screensaver ends it and leaves the app in front, not Lumen under the overlay. LG Home seen in the log opens the Lumen build last in front.
- [ ] Night dim on the screensaver: after 7 pm with Dim the wallpaper at night on, the photos are darker too.
- [ ] Immich wallpaper night dim: after 7 pm the Photos wallpaper shows at 55%, like a cloud one. The code path is the same; Sam saw it not dim.
- [ ] Photos: Recent, with people (verify): only pictures with faces. If Immich leaves out `people` on /api/search/random, it falls back to Recent.
- [ ] Photos day variety: two pictures in a row (pairs included) are never from the same day, unless the source has nothing else.
- [ ] Screensaver > Start on the home screen after (30 s, 1, 2 or 5 min): left alone on the home screen, the photo screensaver opens straight away with no LG screensaver first. Not in Settings, the guide or Control Center. Dock After idle now hides after 30 s, not 8.
- [ ] Inputs: a column of wide glass pills, one per input, in the Control Center's glass; Up and Down move, OK switches. Check LG's input
      pictures are the same size as the Control Center icons.
- [ ] Control Center lists (verify): OK on Sound, Picture, Theme or Clock opens a list of choices, focus on the current one (blue icon), timed
      off the tvOS 26 video frame by frame. The tile turns into a dark pill that grows to the list's size while the rest of the grid shrinks
      toward it and fades; the list fades in inside the pill, then the pill clears (about 0.33 s). OK picks and it runs backwards, landing on the
      tile with a small overshoot; Back returns without a change. Check it matches the video, with Live blur on and off, that it stays smooth
      (the pill's corners are the one thing that is not transform or opacity), and that Reduce motion just switches.
- [ ] Control Center and Inputs open (verify): both panels grow and fade in from their top-bar button (about 0.26 s).
- [ ] Control Center on one grid, at tvOS size (90px controls, about 420px across): the top buttons' glass, and their focus (brighter, larger).
      With Live blur on, each control is a live blur like the top buttons (ten small ones): check moving between them stays smooth. A control
      that is on (Theme dark, Clock not Auto, Eye Comfort) shows a blue icon. Start Screensaver
      and the volume bar are gone (Art mode opens your photos; volume is on the remote). Eye Comfort is its own circle beside the
      backlight bar: reach it with Down from Restart. Check the backlight label reads at a low level, and the glass lines up with the
      wallpaper behind it.
- [ ] Control Center > Art mode: opens the photos at once, even with Use my photos off. Settings > Screensaver is now Use my photos (on/off) and Photos (which source); an old setting carries over.
- [ ] Photos portrait pairs (verify): two portrait photos from different days show side by side, on the wallpaper and the screensaver, with the glass blur matching both halves. Check that Immich sends `localDateTime` on /api/search/random (without it any two portraits pair), and that loading two previews does not slow the wallpaper's first paint (`wp-loaded` in the boot line).
- [x] Guide after switch-on (seen 2026-10-18): the row and Guide fill once Live TV has been opened. The TV's table stays empty until then (docs/live-tv.md Step 2a). `grep guide /var/lib/homehook/lumen.log`
      shows one "now and next" line per change: how many channels are listed and how many have something on now.
- [ ] Full guide from the guide service (verify): it opens with the seven rows in view filled almost at once, the rest follow, and a jump
      down the list fills there first. `grep guide /var/lib/homehook/lumen.log` shows an "events: N calls" line, not a "schedule:" one.
- [ ] Guide after switch-on, before Live TV runs: does the row fill from the guide service? The log shows "events: the first call found
      nothing" if not; then the next idea is a hidden tune at switch-on.
- [ ] Change wallpaper automatically at 1 min with a Photos wallpaper: a new Immich picture each minute.
- [ ] Settings backup: change something in Lumen, wait 5 s, then `cat /var/lib/homehook/lumen-config.json` over ssh. Then uninstall and
      reinstall (or install the other id): the settings should come back with a "Settings restored from the TV" message.
- [ ] Error log: `cat /var/lib/homehook/lumen.log`. It should exist after anything has failed (for example turning on Live app list with the
      Homebrew service stopped). Empty is fine if nothing failed.
- [ ] Control Center: picture mode, sound mode and screensaver time still read and change (they now go through `lib/root.ts`).
- [ ] Sleep timer status chip: set a timer with LG's own menu and check the chip shows it. webOS 25 denies `tvReservationAgent` to
      apps, so reading goes through root. (The sleep timer and screensaver time tiles, and the Settings circle, were taken out of
      Control Center on 2026-10-15 to cut clutter.)
- [ ] Weather: shows nothing until Settings > Options > Weather city is set. **Your current setup will lose the weather** until you pick
      Auto or a city, because "no city" used to mean Auto.
- [ ] Launch parameter: `luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"com.samrenfrew.lumen","params":{"view":"recent"}}'`,
      once with Lumen closed and once with it in front. Both should land on the Recent row. This is the launch-parameter spike as well.
- [ ] Hide app names and Reduce motion in Settings > Options; the top-right button's label no longer shows above Control Center.
- [ ] Home rows: the Recent row has a title, and the second row sits closer under the glass bar. Going down lines the focused row's tiles up
      where the first row's were.
- [ ] Settings > Options: OK on a list option (country, city, language, appearance, clock, dock, wallpaper timer, the three below) opens a
      pop-up list; Up/Down, OK sets, Back cancels. The city list with no country is long: check it scrolls smoothly.
- [ ] Control Center backlight and Eye Comfort (Phase 5): Left/Right on the Backlight bar steps by 5 and the screen should follow about
      0.3 s after the last press; OK on it turns Eye Comfort on and off (warmer picture). Change picture mode: the bar should show that
      mode's own backlight.
- [ ] Big clock: the time at 150px top left, the date and weather (icon, temperature, condition) on one line under it. Check it reads over a
      bright wallpaper and over the video; check the icon matches the sky (moon at night). With Hide the dock set to After idle or Both,
      after 8 s the dock and top buttons fade and the clock block drops to the bottom left.
- [ ] New options: Apps in the glass bar (5, 6, 7; 7 uses smaller tiles), Focus highlight (Subtle, Normal, Strong), Video wallpaper hours
      (the still wallpaper outside them), Restore settings from the TV, Frame-rate counter (dev builds only).

### Put the TV scripts in place
- [x] `tools/tv/watch.sh`, `hosts-extra`, `stop_watch.sh` in `/var/lib/homehook/`, `60-homehook` in `/var/lib/webosbrew/init.d/`. Check with
      `ps -ef | grep watch.sh` (plain `ps` on webOS 25 does not show it). Starts on its own after a reboot (seen 2026-10-15).
- [x] Home button: LG Input Hook owns it. `watch.sh` only takes over LG Home when `/var/lib/homehook/home-takeover` exists (off by default;
      it would still be useful for the cold-boot case where LG Home is the first thing on screen).
- [x] `watch.sh` running (one copy; the boot hook now checks `/proc`, plain `ps` missed it and started duplicates).
- [ ] Stadia watcher: `tools/tv/stadia.sh` in `/var/lib/homehook/`, started by `60-homehook` (installed and running 2026-10-22). While
      Moonlight is in front, a controller that drops, or connects and sends nothing for 30 s, is paired again once you hold Stadia + Y
      (orange light). **(verify)**: open Moonlight, switch the controller off and on, check it is dead, hold Stadia + Y, check it works
      within about 15 s. Then the same from a cold start (controller off when Moonlight opens). Send `/var/lib/homehook/stadia.log`.
- [ ] Recent row: `watch.sh` writes `/var/lib/homehook/recent` correctly (seen 2026-10-15: PlxNative, YouTube). The row was there but drawn
      below the screen (going down slid the rows a fixed 300px, enough for the second row only); now each row slides into view. **(verify)**:
      press Down twice from the glass row.
- [ ] Full guide (Live TV phase 2, `docs/live-tv-build.md`). **(verify)**: open the Guide, press Up to the switcher, Right to Full guide.
      The grid should fill with the schedule, not only now and next. Then `cat /var/lib/homehook/lumen.log` and send the `guide` lines:
      they say how many pages the schedule took and how long the read ran. The grid fills in as the pages arrive.

### Spikes (yes/no answers, noted in `docs/spikes.md`)
- [x] Does the clock go wrong after a reboot here? No: right time and BST with the clock fix moved aside. `clockfix.sh` deleted (it is in git
      history if the clock ever goes wrong after a power cut).
- [x] Does the TV kill background apps? Lumen yes, YouTube no (see `docs/spikes.md`). Cold start stays the thing to make fast.
- [x] Power button opens LG Home, not Lumen (confirmed fixed on the TV 2026-10-16): `watch.sh` now treats a wake (power state back to Active, or a gap in its ticks) and a boot as
      a 30 s window in which LG Home is replaced by Lumen (off with `/var/lib/homehook/no-wake-launch`). **(verify)** on the TV; wakes are
      logged in `/tmp/homehook.run/homehook.log`.
- [x] `"keepAlive": true` in appinfo.json: tried 2026-10-16, no effect (Lumen still reloads from scratch after Plex). Removed. Cold start
      stays the thing to make fast (Phase 4).
- [ ] Keep apps alive: Home or Recents leaves the app you were in running, and Lumen opens with no launch screen. One session of tests
      with a memory profile, planned in `docs/keep-alive.md` (`clearBackgroundApp`, `KeepOnLaunchEx`, keep-alive lists).
      Done 2026-10-22: Lumen is always kept (memchute's `KeepAlive`), and iPlayer, YouTube, Plex, Channel 4 and Channel 5 stay open until
      the TV needs the memory (`KeepOnLaunchEx`). iPlayer needed its appinfo patched (`closeOnBackground`). Reopens are warm (under 1.5 s).
      Results in `docs/keep-alive.md`. Sam checked at the TV: no launch screen and a much faster Lumen, and iPlayer and Plex stay open
      long enough to go back. But Lumen's home screen lags for a moment on return. Next and untried: "Not tried yet" in
      `docs/keep-alive.md`. **(verify)**: Plex and iPlayer go quiet in the background and carry on from the same point.
- [ ] Recents button: rebind it with Input Hook to launch Lumen with `{"view":"recent"}` (needs the launch-parameter check above).
- [ ] SF font from the TV: `npm run push-font` (once), then update and relaunch. The first launch after each update copies the font into
      the app's folder about 5 seconds in, so the text turns from Geist to SF then; later launches start in SF. Reading straight from
      `/var/lib/homehook/` was tried on 2026-10-18 and webOS 25 refuses it: the app can only read its own folder. (verify)
- [ ] SF clock: with SF loaded, every clock (home, screensaver, Settings) has its colon centred between the digits and even spacing.
      Seen right on the screensaver clock on 2026-10-18 (injected live). The home clock kept a 0.06em lift that beat the SF rule; removed
      for SF (SF's 'case' colon measures centred on the digits). (verify)
- [ ] Guide button: rebind it with Input Hook to run `luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"com.samrenfrew.lumen","params":{"view":"guide"}}'`.
      With Lumen closed and with it in front, it should open the Guide (or the Full guide, by Settings). Needs the Live TV row on. (verify)
- [ ] Colour buttons: which does this remote have, and which key codes reach the app?
- [x] Chrome DevTools on the TV: WebAppMgr runs with `--remote-debugging-port=9998` on localhost. Tunnel it over SSH
      (`ssh -N -L 9998:127.0.0.1:9998 root@<tv>`), then `http://localhost:9998/json` lists the pages, Lumen among them. Found 2026-10-18.
- [x] Settings keys: read works for `picture/backlight`, `picture/eyeComfortMode`, `sound/soundOutput` (`docs/spikes.md`). Backlight and Eye Comfort set work. Sound output
      dropped: TV speakers only.
- [x] Live TV channel service, for the Freeview tiles idea in Later. Yes (2026-10-17): 188 aerial channels with names, PNG logos and the
      guide read as root; `apiadapter/tv/openChannel` tunes, even from Home. Details in `docs/live-tv.md`.
- [x] `backdrop-filter` on the dock only: SVG refraction runs at 56-58 fps (2026-10-18), but the video is on a hardware layer the page cannot read, so nothing can blur or bend it. Details in `RESEARCH.md` section 5.
- [ ] `https://sylvan.apple.com/` videos play directly (then the plain HTTP fallback in `lib/wallpaperVideo.ts` goes).
- [ ] Immich: endpoint paths against the server's `/api` docs and which permissions a read-only key needs.
- [ ] `hosts-extra`: capture what this TV calls (LG ads and tracking) and fill it in. It is empty now; the old entries were JioHotstar's.

### Also at the TV
- [ ] Note the current Lumen settings, in case the backup does not work.
- [ ] Use the build for a day and note anything that differs from 1.0.9 (apart from the missing private assets, see Phase 1).
- [ ] `npm run deploy` over SSH: untried on webOS 25; only needed for a private build with your logos and font.
- [ ] Lower rows transition: trace coming back up (see Phase 4) before changing more.

---

## No TV needed

### Done (2026-10-15)
- [x] Every root shell command in one module, `app/src/lib/root.ts`, with fixed commands, setting keys and values from a list, paths checked,
      everything shell-quoted, and files written as base64.
- [x] Settings backup to `/var/lib/homehook/lumen-config.json` after each change, restored on a fresh install (`lib/backup.ts`). Shared by
      stable, dev and reinstalls.
- [x] On-TV error log (`lib/log.ts`): failed Luna calls (root included) and failed fetches go to `/var/lib/homehook/lumen.log`, capped at
      64 KB, buffered in `localStorage` so a failing root service does not lose its own failure.
- [x] Weather location is opt-in: no city means no weather and no request; Auto (ipwho.is) has to be picked.
- [x] Launch parameters: `{"view":"recent"}` on a cold start (`webOSSystem.launchParams` / `PalmSystem.launchParams`) or a relaunch
      (`webOSRelaunch`) focuses the Recent row (`lib/launchParams.ts`). **(verify)**
- [x] Recent row merges `/var/lib/homehook/recent` (written by `watch.sh`) with Lumen's own list (`lib/recent.ts`). **(verify)**
- [x] `watch.sh`: Home takeover behind a flag, recent-apps file, `hosts-extra` only copies `0.0.0.0 <name>` / `:: <name>` lines, duplicate
      function definitions removed. `clockfix.sh` since deleted (not needed here).
- [x] Settings: Hide app names, Reduce motion. Control Center no longer shows the top button's label through it.
- [x] Error log (seen on the TV): it caught `timer/sleep/getRemainTime` being denied. Sleep timer read and set moved to `lib/root.ts`.
- [x] Lazy-loading Settings and Control Center: tried and dropped. The build is one IIFE script because the app loads from `file://`, where
      ES module chunks do not load; splitting would need a second classic script, and the two are a small share of the 186 KB bundle anyway.
      Revisit only if the Phase 4 trace shows script parse time matters.

- [x] Pop-up list picker for the list options in Settings > Options (`components/ChoicePicker.tsx`; only the rows near the window are drawn).
      Picture and sound mode live in Control Center and still step through with OK.
- [x] Settings: Focus highlight (Subtle, Normal, Strong); Apps in the glass bar (5, 6, 7); Video wallpaper hours (Always, Daytime 7-19,
      Evenings 17-23, Night 19-7). **(verify)**
- [x] Settings: Restore settings from the TV (the backup, on demand).
- [x] Wallpaper: `img.decode()` before the swap; the decoded image is held while it is on screen.
- [x] Video wallpaper: the eight Mixkit clips that were 1080p now use their 720p files (checked that each exists). Apple's aerials are
      1080p only.
- [x] Frame-rate counter: Settings > Options, dev builds only (`__LUMEN_DEV__`: the .dev id, or `LUMEN_DEV=1`, which the release workflow
      sets for branch pushes and hyphenated tags).
- [x] Settings descriptions checked: Date and weather (needs a city) and Live blur (now the hybrid) were out of date.
- [ ] `content-visibility: auto` on off-screen rows: not done. The lower rows are kept painted at opacity 0 on purpose (showing them is a
      fade, not a first paint, see Phase 4); `content-visibility` would skip painting them and bring that first paint back. Panels are
      only rendered while open. Revisit with a trace.

### Next
- [ ] Tag `v1.1.0` and switch the TV to the stable repository once the dev build has been lived with.

---

## Phase 1 notes: the rewrite, build and deploy (done)

- `app/` is the committed source (fork of webos-launcher at 1e2c39b); the `tools/apply_*.py` pipeline is gone. Proven against the published
  1.0.9 ipk.
- `.env` (from `.env.example`) sets `LUMEN_APP_ID`, `LUMEN_APP_TITLE`, `LUMEN_TV_HOST`; `npm run build:ipk` builds into `build/`;
  `npm run deploy` installs over SSH; personal assets live in gitignored `app/private/`.
- Homebrew Channel repository instead of a LAN server: every push to a branch other than `main` builds the public `.ipk`, publishes it as the
  rolling `dev` release and writes `hbc-repo/dev/apps.json`; a `v*` tag does the same into `hbc-repo/stable/`. The TV has the dev
  repository added, so updating is a push plus Update in the Channel. Two consequences: (1) this is the public build, without `app/private/`
  (no third-party logos, no SF font, no personal wallpapers); (2) dev versions are `1.0.9xxx`, so the next tagged stable must be at least
  `1.1.0`, or the Channel will see it as older than the dev build already installed under the same id.

---

## Phase 4: Performance

Closed 2026-10-16 without baseline numbers: on the TV, cold start is as good as it gets (the launch screen with the icon and title is webOS
showing `splash.png` until the first frame), and the live blur test is settled.
- [x] Cold start: the last launch's apps, inputs, Recent row, weather, clock format and wallpaper are drawn at once (lib/boot.ts), the TV is
      asked again 400 ms after the first frame. Accepted on the TV.
- [x] Live blur: the glass bar and top buttons blur live (`backdrop-filter`) and look right; a live full-screen backdrop was too slow, so the
      lower rows and Settings keep the pre-blurred copy. Now the default (Settings > Options > Live blur, on).
- [ ] ~~Baseline numbers with DevTools~~: dropped, not needed for now.
- [ ] Cloud wallpaper at cold start (shuffle or a fixed cloud picture): the next launch's picture is chosen and downloaded 8 s after the
      current one is up, stored on the TV in IndexedDB (lib/wpstore.ts), and its strong blur (about 7 KB, a data: URL) is put in the boot
      record. index.html paints that blur before the script loads, the glass row draws over it, and the sharp picture, read from the TV
      with no network, fades in (450 ms). Works in the browser preview; **(verify)** on the TV, including that IndexedDB keeps the
      pictures across launches.

### Lower rows transition (Down from the dock to the blurred backdrop)
Done so far (commit 167253b, dev 1.0.9003): the rows slide with `transform` instead of `top`; the blurred backdrop is a permanent
`.lowerveil` layer that only fades; the glass shows a plain tint (`.screen--plainglass`) while lower and for 300 ms after, instead of the
fixed-position wallpaper copy; the lower rows stay painted at opacity 0. Going down is better on the TV.
Tuned live with Sam 2026-10-22, in source, not built yet:
- Live blur only on the focused top button, Control Center or Inputs control (the rest a plain tint). Sam: snappier.
- Sound and Picture lists open and close 15% quicker (7 choices); Theme and Clock as before. Sam: right.
- The glass bar has no live blur (sheen and rims stay). Left/right on the bar went from about 22 to 40 fps.
- Down/Up 15% slower (276 ms slide, 253 ms backdrop fade), slowest near the dock both ways. Sam: smoother, still not 60 fps.
  Measured: the blurred backdrop switch costs Down/Up about half their frames; the moving lower rows are the next cost. A plain tint
  in place of the blurred backdrop was better but lost something, so the blurred backdrop stays.

Still wrong, seen on the TV:
- [ ] Frame rate (measured 2026-10-22, `docs/frame-rate.md`): every focus move runs at about 22-25 fps, because each live blur adds about
      2 ms of GPU draw to every frame and the home screen has four. With no live blur the same move runs at about 50 fps. Next: decide
      on static glass (the pre-blurred copy with a scroll offset, rastered once) in place of Live blur.
- [ ] Next (Sam, 2026-10-22): draw the lower rows one row at a time, not all at once 3.5 s after launch (`docs/startup-perf.md`, Still open).
- [ ] Control Center: the move from a button to its sub-menu is laggy (about 16 fps open, 20 fps close). Measured on the TV 2026-10-22 with
      Live blur on. `settled` makes no difference, and nor does blur 2px against 3px. The GPU draws each frame in 31 ms on average (up to
      55 ms), because 21 live blurs change every frame: the 10 grid controls (they keep blurring while they fade), the 7 list choices, the
      pill and the 3 top buttons. Without the grid blurs it is 19 ms; without the choices' blurs 23 ms; with no blur 5 ms. Separately, the
      key press runs 60-70 ms of script before the first frame, and the first frame then waits on raster of the new list, so a third of
      the 330 ms open has gone before anything moves. With no blur at all the open still drops frames for that reason.
      Possible fix: the grid controls drop their live blur (to the plain tint) during the open, and the list choices share one blur behind
      the list instead of seven. Catch (Sam): a blur switched off at the start of the fade shows, so the switch must wait until a control
      is nearly faded out, or crossfade. Sam also feels the open was smoother before; no Control Center commit since 2026-10-19, so compare
      against an older build if the fix is not enough.
- Note 2026-10-22: the two items below predate Live blur. With it on, the glass is a `backdrop-filter` and `--wp-blur` is empty, so there
  is no fixed picture to switch back to. They apply only with Live blur off.
- [ ] Coming back up is now noticeably laggy. Likely cause: after the 300 ms the glass switches back to the fixed-position picture, so
      every glass shape repaints at once, and the lower rows fading out may still repaint. Trace it on the TV before changing anything.
- [ ] The backgrounds don't change together: the glass flips to a plain tint at once while the backdrop fades over 220 ms (and flips
      back 300 ms after the backdrop has gone). Options: crossfade the two glass looks as two stacked layers (opacity only); or give the
      glass a fixed-offset `scroll` background (as `.panel` already does) so it never needs `background-attachment: fixed` and can move
      with the rows; or drop the picture from the dock glass entirely and use a tint everywhere.

Settings > Options > Live blur (test), 2026-10-15. First version (every glass shape and the full-screen lower backdrop as `backdrop-filter`)
on the TV: the glass bar looked much better, but moving between apps on the lower rows lagged. Now a hybrid: the glass bar and top buttons
are live blurs (no light copy loaded), the full-screen backdrops (lower rows, Settings) are the pre-blurred `-bg` copy again. **(verify)**
smoothness on the lower rows, and with the video wallpaper. If it is still bad: go back to the transition from before 167253b and try a
different approach.

Done when: the three numbers are recorded before and after, none got worse, and Recents opens Lumen on the Recent row.

---

## Phase 5: Control Center additions (needs the settings keys spike)

- [x] Backlight slider: a bar under the round buttons, Left/Right by 5, sent 300 ms after the last press (one root command per run of
      presses, and at once if the panel closes first). Re-read after a picture mode change, since each mode keeps its own. **(verify)**
- [x] Eye Comfort toggle: OK on the backlight bar, as OK on the volume bar mutes; the Eye Comfort chip on the bar shows the state. **(verify)**

---

## Phase 6: Colour buttons

Only if the colour-button spike found buttons that reach the app.

- [ ] Settings > Remote: an action per colour button (red, green, yellow, blue). Actions:
  - Open a chosen app
  - Open Control Center
  - Screen off
  - Sleep timer (cycle)
  - Picture mode (cycle)
  - Start screensaver / ambient
  - Nothing
- [ ] These work while Lumen is in front (normal key events).
- [ ] Optional: LG Input Hook mappings so the buttons also work inside other apps, by launching Lumen with a parameter (needs the launch
      parameter handling from Phase 4).

Done when: each button does its chosen action on the TV.

---

## Phase 7: Immich photos

- [ ] Settings > Photos: Immich server address and a read-only API key (permissions per the Phase 2 spike).
- [ ] Photos are fetched directly from the Immich server on the LAN. Never through images.weserv.nl or any other public proxy.
- [ ] Glass without live blur: fetch the small thumbnail, blur it once on an `OffscreenCanvas` in a worker, and use that as the glass backdrop.
      No per-frame cost.
- [x] Step 1: Immich as a wallpaper source (built 2026-10-17, docs/immich.md): Settings > Wallpaper > Photos with Recent (90 days), On this
      day, Favourites, All and each album; landscape only; API calls through curl on the TV because Immich sends no CORS headers; blur made
      on the TV from the thumbnail; next photo prepared for the next cold start. Tested against a fake Immich server only. **(verify)** on
      the TV with your server, including the auto-change timer.
- [x] Step 2: ambient screensaver (built 2026-10-17, docs/immich.md): Settings > Options > Screensaver picks an Immich source; `watch.sh`
      opens Lumen with `{"view":"ambient"}` when LG's screensaver starts and only ends LG's while the ambient screen is up. Crossfade every
      30 s, slow zoom, clock bottom left, any key goes home. Simulated in `watch.sh` and the preview only. **(verify)** on the TV.
- [x] Ambient versus video wallpaper: with the video wallpaper on and Lumen in front, the video wallpaper wins (it already acts as
      the screensaver); otherwise ambient replaces LG's screensaver.
- [ ] Prefetch and decode the next photo before it is shown.

Done when: photos load from Immich on the TV, the ambient screen runs for an hour without stutter or memory growth, and the Phase 4 numbers have
not got worse.

---

## Later

In rough order of value:

1. Plex Continue Watching row from the Plex server's On Deck. Tiles open PlxNative. Opening a specific episode needs a launch parameter that
   PlxNative does not have (nothing documented in its README); that is a request to its author, not something this repo can add.
2. Picture and sound mode per app (root; `watch.sh` already knows which app is in front).
3. YouTube subscriptions row (YouTube Data API, TV sign-in with a code), opening videos in youtube-webos with its `contentTarget` launch
   parameter (`{"contentTarget":"v=<id>"}` is documented; `target` is not).
4. Long-press shortcuts per app (for example YouTube: Subscriptions, Search).
5. Bedtime button: lower backlight, Eye Comfort and sleep timer together (all three work as root).
6. Auto-switch to an HDMI input when its device turns on; power off when idle.
7. Profiles, and a kids mode with a PIN and allowed hours.
8. Privacy page: LG ad and Live Plus settings, plus hosts-level blocking of LG ad and tracking hosts (check what the Homebrew Channel's own
   telemetry and ad blocking already covers before adding to `hosts-extra`).
9. Live TV row under the glass bar and a Now and Next guide (phase 1), full guide grid later (phase 2). Plan and mockups in
   `docs/live-tv-build.md`.

## Parked

- Native (GPU) version of Lumen. Reference: PlxNative (Rust, SDL2, OpenGL ES, webosbrew native NDK; GPL-3.0-or-later, so read for approach
  only). If picked up again, start with a native Immich ambient screen as a pilot rather than the whole launcher.

## Not doing

- Resuming Lumen from the background. The TV kills background apps, so every Home press is a cold start; the work goes into making cold start
  fast instead. A "close background apps" button is pointless for the same reason.
- Live blur over large areas or full screen (too expensive on this class of GPU; the dock-only test in Phase 2 is the exception).
- Google Photos (since March 2025 third-party apps can only read photos they created or ones picked by hand).
- iPlayer, Channel 4 and Channel 5 content rows (no public APIs).
- Contributing any of this upstream.
