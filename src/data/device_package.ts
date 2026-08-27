// A Sammlung as the device build's own .obz: sources, flags and 16 kHz WAVs.
//
// The third export door, and docs/obz-as-device-input.md is the measurement it
// comes out of. That document asked whether an .obz could be the input to the
// device build and answered yes - every gap between what runBuild() consumes
// and what the existing exports emit is a matter of form rather than of
// presence. This is that form, written down.
//
// ---------------------------------------------------------------------------
// Why a third door rather than a flag on one of the two
//
// exchange/SPEC.md §5.2, in as many words: an export that bakes pixels MUST be
// a separate entry point from the talker's, "a different function, not the
// same one behind a flag". obf.ts writes references and refuses METACOM
// pixels; app_package.ts writes a tablet's pixels; this writes a device's
// sources. Three functions, no shared entry point, and nothing here imports
// obf.ts - not even its grid(), which is twenty lines this file writes again
// on purpose. app_package.ts made the same copy for the same reason, and the
// reason is that a helper shared across that line is where a flag grows.
//
// adr/0010 is the decision, and it exists because three functions that all
// write .obz look exactly like one function with a parameter.
//
// ---------------------------------------------------------------------------
// Why this file is worth having at all
//
// A device build lives in IndexedDB, in one browser, on one machine. Nothing
// anywhere says "this is what is on that talker" in a form somebody can diff,
// archive, or carry to a bench. The folder export writes the loose files and
// cannot be read back. This can: readDevicePackage() and compileDevice() below
// turn the file back into exactly the bytes runBuild() puts in the store.
//
// That is the whole claim, and tests/unit/device_roundtrip.test.ts is where it
// is held to it.
//
// ---------------------------------------------------------------------------
// The four form rules, and what each one is
//
// 1. THE PICTURES ARE THE SOURCES. images/ holds what renderSymbol() needs,
//    not what a button needs, and that is the sentence the shape of an app
//    package hides. app_assets.ts fits a source into 512 through a canvas and
//    says so in its own first line - "Not the device's tile." Compiling a tile
//    out of that PNG resamples twice: for any pictogram larger than 512 the
//    result is provably not the pixels tiles.ts produces, fillColour() reads a
//    different edge, and the alpha has been through a canvas premultiply that
//    tiles.ts has hand-written helpers specifically to avoid. Every tile hash
//    would move and tests/reference/tiles.lock.json would be invalidated.
//
//    So the source travels unresampled, at its own size, in whatever format it
//    was stored in. There is no maximum here and there is deliberately none:
//    exchange/SPEC.md §5.3's 1024 cap is about a tablet's decoded bitmap heap,
//    and §1 of that document puts the talker's .obz outside its scope.
//
// 2. NEGATION IS A FLAG. negateInto() fills a hard-edged nine-pixel cross into
//    the composed tile without antialiasing, because a tile is compared byte
//    for byte against a frozen reference; crossOut() strokes an antialiased
//    one onto the tablet's PNG. Two different drawings on purpose. Baking
//    either into the source would put the wrong one on the device and would
//    make one reference two files for no gain, so ext_vorlaut_negated travels
//    and renderSymbol(source, { negated }) runs exactly as it runs today.
//
// 3. THE SOUND IS THE DEVICE'S WAV. adr/0008 settles it: both delivered
//    artefacts derive from the master and never from each other. That rule
//    forbids deriving the device's WAV from the package's Opus. It says
//    nothing against carrying the device's WAV, which is the master's own
//    child and already sits in the data store under its own name. So sounds/
//    holds a<hash>.wav - the bytes the cable would have sent - and adr/0008 is
//    satisfied by construction rather than by care.
//
// 4. THE LANGUAGE IS THE FIELD ITSELF. localeFor() in app_package.ts derives a
//    locale from the *voice*, because on Android the voice hint is nearly
//    always unavailable. layout.language is a different thing - the language
//    the device shows its own menu in, and the index into LANGUAGE_CODES that
//    becomes header byte 7. The two are not interchangeable. Here `locale` is
//    layout.language and nothing else, which is what obf.ts already writes.
//
// ---------------------------------------------------------------------------
// What it did NOT need, which is the part worth reporting
//
// No new ext_vorlaut_* field, and therefore no change to exchange/SPEC.md.
// Every field this profile needs was already being written by obf.ts:
// ext_vorlaut_negated on a button, ext_vorlaut_sleep_timeout_seconds and
// ext_vorlaut_voice on the root board. The rest is plain OBF - `locale`,
// images[].path, sounds[].path - and §1 of SPEC.md puts the talker's .obz out
// of its scope entirely, so none of §5.3's PNG-and-1024 rules reach here.
//
// A marker field saying "this one is compilable" was considered and left out.
// compileDevice() refuses a package it cannot compile by looking at what is
// actually there - an image entry with no bytes behind it, a sound that is not
// a 16 kHz mono WAV - and a structural check beats a flag, because a flag can
// be written by a wrong writer too. docs/device-interface.md §6 is the reason
// it refuses rather than guesses: a key that says the wrong sentence is worse
// than one that says nothing, because it is said to somebody who believes it.
//
// ---------------------------------------------------------------------------
// The references travel too, beside the pixels
//
// images[] carries `symbol` as well as `path`. The pixels are what the
// compiler wants; the reference is what makes this file readable by everything
// that already reads a talker document - obf.importObz() takes its symbol out
// of that field, so a device export dropped into the import door comes back as
// the Sammlung it was rather than as a Sammlung with no pictures. Writing only
// `path` would have been a file that imports silently wrong, which is the one
// failure mode worse than refusing.

