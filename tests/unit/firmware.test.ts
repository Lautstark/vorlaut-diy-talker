import { afterEach, describe, expect, it } from "vitest";
import {
  type Carried, carriedFirmware, firmwareBytes, firmwareVerdict,
} from "../../loader/src/firmware.js";
import { Trouble } from "../../loader/src/errors.js";

/* The firmware the deployed page carries - adr/0017.
 *
 * Everything here is the half of that decision that can be checked without a
 * chip on the end of a cable, and that division is deliberate rather than
 * convenient: loader/src/flash.ts is the ROM protocol and belongs to
 * esptool-js, and what is left over is which image, whether it arrived whole,
 * and what its name means beside the one a device said. All three are
 * arithmetic, and all three are where a wrong answer costs somebody their
 * firmware.
 */

const MANIFEST: Carried = {
  release: "v0.4",
  url: "https://example.invalid/releases/tag/v0.4",
  chip: "esp32s3",
  flashSize: "8MB",
  flashMode: "dio",
  flashFreq: "80m",
  whole: { file: "whole.bin", address: 0, bytes: 4, sha256: "" },
  program: { file: "program.bin", address: 0x10000, bytes: 4, sha256: "" },
};

/** The one fetch this page makes, stood in for. */
function serving(files: Record<string, unknown>): void {
  globalThis.fetch = (async (input: string | URL) => {
    const name = String(input).split("/").pop()!;
    const found = files[name];
    if (found === undefined) return { ok: false, status: 404 } as Response;
    if (found instanceof Uint8Array) {
      return {
        ok: true,
        arrayBuffer: async () => found.buffer.slice(
          found.byteOffset, found.byteOffset + found.byteLength),
      } as unknown as Response;
    }
    return { ok: true, json: async () => found } as unknown as Response;
  }) as typeof fetch;
}

const sum = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");

const started = globalThis.fetch;
afterEach(() => { globalThis.fetch = started; });

describe("what the deploy carries", () => {
  it("is the manifest it wrote", async () => {
    serving({ "firmware.json": MANIFEST });
    expect((await carriedFirmware())?.release).toBe("v0.4");
  });

  /* Three ways of having no image, and they are one answer on purpose: a
     deploy with no release cut (which is every deploy so far), a deploy from
     before any of this existed, and a manifest this page cannot read. The
     section is absent in all three, because a section that cannot do anything
     is worse than no section. */
  it("is null when no release has been cut", async () => {
    serving({ "firmware.json": { release: null, why: "nothing published" } });
    expect(await carriedFirmware()).toBe(null);
  });

  it("is null when the deploy has no manifest at all", async () => {
    serving({});
    expect(await carriedFirmware()).toBe(null);
  });

  it("is null when the manifest names a release but carries no pieces",
     async () => {
       serving({ "firmware.json": { release: "v0.4" } });
       expect(await carriedFirmware()).toBe(null);
     });
});

describe("the bytes of a piece", () => {
  it("come back when the length and the sum are the ones the manifest names",
     async () => {
       const bytes = new Uint8Array([1, 2, 3, 4]);
       serving({ "whole.bin": bytes });
       const piece = { ...MANIFEST.whole, sha256: await sum(bytes) };
       expect(await firmwareBytes(piece)).toEqual(bytes);
     });

  /* The realistic corruption. A browser that lost the connection halfway hands
     back what it got, with no error of its own - so the length is checked
     before anything is written rather than discovered by a chip. */
  it("refuse a response that was cut short", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    serving({ "whole.bin": bytes });
    const piece = { ...MANIFEST.whole, sha256: await sum(bytes) };
    await expect(firmwareBytes(piece)).rejects.toMatchObject(
      { word: "firmware_wrong_size" });
  });

  it("refuse a response of the right length and the wrong content", async () => {
    serving({ "whole.bin": new Uint8Array([1, 2, 3, 9]) });
    const piece = {
      ...MANIFEST.whole, sha256: await sum(new Uint8Array([1, 2, 3, 4])),
    };
    await expect(firmwareBytes(piece)).rejects.toMatchObject(
      { word: "firmware_wrong_sum" });
  });

  it("refuse a file the deploy does not have", async () => {
    serving({});
    const caught = await firmwareBytes(MANIFEST.whole).catch((e) => e);
    expect(caught).toBeInstanceOf(Trouble);
    expect(caught.word).toBe("firmware_not_fetched");
  });
});

/* The comparison, which is the one piece of judgement on this page that can
 * end with somebody's firmware overwritten. Every row states both words in the
 * order the function takes them - what the device said, then what the page
 * carries. */
describe("what a device's word means beside the page's", () => {
  const rows: [string, string, string][] = [
    ["v0.4", "v0.4", "same"],
    ["v0.3", "v0.4", "device_older"],
    ["v0.5", "v0.4", "device_newer"],
    // A missing rung is a zero rather than a difference, so these are the same
    // release written two ways.
    ["v1.0.0", "v1.0", "same"],
    ["v1.0", "v1.0.1", "device_older"],
    // Numbers, not text. Sorted as text, v0.10 is behind v0.9 - and a page
    // that made that mistake would offer to write an older image over a newer
    // device, which is the one direction that loses something.
    ["v0.10", "v0.9", "device_newer"],
    ["v0.9", "v0.10", "device_older"],
    // What every build release.yml did not compile calls itself. Not older,
    // not newer: not a version, and the page says so rather than guessing.
    ["dev", "v0.4", "unorderable"],
    ["v0.4", "dev", "unorderable"],
    // A device flashed before the greeting named a build at all.
    ["", "v0.4", "unorderable"],
    // Shapes that are nearly tags and are not.
    ["0.4", "v0.4", "unorderable"],
    ["v0.4-rc1", "v0.4", "unorderable"],
    ["v", "v0.4", "unorderable"],
  ];
  for (const [theirs, ours, want] of rows) {
    it(`${theirs || "(silent)"} against ${ours} is ${want}`, () => {
      expect(firmwareVerdict(theirs, ours)).toBe(want);
    });
  }

  /* And the verdict is not constant. Three of the four are reachable from the
     rows above and the fourth is the one a lazy implementation would return
     for everything, so this says out loud that all four occur - the same
     argument the cable transcripts make about version_verdict. */
  it("reaches all four verdicts", () => {
    const seen = new Set(rows.map(([a, b]) => firmwareVerdict(a, b)));
    expect([...seen].sort().join(", "))
      .toBe("device_newer, device_older, same, unorderable");
  });
});
