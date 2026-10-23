// A small box blur (three passes approximate a Gaussian) for engines whose canvas has no `filter` (lib/compat.ts canvasFilterWorks). It runs once
// per wallpaper on a thumbnail-sized canvas (a few hundred pixels wide), never per frame.

function pass (src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, horizontal: boolean): void {
	const len = horizontal ? w : h, lines = horizontal ? h : w;
	const step = horizontal ? 4 : w * 4, lineStep = horizontal ? w * 4 : 4;
	const div = 2 * r + 1;
	for (let line = 0; line < lines; line++) {
		const base = line * lineStep;
		for (let ch = 0; ch < 4; ch++) {
			// running sum over the window, with the edge pixels repeated
			let sum = 0;
			for (let i = -r; i <= r; i++) sum += src[base + Math.min(len - 1, Math.max(0, i)) * step + ch];
			for (let i = 0; i < len; i++) {
				dst[base + i * step + ch] = sum / div;
				const add = Math.min(len - 1, i + r + 1), drop = Math.max(0, i - r);
				sum += src[base + add * step + ch] - src[base + drop * step + ch];
			}
		}
	}
}

/** Blurs the whole canvas in place by about `radius` pixels (a CSS blur(radius px) look). */
export function blurCanvasPixels (ctx: CanvasRenderingContext2D, w: number, h: number, radius: number): void {
	if (radius < 1 || w < 2 || h < 2) return;
	const image = ctx.getImageData(0, 0, w, h);
	const a = image.data, b = new Uint8ClampedArray(a.length);
	// three box passes of this size give about the spread of a Gaussian with sigma = radius
	const r = Math.max(1, Math.round(radius * 0.9));
	for (let n = 0; n < 3; n++) { pass(a, b, w, h, r, true); pass(b, a, w, h, r, false); }
	ctx.putImageData(image, 0, 0);
}
