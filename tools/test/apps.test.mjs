// node --test tools/test/*.test.mjs: app/src/lib/apps.ts listApps and its icon cache, bundled by esbuild with the TV-side modules
// (Luna, the root reads, the catalogue) replaced by stubs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {build} = require('esbuild');

const STUBS = {
	'../config/catalog': 'export const APP_CATALOG = [];',
	'../config/constants': "export const APP_ID = 'com.ovsteenb.lumen';",
	'./luna': 'export const isWebOS = () => true; export const lunaCall = () => Promise.reject(new Error("no"));',
	'./root': 'export const listLaunchPoints = () => Promise.resolve(JSON.stringify({launchPoints: globalThis.T.points}));'
		+ 'export const appInfo = (id) => Promise.resolve({folderPath: "/usr/palm/applications/" + id, icon: "icon.png"});'
		+ 'export const readIcons = (paths) => { globalThis.T.rootReads.push(...paths); return Promise.resolve(paths.map((p, i) => i + " QUJD").join("\\n")); };',
	'./launch': 'export const appExists = () => Promise.resolve(true);',
	'../config/iconpack': 'export const ICON_PACK = {};',
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
const {listApps, iconFile, saveAppsCache, cachedApps} = await import('data:text/javascript,' + encodeURIComponent(code));
const cold = await import('data:text/javascript,' + encodeURIComponent(code + '\n/* cold */'));
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
	// a fresh module: iconPaths is empty, as on a cold start before listApps. The picture is only in the icon cache.
	assert.equal(cold.iconFile({id: 'org.moonfin.webos', title: 'Moonfin', iconUrl: 'data:image/png;base64,MOON'}, dir), moon);
	assert.equal(cold.iconFile({id: 'com.theadelab.amclient-lg', title: 'Amazon Music', iconUrl: 'data:image/png;base64,MUSIC'}, dir), music);
	assert.equal(cold.iconFile({id: 'netflix', title: 'Netflix', iconUrl: 'data:image/png;base64,NET'}, dir), netflix);
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
	assert.equal(by('com.webos.app.livetv').iconPath, '/usr/palm/applications/com.webos.app.livetv/icon.png');
	assert.equal(iconFile(by('netflix'), dir), netflix);
	saveAppsCache(true, true, apps);
	const restored = cold.cachedApps(true, true);
	assert.equal(cold.iconFile(restored.find((a) => a.id === 'org.moonfin.webos'), dir), moon);
	assert.equal(cold.iconFile(restored.find((a) => a.id === 'netflix'), dir), netflix);
	assert.equal(cachedApps(true, true).some((a) => a.id === 'netflix' && a.iconPath === netflix), true);
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
			'./luna': 'export const isWebOS = () => true; export const lunaCall = () => Promise.resolve({stdoutString: globalThis.T.answer});'};
		b.onResolve({filter: /^\.\.?\//}, (a) => (s[a.path] !== undefined ? {path: a.path, namespace: 'stub2'} : undefined));
		b.onLoad({filter: /.*/, namespace: 'stub2'}, (a) => ({contents: s[a.path], loader: 'js'}));
	}}]
})).outputFiles[0].text;
const {setSetting} = await import('data:text/javascript,' + encodeURIComponent(rootCode));

test('a setting counts as set only on "returnValue": true; a refusal (with or without the space) or no answer is an error', async () => {
	for (const ok of ['{"returnValue":true}', '{"returnValue": true, "method": "setSystemSettings"}']) { T.answer = ok; await setSetting('backlight', '80'); }
	for (const [answer, why] of [['{"returnValue":false}', /refused/], ['{"returnValue": false, "errorText": "x"}', /refused/], ['', /no answer/]]) {
		T.answer = answer;
		await assert.rejects(setSetting('backlight', '80'), why, answer);
	}
});
