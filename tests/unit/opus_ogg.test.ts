import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canEncodeOpus, encodeOpus } from "../../src/data/opus.js";

/* The Ogg container, checked by reading it back.
 *
 * The codec is stubbed and the container is not, which is the right way round:
 * libopus is Chromium's and needs no test here, while the pages around it are
 * this repository's own and are the part that is easy to get quietly wrong. A
 * wrong granule position or a missing end-of-stream flag produces a file that
 * plays in the tool you happen to try and is truncated in the one somebody
 * else uses, which is not a failure any manual check finds.
 *
 * What the stub gives is packet lengths chosen on purpose - one of exactly 255
 * bytes, one over it, and enough packets to fill a segment table - because
 * lacing is where an Ogg muxer is usually wrong and those are the three cases
 * that tell a right one from a plausible one.
 *
 * e2e/app_package.spec.ts runs the same encoder against the real WebCodecs in
 * a browser. This one says the container is right; that one says the whole
 * thing works where it actually has to.
 */

/** The 19 bytes Chromium hands over as decoderConfig.description. */
const OPUS_HEAD = new Uint8Array([
  0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,   // "OpusHead"
  1,                                                 // version
  1,                                                 // channels
  0x9c, 0x00,                                        // pre-skip, 156
  0xc0, 0x5d, 0x00, 0x00,                            // input rate, 24000
  0, 0,                                              // output gain
  0,                                                 // channel mapping
]);

const FRAME_US = 20_000;

/** An encoder that emits packets of the lengths it is told to. */
function stubCodec(lengths: readonly number[], { head = OPUS_HEAD } = {}): void {
  class FakeAudioData {
    constructor(readonly init: Record<string, unknown>) {}
  }
  class FakeAudioEncoder {
    constructor(private readonly callbacks: {
      output: (chunk: unknown, metadata?: unknown) => void;
      error: (error: Error) => void;
    }) {}
    configure(): void {}
    encode(): void {
      for (const [at, length] of lengths.entries()) {
        const data = new Uint8Array(length).fill((at % 251) + 1);
        const chunk = {
          byteLength: length,
          timestamp: at * FRAME_US,
          duration: FRAME_US,
          copyTo: (into: Uint8Array) => into.set(data),
        };
        this.callbacks.output(chunk, at === 0 ? { decoderConfig: { description: head } } : undefined);
      }
    }
    async flush(): Promise<void> {}
    close(): void {}
  }
  (globalThis as Record<string, unknown>).AudioEncoder = FakeAudioEncoder;
  (globalThis as Record<string, unknown>).AudioData = FakeAudioData;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).AudioEncoder;
  delete (globalThis as Record<string, unknown>).AudioData;
});

interface Page {
  flags: number;
  granule: number;
  serial: number;
  sequence: number;
  segments: number[];
  body: Uint8Array;
  crcOk: boolean;
}

/** Ogg's own CRC.
 *
 * A second implementation would only say that two pieces of this repository
 * agree, so this one is calibrated instead against a file ffmpeg wrote: the
 * clip under exchange/assets, whose page checksums are libogg's own. The test
 * below that does it is the reason this function can be trusted here at all.
 */
function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    let entry = (((crc >>> 24) ^ byte) & 0xff) << 24;
    for (let bit = 0; bit < 8; bit++) {
      entry = (entry & 0x80000000) ? ((entry << 1) ^ 0x04c11db7) >>> 0 : (entry << 1) >>> 0;
    }
    crc = ((crc << 8) ^ entry) >>> 0;
  }
  return crc >>> 0;
}

