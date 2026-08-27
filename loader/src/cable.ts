// Getting it onto the talker.
//
// This is the slot the note at the foot of index.ts reserved, and it is a
// module of its own for the reason that note gives: everything else the page
// asks of the outside is one shot - ask, get a value, done - and this is a
// gesture, a granted port, an open stream, about a megabyte with progress
// worth watching, a cancel that has to be able to arrive mid-flight, and a
// close. Written as one more async function returning one more value it would
// have had to keep its progress and its cancellation somewhere else.
//
// The protocol is not here. tools/cable.js is the browser's half of the wire
// and stays where it is, because it is the half tests/test_cable_format.py
// drives against the C reader compiled out of the sketch - byte for byte, in
// both directions. A copy of it inside src/ would be a second implementation,
// and the tested one would not be the shipped one. So this file is the part
// that has a browser in it, and that file remains the part that does not.
//
// What is left for here, then, is three things the wire format has no opinion
// about: which port out of the several a laptop has, where the files come
// from, and what the page is told while it happens.
import {
  Cable, CABLE_VERSION, LAYOUT_FILE, plan, push, versionVerdict,
} from "../tools/cable.js";
import { Trouble } from "../../src/core/errors.js";

/** What is to be on the device, by the name it goes under.
 *
 * compileDevice() answers with exactly this - layout.bin, one t<hash>.bin per
 * distinct picture, one a<hash>.wav per distinct sentence. It used to come out
 * of the `data` store instead, through builtFiles(), and sendToDevice() went
 * and fetched it: the build wrote into storage, and the transport read it back
 * by name, which is the arrangement builder.py had with data/ on disk.
 *
 * There is no store on this page and nothing to fetch from, so the files are
 * an argument now. That is a smaller interface rather than a bigger one, and
 * it is what makes the transfer testable against a Map somebody wrote by hand
 * - see loader/README.md on what the e2e specs do with it. */
export type Build = Map<string, Uint8Array<ArrayBuffer>>;

// 115200 because port.open() will not run without a number and vorlaut.ino
// says Serial.begin(115200). On the S3's native USB there is no UART in the
// path to run at it, so the throughput is whatever USB and LittleFS manage.
const BAUD = 115200;

// Opening the port may reset the board - the Arduino core's CDC stack watches
// for the DTR/RTS pattern esptool uses, and what Chrome asserts on open() is
// not knowable from here. If it does reset, the first hello lands while the
// device is still booting. Asking three times costs a second on a device that
// is not there and saves the whole session on a device that is.
const GREETINGS = 3;

/** Whether this browser can talk to a cable at all. Chrome and Edge can;
 *  Firefox and Safari edit boards and cannot send them. */
export function cableSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.serial);
}

/** Ports the person has already granted, in an earlier session or this one.
 *
 * No gesture, so this may be called on load - and it has to be, because the
 * press that would ask for a port is the same press that starts a build, and
 * by the time a build is over the activation that requestPort() needs is long
 * expired. Knowing the answer before the press is what makes one press enough.
 */
export async function grantedDevices(): Promise<SerialPort[]> {
  if (!cableSupported()) return [];
  try {
    return await navigator.serial!.getPorts();
  } catch {
    // A permissions policy can refuse this outright, and a page that cannot
    // ask which ports it has is in the same position as one with none.
    return [];
  }
}

/** The port picker.
 *
 * Must be called from the click itself, before anything that can await for
 * long. Answers null when the person closed the dialog without choosing, and
 * when there was no activation to spend - a cancelled picker is not an error
 * and neither is a page whose build was started some other way.
 */
export async function askForDevice(): Promise<SerialPort | null> {
  if (!cableSupported()) return null;
  try {
    return await navigator.serial!.requestPort();
  } catch {
    return null;
  }
}

/** Told to run again when a cable is plugged in or pulled out, so that a page
 *  which was opened before the talker was does not need reloading. */
export function watchDevices(changed: () => void): void {
  if (!cableSupported()) return;
  navigator.serial!.addEventListener("connect", changed);
  navigator.serial!.addEventListener("disconnect", changed);
}

export type Plan = {
  put: number; remove: number; keep: number; needed: number; tight: boolean;
};

export type Sending = {
  /** Every line on the wire that is not protocol: the device's own serial log,
   *  which is the most useful thing there is when something has gone wrong. */
  onLog?: (line: string) => void;
  /** What is about to happen, once the diff is known and before it starts. */
  onPlan?: (what: Plan) => void;
  onStep?: (what: "put" | "rm", name: string, done: number, total: number) => void;
  signal?: AbortSignal;
};

export type Sent = {
  stored: number; removed: number; bytes: number; keep: number;
  /** The two numbers docs/cable.md keeps its table of: the longest the device
   *  sat with nothing arriving, and the longest a single write into LittleFS
   *  took. Since the device acknowledges every window, the gap is a round trip
   *  rather than a browser running late - small and non-zero on a device that
   *  is working, and zero only on one that is not acknowledging. */
  worstGap: number; worstStall: number;
};

