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
	assert.match(src, /booted=\$\(cut -d\. -f1 "\$\{WATCH_UPTIME:-\/proc\/uptime\}"/);
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
function reinject (nows, {hooked = [], bind = true, mark = true, state = '', layout = 'php', traced = false} = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'inputhook-'));
	const ih = join(dir, 'ih');
	execFileSync('sh', ['-c', `mkdir -p '${ih}' && printf '#!/bin/sh\\necho "$@" >> "${dir}/calls"\\n' > '${ih}/ezinject' && chmod +x '${ih}/ezinject'`]);
	if (layout === 'pp') writeFileSync(join(ih, 'libinputhookpp.so'), '');
	if (layout === 'php') {
		execFileSync('sh', ['-c', `mkdir -p '${ih}/libcrypt1' '${ih}/libcrypt2'`]);
		for (const f of ['libcrypt1/libphp.so', 'libcrypt2/libphp.so', 'lginput-hook.php']) writeFileSync(join(ih, f), '');
	}
	if (mark) writeFileSync(join(dir, 'mark'), '');
	if (state) writeFileSync(join(dir, 'state'), state);
	writeFileSync(join(dir, 'keybinds.json'), bind ? '{"773":{"action":"exec","command":"/bin/sh /var/lib/homehook/home-key.sh"}}\n' : '{}\n');
	const h = nows.map((_, i) => (hooked[i] ? 1 : 0)).join(' ');
	const sh = [`WATCH_SH_LIB=1 IH_DIR='${ih}' IH_MARK='${join(dir, 'mark')}' IH_STATE='${join(dir, 'state')}' IH_LOG='${join(dir, 'log')}' . '${SCRIPT}'`,
		`KEYBINDS='${join(dir, 'keybinds.json')}'`, 'lginput_pid () { echo 4242; }', 'sleep () { :; }',
		`set -- ${h}; HOOK="$*"`, 'lginput_hooked () { set -- $HOOK; [ "$1" = 1 ]; }', `lginput_traced () { ${traced ? 'true' : 'false'}; }`,
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

test('Input Hook 1.5.0 (inputhookpp): re-injected with the service\'s own command', () => {
	const r = reinject([1000, 1005], {hooked: [false, false], layout: 'pp'});
	assert.equal(r.calls.length, 1);
	assert.match(r.calls[0], /^-l \/tmp\/lginput-hook-lginput2\.log 4242 .*\/libinputhookpp\.so$/);
});

test('Input Hook: nothing while lginput2 is being traced (an injection under way), or when Input Hook\'s files are missing', () => {
	assert.deepEqual(reinject([1000, 1005, 1010], {hooked: [false, false, false], traced: true}).calls, []);
	assert.deepEqual(reinject([1000, 1005, 1010], {hooked: [false, false, false], layout: 'none'}).calls, []);
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
	// a stray value in the Home key file is a warning, not an arithmetic error that ends the reader (busybox ash)
	assert.match(run('1x'), /warning/);
});

/** sources watch.sh with a Lumen build in a temp app folder (packaged homehook/) and installed copies next to it, then runs self_update at
 *  each of `nows`; `between` (optional) is shell run after the check of that index. su_reexec is a stub that prints REEXEC and stops. */
function selfUpdate (nows, {pkgWatch, pkgHook, instWatch = WATCH_OK('old'), instHook = HOOK_OK('old'), state = '', between = {}, hook = true, link = false, md5fail = false, stateLink = false, fifo = false} = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'selfupdate-'));
	const app = join(dir, 'apps', LUMEN, 'homehook');
	execFileSync('sh', ['-c', `mkdir -p '${app}' '${dir}/hh' '${dir}/init.d'`]);
	writeFileSync(join(app, '60-homehook'), pkgHook ?? HOOK_OK('new'));
	if (link) execFileSync('sh', ['-c', `printf '%s' '${WATCH_OK('new')}' > '${dir}/elsewhere' && ln -s '${dir}/elsewhere' '${app}/watch.sh'`]);
	else writeFileSync(join(app, 'watch.sh'), pkgWatch ?? WATCH_OK('new'));
	if (fifo) execFileSync('sh', ['-c', `rm -f '${join(app, 'watch.sh')}' && mkfifo '${join(app, 'watch.sh')}'`]);
	writeFileSync(join(dir, 'hh', 'watch.sh'), instWatch);
	if (hook) writeFileSync(join(dir, 'init.d', '60-homehook'), instHook);
	if (stateLink) {
		writeFileSync(join(dir, 'victim'), 'victim\n');
		execFileSync('sh', ['-c', `ln -s '${dir}/victim' '${dir}/state'`]);
	} else if (state) writeFileSync(join(dir, 'state'), state);
	let path = '';
	if (md5fail) {
		execFileSync('sh', ['-c', `mkdir -p '${dir}/bin' && printf '%s\n' '#!/bin/sh' 'exit 1' > '${dir}/bin/md5sum' && chmod +x '${dir}/bin/md5sum'`]);
		path = `PATH='${dir}/bin':"$PATH"; `;
	}
	const sh = [`${path}WATCH_SH_LIB=1 SELF='${dir}/hh/watch.sh' INIT_HOOK='${dir}/init.d/60-homehook' SU_STATE='${dir}/state' IH_LOG='${dir}/log' . '${SCRIPT}'`,
		`APPS='${dir}/apps'; ME='${LUMEN}'`, 'su_reexec () { echo REEXEC; exit 0; }',
		...nows.flatMap((n, i) => [`self_update ${n}`, between[i] || ':'])].join('\n');
	const out = execFileSync('sh', ['-c', sh], {encoding: 'utf8', timeout: 15000}).trim();
	const read = (f) => { try { return readFileSync(join(dir, f), 'utf8'); } catch { return null; } };
	const left = execFileSync('sh', ['-c', `ls -A '${dir}/hh'`], {encoding: 'utf8'}).trim().split('\n');
	const kind = execFileSync('sh', ['-c', `if [ -h '${dir}/state' ]; then echo link; elif [ -f '${dir}/state' ]; then echo file; else echo none; fi`], {encoding: 'utf8'}).trim();
	const exe = (rel) => execFileSync('sh', ['-c', `if [ -x '${join(dir, rel)}' ]; then echo yes; else echo no; fi`], {encoding: 'utf8'}).trim();
	return {out, watch: read('hh/watch.sh'), hook: read('init.d/60-homehook'), log: read('log') || '', state: (read('state') || '').trim(), left, app, victim: read('victim'), stateKind: kind, execWatch: exe('hh/watch.sh'), execHook: exe('init.d/60-homehook')};
}
const WATCH_OK = (v) => `#!/bin/sh\n# ${v}\nsingle_instance() { :; }\nhome_key() { :; }\n`;
const HOOK_OK = (v) => `#!/bin/sh\n# ${v}\nstart /var/lib/homehook/watch.sh\n`;

