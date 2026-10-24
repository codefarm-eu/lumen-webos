import {useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {Status} from './Status';
import {cachedServer, loadServer, nextAsset, picturePosition, previewUrls, type ImmichServer} from '../lib/immich';
import {setAmbientShowing} from '../lib/system';
import {readCache, writeCache} from '../lib/boot';
import {dimForScreensaver, restoreBacklight} from '../lib/tvcontrols';
import type {Weather} from '../lib/weather';
import {safeAnimate} from '../lib/compat';
import {lastPictureFits, nextBuiltin} from '../lib/screensaver';
import {MOVE_EVERY_MS, MOVE_FADE_MS, nextOffset, safeHalves, type Offset} from '../lib/burnin';

interface Layer { urls: string[]; pos: string }
const NO_LAYER: Layer = {urls: [], pos: ''};

/** how long the wallpaper the home screen showed stays before the first new photo starts loading */
const WARM_DELAY_MS = 3000;
/** how long the way back to the home screen takes (matches ambient-out in global.css) */
const CLOSE_MS = 500;
/** the last photo shown, so the TV's screensaver opens on a picture (from the browser cache) rather than black */
const LAST_KEY = 'lumen-ambient-last';

/** where the clock must move to sit on the home screen's clock, as a transform; '' when either is missing */
function toHomeClock (clock: HTMLElement | null): string {
	const home = document.querySelector('.screen:not(.ambient__status) > .pill.status .clock');
	if (!home || !clock) return '';
	const a = home.getBoundingClientRect(), b = clock.getBoundingClientRect();
	// the home clock is smaller: it grows to the screensaver's size as it slides
	return `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${b.width ? a.width / b.width : 1})`;
}

/** Screensaver with your own photos (Immich), or with `builtin` (Lumen's bundled pictures, lib/screensaver.ts) when Immich is off or not set up. Opened by watch.sh with {"view":"ambient"} when the TV's screensaver starts, instead of LG's.
 *  Two full-screen layers: the next photo is loaded and decoded on the hidden one, then they swap with a crossfade (opacity only) every `seconds` (Settings > Screensaver > Time on each photo, 30 by default); each photo
 *  zooms in very slowly (transform only). The clock sits bottom left, the weather and date bottom right. Any key or a click goes back to the home screen.
 *  Started from the home screen (Control Center, or the idle timer), it opens on the wallpaper already there (`opening`): the home screen fades away, the clock
 *  slides from its place top left to bottom left, and the first new photo loads only after that, so nothing heavy runs while the screen changes. */
export function Ambient ({source, builtin, seconds = 30, backlight, weather, showPeriod, print, move = true, opening, onExit}: {source: string; builtin?: string[]; seconds?: number; move?: boolean; backlight?: number; weather?: Weather | null; showPeriod?: boolean; print?: boolean; opening?: {urls: string[]; id: string} | null; onExit: () => void}) {
	// each layer holds one photo's URL, or two for a portrait pair shown side by side, and where they sit (placed on their faces)
	// the last picture shown, only if it is from the source showing now (a bundled picture for the built-in slideshow, else an Immich photo)
	const [last] = useState(() => {
		const l = opening ? null : readCache<{id: string; urls: string[]}>(LAST_KEY);
		return l && lastPictureFits(l.id, builtin) ? l : null;
	});
	const first = opening || last;
	const [layers, setLayers] = useState<[Layer, Layer]>([first ? {urls: first.urls, pos: first.id && !builtin ? picturePosition(first.id) : ''} : NO_LAYER, NO_LAYER]);
	const [front, setFront] = useState(0);
	const state = useRef({front: 0, shown: first ? first.id : '', alive: true, timer: 0});
	const warm = useRef(!!opening).current;
	const status = useRef<HTMLDivElement>(null);
	const root = useRef<HTMLDivElement>(null);
	const exitRef = useRef(onExit);
	exitRef.current = onExit;
	const closing = useRef(false);
	// where burn-in protection has moved the clock and the date/weather block, so the way back to the home screen starts from there
	const moved = useRef<Offset[]>([{x: 0, y: 0}, {x: 0, y: 0}]);

	// the clock slides from where the home screen shows it to its place here (transform only)
	useLayoutEffect(() => {
		const clock = status.current && status.current.querySelector<HTMLElement>('.pill.status .clock');
		const from = toHomeClock(clock);
		if (!warm || !clock || !from || document.documentElement.classList.contains('reduce-motion')) return;
		clock.style.transformOrigin = '0 0';
		clock.style.transform = from;
		void clock.offsetWidth;
		clock.style.transition = 'transform 900ms cubic-bezier(0.4, 0, 0.2, 1)';
		clock.style.transform = '';
		// the date and weather sit on the other side here, so they fade in rather than slide
		const row = status.current && status.current.querySelector<HTMLElement>('.status__row');
		if (row) safeAnimate(row, [{opacity: 0}, {opacity: 1}], {duration: 600, delay: 300, easing: 'ease-out', fill: 'backwards'});
	}, []);

	// burn-in protection (Settings > Screensaver > Move clock to prevent burn-in): every minute the clock and the date/weather block fade out,
	// move to a new random place inside their own half of the safe area (lib/burnin.ts), and fade back in. Opacity and transform only.
	useEffect(() => {
		if (!move) return;
		const layer = status.current;
		if (!layer) return;
		const offsets = moved.current;
		let timer = 0, alive = true;
		const step = () => {
			if (!alive) return;
			const els = [layer.querySelector<HTMLElement>('.pill.status .clock'), layer.querySelector<HTMLElement>('.pill.status .status__row')];
			els.forEach((el) => { if (el) { el.style.transition = `opacity ${MOVE_FADE_MS}ms ease-in-out`; el.style.opacity = '0'; } });
			timer = window.setTimeout(() => {
				if (!alive) return;
				const frame = layer.getBoundingClientRect();
				const scale = frame.width > 0 ? frame.width / layer.offsetWidth : 1;
				const halves = safeHalves(layer.offsetWidth, layer.offsetHeight);
				els.forEach((el, i) => {
					if (!el) return;
					const b = el.getBoundingClientRect();
					// where it would be with no offset, in the layer's own pixels
					const rest = {left: (b.left - frame.left) / scale - offsets[i].x, top: (b.top - frame.top) / scale - offsets[i].y, width: b.width / scale, height: b.height / scale};
					const o = nextOffset(rest, i === 0 ? halves.left : halves.right, offsets[i]);
					offsets[i] = o;
					el.style.transition = 'none';
					el.style.transformOrigin = '0 0';
					el.style.transform = `translate(${o.x}px, ${o.y}px)`;
					void el.offsetWidth;
					el.style.transition = `opacity ${MOVE_FADE_MS}ms ease-in-out`;
					el.style.opacity = '1';
				});
				timer = window.setTimeout(step, MOVE_EVERY_MS - MOVE_FADE_MS);
			}, MOVE_FADE_MS + 50);
		};
		timer = window.setTimeout(step, MOVE_EVERY_MS);
		return () => { alive = false; window.clearTimeout(timer); };
	}, [move]);

	// the TV's backlight goes down while the screensaver shows (Settings > Screensaver > Brightness) and back up when it ends
	useEffect(() => {
		if (backlight === undefined) return;
		let on = true;
		dimForScreensaver(backlight, () => on);
		return () => { on = false; restoreBacklight(); };
	}, [backlight]);

	useEffect(() => {
		const s = state.current;
		s.alive = true;
		setAmbientShowing(true);
		let server: ImmichServer | null = builtin ? null : cachedServer();
		// the bundled picture on screen: the one the home screen showed, if it is one of them
		if (builtin && opening) { const f = builtin.filter((b) => opening.urls.some((u) => u.slice(-b.length) === b)); if (f.length) s.shown = f[0]; }
		const advance = () => {
			if (!s.alive) return;
			const ready: Promise<ImmichServer | null> = builtin ? Promise.resolve(null) : server ? Promise.resolve(server) : loadServer();
			ready
				.then((srv): string | null | Promise<string | null> => {
					if (builtin) { const i = nextBuiltin(builtin, s.shown); return i < 0 ? null : builtin[i]; }
					server = srv; return srv ? nextAsset(srv, source, s.shown) : null;
				})
				.then((id) => {
					if (!id || !s.alive || (!builtin && !server)) return null;
					const urls = builtin ? [id] : previewUrls(server as ImmichServer, id);
					return Promise.all(urls.map((url) => {
						const img = new Image();
						img.src = url;
						return typeof img.decode === 'function' ? img.decode() : Promise.resolve();
					})).then(() => ({id, urls}));
				})
				.then((pic) => {
					if (!pic || !s.alive) return;
					s.shown = pic.id;
					writeCache(LAST_KEY, pic);
					const back = 1 - s.front;
					setLayers((l) => { const n: [Layer, Layer] = [l[0], l[1]]; n[back] = {urls: pic.urls, pos: builtin ? '' : picturePosition(pic.id)}; return n; });
					// two frames so the hidden layer has its picture before it becomes the visible one
					window.requestAnimationFrame(() => window.requestAnimationFrame(() => { s.front = back; setFront(back); }));
				})
				.catch(() => undefined)
				.then(() => { if (s.alive) s.timer = window.setTimeout(advance, seconds * 1000); });
		};
		// on the wallpaper already showing, the next photo waits until the change of screen is over
		if (warm) s.timer = window.setTimeout(advance, WARM_DELAY_MS); else advance();
		// any key goes back: the clock slides back to the home screen's clock while the screensaver fades away, then the screen changes
		const exit = (e: Event) => {
			e.preventDefault();
			if (closing.current) return;
			closing.current = true;
			const el = root.current;
			if (!el || document.documentElement.classList.contains('reduce-motion')) { exitRef.current(); return; }
			const clock = status.current && status.current.querySelector<HTMLElement>('.pill.status .clock');
			const to = toHomeClock(clock);
			if (clock && to) {
				// toHomeClock measures the clock where it is now, burn-in offset included, so that offset stays in front of the move
				const o = moved.current[0];
				clock.style.transformOrigin = '0 0';
				clock.style.transition = `transform ${CLOSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
				clock.style.transform = (o.x || o.y ? `translate(${o.x}px, ${o.y}px) ` : '') + to;
			}
			el.classList.add('ambient--closing');
			window.setTimeout(() => exitRef.current(), CLOSE_MS);
		};
		window.addEventListener('keydown', exit, true);
		window.addEventListener('mousedown', exit, true);
		return () => {
			s.alive = false;
			window.clearTimeout(s.timer);
			window.removeEventListener('keydown', exit, true);
			window.removeEventListener('mousedown', exit, true);
			setAmbientShowing(false);
		};
	}, [source, seconds, builtin ? builtin.join('|') : '']);

	return (
		<div ref={root} class={`ambient${warm ? ' ambient--warm' : ''}${move ? ' ambient--move' : ''}`}>
			{layers.map(({urls, pos}, i) => (
				// keyed by URL, so a new photo restarts the slow zoom
				<div key={i + urls.join(' ')} class={`ambient__photo${i === front ? ' ambient__photo--on' : ''}${i === 1 ? ' ambient__photo--alt' : ''}${urls.length > 1 ? ' ambient__photo--pair' : ''}`} style={urls.length > 0 ? {backgroundImage: urls.map((u) => `url("${u}")`).join(', '), backgroundPosition: pos || undefined, animationDuration: `${seconds + 6}s`} : undefined} />
			))}
			{print && <div class="ambient__print" />}
			<div class="ambient__night" />
			<div class="ambient__shade" />
			<div class="screen ambient__status" ref={status}><Status weather={weather} showPeriod={showPeriod} /></div>
		</div>
	);
}
