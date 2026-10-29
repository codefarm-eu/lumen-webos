// node --test tools/test/*.test.mjs: app/src/lib/checks.ts (icon paths read as root, the Immich server), lib/launchParams.ts launchAction and
// lib/backlightSaver.ts, each turned into JS by esbuild (they have no imports)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const load = async (f) => import('data:text/javascript,' + encodeURIComponent(transformSync(readFileSync(new URL(`../../app/src/lib/${f}`, import.meta.url), 'utf8'), {loader: 'ts', format: 'esm'}).code));
const {safeAppPath, immichServer, APP_ROOTS_CASE, keepOnly, shaCheck, resolvedPath, syncBarShell, syncBarResult} = await load('checks.ts');
const {launchAction} = await load('launchParams.ts');
const {backlightSaver} = await load('backlightSaver.ts');

test('icon paths: only plain paths under the app folders, no "." or ".." segments', () => {
	assert.equal(safeAppPath('/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon.png'), true);
	assert.equal(safeAppPath('/usr/palm/applications/com.webos.app.hdmi1/icon.png'), true);
	assert.equal(safeAppPath('/media/cryptofs/apps/usr/palm/applications/youtube.leanback.v4/largeIcon.png'), true);
	assert.equal(safeAppPath('/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon-130.png'), true);
	assert.equal(safeAppPath('/media/cryptofs/apps/usr/palm/applications/com.theadelab.amclient-lg/largeIcon.png'), true);
	assert.equal(safeAppPath('/media/cryptofs/apps/usr/palm/applications/netflix/icon.png'), true);
	for (const bad of ['/media/developer/apps/x/../../../../etc/shadow', '/media/developer/apps/./x.png', '/media/developer/apps//x.png',
		'/etc/shadow', '/var/lib/homehook/immich.json', '/home/root/.ssh/id_rsa', 'media/developer/apps/x.png', "/media/developer/apps/a'b.png",
		'/media/developer/apps/a b.png', '/media/developer/apps/x/..', '/usr/palmx/a.png']) assert.equal(safeAppPath(bad), false, bad);
	assert.match(APP_ROOTS_CASE, /^\/media\/developer\/apps\/\*\|/);
});

test('Immich: a plain http(s)://host[:port] and a plain key, or nothing (the key never goes into an odd URL)', () => {
	assert.deepEqual(immichServer('http://192.168.1.10:2283/api/', ' abcdefghijklmnop1234 '), {url: 'http://192.168.1.10:2283', key: 'abcdefghijklmnop1234'});
	assert.deepEqual(immichServer('https://photos.example.org', 'abcdefghijklmnop1234'), {url: 'https://photos.example.org', key: 'abcdefghijklmnop1234'});
	for (const url of ['http://evil@photos.example.org', 'http://host/path', 'javascript:alert(1)', 'ftp://host', 'http://host?x=1', '']) {
		assert.equal(immichServer(url, 'abcdefghijklmnop1234'), null, url);
	}
	assert.equal(immichServer('http://host:2283', 'short'), null);
	assert.equal(immichServer('http://host:2283', 'abc&def=ghijklmnop'), null);
});

test('launch parameters: the screensaver closes Control Center, keeps the first "back", and a plain relaunch goes home', () => {
	const cfg = {ambientOn: true, liveTv: false};
	assert.deepEqual(launchAction({view: 'ambient', back: 'org.moonfin.webos'}, cfg, 'home'), {screen: 'ambient', closeControls: true, back: 'org.moonfin.webos', focusDock: false});
	// LG's timer again while it is up: no back, the first one kept (undefined)
	assert.equal(launchAction({view: 'ambient'}, cfg, 'ambient').back, undefined);
	assert.equal(launchAction({view: 'ambient'}, cfg, 'home').back, null);
	assert.deepEqual(launchAction({}, cfg, 'ambient'), {screen: 'home', closeControls: true, back: null, focusDock: false});
	assert.deepEqual(launchAction({view: 'ambient'}, {ambientOn: false, liveTv: false}, 'home'), {closeControls: false, back: null, focusDock: false});
	assert.equal(launchAction({view: 'guide'}, {ambientOn: true, liveTv: true}, 'home').screen, 'guide');
	assert.equal(launchAction({view: 'guide'}, cfg, 'home').screen, undefined);
	assert.equal(launchAction({view: 'recent'}, cfg, 'home').focusDock, true);
});

/** a fake TV: reads and writes resolve when released, in the order asked for unless `out of order` */
function tv (start) {
	const st = {level: start, saved: null, pending: [], sets: []};
	const later = (fn) => new Promise((ok) => st.pending.push(() => ok(fn())));
	const io = {read: () => later(() => st.level), set: (v) => later(() => { st.level = v; st.sets.push(v); }), load: () => st.saved, save: (v) => { st.saved = v; }};
	const flush = async () => { for (let i = 0; i < 50; i++) { await new Promise((r) => setImmediate(r)); const f = st.pending.shift(); if (f) f(); } };
	return {st, io, flush};
}

test('backlight: a restore asked for while the lowering is still out waits for it, so the panel is never left dim', async () => {
	const {st, io, flush} = tv(80);
	const b = backlightSaver(io);
	b.dim(30, () => true);
	b.restore();   // the screensaver ended before the read came back
	await flush();
	assert.deepEqual(st.sets, [30, 80]);
	assert.equal(st.level, 80);
	assert.equal(st.saved, null);
});

test('backlight: never raised, nothing done once the screensaver is gone, and a leftover is put back at start', async () => {
	let t = tv(20); let b = backlightSaver(t.io);
	b.dim(30, () => true); b.restore(); await t.flush();
	assert.deepEqual(t.st.sets, []);
	t = tv(80); b = backlightSaver(t.io);
	let on = true;
	b.dim(30, () => on); on = false; b.restore(); await t.flush();
	assert.deepEqual(t.st.sets, []);
	t = tv(30); t.st.saved = 75; b = backlightSaver(t.io);
	b.restoreLeftover(); await t.flush();
	assert.deepEqual(t.st.sets, [75]);
	assert.equal(t.st.saved, null);
});

test('the icon cache keeps only the icons of the apps installed now', () => {
	assert.deepEqual(keepOnly({'/a/icon.png': 'A', '/gone/icon.png': 'G'}, ['/a/icon.png', '/new/icon.png']), {cache: {'/a/icon.png': 'A'}, changed: true});
	assert.deepEqual(keepOnly({'/a/icon.png': 'A'}, ['/a/icon.png']), {cache: {'/a/icon.png': 'A'}, changed: false});
});

