// What Lumen's own screensaver (components/Ambient.tsx) shows. Your Immich photos only when they are turned on (Settings > Screensaver >
// Use my photos) and an Immich server is set up; otherwise a slideshow of Lumen's bundled pictures (config/wallpapers.ts LOCAL_WALLPAPERS:
// public/wallpapers/default-N.jpg, or your own from app/private/), which are in the app and need no network. No imports, so it can be tested
// on its own (tools/test/screensaver.test.mjs).

export type ScreensaverSource = {kind: 'immich'; source: string} | {kind: 'builtin'};

/** Immich only when `ambientOn` and a server is set up (`immichConfigured`), never just because one of them is. */
export function screensaverSource (c: {ambientOn: boolean; ambient: string}, immichConfigured: boolean): ScreensaverSource {
	return c.ambientOn && immichConfigured ? {kind: 'immich', source: c.ambient} : {kind: 'builtin'};
}

/** The next bundled picture: a random one of `files` that is not `current` (when there is more than one). -1 when there are none. */
export function nextBuiltin (files: string[], current: string, rand: () => number = Math.random): number {
	if (files.length === 0) return -1;
	const at = files.indexOf(current);
	if (files.length === 1 || at === -1) return Math.min(files.length - 1, Math.floor(rand() * files.length));
	// one of the others, evenly
	const i = Math.min(files.length - 2, Math.floor(rand() * (files.length - 1)));
	return i >= at ? i + 1 : i;
}

/** The last picture the screensaver showed (cached, so a screensaver the TV starts opens on a picture rather than black) is only reused by
 *  the same source: one of the bundled pictures for the built-in slideshow, an Immich asset (a UUID) for Immich. */
export function lastPictureFits (id: string, builtin?: string[]): boolean {
	if (!id) return false;
	return builtin ? builtin.indexOf(id) !== -1 : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Whether the video wallpaper stands in for a screensaver: no screensaver of Lumen's own, and the watcher ends LG's (the video-wallpaper flag).
 *  Only while a clip really plays on the home screen. The setting alone is not enough: a video that can't play (no network, a dead link)
 *  stops after a few tries and leaves the still wallpaper, and Settings, the Guide and the screensaver hold the video, so with the setting on
 *  an OLED kept a still picture for hours with every screensaver suppressed. */
export function videoStandsIn (videoOn: boolean, playing: boolean, screen: string): boolean {
	return videoOn && playing && screen === 'home';
}

/** Where dismissing a screensaver that the TV started over another app goes (tools/tv/watch.sh passes that app as `back`): back to it when it is
 *  still open, so it comes forward as it was (a paused film stays paused where it was), rather than a cold start. `running` is the app manager's
 *  running list, or null when it could not be read; then the app is launched anyway, as a relaunch of an app that is still open resumes it.
 *  null (stay on Lumen's home screen) when there is no such app or it has been closed since. */
export function returnTo (back: string | null | undefined, running: string[] | null): string | null {
	if (!back) return null;
	if (running && running.indexOf(back) === -1) return null;
	return back;
}
