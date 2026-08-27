import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
/* The writer's half of src/data/device_package.ts, and nothing else out of it.
 * readDevicePackage(), planLayout(), wavFormat() and wavSeconds() are the
 * reader's names and are deliberately absent - see "what this file may not
 * import" at the foot. */
import {
  buildDevicePackage, devicePackageBytes, digest, sniffImageType,
  type DeviceSound, type DeviceSource,
} from "../../src/data/device_package.js";
import type { DiyLayout } from "../../src/core/types.js";
import { unzip } from "./obz.js";

/* The editor's half of device/fixtures/package/.
 *
 * This file used to be half of tests/unit/device_roundtrip.test.ts, which held
 * buildDevicePackage() against compileDevice() in one process. That was the
 * most valuable check on the boundary adr/0011 drew and it was also the one
 * the split deletes: after it, no repository has both halves. adr/0013 is the
 * decision that replaced it with a fixture kind, and this is the writing half
 * of that replacement.
 *
 * What is asked here: given the Sammlung a fixture states, the pictures behind
 * its references and the recordings behind its sentences, buildDevicePackage()
 * must produce exactly the manifest and the board documents the fixture holds,
 * and exactly its members. Where a fixture is a refusal with a write half, the
 * writer must refuse it and say so in words the fixture names.
 *
 * The fixture is the meeting point and it is the only one. Nothing here reads
 * anything the reader produced, and tests/unit/device_package_reader.test.ts
 * reads nothing this produced - which is what makes the pair survive being put
 * in two repositories, and what makes it worth having in one.
 *
 * The archive is opened with the suite's own zip reader (tests/unit/obz.ts)
 * rather than with the loader's, because the fixture's bytes are the input
 * here and not the thing under test. Opening it at all is what lets the
 * pictures and the WAVs live once, in the artefact, instead of a second time
 * as base64 in an expectation that could drift from it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "..", "device", "fixtures");

const readJson = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const index = readJson("index.json");
const listed: any[] = index.fixtures;
const packages = listed.filter((one) => one.kind === "package")
  .map((one) => ({ listed: one, want: readJson(one.expected) }));

/** A copy with a buffer of its own.
 *
 * new Uint8Array(view) rather than the view itself, and the difference is not
 * cosmetic: readFileSync answers with a Buffer out of node's shared pool and
 * every member sliced out of it is a view into that pool. Three pictures read
 * that way hash identically and collapse into one member of the archive -
 * which is a green test asserting almost nothing. */
const owned = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;

const memberBytes = (want: any): Map<string, Uint8Array<ArrayBuffer>> => {
  const out = new Map<string, Uint8Array<ArrayBuffer>>();
  if (!want.file) return out;
  for (const [name, entry] of unzip(readFileSync(join(FIXTURES, want.file)))) {
    out.set(name, owned(entry.data));
  }
  return out;
};

/** The word a refusal has to contain, as a pattern rather than a whole
 *  sentence: a fixture that pinned the message would be a fixture about
 *  wording, and the wording is allowed to improve. */
const saying = (fragment: string) =>
  new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

describe("device/fixtures/package/ has a writing half at all", () => {
  it("lists package fixtures, and some of them state what a writer produces", () => {
    // Without this the whole file is green on an index that lost the kind,
    // which is the failure mode this repository has been bitten by twice.
    expect(packages.length).toBeGreaterThan(0);
    expect(packages.filter(({ want }) => want.write !== null).length)
      .toBeGreaterThan(0);
    expect(packages.filter(({ want }) => want.write?.refuses).length)
      .toBeGreaterThan(0);
  });
});

