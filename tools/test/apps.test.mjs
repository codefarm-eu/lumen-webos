// node --test tools/test/*.test.mjs: app/src/lib/apps.ts listApps and its icon cache, bundled by esbuild with the TV-side modules
// (Luna, the root reads, the catalogue) replaced by stubs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {build} = require('esbuild');

const STUBS = {
	'../config/catalog': "export const APP_CATALOG = ["
		+ "{id: 'youtube.leanback.v4', title: 'YouTube', icon: 'youtube.leanback.v4.png'},"
		+ "{id: 'netflix', title: 'Netflix', color: '#b1060f'},"
		+ "{id: 'amazon', title: 'Prime Video', icon: 'amazon.png'},"
		+ "{id: 'com.webos.app.browser', title: 'Browser', icon: 'com.webos.app.browser.png'},"
		+ "{id: 'com.webos.app.discovery', title: 'App Store', color: '#a50034'},"
		+ "{id: 'org.webosbrew.hbchannel', title: 'Homebrew', icon: 'org.webosbrew.hbchannel.png'}];",
	'../config/constants': "export const APP_ID = 'com.ovsteenb.lumen';",
	'./luna': 'export const isWebOS = () => true; export const lunaCall = () => Promise.reject(new Error("no"));',
	'./root': 'export const listLaunchPoints = () => Promise.resolve(JSON.stringify({launchPoints: globalThis.T.points}));'
		+ 'export const appInfo = (id) => Promise.resolve({folderPath: "/usr/palm/applications/" + id, icon: "icon.png"});'
		+ 'export const readIcons = (paths) => { globalThis.T.rootReads.push(...paths); return Promise.resolve(paths.map((p, i) => i + " QUJD").join("\\n")); };',
	'./launch': 'export const appExists = () => Promise.resolve(true);',
	'../config/iconpack': "export const ICON_PACK = {orgwebosbrewhbchannel: 'hb.png'};",
	'../config/systemApps': "export const SYSTEM_APPS = [{id: 'com.webos.app.livetv', title: 'Live TV', color: '#5d7b74'}];",
	'./boot': 'export const readCache = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };'
		+ 'export const writeCache = (k, v) => { localStorage.setItem(k, JSON.stringify(v)); };',
	'./log': 'export const bootMark = () => {};'
};
const code = (await build({
	entryPoints: [new URL('../../app/src/lib/apps.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, define: {'import.meta.env.DEV': 'false'},
	plugins: [{name: 'stubs', setup (b) {
		b.onResolve({filter: /^\.\.?\//}, (a) => (STUBS[a.path] !== undefined ? {path: a.path, namespace: 'stub'} : undefined));
		b.onLoad({filter: /.*/, namespace: 'stub'}, (a) => ({contents: STUBS[a.path], loader: 'js'}));
	}}]
})).outputFiles[0].text;

const store = {};
globalThis.localStorage = {getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }};
globalThis.performance = globalThis.performance || {now: () => 0};
globalThis.location = {search: ''};
globalThis.window = globalThis;
// icon files never load as files here (as on the C8), so each icon is read as root
globalThis.Image = function () { const img = this; Object.defineProperty(img, 'src', {set () { setTimeout(() => img.onerror && img.onerror()); }}); };
globalThis.T = {points: [], rootReads: []};
const {listApps, iconFile, barIcon, iconPathByPicture, saveAppsCache, cachedApps, sameApps} = await import('data:text/javascript,' + encodeURIComponent(code));
const cold = await import('data:text/javascript,' + encodeURIComponent(code + '\n/* cold */'));
const bareMod = await import('data:text/javascript,' + encodeURIComponent(code + '\n/* bare */'));
const CACHE = 'launcher-icon-cache-v1';

test('icon cache: pruned once against both lists (launch points and system apps), so a second start reads nothing as root', async () => {
	T.points = [{id: 'org.moonfin.webos', title: 'Moonfin', largeIcon: '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon.png'}];
	store[CACHE] = JSON.stringify({'/media/developer/apps/usr/palm/applications/gone.app/icon.png': 'data:old'});
	await listApps(true, true);
	const cached = Object.keys(JSON.parse(store[CACHE])).sort();
	assert.deepEqual(cached, ['/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon.png', '/usr/palm/applications/com.webos.app.livetv/icon.png']);
	T.rootReads = [];
	await listApps(true, true);
	assert.deepEqual(T.rootReads, [], 'both lists\' icons stayed cached');
	assert.deepEqual(Object.keys(JSON.parse(store[CACHE])).sort(), cached);
});

test('bar icon file: a data: URI from the icon cache resolves for Moonfin, Amazon Music and Netflix, not only the bundled icons', () => {
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const moon = '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon-130.png';
	const music = '/media/cryptofs/apps/usr/palm/applications/com.theadelab.amclient-lg/largeIcon.png';
	const netflix = '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png';
	store[CACHE] = JSON.stringify({[moon]: 'data:image/png;base64,MOON', [music]: 'data:image/png;base64,MUSIC', [netflix]: 'data:image/png;base64,NET'});
	// one parse of the cache for the whole sync, not one per app. The map is empty until it is passed in.
	const pictures = cold.iconPathByPicture();
	assert.equal(cold.iconFile({id: 'org.moonfin.webos', title: 'Moonfin', iconUrl: 'data:image/png;base64,MOON'}, dir), undefined);
	assert.equal(cold.iconFile({id: 'org.moonfin.webos', title: 'Moonfin', iconUrl: 'data:image/png;base64,MOON'}, dir, pictures), moon);
	assert.equal(cold.iconFile({id: 'com.theadelab.amclient-lg', title: 'Amazon Music', iconUrl: 'data:image/png;base64,MUSIC'}, dir, pictures), music);
	assert.equal(cold.iconFile({id: 'netflix', title: 'Netflix', iconUrl: 'data:image/png;base64,NET'}, dir, pictures), netflix);
	assert.equal(cold.iconFile({id: 'youtube.leanback.v4', title: 'YouTube', iconUrl: 'icons/apps/youtube.leanback.v4.png'}, dir), dir + '/icons/apps/youtube.leanback.v4.png');
	assert.equal(cold.iconFile({id: 'x', title: 'X', iconUrl: 'http://lgsmarttv.lan/icon.png'}, dir), undefined);
	assert.equal(cold.iconFile({id: 'org.moonfin.webos', title: 'Moonfin', iconUrl: 'data:not-cached', iconPath: '/etc/passwd'}, dir), undefined);
	assert.equal(cold.iconFile({id: 'netflix', title: 'Netflix', iconUrl: 'data:not-cached', iconPath: netflix}, dir), netflix);
});

test('bar icon file: launch points keep the TV path, including an http largeIcon that falls through to the file', async () => {
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const moon = '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon-130.png';
	const music = '/media/cryptofs/apps/usr/palm/applications/com.theadelab.amclient-lg/largeIcon.png';
	const netflix = '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png';
	const iplayer = '/media/cryptofs/apps/usr/palm/applications/bbc.iplayer.3.0/icon.png';
	T.points = [
		{id: 'org.moonfin.webos', title: 'Moonfin', largeIcon: moon},
		{id: 'com.theadelab.amclient-lg', title: 'Amazon Music', largeIcon: music},
		{id: 'netflix', title: 'Netflix', icon: netflix},
		{id: 'bbc.iplayer.3.0', title: 'BBC iPlayer', largeIcon: 'http://lgsmarttv.lan:3000/iplayer.png', icon: iplayer}
	];
	const {apps} = await listApps(true, true);
	const by = (id) => apps.find((a) => a.id === id);
	assert.equal(by('org.moonfin.webos').iconPath, moon);
	assert.equal(by('com.theadelab.amclient-lg').iconPath, music);
	assert.equal(by('netflix').iconPath, netflix);
	assert.equal(by('bbc.iplayer.3.0').iconPath, iplayer);
	assert.equal(by('bbc.iplayer.3.0').plain, true);
	assert.equal(barIcon(by('bbc.iplayer.3.0'), dir).file, iplayer);
	assert.equal(barIcon(by('bbc.iplayer.3.0'), dir).plain, true);
	assert.equal(by('com.webos.app.livetv').iconPath, '/usr/palm/applications/com.webos.app.livetv/icon.png');
	assert.equal(iconFile(by('netflix'), dir), netflix);
	saveAppsCache(true, true, apps);
	const restored = cold.cachedApps(true, true);
	assert.equal(cold.iconFile(restored.find((a) => a.id === 'org.moonfin.webos'), dir), moon);
	assert.equal(cold.iconFile(restored.find((a) => a.id === 'netflix'), dir), netflix);
	assert.equal(cachedApps(true, true).some((a) => a.id === 'netflix' && a.iconPath === netflix), true);
});

test('bar icon matches the tile: a catalogue icon and an icon-pack icon win over the TV file', async () => {
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const ytTv = '/media/cryptofs/apps/usr/palm/applications/youtube.leanback.v4/largeIcon.png';
	const hbTv = '/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/icon.png';
	T.points = [
		{id: 'youtube.leanback.v4', title: 'YouTube', largeIcon: ytTv},
		{id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel', largeIcon: hbTv}
	];
	const {apps} = await listApps(true, false);
	const yt = apps.find((a) => a.id === 'youtube.leanback.v4');
	const hb = apps.find((a) => a.id === 'org.webosbrew.hbchannel');
	assert.equal(yt.iconUrl, 'icons/apps/youtube.leanback.v4.png');
	assert.equal(yt.plain, true);
	assert.equal(yt.iconPath, ytTv);
	assert.deepEqual(barIcon(yt, dir), {file: dir + '/icons/apps/youtube.leanback.v4.png', plain: true});
	assert.equal(hb.iconUrl, 'iconpack/hb.png');
	assert.equal(hb.plain, false);
	assert.deepEqual(barIcon(hb, dir), {file: dir + '/iconpack/hb.png', plain: false});
});

test('C8 listLaunchPoints: catalogue icons stay Lumen\'s files, and Moonfin, Amazon Music, iPlayer and Netflix use their largeIcon', async () => {
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const moon = '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon-130.png';
	const music = '/media/cryptofs/apps/usr/palm/applications/com.theadelab.amclient-lg/largeIcon.png';
	const iplayer = '/media/cryptofs/apps/usr/palm/applications/bbc.iplayer.3.0/bbc_130x130.png';
	const netflix = '/media/cryptofs/apps/usr/palm/applications/netflix/LARGE_APP_ICON.png';
	T.points = [
		{id: 'youtube.leanback.v4', title: 'YouTube', largeIcon: '/media/cryptofs/apps/usr/palm/applications/youtube.leanback.v4/yt_lg_130x130.png', icon: '/media/cryptofs/apps/usr/palm/applications/youtube.leanback.v4/yt_lg_80x80.png', iconColor: '#ffffff'},
		{id: 'netflix', title: 'Netflix', largeIcon: netflix, icon: '/media/cryptofs/apps/usr/palm/applications/netflix/SMALL_APP_ICON.png', iconColor: '#ffffff'},
		{id: 'org.moonfin.webos', title: 'Moonfin', largeIcon: moon, icon: '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon-80.png', iconColor: '#000000'},
		{id: 'com.theadelab.amclient-lg', title: 'Amazon Music', largeIcon: music, icon: '/media/cryptofs/apps/usr/palm/applications/com.theadelab.amclient-lg/icon.png', iconColor: '#25d1da'},
		{id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel', largeIcon: '/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/assets/icon130.png', icon: '/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/assets/icon80.png', iconColor: '#cf0652'},
		{id: 'bbc.iplayer.3.0', title: 'BBC iPlayer', largeIcon: iplayer, icon: '/media/cryptofs/apps/usr/palm/applications/bbc.iplayer.3.0/bbc_80x80.png', iconColor: '#101010'},
		{id: 'amazon', title: 'Prime Video', largeIcon: '/media/cryptofs/apps/usr/palm/applications/amazon/aiv_white_130x130.png', icon: '/media/cryptofs/apps/usr/palm/applications/amazon/aiv_white_80x80.png', iconColor: '#0578ff'},
		{id: 'com.webos.app.browser', title: 'Web Browser', largeIcon: '/media/system/apps/usr/palm/applications/com.webos.app.browser/assets/hd1080/webbrowser_large_icon.png', icon: '/media/system/apps/usr/palm/applications/com.webos.app.browser/assets/hd1080/webbrowser_icon.png', iconColor: '#FFFFFF'}
	];
	const {apps} = await listApps(true, false);
	const file = (id) => barIcon(apps.find((a) => a.id === id), dir, iconPathByPicture()).file;
	// the four files on the 1.0.9044 bar: a relative catalogue (or pack) icon, not the TV's largeIcon
	assert.equal(file('youtube.leanback.v4'), dir + '/icons/apps/youtube.leanback.v4.png');
	assert.equal(file('amazon'), dir + '/icons/apps/amazon.png');
	assert.equal(file('com.webos.app.browser'), dir + '/icons/apps/com.webos.app.browser.png');
	assert.equal(file('org.webosbrew.hbchannel'), dir + '/iconpack/hb.png');
	assert.equal(file('org.moonfin.webos'), moon);
	assert.equal(file('com.theadelab.amclient-lg'), music);
	assert.equal(file('bbc.iplayer.3.0'), iplayer);
	assert.equal(file('netflix'), netflix);
	assert.equal(barIcon(apps.find((a) => a.id === 'netflix'), dir).plain, true);
	// 1.0.9044's sameApps ignores a newly learned path, so a saved list of data: URIs stays on screen and the bar
	// effect does not run again. The path has to count. Once listApps has filled iconPaths, that same data: entry
	// (no path of its own) resolves: the write reads the file when its timer fires, not when the effect starts.
	const shown = apps.map((a) => ({...a, iconPath: undefined}));
	assert.equal(sameApps(shown, apps), false);
	assert.equal(iconFile({id: 'org.moonfin.webos', title: 'Moonfin', iconUrl: 'data:image/png;base64,MOON', plain: true}, dir), moon);
	assert.equal(iconFile({id: 'com.theadelab.amclient-lg', title: 'Amazon Music', iconUrl: 'data:image/png;base64,MUSIC', plain: true}, dir), music);
	assert.equal(iconFile({id: 'bbc.iplayer.3.0', title: 'BBC iPlayer', iconUrl: 'data:image/png;base64,IPLAYER', plain: true}, dir), iplayer);
	assert.equal(iconFile({id: 'netflix', title: 'Netflix', iconUrl: 'data:image/png;base64,NETFLIX', plain: true}, dir), netflix);
	// two icons can share bytes; the picture map keeps the first path. The app's own path wins.
	assert.equal(bareMod.iconFile({id: 'org.moonfin.webos', title: 'Moonfin', iconUrl: 'data:image/png;base64,MOON', iconPath: moon, plain: true}, dir, {'data:image/png;base64,MOON': music}), moon);
	// cold start as 1.0.9044 stored it: the picture is a data URI and the entry has no path.
	// main's iconFile returns nothing; the cache map gives each app its own largeIcon.
	const prev = store[CACHE];
	store[CACHE] = JSON.stringify({[moon]: 'data:image/png;base64,MOON', [music]: 'data:image/png;base64,MUSIC', [iplayer]: 'data:image/png;base64,IPLAYER', [netflix]: 'data:image/png;base64,NETFLIX'});
	const map = bareMod.iconPathByPicture();
	const bare = (id, title, url) => ({id, title, iconUrl: url, plain: true});
	// a module that has never listed apps: main's iconFile drops the data URI. The map keeps each largeIcon.
	assert.equal(bareMod.iconFile(bare('bbc.iplayer.3.0', 'BBC iPlayer', 'data:image/png;base64,IPLAYER'), dir), undefined);
	assert.equal(bareMod.iconFile(bare('com.theadelab.amclient-lg', 'Amazon Music', 'data:image/png;base64,MUSIC'), dir), undefined);
	assert.equal(bareMod.iconFile(bare('org.moonfin.webos', 'Moonfin', 'data:image/png;base64,MOON'), dir), undefined);
	assert.equal(bareMod.iconFile(bare('netflix', 'Netflix', 'data:image/png;base64,NETFLIX'), dir), undefined);
	assert.equal(bareMod.barIcon(bare('org.moonfin.webos', 'Moonfin', 'data:image/png;base64,MOON'), dir, map).file, moon);
	assert.equal(bareMod.barIcon(bare('com.theadelab.amclient-lg', 'Amazon Music', 'data:image/png;base64,MUSIC'), dir, map).file, music);
	assert.equal(bareMod.barIcon(bare('bbc.iplayer.3.0', 'BBC iPlayer', 'data:image/png;base64,IPLAYER'), dir, map).file, iplayer);
	assert.equal(bareMod.barIcon(bare('netflix', 'Netflix', 'data:image/png;base64,NETFLIX'), dir, map).file, netflix);
	store[CACHE] = prev;
});

test('an icon outside the app folders is tried as a file and never read as root', async () => {
	const outside = '/tmp/outside-app/icon.png';
	const moon = '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon-fresh.png';
	const trap = '/media/developer/apps/usr/palm/applications/org.moonfin.webos/../../../etc/passwd';
	T.points = [
		{id: 'outside.app', title: 'Outside', largeIcon: outside},
		{id: 'org.moonfin.webos', title: 'Moonfin', largeIcon: moon},
		{id: 'trap.app', title: 'Trap', largeIcon: trap}
	];
	T.rootReads = [];
	let {apps} = await listApps(true, false);
	assert.equal(apps.find((a) => a.id === 'outside.app').iconUrl, undefined);
	assert.equal(apps.find((a) => a.id === 'trap.app').iconUrl, undefined);
	assert.deepEqual(T.rootReads, [moon]);
	const Prev = globalThis.Image;
	globalThis.Image = function () {
		const img = this;
		Object.defineProperty(img, 'src', {set () { img.naturalWidth = 8; setTimeout(() => img.onload && img.onload()); }});
	};
	try {
		T.points = [{id: 'outside.app', title: 'Outside', largeIcon: '/tmp/outside-app/other.png'}];
		T.rootReads = [];
		({apps} = await listApps(true, false));
		assert.equal(apps.find((a) => a.id === 'outside.app').iconUrl, 'file:///tmp/outside-app/other.png');
		assert.deepEqual(T.rootReads, []);
	} finally {
		globalThis.Image = Prev;
	}
});

test('a TV path is forgotten once that app is no longer installed', async () => {
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const moon = '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon-130.png';
	const netflix = '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png';
	T.points = [{id: 'org.moonfin.webos', title: 'Moonfin', largeIcon: moon}];
	await listApps(true, false);
	T.points = [{id: 'netflix', title: 'Netflix', icon: netflix}];
	await listApps(true, false);
	assert.equal(iconFile({id: 'org.moonfin.webos', title: 'Moonfin', iconUrl: 'data:image/png;base64,X'}, dir), undefined);
	assert.equal(iconFile({id: 'netflix', title: 'Netflix', iconUrl: 'data:image/png;base64,QUJD'}, dir), netflix);
});

test('icon cache: a listing that looked nothing up (the TV\'s list unreadable) prunes nothing', async () => {
	store[CACHE] = JSON.stringify({'/a/icon.png': 'data:a'});
	T.points = [];
	await listApps(true, false).catch(() => undefined);
	assert.deepEqual(JSON.parse(store[CACHE]), {'/a/icon.png': 'data:a'});
});

// lib/root.ts setSetting, with the Homebrew Channel's exec answering `T.answer` as the command's output
const rootCode = (await build({
	entryPoints: [new URL('../../app/src/lib/root.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false,
	plugins: [{name: 'stubs', setup (b) {
		const s = {'../config/constants': "export const LUNA = {homebrewExec: 'luna://org.webosbrew.hbchannel.service/exec'};",
			'./luna': 'export const isWebOS = () => true; export const lunaCall = (uri, params) => { const cmd = (params && params.command) || ""; (globalThis.T.calls = globalThis.T.calls || []).push(cmd); if (globalThis.T.gate) return new Promise((resolve, reject) => { globalThis.T.gate.push((err) => err ? reject(err) : resolve({stdoutString: globalThis.T.answer || ""})); }); return Promise.resolve({stdoutString: globalThis.T.answer || ""}); };'};
		b.onResolve({filter: /^\.\.?\//}, (a) => (s[a.path] !== undefined ? {path: a.path, namespace: 'stub2'} : undefined));
		b.onLoad({filter: /.*/, namespace: 'stub2'}, (a) => ({contents: s[a.path], loader: 'js'}));
	}}]
})).outputFiles[0].text;
const {setSetting, syncBar, barSig, BAR_EPOCH, clearBarSeen, retryBarBusy} = await import('data:text/javascript,' + encodeURIComponent(rootCode));

test('a setting counts as set only on "returnValue": true; a refusal (with or without the space) or no answer is an error', async () => {
	for (const ok of ['{"returnValue":true}', '{"returnValue": true, "method": "setSystemSettings"}']) { T.answer = ok; await setSetting('backlight', '80'); }
	for (const [answer, why] of [['{"returnValue":false}', /refused/], ['{"returnValue": false, "errorText": "x"}', /refused/], ['', /no answer/]]) {
		T.answer = answer;
		await assert.rejects(setSetting('backlight', '80'), why, answer);
	}
});

test('bar signature changes when BAR_EPOCH is part of it, which is what makes an old bar rewrite', () => {
	const dock = ['youtube.leanback.v4'];
	const recent = ['netflix'];
	const list = [{id: 'netflix', title: 'Netflix', file: '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png'}];
	const style = {size: 206, height: 124, gap: 38, perRow: 7, scale: 1.12};
	const hash = (parts) => {
		const text = JSON.stringify(parts);
		let h = 5381;
		for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
		return h.toString(36);
	};
	assert.equal(BAR_EPOCH, 2);
	assert.equal(barSig(dock, recent, list, style), hash([BAR_EPOCH, dock, recent, list, style]));
	assert.notEqual(barSig(dock, recent, list, style), hash([dock, recent, list, style]));
});

test('syncBar logs a skipped copy and a missing path, and does not keep an icon token for "." or ".."', async () => {
	T.answer = 'skip netflix not-image\nwritten';
	T.calls = [];
	const r = await syncBar('/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen', 'com.ovsteenb.lumen', [], [], [
		{id: 'netflix', title: 'Netflix', file: '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png'},
		{id: 'com.webos.app.livetv', title: 'Live TV'},
		{id: '.', title: 'dot', file: '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon.png'},
		{id: '..', title: 'dotdot', file: '/media/developer/apps/usr/palm/applications/org.moonfin.webos/icon.png'}
	], 'log1');
	assert.equal(r, 'written');
	const b64 = /b64='([^']*)'/.exec(T.calls[0]);
	const json = JSON.parse(Buffer.from(b64[1], 'base64').toString('utf8'));
	assert.equal(json.apps['.'], undefined);
	assert.equal(json.apps['..'], undefined);
	assert.equal(json.apps.netflix.icon, '~icon:netflix.png');
	const logged = Buffer.from(/echo ([A-Za-z0-9+/=]+) \| base64/.exec(T.calls[1])[1], 'base64').toString('utf8');
	assert.match(logged, /bar: icon skipped netflix not-image/);
	assert.match(logged, /bar: icon skipped com\.webos\.app\.livetv no-path/);
	assert.doesNotMatch(logged, /skipped \./);
});

test('an svg or gif is not sent to the copy, and a webp icon pack file is', async () => {
	T.answer = 'written';
	T.calls = [];
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const r = await syncBar(dir, 'com.ovsteenb.lumen', [], [], [
		{id: 'org.example.svgapp', title: 'SVG', file: '/media/developer/apps/usr/palm/applications/org.example.svgapp/icon.svg'},
		{id: 'org.example.webpapp', title: 'WebP', file: '/media/developer/apps/usr/palm/applications/org.example.webpapp/icon.webp'},
		{id: 'org.example.gifapp', title: 'GIF', file: '/media/developer/apps/usr/palm/applications/org.example.gifapp/icon.gif'},
		{id: 'org.example.jpgapp', title: 'JPEG', file: '/media/developer/apps/usr/palm/applications/org.example.jpgapp/icon.jpg'}
	], 'img1');
	assert.equal(r, 'written');
	const cmd = T.calls[0];
	assert.equal(cmd.includes('icon.svg'), false);
	assert.equal(cmd.includes('icon.webp'), true);
	assert.equal(cmd.includes('icon.gif'), false);
	assert.equal(cmd.includes('icon.jpg'), true);
	const json = JSON.parse(Buffer.from(/b64='([^']*)'/.exec(cmd)[1], 'base64').toString('utf8'));
	assert.equal(json.apps['org.example.svgapp'].icon, undefined);
	assert.equal(json.apps['org.example.webpapp'].icon, '~icon:org.example.webpapp.webp');
	assert.equal(json.apps['org.example.gifapp'].icon, undefined);
	assert.equal(json.apps['org.example.jpgapp'].icon, '~icon:org.example.jpgapp.jpg');
	const logged = Buffer.from(/echo ([A-Za-z0-9+/=]+) \| base64/.exec(T.calls[1])[1], 'base64').toString('utf8');
	assert.match(logged, /bar: icon skipped org\.example\.svgapp not-image/);
	assert.doesNotMatch(logged, /webpapp not-image/);
	assert.match(logged, /bar: icon skipped org\.example\.gifapp not-image/);
	assert.doesNotMatch(logged, /jpgapp not-image/);
});

test('syncBar runs one write at a time', async () => {
	T.answer = 'same';
	T.calls = [];
	T.gate = [];
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const app = {id: 'netflix', title: 'Netflix', file: '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png'};
	const first = syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'q1');
	const second = syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'q2');
	await Promise.resolve();
	assert.equal(T.calls.length, 1);
	T.gate.shift()();
	assert.equal(await first, 'same');
	await Promise.resolve();
	assert.equal(T.calls.length, 2);
	assert.equal(T.calls[1].includes("sig='q2'"), true);
	T.gate.shift()();
	assert.equal(await second, 'same');
	T.gate = null;
});

test('syncBar: a rejected write, as on a timeout, does not block the next one', async () => {
	T.answer = 'written';
	T.calls = [];
	T.gate = [];
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const app = {id: 'netflix', title: 'Netflix', file: '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png'};
	const first = syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'rej1');
	const second = syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'rej1');
	await Promise.resolve();
	assert.equal(T.calls.length, 1);
	T.gate.shift()(new Error('timeout'));
	await assert.rejects(first);
	await Promise.resolve();
	assert.equal(T.calls.length, 2);
	assert.equal(T.calls[1].includes("sig='rej1'"), true);
	T.gate.shift()();
	assert.equal(await second, 'written');
	T.gate = null;
});

test('syncBar skips a second call with the signature already written or left as same', async () => {
	T.answer = 'written';
	T.calls = [];
	T.gate = null;
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const app = {id: 'netflix', title: 'Netflix', file: '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png'};
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'skp'), 'written');
	assert.equal(T.calls.length, 1);
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'skp'), 'same');
	assert.equal(T.calls.length, 1);
	T.answer = 'same';
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'skq'), 'same');
	assert.equal(T.calls.length, 2);
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'skq'), 'same');
	assert.equal(T.calls.length, 2);
	T.answer = 'busy';
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'skr'), 'busy');
	assert.equal(T.calls.length, 3);
	T.answer = 'written';
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'skr'), 'written');
	assert.equal(T.calls.length, 4);
	T.gate = [];
	T.answer = 'written';
	const queued = syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'sks');
	const again = syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'sks');
	await Promise.resolve();
	assert.equal(T.calls.length, 5);
	T.gate.shift()();
	assert.equal(await queued, 'written');
	assert.equal(await again, 'same');
	assert.equal(T.calls.length, 5);
	T.gate = null;
});

