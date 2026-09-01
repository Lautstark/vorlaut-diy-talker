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
import { forDevice } from "./tile_encode.js";
import {
  Cable, CABLE_VERSION, isCollection, LAYOUT_FILE, plan, planRemoval, push,
  versionVerdict,
} from "../tools/cable.js";
import { readLayoutBin } from "./layout_format.js";
import { Trouble } from "./errors.js";

/** What is to be on the device, by the name it goes under.
 *
 * compileDevice() answers with exactly this - one c<hash>.bin for the
 * collection, one t<hash>.bin per distinct picture, one a<hash>.wav per
 * distinct sentence. It used to come out
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
  /** What the collection comes to altogether, and how much of that the device
   *  already holds. `needed` is the difference, and it is the only one of the
   *  three that crosses the cable - see plan() in loader/tools/cable.js. */
  total: number; already: number;
  /** What the partition has left once this has landed. */
  freeAfter: number;
  /** How many collections the device would then hold, and how many it says it
   *  can. */
  collections: number; room: number;
};

/** Which talker answered, in the two words it says about itself.
 *
 * `version` is the protocol and `firmware` is the build, and they are two
 * facts rather than one seen twice: the protocol stands still for releases at
 * a time, so a page that asked it "which firmware is this" would get the same
 * answer from every device for a year. See firmware/vorlaut/version.h.
 *
 * `firmware` is empty when the device did not say - a talker flashed before
 * 2026-08-28 has no such line - and that is a state to be named rather than
 * an error. It is the word the device said, unparsed: a release says its tag
 * and a sketch off somebody's desk says "dev", and nothing here has a second
 * version to hold either against. The comparison arrives with whoever ships
 * an image to compare with.
 */
export type Talker = {
  version: number; firmware: string;
  /** How many collections this device holds. One where it did not say, which
   *  is every talker flashed before 2026-08-31 and is what those really hold -
   *  see the note on the keyword in loader/tools/cable.js. */
  collections: number;
};

