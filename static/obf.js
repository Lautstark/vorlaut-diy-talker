// layout.json as an Open Board Format document, and back again - in the browser.
//
// A port of the mapping half of obf.py, written field for field against it
// while it was the oracle. The app is a static site now, so this is where
// export and import happen: both are reached from the settings sheet.
//
// obf.py has since been deleted with the rest of the Python half, and
// tests/test_obf_js.py - which drove layouts and foreign documents through
// both implementations and compared the results field for field - went with
// it. What it used to say was written down first: tests/reference/obf.lock.json
// holds every helper, every layout as the document it becomes, every document
// as the layout it becomes, the licence refusals and what a .obz contains
// member by member, and tests/test_obf_frozen.py holds this file to all of it
// without needing Python.
//
// Worth knowing what that does not cover. A .obf is a mapping this project
// invented, so unlike tiles or the layout binary there is no outside opinion
// to fall back on - the lock is obf.py's answer, not a right answer, and it
// only answers for the cases recorded in it. A mistake on some other input is
// a board that somebody else's software reads wrongly or cannot open, and it
// will not show up here: the file writes, the zip opens, the damage is on the
// other side.
//
// What is deliberately not here.
//
// **validate() and the profiles.** They answer "would this document fit on an
// ESP32", and nothing in the page asks: the export button exports and the
// import button imports, exactly as the two routes in app.py do. `obf.py
// check` is a command line tool and stays one. Porting a validator nothing
// calls would be a second copy of a table to keep in step for no reader.
//
// **estimate_bytes(), the graph tools and the two attach_*() steps.** Same
// reason for the first three. attach_images() and attach_sounds() are opt-ins
// that only the command line passes - see exportBoard() in backend/local.js,
// which says so where somebody would look for them.
//
// **The device.** layout.bin stays exactly what layout_format.js writes. This
// replaces the document somebody edits, not the file that gets flashed.

import { LIMITS, PALETTE } from "./boot_data.js";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  SLOTS_PER_SET,
  hexToRgb,
  normalizeColor,
} from "./layout_format.js";

// --- What the spec calls things ---------------------------------------------

export const FORMAT = "open-board-0.1";
export const MANIFEST_NAME = "manifest.json";
export const BOARD_DIR = "boards";
export const IMAGE_DIR = "images";
export const SOUND_DIR = "sounds";

// The symbol set a bare file name in layout.json belongs to. A symbol stays a
// reference across the format rather than travelling as pixels, which is what
// keeps a licensed collection out of a document somebody sends on.
export const OWN_SET = "vorlaut";
export const METACOM_SET = "metacom";

// What the project declares about every pictogram the search loads. The
// over-attribution this carries is known and is obf.py's, not this port's:
// an uploaded photograph gets the same line, because layout.json records
// where a symbol came from nowhere at all.
export const ARASAAC_LICENSE = {
  type: "CC BY-NC-SA 4.0",
  copyright_notice_url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  author_name: "Sergio Palao",
  author_url: "https://arasaac.org",
  source_url: "https://arasaac.org",
};

// METACOM is licensed per person and lives outside the project. The licence
// block says so; checkLicensing() is what makes it true.
export const METACOM_LICENSE = {
  type: "Proprietary",
  author_name: "Annette Kitzinger",
  author_url: "https://www.metacom-symbole.de",
  source_url: "https://www.metacom-symbole.de/en/licensing.html",
};

export function boardPath(boardId) {
  return `${BOARD_DIR}/${boardId}.obf`;
}

// --- Two things Python does by itself ----------------------------------------

/** Python's str(x) for a field that should have been a string.
 *
 * A foreign board can put anything in any field, and obf.py answers with
 * `str(value or "")` throughout rather than refusing. This is that, with the
 * one difference that cannot be closed written down: JSON's 1.0 is a float in
 * Python and the integer 1 in JavaScript, so a filename of 1.0 - which is not
 * a filename - reads back one character apart. Every field this touches is a
 * string in every document either implementation writes.
 */
function text(value) {
  if (!value) return "";
  if (value === true) return "True";        // Python spells its booleans so
  return String(value);
}

/** Python's sorted() for strings: by code point.
 *
 * JavaScript's default sort compares UTF-16 code units, which puts anything
 * above the BMP before U+E000..U+FFFF instead of after. Board ids and image
 * ids written here are ASCII and would not notice; a document from somewhere
 * else names its boards whatever it likes, and the order of the boards is the
 * order of the sets.
 */
