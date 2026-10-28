// node --test tools/test/*.test.mjs: app/src/lib/checks.ts (icon paths read as root, the Immich server), lib/launchParams.ts launchAction and
// lib/backlightSaver.ts, each turned into JS by esbuild (they have no imports)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const load = async (f) => import('data:text/javascript,' + encodeURIComponent(transformSync(readFileSync(new URL(`../../app/src/lib/${f}`, import.meta.url), 'utf8'), {loader: 'ts', format: 'esm'}).code));
const {safeAppPath, immichServer, APP_ROOTS_CASE, keepOnly} = await load('checks.ts');
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
