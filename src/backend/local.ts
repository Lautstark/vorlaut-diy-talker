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
// Everything here is the destination rather than a stepping stone. runBuild()
// was the last exception - the build orchestration, which files to write, what
// to call them, what to throw away, lived in builder.py and threw here - and
// it is at the foot of this file now.

import type { Layout, OfferedVoice, Settings, VoiceList, WantedSettings, AzureState } from "../core/types.js";
import * as obf from "../data/obf.js";
import * as appPackage from "../data/app_package.js";
import { bakeImage, bakeSound } from "../data/app_assets.js";
import { ENCODER_RATE } from "../data/opus.js";
import * as store from "../data/store.js";
import * as tiles from "../data/tiles.js";
import * as symbols from "../data/symbols.js";
import {
  DEFAULT_LANGUAGE, HASH_BYTES, LAYOUT_BIN, SLOTS_PER_SET,
  activeSets, renderLayoutBin,
} from "../data/layout_format.js";
import { reason } from "../core/errors.js";
import { t } from "../core/texts.js";
import {
  speak, asBlob, shippable, displayName, parseVoiceId, usePiperRuntime,
  PIPELINE_VERSION,
  listVoices as catalogueVoices,
  type OnnxModule,
} from "@lautstark/stimmquelle/browser";
import { piperRuntime } from "@lautstark/stimmquelle/runtime";
import { LANGUAGES } from "../core/boot_data.js";

// What vorlaut asks the shared chain for. The rate is the device's; the fade
// and the tail pad are CONTRACT.md §2's permitted device extras, off unless
// asked for, and asked for here because of the MAX98357A. tts.py applies the
// same two - tests/test_browser_tts.py is what holds them together.
const VORLAUT = { rate: 16000, fadeSec: 0.012, padSec: 0.06 };

// The package does not drive piper by itself; the consumer says where the
// pieces are. Driving it directly - rather than through vits-web's predict() -
// is what makes de_DE-kerstin-low and en_US-john-medium speakable at all:
// vits-web cannot phonemise her and does not list him, and she is the one
// voice in the catalogue that is 16 kHz native, the device's own rate, so she
// alone reaches it without a resample. Configuring this reroutes every piper
// voice, and the package holds that safe: a voice that already spoke produces
// identical phoneme ids on either route, so nothing re-renders. What does move
// is the model cache - an OPFS directory of stimmquelle's rather than
// vits-web's - so the first sentence per voice after this re-downloads its
// 63 MB. That looks like a broken fetch and is not one.
//
// vits-web itself is gone with this: speak() routes every piper voice here the
// moment a runtime is configured, which made the usePiper() handover the kind
// of code this file exists to not have - importable, reading like a working
// path, and unreachable. The import map in index.html went with it; nothing
// imports a bare name from the browser any more.
//
// Three pieces, and stimmquelle now has an opinion about two of them:
// piperRuntime() fills in the phonemizer - the one npm package that ships it -
// and points wasmBase at the directory piperVendor() fills, defaulting both to
// `vendor/` off import.meta.env.BASE_URL so the repository name stays unwritten
// here. It also pins onnxruntime to one thread, which this file used to do for
// itself: threads want a cross-origin-isolated page and GitHub Pages sends none
// of the headers for one, so a pool sized off hardwareConcurrency only ever
// warned and fell back.
//
// The third piece stays a choice, and the package declines to make it. Where
// onnxruntime's module comes from is a fact about this product: the pinned CDN
// URL keeps the engine's weight off a bundle nobody pays for until somebody
// speaks, where mitreden bundles the same module because it promises to work
// offline. See src/types/cdn.d.ts for why that URL is pinned to the version
// piperVendor() copies binaries from - the module and the binaries beside the
// page have to be the same onnxruntime.
//
// base is passed rather than left to the package, which would rather default
// it and cannot here. Its default reads import.meta.env.BASE_URL through a
// local alias, and vite only substitutes that name written out in full, so the
// expression survives into the bundle and finds no env at run time. It falls
// back to "/", which is right in dev and wrong on Pages: the phonemizer would
// be fetched from /vendor/ on a site served at /vorlaut-diy-talker/, and the first
// sentence would fail on a 404 that no test sees, because e2e stands the
// phonemizer chunk in and never loads the real files. Written out here, vite
// substitutes it at build time. mitreden hit the same edge and passes it too;
// it belongs back in stimmquelle, and this line can go when it lands there.
usePiperRuntime(piperRuntime({
  base: import.meta.env.BASE_URL,
  onnx: () => import(
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js"
  ) as unknown as Promise<OnnxModule>,
}));

