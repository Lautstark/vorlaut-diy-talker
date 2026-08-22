// The questions backend.js names, answered without a server.
//
// There used to be a backend/server.js beside this that sent each of them to
// app.py. It was deleted with app.py rather than kept: a second implementation
// of the seam, still importable, still reading like working code, and every
// call in it pointing at a route that no longer answers. This one answers out
// of the browser instead - the content from store.js, the pictures from
// symbols.js and the package behind it, the tiles from tiles.js, the speech
// from the vendored @lautstark/stimmquelle, the board as a document from
// obf.js. Each was written and measured against the Python one at a time; this
// is the file where they stop being spare parts.
//
// Everything here is the destination rather than a stepping stone, with one
// exception that is marked as one: runBuild(). The build orchestration -
// which files to write, what to call them, what to throw away - is builder.py
// and has no browser half yet, so it says so instead of pretending.

import type { Layout, PairAnswer, Settings, VoiceList, WantedSettings } from "../core/types.js";
import * as obf from "../data/obf.js";
import * as store from "../data/store.js";
import * as tiles from "../data/tiles.js";
import * as symbols from "../data/symbols.js";
import {
  speak, asBlob, shippable, displayName, usePiper,
} from "@lautstark/stimmquelle/browser";

// What vorlaut asks the shared chain for. The rate is the device's; the fade
// and the tail pad are CONTRACT.md §2's permitted device extras, off unless
// asked for, and asked for here because of the MAX98357A. tts.py applies the
// same two - tests/test_browser_tts.py is what holds them together.
const VORLAUT = { rate: 16000, fadeSec: 0.012, padSec: 0.06 };

// The package does not import piper; the consumer hands it in. Kept lazy, so
// opening the page costs nothing until somebody actually speaks.
usePiper(() => import(
  // The package's PiperModule is a description of somebody else's module and
  // this is a URL the compiler cannot see behind - see src/types/cdn.d.ts.
  "https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/vits-web.js"
) as unknown as Promise<Parameters<typeof usePiper>[0] extends () => Promise<infer M> ? M : never>);

// --- The layout --------------------------------------------------------------

// What a first visit gets. app.py seeds content/ from example/ so nobody meets
// an empty screen; this is that idea at its smallest - one set, four empty
// keys - because the examples are pictures and recordings that would have to
// be fetched, and an empty board somebody can type into is worth more than a
// wait.
const FIRST: Layout = {
  sleep_timeout_seconds: 600,
  language: "de",
  sets: [{
    name: "",
    symbol: "",
    color: "#3B5BDB",
    active: true,
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  }],
};

export async function loadLayout() {
  const held = await store.readLayout();
  if (held.layout) return held;
  // Written rather than only returned, so that the stamp the page carries is
  // one the store agrees with. Handing back a layout that is not in there
  // would make the first save look like somebody else's write.
  const seeded = await store.writeLayout(FIRST, null);
  return {
    layout: seeded.saved,
    version: seeded.version,
    buildCurrent: seeded.buildCurrent,
  };
}

export async function saveLayout(layout, version) {
  return await store.writeLayout(layout, version);
}

// --- Symbols -----------------------------------------------------------------

/** Where a reference resolves to something drawImage will take.
 *
 * Three kinds, and they are not interchangeable. A METACOM reference is
 * resolved by the package, out of the folder somebody licensed, and never
 * copied anywhere. A plain file name is a picture kept in here. Anything that
 * resolves to nothing is not an error - renderSymbol draws its grey cross. */
