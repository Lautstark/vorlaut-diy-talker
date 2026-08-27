import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
/* The reader's half of the device package, and nothing else.
 *
 * readPackageFile() is loader/src/read.ts - the half that opens an archive -
 * and the four names beside it are the ones docs/split-crossings.md has
 * leaving src/data/device_package.ts for loader/ on the day of the move.
 * buildDevicePackage(), devicePackageBytes(), digest() and sniffImageType()
 * are the writer's and are deliberately absent - see the foot of this file. */
import { readPackageFile } from "../../loader/src/read.js";
import {
  isDeviceWav, planLayout, readDevicePackage, wavFormat, wavSeconds,
} from "../../src/data/device_package.js";

/* The talker page's half of device/fixtures/package/.
 *
 * The mirror of tests/unit/device_package_writer.test.ts, and the two never
 * meet. This one is given the fixture's archive - the actual bytes of an .obz,
 * opened by the loader's own reader - and must come back with the answers the
 * fixture states: the plan, the pictures behind its references, the recordings
 * behind its sentences. Where a fixture is a refusal it must refuse it, at the
 * step the fixture names.
 *
 * Those two steps are not interchangeable and the fixtures say which is which.
 * `archive` is loader/src/read.ts, whose job is deciding whether there is a
 * package at all; `package` is readDevicePackage(), whose job is deciding
 * whether it is one that can be compiled. Keeping them apart is what lets each
 * say something specific instead of "this file is broken", and a fixture that
 * moved from one to the other would be a change in what a person is told.
 *
 * Where this stops. It reads a package; it does not compile one.
 * device/fixtures/layout/, tile/ and audio/ already own everything downstream
 * of here, and tests/unit/device_compile.test.ts is the step between the two.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "..", "device", "fixtures");

const readJson = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const index = readJson("index.json");
const listed: any[] = index.fixtures;
const packages = listed.filter((one) => one.kind === "package")
  .map((one) => ({ listed: one, want: readJson(one.expected) }));

const archiveOf = (want: any): Uint8Array<ArrayBuffer> =>
  new Uint8Array(readFileSync(join(FIXTURES, want.file))) as Uint8Array<ArrayBuffer>;

/** The word a refusal has to contain, as a pattern rather than a whole
 *  sentence: a fixture that pinned the message would be a fixture about
 *  wording, and the wording is allowed to improve. */
const saying = (fragment: string) =>
  new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

describe("device/fixtures/package/ has a reading half at all", () => {
  it("lists packages to take and packages to refuse, at both steps", () => {
    // Without this the whole file is green on an index that lost the kind.
    const refusals = packages.filter(({ want }) => want.read?.result === "refused");
    expect(packages.filter(({ want }) => want.read?.result === "ok").length)
      .toBeGreaterThan(0);
    expect(refusals.length).toBeGreaterThan(0);
    // Both steps, because a fixture set that only exercised one of them would
    // let the other be deleted without a word.
    const at = new Set(refusals.map(({ want }) => want.read.at));
    expect([...at].sort()).toEqual(["archive", "package"]);
  });
});