// --- The boards ---------------------------------------------------------------

// The list, and which of them is open. Straight through to store.ts, which is
// where the reasoning about ids, duplication and deletion lives - these are
// here because backend/index.ts is the whole list of ways the page reaches the
// outside, and a board list read around it would be a second door.
export const listCollections = store.readCollections;
export const createCollection = store.createCollection;
export const renameCollection = store.renameCollection;
export const deleteCollection = store.deleteCollection;
export const useCollection = store.useCollection;
// One Sammlung's layout without opening it, which is how the sidebar counts
// what is in the ones that are not on screen.
export const layoutOf = store.readLayoutOf;

// --- The layout --------------------------------------------------------------

/** The board in force, and a seed for the case where there is not one yet.
 *
 * app.py seeded content/ from example/ so that nobody met an empty screen. The
 * seed is still that idea, and it no longer lives here: what an empty board
 * looks like is the editor's answer - one set of four keys for the five-key
 * talker, something else entirely for whatever comes next - and this file
 * would have had to hold a `sets` array to say it. core/editor.ts's blank() is
 * where it comes from now, and core/save.ts passes it in.
 */
export async function loadLayout(seed: Layout) {
  const held = await store.readLayout();
  if (held.layout) return held;
  // Written rather than only returned, so that the stamp the page carries is
  // one the store agrees with. Handing back a layout that is not in there
  // would make the first save look like somebody else's write. The write also
  // mints the board this page has been editing all along without a name for.
  const seeded = await store.writeLayout(seed, null);
  return {
    layout: seeded.saved,
    version: seeded.version,
    buildCurrent: seeded.buildCurrent,
  };
}

export async function saveLayout(layout, version) {
  return await store.writeLayout(layout, version);
}

/** What a read falls back to where the store holds no board at all.
 *
 * It used to be the seed - one set of four keys - and the two are not the same
 * thing. A seed is what a first visit is *given*, and giving one is a write;
 * the two readers below only want something with the right shape to walk, and
 * seeding a board as a side effect of exporting or building one would be a
 * board appearing in somebody's list because they pressed the wrong button.
 * An empty layout builds to "there are no sets" and exports to an empty
 * document, which is what is true. */
const NOTHING: Layout = { sets: [] };

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
    // By name, not by id: the reference stores a name - the bare stem, or a
    // folder-qualified one ("PNG_ohne_Rahmen/ja") now that picks record which
    // rendering was chosen - while the provider's ids are paths into one
    // particular copy of the collection. imageUrl() with the name asked for a
    // path that never existed, so every metacom: key rendered its placeholder
    // - with the folder connected, the index built, and nothing anywhere
    // saying why.
    const url = await symbols.metacomImageByName(reference.slice("metacom:".length));
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

/* What to call an Azure voice when Azure cannot be asked.
 *
 * The friendly name in the list is `LocalName` out of the catalogue, which is
 * a network answer - and a network answer is exactly what is missing in the
 * one case this exists for: a stored key that has stopped working, and a row
 * that still has to say which voice the board is holding on to.
 *
 * displayName() cannot do it, and not by oversight. Its fallback cuts the
 * locale off at the FIRST dash, which is right for the piper stem it is meant
 * for - `de_DE-thorsten-medium`, whose locale carries an underscore - and
 * wrong for a ShortName whose locale carries the dash itself:
 * `de-DE-KatjaNeural` came out as `DE-KatjaNeural`, which is not a name.
 *
 * So this reads Azure's own convention, the same one stimmquelle's localeOf()
 * reads from the other end: a ShortName is `<lang>-<REGION>-<Name>`, and the
 * name is camel case with `Neural` stuck on it. Katja is Katja. The
 * multilingual ones keep the word, because "Jenny Multilingual" is a different
 * voice from Jenny and Azure's own DisplayName says so too. */
