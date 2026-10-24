// node --test tools/test/*.test.mjs: the remote's Home through LG Input Hook (tools/tv/watch.sh home_key) and Lumen bar's answer to it
// (bar/bar.js): Home opens the bar over any app and over Lumen, and Home while the bar is up closes it, except right after it came up.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';

const SCRIPT = new URL('../../tools/tv/watch.sh', import.meta.url).pathname;
const BAR_SRC = readFileSync(new URL('../../bar/bar.js', import.meta.url), 'utf8');

/** runs home_key once with `fg` in front; a fake luna-send records each launch's JSON. Prints the launches. */
function homeKey (fg, {bar = true, syslog = null, uptime = '20000.00', close = 'true'} = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'homekey-'));
	const bin = join(dir, 'bin');
	const apps = join(dir, 'apps');
	mkdirSync(bin); mkdirSync(join(apps, 'com.ovsteenb.lumen'), {recursive: true});
	if (bar) mkdirSync(join(apps, 'com.ovsteenb.lumen.bar'));
	writeFileSync(join(bin, 'luna-send'), `#!/bin/sh
case "$3" in
  */getForegroundAppInfo) echo '{"returnValue":true,"appId":"${fg}"}' ;;
  */launch) echo "$4" >> '${dir}/launches'; echo '{"returnValue":true}' ;;
  */closeByAppId) echo "$4" | sed 's/^/CLOSE /' >> '${dir}/launches.close'; echo '{"returnValue": ${close}}' ;;
esac
`);
	chmodSync(join(bin, 'luna-send'), 0o755);
	if (syslog !== null) writeFileSync(join(dir, 'messages'), syslog);
	writeFileSync(join(dir, 'takeover'), '');
	if (bar) writeFileSync(join(dir, 'home-bar'), '');
	const sh = [`WATCH_SH_LIB=1 HOMEKEY_AT='${join(dir, 'at')}' . '${SCRIPT}'`,
		`SYSLOG='${join(dir, 'messages')}'; BAR_CLOSED_AT='${join(dir, 'closed-at')}'`, `up () { echo '${uptime}'; }`,
		`APPS='${apps}'; TAKEOVER_FLAG='${join(dir, 'takeover')}'; BAR_FLAG='${join(dir, 'home-bar')}'; WAKEFILE='${join(dir, 'wu')}'; LASTME='${join(dir, 'lastme')}'`,
		'home_key'].join('\n');
	// home_key puts /bin, /usr/bin... first; there is no luna-send there off the TV, so the fake one in front of PATH is the one found
	execFileSync('sh', ['-c', sh], {encoding: 'utf8', env: {...process.env, PATH: `${bin}:${process.env.PATH}`}});
	let launches = [];
	try { launches = readFileSync(join(dir, 'launches'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { /* none */ }
	try { launches = launches.concat(readFileSync(join(dir, 'launches.close'), 'utf8').trim().split('\n')); } catch { /* none */ }
	let closedAt = '';
	try { closedAt = readFileSync(join(dir, 'closed-at'), 'utf8').trim(); } catch { /* not written */ }
	homeKey.closedAt = closedAt;
	return launches;
}

test('Home over an app opens Lumen bar with {"home":true}', () => {
	assert.deepEqual(homeKey('youtube.leanback.v4'), [{id: 'com.ovsteenb.lumen.bar', params: {home: true}}]);
});

test('Home over full Lumen opens the bar too', () => {
	assert.deepEqual(homeKey('com.ovsteenb.lumen'), [{id: 'com.ovsteenb.lumen.bar', params: {home: true}}]);
});

test('without the bar: Home over an app opens Lumen, over Lumen it does nothing (as before)', () => {
	assert.deepEqual(homeKey('youtube.leanback.v4', {bar: false}), [{id: 'com.ovsteenb.lumen'}]);
	assert.deepEqual(homeKey('com.ovsteenb.lumen', {bar: false}), []);
});

/** runs bar.js in a vm with a fake DOM and clock; returns helpers to fire events and read the bar's state */
function bar () {
	const el = () => ({className: '', style: {}, children: [], textContent: '', innerHTML: '', parentNode: null,
		appendChild (c) { c.parentNode = this; this.children.push(c); return c; }, removeChild () {}, querySelector () { return null; }, setAttribute () {}});
	const ids = {bar: el(), view: el(), track: el(), tiles: el(), label: el()};
	ids.bar.parentNode = el();
	ids.view.parentNode = ids.bar; ids.track.parentNode = ids.view; ids.tiles.parentNode = ids.track; ids.label.parentNode = ids.track;
	const handlers = {};
	const timers = new Map();
	let nextTimer = 1;
	let now = 100000;
	let closed = 0;
	const ctx = {
		location: {pathname: '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen.bar/index.html'},
		document: {getElementById: (id) => ids[id], createElement: el, addEventListener (type, fn) { (handlers[type] = handlers[type] || []).push(fn); }},
		PalmServiceBridge: function () { this.call = () => this.onservicecallback(JSON.stringify({returnValue: true, stdoutString: ''})); },
		setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, {fn, ms}); return id; },
		clearTimeout: (id) => { timers.delete(id); },
		close: () => { closed++; },
		Date: {now: () => now}, decodeURIComponent, JSON, Math, String, RegExp
	};
	ctx.window = ctx;
	vm.runInNewContext(BAR_SRC, ctx);
	const fire = (type, props) => (handlers[type] || []).forEach((fn) => fn(Object.assign({type, preventDefault () {}}, props)));
	return {
		up: () => ids.bar.className.indexOf('bar--in') !== -1,
		wait: (ms) => { now += ms; },
		relaunch: (detail) => fire('webOSRelaunch', {detail}),
		key: (keyCode) => fire('keydown', {keyCode, target: ids.bar}),
		/** runs the pending 150 ms window.close timers; returns how many times the window was closed */
		flush: () => { for (const [id, t] of [...timers]) if (t.ms === 150) { timers.delete(id); t.fn(); } return closed; }
	};
}

