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

test('the boot wake window only follows a real boot (uptime under 5 minutes), not a watcher restart', () => {
	const src = readFileSync(SCRIPT, 'utf8');
	assert.match(src, /booted=\$\(cut -d\. -f1 \/proc\/uptime/);
	assert.match(src, /"\$booted" -gt 300 \] 2>\/dev\/null && wakeuntil=0/);
});

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

/** a shell that sources watch.sh and runs single_instance against `lock`, printing ok or busy, then holds for `hold` seconds */
function claim (lock, hold = 0) {
	return `WATCH_SH_LIB=1 WATCH_LOCK='${lock}' . '${SCRIPT}'; if single_instance; then echo ok; else echo busy; fi; sleep ${hold}`;
}

test('only one watcher runs: a second copy exits while the first is alive, and takes over once it is gone', async () => {
	const {spawn} = await import('node:child_process');
	const lock = join(mkdtempSync(join(tmpdir(), 'watch-lock-')), 'lock');
	const first = spawn('sh', ['-c', claim(lock, 5)]);
	const firstOut = await new Promise((ok) => first.stdout.once('data', (d) => ok(String(d).trim())));
	assert.equal(firstOut, 'ok');
	assert.equal(execFileSync('sh', ['-c', claim(lock)], {encoding: 'utf8'}).trim(), 'busy');
	first.kill('SIGKILL');
	await new Promise((ok) => first.once('exit', ok));
	// the lock is left behind with a dead pid: the next copy takes it over
	assert.equal(execFileSync('sh', ['-c', claim(lock)], {encoding: 'utf8'}).trim(), 'ok');
});

/** sources watch.sh with Input Hook's paths in a temp folder: lginput2 is pid 4242, hooked or not per check (`hooked`, one entry per
 *  inputhook_check call), and ezinject is a stub that records its arguments. Runs inputhook_check at each of `nows`. */
function reinject (nows, {hooked = [], bind = true, mark = true, state = ''} = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'inputhook-'));
	const ih = join(dir, 'ih');
	execFileSync('sh', ['-c', `mkdir -p '${ih}' && printf '#!/bin/sh\\necho "$@" >> "${dir}/calls"\\n' > '${ih}/ezinject' && chmod +x '${ih}/ezinject'`]);
	if (mark) writeFileSync(join(dir, 'mark'), '');
	if (state) writeFileSync(join(dir, 'state'), state);
	writeFileSync(join(dir, 'keybinds.json'), bind ? '{"773":{"action":"exec","command":"/bin/sh /var/lib/homehook/home-key.sh"}}\n' : '{}\n');
	const h = nows.map((_, i) => (hooked[i] ? 1 : 0)).join(' ');
	const sh = [`WATCH_SH_LIB=1 IH_DIR='${ih}' IH_MARK='${join(dir, 'mark')}' IH_STATE='${join(dir, 'state')}' IH_LOG='${join(dir, 'log')}' . '${SCRIPT}'`,
		`KEYBINDS='${join(dir, 'keybinds.json')}'`, 'lginput_pid () { echo 4242; }', 'sleep () { :; }',
		`set -- ${h}; HOOK="$*"`, 'lginput_hooked () { set -- $HOOK; [ "$1" = 1 ]; }',
		...nows.map((n) => `inputhook_check ${n}; set -- $HOOK; shift; HOOK="$*"`)].join('\n');
	execFileSync('sh', ['-c', sh], {encoding: 'utf8'});
	const read = (f) => { try { return readFileSync(join(dir, f), 'utf8').trim(); } catch { return ''; } };
	return {calls: read('calls').split('\n').filter(Boolean), log: read('log'), state: read('state')};
}

test('Input Hook: a hooked lginput2 is left alone', () => {
	assert.deepEqual(reinject([1000, 1005], {hooked: [true, true]}).calls, []);
});

test('Input Hook: lginput2 without the hook on two checks in a row is re-injected once, lginput2 only, and logged', () => {
	const r = reinject([1000, 1005, 1010], {hooked: [false, false, false]});
	assert.equal(r.calls.length, 1);
	assert.match(r.calls[0], /^4242 .*\/libcrypt[12]\/libphp\.so .*\/lginput-hook\.php lginput2$/);
	assert.match(r.log, /Input Hook re-injected into lginput2 \(pid 4242\)/);
	assert.equal(r.state, '1005');
});

test('Input Hook: at most one re-injection a minute', () => {
	const r = reinject([1000, 1005, 1010, 1015, 1060, 1065, 1070], {hooked: Array(7).fill(false)});
	assert.equal(r.calls.length, 2);
	assert.equal(r.state, '1005\n1065');
});

test('Input Hook: after 5 re-injections in a boot it gives up and says so once', () => {
	const r = reinject([5000, 5005, 5010], {hooked: [false, false, false], state: '1\n2\n3\n4\n5\n'});
	assert.deepEqual(r.calls, []);
	assert.equal(r.log.match(/not re-injected/g).length, 1);
});

test('Input Hook: nothing without our Home bind, or before its own boot injection (/tmp/inputhook)', () => {
	assert.deepEqual(reinject([1000, 1005], {bind: false}).calls, []);
	assert.deepEqual(reinject([1000, 1005], {mark: false}).calls, []);
});

test('LG Home shown with no Home key from Input Hook before it is logged as a warning; right after a Home key it is not', () => {
	const dir = mkdtempSync(join(tmpdir(), 'homekey-'));
	writeFileSync(join(dir, 'keybinds.json'), '{"773":{"action":"exec","command":"/bin/sh /var/lib/homehook/home-key.sh"}}\n');
	const run = (at) => {
		if (at) writeFileSync(join(dir, 'at'), String(at)); else writeFileSync(join(dir, 'at'), '');
		writeFileSync(join(dir, 'log'), '');
		execFileSync('sh', ['-c', [`WATCH_SH_LIB=1 IH_LOG='${join(dir, 'log')}' HOMEKEY_AT='${join(dir, 'at')}' . '${SCRIPT}'`,
			`KEYBINDS='${join(dir, 'keybinds.json')}'`, 'lginput_pid () { echo 4242; }', 'lginput_hooked () { false; }', 'home_key_missed 1000'].join('\n')]);
		return readFileSync(join(dir, 'log'), 'utf8');
	};
	assert.match(run(0), /warning: LG Home shown with no Home key .*lginput2 hooked: no/);
	assert.equal(run(998), '');
	assert.match(run(990), /warning/);
});