export function sorted(names) {
  return [...names].sort((one, two) => {
    const a = [...one].map((c) => c.codePointAt(0));
    const b = [...two].map((c) => c.codePointAt(0));
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  });
}

/** Python's isinstance(value, dict), which an array and null are not. */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Symbol references -------------------------------------------------------
// The one invariant borrowed wholesale: a symbol is a name in a collection and
// never a picture. It has to be structurally impossible to hand somebody a
// METACOM board as pixels, because the licence is per person and a file that
// carries the pixels has already handed them over.

/** A layout.json symbol reference as [set, name]. */
export function splitSymbol(symbol) {
  if (!symbol) return ["", ""];
  const colon = symbol.indexOf(":");
  if (colon < 0) return [OWN_SET, symbol];
  return [symbol.slice(0, colon), symbol.slice(colon + 1)];
}

/** [set, name] back into what layout.json writes. */
export function joinSymbol(symbolSet, filename) {
  if (!filename) return "";
  if (symbolSet === "" || symbolSet === OWN_SET) return filename;
  return `${symbolSet}:${filename}`;
}

/** A stable id for a symbol reference.
 *
 * Derived from the reference and from nothing else, so the same picture in two
 * differently coloured sets is the same id in both - the reasoning tiles.js
 * uses to make it exactly one file on the device.
 *
 * Async where the Python is not: hashing in a browser is crypto.subtle, which
 * is a promise. Everything that calls this is already async for other reasons.
 */
export async function imageId(symbol) {
  const bytes = new TextEncoder().encode(symbol);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `img-${hex.slice(0, 8)}`;
}

/** The images[] entry for one symbol reference. */
export async function imageEntry(symbol) {
  const [symbolSet, filename] = splitSymbol(symbol);
  const entry = {
    id: await imageId(symbol),
    symbol: { set: symbolSet, filename },
  };
  if (symbolSet === METACOM_SET) entry.license = { ...METACOM_LICENSE };
  return entry;
}

/** An images[] entry back to a layout.json reference - "" if it is pixels.
 *
 * A foreign board may carry its picture as a data URL or a file in the zip
 * rather than as a name. There is nowhere to put that, so it comes back empty
 * and the key gets the placeholder.
 */
export function symbolOf(image) {
  const symbol = (image && image.symbol) || {};
  if (!isObject(symbol)) return "";
  return joinSymbol(text(symbol.set), text(symbol.filename));
}

/** Refuses a document that carries a licensed collection as pixels.
 *
 * Every path that writes a .obz goes through here, so that the file cannot
 * come into existence rather than being written with a warning beside it.
 */
export function checkLicensing(document) {
  for (const boardId of sorted(Object.keys(document.boards))) {
    for (const image of document.boards[boardId].images || []) {
      const symbol = (image && image.symbol) || {};
      if ((isObject(symbol) ? symbol.set : "") !== METACOM_SET) continue;
      const carried = ["data", "url", "path"].filter((field) => image[field]);
      if (carried.length) {
        // str(image.get("id") or symbol.get("filename")) - which is "None"
        // when a doctored image has neither, and says so rather than naming
        // nothing at all.
        const named = image.id || symbol.filename;
        // The wording of obf.err.metacom_pixels in texts.py. Said in English
        // here for the same reason layout_format.js says its own refusals in
        // English: the ported modules carry no text table.
        throw new Error(
          `Image ${named === undefined || named === null ? "None" : named} ` +
          `comes from the METACOM collection, so it may be referred to but ` +
          `never stored: ` +
          `${carried.join(", ")} would carry the picture itself. ` +
          `Nothing was written.`);
      }
    }
  }
}

// --- Colours -----------------------------------------------------------------
// layout.json writes "#3B5BDB", OBF writes CSS. The hex form is the one that
// survives, in ext_vorlaut_color; the CSS one is written next to it so a
// foreign renderer has something to draw, and is ignored on the way back.

export function cssColor(value) {
  const [red, green, blue] = hexToRgb(value);
  return `rgb(${red}, ${green}, ${blue})`;
}

// --- The document ------------------------------------------------------------
//
// { root, boards, files }: the plain object obf.py's Document namedtuple is.
// Boards are kept as the dictionaries they were parsed from rather than as
// objects - that is what makes a foreign document survive the trip, because a
// field this project has never heard of is copied along instead of being
// dropped by a class that has no attribute for it. `files` is everything in
// the zip that is not a board, as Uint8Array, keyed by the path inside it.