function azureName(model: string): string {
  const parts = model.split("-");
  const stem = (parts.length >= 3 ? parts.slice(2).join(" ") : model)
    .replace(/Neural$/, "");
  return stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim() || model;
}

/* A voice's name from its id and nothing else - no key, no network, no
 * catalogue entry. Which backend minted the id decides how it is read, because
 * the two write names differently and only one of them is stimmquelle's own. */
function nameOf(id: string): string {
  if (!id) return "";
  const parsed = parseVoiceId(id);
  return parsed && parsed.backend === "azure"
    ? azureName(parsed.model) : displayName(id);
}

export async function listVoices(): Promise<VoiceList> {
  // shippable() rather than the whole catalogue: it drops what cannot speak
  // here, what may not be handed on at all, and what may be handed on only
  // with an attribution this interface does not render yet. The last one costs
  // a voice - de_DE-mls-medium is CC-BY - and that is the option doing its
  // job, not a bug. Pass { rendersAttribution: true } once the notices are on
  // screen; attributionsFor() in the catalogue is what would render them.
  //
  // ownsInference is the usePiperRuntime() call at the top of this file: the
  // runtime question is answered by this page itself now, not by what
  // vits-web could speak, and that is what puts Kerstin and John on offer.
  // It claims nothing about licences - that half is asked of every voice
  // either way, which is why mls still waits on its notice.
  const layout = (await store.readLayout()).layout;
  const chosen = layout && layout.voice ? layout.voice : "";
  const list: OfferedVoice[] = shippable({ ownsInference: true }).map((voice) => ({
    id: `piper:${voice.id}`,
    label: displayName(voice.id),
    language: voice.lang || "",
    ready: true,
    // The catalogue has carried these three all along; this map used to drop
    // them, and the picker could only ever show a name because of it.
    source: "piper" as const,
    gender: voice.gender || "",
    // Straight off the catalogue entry in hand rather than through
    // qualityOf(), which would re-derive from the id what this object is
    // already holding.
    quality: voice.quality || "",
    downloadBytes: voice.bytes || 0,
    needsKey: false,
    // Off the catalogue entry in hand, like the tier above it. This one is
    // worth saying out loud: it is the whole of what vorlaut knows about which
    // voice rushes a single word, and it must stay the whole of it. The moment
    // a model stem is compared against here, the catalogue has stopped being
    // the source and a second voice carrying the flag would show nothing.
    rushesFragments: voice.rushesFragments,
  }));

  // Azure's voices, when a key is stored. app.py listed them and this file
  // did not, so the key somebody typed into the sheet was kept, shown as
  // "set", and then never asked anything - the sheet offered piper alone and
  // the Azure section looked decorative. Failure adds nothing rather than
  // throwing: a wrong key or a network that is not there should cost the
  // Azure rows, not the whole list, and the key panel's own state line is
  // where a bad key gets talked about.
  const held = await store.readSettings(NO_SETTINGS);
  if (held.azureSecret && held.azureRegion) {
    try {
      for (const voice of await azureCatalogue(held.azureSecret, held.azureRegion)) {
        list.push({
          id: voice.id, label: voice.name, language: voice.lang || "", ready: true,
          // Nothing is fetched for a cloud voice; what it costs is the key and
          // a request per sentence, which is what needsKey says.
          source: "azure" as const, gender: voice.gender,
          // No tier: a quality tier is a piper model's file stem, and Azure
          // publishes nothing of the kind. Empty says so; a guess would not.
          quality: "",
          downloadBytes: 0, needsKey: voice.needsKey,
        });
      }
    } catch {
      // The rows stay absent from the LIST - a broken key must not cost the
      // piper voices. But absent-with-no-words was the whole of the bad UX:
      // somebody typed a wrong region and the page's only answer was a list
      // that looked exactly as if they had typed nothing. azureState() is
      // where the failure gets its words, and the settings sheet renders it.
    }
  }
  // Both names, because the page reads both and means different things by
  // them: `active` is what would speak if somebody pressed play now, `chosen`
  // is what stands in layout.json. Without a server they are the same value.
  // Returning only `active` left the settings sheet opening with nothing
  // ticked, because it reads `chosen` to decide.
  // chosenLabel travels with them because the page cannot work it out: naming
  // a voice is stimmquelle's business and this file is where stimmquelle is.
  // It is filled in whether or not the voice is on offer - the row that needs
  // it is precisely the one whose voice is missing from `list`.
  return { voices: list, active: chosen, chosen, chosenLabel: nameOf(chosen),
           backend: "browser" };
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
  // No voice named means the board's chosen one - the meaning "" always had.
  // app.py filled that in on the server, and this file forgot to when it took
  // over: every play press on a board without a voice went to the catalogue as
  // the empty string and came back as a refusal with no name in it.
  const chosen = voice || (await store.readLayout()).layout?.voice || "";
  // The Azure key rides along whenever one is stored. speak() only reaches
  // for it on an azure: id, so for piper this is baggage it ignores - and
  // without it an azure: voice chosen in the sheet failed on every sentence.
  const held = await store.readSettings(NO_SETTINGS);
  // ownsInference rides in the options, never in VORLAUT: speak()'s licence
  // gate takes the runtime claim from its caller rather than inferring it,
  // so without this line Kerstin is refused at the door the sheet offered
  // her through. And VORLAUT is spread into the WAV fingerprint below, where
  // a new key would rename every recording ever made.
  const options = held.azureSecret && held.azureRegion
    ? { ...VORLAUT, ownsInference: true,
        azure: { key: held.azureSecret, region: held.azureRegion } }
    : { ...VORLAUT, ownsInference: true };
  const spoken = await speak(text, chosen, options);
  return asBlob(spoken.wav);
}