import { slotIsEmpty } from "./app_package.js";
import {
  DEVICE_BITS_PER_SAMPLE, DEVICE_CHANNELS, DEVICE_SAMPLE_RATE,
} from "./audio_format.js";
import {
  HASH_BYTES, LAYOUT_BIN, SLOTS_PER_SET, renderLayoutBin,
} from "./layout_format.js";
import * as tiles from "./tiles.js";
import { zipBytes, type ZipMember } from "./zip.js";
import type { DiyLayout } from "../core/types.js";

export const FORMAT = "open-board-0.1";
const MANIFEST = "manifest.json";

/** The symbol set a bare file name belongs to, and the one a "metacom:"
 *  reference does. The same two words obf.ts writes, because the field is read
 *  back by obf.importObz() and a third spelling would not round trip. */
const OWN_SET = "vorlaut";
const METACOM_SET = "metacom";

/** `a` + 32 hex + `.wav`: what layout.bin can carry and hashBytes() can read.
 *  A name of any other shape is refused rather than written, because
 *  hashBytes() throws on it at the far end of a build nobody is watching. */
const AUDIO_NAME = new RegExp(`^a[0-9a-f]{${HASH_BYTES * 2}}\\.wav$`);

/* ------------------------------------------------------------- reading --- */

/** One slot, as the device build reads it. */
export interface DeviceSlot {
  text: string;
  /** The picture reference, "" for none. Not crossed out: see `negated`. */
  symbol: string;
  negated: boolean;
  /** slotIsEmpty(), asked once and carried.
   *
   *  Carried rather than re-derived at each of the three places that want it,
   *  because the three answering differently is precisely the divergence
   *  docs/obz-as-device-input.md §5 found: an untouched key was an empty cell
   *  on a tablet and a missing-picture cross on the device, and no test could
   *  see it because the paths never met. They meet here. */
  empty: boolean;
}

export interface DeviceSet {
  name: string;
  /** The set key's picture reference, "" for none. */
  symbol: string;
  slots: DeviceSlot[];
}

/**
 * A Layout as the nine things runBuild() takes out of one, and nothing else.
 *
 * The one reading, asked by the export, by the compiler and by the build. What
 * makes it worth a type rather than three walks over `layout.sets` is that the
 * three walks are what drifted apart before.
 *
 * Slots are cut at SLOTS_PER_SET and are deliberately NOT padded up to it. A
 * short set is a set layout.bin writes zero hashes for, which is what the
 * device already does with one, and reproducing that faithfully is this file's
 * job - obf.ts's normalizeLayout() is where a short set gets padded, on the
 * way *in*, and correcting one here would make the export disagree with the
 * build it is meant to reconstruct.
 */
export interface DevicePlan {
  /** layout.language: the index into LANGUAGE_CODES, header byte 7. Passed
   *  through as it stands - renderLayoutBin() owns the fallback. */
  language: string;
  /** chosenVoice(layout): what every WAV is named for. The caller resolves it,
   *  because the fallback reads the shipped voice catalogue. */
  voice: string;
  sleepTimeoutSeconds: number;
  sets: DeviceSet[];
}

export function devicePlan(layout: DiyLayout, voice: string): DevicePlan {
  return {
    language: String(layout.language ?? ""),
    voice: String(voice ?? ""),
    sleepTimeoutSeconds: Number(layout.sleep_timeout_seconds ?? 0),
    sets: (layout.sets ?? []).map((set) => ({
      name: String(set?.name ?? ""),
      symbol: String(set?.symbol ?? ""),
      slots: (set?.slots ?? []).slice(0, SLOTS_PER_SET).map((slot) => ({
        text: String(slot?.text ?? ""),
        symbol: String(slot?.symbol ?? ""),
        negated: Boolean(slot?.negated),
        empty: slotIsEmpty(slot),
      })),
    })),
  };
}

/** The plan back as the Layout renderLayoutBin() reads.
 *
 * That function wants a layout rather than a plan, and it is device-format
 * code that this file has no business reshaping. So the plan is handed back in
 * the shape it asks for, which is also the proof that nothing was lost on the
 * way through: every field it reads is one the plan carries. */
