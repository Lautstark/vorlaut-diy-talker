// A Sammlung as a Lautstark Board Package: the .obz the Android viewer opens.
//
// exchange/SPEC.md is the format and this is a builder for it. The spec is
// checked in beside this repository's own code and is meant to be readable on
// its own; where a rule below cites a section, that section is the authority
// and this file is only what it looks like in TypeScript.
//
// ---------------------------------------------------------------------------
// Why this is not in obf.ts
//
// SPEC.md §5.2 asks for it in as many words: an export that bakes pixels MUST
// be a separate entry point from the talker's, "a different function, not the
// same one behind a flag". The talker's guarantee is that it never writes a
// symbol as pixels - that is what keeps a licensed METACOM collection inside
// the licence when a board is sent to somebody - and a guarantee enforced by
// an argument is one flag away from being untrue.
//
// So the two exports share no code path at all. obf.ts writes references and
// refuses METACOM pixels in checkLicensing(); this file writes pixels and
// never writes a reference. Neither can be talked into being the other.
//
// The word "board" means different things on either side of that line, which
// is worth saying once: here it is one OBF page, and a *Sammlung* is the whole
// package. On the device a "board" was the whole thing. src/core/types.ts has
// the same note.
//
// ---------------------------------------------------------------------------
// What a DIY Sammlung becomes
//
// The device is five keys and up to five sets, which is a small corner of what
// the format allows - no grid editor, no pages of thirty, no spelling. The
// mapping keeps the device's own shape rather than inventing a tablet layout:
//
//   one set          -> one board, coloured with the set's colour
//   four slots       -> four buttons, in the positions they sit in on the case
//   the set key      -> a load_board button, the same ring the device cycles
//   the empty corner -> a null grid cell, where the speaker is
//
// Keeping the positions is the point. Somebody who uses the device knows where
// "Ich habe Durst" is with their hand, and a viewer that re-flows five keys
// into a tidy row takes that away. docs/hardware.md has the picture.
//
// The buttons speak at once (§4.3) rather than composing into the message bar.
// That is what the device does, and what the person holding it has learned: a
// key is a whole sentence, not a word to build one out of. A DIY Sammlung with
// its keys appending to a bar would be a different thing wearing its labels.
//
// ---------------------------------------------------------------------------
// What a tablet Sammlung becomes
//
// Nothing, in the sense that matters: the format already had all of it. A page
// is an OBF board with the Sammlung's own grid on it, a button is an OBF
// button, navigation is `load_board`, the four bar controls are §7.4's
// actions, and a word class is a `background_color`. SPEC.md was not touched
// for this and SPEC_VERSION below did not move.
//
//   one page         -> one board, at the Sammlung's grid size
//   one button       -> one button, in the cell it sits in
//   a `goto` button  -> load_board, at the page it names
//   the home page    -> manifest.root, and where `:home` goes
//
// Two mappings in one file rather than two files, and that is not the split
// §5.2 asks for. That rule is about *pixels against references* - the talker's
// export in obf.ts writes a symbol as a reference and refuses METACOM pixels,
// which is what keeps a licensed collection inside its licence when a board is
// sent to somebody. Both targets here bake pixels, so both are on the same
// side of that line and share the one entry point.
//
// What the two do not share is what a press does. The device speaks at once
// because it has no bar; a tablet appends by default because it has one. That
// difference is the Act on each button rather than a flag on the export.

import { LANGUAGE_CODES, DEFAULT_LANGUAGE, hexToRgb } from "./layout_format.js";
import { encodeOpus, ENCODER_RATE, type OpusClip } from "./opus.js";
import { zipBytes, type ZipMember } from "./zip.js";
import { WORD_CLASSES } from "../core/boot_data.js";
import type { AppButton, AppLayout, CollectionRef, DiyLayout, Layout }
  from "../core/types.js";

/** The version of exchange/SPEC.md this builder targets.
 *
 * §12: a builder writes the version it targets, not the version it happens to
 * fit. Bumping this is a decision about having read the changelog. */
export const SPEC_VERSION = "1.1.0";

export const FORMAT = "open-board-0.1";
const MANIFEST = "manifest.json";

/** §5.3: the size a symbol is written at. 512 is what ARASAAC ships and what
 *  a button needs; 1024 is the cap, and a package sitting at the cap costs a
 *  phone 4 MiB of bitmap per button. */
export const IMAGE_SIZE = 512;
export const IMAGE_MAX = 1024;
/** §6: no clip may be longer than this. */
export const MAX_SECONDS = 30;

/* ------------------------------------------------------------- shapes --- */

export interface PackageImage {
  id: string;
  path: string;
  content_type: string;
}

export interface PackageSound {
  id: string;
  path: string;
  content_type: string;
  duration: number;
}