/** a PATH with only `tools` (plus what the snippet needs), so a TV with or without sha256sum / openssl can be tried */
function toolPath (tools, extra = {}) {
	const d = mkdtempSync(join(tmpdir(), 'tools-'));
	for (const t of ['sed', 'head', 'cut', 'cat', ...tools]) {
		const at = execFileSync('sh', ['-c', `command -v ${t}`], {encoding: 'utf8'}).trim();
		symlinkSync(at, join(d, t));
	}
	Object.entries(extra).forEach(([n, body]) => { writeFileSync(join(d, n), body, {mode: 0o755}); });
	return d;
}
function homehook (sums = 'good') {
	const d = mkdtempSync(join(tmpdir(), 'homehook-'));
	const h = {};
	for (const f of ['watch.sh', '60-homehook']) { writeFileSync(join(d, f), `#!/bin/sh\n# ${f}\n`); h[f] = createHash('sha256').update(readFileSync(join(d, f))).digest('hex'); }
	if (sums !== 'none') writeFileSync(join(d, 'SHA256SUMS'), Object.entries(h).map(([f, x]) => (sums === 'bad' && f === '60-homehook' ? '0'.repeat(64) : x) + '  ' + f).join('\n') + '\n');
	return d;
}
const SH = execFileSync('sh', ['-c', 'command -v sh'], {encoding: 'utf8'}).trim();
const check = (dir, path) => execFileSync(SH, ['-c', shaCheck(dir, ['watch.sh', '60-homehook']) + '; echo ok'], {encoding: 'utf8', env: {PATH: path}}).trim();

test('Settings install: SHA256SUMS checked file by file, with sha256sum or openssl, never sha256sum -c', () => {
	const sha = toolPath(['sha256sum']);
	assert.equal(check(homehook(), sha), 'ok');
	assert.equal(check(homehook('bad'), sha), 'badsum');
	assert.equal(check(homehook('none'), sha), 'badsum');
	// a busybox sha256sum built without -c: the check used to fail every install there
	const real = execFileSync('sh', ['-c', 'command -v sha256sum'], {encoding: 'utf8'}).trim();
	const noC = toolPath([], {sha256sum: `#!/bin/sh\ncase "$1" in -c) echo 'sha256sum: unrecognized option -c' >&2; exit 1 ;; esac\nexec ${real} "$@"\n`});
	assert.equal(check(homehook(), noC), 'ok');
	const ossl = toolPath(['openssl']);
	assert.equal(check(homehook(), ossl), 'ok');
	assert.equal(check(homehook('bad'), ossl), 'badsum');
	// neither: nothing can be checked, and the install started from Lumen goes ahead (the watcher's own refresh refuses, watch.test.mjs)
	assert.equal(check(homehook('bad'), toolPath([])), 'ok');
});

test('icon paths resolved as root: readlink -f, or cd -P/pwd -P where busybox has no readlink -f; never a file outside the app folders', () => {
	const t = mkdtempSync(join(tmpdir(), 'resolve-'));
	const root = join(t, 'apps');
	mkdirSync(join(root, 'real'), {recursive: true});
	writeFileSync(join(root, 'real', 'icon.png'), 'x');
	writeFileSync(join(t, 'secret'), 's');
	symlinkSync(join(root, 'real'), join(root, 'dirlink'));
	symlinkSync(join(t, 'secret'), join(root, 'real', 'leak.png'));
	symlinkSync(t, join(root, 'out'));
	const res = (p, path) => execFileSync(SH, ['-c', resolvedPath(p).replace(APP_ROOTS_CASE, root + '/*') + ' && echo "$r" || echo no'], {encoding: 'utf8', env: {PATH: path}}).trim();
	const noReadlink = toolPath([], {readlink: '#!/bin/sh\necho "readlink: invalid option -- f" >&2; exit 1\n'});
	for (const path of [process.env.PATH, noReadlink]) {
		assert.equal(res(join(root, 'real', 'icon.png'), path), join(root, 'real', 'icon.png'));
		assert.equal(res(join(root, 'dirlink', 'icon.png'), path), join(root, 'real', 'icon.png'));
		assert.equal(res(join(root, 'real', 'leak.png'), path), 'no');
		assert.equal(res(join(root, 'out', 'secret'), path), 'no');
	}
});

test('backlight: saved with its picture mode and put back only into that mode; a failed write keeps it for the next try', async () => {
	const t = tv(80);
	let mode = 'cinema';
	let fail = false;
	t.io.mode = () => Promise.resolve(mode);
	const set = t.io.set;
	t.io.set = (v) => (fail ? Promise.reject(new Error('no')) : set(v));
	const b = backlightSaver(t.io);
	b.dim(30, () => true); await t.flush();
	assert.deepEqual(t.st.saved, {level: 80, mode: 'cinema'});
	mode = 'hdrCinema';   // an HDR film came on: its backlight is not touched
	b.restore(); await t.flush();
	assert.deepEqual(t.st.sets, [30]);
	assert.deepEqual(t.st.saved, {level: 80, mode: 'cinema'});
	mode = 'cinema'; fail = true;
	b.restore(); await t.flush();
	assert.deepEqual(t.st.saved, {level: 80, mode: 'cinema'}, 'kept after a failed write');
	fail = false;
	b.restore(); await t.flush();
	assert.deepEqual(t.st.sets, [30, 80]);
	assert.equal(t.st.saved, null);
	// an older build's plain number, or a mode that can't be read: put back as before
	const o = tv(30); o.st.saved = 75; o.io.mode = () => Promise.resolve(null);
	backlightSaver(o.io).restore(); await o.flush();
	assert.deepEqual(o.st.sets, [75]);
});

const png = (extra = '') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(String(extra))]);
const modeOf = (p) => execFileSync('sh', ['-c', `stat -c %a '${p}'`], {encoding: 'utf8'}).trim();
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

/** runs the link-safe bar write in `dir`. `roots`, when set, is treated as an app-folder root so an icon under it can be copied. */
function runSync (dir, {sig = 'abc', json = {v: 1, title: 'a "b"'}, icons = [], hook = '', roots = null, full = false} = {}) {
	let script = syncBarShell(dir, sig, b64(json), icons);
	// every icon's resolvedPath embeds the app-root list; one replace would only retarget the first icon
	if (roots) script = script.split(APP_ROOTS_CASE).join(roots + '/*');
	const out = execFileSync('sh', ['-c', hook + script], {encoding: 'utf8'}).replace(/\s+$/, '');
	// skip lines come before the status word
	return full ? out : (out.split('\n').pop() || '').trim();
}

test('syncBar: a reply that is not exactly one status word is never a successful write', () => {
	for (const s of ['written', 'written\n', 'noise\nwritten', 'skip netflix unresolved\nwritten']) assert.equal(syncBarResult(s), 'written');
	assert.equal(syncBarResult('same'), 'same');
	assert.equal(syncBarResult('missing'), 'missing');
	assert.equal(syncBarResult('refused'), 'refused');
	assert.equal(syncBarResult('busy'), 'busy');
	assert.equal(syncBarResult('skip a unresolved\nbusy'), 'busy');
	for (const s of ['', 'oops', 'written extra', 'not written', 'busy extra']) assert.equal(syncBarResult(s), 'refused', JSON.stringify(s));
});

