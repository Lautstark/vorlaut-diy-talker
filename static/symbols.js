// Finding a symbol, in the browser.
//
// The browser half of metacom.py and of the ARASAAC endpoints in app.py, the
// same way static/tiles.js is the browser half of tiles.py. Both halves exist
// while the rewrite is in flight; this one does not replace the server yet.
// picker.js asks backend.js for a search and backend.js still answers it over
// HTTP - so this file is what the local implementation behind that seam will
// call once there is one. See docs/symbol-search.md for what has to be true
// before the switch is thrown.
//
// The work itself is not done here. It is done by @lautstark/bildquelle, which
// bildhaft and vorlaut share, because the METACOM rules are easier to keep
// right in one audited place than in two apps. This file is only the adapter
// between that package and the shapes vorlaut already speaks.
//
// The bare specifier below needs an import map, and a module cannot install one
// for its own import — it has to be in the document before the first module
// loads. tools/symbolcheck.html carries it, and for now that is the only page
// that should: ui.html is the server-rendered app and nothing it loads imports
// this file yet. The map belongs to whatever page the rewrite grows.
//
// This is not a stopgap. Native modules and an import map are a destination
// vorlaut can keep: the pitch is a web interface built from the standard
// library with no build step, and a bundler would mean node_modules, a
// lockfile and CI to run it, for a project that has none of the three. The
// specifier is bare rather than a relative path only because that costs
// nothing and leaves the door open.
import {
  attributionsFor,
  getProvider,
  metacom,
  MetacomProvider,
} from "@lautstark/bildquelle";

/** How many hits per source reach the dialog. Matches SEARCH_LIMIT in app.py. */
const SEARCH_LIMIT = 24;

/** The prefix layout.json uses for a symbol out of the licensed collection. */
const METACOM_PREFIX = "metacom:";

/* ------------------------------------------------------------- sources --- */

/** True when this browser can remember a chosen folder across visits. */
export const remembersFolder = MetacomProvider.supportsPersistentPicker;

/** Re-attaches to a folder chosen on an earlier visit. Safe to call always. */
export async function restoreMetacom() {
  try {
    return await metacom.restore();
  } catch {
    return false;
  }
}

export const metacomStatus = () => metacom.status();
export const metacomReady = () => metacom.isReady();
export const subscribeMetacom = (listener) => metacom.subscribe(listener);

export const chooseMetacomFolder = () => metacom.pickDirectory();
export const readMetacomFiles = (files) => metacom.useFileList(files);
export const readMetacomZip = (file) => metacom.useZip(file);
export const forgetMetacom = () => metacom.forget();

/* -------------------------------------------------------------- search --- */

/**
 * vorlaut's reference for a symbol out of the licensed collection.
 *
 * bildquelle identifies a METACOM symbol by its path inside the chosen folder,
 * "METACOM_Symbole/.../Apfel.png". layout.json has always written "metacom:Apfel"
 * — the bare stem — and obf.py reads it back that way, so the stem is what the
 * reference stays. METACOM keeps its PNGs in one flat directory, so a stem
 * identifies a file on its own.
 */
const referenceFor = (path) => METACOM_PREFIX + path.split("/").pop().replace(/\.[^.]+$/, "");

/**
 * Hits from one source, in the shape picker.js already renders: source, label,
 * a URL for the preview, and whichever identifier the pick step needs — `ref`
 * for METACOM, `id` for ARASAAC.
 *
 * Never throws. A source that cannot answer contributes nothing, because a
 * licensed collection that is there is worth more than an error about the one
 * that is not.
 */
export async function search(word, source) {
  const term = (word || "").trim();
  if (!term) return [];

  let hits;
  try {
    hits = await getProvider(source).search(term);
  } catch {
    return [];
  }

  const wanted = hits.slice(0, SEARCH_LIMIT);
  return Promise.all(wanted.map(async (hit) => ({
    source,
    label: hit.label,
    url: (await imageUrl(source, hit.id)) || "",
    ...(source === "metacom" ? { ref: referenceFor(hit.id) } : { id: hit.id }),
  })));
}

/** Both sources, the local one first because it answers without a network. */
export async function searchAll(word) {
  const groups = [];
  if (metacomReady()) groups.push(["METACOM", await search(word, "metacom")]);
  groups.push(["ARASAAC", await search(word, "arasaac")]);
  return groups;
}

/* --------------------------------------------------------------- image --- */

/** A URL for <img src>, or null. Object URLs where it can, remote where it must. */
export const imageUrl = (source, id) => getProvider(source).getImageUrl(id);

/**
 * The symbol as something drawImage takes, ready for tiles.js.
 *
 * The crossOrigin is the whole reason this exists rather than callers building
 * their own <img>. bildquelle hands back a blob: URL for anything it has, but
 * falls back to ARASAAC's own URL when a fetch failed — deliberately, so the
 * <img> can still try instead of leaving a spinner up. That fallback is cross
 * origin, and a canvas drawn from it is tainted, so getImageData throws and the
 * tile fails at build time rather than on screen. ARASAAC sends
 * access-control-allow-origin: *, so asking for CORS up front costs nothing and
 * keeps the canvas readable either way. It has to be set before src.
 */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!url.startsWith("blob:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`symbol did not load: ${url}`));
    image.src = url;
  });
}

/* --------------------------------------------------------- attribution --- */

/**
 * The licence notices owed by a board, given the sources it draws on.
 *
 * ARASAAC is CC BY-NC-SA and the notice is a condition of it, not a courtesy,
 * so this belongs anywhere symbols are shown or built — not only in the picker.
 * METACOM owes nothing: it is the user's own licensed copy.
 */
export function attributionFor(sources) {
  return attributionsFor(sources);
}
