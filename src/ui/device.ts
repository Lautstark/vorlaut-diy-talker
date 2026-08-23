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
// So the picker has a button of its own, in the settings, where no build is
// waiting behind it. The press that sends never opens a dialog: it uses what
// getPorts() already grants, which needs no gesture at all. This module is
// what the two share.
import {
  askForDevice, cableSupported, grantedDevices, watchDevices,
} from "../backend/index.js";

let known: SerialPort[] = [];
const listeners: (() => void)[] = [];

/** The ports the person has granted, in an earlier session or this one. */
export const devices = (): SerialPort[] => known;
export const haveDevice = (): boolean => known.length > 0;

function announce(): void {
  for (const listener of listeners) listener();
}

async function refresh(): Promise<void> {
  known = await grantedDevices();
  announce();
}

/** Told when the list moves, so a panel showing it can redraw. */
export function onDevices(listener: () => void): void {
  listeners.push(listener);
}

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
  if (!known.includes(got)) {
    known = [got, ...known];
    announce();
  }
  return true;
}