// Azure's catalogue, memoised per key and region: one sheet-opening asks for
// it twice - once for the voice list, once for the state line - and Azure's
// answer does not change between the two. A new key clears it (writeSettings).
/** One cloud voice as the Azure branch keeps it: the same four facts the
 *  picker shows, minus the ones a cloud backend answers for by being one. */
interface CloudVoice { id: string; name: string; lang: string; gender: string; needsKey: boolean }

let azureCache: { stamp: string; voices: CloudVoice[] } | null = null;

async function azureCatalogue(key: string, region: string) {
  const stamp = `${region}\u0000${key}`;
  if (azureCache && azureCache.stamp === stamp) return azureCache.voices;
  const offered = await catalogueVoices({
    azure: { key, region, languages: [...LANGUAGES] },
  });
  const cloud = offered.filter((voice) => voice.source === "azure")
    .map((voice) => ({
      id: voice.id, name: voice.name, lang: voice.lang || "",
      gender: voice.gender || "", needsKey: voice.needsKey,
    }));
  azureCache = { stamp, voices: cloud };
  return cloud;
}

/** Whether Azure answers for the stored key and region, in a shape the page
 * can put into words.
 *
 * This exists because its absence was the bad experience: a wrong region is a
 * hostname that does not resolve, the fetch threw, listVoices() swallowed it
 * so the piper voices survive - and the page's only signal was Azure rows
 * that silently were not there, under a panel saying "stored". Stored
 * describes this database. This describes whether the key works, which is
 * the only question the person typing it has.
 *
 * The code is for the text table to translate, not prose to print: the seam
 * stays wordless and the page owns the words, which is the rule bildquelle's
 * ProviderStatus set and the Release button learned the hard way. */
export async function azureState(): Promise<AzureState> {
  const held = await store.readSettings(NO_SETTINGS);
  if (!held.azureSecret || !held.azureRegion) {
    return { configured: false, ok: false, count: 0, code: "" };
  }
  try {
    const cloud = await azureCatalogue(held.azureSecret, held.azureRegion);
    return { configured: true, ok: true, count: cloud.length, code: "" };
  } catch (error) {
    // A region that is not one is a hostname that never resolves - the fetch
    // fails as a TypeError before any status exists. A live region with a
    // wrong key answers, and stimmquelle relays Azure's refusal.
    const code = error instanceof TypeError ? "unreachable"
      : /rejected the key|401|403/.test(reason(error)) ? "refused"
      : "failed";
    return { configured: true, ok: false, count: 0, code };
  }
}