/** The boards, root first, then the way the links run.
 *
 * Deterministic, which is what makes a round trip a round trip. Boards that no
 * link reaches come last, sorted by id, so an orphan is preserved rather than
 * lost.
 */
export function order(document) {
  const seen = [];
  const queue = document.root in document.boards ? [document.root] : [];
  while (queue.length) {
    const current = queue.shift();
    if (seen.includes(current)) continue;
    seen.push(current);
    queue.push(...targetsOf(document, current).filter(
      (t) => t in document.boards));
  }
  seen.push(...sorted(Object.keys(document.boards).filter(
    (b) => !seen.includes(b))));
  return seen;
}

// --- layout.json -> document -------------------------------------------------

/** The whole of a layout as linked boards.
 *
 * Every set becomes a board, including the switched-off ones: they are part of
 * the collection somebody made, and only the build takes the active ones. So
 * the ring runs through all of them in file order and wraps at the end, and
 * ext_vorlaut_active says which ones go on the device.
 */
export async function layoutToDocument(layout, { imageLicense } = {}) {
  const license = imageLicense === undefined || imageLicense === null
    ? ARASAAC_LICENSE : imageLicense;
  const entries = layout.sets || [];
  const ids = entries.map((_, index) => `set-${index + 1}`);
  const boards = {};

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const boardId = ids[index];
    // The ring: the set key switches to the next set and the last one comes
    // back round to the first, which is what the device does.
    const following = ids[(index + 1) % ids.length];
    const buttons = [];
    const images = {};

    /** Adds the images[] entry for a symbol and returns its id. */
    const remember = async (symbol) => {
      if (!symbol) return null;
      const entryFor = await imageEntry(symbol);
      if (entryFor.symbol.set === OWN_SET && license) {
        entryFor.license = { ...license };
      }
      if (!(entryFor.id in images)) images[entryFor.id] = entryFor;
      return entryFor.id;
    };

    for (let slotIndex = 0; slotIndex < entry.slots.length; slotIndex++) {
      const slot = entry.slots[slotIndex];
      const button = {
        id: `${boardId}-key-${slotIndex + 1}`,
        // Both, and the same text in both. The label is what any other editor
        // shows on the key; the vocalization is what gets spoken. They are one
        // sentence here because the device writes no caption - but saying it
        // twice is what keeps the spoken half right if somebody later shortens
        // the label.
        label: slot.text,
        vocalization: slot.text,
        // Derived, and ignored on the way back. The colour belongs to the set,
        // not to the key, and OBF has nowhere to put a colour that belongs to
        // a board.
        border_color: cssColor(entry.color),
      };
      const picture = await remember(slot.symbol);
      if (picture) button.image_id = picture;
      buttons.push(button);
    }

    const switchKey = {
      id: `${boardId}-set`,
      label: entry.name,
      border_color: cssColor(entry.color),
      load_board: {
        id: following,
        name: entries[(index + 1) % entries.length].name,
        path: boardPath(following),
      },
    };
    const picture = await remember(entry.symbol);
    if (picture) switchKey.image_id = picture;
    buttons.push(switchKey);

    boards[boardId] = {
      format: FORMAT,
      id: boardId,
      // The board's language, which on this device reaches only the four menu
      // labels the firmware draws itself. On a phone it is also what picks the
      // voice.
      locale: "language" in layout ? layout.language : DEFAULT_LANGUAGE,
      name: entry.name,
      grid: grid(boardId),
      buttons,
      images: sorted(Object.keys(images)).map((key) => images[key]),
      sounds: [],
      // --- vorlaut's own -----------------------------------------------------
      // ext_* is the spec's own way of carrying a field it has no opinion
      // about. These are the ones with no home in OBF.
      ext_vorlaut_color: entry.color,
      ext_vorlaut_active: entry.active,
    };
  }

  const root = ids.length ? ids[0] : "";
  const document = { root, boards, files: {} };
  if (root) {
    // Document-wide settings live on the root board rather than in the
    // manifest: a manifest is an index of a zip and gets rebuilt by any tool
    // that touches it, whereas a board is the document. It also means a single
    // .obf exported on its own still knows how long to stay awake and which
    // voice to speak in.
    boards[root].ext_vorlaut_sleep_timeout_seconds = layout.sleep_timeout_seconds;
    boards[root].ext_vorlaut_voice = "voice" in layout ? layout.voice : "";
  }
  return document;
}