test('syncBar: bar.json and sig round-trip, a matching sig is left alone, wallpapers stay, and the shell never removes recursively', () => {
	const bar = mkdtempSync(join(tmpdir(), 'sync-bar-'));
	const root = mkdtempSync(join(tmpdir(), 'sync-apps-'));
	mkdirSync(join(root, 'app'), {recursive: true});
	const bytes = png('png-bytes');
	writeFileSync(join(root, 'app', 'icon.png'), bytes);
	const secret = join(root, 'secret');
	writeFileSync(secret, 'secret');
	symlinkSync(secret, join(root, 'app', 'leak.png'));
	mkdirSync(join(bar, 'data', 'wallpapers'), {recursive: true});
	writeFileSync(join(bar, 'data', 'wallpapers', 'keep'), 'pic');
	chmodSync(join(bar, 'data', 'wallpapers', 'keep'), 0o600);
	chmodSync(join(bar, 'data', 'wallpapers'), 0o700);
	mkdirSync(join(bar, 'data', 'icons', 'keepdir'), {recursive: true});
	writeFileSync(join(bar, 'data', 'icons', 'keepdir', 'f'), 'stay');
	writeFileSync(join(bar, 'data', 'icons', 'old.png'), 'old');
	const icons = [{src: join(root, 'app', 'icon.png'), name: 'yt.png'}, {src: join(root, 'app', 'leak.png'), name: 'leak.png'}];
	const script = syncBarShell(bar, 'abc', b64({v: 1}), icons);
	assert.doesNotMatch(script, /rm -[a-z]*r/);
	assert.doesNotMatch(script, /wallpapers/);
	const first = runSync(bar, {icons, roots: join(root, 'app'), json: {v: 1, title: 'a "b"'}, full: true});
	assert.equal(first.split('\n').pop(), 'written');
	assert.match(first, /skip leak\.png outside/);
	const data = join(bar, 'data');
	assert.equal(JSON.parse(read(join(data, 'bar.json'))).title, 'a "b"');
	// the link resolves outside the app folder: signed, so the same list answers "same" and is not rewritten
	assert.equal(read(join(data, 'sig')), 'abc-p\n');
	assert.equal(runSync(bar, {icons, roots: join(root, 'app'), json: {v: 1, title: 'a "b"'}}), 'same');
	assert.equal(Buffer.compare(readFileSync(join(data, 'icons', 'yt.png')), bytes), 0);
	assert.equal(modeOf(join(data, 'icons', 'yt.png')), '644');
	assert.equal(read(join(data, 'icons', 'leak.png')), null);
	assert.equal(read(secret), 'secret');
	assert.equal(read(join(data, 'icons', 'old.png')), null);
	assert.equal(read(join(data, 'icons', 'keepdir', 'f')), 'stay');
	assert.equal(read(join(data, 'wallpapers', 'keep')), 'pic');
	assert.equal(modeOf(join(data, 'wallpapers', 'keep')), '600');
	assert.equal(modeOf(join(data, 'wallpapers')), '700');
	assert.equal(lstatSync(join(data, 'icons', 'yt.png')).isSymbolicLink(), false);
	const only = [icons[0]];
	assert.equal(runSync(bar, {sig: 'abd', icons: only, roots: join(root, 'app'), json: {v: 1, title: 'a "b"'}}), 'written');
	assert.equal(read(join(data, 'sig')), 'abd\n');
	writeFileSync(join(root, 'app', 'icon.png'), png('changed'));
	assert.equal(runSync(bar, {sig: 'abd', icons: only, roots: join(root, 'app')}), 'same');
	assert.equal(Buffer.compare(readFileSync(join(data, 'icons', 'yt.png')), bytes), 0);
	const rootSrc = readFileSync(new URL('../../app/src/lib/root.ts', import.meta.url), 'utf8');
	assert.match(rootSrc, /syncBarShell\(dir, sig, toBase64\(json\), icons\)/);
	assert.doesNotMatch(rootSrc, /rm -rf \$\{dir\}/);
	assert.doesNotMatch(rootSrc, /cat \$\{dir\}\/data\/sig/);
	assert.doesNotMatch(rootSrc, /> \$\{dir\}\/data\/bar\.json/);
});

test('syncBar: a link at data, icons, bar.json or sig is never written through, and a missing bar folder is missing', () => {
	assert.equal(runSync(join(tmpdir(), 'sync-no-such-bar')), 'missing');
	const planted = (at) => {
		const bar = mkdtempSync(join(tmpdir(), 'sync-link-'));
		const victim = mkdtempSync(join(tmpdir(), 'sync-victim-'));
		writeFileSync(join(victim, 'keep'), 'keep');
		chmodSync(join(victim, 'keep'), 0o600);
		chmodSync(victim, 0o700);
		mkdirSync(join(bar, 'data'), {recursive: true});
		const link = at === 'data' ? join(bar, 'data') : join(bar, 'data', at);
		if (at === 'data') execFileSync('rm', ['-rf', link]);
		symlinkSync(at === 'icons' || at === 'data' ? victim : join(victim, 'keep'), link);
		const status = runSync(bar, {json: {v: 1, title: 'new'}});
		assert.equal(read(join(victim, 'keep')), 'keep', at);
		assert.equal(modeOf(join(victim, 'keep')), '600', at);
		assert.equal(modeOf(victim), '700', at);
		assert.equal(status, 'written', at);
		if (at === 'bar.json' || at === 'sig') assert.equal(lstatSync(link).isSymbolicLink(), false, at);
		return status;
	};
	for (const at of ['bar.json', 'sig', 'icons', 'data']) planted(at);
	const bar = mkdtempSync(join(tmpdir(), 'sync-siglink-'));
	mkdirSync(join(bar, 'data'), {recursive: true});
	const secret = join(bar, 'secret');
	writeFileSync(secret, 'abc\n');
	chmodSync(secret, 0o600);
	symlinkSync(secret, join(bar, 'data', 'sig'));
	assert.equal(runSync(bar, {sig: 'abc'}), 'written');
	assert.equal(read(secret), 'abc\n');
	assert.equal(modeOf(secret), '600');
	assert.equal(lstatSync(join(bar, 'data', 'sig')).isSymbolicLink(), false);
	const dirLink = mkdtempSync(join(tmpdir(), 'sync-dirlink-'));
	const dest = mkdtempSync(join(tmpdir(), 'sync-dirdest-'));
	writeFileSync(join(dest, 'keep'), 'keep');
	mkdirSync(join(dirLink, 'data'), {recursive: true});
	symlinkSync(dest, join(dirLink, 'data', 'bar.json'));
	assert.equal(runSync(dirLink), 'written');
	assert.equal(read(join(dest, 'keep')), 'keep');
	assert.equal(read(join(dest, '.bar.json.new')), null);
	assert.equal(lstatSync(join(dirLink, 'data', 'bar.json')).isSymbolicLink(), false);
	const asDir = mkdtempSync(join(tmpdir(), 'sync-asdir-'));
	mkdirSync(join(asDir, 'data', 'bar.json'), {recursive: true});
	writeFileSync(join(asDir, 'data', 'bar.json', 'keep'), 'keep');
	assert.equal(runSync(asDir), 'refused');
	assert.equal(read(join(asDir, 'data', 'bar.json', 'keep')), 'keep');
	assert.equal(read(join(asDir, 'data', 'bar.json', '.bar.json.new')), null);
	const iconDir = mkdtempSync(join(tmpdir(), 'sync-icondir-'));
	const src = mkdtempSync(join(tmpdir(), 'sync-icondir-src-'));
	mkdirSync(join(src, 'app'), {recursive: true});
	writeFileSync(join(src, 'app', 'icon.png'), 'png');
	mkdirSync(join(iconDir, 'data', 'icons', 'yt.png'), {recursive: true});
	writeFileSync(join(iconDir, 'data', 'icons', 'yt.png', 'keep'), 'keep');
	assert.equal(runSync(iconDir, {icons: [{src: join(src, 'app', 'icon.png'), name: 'yt.png'}], roots: src}), 'refused');
	assert.equal(read(join(iconDir, 'data', 'icons', 'yt.png', 'keep')), 'keep');
});

