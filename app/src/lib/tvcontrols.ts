// Control Center: what the TV lets a normal web app do (volume, mute) and what needs the Homebrew Channel's root service
// (picture mode, backlight, Eye Comfort, screen off, restart), through lib/root.ts. Off the TV (the dev preview) the values are kept in memory.

import {isWebOS, lunaCall} from './luna';
import * as root from './root';
import {readCache, writeCache} from './boot';

const AUDIO = 'luna://com.webos.audio/';

// Picture and sound modes as the OLED C8 (2018, webOS 4) has them. The keys are the settings service's own (bscpylgtv
// docs/available_settings_C8.md, read from a C8 on webOS 4.4.3); the menus, their order and names are LG's 2018 ones (owners' threads on
// AVS Forum and AVForums, the HiFiReport and AREA DVD reviews). The picture menu depends on what is playing: SDR, HDR10/HLG, Dolby Vision
// (and Technicolor HDR), each with its own modes, so the list offered is the one the current mode belongs to. There is no FILMMAKER mode
// (2020 on). Where the TV describes the setting (getSystemSettingDesc), only the modes it marks visible are kept, and a mode the TV
// refuses is not offered again.

/** each picture menu, in LG's order */
const PICTURE_MENUS: Record<'sdr' | 'hdr' | 'dolby' | 'technicolor', string[]> = {
	sdr: ['vivid', 'normal', 'eco', 'cinema', 'sports', 'game', 'hdrEffect', 'technicolor', 'expert1', 'expert2'],
	hdr: ['hdrVivid', 'hdrStandard', 'hdrCinemaBright', 'hdrCinema', 'hdrGame', 'hdrTechnicolor'],
	dolby: ['dolbyHdrVivid', 'dolbyHdrStandard', 'dolbyHdrCinemaBright', 'dolbyHdrCinema', 'dolbyHdrGame'],
	technicolor: ['technicolorHdrVivid', 'technicolorHdrStandard', 'technicolorHdrCinemaBright', 'technicolorHdrCinema', 'technicolorHdrGame', 'technicolorHdrTechnicolor']
};
/** the SDR menu: what the dev preview offers */
export const PICTURE_MODES = PICTURE_MENUS.sdr;
export const PICTURE_LABEL: Record<string, string> = {
	vivid: 'Vivid', normal: 'Standard', eco: 'Eco', cinema: 'Cinema', sports: 'Sports', game: 'Game', hdrEffect: 'HDR Effect', technicolor: 'Technicolor Expert',
	expert1: 'ISF Expert (Bright Room)', expert2: 'ISF Expert (Dark Room)', photo: 'Photo', filmMaker: 'FILMMAKER',
	hdrVivid: 'Vivid', hdrStandard: 'Standard', hdrCinemaBright: 'Cinema Home', hdrCinema: 'Cinema', hdrGame: 'Game', hdrTechnicolor: 'Technicolor Expert',
	dolbyHdrVivid: 'Vivid', dolbyHdrStandard: 'Standard', dolbyHdrCinemaBright: 'Cinema Home', dolbyHdrCinema: 'Cinema', dolbyHdrGame: 'Game',
	technicolorHdrVivid: 'Vivid', technicolorHdrStandard: 'Standard', technicolorHdrCinemaBright: 'Cinema Home', technicolorHdrCinema: 'Cinema',
	technicolorHdrGame: 'Game', technicolorHdrTechnicolor: 'Technicolor Expert'
};
/** what the current mode says is playing: its menu, and the word shown with it */
function pictureMenu (mode: string): {menu: string[]; range: string} {
	if (/^dolbyHdr|^dolbyStandard/.test(mode)) return {menu: PICTURE_MENUS.dolby, range: 'Dolby Vision'};
	if (/^technicolorHdr/.test(mode)) return {menu: PICTURE_MENUS.technicolor, range: 'HDR'};
	if (/^hdr/.test(mode) && mode !== 'hdrEffect') return {menu: PICTURE_MENUS.hdr, range: 'HDR'};
	return {menu: PICTURE_MENUS.sdr, range: ''};
}
/** "HDR" or "Dolby Vision" while such a picture is playing (its own menu is shown), else '' */
export const pictureRange = (mode: string): string => pictureMenu(mode).range;

