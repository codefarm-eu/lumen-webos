// node --test tools/test/*.test.mjs  (needs app/node_modules: esbuild turns the TypeScript module into JS first)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const src = readFileSync(new URL('../../app/src/lib/screensaver.ts', import.meta.url), 'utf8');
const js = transformSync(src, {loader: 'ts', format: 'esm'}).code;
const {screensaverSource, nextBuiltin} = await import('data:text/javascript,' + encodeURIComponent(js));

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