test('self-refresh: a packaged watcher that differs is installed on the second check (install finished), with its hook, then re-execs', () => {
	const r = selfUpdate([1000, 1030]);
	assert.equal(r.out, 'REEXEC');
	assert.equal(r.watch, WATCH_OK('new'));
	assert.equal(r.hook, HOOK_OK('new'));
	assert.match(r.log, /watcher refresh: updated from .*homehook \(Lumen was updated\), restarting/);
	assert.equal(r.state, '1030');
	assert.equal(r.stateKind, 'file');
	assert.equal(r.execWatch, 'yes');   // the boot hook starts it only when it is executable
	assert.equal(r.execHook, 'yes');
	assert.deepEqual(r.left, ['watch.sh']);   // no temporary copies left behind
});

test('self-refresh: one check alone changes nothing, and the same pair already installed is left alone', () => {
	const one = selfUpdate([1000]);
	assert.equal(one.out, '');
	assert.equal(one.watch, WATCH_OK('old'));
	const same = selfUpdate([1000, 1030, 1060], {instWatch: WATCH_OK('new'), instHook: HOOK_OK('new')});
	assert.equal(same.out, '');
	assert.equal(same.log, '');
	assert.deepEqual(same.left, ['watch.sh']);
});

test('self-refresh: a packaged file still changing between checks (install under way) is not taken', () => {
	const r = selfUpdate([1000, 1030], {between: {0: `printf '%s' '${WATCH_OK('newer')}' > "$APPS/${LUMEN}/homehook/watch.sh"`}});
	assert.equal(r.out, '');
	assert.equal(r.watch, WATCH_OK('old'));
});