export type Sending = {
  /** Every line on the wire that is not protocol: the device's own serial log,
   *  which is the most useful thing there is when something has gone wrong. */
  onLog?: (line: string) => void;
  /** Who answered, as soon as one does - before the diff and before anything
   *  is sent. Early on purpose: which device this is belongs in the log above
   *  the failure rather than in a summary that a failed transfer never
   *  reaches. */
  onFound?: (who: Talker) => void;
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
 * Who is there, and nothing else.
 *
 * A session that opens, greets and closes. Everything else on this page asks
 * about a device on the way to sending it something; this asks because
 * somebody pressed a button that only wants the answer - which firmware is on
 * the talker, before there is any package to send it. adr/0017 is why that
 * button exists.
 *
 * Not free at the device, and worth knowing rather than hiding: `cable.h`
 * calls `progress("hello")`, so the talker stops what it is doing and draws
 * something. That is fine for a press somebody made on purpose and would not
 * be fine on a timer, which is why there is no timer.
 *
 * Throws the same Trouble as a transfer would when nothing answers, because it
 * is the same fact and deserves the same sentence - with one difference in
 * what the caller does with it: here, "nothing answered" is also what a device
 * with no firmware at all looks like.
 */
export async function askTalker(
  ports: SerialPort[], onLog: (line: string) => void = () => {},
): Promise<Talker & { port: SerialPort }> {
  const { port, cable, hello } = await findTalker(ports, onLog);
  try {
    // The port comes back with the answer, and that is not bookkeeping: it is
    // the one port on this machine known to have a talker on it, and the
    // firmware section needs it later to reboot that talker into its
    // bootloader without anybody opening the case. See flash.ts.
    return { version: hello.version, firmware: hello.firmware,
             collections: hello.collections, port };
  } finally {
    await cable.close().catch(() => {});
    await port.close().catch(() => {});
  }
}

/** The collection file inside a payload. There is exactly one - compileDevice()
 *  writes it and says which - and this is how a caller that was handed only the
 *  map finds it again. */
const collectionIn = (files: Build | Map<string, { bytes: Uint8Array }>) =>
  [...files.keys()].find((name) => isCollection(name)) ?? "";

/**
 * The payload under the names this particular talker actually reads.
 *
 * A collection travels as `c<hash>.bin`, because a device that holds several
 * needs a name per collection for there to be a list at all. **A talker
 * flashed before 2026-08-31 holds exactly one, under `layout.bin`, and opens
 * no other name.** Sending it the new name would store a file it never reads
 * and - because one collection means a transfer is a replacement - sweep away
 * the `layout.bin` it does read. The device would come back with five black
 * keys from a transfer that reported success, and the only way out would be a
 * reflash.
 *
 * So the collection goes under the old name where the device is an old one.
 * It says which it is in its greeting, and silence means one.
 *
 * This is the same decision the tiles make, in the same place and for the same
 * reason: here is the first place that knows who is listening. The compile
 * stays device-independent because it also feeds the preview and the folder
 * export, and neither of those has a talker to ask.
 */
function underDeviceNames(made: Map<string, { bytes: Uint8Array }>,
                          holds: number): Map<string, { bytes: Uint8Array }> {
  if (holds > 1) return made;
  const named = collectionIn(made);
  if (!named || named === LAYOUT_FILE) return made;
  return new Map([...made].map(
    ([name, file]) => [name === named ? LAYOUT_FILE : name, file]));
}

/**
 * The diff, and the sentence about it.
 *
 * Split out of sendToDevice() because it is also what the page asks for on its
 * own: **what a transfer would cost, said before anybody presses Send.** The
 * numbers cannot be known without talking to the device - which files it
 * already has is the whole of the answer - and they are not free at the device
 * either, so this happens on a press and never on a timer.
 */
async function worked(cable: InstanceType<typeof Cable>,
                      made: Map<string, { bytes: Uint8Array }>,
                      have: { name: string; size: number }[],
                      hello: { free: number; collections: number }) {
  // The one name in the payload whose content its name does not promise, so
  // its presence proves nothing and it has to be asked about. Every other name
  // is a hash of what went into the file and answers the question by existing.
  const collection = collectionIn(made);
  const already = have.some((f) => f.name === collection)
    ? await cable.crc(collection)
    : null;
  const work = plan(made, have, hello, already);
  return {
    ...work,
    said: {
      put: work.put.length, remove: work.remove.length,
      keep: work.keep.length, needed: work.needed, tight: work.tight,
      total: work.total, already: work.already,
      freeAfter: Math.max(0, hello.free - work.needed),
      collections: work.collections, room: work.room,
    } as Plan,
  };
}

/** What is about to be sent, in one session that sends nothing.
 *
 * Opens, greets, lists, works the diff out, closes. The press behind it is
 * somebody asking what a transfer would cost before committing to one, which
 * on an additive device is the difference between "this is a tile" and "this is
 * most of a game". */
export async function costOnDevice(
  ports: SerialPort[], build: Build, onLog: (line: string) => void = () => {},
): Promise<Plan & { firmware: string }> {
  const { port, cable, hello } = await findTalker(ports, onLog);
  try {
    const made = underDeviceNames(
      new Map([...forDevice(build, hello.tiles)].map(
        ([name, bytes]) => [name, { bytes }])), hello.collections);
    const have = await cable.list();
    const work = await worked(cable, made, have, hello);
    await cable.done();
    return { ...work.said, firmware: hello.firmware };
  } finally {
    await cable.close().catch(() => {});
    await port.close().catch(() => {});
  }
}

/** One collection on a device, as this page can speak about it. */
export type OnDevice = {
  /** The file it lies under, which is what a removal names. */
  file: string;
  /** Its first set's name, which is what the device's own menu shows - see
   *  collectionHeadName() in firmware/vorlaut/collections.h. Empty where this
   *  page could not read the file. */
  name: string;
  sets: number;
  /** The bytes of it and of everything it names. Not what removing it would
   *  free - a picture two collections share is counted for both. */
  size: number;
  /** What removing it really frees: itself, plus everything no other
   *  collection names. */
  frees: number;
  /** True where this page could not read the file at all. Such a collection is
   *  listed and cannot be removed, because sweeping on behalf of a collection
   *  whose contents are unknown would take another one's files with it. */
  unreadable: boolean;
};

/**
 * What the talker is holding, collection by collection.
 *
 * One session: greet, list, and read back every file whose name is a
 * collection's. They are a few kilobytes each, and reading them is what lets
 * the deciding stay on this side of the cable - see `get` in
 * loader/tools/cable.js.
 *
 * Only asked of a device that says it holds more than one. A talker flashed
 * before 2026-08-31 has one collection under one name and does not have the
 * verb; there is nothing to list and nothing to subtract.
 */
export async function readCollections(
  ports: SerialPort[], onLog: (line: string) => void = () => {},
): Promise<{ talker: Talker; free: number; total: number; on: OnDevice[] }> {
  const { port, cable, hello } = await findTalker(ports, onLog);
  try {
    const have = await cable.list();
    const sizes = new Map(have.map((f) => [f.name, f.size]));
    const files = have.filter((f) => isCollection(f.name)).map((f) => f.name);

    // Only where the device says it holds more than one. A talker flashed
    // before 2026-08-31 says nothing, which means one - and it has no `get` to
    // ask with either, because the verb and the capability arrived in the same
    // firmware. There is also nothing to work out: one collection names
    // everything on the partition, so removing it is removing all of it.
    const canRead = hello.collections > 1;
    const read = new Map<string, ReturnType<typeof readLayoutBin>>();
    if (canRead) {
      for (const file of files) read.set(file, readLayoutBin(await cable.get(file)));
    }
    await cable.done();

    const on = files.map((file) => {
      const layout = read.get(file);
      // Everything every OTHER collection names, plus every other collection
      // file. What is left over is what this one would take with it.
      const keeping = new Set<string>();
      for (const [other, theirs] of read) {
        if (other === file) continue;
        keeping.add(other);
        if (theirs) for (const named of theirs.files) keeping.add(named);
        // A collection this page cannot read contributes nothing, which is why
        // `unreadable` below stops a removal rather than merely annotating it.
      }
      const { frees } = planRemoval(have, file, keeping);
      const size = layout
        ? (sizes.get(file) ?? 0)
          + [...layout.files].reduce((sum, n) => sum + (sizes.get(n) ?? 0), 0)
        // Nothing was read, so nothing is known about what this names. On a
        // one-collection device that is every byte on the partition, which is
        // also what removing it frees.
        : frees;
      return {
        file, name: layout?.name ?? "", sets: layout?.sets ?? 0, size, frees,
        unreadable: canRead && !layout,
      };
    });
    return {
      talker: { version: hello.version, firmware: hello.firmware,
                collections: hello.collections },
      free: hello.free, total: hello.total, on,
    };
  } finally {
    await cable.close().catch(() => {});
    await port.close().catch(() => {});
  }
}

/**
 * One collection off the device, and everything nothing else needs with it.
 *
 * The list is read again inside this session rather than being carried over
 * from readCollections(), and that is not belt and braces: the two are separate
 * sessions with a person's decision between them, and what a removal must never
 * do is subtract against a picture of the device that is minutes old. A
 * collection sent in between would have its files swept out from under it.
 */
export async function removeCollection(
  ports: SerialPort[], file: string, options: Sending = {},
): Promise<{ removed: number; freed: number }> {
  const { onLog = () => {}, onStep = () => {}, signal } = options;
  const { port, cable } = await findTalker(ports, onLog);
  try {
    const have = await cable.list();
    if (!have.some((f) => f.name === file)) {
      // Already gone - somebody removed it in another session, or the device
      // was reflashed. Not a failure: it is in the state that was asked for.
      await cable.done();
      return { removed: 0, freed: 0 };
    }
    const keeping = new Set<string>();
    for (const other of have.filter((f) => isCollection(f.name))) {
      if (other.name === file) continue;
      keeping.add(other.name);
      const theirs = readLayoutBin(await cable.get(other.name));
      if (!theirs) {
        // Refused rather than guessed at. A collection this page cannot read
        // names files it cannot enumerate, and sweeping anyway would take them.
        throw new Trouble("cable_unreadable_collection", { name: other.name });
      }
      for (const named of theirs.files) keeping.add(named);
    }
    const { remove, frees } = planRemoval(have, file, keeping);
    let step = 0;
    for (const name of remove) {
      signal?.throwIfAborted();
      onStep("rm", name, ++step, remove.length);
      await cable.rm(name).catch((error) => {
        // A file that is not there is already in the state we wanted it in -
        // the same forgiveness push()'s sweep has, and for the same reason.
        if (!(error instanceof Error && /missing/.test(error.message))) throw error;
      });
    }
    // "done" is what makes the device read its collections in again, so it is
    // what makes the menu stop offering the one that has gone.
    await cable.done();
    return { removed: remove.length, freed: frees };
  } finally {
    await cable.close().catch(() => {});
    await port.close().catch(() => {});
  }
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
 * send the collection, then delete what is stale. The collection file is the
 * commit, and until it lands the device still reads the old one, which still
 * points at files that are all still there. The exception is a payload that
 * will not fit alongside what is already on the partition - then plan() says
 * `tight` and the clearing goes first, which is a worse failure mode and is
 * reported so the page can say as much before anybody presses anything.
 *
 * **On a device that holds several collections there is no deleting at all.**
 * A transfer adds, and what it does not name belongs to the other collections
 * rather than being stale - plan() is where that is argued. Removing one is a
 * separate press with a subtraction of its own, and removeCollection() above is
 * it.
 */
export async function sendToDevice(
  ports: SerialPort[], build: Build, options: Sending = {},
): Promise<Sent> {
  const {
    onLog = () => {}, onFound = () => {}, onPlan = () => {}, onStep = () => {},
    signal,
  } = options;
  const { port, cable, hello } = await findTalker(ports, onLog);
  // plan() and push() want {bytes} per name, because the plan may also be made
  // from sizes and checksums alone. One line of shaping rather than a second
  // shape for compileDevice() to answer in.
  //
  // The tiles are compressed here and nowhere earlier, because here is the
  // first place that knows who is listening: the device says in its hello
  // which forms it can draw, and one that says nothing gets exactly the raw
  // bytes it got yesterday. The compile stays raw for the same reason - it
  // also feeds the preview and the folder export, and neither of those has a
  // talker to ask.
  const made = underDeviceNames(
    new Map([...forDevice(build, hello.tiles)].map(
      ([name, bytes]) => [name, { bytes }])), hello.collections);
  onFound({ version: hello.version, firmware: hello.firmware,
            collections: hello.collections });
  try {
    const have = await cable.list();
    const work = await worked(cable, made, have, hello);
    onPlan(work.said);
    if (work.full) {
      throw new Trouble("cable_too_many",
                        { on: work.collections, room: work.room });
    }
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
