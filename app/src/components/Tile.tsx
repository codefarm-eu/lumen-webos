import {useState} from 'preact/hooks';
import {CheckMark, Glyph, type GlyphName} from './Glyph';
import {ChannelTile, type LiveTile} from './ChannelTile';

/** Everything a tile needs to draw itself; rows and grids build these from app/input data. */
export interface TileModel {
	key: string;
	label: string;
	/** full-bleed artwork (app icons) */
	imageUrl?: string;
	/** LG's grey line-art input icons, drawn smaller and lightened */
	glyphImageUrl?: string;
	/** built-in vector icon */
	glyph?: GlyphName;
	/** monogram background when there is no artwork */
	color?: string;
	/** imageUrl is a small square icon: drawn sharp and centred on the colour instead of stretched over the tile */
	plain?: boolean;
	/** a folder: the icons of the apps inside (up to 4 are drawn as a small collage) */
	children?: (string | undefined)[];
	/** a name drawn as the tile's picture (a channel without a logo) */
	wordmark?: string;
	/** a channel on the Live TV row: drawn by ChannelTile */
	live?: LiveTile;
	/** the app is open in the background, so it comes back where it was: a dot above the tile */
	running?: boolean;
}

interface Props {
	model: TileModel;
	focused: boolean;
	/** picked up in re-order mode */
	lifted?: boolean;
	/** shown with a tick badge (settings picker) */
	checked?: boolean;
	/** greyed out (settings picker: not on the home screen) */
	dimmed?: boolean;
	onHover?: () => void;
	onActivate?: () => void;
}

export function Tile ({model, focused, lifted, checked, dimmed, onHover, onActivate}: Props) {
	// an icon that fails to load (a TV file the app may not read, a broken cache entry) gives way to the letter tile
	const [broken, setBroken] = useState('');
	const classes = ['tile', focused && 'tile--focused', lifted && 'tile--lifted', dimmed && 'tile--dimmed'].filter(Boolean).join(' ');
	if (model.live) return <ChannelTile live={model.live} classes={classes} onHover={onHover} onActivate={onActivate} />;
	// pointer: the focused tile tilts a little towards the cursor, like the Apple TV parallax (transform only, set straight on the element)
	const tilt = (e: MouseEvent) => {
		const el = e.currentTarget as HTMLElement;
		const box = el.querySelector('.tile__box') as HTMLElement | null;
		if (!box) return;
		const r = el.getBoundingClientRect();
		box.style.setProperty('--rx', (-((e.clientY - r.top) / r.height - 0.5) * 10).toFixed(1) + 'deg');
		box.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * 12).toFixed(1) + 'deg');
	};
	const untilt = (e: MouseEvent) => {
		const box = (e.currentTarget as HTMLElement).querySelector('.tile__box') as HTMLElement | null;
		if (box) { box.style.removeProperty('--rx'); box.style.removeProperty('--ry'); }
	};
	const image = model.imageUrl && model.imageUrl !== broken ? model.imageUrl : undefined;
	return (
		<div class={classes} onMouseEnter={onHover} onClick={onActivate} onMouseMove={focused ? tilt : undefined} onMouseLeave={untilt}>
			<div class={model.running ? 'tile__dot tile__dot--on' : 'tile__dot'} />
			<div class="tile__box" style={model.color && (!image || model.plain) ? {background: model.color} : undefined}>
				{model.children
					? <div class="tile__folder">{model.children.slice(0, 4).map((u, i) => <div key={i} class="tile__mini" style={u ? {backgroundImage: `url("${u}")`} : undefined} />)}</div>
					: image
					? <img class={model.plain ? 'tile__image tile__image--icon' : 'tile__image'} src={image} alt="" decoding="async" onError={() => setBroken(image)} />
					: model.glyphImageUrl
						? <img class="tile__image tile__image--glyph" src={model.glyphImageUrl} alt="" decoding="async" />
						: model.wordmark
							? <div class="chan__name">{model.wordmark}</div>
						: model.glyph
							? <Glyph name={model.glyph} />
							: <div class="tile__monogram">{model.label.charAt(0).toUpperCase()}</div>}
				{checked && <div class="tile__badge"><CheckMark /></div>}
			</div>
			<div class="tile__label">{model.label}</div>
		</div>
	);
}
