// Keeps a flag file for the TV-side watcher (tools/tv/watch.sh) in step with a setting. The write goes through the Homebrew Channel, which can
// be down or slow. A write that failed used to be dropped, so the setting read On while the watcher never saw the file: on 24 Oct, Use Lumen's
// screensaver was turned on while the Channel hung, and LG's screensaver kept showing. Now a failed write is tried again until it lands or the
// setting changes, and `resync` (for when Lumen comes back to the front) writes the latest value again.

export type Timers = {set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void};

/** waits after the 1st, 2nd, ... failed write; the last one repeats */
export const RETRY_MS = [3000, 10000, 30000, 60000];

export function flagSync (write: (on: boolean) => Promise<unknown>, timers: Timers = {set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>)}) {
	let wanted: boolean | undefined;
	let gen = 0;
	let timer: unknown;
	const attempt = (my: number, tries: number): void => {
		if (my !== gen || wanted === undefined) return;
		write(wanted).then(() => undefined, () => {
			if (my !== gen) return;
			timer = timers.set(() => attempt(my, tries + 1), RETRY_MS[Math.min(tries, RETRY_MS.length - 1)]);
		});
	};
	const start = () => { gen++; if (timer !== undefined) timers.clear(timer); timer = undefined; attempt(gen, 0); };
	return {
		set (on: boolean): void { wanted = on; start(); },
		resync (): void { if (wanted !== undefined) start(); },
	};
}
