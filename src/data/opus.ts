// Ogg Opus, in the browser, without a dependency.
//
// exchange/SPEC.md §6 requires a builder to write Ogg Opus: mono, 24 kHz into
// the encoder, 24-32 kbit/s VBR. Nothing in this project could until now - the
// device wants 16 kHz WAV and gets it from stimmquelle, and the fixtures under
// exchange/assets are rendered by ffmpeg on somebody's machine, which is no
// use to a page.
//
// So the browser does both halves:
//
//   the codec       WebCodecs' AudioEncoder, which is libopus inside Chromium
//   the container   the pages below, which are the whole of RFC 3533 that a
//                   single-stream Opus file needs
//
// **Why not a wasm build of libopus.** It would be a dependency to pin, audit
// and ship - some hundreds of kilobytes - to do a job the browser already
// does. The encoder here is the same libopus, driven through an interface that
// is part of the platform.
//
// **What the encoder gives us that matters most.** `decoderConfig.description`
// comes back as the 19-byte OpusHead, pre-skip and input rate already filled
// in. That is the field this file would otherwise have to guess at: pre-skip
// depends on the encoder's internal delay, a wrong value clips the start of
// every recording, and nothing about the file looks broken when it happens.
// Copying the encoder's own header is how this stays right if Chromium's
// libopus ever changes its delay.
//
// **Why granule positions are in 48 kHz samples** even though the input is
// 24 kHz: Opus always decodes at 48 kHz. RFC 7845 §4 defines the granule
// position in that rate, and OpusHead's input-rate field is informational.
// A conformance check asserting a 24 kHz decoded stream will fail on correct
// files - SPEC.md §6 says so too, in the paragraph that mentions the
// afternoon it costs.

/** What comes back: the file, and how long it plays. */
export interface OpusClip {
  bytes: Uint8Array<ArrayBuffer>;
  /** Seconds, from the samples that went in. `sounds[].duration` in OBF. */
  seconds: number;
}

export interface OpusOptions {
  /** Bits per second. SPEC.md §6 wants 24-32k VBR; the default is the floor. */
  bitrate?: number;
  /** The Ogg stream serial. Deterministic on purpose - see the note below. */
  serial?: number;
}

/** SPEC.md §6: the rate fed to the encoder. */
export const ENCODER_RATE = 24000;
/** The rate every Opus decoder outputs, and the one granules are counted in. */
const DECODE_RATE = 48000;
const DEFAULT_BITRATE = 24000;

/* Ogg's CRC is not the zip one.
 *
 * Same polynomial as Ethernet, and nothing else about it is the same: no
 * reflection at either end, no initial value, no final inversion. Feeding an
 * Ogg page to a CRC-32 taken from a zip writer produces a number, no warning,
 * and a file that ffprobe rejects one page in.
 */
const OGG_CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n << 24;
    for (let k = 0; k < 8; k++) c = (c & 0x80000000) ? ((c << 1) ^ 0x04c11db7) : (c << 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function oggCrc(bytes: Uint8Array<ArrayBuffer>): number {
  let crc = 0;
  for (const byte of bytes) crc = (OGG_CRC[((crc >>> 24) ^ byte) & 0xff]! ^ (crc << 8)) >>> 0;
  return crc >>> 0;
}

/** A packet on its way into a page: the bytes and what they decode to. */
interface Packet {
  data: Uint8Array<ArrayBuffer>;
  /** 48 kHz samples this packet decodes to, for the granule position. */
  samples: number;
}

const HEADER = 27;
const MAX_SEGMENTS = 255;

/** The segment table entries one packet needs: 255s, then the remainder.
 *
 * A packet whose length is an exact multiple of 255 needs a trailing zero
 * segment, or the reader has no way to know the packet ended rather than
 * continuing onto the next page. This is the lacing rule and it is the one
 * place an Ogg muxer is usually wrong.
 */
function lacing(length: number): number[] {
  const segments: number[] = [];
  let left = length;
  while (left >= 255) { segments.push(255); left -= 255; }
  segments.push(left);
  return segments;
}

/** One Ogg page, checksum included. */
function page(payload: readonly Uint8Array<ArrayBuffer>[], segments: readonly number[],
              { granule, serial, sequence, flags }:
              { granule: number; serial: number; sequence: number; flags: number }): Uint8Array<ArrayBuffer> {
  const body = payload.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(HEADER + segments.length + body);
  const view = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0);          // "OggS"
  out[4] = 0;                                     // stream structure version
  out[5] = flags;
  // A 64 bit granule position, written as two 32 bit halves: this is the one
  // field in the format that does not fit a JS number bit operation, and
  // BigInt for a value that never exceeds 2^53 here would be ceremony.
  view.setUint32(6, granule >>> 0, true);
  view.setUint32(10, Math.floor(granule / 0x100000000), true);
  view.setUint32(14, serial >>> 0, true);
  view.setUint32(18, sequence >>> 0, true);
  view.setUint32(22, 0, true);                    // checksum, filled in below
  out[26] = segments.length;
  out.set(segments, HEADER);
  let at = HEADER + segments.length;
  for (const part of payload) { out.set(part, at); at += part.length; }
  view.setUint32(22, oggCrc(out), true);
  return out;
}

