// System actions the web app cannot do itself. They go through the Homebrew Channel's root service (lib/root.ts).

import {isWebOS} from './luna';
import * as root from './root';
import {flagSync} from './flagSync';

/** Tells the TV-side watcher that the video wallpaper is on, so LG's screensaver is ended while Lumen is in front. */
const videoFlag = flagSync(root.setVideoFlag);
const ambientFlag = flagSync(root.setAmbientFlag);
const ambientShowing = flagSync(root.setAmbientShowing);

export function setVideoFlag (on: boolean): void {
	if (!isWebOS()) return;
	videoFlag.set(on);
}

/** Settings > Screensaver: watch.sh opens Lumen's ambient screen instead of LG's screensaver. */
export function setAmbientFlag (on: boolean): void {
	if (!isWebOS()) return;
	ambientFlag.set(on);
}

/** Writes the watcher's flags again (Lumen came back to the front). Cheap: a touch or rm each. */
export function resyncFlags (): void {
	if (!isWebOS()) return;
	videoFlag.resync();
	ambientFlag.resync();
	ambientShowing.resync();
}

/** Whether Lumen's screensaver is up (/tmp/lumen-ambient-on). A flag left set made the watcher end every screensaver of LG's while Lumen was
 *  in front, so a failed write is tried again like the other flags. */
export function setAmbientShowing (on: boolean): void {
	if (!isWebOS()) return;
	ambientShowing.set(on);
}

/** Starts the TV's screensaver now. */
export function startScreensaver (): Promise<void> {
	return root.startScreensaver();
}
