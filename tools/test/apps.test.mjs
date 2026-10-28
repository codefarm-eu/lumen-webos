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
	'./boot': 'export const readCache = () => null; export const writeCache = () => {};',
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
const {listApps} = await import('data:text/javascript,' + encodeURIComponent(code));
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
