// Which firmware this deploy carries, and how it compares with the one that
// answered.
//
// adr/0017 is the decision. The short of what belongs here: the page offers to
// write an image, and everything about that image except the writing itself is
// this module - where it comes from, whether it arrived whole, and what it
// means beside the word a device said about itself.
//
// The writing is flash.ts, and the split is the same one cable.ts describes
// for the transfer: the part with a chip on the end of it is separated from
// the part that is arithmetic, because only one of those can be checked
// without hardware.
import { Trouble } from "./errors.js";

/** One thing to write, and where. */
export type Piece = {
  file: string;
  /** Where in the flash it goes. 0 for the whole image, 0x10000 for the
   *  program on its own. */
  address: number;
  bytes: number;
  /** Lower-case hex, as tools/firmware_for_pages.mjs wrote it. */
  sha256: string;
};

/** What `dist/firmware/firmware.json` says, when there is a release in it.
 *
 * The board settings ride along rather than living in this page, so that they
 * sit beside the image they describe - the same argument
 * `.github/actions/firmware` makes for keeping the FQBN in one place. A page
 * that carried its own copy would be the second place a partition scheme is
 * written down, and the failure when they disagree is a device with black
 * displays.
 */
export type Carried = {
  release: string;
  url: string;
  chip: string;
  flashSize: string;
  flashMode: string;
  flashFreq: string;
  /** Everything, at 0. Takes the file system with it. */
  whole: Piece;
  /** The program alone, at 0x10000. Leaves the content where it is. */
  program: Piece;
};

/** Where the deploy put it. Explicitly through BASE_URL rather than as a bare
 *  relative path: a project site is served from /<repo>/, and a fetch written
 *  as "firmware/firmware.json" is a 404 there and nowhere else - which is the
 *  kind of bug that only ever appears after it is deployed. */
const AT = (name: string) => `${import.meta.env.BASE_URL}firmware/${name}`;

/** What this deploy carries, or null for one that carries nothing.
 *
 * Null is a real answer and the common one so far: no `v*` release has been
 * cut, so `tools/firmware_for_pages.mjs` writes a manifest that says as much.
 * A missing file answers null too - a deploy from before this existed - and
 * so does a manifest this page cannot make sense of. In every one of those
 * cases the honest thing is a page with no firmware section rather than a
 * section that cannot do anything, so they are one answer rather than three.
 */
export async function carriedFirmware(): Promise<Carried | null> {
  let said: unknown;
  try {
    const answer = await fetch(AT("firmware.json"), { cache: "no-cache" });
    if (!answer.ok) return null;
    said = await answer.json();
  } catch {
    return null;
  }
  const one = said as Partial<Carried> | null;
  if (!one || typeof one.release !== "string" || !one.whole || !one.program) {
    return null;
  }
  return one as Carried;
}

/** The bytes of one piece, and proof they are the ones the deploy meant.
 *
 * The sum is checked rather than trusted, and it is checked here rather than
 * left to the flash. A same-origin fetch of a file this deploy wrote is not a
 * place a wrong answer is likely to come from - and the cost of the unlikely
 * one is somebody's talker with half an image on it, which is the sort of
 * asymmetry docs/cable.md's checksum note is about. A cut-off response is the
 * realistic version: a browser that lost the connection halfway hands back
 * what it got.
 */
export async function firmwareBytes(
  piece: Piece,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!globalThis.crypto?.subtle) {
    // Rather than writing an unverified image. Every place this page is meant
    // to run is a secure context - https, or localhost - so this is a page
    // being served somewhere it was not meant to be, and that is worth
    // saying rather than working around.
    throw new Trouble("firmware_no_digest");
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const answer = await fetch(AT(piece.file), { cache: "no-cache" });
    if (!answer.ok) throw new Error(String(answer.status));
    bytes = new Uint8Array(await answer.arrayBuffer());
  } catch {
    throw new Trouble("firmware_not_fetched");
  }
  if (bytes.length !== piece.bytes) throw new Trouble("firmware_wrong_size");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== piece.sha256) throw new Trouble("firmware_wrong_sum");
  return bytes;
}

export type FirmwareVerdict = "same" | "device_older" | "device_newer"
  | "unorderable";

/** A tag as numbers, or null for anything that is not one.
 *
 * `v0.4` and `v1.0.0` are both tags this repository could cut - docs/releases.md
 * shows two components in one example and three in another - so the ladder is
 * however many there are, and a missing rung is a zero. Anything else comes
 * back null, and the two that matter are `dev`, which is what every build
 * release.yml did not compile calls itself, and the empty string, which is
 * what a device flashed before the greeting named a build says.
 */
function ladder(tag: string): number[] | null {
  const found = /^v(\d+(?:\.\d+)*)$/.exec(tag);
  return found ? found[1]!.split(".").map(Number) : null;
}

/**
 * What the word a device said means beside the one this deploy carries.
 *
 * The two ends of `versionVerdict()` in tools/cable.js, one keyword along, and
 * with one deliberate difference: **this one refuses to guess.** A protocol
 * version is a number and always comparable; a build name is whatever the
 * build was called, and two of them are only ordered when both are tags. `dev`
 * against `v0.4` is not "older" - it is a build somebody made themselves,
 * possibly from a tree with more in it than any release, and telling them it
 * is out of date would be a page inventing an ordering the device never
 * promised. In the one place where the wrong answer overwrites firmware.
 *
 * So: `unorderable` whenever either side is not a tag, and the page says both
 * words and offers the write without a verdict attached.
 */
export function firmwareVerdict(theirs: string, ours: string): FirmwareVerdict {
  const mine = ladder(ours);
  const yours = ladder(theirs);
  if (!mine || !yours) return "unorderable";
  for (let at = 0; at < Math.max(mine.length, yours.length); at++) {
    const a = yours[at] ?? 0;
    const b = mine[at] ?? 0;
    if (a !== b) return a < b ? "device_older" : "device_newer";
  }
  return "same";
}