export interface PackageButton {
  id: string;
  label?: string;
  vocalization?: string;
  image_id?: string;
  sound_id?: string;
  /** §7.2. The word class a button carries, drawn as a filled cell. Absent on
   *  a talker Sammlung, whose colour belongs to the set rather than the key. */
  background_color?: string;
  border_color?: string;
  load_board?: { id: string; name: string; path: string };
  /** §7.4. One of `:clear`, `:backspace`, `:speak`, `:home` - and nothing
   *  else, because §7.4 requires an importer to disable a button carrying an
   *  action it does not implement, and writing one would be building a dead
   *  button on purpose. The singular field rather than `actions`: every
   *  control here is one act, and §7.4 disables the whole button if an array
   *  holds one thing the viewer cannot do. */
  action?: string;
  ext_lautstark_speak_immediately?: boolean;
}

export interface PackageBoard {
  format: string;
  id: string;
  locale: string;
  name: string;
  buttons: PackageButton[];
  grid: { rows: number; columns: number; order: (string | null)[][] };
  images: PackageImage[];
  sounds: PackageSound[];
  ext_lautstark_board_color?: string;
}

export interface PackageManifest {
  format: string;
  root: string;
  paths: {
    boards: Record<string, string>;
    images?: Record<string, string>;
    sounds?: Record<string, string>;
  };
  ext_lautstark_spec_version: string;
  ext_lautstark_package_id: string;
  ext_lautstark_package_name: string;
  ext_lautstark_modified: string;
  ext_lautstark_symbol_source: SymbolSource;
  ext_lautstark_redistributable: boolean;
  ext_lautstark_tts_voice?: string;
  ext_lautstark_first_column_gap?: boolean;
}

/** §5.1: one source for the whole package, and mixing is not representable. */
export type SymbolSource = "arasaac" | "metacom" | "none";

/** The package as three parts, before it is a zip. */
export interface AppPackage {
  manifest: PackageManifest;
  boards: PackageBoard[];
  /** Archive path -> bytes, for everything that is not a board document. */
  files: Map<string, Uint8Array<ArrayBuffer>>;
}

/** One resolved symbol: the PNG somebody's reference turned into.
 *
 * `key` is the content hash the member is named for. It is computed by
 * whoever baked the bytes rather than here, because hashing is asynchronous
 * and this half of the work is a pure function - see buildAppPackage().
 */
export interface BakedImage {
  key: string;
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

/** One resolved recording, named the same way and for the same reason. */
export interface BakedSound {
  key: string;
  bytes: Uint8Array<ArrayBuffer>;
  seconds: number;
}

/** Everything the mapping needs, already resolved.
 *
 * Resolution is somebody else's job - it needs a canvas, a folder somebody
 * licensed and a synthesiser - which is what keeps this half a pure function
 * over data and therefore checkable without a browser.
 */
export interface PackageInput {
  collection: CollectionRef;
  layout: Layout;
  /** Baked pictures by the reference they came from. */
  images: Map<string, BakedImage>;
  /** Baked recordings by the text they say. */
  sounds: Map<string, BakedSound>;
  /** What goes in ext_lautstark_tts_voice, or "" for none. */
  voice: string;
}

/* -------------------------------------------------------------- naming --- */

export const boardPath = (id: string) => `boards/${id}.obf`;
const imagePath = (key: string) => `images/${key}.png`;
const soundPath = (key: string) => `sounds/${key}.opus`;

/** A short content hash, which is what an image and a sound are named for.
 *
 * Content rather than a counter, so that the same picture used on three keys
 * is one member of the archive and one decode on the phone - and so that an
 * unchanged Sammlung exports to an unchanged file. */
export async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0"))
    .join("").slice(0, 16);
}

/** §7.2's colour shape. The layout stores "#RRGGBB"; both are permitted, and
 *  rgb() is the one the format's own examples use. */
export const cssColor = (value: string): string => {
  const [red, green, blue] = hexToRgb(value);
  return `rgb(${red}, ${green}, ${blue})`;
};

/** RFC 3339, UTC, seconds - what §4.1 asks of ext_lautstark_modified. */
export const rfc3339 = (at: number): string =>
  new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Which collection the symbols come from, or a refusal.
 *
 * §5.1 makes one source per package a rule and leaves enforcement to the
 * builder, because an importer has no symbol library to check against. In this
 * project a mixed Sammlung has only ever been a bug - the picker offers one
 * source at a time on purpose - so this refuses rather than picking a winner.
 *
 * What tells the two apart is how a reference is stored, which is a fact about
 * the licence rather than about file naming. A METACOM symbol is never copied
 * anywhere: it stays a "metacom:" reference into somebody's own licensed
 * folder. An ARASAAC pick is downloaded into this browser as
 * "arasaac-<id>.png" - backend/local.ts's pickSymbol().
 *
 * A picture somebody uploaded themselves is neither. It keeps its own file
 * name, and it does not make the package ARASAAC's: a photograph of a
 * grandmother on a board of METACOM symbols is a normal board, not a mixed
 * collection, and §5.1's three values have nowhere to say "and one photo".
 * So uploads count towards no source, and a package of nothing but uploads is
 * "none" - which is the value that says the viewer owes no attribution.
 */
