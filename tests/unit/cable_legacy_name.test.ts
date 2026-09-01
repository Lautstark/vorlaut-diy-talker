import { check } from "./harness.js";
import { sendToDevice, type Build } from "../../loader/src/cable.js";
import { MockDevice } from "../../loader/tools/cable_mock.js";

/* The name a collection travels under, against a device that predates the idea
 * of there being more than one.
 *
 * compileDevice() writes `c<hash>.bin`, because a talker that holds several
 * collections needs a name per collection for its directory to be a list at
 * all. **A talker flashed before 2026-08-31 opens `/layout.bin` and no other
 * name.** Sent the new name it would store a file it never reads - and, because
 * a device that holds one collection is a device every transfer replaces, the
 * same session sweeps away the `layout.bin` it does read.
 *
 * That failure is the bad kind twice over: the transfer reports success, and
 * what it leaves behind is a device with five black keys that only a reflash
 * gets out of. Nothing else in the suite would have caught it, because every
 * other name in a payload is a hash of its own content and means the same thing
 * to both firmwares - the collection is the one file whose name is a decision.
 *
 * So this drives the real sendToDevice() against a mock that greets the way an
 * old device greets - `collections: 0`, which is the mock saying the keyword
 * does not exist rather than saying zero - and looks at what the device is
 * holding afterwards. The mock's own greeting is what makes it a test of the
 * rule and not of a constant: silence is the whole input.
 */

const hash = (of: string) => of.repeat(32).slice(0, 32);
function bytes(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i + seed) & 0xff;
  return out;
}

const COLLECTION = `c${hash("a")}.bin`;
const TILE = `t${hash("b")}.bin`;

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

async function sendTo(collections: number, holding: Map<string, Uint8Array>) {
  const device = new MockDevice({ collections, files: holding });
  const build: Build = new Map([
    [COLLECTION, bytes(64, 1)],
    [TILE, bytes(32, 2)],
  ]);
  await sendToDevice([asPort(device) as never], build);
  return device;
}

// --- A device from before this change ----------------------------------------

const old = await sendTo(0, new Map([["layout.bin", bytes(48, 9)]]));

check("an old device is left holding the name it reads",
      old.files.has("layout.bin"), [...old.files.keys()].join(", "));

check("and is not left holding one it never opens",
      !old.files.has(COLLECTION), [...old.files.keys()].join(", "));

/* The bytes matter as much as the name. Keeping `layout.bin` by leaving the
 * device's own stale copy alone would satisfy the check above and send nobody
 * the new collection at all. */
check("under the collection that was actually built",
      old.files.get("layout.bin")?.length === 64,
      String(old.files.get("layout.bin")?.length));

check("and the tiles keep the names their content gives them",
      old.files.has(TILE), [...old.files.keys()].join(", "));

// --- A device that says it holds several -------------------------------------

/* The other direction, so that the rule above cannot be satisfied by simply
 * always writing layout.bin - which would work here and take the collections
 * with it. */
const now = await sendTo(16, new Map());

check("a device that holds several gets the collection under its own name",
      now.files.has(COLLECTION), [...now.files.keys()].join(", "));

check("and nothing is written to the legacy name",
      !now.files.has("layout.bin"), [...now.files.keys()].join(", "));