// --- Settings ----------------------------------------------------------------

const NO_SETTINGS: Settings = {
  azureKey: { set: false, hint: "" },
  azureRegion: "",
  metacom: { path: "", ok: false, count: 0, keywords: false, fixed: false },
  // ARASAAC until somebody says otherwise: it needs no licence and no folder,
  // so it is the only source a first visit can actually search.
  activeProvider: "arasaac",
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
    // A folder that is not there cannot be the source the picker offers. This
    // is not a preference being overridden - it is the only answer that is
    // true, and without it a METACOM chosen on another machine would leave the
    // picker with nothing to search at all.
    activeProvider: held.activeProvider === "metacom" && symbols.metacomReady()
      ? "metacom" : "arasaac",
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
  const next = { ...held };
  if (wanted.azureRegion !== undefined) next.azureRegion = wanted.azureRegion;
  if (wanted.sidebarOpen !== undefined) next.sidebarOpen = wanted.sidebarOpen;
  // Absent means "leave it alone", null means "clear it" - the same rule the
  // key below follows, so a save about the region cannot drop the rendering.
  if (wanted.metacomRendering !== undefined) {
    next.metacomRendering = wanted.metacomRendering;
  }
  if (wanted.activeProvider !== undefined) {
    next.activeProvider = wanted.activeProvider;
  }
  // An untouched field must not wipe the key - the same rule settings.js
  // follows on the way in. Which left removal with no door at all: this
  // branch only ever set, so a stored key was permanent until null became
  // the one explicit way to ask for its removal.
  if (wanted.azureKey) {
    next.azureKey = { set: true, hint: wanted.azureKey.slice(-4) };
    next.azureSecret = wanted.azureKey;
  } else if (wanted.azureKey === null) {
    next.azureKey = { set: false, hint: "" };
    delete next.azureSecret;
  }
  // A different key or region is a different Azure to ask.
  azureCache = null;
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
  const held = await store.readLayout();
  return new Blob([await obf.exportObz(held.layout || NOTHING)],
                  { type: "application/zip" });
}

/**
 * The Sammlung as a Lautstark Board Package, for the Android viewer.
 *
 * The second door, and deliberately a door of its own: exchange/SPEC.md §5.2
 * requires that an export baking pixels not be the same function as the
 * talker's behind a flag, because the talker's guarantee is that it never
 * writes a symbol as pixels and a guarantee enforced by an argument is one
 * flag away from being untrue. exportBoard() above writes references and
 * refuses METACOM; this writes files and asks nobody, on the narrow permission
 * §5.2 sets out - a licensee preparing material for the person they support,
 * sideloaded onto that person's own device. The package says so: it goes out
 * with redistributable false.
 *
 * `missing` counts references that resolved to nothing. Not an error - a
 * package without a picture on one button is a working package, and §9.2 has
 * the viewer degrade that button rather than refuse the file - but it is worth
 * saying out loud, because the usual cause is a METACOM folder this browser
 * has not been given back yet, and the fix is one click away in the settings.
 */
