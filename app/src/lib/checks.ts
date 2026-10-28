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

const syncNameOk = (n: string) => /^[A-Za-z0-9._-]+$/.test(n) && n !== '.' && n !== '..' && n !== '.new';

/** The one word syncBar's shell prints. Anything else (a stray line, an empty reply) is refused, so it is never reported as a write. */
export function syncBarResult (stdout: string): 'same' | 'written' | 'missing' | 'refused' {
	const line = (stdout.trim().split('\n').pop() || '').trim();
	if (line === 'missing' || line === 'same' || line === 'written' || line === 'refused') return line;
	return 'refused';
}

/** Shell that fills the bar folder `dir`'s data/icons, data/bar.json and data/sig. `dir` is an absolute path with no quotes or ".."
 *  (the bar folder next to an app dir that passed APP_DIR). `sig` is [a-z0-9]+ and `b64` is bar.json. Each icon `src` has passed
 *  safeAppPath; `name` is `<id>.<ext>`.
 *  The bar's folder is writable by others, so nothing is written by a full path (a redirect and a recursive remove both follow a link).
 *  The bar folder and then data/ are entered with cd -P and must be that directory (pwd -P); a parent that is a link is fine, the bar
 *  folder itself being a link is not. A data/ or data/icons/ that is not this user's is left as it is. A link at data, icons, bar.json
 *  or sig is removed or replaced, not written through. bar.json and sig are written to a temp file in that directory and moved into
 *  place. data/wallpapers/ is never named. Prints one word: missing, same, written, or refused. */