export function symbolSource(layout: Layout): SymbolSource {
  let metacom = false;
  let arasaac = false;
  for (const reference of references(layout)) {
    if (!reference) continue;
    if (reference.startsWith("metacom:")) metacom = true;
    else if (/^arasaac-/.test(reference)) arasaac = true;
  }
  if (metacom && arasaac) {
    throw new Error(
      "This Sammlung draws on two symbol collections at once, and a package " +
      "may only carry one (exchange/SPEC.md §5.1). Replace the odd ones out " +
      "so that every key comes from the same collection.");
  }
  if (metacom) return "metacom";
  return arasaac ? "arasaac" : "none";
}

/** §7.1's grid: the five keys where they really sit, with the speaker's
 *  corner left empty. The same shape obf.ts writes, for the same reason. */
export function grid(boardId: string, present: readonly boolean[]) {
  const key = (at: number) => (present[at] ? `${boardId}-key-${at + 1}` : null);
  return {
    rows: 2,
    columns: 3,
    order: [
      [null, key(0), key(1)],
      [`${boardId}-set`, key(2), key(3)],
    ],
  };
}

/** Every symbol reference in a Sammlung, whichever shape it is.
 *
 * One walker rather than one per caller: symbolSource() and the bake loop in
 * backend/local.ts both need exactly this list, and the way §5.1 gets broken
 * is a new place to put a symbol that one of the two walkers never learned
 * about. Duplicates are left in - both callers de-duplicate for their own
 * reasons, and neither wants this function guessing which. */
export function references(layout: Layout): string[] {
  const out: string[] = [];
  if (layout.target === "app") {
    for (const page of layout.pages ?? []) {
      for (const button of page.buttons ?? []) out.push(String(button.symbol ?? ""));
    }
    return out;
  }
  for (const set of layout.sets ?? []) {
    out.push(String(set.symbol ?? ""));
    for (const slot of set.slots ?? []) out.push(String(slot.symbol ?? ""));
  }
  return out;
}

/** Every sentence a Sammlung will need a recording of, in the order it is met.
 *
 * The key into PackageInput.sounds, and therefore the thing backend/local.ts
 * has to synthesise. It is *the text that will be spoken*, which on a talker
 * key is its own text and on a tablet button is its vocalization falling back
 * to its label - §7.2. That fallback is the whole reason this is a function
 * rather than a field read at both ends: keying the map by the label shipped
 * the wrong clip on every button whose spoken text differs from what it shows,
 * which is exactly the button the fallback exists for.
 *
 * A tablet button only earns a clip when pressing it speaks. The viewer's
 * BoardViewModel utters on `Append` and on `SpeakImmediately` and on nothing
 * else - navigation and the four bar controls are silent, and `:speak` always
 * synthesises the composed sentence because the bar has no clip of its own. So
 * a clip on any of those would be a member of the archive nothing can ever
 * play, on a board that may have four hundred buttons.
 */
export function spokenTexts(layout: Layout): string[] {
  const out: string[] = [];
  if (layout.target === "app") {
    for (const page of layout.pages ?? []) {
      for (const button of page.buttons ?? []) {
        if (button.act?.kind !== "append" && button.act?.kind !== "speak") continue;
        const spoken = spokenTextOf(button);
        if (spoken) out.push(spoken);
      }
    }
    return out;
  }
  for (const set of layout.sets ?? []) {
    for (const slot of set.slots ?? []) {
      const text = String(slot.text ?? "").trim();
      if (text) out.push(text);
    }
  }
  return out;
}

/** §7.2: what a button says, which is its vocalization or else its label. */
export const spokenTextOf = (button: AppButton): string =>
  String(button.vocalization ?? "").trim() || String(button.label ?? "").trim();

/** The hex a word class is drawn in, or "" for a button carrying none.
 *
 * The layout stores the class and this is where it becomes a colour - see
 * AppButton.wordClass. A class this table does not know resolves to nothing
 * rather than to a guess: the viewer's own default is a better answer than a
 * colour that would mean the wrong word class to anybody reading the board. */
export const wordClassColor = (key: string): string =>
  WORD_CLASSES.find((one) => one.key === key)?.color ?? "";

/**
 * The board's locale: the language the sentences on it are in.
 *
 * Off the chosen voice first, and that is the whole point of this function.
 * §7.1 makes `locale` the fallback that picks a voice when
 * `ext_lautstark_tts_voice` is unavailable - and on Android it is nearly always
 * unavailable, because the names vorlaut stores are piper models and Azure
 * voices that no tablet has. So this field, not the hint, is what actually
 * decides how a package sounds.
 *
 * `layout.language` is the wrong thing to take it from: it is the language of
 * the *builder's own page* and of the four menu labels the firmware draws, and
 * it follows whichever language the browser asked for. A German board built in
 * an English browser went out saying `locale: "en"`, which on the tablet means
 * German sentences read aloud by an English voice. Found by exporting a
 * package and opening it in the viewer, which is the only place it shows.
 *
 * The voice is better evidence because somebody chose it *for these sentences*.
 * Both id shapes carry their language: `azure:de-DE-KatjaNeural` and
 * `piper:de_DE-thorsten-medium`. Without a voice there is nothing better than
 * the page's language, which is also the case where nothing will be spoken
 * from a recording anyway.
 */