/** The five keys where they really sit.
 *
 * Two rows of three, and the top left cell is empty because that is where the
 * speaker is - docs/hardware.md.
 *
 *     .        key 1    key 2
 *     set      key 3    key 4
 *
 * A grid with a hole in it is what grid.order's nulls are for, and it beats a
 * tidy 1x5 that no renderer could turn back into the thing on the table.
 * Nothing downstream depends on it: the importer finds the set key by its
 * load_board and the speech keys by not having one.
 */
export function grid(boardId) {
  return {
    rows: 2,
    columns: 3,
    order: [
      [null, `${boardId}-key-1`, `${boardId}-key-2`],
      [`${boardId}-set`, `${boardId}-key-3`, `${boardId}-key-4`],
    ],
  };
}

// --- document -> layout.json -------------------------------------------------

/** The button ids in reading order, then anything the grid left out.
 *
 * Buttons not named in the grid are appended rather than dropped: OBF allows a
 * board to carry more buttons than the grid shows, and losing one silently on
 * import is how a sentence disappears without an error.
 */
export function gridOrder(board) {
  const ordered = [];
  const cells = (board.grid || {}).order || [];
  for (const row of cells) {
    for (const cell of row || []) {
      if (cell) ordered.push(text(cell));
    }
  }
  for (const button of board.buttons || []) {
    const buttonId = text(button.id);
    if (buttonId && !ordered.includes(buttonId)) ordered.push(buttonId);
  }
  return ordered;
}

export function buttonsInOrder(board) {
  const byId = {};
  for (const button of board.buttons || []) byId[text(button.id)] = button;
  return gridOrder(board).filter((key) => key in byId).map((key) => byId[key]);
}

export function imagesById(board) {
  const byId = {};
  for (const image of board.images || []) byId[text(image.id)] = image;
  return byId;
}

/** Which boards this one links to, in button order. */
function targetsOf(document, boardId) {
  const board = document.boards[boardId] || {};
  const found = [];
  for (const button of buttonsInOrder(board)) {
    const target = linkTarget(document, button);
    if (target) found.push(target);
  }
  return found;
}

/** The board id a load_board points at, or "" if it points nowhere here.
 *
 * Three ways to say it, tried in that order: the id, the path inside the zip,
 * and the name. The id is what this project writes; the path is what a
 * document whose ids are not its file names uses; the name is the last resort
 * and matches at most one board, because two boards with the same name make it
 * meaningless.
 */
export function linkTarget(document, button) {
  const link = button.load_board;
  if (!isObject(link)) return "";
  const wanted = text(link.id);
  if (wanted in document.boards) return wanted;
  const path = text(link.path);
  if (path) {
    for (const boardId of Object.keys(document.boards)) {
      if (boardPath(boardId) === path) return boardId;
    }
  }
  const name = text(link.name);
  if (name) {
    const matching = Object.keys(document.boards).filter(
      (b) => document.boards[b].name === name);
    if (matching.length === 1) return matching[0];
  }
  return "";
}

/** The boards back into the file the build reads.
 *
 * Lossy in one direction only, and knowingly: everything OBF can hold that
 * this device cannot do - a third row of keys, a button with an action, a
 * picture carried as pixels - has no field in layout.json. What survives is
 * what the device can show. This stops only where carrying on would be a lie,
 * which is a board with more speech keys than there are keys.
 */
