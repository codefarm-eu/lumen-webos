// The Magic Remote's OK with the pointer showing can reach the page as a mouse click, as an Enter key, or as both (webOS sends both on
// some firmware). Lumen acts on either: a tile's onClick and useOkPress's key-up. This keeps one OK press from acting twice, whichever of
// the two comes first; a second OK pressed later (more than WINDOW_MS after) acts as normal.

export const WINDOW_MS = 400;

export interface OkClickGuard {
	/** an Enter press is about to act: false when a click just acted for the same press */
	key (): boolean;
	/** a click is about to act: false when an Enter press just acted for the same press */
	click (): boolean;
}

export function okClickGuard (now: () => number = Date.now): OkClickGuard {
	let keyAt = -Infinity;
	let clickAt = -Infinity;
	return {
		key () {
			const t = now();
			if (t - clickAt < WINDOW_MS) return false;
			keyAt = t;
			return true;
		},
		click () {
			const t = now();
			if (t - keyAt < WINDOW_MS) return false;
			clickAt = t;
			return true;
		}
	};
}