export function localeFor(voice: string, language?: string): string {
  const named = voice.replace(/^(piper|azure):/, "");
  if (named) {
    // piper writes de_DE, BCP 47 wants de-DE; azure already writes it that way.
    const parts = named.replace(/_/g, "-").split("-");
    const tag = parts[1] && /^[A-Za-z]{2}$/.test(parts[1])
      ? `${parts[0]!.toLowerCase()}-${parts[1]!.toUpperCase()}`
      : parts[0]!.toLowerCase();
    if (/^[a-z]{2}(-[A-Z]{2})?$/.test(tag)) return tag;
  }
  // LANGUAGE_CODES is the table the firmware indexes its own menu by, and also
  // the whole list of languages this page has.
  return Object.hasOwn(LANGUAGE_CODES, String(language ?? ""))
    ? String(language) : DEFAULT_LANGUAGE;
}

/* ------------------------------------------------------------ building --- */

/**
 * The package as data. Pure: no canvas, no storage, no clock.
 *
 * No clock is the one worth naming. §8 wants a modified timestamp that says
 * when the Sammlung was last written, so that a viewer can tell an update from
 * a downgrade, and Date.now() at export time would make every re-export look
 * newer than the one before it while saying nothing about the content. It
 * comes off the Sammlung's own updatedAt.
 */
export function buildAppPackage(input: PackageInput): AppPackage {
  const { collection, layout } = input;
  const source = symbolSource(layout);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const locale = localeFor(input.voice, layout.language);

  // Which mapping, and nothing else branches on it below: the manifest, the
  // member names and the licence flag are facts about a package rather than
  // about what is in one.
  const { boards, root } = layout.target === "app"
    ? appBoards(layout, input, files, locale)
    : diyBoards(layout, input, files, locale);

  const manifest: PackageManifest = {
    format: FORMAT,
    root: boardPath(root),
    paths: {
      boards: Object.fromEntries(boards.map((one) => [one.id, boardPath(one.id)])),
    },
    ext_lautstark_spec_version: SPEC_VERSION,
    // §8: minted once with the Sammlung, never re-derived here. Duplicating a
    // Sammlung mints a fresh one in the store, which is the rule this depends
    // on and the one §8 says gets forgotten.
    ext_lautstark_package_id: collection.id,
    ext_lautstark_package_name: collection.name,
    ext_lautstark_modified: rfc3339(collection.updatedAt ?? 0),
    ext_lautstark_symbol_source: source,
    // Always false, and it is a decision rather than a limitation.
    //
    // §5.2 *requires* false for METACOM, and permits true for ARASAAC. What
    // the flag says is "this may be passed on", and a package built here is a
    // vocabulary made for one person, carrying that person's recordings, in
    // their voice. The builder is in no position to assert it may travel, and
    // the viewer treats the flag as an instruction it must keep after import.
    // False is the answer that stays true whoever the symbols came from.
    ext_lautstark_redistributable: false,
  };

  const imageMembers = [...files.keys()].filter((p) => p.startsWith("images/")).sort();
  const soundMembers = [...files.keys()].filter((p) => p.startsWith("sounds/")).sort();
  if (imageMembers.length) {
    manifest.paths.images = Object.fromEntries(
      imageMembers.map((path) => [`img-${stemOf(path)}`, path]));
  }
  if (soundMembers.length) {
    manifest.paths.sounds = Object.fromEntries(
      soundMembers.map((path) => [`snd-${stemOf(path)}`, path]));
  }
  // §4.1: a hint, and the importer falls back to the platform's own voice. The
  // backend prefix is vorlaut's own bookkeeping - "piper:" says where a voice
  // is synthesised, which is not a thing an Android viewer can act on.
  const voice = input.voice.replace(/^(piper|azure):/, "");
  if (voice) manifest.ext_lautstark_tts_voice = voice;
  // §4.1: false is the default, so the field is written only where it is
  // asked for. A talker Sammlung never asks - its first column is the set key
  // and the speaker's empty corner, which is not a column of anything.
  if (layout.target === "app" && layout.firstColumnGap === true) {
    manifest.ext_lautstark_first_column_gap = true;
  }

  return { manifest, boards, files };
}

/** Putting a picture and a recording into the archive and onto one board.
 *
 * Per board, because §7.1 gives each board its own `images` and `sounds`
 * lists, and shared across them through `files`, because a member is named for
 * its content hash - the same picture on three pages is one member of the zip
 * and one decode on the phone. */
function mediaFor(
  input: PackageInput,
  files: Map<string, Uint8Array<ArrayBuffer>>,
  images: Map<string, PackageImage>,
  sounds: Map<string, PackageSound>,
) {
  return {
    image(reference: string): string | undefined {
      const baked = input.images.get(reference);
      if (!reference || !baked) return undefined;
      const entry: PackageImage = {
        id: `img-${baked.key}`, path: imagePath(baked.key), content_type: "image/png",
      };
      images.set(entry.id, entry);
      files.set(entry.path, baked.bytes);
      return entry.id;
    },
    sound(text: string): string | undefined {
      const baked = input.sounds.get(text);
      if (!text || !baked) return undefined;
      const entry: PackageSound = {
        id: `snd-${baked.key}`, path: soundPath(baked.key),
        content_type: "audio/ogg", duration: baked.seconds,
      };
      sounds.set(entry.id, entry);
      files.set(entry.path, baked.bytes);
      return entry.id;
    },
  };
}

