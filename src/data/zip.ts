// A zip writer for app packages.
//
// obf.ts has one of these too, and this is deliberately not it. The talker's
// .obz is frozen byte for byte by tests/reference/obf.lock.json, so its writer
// cannot grow a flag without moving bytes that a test holds still; and the two
// want different things anyway:
//
//   * **Flag bit 11.** exchange/SPEC.md §2 asks a builder to say that member
//     names are UTF-8. The talker's writer leaves the flags at zero, which is
//     what the lock records. An app package sets it, so that an importer
//     reading the general purpose flags is told rather than left guessing
//     between UTF-8 and CP437.
//   * **NFC.** §2 requires member names in NFC, and names a case worth reading
//     twice: on macOS a name taken from a file on disk arrives decomposed, so
//     the archive says `café.png` while the board document says
//     `café.png`. Same word, different bytes, and the picture goes
//     missing. Every name is normalised here, once, at the door.
//   * **Stored members.** PNG and Opus are already compressed; deflating them
//     again costs time and adds bytes. JSON is deflated. The talker's writer
//     deflates everything, which for a document with no files in it is the
//     same decision.
//
// What both writers share is the framing itself, and that is the honest cost
// of leaving obf.ts alone: about sixty lines of local headers, central
// directory and CRC-32 exist twice in this directory. Extracting them is a
// mechanical change that test_obf_frozen.py would keep honest - see the last
// section of docs/exchange.md.
//
// No Zip64 and no encryption, because §2 forbids both. A package that needed
// Zip64 would be over four gigabytes, and §2.1 says a builder should have
// spoken up somewhere around fifty megabytes.

/** One member: a name inside the archive and the bytes it holds. */
export interface ZipMember {
  name: string;
  data: Uint8Array<ArrayBuffer>;
  /** Compressed members. Default true. PNG and Opus pass false. */
  deflate?: boolean;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const NEEDED = 20;
const DEFLATED = 8;
const STORED = 0;
/** Bit 11: the names in this archive are UTF-8, and are meant to be read so. */
const UTF8 = 0x0800;
/** Unix, and a regular file readable by everybody. */
const MADE_BY = 0x031e;
const EXTERNAL_ATTR = 0o100644 << 16;

/* One fixed timestamp rather than the clock.
 *
 * Two exports of an unchanged Sammlung should be the same file. A zip carries
 * a modification time per member, so with the clock in there the bytes differ
 * every time and nothing downstream can tell a changed board from a re-export.
 * When the package was last touched is in the manifest, where the format put
 * it deliberately - exchange/SPEC.md §8 - and it belongs in exactly one place.
 *
 * 1980-01-01, which is the DOS epoch and the earliest a zip can say.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Everything a compression stream gives back, as one array of bytes.
 *
 * The write is deliberately not awaited before the reading starts: a stream
 * holds a chunk until somebody takes it, so awaiting both in order is how a
 * large member would sit there forever. Same shape as obf.ts's through().
 */
async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const written = writer.write(bytes).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
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
 * The archive, in the order the members were given.
 *
 * Order is the caller's business and it is worth being deliberate about:
 * manifest first, then boards, then media, so that a person running `unzip -l`
 * on a package reads it in the order the format describes it.
 */
export async function zipBytes(members: readonly ZipMember[]): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const pieces: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const member of members) {
    const name = encoder.encode(member.name.normalize("NFC"));
    const compressed = member.deflate !== false;
    const body = compressed ? await deflateRaw(member.data) : member.data;
    const method = compressed ? DEFLATED : STORED;
    const crc = crc32(member.data);

    const local = new Uint8Array(30 + name.length);
    const head = new DataView(local.buffer);
    head.setUint32(0, LOCAL, true);
    head.setUint16(4, NEEDED, true);
    head.setUint16(6, UTF8, true);
    head.setUint16(8, method, true);
    head.setUint16(10, DOS_TIME, true);
    head.setUint16(12, DOS_DATE, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, member.data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);                 // no extra field
    local.set(name, 30);
    pieces.push(local, body);

    const entry = new Uint8Array(46 + name.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, CENTRAL, true);
    view.setUint16(4, MADE_BY, true);
    view.setUint16(6, NEEDED, true);
    view.setUint16(8, UTF8, true);
    view.setUint16(10, method, true);
    view.setUint16(12, DOS_TIME, true);
    view.setUint16(14, DOS_DATE, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, body.length, true);
    view.setUint32(24, member.data.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(38, EXTERNAL_ATTR, true);
    view.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + body.length;
  }

  const directorySize = central.reduce((total, one) => total + one.length, 0);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, END, true);
  tail.setUint16(8, members.length, true);
  tail.setUint16(10, members.length, true);
  tail.setUint32(12, directorySize, true);
  tail.setUint32(16, offset, true);

  const parts = [...pieces, ...central, end];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
