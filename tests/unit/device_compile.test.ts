import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readPackageFile } from "../../loader/src/read.js";
import { compileDevice, type DeviceHost } from "../../loader/src/compile.js";
import {
  planLayout, readDevicePackage, type ReadDevicePackage,
} from "../../src/data/device_package.js";
import {
  HASH_BYTES, LAYOUT_BIN, renderLayoutBin,
} from "../../loader/src/layout_format.js";
import { blank, renderPixels, toRgb565Be } from "../../loader/src/tiles.js";

/* A fixture package, compiled into exactly the files a talker reads.
 *
 * This was the second half of tests/unit/device_roundtrip.test.ts, which held
 * buildDevicePackage() against compileDevice() in one process and which
 * adr/0013 replaced with a fixture kind. What is left here is the step the
 * fixtures stop short of: device/fixtures/package/ says what a package holds
 * and what a reader makes of it, and device/fixtures/layout/, tile/ and audio/
 * say what the device is handed - and between those two there is a compile
 * that neither of them watches.
 *
 * So the input is a committed package rather than one written here, which is
 * what makes this file the talker's outright: it imports no writer, and after
 * the split it travels to vorlaut-diy-talker unchanged. docs/split-crossings.md
 * names the edit that would undo that - a vendored copy of the editor's writer,
 * added so a round trip could be made to work locally - and
 * tests/unit/device_package_reader.test.ts is where that rule is checked.
 *
 * What is compared, and what it is worth. The expectation is built here from
 * the plan the fixture states, with the same two primitives the compiler uses -
 * tiles.renderPixels() and renderLayoutBin() - because those ARE the device
 * format and a second tile renderer in a test would be a second opinion about
 * frozen bytes. tests/test_tile_render_js.py is what holds those primitives to
 * the Pillow that no longer exists; nothing here can or should say anything
 * about that. What this file is about is everything between: which picture is
 * drawn for which key, which keys share a tile and which must not, and that
 * layout.bin names the files that were actually written.
 *
 * The decode is a fixture rather than a canvas, and everything below the decode
 * is arithmetic, so everything below it runs here for real.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "..", "device", "fixtures");

/** The package this compiles: two boards, a crossed-out key sharing a picture
 *  with a plain one, a key holding nothing, a reference behind which there is
 *  nothing, and a picture in a format nothing here can decode. Every branch of
 *  the compile is one of those. */
const FIXTURE = "two-sets-and-the-ring";

const want = JSON.parse(readFileSync(
  join(FIXTURES, "package", `${FIXTURE}.expected.json`), "utf8"));

const archive = () =>
  new Uint8Array(readFileSync(join(FIXTURES, want.file))) as Uint8Array<ArrayBuffer>;

/**
 * A 24-bit BMP as pixels, and null for anything else.
 *
 * The host's whole job on this side of the seam, and it is a fixture standing
 * in for a browser's image decoder rather than a mock of anything under test:
 * decoding is what DeviceHost exists to keep out of the compiler.
 *
 * BMP because that is the one picture format device/fixtures/ can hold. A
 * directory that must regenerate byte for byte cannot contain a PNG - writing
 * one needs a compressor, whose output is a property of whichever zlib is
 * installed - so the fixtures' pictures are laid out pixel by pixel and read
 * back the same way. The SVG in the same package decodes to null here, which
 * is what a browser without an SVG rasteriser would also do, and null is not
 * an error: it is the grey cross.
 */
function decodeBmp(bytes: Uint8Array):
    { data: Uint8ClampedArray; width: number; height: number } | null {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  if (view.getUint16(28, true) !== 24 || view.getUint32(30, true) !== 0) return null;
  const stride = (width * 3 + 3) & ~3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rows run bottom-up, which is the one thing about this format that
      // silently flips a picture if it is forgotten.
      const at = start + (height - 1 - y) * stride + x * 3;
      const to = (y * width + x) * 4;
      data[to] = bytes[at + 2]!;
      data[to + 1] = bytes[at + 1]!;
      data[to + 2] = bytes[at]!;
      data[to + 3] = 255;
    }
  }
  return { data, width, height };
}

/** sha256 cut to HASH_BYTES, as hex - the name rule, and the same one
 *  runBuild()'s fingerprint() applies. Passed in rather than written into the
 *  compiler, because two of them would be two opinions about a file name. */
const hashOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, HASH_BYTES * 2);

const host: DeviceHost = {
  async decode(bytes) { return decodeBmp(bytes); },
  async hash(bytes) { return hashOf(bytes); },
};

const opened = async (): Promise<ReadDevicePackage> =>
  readDevicePackage(await readPackageFile(archive()));

/**
 * The files a compile must produce, built from the fixture's own answers.
 *
 * The same walk the compiler makes, and that is deliberate rather than lazy:
 * what would be worth nothing is a second renderer, and what is worth having
 * is a second walk. Every name below is chosen here from the plan and the
 * sources; if the compiler dedupes differently, draws a blank where a cross
 * belongs, or writes layout.bin naming a file it did not write, the two maps
 * stop matching.
 */