test('self-refresh: only the hook changed: the hook is updated, no re-exec', () => {
	const r = selfUpdate([1000, 1030], {instWatch: WATCH_OK('new')});
	assert.equal(r.out, '');
	assert.equal(r.hook, HOOK_OK('new'));
	assert.match(r.log, /boot hook updated/);
});

test('self-refresh: a packaged watcher that does not parse or is not watch.sh is refused, logged once', () => {
	const bad = selfUpdate([1000, 1030, 1060, 1090], {pkgWatch: '#!/bin/sh\nif then\n'});
	assert.equal(bad.out, '');
	assert.equal(bad.watch, WATCH_OK('old'));
	assert.equal(bad.log.match(/does not look right/g).length, 1);
	assert.equal(selfUpdate([1000, 1030], {pkgWatch: '#!/bin/sh\necho hi\n'}).watch, WATCH_OK('old'));
	assert.equal(selfUpdate([1000, 1030], {pkgHook: '#!/bin/sh\necho hi\n'}).watch, WATCH_OK('old'));
});

test('self-refresh: a packaged watch.sh that is a symlink is refused; a missing boot hook is not recreated', () => {
	const l = selfUpdate([1000, 1030], {link: true});
	assert.equal(l.out, '');
	assert.equal(l.watch, WATCH_OK('old'));
	const h = selfUpdate([1000, 1030], {hook: false});
	assert.equal(h.out, 'REEXEC');
	assert.equal(h.hook, null);
});

test('self-refresh: at most once a minute and 5 times a boot (the count survives the re-exec)', () => {
	assert.equal(selfUpdate([1000, 1030], {state: '1000\n'}).out, '');
	const max = selfUpdate([5000, 5030, 5060], {state: '1\n2\n3\n4\n5\n'});
	assert.equal(max.out, '');
	assert.equal(max.log.match(/5 refreshes this boot already/g).length, 1);
});

test('self-refresh: the watcher checks about every 30 s and keeps home_reader\'s pid for the re-exec', () => {
	const src = readFileSync(SCRIPT, 'utf8');
	assert.match(src, /\[ \$\(\(ticks % 30\)\) -eq 15 \] && self_update "\$now"/);
	assert.match(src, /home_reader &\nhrpid=\$!/);
	assert.match(src, /exec \/bin\/sh "\$SELF"/);
});

test('self-refresh: the real watch.sh and 60-homehook pass the shape check (a refactor must not stop later refreshes)', () => {
	const real = (f) => readFileSync(new URL(`../../tools/tv/${f}`, import.meta.url), 'utf8');
	const r = selfUpdate([1000, 1030], {pkgWatch: real('watch.sh'), pkgHook: real('60-homehook')});
	assert.equal(r.out, 'REEXEC');
	assert.equal(r.watch, real('watch.sh'));
});

test('a watcher started after the first 5 minutes (re-exec, restart) does not preload Lumen', () => {
	assert.match(readFileSync(SCRIPT, 'utf8'), /\[ "\$wakeuntil" -eq 0 \] && preloadat=0/);
});

test('self-refresh: a re-exec in the first 5 minutes is not a boot (no wake window, no hidden preload)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'reexec-boot-'));
	const lock = join(dir, 'lock');
	const up = join(dir, 'uptime');
	const run = (setup, uptime) => execFileSync('sh', ['-c', `${setup}\nprintf '%s\\n' '${uptime}' > '${up}'\nWATCH_LOCK='${lock}' WATCH_UPTIME='${up}' WATCH_SH_LIB=1 . '${SCRIPT}'\necho "$wakeuntil $preloadat"`], {encoding: 'utf8'}).trim();
	const fresh = run(`rm -rf '${lock}'`, '10.00 1.00').split(' ');
	assert.notEqual(fresh[0], '0');
	assert.notEqual(fresh[1], '0');
	assert.equal(run(`mkdir -p '${lock}' && echo $$ > '${lock}/pid'`, '10.00 1.00'), '0 0');
	assert.equal(run(`rm -rf '${lock}'`, '400.00 1.00'), '0 0');
});

