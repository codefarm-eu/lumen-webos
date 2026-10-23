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
