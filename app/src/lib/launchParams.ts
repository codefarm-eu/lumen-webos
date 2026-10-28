// Launch parameters: {"view":"recent"} opens Lumen on its Recent row and {"view":"guide"} on the Guide (buttons rebound with LG Input Hook). webOS hands them over
// in webOSSystem.launchParams (PalmSystem on older firmware) on a cold start and in a webOSRelaunch event when Lumen is already running. Untested on webOS 25 (PLAN Phase 2).

const system = () => window.webOSSystem || window.PalmSystem;

/** `back`: with {"view":"ambient"}, the app that was in front when the TV's screensaver started (tools/tv/watch.sh); dismissing the screensaver
 *  returns to it. Only a plain app id is kept. */
export interface LaunchParams { view?: string; back?: string; }

const APP_ID = /^[A-Za-z0-9._-]{1,128}$/;

function clean (p: unknown): LaunchParams {
	const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
	if (typeof o.view !== 'string') return {};
	return typeof o.back === 'string' && APP_ID.test(o.back) ? {view: o.view, back: o.back} : {view: o.view};
}

/** The parameters Lumen was started with. Dev preview: ?view=recent. */
export function startParams (): LaunchParams {
	if (import.meta.env.DEV) { const m = /[?&]view=(\w+)/.exec(location.search); if (m) return {view: m[1]}; }
	try {
		const raw = system() && system()!.launchParams;
		return clean(raw ? JSON.parse(raw) : {});
	} catch { return {}; }
}

/** Calls back with the parameters of each relaunch while Lumen is running. Returns the unsubscribe. */
export function onRelaunch (cb: (p: LaunchParams) => void): () => void {
	const handler = (e: Event) => {
		const detail = (e as CustomEvent).detail;
		let p: unknown = detail;
		const sys = system();
		// a relaunch must bring the window forward itself: on webOS 4 LG's home bar stays over Lumen when the watcher relaunches Lumen while it is
		// already the app under the bar, and activate() is what gives Lumen's window the focus back (LG's own guidance for webOSRelaunch)
		try { const act = sys && (sys as {activate?: () => void}).activate; if (typeof act === 'function') act.call(sys); } catch { /* not on this firmware */ }
		if (!p && sys && sys.launchParams) { try { p = JSON.parse(sys.launchParams); } catch { p = {}; } }
		cb(clean(p));
	};
	document.addEventListener('webOSRelaunch', handler);
	return () => document.removeEventListener('webOSRelaunch', handler);
}

/** What a launch or relaunch with `p` does (app.tsx applies it): the screen to show, whether Control Center closes, the app to go back to
 *  after the screensaver (undefined: keep the one set), and whether the app grid gets the focus. `screen` is the screen up now.
 *  The screensaver closes Control Center too: it stays mounted and is painted over Ambient, so its keys still ran under the photos. */
export function launchAction (p: LaunchParams, cfg: {ambientOn: boolean; liveTv: boolean}, screen: string):
	{screen?: string; closeControls: boolean; back?: string | null; focusDock: boolean} {
	const out: {screen?: string; closeControls: boolean; back?: string | null; focusDock: boolean} = {closeControls: false, focusDock: p.view === 'recent'};
	// watch.sh opens Lumen with {"view":"ambient"} when the TV's screensaver starts (Settings > Screensaver); with "back" (the app the TV's
	// screensaver came up over), dismissing it returns there. A second ambient launch while it is up (LG's screensaver timer again) has no
	// "back" and keeps the first one.
	if (p.view === 'ambient' && cfg.ambientOn) {
		if (p.back || screen !== 'ambient') out.back = p.back || null;
		out.screen = 'ambient';
		out.closeControls = true;
	} else out.back = null;
	// {"view":"guide"} is the remote's Guide button, rebound with LG Input Hook; only with Settings > Live TV on; off, the button does nothing here
	if (p.view === 'guide' && cfg.liveTv) { out.screen = 'guide'; out.closeControls = true; }
	// a plain relaunch is the remote's Home button: back to the home screen from Settings, the Guide, the screensaver or Control Center
	if (!p.view) { out.screen = 'home'; out.closeControls = true; }
	return out;
}
