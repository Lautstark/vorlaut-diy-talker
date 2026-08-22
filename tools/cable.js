// The browser's half of the cable, with no browser in it.
//
// Everything here works against a { readable, writable } pair, which is what
// navigator.serial hands back and also what a mock can be. That is the whole
// reason this is a module rather than a script inside serialcheck.html: the
// same code can be driven from a tab with a device on the end of it and from
// node with cable_mock.js on the end of it, and tests/test_cable_format.py
// then feeds the bytes it produced into the compiled C reader from the sketch.
//
// The protocol is written down in docs/cable.md. The short of it: lines in
// both directions, marked "> " outbound and "< " inbound because this stream
// is shared with the device's serial log, and one file at a time as raw bytes
// between a "go" and an "ok".
//
// The device is deliberately stupid here. It can list what it holds, hand
// back a checksum, take a file, delete a file, and say goodbye - it does not
// work out what is missing. That is done below, where there is memory and a
// language to do it in.

/** The protocol version this client speaks. See CABLE_VERSION in
 *  firmware/vorlaut/cable_format.h. */
export const CABLE_VERSION = 1;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- The checksum ------------------------------------------------------------
//
// The same CRC-32 as zlib.crc32 and as cableCrc32() in cable_format.h. The
// names are hashes of the input rather than of the bytes, so a name proves
// nothing about what actually arrived - see the note in that header.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** Running CRC-32, so a file can be checksummed in the pieces it is sent in. */
export function crc32(bytes, crc = 0) {
  let value = ~crc;
  for (let i = 0; i < bytes.length; i++) {
    value = (value >>> 8) ^ CRC_TABLE[(value ^ bytes[i]) & 0xff];
  }
  return (~value) >>> 0;
}

