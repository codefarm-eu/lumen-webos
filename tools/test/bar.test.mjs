// node --test tools/test/*.test.mjs: runs bar/bar.js (Lumen bar) in a vm with a tiny fake DOM and a fake Luna bridge that answers its
// data/bar.json read, and checks which tiles it draws.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../bar/bar.js', import.meta.url), 'utf8');

function el (tag) {
	return {tag, className: '', style: {}, children: [], textContent: '', innerHTML: '', parentNode: null,
		appendChild (c) { c.parentNode = this; this.children.push(c); return c; }, removeChild () {}, querySelector () { return null; }};
}
function run (data, recent) {
	const ids = {bar: el('div'), tiles: el('div'), label: el('div')};
	// innerHTML = '' empties the tile row
	Object.defineProperty(ids.tiles, 'innerHTML', {set () { this.children = []; }, get () { return ''; }});
	const out = JSON.stringify(data) + '\n@@RECENT\n' + recent.join('\n') + '\n';
	const ctx = {
		location: {pathname: '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen.bar/index.html'},
		document: {getElementById: (id) => ids[id], createElement: el, addEventListener () {}},
		PalmServiceBridge: function () { this.call = (uri) => { const r = uri.indexOf('/exec') !== -1 ? {returnValue: true, stdoutString: out} : {returnValue: true}; this.onservicecallback(JSON.stringify(r)); }; },
		setTimeout: () => 0, clearTimeout () {}, decodeURIComponent, JSON, Math, String, RegExp
	};
	ctx.window = ctx;
	vm.runInNewContext(SRC, ctx);
	return ids.tiles.children;
}
const titles = (tiles) => tiles.filter((t) => t.className.indexOf('tile') === 0).map((t) => t.className.indexOf('tile--home') !== -1 ? 'HOME' : (t.children[0] && t.children[0].textContent));
const DATA = {v: 1, lumen: 'com.ovsteenb.lumen', dock: ['youtube.leanback.v4', 'netflix'], recent: ['com.palm.app.settings'], apps: {
	'youtube.leanback.v4': {title: 'YouTube', plain: true, icon: 'data/icons/youtube.leanback.v4.png'},
	netflix: {title: 'Netflix', plain: true, icon: 'data/icons/netflix.png'},
	'com.webos.app.livetv': {title: 'Live TV', plain: true, icon: 'data/icons/com.webos.app.livetv.png'},
	'com.palm.app.settings': {title: 'TV Settings', color: 'rgb(94, 94, 112)', plain: true}
}};

test('recent apps without an icon (TV Settings) are left out, so no grey letter tile', () => {
	const t = run(DATA, ['youtube.leanback.v4', 'com.palm.app.settings', 'com.webos.app.livetv']);
	assert.deepEqual(titles(t), ['HOME', 'Y', 'N', 'L']);
	assert.equal(t.filter((x) => x.className === 'sep').length, 1);
});

test('dock apps keep their letter fallback even without an icon', () => {
	const d = JSON.parse(JSON.stringify(DATA));
	d.dock.push('com.palm.app.settings');
	assert.deepEqual(titles(run(d, [])), ['HOME', 'Y', 'N', 'T']);
});