export const planLayout = (plan: DevicePlan): DiyLayout => ({
  language: plan.language,
  voice: plan.voice,
  sleep_timeout_seconds: plan.sleepTimeoutSeconds,
  sets: plan.sets.map((set) => ({
    name: set.name,
    symbol: set.symbol,
    slots: set.slots.map((slot) => ({
      text: slot.text, symbol: slot.symbol, negated: slot.negated,
    })),
  })),
});

/* -------------------------------------------------------------- shapes --- */

/** One source picture, exactly as it is stored, un-resampled and un-crossed.
 *
 * Keyed by the reference alone rather than by pictureKey(): the cross is a
 * flag here (form rule 2), so a reference and the same reference crossed out
 * are one file in this archive where they are two in an app package. */
export interface DeviceSource {
  /** The content hash the member is named for. Computed by whoever read the
   *  bytes rather than here, because hashing is asynchronous and this half of
   *  the work is a pure function - the same division BakedImage makes. */
  key: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** What the bytes actually are - "image/png", "image/jpeg", "image/svg+xml".
   *  Written into the entry rather than guessed from the reference, because a
   *  reference is a store key and somebody's upload keeps its own name. */
  contentType: string;
}

/** One spoken sentence as the device's own WAV, under the device's own name. */
export interface DeviceSound {
  /** a<hash>.wav, as runBuild() named it. The name travels rather than being
   *  re-derived here: the rule is text, voice, PIPELINE_VERSION and every
   *  option that changes how a sentence sounds, and it lives beside the
   *  synthesis in backend/local.ts where the options are. Carrying the name
   *  keeps that rule in one place and makes the compiler a copy. */
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface DeviceInput {
  layout: DiyLayout;
  /** chosenVoice(layout) - see DevicePlan.voice. */
  voice: string;
  /** Sources by reference. */
  sources: Map<string, DeviceSource>;
  /** WAVs by the sentence they say. */
  sounds: Map<string, DeviceSound>;
}

export interface DeviceImageEntry {
  id: string;
  /** Where the source lives in the archive - absent when the reference
   *  resolved to nothing, which is a gap the file records rather than hides.
   *  See putImage(). */
  path?: string;
  content_type?: string;
  /** The reference this picture came from, so the file still imports as a
   *  Sammlung. obf.symbolOf() reads exactly this. */
  symbol: { set: string; filename: string };
}

export interface DeviceSoundEntry {
  id: string;
  path: string;
  content_type: string;
  /** Seconds, off the WAV's own header. OBF has the field and a person
   *  reading the file at a bench has no other way to see the length. */
  duration: number;
}

export interface DeviceButton {
  id: string;
  label: string;
  vocalization?: string;
  image_id?: string;
  sound_id?: string;
  load_board?: { id: string; name: string; path: string };
  /** Slot.negated. Form rule 2 - the flag, not a baked cross. */
  ext_vorlaut_negated?: boolean;
}

export interface DeviceBoard {
  format: string;
  id: string;
  /** layout.language itself. Form rule 4. */
  locale: string;
  name: string;
  buttons: DeviceButton[];
  grid: { rows: number; columns: number; order: (string | null)[][] };
  images: DeviceImageEntry[];
  sounds: DeviceSoundEntry[];
  /** Root board only, both of them - a manifest is an index of a zip and gets
   *  rebuilt by any tool that touches it, whereas a board is the document.
   *  obf.ts puts them in the same place for the same reason. */
  ext_vorlaut_sleep_timeout_seconds?: number;
  ext_vorlaut_voice?: string;
}

export interface DeviceManifest {
  format: string;
  root: string;
  paths: {
    boards: Record<string, string>;
    images?: Record<string, string>;
    sounds?: Record<string, string>;
  };
}

export interface DevicePackage {
  manifest: DeviceManifest;
  boards: DeviceBoard[];
  /** Archive path -> bytes, for everything that is not a board document. */
  files: Map<string, Uint8Array<ArrayBuffer>>;
}

/* -------------------------------------------------------------- naming --- */

const boardId = (at: number) => `set-${at + 1}`;
export const boardPath = (id: string) => `boards/${id}.obf`;
const stemOf = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/** The extension a content type gets in the archive.
 *
 * The source keeps its own format, so the member has to say which one it is
 * twice: in content_type, which is the authority, and in the name, which is
 * what somebody running `unzip -l` reads. Anything unrecognised keeps .bin
 * rather than being refused - the compiler decodes by content type and an
 * archive member's extension decides nothing. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/**
 * What a source picture actually is, read out of its first bytes.
 *
 * The reference is a store key and an upload keeps whatever name its file had,
 * so the extension is not evidence - "grandma.png" is whatever somebody saved
 * under that name. The magic numbers are, and content_type is the field the
 * compiler decodes by, so getting it from the bytes is the only honest way.
 *
 * "application/octet-stream" for anything unrecognised rather than a refusal:
 * decoding is the host's, browsers take formats this list has never heard of,
 * and a source that will not decode draws the grey cross renderSymbol() draws
 * for every other unresolved picture. Refusing here would turn a key that says
 * nothing into an export that does not exist.
 */
export function sniffImageType(bytes: Uint8Array): string {
  const starts = (...magic: number[]) =>
    magic.every((byte, at) => bytes[at] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes.length > 12
      && starts(0x52, 0x49, 0x46, 0x46) && [0x57, 0x45, 0x42, 0x50]
        .every((byte, at) => bytes[8 + at] === byte)) return "image/webp";
  // SVG is text and has no magic number. The declaration is optional, so both
  // openings are looked for, and only at the very start - a "<svg" further in
  // is a string in some other document.
  const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "application/octet-stream";
}

/** A short content hash, which is what a source is named for.
 *
 * Content rather than a counter, so the same picture on three keys is one
 * member of the archive - and so that an unchanged Sammlung exports to
 * unchanged bytes. Sixteen hex characters, matching app_package.digest(): this
 * is the *archive* member's name and never reaches layout.bin, where the
 * device's own 32-character tile hash goes. */
export async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0"))
    .join("").slice(0, 16);
}