for (const { listed: one, want } of packages) {
  if (want.read === null) continue;

  if (want.read.result === "refused") {
    describe(`${one.fixture}: what a reader must refuse`, () => {
      it(`refuses it at the ${want.read.at}, saying "${want.read.because}"`,
         async () => {
        if (want.read.at === "archive") {
          await expect(readPackageFile(archiveOf(want)))
            .rejects.toThrow(saying(want.read.because));
          return;
        }
        // It is a package. What it is not is one that can be compiled.
        const pkg = await readPackageFile(archiveOf(want));
        expect(() => readDevicePackage(pkg)).toThrow(saying(want.read.because));
      });
    });
    continue;
  }

  describe(`${one.fixture}: what a reader must make of it`, () => {
    const opened = async () => {
      const pkg = await readPackageFile(archiveOf(want));
      return { pkg, read: readDevicePackage(pkg) };
    };

    it("comes back with the plan the fixture states", async () => {
      const { read } = await opened();
      expect(read.plan).toEqual({
        language: want.read.plan.language,
        voice: want.read.plan.voice,
        sleepTimeoutSeconds: want.read.plan.sleep_timeout_seconds,
        sets: want.read.plan.sets,
      });
    });

    it("brings back the pictures, under the references they were filed with",
       async () => {
      const { pkg, read } = await opened();
      const wanted: any[] = want.read.sources;
      expect([...read.sources.keys()].sort())
        .toEqual(wanted.map((each) => each.reference).sort());
      for (const source of wanted) {
        const got = read.sources.get(source.reference)!;
        expect(got.key, source.reference).toBe(source.key);
        expect(got.contentType, source.reference).toBe(source.content_type);
        // The bytes are the member's, unresampled and un-re-encoded: form
        // rule 1 as a statement about bytes rather than about intent.
        expect(Buffer.from(got.bytes), source.reference)
          .toEqual(Buffer.from(pkg.files.get(source.path)!));
      }
    });

    it("leaves a reference with nothing behind it as a reference", async () => {
      // The gap travels as a gap. A reference the export could not resolve is
      // in the plan and not in sources, so the compiler draws the same grey
      // cross the build drew - where dropping the entry would have made it a
      // key that never had a picture, and on a key with no word either that is
      // a blank tile instead.
      const { read } = await opened();
      const referenced = new Set<string>();
      for (const set of read.plan.sets) {
        if (set.symbol) referenced.add(set.symbol);
        for (const slot of set.slots) if (slot.symbol) referenced.add(slot.symbol);
      }
      for (const reference of referenced) {
        if (read.sources.has(reference)) continue;
        expect((want.read.sources as any[]).some(
          (each) => each.reference === reference), reference).toBe(false);
      }
    });

    it("brings back the recordings, under the sentences they say", async () => {
      const { pkg, read } = await opened();
      const wanted: any[] = want.read.sounds;
      expect([...read.sounds.keys()].sort())
        .toEqual(wanted.map((each) => each.text).sort());
      for (const sound of wanted) {
        const got = read.sounds.get(sound.text)!;
        expect(got.name, sound.text).toBe(sound.name);
        expect(Buffer.from(got.bytes), sound.text)
          .toEqual(Buffer.from(pkg.files.get(sound.path)!));
        expect(isDeviceWav(wavFormat(got.bytes)), sound.name).toBe(true);
      }
    });

    it("finds the length the board document claims for each recording",
       async () => {
      // The document and the bytes, against each other. OBF has the field and
      // a person reading the file at a bench has no other way to see how long
      // a clip is, so a duration nobody checks is the quiet kind of wrong:
      // nothing refuses it, nothing sounds different, and the number is a lie
      // in a file somebody archived.
      const { pkg } = await opened();
      let checked = 0;
      for (const board of pkg.boards) {
        for (const entry of board.sounds ?? []) {
          const bytes = pkg.files.get(entry.path)!;
          expect(wavSeconds(wavFormat(bytes)!), entry.path)
            .toBeCloseTo(entry.duration, 6);
          checked++;
        }
      }
      expect(checked, "the fixture has recordings to check")
        .toBe((want.read.sounds as any[]).length);
    });

    it("hands the plan back in the shape renderLayoutBin() reads", async () => {
      // planLayout()'s whole claim: every field the compiler needs is one the
      // plan carries, so handing it back loses nothing. `empty` is the one
      // field that does not travel, and it does not have to - it is a question
      // about the slot, asked again on the far side.
      const { read } = await opened();
      const back = planLayout(read.plan);
      expect(back.language).toBe(read.plan.language);
      expect(back.voice).toBe(read.plan.voice);
      expect(back.sleep_timeout_seconds).toBe(read.plan.sleepTimeoutSeconds);
      expect(back.sets).toEqual(read.plan.sets.map((set) => ({
        name: set.name,
        symbol: set.symbol,
        slots: set.slots.map((slot) => ({
          text: slot.text, symbol: slot.symbol, negated: slot.negated,
        })),
      })));
    });
  });
}

/* --------------------------------------------- the WAV header reader --- */

