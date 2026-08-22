// Runs the browser's layout.bin writer from the command line, so the test
// next door can hold its bytes against the ones Python writes.
//
// Reads a JSON array of cases on stdin, one object per case:
//
//   {"layout": {...}, "label": [...], "images": [[...]], "sounds": [[...]]}
//
// and prints one line per case, in the same order: the bytes as hex, or
// "error <message>" if the writer refused them. Every case in one run, since
// starting Node costs more than writing all of them.

import { readFileSync } from "node:fs";
import { renderLayoutBin } from "../src/data/layout_format.ts";

const cases = JSON.parse(readFileSync(0, "utf8"));
const lines = cases.map((one) => {
  try {
    return Buffer.from(
      renderLayoutBin(one.layout, one.label, one.images, one.sounds)
    ).toString("hex");
  } catch (error) {
    return `error ${error.message}`;
  }
});
process.stdout.write(lines.join("\n") + "\n");
