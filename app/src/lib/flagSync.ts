// Keeps a flag file for the TV-side watcher (tools/tv/watch.sh) in step with a setting. The write goes through the Homebrew Channel, which can
// be down or slow. A write that failed used to be dropped, so the setting read On while the watcher never saw the file: on 24 Oct, Use Lumen's
// screensaver was turned on while the Channel hung, and LG's screensaver kept showing. Now a failed write is tried again until it lands or the
// setting changes, and `resync` (for when Lumen comes back to the front) writes the latest value again.
// One write at a time: each is its own shell on the TV, so a touch and an rm sent together could land in either order and leave the older
// value on disk. A change made while a write is out waits for it, then the newest value is written.

export type Timers = {set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void};

/** waits after the 1st, 2nd, ... failed write; the last one repeats */
export const RETRY_MS = [3000, 10000, 30000, 60000];

export function flagSync (write: (on: boolean) => Promise<unknown>, timers: Timers = {set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>)}) {
	let wanted: boolean | undefined;
	let gen = 0;
	let timer: unknown;
	let busy = false;
	const attempt = (my: number, tries: number): void => {
		if (my !== gen || wanted === undefined || busy) return;
		busy = true;
		const settled = (failed: boolean) => {
			busy = false;
			if (my !== gen) { attempt(gen, 0); return; }
			if (failed) timer = timers.set(() => attempt(my, tries + 1), RETRY_MS[Math.min(tries, RETRY_MS.length - 1)]);
		};
		write(wanted).then(() => settled(false), () => settled(true));
	};
	const start = () => { gen++; if (timer !== undefined) timers.clear(timer); timer = undefined; attempt(gen, 0); };
	return {
		set (on: boolean): void { wanted = on; start(); },
		resync (): void { if (wanted !== undefined) start(); },
	};
}
