// Available apps. Two providers:
//
//  1. Catalogue (default, no root): config/catalog.ts filtered by getAppLoadStatus.
//  2. Homebrew Channel (opt-in, rooted TVs only): the Homebrew Channel's service runs
//     shell commands as root for any app that asks. With the user's consent (an option
//     in Settings, off by default) we use it to run `luna-send listLaunchPoints`, which
//     gives the live list with LG's own titles, and to read each icon as base64. If the
//     service isn't there, we fall back to the catalogue.

import {APP_CATALOG, type CatalogApp} from '../config/catalog';
import {APP_ID} from '../config/constants';
import {isWebOS} from './luna';
import {appInfo, listLaunchPoints, readIcons} from './root';
import {keepOnly, safeAppPath} from './checks';
import {lunaCall} from './luna';
import {appExists} from './launch';
import {ICON_PACK} from '../config/iconpack';
import {SYSTEM_APPS} from '../config/systemApps';
import type {GlyphName} from '../components/Glyph';
import {readCache, writeCache} from './boot';
import {bootMark} from './log';

export interface AppEntry {
	id: string;
	title: string;
	/** image URL (relative asset path or data: URI); undefined → monogram */
	iconUrl?: string;
	/** absolute path of the icon file on the TV, when it sits under an app folder (lib/checks.ts). Lumen bar copies this. */
	iconPath?: string;
	color?: string;
	/** a small square icon (not full tile artwork): drawn at a sharp size on a tile coloured like it */
	plain?: boolean;
	/** a built-in vector icon on the colour (the built-in tiles, config/builtinApps.ts) */
	glyph?: GlyphName;
}

export type AppSource = 'catalog' | 'homebrew';

export interface AppList {
	apps: AppEntry[];
	/** where the list actually came from (homebrew falls back to catalog) */
	source: AppSource;
}

const ICON_DIR = 'icons/apps/';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** An icon from the drop-in icon pack (public/iconpack), matched by the app's id or title. It wins over every other icon. */
export function packIcon (id: string, title: string): string | undefined {
	const file = ICON_PACK[slug(id)] || ICON_PACK[slug(title)];
	return file ? 'iconpack/' + file : undefined;
}

export function listApps (useHomebrew: boolean, showSystem = false): Promise<AppList> {
	// every icon path this listing looked up, from both lists (the TV's launch points and the system apps): the icon cache is pruned once,
	// against all of them. Pruning in each loadIcons dropped the other list's icons, so each start read them all again as root.
	const seen: string[] = [];
	return listAppsBase(useHomebrew, seen).then((list) => (showSystem ? addSystemApps(list, seen) : list)).then((list) => { pruneIconCache(seen); return list; });
}

// ---------- the list the last launch showed (lib/boot.ts) ----------

const LIST_CACHE_KEY = 'lumen-boot-apps-v1';
/** marks an icon kept in the icon cache, so the data: URI is not stored twice */
const ICON_REF = '@icon:';
/** where each icon read through the Homebrew Channel came from, by app id */
const iconPaths: Record<string, string> = {};

/** The list the last launch showed with these options, or null. Icons read from the TV come back from the icon cache. */
export function cachedApps (useHomebrew: boolean, showSystem: boolean): AppEntry[] | null {
	const saved = readCache<{key: string; apps: AppEntry[]}>(LIST_CACHE_KEY);
	if (!saved || saved.key !== listKey(useHomebrew, showSystem) || !Array.isArray(saved.apps)) return null;
	const icons = saved.apps.some((a) => !!a.iconUrl && a.iconUrl.indexOf(ICON_REF) === 0) ? readIconCache() : {};
	return saved.apps.map((a) => {
		// the path is kept on the entry too (not only inside @icon:), so a cold start can copy it before this map is filled another way
		const savedPath = a.iconPath && safeAppPath(a.iconPath) ? a.iconPath : undefined;
		if (savedPath) iconPaths[a.id] = savedPath;
		if (!a.iconUrl || a.iconUrl.indexOf(ICON_REF) !== 0) return savedPath ? {...a, iconPath: savedPath} : a;
		const path = a.iconUrl.slice(ICON_REF.length);
		if (safeAppPath(path)) iconPaths[a.id] = path;
		const iconPath = iconPaths[a.id];
		return {...a, iconUrl: icons[path], iconPath: iconPath && safeAppPath(iconPath) ? iconPath : undefined};
	});
}

