// Runs the browser's Open Board Format converter from the command line, so
// the test next door can hold its answers against the ones obf.py gives.
//
// Reads one JSON object on stdin with a list per question:
//
//   {"helpers": [{"call": "cssColor", "args": ["#abc"]}, ...],
//    "exports": [<layout>, ...],
//    "imports": [<document>, ...],
//    "licensing": [<document>, ...],
//    "obz": [<layout>, ...],
//    "unobz": [{"base64": "...", "name": "board.obz"}, ...]}
//
// The two container lists deal in base64: a zip is bytes, JSON is not, and
// this is the one shape both sides already have a decoder for.
//
// and writes one JSON object back with the same keys and the answers in the
// same order. A call that threw comes back as {"error": "<message>"} rather
// than taking the run with it - one refused case should read as one failure
// and not as a missing answer for every case after it.
//
// Everything in one process, since starting Node costs more than answering
// all of them.

import { readFileSync } from "node:fs";
import * as obf from "../static/obf.js";

const HELPERS = {
  splitSymbol: obf.splitSymbol,
  joinSymbol: obf.joinSymbol,
  imageId: obf.imageId,
  imageEntry: obf.imageEntry,
  symbolOf: obf.symbolOf,
  cssColor: obf.cssColor,
  boardPath: obf.boardPath,
  localeToLanguage: obf.localeToLanguage,
  gridOrder: obf.gridOrder,
  grid: obf.grid,
  order: obf.order,
  normalizeLayout: obf.normalizeLayout,
};

/** Whatever the call answers, or the message it refused with. */
async function answered(work) {
  try {
    return { value: await work() };
  } catch (error) {
    return { error: String(error.message) };
  }
}

const jobs = JSON.parse(readFileSync(0, "utf8"));
const out = { helpers: [], exports: [], imports: [], licensing: [],
              obz: [], unobz: [] };

for (const one of jobs.helpers || []) {
  out.helpers.push(await answered(() => HELPERS[one.call](...one.args)));
}
for (const layout of jobs.exports || []) {
  out.exports.push(await answered(() => obf.layoutToDocument(layout)));
}
for (const document of jobs.imports || []) {
  out.imports.push(await answered(() => obf.documentToLayout(document)));
}
for (const document of jobs.licensing || []) {
  // "" is what a document that may be written answers with, so that the
  // comparison is between two messages rather than between two exceptions.
  out.licensing.push(await answered(() => {
    obf.checkLicensing(document);
    return "";
  }));
}

for (const layout of jobs.obz || []) {
  out.obz.push(await answered(async () =>
    Buffer.from(await obf.exportObz(layout)).toString("base64")));
}
for (const one of jobs.unobz || []) {
  // The same sniff importObz() makes, and then both halves of what it does -
  // the document and the layout - so that a difference says which of the two
  // it is in.
  out.unobz.push(await answered(async () => {
    const bytes = new Uint8Array(Buffer.from(one.base64, "base64"));
    const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const document = zipped
      ? await obf.readObz(bytes, one.name) : obf.readObf(bytes, one.name);
    const files = {};
    for (const [name, data] of Object.entries(document.files)) {
      files[name] = Buffer.from(data).toString("base64");
    }
    return { root: document.root, boards: document.boards, files,
             layout: obf.documentToLayout(document) };
  }));
}

process.stdout.write(JSON.stringify(out));