test('syncBar: a busybox without id takes the writer as root, as the watcher does, rather than refusing every write', () => {
	// the folders are this user's, so the owner checks pass only when `me` matches: with id gone they must still, which the stat hook
	// makes true by answering 0 for everything (on the TV both are root)
	const bar = mkdtempSync(join(tmpdir(), 'sync-noid-'));
	const noId = 'id () { echo "id: applet not found" >&2; return 127; }\nstat () { case "$*" in *%u*) echo 0 ;; *) command stat "$@" ;; esac; }\n';
	assert.equal(runSync(bar, {hook: noId}), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'abc\n');
	// an id that answers something odd is not taken as a uid either
	const odd = mkdtempSync(join(tmpdir(), 'sync-oddid-'));
	assert.equal(runSync(odd, {hook: 'id () { echo "uid=0(root)"; }\nstat () { case "$*" in *%u*) echo 0 ;; *) command stat "$@" ;; esac; }\n'}), 'written');
	// and with id working, a folder of another user is still refused (the stat hook says 4242 for data)
	const theirs = mkdtempSync(join(tmpdir(), 'sync-theirs-'));
	mkdirSync(join(theirs, 'data'));
	assert.equal(runSync(theirs, {hook: 'stat () { case "$*" in *%u*data) echo 4242 ;; *) command stat "$@" ;; esac; }\n'}), 'refused');
	assert.match(readFileSync(new URL('../../app/src/app.tsx', import.meta.url), 'utf8'), /r === 'refused'\) logError\('bar'/);
});

test('syncBar: a data or icons folder that is not ours is left alone, and a link swapped in at mkdir is not entered', () => {
	const rmLog = join(mkdtempSync(join(tmpdir(), 'sync-rm-')), 'rm');
	const hookRm = `rm () { case "$1" in -r*|-*r*) echo "$*" >> '${rmLog}' ;; esac; command rm "$@"; }\n`;
	const foreign = (which) => {
		const bar = mkdtempSync(join(tmpdir(), 'sync-own-'));
		mkdirSync(join(bar, 'data', 'icons'), {recursive: true});
		mkdirSync(join(bar, 'data', 'wallpapers'), {recursive: true});
		writeFileSync(join(bar, 'data', 'icons', 'keep'), 'keep');
		writeFileSync(join(bar, 'data', 'wallpapers', 'pic'), 'pic');
		chmodSync(join(bar, 'data', 'icons'), 0o700);
		const stat = `stat () { case "$*" in *%u*${which}) echo 4242 ;; *) command stat "$@" ;; esac; }\n`;
		assert.equal(runSync(bar, {hook: hookRm + stat}), 'refused');
		assert.equal(read(join(bar, 'data', 'icons', 'keep')), 'keep');
		assert.equal(read(join(bar, 'data', 'wallpapers', 'pic')), 'pic');
		assert.equal(modeOf(join(bar, 'data', 'icons')), '700');
		assert.equal(read(join(bar, 'data', 'bar.json')), null);
	};
	foreign('data');
	foreign('icons');
	assert.throws(() => readFileSync(rmLog), undefined, 'no recursive remove');
	const bar = mkdtempSync(join(tmpdir(), 'sync-swap-'));
	const victim = mkdtempSync(join(tmpdir(), 'sync-swap-victim-'));
	writeFileSync(join(victim, 'keep'), 'keep');
	chmodSync(join(victim, 'keep'), 0o600);
	chmodSync(victim, 0o700);
	const mkdirHook = `mkdir () { command mkdir "$@"; for a; do case "$a" in data|icons) command rm -rf "$a"; ln -s '${victim}' "$a" ;; esac; done; }\n`;
	assert.equal(runSync(bar, {hook: mkdirHook}), 'refused');
	assert.equal(read(join(victim, 'keep')), 'keep');
	assert.equal(modeOf(victim), '700');
	assert.equal(modeOf(join(victim, 'keep')), '600');
	const parent = mkdtempSync(join(tmpdir(), 'sync-parent-'));
	const real = join(parent, 'real');
	mkdirSync(real);
	symlinkSync(real, join(parent, 'link'));
	assert.equal(runSync(join(parent, 'link', 'bar')), 'missing');
	mkdirSync(join(parent, 'link', 'bar'));
	assert.equal(runSync(join(parent, 'link', 'bar')), 'written');
	assert.equal(read(join(real, 'bar', 'data', 'sig')), 'abc\n');
	const via = mkdtempSync(join(tmpdir(), 'sync-via-'));
	mkdirSync(join(via, 'realbar'));
	symlinkSync(join(via, 'realbar'), join(via, 'bar'));
	writeFileSync(join(via, 'realbar', 'keep'), 'keep');
	assert.equal(runSync(join(via, 'bar')), 'refused');
	assert.equal(read(join(via, 'realbar', 'keep')), 'keep');
	assert.equal(read(join(via, 'realbar', 'data', 'bar.json')), null);
});

test('syncBar: a picture swapped for a link while it is copied is not kept, and its target is not chmodded', () => {
	const root = mkdtempSync(join(tmpdir(), 'sync-src-'));
	const bar = mkdtempSync(join(tmpdir(), 'sync-dst-'));
	mkdirSync(join(root, 'app'), {recursive: true});
	writeFileSync(join(root, 'app', 'icon.png'), png('png'));
	const secret = join(root, 'secret');
	writeFileSync(secret, 'secret');
	chmodSync(secret, 0o600);
	const hook = `cp () { command cp "$@"; rm -f -- .n."$t"; ln -s '${secret}' .n."$t"; }\n`;
	assert.equal(runSync(bar, {icons: [{src: join(root, 'app', 'icon.png'), name: 'yt.png'}], roots: root, hook}), 'written');
	assert.equal(modeOf(secret), '600');
	assert.equal(read(secret), 'secret');
	assert.equal(read(join(bar, 'data', 'icons', 'yt.png')), null);
	const pre = mkdtempSync(join(tmpdir(), 'sync-pre-'));
	mkdirSync(join(pre, 'data'), {recursive: true});
	const target = join(pre, 'target');
	writeFileSync(target, 'secret');
	chmodSync(target, 0o600);
	symlinkSync(target, join(pre, 'data', '.bar.json.new'));
	assert.equal(runSync(pre), 'written');
	assert.equal(read(target), 'secret');
	assert.equal(modeOf(target), '600');
	assert.equal(lstatSync(join(pre, 'data', 'bar.json')).isSymbolicLink(), false);
	assert.equal(JSON.parse(read(join(pre, 'data', 'bar.json'))).v, 1);
});