/* wavFormat() against device/fixtures/audio/, which nothing else asks.
 *
 * It is the reader's, it moves to loader/ with the rest of the reading half,
 * and until this file existed it was held only by a handful of WAVs written
 * inside tests/unit/device_roundtrip.test.ts - which is a reader checked
 * against bytes the same test wrote. The audio fixtures are eight files
 * authored from the rule, four of which no writer would ever emit, so pointing
 * this reader at them is strictly more than what it had.
 *
 * The audio kind's own `read` half is the firmware's: seekToWavData() walking
 * the chunks on the device. This is the browser end of the same eight files,
 * and the two readers agreeing about which of them are RIFF/WAVE at all is
 * something neither end could state alone.
 */

const audio = listed.filter((one) => one.kind === "audio")
  .map((one) => ({
    listed: one,
    want: readJson(one.expected),
    bytes: new Uint8Array(readFileSync(join(FIXTURES, one.file))),
  }));

describe("the WAV header reader, against the audio fixtures", () => {
  it("has fixtures to read", () => {
    expect(audio.length).toBeGreaterThan(0);
  });

  for (const { listed: one, want, bytes } of audio) {
    it(`${one.fixture}: is a RIFF/WAVE file to both readers or to neither`,
       () => {
      // The device's acceptor and this one are different code with different
      // jobs, and this is the one thing they must not disagree about: whether
      // there is a WAV here. A browser that saw a file the device would refuse
      // would refuse a build for a reason nobody could act on; a browser that
      // refused one the device takes would be the export door closing on a
      // file that works.
      expect(wavFormat(bytes) !== null, one.fixture).toBe(want.read.accepts);
    });

    if (!want.read.accepts) continue;

    it(`${one.fixture}: measures the data by what is there`, () => {
      const format = wavFormat(bytes)!;
      // data-longer-than-file declares four times what it holds. Believing the
      // declaration is how a word comes out short with nothing saying so, and
      // the fixture states both numbers so that taking the wrong one is
      // visible here rather than at a bench.
      const available = want.read.data_bytes_available ?? want.read.data_bytes;
      expect(format.dataBytes, one.fixture).toBe(available);
      if (want.read.data_bytes_declared !== undefined) {
        expect(format.dataBytes).not.toBe(want.read.data_bytes_declared);
      }
    });

    if (want.write) {
      it(`${one.fixture}: is the WAV the device plays, and says which`, () => {
        const format = wavFormat(bytes)!;
        expect(format.sampleRate).toBe(want.write.sample_rate);
        expect(format.channels).toBe(want.write.channels);
        expect(format.bitsPerSample).toBe(want.write.bits_per_sample);
        expect(isDeviceWav(format)).toBe(true);
        const perFrame = want.write.channels * (want.write.bits_per_sample / 8);
        expect(wavSeconds(format))
          .toBeCloseTo(format.dataBytes / perFrame / want.write.sample_rate, 9);
      });
    }
  }

  it("does not accept every file the device accepts", () => {
    // The whole reason this reader exists. seekToWavData() never looks at fmt,
    // so a 44.1 kHz stereo file is taken and played at 16 kHz mono - a word
    // about a third as long as it should be, at the wrong pitch, on a talker.
    // Nothing on the device refuses it and nothing can report it, so this is
    // the only place in the toolchain where that file is visible, and a
    // predicate that answered true to everything would be no place at all.
    const verdicts = new Set(audio.filter(({ want }) => want.read.accepts)
      .map(({ bytes }) => isDeviceWav(wavFormat(bytes))));
    expect([...verdicts].sort()).toEqual([false, true]);
  });
});

describe("what this file may not import", () => {
  it("names nothing out of the writing half", () => {
    /* The edit docs/split-crossings.md names as the one that would undo the
     * whole arrangement: a vendored copy of the editor's writer, added on this
     * side so that a round-trip test can be made to work locally. It would be
     * green, and what it would prove is that two functions agree with each
     * other rather than that either agrees with the format.
     *
     * The mirror of this check is at the foot of
     * tests/unit/device_package_writer.test.ts. After the split the two live
     * in two repositories and each keeps its own half. */
    const source = readFileSync(new URL(import.meta.url), "utf8");
    const imports = source.slice(0, source.indexOf("const HERE"));
    for (const name of ["buildDevicePackage", "devicePackageBytes", "digest",
                        "sniffImageType", "jsonBytes", "devicePlan",
                        "boardPath"]) {
      expect(imports.includes(`  ${name},`) || imports.includes(`${name},`),
             `${name} is the writer's`).toBe(false);
    }
  });
});
