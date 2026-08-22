// Speaking a sentence with nothing behind the page.
//
// The container has two backends and this has the same two, under the same
// names: a voice is one string, "piper:de_DE-thorsten-medium" or
// "azure:de-DE-GiselaNeural", exactly as it stands in layout.json. Keeping
// the ids identical is what lets a set of sentences move between the server
// and the static site without being renamed or re-recorded.
//
// What comes out is what tts.synthesize() returns: a 16 kHz mono 16 bit WAV,
// trimmed and levelled. The levelling is level.js next door, measured against
// the container in tools/leveling.py.
//
// This file needs a browser; level.js deliberately does not. The split is so
// that the arithmetic can be checked without one.

import { postprocess } from "./level.js";

// --- piper -------------------------------------------------------------------

// piper compiled to WASM. Pinned, and pinned twice over: vits-web loads its
// onnxruntime binaries from a fixed 1.18.0 path, so the runtime the page
// imports has to be that same version or the failure happens deep inside the
// runtime with nothing readable attached to it.
export const VITS_WEB = "https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/vits-web.js";
export const ONNX_RUNTIME = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js";

// The page has to carry an import map, because vits-web's bundle imports
// onnxruntime-web by bare name and a bare name is a bundler's job:
//
//   <script type="importmap">
//   { "imports": { "onnxruntime-web": "<ONNX_RUNTIME>" } }
//   </script>
//
// A module cannot install that for its own import - import maps have to be in
// the document before the first module loads. static/tts/check.html shows it.
// Shipping for real, all of this is vendored and the map goes away.

let piper = null;

async function loadPiper() {
  if (!piper) piper = await import(/* @vite-ignore */ VITS_WEB);
  return piper;
}

/** The models already in this browser's storage, by voice id.
 *
 * They live in the origin private file system, which is per origin and
 * unaffected by clearing history. 63 MB for a medium voice, so the second
 * sentence is fast and the first is not.
 */
export async function downloaded() {
  return (await loadPiper()).stored();
}

/** Throw the downloaded models away. */
export async function forget() {
  return (await loadPiper()).flush();
}

async function synthesizePiper(text, model, onProgress) {
  const tts = await loadPiper();
  // vits-web looks the id up in a table it ships, and hands the mirror the
  // string "undefined" when it is not there - which arrives as a 404 about a
  // file nobody asked for. Five of the voices its own voices() call
  // advertises are missing from that table, en_US-john-medium among them.
  // Say so here instead, where the voice id is still in hand.
  if (!(model in tts.PATH_MAP)) {
    throw new Error(`${model} cannot be fetched by vits-web - it is not in its PATH_MAP. `
      + "See static/tts/voices.json for what can.");
  }
  const blob = await tts.predict({ text: text.trim(), voiceId: model }, (p) => {
    if (onProgress && p && p.total) {
      onProgress({ url: p.url, loaded: p.loaded, total: p.total,
                   share: p.loaded / p.total });
    }
  });
  return new Uint8Array(await blob.arrayBuffer());
}

// --- Azure -------------------------------------------------------------------

// Reachable straight from a tab: both endpoints answer the preflight with
// access-control-allow-origin: *, and so does the synthesis itself. Which
// means the key lives in the browser. For a local-only page that is the same
// exposure as the .env file it replaces; for a page served to anyone else it
// is not, and nothing here can tell the difference - see docs/browser-tts.md.
export const AZURE_FORMAT = "riff-16khz-16bit-mono-pcm";   // tts.AZURE_FORMAT
export const AZURE_RATE = "-5%";                           // tts.RATE default

const endpoint = (region) =>
  `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
const voiceList = (region) =>
  `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;

/** de-DE-GiselaNeural -> de-DE. tts.locale_of(). */
export function localeOf(name) {
  const parts = name.split("-");
  return parts.length >= 3 ? parts.slice(0, 2).join("-") : "de-DE";
}

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The same body tts.build_ssml() sends, down to the attribute order.
 *
 * Not tidiness: Azure renders from this, and a request that differs is a
 * recording that differs from the one already in the cache under that name.
 */