/** Eight lower-case hex digits, the way the device writes and reads them. */
export function hex8(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

// --- Errors ------------------------------------------------------------------

/** An "err <word>" the device sent back. The word is the part worth acting
 *  on; the rest is for whoever is reading the log. */
export class CableError extends Error {
  constructor(word, detail) {
    super(detail ? `${word} (${detail})` : word);
    this.name = "CableError";
    this.word = word;
    this.detail = detail || "";
  }
}

// --- The connection ----------------------------------------------------------

const DEFAULT_TIMEOUT = 5000;

export class Cable {
  /**
   * @param {{readable: ReadableStream, writable: WritableStream}} port
   * @param {{onLog?: (line: string) => void, timeout?: number}} options
   *   onLog gets every line that is NOT part of the protocol. That is the
   *   device's own serial output, and throwing it away would take the most
   *   useful diagnostic on the device with it.
   */
  constructor(port, { onLog = () => {}, timeout = DEFAULT_TIMEOUT } = {}) {
    this.port = port;
    this.onLog = onLog;
    this.timeout = timeout;
    this.lines = [];          // protocol lines that have arrived, unread
    this.waiting = null;      // a readLine() that is waiting for one
    this.rest = "";           // a line that has not finished arriving
    this.closed = false;
    this.failure = null;
    this.queue = Promise.resolve();   // one command at a time, in order
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.pump = this.#pump();
  }

  async #pump() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.rest += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = this.rest.indexOf("\n")) >= 0) {
          const line = this.rest.slice(0, cut).replace(/\r$/, "");
          this.rest = this.rest.slice(cut + 1);
          // Everything that is not marked is the device's own log. Keeping
          // the two apart in one stream is what the sigils are for.
          if (line.startsWith("< ")) this.#deliver(line.slice(2));
          else if (line.length) this.onLog(line);
        }
      }
    } catch (error) {
      this.failure = error;
    } finally {
      this.closed = true;
      if (this.waiting) this.#deliver(null);
    }
  }

  #deliver(line) {
    if (this.waiting) {
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve(line);
    } else if (line !== null) {
      this.lines.push(line);
    }
  }

  /** The next protocol line, without its "< ". Throws on silence. */
  async readLine(timeout = this.timeout) {
    if (this.lines.length) return this.lines.shift();
    if (this.closed) throw this.failure || new Error("the cable was unplugged");
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error(`the device said nothing for ${timeout} ms`));
      }, timeout);
      this.waiting = {
        resolve: (line) => {
          clearTimeout(timer);
          if (line === null) {
            reject(this.failure || new Error("the cable was unplugged"));
          } else {
            resolve(line);
          }
        },
      };
    });
  }

  async send(text) {
    await this.writer.write(encoder.encode(`> ${text}\n`));
  }

  /** Splits "crc layout.bin 1a2b3c4d" into its keyword and the rest. */
  static split(line) {
    const space = line.indexOf(" ");
    return space < 0
      ? { key: line, rest: "" }
      : { key: line.slice(0, space), rest: line.slice(space + 1) };
  }

  /** Reads one line and turns "err ..." into something that can be caught. */
  async expect(timeout = this.timeout) {
    const { key, rest } = Cable.split(await this.readLine(timeout));
    if (key === "err") {
      const { key: word, rest: detail } = Cable.split(rest);
      throw new CableError(word, detail);
    }
    return { key, rest };
  }

  /** Runs commands strictly one after another. Two at once would interleave
   *  their answers, and the second one's "ok" would be read as the first's. */
  #serial(work) {
    const next = this.queue.then(work, work);
    this.queue = next.then(() => {}, () => {});
    return next;
  }

  // --- The six verbs ---------------------------------------------------------

  /** Who is on the other end. Also the only way to tell a vorlaut from
   *  whatever else the person picked in the port dialog. */
  hello() {
    return this.#serial(async () => {
      await this.send("hello");
      const answer = { version: 0, total: 0, free: 0, files: 0 };
      for (;;) {
        const { key, rest } = await this.expect();
        if (key === "end") return answer;              // "end hello"
        if (key === "vorlaut") answer.version = Number(rest);
        else if (key === "total") answer.total = Number(rest);
        else if (key === "free") answer.free = Number(rest);
        else if (key === "files") answer.files = Number(rest);
        // Anything else is skipped: a newer device may say more than this
        // one knows how to ask about.
      }
    });
  }

  /** Everything the device holds, as [{name, size}]. The device does no
   *  comparing - this list is the raw truth and the diff happens here. */
  list() {
    return this.#serial(async () => {
      await this.send("list");
      const files = [];
      for (;;) {
        const { key, rest } = await this.expect();
        if (key === "end") return files;               // "end list <count>"
        if (key !== "file") continue;
        const cut = rest.lastIndexOf(" ");
        if (cut < 0) continue;
        files.push({ name: rest.slice(0, cut), size: Number(rest.slice(cut + 1)) });
      }
    });
  }

  /** The checksum of one file. Needed for layout.bin, whose name stays the
   *  same when its content changes - every other name is a hash and answers
   *  the question by existing. */
  crc(name) {
    return this.#serial(async () => {
      await this.send(`crc ${name}`);
      const { rest } = await this.expect();
      return parseInt(rest.slice(rest.lastIndexOf(" ") + 1), 16) >>> 0;
    });
  }

  /**
   * One file. The bytes go out only after the device has said "go" - it has
   * opened its half-written file by then and is counting. Without that
   * handshake a refusal would be followed by a file's worth of content
   * arriving in the device's line reader.
   */
  put(name, bytes, { onProgress = null, chunk = 4096 } = {}) {
    return this.#serial(async () => {
      const sum = crc32(bytes);
      await this.send(`put ${name} ${bytes.length} ${hex8(sum)}`);
      const { key } = await this.expect();
      if (key !== "go") throw new Error(`expected "go", got "${key}"`);
      for (let at = 0; at < bytes.length; at += chunk) {
        await this.writer.write(bytes.subarray(at, Math.min(at + chunk, bytes.length)));
        if (onProgress) onProgress(Math.min(at + chunk, bytes.length), bytes.length);
      }
      // Writing is quick and storing is not: the device is still emptying its
      // buffer into flash when the last chunk is accepted here.
      const { key: verdict, rest } = await this.expect(this.timeout);
      if (verdict !== "ok") throw new Error(`expected "ok", got "${verdict}"`);
      return { name, size: Number(rest.slice(rest.lastIndexOf(" ") + 1)) };
    });
  }

  rm(name) {
    return this.#serial(async () => {
      await this.send(`rm ${name}`);
      const { rest } = await this.expect();
      return rest;
    });
  }

  /** The device reads its new layout in and goes back to being a talker. */
  done() {
    return this.#serial(async () => {
      await this.send("done");
      const { rest } = await this.expect();
      const [stored, removed, bytes] = rest.split(" ").map(Number);
      return { stored, removed, bytes };
    });
  }

  /** Lets go of the port so it can be opened again. */
  async close() {
    try { await this.writer.close(); } catch { /* already gone */ }
    try { await this.reader.cancel(); } catch { /* already gone */ }
    try { this.writer.releaseLock(); } catch { /* already released */ }
    try { this.reader.releaseLock(); } catch { /* already released */ }
    await this.pump.catch(() => {});
  }
}