/* ------------------------------------------------------- the five keys --- */

function diyBoards(
  layout: DiyLayout,
  input: PackageInput,
  files: Map<string, Uint8Array<ArrayBuffer>>,
  locale: string,
): { boards: PackageBoard[]; root: string } {
  const sets = layout.sets ?? [];
  if (!sets.length) {
    throw new Error("There is nothing in this Sammlung to export yet.");
  }
  const ids = sets.map((_, index) => `set-${index + 1}`);
  const boards: PackageBoard[] = [];

  for (const [index, set] of sets.entries()) {
    const boardId = ids[index]!;
    const following = ids[(index + 1) % ids.length]!;
    const buttons: PackageButton[] = [];
    const images = new Map<string, PackageImage>();
    const sounds = new Map<string, PackageSound>();
    const put = mediaFor(input, files, images, sounds);

    const present: boolean[] = [];
    for (const [at, slot] of (set.slots ?? []).entries()) {
      const text = String(slot?.text ?? "").trim();
      const reference = String(slot?.symbol ?? "");
      // A key with nothing on it is a cell rather than a button. §7.2 would
      // render an empty button as an empty cell anyway; leaving the button out
      // says the same thing without asking the viewer to draw nothing.
      if (!text && !reference) { present[at] = false; continue; }
      present[at] = true;
      const button: PackageButton = {
        id: `${boardId}-key-${at + 1}`,
        label: String(slot?.text ?? ""),
        border_color: cssColor(set.color),
        // The device speaks on press and has no bar to compose in. §4.3.
        ext_lautstark_speak_immediately: true,
      };
      // Both, and the same text, exactly as the talker export writes them: the
      // label is what the button shows, the vocalization is what it says, and
      // §7.3 puts the vocalization in the message bar. Saying it twice keeps
      // the spoken half right if somebody later shortens the label.
      if (button.label) button.vocalization = button.label;
      const picture = put.image(reference);
      if (picture) button.image_id = picture;
      const recording = put.sound(text);
      if (recording) button.sound_id = recording;
      buttons.push(button);
    }

    const switchKey: PackageButton = {
      id: `${boardId}-set`,
      label: String(set.name ?? ""),
      border_color: cssColor(set.color),
      load_board: {
        id: following,
        name: String(sets[(index + 1) % sets.length]!.name ?? ""),
        path: boardPath(following),
      },
    };
    const setPicture = put.image(String(set.symbol ?? ""));
    if (setPicture) switchKey.image_id = setPicture;
    buttons.push(switchKey);

    boards.push({
      format: FORMAT,
      id: boardId,
      locale,
      name: String(set.name ?? ""),
      buttons,
      grid: grid(boardId, present),
      images: [...images.values()].sort(byId),
      sounds: [...sounds.values()].sort(byId),
      // §4.2: a whole-page colour, which OBF has nowhere else to put. Pages
      // are told apart by colour before they are read, which is the whole
      // point on a device whose user does not read.
      ext_lautstark_board_color: normalizeHex(set.color),
    });
  }

  return { boards, root: ids[0]! };
}

/* ------------------------------------------------------------ the pages --- */

/** A board id, from where the page sits in the Sammlung.
 *
 * Positional and readable rather than the page's own UUID. §7.1 only asks that
 * it be unique within the package, and a package whose ids read `board-3` is
 * one somebody can hold a diff of against the viewer's log. The identity that
 * has to be stable across exports is the *package* id, which §8 puts in the
 * manifest and which is the Sammlung's UUID. */
const appBoardId = (at: number) => `board-${at + 1}`;
const appButtonId = (boardId: string, row: number, col: number) =>
  `${boardId}-r${row + 1}c${col + 1}`;

