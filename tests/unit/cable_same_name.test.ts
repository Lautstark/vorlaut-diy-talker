import { check } from "./harness.js";
import {
  type Build, costOnDevice, sendToDevice, type Plan,
} from "../../loader/src/cable.js";
import {
  HEADER_BYTES, LAYOUT_MAGIC, LAYOUT_VERSION, NAME_BYTES, SET_BYTES,
  SLOTS_PER_SET,
} from "../../loader/src/layout_format.js";
import { MockDevice } from "../../loader/tools/cable_mock.js";

/* Two collections that the device's menu would show under one name.
 *
 * A collection has no name field of its own - adr/0021 decision 2 refused one
 * rather than forgot it - so its name lives at the head of the file, in the
 * first set's name slot, and the device lists it under whatever it finds
 * there. Nothing stops two files from answering with the same string, and
 * nothing breaks when they do: collectionOrder() breaks the tie on the file
 * name, so the order is stable, both stay, and each entry opens the file it
 * points at. The cost is paid by the person holding the talker, who sees two
 * identical lines and has no way to tell which is which.
 *
 * The names here are read out of the FILES, which is why these fixtures are
 * layouts rather than packages: what lands in that slot is the Sammlung's name
 * where the package carries one and the first set's where it does not, and the
 * check must not have to know which.
 *
 * The remedy is upstream and free - a different name in the editor - which is
 * why this is a sentence said before a transfer rather than a refusal of one,
 * and why the moment it is said matters as much as the words: after the
 * transfer the file is on the device and the cheap fix has become a re-export
 * and a second transfer.
 *
 * So what is held here is the condition, not the wording. Four things have to
 * be true of it, and three of them are the ways an over-eager version of this
 * check would be wrong: a collection replacing ITSELF is not a clash, a device
 * that holds one collection has nothing to clash with, and a collection this
 * page cannot read must not be guessed about.
 */

const hash = (of: string) => of.repeat(32).slice(0, 32);
const collection = (of: string) => `c${hash(of)}.bin`;

function bytes(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i + seed) & 0xff;
  return out;
}

/** One set, no keys, and a name in it - which is all readLayoutBin() needs to
 *  answer the only question this file asks. Written from the constants rather
 *  than as a literal, so a layout that grows a field moves this with it. */
function layoutNamed(name: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(HEADER_BYTES + SET_BYTES);
  for (let i = 0; i < LAYOUT_MAGIC.length; i++) out[i] = LAYOUT_MAGIC.charCodeAt(i);
  out[4] = LAYOUT_VERSION;
  out[5] = 1;
  out[6] = SLOTS_PER_SET;
  const said = new TextEncoder().encode(name);
  out.set(said.subarray(0, NAME_BYTES - 1), HEADER_BYTES);
  return out;
}

const OURS = collection("a");
const THEIRS = collection("b");
const TILE = `t${hash("c")}.bin`;

/** The mock, wearing the two methods a SerialPort has and Cable does not use. */
function asPort(device: InstanceType<typeof MockDevice>) {
  const wire = device.open();
  return {
    readable: wire.readable,
    writable: wire.writable,
    async open() {},
    async close() {},
    async setSignals() {},
  };
}

/** What the page would say about sending `named` to a device already holding
 *  `holding`, in the one field of the plan this file is about. */
async function sending(
  named: string, holding: Map<string, Uint8Array>, collections = 16,
): Promise<string> {
  const device = new MockDevice({ collections, files: holding });
  const build: Build = new Map([
    [OURS, layoutNamed(named)],
    [TILE, bytes(32, 2)],
  ]);
  const work = await costOnDevice([asPort(device) as never], build);
  return work.sameName;
}

// --- The case this exists for ------------------------------------------------

const clashed = await sending("Runde 1", new Map([
  [THEIRS, layoutNamed("Runde 1")],
]));
check("a second collection under a name the device already shows is named",
      clashed === "Runde 1", clashed);

check("and it is the only collection asked about that decides it",
      await sending("Runde 1", new Map([
        [collection("d"), layoutNamed("Plauderbuch")],
        [THEIRS, layoutNamed("Runde 1")],
      ])) === "Runde 1");

// --- The three ways of being wrong about it ----------------------------------

/* A collection sent twice lands on the same file both times - the hash is of
 * the Sammlung's own id, not of the bytes - so a name matching itself is a
 * replacement. Warning there would fire on the ordinary case: every second
 * transfer of the same game. */
const again = await sending("Runde 1", new Map([[OURS, layoutNamed("Runde 1")]]));
check("a collection replacing itself is not a clash", again === "", again);

check("and a device holding a differently named collection is not one either",
      await sending("Runde 1", new Map([
        [THEIRS, layoutNamed("Schattenspiel")],
      ])) === "");

/* A talker flashed before 2026-08-31 says nothing about collections, which
 * means one, and one means every transfer is a replacement: what is on it now
 * is going, so there is no second entry for a menu to show. It also has no
 * `get` to be asked with - the verb and the capability arrived together - so a
 * check that ran here would be asking an old device a word it does not know. */
check("a device that holds one collection has nothing to collide with",
      await sending("Runde 1", new Map([["layout.bin", layoutNamed("Runde 1")]]),
                    0) === "");

/* A collection from another version of the format says nothing about what it
 * is called. The listing leaves such a file alone rather than guessing at it,
 * and so does this: a warning assembled out of a file this page cannot read
 * would be an invention. */
check("a collection this page cannot read is passed over, not guessed at",
      await sending("Runde 1", new Map([[THEIRS, bytes(64, 7)]])) === "");

/* And an unnamed first set is a different complaint. Two blank lines in a menu
 * are worth saying something about, but not this sentence - which asks
 * somebody to rename a board to something other than what it is already not
 * called. */
check("two collections with no name are not told to rename anything",
      await sending("", new Map([[THEIRS, layoutNamed("")]])) === "");

// --- Said before the transfer, and not after ---------------------------------

/* The whole point of the sentence is where it lands. onPlan fires after the
 * diff and before push(), so what this holds is that the page has the words in
 * hand while the Send button is still the thing that has not been pressed - not
 * merely that costOnDevice() can work it out on a press of its own. */
const device = new MockDevice({
  collections: 16, files: new Map([[THEIRS, layoutNamed("Runde 1")]]),
});
let planned: Plan | null = null;
/* Files that crossed while the plan was still unknown. Zero is the assertion:
 * a sentence said after the bytes have landed is a sentence about something
 * that can no longer be decided. */
let tooLate = 0;
await sendToDevice([asPort(device) as never], new Map([
  [OURS, layoutNamed("Runde 1")],
  [TILE, bytes(32, 2)],
]), {
  onPlan: (work) => { planned = work; },
  onStep: () => { if (!planned) tooLate++; },
});
const said = planned as Plan | null;

check("the transfer carries the same sentence into its plan",
      said?.sameName === "Runde 1", String(said?.sameName));

check("and has it before the first file goes across", tooLate === 0,
      `${tooLate} across first`);

check("which does not stop the transfer - it is a sentence, not a refusal",
      device.files.has(OURS), [...device.files.keys()].join(", "));
