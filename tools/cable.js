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
// between a "go" and an "ok" - a window at a time, waiting after each for the
// device to say the bytes are in its file system.
//
// The device is deliberately stupid here. It can list what it holds, hand
// back a checksum, take a file, delete a file, and say goodbye - it does not
// work out what is missing. That is done below, where there is memory and a
// language to do it in.

/** The protocol version this client speaks. See CABLE_VERSION in
 *  firmware/vorlaut/cable_format.h. */
export const CABLE_VERSION = 2;

/**
 * What the number in "< vorlaut N" means for this client.
 *
 * The number existed for a year before anything read it. `findTalker()` tested
 * it for truthiness - any non-zero version was accepted and then driven as
 * whatever this file happened to speak - and the only other reader was a test
 * grepping this source for the digit. Then the first real bump happened, on
 * 2026-08-27, when the acknowledged transfer landed and made version 1 and
 * version 2 two protocols that really exist and really cannot drive each other.
 *
 * **Any mismatch is refused, in both directions.** That is not caution, it is
 * what the number means: cable_format.h defines a bump as the case where "a
 * device that speaks the old protocol could no longer be driven correctly by a
 * browser that speaks the new one", and says outright that adding a keyword is
 * not one - unknown keywords are skipped on both sides and cost no version at
 * all. So a version that is not this one is a statement by whoever bumped it
 * that these two ends do not work together, and there is no field saying a
 * particular bump was safe in one direction. Sending anyway would mean starting
 * a transfer the protocol says cannot finish, and finding out halfway - which
 * for version 2 in particular means a browser waiting forever for an ack, or a
 * device overrun and failing on a checksum. A talker left with silent keys is
 * a worse answer than a sentence before anything is sent.
 *
 * The two directions are told apart because the remedies are opposite and
 * neither is "the device is broken": an older device needs newer firmware, and
 * a newer device means this page is the stale half.
 *
 * @param {number} theirs  the version out of hello()
 * @returns {"ok" | "silent" | "device_older" | "device_newer"}
 */
export function versionVerdict(theirs) {
  // Zero is not a mismatch. It is what hello() starts at and never overwrote,
  // which means whatever is on that port never said "vorlaut" at all - a
  // dongle, a printer, somebody else's dev board. Not a talker rather than a
  // talker of the wrong age, and the caller keeps looking.
  if (!theirs) return "silent";
  if (theirs === CABLE_VERSION) return "ok";
  return theirs < CABLE_VERSION ? "device_older" : "device_newer";
}

/* The shapes of the answers, so that this file says what it hands back rather
 * than leaving each of its three consumers - the bench, the node harness and
 * src/backend/cable.ts - to find out. They are comments: nothing here is
 * compiled, and tests/test_cable_format.py remains what actually holds this
 * client to the device's own reader.
 *
 * @typedef {{version: number, total: number, free: number, files: number}} Greeting
 * @typedef {{name: string, size: number}} Held
 * @typedef {{stored: number, removed: number, bytes: number}} Farewell
 * @typedef {{put: {name: string, size: number, crc: number}[], remove: string[],
 *            keep: string[], needed: number, tight: boolean, fits: boolean}} Plan
 */

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