export function documentToLayout(document) {
  const sets = [];
  const rootBoard = document.boards[document.root] || {};

  for (const boardId of order(document)) {
    const board = document.boards[boardId];
    const images = imagesById(board);
    const slots = [];
    let switchKey = null;

    for (const button of buttonsInOrder(board)) {
      const symbol = symbolOf(images[text(button.image_id)] || {});
      if (isObject(button.load_board)) {
        // The first link out is the set key. A board with several is legal OBF
        // and normal on a phone; here the rest cannot be reached.
        if (switchKey === null) switchKey = { symbol };
        continue;
      }
      slots.push({
        // The vocalization is what gets spoken and therefore what a slot's
        // text is. The label stands in when there is none, which is the common
        // case in boards written elsewhere.
        text: text(button.vocalization || button.label),
        symbol,
      });
    }

    if (slots.length > SLOTS_PER_SET) {
      // build.err.too_many_slots, in the words texts.py gives it.
      throw new Error(
        `Set ${text(board.name) || boardId} has ${slots.length} slots, ` +
        `exactly ${SLOTS_PER_SET} are allowed.`);
    }

    const colour = board.ext_vorlaut_color;
    sets.push({
      name: text(board.name) || boardId,
      active: "ext_vorlaut_active" in board
        ? Boolean(board.ext_vorlaut_active) : true,
      symbol: switchKey === null ? "" : switchKey.symbol,
      // No ext_vorlaut_color means a board from somewhere else, and then
      // normalizeLayout() hands out a colour from the palette. Reading it back
      // out of border_color was the alternative and it is worse: rgb() through
      // hex and back is a conversion that has to come out identical twice for
      // a file to look unchanged.
      color: typeof colour === "string" && colour ? colour : "",
      slots,
    });
  }

  const raw = {
    sets,
    language: localeToLanguage(rootBoard.locale),
    voice: text(rootBoard.ext_vorlaut_voice),
  };
  const timeout = rootBoard.ext_vorlaut_sleep_timeout_seconds;
  if (timeout !== undefined && timeout !== null) {
    raw.sleep_timeout_seconds = timeout;
  }
  return normalizeLayout(raw);
}

/** A BCP-47 locale down to the two codes this project has.
 *
 * "de-DE" and "de" are the same answer, and anything else falls back the way
 * normalizeLayout() already falls back: an unknown language costs the four
 * menu labels, not the content, and that is not worth stopping an import over.
 */
export function localeToLanguage(locale) {
  const code = text(locale).trim().toLowerCase().replace(/_/g, "-")
    .split("-")[0];
  return Object.hasOwn(LANGUAGE_CODES, code) ? code : DEFAULT_LANGUAGE;
}


// --- The complete shape ------------------------------------------------------
//
// normalizeLayout() is layout.py's, not obf.py's, and it is here because
// document_to_layout() ends in it: a board that came from somewhere else has
// no colour, no timeout it agrees with and however many slots its author felt
// like, and this is what turns that into the shape everything downstream is
// allowed to stop checking. Without it documentToLayout() answers with
// `color: ""`, which is not a layout anybody may save.
//
// It lives in this module rather than in a layout.js that does not exist yet -
// the same way layout.py's colour helpers live in layout_format.js, next to
// the one thing that needs them. Whoever writes that module takes this with
// them.
//
// The promise, unchanged: every set has a name, a colour and exactly four
// slots, and every slot has a text and a symbol, whatever the document
// happened to be missing.

// What layout.py says, read where the page already reads it: the palette and
// the two limits come out of boot_data.js, which tools/bootdata.py writes from
// layout.py itself. One table rather than a second copy to keep level.
export const MAX_SETS = LIMITS.maxSets;
export const MAX_ACTIVE_SETS = LIMITS.maxActive;
export const DEFAULT_PALETTE = PALETTE;
// The one number that is in neither table. layout.py's DEFAULT_SLEEP_TIMEOUT.
export const DEFAULT_SLEEP_TIMEOUT = 600;

/** Python's int(value), which is not Number(value).
 *
 * The timeout arrives from ext_vorlaut_sleep_timeout_seconds, which a foreign
 * document fills with whatever it likes, and normalize_layout() answers a
 * TypeError or a ValueError with the default. Where the two languages differ
 * is what counts as a number: Python truncates a float towards zero, reads a
 * string of digits - underscores between them included - and refuses "1e3",
 * "0x10" and "600.5", all of which Number() would take.
 *
 * Not reproduced: Python also accepts digits from other scripts, which is a
 * sentence rather than a timeout wherever it turns up.
 */
function pyInt(value, fallback) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  }
  if (typeof value === "string") {
    const digits = value.trim();
    if (!/^[+-]?[0-9](_?[0-9])*$/.test(digits)) return fallback;
    return Number(digits.replace(/_/g, ""));
  }
  return fallback;
}

