// layout.json as an Open Board Format document, and back again - in the browser.
//
// A port of the mapping half of obf.py. The app is becoming a static site, so
// the converter has to exist here as well: export and import are reached from
// the settings sheet, and today both of them are a request to app.py.
//
// obf.py is the oracle and stays untouched. What that means in practice is in
// docs/obf.md, the argument field by field, and in
// tests/test_obf_js.py, which drives a set of layouts and a set of foreign
// documents through both implementations and compares the results field for
// field. The documents are JSON, so that comparison needs no zip and no
// browser - the same arrangement tests/test_layout_format.py uses for
// layout.bin.
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

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  SLOTS_PER_SET,
  hexToRgb,
} from "./layout_format.js";

// --- What the spec calls things ---------------------------------------------

export const FORMAT = "open-board-0.1";
export const MANIFEST_NAME = "manifest.json";
export const BOARD_DIR = "boards";
export const IMAGE_DIR = "images";
export const SOUND_DIR = "sounds";

// The symbol set a bare file name in layout.json belongs to - see
// docs/obf.md, "Symbols stay references".
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
      // voice - see docs/obf.md.
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
  return raw;
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
