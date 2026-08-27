import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildDevicePackage, compileDevice, devicePackageBytes, devicePlan,
  readDevicePackage, sniffImageType, wavFormat, isDeviceWav, wavSeconds,
  type DeviceHost, type DevicePackage, type DeviceSound, type DeviceSource,
} from "../../src/data/device_package.js";
import {
  HASH_BYTES, LAYOUT_BIN, SLOTS_PER_SET, renderLayoutBin,
} from "../../loader/src/layout_format.js";
import { blank, renderPixels, toRgb565Be } from "../../loader/src/tiles.js";
import type { DiyLayout } from "../../src/core/types.js";
import { unzip } from "./obz.js";

/* A device build, out of the export and back, held against the build itself.
 *
 * This is the comparison nothing in this repository performs. runBuild() walks
 * a Layout and writes tiles, WAVs and layout.bin into the store; diyBoards()
 * walks the same Layout and writes an .obz; and neither has ever read the
 * other's output, so anything the two disagree about had no test to fail. That
 * is exactly how the empty-slot divergence survived - see
 * docs/obz-as-device-input.md §5 - and it is why the round trip is the test
 * that matters rather than one more assertion about a manifest.
 *
 * What is compared, and why it is not a tautology. The expectation is built
 * here, from the Layout, with the same two primitives runBuild() uses -
 * tiles.renderPixels() and renderLayoutBin() - because those *are* the device
 * format and sharing them is correct: a second tile renderer in a test would
 * be a second opinion about frozen bytes. What is not shared is everything in
 * between. The left-hand side reads the Layout and the pictures directly; the
 * right-hand side reads nothing but the bytes of the .obz, through
 * readDevicePackage() and compileDevice(). So every field the export drops,
 * renames, resamples or bakes shows up as a different file map.
 *
 * The tiles are additionally held against tests/reference/tiles.lock.json,
 * which is the only opinion in this repository about what a tile should look
 * like and was frozen by a Pillow that no longer exists. That is what stops
 * both sides of the comparison being wrong together.
 *
 * The decode is a fixture rather than a canvas, and that is the split
 * docs/obz-as-device-input.md §7 predicted: a node-safe core with a
 * browser-only decoder over it. Everything below the decode is arithmetic, so
 * everything below it runs here for real.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE = resolve(HERE, "..", "reference");

interface Frozen {
  name: string;
  width: number;
  height: number;
  /** The gzipped raw RGBA, which is what this test uses as a source picture. */
  bytes: Uint8Array<ArrayBuffer>;
  /** The tile Pillow rendered for it, byte for byte. */
  tile: Uint8Array<ArrayBuffer>;
}

/** A copy with a buffer of its own.
 *
 * new Uint8Array(view) rather than view.slice().buffer, and the difference is
 * not cosmetic: readFileSync answers with a Buffer out of node's shared pool,
 * Buffer#slice returns a *view* into it, and .buffer is then the whole pool.
 * Three fixtures read that way come back as three views of one allocation,
 * hash identically, and collapse into one member of the archive - which is a
 * green test asserting almost nothing. */
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;

/** The frozen fixtures, as source pictures a device export could carry.
 *
 * The .rgba.gz files are real bytes of a real format - gzip - and the decode
 * below really decodes them, so nothing here is a stub standing in for the
 * step that matters. What they are *not* is PNG, which is deliberate: the
 * source travels in whatever format it was stored in, so a fixture in a format
 * the sniffer does not recognise exercises the branch an unusual upload takes.
 */
function frozen(): Frozen[] {
  const lock = JSON.parse(
    readFileSync(resolve(REFERENCE, "tiles.lock.json"), "utf8"));
  return (lock.fixtures as Record<string, unknown>[])
    .filter((one) => typeof one.pixels === "string")
    .map((one) => ({
      name: String(one.name),
      width: Number(one.width),
      height: Number(one.height),
      bytes: owned(readFileSync(resolve(REFERENCE, String(one.pixels)))),
      tile: owned(readFileSync(resolve(REFERENCE, String(one.expected)))),
    }));
}

const FIXTURES = frozen();
const named = (name: string): Frozen => {
  const one = FIXTURES.find((each) => each.name === name);
  if (!one) throw new Error(`tiles.lock.json has no fixture called ${name}`);
  return one;
};

/** The whole of what the host contributes: gunzip, and sha256.
 *
 * The hash is node's rather than the browser's crypto.subtle, and it is the
 * same rule runBuild()'s fingerprint() applies - sha256, cut to HASH_BYTES,
 * as hex. Written out here rather than imported, because fingerprint() is
 * private to backend/local.ts and exporting it to be tested would be the test
 * changing the code to suit itself.
 */
