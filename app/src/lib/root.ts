// Every command Lumen runs as root, through the Homebrew Channel's exec service. Nothing else in the app builds a shell command: each export
// below is one fixed command, and any value that goes into one is checked against a list or a pattern first, then shell-quoted.

import {LUNA} from '../config/constants';
import {isWebOS, lunaCall} from './luna';
import {IMMICH_BASE, IMMICH_KEY, resolvedPath, safeAppPath, shaCheck, syncBarResult, syncBarShell} from './checks';

/** The TV-side folder shared with tools/tv/watch.sh (flag files, the log, the settings backup). */
export const HOMEHOOK = '/var/lib/homehook';

/** Quote a value for a POSIX shell. */
export function shellQuote (value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Shell: the icon path `p` resolved through every link into $r, true only for a plain file still under the app folders (checks.ts resolvedPath) */
const resolvedIcon = (p: string) => `{ ${resolvedPath(p)}; }`;
const BASE64 = /^[A-Za-z0-9+\/]*={0,2}$/;

/** The settings Lumen reads or changes, and the values it may set. A key not listed here never reaches the shell. */
const SETTINGS: Record<string, {category: string; values?: string[]}> = {
	// every picture mode key the settings service lists on an OLED C8 (webOS 4.4, bscpylgtv docs/available_settings_C8.md), and the later
	// models' FILMMAKER; which of them Lumen offers is decided in lib/tvcontrols.ts
	pictureMode: {category: 'picture', values: ['vivid', 'normal', 'eco', 'cinema', 'sports', 'game', 'photo', 'hdrEffect', 'technicolor', 'expert1', 'expert2', 'filmMaker',
		'hdrVivid', 'hdrStandard', 'hdrCinemaBright', 'hdrCinema', 'hdrGame', 'hdrTechnicolor',
		'dolbyHdrVivid', 'dolbyHdrStandard', 'dolbyHdrCinemaBright', 'dolbyHdrCinema', 'dolbyHdrGame',
		'technicolorHdrVivid', 'technicolorHdrStandard', 'technicolorHdrCinemaBright', 'technicolorHdrCinema', 'technicolorHdrGame', 'technicolorHdrTechnicolor']},
	soundMode: {category: 'sound', values: ['standard', 'news', 'movie', 'music', 'sports', 'game', 'aiSound']},
	/** where the sound goes (tv_speaker, external_arc, ...): read only, an empty list refuses every value */
	soundOutput: {category: 'sound', values: []},
	/** for the picture mode in use (the TV keeps one per mode and input) */
	backlight: {category: 'picture', values: Array.from({length: 101}, (_, i) => String(i))},
	eyeComfortMode: {category: 'picture', values: ['on', 'off']}
};

/** Files under HOMEHOOK that Lumen may write or read. */
const FILES = ['lumen-config.json', 'recent', 'immich.json'] as const;
export type HomehookFile = typeof FILES[number];
const LOG = `${HOMEHOOK}/lumen.log`;
const LOG_MAX_BYTES = 64 * 1024;

let timed: ((tag: string, start: number, end: number) => void) | null = null;
/** lib/log.ts's boot timeline: told when each command started and ended. */
export function setRootTimer (fn: (tag: string, start: number, end: number) => void): void { timed = fn; }

/** The one place a command is sent. Not exported: callers use the fixed commands below. */
function run (command: string, timeoutMs = 6000): Promise<string> {
	if (!isWebOS()) return Promise.reject(new Error('not on a TV'));
	const start = performance.now();
	const call = lunaCall<{stdoutString?: string}>(LUNA.homebrewExec, {command}, timeoutMs).then((r) => r.stdoutString || '');
	if (timed) {
		// a Luna method's name ("getChannelList"), else the command's first word ("base64", "curl")
		const m = /luna:\/\/[\w.]+\/(?:[\w]+\/)*(\w+)/.exec(command);
		const tag = m ? m[1] : (/(curl|base64|touch|rm|mkdir)/.exec(command) || ['shell'])[0];
		const done = () => { if (timed) timed(tag, start, performance.now()); };
		call.then(done, done);
	}
	return call;
}

function luna (uri: string, params: object): string {
	return `luna-send -n 1 ${shellQuote(uri)} ${shellQuote(JSON.stringify(params))}`;
}

export function listLaunchPoints (): Promise<string> {
	return run(luna('luna://com.webos.applicationManager/listLaunchPoints', {}), 8000);
}

const APP_ID = /^[A-Za-z0-9._-]+$/;

/** The ids of the apps the TV has open, Lumen too. Root because the app manager's running list is not offered to apps. */
export function runningApps (): Promise<string[]> {
	return run(luna('luna://com.webos.applicationManager/running', {})).then((text) => {
		const ids = (JSON.parse(text).running || []) as {id?: string}[];
		return ids.map((a) => a.id || '').filter((id) => APP_ID.test(id));
	});
}

/** An app's info from the app manager (its folder and icon paths), for the TV's own apps that are not launch points. Root because getAppInfo
 *  is not offered to apps. */
export function appInfo (id: string): Promise<{folderPath?: string; icon?: string; largeIcon?: string; mediumLargeIcon?: string; iconColor?: string; bgColor?: string}> {
	if (!APP_ID.test(id)) return Promise.reject(new Error('refused: app id'));
	return run(luna('luna://com.webos.applicationManager/getAppInfo', {id})).then((text) => {
		const r = JSON.parse(text) as {appInfo?: Record<string, string>};
		if (!r.appInfo) throw new Error('no app info');
		return r.appInfo;
	});
}

/** Never offered for uninstalling: every Lumen build (this fork's, Lumen bar and the dev copies included: com.ovsteenb.lumen*), LG Home and system apps, and the Homebrew Channel, which every root command runs through. */
export const KEEP_INSTALLED = /^(com\.ovsteenb\.lumen|com\.webos\.|com\.palm\.|com\.lge\.|org\.webosbrew\.hbchannel$)/;

export function canUninstall (id: string): boolean {
	return APP_ID.test(id) && !KEEP_INSTALLED.test(id);
}

/** Removes an app: the developer-mode remover first (Homebrew Channel apps), then the store's. True once the TV no longer knows the app. */
export function uninstallApp (id: string): Promise<boolean> {
	if (!canUninstall(id)) return Promise.reject(new Error(`refused: uninstall ${id}`));
	// luna-send prints "returnValue": true with a space on some firmware and without on others (tools/tv/watch.sh)
	const present = `${luna('luna://com.webos.applicationManager/getAppInfo', {id})} 2>/dev/null | grep -Eq '"returnValue": *true'`;
	const remove = (service: string) => `if ${present}; then ${luna(`luna://com.webos.appInstallService/${service}`, {id, subscribe: false})} >/dev/null 2>&1; sleep 2; fi`;
	return run(`${remove('dev/remove')}; ${remove('remove')}; if ${present}; then echo kept; else echo gone; fi`, 30000).then((text) => text.indexOf('gone') !== -1);
}

/** Icons as "<index> <base64>" lines, one per path; paths that are not plain absolute paths are skipped (their line is missing). */
export function readIcons (paths: string[]): Promise<string> {
	const script = paths
		.map((p, i) => safeAppPath(p) ? `if ${resolvedIcon(p)}; then printf '%d ' ${i}; base64 "$r" 2>/dev/null | tr -d '\\n'; echo; fi` : '')
		.filter(Boolean)
		.join('; ');
	return script ? run(script, 15000) : Promise.resolve('');
}

// ---------- Live TV (docs/live-tv-build.md) ----------

/** "1_41_2_102_16522_17472_9018": seven numbers. */
const CHANNEL_ID = /^\d+(_\d+){6}$/;
/** db8's paging key from the last reply ("1mo403xJBZ3rD34pMoS5+F") */
const DB8_PAGE = /^[A-Za-z0-9+\/=_.-]{1,128}$/;
/** the now and next programmes of every channel */
const PROGRAM_PF = 'com.webos.service.legacybroadcast.programPF:4';
const PF_FIELDS = ['signalChannelId', 'programName', 'startTime', 'endTime', 'isPresent'];

/** The aerial channel list (about 188 channels), as the TV's JSON reply. */
export function channelList (): Promise<string> {
	return run(luna('luna://com.webos.service.iepg/getChannelList', {dataType: 0, sort: 0, channelMode: 'Terrestrial', attribute: [{filterType: 'Invisible', value: false}]}), 12000);
}

/** One page (up to 500 rows) of the now and next programmes, as the TV's JSON reply. `slim` asks only for the fields Lumen reads; without
 *  it every row carries its audio, rating and description blocks (about 1.5 KB a row). */
export function nowNext (page?: string, slim = true): Promise<string> {
	if (page !== undefined && !DB8_PAGE.test(page)) return Promise.reject(new Error('refused: db8 page'));
	const query: Record<string, unknown> = {from: PROGRAM_PF, limit: 500};
	if (slim) query.select = PF_FIELDS;
	if (page) query.page = page;
	return run(luna('luna://com.webos.epgdb/find', {query}), 12000);
}

/** the full schedule (the Full guide); about 11,900 rows when Live TV has run lately */
const PROGRAM_SCH = 'com.webos.service.legacybroadcast.programSCH:4';
const SCH_FIELDS = ['signalChannelId', 'programName', 'startTime', 'endTime', 'isSubtitle', 'isAD'];

/** One page (up to 500 rows) of the whole schedule, as the TV's JSON reply. No time filter: the kind has no index on the times. */
export function schedule (page?: string): Promise<string> {
	if (page !== undefined && !DB8_PAGE.test(page)) return Promise.reject(new Error('refused: db8 page'));
	const query: Record<string, unknown> = {from: PROGRAM_SCH, select: SCH_FIELDS, limit: 500};
	if (page) query.page = page;
	return run(luna('luna://com.webos.epgdb/find', {query}), 12000);
}

/** "2026,10,18,06,30,00": the guide service's local-time stamp */
const LOCAL_TIME = /^\d{4}(,\d{2}){5}$/;
/** channels per guide service call, as LG's own Guide asks */
export const EVENT_BATCH = 10;

/** Every programme on up to EVENT_BATCH channels between two local times, from the TV's guide service (what LG's Guide reads, which can
 *  also draw on the online Freeview Play guide), as the TV's JSON reply. The call is copied from LG's Guide (docs/live-tv.md Step 2d). */
export function eventList (channelIds: string[], localStart: string, localEnd: string): Promise<string> {
	if (channelIds.length === 0 || channelIds.length > EVENT_BATCH || !channelIds.every((id) => CHANNEL_ID.test(id))) return Promise.reject(new Error('refused: channel ids'));
	if (!LOCAL_TIME.test(localStart) || !LOCAL_TIME.test(localEnd)) return Promise.reject(new Error('refused: guide time'));
	return run(luna('luna://com.webos.service.iepg/getEventList', {bFVPChannelId: true, channelId: channelIds, dataType: 0, fepgType: 'Forward', localStartTime: localStart, localEndTime: localEnd, sort: 0}), 12000);
}

/** Opens Live TV on a channel (from Home too). */
export function openChannel (channelId: string): Promise<void> {
	if (!CHANNEL_ID.test(channelId)) return Promise.reject(new Error('refused: channel id'));
	return run(luna('luna://com.webos.service.apiadapter/tv/openChannel', {channelId})).then((text) => {
		if (text.indexOf('"returnValue":false') !== -1) throw new Error('the TV refused the channel');
	});
}

/** The value of one known setting, or '' when the TV has none. */
export function getSetting (key: string): Promise<string> {
	const s = SETTINGS[key];
	if (!s) return Promise.reject(new Error('unknown setting ' + key));
	return run(luna('luna://com.webos.settingsservice/getSystemSettings', {category: s.category, keys: [key]})).then((text) => {
		const m = JSON.parse(text) as {settings?: Record<string, unknown>};
		const v = m.settings && m.settings[key];
		return v === undefined || v === null ? '' : String(v);
	});
}

/** The values the TV's settings service offers for a known setting (getSystemSettingDesc), without those it marks hidden or inactive; null
 *  when it gives no list (an older firmware, or a setting described by a range). */
/** What the TV says about a setting (getSystemSettingDesc). On the C8 (webOS 4.4.3) "visible" is fixed, not per signal: the HDR and Dolby Vision
 * picture modes are visible:false even while such a picture plays, and ui.active is false for soundMode while the sound goes over HDMI ARC. */
export interface SettingDesc {
	/** values marked active (all the TV accepts) */
	values: string[];
	/** values marked active and visible */
	visible: string[];
	/** ui.active: false when the TV greys the setting out */
	uiActive: boolean;
}
export function getSettingValues (key: string): Promise<SettingDesc | null> {
	const s = SETTINGS[key];
	if (!s) return Promise.reject(new Error('unknown setting ' + key));
	return run(luna('luna://com.webos.settingsservice/getSystemSettingDesc', {category: s.category, keys: [key]})).then((text) => {
		type Ext = {value?: unknown; visible?: boolean; active?: boolean};
		const r = JSON.parse(text) as {returnValue?: boolean; results?: {key?: string; ui?: {active?: boolean}; values?: {arrayExt?: Ext[]; array?: unknown[]}}[]};
		const desc = (r.results || []).filter((x) => !x.key || x.key === key)[0];
		const v = desc && desc.values;
		if (!v) return null;
		const uiActive = !(desc.ui && desc.ui.active === false);
		if (Array.isArray(v.arrayExt)) {
			const act = v.arrayExt.filter((e) => e.active !== false && typeof e.value === 'string');
			return {values: act.map((e) => e.value as string), visible: act.filter((e) => e.visible !== false).map((e) => e.value as string), uiActive};
		}
		if (Array.isArray(v.array)) { const a = v.array.filter((x): x is string => typeof x === 'string'); return {values: a, visible: a, uiActive}; }
		return null;
	});
}

/** Rejects for a key or value not in SETTINGS, and when the TV answers returnValue:false. */
export function setSetting (key: string, value: string): Promise<void> {
	const s = SETTINGS[key];
	if (!s || (s.values && s.values.indexOf(value) === -1)) return Promise.reject(new Error(`refused: ${key}=${value}`));
	return run(luna('luna://com.webos.settingsservice/setSystemSettings', {category: s.category, settings: {[key]: value}})).then((text) => {
		// only a "returnValue": true counts (with or without the space luna-send puts there on some firmware): a refusal, or no answer at
		// all, is an error, so a backlight the screensaver lowered is never taken as put back when it wasn't (lib/backlightSaver.ts)
		if (!/"returnValue": *true/.test(text)) throw new Error(/"returnValue": *false/.test(text) ? `the TV refused ${key}=${value}` : `no answer for ${key}=${value}`);
	});
}

export function screenOff (): Promise<void> {
	return run(luna('luna://com.webos.service.tvpower/power/turnOffScreen', {})).then(() => undefined);
}

// every tvpower reboot reason comes back in Active Standby (docs/spikes.md); the shell's reboot comes back on. Detached so the call returns.
export function reboot (): Promise<void> {
	return run('(sleep 1; reboot) >/dev/null 2>&1 &').then(() => undefined);
}

/** Seconds left on the sleep timer, 0 when none. webOS 25 denies tvReservationAgent to apps ("Denied method call"), hence root. */
export function sleepRemainSeconds (): Promise<number> {
	return run(luna('luna://com.webos.service.tvReservationAgent/timer/sleep/getRemainTime', {})).then((text) => {
		const m = JSON.parse(text) as {sleepTimeSecond?: number};
		return Number(m.sleepTimeSecond) || 0;
	});
}

/** webOS 4: LG's home bar is not an app (launching com.webos.app.home answers "notexist"). A Home key through LG's network input service
 * (what LG's phone remote uses) brings it up. Checked on the C8 (webOS 4.4.3). */
export function pressHomeKey (): Promise<void> {
	return run(luna('luna://com.webos.service.networkinput/sendSpecialKey', {key: 'HOME'})).then((text) => {
		if (text.indexOf('"returnValue":false') !== -1 || text.indexOf('"returnValue": false') !== -1) throw new Error('the TV refused the Home key');
	});
}

/** tvpower/turnOnScreenSaver is a system-only call, hence root. */
export function startScreensaver (): Promise<void> {
	return run(luna('luna://com.webos.service.tvpower/power/turnOnScreenSaver', {})).then(() => undefined);
}

/** Tells watch.sh the video wallpaper is on, so LG's screensaver is ended while Lumen is in front. */
export function setVideoFlag (on: boolean): Promise<void> {
	return run(on ? `mkdir -p ${HOMEHOOK} && touch ${HOMEHOOK}/video-wallpaper` : `rm -f ${HOMEHOOK}/video-wallpaper`).then(() => undefined);
}

/** Tells watch.sh to replace LG's screensaver with Lumen's ambient screen (your photos). */
export function setAmbientFlag (on: boolean): Promise<void> {
	return run(on ? `mkdir -p ${HOMEHOOK} && touch ${HOMEHOOK}/ambient-screensaver` : `rm -f ${HOMEHOOK}/ambient-screensaver`).then(() => undefined);
}

const AMBIENT_ON = '/tmp/lumen-ambient-on';
/** Shell: writes `text` (a fixed word) to a file in /tmp as root by rename: a link someone put at that name is replaced, never written through. */
export const tmpWrite = (file: string, text: string) => `t=$(mktemp ${file}.XXXXXX) && echo ${text} > "$t" && chmod 644 "$t" && mv -f "$t" ${file}`;
/** While the ambient screen is up, watch.sh only ends LG's screensaver (which starts again after its timer, as nothing is pressed) instead of
 *  opening Lumen again. The file names its owner ("lumen"; Lumen bar's screensaver writes "bar"), and off never removes the bar's. */
export function setAmbientShowing (on: boolean): Promise<void> {
	return run(on ? tmpWrite(AMBIENT_ON, 'lumen') : `[ "$(cat ${AMBIENT_ON} 2>/dev/null)" = bar ] || rm -f ${AMBIENT_ON}`, 4000).then(() => undefined);
}

/** With the Home watcher running, LG Home would bounce straight back to Lumen: this flag lets it open once. */
export function allowLgHome (): Promise<void> {
	return run(tmpWrite('/tmp/allow_lg_home', 'lumen'), 4000).then(() => undefined);
}

/** The only Immich paths Lumen asks for. */
const IMMICH_PATHS = [
	/^\/api\/server\/version$/,
	/^\/api\/albums$/,
	/^\/api\/search\/random$/,
	/^\/api\/memories\?for=\d{4}-\d{2}-\d{2}$/,
	/^\/api\/assets\/[0-9a-f-]{36}\/thumbnail\?size=thumbnail$/,
	/^\/api\/faces\?id=[0-9a-f-]{36}$/
];

/** One request to an Immich server, made with curl on the TV: Immich sends no CORS headers outside its dev mode, so the app's own fetch would
 *  be refused. A JSON body travels as base64. `as: 'base64'` returns the response body base64-encoded (for a thumbnail). */
export function immichRequest (base: string, key: string, path: string, opts: {body?: object; as?: 'text' | 'base64'} = {}): Promise<string> {
	if (!IMMICH_BASE.test(base) || !IMMICH_KEY.test(key) || !IMMICH_PATHS.some((re) => re.test(path))) return Promise.reject(new Error('refused: immich request'));
	const curl = `curl -sf -m 15 -H ${shellQuote('x-api-key: ' + key)} -H 'accept: application/json'`;
	const url = shellQuote(base + path);
	const command = opts.body
		? `echo ${toBase64(JSON.stringify(opts.body))} | base64 -d | ${curl} -H 'content-type: application/json' --data-binary @- ${url}`
		: `${curl} ${url}`;
	return run(opts.as === 'base64' ? `${command} | base64 | tr -d '\\n'` : command, 20000);
}

/** The ids in every stack on an Immich server, as '<primaryAssetId>' or '=<id>' lines (the stacks' own ids are among the second kind).
 *  Only the ids leave the TV, since the full answer carries every photo in every stack. Needs the API key to have stack.read. */
export function immichStackIds (base: string, key: string): Promise<string> {
	if (!IMMICH_BASE.test(base) || !IMMICH_KEY.test(key)) return Promise.reject(new Error('refused: immich request'));
	const curl = `curl -sf -m 15 -H ${shellQuote('x-api-key: ' + key)} -H 'accept: application/json'`;
	return run(`${curl} ${shellQuote(base + '/api/stacks')} | grep -oE '"(primaryAssetId|id)":"[0-9a-f-]{36}"' | sed -e 's/^"primaryAssetId":"//' -e 's/^"id":"/=/' -e 's/"$//'`, 20000);
}

/** Lumen's own install folder: the only place the app may read files from, and the only one copyFontIn writes to. */
const APP_DIR = /^\/media\/developer\/apps\/usr\/palm\/applications\/com\.ovsteenb\.lumen(\.dev)?$/;

/** Copies the SF font that tools/push_sf_font.sh put on the TV into the app's folder (each Channel update replaces the folder). True when copied. */
export function copyFontIn (appDir: string): Promise<boolean> {
	if (!APP_DIR.test(appDir)) return Promise.reject(new Error('refused: app folder'));
	// Lumen bar too, when it is installed: it can not load Lumen's copy (a webOS 4 app may not read another app's files)
	const bar = barDir(appDir);
	return run(`[ -f ${HOMEHOOK}/fonts/sf.woff2 ] && mkdir -p ${appDir}/fonts && cp ${HOMEHOOK}/fonts/sf.woff2 ${appDir}/fonts/sf.woff2 && echo ok; `
		+ `[ -f ${HOMEHOOK}/fonts/sf.woff2 ] && [ -d ${bar} ] && mkdir -p ${bar}/fonts && cp ${HOMEHOOK}/fonts/sf.woff2 ${bar}/fonts/sf.woff2; true`).then((out) => out.trim() === 'ok');
}

const INIT_D = '/var/lib/webosbrew/init.d';
/** a shell loop that runs `action` for each running copy of the watcher ($p is its /proc folder): found in /proc, as 60-homehook does, and
 *  matched on the start of the command line, so a shell whose -c text only names the watcher is not one */
function forEachWatcher (action: string): string {
	return `for p in /proc/[0-9]*; do case "$(tr '\\0' ' ' < $p/cmdline 2>/dev/null)" in "/bin/sh ${HOMEHOOK}/watch.sh"*|"sh ${HOMEHOOK}/watch.sh"*) ${action} ;; esac; done`;
}
/** kills every running copy of the watcher (found in /proc as 60-homehook does: busybox ps lists too little on some firmware; matched on the
 *  start of the command line, so this shell, whose -c text names the watcher too, is not one), then starts it through its boot hook */
const RESTART_WATCHER = `${forEachWatcher('kill ${p#/proc/} 2>/dev/null')}; sh ${INIT_D}/60-homehook`;

/** Settings > Home Screen > Home opens Lumen. On: installs tools/tv/watch.sh and its boot hook from the app's own folder (homehook/, copied in by
 *  the build), turns the takeover on (home-takeover, and wake launch back on) and (re)starts the watcher. Off: removes the takeover flags, so
 *  the watcher (still useful for the Recent row) leaves LG Home alone, also after a wake. `livetv`: Live TV coming up after an app also counts as
 *  LG Home (Lumen's Live TV is off). Resolves "installed", "updated" or "same" (the watcher already the bundled one, and running). */
export function setHomeTakeover (appDir: string, on: boolean, livetv: boolean): Promise<string> {
	if (!APP_DIR.test(appDir)) return Promise.reject(new Error('refused: app folder'));
	if (!on) return run(`rm -f ${HOMEHOOK}/home-takeover ${HOMEHOOK}/livetv-to-lumen; mkdir -p ${HOMEHOOK} && touch ${HOMEHOOK}/no-wake-launch`).then(() => 'off');
	const src = `${appDir}/homehook`;
	const flags = `mkdir -p ${HOMEHOOK} && touch ${HOMEHOOK}/home-takeover && rm -f ${HOMEHOOK}/no-wake-launch && ${livetv ? `touch ${HOMEHOOK}/livetv-to-lumen` : `rm -f ${HOMEHOOK}/livetv-to-lumen`}`;
	const running = forEachWatcher('echo run; break');
	// homehook/SHA256SUMS (made by the build, app/vite.config.ts) must match both files: a half-written or partly replaced pair is not
	// installed as root (checks.ts shaCheck: sha256sum or openssl, the same rule as the watcher's). This checks the pair is whole; it is
	// not a signature (docs/webos4.md).
	const sums = shaCheck(src, ['watch.sh', '60-homehook']);
	return run(`[ -f ${src}/watch.sh ] && [ -f ${src}/60-homehook ] || { echo missing; exit 0; }; ${sums}; ${flags}; `
		+ `if cmp -s ${src}/watch.sh ${HOMEHOOK}/watch.sh && cmp -s ${src}/60-homehook ${INIT_D}/60-homehook && [ -n "$(${running})" ]; then echo same; exit 0; fi; `
		+ `[ -f ${HOMEHOOK}/watch.sh ] && w=updated || w=installed; mkdir -p ${INIT_D} && cp ${src}/watch.sh ${HOMEHOOK}/watch.sh && cp ${src}/60-homehook ${INIT_D}/60-homehook `
		+ `&& chmod 755 ${HOMEHOOK}/watch.sh ${INIT_D}/60-homehook && { ${RESTART_WATCHER}; } >/dev/null 2>&1; echo $w`, 10000).then((out) => {
		const r = out.trim().split('\n').pop() || '';
		if (r === 'missing') throw new Error('watcher not in this build');
		if (r === 'badsum') throw new Error('the watcher in this build does not match its SHA256SUMS');
		return r;
	});
}

/** Lumen bar (com.ovsteenb.lumen.bar) sits next to Lumen in the TV's app folder. */
export const BAR_ID = 'com.ovsteenb.lumen.bar';
export const barDir = (appDir: string): string => appDir.replace(/\/[^/]+$/, '/' + BAR_ID);

/** Tells watch.sh to answer LG's home bar over an app with Lumen bar (home-bar). Prints "missing" when Lumen bar is not installed. */
export function setHomeBar (appDir: string, on: boolean): Promise<'on' | 'off' | 'missing'> {
	if (!APP_DIR.test(appDir)) return Promise.reject(new Error('refused: app folder'));
	if (!on) return run(`rm -f ${HOMEHOOK}/home-bar; echo off`).then(() => 'off');
	return run(`mkdir -p ${HOMEHOOK} && touch ${HOMEHOOK}/home-bar; [ -d ${barDir(appDir)} ] && echo on || echo missing`)
		.then((out) => (out.indexOf('missing') !== -1 ? 'missing' : 'on'));
}

export interface BarApp { id: string; title: string; color?: string; plain?: boolean; file?: string }
/** The home bar's look, so Lumen bar draws its tiles at the same size: the first row's tile size, height and gap, how many tiles it shows
 *  before it scrolls, and how much the focused tile grows. */
export interface BarStyle { size: number; height: number; gap: number; perRow: number; scale: number }
/** Part of the bar signature. 1.0.9044 hashed the list without it, so a TV on that sig rewrites. */
export const BAR_EPOCH = 2;
/** The signature stored in the bar's data/sig. `epoch` is included so a change of this constant rewrites an old bar. */
export function barSig (dock: string[], recent: string[], list: unknown, style: unknown): string {
	const text = JSON.stringify([BAR_EPOCH, dock, recent, list, style]);
	let h = 5381;
	for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
	return h.toString(36);
}
/** Fills Lumen bar's data/ folder: copies each app's icon file to data/icons/<id>.<ext> and writes data/bar.json (the dock, Lumen's recent
 *  list, the apps, Lumen's id). Skipped when data/sig already holds `sig` (an app update wipes data/, and then it is written again).
 *  data/wallpapers/ is left alone: it holds the screensaver pictures, which tools/tv/watch.sh bar_pictures copies from Lumen.
 *  The bar's folder is writable by others, so the write is syncBarShell: relative names after cd -P, a temp file then mv, and a data/
 *  or icons/ that is not root's own is refused rather than removed. */
export function syncBar (appDir: string, lumenId: string, dock: string[], recent: string[], apps: BarApp[], sig: string, style?: BarStyle): Promise<'same' | 'written' | 'missing' | 'refused'> {
	if (!APP_DIR.test(appDir) || !APP_ID.test(lumenId) || !/^[a-z0-9]+$/.test(sig)) return Promise.reject(new Error('refused'));
	const dir = barDir(appDir);
	const out: Record<string, {title: string; color?: string; plain?: boolean; icon?: string}> = {};
	const icons: {src: string; name: string; id: string}[] = [];
	const skipped: string[] = [];
	apps.forEach((a) => {
		// "." and ".." pass APP_ID but are not file names the shell will copy; a "~icon:" token for them would be left in bar.json
		if (!APP_ID.test(a.id) || a.id === '.' || a.id === '..') return;
		const entry: {title: string; color?: string; plain?: boolean; icon?: string} = {title: a.title, color: a.color, plain: a.plain};
		// png and jpeg only: the shell's magic check refuses anything else, and sending it would rewrite the bar on every start
		const ext = a.file && /\.(png|jpe?g)$/i.exec(a.file);
		const name = ext ? `${a.id}.${ext[1].toLowerCase()}` : '';
		const nameOk = !!name && name !== '.new' && /^[A-Za-z0-9._-]+$/.test(name);
		if (a.file && safeAppPath(a.file) && nameOk) {
			// the shell swaps this icon field for the copied name, or for null when the copy did not happen
			entry.icon = `~icon:${name}`;
			icons.push({src: a.file, name, id: a.id});
		} else if (a.file && safeAppPath(a.file)) skipped.push(`bar: icon skipped ${a.id} not-image`);
		else skipped.push(`bar: icon skipped ${a.id} ${a.file ? 'unsafe-path' : 'no-path'}`);
		out[a.id] = entry;
	});
	const json = JSON.stringify({v: 1, lumen: lumenId, dock: dock.filter((x) => APP_ID.test(x)), recent: recent.filter((x) => APP_ID.test(x)), apps: out, style});
	return run(syncBarShell(dir, sig, toBase64(json), icons), 15000).then((outText) => {
		const status = syncBarResult(outText);
		if (status === 'written') {
			const lines = skipped.slice();
			for (const line of outText.split('\n')) {
				const m = /^skip ([A-Za-z0-9._-]+) (copy|unresolved|toobig|not-image)$/.exec(line.trim());
				if (m) lines.push(`bar: icon skipped ${m[1]} ${m[2]}`);
			}
			if (lines.length) appendLog(lines.join('\n') + '\n').catch(() => undefined);
		}
		return status;
	});
}

/** Writes text to one of FILES. The text travels as base64, so nothing in it is ever read by the shell. */
export function writeFile (name: HomehookFile, text: string): Promise<void> {
	if (FILES.indexOf(name) === -1) return Promise.reject(new Error('unknown file ' + name));
	const b64 = toBase64(text);
	return run(`mkdir -p ${HOMEHOOK} && echo ${b64} | base64 -d > ${HOMEHOOK}/${name}.tmp && mv ${HOMEHOOK}/${name}.tmp ${HOMEHOOK}/${name}`).then(() => undefined);
}

/** The contents of one of FILES, or '' when it does not exist. */
export function readFile (name: HomehookFile): Promise<string> {
	if (FILES.indexOf(name) === -1) return Promise.reject(new Error('unknown file ' + name));
	return run(`[ -f ${HOMEHOOK}/${name} ] && base64 ${HOMEHOOK}/${name} | tr -d '\\n'; true`).then((out) => fromBase64(out.trim()));
}

/** Appends lines to the log and keeps only its last LOG_MAX_BYTES. Calls the bridge directly, without the error hook, so a failing
 *  root service cannot loop by logging its own failure to write the log. */
export function appendLog (text: string): Promise<void> {
	if (!isWebOS()) return Promise.reject(new Error('not on a TV'));
	const b64 = toBase64(text);
	const command = `mkdir -p ${HOMEHOOK} && echo ${b64} | base64 -d >> ${LOG} && if [ $(wc -c < ${LOG}) -gt ${LOG_MAX_BYTES} ]; then tail -c ${LOG_MAX_BYTES / 2} ${LOG} > ${LOG}.tmp && mv ${LOG}.tmp ${LOG}; fi`;
	return lunaCall(LUNA.homebrewExec, {command}, 6000, true).then(() => undefined);
}

function toBase64 (text: string): string {
	const b64 = btoa(unescape(encodeURIComponent(text)));
	if (!BASE64.test(b64)) throw new Error('bad base64');   // cannot happen; the check is what keeps the command safe if btoa ever changes
	return b64;
}

function fromBase64 (b64: string): string {
	if (!b64) return '';
	if (!BASE64.test(b64)) throw new Error('bad base64 from the TV');
	return decodeURIComponent(escape(atob(b64)));
}
