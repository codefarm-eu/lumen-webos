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

/** The one word syncBar's shell prints. Anything else (a stray line, an empty reply) is refused, so it is never reported as a write.
 *  `busy` is a live run lock: nothing was signed, and the next sync tries again. */
export function syncBarResult (stdout: string): 'same' | 'written' | 'missing' | 'refused' | 'busy' {
	const line = (stdout.trim().split('\n').pop() || '').trim();
	if (line === 'missing' || line === 'same' || line === 'written' || line === 'refused' || line === 'busy') return line;
	return 'refused';
}

/** Shell that fills the bar folder `dir`'s data/icons, data/bar.json and data/sig. `dir` is an absolute path with no quotes or ".."
 *  (the bar folder next to an app dir that passed APP_DIR). `sig` is [a-z0-9]+ and `b64` is bar.json. Each icon `src` has passed
 *  safeAppPath; `name` is `<id>.<ext>`. An entry that should show an icon carries `"icon":"~icon:<name>"`. That field becomes
 *  `"icon":"data/icons/<name>?<sig>"` only when the copy is a plain PNG, JPEG or WebP of at most 1 MiB. A failed re-copy leaves a previous good
 *  file in place and the field keeps naming it; with no previous file the field is `"icon":null` (bar.js treats a null icon as none). The match
 *  is the icon field, so a title with the same text is left alone, key order does not matter, and one name is not a prefix of another. A copy
 *  that did not happen prints `skip <id> <reason>` (`unresolved`, `outside`, `copy`, `toobig`, `not-image`). A missing file or a folder at the
 *  icon path (`unresolved`) is signed `<sig>-r` the first time. The retry is the next launch of Lumen: this page does not run the shell
 *  again for a signature it has already answered `written` or `same` (lib/root.ts syncBar), so a second sync in the same start does not
 *  turn `<sig>-r` into `<sig>-p`. On that next launch, a file that is still missing is signed `<sig>-p` and one that has appeared is copied.
 *  A copy that failed while writing (`copy`) is not signed, so the next launch tries it again. A path that resolves outside the app folders
 *  (`outside`), a file that is too big, or a file that is not an image is signed `<sig>-p` at once, so the same list then answers `same`.
 *  A different list still rewrites. The whole run holds `data/.lock` (mkdir, with this shell's pid inside). A lock whose pid is still alive
 *  (`kill -0`) answers `busy` and signs nothing, so the next sync tries again. A lock whose pid is dead is removed and taken. Scratch files
 *  are named with the shell's pid. The icons cleanup leaves another live pid's scratch files, and a dead pid's `data/.bar.<pid>` and
 *  `data/.sig.<pid>` are removed.
 *  The bar's folder is writable by others, so nothing is written by a full path (a redirect and a recursive remove both follow a link).
 *  The bar folder and then data/ are entered with cd -P and must be that directory (pwd -P); a parent that is a link is fine, the bar
 *  folder itself being a link is not. A data/ or data/icons/ that is not this user's is left as it is. A link at data, icons, bar.json
 *  or sig is removed or replaced, not written through. bar.json and sig are written to a temp file in that directory and moved into
 *  place. data/wallpapers/ is never named. The last line is one word: missing, same, written, refused, or busy. `skip` lines may come before it. */