async function picture(reference) {
  if (!reference) return null;
  if (reference.startsWith("metacom:")) {
    const url = await symbols.imageUrl("metacom", reference.slice("metacom:".length));
    return url ? await symbols.loadImage(url) : null;
  }
  const bytes = await store.getFile("symbols", reference);
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes]));
  try {
    return await symbols.loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function pickSymbol(choice) {
  // METACOM never gets here - picker.js keeps the reference and asks nobody,
  // which is the licence rule. This is the ARASAAC branch, and the download
  // that app.py used to do into symbols/ happens here into the store instead.
  const url = await symbols.imageUrl(choice.source, choice.id);
  if (!url) throw new Error(`${choice.source} has no picture for ${choice.id}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ARASAAC answered ${response.status}`);
  const name = `${choice.source}-${choice.id}.png`;
  await store.putFile("symbols", name, await response.arrayBuffer());
  return { symbol: name, label: choice.label || "" };
}

export async function uploadSymbol(file) {
  // The name is what somebody's file was called, with anything that could be a
  // path taken out of it - these become keys, and a key with a slash in it
  // reads like a folder that is not there.
  const name = file.name.replace(/[^\w.-]+/g, "_");
  await store.putFile("symbols", name, await file.arrayBuffer());
  return { symbol: name };
}

/** The 128x128 the panel really shows: the tile, and the border round it.
 *
 * Reproduces preview_png() in app.py, including the part that looks like a
 * detail and is not - RGB565 has five bits of red and six of green, and a
 * panel lights the missing low bits by repeating the high ones. Dropping that
 * gives a preview very slightly darker than the device, which is exactly the
 * kind of difference nobody can see and everybody argues about. */
export async function previewInto(image, symbol, colour) {
  const raw = tiles.renderSymbol(await picture(symbol));
  const side = tiles.TILE_SIZE;
  const inner = new ImageData(side, side);
  for (let i = 0; i < side * side; i++) {
    const value = (raw[i * 2] << 8) | raw[i * 2 + 1];
    const r = (value >> 11) << 3;
    const g = ((value >> 5) & 0x3f) << 2;
    const b = (value & 0x1f) << 3;
    inner.data[i * 4] = r | (r >> 5);
    inner.data[i * 4 + 1] = g | (g >> 6);
    inner.data[i * 4 + 2] = b | (b >> 5);
    inner.data[i * 4 + 3] = 255;
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = tiles.IMG_SIZE;
  const context = canvas.getContext("2d");
  context.fillStyle = colour || "#000000";
  context.fillRect(0, 0, tiles.IMG_SIZE, tiles.IMG_SIZE);
  const patch = document.createElement("canvas");
  patch.width = patch.height = side;
  patch.getContext("2d").putImageData(inner, 0, 0);
  context.drawImage(patch, tiles.BORDER, tiles.BORDER);

  // The element is handed over rather than a URL returned precisely so that
  // this can happen: the picture is not there until it has been drawn, and
  // the URL has to be let go of afterwards or every render leaks one.
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const previous = image.dataset.blobUrl;
    if (previous) URL.revokeObjectURL(previous);
    image.dataset.blobUrl = url;
    image.src = url;
  }, "image/png");
}

/** The symbol itself, out of wherever it lives.
 *
 * The same resolution previewInto() uses, which is the point of picture()
 * being separate: a reference is a file in here, or a name in a licensed
 * collection the package resolves, and neither is a path anybody can write
 * down. The previous blob is let go of on the way, or every render leaks one.
 */
export async function symbolInto(image, reference) {
  const source = await picture(reference);
  const previous = image.dataset.blobUrl;
  if (previous) URL.revokeObjectURL(previous);
  if (!source) {
    image.removeAttribute("src");
    image.dispatchEvent(new Event("error"));
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth || source.width;
  canvas.height = source.naturalHeight || source.height;
  canvas.getContext("2d").drawImage(source, 0, 0);
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    image.dataset.blobUrl = url;
    image.src = url;
  }, "image/png");
}


// --- Voices and speech -------------------------------------------------------

export async function listVoices(): Promise<VoiceList> {
  // shippable() rather than the whole catalogue: it drops what cannot speak in
  // a tab, what may not be handed on at all, and what may be handed on only
  // with an attribution this interface does not render yet. The last one costs
  // a voice - de_DE-mls-medium is CC-BY - and that is the option doing its
  // job, not a bug. Pass { rendersAttribution: true } once the notices are on
  // screen; attributionsFor() in the catalogue is what would render them.
  //
  // It took an argument until 2.0.0 - shippable("browser") - and the default
  // now says the same thing: this page does not render notices and does not
  // drive piper itself, so it is offered what vits-web can speak and what may
  // be handed on unconditionally.
  const layout = (await store.readLayout()).layout;
  const chosen = layout && layout.voice ? layout.voice : "";
  const list = shippable().map((voice) => ({
    id: `piper:${voice.id}`,
    label: displayName(voice.id),
    language: voice.lang || "",
    ready: true,
  }));
  // Both names, because the page reads both and means different things by
  // them: `active` is what would speak if somebody pressed play now, `chosen`
  // is what stands in layout.json. Without a server they are the same value.
  // Returning only `active` left the settings sheet opening with nothing
  // ticked, because it reads `chosen` to decide.
  return { voices: list, active: chosen, chosen, backend: "browser" };
}

// Piper's models arrive from a CDN on first use rather than being fetched
// ahead of time, so there is no job here to watch. The shape is kept because
// voices.js reads these fields; what changed is that the answer is always
// "nothing is running".
export async function voiceFetchState() {
  return { running: false, done: 0, total: 0, name: "", error: "", missing: 0 };
}

