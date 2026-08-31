/* Every frozen tile, compressed by loader/src/tile_encode.ts.
 *
 * One line per tile, "name hex", in the order the names sort. The Python
 * script next door feeds each of them to the firmware's own decoder and holds
 * what comes back against the frozen bytes this started from.
 *
 * All of them in one run, for the reason tests/layout_node.mjs gives: starting
 * node costs more than encoding every tile.
 */

import { readdirSync, readFileSync } from "node:fs";
import { encodeTile, decodeTile } from "../loader/src/tile_encode.ts";

const dir = new URL("reference/tiles/", import.meta.url);
for (const name of readdirSync(dir).filter((n) => n.endsWith(".rgb565")).sort()) {
  const raw = new Uint8Array(readFileSync(new URL(name, dir)));
  const encoded = encodeTile(raw);
  // The browser's own decoder, said here rather than in a second harness: if
  // this half cannot read what this half wrote, the C decoder disagreeing
  // afterwards would be the wrong story about the same fault.
  const back = decodeTile(encoded);
  const same = back !== null && back.length === raw.length &&
    back.every((byte, at) => byte === raw[at]);
  process.stdout.write(
    `${name.replace(".rgb565", "")} ${same ? "roundtrip" : "BROKEN"} ` +
    `${Buffer.from(encoded).toString("hex")}\n`);
}