/**
 * The id an unresolved picture's entry carries.
 *
 * A resolved one is named for its content hash, which an unresolved one has
 * none of - there are no bytes. The reference itself is what is left, and it
 * is unique within the board by construction, so it is used directly with the
 * characters an OBF id should not carry replaced. It never names a member of
 * the archive: there is no member.
 */
const unresolvedId = (reference: string): string =>
  `none-${reference.replace(/[^A-Za-z0-9._-]+/g, "-")}`;

/** A reference split the way obf.ts splits it, so the field round trips. */
function splitReference(reference: string): { set: string; filename: string } {
  return reference.startsWith(`${METACOM_SET}:`)
    ? { set: METACOM_SET, filename: reference.slice(METACOM_SET.length + 1) }
    : { set: OWN_SET, filename: reference };
}

const joinReference = (set: string, filename: string): string =>
  !filename ? "" : set === METACOM_SET ? `${METACOM_SET}:${filename}` : filename;

/* ---------------------------------------------------------------- WAVs --- */

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Bytes in the data chunk, which is what a length is worked out from. */
  dataBytes: number;
}

/**
 * What a RIFF/WAVE file declares about itself, or null if it is not one.
 *
 * The check audio_format.ts says nobody was making. Its own comment is that
 * the obligation runs one way - a writer MUST produce 16 kHz mono 16-bit, and
 * the device checks none of it, because seekToWavData() finds the data chunk
 * and plays whatever is in it at the rate I2S was started with. A file at
 * another rate is therefore not refused on the device, it is a word at the
 * wrong pitch. So the rule has to be kept on this side, and this is the first
 * place in this repository that keeps it.
 *
 * The chunks are walked rather than read at fixed offsets: a synthesiser is
 * entitled to write LIST or fact between fmt and data, and a reader that
 * assumed the canonical 44-byte header would reject a perfectly good file.
 */
export function wavFormat(bytes: Uint8Array): WavFormat | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;

  let found: Omit<WavFormat, "dataBytes"> | null = null;
  let dataBytes = -1;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const name = tag(at);
    const size = view.getUint32(at + 4, true);
    if (name === "fmt " && size >= 16 && at + 8 + 16 <= bytes.length) {
      found = {
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
        bitsPerSample: view.getUint16(at + 22, true),
      };
    } else if (name === "data") {
      // Against what is actually there as well as what is declared: a
      // truncated file declares the length it meant to have.
      dataBytes = Math.min(size, Math.max(0, bytes.length - (at + 8)));
    }
    // Chunks are word aligned, and an odd size carries a pad byte that is not
    // counted in it.
    at += 8 + size + (size % 2);
  }
  if (!found || dataBytes < 0) return null;
  return { ...found, dataBytes };
}

/** Whether a WAV is the one the device plays: 16 kHz, mono, 16-bit. */
export const isDeviceWav = (format: WavFormat | null): boolean =>
  format !== null
  && format.sampleRate === DEVICE_SAMPLE_RATE
  && format.channels === DEVICE_CHANNELS
  && format.bitsPerSample === DEVICE_BITS_PER_SAMPLE;

/** How long the clip runs, from the header alone. */
export const wavSeconds = (format: WavFormat): number => {
  const perFrame = format.channels * (format.bitsPerSample / 8);
  return perFrame > 0 && format.sampleRate > 0
    ? format.dataBytes / perFrame / format.sampleRate : 0;
};

/* ------------------------------------------------------------ building --- */

/** The five keys where they really sit - two rows of three, and the top left
 *  cell empty because that is where the speaker is (docs/hardware.md).
 *
 *      .        key 1    key 2
 *      set      key 3    key 4
 *
 *  Written again rather than taken from obf.ts or app_package.ts. Both of
 *  those have their own copy already, and the reason is the one at the head of
 *  this file: a helper reaching across the §5.2 line is where a flag grows.
 *  Twenty lines is the price of three doors that cannot be talked into being
 *  one, and adr/0010 is where that price is argued.
 *
 *  Every slot gets a cell, including an empty one. That is where this differs
 *  from diyBoards(), and the difference is not a disagreement: a tablet grid
 *  can leave a cell out, and the device has five panels that are always lit,
 *  so a key that holds nothing is still a key. Which of them hold nothing is
 *  DeviceSlot.empty, and the compiler draws tiles.blank() for those. */
