// node --test tools/test/*.test.mjs: wallpaper dimming (lib/dim.ts, from upstream e296505)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const js = transformSync(readFileSync(new URL('../../app/src/lib/dim.ts', import.meta.url), 'utf8'), {loader: 'ts', format: 'esm'}).code;
const {wallpaperDimFrom, dimClasses} = await import('data:text/javascript,' + encodeURIComponent(js));

test('the old on/off setting becomes At night or Off; the new one is kept; junk is Off', () => {
	assert.equal(wallpaperDimFrom({nightDim: true}), 'night');
	assert.equal(wallpaperDimFrom({nightDim: false}), 'off');
	assert.equal(wallpaperDimFrom({}), 'off');
	assert.equal(wallpaperDimFrom({wallpaperDim: 'always', nightDim: false}), 'always');
	assert.equal(wallpaperDimFrom({wallpaperDim: 'off', nightDim: true}), 'off');
	assert.equal(wallpaperDimFrom({wallpaperDim: 'sometimes', nightDim: true}), 'night');
});

test('At night dims from 19:00 to 06:00, the wallpaper and the screensaver', () => {
	assert.deepEqual(dimClasses('night', 18), {night: false, nightHours: false});
	assert.deepEqual(dimClasses('night', 19), {night: true, nightHours: true});
	assert.deepEqual(dimClasses('night', 5), {night: true, nightHours: true});
	assert.deepEqual(dimClasses('night', 6), {night: false, nightHours: false});
});

test('Always dims the wallpaper all day, the screensaver only at night (its Brightness setting already lowers the backlight)', () => {
	assert.deepEqual(dimClasses('always', 12), {night: true, nightHours: false});
	assert.deepEqual(dimClasses('always', 23), {night: true, nightHours: true});
	assert.deepEqual(dimClasses('off', 23), {night: false, nightHours: false});
});
