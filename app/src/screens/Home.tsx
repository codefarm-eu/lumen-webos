import {t as tr} from '../lib/i18n';
import type {Weather} from '../lib/weather';
import {VideoCaption} from '../components/VideoCaption';
import {LowerVeil} from '../components/LowerVeil';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {Clock} from '../components/Clock';
import {Glyph} from '../components/Glyph';
import {growFrom, DOUBLE_DOWN_MS} from '../components/ControlCenter';
import {Row} from '../components/Row';
import {Tile, type TileModel} from '../components/Tile';
import {useKeys, clamp, type NavKey} from '../hooks/useKeys';
import {useOkPress} from '../hooks/useOkPress';
import {okClickGuard} from '../lib/okClick';
import {Status} from '../components/Status';
import {BUILTIN} from '../config/builtinApps';
import {bootMark} from '../lib/log';

export interface HomeRow {
	id: string;
	label: string;
	items: TileModel[];
	emptyText?: string;
	compact?: boolean;
	/** show the row's name above it (the Recent row); the app rows have none, as on tvOS */
	titled?: boolean;
	/** extra class on the row (row--live) */
	className?: string;
	/** how much higher the row must sit when focused, to leave room under it (the Live TV row's now/next block) */
	below?: number;
	/** see Row's slot */
	slot?: number;
}

interface Props {
	rows: HomeRow[];
	/** the top bar: the Inputs button, then the time pill that opens the menu */
	topItems: TileModel[];
	/** what the time pill's menu lists (LG Home, Settings, Start Screensaver) */
	menuItems: TileModel[];
	/** what the Inputs panel lists */
	inputs: TileModel[];
	active: boolean;
	onActivate: (rowId: string, item: TileModel) => void;
	/** show AM/PM beside the time (12-hour clocks) */
	showPeriod?: boolean;
	/** hold OK on an app: move it one place along its row, or take it off the home screen */
	onEdit?: (action: 'move' | 'remove' | 'folder-add' | 'folder-out', rowId: string, key: string, arg?: number | string) => void;
	/** the apps inside each folder, by folder name */
	folders?: Record<string, TileModel[]>;
	/** shown beside the date under the clock, top left */
	weather?: Weather | null;
	/** off | down | idle | both: when the dock slides away */
	dockHide?: string;
	/** darken the wallpaper while the dock is hidden */
	dockDim?: boolean;
	/** put the focus on this row (a launch with {"view":"recent"}); a new seq asks again */
	focusRow?: {id: string; seq: number};
	/** tile size on the rows (Settings > Apps in the glass bar: 7 apps need smaller tiles); the first row is `perRow` tiles wide */
	tiles?: {size: number; height: number; gap: number};
	perRow?: number;
}


/** the rows whose apps can be moved or removed: the glass bar and the grid rows ('dock', 'dock:1'...) */
const editable = (rowId: string) => rowId === 'apps' || rowId.indexOf('dock') === 0;
/** where the glass bar's row goes when the remote is down in the grid: near the top of the screen, as on tvOS (its tiles sit 40px lower) */
const GRID_TOP = 76;
/** the lowest a focused grid row may sit before the grid scrolls on (its tiles 40px lower) */
const GRID_BOTTOM = 780;   // 40px less than it looks: the grid rows sit 40px lower while the remote is in them (global.css)
const FOLDER_PRESETS = ['Games', 'Tools', 'Media'];
const CTX_ITEMS = ['Move', 'Remove from Home'].concat(FOLDER_PRESETS.map((f) => 'Add to ' + f));
const CTX_FOLDER_ITEMS = ['Take out of Folder'];
const FOLDER_PREFIX = 'folder:';

/** Where the remote's focus is: a row of apps, the top bar, or one of the two open panels. */
type Zone = 'rows' | 'top' | 'panel' | 'menu' | 'ctx' | 'folder';