function deviceGrid(id: string, slots: number) {
  const key = (at: number) => (at < slots ? `${id}-key-${at + 1}` : null);
  return {
    rows: 2,
    columns: 3,
    order: [
      [null, key(0), key(1)],
      [`${id}-set`, key(2), key(3)],
    ],
  };
}

/**
 * The package as data. Pure: no canvas, no store, no clock, no synthesiser.
 *
 * Everything expensive has already happened - the sources are bytes out of the
 * store or out of a licensed folder, the WAVs are bytes out of the same build
 * cache the cable reads. What is left is a mapping over data, which is what
 * makes it checkable under node.
 *
 * It refuses rather than writes a file that cannot be compiled: a WAV that is
 * not the device's, or a name layout.bin cannot carry. Both would travel all
 * the way to a talker before anything noticed.
 */
export function buildDevicePackage(input: DeviceInput): DevicePackage {
  const plan = devicePlan(input.layout, input.voice);
  if (!plan.sets.length) {
    throw new Error("There is nothing in this Sammlung to export yet.");
  }

  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const boards: DeviceBoard[] = [];
  const ids = plan.sets.map((_, at) => boardId(at));

  for (const [index, set] of plan.sets.entries()) {
    const id = ids[index]!;
    const following = ids[(index + 1) % ids.length]!;
    const images = new Map<string, DeviceImageEntry>();
    const sounds = new Map<string, DeviceSoundEntry>();
    const buttons: DeviceButton[] = [];

    /**
     * The source behind a reference, as an entry and a member.
     *
     * A reference that resolved to nothing still gets an entry - the reference,
     * and no `path`. That is the case this file got wrong first, and the round
     * trip is what found it: dropping the entry altogether loses the reference,
     * so the Sammlung comes back with an empty key where it had a picture
     * nobody could find. Two things then go wrong, and the second is the one
     * that matters. The file stops being a record of the Sammlung, and - if
     * that key also has no word - slotIsEmpty() answers differently on the way
     * back in, so a key the build drew the grey cross for compiles to a blank.
     * That is the divergence of docs/obz-as-device-input.md §5, re-entering by
     * the door built to close it.
     *
     * So the gap travels as a gap. The build drew "a picture is missing" and
     * the export says a picture is missing, which is the same sentence.
     */
    const putImage = (reference: string): string | undefined => {
      if (!reference) return undefined;
      const source = input.sources.get(reference);
      const entry: DeviceImageEntry = source
        ? {
            id: `img-${source.key}`,
            path: `images/${source.key}.${EXTENSIONS[source.contentType] ?? "bin"}`,
            content_type: source.contentType,
            symbol: splitReference(reference),
          }
        : { id: `img-${unresolvedId(reference)}`, symbol: splitReference(reference) };
      images.set(entry.id, entry);
      if (source && entry.path) files.set(entry.path, source.bytes);
      return entry.id;
    };

    const putSound = (text: string): string | undefined => {
      const sound = text ? input.sounds.get(text) : undefined;
      if (!sound) return undefined;
      // Refused here rather than at the far end of a build nobody is
      // watching. A name of another shape is one hashBytes() throws on; a WAV
      // of another format is a word at the wrong pitch, which the device does
      // not refuse and cannot report - see wavFormat() above.
      if (!AUDIO_NAME.test(sound.name)) {
        throw new Error(
          `${sound.name} is not a name layout.bin can carry: a device WAV is ` +
          `"a" and ${HASH_BYTES * 2} hex characters.`);
      }
      const format = wavFormat(sound.bytes);
      if (!isDeviceWav(format)) {
        throw new Error(
          `${sound.name} is not the WAV the device plays. It wants ` +
          `${DEVICE_SAMPLE_RATE} Hz, ${DEVICE_CHANNELS} channel, ` +
          `${DEVICE_BITS_PER_SAMPLE}-bit, and this is ` +
          (format
            ? `${format.sampleRate} Hz, ${format.channels} channel, ` +
              `${format.bitsPerSample}-bit.`
            : "not a RIFF/WAVE file at all."));
      }
      const entry: DeviceSoundEntry = {
        id: `snd-${stemOf(sound.name)}`,
        path: `sounds/${sound.name}`,
        content_type: "audio/wav",
        duration: wavSeconds(format!),
      };
      sounds.set(entry.id, entry);
      files.set(entry.path, sound.bytes);
      return entry.id;
    };

    for (const [at, slot] of set.slots.entries()) {
      const button: DeviceButton = {
        id: `${id}-key-${at + 1}`,
        // Both, and the same text, exactly as obf.ts and app_package.ts write
        // them: the label is what any other editor shows, the vocalization is
        // what gets spoken. The device writes no caption, so on this profile
        // they are one sentence - but saying it twice is what keeps the spoken
        // half right if somebody later shortens the label.
        label: slot.text,
      };
      if (slot.text) button.vocalization = slot.text;
      const picture = putImage(slot.symbol);
      if (picture) button.image_id = picture;
      // Written only when true, so a Sammlung with no crossed-out key exports
      // byte for byte the file it did before this existed.
      if (slot.negated) button.ext_vorlaut_negated = true;
      const recording = putSound(slot.text);
      if (recording) button.sound_id = recording;
      buttons.push(button);
    }

    const switchKey: DeviceButton = {
      id: `${id}-set`,
      label: set.name,
      load_board: {
        id: following,
        name: plan.sets[(index + 1) % plan.sets.length]!.name,
        path: boardPath(following),
      },
    };
    const setPicture = putImage(set.symbol);
    if (setPicture) switchKey.image_id = setPicture;
    buttons.push(switchKey);

    const board: DeviceBoard = {
      format: FORMAT,
      id,
      locale: plan.language,
      name: set.name,
      buttons,
      grid: deviceGrid(id, set.slots.length),
      images: [...images.values()].sort(byId),
      sounds: [...sounds.values()].sort(byId),
    };
    if (index === 0) {
      board.ext_vorlaut_sleep_timeout_seconds = plan.sleepTimeoutSeconds;
      board.ext_vorlaut_voice = plan.voice;
    }
    boards.push(board);
  }

  const manifest: DeviceManifest = {
    format: FORMAT,
    root: boardPath(ids[0]!),
    paths: { boards: Object.fromEntries(boards.map((one) => [one.id, boardPath(one.id)])) },
  };
  const listed = (prefix: string, mark: string) => {
    const members = [...files.keys()].filter((one) => one.startsWith(prefix)).sort();
    return members.length
      ? Object.fromEntries(members.map((path) => [`${mark}-${stemOf(path)}`, path]))
      : undefined;
  };
  const images = listed("images/", "img");
  const sounds = listed("sounds/", "snd");
  if (images) manifest.paths.images = images;
  if (sounds) manifest.paths.sounds = sounds;

  return { manifest, boards, files };
}

