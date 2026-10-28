// The screensaver's backlight (Settings > Screensaver > Brightness): lowered while it shows, put back when it ends. No imports, so it is
// tested on its own (tools/test/checks.test.mjs); lib/tvcontrols.ts gives it the TV's read and write.
// One change at a time: the lowering is a read and then a write, each its own root call. A restore asked for while that was still out used
// to find nothing saved yet and do nothing, and then the lowering landed: the panel stayed dim after the screensaver. Now every step waits
// for the one before it, and a restore after a lowering always sees what the lowering saved.
// The backlight belongs to the picture mode: the value is saved with the mode it came from and put back only while that mode is on, so a
// change of mode in between (an HDR film started) never gives another mode the old value; it waits until the mode is back. A mode that
// can't be read doesn't hold the restore up.

/** what was saved: the backlight before, and the picture mode it was read in (older builds saved only the number) */
export type SavedBacklight = number | {level: number; mode?: string | null};

export interface BacklightIo {
	read: () => Promise<number | null>;
	set: (level: number) => Promise<void>;
	/** the picture mode now, or null when it can't be read */
	mode?: () => Promise<string | null>;
	/** the value saved before the screensaver lowered it (kept across a crash), or null */
	load: () => SavedBacklight | null;
	save: (saved: SavedBacklight | null) => void;
}

const levelOf = (s: SavedBacklight): number => (typeof s === 'number' ? s : s.level);
const modeOf = (s: SavedBacklight): string | null => (typeof s === 'number' ? null : s.mode || null);

export function backlightSaver (io: BacklightIo) {
	let chain: Promise<unknown> = Promise.resolve();
	let dimmedHere = false;
	const queue = (fn: () => Promise<unknown> | void) => { chain = chain.then(fn).catch(() => undefined); return chain; };
	const mode = () => (io.mode ? io.mode().catch(() => null) : Promise.resolve(null));
	return {
		/** Lowers the backlight to `level` (never raises it), keeping the old value to put back. `stillWanted` is asked again once the read is back.
		 *  A value still saved for another picture mode (or with the mode now unreadable) leaves the backlight as it is: lowered, this mode
		 *  would have nothing saved to come back to, and stay dim. */
		dim (level: number, stillWanted: () => boolean): Promise<unknown> {
			return queue(() => io.read().then((before) => {
				if (before === null || before <= level || !stillWanted()) return undefined;
				const saved = io.load();
				const want = saved === null ? null : modeOf(saved);
				const ready = saved === null ? mode().then((m) => { io.save({level: before, mode: m}); return true; })
					: want ? mode().then((m) => m === want) : Promise.resolve(true);
				return ready.then((ok) => {
					if (!ok) return undefined;
					dimmedHere = true;
					return io.set(level);
				});
			}));
		},
		/** Puts back the value the screensaver lowered, if it did, and only into the picture mode it came from. Safe to call at any time;
		 *  runs after a lowering still under way. A failed write keeps the saved value for the next try. */
		restore (): Promise<unknown> {
			return queue(() => {
				const saved = io.load();
				if (saved === null) return undefined;
				const want = modeOf(saved);
				return (want ? mode() : Promise.resolve(null)).then((now) => {
					if (want && now && now !== want) return undefined;
					return io.set(levelOf(saved)).then(() => { io.save(null); dimmedHere = false; });
				});
			});
		},
		/** At start-up: a backlight left low by a screensaver that never ended (Lumen closed or crashed) is put back, unless this launch dimmed it. */
		restoreLeftover (): Promise<unknown> {
			return dimmedHere ? chain : this.restore();
		}
	};
}
