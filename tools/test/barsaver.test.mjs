// node --test tools/test/*.test.mjs: Lumen bar's screensaver ({"saver":true}, bar/bar.js openSaver), run in a vm with a tiny fake DOM, a fake
// Luna bridge and fake Image loads (wallpapers/default-0..2.jpg exist).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../bar/bar.js', import.meta.url), 'utf8');
const el = () => ({className: '', style: {}, children: [], textContent: '', innerHTML: '', appendChild (c) { this.children.push(c); return c; }, querySelector () { return null; }});

function start (launchParams) {
	const ids = {bar: el(), view: el(), track: el(), tiles: el(), label: el(), saver: el(), saverA: el(), saverB: el(), saverClock: el()};
	const handlers = {};
	const calls = [];
	let closed = 0;
	const ctx = {
		location: {pathname: '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen.bar/index.html'},
		document: {getElementById: (id) => ids[id], createElement: el, addEventListener (type, fn) { (handlers[type] = handlers[type] || []).push(fn); }},
		PalmServiceBridge: function () { this.call = (uri, params) => { calls.push({uri, params: JSON.parse(params)}); this.onservicecallback(JSON.stringify({returnValue: true, stdoutString: ''})); }; },
		PalmSystem: {launchParams: JSON.stringify(launchParams || {})},
		Image: function () { const img = this; Object.defineProperty(img, 'src', {set (v) { img._src = v; (/default-[0-2]\.jpg$/.test(v) ? img.onload : img.onerror)(); }}); },
		setTimeout: (fn) => { fn.pending = true; return 1; }, clearTimeout () {}, setInterval: () => 1, clearInterval () {},
		close () { closed++; }, decodeURIComponent, JSON, Math, String, RegExp, Date
	};
	ctx.window = ctx;
	vm.runInNewContext(SRC, ctx);
	const fire = (type, props) => { const e = Object.assign({type, preventDefault () {}}, props); (handlers[type] || []).forEach((fn) => fn(e)); };
	const execs = () => calls.filter((c) => c.uri.indexOf('/exec') !== -1).map((c) => c.params.command).filter((c) => c.indexOf('lumen-bar.log') === -1);
	return {ids, fire, calls, execs, closed: () => closed};
}

test('{"saver":true}: an opaque screensaver with Lumen\'s pictures, no bar, and the watcher told it is up', () => {
	const t = start({saver: true, lumen: 'com.ovsteenb.lumen'});
	assert.match(t.ids.saver.className, /saver--on/);
	assert.doesNotMatch(t.ids.bar.className, /bar--in/);
	assert.deepEqual(t.execs(), ['touch /tmp/lumen-ambient-on']);
	const shown = [t.ids.saverA.src, t.ids.saverB.src].filter(Boolean);
	assert.equal(shown.length, 1);
	assert.match(shown[0], /^file:\/\/\/media\/developer\/apps\/usr\/palm\/applications\/com\.ovsteenb\.lumen\/wallpapers\/default-[0-2]\.jpg$/);
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