/** Settings > Sound > Sound Mode on a 2018 UK set (the settings service also lists Brazil's pagode, sertaWego and brazilianPunk) */
export const SOUND_MODES = ['standard', 'news', 'music', 'movie', 'sports', 'game'];
export const SOUND_LABEL: Record<string, string> = {standard: 'Standard', news: 'Clear Voice', movie: 'Cinema', music: 'Music', sports: 'Sports', game: 'Game', aiSound: 'AI Sound', aiSoundPlus: 'AI Sound Pro', custom: 'Custom'};
/** the outputs the TV's sound modes work on: its own speakers (a sound mode is greyed out in LG's menu for HDMI ARC, optical, Bluetooth...) */
const SPEAKER_OUTPUTS = ['tv_speaker', 'tv_speaker_headphone', 'tv_external_speaker'];
export const OUTPUT_LABEL: Record<string, string> = {
	tv_speaker: 'TV speaker', tv_external_speaker: 'TV speaker', tv_speaker_headphone: 'TV speaker', external_arc: 'HDMI ARC', external_optical: 'Optical',
	bt_soundbar: 'Bluetooth', bt_audio: 'Bluetooth', lineout: 'Line out', headphone: 'Headphones', tv_speakerbar: 'Sound bar', builtin_soundbar: 'Sound bar',
	tv_speakerbar_headphone: 'Sound bar'
};
/** true when the TV's sound modes apply to this output ('' = unknown: assume the speakers) */
export const soundModesApply = (output: string): boolean => !output || SPEAKER_OUTPUTS.indexOf(output) !== -1;

/** modes the TV refused (setSystemSettings returnValue false), kept so they are not offered again */
const REFUSED_KEY = 'lumen-refused-modes-v1';
function refused (): string[] { const r = readCache<string[]>(REFUSED_KEY); return Array.isArray(r) ? r : []; }
function refuse (mode: string): void { const r = refused(); if (r.indexOf(mode) === -1) writeCache(REFUSED_KEY, r.concat(mode)); }

/** what the TV describes, read once a session (null: no description) */
let described: Promise<{picture: root.SettingDesc | null; sound: root.SettingDesc | null}> | null = null;
function describe (): Promise<{picture: root.SettingDesc | null; sound: root.SettingDesc | null}> {
	if (!described) {
		described = Promise.all([root.getSettingValues('pictureMode').catch(() => null), root.getSettingValues('soundMode').catch(() => null)])
			.then(([picture, sound]) => ({picture, sound}));
	}
	return described;
}
/** a menu less what the TV hides or refused, the current value always kept */
function offer (menu: string[], visible: string[] | null, current: string): string[] {
	const no = refused();
	const kept = menu.filter((m) => (m === current) || ((!visible || !visible.length || visible.indexOf(m) !== -1) && no.indexOf(m) === -1));
	return kept.length ? kept : menu;
}

export interface Controls {
	volume: number;
	muted: boolean;
	picture: string;
	sound: string;
	/** where the sound goes (soundOutput: tv_speaker, external_arc, ...); '' unknown */
	soundOutput: string;
	/** the picture modes to offer now: the menu of what is playing (SDR, HDR, Dolby Vision) */
	pictureModes: string[];
	/** the sound modes to offer; empty when the sound goes to something else than the TV's speakers */
	soundModes: string[];
	/** why soundModes is empty: 'output' (not the TV's speakers), 'tv' (the TV greys sound mode out), '' (not empty) */
	soundModeOff: '' | 'output' | 'tv';
	/** 0-100, for the picture mode in use */
	backlight: number;
	eyeComfort: boolean;
}

const mock: Controls = {volume: 18, muted: false, picture: 'normal', sound: 'standard', soundOutput: 'tv_speaker', pictureModes: PICTURE_MODES, soundModes: SOUND_MODES, soundModeOff: '', backlight: 100, eyeComfort: false};

export function readControls (): Promise<Controls> {
	if (!isWebOS()) return Promise.resolve({...mock});
	const out: Controls = {volume: 0, muted: false, picture: 'normal', sound: 'standard', soundOutput: '', pictureModes: PICTURE_MODES, soundModes: SOUND_MODES, soundModeOff: '', backlight: 100, eyeComfort: false};
	const audio = lunaCall<{volume?: number; muteStatus?: boolean}>(AUDIO + 'getVolume', {}).then((r) => {
		out.volume = Number(r.volume) || 0;
		out.muted = r.muteStatus === true;
	}).catch(() => undefined);
	const picture = root.getSetting('pictureMode').then((v) => { if (v) out.picture = v; }).catch(() => undefined);
	const sound = root.getSetting('soundMode').then((v) => { if (v) out.sound = v; }).catch(() => undefined);
	const output = root.getSetting('soundOutput').then((v) => { out.soundOutput = v; }).catch(() => undefined);
	const backlight = readBacklight().then((v) => { if (v !== null) out.backlight = v; });
	const eye = root.getSetting('eyeComfortMode').then((v) => { out.eyeComfort = v === 'on'; }).catch(() => undefined);
	return Promise.all([audio, picture, sound, output, backlight, eye, describe()]).then((all) => {
		const desc = all[6];
		// SDR: what the TV marks visible (photo stays out). HDR and Dolby Vision: the C8 marks those modes visible:false all the time, so only
		// "active" counts there
		const menu = pictureMenu(out.picture);
		const pd = desc.picture;
		out.pictureModes = offer(menu.menu, pd ? (menu.range === '' ? pd.visible : pd.values) : null, out.picture);
		const sd = desc.sound;
		out.soundModeOff = !soundModesApply(out.soundOutput) ? 'output' : (sd && !sd.uiActive ? 'tv' : '');
		out.soundModes = out.soundModeOff ? [] : offer(SOUND_MODES, sd ? sd.visible : null, out.sound);
		return out;
	});
}

