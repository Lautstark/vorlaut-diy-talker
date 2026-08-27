/* A talker's package, written here, for the page that reads one.
 *
 * loader.spec.ts needs a file to feed the page, and there are two ways to get
 * one. It could press the editor's export and carry the download across, which
 * is a real hand-off and is exactly what device_export.spec.ts already checks;
 * doing it again here would make every assertion about the loader wait on a
 * synthesis chain and fail for the editor's reasons. Or it could commit a
 * fixture, which is a binary in the repository that nothing regenerates and
 * that quietly stops describing the format.
 *
 * So the package is built here, through the same writer the editor uses -
 * src/data/device_package.ts - and everything about its *shape* is therefore
 * the product's rather than this file's. What this file decides is only what
 * is in it: which pictures, which sentences, and which of the shapes a key can
 * be in, chosen so that every check the loader makes has something to be right
 * or wrong about.
 *
 * The two ends stay honest about each other because they meet in the middle:
 * this writer is the editor's, and device_export.spec.ts holds the editor's
 * export to producing the same shape from a browser.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDevicePackage, devicePackageBytes, digest, sniffImageType,
  type DevicePackage, type DeviceSound, type DeviceSource,
} from "../src/data/device_package.js";
import type { DiyLayout } from "../src/core/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A picture that really is a PNG, so the page's decoder really decodes.
 *
 * e2e/fixtures/, which the crop and picker specs already draw on. A canvas
 * would have done and would have been this file inventing a format; a file on
 * disk is what a person's Sammlung actually holds. */
const png = (name: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(readFileSync(join(HERE, "fixtures", name))) as Uint8Array<ArrayBuffer>;

/** `seconds` of silence at the device's own shape - 16 kHz, mono, 16-bit.
 *
 * Silence rather than a tone, because nothing downstream of here listens: the
 * loader reads the header to say how long a clip runs and the cable counts
 * bytes. What matters is that the header is real, and it is - written out
 * field by field rather than copied from a file, so a rate this test needs to
 * be wrong can be made wrong. */
export function wav(seconds: number, rate = 16000): Uint8Array<ArrayBuffer> {
  const frames = Math.round(seconds * rate);
  const dataBytes = frames * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                       // PCM
  view.setUint16(22, 1, true);                       // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes as Uint8Array<ArrayBuffer>;
}

/** sha256 cut to sixteen bytes, which is the shape layout.bin carries a name
 *  in. Written out rather than imported: the rule lives beside the synthesis
 *  in backend/local.ts, and a package that arrives from anywhere else has to
 *  carry a name of this shape or the loader refuses it - which is exactly the
 *  thing being exercised. */
async function audioName(text: string): Promise<string> {
  const digestBytes = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digestBytes)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return `a${hex.slice(0, 32)}.wav`;
}

export const VOICE = "piper:de_DE-thorsten-medium";

/** Two sets, and every key is a shape the loader has something to say about.
 *
 * A Sammlung where every key were filled and every picture resolved would let
 * the whole spec pass while proving one case. So, in order:
 *
 *   set 1  a picture and a word; the same picture crossed out, with a word;
 *          a word and no picture; a picture and no word.
 *   set 2  a picture and a word; nothing at all; a reference nothing in the
 *          file resolves; a word whose recording is not in the file.
 *
 * Which makes the counts predictable: two distinct sources, four distinct
 * tiles for the keys plus the two set keys plus one blank, and four
 * recordings.
 */
export const LAYOUT: DiyLayout = {
  language: "de",
  voice: VOICE,
  sleep_timeout_seconds: 600,
  sets: [
    {
      name: "Erste",
      symbol: "symbol.png",
      slots: [
        { text: "Hallo", symbol: "symbol.png" },
        { text: "Nicht hallo", symbol: "symbol.png", negated: true },
        { text: "Danke", symbol: "" },
        { text: "", symbol: "wide.png" },
      ],
    },
    {
      name: "Zweite",
      symbol: "",
      slots: [
        { text: "Bitte", symbol: "wide.png" },
        { text: "", symbol: "" },
        // Nothing in the file resolves this, and nothing is meant to: the
        // export writes a reference with no member for a picture that had
        // already gone missing, and the compiler draws its grey cross.
        { text: "Weg", symbol: "fehlt.png" },
        // A word the file has no recording for, which is a silent key.
        { text: "Niemals", symbol: "symbol.png" },
      ],
    },
  ],
} as unknown as DiyLayout;

/** Every sentence in LAYOUT that has a recording. "Niemals" is deliberately
 *  not here. */
export const SPOKEN = ["Hallo", "Nicht hallo", "Danke", "Bitte"];

/** How long the one long clip runs. Past LONG_CLIP_SECONDS, so that the note
 *  about a key that answers nothing while it talks has a case. */
export const LONG = 12;

/**
 * The package, as the bytes of a file.
 *
 * Two hooks, and the difference between them is the difference between a file
 * this editor could write and one it could not.
 *
 * `change` is handed the input on its way to the writer, so that a spec can
 * make one thing wrong - a sixth set, a sleep timeout out of range - without a
 * second copy of everything that is right. What it cannot do is anything
 * buildDevicePackage() refuses, because that function refuses it here too.
 *
 * `tamper` is handed the assembled package, past every refusal the writer
 * makes, and that is exactly the point: the loader's checks exist because a
 * file can arrive from somewhere that is not this writer, and a fault the
 * writer will not produce is the one the reader most needs to catch. A 24 kHz
 * recording is the case - the device does not refuse one, it plays it at 16
 * and the word comes out at the wrong pitch.
 */
export async function packageBytes(
  change: (input: {
    layout: DiyLayout; voice: string;
    sources: Map<string, DeviceSource>; sounds: Map<string, DeviceSound>;
  }) => void = () => {},
  tamper: (pkg: DevicePackage) => void = () => {},
): Promise<Buffer> {
  const sources = new Map<string, DeviceSource>();
  for (const name of ["symbol.png", "wide.png"]) {
    const bytes = png(name);
    sources.set(name, {
      key: await digest(bytes), bytes, contentType: sniffImageType(bytes),
    });
  }

  const sounds = new Map<string, DeviceSound>();
  for (const text of SPOKEN) {
    sounds.set(text, {
      name: await audioName(text),
      // "Bitte" is the long one, so that exactly one key draws the note.
      bytes: wav(text === "Bitte" ? LONG : 0.6),
    });
  }

  const input = {
    layout: structuredClone(LAYOUT), voice: VOICE, sources, sounds,
  };
  change(input);
  const pkg = buildDevicePackage(input);
  tamper(pkg);
  return Buffer.from(await devicePackageBytes(pkg));
}
