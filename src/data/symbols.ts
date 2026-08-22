// Finding a symbol, in the browser.
//
// The browser half of metacom.py and of the ARASAAC endpoints in app.py, the
// same way static/tiles.js is the browser half of tiles.py. This is the half
// the page uses: nothing here asks /api/search, /api/thumb or /api/sources any
// more. The Python still answers all three, and still resolves symbols for the
// build, which is the one thing that has not moved. See docs/symbol-search.md.
//
// The work itself is not done here. It is done by @lautstark/bildquelle, which
// bildhaft and vorlaut share, because the METACOM rules are easier to keep
// right in one audited place than in two apps. This file is only the adapter
// between that package and the shapes vorlaut already speaks.
//
// The specifier is bare and resolves out of node_modules, where npm put it
// from the pin in package.json. It used to need an import map in the page,
// because there was no bundler and nothing else could answer a bare name; the
// comment that stood here argued at some length that native modules and a map
// were a destination rather than a stopgap. They were a destination for as long
// as the project had no node_modules, no lockfile and no CI to run them, and it
// has all three now.
import {
  attributionsFor,
  getProvider,
  metacom,
  MetacomProvider,
  type ProviderId,
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
/** How many image files were indexed. A count, never the list. */
export const metacomCount = () => metacom.symbolCount;
/** The name of the chosen folder, for saying which one is in use. */
export const metacomRoot = () => metacom.rootName;
export const subscribeMetacom = (listener) => metacom.subscribe(listener);

export const chooseMetacomFolder = () => metacom.pickDirectory();
/** One click on a stored folder handle, no picker: Chromium keeps the handle
 *  across visits but often downgrades the permission to "ask again", and
 *  re-confirming needs a user gesture. This is that gesture's cheap path -
 *  falling back to the full picker only when there is nothing stored. */
export const reconnectMetacom = () => metacom.requestPermission();
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

/** A URL for <img src>, or null. Object URLs where it can, remote where it must.
 *
 * Asynchronous, and that has to be awaited: a METACOM reference is resolved out
 * of somebody's folder, which means reading a file. Callers that forgot got a
 * Promise, which is truthy, and put "[object Promise]" where a URL belonged. */
export const imageUrl = (source: ProviderId, id: string): Promise<string | null> =>
  getProvider(source).getImageUrl(id);

/** A metacom: reference's picture, from the bare stem the reference is.
 *
 * Two different questions hide behind "give me the image". The picker holds
 * provider ids - paths - and imageUrl() answers those. A stored reference
 * holds a *name*, because a name survives the collection moving between
 * machines, and turning it back into a path is the provider's idForName():
 * exact or null, never ranked. Resolution through search() was the bug this
 * replaces - capped at 24 ranked hits, a stem behind a common word family
 * simply fell off the end. */
export async function metacomImageByName(stem: string): Promise<string | null> {
  const path = metacom.idForName(stem);
  return path ? metacom.getImageUrl(path) : null;
}

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
export function loadImage(url): Promise<HTMLImageElement> {
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