interface Nav {
	/** false = resting: nothing is focused until the remote (or the pointer) is used */
	engaged: boolean;
	zone: Zone;
	rowIndex: number;
	columns: Record<string, number>;
	topIndex: number;
	panelIndex: number;
	menuIndex: number;
	ctxIndex: number;
	/** the key of the app being moved with the arrows, or null */
	moving: string | null;
	/** the OK that brought the focus up must not also open the app on release */
	swallowOk: boolean;
	/** a press-and-hold with the pointer just opened the menu: ignore the click that follows */
	suppressClick: boolean;
	/** the open folder (its name) and the focused app in it */
	folder: string;
	folderIndex: number;
	/** where the hold-OK menu was opened from, and where it returns to */
	ctxFrom: 'rows' | 'folder';
	/** who moved the focus last: leaving the dock with the pointer rests the icons, with the keys the focus stays */
	mode: 'key' | 'pointer';
	/** the dock is slid away; any key brings it back */
	dockHidden: boolean;
	/** where the Inputs panel was opened from (the top bar button or the Inputs tile), and where Back returns to */
	panelFrom: 'top' | 'rows';
}

const PANEL_COLUMNS = 3;
const INPUTS_KEY = 'inputs';
const MENU_KEY = 'menu';

/** The home screen, navigated like tvOS:
 *  - Left/Right move along a row; Up/Down move between rows (same column, as far as that row reaches).
 *  - Up from the first row reaches the top bar (Inputs button, time pill); Down goes back to the same app.
 *  - OK on Inputs opens the inputs panel, OK on the time pill opens the menu; Back closes either.
 *  - The second row stays hidden until the remote goes down to it. */
