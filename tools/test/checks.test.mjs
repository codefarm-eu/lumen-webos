// node --test tools/test/*.test.mjs: app/src/lib/checks.ts (icon paths read as root, the Immich server), lib/launchParams.ts launchAction and
// lib/backlightSaver.ts, each turned into JS by esbuild (they have no imports)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const load = async (f) => import('data:text/javascript,' + encodeURIComponent(transformSync(readFileSync(new URL(`../../app/src/lib/${f}`, import.meta.url), 'utf8'), {loader: 'ts', format: 'esm'}).code));
const {safeAppPath, immichServer, APP_ROOTS_CASE, keepOnly, shaCheck, resolvedPath} = await load('checks.ts');
const {launchAction} = await load('launchParams.ts');
const {backlightSaver} = await load('backlightSaver.ts');

test('icon paths: only plain paths under the app folders, no "." or ".." segments', () => {
	assert.equal(safeAppPath('/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon.png'), true);
	assert.equal(safeAppPath('/usr/palm/applications/com.webos.app.hdmi1/icon.png'), true);
	assert.equal(safeAppPath('/media/cryptofs/apps/usr/palm/applications/youtube.leanback.v4/largeIcon.png'), true);
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
