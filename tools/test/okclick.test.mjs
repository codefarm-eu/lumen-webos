// node --test tools/test/*.test.mjs: Lumen home's guard that keeps one Magic Remote OK (click and/or Enter) from acting twice
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const js = transformSync(readFileSync(new URL('../../app/src/lib/okClick.ts', import.meta.url), 'utf8'), {loader: 'ts', format: 'esm'}).code;
const {okClickGuard, WINDOW_MS} = await import('data:text/javascript,' + encodeURIComponent(js));

const clock = () => { const c = {t: 1000, now: () => c.t}; return c; };

test('Enter then its click: only the Enter acts', () => {
	const c = clock(); const g = okClickGuard(c.now);
	assert.equal(g.key(), true);
	c.t += 60;
	assert.equal(g.click(), false);
});

test('click then its Enter: only the click acts', () => {
	const c = clock(); const g = okClickGuard(c.now);
	assert.equal(g.click(), true);
	c.t += 30;
	assert.equal(g.key(), false);
});

test('separate presses each act, by pointer or by key', () => {
	const c = clock(); const g = okClickGuard(c.now);
	assert.equal(g.click(), true);
	c.t += WINDOW_MS + 1;
	assert.equal(g.click(), true);
	c.t += WINDOW_MS + 1;
	assert.equal(g.key(), true);
	c.t += WINDOW_MS + 1;
	assert.equal(g.key(), true);
});
