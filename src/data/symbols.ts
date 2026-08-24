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
/** Whether a provider state is one somebody has to act on - the package's
 *  answer, so that two products cannot disagree about it. */
export { needsAttention } from "@lautstark/bildquelle";
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

/* METACOM ships the same symbols several times over - with and without a
 * frame, with and without the word printed on - as parallel folders holding
 * identical file names. bildquelle derives the list from the index rather than
 * from any list of known folder names, because a user's copy is theirs:
 * renamed, partial, or organised for a language nobody here has seen.
 *
 * Preferring one is ordering only. Nothing is filtered out, so a symbol that
 * exists in a single folder stays reachable, and a key that already holds a
 * picture keeps exactly the picture it holds. */
export const metacomRenderings = () => metacom.renderings();
export const preferredRendering = () => metacom.preferredRendering;
export const preferRendering = (segment: string | null) => metacom.preferRendering(segment);

/* -------------------------------------------------------------- search --- */

/**
 * vorlaut's oldest reference for a symbol out of the licensed collection.
 *
 * bildquelle identifies a METACOM symbol by its path inside the chosen folder,
 * "METACOM_9/PNG_ohne_Rahmen/ja.png". layout.json wrote "metacom:ja" — the
 * bare stem — from the day there was a layout.json, and obf.py read it back
 * that way, so every existing board and export holds this shape and it must
 * keep resolving forever. What a stem cannot say is which of METACOM's
 * parallel rendering folders was meant — pickReference below records that —
 * so nothing writes this shape any more; it is read for as long as boards
 * exist. tests/test_symbol_frozen.py holds this line to the frozen mapping.
 */
const referenceFor = (path) => METACOM_PREFIX + path.split("/").pop().replace(/\.[^.]+$/, "");

/**
 * The reference a pick stores: the path under the collection root, extension
 * dropped — "metacom:PNG_ohne_Rahmen/ja" for "METACOM_9/PNG_ohne_Rahmen/ja.png".
 *
 * METACOM ships parallel rendering folders holding identical file names, so
 * four picker tiles that are the same stem in four folders all stored the same
 * bare-stem reference, and every one of them rendered whichever folder the
 * index walked first. The folders are part of a METACOM distribution while the
 * root names one copy of it, so dropping the root keeps the reference portable
 * between copies of the same version; a collection arranged differently
 * degrades to the stem inside bildquelle, and bare stems stay valid forever.
 *
 * The root is compared, not assumed: bildquelle's ids only start with the
 * root when the collection came in as a file list or zip. A picked directory
 * handle indexes paths without it — there the first segment is already the
 * rendering folder, and cutting it blind would store the stem and lose the
 * pick. A path that carries no folder beyond the root has nothing to say
 * either way and stays the bare stem it always was.
 *
 * Exported for tests: the handle shape cannot be fabricated through
 * readMetacomFiles, so the mapping is checked as the function it is.
 */
export const pickReference = (path, root) => {
  const segments = path.split("/");
  const inside = (segments[0] === root ? segments.slice(1) : segments).join("/");
  return inside.includes("/")
    ? METACOM_PREFIX + inside.replace(/\.[^.]+$/, "")
    : referenceFor(path);
};

/** The folder a hit's picture sits in, said the way a human would — "PNG ohne
 *  Rahmen" — or "" for a file straight under the collection root. Root-aware
 *  for the same reason pickReference is. */
export const folderOf = (path, root) => {
  const segments = path.split("/");
  const inside = segments[0] === root ? segments.slice(1) : segments;
  return inside.length > 1 ? inside[inside.length - 2].replace(/_/g, " ") : "";
};

/**
 * Hits from one source, in the shape picker.js already renders: source, label,
 * a URL for the preview, and whichever identifier the pick step needs — `ref`
 * for METACOM, `id` for ARASAAC.
 *
 * Shaping only, and it throws what it is handed: the "never throws" this
 * paragraph used to promise was search()'s rule, written above the wrong
 * function, and it read as a licence to swallow one layer further out.
 */
async function decorate(hits, source) {
  const wanted = hits.slice(0, SEARCH_LIMIT);
  // Four METACOM tiles all captioned "ja" are told apart only by picture, so
  // when a label repeats within one answer, the tile also names the folder its
  // rendering came from. Display only: the caption must not leak into the
  // reference, and item.label stays clean because applySymbol may write it
  // onto the key.
  const twins = new Map();
  for (const hit of wanted) twins.set(hit.label, twins.has(hit.label));
  return Promise.all(wanted.map(async (hit) => {
    const item = {
      source,
      label: hit.label,
      url: (await imageUrl(source, hit.id)) || "",
    };
    if (source !== "metacom") return { ...item, id: hit.id };
    const root = metacomRoot();
    const hint = twins.get(hit.label) ? folderOf(hit.id, root) : "";
    return { ...item, ref: pickReference(hit.id, root), ...(hint ? { hint } : {}) };
  }));
}