/** The OpusTags header. One required vendor string, no comments. */
function opusTags(): Uint8Array<ArrayBuffer> {
  const vendor = new TextEncoder().encode("vorlaut");
  const out = new Uint8Array(8 + 4 + vendor.length + 4);
  out.set(new TextEncoder().encode("OpusTags"), 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, vendor.length, true);
  out.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true);    // no user comments
  return out;
}

/**
 * The packets as an Ogg stream: OpusHead, OpusTags, then the audio.
 *
 * Packets are packed into pages until the segment table is full. The granule
 * position on a page is the running total of decoded samples at the *end* of
 * it, which is what lets a player seek without decoding, and the last page
 * carries the end-of-stream flag - a file without one is truncated as far as
 * every decoder is concerned, even when every byte is present.
 */
function ogg(head: Uint8Array<ArrayBuffer>, packets: readonly Packet[], serial: number): Uint8Array<ArrayBuffer> {
  const pages: Uint8Array<ArrayBuffer>[] = [];
  let sequence = 0;

  // The two headers each get a page of their own, which the format requires:
  // OpusHead must be alone on the first page, and OpusTags must end before
  // the first audio packet begins.
  pages.push(page([head], lacing(head.length),
                  { granule: 0, serial, sequence: sequence++, flags: 0x02 }));
  const tags = opusTags();
  pages.push(page([tags], lacing(tags.length),
                  { granule: 0, serial, sequence: sequence++, flags: 0x00 }));

  let granule = 0;
  let held: Uint8Array<ArrayBuffer>[] = [];
  let segments: number[] = [];
  for (const [index, packet] of packets.entries()) {
    const wanted = lacing(packet.data.length);
    if (segments.length + wanted.length > MAX_SEGMENTS) {
      pages.push(page(held, segments, { granule, serial, sequence: sequence++, flags: 0 }));
      held = [];
      segments = [];
    }
    held.push(packet.data);
    segments.push(...wanted);
    granule += packet.samples;
    const last = index === packets.length - 1;
    if (last) {
      pages.push(page(held, segments,
                      { granule, serial, sequence: sequence++, flags: 0x04 }));
    }
  }

  const total = pages.reduce((sum, one) => sum + one.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const one of pages) { out.set(one, at); at += one.length; }
  return out;
}

/** True where this browser can encode Opus at all. */
export const canEncodeOpus = (): boolean => typeof globalThis.AudioEncoder === "function";

/**
 * Mono samples in, an Ogg Opus file out.
 *
 * `rate` is the rate the samples are at, and it is passed to the encoder
 * unchanged rather than resampled here: stimmquelle levels at whatever rate it
 * is asked for, so the master arrives at ENCODER_RATE already and a resample
 * in this file would be a second one for nothing.
 *
 * The serial defaults to a fixed number rather than a random one. A random
 * serial is what a live stream needs, where several may be multiplexed; a file
 * holding one stream needs only that it be consistent, and a stable value
 * means an unchanged Sammlung exports to unchanged bytes.
 */
export async function encodeOpus(
  samples: Float32Array, rate: number, options: OpusOptions = {},
): Promise<OpusClip> {
  if (!canEncodeOpus()) {
    throw new Error(
      "This browser cannot encode Opus: it has no WebCodecs AudioEncoder. " +
      "An app package needs one; the export for the device does not.");
  }
  const packets: Packet[] = [];
  let head: Uint8Array<ArrayBuffer> | null = null;
  let failure: Error | null = null;

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const description = metadata?.decoderConfig?.description;
      // Chromium sends the OpusHead with the first chunk and not again. Taking
      // it from the encoder rather than writing one here is what keeps the
      // pre-skip honest - see the note at the top of this file.
      if (description && !head) {
        head = description instanceof ArrayBuffer
          ? new Uint8Array(description)
          : new Uint8Array(ArrayBuffer.prototype.slice.call(
              (description as ArrayBufferView).buffer,
              (description as ArrayBufferView).byteOffset,
              (description as ArrayBufferView).byteOffset + (description as ArrayBufferView).byteLength));
      }
      const data = new Uint8Array(new ArrayBuffer(chunk.byteLength));
      chunk.copyTo(data);
      packets.push({
        data,
        samples: Math.round((chunk.duration ?? 0) * DECODE_RATE / 1_000_000),
      });
    },
    error: (error) => { failure = error as Error; },
  });

  encoder.configure({
    codec: "opus",
    sampleRate: rate,
    numberOfChannels: 1,
    bitrate: options.bitrate ?? DEFAULT_BITRATE,
  });
  encoder.encode(new AudioData({
    format: "f32-planar",
    sampleRate: rate,
    numberOfFrames: samples.length,
    numberOfChannels: 1,
    timestamp: 0,
    data: samples as unknown as BufferSource,
  }));
  await encoder.flush();
  encoder.close();

  if (failure) throw failure;
  if (!head) throw new Error("the Opus encoder produced no OpusHead");
  if (!packets.length) throw new Error("the Opus encoder produced no audio");

  return {
    bytes: ogg(head, packets, options.serial ?? 0x766f726c /* "vorl" */),
    seconds: samples.length / rate,
  };
}