export function Home ({rows, topItems, menuItems, inputs, active, onActivate, showPeriod, onEdit, folders, weather, dockHide, dockDim, focusRow, tiles, perRow = 6}: Props) {
	const nav = useRef<Nav>({engaged: false, zone: 'rows', rowIndex: 0, columns: {}, topIndex: 0, panelIndex: 0, menuIndex: 0, ctxIndex: 0, moving: null, swallowOk: false, suppressClick: false, folder: '', folderIndex: 0, ctxFrom: 'rows', mode: 'key', dockHidden: false, panelFrom: 'top'});
	// when Down was last pressed at the last input, with nowhere lower to go
	const bottomDown = useRef(0);
	const latest = useRef({rows, topItems, menuItems, inputs, onActivate, onEdit, folders, dockHide});
	latest.current = {rows, topItems, menuItems, inputs, onActivate, onEdit, folders, dockHide};
	const [late, setLate] = useState(false);   // the rows below the first are drawn a moment after launch
	useEffect(() => { if (late) bootMark('grid'); }, [late]);
	useEffect(() => { const id = window.setTimeout(() => { bootMark('grid-start'); setLate(true); }, 3500); return () => window.clearTimeout(id); }, []);
	const [, redraw] = useState(0);
	const render = () => redraw((n) => n + 1);

	// a launch asked for a row: focus it as soon as it exists (the Recent row only appears once the app list has loaded)
	const wanted = useRef<{id: string; until: number} | null>(null);
	const focusWanted = (): boolean => {
		const w = wanted.current;
		if (!w || Date.now() > w.until) { wanted.current = null; return false; }
		const r = latest.current.rows.findIndex((row) => row.id === w.id);
		if (r < 0) return false;
		const n = nav.current;
		n.engaged = true; n.mode = 'key'; n.zone = 'rows'; n.rowIndex = r; n.columns[w.id] = 0; n.dockHidden = false;
		setLate(true);
		render();
		return true;
	};
	useEffect(() => {
		if (!focusRow) return;
		wanted.current = {id: focusRow.id, until: Date.now() + 8000};
		focusWanted();
	}, [focusRow && focusRow.seq]);
	useEffect(() => { if (wanted.current) focusWanted(); }, [rows]);

	// coming back to the launcher from another app: rest again, unless the launch asked for a row
	useEffect(() => {
		const rest = () => {
			if (document.hidden) return;
			if (focusWanted()) return;
			const n = nav.current;
			n.engaged = false; n.zone = 'rows'; n.rowIndex = 0; n.dockHidden = false;
			render();
		};
		document.addEventListener('visibilitychange', rest);
		return () => document.removeEventListener('visibilitychange', rest);
	}, []);

	// the idle timer follows the option; moving the pointer brings a hidden dock back
	useEffect(() => {
		const m = nav.current;
		if (dockHide === 'off' || dockHide === 'idle' || !dockHide) { if (dockHide !== 'idle' && m.dockHidden) { m.dockHidden = false; render(); } }
		armIdle();
		const show = () => { const k = nav.current; if (k.dockHidden) { k.dockHidden = false; armIdle(); render(); } };
		window.addEventListener('mousemove', show);
		return () => { window.removeEventListener('mousemove', show); window.clearTimeout(idleTimer.current); };
	}, [dockHide]);

	// while an app is being moved, keep the focus on it as it changes places (it may cross from one row to the next)
	useEffect(() => {
		const n = nav.current;
		if (!n.moving) return;
		for (let r = 0; r < rows.length; r++) {
			const c = rows[r].items.findIndex((t) => t.key === n.moving);
			if (c >= 0) { n.rowIndex = r; n.columns[rows[r].id] = c; render(); return; }
		}
	}, [rows]);

	// a folder that has become empty closes
	useEffect(() => {
		const n = nav.current;
		if (n.zone === 'folder' && !((folders || {})[n.folder] || []).length) { n.zone = 'rows'; render(); }
	}, [folders]);

	const columnOf = (row: HomeRow) => clamp(nav.current.columns[row.id] || 0, 0, Math.max(0, row.items.length - 1));

	const activateTop = (i: number) => {
		const n = nav.current;
		const item = latest.current.topItems[i];
		if (!item) return;
		if (item.key === INPUTS_KEY) { n.panelIndex = 0; n.panelFrom = 'top'; n.zone = 'panel'; render(); }
		else if (item.key === MENU_KEY) { n.menuIndex = 0; n.zone = 'menu'; render(); }
		else latest.current.onActivate('top', item);
	};
	const activatePanel = (i: number) => {
		const item = latest.current.inputs[i];
		if (!item) return;
		nav.current.zone = nav.current.panelFrom;
		render();
		latest.current.onActivate('inputs', item);
	};
	const activateMenu = (i: number) => {
		const item = latest.current.menuItems[i];
		if (!item) return;
		nav.current.zone = 'top';
		render();
		latest.current.onActivate('menu', item);
	};
	const activateCtx = (i: number) => {
		const n = nav.current;
		setLate(true);
		const {rows: allRows, folders: fl, onEdit: edit} = latest.current;
		if (n.ctxFrom === 'folder') {
			const inside = ((fl || {})[n.folder] || [])[n.folderIndex];
			n.zone = 'folder';
			if (inside && edit) edit('folder-out', n.folder, inside.key);
			render();
			return;
		}
		const row = allRows[clamp(n.rowIndex, 0, allRows.length - 1)];
		const item = row && row.items[columnOf(row)];
		n.zone = 'rows';
		if (!item) { render(); return; }
		if (i === 0) n.moving = item.key;
		else if (i === 1 && edit) { edit('remove', row.id, item.key); n.columns[row.id] = clamp(columnOf(row), 0, Math.max(0, row.items.length - 2)); }
		else if (edit) edit('folder-add', row.id, item.key, FOLDER_PRESETS[i - 2]);
		render();
	};

	/** OK on a tile in a row: a folder opens, anything else is handed to the app */
	const activateRowItem = (rowId: string, item: TileModel) => {
		const n = nav.current;
		if (item.key.indexOf(FOLDER_PREFIX) === 0) { n.folder = item.key.slice(FOLDER_PREFIX.length); n.folderIndex = 0; n.zone = 'folder'; render(); return; }
		if (item.key === BUILTIN.inputs) { n.panelIndex = 0; n.panelFrom = 'rows'; n.zone = 'panel'; render(); return; }
		latest.current.onActivate(rowId, item);
	};

	const okGuard = useRef(okClickGuard());
	/** a short OK press: open / activate whatever is focused */
	const press = () => {
		const n = nav.current;
		if (n.swallowOk) { n.swallowOk = false; return; }
		if (!n.engaged) return;
		if (!okGuard.current.key()) return;   // the pointer's click already acted for this OK
		const {rows: allRows, topItems: tops, onActivate: act} = latest.current;
		if (n.zone === 'panel') activatePanel(n.panelIndex);
		else if (n.zone === 'menu') activateMenu(n.menuIndex);
		else if (n.zone === 'ctx') activateCtx(n.ctxIndex);
		else if (n.zone === 'folder') {
			const inside = ((latest.current.folders || {})[n.folder] || [])[n.folderIndex];
			if (inside) { n.zone = 'rows'; render(); act('folder', inside); }
		}
		else if (n.zone === 'top') { if (tops[n.topIndex]) activateTop(n.topIndex); }
		else if (n.moving) { n.moving = null; render(); }
		else {
			const row = allRows[clamp(n.rowIndex, 0, allRows.length - 1)];
			const item = row && row.items[columnOf(row)];
			if (item) activateRowItem(row.id, item);
		}
	};

	/** holding OK on an app opens its menu */
	const longPress = () => {
		const n = nav.current;
		if (n.engaged && n.zone === 'folder') { n.ctxFrom = 'folder'; n.ctxIndex = 0; n.zone = 'ctx'; render(); return; }
		if (!n.engaged || n.zone !== 'rows' || n.moving) return;
		const {rows: allRows} = latest.current;
		const row = allRows[clamp(n.rowIndex, 0, allRows.length - 1)];
		const held = row && row.items[columnOf(row)];
		if (!row || !editable(row.id) || !held || held.key.indexOf(FOLDER_PREFIX) === 0) return;
		n.ctxFrom = 'rows'; n.ctxIndex = 0; n.zone = 'ctx'; render();
	};
	useOkPress({onPress: press, onLongPress: longPress}, active);
	// a click that comes right after an OK key-up that acted is the same press: stop it before it reaches the tile (capture, on window)
	useEffect(() => {
		if (!active) return;
		const onClick = (e: MouseEvent) => { if (!okGuard.current.click()) { e.stopPropagation(); e.preventDefault(); } };
		window.addEventListener('click', onClick, true);
		return () => window.removeEventListener('click', onClick, true);
	}, [active]);

	const holdTimer = useRef(0);
	const holdStart = () => {
		window.clearTimeout(holdTimer.current);
		holdTimer.current = window.setTimeout(() => { const n = nav.current; n.suppressClick = true; longPress(); }, 600);
	};
	const holdCancel = () => window.clearTimeout(holdTimer.current);

	const pointerLeft = () => {
		holdCancel();
		const n = nav.current;
		if (n.mode === 'pointer' && n.zone !== 'panel' && n.zone !== 'menu') { n.engaged = false; render(); }
	};

	const idleTimer = useRef(0);
	const armIdle = () => {
		window.clearTimeout(idleTimer.current);
		const mode = latest.current.dockHide;
		if (mode !== 'idle' && mode !== 'both') return;
		idleTimer.current = window.setTimeout(() => {
			const m = nav.current;
			if (m.zone === 'rows' && !m.moving && !document.hidden) { m.dockHidden = true; render(); }
		}, 30000);
	};

	const handleKey = useCallback((key: NavKey): boolean => {
		const n = nav.current;
		setLate(true);
		const {rows: allRows, topItems: tops, menuItems: menu, inputs: ins, onEdit: edit, folders: fl} = latest.current;
		n.mode = 'key';
		const hideMode = latest.current.dockHide;
		if (n.dockHidden) { n.dockHidden = false; armIdle(); render(); return true; }   // the key that brings the dock back does nothing else
		armIdle();
		if (!n.engaged) { n.engaged = true; if (key === 'enter') n.swallowOk = true; render(); return true; }   // the first press only brings the focus up
		if (key === 'enter') return true;   // handled by useOkPress (press vs hold)

		if (n.zone === 'panel') {
			const last = ins.length - 1;
			switch (key) {
				case 'up': if (n.panelIndex === 0) n.zone = n.panelFrom; else n.panelIndex--; break;   // Up past the first input closes the list
				case 'down':
					if (n.panelIndex < last) { n.panelIndex++; bottomDown.current = 0; }
					// a second Down at the last input soon after the first closes the list and goes to the glass bar, as in Control Center
					else if (Date.now() - bottomDown.current < DOUBLE_DOWN_MS) { n.zone = 'rows'; n.rowIndex = 0; bottomDown.current = 0; }
					else bottomDown.current = Date.now();
					break;
				case 'back': n.zone = n.panelFrom; break;
			}
			render();
			return true;
		}
		if (n.zone === 'menu') {
			switch (key) {
				case 'up': n.menuIndex = clamp(n.menuIndex - 1, 0, menu.length - 1); break;
				case 'down': n.menuIndex = clamp(n.menuIndex + 1, 0, menu.length - 1); break;
				case 'back': n.zone = 'top'; break;
			}
			render();
			return true;
		}
		if (n.zone === 'folder') {
			const last = ((fl || {})[n.folder] || []).length - 1;
			switch (key) {
				case 'left': n.folderIndex = clamp(n.folderIndex - 1, 0, last); break;
				case 'right': n.folderIndex = clamp(n.folderIndex + 1, 0, last); break;
				case 'up': if (n.folderIndex - PANEL_COLUMNS >= 0) n.folderIndex -= PANEL_COLUMNS; break;
				case 'down': if (n.folderIndex + PANEL_COLUMNS <= last) n.folderIndex += PANEL_COLUMNS; break;
				case 'back': n.zone = 'rows'; break;
			}
			render();
			return true;
		}
		if (n.zone === 'ctx') {
			const count = (n.ctxFrom === 'folder' ? CTX_FOLDER_ITEMS : CTX_ITEMS).length;
			switch (key) {
				case 'up': n.ctxIndex = clamp(n.ctxIndex - 1, 0, count - 1); break;
				case 'down': n.ctxIndex = clamp(n.ctxIndex + 1, 0, count - 1); break;
				case 'back': n.zone = n.ctxFrom; break;
			}
			render();
			return true;
		}
		if (n.zone === 'top') {
			switch (key) {
				case 'left': n.topIndex = clamp(n.topIndex - 1, 0, tops.length - 1); break;
				case 'right': n.topIndex = clamp(n.topIndex + 1, 0, tops.length - 1); break;
				case 'down': case 'back': n.zone = 'rows'; break;
			}
			render();
			return true;
		}

		const rowIndex = clamp(n.rowIndex, 0, allRows.length - 1);
		const row = allRows[rowIndex];
		if (!row) return false;
		// like tvOS, moving to another row keeps the same column (as far as that row reaches)
		const moveRow = (next: number) => {
			const target = allRows[next];
			if (!target) return;
			n.columns[target.id] = clamp(columnOf(row), 0, target.items.length - 1);
			n.rowIndex = next;
		};
		if (n.moving) {
			if (key === 'left' || key === 'right') { if (edit) edit('move', row.id, n.moving, key === 'left' ? -1 : 1); return true; }
			if (key === 'back') n.moving = null;
			render();
			return true;
		}
		switch (key) {
			case 'up': if (rowIndex === 0) n.zone = 'top'; else moveRow(rowIndex - 1); break;
			case 'down':
				if (rowIndex >= allRows.length - 1 && (hideMode === 'down' || hideMode === 'both')) n.dockHidden = true;
				else moveRow(Math.min(allRows.length - 1, rowIndex + 1));
				break;
			case 'left': n.columns[row.id] = clamp(columnOf(row) - 1, 0, row.items.length - 1); break;
			case 'right': n.columns[row.id] = clamp(columnOf(row) + 1, 0, row.items.length - 1); break;
			// Back in the grid closes it, back to the glass bar's app it left from; on the bar it does nothing
			case 'back': if (rowIndex === 0) return true; n.rowIndex = 0; break;
		}
		render();
		return true;
	}, []);

	useKeys(handleKey, active);

	const n = nav.current;
	const rowIndex = clamp(n.rowIndex, 0, Math.max(0, rows.length - 1));
	const lower = n.zone === 'rows' && rowIndex >= 1;
	// the glass stays a plain tint until the rows have slid back (see .screen--plainglass in global.css); Live blur has no picture to swap, so it skips the class and its full restyle
	const [settling, setSettling] = useState(false);
	const wasLower = useRef(false);
	useEffect(() => {
		const leaving = wasLower.current && !lower;
		wasLower.current = lower;
		if (!leaving) return;
		setSettling(true);
		const t = setTimeout(() => setSettling(false), 300);
		return () => clearTimeout(t);
	}, [lower]);
	// going down into the grid slides everything up until the glass bar is near the top of the screen with the grid under it, as on tvOS;
	// a focused row lower than GRID_BOTTOM scrolls the grid on
	const rowsRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const el = rowsRef.current;
		if (!el) return;
		const kids = el.children as HTMLCollectionOf<HTMLElement>;
		const tilesTop = (row: HTMLElement) => el.offsetTop + row.offsetTop + ((row.querySelector('.row__viewport') as HTMLElement | null)?.offsetTop || 0);
		let shift = 0;
		if (lower && kids[0] && kids[rowIndex]) {
			shift = tilesTop(kids[0]) - GRID_TOP;
			shift = Math.max(shift, tilesTop(kids[rowIndex]) - GRID_BOTTOM + (rows[rowIndex].below || 0));
		}
		el.style.setProperty('--lower-shift', shift + 'px');
	});
	const overlay = n.zone === 'panel' || n.zone === 'menu' || n.zone === 'ctx' || n.zone === 'folder';
	const topPointer = (i: number) => () => { if (!overlay) { n.mode = 'pointer'; n.engaged = true; n.zone = 'top'; n.topIndex = i; render(); } };
	const focusedTop = (i: number) => n.engaged && n.zone === 'top' && i === n.topIndex;
	return (
		<div class={`screen${active ? '' : ' screen--inactive'}${lower ? ' screen--lower' : ''}${(lower || settling) && !document.documentElement.classList.contains('liveblur') ? ' screen--plainglass' : ''}${n.moving ? ' screen--moving' : ''}${n.dockHidden ? ' screen--dockhidden' : ''}${dockDim ? ' screen--dockdim' : ''}`}>
			<div class="dockdim" />
			<LowerVeil />
			<Status weather={weather} showPeriod={showPeriod} />
			<VideoCaption />
			<div class="dockhint" onClick={() => { n.dockHidden = false; render(); }}><svg viewBox="0 0 48 28" aria-hidden="true"><path d="M6 22 24 6l18 16" /></svg></div>
			<div class="topbar">
				{topItems.map((item, i) => item.key === MENU_KEY ? (
					<div
						key={item.key}
						class={`topcap${focusedTop(i) ? ' topcap--focused' : ''}${n.zone === 'menu' ? ' topcap--open' : ''}`}
						onMouseLeave={pointerLeft}
						onMouseEnter={topPointer(i)}
						onClick={() => { n.topIndex = i; activateTop(i); }}
					>
						<Clock showPeriod={showPeriod} />
						<span class="pill__label">{tr(item.label)}</span>
					</div>
				) : (
					<div
						key={item.key}
						data-top={item.key}
						class={`pill${focusedTop(i) ? ' pill--focused' : ''}${n.zone === 'panel' && item.key === INPUTS_KEY ? ' pill--open' : ''}`}
						onMouseLeave={pointerLeft}
						onMouseEnter={topPointer(i)}
						onClick={() => { n.topIndex = i; activateTop(i); }}
					>
						{item.glyph && <Glyph name={item.glyph} />}
						<span class="pill__label">{tr(item.label)}</span>
					</div>
				))}
			</div>
			<div ref={rowsRef} class={`rows${lower ? ' rows--lower' : ''}${n.dockHidden ? ' rows--hidden' : ''}`} style={tiles ? `--layout-tile-size:${tiles.size}px;--layout-tile-height:${tiles.height}px;--layout-tile-gap:${tiles.gap}px;--first-w:${perRow * (tiles.size + tiles.gap) - tiles.gap}px` : undefined} onMouseDown={() => { n.mode = 'pointer'; holdStart(); }} onMouseUp={holdCancel}>
				{rows.map((row, i) => (
					<Row
						key={row.id}
						label={tr(row.label)}
						titled={row.titled}
						className={row.className}
						slot={row.slot}
						tileSize={tiles && tiles.size}
						tileGap={tiles && tiles.gap}
						items={i > 1 && !late ? [] : row.items}
						emptyText={row.emptyText && tr(row.emptyText)}
						focused={n.engaged && n.zone === 'rows' && i === rowIndex}
						rest={!n.engaged}
						onLeave={pointerLeft}
						selected={columnOf(row)}
						onSelect={(col) => { if (overlay) return; n.mode = 'pointer'; n.engaged = true; n.zone = 'rows'; n.rowIndex = i; n.columns[row.id] = col; render(); }}
						onActivate={(col) => { holdCancel(); if (n.suppressClick) { n.suppressClick = false; return; } activateRowItem(row.id, row.items[col]); }}
					/>
				))}
			</div>
			{n.zone === 'panel' && (
				<>
					<div class="panel-backdrop panel-backdrop--clear" onClick={() => { n.zone = n.panelFrom; render(); }} />
					<div class="panel panel--cc panel--inputs" ref={(el) => { if (el && !el.dataset.grown) { el.dataset.grown = '1'; growFrom(el, INPUTS_KEY); } }}>
						{inputs.map((item, i) => (
							<div
								key={item.key}
								class={`cc__mod cc__tile cc__opt${i === n.panelIndex ? ' cc__mod--focused' : ''}`}
								onMouseEnter={() => { n.panelIndex = i; render(); }}
								onClick={() => activatePanel(i)}
							>
								<div class="cc__icon">
									{item.glyphImageUrl ? <img class="cc__inputicon" src={item.glyphImageUrl} alt="" decoding="async" /> : item.glyph ? <Glyph name={item.glyph} /> : null}
								</div>
								<div class="cc__text"><div class="cc__name">{tr(item.label)}</div></div>
							</div>
						))}
						{inputs.length === 0 && <div class="cc__caption">No inputs selected: add some in Settings &gt; Sources</div>}
					</div>
				</>
			)}
			{n.moving && <div class="movehint">{tr('Move with the arrows · OK to drop')}</div>}
			{n.zone === 'folder' && (
				<>
					<div class="panel-backdrop" onClick={() => { n.zone = 'rows'; render(); }} />
					<div class="panel panel--folder">
						<div class="panel__title">{n.folder}</div>
						<div class="panel__grid" onMouseDown={holdStart} onMouseUp={holdCancel} onMouseLeave={holdCancel}>
							{((folders || {})[n.folder] || []).map((item, i) => (
								<Tile
									key={item.key}
									model={item}
									focused={i === n.folderIndex}
									onHover={() => { n.folderIndex = i; render(); }}
									onActivate={() => { holdCancel(); if (n.suppressClick) { n.suppressClick = false; return; } n.zone = 'rows'; render(); latest.current.onActivate('folder', item); }}
								/>
							))}
						</div>
					</div>
				</>
			)}
			{n.zone === 'ctx' && (
				<>
					<div class="panel-backdrop" onClick={() => { n.zone = n.ctxFrom; render(); }} />
					<div class="panel panel--menu panel--ctx">
						{(n.ctxFrom === 'folder' ? CTX_FOLDER_ITEMS : CTX_ITEMS).map((label, i) => (
							<div
								key={label}
								class={`menu__row${i === n.ctxIndex ? ' menu__row--focused' : ''}`}
								onMouseEnter={() => { n.ctxIndex = i; render(); }}
								onClick={() => activateCtx(i)}
							>
								<span>{tr(label)}</span>
							</div>
						))}
					</div>
				</>
			)}
			{n.zone === 'menu' && (
				<>
					<div class="panel-backdrop" onClick={() => { n.zone = 'top'; render(); }} />
					<div class="panel panel--menu">
						{menuItems.map((item, i) => (
							<div
								key={item.key}
								class={`menu__row${i === n.menuIndex ? ' menu__row--focused' : ''}`}
								onMouseEnter={() => { n.menuIndex = i; render(); }}
								onClick={() => activateMenu(i)}
							>
								{item.glyph && <Glyph name={item.glyph} />}
								<span>{tr(item.label)}</span>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
}