/** Hits from one *named* source. Never throws: this is the shape for asking
 *  several collections at once - tools/symbolcheck.html and the unit tests -
 *  where one that cannot answer should cost its own hits and nothing else.
 *  What the picker calls is searchActive() below, which does throw. */
export async function search(word, source) {
  const term = (word || "").trim();
  if (!term) return [];
  try {
    return await decorate(await getProvider(source).search(term), source);
  } catch {
    return [];
  }
}

/* Which collection the picker offers. One, not both.
 *
 * Held here rather than read out of the settings at each call, for the same
 * reason preferRendering is: the picker asks on every keystroke and must not
 * wait on storage to answer. loadSettings() sets it, and readSettings() has
 * already refused "metacom" when no folder is connected. */
let active: ProviderId = "arasaac";

export const activeSource = (): ProviderId => active;
export const setActiveSource = (source: ProviderId) => { active = source; };

/* What the active collection has for what somebody typed.
 *
 * Not the raw string against the labels any more. A key on this board says
 * "Ich habe Durst" and the collection holds "durstig": comparing the two as
 * strings finds nothing, and since the picker offers one collection there is
 * no second one to fall back on. bildquelle's German half turns the text into
 * the words worth looking up - lemma, then the compound it probably is, then a
 * synonym - and suggest() flattens what they found into one ranked list, which
 * is the shape a grid of tiles wants.
 *
 * Stopwords are dropped only when there is more than one word. A search box is
 * not a sentence: somebody who types a single function word means that word,
 * and answering nothing because the list calls it furniture would be answering
 * a question they did not ask. Several words *is* a sentence, and there the
 * function words really are noise.
 */
/* Fetched the first time somebody searches, and not before.
 *
 * The lemma, baseword and synonym tables behind it are about 170 KB - 42 KB
 * over the wire - and they are worth nothing until a word is typed into the
 * picker. Loading them with the page would spend that on every visit,
 * including the ones that only press a key to hear it. The promise is kept so
 * the second keystroke does not ask again.
 *
 * A chunk that failed to arrive stays failed for the life of the document, and
 * clearing this variable on a rejection does not change that: the browser's
 * module map remembers the failure against the URL, so the retried import()
 * rejects again without a request going out. Measured, not assumed. That is
 * why the failure is reported rather than retried - see ui.search_failed,
 * which says to reload the page, because reloading is what actually helps. */
let german: Promise<typeof import("@lautstark/bildquelle/german")> | null = null;
const loadGerman = () => (german ??= import("@lautstark/bildquelle/german"));

/* Throws, unlike search() above, and the difference is what the caller can do
 * about it. search() answers for one named source out of several, where a
 * source that cannot answer should cost its own hits and nothing else. This
 * one *is* the picker's answer: there is no second collection behind it, so
 * swallowing left the dialog saying "nothing found for X" whether the
 * collection held nothing or the page had never managed to ask. Those are
 * different sentences, and picker.ts writes both. */
export async function searchActive(word: string) {
  const term = (word || "").trim();
  if (!term) return [];
  const { suggest, tokenize } = await loadGerman();
  const single = tokenize(term).length <= 1;
  const hits = await suggest(term, {
    provider: getProvider(active),
    stopwords: single ? [] : undefined,
  });
  return await decorate(hits, active);
}

/* How the active collection is doing, for telling an empty answer apart from
 * one that was never given. A provider's search() must not throw - that is
 * bildquelle's contract, and ARASAAC keeps to it by returning [] when the
 * fetch fails - so an empty list is the only thing a failed network hands
 * back, and this is the only place that says which of the two it was. */
export const activeStatus = () => getProvider(active).status();

/* --------------------------------------------------------------- image --- */

/** A URL for <img src>, or null. Object URLs where it can, remote where it must.
 *
 * Asynchronous, and that has to be awaited: a METACOM reference is resolved out
 * of somebody's folder, which means reading a file. Callers that forgot got a
 * Promise, which is truthy, and put "[object Promise]" where a URL belonged. */
export const imageUrl = (source: ProviderId, id: string): Promise<string | null> =>
  getProvider(source).getImageUrl(id);

/** A metacom: reference's picture, from the name the reference is — a bare
 * stem ("ja") or a folder-qualified one ("PNG_ohne_Rahmen/ja").
 *
 * Two different questions hide behind "give me the image". The picker holds
 * provider ids - paths - and imageUrl() answers those. A stored reference
 * holds a *name*, because a name survives the collection moving between
 * machines, and turning it back into a path is the provider's idForName():
 * exact or null, never ranked. Resolution through search() was the bug this
 * replaces - capped at 24 ranked hits, a stem behind a common word family
 * simply fell off the end. */
export async function metacomImageByName(name: string): Promise<string | null> {
  const path = metacom.idForName(name);
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
