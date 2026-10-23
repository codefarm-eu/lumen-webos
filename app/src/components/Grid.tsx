import {useLayoutEffect, useRef, useState} from 'preact/hooks';
import {LAYOUT} from '../theme/tokens';
import {clamp} from '../hooks/useKeys';
import {Tile, type TileModel} from './Tile';

interface Props {
	items: TileModel[];
	/** select: tick badges on chosen items, others dimmed. reorder: plain tiles. */
	mode: 'select' | 'reorder';
	checkedKeys: string[];
	/** index of the tile picked up in re-order mode, or -1 */
	liftedIndex: number;
	focused: boolean;
	selected: number;
	onSelect: (index: number) => void;
	onActivate: (index: number) => void;
}

// Starting guesses only. After each render the grid measures its row step and tile height, because the label's real height
// depends on the font (68 px with Geist Static on Chromium 53, not the 60 these constants used to assume, which cut off the third row).
const VIEWPORT_HEIGHT = 720;          // the content height of .grid__viewport in global.css (its height less its padding)
const LABEL_HEIGHT = 68;              // two-line tile label + its top margin (see .tile__label)
const GRID_ROW_GAP = 40;              // matches .grid__track grid-row-gap (and the flex fallback's bottom margin)
const ROW_STEP = LAYOUT.tileHeight + LABEL_HEIGHT + GRID_ROW_GAP;
/** .grid__viewport's padding: room for the focused tile's zoom and the mask's fade; the next row starts below the bottom one */
const PAD_TOP = 40;
const PAD_BOTTOM = 36;
/** a long list (Settings > Channels, about 188) draws only the rows near the focused one; the rest keep their place as empty tiles */
const LONG_LIST = 60;
const ROWS_DRAWN = 4;

/** Full grid of tiles; scrolls vertically to keep the focused row in view. */
export function Grid ({items, mode, checkedKeys, liftedIndex, focused, selected, onSelect, onActivate}: Props) {
	const viewport = useRef<HTMLDivElement>(null);
	const track = useRef<HTMLDivElement>(null);
	const [geo, setGeo] = useState<{step: number; tile: number; cols: number}>({step: ROW_STEP, tile: ROW_STEP - GRID_ROW_GAP, cols: LAYOUT.gridColumns});
	useLayoutEffect(() => {
		const tr = track.current;
		if (!tr) return;
		const tiles = tr.children as HTMLCollectionOf<HTMLElement>;
		if (!tiles.length) return;
		// columns as laid out (the track wraps to the width it has), the step between rows, and a tile's height with its label
		let cols = 1;
		while (cols < tiles.length && tiles[cols].offsetTop === tiles[0].offsetTop) cols++;
		const step = tiles.length > cols ? tiles[cols].offsetTop - tiles[0].offsetTop : geo.step;
		const tile = tiles[0].offsetHeight;
		if (tile > 0 && (step !== geo.step || tile !== geo.tile || cols !== geo.cols)) setGeo({step, tile, cols});
	});

	const cols = geo.cols;
	const rows = Math.ceil(items.length / cols);
	const rowIndex = Math.floor(selected / cols);
	// whole rows only: the window is as tall as the rows that fit in VIEWPORT_HEIGHT, so no row is ever drawn cut off at the bottom
	const fit = Math.max(1, Math.min(rows, Math.floor((VIEWPORT_HEIGHT + geo.step - geo.tile) / geo.step)));
	// the first row in the window moves only when the focus would leave it (like tvOS), never past the last row
	const top = useRef(0);
	if (rowIndex < top.current) top.current = rowIndex;
	else if (rowIndex >= top.current + fit) top.current = rowIndex - fit + 1;
	top.current = clamp(top.current, 0, Math.max(0, rows - fit));
	const offset = top.current * geo.step;
	const height = (fit - 1) * geo.step + geo.tile;

	return (
		<div class="grid__viewport" ref={viewport} style={{height: `${height + PAD_TOP + PAD_BOTTOM}px`}}>
			<div class="grid__track" ref={track} style={{transform: `translateY(${-offset}px)`}}>
				{items.map((item, i) => {
					if (items.length > LONG_LIST && Math.abs(Math.floor(i / cols) - rowIndex) > ROWS_DRAWN) {
						return <div key={item.key} class="tile tile--ghost"><div class="tile__box" /><div class="tile__label" /></div>;
					}
					const checked = mode === 'select' && checkedKeys.indexOf(item.key) !== -1;
					return (
						<Tile
							key={item.key}
							model={item}
							focused={focused && i === selected}
							lifted={i === liftedIndex}
							checked={checked}
							dimmed={mode === 'select' && !checked}
							onHover={() => onSelect(i)}
							onActivate={() => onActivate(i)}
						/>
					);
				})}
			</div>
		</div>
	);
}