/** Opens each granted port in turn and keeps the one that says it is a vorlaut.
 *
 * A laptop has several ports - a dongle, a printer, another dev board - and
 * nothing about a port says which is which until it has been asked. `hello` is
 * the question, and a port that does not answer it within a moment is not the
 * talker. Saying so is nicer than timing out later, mid-transfer.
 *
 * Answering with the wrong version is a third thing, and it used to be
 * indistinguishable from the second: the test here was `if (hello.version)`,
 * so any non-zero number was taken and then driven as whatever this browser
 * speaks. versionVerdict() is the comparison now. A port that answers with a
 * version this client cannot drive is remembered rather than returned, and the
 * walk goes on - somebody with two boards plugged in should still reach the one
 * that works. Only when no port is drivable does the mismatch become the
 * failure, and then it is the one reported: a device that answered is not a
 * device that did not, and telling somebody "nothing answered" when something
 * did would send them looking at the cable.
 *
 * Exported for tests/unit/cable_version.test.ts. The routing below is where a
 * mismatch turns into the words somebody reads, and that is worth holding.
 */
export async function findTalker(
  ports: SerialPort[], onLog: (line: string) => void,
) {
  let mismatch: Trouble | null = null;
  for (const port of ports) {
    let cable: InstanceType<typeof Cable> | null = null;
    try {
      await port.open({ baudRate: BAUD });
      // Raising DTR is what makes the device's own Serial report a connection.
      // The pair is never driven in sequence: that is esptool's way into the
      // bootloader, and doing it by accident would take the talker off the
      // wire mid-session.
      try {
        await port.setSignals({ dataTerminalReady: true, requestToSend: false });
      } catch {
        // Not every platform offers the signals, and none of this needs them.
      }
      cable = new Cable(port, { onLog });
      const hello = await cable.hello({ tries: GREETINGS });
      const verdict = versionVerdict(hello.version);
      if (verdict === "ok") return { port, cable, hello };
      if (verdict !== "silent") {
        // Both numbers, because the sentence names them and because which way
        // round they are is the difference between "flash the device" and
        // "reload this page". The first one found is the one reported.
        mismatch ??= new Trouble(`cable_${verdict}`,
                                 { device: hello.version, browser: CABLE_VERSION });
      }
      await cable.close();
      await port.close();
    } catch {
      // Not this one. Whatever it is, it is not answering as a talker, and the
      // next port deserves the same chance.
      if (cable) await cable.close().catch(() => {});
      await port.close().catch(() => {});
    }
  }
  throw mismatch ?? new Trouble("cable_no_device");
}

/**
 * The whole of it: find the talker, work out what it is missing, send that.
 *
 * Takes the granted ports rather than fetching them, because the caller is the
 * one that knows whether it just asked for one, and takes the build rather
 * than fetching that either - see Build above. Returns what the device said it
 * did, not what was sent, which is the same distinction the CRC on every put
 * exists for.
 *
 * The order is the protocol's, and it is the safe one: send what is missing,
 * send layout.bin, then delete what is stale. layout.bin is the commit, and
 * until it lands the device still reads the old one, which still points at
 * files that are all still there. The exception is a payload that will not fit
 * alongside what is already on the partition - then plan() says `tight` and
 * the clearing goes first, which is a worse failure mode and is reported so
 * the page can say as much before anybody presses anything.
 */
export async function sendToDevice(
  ports: SerialPort[], build: Build, options: Sending = {},
): Promise<Sent> {
  const { onLog = () => {}, onPlan = () => {}, onStep = () => {}, signal } = options;
  // plan() and push() want {bytes} per name, because the plan may also be made
  // from sizes and checksums alone. One line of shaping rather than a second
  // shape for compileDevice() to answer in.
  const made = new Map([...build].map(([name, bytes]) => [name, { bytes }]));
  const { port, cable, hello } = await findTalker(ports, onLog);
  try {
    const have = await cable.list();
    // The one file whose name never changes, so its presence proves nothing
    // and it has to be asked about. Every other name is a hash of what went
    // into it and answers the question by existing.
    const layoutCrc = have.some((f) => f.name === LAYOUT_FILE)
      ? await cable.crc(LAYOUT_FILE)
      : null;

    const work = plan(made, have, hello, layoutCrc);
    onPlan({
      put: work.put.length, remove: work.remove.length, keep: work.keep.length,
      needed: work.needed, tight: work.tight,
    });
    if (!work.fits) {
      throw new Trouble("cable_too_big", { needed: work.needed, free: hello.free });
    }

    const total = work.put.length + work.remove.length;
    const result = await push(cable, made, work, {
      signal,
      onStep: (what, name, index) => onStep(what, name, index + 1, total),
    });
    return {
      ...result, keep: work.keep.length,
      worstGap: cable.worstGap, worstStall: cable.worstStall,
    };
  } finally {
    // The cable was opened here, so it is closed here - including when the
    // push threw or was aborted. A port left open cannot be opened again, and
    // the symptom of that is a second attempt that looks like a dead device.
    await cable.close().catch(() => {});
    await port.close().catch(() => {});
  }
}
