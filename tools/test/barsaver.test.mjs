// node --test tools/test/*.test.mjs: Lumen bar's screensaver ({"saver":true}, bar/bar.js openSaver), run in a vm with a tiny fake DOM, a fake
// Luna bridge and fake Image loads (data/wallpapers/default-0..2.jpg exist: the watcher's copy of Lumen's pictures).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
	const timers = [];
	let closed = 0;
	const ctx = {
		location: {pathname: '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen.bar/index.html'},
		document: {getElementById: (id) => ids[id], createElement: el, addEventListener (type, fn) { (handlers[type] = handlers[type] || []).push(fn); }},
		PalmServiceBridge: function () { this.call = (uri, params) => { calls.push({uri, params: JSON.parse(params)}); this.onservicecallback(JSON.stringify({returnValue: true, stdoutString: opts.exec ? opts.exec(JSON.parse(params).command || '') : ''})); }; },
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
	return {ids, fire, calls, execs, tick, closed: () => closed, ctx};
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
	// the log is cut back by rename, and a link at its name is removed first
	assert.match(logs[0].params.command, /\[ -h \$f \] && rm -f \$f/);
	assert.match(logs[0].params.command, /mktemp \$f\.XXXXXX/);
});

test('Brightness Dim lowers the panel (not the pictures) and the old value is put back after, in that order', () => {
	const t = start({saver: true}, {exec: CONFIG({ambientBrightness: 'dim'})});
	t.tick();
	const dim = t.execs().findIndex((c) => c.indexOf('getSystemSettings') !== -1);
	assert.ok(dim !== -1);
	assert.match(t.execs()[dim], /"backlight":"'30'"/);
	assert.doesNotMatch(t.ids.saver.className, /saver--dim/);
	t.fire('keydown', {keyCode: 13});
	const restore = t.execs().findIndex((c) => c.indexOf('f=/var/lib/homehook/saver-backlight; c=$(cat $f') === 0);
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