test('bar: Home while it is up closes it, as Back does', () => {
	const b = bar();
	assert.ok(b.up());
	b.wait(2000);
	b.relaunch({home: true});
	assert.ok(!b.up());
	assert.equal(b.flush(), 1);
});

test('bar: a second Home within 500 ms of it coming up (double press) is ignored, it stays up', () => {
	const b = bar();
	b.wait(200);
	b.relaunch({home: true});
	assert.ok(b.up());
	assert.equal(b.flush(), 0);
	b.wait(400);
	b.relaunch({home: true});
	assert.ok(!b.up());
});

test('bar: a relaunch without "home" (LG Home seen by the watcher) keeps it up, as before', () => {
	const b = bar();
	b.wait(2000);
	b.relaunch({});
	assert.ok(b.up());
});

test('bar: Home again during the close fade-out opens it again, and the pending window close is cancelled', () => {
	const b = bar();
	b.wait(2000);
	b.key(461);
	assert.ok(!b.up());
	b.wait(50);
	b.relaunch({home: true});
	assert.ok(b.up());
	assert.equal(b.flush(), 0);
});

/** a surface-manager line as the C8 writes it, at uptime `at` (seconds) */
const vsc = (at, visible) => `2026-10-24T20:48:11.402145Z [${at}] user.info surface-manager-starfish [] LSM NL_VSC {     "app_id": "com.ovsteenb.lumen.bar",     "visible": ${visible},     "window_type": "_WEBOS_WINDOW_TYPE_OVERLAY" }  \n`;

test('Home while the surface manager says Lumen bar is up closes it (closeByAppId), with no relaunch', () => {
	const r = homeKey('youtube.leanback.v4', {syslog: vsc('19990.084747309', 'false') + vsc('19995.084747309', 'true'), uptime: '20000.00'});
	assert.deepEqual(r, ['CLOSE {"id":"com.ovsteenb.lumen.bar"}']);
	assert.equal(homeKey.closedAt, '2000000');
});

test('Home within 0.3 s of the bar window coming up is ignored (double press)', () => {
	assert.deepEqual(homeKey('youtube.leanback.v4', {syslog: vsc('19999.800000000', 'true'), uptime: '20000.00'}), []);
});

test('bar hidden, or no surface-manager line (log rotated): Home opens the bar', () => {
	const open = [{id: 'com.ovsteenb.lumen.bar', params: {home: true}}];
	assert.deepEqual(homeKey('youtube.leanback.v4', {syslog: vsc('19995.0', 'true') + vsc('19998.084747309', 'false')}), open);
	assert.deepEqual(homeKey('youtube.leanback.v4', {syslog: ''}), open);
	assert.deepEqual(homeKey('youtube.leanback.v4'), open);
});

test('a close that fails (stale log line) falls back to launching the bar', () => {
	const r = homeKey('youtube.leanback.v4', {syslog: vsc('19990.084747309', 'true'), close: 'false'});
	assert.deepEqual(r, [{id: 'com.ovsteenb.lumen.bar', params: {home: true}}, 'CLOSE {"id":"com.ovsteenb.lumen.bar"}']);
});

test('bar_just_closed: true for 2 s after a Home close; a stamp that is not digits counts as none', () => {
	const dir = mkdtempSync(join(tmpdir(), 'closed-'));
	const f = join(dir, 'at');
	const check = (stamp, now) => {
		writeFileSync(f, stamp);
		return execFileSync('sh', ['-c', `WATCH_SH_LIB=1 BAR_CLOSED_AT='${f}' . '${SCRIPT}'; up () { echo '${now}'; }; bar_just_closed && echo yes || echo no`], {encoding: 'utf8'}).trim();
	};
	assert.equal(check('2000000', '20001.50'), 'yes');
	assert.equal(check('2000000', '20002.50'), 'no');
	assert.equal(check('1x', '20000.10'), 'no');
	assert.equal(check('', '20000.10'), 'no');
});

test('bar: a relaunch delivered twice (webOS 4) is handled once, so Home does not close and reopen it', () => {
	const b = bar();
	b.wait(2000);
	b.relaunch({home: true});
	b.wait(18);
	b.relaunch({home: true});
	assert.ok(!b.up());
	assert.equal(b.flush(), 1);
});