export async function exportAppPackage(): Promise<{ blob: Blob; missing: number }> {
  const list = await store.readCollections();
  const current = list.collections.find((one) => one.id === list.current);
  if (!current) throw new Error("There is no Sammlung open to export.");
  const layout = (await store.readLayout()).layout || NOTHING;

  // One bake per distinct reference and per distinct sentence, not per use:
  // the same picture on three keys is one member of the archive, and the same
  // sentence in two sets is synthesised once. The build does the same.
  const images = new Map<string, appPackage.BakedImage>();
  const sounds = new Map<string, appPackage.BakedSound>();
  let missing = 0;

  const voice = chosenVoice(layout);
  const held = await store.readSettings(NO_SETTINGS);
  // The 24 kHz §6 asks for, and none of the device's extras: fadeSec and
  // padSec are there so a class-D amplifier does not click or cut a syllable,
  // which is a fact about the board in the case and not about a tablet.
  const options = held.azureSecret && held.azureRegion
    ? { rate: ENCODER_RATE, ownsInference: true,
        azure: { key: held.azureSecret, region: held.azureRegion } }
    : { rate: ENCODER_RATE, ownsInference: true };

  for (const set of layout.sets || []) {
    for (const reference of [set.symbol, ...(set.slots || []).map((slot) => slot.symbol)]) {
      const key = String(reference || "");
      if (!key || images.has(key)) continue;
      const source = await picture(key);
      if (!source) { missing++; continue; }
      images.set(key, await bakeImage(source));
    }
    for (const slot of set.slots || []) {
      const text = String(slot.text || "").trim();
      // Without a voice there is nothing to record, and that is a normal
      // package rather than a broken one: §9.2 says a board built for text to
      // speech is not degraded, and the viewer speaks it with its own voice.
      if (!text || !voice || sounds.has(text)) continue;
      const spoken = await speak(text, voice, options);
      sounds.set(text, await bakeSound(spoken.samples));
    }
  }

  const pkg = appPackage.buildAppPackage({
    collection: current, layout, images, sounds, voice,
  });
  return {
    blob: new Blob([await appPackage.packageBytes(pkg)], { type: "application/zip" }),
    missing,
  };
}

/** An .obf or .obz on the way in, as a layout. Deliberately does not save it:
 * replacing what somebody has is a decision, and this is the reading half. */
export async function importBoard(file) {
  return await obf.importObz(await file.arrayBuffer(), file.name || "This file");
}

// --- The build ---------------------------------------------------------------
//
// builder.py's build(), which was deleted with the Python half. The parts it
// orchestrated are all here already - tiles.js renders, layout_format.js
// writes the table, the vendored stimmquelle speaks, store.js is the folder -
// so what this is, exactly as it was there, is the order they happen in, what
// gets skipped, and what the log says about it.
//
// Per active set and slot it puts into the "data" store:
//
//   t<hash>.bin   116x116 RGB565 big-endian, the symbol area without a border
//   a<hash>.wav   spoken sentence, 16 kHz mono 16 bit
//   layout.bin    the table the firmware reads all of it back out of
//
// The names are hashes, which is what makes the same symbol in three sets one
// file on the device, and what makes a stale file impossible: change what goes
// into it and the name changes with it. Sixteen bytes of hash, because that is
// what layout.bin carries per slot - hashBytes() reads them straight back out
// of the name, so the two ends only agree if the hex is exactly that long.

/** The bytes as an ArrayBuffer of their own, which is what the store takes.
 *
 * renderSymbol(), renderLayoutBin() and speak() all answer with a view. A view
 * that already covers its whole buffer is handed over as it stands; anything
 * else is copied, because putting the buffer of a partial view into the store
 * would quietly keep whatever else is in it. */
function owned(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.slice().buffer as ArrayBuffer;
}

/** The 32 hex characters a name carries: sha256, cut to HASH_BYTES. */
async function fingerprint(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, HASH_BYTES * 2);
}

/** The voice this layout is spoken in - chosen_voice() in layout.py.
 *
 * An empty entry is not an error but the normal case for a fresh layout: then
 * the catalogue answers, and among several equal voices the one that speaks
 * the language the device is set to. Deliberately without asking the network,
 * for the reason tts.py gave: this answer goes into the name of every WAV, and
 * a list that is there on one page load and gone on the next would rename half
 * the build. */
function chosenVoice(layout: Layout): string {
  if (layout.voice) return layout.voice;
  // The same offering listVoices() asks with, so a fresh board's default is a
  // voice the picker actually shows. The two new voices this admits stand
  // behind Thorsten and Kristin in the catalogue, so no default moves - which
  // matters, because this answer goes into the name of every WAV.
  const offered = shippable({ ownsInference: true });
  if (!offered.length) return "";
  const wanted = layout.language || DEFAULT_LANGUAGE;
  const spoken = offered.find((voice) => voice.lang === wanted) || offered[0];
  return `piper:${spoken.id}`;
}

/** Why a symbol resolves to nothing - as a key for the build log.
 *
 * missing_hint() in tiles.py, with the METACOM branch pointing at the folder
 * picker rather than at an environment variable: the collection is chosen in
 * this browser now, and telling somebody to set VORLAUT_METACOM_DIR would send
 * them looking for a server that is not there. */
