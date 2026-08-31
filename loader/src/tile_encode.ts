/* The compressed form of a t<hash>.bin, written here and read by
 * firmware/vorlaut/tile_format.h.
 *
 * What a raw tile costs is the wait at the cable: a full board is 25 pictures
 * and 800 KB, the cable moves 60 KB a second, and that is thirteen seconds of
 * somebody holding a talker still every time a board changes. The format
 * itself is written down in tile_format.h and stated by device/fixtures/tile/;
 * adr/0019 is why it is a palette and a run length rather than deflate, and
 * why the room on the partition is no longer part of the argument.
 *
 * Two rules keep the two forms from ever being confused for one another:
 *
 *   The raw form is exactly TILE_BYTES long and has no header, so **a
 *   compressed file must never come out at exactly that length**. encodeTile()
 *   returns the raw bytes unchanged whenever the encoding is not smaller,
 *   which is also what keeps a tile that does not compress from costing more
 *   than it did before.
 *
 *   The file name does not change. It is a hash of the *pixels*, not of the
 *   file, so one picture is one name in either form - which is what lets a
 *   talker holding raw tiles and a browser sending compressed ones agree about
 *   what is already there. docs/tile-rendering.md has the argument for why
 *   TILE_PIPELINE does not move for this: the hazard that number exists for is
 *   two renderers producing different *pixels* under one name, and both forms
 *   here decode to the same ones.
 */

import { TILE_SIZE } from "./tiles.js";

/** The three bytes a compressed tile starts with. */
export const TILE_MAGIC = "vt1";
/** How long the raw form is, and the length that means "raw". */
export const TILE_BYTES = TILE_SIZE * TILE_SIZE * 2;

const PIXELS = TILE_SIZE * TILE_SIZE;
const PALETTE_MAX = 256;
const RUN_MAX = 129;        // op 0x00..0x7f carries op + 2
const LITERAL_MAX = 64;     // op 0x80.. and 0xc0.. carry (op & 0x3f) + 1

