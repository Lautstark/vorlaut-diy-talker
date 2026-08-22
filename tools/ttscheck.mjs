// The node side of tools/ttscheck.py: one WAV in, one levelled WAV out, and
// the numbers this path thought it was producing printed as JSON on stdout.
//
//     node tools/ttscheck.mjs raw.wav out.wav
//
// It exists so the browser module can be measured without a browser. The page
// at tools/ttscheck.html imports the same level.js and does the same thing
// in a tab; if these two ever disagree, the difference is the browser and not
// the arithmetic.
import { readFileSync, writeFileSync } from "node:fs";
import { postprocess } from "../static/tts/level.js";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error("usage: node tools/ttscheck.mjs raw.wav out.wav");
  process.exit(2);
}
const result = postprocess(new Uint8Array(readFileSync(source)));
writeFileSync(target, result.wav);
const { wav, ...numbers } = result;
console.log(JSON.stringify(numbers));