function missingHint(reference: string): string {
  if (!reference.startsWith("metacom:")) return "build.missing_symbol";
  return symbols.metacomReady() ? "build.missing_metacom"
                                : "build.missing_metacom_off";
}

/** Everything the firmware needs, out of the layout and into the "data" store.
 *
 * Answers with the log, and nothing else - the files stay where buildManifest()
 * and buildFile() come and read them, which is the arrangement builder.py had
 * with data/ and the reason 1.5 MB never travels through a return value. See
 * the note at the foot of backend.js. */
export async function runBuild(): Promise<{ log: string[] }> {
  const log: string[] = [];
  // The page is served in one language and the log is part of the page, so it
  // reads in that one. An empty key is the blank line before the closing note.
  const note = (key: string, params?: Record<string, string | number>) =>
    log.push(key ? t(key, params) : "");

  const held = await store.readLayout();
  const layout = held.layout || NOTHING;
  // Only the selection goes onto the device. The rest stays in the layout,
  // and switching one back on costs nothing it has not already paid.
  const sets = activeSets(layout);
  const all = layout.sets || [];

  if (!all.length) note("build.no_sets");
  else if (!sets.length) note("build.none_active");
  else if (sets.length !== all.length) {
    note("build.active_count", { active: sets.length, total: all.length });
  }

  // What this run produced. Anything in the store that is not in here at the
  // end is from an earlier one and goes.
  const expected = new Set([LAYOUT_BIN]);
  let audioOk = true;

  const voice = chosenVoice(layout);
  // Without a voice nothing can be spoken. In the Python a cached WAV still
  // counted, because the cache was keyed by a voice that had once been there;
  // here the name of a WAV has the voice in it, so with no voice there is no
  // name to look for and nothing to find.
  const silent = !voice;

  const tileFiles: string[][] = [];   // [set][slot] -> file name
  const audioFiles: string[][] = [];
  const labelFiles: string[] = [];

  // One render per distinct symbol rather than per use: the tile is the same
  // picture whatever set it stands in, and hashing it is what proves that
  // rather than assumes it.
  const drawn = new Map<string, { name: string; missing: boolean }>();
  async function storeTile(reference: string) {
    const key = String(reference || "");
    if (!drawn.has(key)) {
      const source = await picture(key);
      const bytes = tiles.renderSymbol(source);
      const name = `t${await fingerprint(bytes)}.bin`;
      await store.putFile("data", name, owned(bytes));
      // A reference that resolves to nothing is not an error - renderSymbol
      // draws its grey cross - but it is worth a line in the log.
      drawn.set(key, { name, missing: Boolean(key) && !source });
    }
    const tile = drawn.get(key);
    expected.add(tile.name);
    return tile;
  }

  // The WAV is named for what goes into it rather than for what comes out,
  // and that is the one place this differs from the tiles. Synthesis is the
  // expensive step - a model off a CDN, then a sentence at a time - so the
  // name has to be knowable before it is paid for, or a rebuild could never
  // reuse anything. Same rule as tts.fingerprint(): text, voice, and every
  // option that changes how it sounds, the pipeline's own version included,
  // so a levelling change renames rather than silently reuses.
  async function storeAudio(text: string, spokenBy: string): Promise<string> {
    const payload = JSON.stringify({
      text: text.trim(), voice: spokenBy, pipeline: PIPELINE_VERSION, ...VORLAUT,
    });
    const name = `a${await fingerprint(new TextEncoder().encode(payload))}.wav`;
    if (!await store.getFile("data", name)) {
      // The Azure key rides along the way synthesise() sends it, or a board
      // whose voice is azure: previews fine and then fails on Release. Not in
      // the fingerprint above, deliberately: the key changes who may ask, not
      // how the sentence sounds, and rotating a key must not re-render a
      // device's worth of audio.
      const held = await store.readSettings(NO_SETTINGS);
      // ownsInference for the same reason synthesise() states it, and like
      // the key it stays out of the fingerprint payload above: both say who
      // may ask, not how the sentence sounds.
      const options = held.azureSecret && held.azureRegion
        ? { ...VORLAUT, ownsInference: true,
            azure: { key: held.azureSecret, region: held.azureRegion } }
        : { ...VORLAUT, ownsInference: true };
      const spoken = await speak(text, spokenBy, options);
      await store.putFile("data", name, owned(spoken.wav));
    }
    expected.add(name);
    return name;
  }

  for (const [index, entry] of sets.entries()) {
    // The number is the position in the order on the device, not the one in
    // the layout - with switched-off sets the two drift apart, which is why
    // the name is always alongside.
    const number = index + 1;
    const named = String(entry.name || "");
    const label = (!named || named === t("build.set", { n: number }))
      ? t("build.set", { n: number })
      : t("build.set_named", { n: number, name: named });

    const setSymbol = String(entry.symbol || "");
    const setTile = await storeTile(setSymbol);
    labelFiles.push(setTile.name);
    if (!setSymbol) {
      note("build.no_set_symbol", { label });
    } else if (setTile.missing) {
      note("build.missing_prefixed", {
        label, what: t(missingHint(setSymbol), { symbol: setSymbol }),
      });
    }

    const tileNames = [];
    const audioNames = [];
    // The first four and no more: layout.bin holds exactly that many per set,
    // and renderLayoutBin() would drop the rest without a word. Logging slots
    // that cannot reach the device would be worse than not mentioning them.
    const slots = (entry.slots || []).slice(0, SLOTS_PER_SET);
    for (const [at, slot] of slots.entries()) {
      const nth = at + 1;
      const symbol = String(slot.symbol || "");
      const tile = await storeTile(symbol);
      tileNames.push(tile.name);
      if (tile.missing) {
        note("build.missing_in_slot", {
          label, slot: nth, what: t(missingHint(symbol), { symbol }),
        });
      }

      const text = String(slot.text || "");
      if (!text) {
        note("build.no_text", { label, slot: nth });
        audioNames.push("");
        continue;
      }
      if (silent) {
        audioOk = false;
        note("build.slot_no_voice", {
          label, slot: nth, text, reason: t("build.err.no_voice"),
        });
        audioNames.push("");
        continue;
      }
      try {
        audioNames.push(await storeAudio(text, voice));
        note("build.slot_text", { label, slot: nth, text });
      } catch (error) {
        // A sentence that would not speak is a warning rather than the end of
        // the build: everything except the sound is still worth having, and
        // the log says which key is silent.
        audioOk = false;
        note("build.tts_failed", { text, reason: reason(error) });
        audioNames.push("");
      }
    }
    tileFiles.push(tileNames);
    audioFiles.push(audioNames);
  }

  // Leftovers from earlier runs, so that no old set stays behind. layout.bin
  // is in `expected` from the start rather than added after this loop the way
  // the Python did it - there it was deleted here and written back two lines
  // later, and said so in the log on every single build.
  for (const file of await store.listFiles("data")) {
    if (expected.has(file.name)) continue;
    await store.dropFile("data", file.name);
    note("build.removed", { name: file.name });
  }

  await store.putFile("data", LAYOUT_BIN, owned(
    renderLayoutBin(layout, labelFiles, tileFiles, audioFiles)));
  note("build.written", { name: `data/${LAYOUT_BIN}` });

  const left = await store.listFiles("data");
  // What clears the "a release is due" mark: the version this build ran
  // against. saveNow() has already written whatever was on screen, so it is
  // the version the page is showing.
  await store.recordBuild(held.version);
  note("build.done", {
    sets: sets.length,
    files: left.length,
    size: Math.round(left.reduce((total, file) => total + file.size, 0) / 1024),
    where: "data/",
  });
  if (!audioOk) note("build.audio_missing");

  // Where the files go next is not this function's sentence to write. It used
  // to be - three lines saying that a build does not reach the device and
  // where to read about the ways that might - and they were true for as long
  // as nothing here could send. ui/release.ts sends now, and it says what
  // happened to these files immediately below this log: which of them the
  // talker was missing, which went down the cable, what it holds afterwards.
  // Two accounts of the same moment, one of them written before the fact, is
  // how a log starts lying.
  return { log };
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