function appBoards(
  layout: AppLayout,
  input: PackageInput,
  files: Map<string, Uint8Array<ArrayBuffer>>,
  locale: string,
): { boards: PackageBoard[]; root: string } {
  const pages = layout.pages ?? [];
  if (!pages.length) {
    throw new Error("There is nothing in this Sammlung to export yet.");
  }
  const rows = Math.max(1, Math.trunc(layout.grid?.rows ?? 1));
  const columns = Math.max(1, Math.trunc(layout.grid?.columns ?? 1));
  const idOf = new Map(pages.map((page, at) => [page.id, appBoardId(at)]));
  const nameOf = new Map(pages.map((page) => [page.id, String(page.name ?? "")]));
  const boards: PackageBoard[] = [];

  for (const [at, page] of pages.entries()) {
    const boardId = appBoardId(at);
    const buttons: PackageButton[] = [];
    const images = new Map<string, PackageImage>();
    const sounds = new Map<string, PackageSound>();
    const put = mediaFor(input, files, images, sounds);
    // §7.1: exactly `rows` rows of exactly `columns` cells, and a mismatch is
    // a package-level fault. Built as nulls and filled in, so a cell nothing
    // sits in is null by construction rather than by remembering to write one.
    const order: (string | null)[][] =
      Array.from({ length: rows }, () => Array.from({ length: columns }, () => null));

    for (const one of page.buttons ?? []) {
      const row = Math.trunc(one.row);
      const col = Math.trunc(one.col);
      // Outside the grid, or on top of a button already placed. Neither should
      // reach here - the editor keeps both true - and both are dropped rather
      // than written, because §7.1 makes a malformed grid a reason to reject
      // the whole package and losing one button beats losing the vocabulary.
      if (row < 0 || row >= rows || col < 0 || col >= columns) continue;
      if (order[row]![col]) continue;

      const id = appButtonId(boardId, row, col);
      const label = String(one.label ?? "");
      const spoken = spokenTextOf(one);
      const button: PackageButton = { id };
      if (label) button.label = label;
      // Written whenever there is one, including when it is the same as the
      // label: §7.3 says the *bar* shows the vocalization, so a button that
      // left it out would read in the bar as whatever its label happened to
      // be shortened to.
      if (spoken) button.vocalization = spoken;
      const colour = wordClassColor(String(one.wordClass ?? ""));
      if (colour) button.background_color = cssColor(colour);

      const act = one.act ?? { kind: "append" as const };
      switch (act.kind) {
        case "goto": {
          const target = idOf.get(act.page);
          // A `goto` whose page is gone writes no load_board at all, and so
          // becomes an ordinary appending button - which is what the editor
          // does to it the moment a page is deleted. Writing a load_board
          // pointing nowhere would be a button that looks live on a tablet and
          // does nothing, and §7.4 is emphatic about what that teaches.
          if (target) {
            button.load_board = {
              id: target,
              name: nameOf.get(act.page) ?? "",
              path: boardPath(target),
            };
          }
          break;
        }
        case "speak":
          button.ext_lautstark_speak_immediately = true;
          break;
        case "clear": button.action = ":clear"; break;
        case "backspace": button.action = ":backspace"; break;
        case "sayBar": button.action = ":speak"; break;
        case "home": button.action = ":home"; break;
        case "append": break;
      }

      const picture = put.image(String(one.symbol ?? ""));
      if (picture) button.image_id = picture;
      // Only where a press speaks this button's own text - see spokenTexts().
      if (act.kind === "append" || act.kind === "speak") {
        const recording = put.sound(spoken);
        if (recording) button.sound_id = recording;
      }

      // §7.2: nothing to show and nothing to say renders as an empty cell, so
      // it is left as one. A button carrying only an act is the exception and
      // is kept: a bare `:backspace` with no label is a real button somebody
      // put there.
      if (!button.label && !button.image_id && act.kind === "append") continue;

      order[row]![col] = id;
      buttons.push(button);
    }

    boards.push({
      format: FORMAT,
      id: boardId,
      locale,
      name: String(page.name ?? ""),
      buttons,
      grid: { rows, columns, order },
      images: [...images.values()].sort(byId),
      sounds: [...sounds.values()].sort(byId),
      // No ext_lautstark_board_color. §4.2's field is optional and stays
      // defined; a page has no colour to put in it while that idea is being
      // reconsidered, and the viewer already treats the value as nullable. The
      // talker's boards above still carry one, from the set.
    });
  }

  // §7.4's `:home` and §3's root are the same page, and it is the one the
  // layout names rather than the first in the strip - so that reordering the
  // pages in the editor cannot move what a tablet opens on.
  const root = idOf.get(layout.home) ?? appBoardId(0);
  return { boards, root };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const stemOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
const normalizeHex = (value: string): string => {
  const [red, green, blue] = hexToRgb(value);
  return "#" + [red, green, blue].map((n) => n.toString(16).padStart(2, "0")).join("");
};

/* ---------------------------------------------------------- validating --- */

/**
 * Everything wrong with a package, as sentences.
 *
 * These are the checks exchange/tools/make_fixtures.mjs runs over every
 * fixture before it is allowed to write one - the same shape and, where they
 * overlap, the same names in the messages - plus the ones a fixture cannot
 * violate because it is written by hand and this is written by a program:
 * image size, clip length, and the licence pair.
 *
 * Why a builder validates its own output at all: nothing else will. The viewer
 * that finds a fault is on a tablet in somebody's kitchen, and what it can do
 * about it is show a warning to a person who cannot fix it. §9 is written for
 * an importer being lenient about buttons; a builder has the board open and
 * can simply refuse.
 */
export function checkPackage(pkg: AppPackage): string[] {
  const problems: string[] = [];
  const say = (kind: string, detail: string) => problems.push(`[${kind}] ${detail}`);
  const { manifest, boards, files } = pkg;

  // §2: the member names, which is where a package can be actively dangerous.
  //
  // Taken from `paths` rather than derived from the board ids, because §3
  // makes `paths` the authority on where a member lives and because this also
  // reads packages nobody here wrote - the conformance fixtures name a board
  // `hallo` and put it at boards/hello.obf, which is legal and which a checker
  // assuming its own naming would call a missing board.
  const members = new Set([MANIFEST, ...Object.values(manifest.paths?.boards ?? {}),
                           ...files.keys()].map((name) => String(name).normalize("NFC")));
  for (const name of members) {
    if (name.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(name) || /^[A-Za-z]:/.test(name)) {
      say("path-unsafe", `${name} escapes the archive root`);
    }
  }
  const has = (path: unknown) => members.has(String(path ?? "").normalize("NFC"));

  if (manifest.format !== FORMAT) {
    say("manifest", `format is ${JSON.stringify(manifest.format)}, not ${FORMAT}`);
  }
  for (const field of ["ext_lautstark_spec_version", "ext_lautstark_package_id",
                       "ext_lautstark_package_name", "ext_lautstark_modified",
                       "ext_lautstark_symbol_source"] as const) {
    if (!manifest[field]) say("manifest", `${field} is missing`);
  }
  if (typeof manifest.ext_lautstark_redistributable !== "boolean") {
    say("manifest", "ext_lautstark_redistributable is missing");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.ext_lautstark_modified ?? "")) {
    say("manifest", `ext_lautstark_modified ${JSON.stringify(manifest.ext_lautstark_modified)} is not an RFC 3339 UTC time`);
  }
  // §5.2, the rule the whole licensing decision rests on.
  if (manifest.ext_lautstark_symbol_source === "metacom"
      && manifest.ext_lautstark_redistributable !== false) {
    say("licence-inconsistent",
        "symbol_source is metacom, which requires redistributable false");
  }
  // §4.1: a hint, and an importer that cannot read it must not fail - which is
  // exactly why a builder checks it here. A value that is not a boolean is
  // ignored on the tablet and silently drops the gap, so the only place it can
  // still be reported to somebody who can fix it is this side.
  const gap = manifest.ext_lautstark_first_column_gap;
  if (gap !== undefined && typeof gap !== "boolean") {
    say("manifest",
        `ext_lautstark_first_column_gap is ${JSON.stringify(gap)}, which is not a boolean`);
  }
  // And a gap after the first column of a one-column board is a gap after the
  // only column. Nothing can draw it, and a Sammlung that asks for it is one
  // where somebody set a column apart from nothing.
  if (gap === true) {
    for (const board of boards) {
      const columns = board.grid?.columns ?? 0;
      if (columns < 2) {
        say("first-column-gap",
            `${board.id}: the package asks for a gap after the first column and the board has ${columns}`);
      }
    }
  }

  const boardPaths = manifest.paths?.boards ?? {};
  if (!Object.keys(boardPaths).length) say("manifest", "paths.boards is empty");
  if (!Object.values(boardPaths).includes(manifest.root)) {
    say("root-unresolved", `root ${manifest.root} is not a value in paths.boards`);
  }
  const byIdMap = new Map(boards.map((board) => [board.id, board]));
  for (const [id, path] of Object.entries(boardPaths)) {
    if (!has(path)) say("board-unresolved", `paths.boards[${id}] -> ${path}`);
    if (!byIdMap.has(id)) say("board-unresolved", `paths.boards names ${id}, which is not a board`);
  }
  for (const board of boards) {
    if (!boardPaths[board.id]) say("board-unresolved", `board ${board.id} is in no paths.boards entry`);
  }
  for (const [id, path] of Object.entries(manifest.paths?.images ?? {})) {
    if (!has(path)) say("image-unresolved", `paths.images[${id}] -> ${path}`);
  }
  for (const [id, path] of Object.entries(manifest.paths?.sounds ?? {})) {
    if (!has(path)) say("sound-unresolved", `paths.sounds[${id}] -> ${path}`);
  }

  for (const board of boards) {
    // Read defensively rather than by the type: this also runs over packages
    // this builder did not write - the conformance fixtures, in the tests -
    // and OBF leaves images[] and sounds[] out when a board has none.
    const buttons = new Map((board.buttons ?? []).map((b) => [b.id, b]));
    const images = new Map((board.images ?? []).map((i) => [i.id, i]));
    const sounds = new Map((board.sounds ?? []).map((s) => [s.id, s]));
    const order = board.grid?.order ?? [];

    if (!board.locale) say("board", `${board.id}: locale is missing (§7.1)`);
    if (board.format !== FORMAT) say("board", `${board.id}: format is not ${FORMAT}`);

    // §7.1: a grid that disagrees with its own rows and columns is a
    // package-level fault on import, so it must never leave here.
    if (order.length !== board.grid?.rows) {
      say("grid-shape", `${board.id}: rows says ${board.grid?.rows}, order has ${order.length}`);
    }
    for (const row of order) {
      if (row.length !== board.grid?.columns) {
        say("grid-shape", `${board.id}: columns says ${board.grid?.columns}, a row has ${row.length}`);
      }
    }
    const placed = order.flat().filter((cell): cell is string => Boolean(cell));
    for (const cell of placed) {
      if (!buttons.has(cell)) say("grid-ids", `${board.id}: order names ${cell}, which is not in buttons[]`);
    }
    for (const id of buttons.keys()) {
      if (!placed.includes(id)) say("button-unplaced", `${board.id}: button ${id} is in no grid cell`);
    }

    for (const button of board.buttons ?? []) {
      if (button.image_id !== undefined) {
        const entry = images.get(button.image_id);
        if (!entry) say("image-unresolved", `${board.id}/${button.id}: image_id ${button.image_id} not in images[]`);
        else if (!has(entry.path)) say("image-unresolved", `${board.id}/${button.id}: ${entry.path} is not in the archive`);
      }
      if (button.sound_id !== undefined) {
        const entry = sounds.get(button.sound_id);
        if (!entry) say("sound-unresolved", `${board.id}/${button.id}: sound_id ${button.sound_id} not in sounds[]`);
        else if (!has(entry.path)) say("sound-unresolved", `${board.id}/${button.id}: ${entry.path} is not in the archive`);
        else if (entry.duration > MAX_SECONDS) {
          say("sound-too-long", `${board.id}/${button.id}: ${entry.duration.toFixed(1)}s is over the ${MAX_SECONDS}s cap (§6)`);
        }
      }
      const target = button.load_board;
      if (target) {
        if (!byIdMap.has(target.id)) say("load-board", `${board.id}/${button.id}: load_board ${target.id} is not a board`);
        else if (!has(target.path)) say("load-board", `${board.id}/${button.id}: load_board path ${target.path} is not in the archive`);
      }
    }

    // §5: every image is a file in the archive, and never a reference.
    for (const entry of board.images ?? []) {
      if (!has(entry.path)) say("image-unresolved", `${board.id}: ${entry.id} -> ${entry.path} is not in the archive`);
      for (const forbidden of ["url", "data_url", "symbol"]) {
        if (forbidden in entry) {
          say("image-reference", `${board.id}/${entry.id} carries ${forbidden}, and an app package bakes pixels (§5)`);
        }
      }
    }
  }

  // §5.3: the cap is about decoded bitmap memory on a phone, so it is checked
  // against the pixels rather than against anything the document declares.
  for (const [path, bytes] of files) {
    if (!path.endsWith(".png")) continue;
    const size = pngSize(bytes);
    if (!size) { say("image-undecodable", `${path} is not a PNG`); continue; }
    if (size.width > IMAGE_MAX || size.height > IMAGE_MAX) {
      say("image-oversized", `${path} is ${size.width}x${size.height}, over the ${IMAGE_MAX} cap (§5.3)`);
    }
  }
  for (const [path, bytes] of files) {
    if (!path.endsWith(".opus")) continue;
    if (!isOgg(bytes)) say("sound-undecodable", `${path} is not an Ogg stream (§6)`);
  }

  return problems;
}

