// Settings > Wallpaper > Dim the wallpaper (from upstream e296505): off | night (19:00 to 06:00) | always.
// The wallpaper dims by the html class "night". The screensaver dims only at night: with "always", a darker screensaver all day
// would stack with Settings > Screensaver > Brightness, which already lowers the backlight; it gets its own class, "night-hours".

export type WallpaperDim = 'off' | 'night' | 'always';

/** the saved setting, or the older on/off nightDim (on meant at night) */
export function wallpaperDimFrom (saved: {wallpaperDim?: unknown; nightDim?: unknown}): WallpaperDim {
	if (saved.wallpaperDim === 'night' || saved.wallpaperDim === 'always' || saved.wallpaperDim === 'off') return saved.wallpaperDim;
	return saved.nightDim === true ? 'night' : 'off';
}

export function isNightHour (hour: number): boolean {
	return hour >= 19 || hour < 6;
}

/** which html classes are on at this hour */
export function dimClasses (mode: WallpaperDim, hour: number): {night: boolean; nightHours: boolean} {
	const nightHours = mode !== 'off' && isNightHour(hour);
	return {night: mode === 'always' || nightHours, nightHours};
}
