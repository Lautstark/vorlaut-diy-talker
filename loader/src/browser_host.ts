// The two things compileDevice() cannot do for itself, done in a browser.
//
// DeviceHost is decode and hash, and its own note says why those two and
// nothing else: everything between them is arithmetic, and the arithmetic runs
// under node in tests/unit/device_compile.test.ts against a fixture decoder -
// a BMP out of device/fixtures/package/, which is the one picture format a
// directory that has to regenerate byte for byte can hold. This is the other
// implementation of the same two functions, the one that runs on the page - so
// what that test proves about the arithmetic carries straight over, and what
// it does not cover is exactly these forty lines.
//
// Which is also why they are forty lines and not four hundred. Anything that
// grows here is something no test under node can see.
import type { DeviceHost } from "./compile.js";
import type { ReadDevicePackage } from "../../src/data/device_package.js";
import { HASH_BYTES } from "./layout_format.js";
import { sourcePixels } from "./tiles.js";

/** Which references would not decode, filled in as the compile runs.
 *
 * The compiler treats an undecodable source the same way it treats a missing
 * one - tiles.renderPixels(null) draws the grey cross, which is the right
 * picture for a key whose picture is not there. That is correct and it is
 * silent, and a talker with a grey cross on it looks broken to whoever is
 * holding it. So the host keeps a list, and main.ts turns it into findings
 * beside the ones validate.ts made before the decode.
 *
 * A field on the host rather than a callback, because the compile is over
 * before anything is drawn and the whole list reads better than a line at a
 * time. */
export interface BrowserHost extends DeviceHost {
  readonly undecodable: string[];
}

/**
 * An images/ member as pixels, through an <img> and a canvas.
 *
 * The blob carries the content type the package declared, which is what makes
 * an SVG work: createImageBitmap refuses one in more than one browser, and an
 * <img> renders it. The URL is revoked whatever happens - a page that loads
 * fifty pictures and keeps fifty blob URLs alive is holding the whole archive
 * in memory twice.
 *
 * null rather than a throw for anything that will not load. That is
 * DeviceHost's own contract - "not an error but the grey cross" - and it is
 * the right one: one unreadable picture must not cost a talker its other
 * nineteen keys.
 */
async function decodeImage(
  bytes: Uint8Array<ArrayBuffer>, contentType: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  try {
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => resolve(null);
      element.src = url;
    });
    if (!image) return null;
    // An SVG with no intrinsic size decodes to 0x0, and a canvas of that size
    // is a picture of nothing. Refusing it here is what turns it into a grey
    // cross and a line on the page rather than a tile of zeroes.
    if (!image.naturalWidth || !image.naturalHeight) return null;
    return sourcePixels(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** sha256 cut to HASH_BYTES, as hex - the rule layout.bin's names carry.
 *
 * The same rule the editor's export applies when it names a WAV, and the same
 * one runBuild() applied when there was one. It is passed in rather than
 * written inside compileDevice() precisely so that there is one of it per
 * runtime rather than one per module. */
async function hashHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, HASH_BYTES * 2);
}

/**
 * A host for one compile. Not shared between two: `undecodable` is about the
 * file that is on the page now.
 *
 * The sources are passed in only so that a failure can be reported by the
 * name somebody would recognise. decode() is handed bytes and a content type,
 * which is all the arithmetic needs and is nothing a person can be told about
 * - "image/png did not load" names no key on any device. The bytes are the
 * same object readDevicePackage() filed under the reference, so identity is
 * what turns one back into the other; a content comparison would be the same
 * answer at the price of hashing every picture a second time.
 */
export function browserHost(sources: ReadDevicePackage["sources"]): BrowserHost {
  const named = new Map<Uint8Array, string>();
  for (const [reference, source] of sources) named.set(source.bytes, reference);

  const undecodable: string[] = [];
  return {
    undecodable,
    async decode(bytes, contentType) {
      const pixels = await decodeImage(bytes, contentType);
      if (!pixels) undecodable.push(named.get(bytes) ?? contentType);
      return pixels;
    },
    hash: hashHex,
  };
}