/** Width and height out of a PNG's IHDR, or null if it is not a PNG.
 *
 * The header only: §5.3 asks an importer to decide from the header before it
 * allocates a bitmap, and a builder checking its own output has even less
 * reason to decode. */
export function pngSize(bytes: Uint8Array<ArrayBuffer>): { width: number; height: number } | null {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || magic.some((byte, at) => bytes[at] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** An Ogg stream begins "OggS", and an Opus one carries OpusHead in page 0. */
export function isOgg(bytes: Uint8Array<ArrayBuffer>): boolean {
  const text = new TextDecoder().decode(bytes.slice(0, 64));
  return text.startsWith("OggS") && text.includes("OpusHead");
}

/* ------------------------------------------------------------- writing --- */

/** The bytes obf.py's _json_bytes() writes, and the ones this writes too:
 *  sorted keys, indented by two, a newline at the end. Sorted so that a diff
 *  of two exports is about the board rather than about object order. */
export function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(sortDeep(value), null, 2) + "\n");
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort()) {
    out[key] = sortDeep((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * The package as the bytes of a .obz - checked first, always.
 *
 * checkPackage() before zipBytes() and no way past it, for the same reason
 * obf.ts puts checkLicensing() at the top of writeObz(): an invariant is worth
 * what the one door enforcing it is worth. A caller that wants the problems
 * without the refusal can call checkPackage() itself.
 */
export async function packageBytes(pkg: AppPackage): Promise<Uint8Array<ArrayBuffer>> {
  const problems = checkPackage(pkg);
  if (problems.length) {
    throw new Error(
      "This package does not match exchange/SPEC.md, so it was not written:\n" +
      problems.map((one) => `  ${one}`).join("\n"));
  }
  const members: ZipMember[] = [
    { name: MANIFEST, data: jsonBytes(pkg.manifest) },
    ...pkg.boards.map((board) => ({ name: boardPath(board.id), data: jsonBytes(board) })),
    // PNG and Opus are compressed already; deflating them again is work that
    // makes the file bigger.
    ...[...pkg.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, data]) => ({ name, data, deflate: false })),
  ];
  return zipBytes(members);
}

export { encodeOpus, ENCODER_RATE };
export type { OpusClip };