test('syncBar runs the same signature again after Lumen comes to the front', async () => {
	T.answer = 'written';
	T.calls = [];
	T.gate = null;
	const dir = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen';
	const app = {id: 'netflix', title: 'Netflix', file: '/media/cryptofs/apps/usr/palm/applications/netflix/icon.png'};
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'fr1'), 'written');
	assert.equal(T.calls.length, 1);
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'fr1'), 'same');
	assert.equal(T.calls.length, 1);
	clearBarSeen();
	assert.equal(await syncBar(dir, 'com.ovsteenb.lumen', [], [], [app], 'fr1'), 'written');
	assert.equal(T.calls.length, 2);
});

test('a busy bar write is tried three times, and cleanup stops the rest', async () => {
	const pending = [];
	const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
	let calls = 0;
	const stop = retryBarBusy(async () => { calls += 1; return 'busy'; }, 2000, (fn) => { pending.push(fn); return pending.length; }, () => {});
	await flush();
	assert.equal(calls, 1);
	assert.equal(pending.length, 1);
	pending.shift()();
	await flush();
	assert.equal(calls, 2);
	pending.shift()();
	await flush();
	assert.equal(calls, 3);
	assert.equal(pending.length, 0);
	stop();
	calls = 0;
	const queued = [];
	const stopEarly = retryBarBusy(async () => { calls += 1; return 'busy'; }, 2000, (fn) => { queued.push(fn); return queued.length; }, (id) => { queued[id - 1] = null; });
	await flush();
	assert.equal(calls, 1);
	const next = queued[0];
	stopEarly();
	assert.equal(queued[0], null);
	next();
	await flush();
	assert.equal(calls, 1);
	calls = 0;
	const once = [];
	retryBarBusy(async () => { calls += 1; return 'written'; }, 2000, (fn) => { once.push(fn); return once.length; }, () => {});
	await flush();
	assert.equal(calls, 1);
	assert.equal(once.length, 0);
});
