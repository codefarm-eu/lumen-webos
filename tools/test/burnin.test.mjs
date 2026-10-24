// node --test tools/test/*.test.mjs  (needs app/node_modules: esbuild turns the TypeScript module into JS first)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const src = readFileSync(new URL('../../app/src/lib/burnin.ts', import.meta.url), 'utf8');
const js = transformSync(src, {loader: 'ts', format: 'esm'}).code;
const {safeHalves, nextOffset, offsetRange} = await import('data:text/javascript,' + encodeURIComponent(js));

// seeded random, so the test is the same every run
const seeded = (s) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
// the screensaver at 1920x1080: the clock rests bottom left, the date/weather block bottom right (as global.css places them)
const halves = safeHalves(1920, 1080);
const clock = {left: 120, top: 830, width: 420, height: 170};
const row = {left: 1380, top: 900, width: 420, height: 100};
const inside = (b, o, a) => b.left + o.x >= a.left && b.top + o.y >= a.top && b.left + b.width + o.x <= a.right && b.top + b.height + o.y <= a.bottom;

test('safe halves keep a margin and never overlap', () => {
	assert.ok(halves.left.left >= 90 && halves.left.top >= 60 && halves.right.right <= 1830 && halves.right.bottom <= 1020);
	assert.ok(halves.left.right < halves.right.left);
});

test('every move stays on screen, inside its half, in whole pixels, and away from the last place', () => {
	for (const [box, area] of [[clock, halves.left], [row, halves.right]]) {
		const rand = seeded(7);
		const r = offsetRange(box, area);
		const span = Math.hypot(r.maxX - r.minX, r.maxY - r.minY);
		let prev = {x: 0, y: 0};
		for (let i = 0; i < 500; i++) {
			const o = nextOffset(box, area, prev, rand);
			assert.ok(inside(box, o, area), JSON.stringify({box, o}));
			assert.ok(Number.isInteger(o.x) && Number.isInteger(o.y));
			assert.ok(Math.hypot(o.x - prev.x, o.y - prev.y) >= span / 3 - 1);
			prev = o;
		}
	}
});

test('the clock and the weather never overlap, whatever the offsets', () => {
	const rand = seeded(3);
	let a = {x: 0, y: 0}, b = {x: 0, y: 0};
	for (let i = 0; i < 300; i++) {
		a = nextOffset(clock, halves.left, a, rand); b = nextOffset(row, halves.right, b, rand);
		assert.ok(clock.left + clock.width + a.x < row.left + b.x);
	}
});

test('a box bigger than its area stays centred instead of leaving the screen', () => {
	const big = {left: 0, top: 0, width: 2000, height: 50};
	const o = nextOffset(big, halves.left, {x: 0, y: 0}, () => 0.5);
	const r = offsetRange(big, halves.left);
	assert.equal(r.minX, r.maxX);
	assert.ok(Math.abs(o.x - r.minX) <= 1);
});