const host = (sources: Map<string, Frozen>): DeviceHost => ({
  async decode(bytes) {
    const found = [...sources.values()].find(
      (one) => Buffer.compare(Buffer.from(one.bytes), Buffer.from(bytes)) === 0);
    if (!found) return null;
    return {
      data: new Uint8ClampedArray(gunzipSync(bytes)),
      width: found.width,
      height: found.height,
    };
  },
  async hash(bytes) {
    return createHash("sha256").update(bytes).digest("hex")
      .slice(0, HASH_BYTES * 2);
  },
});

const hashOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, HASH_BYTES * 2);

/* ------------------------------------------------------------ a WAV --- */

/** A RIFF/WAVE file of `seconds` of silence, at whatever format is asked for.
 *
 * The device's own shape by default - 16 kHz, mono, 16-bit, which
 * audio_format.ts is the authority on. The parameters are here so that the
 * refusals can be driven with a file that is wrong in exactly one way.
 */
function wav(
  seconds: number,
  { rate = 16000, channels = 1, bits = 16 } = {},
): Uint8Array<ArrayBuffer> {
  const frames = Math.round(seconds * rate);
  const dataBytes = frames * channels * (bits / 8);
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                       // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * (bits / 8), true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes as Uint8Array<ArrayBuffer>;
}

/* --------------------------------------------------------- the Sammlung --- */

const VOICE = "piper:de_DE-thorsten-medium";

/** One Sammlung holding every shape a key can be in.
 *
 * Each set is here for something the export has to carry and could lose:
 * a picture, a crossed-out picture of the *same* reference, a word with no
 * picture, a picture with no word, a key holding nothing at all, a set with no
 * picture on its own key, and a name longer than the 32 bytes layout.bin cuts
 * it at. A fixture where every key is filled would let this whole file pass
 * while proving one case.
 */
const layout = (): DiyLayout => ({
  language: "de",
  voice: VOICE,
  sleep_timeout_seconds: 600,
  sets: [
    {
      name: "Food and drink",
      symbol: "hilfe.rgba.gz",
      slots: [
        { text: "I am hungry", symbol: "ja.rgba.gz" },
        // The same reference crossed out. Two tiles and one source: the cross
        // is a flag, so images/ carries one member and layout.bin two hashes -
        // which is the whole of form rule 2, and the one thing that goes wrong
        // silently if the export bakes the cross instead.
        { text: "I am not hungry", symbol: "ja.rgba.gz", negated: true },
        { text: "I am thirsty", symbol: "" },
        { text: "", symbol: "nein.rgba.gz" },
      ],
    },
    {
      // Longer than NAME_BYTES, with a three-byte character landing across
      // the cut: renderLayoutBin() takes the first 32 *bytes*, which lands in
      // the middle of the dash, and a writer cutting 32 characters instead
      // would hand 34 bytes to a 32-byte field. So this name is where the two
      // stop agreeing, and where an export that decoded and re-encoded the
      // name on the way through would show it.
      //
      // A real Sammlung says this with an umlaut and says it more plainly.
      // The repository is English outside the two translation tables, so the
      // property is pinned with a character rather than with a word.
      name: "Out and about in the afternoon — later",
      symbol: "",
      slots: [
        { text: "Let us go outside", symbol: "hilfe.rgba.gz" },
        // Nothing at all: blank on the device since 2026-08-27, and the case
        // the two halves used to answer differently.
        { text: "", symbol: "" },
        { text: "   ", symbol: "" },
        // A reference nothing resolves - the grey cross, which is a different
        // tile from the blank above it and must stay one.
        { text: "Time to go home", symbol: "metacom:not-there" },
      ],
    },
  ],
});

/** The sources a build would resolve, and the one that does not. */
const sourcesFor = (): Map<string, Frozen> => new Map([
  ["hilfe.rgba.gz", named("hilfe")],
  ["ja.rgba.gz", named("ja")],
  ["nein.rgba.gz", named("nein")],
]);

const soundsFor = (): Map<string, DeviceSound> => {
  const out = new Map<string, DeviceSound>();
  for (const text of ["I am hungry", "I am not hungry",
                      "I am thirsty", "Let us go outside", "Time to go home"]) {
    const bytes = wav(0.4 + text.length / 100);
    // Named the way runBuild() names one: `a`, then the hash of what goes into
    // the synthesis. The payload is not reproduced here - it is
    // backend/local.ts's, and the export carries the name rather than deriving
    // it - so the fixture hashes the text, which gives the same shape.
    out.set(text, { name: `a${hashOf(new TextEncoder().encode(text))}.wav`, bytes });
  }
  return out;
};