export function buildSsml(text, voice, rate = AZURE_RATE) {
  return '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
    + `xml:lang="${xml(localeOf(voice))}">`
    + `<voice name="${xml(voice)}">`
    + `<prosody rate="${xml(rate)}">${xml(text.trim())}</prosody>`
    + "</voice></speak>";
}

async function synthesizeAzure(text, voice, { key, region, rate = AZURE_RATE }) {
  if (!key) throw new Error("No Azure key.");
  const response = await fetch(endpoint(region), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": AZURE_FORMAT,
    },
    body: buildSsml(text, voice, rate),
  });
  if (!response.ok) {
    // 401 is worth its own sentence: it is nearly always a key that belongs
    // to a different region rather than a key that is wrong, and the region
    // is in the URL where nobody looks. tts.py splits the same two apart.
    if (response.status === 401) throw new Error(`Azure rejected the key for ${region}.`);
    throw new Error(`Azure said ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The Azure voices for these locales. Same shape as tts.azure_voice_names().
 *
 * Not cached here. tts.py holds this for a week because it ran on every page
 * load of a server that could not afford the request; a page that keeps its
 * own state can ask once and keep the answer where the rest of its state is.
 */
export async function azureVoices({ key, region, languages = ["de-DE", "en-US"] }) {
  const response = await fetch(voiceList(region), {
    headers: { "Ocp-Apim-Subscription-Key": key },
  });
  if (!response.ok) throw new Error(`Azure said ${response.status} to the voice list.`);
  const want = languages.map((l) => l.toLowerCase());
  return (await response.json())
    .filter((v) => want.some((w) => (v.Locale || "").toLowerCase() === w
      || (v.Locale || "").toLowerCase().startsWith(w + "-")))
    .map((v) => v.ShortName)
    .sort();
}

// --- The catalogue -----------------------------------------------------------

let catalogue = null;

/** The tested voice list next door. Fetched rather than imported so that the
 * same file can be a plain JSON file in two repositories - see its own header
 * for why it is not maintained twice. */
export async function voices(url = new URL("./voices.json", import.meta.url)) {
  if (!catalogue) catalogue = await (await fetch(url)).json();
  return catalogue;
}

/** de_DE-thorsten-medium -> Thorsten, out of the list if it is in there and
 * out of the id if it is not. tts.pretty_piper() with a lookup in front. */
export async function labelFor(vid) {
  const [kind, rest] = split(vid);
  if (kind === "azure") return rest.split("-").pop().replace(/Neural$/, "");
  const known = (await voices()).voices.find((v) => v.id === rest);
  if (known) return known.name;
  const tail = rest.includes("-") ? rest.slice(rest.indexOf("-") + 1) : rest;
  return tail.split("-")[0].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const split = (vid) => {
  const at = vid.indexOf(":");
  return at < 0 ? ["piper", vid] : [vid.slice(0, at), vid.slice(at + 1)];
};

// --- What the page calls -----------------------------------------------------

/** One sentence, one voice id, one finished WAV.
 *
 * Returns level.js's numbers alongside the bytes, and how long each half
 * took. The synthesiser is 4-7 s on an M-series Mac and the levelling is
 * milliseconds; anyone looking at a slow page should be able to see which of
 * the two it was without a profiler.
 */
export async function speak(text, vid, options = {}) {
  if (!text || !text.trim()) throw new Error("Nothing to say.");
  const [kind, rest] = split(vid);
  const started = performance.now();
  const raw = kind === "azure"
    ? await synthesizeAzure(text, rest, options)
    : await synthesizePiper(text, rest, options.onProgress);
  const spoken = performance.now();
  const result = postprocess(raw, options);
  return {
    ...result,
    voice: vid,
    rawBytes: raw.length,
    synthesisMs: Math.round(spoken - started),
    levellingMs: Math.round(performance.now() - spoken),
  };
}

/** The finished WAV as something an <audio> can play. */
export const asBlob = (wav) => new Blob([wav], { type: "audio/wav" });
