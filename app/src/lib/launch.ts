import {LUNA, SYSTEM_APP} from '../config/constants';
import {lunaCall} from './luna';
import {allowLgHome, pressHomeKey} from './root';

/** Launch an app or switch to an input (HDMI inputs are apps too: com.webos.app.hdmiN). */
export function launchApp (id: string, params: object = {}): Promise<void> {
	return lunaCall(LUNA.launch, {id, params}).then(() => undefined);
}

/** Bring up LG's own home screen. */
export function launchLgHome (): Promise<void> {
	// with the Home-button watcher installed, LG Home would bounce straight back here: the flag file lets it open (see tools/tv/watch.sh)
	return allowLgHome()
		.catch(() => undefined)
		// webOS 4 has no com.webos.app.home app ("notexist"): the home bar comes up with a Home key instead
		.then(() => launchApp(SYSTEM_APP.lgHome).catch(() => pressHomeKey()));
}

/** Whether an app with this ID exists on the TV (permitted from a web app, unlike listing). */
export function appExists (id: string): Promise<boolean> {
	return lunaCall<{exist?: boolean}>(LUNA.appLoadStatus, {appId: id})
		.then((r) => r.exist === true)
		.catch(() => false);
}