/* ------------------------------------------------ what the build produces --- */

/**
 * The device files, straight from the Layout - the left-hand side.
 *
 * Written the way runBuild() writes them and reading what runBuild() reads:
 * the Layout, and the pictures a reference resolves to. It shares tiles.ts and
 * renderLayoutBin() with the compiler, which is right - those are the device
 * format - and shares nothing else, which is the point.
 */
async function fromLayout(
  made: DiyLayout, sources: Map<string, Frozen>, sounds: Map<string, DeviceSound>,
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const plan = devicePlan(made, VOICE);

  const drawn = new Map<string, string>();
  const tileFor = (reference: string, negated: boolean): string => {
    const key = (negated ? "!" : "") + reference;
    const already = drawn.get(key);
    if (already) return already;
    const source = sources.get(reference);
    const pixels = source
      ? { data: new Uint8ClampedArray(gunzipSync(source.bytes)),
          width: source.width, height: source.height }
      : null;
    const bytes = renderPixels(pixels, { negated });
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
  for (const set of plan.sets) {
    labelFiles.push(tileFor(set.symbol, false));
    const tileNames: string[] = [];
    const audioNames: string[] = [];
    for (const slot of set.slots) {
      tileNames.push(slot.empty ? blankTile() : tileFor(slot.symbol, slot.negated));
      const sound = slot.text ? sounds.get(slot.text) : undefined;
      if (sound) { files.set(sound.name, sound.bytes); audioNames.push(sound.name); }
      else audioNames.push("");
    }
    tileFiles.push(tileNames);
    audioFiles.push(audioNames);
  }
  files.set(LAYOUT_BIN, renderLayoutBin(made, labelFiles, tileFiles, audioFiles));
  return files;
}

/* ------------------------------------------------ what the export produces --- */

/** The package written, zipped, unzipped and parsed - the whole way round.
 *
 * Through the actual bytes rather than handing the in-memory package straight
 * to the reader. An export that only ever round trips as objects is one whose
 * zip could be unreadable and whose JSON could be unparseable, and the claim
 * being made is about a file somebody archives.
 */
function throughTheFile(bytes: Uint8Array): DevicePackage {
  const members = unzip(bytes);
  const manifest = JSON.parse(
    new TextDecoder().decode(members.get("manifest.json")!.data));
  const boards = Object.values(manifest.paths.boards as Record<string, string>)
    .map((path) => JSON.parse(new TextDecoder().decode(members.get(path)!.data)));
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, entry] of members) {
    if (name === "manifest.json" || name.endsWith(".obf")) continue;
    files.set(name, owned(entry.data));
  }
  return { manifest, boards, files };
}

async function exported(
  made: DiyLayout, sources: Map<string, Frozen>, sounds: Map<string, DeviceSound>,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; pkg: DevicePackage }> {
  const carried = new Map<string, DeviceSource>();
  for (const [reference, one] of sources) {
    carried.set(reference, {
      key: hashOf(one.bytes).slice(0, 16),
      bytes: one.bytes,
      contentType: sniffImageType(one.bytes),
    });
  }
  const pkg = buildDevicePackage({ layout: made, voice: VOICE, sources: carried, sounds });
  return { bytes: await devicePackageBytes(pkg), pkg };
}

/* ------------------------------------------------------------- the test --- */