test('syncBar: C8 developer and cryptofs icons are copied, including an app outside the first boot sample, and a miss is not listed', () => {
	// the paths the C8 actually has. /media is not writable here, so the copy runs on a mirror of the same suffixes.
	const real = {
		moonfin: '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon-130.png',
		music: '/media/cryptofs/apps/usr/palm/applications/com.theadelab.amclient-lg/largeIcon.png',
		netflix: '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png',
		iplayer: '/media/cryptofs/apps/usr/palm/applications/bbc.iplayer.3.0/icon.png',
		evil: '/media/developer/apps/usr/palm/applications/org.evil.app/icon.png'
	};
	for (const p of Object.values(real)) assert.equal(safeAppPath(p), true, p);
	const base = mkdtempSync(join(tmpdir(), 'sync-c8-'));
	const mirror = (p) => join(base, p.replace(/^\//, ''));
	const bar = join(base, 'bar');
	mkdirSync(bar);
	for (const key of ['moonfin', 'music', 'netflix']) {
		mkdirSync(dirname(mirror(real[key])), {recursive: true});
		writeFileSync(mirror(real[key]), png(key));
	}
	const secret = join(base, 'secret');
	writeFileSync(secret, 'secret');
	chmodSync(secret, 0o600);
	mkdirSync(dirname(mirror(real.evil)), {recursive: true});
	symlinkSync(secret, mirror(real.evil));
	const icons = [
		{src: mirror(real.moonfin), name: 'org.moonfin.webos.png', id: 'org.moonfin.webos'},
		{src: mirror(real.music), name: 'com.theadelab.amclient-lg.png', id: 'com.theadelab.amclient-lg'},
		{src: mirror(real.netflix), name: 'netflix.png', id: 'netflix'},
		{src: mirror(real.iplayer), name: 'bbc.iplayer.3.0.png', id: 'bbc.iplayer.3.0'},
		{src: mirror(real.evil), name: 'org.evil.app.png', id: 'org.evil.app'}
	];
	const apps = {};
	for (const i of icons) apps[i.id] = {title: i.id, plain: true, icon: '~icon:' + i.name};
	const out = runSync(bar, {sig: 'c8sig', json: {v: 1, apps}, icons, roots: join(base, 'media'), full: true});
	assert.equal(out.split('\n').pop(), 'written');
	assert.match(out, /skip bbc\.iplayer\.3\.0 unresolved/);
	assert.match(out, /skip org\.evil\.app outside/);
	const got = JSON.parse(read(join(bar, 'data', 'bar.json')));
	assert.equal(got.apps['org.moonfin.webos'].icon, 'data/icons/org.moonfin.webos.png?c8sig');
	assert.equal(got.apps['com.theadelab.amclient-lg'].icon, 'data/icons/com.theadelab.amclient-lg.png?c8sig');
	assert.equal(got.apps.netflix.icon, 'data/icons/netflix.png?c8sig');
	assert.equal(got.apps['bbc.iplayer.3.0'].icon, null);
	assert.equal(got.apps['org.evil.app'].icon, null);
	assert.equal(readFileSync(join(bar, 'data', 'icons', 'org.moonfin.webos.png')).includes(Buffer.from('moonfin')), true);
	assert.equal(readFileSync(join(bar, 'data', 'icons', 'com.theadelab.amclient-lg.png')).includes(Buffer.from('music')), true);
	assert.equal(readFileSync(join(bar, 'data', 'icons', 'netflix.png')).includes(Buffer.from('netflix')), true);
	assert.equal(read(join(bar, 'data', 'icons', 'bbc.iplayer.3.0.png')), null);
	assert.equal(read(join(bar, 'data', 'icons', 'org.evil.app.png')), null);
	assert.equal(read(secret), 'secret');
	assert.equal(modeOf(secret), '600');
	assert.equal(Object.hasOwn(got.apps, 'youtube.leanback.v4'), false);
	// a missing file is signed -r once, then -p, so it is not rewritten on every start. The link out is outside.
	assert.equal(read(join(bar, 'data', 'sig')), 'c8sig-r\n');
	assert.equal(runSync(bar, {sig: 'c8sig', json: {v: 1, apps}, icons, roots: join(base, 'media')}), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'c8sig-p\n');
	assert.equal(runSync(bar, {sig: 'c8sig', json: {v: 1, apps}, icons, roots: join(base, 'media')}), 'same');
});

test('syncBar: the icon token is replaced as a whole, in any key order, and a bad picture is left null', () => {
	const base = mkdtempSync(join(tmpdir(), 'sync-tok-'));
	const app = join(base, 'app');
	const bar = join(base, 'bar');
	mkdirSync(app);
	mkdirSync(bar);
	writeFileSync(join(app, 'a.png'), png('A'));
	writeFileSync(join(app, 'along.png'), png('B'));
	writeFileSync(join(app, 'text.png'), Buffer.from('not an image'));
	const icons = [
		{src: join(app, 'a.png'), name: 'a.png', id: 'a'},
		{src: join(app, 'along.png'), name: 'a.png.png', id: 'a.png'},
		{src: join(app, 'text.png'), name: 'text.png', id: 'text'}
	];
	// icon is not the last key, and "a.png" is a prefix of "a.png.png"
	const json = {v: 1, apps: {
		a: {icon: '~icon:a.png', title: 'A'},
		'a.png': {icon: '~icon:a.png.png', title: 'Long'},
		text: {icon: '~icon:text.png', title: 'Text', plain: true}
	}};
	const out = runSync(bar, {sig: 'tok1', json, icons, roots: app, full: true});
	assert.equal(out.split('\n').pop(), 'written');
	assert.match(out, /skip text not-image/);
	const got = JSON.parse(read(join(bar, 'data', 'bar.json')));
	assert.equal(got.apps.a.icon, 'data/icons/a.png?tok1');
	assert.equal(got.apps.a.title, 'A');
	assert.equal(got.apps['a.png'].icon, 'data/icons/a.png.png?tok1');
	assert.equal(got.apps.text.icon, null);
	assert.equal(got.apps.text.title, 'Text');
	assert.equal(read(join(bar, 'data', 'sig')), 'tok1-p\n');
	// a title that is the token text is not an icon field, so it stays
	const titled = {v: 1, apps: {a: {title: '~icon:a.png', icon: '~icon:a.png'}}};
	const bar2 = join(base, 'bar2');
	mkdirSync(bar2);
	assert.equal(runSync(bar2, {sig: 'tok2', json: titled, icons: [icons[0]], roots: app}).split('\n').pop(), 'written');
	const got2 = JSON.parse(read(join(bar2, 'data', 'bar.json')));
	assert.equal(got2.apps.a.title, '~icon:a.png');
	assert.equal(got2.apps.a.icon, 'data/icons/a.png?tok2');
});

test('syncBar: a rewrite that yields no JSON is refused, and a huge file is not copied', () => {
	const base = mkdtempSync(join(tmpdir(), 'sync-empty-'));
	const app = join(base, 'app');
	const bar = join(base, 'bar');
	mkdirSync(join(app));
	mkdirSync(join(bar, 'data'), {recursive: true});
	writeFileSync(join(bar, 'data', 'bar.json'), '{"v":1,"keep":true}');
	writeFileSync(join(bar, 'data', 'sig'), 'old\n');
	writeFileSync(join(app, 'icon.png'), png('ok'));
	const icons = [{src: join(app, 'icon.png'), name: 'a.png', id: 'a'}];
	const json = {v: 1, apps: {a: {title: 'A', icon: '~icon:a.png'}}};
	assert.equal(runSync(bar, {icons, json, roots: app, hook: 'sed () { return 1; }\n'}), 'refused');
	assert.equal(JSON.parse(read(join(bar, 'data', 'bar.json'))).keep, true);
	assert.equal(read(join(bar, 'data', 'sig')), 'old\n');
	const huge = mkdtempSync(join(tmpdir(), 'sync-huge-'));
	const happ = join(huge, 'app');
	const hbar = join(huge, 'bar');
	mkdirSync(happ);
	mkdirSync(hbar);
	writeFileSync(join(happ, 'icon.png'), png('ok'));
	// the source is a small PNG. Only the copied file's size is reported huge, so the check has to be on .new.
	const hook = 'stat () { if [ "$1" = -c ] && [ "$2" = %s ] && [ "$3" != "$r" ]; then echo 2000000; return; fi; command stat "$@"; }\n';
	const hout = runSync(hbar, {icons: [{src: join(happ, 'icon.png'), name: 'a.png', id: 'a'}], json, roots: happ, hook, full: true});
	assert.match(hout, /skip a toobig/);
	assert.equal(hout.split('\n').pop(), 'written');
	assert.equal(JSON.parse(read(join(hbar, 'data', 'bar.json'))).apps.a.icon, null);
	assert.equal(read(join(hbar, 'data', 'icons', 'a.png')), null);
	assert.equal(read(join(hbar, 'data', 'sig')), 'abc-p\n');
	assert.equal(runSync(hbar, {icons: [{src: join(happ, 'icon.png'), name: 'a.png', id: 'a'}], json, roots: happ, hook}), 'same');
});

const webp = (extra = '') => Buffer.concat([Buffer.from('RIFF'), Buffer.from([16, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from(String(extra))]);

test('syncBar: a missing file is copied once it appears, a non-image is signed once, and WebP is copied', () => {
	const base = mkdtempSync(join(tmpdir(), 'sync-perm-'));
	const app = join(base, 'app');
	const bar = join(base, 'bar');
	mkdirSync(app);
	mkdirSync(bar);
	const missing = [{src: join(app, 'gone.png'), name: 'a.png', id: 'a'}];
	const json = {v: 1, apps: {a: {title: 'A', icon: '~icon:a.png'}}};
	assert.equal(runSync(bar, {sig: 'abc', json, icons: missing, roots: app}), 'written');
	assert.equal(JSON.parse(read(join(bar, 'data', 'bar.json'))).apps.a.icon, null);
	assert.equal(read(join(bar, 'data', 'sig')), 'abc-r\n');
	assert.equal(runSync(bar, {sig: 'abc', json, icons: missing, roots: app}), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'abc-p\n');
	assert.equal(runSync(bar, {sig: 'abc', json, icons: missing, roots: app}), 'same');
	const laterBar = join(base, 'later');
	mkdirSync(laterBar);
	assert.equal(runSync(laterBar, {sig: 'lat', json, icons: missing, roots: app}), 'written');
	assert.equal(read(join(laterBar, 'data', 'sig')), 'lat-r\n');
	writeFileSync(join(app, 'gone.png'), png('later'));
	assert.equal(runSync(laterBar, {sig: 'lat', json, icons: missing, roots: app}), 'written');
	assert.equal(JSON.parse(read(join(laterBar, 'data', 'bar.json'))).apps.a.icon, 'data/icons/a.png?lat');
	assert.equal(readFileSync(join(laterBar, 'data', 'icons', 'a.png')).includes(Buffer.from('later')), true);
	assert.equal(read(join(laterBar, 'data', 'sig')), 'lat\n');
	// a stored -p with a different request sig rewrites, and the new sig has no -p
	writeFileSync(join(app, 'bad.png'), Buffer.from('not an image'));
	const bad = [{src: join(app, 'bad.png'), name: 'b.png', id: 'b'}];
	const badJson = {v: 1, apps: {b: {title: 'B', icon: '~icon:b.png'}}};
	assert.equal(runSync(bar, {sig: 'abd', json: badJson, icons: bad, roots: app}), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'abd-p\n');
	assert.equal(runSync(bar, {sig: 'abe', json, icons: missing, roots: app}), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'abe\n');
	assert.equal(JSON.parse(read(join(bar, 'data', 'bar.json'))).apps.a.icon, 'data/icons/a.png?abe');
	// a clean list, then a permanent skip, stores -p
	assert.equal(runSync(bar, {sig: 'abf', json, icons: missing, roots: app}), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'abf\n');
	assert.equal(runSync(bar, {sig: 'abg', json: badJson, icons: bad, roots: app}), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'abg-p\n');
	// a failed copy next to a non-image leaves no signature, so the copy is tried again
	const mixBar = join(base, 'mix');
	mkdirSync(mixBar);
	writeFileSync(join(app, 'ok.png'), png('ok'));
	const mixHook = 'cp () { case "$3" in */ok.png) return 1 ;; esac; command cp "$@"; }\n';
	const mixIcons = [{src: join(app, 'ok.png'), name: 'a.png', id: 'a'}, {src: join(app, 'bad.png'), name: 'b.png', id: 'b'}];
	const mixJson = {v: 1, apps: {a: {title: 'A', icon: '~icon:a.png'}, b: {title: 'B', icon: '~icon:b.png'}}};
	assert.equal(runSync(mixBar, {sig: 'abh', json: mixJson, icons: mixIcons, roots: app, hook: mixHook}), 'written');
	assert.equal(read(join(mixBar, 'data', 'sig')), null);
	const copyBar = join(base, 'copy');
	mkdirSync(copyBar);
	writeFileSync(join(app, 'ok.png'), png('ok'));
	const hook = 'cp () { return 1; }\n';
	const copyIcons = [{src: join(app, 'ok.png'), name: 'a.png', id: 'a'}];
	assert.equal(runSync(copyBar, {sig: 'abc', json, icons: copyIcons, roots: app, hook}), 'written');
	assert.equal(read(join(copyBar, 'data', 'sig')), null);
	assert.equal(runSync(copyBar, {sig: 'abc', json, icons: copyIcons, roots: app, hook}), 'written');
	assert.equal(read(join(copyBar, 'data', 'sig')), null);
	const pack = join(base, 'pack');
	const packBar = join(base, 'packbar');
	mkdirSync(pack);
	mkdirSync(packBar);
	writeFileSync(join(pack, 'tile.webp'), webp('tile'));
	writeFileSync(join(pack, 'fake.webp'), Buffer.concat([Buffer.from('RIFF'), Buffer.from([16, 0, 0, 0]), Buffer.from('XXXX')]));
	const packJson = {v: 1, apps: {tile: {title: 'Tile', icon: '~icon:tile.webp'}, fake: {title: 'Fake', icon: '~icon:fake.webp'}}};
	const packIcons = [
		{src: join(pack, 'tile.webp'), name: 'tile.webp', id: 'tile'},
		{src: join(pack, 'fake.webp'), name: 'fake.webp', id: 'fake'}
	];
	const pout = runSync(packBar, {sig: 'wp1', json: packJson, icons: packIcons, roots: pack, full: true});
	assert.equal(pout.split('\n').pop(), 'written');
	assert.match(pout, /skip fake not-image/);
	const pgot = JSON.parse(read(join(packBar, 'data', 'bar.json')));
	assert.equal(pgot.apps.tile.icon, 'data/icons/tile.webp?wp1');
	assert.equal(pgot.apps.fake.icon, null);
	assert.equal(readFileSync(join(packBar, 'data', 'icons', 'tile.webp')).includes(Buffer.from('WEBP')), true);
	assert.equal(read(join(packBar, 'data', 'sig')), 'wp1-p\n');
	assert.equal(runSync(packBar, {sig: 'wp1', json: packJson, icons: packIcons, roots: pack}), 'same');
	const again = join(base, 'again');
	mkdirSync(again);
	writeFileSync(join(app, 'a.png'), png('kept'));
	const keepJson = {v: 1, apps: {a: {title: 'A', icon: '~icon:a.png'}}};
	const keepIcons = [{src: join(app, 'a.png'), name: 'a.png', id: 'a'}];
	assert.equal(runSync(again, {sig: 'k1', json: keepJson, icons: keepIcons, roots: app}), 'written');
	writeFileSync(join(app, 'a.png'), Buffer.from('not an image'));
	assert.equal(runSync(again, {sig: 'k2', json: keepJson, icons: keepIcons, roots: app}), 'written');
	const kept = JSON.parse(read(join(again, 'data', 'bar.json')));
	assert.equal(kept.apps.a.icon, 'data/icons/a.png?k2');
	assert.equal(readFileSync(join(again, 'data', 'icons', 'a.png')).includes(Buffer.from('kept')), true);
	assert.equal(read(join(again, 'data', 'sig')), 'k2-p\n');
});

test('syncBar: a folder is a miss, a link is signed without readlink, and a failed sig move leaves no signature', () => {
	const base = mkdtempSync(join(tmpdir(), 'sync-fold-'));
	const app = join(base, 'app');
	const bar = join(base, 'bar');
	mkdirSync(app);
	mkdirSync(join(app, 'icon.png'));
	mkdirSync(bar);
	const icons = [{src: join(app, 'icon.png'), name: 'a.png', id: 'a'}];
	const json = {v: 1, apps: {a: {title: 'A', icon: '~icon:a.png'}}};
	const fold = runSync(bar, {sig: 'abc', json, icons, roots: app, full: true});
	assert.match(fold, /skip a unresolved/);
	assert.equal(fold.split('\n').pop(), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'abc-r\n');
	const fold2 = runSync(bar, {sig: 'abc', json, icons, roots: app, full: true});
	assert.match(fold2, /skip a unresolved/);
	assert.equal(fold2.split('\n').pop(), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'abc-p\n');
	const linkBar = join(base, 'link');
	mkdirSync(linkBar);
	const secret = join(base, 'secret');
	writeFileSync(secret, png('no'));
	symlinkSync(secret, join(app, 'leak.png'));
	const linkIcons = [{src: join(app, 'leak.png'), name: 'b.png', id: 'b'}];
	const linkJson = {v: 1, apps: {b: {title: 'B', icon: '~icon:b.png'}}};
	const linked = runSync(linkBar, {sig: 'lnk', json: linkJson, icons: linkIcons, roots: app, hook: 'readlink () { return 1; }\n', full: true});
	assert.match(linked, /skip b outside/);
	assert.equal(read(join(linkBar, 'data', 'sig')), 'lnk-p\n');
	assert.equal(runSync(linkBar, {sig: 'lnk', json: linkJson, icons: linkIcons, roots: app, hook: 'readlink () { return 1; }\n'}), 'same');
	const moveBar = join(base, 'move');
	mkdirSync(moveBar);
	writeFileSync(join(app, 'ok.png'), png('ok'));
	const moveIcons = [{src: join(app, 'ok.png'), name: 'c.png', id: 'c'}];
	const moveJson = {v: 1, apps: {c: {title: 'C', icon: '~icon:c.png'}}};
	const moveHook = 'mv () { case "$3" in .sig.*) return 1 ;; esac; command mv "$@"; }\n';
	assert.equal(runSync(moveBar, {sig: 'mov', json: moveJson, icons: moveIcons, roots: app, hook: moveHook}), 'refused');
	assert.equal(read(join(moveBar, 'data', 'sig')), null);
	assert.equal(runSync(moveBar, {sig: 'mov', json: moveJson, icons: moveIcons, roots: app}), 'written');
	assert.equal(read(join(moveBar, 'data', 'sig')), 'mov\n');
	assert.equal(JSON.parse(read(join(moveBar, 'data', 'bar.json'))).apps.c.icon, 'data/icons/c.png?mov');
});

test('syncBar: a live lock answers busy and signs nothing, and a stale lock is taken over', () => {
	const dead = '99999999';
	assert.throws(() => execFileSync('sh', ['-c', 'kill -0 ' + dead], {stdio: 'ignore'}));
	const base = mkdtempSync(join(tmpdir(), 'sync-lock-'));
	const app = join(base, 'app');
	const held = join(base, 'held');
	mkdirSync(app);
	mkdirSync(join(held, 'data'), {recursive: true});
	writeFileSync(join(app, 'icon.png'), png('ok'));
	mkdirSync(join(held, 'data', '.lock'));
	writeFileSync(join(held, 'data', '.lock', 'p'), String(process.pid) + '\n');
	writeFileSync(join(held, 'data', 'sig'), 'old\n');
	writeFileSync(join(held, 'data', 'bar.json'), '{"keep":true}\n');
	const icons = [{src: join(app, 'icon.png'), name: 'a.png', id: 'a'}];
	const json = {v: 1, apps: {a: {title: 'A', icon: '~icon:a.png'}}};
	assert.equal(runSync(held, {sig: 'abc', json, icons, roots: app}), 'busy');
	assert.equal(read(join(held, 'data', 'sig')), 'old\n');
	assert.equal(read(join(held, 'data', 'bar.json')), '{"keep":true}\n');
	assert.equal(read(join(held, 'data', '.lock', 'p')), String(process.pid) + '\n');
	const fresh = join(base, 'fresh');
	mkdirSync(join(fresh, 'data', '.lock'), {recursive: true});
	writeFileSync(join(fresh, 'data', '.lock', 'p'), String(process.pid) + '\n');
	assert.equal(runSync(fresh, {sig: 'abc', json, icons, roots: app}), 'busy');
	assert.equal(read(join(fresh, 'data', 'sig')), null);
	assert.equal(read(join(fresh, 'data', 'bar.json')), null);
	const stale = join(base, 'stale');
	mkdirSync(join(stale, 'data', 'icons'), {recursive: true});
	mkdirSync(join(stale, 'data', '.lock'));
	writeFileSync(join(stale, 'data', '.lock', 'p'), dead + '\n');
	writeFileSync(join(stale, 'data', '.bar.' + dead), 'drop-bar');
	writeFileSync(join(stale, 'data', '.sig.' + dead), 'drop-sig');
	writeFileSync(join(stale, 'data', '.bar.' + process.pid), 'live-bar');
	writeFileSync(join(stale, 'data', '.sig.' + process.pid), 'live-sig');
	writeFileSync(join(stale, 'data', 'icons', '.n.' + process.pid), 'live-scratch');
	writeFileSync(join(stale, 'data', 'icons', '.png.' + dead), 'dead-scratch');
	assert.equal(runSync(stale, {sig: 'stl', json, icons, roots: app}), 'written');
	assert.equal(read(join(stale, 'data', 'sig')), 'stl\n');
	assert.equal(JSON.parse(read(join(stale, 'data', 'bar.json'))).apps.a.icon, 'data/icons/a.png?stl');
	let lockGone = false;
	try { lstatSync(join(stale, 'data', '.lock')); } catch { lockGone = true; }
	assert.equal(lockGone, true);
	assert.equal(read(join(stale, 'data', '.bar.' + dead)), null);
	assert.equal(read(join(stale, 'data', '.sig.' + dead)), null);
	assert.equal(read(join(stale, 'data', '.bar.' + process.pid)), 'live-bar');
	assert.equal(read(join(stale, 'data', '.sig.' + process.pid)), 'live-sig');
	assert.equal(read(join(stale, 'data', 'icons', '.n.' + process.pid)), 'live-scratch');
	assert.equal(read(join(stale, 'data', 'icons', '.png.' + dead)), null);
});

test('syncBar: a skipped copy removes the old signature, so going back to that list is not "same" with the skipped bar left in place', () => {
	const base = mkdtempSync(join(tmpdir(), 'sync-stale-'));
	const app = join(base, 'app');
	const bar = join(base, 'bar');
	mkdirSync(app);
	mkdirSync(bar);
	writeFileSync(join(app, 'ok.png'), png('ok'));
	writeFileSync(join(app, 'bad.png'), Buffer.from('not an image'));
	const ok = [{src: join(app, 'ok.png'), name: 'a.png', id: 'a'}];
	const jsonX = {v: 1, recent: ['x'], apps: {a: {title: 'A', icon: '~icon:a.png'}}};
	assert.equal(runSync(bar, {sig: 'sx', json: jsonX, icons: ok, roots: app}), 'written');
	assert.equal(read(join(bar, 'data', 'sig')), 'sx\n');
	const both = ok.concat([{src: join(app, 'bad.png'), name: 'b.png', id: 'b'}]);
	const jsonY = {v: 1, recent: ['y'], apps: {a: {title: 'A', icon: '~icon:a.png'}, b: {title: 'B', icon: '~icon:b.png'}}};
	assert.equal(runSync(bar, {sig: 'sy', json: jsonY, icons: both, roots: app}), 'written');
	assert.equal(JSON.parse(read(join(bar, 'data', 'bar.json'))).recent[0], 'y');
	assert.equal(read(join(bar, 'data', 'sig')), 'sy-p\n');
	assert.equal(runSync(bar, {sig: 'sx', json: jsonX, icons: ok, roots: app}), 'written');
	assert.equal(JSON.parse(read(join(bar, 'data', 'bar.json'))).recent[0], 'x');
	assert.equal(read(join(bar, 'data', 'sig')), 'sx\n');
});

test('backlight: a value still saved for another picture mode leaves this one undimmed (else it stayed dim with nothing saved for it)', async () => {
	let mode = 'cinema';
	const t = tv(80); t.st.saved = {level: 100, mode: 'hdrCinema'}; t.io.mode = () => Promise.resolve(mode);
	const b = backlightSaver(t.io);
	b.dim(30, () => true); b.restore(); await t.flush();
	assert.deepEqual(t.st.sets, []);
	assert.equal(t.st.level, 80);
	assert.deepEqual(t.st.saved, {level: 100, mode: 'hdrCinema'});
	mode = null;   // unreadable: not lowered either
	b.dim(30, () => true); await t.flush();
	assert.deepEqual(t.st.sets, []);
	// the saved value's own mode (its restore never landed), or an older build's number: lowered, the saved value kept
	mode = 'hdrCinema';
	b.dim(30, () => true); await t.flush();
	assert.deepEqual(t.st.sets, [30]);
	assert.deepEqual(t.st.saved, {level: 100, mode: 'hdrCinema'});
	const n = tv(80); n.st.saved = 70; n.io.mode = () => Promise.resolve('vivid');
	backlightSaver(n.io).dim(30, () => true); await n.flush();
	assert.deepEqual(n.st.sets, [30]);
	assert.equal(n.st.saved, 70);
});

test('backlight: a screensaver that ends while the picture mode is still being read is not lowered, and nothing is saved', async () => {
	const t = tv(80);
	let on = true;
	t.io.mode = () => new Promise((resolve) => t.st.pending.push(() => resolve('cinema')));
	const b = backlightSaver(t.io);
	b.dim(30, () => on);
	await new Promise((r) => setImmediate(r));
	t.st.pending.shift()();   // the backlight read is back; the mode read is still out
	await new Promise((r) => setImmediate(r));
	on = false;
	t.st.pending.shift()();   // the mode read comes back after the screensaver has gone
	await t.flush();
	assert.deepEqual(t.st.sets, []);
	assert.equal(t.st.saved, null);
	assert.equal(t.st.level, 80);
});
