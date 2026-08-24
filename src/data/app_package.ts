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

import { LANGUAGE_CODES, DEFAULT_LANGUAGE, hexToRgb } from "./layout_format.js";
import { encodeOpus, ENCODER_RATE, type OpusClip } from "./opus.js";
import { zipBytes, type ZipMember } from "./zip.js";
import type { CollectionRef, Layout } from "../core/types.js";

/** The version of exchange/SPEC.md this builder targets.
 *
 * §12: a builder writes the version it targets, not the version it happens to
 * fit. Bumping this is a decision about having read the changelog. */
export const SPEC_VERSION = "1.0.0";

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
  border_color?: string;
  load_board?: { id: string; name: string; path: string };
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
  for (const set of layout.sets ?? []) {
    for (const reference of [set.symbol, ...(set.slots ?? []).map((s) => s.symbol)]) {
      if (!reference) continue;
      if (reference.startsWith("metacom:")) metacom = true;
      else if (/^arasaac-/.test(reference)) arasaac = true;
    }
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
  const sets = layout.sets ?? [];
  if (!sets.length) {
    throw new Error("There is nothing in this Sammlung to export yet.");
  }

  const source = symbolSource(layout);
  const ids = sets.map((_, index) => `set-${index + 1}`);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const boards: PackageBoard[] = [];
  const locale = localeFor(input.voice, layout.language);

  for (const [index, set] of sets.entries()) {
    const boardId = ids[index]!;
    const following = ids[(index + 1) % ids.length]!;
    const buttons: PackageButton[] = [];
    const images = new Map<string, PackageImage>();
    const sounds = new Map<string, PackageSound>();

    /** Puts a picture in the archive and on the board, and answers with its id. */
    const withImage = (reference: string): string | undefined => {
      const baked = input.images.get(reference);
      if (!reference || !baked) return undefined;
      const key = baked.key;
      const entry: PackageImage = {
        id: `img-${key}`, path: imagePath(key), content_type: "image/png",
      };
      images.set(entry.id, entry);
      files.set(entry.path, baked.bytes);
      return entry.id;
    };

    const withSound = (text: string): string | undefined => {
      const baked = input.sounds.get(text);
      if (!baked) return undefined;
      const key = baked.key;
      const entry: PackageSound = {
        id: `snd-${key}`, path: soundPath(key),
        content_type: "audio/ogg", duration: baked.seconds,
      };
      sounds.set(entry.id, entry);
      files.set(entry.path, baked.bytes);
      return entry.id;
    };

    const present: boolean[] = [];
    for (const [at, slot] of (set.slots ?? []).entries()) {
      const text = String(slot?.text ?? "");
      const reference = String(slot?.symbol ?? "");
      // A key with nothing on it is a cell rather than a button. §7.2 would
      // render an empty button as an empty cell anyway; leaving the button out
      // says the same thing without asking the viewer to draw nothing.
      if (!text && !reference) { present[at] = false; continue; }
      present[at] = true;
      const button: PackageButton = {
        id: `${boardId}-key-${at + 1}`,
        label: text,
        border_color: cssColor(set.color),
        // The device speaks on press and has no bar to compose in. §4.3.
        ext_lautstark_speak_immediately: true,
      };
      // Both, and the same text, exactly as the talker export writes them: the
      // label is what the button shows, the vocalization is what it says, and
      // §7.3 puts the vocalization in the message bar. Saying it twice keeps
      // the spoken half right if somebody later shortens the label.
      if (text) button.vocalization = text;
      const picture = withImage(reference);
      if (picture) button.image_id = picture;
      const recording = text ? withSound(text) : undefined;
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
    const setPicture = withImage(String(set.symbol ?? ""));
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

  const root = ids[0]!;
  const manifest: PackageManifest = {
    format: FORMAT,
    root: boardPath(root),
    paths: {
      boards: Object.fromEntries(ids.map((id) => [id, boardPath(id)])),
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

  return { manifest, boards, files };
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
