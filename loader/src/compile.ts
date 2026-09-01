// A device export, compiled into exactly the files a talker reads.
//
// Split out of data/device_package.ts, which is where the four form rules and
// the reader are written down at length, and the line it was split along is
// the one that file had already drawn: everything above it is a mapping over
// data, and this is the half that renders pixels and writes layout.bin. Those
// two are the device's own code - loader/src/tiles.ts and
// loader/src/layout_format.ts - so this is the half that belongs on this side
// of the boundary, and the editor is now a page that imports neither.
//
// adr/0011 is the decision that drew the boundary. adr/0010 is the one that
// wrote this function, and its own note said that DeviceHost was "drawn as an
// argument rather than as a repository boundary" because nothing was being
// split yet. The argument is now also the boundary, and the interface did not
// have to change for it: decoding a picture is the browser's, hashing is the
// browser's, and everything between them is arithmetic that runs under node.
//
// What did NOT move is readDevicePackage(), and that is deliberate rather than
// an oversight. It reads a shape and refuses one, it touches no pixels and no
// bytes of layout.bin, and it sits beside the writer whose output it reads -
// which is the arrangement exchange/README.md argues for, fixtures with the
// writer and the reader holding itself to them. When this repository is split
// it is the whole of data/device_package.ts that has to answer for itself, in
// the way adr/0009 says a format with two implementations has to; pre-cutting
// it here would only mean the cut happened twice.

import { planLayout, type ReadDevicePackage }
  from "./device_package.js";
import { collectionFile, renderLayoutBin } from "./layout_format.js";
import * as tiles from "./tiles.js";

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
 * Which file every panel of one set will be showing.
 *
 * The device draws five screens at a time - the set key and its four speech
 * keys - and this says which tile lands on each of them, by the name it has in
 * `files`. One entry per set, in the file's own order, so the nth entry is the
 * nth member of `plan.sets` and needs no key of its own.
 *
 * It is the table renderLayoutBin() is handed, before it becomes bytes: this
 * function already works it out and used to throw it away. Saying it costs
 * nothing and is what lets loader/src/preview.ts draw the compiled tiles
 * without rendering a single pixel of its own - adr/0013.
 */
export interface Screens {
  /** The set key's tile. */
  label: string;
  /** The four speech keys' tiles, in the order the set holds them. */
  slots: string[];
}

/** What a compile answers with: the files, and where the tiles land. */
export interface DeviceBuild {
  files: Map<string, Uint8Array<ArrayBuffer>>;
  screens: Screens[];
  /** The file the collection itself goes under, which is one of `files`.
   *
   * Said rather than worked out again by whoever needs it. Three things do -
   * the transfer compares it by checksum, the folder export writes it, and the
   * page names it in a sentence - and each of them recomputing the hash would
   * be three chances to name a different file from the one that was built. */
  collection: string;
}

/**
 * A device export, compiled into exactly the files a build puts in the store.
 *
 * One c<hash>.bin for the collection itself, one t<hash>.bin per distinct
 * picture, one a<hash>.wav per distinct sentence - the map builtFiles()
 * answers with and the cable sends.
 *
 * The collection file was `layout.bin` until 2026-08-31, and it is named now
 * because a device holds several: the list of collections on a talker is what
 * lies in its directory, so a collection has to have a name of its own for
 * there to be a list at all. adr/0021.
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
): Promise<DeviceBuild> {
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

  /** The recording behind a key's word, filed and named, or "" for none.
   *
   *  No recording is a silent key rather than a failure - a Sammlung with no
   *  voice set is a normal one, and layout.bin's per-key flag is what says so.
   *  The zeros hashBytes() writes for an empty name are the firmware's own
   *  "nothing to play". */
  const soundFor = (text: string): string => {
    const sound = text ? read.sounds.get(text) : undefined;
    if (!sound) return "";
    files.set(sound.name, sound.bytes);
    return sound.name;
  };

  const labelFiles: string[] = [];
  const labelSounds: string[] = [];
  const tileFiles: string[][] = [];
  const audioFiles: string[][] = [];

  for (const set of plan.sets) {
    // The set key's tile is drawn whether or not the key holds anything, where
    // a speech key that holds nothing gets the blank. That is not an oversight
    // on either side: the fifth panel is the set, it is lit on every screen the
    // device shows, and a set nobody gave a picture is the grey cross saying
    // exactly that. A blank there would look like a set that was not there.
    labelFiles.push(await tileFor(set.key.symbol, set.key.negated));
    labelSounds.push(soundFor(set.key.text));
    const tileNames: string[] = [];
    const audioNames: string[] = [];
    for (const slot of set.slots) {
      tileNames.push(slot.empty ? await blank() : await tileFor(slot.symbol, slot.negated));
      audioNames.push(soundFor(slot.text));
    }
    tileFiles.push(tileNames);
    audioFiles.push(audioNames);
  }

  // The collection, under the name that identifies it rather than under
  // layout.bin. `read.id` is the root board's id and nothing about the bytes,
  // so a collection sent twice lands on one file both times and a device
  // replaces it instead of holding two of it. See collectionFile().
  //
  // Hashed with the same hasher every other name here goes through, for the
  // reason DeviceHost.hash exists at all: two hashers would be two opinions
  // about a file name.
  const collection = collectionFile(
    await host.hash(new TextEncoder().encode(read.id) as Uint8Array<ArrayBuffer>));
  files.set(collection,
    renderLayoutBin(planLayout(plan), labelFiles, tileFiles, audioFiles,
                    labelSounds));
  return {
    files,
    screens: labelFiles.map((label, at) => ({ label, slots: tileFiles[at]! })),
    collection,
  };
}