describe("a device build, out of the export and back", () => {
  it("is the same files, name for name and byte for byte", async () => {
    const made = layout();
    const sources = sourcesFor();
    const sounds = soundsFor();

    const built = await fromLayout(made, sources, sounds);
    const { bytes } = await exported(made, sources, sounds);
    const compiled = await compileDevice(
      readDevicePackage(throughTheFile(bytes)), host(sources));

    // The names first, because a difference here says which file went missing
    // rather than that some byte somewhere moved.
    expect([...compiled.keys()].sort()).toEqual([...built.keys()].sort());
    for (const [name, expectedBytes] of built) {
      expect(Buffer.from(compiled.get(name)!), name)
        .toEqual(Buffer.from(expectedBytes));
    }
  });

  it("puts the tiles Pillow froze on the device", async () => {
    // What stops both sides of the comparison above being wrong together:
    // tests/reference/tiles.lock.json is the only opinion in this repository
    // about what a tile looks like, and nothing here can write it again.
    const made = layout();
    const sources = sourcesFor();
    const { bytes } = await exported(made, sources, soundsFor());
    const compiled = await compileDevice(
      readDevicePackage(throughTheFile(bytes)), host(sources));

    for (const name of ["hilfe", "ja", "nein"]) {
      const one = named(name);
      expect(Buffer.from(compiled.get(`t${hashOf(one.tile)}.bin`)!), name)
        .toEqual(Buffer.from(one.tile));
    }
  });

  it("carries the sources, not the tablet's fitted PNGs", async () => {
    // Form rule 1, as a statement about bytes: what is in images/ is what was
    // put in, at its own size and in its own format. A canvas anywhere on this
    // path would move every tile hash and invalidate the lock above.
    const sources = sourcesFor();
    const { pkg } = await exported(layout(), sources, soundsFor());
    const members = [...pkg.files.keys()].filter((one) => one.startsWith("images/"));
    expect(members).toHaveLength(3);
    for (const one of sources.values()) {
      const found = [...pkg.files.values()].some(
        (each) => Buffer.compare(Buffer.from(each), Buffer.from(one.bytes)) === 0);
      expect(found, `${one.name} travels unchanged`).toBe(true);
    }
  });

  it("carries one source for a reference that is crossed out on one key", async () => {
    // Form rule 2. The app package bakes the cross, so "ja" and "kein ja" are
    // two PNGs there; here they are one source and a flag, and two tiles come
    // out the far end. Both halves of that are worth pinning: baking the cross
    // would make images/ hold four members, and dropping the flag would make
    // layout.bin hold the same hash twice.
    const sources = sourcesFor();
    const { bytes, pkg } = await exported(layout(), sources, soundsFor());
    const crossed = pkg.boards[0]!.buttons.filter(
      (one) => one.ext_vorlaut_negated === true);
    expect(crossed.map((one) => one.id)).toEqual(["set-1-key-2"]);
    // The same picture on both keys, one member of the archive.
    expect(pkg.boards[0]!.buttons[0]!.image_id)
      .toBe(pkg.boards[0]!.buttons[1]!.image_id);

    const compiled = await compileDevice(
      readDevicePackage(throughTheFile(bytes)), host(sources));
    const plain = `t${hashOf(named("ja").tile)}.bin`;
    expect(compiled.has(plain)).toBe(true);
    // And a second, different tile for the crossed-out one.
    const tiles = [...compiled.keys()].filter((one) => one.startsWith("t"));
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it("carries the device's WAVs rather than the tablet's Opus", async () => {
    // Form rule 3, and adr/0008 satisfied by construction: the bytes in
    // sounds/ are the build's own, at the device's rate, under the device's
    // own name - so nothing anywhere derives one delivered artefact from the
    // other.
    const sounds = soundsFor();
    const { pkg } = await exported(layout(), sourcesFor(), sounds);
    const members = [...pkg.files.keys()].filter((one) => one.startsWith("sounds/"));
    expect(members.length).toBe(sounds.size);
    for (const path of members) {
      expect(path).toMatch(/^sounds\/a[0-9a-f]{32}\.wav$/);
      expect(isDeviceWav(wavFormat(pkg.files.get(path)!)), path).toBe(true);
    }
  });

  it("carries the language itself, not one derived from the voice", async () => {
    // Form rule 4. localeFor() would answer "de-DE" here, off the voice; the
    // device wants the LANGUAGE_CODES key, which is "de". The two are close
    // enough to look interchangeable and are not: "de-DE" is not in that table
    // at all, so it would fall back to English on the device's own menu.
    const { pkg } = await exported(layout(), sourcesFor(), soundsFor());
    for (const board of pkg.boards) expect(board.locale).toBe("de");
    const read = readDevicePackage(pkg);
    expect(read.plan.language).toBe("de");
    expect(read.plan.sleepTimeoutSeconds).toBe(600);
    expect(read.plan.voice).toBe(VOICE);
  });

  it("brings the Sammlung back as the Sammlung it was", async () => {
    // Not a device build this time but the plan: names, order, the ring, the
    // slot texts, the flags and the references. Everything layout.bin does not
    // carry as such but which decides what goes in it.
    const made = layout();
    const { bytes } = await exported(made, sourcesFor(), soundsFor());
    const read = readDevicePackage(throughTheFile(bytes));
    expect(read.plan).toEqual(devicePlan(made, VOICE));
  });
});

describe("what the export refuses to write", () => {
  const good = () => ({
    layout: layout(),
    voice: VOICE,
    sources: new Map<string, DeviceSource>(),
    sounds: soundsFor(),
  });

  it("a sound that is not the device's WAV", () => {
    // The check audio_format.ts says nobody was making. The device does not
    // refuse a 24 kHz file, it plays it at 16 - a word at the wrong pitch, on
    // a talker, with nothing anywhere saying why.
    const input = good();
    const one = input.sounds.get("I am thirsty")!;
    input.sounds.set("I am thirsty", { name: one.name, bytes: wav(0.5, { rate: 24000 }) });
    expect(() => buildDevicePackage(input)).toThrow(/24000 Hz/);
  });

  it("a sound under a name layout.bin cannot carry", () => {
    // hashBytes() throws on one, at the far end of a build nobody is watching.
    const input = good();
    const one = input.sounds.get("I am thirsty")!;
    input.sounds.set("I am thirsty", { name: "hungry.wav", bytes: one.bytes });
    expect(() => buildDevicePackage(input)).toThrow(/not a name layout\.bin can carry/);
  });

  it("a Sammlung with nothing in it", () => {
    expect(() => buildDevicePackage({ ...good(), layout: { sets: [] } }))
      .toThrow(/nothing in this Sammlung/);
  });
});

describe("what the compiler refuses to read", () => {
  it("a talker document, which carries references and no pixels", async () => {
    // The failure this is here to make impossible: obf.ts's export is also a
    // .obz, also has ext_vorlaut_negated on its buttons, and also names its
    // boards set-1, set-2. What it does not have is bytes behind images[], so
    // compiling it would draw the grey cross on every single key - a talker
    // that parses and is wrong, which is the one outcome
    // docs/device-interface.md §6 says is worse than nothing.
    const { pkg } = await exported(layout(), sourcesFor(), soundsFor());
    const stripped: DevicePackage = {
      manifest: pkg.manifest,
      boards: pkg.boards,
      files: new Map([...pkg.files].filter(([name]) => !name.startsWith("images/"))),
    };
    expect(() => readDevicePackage(stripped))
      .toThrow(/is named by this package and is not in it/);
  });

  it("a package whose ring does not reach every board", async () => {
    const { pkg } = await exported(layout(), sourcesFor(), soundsFor());
    // The second set's key now loads itself, so the ring closes after one hop
    // and the first board is the only one reached.
    const board = pkg.boards[0]!;
    const key = board.buttons.find((one) => one.load_board)!;
    key.load_board = { ...key.load_board!, id: board.id };
    expect(() => readDevicePackage(pkg)).toThrow(/does not reach every board/);
  });
});

describe("the WAV header reader", () => {
  it("finds the format past a chunk it does not know", () => {
    // A synthesiser may write LIST or fact between fmt and data, and a reader
    // that assumed the canonical 44-byte header would refuse a good file.
    const plain = wav(0.25);
    const extra = new Uint8Array(plain.length + 12);
    extra.set(plain.slice(0, 36), 0);
    const view = new DataView(extra.buffer);
    for (const [at, ch] of [..."LIST"].entries()) view.setUint8(36 + at, ch.charCodeAt(0));
    view.setUint32(40, 4, true);
    extra.set(plain.slice(36), 48);
    view.setUint32(4, extra.length - 8, true);

    const format = wavFormat(extra);
    expect(format).not.toBeNull();
    expect(isDeviceWav(format)).toBe(true);
    expect(wavSeconds(format!)).toBeCloseTo(0.25, 5);
  });

  it("says no to what is not a RIFF/WAVE file", () => {
    expect(wavFormat(new Uint8Array([0x4f, 0x67, 0x67, 0x53]))).toBeNull();
    expect(isDeviceWav(null)).toBe(false);
  });

  it("measures a truncated file by what is there, not by what it claims", () => {
    const full = wav(1);
    const cut = full.slice(0, full.length - 1000);
    expect(wavSeconds(wavFormat(cut)!)).toBeLessThan(1);
  });
});

describe("the slot cap", () => {
  it("takes the first four and no more, exactly as the build does", () => {
    // renderLayoutBin() holds SLOTS_PER_SET per set and drops the rest without
    // a word, so an export carrying a fifth would be an export of something
    // that cannot reach the device.
    const made = layout();
    made.sets[0]!.slots.push({ text: "A fifth key", symbol: "" });
    const plan = devicePlan(made, VOICE);
    expect(plan.sets[0]!.slots).toHaveLength(SLOTS_PER_SET);
  });
});
