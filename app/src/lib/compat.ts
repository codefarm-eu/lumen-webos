// What the TV's web engine can do, checked once at start-up. The fork's target, an LG C8 on webOS 4 (Chromium 53), has no backdrop-filter,
// no variable fonts and no ResizeObserver; webOS 6 and later have all three. Each check is a feature test, never a version or user-agent test,
// so a newer TV keeps the original look (docs/webos4.md).

const supports = (prop: string, value: string): boolean => {
	try { return !!(window.CSS && CSS.supports && CSS.supports(prop, value)); } catch { return false; }
};

/** Live blur (backdrop-filter, Chromium 76+). Without it the glass shows the pre-blurred wallpaper copy (--wp-blur), lined up with the
 *  wallpaper: the "fake glass" (index.html sets html.fakeglass before the first frame). */
export const LIVE_BLUR = supports('backdrop-filter', 'blur(1px)') || supports('-webkit-backdrop-filter', 'blur(1px)');

/** Variable fonts (Chromium 62+). Without them the font token names the static Geist cuts (global.css, "Geist Static"). */
export const FONT_VARIATIONS = supports('font-variation-settings', '"wght" 400');

/** ResizeObserver (Chromium 64+): only the Liquid glass dock uses it, and that needs live blur anyway. */
export const RESIZE_OBSERVER = typeof (window as unknown as {ResizeObserver?: unknown}).ResizeObserver === 'function';

/** A canvas 2D `filter` (Chromium 52+, but not every TV build honours it): checked by drawing, since setting an unknown property never throws. */
export function canvasFilterWorks (): boolean {
	if (canvasFilter !== null) return canvasFilter;
	try {
		const c = document.createElement('canvas');
		c.width = 9; c.height = 1;
		const g = c.getContext('2d');
		if (!g || typeof (g as unknown as {filter?: unknown}).filter !== 'string') return (canvasFilter = false);
		g.filter = 'blur(2px)';
		g.fillStyle = '#fff';
		g.fillRect(4, 0, 1, 1);
		// a blur spreads the one white pixel into its neighbours
		canvasFilter = g.getImageData(2, 0, 1, 1).data[3] > 0;
	} catch { canvasFilter = false; }
	return canvasFilter;
}
let canvasFilter: boolean | null = null;

/** Element.animate, guarded: an old engine that refuses a keyframe list throws, and a throw inside a layout effect would take the app down. */
export function safeAnimate (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
	if (!el || typeof (el as HTMLElement).animate !== 'function') return null;
	try { return (el as HTMLElement).animate(frames, opts); } catch { return null; }
}