// How long any one answer may take. Longer than the device's own
// CABLE_QUIET_MS of 4000 on purpose: both ends are now waiting on each other
// during a transfer, and whichever gives up first is the one that gets to say
// why. The device gives up first, sends "err short" and shuts the session -
// which arrives here as a word to act on instead of a silence to guess at.
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
    // The longest the device waited for bytes, and the longest a single write
    // into LittleFS took, over every file this connection has carried. These
    // are what say how close CABLE_QUIET_MS came - see docs/cable.md. Since
    // the device waits for a window after every ack, a gap of zero now means
    // the acknowledging is not happening rather than that nothing was late.
    this.worstGap = 0;
    this.worstStall = 0;
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

  /**
   * Reads until one of these keywords arrives, stepping over anything else.
   *
   * This is the rule the protocol states everywhere - a reader skips keywords
   * it does not know, so the other side can gain a field without this one
   * falling over - and until the device started reporting its timings it was
   * a rule this client did not actually follow. Waiting for exactly one line
   * would have turned the first extra keyword the firmware ever sends into a
   * failed transfer.
   */
  async expectOneOf(want, timeout = this.timeout) {
    for (;;) {
      const answer = await this.expect(timeout);
      if (want.includes(answer.key)) return answer;
      this.noted(answer.key, answer.rest);
    }
  }

  /** A keyword this client does not act on. Recorded, not discarded: the
   *  timings the device reports arrive this way. */
  noted(key, rest) {
    if (key === "gap" || key === "stall") {
      const ms = Number(rest);
      const worst = key === "gap" ? "worstGap" : "worstStall";
      if (Number.isFinite(ms) && ms > this[worst]) this[worst] = ms;
    }
    this.onLog(`(${key} ${rest})`);
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
   *  whatever else the person picked in the port dialog.
   *  @param {{tries?: number}} [options]
   *  @returns {Promise<Greeting>} */
  hello({ tries = 1 } = {}) {
    return this.#serial(async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await this.#greet();
        } catch (error) {
          // Opening the port may reset the board - the ESP32-S3's USB stack
          // watches for the DTR/RTS pattern esptool uses, and what Chrome
          // asserts on open() is not something this can find out from here.
          // If that happens the first hello lands while the device is still
          // booting, and the answer is to ask again rather than to give up.
          if (attempt >= tries) throw error;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
    });
  }

  async #greet() {
    await this.send("hello");
    {
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
    }
  }

  /** Everything the device holds, as [{name, size}]. The device does no
   *  comparing - this list is the raw truth and the diff happens here.
   *  @returns {Promise<Held[]>} */
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
      const { rest } = await this.expectOneOf(["crc"]);
      return parseInt(rest.slice(rest.lastIndexOf(" ") + 1), 16) >>> 0;
    });
  }

  /**
   * One file, a window at a time.
   *
   * The bytes go out only after the device has said "go" - it has opened its
   * half-written file by then and is counting. Without that handshake a
   * refusal would be followed by a file's worth of content arriving in the
   * device's line reader.
   *
   * The "go" carries the window: the most the device will take before it says
   * it has the bytes. After each window this waits for an "ack" carrying the
   * running total, and sends nothing until it arrives. Writing here is quick
   * and storing on the device is not, so without that wait the browser
   * finishes a file while the device is still emptying a buffer into flash -
   * and everything that lands while it is in there is discarded by a USB stack
   * with no way to mention it. Waiting is what makes a slow flash cost time
   * rather than content.
   *
   * The number comes off the wire and is not a constant here, deliberately.
   * The device is the end that knows how much room it has, and a browser that
   * decided for itself would be back to guessing.
   */
  put(name, bytes, { onProgress = null } = {}) {
    return this.#serial(async () => {
      const sum = crc32(bytes);
      await this.send(`put ${name} ${bytes.length} ${hex8(sum)}`);
      const window = Number((await this.expectOneOf(["go"])).rest);
      if (!Number.isInteger(window) || window <= 0) {
        throw new Error(`the device said "go" with a window of ${window}`);
      }
      let at = 0;
      while (at < bytes.length) {
        const end = Math.min(at + window, bytes.length);
        await this.writer.write(bytes.subarray(at, end));
        at = end;
        // Whatever the device chose to say first is stepped over here too. An
        // ack is an ordinary keyword line and gets no special reading.
        const acked = Number((await this.expectOneOf(["ack"])).rest);
        if (acked !== at) {
          throw new Error(`sent ${at} bytes of ${name}, `
                          + `the device acknowledged ${acked}`);
        }
        if (onProgress) onProgress(at, bytes.length);
      }
      // "ok", with the gap and stall timings stepped over on the way.
      const { rest } = await this.expectOneOf(["ok"]);
      const stored = Number(rest.slice(rest.lastIndexOf(" ") + 1));
      // The device echoes back what it stored, and it is worth reading rather
      // than assuming. Agreeing on the name but not the length is what a
      // stream that has slipped looks like from here - and it is the one
      // failure that would otherwise be silent, because the next command
      // would still be answered normally.
      if (stored !== bytes.length) {
        throw new Error(`sent ${bytes.length} bytes of ${name}, `
                        + `the device stored ${stored}`);
      }
      return { name, size: stored };
    });
  }

  rm(name) {
    return this.#serial(async () => {
      await this.send(`rm ${name}`);
      const { rest } = await this.expectOneOf(["gone"]);
      return rest;
    });
  }

  /** The device reads its new layout in and goes back to being a talker.
   *  @returns {Promise<Farewell>} */
  done() {
    return this.#serial(async () => {
      await this.send("done");
      const { rest } = await this.expectOneOf(["bye"]);
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
 * The size is compared as well, and that is a belt to the device's braces
 * rather than a second opinion. Keeping a file on its name alone is only
 * sound because the device never creates a name until the bytes under it are
 * whole and their checksum agrees - it writes to /.part and renames, so an
 * interrupted transfer leaves a fragment nobody will look at rather than a
 * short file under a name that promises a whole one. If that were ever not
 * true, a truncated file would be kept for its name, never re-sent, and
 * layout.bin would eventually point at it: silent, and permanent, because
 * nothing looks at that file again. One comparison turns that into a file
 * that is simply sent again, and it costs nothing - list already reports the
 * sizes.
 *
 * layout.bin is the exception at both ends: its name never changes, so it has
 * to be compared by checksum, and it is sent last because it is the file that
 * decides what everything else means. Until it lands the device still reads
 * the old one, and the old one still points at files that are all still there.
 *
 * @returns {Plan}
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
    } else if (present.has(name) && present.get(name).size === size) {
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
 * @param options.onStep  called as ("put"|"rm", name, index, total)
 * @param options.signal  an AbortSignal: the page will have its own reasons to
 *   stop that have nothing to do with the cable - a dialog closing, a
 *   navigation, a timeout - and AbortSignal.any() composes those with this
 *   one, which a cancel() method on the connection would not. All the time is
 *   in here; everything else is pure or one round trip.
 *
 * Closing is the caller's business, not this function's. The cable was handed
 * in, so a caller that wants to abort and retry would be surprised to find its
 * connection shut underneath it - what belongs here is only not going on.
 *
 * Aborting is checked between steps rather than inside a file. It could be
 * checked inside one: the device writes to /.part and renames on a matching
 * checksum, so stopping mid-file leaves a fragment and never a short file
 * under a real name. But stopping mid-file also leaves the device counting
 * down its four seconds to a transfer that will not finish, after which the
 * session is shut until hello. A step boundary is at most one file away - well
 * under a second - and leaves the connection usable.
 *
 * @returns {Promise<Farewell>}
 */
export async function push(cable, made, theplan, options = {}) {
  const { onStep = () => {}, signal = null } = typeof options === "function"
    ? { onStep: options }        // the older positional form
    : options;
  const total = theplan.put.length + theplan.remove.length;
  let step = 0;

  const sweep = async () => {
    for (const name of theplan.remove) {
      signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    onStep("put", file.name, step++, total);
    await cable.put(file.name, made.get(file.name).bytes);
  }
  if (!theplan.tight) await sweep();

  // Not reached when aborted, and deliberately: "done" is what makes the
  // device read its new layout in, and a half-sent payload is not one to
  // start reading.
  signal?.throwIfAborted();
  return await cable.done();
}
