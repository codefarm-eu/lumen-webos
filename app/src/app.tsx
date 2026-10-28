import {useCallback, useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {Home, type HomeRow} from './screens/Home';
import {Settings, type SettingsTab, type WallpaperTab} from './screens/Settings';
import {Guide} from './screens/Guide';
import type {WallpaperEntry} from './components/WallpaperPicker';
import type {OptionItem} from './components/SettingsList';
import {Toast, type ToastMessage} from './components/Toast';
import type {TileModel} from './components/Tile';
import {BUILTIN, BUILTIN_APPS, withBuiltins} from './config/builtinApps';
import {cachedApps, iconFile, listApps, sameApps, saveAppsCache, seedAppIds, type AppEntry} from './lib/apps';
import {afterFirstFrame, readCache, writeCache} from './lib/boot';
import {listInputs, MOCK_INPUTS, type InputSource} from './lib/inputs';
import {launchApp, launchLgHome} from './lib/launch';
import {isWebOS} from './lib/luna';
import {hidePointerOnForeground} from './lib/pointer';
import {dimClasses, wallpaperDimFrom} from './lib/dim';
import {DEFAULT_CONFIG, IDLE_SECONDS, hasSavedConfig, loadConfig, saveConfig, toggleId, withWallpaper, type UserConfig} from './lib/storage';
import {readBackup, scheduleBackup} from './lib/backup';
import {launchAction, onRelaunch, startParams, type LaunchParams} from './lib/launchParams';
import {appTile, inputTile, pickInOrder} from './lib/tiles';
import {TIMING} from './config/constants';
import {LOCAL_WALLPAPERS, WALLPAPERS, WALLPAPER_CATEGORIES, cloudUrl} from './config/wallpapers';
import {setLiquidDock} from './lib/liquidGlass';
import {LIVE_BLUR, RESIZE_OBSERVER} from './lib/compat';
import {resized, setLiveBlur, setPicks, setWallpaper, shownWallpaper} from './lib/wallpaper';
import {restoreLeftoverBacklight} from './lib/tvcontrols';
import {albums as immichAlbums, cachedServer, IMMICH_SOURCES, loadServer} from './lib/immich';
import {Ambient} from './components/Ambient';
import {idleDelay, leaveAmbientFlow, screensaverSource, videoStandsIn} from './lib/screensaver';
import {getCurrentClip, setVideoChoice, setVideoPaused, setVideoWallpaper, VIDEO_PLACES} from './lib/wallpaperVideo';
import {resyncFlags, setAmbientFlag, setAmbientShowing, setVideoFlag, startScreensaver} from './lib/system';
import {setFpsCounter} from './lib/fps';
import {ControlCenter, prefetchControls, type CenterAction} from './components/ControlCenter';
import {CITIES, COUNTRIES} from './config/cities';
import {AUTO_PLACE, POSTCODE_PLACE, findPlace, peekWeather, readWeather, type Weather} from './lib/weather';
import {TextPrompt} from './components/TextPrompt';
import {useLiveTv} from './hooks/useLiveTv';
import {channelColor, nowNextAt, rowChannels, type Channel} from './lib/livetv';
import {openChannel, runningApps, setHomeBar, setHomeTakeover, syncBar, uninstallApp} from './lib/root';

import {bootMark, logError, navMark} from './lib/log';
import {isDark, LANGS, setClockMode, setLang} from './lib/i18n';

/** Lumen's install folder on the TV (the page's own folder) */
const appDir = () => decodeURIComponent(location.pathname).replace(/\/[^/]*$/, '');

type Screen = 'home' | 'settings' | 'ambient' | 'guide';

const ROW = {apps: 'apps', sources: 'sources', misc: 'misc', dock: 'dock', live: 'livetv', channels: 'channels'} as const;
/** the Live TV row: the Guide tile first, then its channels' tiles (channel:<channelId>) */
const LIVE = {prefix: 'channel:', guide: 'livetv:guide'} as const;
/** the width of a channel tile's now/next block (.chan__info in global.css): the row scrolls on so the focused tile always has this to its right */
const LIVE_INFO_W = 660;
/** how much higher the Live TV row sits when focused, so its now/next block fits on screen */
const LIVE_BELOW = 150;
const MISC = {lgHome: 'lg-home', settings: 'settings'} as const;
const OPTION = {liveTv: 'live-tv-row', ambient: 'ambient', ambientOn: 'ambient-on', ambientSeconds: 'ambient-seconds', ambientBrightness: 'ambient-brightness', ambientPrint: 'ambient-print', ambientMove: 'ambient-move', fps: 'fps-counter', restore: 'restore-backup', focus: 'focus-strength', firstRow: 'first-row', videoHours: 'video-hours', dockBlur: 'dock-blur', liquidDock: 'liquid-dock', reduceMotion: 'reduce-motion', hideNames: 'hide-names', showRecents: 'show-recents', useHomebrew: 'use-homebrew', videoWallpaper: 'video-wallpaper', videoClip: 'video-clip', dockHide: 'dock-hide', showAmPm: 'show-ampm', showAll: 'show-all-apps', weather: 'show-weather', city: 'weather-city', postcode: 'weather-postcode', homeTakeover: 'home-takeover', homeBar: 'home-bar', country: 'weather-country', idle: 'idle-screensaver', wpAuto: 'wp-auto', immichDays: 'immich-recent-days', wpType: 'wp-type', wpNew: 'wp-new', nightDim: 'night-dim', dockDim: 'dock-dim', darkMode: 'dark-mode', language: 'language', clock: 'clock-format'} as const;
const WP_AUTO_CHOICES = [0, 0.5, 1, 5, 15, 30, 60];   // minutes
/** when the video wallpaper plays (Settings > Wallpaper > Video wallpaper hours): [first hour, hour it stops]; always = no limit */
const VIDEO_HOURS: Record<string, [number, number]> = {day: [7, 19], evening: [17, 23], night: [19, 7]};
function inVideoHours (mode: string, now = new Date()): boolean {
	const span = VIDEO_HOURS[mode];
	if (!span) return true;
	const h = now.getHours();
	return span[0] < span[1] ? h >= span[0] && h < span[1] : h >= span[0] || h < span[1];
}
/** tile sizes for 5, 6 or 7 apps a row: always about 1670px wide, with 40px of glass round them (the bar about 91% of the screen), still 5:3 */
/** the glass bar's focused tile grows this much (theme/global.css, .rows > .row:first-child --motion-focus-scale); Lumen bar gets it too */
const BAR_FOCUS_SCALE: Record<string, number> = {subtle: 1.06, normal: 1.12, strong: 1.16};
const TILES_FOR: Record<number, {size: number; height: number; gap: number}> = {5: {size: 288, height: 173, gap: 58}, 6: {size: 240, height: 144, gap: 46}, 7: {size: 206, height: 124, gap: 38}};
/** the backlight the screensaver lowers the TV to, by Settings > Screensaver > Brightness */
const AMBIENT_BACKLIGHT: Record<string, number> = {dim: 30, low: 10};
const RECENT_MAX = 8;
/** what the last launch showed, drawn at once on a cold start (lib/boot.ts) */
const INPUTS_CACHE_KEY = 'lumen-boot-inputs-v1';

/** The top bar: Control Center, Settings and Inputs. Control Center comes first, so it has the focus the first time Up reaches the top bar. */
const TOP_ITEMS: TileModel[] = [
	{key: 'controls', label: 'Control Center', glyph: 'sliders'},
	{key: MISC.settings, label: 'Settings', glyph: 'gear'},
	{key: 'inputs', label: 'Inputs', glyph: 'inputs'}
];
/** What the time pill's menu lists. */
const MENU_ITEMS: TileModel[] = [
	{key: 'controls', label: 'Quick Controls', glyph: 'sliders'},
	{key: MISC.lgHome, label: 'LG Home', glyph: 'house'},
	{key: MISC.settings, label: 'Settings', glyph: 'gear'},
	{key: 'screensaver', label: 'Start Screensaver', glyph: 'screensaver'}
];


export function App () {
	/** the Postcode or place text field is open over Settings */
	const [prompt, setPrompt] = useState(false);
	// opened by watch.sh for the TV's screensaver: the first frame is the screensaver, so the home screen never shows first
	const [screen, setScreen] = useState<Screen>(() => import.meta.env.DEV && /[?&]settings/.test(location.search) ? 'settings' : startParams().view === 'ambient' && loadConfig().ambientOn ? 'ambient' : 'home');
	// Immich (Settings > Wallpaper > Photos): whether a server is set up on the TV, and its albums; read again each time Settings opens
	const [immich, setImmich] = useState<{ready: boolean; albums: {id: string; title: string}[]}>({ready: !!cachedServer(), albums: []});
	useEffect(() => {
		if (screen !== 'settings') return;
		loadServer().then((srv) => {
			if (!srv) { setImmich({ready: false, albums: []}); return; }
			immichAlbums(srv).then((a) => setImmich({ready: true, albums: a}), () => setImmich({ready: true, albums: []}));
		});
	}, [screen]);
	const [config, setConfig] = useState<UserConfig>(loadConfig);
	// set before anything renders, so every label below reads the chosen language and clock
	setLang(config.language);
	setClockMode(config.clockFormat);
	// a cold start draws what the last launch showed (lib/boot.ts); the TV is asked again once the first frame is up
	const [apps, setApps] = useState<AppEntry[]>(() => cachedApps(config.useHomebrew, config.showAllApps) || []);
	const [inputs, setInputs] = useState<InputSource[]>(() => (isWebOS() && readCache<InputSource[]>(INPUTS_CACHE_KEY)) || []);
	const [toast, setToast] = useState<ToastMessage | null>(null);
	const [controls, setControls] = useState(false);
	const configRef = useRef(config);
	configRef.current = config;
	const toastTimer = useRef(0);
	// a fresh install first looks for the settings backup on the TV (lib/backup.ts); nothing is seeded until that has answered
	const [restoring, setRestoring] = useState(() => !hasSavedConfig());
	const [focusRow, setFocusRow] = useState<{id: string; seq: number} | undefined>(undefined);
	// Settings > Home Screen > Live TV (off by default): off, the hook makes no Luna call and reads no cache (hooks/useLiveTv.ts)
	const live = useLiveTv(config.liveTv, config.liveTv && screen === 'guide', config.liveChannels);

	const showToast = useCallback((text: string, kind: ToastMessage['kind'] = 'info') => {
		window.clearTimeout(toastTimer.current);
		setToast({text, kind});
		toastTimer.current = window.setTimeout(() => setToast(null), TIMING.toastMs);
	}, []);

	// Magic Remote scroll wheel = Up/Down (rows on the home screen, lists and grids elsewhere)
	useEffect(() => {
		let last = 0;
		const onWheel = (e: WheelEvent) => {
			const now = Date.now();
			if (now - last < 220 || Math.abs(e.deltaY) < 4) return;
			last = now;
			const code = e.deltaY > 0 ? 40 : 38;
			window.dispatchEvent(new KeyboardEvent('keydown', {keyCode: code, which: code, bubbles: true}));
		};
		window.addEventListener('wheel', onWheel, {passive: true});
		return () => window.removeEventListener('wheel', onWheel);
	}, []);

	useEffect(() => {
		if (!restoring) return;
		readBackup().then((saved) => {
			if (saved && !hasSavedConfig()) { updateConfig(saved); showToast('Settings restored from the TV'); }
			setRestoring(false);
		});
	}, []);

	// launch parameters: {"view":"recent"} opens on the app grid (it opened the Recent row, which has gone: every app is in the grid)
	useEffect(() => {
		let seq = 0;
		const apply = (p: LaunchParams) => {
			const a = launchAction(p, configRef.current, screenRef.current);
			if (a.focusDock) setFocusRow({id: ROW.dock, seq: ++seq});
			if (a.back !== undefined) ambientBack.current = a.back;
			if (a.screen === 'ambient') ambientOpening.current = null;
			if (a.screen) setScreen(a.screen as Screen);
			if (a.closeControls) setControls(false);
		};
		apply(startParams());
		return onRelaunch(apply);
	}, []);

	// Start in remote (5-way) mode: hide the Magic Remote pointer whenever we come to the
	// front. Shaking the remote still brings it back.
	useEffect(() => hidePointerOnForeground(), []);

	// Load apps at start and whenever the Homebrew option changes; refresh inputs whenever
	// the app comes back to the foreground (labels or connections may have changed).
	// With a list from the last launch on screen, the first read waits for the first frame; a changed option reads at once.
	const appsShown = useRef(apps);
	appsShown.current = apps;
	const firstAppsRead = useRef(true);
	useEffect(() => {
		const useHomebrew = config.useHomebrew;
		const showAll = config.showAllApps;
		const read = () => listApps(useHomebrew, showAll)
			.then(({apps: list, source}) => {
				bootMark('apps');
				if (!sameApps(list, appsShown.current)) setApps(list);
				saveAppsCache(useHomebrew, showAll, list);
				if (useHomebrew && source !== 'homebrew') showToast('Homebrew Channel not available, using the built-in app list', 'error');
			})
			.catch(() => showToast('Could not read the app list', 'error'));
		const wait = firstAppsRead.current && apps.length > 0;
		firstAppsRead.current = false;
		if (!wait) { read(); return undefined; }
		return afterFirstFrame(read);
	}, [config.useHomebrew, config.showAllApps, showToast]);

	useEffect(() => {
		const refresh = () => {
			if (!isWebOS()) { setInputs(MOCK_INPUTS); return; }
			listInputs().then((list) => {
				writeCache(INPUTS_CACHE_KEY, list);
				setInputs((now) => (JSON.stringify(now) === JSON.stringify(list) ? now : list));
			}).catch(() => showToast('Could not read the inputs', 'error'));
		};
		const cancel = isWebOS() ? afterFirstFrame(refresh) : (refresh(), () => undefined);
		const onVisibility = () => { if (!document.hidden) refresh(); };
		document.addEventListener('visibilitychange', onVisibility);
		return () => { cancel(); document.removeEventListener('visibilitychange', onVisibility); };
	}, [showToast]);

	// the apps still open in the background (docs/keep-alive.md), read again 5 s after Lumen comes to the front: the TV may close some just then
	const [running, setRunning] = useState<string[]>([]);
	useEffect(() => {
		if (!isWebOS()) { setRunning(['youtube.leanback.v4', 'com.beb.plxnative']); return undefined; }
		let again = 0;
		const read = () => runningApps().then((ids) => ids.sort()).then((ids) => setRunning((now) => (now.join() === ids.join() ? now : ids))).catch(() => undefined);
		const onVisibility = () => {
			window.clearTimeout(again);
			if (document.hidden) return;
			read();
			again = window.setTimeout(read, 5000);
		};
		const cancel = afterFirstFrame(onVisibility);
		document.addEventListener('visibilitychange', onVisibility);
		return () => { cancel(); window.clearTimeout(again); document.removeEventListener('visibilitychange', onVisibility); };
	}, []);

	useEffect(() => { setPicks(config.wallpaperPicks, config.wpNewOnLaunch); setWallpaper(config.wallpaper); }, [config.wallpaper]);
	useEffect(() => setPicks(config.wallpaperPicks, config.wpNewOnLaunch), [config.wallpaperPicks, config.wpNewOnLaunch]);

	// the weather under the clock at the top left
	const weatherCity = (c: UserConfig) => (c.weatherCity === AUTO_PLACE ? null
		: c.weatherCity === POSTCODE_PLACE ? (c.weatherPlace ? {name: c.weatherPlace.name, lat: c.weatherPlace.lat, lon: c.weatherPlace.lon} : null)
		: CITIES.filter((x) => x.name === c.weatherCity)[0] || null);
	// the last reading is shown at once on a cold start, however old, so the pill does not change size when the new one comes in
	const [weather, setWeather] = useState<Weather | null>(() => (config.showWeather && config.weatherCity && (config.weatherCity === AUTO_PLACE || weatherCity(config)) ? peekWeather(weatherCity(config)) : null));
	useEffect(() => {
		// no place chosen, no weather (and no request to anyone): Auto, which asks ipwho.is, has to be picked on purpose
		if (!config.showWeather || !config.weatherCity) { setWeather(null); return; }
		const city = weatherCity(config);
		if (!city && config.weatherCity !== AUTO_PLACE) { setWeather(null); return; }
		const load = () => readWeather(city).then(setWeather).catch(() => setWeather(null));
		const cancel = afterFirstFrame(load);
		const id = window.setInterval(load, 30 * 60000);
		return () => { cancel(); window.clearInterval(id); };
	}, [config.showWeather, config.weatherCity, config.weatherPlace]);

	// a new wallpaper every N minutes, from the picks or the Immich sources
	useEffect(() => {
		if (!config.wpAutoMinutes || (config.wallpaper !== 'pick' && config.wallpaper.indexOf('immich:') !== 0)) return;
		const id = window.setInterval(() => { if (!document.hidden) setWallpaper(config.wallpaper); }, config.wpAutoMinutes * 60000);
		return () => window.clearInterval(id);
	}, [config.wpAutoMinutes, config.wallpaper]);

	// a backlight left low by a screensaver that never ended goes back up
	useEffect(() => afterFirstFrame(restoreLeftoverBacklight, 3000), []);

	// night: a dimmer wallpaper, always or between 19:00 and 06:00; the screensaver only between those hours (lib/dim.ts)
	useEffect(() => {
		const apply = () => {
			const d = dimClasses(wallpaperDimFrom(config), new Date().getHours());
			document.documentElement.classList.toggle('night', d.night);
			document.documentElement.classList.toggle('night-hours', d.nightHours);
		};
		apply();
		const id = window.setInterval(apply, 60000);
		return () => { window.clearInterval(id); document.documentElement.classList.remove('night'); document.documentElement.classList.remove('night-hours'); };
	}, [config.wallpaperDim]);
	useEffect(() => {
		const apply = () => { const dark = isDark(config.darkMode); document.documentElement.classList.toggle('dark', dark); document.documentElement.classList.toggle('light', !dark); };
		apply();
		const id = window.setInterval(apply, 60000);
		return () => window.clearInterval(id);
	}, [config.darkMode]);
	useEffect(() => { document.documentElement.classList.toggle('reduce-motion', config.reduceMotion); }, [config.reduceMotion]);
	useEffect(() => { document.documentElement.classList.toggle('hide-names', config.hideNames); }, [config.hideNames]);
	useEffect(() => { document.documentElement.classList.toggle('hide-recents', !config.showRecents); }, [config.showRecents]);
	// html.settled: the veil and lower rows are drawn only once a return has caught up, so the return redraws less but Down stays smooth (docs/startup-perf.md)
	useEffect(() => {
		const root = document.documentElement.classList;
		let timer = 0;
		const onVisibility = () => {
			window.clearTimeout(timer);
			if (document.hidden) { root.remove('settled'); return; }
			timer = window.setTimeout(() => { root.add('settled'); prefetchControls(); }, 4000);
		};
		onVisibility();
		document.addEventListener('visibilitychange', onVisibility);
		return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); root.remove('settled'); };
	}, []);
	useEffect(() => setFpsCounter(__LUMEN_DEV__ && config.fpsCounter), [config.fpsCounter]);
	// live blur where the engine has backdrop-filter (index.html sets the class first); without it (webOS 4) the glass is the pre-blurred
	// wallpaper copy, the original lite glass (lib/compat.ts, docs/webos4.md)
	useEffect(() => {
		const root = document.documentElement.classList;
		root.toggle('liveblur', LIVE_BLUR);
		root.toggle('fakeglass', !LIVE_BLUR);
		setLiveBlur(LIVE_BLUR);
	}, []);
	useEffect(() => { document.documentElement.classList.toggle('dockblur', config.dockBlur); }, [config.dockBlur]);
	useEffect(() => setLiquidDock(LIVE_BLUR && RESIZE_OBSERVER && config.liquidDock), [config.liquidDock]);
	useEffect(() => setVideoChoice(config.videoPlaces), [config.videoPlaces]);
	// the video wallpaper plays only within its hours (checked each minute); the still wallpaper shows the rest of the time
	const [videoTime, setVideoTime] = useState(() => inVideoHours(config.videoHours));
	useEffect(() => {
		const check = () => setVideoTime(inVideoHours(config.videoHours));
		check();
		const id = window.setInterval(check, 60000);
		return () => window.clearInterval(id);
	}, [config.videoHours]);
	const videoOn = config.videoWallpaper && videoTime;
	const videoOnRef = useRef(videoOn);
	videoOnRef.current = videoOn;
	// a clip is on screen (lib/wallpaperVideo.ts announces each one, and null once it gives up)
	const [clipPlaying, setClipPlaying] = useState(() => !!getCurrentClip());
	useEffect(() => {
		const update = () => setClipPlaying(!!getCurrentClip());
		window.addEventListener('lumen-clip', update);
		return () => window.removeEventListener('lumen-clip', update);
	}, []);
	const videoActive = videoStandsIn(videoOn, clipPlaying, screen);
	// the wallpaper the screensaver opens on when started from the home screen; none when the TV's screensaver opens it
	const ambientOpening = useRef<ReturnType<typeof shownWallpaper>>(null);
	/** The app the TV's screensaver came up over (watch.sh's launch parameter "back"), or null: the screensaver was Lumen's own, or over Lumen. */
	const ambientBack = useRef<string | null>(null);
	const screenRef = useRef(screen);
	screenRef.current = screen;
	/** Leaving the screensaver: back to the app it came up over when there was one and it is still open (a paused film in Moonfin or
	 *  YouTube comes forward as it was), without Lumen's home flashing first; else Lumen's home screen (lib/screensaver.ts leaveAmbientFlow). */
	const leaveAmbient = () => {
		const back = ambientBack.current;
		ambientBack.current = null;
		leaveAmbientFlow(back, {running: runningApps, launch: launchApp, home: () => { if (screenRef.current === 'ambient') setScreen('home'); }});
	};
	useEffect(() => setVideoWallpaper(videoOn), [videoOn]);
	useEffect(() => {
		const root = document.documentElement.classList;
		root.toggle('focus-subtle', config.focusStrength === 'subtle');
		root.toggle('focus-strong', config.focusStrength === 'strong');
	}, [config.focusStrength]);
	useEffect(() => { setAmbientFlag(config.ambientOn); }, [config.ambientOn]);
	// also at start: a flag left by a Lumen that was closed mid-screensaver goes
	useEffect(() => { setAmbientShowing(screen === 'ambient'); }, [screen === 'ambient']);
	// the watcher's flag files again each time Lumen comes to the front, in case a write was lost (lib/flagSync.ts)
	useEffect(() => {
		const onVisibility = () => { if (!document.hidden) resyncFlags(); };
		document.addEventListener('visibilitychange', onVisibility);
		return () => document.removeEventListener('visibilitychange', onVisibility);
	}, []);
	// Home opens Lumen: at start, and when Live TV is switched, bring the watcher up to the one in this build and its flags up to date (never
	// run while off: a watcher set up by hand over SSH is left as it is)
	useEffect(() => { if (config.homeTakeover && isWebOS()) setHomeTakeover(appDir(), true, !config.liveTv).catch(() => undefined); }, [config.liveTv]);
	useEffect(() => { setVideoPaused(screen !== 'home'); document.documentElement.classList.toggle('in-settings', screen === 'settings' || screen === 'guide'); }, [screen]);
	const lastScreen = useRef(screen);
	useEffect(() => { if (lastScreen.current !== screen) navMark(`${lastScreen.current}>${screen}`); lastScreen.current = screen; }, [screen]);

	const updateConfig = (c: UserConfig) => { const next = withWallpaper(c); configRef.current = next; setConfig(next); saveConfig(next); scheduleBackup(next); };

	// first run: put the installed apps on the home screen (the catalogue's favourites first)
	useEffect(() => {
		const c = configRef.current;
		if (restoring || apps.length === 0) return;
		const builtins = (ids: string[]) => ids.concat(BUILTIN_APPS.map((b) => b.id).filter((id) => ids.indexOf(id) === -1));
		if (!c.seeded) updateConfig({...c, seeded: true, builtinTiles: true, appIds: builtins(seedAppIds(apps, DEFAULT_CONFIG.appIds))});
		// an install from before the built-in tiles: add them once at the end
		else if (!c.builtinTiles) updateConfig({...c, builtinTiles: true, appIds: builtins(c.appIds)});
	}, [apps, restoring]);
	const allApps = useMemo(() => withBuiltins(apps), [apps]);

	/** Lumen's screensaver straight away, without LG's showing first: your Immich photos when they are on and Immich is set up, else Lumen's
	 *  bundled pictures (lib/screensaver.ts). The idle timer (`own` false) opens LG's own when Use my photos is off; Control Center always opens Lumen's. */
	const showScreensaver = (own = configRef.current.ambientOn) => {
		if (own && (LOCAL_WALLPAPERS.length > 0 || screensaverSource(configRef.current, !!cachedServer()).kind === 'immich')) {
			ambientBack.current = null; ambientOpening.current = videoOnRef.current ? null : shownWallpaper(); setScreen('ambient'); return;
		}
		startScreensaver().catch(() => showToast("Couldn't start the screensaver (it needs the Homebrew Channel)", 'error'));
	};
	const saver = screensaverSource(config, immich.ready);
	const builtinFiles = useMemo(() => LOCAL_WALLPAPERS.map((w) => w.file), []);

	// idle screensaver: after the chosen time on the home screen without a key press or pointer move, while the launcher is in front
	useEffect(() => {
		// while the video plays it stands in for a screensaver, up to a long cap (lib/screensaver.ts idleDelay); then Lumen's own opens
		const delay = idleDelay(config.idleSeconds, videoActive);
		if (!delay || screen !== 'home' || controls) return;
		let timer = 0;
		const arm = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => { if (!document.hidden) showScreensaver(videoActive ? true : undefined); }, delay);
		};
		arm();
		const events = ['keydown', 'mousemove', 'click'];
		events.forEach((e) => window.addEventListener(e, arm));
		return () => { window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, arm)); };
	}, [config.idleSeconds, videoActive, screen, controls]);
	useEffect(() => { setVideoFlag(videoActive); }, [videoActive]);

	// ----- derived rows -----
	const shownApps = useMemo(() => pickInOrder(allApps, config.appIds, (a) => a.id), [allApps, config.appIds]);
	const shownInputs = useMemo(
		() => (config.sourceIds ? pickInOrder(inputs, config.sourceIds, (s) => s.appId) : inputs),
		[inputs, config.sourceIds]
	);


	const folderTiles = useMemo(
		() => config.folders.map((f) => ({name: f.name, items: pickInOrder(allApps, f.appIds, (a) => a.id).map(appTile)})).filter((f) => f.items.length > 0),
		[allApps, config.folders]
	);
	const folderMap = useMemo(() => {
		const map: Record<string, TileModel[]> = {};
		folderTiles.forEach((f) => { map[f.name] = f.items; });
		return map;
	}, [folderTiles]);
	/** what the home rows show: the apps that are not in a folder, then one tile per folder */
	const homeTiles = useMemo(() => {
		const inFolder = config.folders.reduce((all, f) => all.concat(f.appIds), [] as string[]);
		const open = (id: string) => running.indexOf(id) !== -1;
		return shownApps.filter((a) => inFolder.indexOf(a.id) === -1).map((a): TileModel => ({...appTile(a), running: open(a.id)}))
			.concat(folderTiles.map((f): TileModel => ({key: 'folder:' + f.name, label: f.name, color: '#3b4256', children: f.items.map((t) => t.imageUrl), running: f.items.some((t) => open(t.key))})));
	}, [shownApps, folderTiles, config.folders, running]);

	// Lumen bar (Home shows the bar): its data/ folder gets the dock (the glass bar's apps), Lumen's recent list and every app with its icon
	// file, written again only when that changes (a signature in data/sig)
	useEffect(() => {
		if (!config.homeBar || !isWebOS() || !allApps.length) return;
		const dir = appDir();
		const real = allApps.filter((a) => !a.glyph && /^[A-Za-z0-9._-]+$/.test(a.id));
		const dock = homeTiles.slice(0, config.firstRow).map((t) => t.key).filter((k) => real.some((a) => a.id === k));
		const list = real.map((a) => ({id: a.id, title: a.title, color: a.color, plain: a.plain, file: iconFile(a, dir)}));
		const t = TILES_FOR[config.firstRow] || TILES_FOR[6];
		const style = {size: t.size, height: t.height, gap: t.gap, perRow: config.firstRow, scale: BAR_FOCUS_SCALE[config.focusStrength] || BAR_FOCUS_SCALE.normal};
		const text = JSON.stringify([dock, config.recentIds, list, style]);
		let h = 5381;
		for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
		const id = window.setTimeout(() => {
			syncBar(dir, dir.replace(/^.*\//, ''), dock, config.recentIds, list, h.toString(36), style)
				.then((r) => {
					if (r === 'written') bootMark('bar: data written');
					// the bar then shows no icons or titles; lumen.log says why (a data/ or data/icons/ in the bar's folder that is not root's,
					// or a folder where a file should be: lib/checks.ts syncBarShell)
					else if (r === 'refused') logError('bar', 'data/ not written: refused (a folder in the bar\'s data/ that is not root\'s own, or a folder where a file should be)');
				})
				.catch(() => undefined);
		}, 3000);
		return () => window.clearTimeout(id);
	}, [config.homeBar, allApps, homeTiles, config.firstRow, config.recentIds, config.focusStrength]);

	// the first row (in the glass bar) holds config.firstRow apps; the rest make a grid of rows as wide below it, like the tvOS home screen
	// (the grid rows are 'dock', 'dock:1', 'dock:2'...)
	const firstRow = config.firstRow;
	/** the Live TV row: the Guide tile, then the channels picked in Settings > Channels (or the first few), each with what is on now */
	const liveTiles = useMemo((): TileModel[] => {
		if (!config.liveTv || !live.channels.length) return [];
		const guide: TileModel = {key: LIVE.guide, label: 'Guide', glyph: 'guide', color: 'rgba(255, 255, 255, 0.16)'};
		return [guide].concat(rowChannels(live.channels, config.liveChannels).map((c): TileModel => ({
			key: LIVE.prefix + c.id,
			label: c.name,
			live: {number: c.number, name: c.name, logo: c.logoPath && live.logos[c.logoPath], at: live.now, loading: !!live.pending[c.signal], ...nowNextAt(live.listings[c.signal], live.now)}
		})));
	}, [config.liveTv, config.liveChannels, live, config.language]);
	/** the furthest along the row a focused channel may sit with its now/next block still on the row (Row's slot) */
	const liveSlot = useMemo(() => {
		const t = TILES_FOR[firstRow] || TILES_FOR[6];
		return Math.max(0, Math.floor((firstRow * (t.size + t.gap) - t.gap - LIVE_INFO_W) / (t.size + t.gap)));
	}, [firstRow]);
	const rows: HomeRow[] = useMemo(() => {
		const list: HomeRow[] = [{id: ROW.apps, label: 'Apps', items: homeTiles.slice(0, firstRow), emptyText: 'No apps selected — add some in Settings'}];
		for (let at = firstRow, n = 0; at < homeTiles.length; at += firstRow, n++) list.push({id: n ? `${ROW.dock}:${n}` : ROW.dock, label: 'More apps', items: homeTiles.slice(at, at + firstRow)});
		if (liveTiles.length) list.push({id: ROW.live, label: 'Live TV', titled: true, className: 'row--live', below: LIVE_BELOW, slot: liveSlot, items: liveTiles});
		return list;
	}, [homeTiles, shownInputs, config.language, firstRow, liveTiles, liveSlot]);

	// Settings' tabs are only built while Settings is open
	const inSettings = screen === 'settings';
	const tabs: SettingsTab[] = useMemo(() => {
		if (!inSettings) return [];
		const list: SettingsTab[] = [
			{id: ROW.apps, label: 'Apps', glyph: 'grid', noun: 'apps', items: allApps.map(appTile), shown: shownApps.map(appTile)},
			{id: ROW.sources, label: 'Sources', glyph: 'inputs', noun: 'sources', items: inputs.map(inputTile), shown: shownInputs.map(inputTile)}
		];
		// the Live TV row's channels: every channel, the row's ticked, in the row's order
		if (config.liveTv && live.channels.length) {
			const tile = (c: Channel): TileModel => {
				const logo = c.logoPath && live.logos[c.logoPath];
				return {key: c.id, label: `${c.number} · ${c.name}`, imageUrl: logo || undefined, plain: true, color: `linear-gradient(160deg, rgba(255, 255, 255, 0.1) 0%, rgba(0, 0, 0, 0.28) 100%) ${channelColor(c.name) || '#22263a'}`, wordmark: logo ? undefined : c.name};
			};
			list.push({id: ROW.channels, label: 'Channels', glyph: 'guide', noun: 'channels', items: live.channels.map(tile), shown: rowChannels(live.channels, config.liveChannels).map(tile)});
		}
		return list;
	}, [inSettings, allApps, inputs, shownApps, shownInputs, config.language, config.liveTv, config.liveChannels, live.channels, live.logos]);

	/** options that pick from a list: the labels shown in the pop-up list, the stored values, and which one is set now */
	type Choice = {labels: string[]; values: (string | number)[]; now: string | number};
	const choices: Record<string, Choice> = useMemo(() => {
		const country = COUNTRIES.filter((c) => c.code === config.weatherCountry)[0];
		const cities = (country ? country.cities : CITIES).map((c) => c.name);
		return {
			[OPTION.country]: {labels: ['Any'].concat(COUNTRIES.map((c) => c.name)), values: [''].concat(COUNTRIES.map((c) => c.code)), now: config.weatherCountry},
			// the place found from a postcode comes after Auto, while there is one
			[OPTION.city]: config.weatherPlace
				? {labels: ['Not set', 'Auto', config.weatherPlace.name].concat(cities), values: ['', AUTO_PLACE, POSTCODE_PLACE].concat(cities), now: config.weatherCity}
				: {labels: ['Not set', 'Auto'].concat(cities), values: ['', AUTO_PLACE].concat(cities), now: config.weatherCity},
			[OPTION.wpType]: {labels: ['Pictures', 'Video', 'Immich photos', 'Plain'], values: ['pictures', 'video', 'immich', 'plain'], now: config.wallpaperType},
			[OPTION.immichDays]: {labels: ['Last month', 'Last 3 months', 'Last 6 months', 'Last year'], values: [30, 90, 180, 365], now: config.immichRecentDays},
			[OPTION.wpAuto]: {labels: ['Off', '30 sec', '1 min', '5 min', '15 min', '30 min', '60 min'], values: WP_AUTO_CHOICES, now: config.wpAutoMinutes},
			[OPTION.dockHide]: {labels: ['Off', 'Down arrow', 'After idle', 'Both'], values: ['off', 'down', 'idle', 'both'], now: config.dockHide},
			[OPTION.idle]: {labels: ['Never', '30 seconds', '1 minute', '2 minutes', '5 minutes'], values: IDLE_SECONDS, now: config.idleSeconds},
			[OPTION.darkMode]: {labels: ['Light', 'Dark', 'Auto'], values: ['off', 'on', 'auto'], now: config.darkMode},
			[OPTION.language]: {labels: ['Auto'].concat(LANGS.map((l) => l.name)), values: ['auto'].concat(LANGS.map((l) => l.code)), now: config.language},
			[OPTION.clock]: {labels: ['Auto', '12-hour', '24-hour'], values: ['auto', '12h', '24h'], now: config.clockFormat},
			[OPTION.focus]: {labels: ['Subtle', 'Normal', 'Strong'], values: ['subtle', 'normal', 'strong'], now: config.focusStrength},
			[OPTION.firstRow]: {labels: ['5', '6', '7'], values: [5, 6, 7], now: config.firstRow},
			[OPTION.ambient]: {labels: IMMICH_SOURCES.map((x) => x.title).concat(immich.albums.map((a) => a.title)), values: IMMICH_SOURCES.map((x) => x.key).concat(immich.albums.map((a) => `immich:album:${a.id}`)), now: config.ambient},
			[OPTION.ambientSeconds]: {labels: ['10 seconds', '20 seconds', '30 seconds', '1 minute', '2 minutes', '5 minutes'], values: [10, 20, 30, 60, 120, 300], now: config.ambientSeconds},
			[OPTION.ambientBrightness]: {labels: ['As the TV is set', 'Dim', 'Very dim'], values: ['tv', 'dim', 'low'], now: config.ambientBrightness},
			[OPTION.nightDim]: {labels: ['Off', 'At night', 'Always'], values: ['off', 'night', 'always'], now: config.wallpaperDim},
			[OPTION.videoHours]: {labels: ['Always', 'Daytime (7 am to 7 pm)', 'Evenings (5 pm to 11 pm)', 'Night (7 pm to 7 am)'], values: ['always', 'day', 'evening', 'night'], now: config.videoHours}
		};
	}, [config, immich]);
	/** the list fields of an option: its choices, which is set, and the text shown on the right */
	const listed = (id: string, fallback = '') => {
		const c = choices[id];
		const at = c.values.indexOf(c.now);
		return {choices: c.labels, choice: Math.max(0, at), valueText: at >= 0 ? c.labels[at] : fallback || c.labels[0]};
	};

	const options: OptionItem[] = useMemo(() => [
		{
			id: OPTION.liveTv,
			group: 'home' as const,
			label: 'Live TV',
			description: 'A row of TV channels under your apps, showing what is on now and next, with the Guide at the end, and the Guide button opens the Guide. OK on a channel opens Live TV on it. Off, Lumen does not read the TV\'s channels or guide at all. Takes effect at once, no relaunch needed. Needs the Homebrew Channel.',
			value: config.liveTv
		},
		{
			id: OPTION.homeTakeover,
			group: 'home' as const,
			label: 'Home opens Lumen',
			description: 'Whenever LG\'s own home comes up, Lumen opens instead: the Home button (short or long press), Back out of an app to the top level, and turning the TV on.'
				+ (config.liveTv ? '' : ' With Live TV off, Live TV coming up after an app (where Back out of an app lands) opens Lumen too.')
				+ ' LG\'s home shows for about a second first. On installs a small watcher (/var/lib/homehook/watch.sh, started at boot by the Homebrew Channel); Off leaves LG\'s home alone again. Lumen\'s LG Home button still opens it. Needs the Homebrew Channel.',
			value: config.homeTakeover
		},
		{
			id: OPTION.homeBar,
			group: 'home' as const,
			label: 'Home shows the bar',
			description: 'With Home opens Lumen on: Home pressed in an app shows Lumen\'s app bar over it, and the app keeps playing. OK opens an app, Up or the house opens Lumen, Back closes the bar. Needs the Lumen bar app from the same Homebrew Channel repository. Home in Lumen itself, and turning the TV on, still open Lumen.',
			value: config.homeBar
		},
		{
			id: OPTION.useHomebrew,
			group: 'system' as const,
			label: 'Live app list via Homebrew Channel',
			description: 'Rooted TVs only. Lists every installed app with its real icon, using the Homebrew Channel, which runs commands as root. When off, the built-in app catalogue is used.',
			value: config.useHomebrew
		},
		{
			id: OPTION.showAll,
			group: 'system' as const,
			label: 'Show system apps',
			description: 'Offer the TV\'s own apps (Live TV, LG Channels, AirPlay, Screen Share, Game Optimizer, TV Settings) in Settings > Apps, so you can add them to the home screen.',
			value: config.showAllApps
		},
		{
			id: OPTION.weather,
			group: 'weather' as const,
			label: 'Date and weather',
			description: 'Show today\'s date and the temperature at the top left of the home screen. The temperature needs a Weather city below; it comes from open-meteo.com.',
			value: config.showWeather
		},
		{
			id: OPTION.country,
			group: 'weather' as const,
			label: 'Weather country',
			description: 'Pick your country, then the city below. Until a city is chosen no weather is shown and nothing is fetched.',
			value: config.weatherCountry !== '',
			...listed(OPTION.country)
		},
		{
			id: OPTION.city,
			group: 'weather' as const,
			label: 'Weather city',
			description: 'Not set: no weather. Auto finds your area from your internet connection, which sends your IP address to ipwho.is and can be a few towns off. Or pick a city, or type a postcode below.',
			value: config.weatherCity !== '',
			...listed(OPTION.city, config.weatherCity)
		},
		{
			id: OPTION.postcode,
			group: 'weather' as const,
			label: 'Postcode or place',
			description: (config.weatherPlace ? `${config.weatherPlace.label}${config.weatherCity === POSTCODE_PLACE ? '' : ' (not in use: a city is picked above)'}. ` : '')
				+ 'OK, then type a UK postcode (CF10 3AT, or just CF10) or a town anywhere, with the on-screen keyboard. It is looked up once, at postcodes.io (UK postcodes) or open-meteo.com (places), and the weather then comes for that spot.',
			value: !!config.weatherPlace && config.weatherCity === POSTCODE_PLACE,
			valueText: config.weatherPlace && config.weatherCity === POSTCODE_PLACE ? config.weatherPlace.name : 'Not set'
		},
		{
			id: OPTION.wpType,
			group: 'wallpaper' as const,
			label: 'Wallpaper type',
			description: 'Pictures from the library, a video, your photos from Immich, or a plain background. Choose wallpaper then picks which ones.',
			value: true,
			...listed(OPTION.wpType)
		},
		...(immich.ready ? [{
			id: OPTION.immichDays,
			group: 'wallpaper' as const,
			label: 'Recent photos from',
			description: 'How far back the Recent and Recent, with people photos reach, for the wallpaper and the screensaver.',
			value: true,
			...listed(OPTION.immichDays)
		}] : []),
		{
			id: OPTION.wpNew,
			group: 'wallpaper' as const,
			label: 'New picture on startup',
			description: 'Opens on another of your pictures or photos each time. Off, it opens on the last one it showed.',
			value: config.wpNewOnLaunch
		},
		{
			id: OPTION.wpAuto,
			group: 'wallpaper' as const,
			label: 'Change wallpaper automatically',
			description: 'Shows another of your pictures or photos every 30 seconds to 60 minutes.',
			value: config.wpAutoMinutes > 0,
			...listed(OPTION.wpAuto)
		},
		{
			id: OPTION.ambientOn,
			group: 'screensaver' as const,
			label: immich.ready ? 'Use my photos' : 'Use Lumen\'s screensaver',
			description: immich.ready
				? 'When the TV\'s screensaver starts, show your photos from Immich instead of LG\'s: a slow crossfade, with the clock. Any key returns to the home screen. Over another app (Lumen bar\'s screensaver, so a paused film stays as it was) it shows Lumen\'s own pictures. Off, Screensaver in Control Center shows Lumen\'s own pictures.'
				: 'Lumen\'s screensaver instead of LG\'s: a slow crossfade of Lumen\'s own pictures, with the clock. With Immich set up (Settings > Wallpaper > Choose wallpaper > Photos) it shows your photos instead.',
			value: config.ambientOn
		},
		...(immich.ready ? [{
			id: OPTION.ambient,
			group: 'screensaver' as const,
			label: 'Photos',
			description: 'Which photos the screensaver shows.',
			value: true,
			...listed(OPTION.ambient)
		}] : []),
		{
			id: OPTION.idle,
			group: 'screensaver' as const,
			label: 'Start on the home screen after',
			description: 'Starts the screensaver when the home screen has been left alone this long. The TV\'s own screensaver timer still covers everything else.',
			value: config.idleSeconds > 0,
			...listed(OPTION.idle)
		},
		// these apply to Lumen's own pictures too, so they show without Immich
		...[{
			id: OPTION.ambientSeconds,
			group: 'screensaver' as const,
			label: 'Time on each photo',
			description: 'How long each picture stays on the screensaver before the next one fades in.',
			value: true,
			...listed(OPTION.ambientSeconds)
		}, {
			id: OPTION.ambientBrightness,
			group: 'screensaver' as const,
			label: 'Brightness',
			description: 'Turns the TV\'s backlight down while the screensaver shows, and back up when you press a key.',
			value: config.ambientBrightness !== 'tv',
			...listed(OPTION.ambientBrightness)
		}, {
			id: OPTION.ambientPrint,
			group: 'screensaver' as const,
			label: 'Print look',
			description: 'Makes your photos look like prints on a wall rather than a glowing screen: softer blacks, paper-white whites and a gentle fall of light.',
			value: config.ambientPrint
		}, {
			id: OPTION.ambientMove,
			group: 'screensaver' as const,
			label: 'Move clock to prevent burn-in',
			description: 'Every minute the clock and the date and weather fade out and come back somewhere else, so nothing stays in one place on the OLED screen.',
			value: config.ambientMove
		}],
		{
			id: OPTION.videoHours,
			group: 'wallpaper' as const,
			label: 'Video wallpaper hours',
			description: 'When the video wallpaper plays. Outside these hours the still wallpaper shows instead, and nothing streams.',
			value: config.videoHours !== 'always',
			...listed(OPTION.videoHours)
		},
		{
			id: OPTION.nightDim,
			group: 'wallpaper' as const,
			label: 'Dim the wallpaper',
			description: 'A darker wallpaper, easier on the eyes in a dark room. At night: between 7 pm and 6 am.',
			value: config.wallpaperDim !== 'off',
			...listed(OPTION.nightDim)
		},
		{
			id: OPTION.dockHide,
			group: 'home' as const,
			label: 'Hide the dock',
			description: 'Down arrow: Down on the last row slides the dock away. After idle: it hides itself after 30 seconds without a key press. Any key brings it back.',
			value: config.dockHide !== 'off',
			...listed(OPTION.dockHide)
		},
		...(config.dockHide !== 'off' ? [{
			id: OPTION.dockDim,
			group: 'home' as const,
			label: 'Dim when the dock is hidden',
			description: 'With the dock away, the wallpaper fades darker. It brightens again when the dock comes back.',
			value: config.dockDim
		}] : []),
		{
			id: OPTION.firstRow,
			group: 'home' as const,
			label: 'Apps in the glass bar',
			description: 'How many apps a row holds: the glass bar, and each row of the grid below it. With 7 the tiles are a little smaller, with 5 a little bigger.',
			value: true,
			...listed(OPTION.firstRow)
		},
		{
			id: OPTION.focus,
			group: 'appearance' as const,
			label: 'Focus highlight',
			description: 'How much the app in focus stands out: how far it grows and how strong its shadow and shine are.',
			value: config.focusStrength !== 'normal',
			...listed(OPTION.focus)
		},
		{
			id: OPTION.darkMode,
			group: 'appearance' as const,
			label: 'Appearance',
			description: 'Light: bright glass with dark text. Dark: dark glass and a dimmer wallpaper or video. Auto is dark from 7 pm to 6 am.',
			value: config.darkMode !== 'off',
			...listed(OPTION.darkMode)
		},
		{
			id: OPTION.language,
			group: 'language' as const,
			label: 'Language',
			description: "Language of the menus, dates and weather. Auto follows the TV. The long descriptions on this screen stay in English.",
			value: config.language !== 'auto',
			...listed(OPTION.language)
		},
		{
			id: OPTION.clock,
			group: 'language' as const,
			label: 'Clock',
			description: "Auto follows the TV's own 12/24-hour setting. Choose 12-hour or 24-hour to override it.",
			value: config.clockFormat !== 'auto',
			...listed(OPTION.clock)
		},
		{
			id: OPTION.hideNames,
			group: 'home' as const,
			label: 'Hide app names',
			description: 'No names under the apps on the home screen, not even the one in focus. Settings still shows them.',
			value: config.hideNames
		},
		{
			id: OPTION.showRecents,
			group: 'home' as const,
			label: 'Show recents indicator',
			description: 'A dot over the apps that are open.',
			value: config.showRecents
		},
		{
			id: OPTION.reduceMotion,
			group: 'appearance' as const,
			label: 'Reduce motion',
			description: 'Focus, rows and panels change at once, without sliding, fading or zooming.',
			value: config.reduceMotion
		},
		// both act on the live blur: an engine without backdrop-filter (webOS 4) has nothing for them to change
		...(LIVE_BLUR ? [
			{
				id: OPTION.dockBlur,
				group: 'appearance' as const,
				label: 'Dock blur',
				description: 'The glass bar blurs whatever is behind it. Off: the same glass look with no blur, and moving left and right is smoother.',
				value: config.dockBlur
			},
			{
				id: OPTION.liquidDock,
				group: 'appearance' as const,
				label: 'Liquid glass dock',
				description: 'The glass bar bends the picture at its edges, like Liquid Glass on Apple TV. Moving along the dock is slower with it on. Over a video wallpaper it only tints, as the TV draws video where the app cannot reach it.',
				value: config.liquidDock
			}
		] : []),
		{
			id: OPTION.showAmPm,
			group: 'language' as const,
			label: 'AM/PM on the clock',
			description: 'Show AM or PM beside the time when the TV is set to a 12-hour clock.',
			value: config.showAmPm
		},
		{
			id: OPTION.restore,
			group: 'system' as const,
			label: 'Restore settings from the TV',
			description: 'Lumen keeps a copy of its settings on the TV (/var/lib/homehook/lumen-config.json) after every change. This puts that copy back, replacing the settings here. Needs the Homebrew Channel.',
			value: false,
			valueText: 'Restore'
		},
		...(__LUMEN_DEV__ ? [{
			id: OPTION.fps,
			group: 'system' as const,
			label: 'Frame-rate counter (dev builds)',
			description: 'Frames drawn in the last second and the longest frame, in the top-left corner. Only in dev builds.',
			value: config.fpsCounter
		}] : [])
	], [config.liveTv, config.fpsCounter, choices, config.weatherCountry, config.weatherPlace, config.dockHide, config.videoPlaces, config.videoClip, config.darkMode, config.language, config.clockFormat, config.useHomebrew, config.videoWallpaper, config.showAmPm, config.idleSeconds, config.wpAutoMinutes, config.wallpaperType, config.wpNewOnLaunch, config.wallpaperDim, config.dockDim, config.showAllApps, config.showWeather, config.weatherCity, config.hideNames, config.showRecents, config.reduceMotion, config.dockBlur, config.liquidDock, config.ambient, config.ambientOn, config.ambientSeconds, config.ambientBrightness, config.ambientPrint, config.ambientMove, immich.ready]);

	const wallpaper: WallpaperTab = useMemo(() => {
		if (!inSettings) return {categories: [], entries: [], onPick: () => undefined};
		const entries: WallpaperEntry[] = [];
		const type = config.wallpaperType;
		if (type === 'video') {
			const tint = (i: number) => `linear-gradient(150deg, ${["#e9a15b,#6d3d4a", "#d8b46a,#3e5a78", "#9fc2d6,#2d4a6b", "#7fc79a,#1e4a52", "#e07f8a,#4a2d5e", "#c9a0dc,#2f2f6b", "#f0c16a,#8a4a2a", "#8ab0e0,#1d2f5a", "#d6a07a,#4a3430", "#86c5c0,#27495a"][i % 10]})`;
			entries.push({key: 'video:', title: 'All places', category: 'Video', tint: tint(0), on: config.videoPlaces.length === 0});
			VIDEO_PLACES.forEach((p, i) => entries.push({key: `video:${p}`, title: p, category: 'Video', tint: tint(i + 1), on: config.videoPlaces.indexOf(p) >= 0}));
			return {
				categories: ['Video'],
				entries,
				summary: 'Pick the places the video wallpaper plays.',
				onPick: (key: string) => {
					const place = key.slice(6);
					updateConfig({...config, videoPlaces: !place ? [] : config.videoPlaces.indexOf(place) >= 0 ? config.videoPlaces.filter((x) => x !== place) : config.videoPlaces.concat(place)});
				}
			};
		}
		if (type === 'immich') {
			if (immich.ready) {
				IMMICH_SOURCES.forEach((src) => entries.push({key: src.key, title: src.title, category: 'Photos', on: config.immichPicks.indexOf(src.key) >= 0}));
				immich.albums.forEach((a) => entries.push({key: `immich:album:${a.id}`, title: a.title, category: 'Photos', on: config.immichPicks.indexOf(`immich:album:${a.id}`) >= 0}));
			} else {
				entries.push({key: 'immich:setup', title: 'Set up Immich', category: 'Photos', label: 'Set up'});
			}
			return {
				categories: ['Photos'],
				entries,
				summary: 'Pick which of your Immich photos the home screen shows.',
				onPick: (key: string) => {
					if (key === 'immich:setup') { showToast('Put your Immich address and an API key in /var/lib/homehook/immich.json on the TV (see docs/immich.md), then open Settings again', 'error'); return; }
					const has = config.immichPicks.indexOf(key) >= 0;
					if (has && config.immichPicks.length === 1) { showToast('Keep at least one source'); return; }
					updateConfig({...config, immichPicks: has ? config.immichPicks.filter((x) => x !== key) : config.immichPicks.concat(key)});
				}
			};
		}
		if (type === 'plain') return {categories: [], entries: [], onPick: () => undefined};
		const picked = config.wallpaperPicks;
		const keysIn: Record<string, string[]> = {Defaults: LOCAL_WALLPAPERS.map((_, i) => `local:${i}`)};
		WALLPAPERS.forEach((w) => { (keysIn[w.category] || (keysIn[w.category] = [])).push(`cloud:${w.id}`); });
		const categories = WALLPAPER_CATEGORIES.slice(0, 2).concat('Defaults', WALLPAPER_CATEGORIES.slice(2));      // Landscapes and Art first
		categories.forEach((c) => {
			const keys = keysIn[c] || [];
			const all = keys.length > 0 && keys.every((k) => picked.indexOf(k) >= 0);
			entries.push({key: `all:${c}`, title: all ? 'Deselect all' : 'Select all', category: c, label: 'All', on: all});
		});
		LOCAL_WALLPAPERS.forEach((w, i) => entries.push({key: `local:${i}`, title: w.title, category: 'Defaults', thumb: w.file, on: picked.indexOf(`local:${i}`) >= 0}));
		WALLPAPERS.forEach((w) => entries.push({key: `cloud:${w.id}`, title: w.title, category: w.category, thumb: resized(cloudUrl(w), 360), on: picked.indexOf(`cloud:${w.id}`) >= 0}));
		return {
			categories,
			entries,
			// with nothing picked, the default picture shows (lib/wallpaper.ts falls back to it); it is not one of the choices
			summary: picked.length === 0 ? 'Nothing picked: the default picture shows.' : `${picked.length} ${picked.length === 1 ? 'picture' : 'pictures'} picked.`,
			onPick: (key: string) => {
				if (key.indexOf('all:') === 0) {
					const keys = keysIn[key.slice(4)] || [];
					const all = keys.every((k) => picked.indexOf(k) >= 0);
					updateConfig({...config, wallpaperPicks: all ? picked.filter((k) => keys.indexOf(k) === -1) : picked.concat(keys.filter((k) => picked.indexOf(k) === -1))});
					return;
				}
				const has = picked.indexOf(key) >= 0;
				updateConfig({...config, wallpaperPicks: has ? picked.filter((k) => k !== key) : picked.concat(key)});
			}
		};
	}, [config, immich, inSettings]);

	// ----- actions -----
	const open = (id: string, label: string) => {
		launchApp(id).catch(() => showToast(`Couldn't open ${label}`, 'error'));
	};

	const watchChannel = useCallback((c: Channel) => {
		openChannel(c.id).catch(() => showToast(`Couldn't open ${c.name}`, 'error'));
	}, [showToast]);

	const onActivate = useCallback((_rowId: string, item: TileModel) => {
		if (item.key === LIVE.guide) { if (configRef.current.liveTv) setScreen('guide'); return; }
		if (item.key.indexOf(LIVE.prefix) === 0) { openChannel(item.key.slice(LIVE.prefix.length)).catch(() => showToast(`Couldn't open ${item.label}`, 'error')); return; }
		if (item.key === MISC.settings || item.key === BUILTIN.settings) { setScreen('settings'); return; }
		if (item.key === 'screensaver') { startScreensaver().catch(() => showToast("Couldn't start the screensaver (it needs the Homebrew Channel)", 'error')); return; }
		if (item.key === MISC.lgHome) { launchLgHome().catch(() => showToast("Couldn't open LG Home", 'error')); return; }
		if (item.key === 'controls') { setControls(true); return; }
		if (_rowId === ROW.apps || _rowId.indexOf(ROW.dock) === 0 || _rowId === 'folder') {
			const c = configRef.current;
			updateConfig({...c, recentIds: [item.key].concat(c.recentIds.filter((x) => x !== item.key)).slice(0, RECENT_MAX)});
		}
		open(item.key, item.label);
	}, [showToast]);

	/** hold OK on an app: move it one place along the home rows, or take it off the home screen */
	const onEdit = useCallback((action: 'move' | 'remove' | 'uninstall' | 'folder-add' | 'folder-out', _rowId: string, key: string, arg: number | string = 0) => {
		const c = configRef.current;
		const strip = (folders: UserConfig['folders']) => folders.map((f) => ({...f, appIds: f.appIds.filter((id) => id !== key)}));
		if (action === 'uninstall') {
			const title = (allApps.filter((a) => a.id === key)[0] || {title: 'The app'}).title;
			showToast(`Uninstalling ${title}…`);
			uninstallApp(key).then((gone) => {
				if (!gone) { showToast(`${title} is still installed`, 'error'); return; }
				const now = configRef.current;
				updateConfig({...now, appIds: now.appIds.filter((id) => id !== key), folders: strip(now.folders).filter((f) => f.appIds.length > 0)});
				setApps((list) => list.filter((a) => a.id !== key));
				showToast(`${title} uninstalled`);
			}, () => showToast(`Couldn't uninstall ${title}`, 'error'));
			return;
		}
		if (action === 'folder-add') {
			const folders = strip(c.folders);
			const target = folders.filter((f) => f.name === String(arg))[0];
			if (target) target.appIds.push(key); else folders.push({name: String(arg), appIds: [key]});
			updateConfig({...c, folders: folders.filter((f) => f.appIds.length > 0)});
			return;
		}
		if (action === 'folder-out') { updateConfig({...c, folders: strip(c.folders).filter((f) => f.appIds.length > 0)}); return; }
		const inFolder = c.folders.reduce((all, f) => all.concat(f.appIds), [] as string[]);
		const ids = c.appIds.filter((id) => allApps.some((a) => a.id === id) && inFolder.indexOf(id) === -1);   // what the rows show, in order
		const kept = c.appIds.filter((id) => ids.indexOf(id) === -1);                                          // apps in folders keep their place
		const at = ids.indexOf(key);
		if (at < 0) return;
		if (action === 'remove') { updateConfig({...c, appIds: ids.filter((id) => id !== key).concat(kept)}); return; }
		// a row up or down past either end stops at the first or last place
		const to = Math.max(0, Math.min(ids.length - 1, at + Number(arg)));
		if (to === at) return;
		const next = ids.slice();
		next.splice(at, 1);
		next.splice(to, 0, key);
		updateConfig({...c, appIds: next.concat(kept)});
	}, [allApps]);

	const onToggle = useCallback((tabId: string, key: string) => {
		if (tabId === ROW.channels) {
			updateConfig({...config, liveChannels: toggleId(rowChannels(live.channels, config.liveChannels).map((c) => c.id), key)});
		} else if (tabId === ROW.apps) {
			updateConfig({...config, appIds: toggleId(config.appIds, key)});
		} else {
			const current = config.sourceIds || inputs.map((s) => s.appId);
			updateConfig({...config, sourceIds: toggleId(current, key)});
		}
	}, [config, inputs, live.channels]);

	const onOption = useCallback((optionId: string) => {
		if (optionId === OPTION.restore) {
			readBackup().then((saved) => {
				if (!saved) { showToast('No settings backup found on the TV', 'error'); return; }
				updateConfig({...saved, seeded: true});
				showToast('Settings restored from the TV');
			});
			return;
		}
		if (optionId === OPTION.postcode) { setPrompt(true); return; }
		if (optionId === OPTION.useHomebrew) updateConfig({...config, useHomebrew: !config.useHomebrew});
		else if (optionId === OPTION.liveTv) updateConfig({...config, liveTv: !config.liveTv});
		else if (optionId === OPTION.homeTakeover) {
			const on = !config.homeTakeover;
			updateConfig({...config, homeTakeover: on, homeBar: on && config.homeBar});
			if (!on && config.homeBar && isWebOS()) setHomeBar(appDir(), false).catch(() => undefined);
			if (isWebOS()) setHomeTakeover(appDir(), on, !config.liveTv)
				.then((r) => showToast(on ? (r === 'same' ? 'Home opens Lumen' : 'Home watcher ' + r + ': Home opens Lumen') : 'Home opens LG\'s home again'))
				.catch((e: Error) => showToast('Could not set up the Home watcher: ' + e.message, 'error'));
		}
		else if (optionId === OPTION.homeBar) {
			const on = !config.homeBar;
			// the bar needs the watcher: turning it on turns Home opens Lumen on too
			const takeover = on || config.homeTakeover;
			updateConfig({...config, homeBar: on, homeTakeover: takeover});
			if (isWebOS()) {
				const watcher = on && !config.homeTakeover ? setHomeTakeover(appDir(), true, !config.liveTv) : Promise.resolve('same');
				watcher.then(() => setHomeBar(appDir(), on))
					.then((r) => showToast(r === 'missing' ? 'Install Lumen bar from the Homebrew Channel first' : on ? 'Home shows the bar' : 'Home opens Lumen', r === 'missing' ? 'error' : undefined))
					.catch((e: Error) => showToast('Could not set up the bar: ' + e.message, 'error'));
			}
		}
		else if (optionId === OPTION.videoWallpaper) updateConfig({...config, videoWallpaper: !config.videoWallpaper});
		else if (optionId === OPTION.videoClip) {
			const names = [''].concat(VIDEO_PLACES);
			updateConfig({...config, videoClip: names[(names.indexOf(config.videoClip) + 1) % names.length]});
		} else if (optionId === OPTION.showAmPm) updateConfig({...config, showAmPm: !config.showAmPm});
		else if (optionId === OPTION.showAll) updateConfig({...config, showAllApps: !config.showAllApps});
		else if (optionId === OPTION.weather) updateConfig({...config, showWeather: !config.showWeather});
		else if (optionId === OPTION.fps) updateConfig({...config, fpsCounter: !config.fpsCounter});
		else if (optionId === OPTION.hideNames) updateConfig({...config, hideNames: !config.hideNames});
		else if (optionId === OPTION.showRecents) updateConfig({...config, showRecents: !config.showRecents});
		else if (optionId === OPTION.reduceMotion) updateConfig({...config, reduceMotion: !config.reduceMotion});
		else if (optionId === OPTION.dockBlur) updateConfig({...config, dockBlur: !config.dockBlur});
		else if (optionId === OPTION.liquidDock) updateConfig({...config, liquidDock: !config.liquidDock});
		else if (optionId === OPTION.dockDim) updateConfig({...config, dockDim: !config.dockDim});
		else if (optionId === OPTION.ambientOn) updateConfig({...config, ambientOn: !config.ambientOn});
		else if (optionId === OPTION.ambientPrint) updateConfig({...config, ambientPrint: !config.ambientPrint});
		else if (optionId === OPTION.ambientMove) updateConfig({...config, ambientMove: !config.ambientMove});
		else if (optionId === OPTION.wpNew) updateConfig({...config, wpNewOnLaunch: !config.wpNewOnLaunch});
	}, [config]);

	/** a value picked from an option's pop-up list */
	const onChoose = useCallback((optionId: string, index: number) => {
		const c = configRef.current;
		const value = choices[optionId] && choices[optionId].values[index];
		if (value === undefined) return;
		const v = String(value);
		if (optionId === OPTION.country) {
			const first = COUNTRIES.filter((x) => x.code === v)[0];
			// a new country starts with no city (no weather until one is picked); the same country keeps its city
			updateConfig({...c, weatherCountry: v, weatherCity: v === c.weatherCountry ? c.weatherCity : first ? '' : c.weatherCity});
		} else if (optionId === OPTION.city) {
			const owner = COUNTRIES.filter((x) => x.cities.some((y) => y.name === v))[0];
			updateConfig({...c, weatherCity: v, weatherCountry: c.weatherCountry || (owner ? owner.code : '')});
		}
		else if (optionId === OPTION.immichDays) updateConfig({...c, immichRecentDays: Number(value)});
		else if (optionId === OPTION.wpAuto) updateConfig({...c, wpAutoMinutes: Number(value)});
		else if (optionId === OPTION.wpType) updateConfig({...c, wallpaperType: v});
		else if (optionId === OPTION.dockHide) updateConfig({...c, dockHide: v});
		else if (optionId === OPTION.idle) updateConfig({...c, idleSeconds: Number(value)});
		else if (optionId === OPTION.darkMode) updateConfig({...c, darkMode: v});
		else if (optionId === OPTION.language) updateConfig({...c, language: v});
		else if (optionId === OPTION.clock) updateConfig({...c, clockFormat: v});
		else if (optionId === OPTION.focus) updateConfig({...c, focusStrength: v});
		else if (optionId === OPTION.firstRow) updateConfig({...c, firstRow: Number(value)});
		else if (optionId === OPTION.videoHours) updateConfig({...c, videoHours: v});
		else if (optionId === OPTION.nightDim) updateConfig({...c, wallpaperDim: v});
		else if (optionId === OPTION.ambient) updateConfig({...c, ambient: v});
		else if (optionId === OPTION.ambientSeconds) updateConfig({...c, ambientSeconds: Number(value)});
		else if (optionId === OPTION.ambientBrightness) updateConfig({...c, ambientBrightness: v});
	}, [choices]);

	/** Replace a row's order with `keys` (the full list of what's shown). */
	const onReorder = useCallback((tabId: string, keys: string[]) => {
		if (tabId === ROW.apps) updateConfig({...config, appIds: keys});
		else if (tabId === ROW.channels) updateConfig({...config, liveChannels: keys});
		else updateConfig({...config, sourceIds: keys});
	}, [config]);

	return (
		<>
			{/* Home stays mounted under Settings so it keeps its focus position. */}
			<Home rows={rows} tiles={TILES_FOR[firstRow] || TILES_FOR[6]} perRow={firstRow} topItems={TOP_ITEMS} menuItems={MENU_ITEMS} inputs={shownInputs.map(inputTile)} active={screen === 'home' && !controls} onActivate={onActivate} showPeriod={config.showAmPm} onEdit={onEdit} folders={folderMap} weather={weather} dockHide={config.dockHide} dockDim={config.dockDim} focusRow={focusRow} />
			{screen === 'ambient' && <Ambient source={config.ambient} builtin={saver.kind === 'builtin' ? builtinFiles : undefined} seconds={config.ambientSeconds} backlight={AMBIENT_BACKLIGHT[config.ambientBrightness]} weather={weather} showPeriod={config.showAmPm} print={config.ambientPrint} move={config.ambientMove} opening={ambientOpening.current} onExit={leaveAmbient} />}
			{screen === 'guide' && config.liveTv && <Guide channels={live.channels} listings={live.listings} logos={live.logos} now={live.now} schedule={live.schedule} pending={live.pending} full={config.guideFull} onMode={(full) => { if (configRef.current.guideFull !== full) updateConfig({...configRef.current, guideFull: full}); }} active={!controls} onOpen={watchChannel} onClose={() => setScreen('home')} />}
			{screen === 'settings' && <Settings tabs={tabs} wallpaper={wallpaper} options={options} active={!prompt} onToggle={onToggle} onReorder={onReorder} onOption={onOption} onChoose={onChoose} onClose={() => setScreen('home')} />}
			{controls && <ControlCenter
				darkMode={config.darkMode}
				clockFormat={config.clockFormat}
				onDarkMode={(darkMode) => updateConfig({...configRef.current, darkMode})}
				onClockFormat={(clockFormat) => updateConfig({...configRef.current, clockFormat})}
				onClose={() => setControls(false)}
				onCloseDown={() => { setControls(false); setFocusRow({id: ROW.apps, seq: Date.now()}); }}
				onError={(text) => showToast(text, 'error')}
				onAction={(a: CenterAction) => { setControls(false); if (a === 'art') showScreensaver(true); else onActivate('menu', {key: MISC.lgHome, label: 'LG Home'}); }}
			/>}
			{prompt && screen === 'settings' && <TextPrompt
				title="Postcode or place"
				hint="A UK postcode (CF10 3AT, or just CF10), or a town anywhere. Down for the buttons, Back to cancel."
				placeholder="CF10 3AT"
				initial={config.weatherPlace ? config.weatherPlace.query : ''}
				current={config.weatherPlace ? config.weatherPlace.label : undefined}
				onSubmit={(text) => findPlace(text).then((place) => {
					updateConfig({...configRef.current, weatherPlace: place, weatherCity: POSTCODE_PLACE, showWeather: true});
					showToast(`Weather for ${place.name}`);
				})}
				onClear={() => {
					const c = configRef.current;
					// back to the automatic place (from the internet connection), as before a postcode was set
					updateConfig({...c, weatherPlace: null, weatherCity: c.weatherCity === POSTCODE_PLACE ? AUTO_PLACE : c.weatherCity});
				}}
				onClose={() => setPrompt(false)}
			/>}
			<Toast message={toast} />
		</>
	);
}
