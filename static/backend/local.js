// The same questions, answered without a server.
//
// backend/server.js sends each of these to app.py. This answers them out of
// the browser: the content from store.js, the pictures from symbols.js and the
// package behind it, the tiles from tiles.js, the speech from tts/speak.js.
// Those four were written and measured against the Python one at a time; this
// is the file where they stop being spare parts.
//
// Everything here is the destination rather than a stepping stone, with one
// exception that is marked as one: runBuild(). The build orchestration -
// which files to write, what to call them, what to throw away - is builder.py
// and has no browser half yet, so it says so instead of pretending.

import * as store from "../store.js";
import * as tiles from "../tiles.js";
import * as symbols from "../symbols.js";
import { speak, asBlob, voices as catalogue, labelFor } from "../tts/speak.js";

// --- The layout --------------------------------------------------------------

// What a first visit gets. app.py seeds content/ from example/ so nobody meets
// an empty screen; this is that idea at its smallest - one set, four empty
// keys - because the examples are pictures and recordings that would have to
// be fetched, and an empty board somebody can type into is worth more than a
// wait.
const FIRST = {
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
    const url = symbols.imageUrl("metacom", reference.slice("metacom:".length));
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
  const url = symbols.imageUrl(choice.source, choice.id);
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

// --- Voices and speech -------------------------------------------------------

export async function listVoices() {
  const known = await catalogue();
  const layout = (await store.readLayout()).layout;
  const chosen = layout && layout.voice ? layout.voice : "";
  const list = await Promise.all(known.voices.map(async (voice) => ({
    id: `piper:${voice.id}`,
    label: await labelFor(`piper:${voice.id}`),
    language: voice.language || "",
    ready: true,
  })));
  return { voices: list, active: chosen, backend: "browser" };
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
  const spoken = await speak(text, voice || "");
  return asBlob(spoken.wav);
}

// --- Settings ----------------------------------------------------------------

const NO_SETTINGS = {
  azureKey: { set: false, hint: "" },
  azureRegion: "",
  metacom: { path: "", ok: false, count: 0, keywords: false, fixed: false },
  local: true,
};

export async function readSettings() {
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

export async function writeSettings(wanted) {
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
// The one place where the browser is still behind the server. obf.py is a
// thousand lines with a profile system and a licensing check, and porting it
// wants the same treatment tiles.js got: written against the Python, measured
// against it, and only then trusted. Until that exists these say so, because a
// board exported by a half-finished converter is worse than no export - it
// looks like a backup.

export async function exportBoard() {
  throw new Error(
    "Exporting a board needs the OBF converter in the browser, which is not " +
    "written yet - obf.py still does this.");
}

export async function importBoard() {
  throw new Error(
    "Opening a board needs the OBF converter in the browser, which is not " +
    "written yet - obf.py still does this.");
}

// --- The build ---------------------------------------------------------------

/** Not here yet, and saying so.
 *
 * tiles.js and layout_format.js can each make their part; what is missing is
 * builder.py's orchestration - which slots need rendering, what the files are
 * called, what to prune. Throwing is the honest answer: a build that quietly
 * did nothing would leave the page reporting success over an empty data/. */
export async function runBuild() {
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

export async function confirmPairCode() {
  return { ok: false, error: "There is no pairing here - the cable is the way in." };
}