/** The pixels of a raw tile, as RGB565 values in the file's own order. */
function pixelsOf(raw: Uint8Array): Uint16Array {
  const out = new Uint16Array(raw.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (raw[2 * i]! << 8) | raw[2 * i + 1]!;
  return out;
}

/**
 * A tile, compressed - or the same bytes back if that would not be smaller.
 *
 * Takes and returns the raw form rather than pixels, because every caller has
 * a file in its hand rather than a canvas: the compile produces raw tiles and
 * this is applied to them on the way to a talker that says it can read them.
 *
 * The palette holds the 256 most common colours and everything else is written
 * out as a pixel, which is what lets an anti-aliased symbol past 256 colours
 * compress at all - five of the fourteen frozen tiles are past it.
 */
export function encodeTile(raw: Uint8Array): Uint8Array {
  if (raw.length !== TILE_BYTES) return raw;
  const px = pixelsOf(raw);

  const seen = new Map<number, number>();
  for (const value of px) seen.set(value, (seen.get(value) ?? 0) + 1);
  const palette = [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, PALETTE_MAX)
    .map(([value]) => value);
  const index = new Map(palette.map((value, at) => [value, at]));

  const out: number[] = [
    TILE_MAGIC.charCodeAt(0), TILE_MAGIC.charCodeAt(1), TILE_MAGIC.charCodeAt(2),
    palette.length - 1,
  ];
  for (const value of palette) out.push(value >> 8, value & 0xff);

  /* Pixels waiting to go out as literals. Held rather than written one at a
   * time because the opcode carries the count, and because a stretch that is
   * all in the palette costs half of one that is not. */
  let pending: number[] = [];
  const flush = () => {
    while (pending.length) {
      const take = pending.slice(0, LITERAL_MAX);
      pending = pending.slice(LITERAL_MAX);
      if (take.every((value) => index.has(value))) {
        out.push(0x80 | (take.length - 1));
        for (const value of take) out.push(index.get(value)!);
      } else {
        out.push(0xc0 | (take.length - 1));
        for (const value of take) out.push(value >> 8, value & 0xff);
      }
    }
  };

  for (let i = 0; i < PIXELS;) {
    let run = 1;
    while (i + run < PIXELS && px[i + run] === px[i] && run < RUN_MAX) run++;
    // Two is where a run starts paying: one pixel is two bytes as a run and
    // one as a palette literal. A colour the palette does not hold has no
    // index to run on, so it goes out as a literal however long it is.
    if (run >= 2 && index.has(px[i]!)) {
      flush();
      out.push(run - 2, index.get(px[i]!)!);
      i += run;
    } else {
      pending.push(px[i]!);
      if (pending.length === LITERAL_MAX) flush();
      i++;
    }
  }
  flush();

  // Not smaller is not worth having, and exactly TILE_BYTES long would be
  // unreadable - the length is what says which form a file is in.
  return out.length < TILE_BYTES ? Uint8Array.from(out) : raw;
}

/**
 * The other direction, for tests and for anything on this side that has to
 * look at a tile after it has been encoded.
 *
 * Reads what tile_format.h reads, including its forgiveness: a stream that
 * stops early leaves the rest of the tile black, and everything past the last
 * pixel is ignored. Returns null for a file that is neither form, which is
 * what the firmware refuses.
 */
export function decodeTile(data: Uint8Array): Uint8Array | null {
  if (data.length === TILE_BYTES) return data;
  if (data.length < 4 || data[0] !== 0x76 || data[1] !== 0x74 || data[2] !== 0x31) {
    return null;
  }
  const colours = data[3]! + 1;
  if (data.length < 4 + 2 * colours) return null;
  const palette = new Uint16Array(PALETTE_MAX);
  for (let i = 0; i < colours; i++) {
    palette[i] = (data[4 + 2 * i]! << 8) | data[5 + 2 * i]!;
  }

  const out = new Uint8Array(TILE_BYTES);
  let at = 4 + 2 * colours;
  let pixel = 0;
  const emit = (value: number) => {
    out[2 * pixel] = value >> 8;
    out[2 * pixel + 1] = value & 0xff;
    pixel++;
  };
  while (pixel < PIXELS && at < data.length) {
    const op = data[at++]!;
    if (op < 0x80) {
      if (at >= data.length) break;
      const value = palette[data[at++]!]!;
      for (let n = op + 2; n > 0 && pixel < PIXELS; n--) emit(value);
    } else if (op < 0xc0) {
      for (let n = (op & 0x3f) + 1; n > 0 && pixel < PIXELS; n--) {
        if (at >= data.length) break;
        emit(palette[data[at++]!]!);
      }
    } else {
      for (let n = (op & 0x3f) + 1; n > 0 && pixel < PIXELS; n--) {
        if (at + 1 >= data.length) break;
        emit((data[at]! << 8) | data[at + 1]!);
        at += 2;
      }
    }
  }
  return out;   // whatever did not arrive is already black
}

/** Whether a file is one of the tiles this applies to. */
export function isTile(name: string): boolean {
  return name.startsWith("t") && name.endsWith(".bin");
}

/**
 * A build, as the talker in front of us should receive it.
 *
 * The decision rather than the transport, exported for the same reason plan()
 * and versionVerdict() are: what is worth checking here is *who gets which
 * form*, and a check that had to drive a serial port to ask would be a test of
 * the port. sendToDevice() is the one caller.
 *
 * `form` is the word out of the device's hello - `CABLE_TILE_FORM` from a
 * talker that can read the compressed form, and an empty string from every one
 * flashed before 2026-08-31, which had no such line to say. Anything else is
 * treated as silence: a word this browser does not know is a device it must
 * not guess about, because the file it would guess wrong with is drawn as a
 * panel of noise rather than refused.
 *
 * layout.bin and the recordings pass through untouched. Only tiles compress,
 * and only into a form the listener named.
 */
export function forDevice(
  build: Map<string, Uint8Array<ArrayBuffer>>, form: string,
): Map<string, Uint8Array<ArrayBuffer>> {
  if (form !== "vt1") return build;
  return new Map([...build].map(([name, bytes]) =>
    [name, isTile(name) ? (encodeTile(bytes) as Uint8Array<ArrayBuffer>) : bytes]));
}