const byId = (a: { id: string }, b: { id: string }) =>
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/* -------------------------------------------------------------- writing --- */

/** The bytes obf.py's _json_bytes() writes, and the ones this writes too:
 *  sorted keys, indented by two, a newline at the end. Sorted so that a diff
 *  of two exports is about the Sammlung rather than about object order. */
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
 * The package as the bytes of a .obz.
 *
 * Manifest first, then boards, then media, so that `unzip -l` reads in the
 * order the format describes itself in.
 *
 * The media are stored rather than deflated. A PNG and a WAV of speech are
 * both already about as small as they go, and a device export is a thing
 * somebody opens at a bench - a stored member can be pulled out of the archive
 * with dd and a byte offset when whatever they have to hand cannot inflate.
 */
export async function devicePackageBytes(
  pkg: DevicePackage,
): Promise<Uint8Array<ArrayBuffer>> {
  const members: ZipMember[] = [
    { name: MANIFEST, data: jsonBytes(pkg.manifest) },
    ...pkg.boards.map((board) => ({
      name: boardPath(board.id), data: jsonBytes(board),
    })),
    ...[...pkg.files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, data]) => ({ name, data, deflate: false })),
  ];
  return await zipBytes(members);
}

/* -------------------------------------------------------------- reading --- */

/** A device export read back: the plan it carries, and the bytes behind it.
 *
 * The inverse of buildDevicePackage(), and the half that makes the claim at
 * the head of this file true. Without it the export is a write-only artefact
 * and "reconstruct a device build without the editor's IndexedDB" is a slogan.
 */
export interface ReadDevicePackage {
  plan: DevicePlan;
  /** Sources by reference, as they were written. */
  sources: Map<string, DeviceSource>;
  /** WAVs by the sentence they say. */
  sounds: Map<string, DeviceSound>;
}

/**
 * A device export, back as the plan and the media it holds.
 *
 * Takes the package already unzipped, so that this file needs no zip reader:
 * the writing half is zip.ts's and the reading half belongs to whoever opened
 * the archive. obf.ts has the one importer this repository ships, and a second
 * one here would be a second opinion about central directories.
 *
 * Refuses rather than guesses. A board this cannot read is a device that
 * parses and is wrong, which docs/device-interface.md §6 is a whole section
 * about: a key that says the wrong sentence is worse than one that says
 * nothing, because it is said to somebody who believes it.
 */