export function saveAppsCache (useHomebrew: boolean, showSystem: boolean, apps: AppEntry[]): void {
	const slim = apps.map((a) => {
		const path = (a.iconPath && safeAppPath(a.iconPath) && a.iconPath) || (iconPaths[a.id] && safeAppPath(iconPaths[a.id]) && iconPaths[a.id]) || '';
		const iconUrl = a.iconUrl && a.iconUrl.indexOf('data:') === 0 && path ? ICON_REF + path : a.iconUrl;
		return path ? {...a, iconUrl, iconPath: path} : {...a, iconUrl};
	});
	writeCache(LIST_CACHE_KEY, {key: listKey(useHomebrew, showSystem), apps: slim});
}

/** True when two lists would draw the same tiles (the icons compared by length and start, not in full). A path gained for the bar counts: the
 *  cold-start list often has the picture already and would otherwise be left as it is, and the bar would keep the copy from that list. */
export function sameApps (a: AppEntry[], b: AppEntry[]): boolean {
	const sig = (list: AppEntry[]) => JSON.stringify(list.map((x) => [x.id, x.title, x.color, !!x.plain, x.iconPath || '', x.iconUrl ? x.iconUrl.length + x.iconUrl.slice(0, 80) : '']));
	return sig(a) === sig(b);
}

function listKey (useHomebrew: boolean, showSystem: boolean): string {
	return `${useHomebrew ? 'hb' : 'cat'}:${showSystem ? 'sys' : ''}`;
}

function addSystemApps (list: AppList, seen: string[]): Promise<AppList> {
	const have = list.apps.map((a) => a.id);
	const extra = SYSTEM_APPS.filter((a) => have.indexOf(a.id) === -1);
	const check = isWebOS() ? Promise.all(extra.map((a) => appExists(a.id))) : Promise.resolve(extra.map(() => true));
	return check.then((present) => {
		const found = extra.filter((_, i) => present[i]);
		// the TV's own icon for each, as for the other apps (only with the Homebrew Channel: the app manager's app info is read as root)
		const points = list.source === 'homebrew' ? Promise.all(found.map((a) => appInfo(a.id).then((info): LaunchPoint => ({id: a.id, title: a.title, ...iconFields(info)})).catch((): LaunchPoint => ({id: a.id, title: a.title}))))
			: Promise.resolve(found.map((a): LaunchPoint => ({id: a.id, title: a.title})));
		return points.then((pts) => loadIcons(pts, list.source === 'homebrew', seen).then((icons) => Promise.all(found.map((a, i) => {
			const pack = packIcon(a.id, a.title);
			const iconPath = fileIcon(pts[i]);
			if (iconPath) iconPaths[a.id] = iconPath;
			return withIconColor({id: a.id, title: a.title, iconUrl: pack || icons[a.id], color: tvColor(pts[i]) || a.color, plain: !pack && !!icons[a.id], iconPath});
		})))).then((apps) => ({...list, apps: list.apps.concat(apps)}));
	});
}

function listAppsBase (useHomebrew: boolean, seen: string[]): Promise<AppList> {
	if (!isWebOS()) return Promise.all(catalogEntries(APP_CATALOG).map(withIconColor)).then((apps): AppList => ({apps, source: 'catalog'}));
	const catalog = () => listViaCatalog().then((apps): AppList => ({apps, source: 'catalog'}));
	// without root, the app manager's list may still be open to apps (it is not on webOS 6); its icons then load as files or not at all
	const direct = () => lunaCall<{launchPoints?: LaunchPoint[]}>(LIST_LAUNCH_POINTS, {}, 8000, true)
		.then((r) => fromLaunchPoints(r.launchPoints, false, seen))
		.then((apps): AppList => ({apps, source: 'catalog'}), catalog);
	if (!useHomebrew) return direct();
	return listViaHomebrew(seen)
		.then((apps): AppList => ({apps, source: 'homebrew'}))
		.catch(direct);
}

