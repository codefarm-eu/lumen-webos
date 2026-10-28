/* Lumen bar (com.ovsteenb.lumen.bar): Lumen's dock as an overlay window over the app that is playing (webOS 4: "defaultWindowType":
 * "overlay" in appinfo.json; the app underneath stays in front and keeps playing). Plain ES5 for Chromium 53, no build step.
 * Data: data/bar.json in this app's own folder, written by Lumen (Settings > Home Screen > Home shows the bar) with the dock, the icons
 * (copied into data/icons/) and Lumen's app id; /var/lib/homehook/recent (the Home watcher's list of apps that were in front).
 * Keys: Left/Right move, OK opens, 1 to 6 open the dock's apps, Up or the Home tile opens full Lumen, Back/Esc closes (focus goes back to the app underneath).
 * The remote's Home closes it too: watch.sh's home_key closes the bar itself (closeByAppId) when the surface manager says it is up. Only when
 * that is unknown does it launch the bar again with {"home":true}; that relaunch while the bar is up closes it like Back, and HOME_DEBOUNCE_MS
 * after it came up a second press is ignored. webOS 4 delivered one relaunch twice (C8, 24 Oct 2026: closed, then opened again), so a
 * relaunch with the same parameters within RELAUNCH_DUP_MS of the previous one is dropped.
 * Magic Remote pointer: pointing at a tile focuses it, a click opens it, the wheel moves along; a click off the glass closes the bar. With the
 * pointer showing, OK can come as a click, as keydown 13, or as both: whichever comes first opens the tile and closes the bar, so the
 * other is ignored (closing), and a keydown 13 with the pointer off every tile does nothing (its click closes the bar).
 * Closes by itself after IDLE_MS without a key.
 * Look: Lumen's home bar (bar.css). The tile size, gap, focus scale and tiles per row come from data/bar.json "style" (Lumen's first row);
 * the tiles are placed here, and past perRow tiles the row scrolls to keep the focused one in view.
 * Screensaver ({"saver":true}, from tools/tv/watch.sh when the TV's screensaver starts over another app): Lumen's bundled pictures (copied by
 * root into this app's data/wallpapers/ by watch.sh bar_pictures: this window can't load Lumen's, and they ship only in Lumen) and a clock,
 * full screen and opaque, in this overlay window, so the app underneath (a film paused in Moonfin or YouTube) stays in front with its player
 * as it was: it is never sent to the background or relaunched, which made Moonfin drop its player. Any key or click closes it, and the remote
 * is the app's again. /tmp/lumen-ambient-on holds "bar" while it is up, so the watcher only ends LG's screensaver when its timer fires again.
 * Settings > Screensaver > Brightness lowers the panel's backlight while it shows, as Lumen's own screensaver does (the old value is kept in
 * /var/lib/homehook/saver-backlight and put back when it ends; the watcher puts it back too when it closes the bar, or finds the bar gone),
 * and Settings > Screensaver > Move clock moves the clock to a new place each minute (lib/burnin.ts's rule). */
