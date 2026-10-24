/* Lumen bar (com.ovsteenb.lumen.bar): Lumen's dock as an overlay window over the app that is playing (webOS 4: "defaultWindowType":
 * "overlay" in appinfo.json; the app underneath stays in front and keeps playing). Plain ES5 for Chromium 53, no build step.
 * Data: data/bar.json in this app's own folder, written by Lumen (Settings > Home Screen > Home shows the bar) with the dock, the icons
 * (copied into data/icons/) and Lumen's app id; /var/lib/homehook/recent (the Home watcher's list of apps that were in front).
 * Keys: Left/Right move, OK opens, Up or the Home tile opens full Lumen, Back/Esc closes (focus goes back to the app underneath).
 * Magic Remote pointer: pointing at a tile focuses it, a click opens it, the wheel moves along; a click off the glass closes the bar. With the
 * pointer showing, OK can come as a click, as keydown 13, or as both: whichever comes first opens the tile and closes the bar, so the
 * other is ignored (closing), and a keydown 13 with the pointer off every tile does nothing (its click closes the bar).
 * Closes by itself after IDLE_MS without a key.
 * Look: Lumen's home bar (bar.css). The tile size, gap, focus scale and tiles per row come from data/bar.json "style" (Lumen's first row);
 * the tiles are placed here, and past perRow tiles the row scrolls to keep the focused one in view. */