// ---------- provider 1: catalogue ----------

/** dev preview only: ?plain shows the catalogue's small icons the way unknown apps are drawn */
const DEV_PLAIN = import.meta.env.DEV && /[?&]plain/.test(location.search);

function catalogEntries (apps: CatalogApp[]): AppEntry[] {
	return apps.map((a) => ({
		id: a.id,
		title: a.title,
		iconUrl: (DEV_PLAIN ? undefined : packIcon(a.id, a.title)) || (a.icon ? ICON_DIR + a.icon : undefined),
		color: a.color,
		plain: DEV_PLAIN ? !!a.icon : (!packIcon(a.id, a.title) && !!a.icon)
	}));
}

function listViaCatalog (): Promise<AppEntry[]> {
	return Promise.all(APP_CATALOG.map((a) => appExists(a.id)))
		.then((present) => Promise.all(catalogEntries(APP_CATALOG.filter((_, i) => present[i])).map(withIconColor)));
}

// ---------- provider 2: Homebrew Channel (opt-in) ----------

/** a launch point as applicationManager/listLaunchPoints (and getAppInfo) gives it: absolute icon paths on the TV
 *  (/usr/palm/applications/<id>/..., /media/cryptofs/apps/usr/palm/applications/<id>/...), and the colours LG's launcher draws them on */
interface LaunchPoint { id: string; title: string; folderPath?: string; largeIcon?: string; mediumLargeIcon?: string; icon?: string; iconColor?: string; bgColor?: string; }

const LIST_LAUNCH_POINTS = 'luna://com.webos.applicationManager/listLaunchPoints';

/** the sharpest icon: largeIcon (130 px on webOS 4), then mediumLargeIcon, then icon (80 px). May be an http URL (some launch points) or a file. */
const bestIcon = (p: LaunchPoint): string | undefined => p.largeIcon || p.mediumLargeIcon || p.icon;

/** The icon as a file under an app folder, for Lumen bar. An http icon is skipped (it is not a file the bar can copy); a relative name is
 *  joined to folderPath. The first of large, medium, icon that lands under APP_ROOTS wins. */
function fileIcon (p: LaunchPoint): string | undefined {
	const folder = p.folderPath && p.folderPath.charAt(0) === '/' ? p.folderPath.replace(/\/$/, '') : '';
	for (const raw of [p.largeIcon, p.mediumLargeIcon, p.icon]) {
		if (!raw || raw.indexOf('://') !== -1) continue;
		const abs = raw.charAt(0) === '/' ? raw : folder ? `${folder}/${raw.replace(/^\.?\//, '')}` : '';
		if (abs && safeAppPath(abs)) return abs;
	}
	return undefined;
}