/** The backlight of the picture mode in use, or null when it can't be read. Read again after a picture mode change: each mode has its own. */
export function readBacklight (): Promise<number | null> {
	if (!isWebOS()) return Promise.resolve(mock.backlight);
	return root.getSetting('backlight').then((v) => {
		const n = Number(v);
		return v !== '' && Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
	}).catch(() => null);
}

export function setVolume (volume: number): Promise<void> {
	mock.volume = volume;
	if (!isWebOS()) return Promise.resolve();
	return lunaCall(AUDIO + 'setVolume', {volume}).then(() => undefined);
}

export function setMuted (muted: boolean): Promise<void> {
	mock.muted = muted;
	if (!isWebOS()) return Promise.resolve();
	return lunaCall(AUDIO + 'setMuted', {muted}).then(() => undefined);
}

/** Only the TV's known mode names are ever put into the root command. */
export function setPictureMode (mode: string): Promise<void> {
	mock.picture = mode;
	if (!isWebOS()) return Promise.resolve();
	if (!PICTURE_LABEL[mode]) return Promise.reject(new Error('unknown picture mode'));
	return root.setSetting('pictureMode', mode).catch((e: Error) => { if (/refused/.test(e.message) && !/^refused:/.test(e.message)) refuse(mode); throw e; });
}

/** Only the TV's known sound mode names are ever put into the root command. */
export function setSoundMode (mode: string): Promise<void> {
	mock.sound = mode;
	if (!isWebOS()) return Promise.resolve();
	if (SOUND_MODES.indexOf(mode) === -1) return Promise.reject(new Error('unknown sound mode'));
	return root.setSetting('soundMode', mode).catch((e: Error) => { if (/refused/.test(e.message) && !/^refused:/.test(e.message)) refuse(mode); throw e; });
}

/** 0-100, whole numbers only. */
export function setBacklight (level: number): Promise<void> {
	mock.backlight = level;
	if (!isWebOS()) return Promise.resolve();
	if (!Number.isInteger(level) || level < 0 || level > 100) return Promise.reject(new Error('bad backlight level'));
	return root.setSetting('backlight', String(level));
}

/** The backlight before the screensaver lowered it, kept until it is put back, so a launch after a crash can still put it back. */
const SAVED_BACKLIGHT_KEY = 'lumen-screensaver-backlight-v1';
let dimmedHere = false;

/** Lowers the backlight to `level` for the screensaver (never raises it), keeping the old value to put back. */
export function dimForScreensaver (level: number, stillWanted: () => boolean): void {
	readBacklight().then((before) => {
		if (before === null || before <= level || !stillWanted()) return;
		if (readCache<number>(SAVED_BACKLIGHT_KEY) === null) writeCache(SAVED_BACKLIGHT_KEY, before);
		dimmedHere = true;
		return setBacklight(level);
	}).catch(() => undefined);
}

/** Puts back the backlight the screensaver lowered, if it did. Safe to call at any time. */
export function restoreBacklight (): void {
	const before = readCache<number>(SAVED_BACKLIGHT_KEY);
	if (before === null) return;
	setBacklight(before).then(() => { writeCache(SAVED_BACKLIGHT_KEY, null); dimmedHere = false; }).catch(() => undefined);
}

/** At start-up: a backlight left low by a screensaver that never ended (Lumen closed or crashed) is put back, unless this launch dimmed it. */
export function restoreLeftoverBacklight (): void {
	if (!dimmedHere) restoreBacklight();
}

export function setEyeComfort (on: boolean): Promise<void> {
	mock.eyeComfort = on;
	if (!isWebOS()) return Promise.resolve();
	return root.setSetting('eyeComfortMode', on ? 'on' : 'off');
}

/** Screen off, the TV keeps running (a press on the remote wakes it). */
export function screenOff (): Promise<void> {
	if (!isWebOS()) return Promise.reject(new Error('not on a TV'));
	return root.screenOff();
}

export function restartTv (): Promise<void> {
	if (!isWebOS()) return Promise.reject(new Error('not on a TV'));
	return root.reboot();
}
