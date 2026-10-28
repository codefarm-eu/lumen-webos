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

/** Shell that prints "badsum" and exits unless each of `files` in `dir` has the sha256 that dir/SHA256SUMS gives for it. The same rule as
 *  tools/tv/watch.sh su_sha_ok: each hash is worked out and compared on its own, never with `sha256sum -c` (a busybox build may leave the
 *  check option out, and then every install failed), with `sha256sum`, or else `openssl dgst -sha256`. A TV with neither can check nothing:
 *  this install, started from Lumen itself, goes ahead (the code asking for it comes from the same folder, so checking the folder against
 *  itself proves nothing), while the watcher's unattended self-refresh refuses and waits for this install. `dir` and `files` are fixed
 *  strings from the caller (an app folder that passed APP_DIR, and literal names). */
export function shaCheck (dir: string, files: string[]): string {
	const hash = `sh256 () { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" 2>/dev/null | cut -d' ' -f1; else openssl dgst -sha256 "$1" 2>/dev/null | sed 's/^.*= *//'; fi; }`;
	const each = files.map((f) => `w=$(sed -n 's/^\\([0-9a-f]\\{64\\}\\)  ${f.replace(/\./g, '\\.')}$/\\1/p' ${dir}/SHA256SUMS 2>/dev/null | head -n 1); [ "\${#w}" -eq 64 ] && [ "$(sh256 ${dir}/${f})" = "$w" ] || { echo badsum; exit 0; }`).join('; ');
	return `if command -v sha256sum >/dev/null 2>&1 || command -v openssl >/dev/null 2>&1; then ${hash}; ${each}; fi`;
}

/** Shell: the path `p` resolved through every link into $r, true only when that is a plain file still under one of APP_ROOTS, so a link in an
 *  app's folder can't have root read or copy a file elsewhere. `p` has passed safeAppPath (no quote, space or "." / ".." segment), and
 *  goes in single-quoted. Uses readlink -f, or, where busybox was built without it, the folder's physical path (cd -P, pwd -P) with the
 *  file itself not a link. */
export function resolvedPath (p: string): string {
	return `p='${p}'; r=$(readlink -f "$p" 2>/dev/null) || r=$(cd -P "\${p%/*}" 2>/dev/null && [ ! -L "$p" ] && echo "$(pwd -P)/\${p##*/}"); `
		+ `case "$r" in ${APP_ROOTS_CASE}) [ -f "$r" ] ;; *) false ;; esac`;
}