test('self-refresh: re-exec keeps its own single_instance lock instead of dropping it', () => {
	const lock = join(mkdtempSync(join(tmpdir(), 'ownlock-')), 'lock');
	const out = execFileSync('sh', ['-c', `
WATCH_SH_LIB=1 WATCH_LOCK='${lock}' . '${SCRIPT}'
mkdir -p '${lock}'
echo $$ > '${lock}/pid'
ino=$(stat -c %i '${lock}')
if single_instance; then echo ok; else echo busy; fi
echo "$ino $(stat -c %i '${lock}')"
echo "$(cat '${lock}/pid') $$"
`], {encoding: 'utf8'}).trim().split('\n');
	assert.equal(out[0], 'ok');
	assert.equal(out[1].split(' ')[0], out[1].split(' ')[1]);
	assert.equal(out[2].split(' ')[0], out[2].split(' ')[1]);
});

test('self-refresh: re-exec stops the reader that shares its command line, and leaves an unrelated pid alone', () => {
	const dir = mkdtempSync(join(tmpdir(), 'reader-'));
	const watch = join(dir, 'watch.sh');
	const fifo = join(dir, 'fifo');
	execFileSync('sh', ['-c', `mkfifo '${fifo}'`]);
	// blocked on a fifo, so the process stays /bin/sh <this file> (exec sleep would replace that command line)
	writeFileSync(watch, `#!/bin/sh\nread x < '${fifo}'\n`);
	execFileSync('sh', ['-c', `chmod +x '${watch}'`]);
	const out = execFileSync('sh', ['-c', `
WATCH_SH_LIB=1 SELF='${watch}' . '${SCRIPT}'
/bin/sh '${watch}' >/dev/null 2>&1 &
hrpid=$!
i=0
while [ "$i" -lt 50 ] && ! cat /proc/$hrpid/cmdline >/dev/null 2>&1; do sleep 0.05; i=$((i + 1)); done
reader=$hrpid
su_stop_reader
if kill -0 "$reader" 2>/dev/null; then echo READER_ALIVE; kill -9 "$reader" 2>/dev/null || true; else echo READER_DEAD; fi
sleep 30 >/dev/null 2>&1 &
other=$!
hrpid=$other
su_stop_reader
if kill -0 "$other" 2>/dev/null; then echo OTHER_ALIVE; else echo OTHER_DEAD; fi
kill "$other" 2>/dev/null || true
wait "$other" 2>/dev/null || true
wait "$reader" 2>/dev/null || true
`], {encoding: 'utf8', timeout: 8000}).trim();
	assert.equal(out, 'READER_DEAD\nOTHER_ALIVE');
});

test('self-refresh: a failed checksum is not "the same twice", a non-numeric time does not kill the watcher, and a fifo is not read', () => {
	assert.equal(selfUpdate([1000], {md5fail: true}).out, '');
	assert.equal(selfUpdate([1000, 1030], {md5fail: true}).watch, WATCH_OK('old'));
	assert.equal(selfUpdate([1000, '1x']).out, '');
	assert.equal(selfUpdate([1000, '1x']).watch, WATCH_OK('old'));
	const fifo = selfUpdate([1000, 1030], {fifo: true});
	assert.equal(fifo.out, '');
	assert.equal(fifo.watch, WATCH_OK('old'));
});

test('self-refresh: a packaged watcher over 256 KB is refused; a rate-limit symlink is not followed', () => {
	const big = `#!/bin/sh\n# ${'x'.repeat(262144)}\nsingle_instance() { :; }\nhome_key() { :; }\n`;
	const over = selfUpdate([1000, 1030], {pkgWatch: big});
	assert.equal(over.out, '');
	assert.equal(over.watch, WATCH_OK('old'));
	const linked = selfUpdate([1000, 1030], {stateLink: true});
	assert.equal(linked.out, 'REEXEC');
	assert.equal(linked.victim, 'victim\n');
	assert.equal(linked.stateKind, 'file');
	assert.equal(linked.state, '1030');
	assert.equal(linked.watch, WATCH_OK('new'));
});
