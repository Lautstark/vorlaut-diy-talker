import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readPackageFile } from "../../loader/src/read.js";
import { compileDevice, type DeviceHost } from "../../loader/src/compile.js";
import { readDevicePackage, type ReadDevicePackage }
  from "../../loader/src/device_package.js";
import { HASH_BYTES, HEADER_BYTES, NAME_BYTES }
  from "../../loader/src/layout_format.js";

/* Which collection a package IS, and what a talker calls it.
 *
 * These are two questions the device asks of every file it holds and neither
 * was answerable until 2026-09-01. adr/0021 gave the talker several
 * collections; what it could not give it was a way to tell them apart, because
 * the export dropped both answers on the floor:
 *
 *  - **The id.** compileDevice() names a collection `c<hash>.bin` after what
 *    identifies it, and identity was read off the root board. The editor calls
 *    every root board `set-1` - boardId() there is `set-${at + 1}` - so every
 *    Sammlung hashed to the same file name, and a second game sent to a talker
 *    replaced the first instead of joining it. That is the exact failure
 *    adr/0021 exists to prevent, arriving through the one door it did not
 *    look at.
 *  - **The name.** The device lists a collection by the name at the head of
 *    the file. The Sammlung's name never entered the file at all - it survived
 *    as the download's filename - so what stood there was the first set's
 *    name, and two different games both read `Runde 1`.
 *
 * Both are now `ext_lautstark_package_*` on the root board, and this is the
 * half of that which lives on the talker's side. The fixtures pin the fields;
 * what is checked here is what the compiler DOES with them, which no fixture
 * states because it is a decision rather than a format.
 *
 * The packages are the fixture's own, varied in one field each. Building them
 * by hand would be a second writer, and the thing worth knowing is what
 * changes when one field changes - which is a comparison, not a constant.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "..", "device", "fixtures");

const hashOf = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, HASH_BYTES * 2);

/* One opaque grey pixel for every source, whatever it really is.
 *
 * Nothing here is about pictures: what a tile decodes to changes the tile's
 * name and no part of the two questions this file asks. A decoder that always
 * answers the same thing keeps the tiles constant across the variations below,
 * so a collection file name that moves has moved for the reason under test. */
const host: DeviceHost = {
  async decode() {
    return { data: new Uint8ClampedArray([128, 128, 128, 255]), width: 1, height: 1 };
  },
  async hash(bytes) { return hashOf(bytes); },
};

const archive = () =>
  new Uint8Array(readFileSync(join(FIXTURES, "package",
                                   "two-sets-and-the-ring.obz"))) as Uint8Array<ArrayBuffer>;

const opened = async (): Promise<ReadDevicePackage> =>
  readDevicePackage(await readPackageFile(archive()));

/** The compiler's answer for a package with these two fields set to this. */
async function collectionOf(over: { packageId?: string; packageName?: string }) {
  const read = { ...(await opened()), ...over };
  const { files, collection } = await compileDevice(read, host);
  return { collection, bytes: files.get(collection)! };
}

/** The name a talker would list this file under: NAME_BYTES at the head, which
 *  is collectionHeadName() in firmware/vorlaut/collections.h, from this side. */
const listedAs = (bytes: Uint8Array) =>
  new TextDecoder().decode(
    bytes.slice(HEADER_BYTES, HEADER_BYTES + NAME_BYTES))
    .replace(/\0+$/, "");

describe("which collection a package is", () => {
  it("is the package's own id, so two Sammlungen are two files", async () => {
    const one = await collectionOf({ packageId: "collection-one" });
    const two = await collectionOf({ packageId: "collection-two" });
    expect(one.collection).not.toBe(two.collection);
  });

  /* The failure this replaces, stated as the thing that must not come back:
     the root board's id is the same in every package the editor writes, so a
     compiler reading identity from there gives every Sammlung one file. */
  it("and not the root board's, which every package calls the same", async () => {
    // The root board is `set-1` in both of these and in every other package
    // the editor writes. If identity came from there, all three of these would
    // be one file - which is exactly what was happening.
    const one = await collectionOf({ packageId: "collection-one" });
    const two = await collectionOf({ packageId: "collection-two" });
    const neither = await collectionOf({ packageId: "" });
    expect(new Set([one.collection, two.collection, neither.collection]).size)
      .toBe(3);
  });

  it("survives a rename, because a renamed Sammlung is the same one", async () => {
    const before = await collectionOf({ packageId: "steady", packageName: "Erst" });
    const after = await collectionOf({ packageId: "steady", packageName: "Dann" });
    expect(after.collection).toBe(before.collection);
  });

  /* A package written before the field existed. One collection is the right
     answer for such a file, and the root board is all it has to offer. */
  it("falls back to the root board where the package predates the field", async () => {
    const old = await collectionOf({ packageId: "", packageName: "" });
    const read = await opened();
    expect(old.collection)
      .toBe(`c${hashOf(new TextEncoder().encode(read.id))}.bin`);
  });
});

describe("what a talker calls it", () => {
  it("is the Sammlung's name, at the head of the file where the device reads it",
     async () => {
       const made = await collectionOf({ packageName: "Spiegel und Ei" });
       expect(listedAs(made.bytes)).toBe("Spiegel und Ei");
     });

  /* Without it the head holds the first set's name, which is what every
     collection already on a talker is listed under. */
  it("and the first set's name where the package carries none", async () => {
    const read = await opened();
    const made = await collectionOf({ packageName: "" });
    expect(listedAs(made.bytes)).toBe(read.plan.sets[0]!.name);
  });

  /* The name is written into the file and nowhere else: the package's own set
     names are what this page says about sets, and a compile must not have
     edited them on the way past. */
  it("without the package's sets being renamed under it", async () => {
    const read = await opened();
    const before = read.plan.sets[0]!.name;
    await compileDevice({ ...read, packageName: "Etwas ganz anderes" }, host);
    expect(read.plan.sets[0]!.name).toBe(before);
  });
});