// --- Working out what to send ------------------------------------------------

/** The one name that does not change with its content. */
export const LAYOUT_FILE = "layout.bin";

/**
 * What to send and what to throw away.
 *
 * @param want  Map name -> {bytes} or {size, crc}: what the build produced.
 * @param have  [{name, size}] as the device reported them.
 * @param room  {total, free} out of hello().
 * @param layoutCrc  the device's checksum of layout.bin, or null if it has none.
 *
 * A name is a hash of the input that produced the file, so a name that is
 * already there is already the right content and needs no transfer. That is
 * the same reasoning the Wi-Fi manifest runs on; only the direction is
 * different, because over a cable the browser is the one that can afford to
 * think.
 *
 * layout.bin is the exception at both ends: its name never changes, so it has
 * to be compared by checksum, and it is sent last because it is the file that
 * decides what everything else means. Until it lands the device still reads
 * the old one, and the old one still points at files that are all still there.
 */
export function plan(want, have, room, layoutCrc = null) {
  const present = new Map(have.map((f) => [f.name, f]));
  const put = [];
  const keep = [];

  for (const [name, file] of want) {
    const sum = file.crc !== undefined ? file.crc : crc32(file.bytes);
    const size = file.size !== undefined ? file.size : file.bytes.length;
    if (name === LAYOUT_FILE) {
      if (present.has(name) && layoutCrc === sum) keep.push(name);
      else put.push({ name, size, crc: sum });
    } else if (present.has(name)) {
      keep.push(name);
    } else {
      put.push({ name, size, crc: sum });
    }
  }

  const remove = have.map((f) => f.name).filter((name) => !want.has(name));

  // Last, always. It is the commit.
  put.sort((a, b) => (a.name === LAYOUT_FILE) - (b.name === LAYOUT_FILE));

  const needed = put.reduce((sum, f) => sum + f.size, 0);
  const frees = remove.reduce(
    (sum, name) => sum + (present.get(name)?.size || 0), 0);

  // Sending first and deleting afterwards means the device is never holding a
  // layout that points at a file which is no longer there. It costs room: for
  // the length of the transfer both the old files and the new ones are on a
  // partition of 1.5 MB. Replacing every symbol and every sentence at once
  // does not fit, and then there is no choice but to clear the way first and
  // accept that a transfer breaking off in the middle leaves the device with
  // silent keys until it is finished.
  const tight = needed > room.free;
  if (tight && needed > room.free + frees) {
    return { put, remove, keep, needed, tight, fits: false };
  }
  return { put, remove, keep, needed, tight, fits: true };
}

/**
 * Runs a plan. Returns what the device said it did.
 *
 * @param cable  a connected Cable
 * @param made   Map name -> {bytes}
 * @param theplan  what plan() worked out
 * @param onStep  called as ("put"|"rm", name, index, total)
 */
export async function push(cable, made, theplan, onStep = () => {}) {
  const total = theplan.put.length + theplan.remove.length;
  let step = 0;

  const sweep = async () => {
    for (const name of theplan.remove) {
      onStep("rm", name, step++, total);
      try {
        await cable.rm(name);
      } catch (error) {
        // A file that is not there is already in the state we wanted it in.
        if (!(error instanceof CableError && error.word === "missing")) throw error;
      }
    }
  };

  if (theplan.tight) await sweep();
  for (const file of theplan.put) {
    onStep("put", file.name, step++, total);
    await cable.put(file.name, made.get(file.name).bytes);
  }
  if (!theplan.tight) await sweep();

  return await cable.done();
}
