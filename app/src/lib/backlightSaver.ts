// The screensaver's backlight (Settings > Screensaver > Brightness): lowered while it shows, put back when it ends. No imports, so it is
// tested on its own (tools/test/backlight.test.mjs); lib/tvcontrols.ts gives it the TV's read and write.
// One change at a time: the lowering is a read and then a write, each its own root call. A restore asked for while that was still out used
// to find nothing saved yet and do nothing, and then the lowering landed: the panel stayed dim after the screensaver. Now every step waits
// for the one before it, and a restore after a lowering always sees what the lowering saved.

export interface BacklightIo {
	read: () => Promise<number | null>;
	set: (level: number) => Promise<void>;
	/** the value saved before the screensaver lowered it (kept across a crash), or null */
	load: () => number | null;
	save: (level: number | null) => void;
}

export function backlightSaver (io: BacklightIo) {
	let chain: Promise<unknown> = Promise.resolve();
	let dimmedHere = false;
	const queue = (fn: () => Promise<unknown> | void) => { chain = chain.then(fn).catch(() => undefined); return chain; };
	return {
		/** Lowers the backlight to `level` (never raises it), keeping the old value to put back. `stillWanted` is asked again once the read is back. */
		dim (level: number, stillWanted: () => boolean): Promise<unknown> {
			return queue(() => io.read().then((before) => {
				if (before === null || before <= level || !stillWanted()) return undefined;
				if (io.load() === null) io.save(before);
				dimmedHere = true;
				return io.set(level);
			}));
		},
		/** Puts back the value the screensaver lowered, if it did. Safe to call at any time; runs after a lowering still under way. */
		restore (): Promise<unknown> {
			return queue(() => {
				const before = io.load();
				if (before === null) return undefined;
				return io.set(before).then(() => { io.save(null); dimmedHere = false; });
			});
		},
		/** At start-up: a backlight left low by a screensaver that never ended (Lumen closed or crashed) is put back, unless this launch dimmed it. */
		restoreLeftover (): Promise<unknown> {
			return dimmedHere ? chain : this.restore();
		}
	};
}