const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9., %]+\))$/;
/** LG's tile colour for the app: iconColor, else bgColor (white is LG's "not set" for both, so it is skipped) */
function tvColor (p: LaunchPoint): string | undefined {
	for (const c of [p.iconColor, p.bgColor]) if (c && COLOR.test(c.trim()) && !/^#f{3}(f{3})?$/i.test(c.trim())) return c.trim();
	return undefined;
}

/** the icon fields of an app info, with any relative path made absolute against its folder */
function iconFields (info: {folderPath?: string; icon?: string; largeIcon?: string; mediumLargeIcon?: string; iconColor?: string; bgColor?: string}): Partial<LaunchPoint> {
	const abs = (v?: string) => (!v ? undefined : v.charAt(0) === '/' ? v : info.folderPath ? `${info.folderPath.replace(/\/$/, '')}/${v}` : undefined);
	return {icon: abs(info.icon), largeIcon: abs(info.largeIcon), mediumLargeIcon: abs(info.mediumLargeIcon), iconColor: info.iconColor, bgColor: info.bgColor};
}

/** Apps LG lists but that make no sense on a launcher (ourselves, promos). */
const HIDDEN_IDS = [APP_ID, 'google.assistant.promo'];

const ICON_CACHE_KEY = 'launcher-icon-cache-v1';

function listViaHomebrew (seen: string[]): Promise<AppEntry[]> {
	return listLaunchPoints().then((out) => fromLaunchPoints((JSON.parse(out) as {launchPoints?: LaunchPoint[]}).launchPoints, true, seen));
}

/** The list from the TV's launch points. `root`: icons the app cannot load as files are read through the Homebrew Channel. */
function fromLaunchPoints (all: LaunchPoint[] | undefined, root: boolean, seen: string[]): Promise<AppEntry[]> {
	const points = (all || []).filter((p) => p.id && p.title && HIDDEN_IDS.indexOf(p.id) === -1);
	if (!points.length) return Promise.reject(new Error('no launch points'));
	bootMark('apps-parsed', `${points.length}`);
	return loadIcons(points, root, seen).then((icons) => Promise.all(points.map((p) => {
		// kept even when the tile shows a bundled icon or a data: URI: the bar copies the file, it does not reuse the picture bytes
		const iconPath = fileIcon(p);
		if (iconPath) iconPaths[p.id] = iconPath;
		const known = APP_CATALOG.find((c) => c.id === p.id);
		return {
			id: p.id,
			// the catalogue's titles are shorter than LG's ("IPTV Player" vs "webOS IPTV Player")
			title: known ? known.title : p.title,
			// the catalogue's own icon before the TV's: they are full squares picked to fill a tile, the TV's often have a margin
			iconUrl: packIcon(p.id, known ? known.title : p.title) || (known && known.icon ? ICON_DIR + known.icon : undefined) || icons[p.id],
			color: (known && known.color) || tvColor(p),
			plain: !packIcon(p.id, known ? known.title : p.title) && !!(icons[p.id] || (known && known.icon)),
			iconPath
		} as AppEntry;
	}).map(withIconColor)).then((list) => { bootMark('apps-colours'); return list; }));
}

/** Does the icon load straight from its file? A web app runs from file://; webOS 4 (the C8) refuses another app's files (docs/webos4.md), so there it
 *  usually errors and the icon is read as root instead. */
function probeFile (path: string): Promise<string | null> {
	const url = 'file://' + path.split('/').map(encodeURIComponent).join('/');
	return new Promise((resolve) => {
		const img = new Image();
		const timer = window.setTimeout(() => { img.onload = img.onerror = null; resolve(null); }, 4000);
		img.onload = () => { window.clearTimeout(timer); resolve(img.naturalWidth > 0 ? url : null); };
		img.onerror = () => { window.clearTimeout(timer); resolve(null); };
		img.src = url;
	});
}

/** icons read per shell call: a long reply of base64 through the Homebrew Channel's Luna answer can be cut short or time out */
const ICON_BATCH = 8;

/** Each app's own icon from the TV, cached in localStorage by path: first as a file:// URL (cheap, nothing copied); an icon the app may
 *  not read as a file is read as root through the Homebrew Channel (`root`), a few at a time, as a data URI. Icons are requested by *index*,
 *  so app IDs never reach the shell. A tile whose icon still fails to draw shows its letter (components/Tile.tsx). */
function loadIcons (points: LaunchPoint[], root: boolean, seen: string[]): Promise<Record<string, string>> {
	const cache = readIconCache();
	const result: Record<string, string> = {};
	const missing: {id: string; path: string}[] = [];
	for (const p of points) {
		const path = bestIcon(p);
		if (!path || !/^\/[A-Za-z0-9._\/+@-]+$/.test(path)) continue;
		seen.push(path);
		if (cache[path]) result[p.id] = cache[path];
		else missing.push({id: p.id, path});
	}
	if (!missing.length) return Promise.resolve(result);

	return Promise.all(missing.map((m) => probeFile(m.path))).then((urls) => {
		const unread: {id: string; path: string}[] = [];
		missing.forEach((m, i) => {
			const url = urls[i];
			if (url) { result[m.id] = url; cache[m.path] = url; } else unread.push(m);
		});
		bootMark('icons-file', `${missing.length - unread.length}/${missing.length}`);
		if (!unread.length || !root) { writeIconCache(cache); return result; }
		const batches: {id: string; path: string}[][] = [];
		for (let i = 0; i < unread.length; i += ICON_BATCH) batches.push(unread.slice(i, i + ICON_BATCH));
		// one batch after another: one line per icon, "<index> <base64>" (lib/root.ts skips any path that is not a plain absolute path)
		return batches.reduce((chain, batch) => chain.then(() => readIcons(batch.map((m) => m.path)).then((out) => {
			for (const line of out.split('\n')) {
				const match = /^(\d+) ([A-Za-z0-9+\/=]+)$/.exec(line);
				const entry = match && batch[Number(match[1])];
				if (!match || !entry || !match[2]) continue;
				const url = `data:${/\.jpe?g$/i.test(entry.path) ? 'image/jpeg' : 'image/png'};base64,${match[2]}`;
				result[entry.id] = url;
				cache[entry.path] = url;
			}
		}, () => undefined)), Promise.resolve()).then(() => { writeIconCache(cache); return result; });
	});
}

function readIconCache (): Record<string, string> {
	try {
		const t = performance.now();
		const raw = localStorage.getItem(ICON_CACHE_KEY) || '{}';
		const out = JSON.parse(raw) as Record<string, string>;
		bootMark('iconcache', `${Math.round(raw.length / 1024)}KB ${Math.round(performance.now() - t)}ms`);
		return out;
	} catch { return {}; }
}

/** Keeps only the icons of the apps installed now (`seen`: every icon path the listing looked up). Not when nothing was looked up (the
 *  catalogue fallback, the TV's list unreadable): that is no sign the apps are gone. */
function pruneIconCache (seen: string[]): void {
	if (!seen.length) return;
	const kept = keepOnly(readIconCache(), seen);
	if (kept.changed) writeIconCache(kept.cache);
}

function writeIconCache (cache: Record<string, string>): void {
	try { localStorage.setItem(ICON_CACHE_KEY, JSON.stringify(cache)); }
	catch { /* quota exceeded: icons will simply be re-fetched next time */ }
}

/** The colour of an icon's own background (a pixel at its left edge, or its top), so a small icon can sit on a tile of the same colour. Icons read from the TV
 *  are data: URIs, so the canvas can be read; a file the app ships may not allow it, then the catalogue colour (or a dark default) is used. */
const COLOR_CACHE_KEY = 'launcher-icon-colors-v2';

function readColorCache (): Record<string, string> {
	try { return JSON.parse(localStorage.getItem(COLOR_CACHE_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}

/** what one icon cost (boot timeline): how it ended, its size, and the time spent drawing and reading it */
function sampled (id: string, img: HTMLImageElement, outcome: string, t: number): void {
	bootMark('sampled', `${id} ${outcome} ${img.naturalWidth}px ${Math.round(performance.now() - t)}ms`);
}

function sampleColor (url: string, id: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			const t = performance.now();
			try {
				// a 16 x 16 copy: reading back a handful of pixels from a small canvas is cheap, from a full-size icon it freezes the TV
				const c = document.createElement('canvas');
				c.width = 16; c.height = 16;
				const g = c.getContext('2d');
				if (!g) { sampled(id, img, 'nocanvas', t); resolve(undefined); return; }
				g.drawImage(img, 0, 0, 16, 16);
				// the four corners and the middle of each edge; the colour most of the opaque ones share is the icon's background. One spot
				// alone can land on the logo (YouTube's red play button sits at the left edge of a white icon).
				const spots = [[1, 1], [14, 1], [1, 14], [14, 14], [8, 1], [1, 8], [14, 8], [8, 14]];
				const votes: Record<string, {n: number; rgb: string}> = {};
				let best: {n: number; rgb: string} | undefined;
				for (const [x, y] of spots) {
					const d = g.getImageData(x, y, 1, 1).data;
					if (d[3] <= 200) continue;
					const bucket = `${d[0] >> 4},${d[1] >> 4},${d[2] >> 4}`;
					const v = votes[bucket] || (votes[bucket] = {n: 0, rgb: `rgb(${d[0]}, ${d[1]}, ${d[2]})`});
					v.n++;
					if (!best || v.n > best.n) best = v;
				}
				sampled(id, img, best ? 'ok' : 'clear', t);
				resolve(best && best.rgb);
			} catch { sampled(id, img, 'taint', t); resolve(undefined); }
		};
		img.onerror = () => { sampled(id, img, 'error', performance.now()); resolve(undefined); };
		img.src = url;
	});
}

/** stored for an icon that gave no colour, so it is not tried again on every launch */
const NO_COLOR = 'none';

/** colours already found are kept by app id and icon size, so launching again does no image work at all */
function withIconColor (entry: AppEntry): Promise<AppEntry> {
	if (!entry.plain || !entry.iconUrl) return Promise.resolve(entry);
	const key = `${entry.id}:${entry.iconUrl.length}`;
	const cache = readColorCache();
	if (cache[key]) return Promise.resolve(cache[key] === NO_COLOR ? entry : {...entry, color: cache[key]});
	bootMark('sample', entry.id);
	return sampleColor(entry.iconUrl, entry.id).then((color) => {
		const next = readColorCache();
		next[key] = color || NO_COLOR;
		try { localStorage.setItem(COLOR_CACHE_KEY, JSON.stringify(next)); } catch { /* full: sampled again next time */ }
		return {...entry, color: color || entry.color};
	});
}

/** What a fresh install shows on the home screen: the catalogue's favourites first, then the other installed apps, without the TV's own system apps. */
export function seedAppIds (apps: AppEntry[], preferred: string[]): string[] {
	const system = /^(com\.webos\.|com\.palm\.|com\.lge\.|airplay$|google\.assistant|amazon\.alexa|yandex\.alice)/;
	const rest = apps.filter((a) => preferred.indexOf(a.id) === -1 && !system.test(a.id)).map((a) => a.id);
	const first = preferred.filter((id) => apps.some((a) => a.id === id));
	return first.concat(rest).slice(0, 24);
}

/** The path in the icon cache whose stored picture is `url` (a data: URI or a file:// URL), when that path is still an app file. */
function pathFromIconCache (url: string): string | undefined {
	const cache = readIconCache();
	for (const path of Object.keys(cache)) if (cache[path] === url && safeAppPath(path)) return path;
	return undefined;
}

/** Where an app's icon is as a file on the TV, for Lumen bar (it copies the files). The TV path kept on the entry or in `iconPaths` wins, then
 *  a file:// URL, then a data: URI looked up in the icon cache (the C8 stores almost every icon that way: file:// loads fail), then a
 *  bundled icon under `dir`. An http icon, or a path outside the app folders, is left out. */
export function iconFile (a: AppEntry, dir: string): string | undefined {
	const picked = (p?: string) => (p && safeAppPath(p) ? p : undefined);
	const direct = picked(a.iconPath) || picked(iconPaths[a.id]);
	if (direct) return direct;
	const u = a.iconUrl;
	if (!u) return undefined;
	if (u.indexOf(ICON_REF) === 0) return picked(u.slice(ICON_REF.length));
	if (u.indexOf('file://') === 0) {
		try { return picked(decodeURIComponent(u.slice(7))); } catch { return undefined; }
	}
	if (u.indexOf('data:') === 0) return pathFromIconCache(u);
	if (/^[a-z]+:/i.test(u)) return undefined;
	return picked(dir.replace(/\/$/, '') + '/' + u.replace(/^\.?\//, ''));
}
