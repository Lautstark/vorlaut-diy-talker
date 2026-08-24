#!/usr/bin/env node
// Renders the images and audio clips the fixtures embed, into ../assets.
//
// Separate from make_fixtures.mjs, and run far less often, because these are
// the two things that cannot be reproduced byte for byte from a script:
//
//   Opus depends on the libopus build.
//   PNG's IDAT depends on the zlib build.
//
// Both are therefore committed as source, and make_fixtures.mjs only reads
// them - which is what lets a regeneration be identical on any machine. It also
// keeps the fixtures small: compressing here once means make_fixtures.mjs can
// store already-compressed bytes rather than compressing them again.
//
// Re-run this only to change an asset on purpose, and expect the bytes to move
// even when the picture or the tone does not.
//
// Needs: ffmpeg with libopus. Last rendered with ffmpeg 9.0.1.
//
// The clips are sine tones, not speech. They exercise the container, the codec
// and the fallback rules; whether a voice sounds right is not something a
// fixture can answer.

import { deflateSync, crc32 } from "node:zlib";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

// --- PNG ---------------------------------------------------------------------
// Hand-rolled so the assets need no image library. Truecolour with alpha,
// filter 0 on every row: the simplest thing every PNG decoder must handle.

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

function png(width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[at++] = r; raw[at++] = g; raw[at++] = b; raw[at++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A symbol-ish picture: a filled disc on transparency, so alpha is exercised. */
function disc(name, size, [r, g, b]) {
  const mid = (size - 1) / 2;
  const radius = size * 0.42;
  const bytes = png(size, size, (x, y) => {
    const dx = x - mid, dy = y - mid;
    return dx * dx + dy * dy <= radius * radius ? [r, g, b, 255] : [0, 0, 0, 0];
  });
  writeFileSync(join(OUT, name), bytes);
  console.log(`  ${name}  ${bytes.length} bytes`);
}

// --- Audio -------------------------------------------------------------------

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

/** Ogg Opus, mono, 24 kHz in - what SPEC.md 6 requires of a builder. */
function opus(name, hz, seconds) {
  ffmpeg(["-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${seconds}`,
          "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", "24k",
          "-f", "ogg", join(OUT, name)]);
  console.log(`  ${name}`);
}

/** 16 kHz mono PCM - the legacy shape SPEC.md 6 tolerates on import. */
function wav(name, hz, seconds) {
  ffmpeg(["-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${seconds}`,
          "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", join(OUT, name)]);
  console.log(`  ${name}`);
}

disc("disc-blue-512.png",    512,  [0x3b, 0x5b, 0xdb]);
disc("disc-green-512.png",   512,  [0x2f, 0x9e, 0x44]);
disc("disc-orange-512.png",  512,  [0xe8, 0x59, 0x0c]);
disc("disc-grey-512.png",    512,  [0x86, 0x8e, 0x96]);
disc("disc-violet-512.png",  512,  [0x7c, 0x3a, 0xed]);
// Over the 1024 cap on purpose - fixture oversized-image.
disc("disc-red-2048.png",    2048, [0xc9, 0x2a, 0x2a]);
disc("disc-violet-2048.png", 2048, [0x7c, 0x3a, 0xed]);

opus("clip-a.opus", 440, 0.6);
opus("clip-b.opus", 660, 0.4);
wav("clip-legacy-16k.wav", 520, 0.6);
console.log(`assets written to ${OUT}`);