function pages(bytes: Uint8Array): Page[] {
  const out: Page[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at < bytes.length) {
    expect(String.fromCharCode(...bytes.slice(at, at + 4))).toBe("OggS");
    const count = bytes[at + 26]!;
    const segments = [...bytes.slice(at + 27, at + 27 + count)];
    const bodyLength = segments.reduce((sum, one) => sum + one, 0);
    const headerLength = 27 + count;

    const copy = bytes.slice(at, at + headerLength + bodyLength);
    const stated = new DataView(copy.buffer, copy.byteOffset).getUint32(22, true);
    new DataView(copy.buffer, copy.byteOffset).setUint32(22, 0, true);

    out.push({
      flags: bytes[at + 5]!,
      granule: view.getUint32(at + 6, true) + view.getUint32(at + 10, true) * 0x100000000,
      serial: view.getUint32(at + 14, true),
      sequence: view.getUint32(at + 18, true),
      segments,
      body: bytes.slice(at + headerLength, at + headerLength + bodyLength),
      crcOk: oggCrc(copy) === stated,
    });
    at += headerLength + bodyLength;
  }
  return out;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("the checksum this test checks pages with", () => {
  it("agrees with the one ffmpeg wrote into a real clip", () => {
    // exchange/assets/clip-a.opus is rendered by ffmpeg with libopus, and its
    // page checksums are libogg's. If this passes, a page of ours that fails
    // is our page and not this arithmetic.
    const real = new Uint8Array(readFileSync(
      join(import.meta.dirname, "..", "..", "exchange", "assets", "clip-a.opus")));
    const all = pages(real);
    expect(all.length).toBeGreaterThan(2);
    expect(all.every((one) => one.crcOk)).toBe(true);
    expect(text(all[0]!.body).startsWith("OpusHead")).toBe(true);
  });
});

describe("the Ogg Opus a browser writes", () => {
  it("opens with OpusHead alone, then OpusTags", async () => {
    stubCodec([80, 70, 60]);
    const clip = await encodeOpus(new Float32Array(24000), 24000);
    const [head, tags] = pages(clip.bytes);

    // Page 0 carries the beginning-of-stream flag and nothing but the header.
    expect(head!.flags).toBe(0x02);
    expect(head!.granule).toBe(0);
    expect(head!.body).toEqual(OPUS_HEAD);
    // The encoder's own header, byte for byte: pre-skip is the field this
    // could not otherwise know, and a wrong one clips the start of every clip.
    expect(head!.body.slice(10, 12)).toEqual(new Uint8Array([0x9c, 0x00]));

    expect(tags!.flags).toBe(0);
    expect(text(tags!.body).startsWith("OpusTags")).toBe(true);
    expect(tags!.granule).toBe(0);
  });

  it("counts granules in 48 kHz samples, whatever went in", async () => {
    stubCodec([80, 70, 60, 50]);
    const clip = await encodeOpus(new Float32Array(24000), 24000);
    const last = pages(clip.bytes).at(-1)!;
    // Four 20 ms packets: 4 x 960 samples at the rate Opus always decodes at,
    // not at the 24 kHz the encoder was fed. RFC 7845 §4.
    expect(last.granule).toBe(4 * 960);
    expect(clip.seconds).toBe(1);
  });

  it("ends the stream, and says so on the last page", async () => {
    stubCodec([80, 70]);
    const all = pages((await encodeOpus(new Float32Array(2400), 24000)).bytes);
    expect(all.at(-1)!.flags).toBe(0x04);
    // A file whose last page has no end-of-stream flag is truncated as far as
    // a decoder is concerned, even with every byte present.
    expect(all.filter((one) => one.flags & 0x04)).toHaveLength(1);
    expect(all.map((one) => one.sequence)).toEqual(all.map((_, at) => at));
    expect(new Set(all.map((one) => one.serial)).size).toBe(1);
  });

  it("checksums every page", async () => {
    stubCodec([80, 300, 255, 70]);
    const all = pages((await encodeOpus(new Float32Array(4800), 24000)).bytes);
    expect(all.every((one) => one.crcOk)).toBe(true);
  });

  it("laces a packet of exactly 255 bytes with a zero segment after it", async () => {
    stubCodec([255]);
    const audio = pages((await encodeOpus(new Float32Array(1200), 24000)).bytes)[2]!;
    // Without the trailing zero a reader cannot tell the packet ended from a
    // packet continuing onto the next page. This is the lacing rule.
    expect(audio.segments).toEqual([255, 0]);
    expect(audio.body).toHaveLength(255);
  });

  it("laces a long packet into 255s and a remainder", async () => {
    stubCodec([600]);
    const audio = pages((await encodeOpus(new Float32Array(1200), 24000)).bytes)[2]!;
    expect(audio.segments).toEqual([255, 255, 90]);
  });

  it("starts a new page when the segment table is full", async () => {
    // 300 packets, each one segment, so the table fills at 255 and the rest go
    // on a second page.
    stubCodec(Array.from({ length: 300 }, () => 40));
    const all = pages((await encodeOpus(new Float32Array(144000), 24000)).bytes);
    const audio = all.slice(2);
    expect(audio).toHaveLength(2);
    expect(audio[0]!.segments).toHaveLength(255);
    expect(audio[1]!.segments).toHaveLength(45);
    // The granule on a page is the running total at the *end* of it, which is
    // what lets a player seek without decoding.
    expect(audio[0]!.granule).toBe(255 * 960);
    expect(audio[1]!.granule).toBe(300 * 960);
    expect(audio.every((one) => one.crcOk)).toBe(true);
  });

  it("says so where the browser cannot encode Opus at all", async () => {
    expect(canEncodeOpus()).toBe(false);
    await expect(encodeOpus(new Float32Array(2400), 24000))
      .rejects.toThrow(/WebCodecs AudioEncoder/);
  });
});