(function () {
	'use strict';
	var IDLE_MS = 10000;
	var RECENT_MAX = 4;
	var HOMEHOOK = '/var/lib/homehook';
	var DIR = decodeURIComponent(location.pathname).replace(/\/[^\/]*$/, '');
	var SAFE_DIR = /^\/[A-Za-z0-9._\/+@-]+$/;
	var APP_ID = /^[A-Za-z0-9._-]+$/;
	var KEY = {left: 37, up: 38, right: 39, down: 40, ok: 13, back: 461, esc: 27, backspace: 8};
	var sys = window.webOSSystem || window.PalmSystem;
	var barEl = document.getElementById('bar');
	var tilesEl = document.getElementById('tiles');
	var labelEl = document.getElementById('label');
	var viewEl = document.getElementById('view');
	var trackEl = document.getElementById('track');
	var STYLE = {size: 206, height: 124, gap: 38, perRow: 7, scale: 1.12};
	var PAD = 40;   // glass round the tiles (bar.css --pad)
	var SEP = 2;    // the divider's width; it has a gap either side
	var style = STYLE;
	var scroll = 0;
	var items = [];
	var focus = 0;
	var lumenId = 'com.ovsteenb.lumen';
	var idleTimer = 0;
	var closing = false;
	var pointer = false;   // the Magic Remote's pointer is showing (cursorStateChange, or a pointer move)
	var hover = -1;        // the tile under the pointer
	var told = {};         // pointer events already written to the log once (to see on the TV which ones reach this overlay window)

	function call (uri, params, cb) {
		if (typeof window.PalmServiceBridge !== 'function') { if (cb) cb(null); return; }
		var bridge = new window.PalmServiceBridge();
		var done = false;
		bridge.onservicecallback = function (text) {
			if (done) return;
			done = true;
			var r = null;
			try { r = JSON.parse(text); } catch (e) { r = null; }
			if (cb) cb(r);
		};
		bridge.call(uri, JSON.stringify(params || {}));
		window.__bridges = (window.__bridges || []).concat(bridge);   // keep a reference until it answers
	}
	function exec (command, cb) {
		call('luna://org.webosbrew.hbchannel.service/exec', {command: command}, function (r) { cb(r && r.returnValue !== false ? String(r.stdoutString || '') : null); });
	}
	function log (text) {
		exec('echo "$(date +%T) ' + String(text).replace(/[^\w .:=>,+-]/g, '') + '" >> /tmp/lumen-bar.log', function () {});
	}
	function launch (id) {
		if (!APP_ID.test(id)) return;
		call('luna://com.webos.applicationManager/launch', {id: id}, function (r) {
			log('launch ' + id + ' ' + (r && r.returnValue ? 'ok' : 'failed ' + (r && r.errorText || '')));
		});
	}

	function num (v, lo, hi, d) { return typeof v === 'number' && v >= lo && v <= hi ? v : d; }
	function readStyle (data) {
		var st = (data && data.style) || {};
		return {size: num(st.size, 80, 400, STYLE.size), height: num(st.height, 50, 300, STYLE.height), gap: num(st.gap, 0, 100, STYLE.gap),
			perRow: Math.round(num(st.perRow, 3, 10, STYLE.perRow)), scale: num(st.scale, 1, 1.4, STYLE.scale)};
	}
	function setVar (el, name, value) { if (el && el.style && el.style.setProperty) el.style.setProperty(name, value); }

	function letter (title) { var m = /[A-Za-z0-9]/.exec(title || ''); return m ? m[0].toUpperCase() : '?'; }

	function render () {
		tilesEl.innerHTML = '';
		if (items.length <= 1) {
			var empty = document.createElement('div');
			empty.className = 'bar__empty';
			empty.textContent = 'Open Lumen once to fill the bar';
			empty.style.left = (style.size + style.gap) + 'px';
			tilesEl.appendChild(empty);
		}
		setVar(barEl, '--size', style.size + 'px');
		setVar(barEl, '--height', style.height + 'px');
		setVar(barEl, '--gap', style.gap + 'px');
		setVar(barEl, '--scale', String(style.scale));
		var x = 0;
		for (var i = 0; i < items.length; i++) {
			var it = items[i];
			if (it.sep) {
				var s = document.createElement('div');
				s.className = 'sep';
				s.style.left = x + 'px';
				x += SEP + style.gap;
				tilesEl.appendChild(s);
			}
			var t = document.createElement('div');
			it.x = x;
			t.barIndex = i;
			t.style.left = x + 'px';
			x += style.size + style.gap;
			t.className = 'tile' + (it.home ? ' tile--home' : '') + (it.plain ? ' tile--plain' : '');
			if (it.color && /^#[0-9a-fA-F]{3,8}$|^rgba?\([0-9., ]+\)$/.test(it.color)) t.style.background = it.color;
			if (it.home) {
				t.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/></svg>';
			} else {
				var l = document.createElement('div');
				l.className = 'tile__letter';
				l.textContent = letter(it.title);
				t.appendChild(l);
				if (it.icon) {
					var img = document.createElement('img');
					img.onerror = function () { this.parentNode && this.parentNode.removeChild(this); };
					img.onload = function () { var p = this.parentNode; if (p) { var x = p.querySelector('.tile__letter'); if (x) x.style.display = 'none'; } };
					img.src = it.icon;
					t.appendChild(img);
				}
			}
			it.el = t;
			tilesEl.appendChild(t);
		}
		// the glass fits the tiles, up to perRow of them; past that the row scrolls
		var width = x - style.gap + (items.length > 1 ? 0 : 440);
		var max = style.perRow * style.size + (style.perRow - 1) * style.gap;
		var view = Math.min(width, max);
		barEl.style.width = (view + 2 * PAD) + 'px';
		barEl.style.marginLeft = -Math.round((view + 2 * PAD) / 2) + 'px';
		if (viewEl) viewEl.className = 'bar__view' + (width > max ? ' bar__view--scroll' : '');
		scroll = 0;
		layout.view = view;
		layout.width = width;
		show();
	}
	var layout = {view: 0, width: 0};
	/** the focused tile in view (its whole width, as the row scrolls a tile at a time), and its name under it */
	function place (byPointer) {
		var it = items[focus];
		if (!it || it.x === undefined) return;
		// a tile the pointer is on is already in view; scrolling under the pointer would move another tile under it
		if (byPointer) { /* keep the scroll */ } else if (layout.width > layout.view) {
			if (it.x < scroll) scroll = it.x;
			if (it.x + style.size > scroll + layout.view) scroll = it.x + style.size - layout.view;
			scroll = Math.max(0, Math.min(scroll, layout.width - layout.view));
		} else scroll = 0;
		if (trackEl) trackEl.style.transform = 'translateX(' + (-scroll) + 'px)';
		labelEl.style.left = (it.x + style.size / 2) + 'px';
	}
	function show (byPointer) {
		for (var i = 0; i < items.length; i++) items[i].el.className = items[i].el.className.replace(/ tile--focus/g, '') + (i === focus ? ' tile--focus' : '');
		labelEl.textContent = items[focus] ? items[focus].title : '';
		place(byPointer);
	}

	function parse (out) {
		var parts = (out || '').split('@@RECENT');
		var data = null;
		try { data = JSON.parse(parts[0]); } catch (e) { data = null; }
		var recent = (parts[1] || '').split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return APP_ID.test(x); });
		return {data: data, recent: recent};
	}
	function build (data, recent) {
		var apps = (data && data.apps) || {};
		if (data && APP_ID.test(data.lumen || '')) lumenId = data.lumen;
		var list = [{home: true, id: lumenId, title: 'Lumen'}];
		var seen = {};
		seen[lumenId] = true;
		var dock = (data && data.dock) || [];
		for (var i = 0; i < dock.length; i++) {
			var a = apps[dock[i]];
			if (!a || seen[dock[i]]) continue;
			seen[dock[i]] = true;
			list.push({id: dock[i], title: a.title, color: a.color, plain: a.plain, icon: a.icon});
		}
		// recent apps that are not in the dock, after a divider: the watcher's list first (apps opened from anywhere), then Lumen's
		var ids = recent.concat((data && data.recent) || []);
		var added = 0;
		for (var j = 0; j < ids.length && added < RECENT_MAX; j++) {
			var id = ids[j];
			// a recent app with no icon file (TV Settings and other system apps Lumen draws with its own glyph) is left out: a grey letter tile
			// does not match the rest of the bar
			if (seen[id] || !apps[id] || !apps[id].icon || /^com\.ovsteenb\.lumen/.test(id)) continue;
			seen[id] = true;
			list.push({id: id, title: apps[id].title, color: apps[id].color, plain: apps[id].plain, icon: apps[id].icon, sep: added === 0});
			added++;
		}
		return list;
	}
	function load (initial) {
		if (!SAFE_DIR.test(DIR)) { items = build(null, []); render(); return; }
		exec('cat ' + DIR + '/data/bar.json 2>/dev/null; echo; echo @@RECENT; cat ' + HOMEHOOK + '/recent 2>/dev/null; true', function (out) {
			var p = parse(out);
			style = readStyle(p.data);
			items = build(p.data, p.recent);
			if (initial || focus >= items.length) focus = items.length > 1 ? 1 : 0;
			render();
		});
	}

	function close (why) {
		if (closing) return;
		closing = true;
		window.clearTimeout(idleTimer);
		barEl.className = 'bar';
		log('close ' + why);
		window.setTimeout(function () { try { window.close(); } catch (e) { /* nothing */ } }, 150);
	}
	function poke () {
		window.clearTimeout(idleTimer);
		idleTimer = window.setTimeout(function () { close('idle'); }, IDLE_MS);
	}
	function open (initial) {
		closing = false;
		focus = items.length > 1 ? 1 : 0;
		load(initial);
		try { if (sys && sys.activate) sys.activate(); } catch (e) { /* older firmware */ }
		barEl.className = 'bar bar--in';
		poke();
	}

	/** opens item i (the Home tile is Lumen itself) and closes the bar; once closing, a second OK or click is ignored */
	function activate (i, how) {
		var it = items[i];
		if (!it || closing) return;
		launch(it.id);
		close('open ' + it.id + ' (' + how + ')');
	}
	function move (by) {
		if (!items.length) return;
		focus = Math.max(0, Math.min(items.length - 1, focus + by));
		show();
	}
	/** the tile an event happened on (its img, letter or svg count), or -1 */
	function tileAt (node) {
		for (var n = node; n && n !== barEl && n !== document; n = n.parentNode) if (typeof n.barIndex === 'number') return n.barIndex;
		return -1;
	}
	function onBar (node) {
		for (var n = node; n; n = n.parentNode) if (n === barEl) return true;
		return false;
	}
	function once (what) { if (!told[what]) { told[what] = true; log('pointer: ' + what); } }

	function pointed (e) {
		if (closing) return;
		once(e.type);
		pointer = true;
		poke();
		hover = tileAt(e.target);
		if (hover >= 0 && hover !== focus && items[hover]) { focus = hover; show(true); }
	}
	document.addEventListener('mousemove', pointed, true);
	document.addEventListener('mouseover', pointed, true);
	document.addEventListener('click', function (e) {
		if (closing) return;
		once('click');
		if (e.preventDefault) e.preventDefault();
		var i = tileAt(e.target);
		if (i >= 0) activate(i, 'click');
		else if (!onBar(e.target)) close('pointer outside');   // off the glass: the app underneath gets the remote back
	}, true);
	document.addEventListener('wheel', function (e) {
		if (closing) return;
		once('wheel');
		if (e.preventDefault) e.preventDefault();
		poke();
		if (e.deltaY) move(e.deltaY > 0 ? 1 : -1);
	}, true);
	document.addEventListener('cursorStateChange', function (e) {
		var on = !!(e.detail && e.detail.visibility);
		log('pointer: cursor ' + (on ? 'shown' : 'hidden'));
		pointer = on;
		if (!on) hover = -1;
		if (!closing) poke();
	}, false);
	document.addEventListener('webOSMouse', function (e) { log('pointer: webOSMouse ' + (e.detail && e.detail.inRange ? 'in' : 'out')); }, false);

	document.addEventListener('keydown', function (e) {
		var k = e.keyCode;
		if (closing) return;
		poke();
		if (k === KEY.left || k === KEY.right) {
			e.preventDefault();
			pointer = false;   // an arrow puts the remote back in 5-way mode, and the system hides the pointer
			hover = -1;
			move(k === KEY.left ? -1 : 1);
		} else if (k === KEY.ok) {
			e.preventDefault();
			// with the pointer showing, OK on a tile opens that tile (hover focused it); off every tile it waits for its click
			if (pointer && hover < 0) return;
			activate(pointer ? hover : focus, pointer ? 'ok, pointer' : 'ok');
		} else if (k === KEY.up) {
			e.preventDefault();
			launch(lumenId);
			close('up: lumen');
		} else if (k === KEY.back || k === KEY.esc || k === KEY.backspace) {
			e.preventDefault();
			close('back');
		}
	}, true);
	document.addEventListener('webOSRelaunch', function () { open(false); }, true);
	open(true);
})();