for (const { listed: one, want } of packages) {
  if (want.write === null) continue;

  describe(`${one.fixture}: what a writer must produce`, () => {
    const members = memberBytes(want);

    /** The input the fixture states, with the bytes taken out of its own
     *  archive. digest() and sniffImageType() are asked rather than told: the
     *  fixture states what each must answer, so the two names the editor owns
     *  on this path are held to it here rather than assumed. */
    const inputFrom = async () => {
      const sources = new Map<string, DeviceSource>();
      for (const source of want.write.sources) {
        const bytes = members.get(source.member);
        expect(bytes, `${source.member} is in the fixture's archive`)
          .toBeDefined();
        expect(sniffImageType(bytes!), source.reference)
          .toBe(source.content_type);
        const key = await digest(bytes!);
        expect(key, `${source.reference} is named for its content`)
          .toBe(source.key);
        sources.set(source.reference, {
          key, bytes: bytes!, contentType: source.content_type,
        });
      }
      const sounds = new Map<string, DeviceSound>();
      for (const sound of want.write.sounds) {
        const bytes = members.get(sound.member);
        expect(bytes, `${sound.member} is in the fixture's archive`)
          .toBeDefined();
        sounds.set(sound.text, { name: sound.name, bytes: bytes! });
      }
      return {
        layout: want.write.layout as DiyLayout,
        voice: want.write.voice as string,
        sources,
        sounds,
      };
    };

    if (want.write.refuses) {
      it(`refuses it, saying "${want.write.refuses}"`, async () => {
        const input = await inputFrom();
        expect(() => buildDevicePackage(input))
          .toThrow(saying(want.write.refuses));
      });
      return;
    }

    it("writes the manifest the fixture holds", async () => {
      const pkg = buildDevicePackage(await inputFrom());
      expect(pkg.manifest).toEqual(want.manifest);
    });

    it("writes the board documents the fixture holds", async () => {
      const pkg = buildDevicePackage(await inputFrom());
      // Whole documents rather than field by field. Every one of the four form
      // rules lives in here somewhere - the source travelling unresampled, the
      // cross as a flag, the WAV under the device's own name, the language the
      // Sammlung's own - and a per-field check would be a list somebody has to
      // remember to extend.
      expect(pkg.boards).toEqual(want.boards);
    });

    it("puts exactly the fixture's members in it, byte for byte", async () => {
      const pkg = buildDevicePackage(await inputFrom());
      const wanted = (want.members as any[])
        .map((each) => each.path as string)
        .filter((path) => path !== "manifest.json" && !path.endsWith(".obf"));
      // The names first, because a difference here says which file went
      // missing rather than that some byte somewhere moved.
      expect([...pkg.files.keys()].sort()).toEqual([...wanted].sort());
      for (const path of wanted) {
        expect(Buffer.from(pkg.files.get(path)!), path)
          .toEqual(Buffer.from(members.get(path)!));
      }
    });

    it("writes an archive that opens, with the manifest first in it", async () => {
      // What this file says about the container, and all it says. The order is
      // the format's - manifest, then boards, then media, so that `unzip -l`
      // reads in the order the format describes itself in - and the
      // COMPRESSION is not: the fixtures are stored because a directory that
      // must regenerate byte for byte cannot depend on a deflate
      // implementation, and a conforming writer may deflate. So the bytes of
      // the two archives are not compared and must not be.
      const bytes = await devicePackageBytes(buildDevicePackage(await inputFrom()));
      expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
      const nameLength = new DataView(bytes.buffer, bytes.byteOffset,
                                      bytes.byteLength).getUint16(26, true);
      expect(new TextDecoder().decode(bytes.slice(30, 30 + nameLength)))
        .toBe("manifest.json");
    });
  });
}

describe("what this file may not import", () => {
  it("names nothing out of the reading half", () => {
    /* The one edit that would quietly undo the whole arrangement: a reader
     * pulled in here so that a check could be made "properly", against what
     * the other half makes of what this half wrote. That is the round trip
     * again, in a repository that after the split has only one end of it, and
     * it would be green while proving that two functions in one file agree.
     *
     * docs/split-crossings.md names the mirror of this on the talker's side -
     * a vendored copy of the writer, added to make a round-trip test work
     * locally - as the edit that would undo hard case one's answer. Same edit,
     * same rule, and this is the half of it that can be checked here. */
    const source = readFileSync(new URL(import.meta.url), "utf8");
    const imports = source.slice(0, source.indexOf("const HERE"));
    for (const name of ["readDevicePackage", "planLayout", "compileDevice",
                        "readPackageFile", "wavFormat", "wavSeconds",
                        "isDeviceWav"]) {
      expect(imports.includes(`  ${name},`) || imports.includes(`${name} }`),
             `${name} is the reader's`).toBe(false);
    }
  });
});
