// The device package, as the page that reads one sees it.
//
// The reader's half of what was src/data/device_package.ts, moved here by the
// split adr/0012 decided. That module wrote the file and read it back, in the
// repository that held both halves; docs/split-crossings.md costed the cut
// before the day - "hard case one - the device package is the boundary, and it
// divides by role" - and this is that cut, made where it said it fell.
//
// What came, and what did not:
//
//   the reader   readDevicePackage(), planLayout(), wavFormat(), wavSeconds(),
//                isDeviceWav() and the ReadDevicePackage shape they answer
//                with. This file.
//   the writer   devicePlan(), buildDevicePackage(), devicePackageBytes(),
//                jsonBytes(), digest(), sniffImageType(), boardPath(). Gone
//                with the editor, and deliberately not copied: a vendored
//                writer here would be a second opinion about the format inside
//                the repository that reads it, which is the one edit
//                split-crossings.md names as the edit that must not happen.
//   the shapes   duplicated, because the format's own vocabulary is needed by
//                both halves and every field of it. vorlaut-editor holds the
//                other copy.
//
// Nothing holds the two copies of the shapes together any more, and that is
// what device/fixtures/package/ is for: adr/0014 gave the package a fixture
// kind, and tests/unit/device_package_reader.test.ts and device_compile.test.ts
// hold this side to those files without ever meeting a writer. That is the
// arrangement adr/0009 asks for and the reason this cut is affordable.
//
// The four form rules the writer was built on are still what a package means,
// and they are worth having in front of a reader of this file:
//
//   1. THE PICTURES ARE THE SOURCES - unresampled, at their own size, in
//      whatever format they were stored in. Compiling a tile out of a
//      re-encoded PNG resamples twice and every tile hash moves.
//   2. NEGATION IS A FLAG - ext_vorlaut_negated travels, and
//      renderSymbol(source, { negated }) draws the device's hard-edged cross.
//      A baked cross would be the tablet's antialiased one, on the device.
//   3. THE SOUND IS THE DEVICE'S WAV - a<hash>.wav, the bytes the cable would
//      have sent. adr/0008 forbids deriving it from the package's Opus.
//   4. THE LANGUAGE IS THE FIELD ITSELF - `locale` is layout.language, the
//      index into LANGUAGE_CODES that becomes header byte 7, and not a locale
//      derived from a voice.
//
// It refuses rather than guesses, throughout. docs/device-interface.md section
// 6 is why: a key that says the wrong sentence is worse than one that says
// nothing, because it is said to somebody who believes it.

import {
  DEVICE_BITS_PER_SAMPLE, DEVICE_CHANNELS, DEVICE_SAMPLE_RATE,
} from "./audio_format.js";
import { HASH_BYTES } from "./layout_format.js";

/** The symbol set a bare file name belongs to, and the one a "metacom:"
 *  reference does. The same two words obf.ts writes in vorlaut-editor, because
 *  the field is read back by its importObz() and a third spelling would not
 *  round trip. */
const OWN_SET = "vorlaut";
const METACOM_SET = "metacom";

/** `a` + 32 hex + `.wav`: what layout.bin can carry and hashBytes() can read.
 *  A name of any other shape is refused rather than compiled, because
 *  hashBytes() throws on it at the far end of a build nobody is watching. */
const AUDIO_NAME = new RegExp(`^a[0-9a-f]{${HASH_BYTES * 2}}\\.wav$`);

/** Whether a key says nothing and shows nothing.
 *
 * Two lines, copied from the editor's app_package.ts rather than imported
 * across a repository boundary. The rule it states is the one thing three
 * different walks over a layout disagreed about before
 * docs/obz-as-device-input.md section 5 found them: an untouched key was an
 * empty cell on a tablet and a missing-picture cross on the device. */
const slotIsEmpty = (slot: { text?: string; symbol?: string }): boolean =>
  !String(slot?.text ?? "").trim() && !String(slot?.symbol ?? "");

const stemOf = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

const joinReference = (set: string, filename: string): string =>
  !filename ? "" : set === METACOM_SET ? `${METACOM_SET}:${filename}` : filename;


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

/** The layout renderLayoutBin() reads.
 *
 * Stated here rather than imported. It was DiyLayout from the editor's
 * core/types.ts, which is the editor's document type and carried far more than
 * this; layout_format.ts takes its argument untyped, so what the boundary
 * actually needs is these four fields and nothing else. */
export interface LayoutForDevice {
  language: string;
  voice: string;
  sleep_timeout_seconds: number;
  sets: {
    name: string;
    symbol: string;
    slots: { text: string; symbol: string; negated: boolean }[];
  }[];
}

/** The plan back as the Layout renderLayoutBin() reads.
 *
 * That function wants a layout rather than a plan, and it is device-format
 * code that this file has no business reshaping. So the plan is handed back in
 * the shape it asks for, which is also the proof that nothing was lost on the
 * way through: every field it reads is one the plan carries. */
export const planLayout = (plan: DevicePlan): LayoutForDevice => ({
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
        const heard = wavFormat(bytes);
        if (!isDeviceWav(heard)) {
          // Both halves, and the second one is the half that is useful. Saying
          // only what the device wants leaves whoever is reading it to open
          // the file in something that can tell them what it is; saying what
          // arrived is usually the whole diagnosis, because the answer is
          // nearly always one number.
          throw new Error(
            `${name} is not the WAV the device plays. It wants ` +
            `${DEVICE_SAMPLE_RATE} Hz, ${DEVICE_CHANNELS} channel, ` +
            `${DEVICE_BITS_PER_SAMPLE}-bit, and this is ` +
            (heard
              ? `${heard.sampleRate} Hz, ${heard.channels} channel, `
                + `${heard.bitsPerSample}-bit`
              : "not a RIFF/WAVE file at all - an app package's Ogg Opus is "
                + "the usual thing to find here") +
            ". adr/0008 is why it must not be converted into one.");
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
