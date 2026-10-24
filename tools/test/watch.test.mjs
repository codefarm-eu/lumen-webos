// node --test tools/test/*.test.mjs: the TV watcher's wake rule (tools/tv/watch.sh, wake_tick; from upstream 3f26515). The script is
// sourced in sh with WATCH_SH_LIB=1, which stops it before its loops, and wake_open is replaced by a stub that prints what it would open.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SCRIPT = new URL('../../tools/tv/watch.sh', import.meta.url).pathname;
const LUMEN = 'com.ovsteenb.lumen';

/** runs wake_tick once per step ({front, app, now, power}); prints OPEN lines and the end state */
function ticks (steps, {nowake = false, wakeuntil = 1090} = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'watch-'));
	const flag = join(dir, 'no-wake-launch');
	if (nowake) writeFileSync(flag, '');
	const lines = steps.map((s) => `front='${s.front ? LUMEN : ''}'; app='${s.front ? LUMEN : s.app || ''}'; now=${s.now}; pwstate='${s.power || 'Active'}'; wake_tick`);
	const sh = [`WATCH_SH_LIB=1 . '${SCRIPT}'`, `NOWAKE_FLAG='${flag}'; WAKEFILE='${join(dir, 'wakeuntil')}'; wakeuntil=${wakeuntil}`,
		'wake_open () { echo "OPEN over ${1:-nothing}"; }', ...lines, 'echo "wakeuntil=$wakeuntil"'].join('\n');
	const out = execFileSync('sh', ['-c', sh], {encoding: 'utf8'});
	let file = '';
	try { file = readFileSync(join(dir, 'wakeuntil'), 'utf8').trim(); } catch { /* not written */ }
	return {out: out.trim().split('\n'), file};
}

test('watch.sh parses in sh, and never sleeps fractions (webOS 4 busybox sleep takes whole seconds)', () => {
	execFileSync('sh', ['-n', SCRIPT]);
	assert.doesNotMatch(readFileSync(SCRIPT, 'utf8'), /(^|[^u])sleep [0-9]*\.[0-9]/m);
});

test('after a wake into Live TV (Wake-on-LAN), Lumen is opened each tick until it is in front', () => {
	const r = ticks([{app: 'com.webos.app.livetv', now: 1000}, {app: 'com.webos.app.livetv', now: 1001}]);
	assert.deepEqual(r.out, ['OPEN over com.webos.app.livetv', 'OPEN over com.webos.app.livetv', 'wakeuntil=1090']);
});

test('once Lumen has stayed in front 3 s the wake ends, for the Home bar path too (WAKEFILE)', () => {
	const r = ticks([{front: true, now: 1000}, {front: true, now: 1002}, {front: true, now: 1003}]);
	assert.deepEqual(r.out, ['wakeuntil=0']);
	assert.equal(r.file, '0');
});

test('the TV putting Live TV or LG Home over Lumen in the first seconds: Lumen again', () => {
	assert.deepEqual(ticks([{front: true, now: 1000}, {app: 'com.webos.app.livetv', now: 1001}]).out, ['OPEN over com.webos.app.livetv', 'wakeuntil=1090']);
	assert.deepEqual(ticks([{front: true, now: 1000}, {app: 'com.webos.app.home', now: 1001}]).out, ['OPEN over com.webos.app.home', 'wakeuntil=1090']);
});

test('an app opened from Lumen in the first seconds ends the wake: it is not covered by Lumen again', () => {
	const r = ticks([{front: true, now: 1000}, {app: 'youtube.leanback.v4', now: 1001}, {app: 'youtube.leanback.v4', now: 1002}]);
	assert.deepEqual(r.out, ['wakeuntil=0']);
	assert.equal(r.file, '0');
});

test('no-wake-launch, a screen that is not on, or a wake that is over: nothing is opened', () => {
	assert.deepEqual(ticks([{app: 'com.webos.app.livetv', now: 1000}], {nowake: true}).out, ['wakeuntil=1090']);
	assert.deepEqual(ticks([{app: 'com.webos.app.livetv', now: 1000, power: 'Active Standby'}]).out, ['wakeuntil=1090']);
	assert.deepEqual(ticks([{app: 'com.webos.app.livetv', now: 1100}]).out, ['wakeuntil=1090']);
});
