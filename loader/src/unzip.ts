// A .obz off somebody's disk, as its members.
//
// The second reader of a central directory in this repository, and that is
// worth stating rather than hiding, because the first thing anybody will want
// to do is delete one of them.
//
// src/data/obf.ts has the other. It belongs to the editor's import door: it
// answers in the editor's error words ("This file is not a readable .obz"),
// it is tolerant in the ways an importer should be - a manifest that names
// nothing is ignored and every .obf in the archive is taken instead - and it
// goes with the editor when this repository is split. This one is the
// loader's, it refuses rather than guesses, and it stays here. Neither is a
// candidate to become the other: an importer that guessed less would refuse
// files people actually have, and a loader that guessed more would compile a
// talker document into a device full of grey crosses, which is exactly the
// outcome docs/device-interface.md §6 says is worse than nothing.
//
// What the two do share is the one rule that matters, and it is not ours:
// exchange/SPEC.md §2 requires an importer to read the central directory and
// forbids recovering members by scanning for local headers. The directory is
// also where the sizes are certain, since a local header may leave them for a
// data descriptor written after the data.

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** What went wrong with a file, in a sentence somebody can act on.
 *
 * A class rather than a plain Error so main.ts can tell "this is not the file
 * you meant" apart from a bug in this page, and say so differently. */
export class NotAPackage extends Error {
  constructor(why: string) {
    super(why);
    this.name = "NotAPackage";
  }
}

/**
 * Raw deflate through the platform's own decompressor.
 *
 * The write is deliberately not awaited before the reading starts - a stream
 * holds a chunk until somebody takes it, so awaiting both in order is how a
 * large member sits there for ever. The same shape obf.ts uses, for the same
 * reason, and it is about six lines of stream plumbing rather than anything
 * either file has an opinion about.
 */
async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const written = writer.write(bytes).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
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

/**
 * Every member of the archive, by name, already decompressed.
 *
 * Throws NotAPackage for anything that is not a zip this can read. The
 * messages name what was looked for rather than an offset: whoever is reading
 * them has a file manager open, not a hex editor.
 */
export async function unzip(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    // "PK", where every zip starts and no JSON document does. Said first
    // because it is the case somebody actually hits: an .obf, a .json backup,
    // or a picture dropped on the wrong page.
    throw new NotAPackage("not a zip at all");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === END) { end = at; break; }
  }
  if (end < 0) throw new NotAPackage("no end-of-central-directory record");

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const members = new Map<string, Uint8Array<ArrayBuffer>>();

  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) {
      throw new NotAPackage(`the central directory stops making sense at byte ${at}`);
    }
    const method = view.getUint16(at + 10, true);
    const packedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const start = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

    if (start + 30 > bytes.length || view.getUint32(start, true) !== LOCAL) {
      throw new NotAPackage(`${name} is not where the directory says it is`);
    }
    const from = start + 30
      + view.getUint16(start + 26, true)
      + view.getUint16(start + 28, true);
    const packed = bytes.subarray(from, from + packedSize) as Uint8Array<ArrayBuffer>;
    if (method === DEFLATED) {
      members.set(name, (await inflate(packed)) as Uint8Array<ArrayBuffer>);
    } else if (method === STORED) {
      members.set(name, new Uint8Array(packed) as Uint8Array<ArrayBuffer>);
    } else {
      throw new NotAPackage(`${name} is compressed with a method this cannot read (${method})`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return members;
}