export function syncBarShell (dir: string, sig: string, b64: string, icons: {src: string; name: string}[]): string {
	// the leading slash splits off an empty first segment; ".." and an empty segment later are what a path must not have
	const dirParts = dir.split('/');
	if (!/^\/[A-Za-z0-9._/+@-]+$/.test(dir) || dirParts[0] !== '' || dirParts.slice(1).some((s) => s === '' || s === '.' || s === '..')) throw new Error('refused');
	if (!/^[a-z0-9]+$/.test(sig) || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error('refused');
	// safe to quote into the shell. The app-folder check is resolvedPath's, so a link that resolves outside one is not copied.
	const shellPath = (p: string) => /^\/[A-Za-z0-9._/+@-]+$/.test(p) && p.length <= 512 && !p.slice(1).split('/').some((s) => s === '' || s === '.' || s === '..');
	const use = icons.filter((i) => shellPath(i.src) && syncNameOk(i.name));
	const names = use.map((i) => i.name).join(' ');
	const copies = use.map((i) => 'if { ' + resolvedPath(i.src) + '; }; then rm -f -- .new; '
		+ 'if [ -e .new ]; then echo refused; exit 0; fi; '
		+ 'cp -fP -- "$r" .new 2>/dev/null; '
		+ 'if [ -L \'' + i.name + '\' ]; then rm -f -- \'' + i.name + '\'; fi; '
		+ 'if [ -f .new ] && [ ! -L .new ] && chmod 644 .new && mv -f -- .new \'' + i.name + '\'; then :; else rm -f -- .new; fi; fi').join('\n');
	const dropDirs = names ? 'for n in ' + names + '; do if [ -d "$n" ] && [ ! -L "$n" ]; then echo refused; exit 0; fi; done' : ':';
	return [
		'# relative names only, after cd -P. a folder that is not ours is left alone. never a recursive remove.',
		"d='" + dir + "'",
		"sig='" + sig + "'",
		"b64='" + b64 + "'",
		'me=$(id -u 2>/dev/null) || { echo refused; exit 0; }',
		'[ -d "$d" ] || { echo missing; exit 0; }',
		'parent=${d%/*}; base=${d##*/}',
		'pphys=$(cd -P "$parent" 2>/dev/null && pwd -P) || { echo refused; exit 0; }',
		'cd -P "$d" 2>/dev/null && [ "$(pwd -P)" = "$pphys/$base" ] || { echo refused; exit 0; }',
		'if [ -L data ]; then rm -f -- data',
		'elif [ -d data ]; then [ "$(stat -c %u data 2>/dev/null)" = "$me" ] || { echo refused; exit 0; }',
		'elif [ -e data ]; then rm -f -- data; fi',
		'mkdir -p data 2>/dev/null || { echo refused; exit 0; }',
		'here=$(pwd -P)',
		'cd -P data 2>/dev/null && [ "$(pwd -P)" = "$here/data" ] || { echo refused; exit 0; }',
		'[ "$(stat -c %u . 2>/dev/null)" = "$me" ] || { echo refused; exit 0; }',
		'chmod 755 . 2>/dev/null || { echo refused; exit 0; }',
		'if [ -f sig ] && [ ! -L sig ] && [ "$(stat -c %u sig 2>/dev/null)" = "$me" ] && [ "$(cat sig 2>/dev/null)" = "$sig" ]; then echo same; exit 0; fi',
		'if [ -d bar.json ] && [ ! -L bar.json ]; then echo refused; exit 0; fi',
		'if [ -d sig ] && [ ! -L sig ]; then echo refused; exit 0; fi',
		'if [ -L icons ]; then rm -f -- icons',
		'elif [ -d icons ]; then [ "$(stat -c %u icons 2>/dev/null)" = "$me" ] || { echo refused; exit 0; }',
		'elif [ -e icons ]; then rm -f -- icons; fi',
		'mkdir -p icons 2>/dev/null || { echo refused; exit 0; }',
		'ihere=$(pwd -P)',
		'cd -P icons 2>/dev/null && [ "$(pwd -P)" = "$ihere/icons" ] || { echo refused; exit 0; }',
		'[ "$(stat -c %u . 2>/dev/null)" = "$me" ] || { echo refused; exit 0; }',
		'chmod 755 . 2>/dev/null || { echo refused; exit 0; }',
		dropDirs,
		copies,
		"keep='" + names + "'",
		'for f in .* *; do',
		'case "$f" in .|..|\'*\'|\'.*\') continue ;; esac',
		'skip=0; for k in $keep; do [ "$f" = "$k" ] && skip=1; done',
		'[ "$skip" = 1 ] && continue',
		'if [ -L "$f" ] || [ -f "$f" ]; then rm -f -- "$f"; fi',
		'done',
		'rm -f -- .new',
		'cd -P .. 2>/dev/null && [ "$(pwd -P)" = "$ihere" ] || { echo refused; exit 0; }',
		'if [ -L .bar.json.new ]; then rm -f -- .bar.json.new',
		'elif [ -d .bar.json.new ]; then echo refused; exit 0',
		'elif [ -e .bar.json.new ]; then rm -f -- .bar.json.new; fi',
		'if [ -L .sig.new ]; then rm -f -- .sig.new',
		'elif [ -d .sig.new ]; then echo refused; exit 0',
		'elif [ -e .sig.new ]; then rm -f -- .sig.new; fi',
		'printf \'%s\' "$b64" | base64 -d > .bar.json.new || { rm -f -- .bar.json.new; echo refused; exit 0; }',
		'[ -f .bar.json.new ] && [ ! -L .bar.json.new ] || { rm -f -- .bar.json.new; echo refused; exit 0; }',
		'chmod 644 .bar.json.new || { echo refused; exit 0; }',
		'printf \'%s\\n\' "$sig" > .sig.new || { echo refused; exit 0; }',
		'[ -f .sig.new ] && [ ! -L .sig.new ] || { rm -f -- .sig.new; echo refused; exit 0; }',
		'chmod 644 .sig.new || { echo refused; exit 0; }',
		'if [ -L bar.json ]; then rm -f -- bar.json; fi',
		'if [ -L sig ]; then rm -f -- sig; fi',
		'mv -f -- .bar.json.new bar.json && mv -f -- .sig.new sig && echo written || echo refused'
	].join('\n');
}