export async function startVoiceFetch() {}

export async function synthesise(text, voice) {
  const spoken = await speak(text, voice || "", VORLAUT);
  return asBlob(spoken.wav);
}

// --- Settings ----------------------------------------------------------------

const NO_SETTINGS: Settings = {
  azureKey: { set: false, hint: "" },
  azureRegion: "",
  metacom: { path: "", ok: false, count: 0, keywords: false, fixed: false },
  local: true,
};

export async function readSettings(): Promise<Settings> {
  const held = await store.readSettings(NO_SETTINGS);
  // METACOM is answered by the provider rather than by what was saved: the
  // folder is chosen in this browser and can go away between two visits, so a
  // stored "ok: true" would be a claim nobody checked.
  return {
    ...NO_SETTINGS,
    ...held,
    metacom: {
      path: symbols.metacomRoot() || "",
      ok: symbols.metacomReady(),
      count: symbols.metacomCount() || 0,
      keywords: false,
      fixed: false,
    },
  };
}

export async function writeSettings(wanted: WantedSettings): Promise<Settings> {
  const held = await store.readSettings(NO_SETTINGS);
  const next = { ...held, azureRegion: wanted.azureRegion || "" };
  // An untouched field must not wipe the key - the same rule settings.js
  // follows on the way in.
  if (wanted.azureKey) {
    next.azureKey = { set: true, hint: wanted.azureKey.slice(-4) };
    next.azureSecret = wanted.azureKey;
  }
  await store.writeSettings(next);
  return await readSettings();
}

// --- The board as a document -------------------------------------------------
//
// obf.js is the converter, measured against obf.py document by document in
// tests/test_obf_js.py. What is left here is the two ends of it: where the
// layout comes from, and what the page is handed back.

/** The board as a .obz, ready to be downloaded.
 *
 * A Blob rather than bytes, because that is what the route answered with and
 * what settings.js hands to createObjectURL. References only: embedding the
 * symbols is an opt-in that only obf.py's command line ever passed, and it
 * needs a content type per file and a reader for content/symbols/ that this
 * has no caller for. Asked for it anyway, it says so rather than quietly
 * writing a document with no pictures in it and calling that the same thing.
 */
export async function exportBoard({ images = false } = {}) {
  if (images) {
    throw new Error(
      "Embedding the symbols in the export is not written here - obf.py's " +
      "--images does it, and nothing in the page asks for it.");
  }
  const held = await loadLayout();
  return new Blob([await obf.exportObz(held.layout)],
                  { type: "application/zip" });
}

/** An .obf or .obz on the way in, as a layout. Deliberately does not save it:
 * replacing what somebody has is a decision, and this is the reading half. */
export async function importBoard(file) {
  return await obf.importObz(await file.arrayBuffer(), file.name || "This file");
}

// --- The build ---------------------------------------------------------------

/** Not here yet, and saying so.
 *
 * tiles.js and layout_format.js can each make their part; what is missing is
 * builder.py's orchestration - which slots need rendering, what the files are
 * called, what to prune. Throwing is the honest answer: a build that quietly
 * did nothing would leave the page reporting success over an empty data/. */
export async function runBuild(): Promise<{ log: string[] }> {
  throw new Error(
    "Building in the browser is not written yet - tiles.js and " +
    "layout_format.js are here, builder.py's orchestration is not.");
}

export async function buildManifest() {
  const files = await store.listFiles("data");
  const held = await store.readLayout();
  return {
    version: held.version,
    current: held.buildCurrent === "1",
    sets: held.layout ? held.layout.sets.filter((s) => s.active !== false).length : 0,
    files,
    bytes: files.reduce((total, file) => total + file.size, 0),
  };
}

export async function buildFile(name) {
  const bytes = await store.getFile("data", name);
  if (!bytes) throw new Error(`no such file in data/: ${name}`);
  return bytes;
}

// --- Pairing -----------------------------------------------------------------
//
// There is none. The five digits prove that a talker reaching this over a
// network is the one in the room; a cable does not need proving, and there is
// no network here to reach over. pairState answers "nobody is waiting" rather
// than throwing, because watchPair() asks every five seconds and an error each
// time would be noise about something that is not going to happen.

export async function pairState() {
  return { waiting: [] };
}

export async function confirmPairCode(_code: string): Promise<PairAnswer> {
  return { ok: false, error: "There is no pairing here - the cable is the way in." };
}
