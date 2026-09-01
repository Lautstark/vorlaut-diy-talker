/* Every example recording, compressed by loader/src/audio_encode.ts.
 *
 * Two lines per file - what the browser would send, and what the browser's own
 * decoder makes of it again. The Python script next door hands the first to the
 * firmware's decoder and holds what comes back against both the second and the
 * recording this started from.
 *
 * All of them in one run, for the reason tests/tile_node.mjs gives: starting
 * node costs more than encoding every word in example/speech/.
 */

import { readdirSync, readFileSync } from "node:fs";
import { decodeAdpcmWav, encodeAdpcmWav } from "../loader/src/audio_encode.ts";

const dir = new URL("../example/speech/", import.meta.url);
for (const name of readdirSync(dir).filter((n) => n.endsWith(".wav")).sort()) {
  const raw = new Uint8Array(readFileSync(new URL(name, dir)));
  const encoded = encodeAdpcmWav(raw);
  const back = decodeAdpcmWav(encoded);
  const stem = name.replace(".wav", "");
  process.stdout.write(
    `file ${stem} ${Buffer.from(encoded).toString("hex")}\n`);
  // The browser's own decoder, said here rather than in a second harness: if
  // this half cannot read what this half wrote, the C decoder disagreeing
  // afterwards would be the wrong story about the same fault.
  process.stdout.write(
    `pcm ${stem} ${back === null ? "NOTADPCM" : Buffer.from(back).toString("hex")}\n`);
}