(function () {
	'use strict';
	var IDLE_MS = 10000;
	var HOME_DEBOUNCE_MS = 500;
	var RELAUNCH_DUP_MS = 250;
	var LOG_MAX = 200;     // lines this window writes to /tmp/lumen-bar.log (RAM) before it stops; the file itself is kept under LOG_BYTES
	var LOG_BYTES = 65536;
	var SAVER_BACKLIGHT = {dim: 30, low: 10};   // as Lumen's (app.tsx AMBIENT_BACKLIGHT)
	var SAVED_BACKLIGHT = '/var/lib/homehook/saver-backlight';
	// the screensaver's flag for the watcher, written as root by rename (a link someone put at that name in /tmp is replaced, not written through)
	var FLAG_ON = 't=$(mktemp /tmp/lumen-ambient-on.XXXXXX) && echo bar > "$t" && chmod 644 "$t" && mv -f "$t" /tmp/lumen-ambient-on';
	var CALL_MS = 3000;
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
	var closeTimer = 0;
	var openedAt = 0;      // when the bar last came up (Date.now), for the Home debounce
	var relaunchAt = 0;    // the last webOSRelaunch handled (Date.now), to drop a duplicate
	var relaunchKey = '';  // and its parameters (only the same relaunch twice is a duplicate)
	var logged = 0;        // lines written to the log by this window
	var pointer = false;   // the Magic Remote's pointer is showing (cursorStateChange, or a pointer move)
	var hover = -1;        // the tile under the pointer
	var told = {};         // pointer events already written to the log once (to see on the TV which ones reach this overlay window)

	/** A Luna call. With no answer within CALL_MS, cb(null): on 24 Oct the Homebrew Channel's service stopped answering on the C8, and the bar
	 *  waited for ever with no tiles, an invisible window that took Home and Back until it timed out. */
	function call (uri, params, cb) {
		if (typeof window.PalmServiceBridge !== 'function') { if (cb) cb(null); return; }
		var bridge = new window.PalmServiceBridge();
		var done = false;
		var timer = 0;
		var drop = function () {
			var list = window.__bridges || [];
			for (var i = 0; i < list.length; i++) if (list[i] === bridge) { list.splice(i, 1); break; }
		};
		timer = window.setTimeout(function () { drop(); if (done) return; done = true; if (cb) cb(null); }, CALL_MS);
		bridge.onservicecallback = function (text) {
			drop();
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			var r = null;
			try { r = JSON.parse(text); } catch (e) { r = null; }
			if (cb) cb(r);
		};
		bridge.call(uri, JSON.stringify(params || {}));
		// a reference until it answers or times out (the window can stay up for hours with the screensaver: answered ones are dropped)
		if (!done) (window.__bridges = window.__bridges || []).push(bridge);
	}
	function exec (command, cb) {
		call('luna://org.webosbrew.hbchannel.service/exec', {command: command}, function (r) { cb(r && r.returnValue !== false ? String(r.stdoutString || '') : null); });
	}
	/** One line in /tmp/lumen-bar.log (written as root: a link put at that name is removed first, and the file is cut back to its last half once
	 *  over LOG_BYTES, by rename). At most LOG_MAX lines per window, so a screensaver left up for hours does not keep writing. */
	function log (text) {
		if (logged >= LOG_MAX) return;
		logged++;
		var f = '/tmp/lumen-bar.log';
		exec('f=' + f + '; [ -h $f ] && rm -f $f; echo "$(date +%T) ' + String(text).replace(/[^\w .:=>,+-]/g, '') + '" >> $f; '
			+ 'if [ "$(wc -c < $f)" -gt ' + LOG_BYTES + ' ]; then t=$(mktemp $f.XXXXXX) && tail -c ' + (LOG_BYTES / 2) + ' $f > "$t" && mv -f "$t" $f; fi; true', function () {});
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
			list.push({id: id, title: apps[id].title, color: apps[id].color, plain: apps[id].plain, icon: apps[id].icon, sep: added === 0, recent: true});
			added++;
		}
		return list;
	}
	/** a file as text, read straight from disk (a webOS 4 web app may read file:// paths); null when it can't be read */
	function readFile (path, cb) {
		var done = false;
		var finish = function (text) { if (!done) { done = true; cb(text); } };
		try {
			var x = new XMLHttpRequest();
			x.open('GET', 'file://' + path, true);
			x.onreadystatechange = function () { if (x.readyState === 4) finish((x.status === 0 || x.status === 200) && x.responseText ? String(x.responseText) : null); };
			x.onerror = function () { finish(null); };
			x.send();
		} catch (e) { finish(null); }
	}
	function apply (out, initial) {
		var p = parse(out);
		style = readStyle(p.data);
		items = build(p.data, p.recent);
		if (initial || focus >= items.length) focus = items.length > 1 ? 1 : 0;
		render();
	}
	/** The bar's data is read from disk, without the Homebrew Channel; only if that fails is it read through the Channel's exec (as root).
	 *  Either way something is drawn: with nothing read, the bar still has its Home tile. */
	function load (initial) {
		if (!SAFE_DIR.test(DIR)) { items = build(null, []); render(); return; }
		readFile(DIR + '/data/bar.json', function (json) {
			readFile(HOMEHOOK + '/recent', function (recent) {
				if (json) { apply(json + '\n@@RECENT\n' + (recent || ''), initial); return; }
				exec('cat ' + DIR + '/data/bar.json 2>/dev/null; echo; echo @@RECENT; cat ' + HOMEHOOK + '/recent 2>/dev/null; true', function (out) {
					if (out === null) log('load: no data (Homebrew Channel not answering)');
					apply(out, initial);
				});
			});
		});
	}

	// ----- screensaver -----
	var SAVER_SECONDS = 30;
	var saverEl = document.getElementById('saver');
	var saverPics = [document.getElementById('saverA'), document.getElementById('saverB')];
	var saverClockEl = document.getElementById('saverClock');
	var saver = {on: false, timer: 0, clockTimer: 0, files: [], at: -1, layer: 0, seconds: SAVER_SECONDS, ends: 0, session: 0, brightness: '', shown: false,
		panel: false, move: true, offset: {x: 0, y: 0}, movedAt: 0};
	var saverClosing = false;   // the screensaver's 400 ms fade-out: a relaunch then (Home just after the key that ended it) opens nothing
	var MOVE_EVERY_MS = 60000;  // lib/burnin.ts
	/** lib/burnin.ts nextOffset in ES5: a new offset for a box at `rest` inside `area`, at least a third of the free range away from `prev` when
	 *  there is room (else the farthest of 12 random tries). Whole pixels. */
	function nextOffset (rest, area, prev, rand) {
		var minX = area.left - rest.left, maxX = area.right - (rest.left + rest.width);
		var minY = area.top - rest.top, maxY = area.bottom - (rest.top + rest.height);
		if (minX > maxX) minX = maxX = (minX + maxX) / 2;
		if (minY > maxY) minY = maxY = (minY + maxY) / 2;
		var far = Math.sqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY)) / 3;
		var best = {x: Math.round(minX), y: Math.round(minY)}, bestD = -1;
		for (var i = 0; i < 12; i++) {
			var o = {x: Math.min(Math.floor(maxX), Math.max(Math.ceil(minX), Math.round(minX + rand() * (maxX - minX)))),
				y: Math.min(Math.floor(maxY), Math.max(Math.ceil(minY), Math.round(minY + rand() * (maxY - minY))))};
			var d = Math.sqrt((o.x - prev.x) * (o.x - prev.x) + (o.y - prev.y) * (o.y - prev.y));
			if (d >= far) return o;
			if (d > bestD) { best = o; bestD = d; }
		}
		return best;
	}
	/** the clock's resting box (bar.css .saver__clock: left 96px, bottom 80px) and lib/burnin.ts's safe area of the 1920 x 1080 frame */
	function clockRest () {
		var w = (saverClockEl && saverClockEl.offsetWidth) || 340, h = (saverClockEl && saverClockEl.offsetHeight) || 150;
		return {left: 96, top: 1080 - 80 - h, width: w, height: h};
	}
	var SAFE_AREA = {left: 96, top: 65, right: 1824, bottom: 1015};
	function two (n) { return (n < 10 ? '0' : '') + n; }
	function saverClock () {
		if (!saverClockEl) return;
		var d = new Date();
		saverClockEl.textContent = two(d.getHours()) + ':' + two(d.getMinutes());
		// Move clock on (the default): a new random place in the safe area each minute, far from the last one, so it never burns in.
		// Off: it stays where it is, as on Lumen's own screensaver.
		var now = Date.now();
		if (!saver.move || (saver.movedAt && now - saver.movedAt >= 0 && now - saver.movedAt < MOVE_EVERY_MS)) return;
		saver.movedAt = now;
		saver.offset = nextOffset(clockRest(), SAFE_AREA, saver.offset, Math.random);
		saverClockEl.style.transform = 'translate(' + saver.offset.x + 'px, ' + saver.offset.y + 'px)';
	}
	/** The screensaver's pictures: Lumen's default-N.jpg, which ship only in Lumen. Root copies them into this app's data/wallpapers/ along
	 *  with a "list" of their names (tools/tv/watch.sh bar_pictures, run before it opens this screensaver), because a webOS 4 web app may not
	 *  load another app's files (C8, 28 Oct 2026: from here every picture in Lumen's folder failed). If the list can't be read, each name is
	 *  tried in turn, stopping only after two misses in a row, so one missing number doesn't hide the rest. None yet (a fresh install before
	 *  the watcher's first copy) means black with the clock. */
	var SAVER_PICS = DIR + '/data/wallpapers/';
	var SAVER_NAME = /^default-[0-9]{1,2}\.jpg$/;
	function saverFind (cb) {
		readFile(SAVER_PICS + 'list', function (text) {
			var names = (text || '').split('\n').filter(function (n) { return SAVER_NAME.test(n); });
			if (names.length) { cb(names.map(function (n) { return 'file://' + SAVER_PICS + n; }), 'list'); return; }
			saverProbe(cb);
		});
	}
	function saverProbe (cb) {
		var found = [];
		var misses = 0;
		var probe = function (n) {
			if (n >= 40 || misses >= 2 || typeof Image !== 'function') { cb(found, 'probe'); return; }
			var src = 'file://' + SAVER_PICS + 'default-' + n + '.jpg';
			var img = new Image();
			img.onload = function () { misses = 0; found.push(src); probe(n + 1); };
			img.onerror = function () { misses++; probe(n + 1); };
			img.src = src;
		};
		probe(0);
	}
	function saverNext () {
		if (!saver.on || !saver.files.length) return;
		var n = saver.files.length;
		var next = n === 1 ? 0 : (saver.at + 1 + Math.floor(Math.random() * (n - 1))) % n;
		saver.at = next;
		var show = saverPics[saver.layer];
		var hide = saverPics[1 - saver.layer];
		saver.layer = 1 - saver.layer;
		if (show) {
			show.onload = function () { show.className = 'saver__pic saver__pic--in'; if (hide) hide.className = 'saver__pic'; };
			show.src = saver.files[next];
		}
		saver.timer = window.setTimeout(saverNext, saver.seconds * 1000);
	}
	/** Settings > Screensaver's picture time and brightness, from Lumen's settings backup on the TV; the defaults when it can't be read */
	function saverSettings (cb) {
		// outside this app's folder, so a plain read may be refused (as Lumen's folder is): then it is read as root
		readFile(HOMEHOOK + '/lumen-config.json', function (text) {
			if (text) { saverConfig(text, cb); return; }
			exec('cat ' + HOMEHOOK + '/lumen-config.json 2>/dev/null; true', function (out) { saverConfig(out, cb); });
		});
	}
	function saverConfig (text, cb) {
		var c = null;
		try { c = JSON.parse(text || 'null'); } catch (e) { c = null; }
		c = c && typeof c === 'object' ? (c.config && typeof c.config === 'object' ? c.config : c) : {};
		cb({seconds: num(c.ambientSeconds, 5, 3600, SAVER_SECONDS), brightness: c.ambientBrightness === 'dim' || c.ambientBrightness === 'low' ? c.ambientBrightness : '',
			move: c.ambientMove !== false});
	}
	// ----- the panel's backlight while the screensaver shows (lib/tvcontrols.ts dimForScreensaver, in the shell as root) -----
	// One root call at a time, in order: a restore sent while a lowering was still out could land first, and the panel stayed dim.
	var rootQueue = [];
	var rootBusy = false;
	function serial (command, cb) {
		rootQueue.push({command: command, cb: cb});
		if (!rootBusy) rootNext();
	}
	function rootNext () {
		var job = rootQueue.shift();
		if (!job) { rootBusy = false; return; }
		rootBusy = true;
		exec(job.command, function (out) { if (job.cb) job.cb(out); rootNext(); });
	}
	var BACKLIGHT_GET = "luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings '{\"category\":\"picture\",\"keys\":[\"backlight\"]}' 2>/dev/null"
		+ " | sed -n 's/.*\"backlight\": *\"\\{0,1\\}\\([0-9][0-9]*\\).*/\\1/p'";
	function backlightSet (v) {
		return "luna-send -n 1 luna://com.webos.settingsservice/setSystemSettings '{\"category\":\"picture\",\"settings\":{\"backlight\":\"'" + v + "'\"}}' >/dev/null 2>&1";
	}
	/** Lowers the backlight to `level` (never raises it). The value before is kept in SAVED_BACKLIGHT, unless one is there already (a
	 *  screensaver that never put it back: that one is still the real value). Prints "dimmed" when it did. */
	function saverDimCommand (level) {
		return 'f=' + SAVED_BACKLIGHT + '; c=$(' + BACKLIGHT_GET + '); case "$c" in \'\'|*[!0-9]*) exit 0 ;; esac; '
			+ '[ "$c" -gt ' + level + ' ] || exit 0; [ -f $f ] || { mkdir -p ' + HOMEHOOK + ' && echo "$c" > $f; }; ' + backlightSet(level) + '; '
			// the screensaver already gone (its flag removed: the watcher closed the bar, and put the backlight back, while this was under way):
			// put it back here too, or the panel stayed dim with nothing left to undo it
			+ 'if [ -f /tmp/lumen-ambient-on ]; then echo dimmed; else ' + SAVER_RESTORE + '; fi';
	}
	/** Puts back the value in SAVED_BACKLIGHT, if there is one, and removes it. tools/tv/watch.sh saver_backlight_restore does the same. */
	var SAVER_RESTORE = 'f=' + SAVED_BACKLIGHT + '; c=$(cat $f 2>/dev/null); case "$c" in \'\'|*[!0-9]*) rm -f $f; exit 0 ;; esac; '
		+ '[ "$c" -le 100 ] && ' + backlightSet('$c') + '; rm -f $f';
	function saverDim (level, live) {
		serial(saverDimCommand(level), function (out) {
			if (out && out.indexOf('dimmed') !== -1) {
				saver.panel = true;
				if (live() && saver.shown) saverEl.className = saverClass();
			}
		});
	}
	function saverRestore () {
		serial(SAVER_RESTORE, function () {});
	}
	function openSaver () {
		if (!saverEl) { log('saver: no screensaver in this build'); return; }
		// already up (the watcher's next {"saver":true}): the flag is written again, as the watcher drops a "bar" flag when it can't see the
		// bar running (a running list that did not answer), and without it every LG screensaver timer relaunched this window
		if (saver.on) { exec(FLAG_ON, function () {}); return; }
		saver.on = true;
		saverClosing = false;
		saver.ends = 0;
		saver.panel = false;
		saver.movedAt = 0;
		window.clearTimeout(idleTimer);
		window.clearTimeout(closeTimer);
		closing = false;
		barEl.className = 'bar';
		openedAt = Date.now();
		try { if (sys && sys.activate) sys.activate(); } catch (e) { /* older firmware */ }
		// "bar": the watcher knows the flag is this window's, and drops it once the bar is closed (tools/tv/watch.sh ambient_stale)
		exec(FLAG_ON, function () {});
		saverClock();
		saver.clockTimer = window.setInterval ? window.setInterval(saverClock, 10000) : 0;
		// black at once, over the app: the settings (possibly read as root) and the pictures are found meanwhile, and the first picture
		// fades in once both are known. A late answer from an earlier opening (session) is dropped.
		var session = ++saver.session;
		var live = function () { return saver.on && saver.session === session; };
		saver.brightness = '';
		saver.shown = false;
		saverEl.className = 'saver saver--on';
		window.setTimeout(function () { if (live()) { saver.shown = true; saverEl.className = saverClass(); } }, 30);
		var waiting = 2;
		var ready = function () { if (--waiting === 0 && live()) saverNext(); };
		saverSettings(function (st) {
			if (!live()) return;
			saver.seconds = st.seconds;
			saver.brightness = st.brightness;
			saver.move = st.move;
			if (!saver.move) { saver.offset = {x: 0, y: 0}; if (saverClockEl) saverClockEl.style.transform = ''; }
			if (st.brightness) saverDim(SAVER_BACKLIGHT[st.brightness], live);
			if (saver.shown) saverEl.className = saverClass();
			ready();
		});
		saverFind(function (files, from) {
			if (!live()) return;
			saver.files = files;
			log('saver: open, ' + (files.length ? files.length + ' pictures (' + from + ')' : 'no pictures yet (the watcher copies them from Lumen), black with the clock'));
			ready();
		});
	}
	// the pictures are only made darker here when the panel could not be dimmed (the backlight unreadable, or already that low)
	function saverClass () { return 'saver saver--on saver--in' + (saver.brightness && !saver.panel ? ' saver--' + saver.brightness : ''); }
	function closeSaver (why) {
		if (!saver.on) return;
		saver.on = false;
		window.clearTimeout(saver.timer);
		if (saver.clockTimer && window.clearInterval) window.clearInterval(saver.clockTimer);
		if (saverEl) saverEl.className = 'saver saver--on';
		exec('rm -f /tmp/lumen-ambient-on', function () {});
		saverRestore();
		log('saver: close ' + why);
		saverClosing = true;
		closing = true;
		window.clearTimeout(idleTimer);
		// if the window is not closed after all (window.close refused), a later Home must still open the bar
		window.setTimeout(function () { saverClosing = false; }, 1500);
		closeTimer = window.setTimeout(function () { try { window.close(); } catch (e) { /* nothing */ } }, 400);
	}
	function wantsSaver (p) { return !!(p && p.saver === true); }
	/** the Lumen build whose pictures to show (watch.sh passes the one Home opens) */
	function saverLumen (p) { if (p && typeof p.lumen === 'string' && APP_ID.test(p.lumen)) lumenId = p.lumen; }

	function close (why) {
		// the screensaver is ended as such (its flag, the backlight), never just closed with the bar's own fade
		if (saver.on) { closeSaver(why); return; }
		if (closing) return;
		closing = true;
		window.clearTimeout(idleTimer);
		barEl.className = 'bar';
		log('close ' + why);
		closeTimer = window.setTimeout(function () { try { window.close(); } catch (e) { /* nothing */ } }, 150);
	}
	function poke () {
		// no idle close under the screensaver: only a key or a click ends it
		if (saver.on) return;
		window.clearTimeout(idleTimer);
		idleTimer = window.setTimeout(function () { close('idle'); }, IDLE_MS);
	}
	function open (initial) {
		// a launch in the 150 ms fade-out: the window stays (the pending close is cancelled)
		window.clearTimeout(closeTimer);
		closing = false;
		openedAt = Date.now();
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
	/** 1 to 6 on the digit row or the number pad (Lumen's Home.tsx dockDigit), else 0 */
	function dockDigit (k) { return k >= 49 && k <= 54 ? k - 48 : k >= 97 && k <= 102 ? k - 96 : 0; }
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
		if (saver.on) return;   // the pointer moving does not end the screensaver (a remote on a table), a click or a key does
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
		if (saver.on) { if (e.preventDefault) e.preventDefault(); closeSaver('click'); return; }
		if (closing) return;
		once('click');
		if (e.preventDefault) e.preventDefault();
		var i = tileAt(e.target);
		if (i >= 0) activate(i, 'click');
		else if (!onBar(e.target)) close('pointer outside');   // off the glass: the app underneath gets the remote back
	}, true);
	document.addEventListener('wheel', function (e) {
		if (saver.on) { if (e.preventDefault) e.preventDefault(); closeSaver('wheel'); return; }
		if (closing) return;
		once('wheel');
		if (e.preventDefault) e.preventDefault();
		poke();
		if (e.deltaY) move(e.deltaY > 0 ? 1 : -1);
	}, true);
	document.addEventListener('cursorStateChange', function (e) {
		var on = !!(e.detail && e.detail.visibility);
		// the pointer showing or hiding (the remote picked up) does not end the screensaver, nor arm the bar's idle close under it
		if (saver.on) return;
		if (on !== pointer) log('pointer: cursor ' + (on ? 'shown' : 'hidden'));
		pointer = on;
		if (!on) hover = -1;
		if (!closing) poke();
	}, false);
	document.addEventListener('webOSMouse', function (e) { log('pointer: webOSMouse ' + (e.detail && e.detail.inRange ? 'in' : 'out')); }, false);

	document.addEventListener('keydown', function (e) {
		var k = e.keyCode;
		// any key ends the screensaver, and only that: the app underneath gets the next one
		if (saver.on) { e.preventDefault(); closeSaver('key ' + k); return; }
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
		} else if (dockDigit(k)) {
			// 1 to 6 open the dock's apps at those places, as on Lumen's home screen (the Home tile is not counted, nor are recent apps)
			var d = dockDigit(k);
			if (!items[d] || items[d].recent || items[d].home) return;
			e.preventDefault();
			activate(d, 'key ' + d);
		} else if (k === KEY.up) {
			e.preventDefault();
			launch(lumenId);
			close('up: lumen');
		} else if (k === KEY.back || k === KEY.esc || k === KEY.backspace) {
			e.preventDefault();
			close('back');
		}
	}, true);
	/** the launch parameters of a relaunch: the event's detail, else PalmSystem.launchParams (a JSON string) */
	function relaunchParams (e) {
		if (e && e.detail && typeof e.detail === 'object') return e.detail;
		try { return JSON.parse((sys && sys.launchParams) || '{}') || {}; } catch (err) { return {}; }
	}
	document.addEventListener('webOSRelaunch', function (e) {
		var t = Date.now();
		var p = relaunchParams(e);
		var k = '';
		try { k = JSON.stringify(p); } catch (err) { k = ''; }
		if (relaunchAt && k === relaunchKey && t - relaunchAt >= 0 && t - relaunchAt < RELAUNCH_DUP_MS) { log('relaunch: duplicate dropped (' + (t - relaunchAt) + ' ms)'); return; }
		relaunchAt = t;
		relaunchKey = k;
		if (wantsSaver(p)) { saverLumen(p); openSaver(); return; }
		// the screensaver's fade-out (a key ended it): a Home right after is not a request for the bar, the app underneath gets the remote back
		if (saverClosing) { log('relaunch: ignored, the screensaver is closing'); return; }
		// Home while the screensaver is up: it ends, and the app underneath is in front as it was
		if (saver.on) { closeSaver(p.home ? 'home' : 'relaunch'); return; }
		if (p.home && !closing) {
			// the remote's Home while the bar is up: close it, as Back does; not right after it came up (a double press, or a key bounce)
			if (Date.now() - openedAt < HOME_DEBOUNCE_MS) { log('home: ignored (' + (Date.now() - openedAt) + ' ms after opening)'); return; }
			close('home');
			return;
		}
		open(false);
	}, true);
	var started = relaunchParams(null);
	if (wantsSaver(started)) { saverLumen(started); openSaver(); } else open(true);
})();
