// OLED burn-in protection for the screensaver (components/Ambient.tsx): the clock and the date/weather block each move to a new random place
// inside their own half of the screen's safe area every minute, never close to where they were. No imports, so it is tested on its own
// (tools/test/burnin.test.mjs).

export interface Box { left: number; top: number; width: number; height: number }
export interface Area { left: number; top: number; right: number; bottom: number }
export interface Offset { x: number; y: number }

/** how often the blocks move, and how long each fade (out, then in at the new place) takes */
export const MOVE_EVERY_MS = 60000;
export const MOVE_FADE_MS = 1500;

/** The safe area of a `w` x `h` frame (5 % of the width and 6 % of the height kept clear, inside the TV's title-safe area), split in two
 *  halves with a gap, so the clock (left) and the date/weather block (right) can never overlap. */
export function safeHalves (w: number, h: number): {left: Area; right: Area} {
	const mx = Math.round(w * 0.05), my = Math.round(h * 0.06), gap = Math.round(w * 0.02);
	return {
		left: {left: mx, top: my, right: Math.round(w / 2) - gap, bottom: h - my},
		right: {left: Math.round(w / 2) + gap, top: my, right: w - mx, bottom: h - my}
	};
}

/** the offsets (from its resting place `rest`) that keep the box inside `area`; a box bigger than the area stays centred in it */
export function offsetRange (rest: Box, area: Area): {minX: number; maxX: number; minY: number; maxY: number} {
	let minX = area.left - rest.left, maxX = area.right - (rest.left + rest.width);
	let minY = area.top - rest.top, maxY = area.bottom - (rest.top + rest.height);
	if (minX > maxX) minX = maxX = (minX + maxX) / 2;
	if (minY > maxY) minY = maxY = (minY + maxY) / 2;
	return {minX, maxX, minY, maxY};
}

/** A new offset for a box at `rest`, inside `area`, at least a third of the free range away from `prev` when there is room (otherwise the
 *  farthest of a few random tries). Whole pixels, so the text stays sharp. */
export function nextOffset (rest: Box, area: Area, prev: Offset, rand: () => number = Math.random): Offset {
	const r = offsetRange(rest, area);
	const span = Math.sqrt((r.maxX - r.minX) * (r.maxX - r.minX) + (r.maxY - r.minY) * (r.maxY - r.minY));
	const far = span / 3;
	let best: Offset = {x: Math.round(r.minX), y: Math.round(r.minY)}, bestD = -1;
	for (let i = 0; i < 12; i++) {
		const o = {
			x: Math.min(Math.floor(r.maxX), Math.max(Math.ceil(r.minX), Math.round(r.minX + rand() * (r.maxX - r.minX)))),
			y: Math.min(Math.floor(r.maxY), Math.max(Math.ceil(r.minY), Math.round(r.minY + rand() * (r.maxY - r.minY))))
		};
		const d = Math.sqrt((o.x - prev.x) * (o.x - prev.x) + (o.y - prev.y) * (o.y - prev.y));
		if (d >= far) return o;
		if (d > bestD) { best = o; bestD = d; }
	}
	return best;
}
