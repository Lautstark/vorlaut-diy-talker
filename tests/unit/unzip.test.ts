import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { NotAPackage, unzip } from "../../loader/src/unzip.js";

/* loader/src/unzip.ts against a member whose deflate data is broken.
 *
 * The read side of the platform's decompressor throws first, and inflate()
 * used to leave on that throw without ever awaiting its own write - so the
 * write's rejection was an unhandled one, and what reached the page was a
 * TypeError with an empty message. main.ts tells a NotAPackage apart from a
 * bug in the page, and an empty TypeError is the second; a damaged file is
 * the first.
 *
 * The archive is laid out here by hand, one member and the three records a zip
 * needs, rather than taken from a fixture: what is under test is a zip whose
 * framing is sound and whose data is not, and no tool writes one of those on
 * purpose. */

/** A one-member zip with `data` as the member's bytes, under `method`. */
function zipOf(name: string, data: Uint8Array, method: number): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + encoded.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, method, true);
  lv.setUint32(18, data.length, true);
  lv.setUint16(26, encoded.length, true);
  local.set(encoded, 30);

  const central = new Uint8Array(46 + encoded.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, method, true);
  cv.setUint32(20, data.length, true);
  cv.setUint16(28, encoded.length, true);
  cv.setUint32(42, 0, true);
  central.set(encoded, 46);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);

  const out = new Uint8Array(local.length + data.length + central.length + end.length);
  out.set(local, 0);
  out.set(data, local.length);
  out.set(central, local.length + data.length);
  out.set(end, local.length + data.length + central.length);
  return out;
}

describe("a deflated member", () => {
  it("unpacks when its data is sound", async () => {
    // The control: the same framing with real deflate data in it, so the
    // refusal below is about the data and not about the hand-laid zip.
    const text = "breakfast ".repeat(50);
    const members = await unzip(
      zipOf("boards/set-1.obf", deflateRawSync(Buffer.from(text)), 8));
    expect(new TextDecoder().decode(members.get("boards/set-1.obf")))
      .toBe(text);
  });

  it("is refused as a damaged file, named, and leaves nothing unhandled", async () => {
    const stray: unknown[] = [];
    const notice = (why: unknown) => { stray.push(why); };
    process.on("unhandledRejection", notice);
    try {
      const broken = zipOf("boards/set-1.obf",
                           new Uint8Array([0xff, 0xff, 0xff, 0xff, 1, 2, 3]), 8);
      const thrown = await unzip(broken).then(() => null, (error) => error);
      expect(thrown).toBeInstanceOf(NotAPackage);
      expect(thrown.message).toContain("boards/set-1.obf");
      // Long enough for a rejection nobody handled to have been reported.
      await new Promise((settle) => setTimeout(settle, 50));
      expect(stray).toEqual([]);
    } finally {
      process.off("unhandledRejection", notice);
    }
  });
});