/** layout.py's normalize_layout(): the file, brought into a complete shape. */
export function normalizeLayout(raw) {
  const timeout = Math.max(
    10, Math.min(pyInt("sleep_timeout_seconds" in raw
      ? raw.sleep_timeout_seconds : DEFAULT_SLEEP_TIMEOUT,
      DEFAULT_SLEEP_TIMEOUT), 24 * 3600));

  let language = text(raw.language || DEFAULT_LANGUAGE).trim().toLowerCase();
  if (!Object.hasOwn(LANGUAGE_CODES, language)) {
    // Not an error: an unknown language costs the menu labels, not the
    // content. The device would fall back to English by itself.
    language = DEFAULT_LANGUAGE;
  }

  // Which voice speaks. Only the shape is checked here, not whether this
  // browser has that voice: a model on the other computer must not quietly
  // overwrite a choice that was made deliberately.
  let voice = text(raw.voice).trim();
  if (!voice.startsWith("piper:") && !voice.startsWith("azure:")) voice = "";

  const sets = raw.sets || [];
  if (!Array.isArray(sets)) throw new Error(`"sets" has to be a list.`);
  if (sets.length > MAX_SETS) {
    throw new Error(`At most ${MAX_SETS} sets, found: ${sets.length}.`);
  }

  const cleanSets = sets.map((given, index) => {
    const entry = isObject(given) ? given : {};
    let slots = entry.slots || [];
    if (!Array.isArray(slots)) slots = [];
    // Exactly four slots: pad the missing ones, surplus ones are an error.
    if (slots.length > SLOTS_PER_SET) {
      throw new Error(`Set ${index + 1} has ${slots.length} slots, exactly ` +
                      `${SLOTS_PER_SET} are allowed.`);
    }
    slots = [...slots];
    while (slots.length < SLOTS_PER_SET) slots.push({ text: "", symbol: "" });
    return {
      name: text(entry.name || `Set ${index + 1}`).trim(),
      // If the field is absent the set is active - that keeps layouts from
      // before this distinction valid unchanged.
      active: "active" in entry ? Boolean(entry.active) : true,
      symbol: text(entry.symbol).trim(),
      color: normalizeColor(
        entry.color || DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]),
      slots: slots.map((slot) => {
        const one = isObject(slot) ? slot : {};
        return { text: text(one.text).trim(), symbol: text(one.symbol).trim() };
      }),
    };
  });

  const active = cleanSets.filter((entry) => entry.active).length;
  if (active > MAX_ACTIVE_SETS) {
    throw new Error(`At most ${MAX_ACTIVE_SETS} sets active at once, ` +
                    `${active} are chosen. More do not fit on the device.`);
  }

  return { sleep_timeout_seconds: timeout, language, voice, sets: cleanSets };
}

// --- The container -----------------------------------------------------------
//
// A .obf is one board as JSON; a .obz is a zip of several with a manifest
// naming the root, and since vorlaut writes one board per set, everything it
// exports is a .obz. Neither the browser nor node has a zip in it, and this
// project has no bundler, no node_modules and no lockfile - so the sixty lines
// below are the container, written out, and the compression itself is
// CompressionStream, which both of them do have.
//
// What is not attempted is byte-identical zips. Python's zlib and the
// browser's deflate are two compressors and agree about the format, not about
// the output, so the thing that has to be identical is what comes out of the
// members: the same names in the same order, the same bytes inside each, the
// same fixed timestamp. tests/test_obf_js.py unpacks both with Python's own
// zipfile and compares member by member.

// Zip entries carry a fixed timestamp, so the same document always produces
// the same bytes. Otherwise "did anything actually change" is unanswerable
// without unpacking both files. obf.py's ZIP_DATE, as the two 16-bit fields
// the format actually stores: 1980-01-01 00:00:00.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
// 0o644 << 16, and the creating system as unix - what zipfile.ZipInfo writes
// on the machine obf.py runs on.
const EXTERNAL_ATTR = 0o644 << 16;
const MADE_BY = (3 << 8) | 20;
const NEEDED = 20;
const DEFLATED = 8;
const STORED = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Everything a compression stream gives back, as one array of bytes.
 *
 * The write is deliberately not awaited before the reading starts: a stream
 * holds a chunk until somebody takes it, so awaiting both in order is how a
 * large member would sit there forever.
 */
async function through(bytes, stream) {
  const writer = stream.writable.getWriter();
  const written = writer.write(bytes).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const deflate = (bytes) => through(bytes, new CompressionStream("deflate-raw"));
const inflate = (bytes) => through(bytes, new DecompressionStream("deflate-raw"));

/** What Path(name).stem gives: the file name without its directory or its
 * last suffix. layout_format.js has the same four lines and does not export
 * them; a shared one belongs in neither of these two modules. */
function stemOf(name) {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || /^\.+$/.test(base)) return base;
  return base.slice(0, dot);
}