export function readDevicePackage(pkg: DevicePackage): ReadDevicePackage {
  const order = Object.keys(pkg.manifest?.paths?.boards ?? {});
  if (!order.length) throw new Error("This package names no boards.");

  const byBoardId = new Map(pkg.boards.map((board) => [board.id, board]));
  // The ring is the order, and the order is the ring: set N's key loads set
  // N+1 and the last comes back round to the first. Following it rather than
  // trusting the manifest's key order, because a manifest is an index that any
  // tool may rewrite and the ring is what the device actually cycles.
  const rootId = stemOf(String(pkg.manifest.root ?? ""));
  const walked: DeviceBoard[] = [];
  const seen = new Set<string>();
  let at: string | undefined = rootId;
  while (at && !seen.has(at)) {
    const board = byBoardId.get(at);
    if (!board) throw new Error(`This package names a board it does not hold: ${at}`);
    seen.add(at);
    walked.push(board);
    at = board.buttons.find((one) => one.load_board)?.load_board?.id;
  }
  if (walked.length !== byBoardId.size) {
    throw new Error(
      "The ring in this package does not reach every board in it, so the " +
      "order the device would cycle them in is not the order they are filed " +
      `under - ${walked.length} reached of ${byBoardId.size}.`);
  }

  const sources = new Map<string, DeviceSource>();
  const sounds = new Map<string, DeviceSound>();
  const root = walked[0]!;
  const sets: DeviceSet[] = [];

  for (const board of walked) {
    const images = new Map(board.images?.map((one) => [one.id, one]) ?? []);
    const soundEntries = new Map(board.sounds?.map((one) => [one.id, one]) ?? []);

    /** The reference behind a button's picture, and the bytes filed with it. */
    const referenceOf = (button: DeviceButton | undefined): string => {
      if (!button?.image_id) return "";
      const entry = images.get(button.image_id);
      if (!entry) {
        throw new Error(
          `${button.id} names a picture the board does not list: ${button.image_id}`);
      }
      const reference = joinReference(
        String(entry.symbol?.set ?? OWN_SET), String(entry.symbol?.filename ?? ""));
      if (!reference) {
        throw new Error(
          `${button.id} carries a picture with no reference behind it. A ` +
          "device export writes images[].symbol beside the bytes so that the " +
          "file still reads as a Sammlung - see the head of device_package.ts.");
      }
      if (!entry.path) {
        // A gap the export recorded: this reference resolved to nothing when
        // the file was written, and the build drew its grey cross for the same
        // key. The reference comes back so the Sammlung is whole; no source
        // goes in, so the compiler draws the same cross. See putImage().
        return reference;
      }
      const bytes = pkg.files.get(entry.path);
      if (!bytes) {
        // Not the same thing as the branch above, and telling them apart is
        // the point. An entry that declares a path and has no member behind it
        // is either a truncated archive or a talker document from obf.ts,
        // which carries references and no pixels on purpose. Compiling one
        // would draw the grey cross on every single key - a talker that parses
        // and is wrong, which docs/device-interface.md §6 is a section about.
        throw new Error(
          `${entry.path} is named by this package and is not in it. A device ` +
          "export carries the source picture as a member; a talker document " +
          "carries the reference alone and cannot be compiled.");
      }
      sources.set(reference, {
        key: stemOf(entry.path),
        bytes,
        contentType: String(entry.content_type ?? "application/octet-stream"),
      });
      return reference;
    };

    const slots: DeviceSlot[] = [];
    for (const button of board.buttons ?? []) {
      if (button.load_board) continue;               // the set key, taken below
      const text = String(button.vocalization ?? button.label ?? "");
      const symbol = referenceOf(button);
      if (button.sound_id) {
        const entry = soundEntries.get(button.sound_id);
        if (!entry) {
          throw new Error(
            `${button.id} names a recording the board does not list: ${button.sound_id}`);
        }
        const bytes = pkg.files.get(entry.path);
        if (!bytes) {
          throw new Error(`${entry.path} is named by this package and is not in it.`);
        }
        const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
        if (!AUDIO_NAME.test(name)) {
          throw new Error(
            `${name} is not a name layout.bin can carry, so this package ` +
            "cannot be compiled without renaming what the device would hold.");
        }
        if (!isDeviceWav(wavFormat(bytes))) {
          throw new Error(
            `${name} is not the WAV the device plays - ${DEVICE_SAMPLE_RATE} Hz, ` +
            `${DEVICE_CHANNELS} channel, ${DEVICE_BITS_PER_SAMPLE}-bit. An app ` +
            "package's Ogg Opus is the usual thing to find here, and adr/0008 " +
            "is why it must not be converted into one.");
        }
        sounds.set(text, { name, bytes });
      }
      slots.push({
        text,
        symbol,
        negated: button.ext_vorlaut_negated === true,
        // Asked of the shape the slot came back as, rather than carried in the
        // file. The predicate is the authority and a stored answer could
        // disagree with it - which is the divergence this whole file is the
        // meeting point of.
        empty: slotIsEmpty({ text, symbol }),
      });
    }

    const setKey = board.buttons?.find((one) => one.load_board);
    sets.push({
      name: String(board.name ?? ""),
      symbol: referenceOf(setKey),
      slots,
    });
  }

  return {
    plan: {
      language: String(root.locale ?? ""),
      voice: String(root.ext_vorlaut_voice ?? ""),
      sleepTimeoutSeconds: root.ext_vorlaut_sleep_timeout_seconds as number,
      sets,
    },
    sources,
    sounds,
  };
}