async function expected(read: ReadDevicePackage) {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const drawn = new Map<string, string>();
  const tileFor = (reference: string, negated: boolean): string => {
    const key = (negated ? "!" : "") + reference;
    const already = drawn.get(key);
    if (already) return already;
    const source = read.sources.get(reference);
    const bytes = renderPixels(source ? decodeBmp(source.bytes) : null, { negated });
    const name = `t${hashOf(bytes)}.bin`;
    drawn.set(key, name);
    files.set(name, bytes);
    return name;
  };

  let blankName = "";
  const blankTile = (): string => {
    if (!blankName) {
      const bytes = toRgb565Be(blank());
      blankName = `t${hashOf(bytes)}.bin`;
      files.set(blankName, bytes);
    }
    return blankName;
  };

  const labelFiles: string[] = [];
  const tileFiles: string[][] = [];
  const audioFiles: string[][] = [];
  for (const set of read.plan.sets) {
    labelFiles.push(tileFor(set.symbol, false));
    const tileNames: string[] = [];
    const audioNames: string[] = [];
    for (const slot of set.slots) {
      tileNames.push(slot.empty ? blankTile() : tileFor(slot.symbol, slot.negated));
      const sound = slot.text ? read.sounds.get(slot.text) : undefined;
      if (sound) { files.set(sound.name, sound.bytes); audioNames.push(sound.name); }
      else audioNames.push("");
    }
    tileFiles.push(tileNames);
    audioFiles.push(audioNames);
  }
  files.set(LAYOUT_BIN,
            renderLayoutBin(planLayout(read.plan), labelFiles, tileFiles, audioFiles));
  return files;
}

describe("a fixture package, compiled into what a talker reads", () => {
  it("is the same files, name for name and byte for byte", async () => {
    const read = await opened();
    const compiled = await compileDevice(read, host);
    const wanted = await expected(read);

    // The names first, because a difference here says which file went missing
    // rather than that some byte somewhere moved.
    expect([...compiled.keys()].sort()).toEqual([...wanted.keys()].sort());
    for (const [name, bytes] of wanted) {
      expect(Buffer.from(compiled.get(name)!), name).toEqual(Buffer.from(bytes));
    }
  });

  it("writes the three shapes of file the device reads, and nothing else",
     async () => {
    const compiled = await compileDevice(await opened(), host);
    for (const name of compiled.keys()) {
      expect(name === LAYOUT_BIN
             || /^t[0-9a-f]{32}\.bin$/.test(name)
             || /^a[0-9a-f]{32}\.wav$/.test(name), name).toBe(true);
    }
    expect(compiled.has(LAYOUT_BIN)).toBe(true);
  });

  it("draws a crossed-out key as a different tile from the plain one",
     async () => {
    // Form rule 2, at the far end of it. The package carries one picture and a
    // flag; the device gets two tiles. Baking the cross into the export would
    // have made images/ hold two members, and dropping the flag would make
    // layout.bin hold the same tile hash twice - a talker that says "Ich habe
    // keinen Hunger" under a picture that does not say "not".
    const read = await opened();
    const first = read.plan.sets[0]!;
    const plain = first.slots.find((one) => one.symbol && !one.negated)!;
    const crossed = first.slots.find((one) => one.negated)!;
    expect(crossed.symbol).toBe(plain.symbol);

    const compiled = await compileDevice(read, host);
    const source = read.sources.get(plain.symbol)!;
    const plainTile = `t${hashOf(renderPixels(decodeBmp(source.bytes), { negated: false }))}.bin`;
    const crossedTile = `t${hashOf(renderPixels(decodeBmp(source.bytes), { negated: true }))}.bin`;
    expect(plainTile).not.toBe(crossedTile);
    expect(compiled.has(plainTile)).toBe(true);
    expect(compiled.has(crossedTile)).toBe(true);
  });

  it("draws a key holding nothing as a blank, not as the missing-picture cross",
     async () => {
    // The divergence this whole boundary was built to close. An untouched key
    // used to be an empty cell on a tablet and tiles.placeholder() on the
    // device - the grey cross that means "no picture yet", said about a key
    // nobody had asked anything of.
    const read = await opened();
    const compiled = await compileDevice(read, host);
    const blankTile = `t${hashOf(toRgb565Be(blank()))}.bin`;
    const cross = `t${hashOf(renderPixels(null, { negated: false }))}.bin`;

    expect(read.plan.sets.some((set) => set.slots.some((one) => one.empty)))
      .toBe(true);
    expect(compiled.has(blankTile)).toBe(true);
    expect(blankTile).not.toBe(cross);
  });

  it("draws the same cross for a reference with nothing behind it as for a "
     + "picture that will not decode", async () => {
    // Two different gaps and one picture, which is right: the device has no
    // way to say which kind of nothing it is, and a carer looking at the panel
    // is being told "there is no picture here" either way. What must not
    // happen is either of them coming out as a blank, which says the opposite.
    const read = await opened();
    const compiled = await compileDevice(read, host);
    const cross = `t${hashOf(renderPixels(null, { negated: false }))}.bin`;

    const unresolved = read.plan.sets.flatMap((set) => set.slots)
      .find((one) => one.symbol && !read.sources.has(one.symbol));
    expect(unresolved, "the fixture has a reference behind which there is nothing")
      .toBeDefined();
    const undecodable = [...read.sources.values()]
      .find((one) => decodeBmp(one.bytes) === null);
    expect(undecodable, "and a picture this host cannot decode").toBeDefined();

    expect(compiled.has(cross)).toBe(true);
  });

  it("carries the package's own WAVs, under the package's own names",
     async () => {
    // adr/0008 satisfied by construction: the bytes that reach the device are
    // the ones that were in the file, not something derived from them.
    const read = await opened();
    const compiled = await compileDevice(read, host);
    expect(read.sounds.size).toBeGreaterThan(0);
    for (const sound of read.sounds.values()) {
      expect(Buffer.from(compiled.get(sound.name)!), sound.name)
        .toEqual(Buffer.from(sound.bytes));
    }
  });
});