/** The bytes obf.py's _json_bytes() writes: sorted keys, indented by two,
 * not escaped away from UTF-8, and a newline at the end.
 *
 * Sorted so that the same document is the same file - a diff of an export
 * should be about what changed in the board and not about what order a
 * dictionary happened to be built in.
 */
export function jsonBytes(data) {
  return new TextEncoder().encode(
    JSON.stringify(sortDeep(data), null, 2) + "\n");
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!isObject(value)) return value;
  const out = {};
  for (const key of sorted(Object.keys(value))) out[key] = sortDeep(value[key]);
  return out;
}

/** The manifest the spec asks for, and nothing beyond it.
 *
 * Deliberately thin. Everything about the document that is vorlaut's own sits
 * on the root board instead - a manifest is an index of a zip, and an index is
 * the thing a tool rewrites without thinking about what it was carrying.
 */
export function manifestOf(document) {
  const paths = {};
  for (const boardId of order(document)) paths[boardId] = boardPath(boardId);
  const manifest = { format: FORMAT, root: document.root
    ? boardPath(document.root) : "", paths: { boards: paths } };
  for (const [field, prefix] of [["images", IMAGE_DIR], ["sounds", SOUND_DIR]]) {
    const found = {};
    for (const name of sorted(Object.keys(document.files || {}))) {
      if (name.startsWith(prefix + "/")) found[name] = name;
    }
    if (Object.keys(found).length) manifest.paths[field] = found;
  }
  return manifest;
}

/** Writes the document out as the bytes of a .obz.
 *
 * checkLicensing() first, always, whatever the caller thinks it is doing.
 * That is the only reason this function exists rather than callers reaching
 * for a zip writer: there has to be exactly one door, so that the invariant
 * can stand next to it.
 */
export async function writeObz(document) {
  checkLicensing(document);
  const members = [{ name: MANIFEST_NAME, data: jsonBytes(manifestOf(document)) }];
  for (const boardId of order(document)) {
    members.push({ name: boardPath(boardId),
                   data: jsonBytes(document.boards[boardId]) });
  }
  for (const name of sorted(Object.keys(document.files || {}))) {
    members.push({ name, data: new Uint8Array(document.files[name]) });
  }

  const encoder = new TextEncoder();
  const pieces = [];
  const central = [];
  let offset = 0;
  for (const member of members) {
    const name = encoder.encode(member.name);
    const packed = await deflate(member.data);
    const crc = crc32(member.data);

    const local = new Uint8Array(30 + name.length);
    const head = new DataView(local.buffer);
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, NEEDED, true);
    head.setUint16(6, 0, true);                  // no flags, no data descriptor
    head.setUint16(8, DEFLATED, true);
    head.setUint16(10, DOS_TIME, true);
    head.setUint16(12, DOS_DATE, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, packed.length, true);
    head.setUint32(22, member.data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);                 // no extra field
    local.set(name, 30);
    pieces.push(local, packed);

    const entry = new Uint8Array(46 + name.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, MADE_BY, true);
    view.setUint16(6, NEEDED, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, DEFLATED, true);
    view.setUint16(12, DOS_TIME, true);
    view.setUint16(14, DOS_DATE, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, packed.length, true);
    view.setUint32(24, member.data.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(38, EXTERNAL_ATTR, true);
    view.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + packed.length;
  }

  const directorySize = central.reduce((total, one) => total + one.length, 0);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true);
  tail.setUint16(8, members.length, true);
  tail.setUint16(10, members.length, true);
  tail.setUint32(12, directorySize, true);
  tail.setUint32(16, offset, true);
  return concat([...pieces, ...central, end]);
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Every member of a zip, by name, already decompressed.
 *
 * Read from the central directory rather than by walking the local headers:
 * the directory is where the sizes are certain, since a local header is
 * allowed to leave them for a data descriptor after the data.
 */