/* ------------------------------------------------------------ compiling --- */

/**
 * The two things a compiler needs from its host, and nothing else.
 *
 * Decoding a picture and hashing bytes are the browser's, and everything else
 * about turning this package into a device build is arithmetic. That is the
 * split docs/obz-as-device-input.md §7 predicted - a node-safe core and a
 * browser-only renderer over it - drawn as an argument rather than as a
 * repository boundary, because recommendation 4 of that document is that
 * nothing is packaged or split yet and this changes none of that.
 *
 * It is also what makes the round trip testable: under node the decode is a
 * fixture and the arithmetic is the real thing.
 */
export interface DeviceHost {
  /** One images/ member as pixels - `data`, `width`, `height` - or null when
   *  it will not decode, which is not an error but the grey cross.
   *
   *  Pixels rather than something drawImage takes, and that is where the line
   *  falls: decoding is the browser's and everything after it is arithmetic.
   *  tiles.renderPixels() is the half on this side of it. */
  decode(
    bytes: Uint8Array<ArrayBuffer>, contentType: string,
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null>;
  /** sha256 cut to HASH_BYTES, as hex. The name rule, and the reason it is
   *  passed in rather than written here is that runBuild() already has one and
   *  two of them would be two opinions about a file name. */
  hash(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
}

/**
 * A device export, compiled into exactly the files a build puts in the store.
 *
 * layout.bin, one t<hash>.bin per distinct picture, one a<hash>.wav per
 * distinct sentence - the map builtFiles() answers with and the cable sends.
 *
 * This is the claim the whole file exists for, so it is worth saying what it
 * does *not* need: no store, no Sammlung, no synthesiser, no Azure key, no
 * voice catalogue, no METACOM folder and no network. Items 10 and 12 of
 * docs/obz-as-device-input.md §1 stayed in the editor, and everything about
 * people - the progress list, the missing-symbol hints, the log's language,
 * the folder picker, Web Serial - stayed with them.
 */
export async function compileDevice(
  read: ReadDevicePackage, host: DeviceHost,
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const { plan } = read;

  // One render per distinct picture rather than per use, keyed the way
  // runBuild() keys its own: the reference and whether it is crossed out,
  // because a crossed-out key is different pixels and therefore a different
  // name. Keyed by the reference alone, a set holding "Brot" and "kein Brot"
  // gets whichever of the two was drawn first on both.
  const drawn = new Map<string, string>();
  const tileFor = async (reference: string, negated: boolean): Promise<string> => {
    const key = (negated ? "!" : "") + reference;
    const already = drawn.get(key);
    if (already) return already;
    const source = read.sources.get(reference);
    const decoded = source ? await host.decode(source.bytes, source.contentType) : null;
    const bytes = tiles.renderPixels(decoded, { negated });
    const name = `t${await host.hash(bytes)}.bin`;
    drawn.set(key, name);
    files.set(name, bytes);
    return name;
  };

  // The blank, rendered once for the whole compile and kept out of `drawn` for
  // the reason runBuild()'s storeBlank() gives: that map is keyed by a
  // reference and whether it is crossed out, and an empty key is neither.
  let blankName = "";
  const blank = async (): Promise<string> => {
    if (!blankName) {
      const bytes = tiles.toRgb565Be(tiles.blank());
      blankName = `t${await host.hash(bytes)}.bin`;
      files.set(blankName, bytes);
    }
    return blankName;
  };

  const labelFiles: string[] = [];
  const tileFiles: string[][] = [];
  const audioFiles: string[][] = [];

  for (const set of plan.sets) {
    labelFiles.push(await tileFor(set.symbol, false));
    const tileNames: string[] = [];
    const audioNames: string[] = [];
    for (const slot of set.slots) {
      tileNames.push(slot.empty ? await blank() : await tileFor(slot.symbol, slot.negated));
      const sound = slot.text ? read.sounds.get(slot.text) : undefined;
      if (sound) {
        files.set(sound.name, sound.bytes);
        audioNames.push(sound.name);
      } else {
        // No recording is a silent key rather than a failure - a Sammlung with
        // no voice set is a normal one, and layout.bin's per-slot flag is what
        // says so. The zeros hashBytes() writes for an empty name are the
        // firmware's own "nothing to play".
        audioNames.push("");
      }
    }
    tileFiles.push(tileNames);
    audioFiles.push(audioNames);
  }

  files.set(LAYOUT_BIN,
    renderLayoutBin(planLayout(plan), labelFiles, tileFiles, audioFiles));
  return files;
}
