// node --test tools/test/*.test.mjs: runs bar/bar.js (Lumen bar) in a vm with a tiny fake DOM and a fake Luna bridge that answers its
// data/bar.json read, and checks which tiles it draws.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../bar/bar.js', import.meta.url), 'utf8');

function el (tag) {
	return {tag, className: '', style: {}, children: [], textContent: '', innerHTML: '', parentNode: null,
		appendChild (c) { c.parentNode = this; this.children.push(c); return c; }, removeChild () {}, querySelector () { return null; }, setAttribute () {}};
}
function run (data, recent) {
	const ids = {bar: el('div'), view: el('div'), track: el('div'), tiles: el('div'), label: el('div')};
	// innerHTML = '' empties the tile row
	Object.defineProperty(ids.tiles, 'innerHTML', {set () { this.children = []; }, get () { return ''; }});
	const out = JSON.stringify(data) + '\n@@RECENT\n' + recent.join('\n') + '\n';
	const handlers = {};
	const launches = [];
	const timers = [];
	ids.view.parentNode = ids.bar;
	ids.track.parentNode = ids.view;
	ids.tiles.parentNode = ids.track;
	ids.label.parentNode = ids.track;
	const body = el('body');
	ids.bar.parentNode = body;
	const ctx = {
		location: {pathname: '/media/developer/apps/usr/palm/applications/com.ovsteenb.lumen.bar/index.html'},
		document: {getElementById: (id) => ids[id], createElement: el, addEventListener (type, fn) { (handlers[type] = handlers[type] || []).push(fn); }},
		PalmServiceBridge: function () { this.call = (uri, params) => { if (uri.indexOf('/launch') !== -1) launches.push(JSON.parse(params).id); const r = uri.indexOf('/exec') !== -1 ? {returnValue: true, stdoutString: out} : {returnValue: true}; this.onservicecallback(JSON.stringify(r)); }; },
		setTimeout: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimeout () {}, decodeURIComponent, JSON, Math, String, RegExp
	};
	ctx.window = ctx;
	vm.runInNewContext(SRC, ctx);
	run.ids = ids;
	run.body = body;
	run.launches = launches;
	run.timers = timers;
	run.fire = (type, props) => { const e = Object.assign({type, preventDefault () {}}, props); (handlers[type] || []).forEach((fn) => fn(e)); };
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

test('tiles take the size, gap and focus scale Lumen writes, and past perRow tiles the bar scrolls', () => {
	const d = JSON.parse(JSON.stringify(DATA));
	d.style = {size: 240, height: 144, gap: 46, perRow: 3, scale: 1.16};
	const t = run(d, ['com.webos.app.livetv']);
	const tiles = t.filter((x) => x.className.indexOf('tile') === 0);
	assert.deepEqual(tiles.map((x) => x.style.left), ['0px', '286px', '572px', '906px']);   // the divider adds 2px + a gap before Live TV
	assert.equal(t.filter((x) => x.className === 'sep')[0].style.left, '858px');
	assert.equal(run.ids.bar.style.width, (3 * 240 + 2 * 46 + 80) + 'px');   // three tiles of glass, 40px round them
	assert.equal(run.ids.view.className, 'bar__view bar__view--scroll');
	assert.equal(run.ids.label.style.left, (286 + 120) + 'px');   // YouTube is focused, its name under it
});

test('without a style the bar uses Lumen\'s 7-a-row tiles and does not scroll', () => {
	run(DATA, []);
	assert.equal(run.ids.bar.style.width, (3 * 206 + 2 * 38 + 80) + 'px');
	assert.equal(run.ids.view.className, 'bar__view');
	assert.equal(run.ids.track.style.transform, 'translateX(0px)');
});

// the Magic Remote pointer: tiles[i] is the i-th tile (0 = Home), an event's target can be the tile's img inside it
const tilesOf = (t) => t.filter((x) => x.className.indexOf('tile') === 0);

test('pointing at a tile focuses it and shows its name, and a pointer move keeps the bar open (10 s again)', () => {
	const tiles = tilesOf(run(DATA, []));
	const before = run.timers.filter((ms) => ms === 10000).length;
	run.fire('mousemove', {target: tiles[2].children[0]});
	assert.match(tiles[2].className, /tile--focus/);
	assert.doesNotMatch(tiles[1].className, /tile--focus/);
	assert.equal(run.ids.label.textContent, 'Netflix');
	assert.equal(run.timers.filter((ms) => ms === 10000).length, before + 1);
});

test('a click opens the tile under the pointer, once, even when OK also comes as keydown 13', () => {
	const tiles = tilesOf(run(DATA, []));
	run.fire('cursorStateChange', {detail: {visibility: true}});
	run.fire('mouseover', {target: tiles[2]});
	run.fire('keydown', {keyCode: 13});
	run.fire('click', {target: tiles[2]});
	assert.deepEqual(run.launches, ['netflix']);
});

test('the click may come before the key: still one launch', () => {
	const tiles = tilesOf(run(DATA, []));
	run.fire('mousemove', {target: tiles[1]});
	run.fire('click', {target: tiles[1]});
	run.fire('keydown', {keyCode: 13});
	assert.deepEqual(run.launches, ['youtube.leanback.v4']);
});

test('clicking the house opens full Lumen', () => {
	const tiles = tilesOf(run(DATA, []));
	run.fire('mousemove', {target: tiles[0]});
	run.fire('click', {target: tiles[0]});
	assert.deepEqual(run.launches, ['com.ovsteenb.lumen']);
});

test('a click off the glass closes the bar and opens nothing; a click on the glass between tiles does nothing', () => {
	run(DATA, []);
	run.fire('click', {target: run.ids.tiles});
	assert.deepEqual(run.launches, []);
	assert.equal(run.ids.bar.className, 'bar bar--in');
	run.fire('click', {target: run.body});
	assert.deepEqual(run.launches, []);
	assert.equal(run.ids.bar.className, 'bar');   // closing
	run.fire('keydown', {keyCode: 13});
	assert.deepEqual(run.launches, []);
});

test('with the pointer showing but on no tile, OK waits for its click; once the pointer hides, OK opens the focused tile', () => {
	run(DATA, []);
	run.fire('cursorStateChange', {detail: {visibility: true}});
	run.fire('mousemove', {target: run.body});
	run.fire('keydown', {keyCode: 13});
	assert.deepEqual(run.launches, []);
	run.fire('cursorStateChange', {detail: {visibility: false}});
	run.fire('keydown', {keyCode: 13});
	assert.deepEqual(run.launches, ['youtube.leanback.v4']);
});

test('the wheel moves the focus along the bar', () => {
	const tiles = tilesOf(run(DATA, []));
	run.fire('wheel', {deltaY: 100});
	assert.match(tiles[2].className, /tile--focus/);
	run.fire('wheel', {deltaY: -100});
	assert.match(tiles[1].className, /tile--focus/);
});

test('number keys 1 to 6 open the dock app at that place, as on the home screen; not a recent app, and not past the dock', () => {
	run(DATA, ['com.webos.app.livetv']);
	run.fire('keydown', {keyCode: 50});
	assert.deepEqual(run.launches, ['netflix']);
	run(DATA, ['com.webos.app.livetv']);
	run.fire('keydown', {keyCode: 51});   // 3: the place after the dock is Live TV, a recent app
	assert.deepEqual(run.launches, []);
	run(DATA, []);
	run.fire('keydown', {keyCode: 97});   // number pad 1
	assert.deepEqual(run.launches, ['youtube.leanback.v4']);
});
