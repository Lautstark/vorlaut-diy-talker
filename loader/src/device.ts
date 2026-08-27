// Which talker this page may speak to.
//
// One explicit connect the first time, and silent reconnect for ever after.
// That is what docs/cable.md concluded from the two facts about the browser,
// and it is worth restating here because the interface briefly had a different
// shape and the difference is not cosmetic.
//
// requestPort() needs transient activation and Chrome expires it in about five
// seconds; a build with speech in it takes longer. So a picker opened by the
// button that builds and sends has to come *before* the build - and then
// dismissing that picker has already cost a build nobody asked for, which is
// exactly what it did. A dialog somebody closes should cost nothing.
//
// **So the picker has a button of its own, with no build waiting behind it.**
// That is the whole of the rule, and it survives the two places that button
// has lived. It used to be in the settings sheet, under Device; that panel is
// gone, and the button is the one inside release.ts's transfer sheet now - a
// step somebody is standing on, whose own click is the activation, reached
// before anything has been built. The move changed where the rule is kept, not
// what it says: whoever puts a picker back behind the press that builds will
// rediscover the same lost minutes.
//
// The press that sends never opens a dialog: it uses what getPorts() already
// grants, which needs no gesture at all. This module is what the two share.
import {
  askForDevice, cableSupported, grantedDevices, watchDevices,
} from "./cable.js";

let known: SerialPort[] = [];

/** The ports the person has granted, in an earlier session or this one. */
export const devices = (): SerialPort[] => known;
export const haveDevice = (): boolean => known.length > 0;

async function refresh(): Promise<void> {
  known = await grantedDevices();
}

/* There was an onDevices() here, and the settings panel that subscribed to it
 * is gone. Nothing reads this list except at the moment it is about to be
 * used: the transfer sheet asks haveDevice() when it draws its first step, and
 * sendToDevice() takes devices() when it runs. Neither is on screen waiting to
 * be told, so there is nothing left to announce to. */

/** Asked on load, and again whenever a cable is plugged in or pulled out - so
 *  a page opened before the talker was does not need reloading. */
export function watchForDevices(): void {
  void refresh();
  watchDevices(() => { void refresh(); });
}

/** Opens the picker. From a click, and from nothing else.
 *
 * Answers false when the dialog was dismissed, which is not a failure and
 * should not read as one: it is somebody deciding not to, and nothing at all
 * should happen. */
export async function connectDevice(): Promise<boolean> {
  if (!cableSupported()) return false;
  const got = await askForDevice();
  if (!got) return false;
  await refresh();
  // getPorts() ought to carry it now. If a browser is slow to reflect the
  // grant, keep the handle anyway rather than telling somebody who has just
  // chosen a device that there is none.
  if (!known.includes(got)) known = [got, ...known];
  return true;
}