async function unzip(bytes, name) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw notAZip(name, "no end of central directory");

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const members = new Map();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) {
      throw notAZip(name, `damaged central directory at ${at}`);
    }
    const method = view.getUint16(at + 10, true);
    const packedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const start = view.getUint32(at + 42, true);
    const member = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    if (view.getUint32(start, true) !== 0x04034b50) {
      throw notAZip(name, `${member} is not where the directory says`);
    }
    const from = start + 30 + view.getUint16(start + 26, true)
      + view.getUint16(start + 28, true);
    const packed = bytes.subarray(from, from + packedSize);
    if (method === DEFLATED) members.set(member, await inflate(packed));
    else if (method === STORED) members.set(member, packed);
    else throw notAZip(name, `${member} is compressed with method ${method}`);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return members;
}

function notAZip(name, reason) {
  // obf.err.not_a_zip, in the words texts.py gives it.
  return new Error(`${name} is not a readable .obz: ${reason}`);
}

function readJson(members, member, name) {
  try {
    return JSON.parse(new TextDecoder().decode(members.get(member)));
  } catch (error) {
    // build.err.bad_json, named the way obf.py names a member inside a zip.
    throw new Error(`${name}:${member} is not valid JSON: ${error.message}`);
  }
}

/** Reads a .obz back into a document.
 *
 * Tolerant about where the boards are: the manifest is believed first, and if
 * it names nothing usable every .obf in the zip is taken instead. Both happen
 * in the wild - a manifest written by hand tends to be the half of the file
 * that is wrong, and the boards are still all there.
 */
export async function readObz(bytes, name = "This file") {
  const members = await unzip(bytes, name);
  const names = [...members.keys()];
  let manifest = {};
  if (members.has(MANIFEST_NAME)) {
    manifest = readJson(members, MANIFEST_NAME, name);
    if (!isObject(manifest)) manifest = {};
  }

  let wanted = ((manifest.paths || {}).boards);
  if (!isObject(wanted) || !Object.keys(wanted).length) {
    wanted = {};
    for (const member of sorted(names)) {
      if (member.endsWith(".obf")) wanted[stemOf(member)] = member;
    }
  }

  const boards = {};
  // The order the boards went in, kept beside them: an object with a board
  // called "12" in it does not iterate in insertion order, and the first board
  // is what the root falls back to.
  const inserted = [];
  const byMember = new Map();
  for (const key of sorted(Object.keys(wanted))) {
    const member = wanted[key];
    if (!members.has(member)) continue;
    let board = readJson(members, member, name);
    if (!isObject(board)) board = {};
    const boardId = text(board.id) || key;
    if (!(boardId in boards)) inserted.push(boardId);
    boards[boardId] = board;
    byMember.set(member, boardId);
  }

  const files = {};
  for (const member of sorted(names)) {
    if (member === MANIFEST_NAME || member.endsWith(".obf")
        || member.endsWith("/")) continue;
    files[member] = members.get(member);
  }

  // A manifest that names a board nobody packed: the document is still
  // readable and a root still has to be picked, so it is the first one in the
  // manifest's own order - which is the order it was written in.
  const root = byMember.get(text(manifest.root)) || inserted[0] || "";
  if (!inserted.length) {
    // obf.err.no_boards.
    throw new Error(`${name} has no board in it.`);
  }
  return { root, boards, files };
}

/** A single .obf - one board as JSON - as a document of one.
 *
 * The one place this does more than obf.py, and it is the page that asks for
 * it: ui.html's file input accepts `.obf`, and read_obz() only reads zips, so
 * over the server that promise ends in "is not a readable .obz". A board on
 * its own is the format's other half and is a document with one board in it.
 */
export function readObf(bytes, name = "This file") {
  let board;
  try {
    board = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw notAZip(name, error.message);
  }
  if (!isObject(board)) throw new Error(`${name} has no board in it.`);
  const boardId = text(board.id) || stemOf(name) || "board";
  return { root: boardId, boards: { [boardId]: board }, files: {} };
}

// --- The two ends ------------------------------------------------------------

/** A layout out as the bytes of a .obz. */
export async function exportObz(layout) {
  return await writeObz(await layoutToDocument(normalizeLayout(layout)));
}

/** A .obf or a .obz in, as a layout. Does not save it: reading somebody
 * else's document and seeing what it would become is the common case, and it
 * should not cost the file you already had. */
export async function importObz(bytes, name = "This file") {
  const data = new Uint8Array(bytes);
  // "PK", which is where every zip starts and no JSON document does.
  const zipped = data[0] === 0x50 && data[1] === 0x4b;
  return documentToLayout(
    zipped ? await readObz(data, name) : readObf(data, name));
}
