// node --test tools/test/*.test.mjs: Lumen bar's screensaver ({"saver":true}, bar/bar.js openSaver), run in a vm with a tiny fake DOM, a fake
// Luna bridge and fake Image loads (data/wallpapers/default-0..2.jpg exist: the watcher's copy of Lumen's pictures).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../bar/bar.js', import.meta.url), 'utf8');
const FLAG_ON = 't=$(mktemp /tmp/lumen-ambient-on.XXXXXX) && echo bar > "$t" && chmod 644 "$t" && mv -f "$t" /tmp/lumen-ambient-on';
const el = () => ({className: '', style: {}, children: [], textContent: '', innerHTML: '', appendChild (c) { this.children.push(c); return c; }, querySelector () { return null; }});

// the pictures that load: by default the watcher's copy in the bar's data/wallpapers (a webOS 4 app can't load another app's files)
const BAR_PICS = /\/com\.ovsteenb\.lumen\.bar\/data\/wallpapers\/default-[0-2]\.jpg$/;
function start (launchParams, opts = {}) {
	const loads = opts.loads || BAR_PICS;
	const ids = {bar: el(), view: el(), track: el(), tiles: el(), label: el(), saver: el(), saverA: el(), saverB: el(), saverClock: el()};
	const handlers = {};
	const calls = [];
	const held = [];
	const timers = [];
	let closed = 0;
	const ctx = {
		location: {pathname: '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen.bar/index.html'},
		document: {getElementById: (id) => ids[id], createElement: el, addEventListener (type, fn) { (handlers[type] = handlers[type] || []).push(fn); }},
		PalmServiceBridge: function () { this.call = (uri, params) => {
			calls.push({uri, params: JSON.parse(params)});
			const cmd = JSON.parse(params).command || '';
			const answer = () => this.onservicecallback(JSON.stringify({returnValue: true, stdoutString: opts.exec ? opts.exec(cmd) : ''}));
			if (opts.hold && opts.hold(cmd)) held.push(answer); else answer();
		}; },
		PalmSystem: {launchParams: JSON.stringify(launchParams || {})},
		Image: function () { const img = this; Object.defineProperty(img, 'src', {set (v) { img._src = v; (loads.test(v) ? img.onload : img.onerror)(); }}); },
		setTimeout: (fn, ms) => { fn.pending = true; timers.push({fn, ms: ms || 0}); return 1; }, clearTimeout () {}, setInterval: () => 1, clearInterval () {},
		XMLHttpRequest: opts.files ? function () { const x = this; x.open = (m, u) => { x.url = u; }; x.send = () => { const f = opts.files[x.url.replace(/^file:\/\//, '')]; x.readyState = 4; x.status = f == null ? 404 : 200; x.responseText = f || ''; x.onreadystatechange(); }; } : undefined,
		close () { closed++; }, decodeURIComponent, JSON, Math, String, RegExp, Date
	};
	ctx.window = ctx;
	vm.runInNewContext(SRC, ctx);
	const fire = (type, props) => { const e = Object.assign({type, preventDefault () {}}, props); (handlers[type] || []).forEach((fn) => fn(e)); };
	const execs = () => calls.filter((c) => c.uri.indexOf('/exec') !== -1).map((c) => c.params.command).filter((c) => c.indexOf('lumen-bar.log') === -1);
	// runs the timers set for `ms` or less (the screensaver's 30 ms fade-in), once
	const tick = (ms = 50) => { timers.splice(0).forEach((t) => { if (t.ms <= ms) t.fn(); else timers.push(t); }); };
	return {ids, fire, calls, execs, tick, closed: () => closed, ctx, held};
}

test('{"saver":true}: an opaque screensaver with Lumen\'s pictures, no bar, and the watcher told it is up', () => {
	const t = start({saver: true, lumen: 'com.ovsteenb.lumen'});
	assert.match(t.ids.saver.className, /saver--on/);
	assert.doesNotMatch(t.ids.bar.className, /bar--in/);
	// the settings backup is read as root here (the test has no XMLHttpRequest, as when the TV refuses the plain read)
	assert.deepEqual(t.execs(), [FLAG_ON, 'cat /var/lib/homehook/lumen-config.json 2>/dev/null; true']);
	const shown = [t.ids.saverA.src, t.ids.saverB.src].filter(Boolean);
	assert.equal(shown.length, 1);
	assert.match(shown[0], /^file:\/\/\/media\/developer\/apps\/usr\/palm\/applications\/com\.ovsteenb\.lumen\.bar\/data\/wallpapers\/default-[0-2]\.jpg$/);
});

const PICS_DIR = '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen.bar/data/wallpapers/';
test('the pictures come from the list the watcher wrote with its copy, when it can be read', () => {
	const t = start({saver: true}, {files: {[PICS_DIR + 'list']: 'default-3.jpg\ndefault-7.jpg\n../x.jpg\n'}, loads: /default-[37]\.jpg$/});
	const shown = [t.ids.saverA.src, t.ids.saverB.src].filter(Boolean);
	assert.equal(shown.length, 1);
	assert.match(shown[0], /\/data\/wallpapers\/default-[37]\.jpg$/);
});

test('with no list, a missing number does not hide the pictures after it (probing stops at two misses in a row)', () => {
	const t = start({saver: true}, {loads: /\/data\/wallpapers\/default-(0|2|3)\.jpg$/});
	const logs = t.calls.map((c) => c.params.command || '').filter((c) => c.indexOf('lumen-bar.log') !== -1).join('\n');
	assert.match(logs, /saver: open, 3 pictures probe/);
});

test('a fresh install before the watcher\'s first copy: no pictures, black with the clock, and the log says why', () => {
	const t = start({saver: true}, {loads: /^$/});
	assert.match(t.ids.saver.className, /saver--on/);
	assert.deepEqual([t.ids.saverA.src, t.ids.saverB.src].filter(Boolean), []);
	assert.match((t.calls.map((c) => c.params.command || '').filter((c) => c.indexOf('lumen-bar.log') !== -1).join('\n')), /no pictures yet/);
});

test('picture time and brightness come from Lumen\'s settings backup, read as root when a plain read is refused', () => {
	const t = start({saver: true}, {exec: (c) => (c.indexOf('cat /var/lib/homehook/lumen-config.json') === 0 ? JSON.stringify({config: {ambientSeconds: 60, ambientBrightness: 'low'}}) : '')});
	assert.ok(t.calls.some((c) => (c.params.command || '').indexOf('cat /var/lib/homehook/lumen-config.json') === 0));
	t.tick();
	assert.match(t.ids.saver.className, /saver--in/);
	assert.match(t.ids.saver.className, /saver--low/);
});

test('any key closes the screensaver and nothing else: no app is launched, the window closes, the flag goes', () => {
	const t = start({saver: true});
	t.fire('keydown', {keyCode: 13});
	assert.equal(t.calls.filter((c) => c.uri.indexOf('/launch') !== -1).length, 0);
	assert.ok(t.execs().indexOf('rm -f /tmp/lumen-ambient-on') !== -1);
	assert.doesNotMatch(t.ids.saver.className, /saver--in/);
});

test('a relaunch with {"saver":true} over the bar shows the screensaver; Home while it is up closes it', async () => {
	const t = start({});
	t.fire('webOSRelaunch', {detail: {saver: true}});
	assert.match(t.ids.saver.className, /saver--on/);
	await new Promise((r) => setTimeout(r, 300));   // past the duplicate-relaunch guard (RELAUNCH_DUP_MS)
	t.fire('webOSRelaunch', {detail: {home: true}});
	assert.ok(t.execs().indexOf('rm -f /tmp/lumen-ambient-on') !== -1);
});

test('the pointer moving does not end the screensaver, a click does', () => {
	const t = start({saver: true});
	t.fire('mousemove', {target: {}});
	assert.equal(t.execs().indexOf('rm -f /tmp/lumen-ambient-on'), -1);
	t.fire('click', {target: {}});
	assert.ok(t.execs().indexOf('rm -f /tmp/lumen-ambient-on') !== -1);
});

test('{"saver":true} again while the screensaver is up writes the flag again (the watcher may have dropped it)', async () => {
	const t = start({saver: true});
	await new Promise((r) => setTimeout(r, 300));   // past the duplicate-relaunch guard (RELAUNCH_DUP_MS)
	t.fire('webOSRelaunch', {detail: {saver: true}});
	assert.equal(t.execs().filter((c) => c === FLAG_ON).length, 2);
	assert.match(t.ids.saver.className, /saver--on/);
});

const CONFIG = (c) => (cmd) => (cmd.indexOf('cat /var/lib/homehook/lumen-config.json') === 0 ? JSON.stringify({config: c}) : cmd.indexOf('saver-backlight') !== -1 && cmd.indexOf('getSystemSettings') !== -1 ? 'dimmed' : '');

test('the pointer showing or hiding under the screensaver neither closes it nor arms the bar\'s idle close (Fable H2)', () => {
	const t = start({saver: true});
	t.fire('cursorStateChange', {detail: {visibility: true}});
	t.fire('cursorStateChange', {detail: {visibility: false}});
	t.tick(20000); t.tick(20000);
	assert.equal(t.closed(), 0);
	assert.equal(t.execs().indexOf('rm -f /tmp/lumen-ambient-on'), -1);
	assert.match(t.ids.saver.className, /saver--on/);
});

test('Home right after a key ended the screensaver (its fade-out) does not bring the bar up over the app (Fable H3)', () => {
	const t = start({saver: true});
	t.fire('keydown', {keyCode: 13});
	t.fire('webOSRelaunch', {detail: {home: true}});
	t.fire('webOSRelaunch', {detail: {}});
	assert.doesNotMatch(t.ids.bar.className, /bar--in/);
	t.tick(500);
	assert.equal(t.closed(), 1);
	// a new screensaver in the fade is still shown
	const u = start({saver: true});
	u.fire('keydown', {keyCode: 13});
	u.fire('webOSRelaunch', {detail: {saver: true}});
	assert.match(u.ids.saver.className, /saver--on/);
});

test('only the same relaunch twice is a duplicate: {"home":true} right after {"saver":true} still ends the screensaver', () => {
	const t = start({});
	t.fire('webOSRelaunch', {detail: {saver: true}});
	t.fire('webOSRelaunch', {detail: {saver: true}});   // the C8's double delivery: dropped
	assert.equal(t.execs().filter((c) => c === FLAG_ON).length, 1);
	t.fire('webOSRelaunch', {detail: {home: true}});
	assert.ok(t.execs().indexOf('rm -f /tmp/lumen-ambient-on') !== -1);
});

test('answered Luna bridges are let go, and the log stops after LOG_MAX lines per window', () => {
	const t = start({});
	assert.equal((t.ctx.__bridges || []).length, 0);
	for (let i = 0; i < 400; i++) t.fire('cursorStateChange', {detail: {visibility: i % 2 === 0}});
	const logs = t.calls.filter((c) => (c.params.command || '').indexOf('lumen-bar.log') !== -1);
	assert.ok(logs.length <= 200, String(logs.length));
	// written as root only inside the watcher's own folder: there it is, as a link or missing nothing is written
	const cmd = logs[0].params.command;
	const dir = mkdtempSync(join(tmpdir(), 'barlog-'));
	const runIn = (d) => execFileSync('sh', ['-c', cmd.split('/tmp/homehook.run').join(d)]);
	execFileSync('sh', ['-c', `mkdir -m 700 '${dir}/run' && mkdir '${dir}/elsewhere' && ln -s '${dir}/elsewhere' '${dir}/link'`]);
	runIn(join(dir, 'run'));
	assert.match(readFileSync(join(dir, 'run', 'lumen-bar.log'), 'utf8'), /pointer/);
	runIn(join(dir, 'link'));
	runIn(join(dir, 'missing'));
	assert.equal(execFileSync('sh', ['-c', `ls -A '${dir}/elsewhere'; ls -d '${dir}/missing' 2>/dev/null; true`], {encoding: 'utf8'}), '');
	assert.match(cmd, /mktemp \$f\.XXXXXX/);
	assert.doesNotMatch(cmd, /\/tmp\/lumen-bar\.log/);
});

test('Brightness Dim lowers the panel (not the pictures) and the old value is put back after, in that order', () => {
	const t = start({saver: true}, {exec: CONFIG({ambientBrightness: 'dim'})});
	t.tick();
	const dim = t.execs().findIndex((c) => c.indexOf('getSystemSettings') !== -1);
	assert.ok(dim !== -1);
	assert.match(t.execs()[dim], /"backlight":"'30'"/);
	assert.doesNotMatch(t.ids.saver.className, /saver--dim/);
	t.fire('keydown', {keyCode: 13});
	const restore = t.execs().findIndex((c) => c.indexOf('f=/var/lib/homehook/saver-backlight; read -r c sm') === 0);
	assert.ok(restore > dim);
});

test('a panel that could not be dimmed: the pictures are made darker instead', () => {
	const t = start({saver: true}, {exec: (cmd) => (cmd.indexOf('cat /var/lib/homehook/lumen-config.json') === 0 ? JSON.stringify({config: {ambientBrightness: 'low'}}) : '')});
	t.tick();
	assert.match(t.ids.saver.className, /saver--low/);
});

test('Move clock: the clock goes to a place inside the safe area; off, it stays put', () => {
	const t = start({saver: true});
	const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(t.ids.saverClock.style.transform);
	assert.ok(m, t.ids.saverClock.style.transform);
	const x = Number(m[1]), y = Number(m[2]);
	assert.ok(x >= 0 && 96 + x + 340 <= 1824, String(x));
	assert.ok(850 + y >= 65 && 850 + y + 150 <= 1015, String(y));
	const off = start({saver: true}, {exec: CONFIG({ambientMove: false})});
	assert.equal(off.ids.saverClock.style.transform, '');
});

test('the root queue waits for a slow lowering to really finish (not just the 3 s call timeout) before the restore goes', () => {
	const t = start({saver: true}, {exec: CONFIG({ambientBrightness: 'dim'}), hold: (c) => c.indexOf('getSystemSettings') !== -1 && c.indexOf('echo "$c $m"') !== -1});
	t.tick();
	assert.equal(t.held.length, 1, 'the lowering is out');
	t.fire('keydown', {keyCode: 13});
	t.tick(3000);   // the call timeout passes: the lowering may still be running on the TV
	const restoreSent = () => t.execs().some((c) => c.indexOf('f=/var/lib/homehook/saver-backlight; read -r c sm') === 0);
	assert.equal(restoreSent(), false, 'no restore while the lowering may still land');
	t.held.shift()();   // the lowering answers
	assert.equal(restoreSent(), true);
});

/** runs one of the bar's root commands in sh against a fake settings service (state in `dir`) */
function runRoot (cmd, dir, {backlight = 80, mode = 'cinema', setOk = true} = {}) {
	writeFileSync(join(dir, 'tv'), `${backlight} ${mode}`);
	writeFileSync(join(dir, 'luna-send'), `#!/bin/sh
read -r b m < '${dir}/tv'
case "$*" in
  *getSystemSettings*) printf '{"returnValue": true, "settings": {"backlight": "%s", "pictureMode": "%s"}}\\n' "$b" "$m" ;;
  *setSystemSettings*) ${setOk ? `v=$(echo "$*" | sed -n 's/.*"backlight":"\\([0-9]*\\)".*/\\1/p'); echo "$v $m" > '${dir}/tv'; echo '{"returnValue": true}'` : `echo '{"returnValue": false}'`} ;;
esac
`, {mode: 0o755});
	const out = execFileSync('sh', ['-c', '{ ' + cmd.split('/var/lib/homehook/saver-backlight').join(join(dir, 'saved')).split('mkdir -p /var/lib/homehook').join('true') + '\n}; true'], {encoding: 'utf8', env: {...process.env, PATH: `${dir}:${process.env.PATH}`}});
	const read = (f) => { try { return readFileSync(join(dir, f), 'utf8').trim(); } catch { return null; } };
	return {tv: read('tv'), saved: read('saved'), out: out.trim()};
}

test('backlight as root: saved with its picture mode, put back only into that mode, and kept when the settings service refuses', () => {
	const t = start({saver: true}, {exec: CONFIG({ambientBrightness: 'dim'})});
	t.tick();
	const dim = t.execs().find((c) => c.indexOf('echo "$c $m"') !== -1);
	t.fire('keydown', {keyCode: 13});
	const restore = t.execs().find((c) => c.indexOf('f=/var/lib/homehook/saver-backlight; read -r c sm') === 0);
	const dir = mkdtempSync(join(tmpdir(), 'bar-bl-'));
	let r = runRoot(dim.split('/tmp/lumen-ambient-on').join(join(dir, 'flag')), dir, {backlight: 80, mode: 'cinema'});
	assert.equal(r.saved, null, 'no flag: the lowering put itself back at once');
	// the flag is up, so the lowering stays
	writeFileSync(join(dir, 'flag'), 'bar');
	r = runRoot(dim.split('/tmp/lumen-ambient-on').join(join(dir, 'flag')), dir, {backlight: 80, mode: 'cinema'});
	assert.equal(r.saved, '80 cinema');
	assert.equal(r.tv, '30 cinema');
	// another mode on: left alone for the watcher
	r = runRoot(restore, dir, {backlight: 100, mode: 'hdrCinema'});
	assert.equal(r.saved, '80 cinema');
	assert.equal(r.tv, '100 hdrCinema');
	// the settings service refuses: kept
	r = runRoot(restore, dir, {backlight: 30, mode: 'cinema', setOk: false});
	assert.equal(r.saved, '80 cinema');
	r = runRoot(restore, dir, {backlight: 30, mode: 'cinema'});
	assert.equal(r.saved, null);
	assert.equal(r.tv, '80 cinema');
	// an older build's number only
	writeFileSync(join(dir, 'saved'), '70\n');
	r = runRoot(restore, dir, {backlight: 30, mode: 'vivid'});
	assert.equal(r.tv, '70 vivid');
	assert.equal(r.saved, null);
});

test('backlight as root: a value still saved for another picture mode leaves this mode undimmed, so it is never left dim with nothing saved', () => {
	const t = start({saver: true}, {exec: CONFIG({ambientBrightness: 'dim'})});
	t.tick();
	const dim = t.execs().find((c) => c.indexOf('echo "$c $m"') !== -1);
	t.fire('keydown', {keyCode: 13});
	const restore = t.execs().find((c) => c.indexOf('f=/var/lib/homehook/saver-backlight; read -r c sm') === 0);
	const dir = mkdtempSync(join(tmpdir(), 'bar-bl-'));
	writeFileSync(join(dir, 'flag'), 'bar');
	const lower = dim.split('/tmp/lumen-ambient-on').join(join(dir, 'flag'));
	// the TV went off under an HDR film's screensaver: its value waits for hdrCinema (the watcher); now a screensaver over a cinema film
	writeFileSync(join(dir, 'saved'), '100 hdrCinema\n');
	let r = runRoot(lower, dir, {backlight: 80, mode: 'cinema'});
	assert.equal(r.tv, '80 cinema', 'cinema not lowered');
	assert.equal(r.saved, '100 hdrCinema');
	r = runRoot(restore, dir, {backlight: 80, mode: 'cinema'});
	assert.equal(r.tv, '80 cinema');
	// the mode can't be read: not lowered either
	r = runRoot(lower, dir, {backlight: 80, mode: ''});
	assert.equal(r.tv, '80');
	// the same mode as the saved value (its restore never landed), or an older build's number: lowered, the saved value kept
	r = runRoot(lower, dir, {backlight: 90, mode: 'hdrCinema'});
	assert.equal(r.tv, '30 hdrCinema');
	assert.equal(r.saved, '100 hdrCinema');
	writeFileSync(join(dir, 'saved'), '70\n');
	r = runRoot(lower, dir, {backlight: 80, mode: 'vivid'});
	assert.equal(r.tv, '30 vivid');
	assert.equal(r.saved, '70');
	// nothing readable in the file (gone between the check and the read, or empty): this mode is saved, then lowered
	writeFileSync(join(dir, 'saved'), '\n');
	r = runRoot(lower, dir, {backlight: 80, mode: 'cinema'});
	assert.equal(r.tv, '30 cinema');
	assert.equal(r.saved, '80 cinema');
	// the file can't be read or replaced: not lowered, so a mode is never dimmed with nothing that can be put back
	writeFileSync(join(dir, 'saved'), '100 hdrCinema\n');
	chmodSync(join(dir, 'saved'), 0o000);
	r = runRoot(lower, dir, {backlight: 80, mode: 'cinema'});
	assert.equal(r.tv, '80 cinema');
	chmodSync(join(dir, 'saved'), 0o644);
});

test('backlight as root: a lowering the settings service refused does not say "dimmed", so the pictures are darkened instead', () => {
	const t = start({saver: true}, {exec: CONFIG({ambientBrightness: 'dim'})});
	t.tick();
	const dim = t.execs().find((c) => c.indexOf('echo "$c $m"') !== -1);
	const dir = mkdtempSync(join(tmpdir(), 'bar-bl-'));
	writeFileSync(join(dir, 'flag'), 'bar');
	const lower = dim.split('/tmp/lumen-ambient-on').join(join(dir, 'flag'));
	let r = runRoot(lower, dir, {backlight: 80, mode: 'cinema', setOk: false});
	assert.equal(r.tv, '80 cinema');
	assert.equal(r.out, '', 'not "dimmed": the panel is as bright as before');
	// the value saved first is the real one and stays for the restore (the same value, no harm) rather than being lost
	assert.equal(r.saved, '80 cinema');
	r = runRoot(lower, dir, {backlight: 80, mode: 'cinema'});
	assert.equal(r.out, 'dimmed');
	assert.equal(r.tv, '30 cinema');
	// in the window: a refused lowering keeps the pictures dark (saver--dim), the same as a panel that could not be read
	const refused = start({saver: true}, {exec: (cmd) => (cmd.indexOf('cat /var/lib/homehook/lumen-config.json') === 0 ? JSON.stringify({config: {ambientBrightness: 'dim'}}) : '')});
	refused.tick();
	assert.match(refused.ids.saver.className, /saver--dim/);
});
