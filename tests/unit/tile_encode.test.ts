import { check } from "./harness.js";
import { decodeTile, encodeTile, forDevice, isTile, TILE_BYTES }
  from "../../loader/src/tile_encode.js";
import { CABLE_TILE_FORM } from "../../loader/tools/cable.js";

/* Who gets which form of a tile, and what happens to the other files.
 *
 * The format itself is stated in device/fixtures/tile/ and run from both sides
 * there, and whether a compressed tile survives the round trip is
 * tests/test_tile_compression.py, which puts the firmware's own decoder on the
 * other end of it. What is left is the decision, and it is the half with the
 * expensive failure: sending a compressed tile to a talker that cannot read
 * one puts a palette on a panel as though it were pixels. That device is in
 * somebody's house and there is no update channel.
 *
 * So the rule is stated as a whitelist rather than as a version comparison.
 * A device gets the compressed form if it named this exact word and the raw
 * form otherwise - including when it named something newer, which is the case
 * a "greater than" would get backwards.
 */

/** A tile of one colour: 32768 bytes that compress to almost nothing. */
function flat(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(TILE_BYTES);
  for (let i = 0; i < TILE_BYTES; i += 2) {
    out[i] = value >> 8;
    out[i + 1] = value & 0xff;
  }
  return out;
}

/** Noise, which is the tile that does not compress. Deterministic, because a
 *  test that is sometimes the interesting case is a test nobody can read. */
function noise(): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(TILE_BYTES);
  let x = 0x2545;
  for (let i = 0; i < TILE_BYTES; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (x >> 16) & 0xff;
  }
  return out;
}

const TILE = "t0123456789abcdef0123456789abcdef.bin";
const WAV = "afedcba9876543210fedcba9876543210.wav";
const LAYOUT = "layout.bin";

const build = new Map<string, Uint8Array<ArrayBuffer>>([
  [TILE, flat(0xf800)],
  [WAV, new Uint8Array([1, 2, 3, 4])],
  [LAYOUT, new Uint8Array([9, 9, 9])],
]);

{
  const sent = forDevice(build, CABLE_TILE_FORM);
  const tile = sent.get(TILE)!;
  check("a talker that named the form gets the tile compressed",
        tile.length < TILE_BYTES, `${tile.length} bytes`);
  check("and the pixels it draws are the ones that went in",
        Buffer.compare(Buffer.from(decodeTile(tile)!),
                       Buffer.from(build.get(TILE)!)) === 0);
  check("the recording is not touched",
        sent.get(WAV) === build.get(WAV));
  check("and neither is layout.bin",
        sent.get(LAYOUT) === build.get(LAYOUT));
}

{
  // Every talker flashed before 2026-08-31. It says nothing, and nothing means
  // raw - which is exactly what it was being sent the day before.
  const sent = forDevice(build, "");
  check("a talker that said nothing gets the raw bytes, unchanged",
        sent.get(TILE) === build.get(TILE));
}

{
  // The case a version comparison would get backwards. A word this browser
  // does not know is not a newer form to try: it is a device to leave alone.
  const sent = forDevice(build, "vt2");
  check("a talker that named a form this browser does not know gets raw too",
        sent.get(TILE) === build.get(TILE));
}

{
  // The rule that keeps the two forms apart, at the one place it can be
  // broken: a tile that does not compress must come back as itself, because a
  // compressed file of exactly TILE_BYTES would be read as a raw one.
  const stubborn = noise();
  const encoded = encodeTile(stubborn);
  check("a tile that will not compress is returned raw",
        encoded === stubborn, `${encoded.length} bytes`);
  check("so nothing this writer produces is ever compressed-and-32768-long",
        encoded.length === TILE_BYTES && decodeTile(encoded) === encoded);
}

{
  check("layout.bin is not mistaken for a tile", !isTile(LAYOUT));
  check("a recording is not either", !isTile(WAV));
  check("and a tile is", isTile(TILE));
}
