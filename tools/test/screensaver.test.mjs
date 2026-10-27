// node --test tools/test/*.test.mjs  (needs app/node_modules: esbuild turns the TypeScript module into JS first)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const src = readFileSync(new URL('../../app/src/lib/screensaver.ts', import.meta.url), 'utf8');
const js = transformSync(src, {loader: 'ts', format: 'esm'}).code;
const {screensaverSource, nextBuiltin, returnTo} = await import('data:text/javascript,' + encodeURIComponent(js));

test('Immich off or not set up: the bundled pictures, never Immich', () => {
	assert.deepEqual(screensaverSource({ambientOn: false, ambient: 'immich:recent'}, false), {kind: 'builtin'});
	assert.deepEqual(screensaverSource({ambientOn: false, ambient: 'immich:recent'}, true), {kind: 'builtin'});
	assert.deepEqual(screensaverSource({ambientOn: true, ambient: 'immich:recent'}, false), {kind: 'builtin'});
});

test('Immich on and set up: its source', () => {
	assert.deepEqual(screensaverSource({ambientOn: true, ambient: 'immich:album:x'}, true), {kind: 'immich', source: 'immich:album:x'});
});

test('nextBuiltin never repeats the picture on screen and covers every other one', () => {
	const files = ['a', 'b', 'c', 'd', 'e'];
	for (const cur of files) {
		const seen = new Set();
		for (let k = 0; k < 40; k++) { const i = nextBuiltin(files, cur, () => k / 40); assert.notEqual(files[i], cur); seen.add(i); }
		assert.equal(seen.size, 4);
	}
	assert.equal(nextBuiltin([], 'a'), -1);
	assert.equal(nextBuiltin(['a'], 'a'), 0);
	assert.ok(nextBuiltin(files, 'zzz', () => 0.999) === 4);
	assert.ok(nextBuiltin(files, 'a', () => 0.9999) === 4);
});

test('the cached last picture is only reused by its own source (from upstream bb94320: the TV-started screensaver opens on it)', async () => {
	const {lastPictureFits} = await import('data:text/javascript,' + encodeURIComponent(js));
	const files = ['./wallpapers/a.jpg', './wallpapers/b.jpg'];
	assert.equal(lastPictureFits('./wallpapers/b.jpg', files), true);
	assert.equal(lastPictureFits('./wallpapers/old.jpg', files), false);
	assert.equal(lastPictureFits('3f2a9c1e-0b7d-4c2e-9a51-6f0e1d2c3b4a', files), false);
	assert.equal(lastPictureFits('3f2a9c1e-0b7d-4c2e-9a51-6f0e1d2c3b4a'), true);
	assert.equal(lastPictureFits('./wallpapers/a.jpg'), false);
	assert.equal(lastPictureFits(''), false);
});

test('dismissing the screensaver returns to the app it came up over while that app is still open', () => {
	assert.equal(returnTo('org.moonfin.webos', ['com.ovsteenb.lumen', 'org.moonfin.webos']), 'org.moonfin.webos');
	assert.equal(returnTo('youtube.leanback.v4', null), 'youtube.leanback.v4');   // running list unreadable: launched anyway
});

test('no app, or one that has been closed since: Lumen stays on its home screen', () => {
	assert.equal(returnTo(null, ['org.moonfin.webos']), null);
	assert.equal(returnTo('', null), null);
	assert.equal(returnTo('org.moonfin.webos', ['com.ovsteenb.lumen']), null);
});
