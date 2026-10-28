// Checks on values that reach a root shell or a URL, kept here with no imports so they are tested on their own (tools/test/checks.test.mjs).

/** The folders the TV keeps apps in (their icons are read as root, lib/root.ts readIcons and syncBar): developer (Homebrew) apps, store apps,
 *  the TV's own apps and its updated copies. A path elsewhere (/etc, /var/lib, /home) is never read as root for an icon. */
export const APP_ROOTS = ['/media/developer/apps/', '/media/cryptofs/apps/', '/media/system/apps/', '/usr/palm/', '/mnt/otncabi/', '/mnt/otycabi/'];

/** A plain absolute path under one of APP_ROOTS: no quotes, spaces or shell syntax, and no "." or ".." segment or empty segment, so
 *  "/media/developer/apps/x/../../../../etc/shadow" is refused. (The shell side also resolves links before reading, lib/root.ts.) */
export function safeAppPath (p: string): boolean {
	if (typeof p !== 'string' || !/^\/[A-Za-z0-9._\/+@-]+$/.test(p) || p.length > 512) return false;
	const parts = p.slice(1).split('/');
	if (parts.some((s) => s === '' || s === '.' || s === '..')) return false;
	return APP_ROOTS.some((r) => p.indexOf(r) === 0);
}

/** A shell `case` pattern list matching APP_ROOTS (for a path resolved on the TV with readlink -f). */
export const APP_ROOTS_CASE = APP_ROOTS.map((r) => r + '*').join('|');

/** An Immich server's address (scheme, host and port only) and an API key, as checked before either reaches the shell or a picture URL. */
export const IMMICH_BASE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
export const IMMICH_KEY = /^[A-Za-z0-9_-]{16,128}$/;

/** immich.json's url and key, cleaned up ("http://host:2283/api/" -> "http://host:2283") and checked; null when either is not plain. A
 *  replaced or mistyped immich.json then never sends the key to a host built from odd characters (a user@ part, a path, a query). */
export function immichServer (url: unknown, key: unknown): {url: string; key: string} | null {
	const u = String(url || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
	const k = String(key || '').trim();
	return IMMICH_BASE.test(u) && IMMICH_KEY.test(k) ? {url: u, key: k} : null;
}

/** The icon cache (lib/apps.ts, localStorage) limited to `keep`, the icon paths of the apps installed now, so icons of removed apps (and
 *  of an app's old versions) don't pile up until the storage quota is hit. `changed` says whether anything was dropped. */
export function keepOnly (cache: Record<string, string>, keep: string[]): {cache: Record<string, string>; changed: boolean} {
	const out: Record<string, string> = {};
	let changed = false;
	Object.keys(cache).forEach((k) => { if (keep.indexOf(k) !== -1) out[k] = cache[k]; else changed = true; });
	return {cache: out, changed};
}