export function syncBarShell (dir: string, sig: string, b64: string, icons: {src: string; name: string; id?: string}[]): string {
	// the leading slash splits off an empty first segment; ".." and an empty segment later are what a path must not have
	const dirParts = dir.split('/');
	if (!/^\/[A-Za-z0-9._/+@-]+$/.test(dir) || dirParts[0] !== '' || dirParts.slice(1).some((s) => s === '' || s === '.' || s === '..')) throw new Error('refused');
	if (!/^[a-z0-9]+$/.test(sig) || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error('refused');
	// safe to quote into the shell. The app-folder check is resolvedPath's, so a link that resolves outside one is not copied.
	const shellPath = (p: string) => /^\/[A-Za-z0-9._/+@-]+$/.test(p) && p.length <= 512 && !p.slice(1).split('/').some((s) => s === '' || s === '.' || s === '..');
	const use = icons.filter((i) => shellPath(i.src) && syncNameOk(i.name) && (!i.id || syncNameOk(i.id)));
	const names = use.map((i) => i.name).join(' ');
	const copies = use.map((i) => {
		const id = i.id && syncNameOk(i.id) ? i.id : i.name;
		// a missing file is counted once, then signed. a failed write is tried again. outside, too big, and not an image are signed at once.
		const skip = (why: string) => (why === 'unresolved' ? 'miss=1' : why === 'copy' ? 'retry=1' : 'perm=1') + '; echo \'skip ' + id + ' ' + why + '\'';
		// size without reading the file. stat -c %s decides. ls -ln (size is the fifth field) runs only when that print is empty.
		// The owner checks above already use stat -c %u, so a host with no stat is refused before it gets here.
		const sizeOf = (p: string) => 'sz=$(stat -c %s ' + p + ' 2>/dev/null); case "$sz" in \'\'|*[!0-9]*) sz=$(ls -ln ' + p + ' 2>/dev/null | tr -s \' \' | cut -d\' \' -f5) ;; esac';
		const n = '.n.$t';
		// -P copies a link as a link; it is then not a plain file, so it is removed and not named in bar.json.
		// A launch point can name any file under an app folder. The size is read first so a huge file is not copied into the
		// 15s budget. The copy is then judged again (a file swapped in after the first stat), and removed when it fails.
		return [
			'if { ' + resolvedPath(i.src) + '; }; then',
			sizeOf('"$r"'),
			'if [ -z "$sz" ] || [ -n "$(printf %s "$sz" | tr -d 0-9)" ]; then ' + skip('copy'),
			'elif [ "$sz" -gt 1048576 ]; then ' + skip('toobig'),
			'else rm -f -- ' + n,
			'if [ -e ' + n + ' ]; then echo refused; exit 0; fi',
			'cp -fP -- "$r" ' + n + ' 2>/dev/null',
			'if [ -d ' + n + ' ]; then ' + skip('unresolved'),
			'elif [ ! -f ' + n + ' ] || [ -L ' + n + ' ]; then rm -f -- ' + n + '; ' + skip('copy'),
			'else ' + sizeOf(n),
			'if [ -z "$sz" ] || [ -n "$(printf %s "$sz" | tr -d 0-9)" ]; then rm -f -- ' + n + '; ' + skip('copy'),
			'elif [ "$sz" -gt 1048576 ]; then rm -f -- ' + n + '; ' + skip('toobig'),
			'elif ! { dd if=' + n + ' bs=8 count=1 2>/dev/null | cmp -s - .png.$t || dd if=' + n + ' bs=3 count=1 2>/dev/null | cmp -s - .jpg.$t || { dd if=' + n + ' bs=4 count=1 2>/dev/null | cmp -s - .riff.$t && dd if=' + n + ' bs=1 skip=8 count=4 2>/dev/null | cmp -s - .webp.$t; }; }; then rm -f -- ' + n + '; ' + skip('not-image'),
			'else if [ -L \'' + i.name + '\' ]; then rm -f -- \'' + i.name + '\'; fi',
			'if [ -f ' + n + ' ] && [ ! -L ' + n + ' ] && chmod 644 ' + n + ' && mv -f -- ' + n + ' \'' + i.name + '\'; then :; else rm -f -- ' + n + '; ' + skip('copy') + '; fi',
			'fi',
			'fi',
			'fi',
			// $r is what resolvedPath left. A folder under the app folders is a miss (tried once more), not a path that escaped.
			// An empty resolve of a link, or a path that landed elsewhere, will not become a file here.
			'elif [ -d "$r" ] && case "$r" in ' + APP_ROOTS_CASE + ') [ ! -L "$p" ] ;; *) false ;; esac; then ' + skip('unresolved') +
			'; else case "$r" in ' + APP_ROOTS_CASE + ') ' + skip('unresolved') + ' ;; \'\' ) if [ -L "$p" ]; then ' + skip('outside') + '; else ' + skip('unresolved') + '; fi ;; *) ' + skip('outside') + ' ;; esac; fi'
		].join('\n');
	}).join('\n');
	// the quoted token only. null is what bar.js already treats as no icon, and it does not depend on which key is last.
	const rewrite = use.map((i) => {
		const pat = i.name.replace(/\./g, '\\.');
		// the icon field only. A title that is the same text is `"title":"~icon:…"`, which this does not match, and a quote in a
		// title is escaped by JSON.stringify, so it cannot forge the field.
		const token = '\\"icon\\":\\"~icon:' + pat + '\\"';
		const dest = '\\"icon\\":\\"data/icons/' + i.name + '?$sig\\"';
		return 'if [ -f \'icons/' + i.name + '\' ] && [ ! -L \'icons/' + i.name + '\' ]; then '
			+ 'json=$(printf \'%s\' "$json" | sed "s#' + token + '#' + dest + '#g"); '
			+ 'else json=$(printf \'%s\' "$json" | sed "s#' + token + '#\\"icon\\":null#g"); fi';
	});
	const dropDirs = names ? 'for n in ' + names + '; do if [ -d "$n" ] && [ ! -L "$n" ]; then echo refused; exit 0; fi; done' : ':';
	return [
		'# relative names only, after cd -P. a folder that is not ours is left alone. never a recursive remove.',
		"d='" + dir + "'",
		"sig='" + sig + "'",
		"b64='" + b64 + "'",
		'miss=0',
		'retry=0',
		'perm=0',
		'got=',
		't=$$',
		// a busybox without id: 0, as the watcher assumes (MYUID): the Channel's exec only ever runs as root
		'me=$(id -u 2>/dev/null); case "$me" in \'\'|*[!0-9]*) me=0 ;; esac',
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
		// one run at a time. mkdir is the lock; the pid inside says who holds it. a live pid answers busy and signs nothing.
		// a dead pid, or a lock that is not a directory of ours, is cleared and taken. the trap drops the lock on the way out,
		// and only when it still holds our pid, including after cd into icons/.
		'lockdir=$(pwd -P)',
		'if mkdir .lock 2>/dev/null; then',
		'printf \'%s\\n\' "$t" > .lock/p || { rm -f -- .lock/p; rmdir .lock 2>/dev/null; echo refused; exit 0; }',
		'else',
		'if [ -L .lock ] || { [ -e .lock ] && [ ! -d .lock ]; }; then',
		'rm -f -- .lock',
		'mkdir .lock 2>/dev/null || { echo busy; exit 0; }',
		'printf \'%s\\n\' "$t" > .lock/p || { rm -f -- .lock/p; rmdir .lock 2>/dev/null; echo refused; exit 0; }',
		'elif [ -d .lock ] && [ ! -L .lock ]; then',
		'lp=',
		'if [ -f .lock/p ] && [ ! -L .lock/p ]; then lp=$(cat .lock/p 2>/dev/null); fi',
		'case "$lp" in \'\'|*[!0-9]*) ;; *) kill -0 "$lp" 2>/dev/null && { echo busy; exit 0; } ;; esac',
		'lp2=',
		'if [ -f .lock/p ] && [ ! -L .lock/p ]; then lp2=$(cat .lock/p 2>/dev/null); fi',
		'[ "$lp2" = "$lp" ] || { echo busy; exit 0; }',
		'case "$lp2" in \'\'|*[!0-9]*) ;; *) kill -0 "$lp2" 2>/dev/null && { echo busy; exit 0; } ;; esac',
		'if [ -L .lock/p ] || [ -f .lock/p ]; then rm -f -- .lock/p; fi',
		'if [ -e .lock/p ]; then echo busy; exit 0; fi',
		'rmdir .lock 2>/dev/null || { echo busy; exit 0; }',
		'mkdir .lock 2>/dev/null || { echo busy; exit 0; }',
		'printf \'%s\\n\' "$t" > .lock/p || { rm -f -- .lock/p; rmdir .lock 2>/dev/null; echo refused; exit 0; }',
		'else echo busy; exit 0; fi',
		'fi',
		'[ -f .lock/p ] && [ ! -L .lock/p ] && [ "$(cat .lock/p 2>/dev/null)" = "$t" ] || { rm -f -- .lock/p; rmdir .lock 2>/dev/null; echo refused; exit 0; }',
		'trap \'if [ -f "$lockdir/.lock/p" ] && [ ! -L "$lockdir/.lock/p" ] && [ "$(cat "$lockdir/.lock/p" 2>/dev/null)" = "$t" ]; then rm -f -- "$lockdir/.lock/p"; rmdir "$lockdir/.lock" 2>/dev/null; fi\' EXIT',
		// a dead pid's bar and sig temps. a live pid's are left, and ours are the names this run is about to use.
		'for f in .bar.[0-9]* .sig.[0-9]*; do',
		'case "$f" in .bar.[0-9]*|.sig.[0-9]*) ;; *) continue ;; esac',
		'op=${f##*.}',
		'[ "$op" = "$t" ] && continue',
		'case "$op" in *[!0-9]*) continue ;; esac',
		'kill -0 "$op" 2>/dev/null && continue',
		'if [ -L "$f" ] || [ -f "$f" ]; then rm -f -- "$f"; fi',
		'done',
		'if [ -f sig ] && [ ! -L sig ] && [ "$(stat -c %u sig 2>/dev/null)" = "$me" ]; then got=$(cat sig 2>/dev/null); if [ "$got" = "$sig" ] || [ "$got" = "$sig-p" ]; then echo same; exit 0; fi; fi',
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
		"printf '\\211PNG\\r\\n\\032\\n' > .png.\$t; printf '\\377\\330\\377' > .jpg.\$t; printf 'RIFF' > .riff.\$t; printf 'WEBP' > .webp.\$t",
		copies,
		'rm -f -- .n.$t .png.$t .jpg.$t .riff.$t .webp.$t',
		"keep='" + names + "'",
		'for f in .* *; do',
		'case "$f" in .|..|\'*\'|\'.*\') continue ;; esac',
		'skip=0; for k in $keep; do [ "$f" = "$k" ] && skip=1; done',
		'[ "$skip" = 1 ] && continue',
		'case "$f" in .n.[0-9]*|.png.[0-9]*|.jpg.[0-9]*|.riff.[0-9]*|.webp.[0-9]*) op=${f##*.}; [ "$op" != "$t" ] && kill -0 "$op" 2>/dev/null && continue ;; esac',
		'if [ -L "$f" ] || [ -f "$f" ]; then rm -f -- "$f"; fi',
		'done',
		'rm -f -- .n.$t',
		'cd -P .. 2>/dev/null && [ "$(pwd -P)" = "$ihere" ] || { echo refused; exit 0; }',
		'if [ -L .bar.$t ]; then rm -f -- .bar.$t',
		'elif [ -d .bar.$t ]; then echo refused; exit 0',
		'elif [ -e .bar.$t ]; then rm -f -- .bar.$t; fi',
		'if [ -L .sig.$t ]; then rm -f -- .sig.$t',
		'elif [ -d .sig.$t ]; then echo refused; exit 0',
		'elif [ -e .sig.$t ]; then rm -f -- .sig.$t; fi',
		'printf \'%s\' "$b64" | base64 -d > .bar.$t || { rm -f -- .bar.$t; echo refused; exit 0; }',
		'[ -f .bar.$t ] && [ ! -L .bar.$t ] || { rm -f -- .bar.$t; echo refused; exit 0; }',
		'json=$(cat .bar.$t) || { echo refused; exit 0; }',
		...rewrite,
		// a failed sed leaves json empty; writing that and a new sig would stick ("same" forever) with an empty bar
		'[ -n "$json" ] || { rm -f -- .bar.$t .sig.$t; echo refused; exit 0; }',
		'case "$json" in \'{\'*) ;; *) rm -f -- .bar.$t .sig.$t; echo refused; exit 0 ;; esac',
		'printf \'%s\' "$json" > .bar.$t',
		'[ -f .bar.$t ] && [ ! -L .bar.$t ] || { rm -f -- .bar.$t; echo refused; exit 0; }',
		'chmod 644 .bar.$t || { echo refused; exit 0; }',
		'if [ -L bar.json ]; then rm -f -- bar.json; fi',
		// a copy that failed while writing is tried again: the signature is removed, so the next launch is not "same".
		// a missing file is "<sig>-r" the first time and "<sig>-p" when this script runs again and it is still missing.
		// that next run is the next launch: this page does not call again for a signature it already wrote or matched.
		// outside, too big and not an image are "<sig>-p" at once. busy (a live lock) never reaches here, so it does not sign.
		// the old signature is removed before either move, so a failed move of sig cannot leave it beside a new bar.json.
		'if [ "$retry" = 1 ]; then rm -f -- .sig.$t; rm -f -- sig; mv -f -- .bar.$t bar.json && echo written || echo refused; exit 0; fi',
		'mark="$sig"; if [ "$miss" = 1 ]; then if [ "$got" = "$sig-r" ]; then mark="$sig-p"; else mark="$sig-r"; fi; elif [ "$perm" = 1 ]; then mark="$sig-p"; fi',
		'printf \'%s\\n\' "$mark" > .sig.$t || { echo refused; exit 0; }',
		'[ -f .sig.$t ] && [ ! -L .sig.$t ] || { rm -f -- .sig.$t; echo refused; exit 0; }',
		'chmod 644 .sig.$t || { echo refused; exit 0; }',
		'rm -f -- sig',
		'mv -f -- .bar.$t bar.json && mv -f -- .sig.$t sig && echo written || echo refused'
	].join('\n');
}
