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
// back a checksum, hand back a file, take a file, delete a file, and say
// goodbye - it does not work out what is missing. That is done below, where
// there is memory and a language to do it in.

/** The tile form this client can write, matched whole against what the device
 *  says in its hello. The mirror of CABLE_TILE_FORMS in
 *  firmware/vorlaut/cable_format.h, and device/fixtures/cable/tiles-named-in-
 *  the-hello is where the two are held together.
 *
 *  Unlike the version below this is not a number and is not compared as one.
 *  There is no "newer": a browser sends the compressed form to a device that
 *  named this exact word and the raw form to every other device, so the two
 *  ends either agree completely or do not try. */
export const CABLE_TILE_FORM = "vt1";

/** The recording form this client can write, matched whole against what the
 *  device says in its hello. The mirror of CABLE_AUDIO_FORMS in
 *  firmware/vorlaut/cable_format.h, and device/fixtures/cable/audio-named-in-
 *  the-hello is where the two are held together.
 *
 *  Read exactly like the tile form above and for a sharper version of the same
 *  reason. A tile sent to a device that cannot read it is a panel of noise;
 *  a recording sent to one is a full-volume hiss out of the speaker, which is
 *  the one failure on this device that a person cannot look away from. */
export const CABLE_AUDIO_FORM = "va1";

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
 * loader/src/cable.ts - to find out. They are comments: nothing here is
 * compiled, and tests/test_cable_format.py remains what actually holds this
 * client to the device's own reader.
 *
 * @typedef {{version: number, total: number, free: number, files: number,
 *            firmware: string, tiles: string, audio: string,
 *            collections: number}} Greeting
 * @typedef {{name: string, size: number}} Held
 * @typedef {{stored: number, removed: number, bytes: number}} Farewell
 * @typedef {{put: {name: string, size: number, crc: number}[], remove: string[],
 *            keep: string[], needed: number, total: number, already: number,
 *            tight: boolean, fits: boolean, collections: number, room: number,
 *            full: boolean}} Plan
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

/* How long a command that has to walk the file system may take to answer.
 *
 * `hello` and `list` are the two, and the cost is the walk rather than the
 * wire: measured on v0.11 with a 7040 KiB partition holding 322 files, the
 * greeting's `free` line arrived at 0.7s and `files` at 7.1s, with everything
 * before and after it instant. A full talker stopped answering a page that the
 * same talker answered fine when it was nearly empty, and from the outside
 * that is indistinguishable from no device at all. The partition grew from
 * 1536 to 7040 KiB; the patience did not grow with it.
 *
 * Deliberately not DEFAULT_TIMEOUT and deliberately not a raise of it. That
 * number is pinned just above the device's own CABLE_QUIET_MS so that during a
 * transfer the device gives up first and says `err short` - a word to act on
 * rather than a silence to guess at - and raising it would hand that race to
 * the browser. Nothing races during a walk: the device is computing, not
 * waiting on us. The only thing this patience costs is the wait before a port
 * that really is silent is called silent. */
const WALK_TIMEOUT = 30000;

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
    // What has arrived and not been read yet, as BYTES rather than as text.
    //
    // It was a string, decoded as each chunk landed, and that was fine while
    // everything coming this way was lines. `get` hands a file back the way a
    // `put` sends one - a head line, then that many raw bytes with no newline
    // anywhere - and decoding those as UTF-8 would turn every byte above 0x7f
    // into a replacement character on the way past. So the bytes are kept as
    // bytes and only a whole line is ever decoded, which also happens to fix a
    // thing the streaming decoder was papering over: a line is now decoded in
    // one piece rather than across two chunks.
    this.rest = new Uint8Array(0);
    // A read of raw bytes in flight, or null. See #readRaw().
    this.raw = null;
    /* Whether a `data` head has been read and the bytes it announced have not
     * been asked for yet.
     *
     * #chew() says the rule already - "while a `get` is in flight the stream is
     * a file and not a conversation" - and `this.raw` was the only thing
     * enforcing it, which left a gap the width of an await. #deliver() resolves
     * the promise `get` is waiting on, but the code that awaited it cannot run
     * until #chew()'s synchronous loop lets go, and that loop carried on
     * parsing lines. A file arriving in the same read as its own head was
     * therefore read as conversation and handed to onLog, byte for byte, and
     * the raw read that started afterwards waited for bytes that had already
     * been thrown away: "the device sent 0 of 1072 bytes and stopped", with the
     * file itself in the log pane underneath it.
     *
     * It only bit where one read held both. A device that paused between the
     * head and the body - or a slower stream that split them - gave the await
     * time to land and looked perfectly well, which is why every test and a
     * run against real hardware from node missed it and a browser did not. */
    this.holding = false;
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
        const merged = new Uint8Array(this.rest.length + value.length);
        merged.set(this.rest);
        merged.set(value, this.rest.length);
        this.rest = merged;
        this.#chew();
      }
    } catch (error) {
      this.failure = error;
    } finally {
      this.closed = true;
      this.holding = false;
      if (this.waiting) this.#deliver(null);
      if (this.raw) {
        const stopped = this.raw;
        this.raw = null;
        clearTimeout(stopped.timer);
        stopped.reject(this.failure || new Error("the cable was unplugged"));
      }
    }
  }

  /** What has arrived, turned into whoever is waiting for it.
   *
   * Raw bytes first and lines second, and never both at once: while a `get` is
   * in flight the stream is a file and not a conversation, which is the same
   * rule a `put` follows in the other direction. Anything left over after the
   * count is met is a line again, immediately, in this same pass - the "sent"
   * that closes a `get` usually arrives in the very chunk the last bytes did.
   */
  #chew() {
    for (;;) {
      if (this.raw) {
        const take = Math.min(this.raw.want - this.raw.at, this.rest.length);
        if (take > 0) {
          this.raw.into.set(this.rest.subarray(0, take), this.raw.at);
          this.raw.at += take;
          this.rest = this.rest.subarray(take);
          this.#rawTick();
        }
        if (this.raw.at < this.raw.want) return;
        const whole = this.raw;
        this.raw = null;
        clearTimeout(whole.timer);
        whole.resolve(whole.into);
        continue;
      }
      /* Bytes are owed to a `get` that has not set up its read yet. They stay
         in `rest` until #readRaw() takes them; parsing them as lines here is
         exactly the bug this flag exists for. */
      if (this.holding) return;

      const cut = this.rest.indexOf(10);
      if (cut < 0) return;
      const line = decoder.decode(this.rest.subarray(0, cut)).replace(/\r$/, "");
      this.rest = this.rest.subarray(cut + 1);
      // Everything that is not marked is the device's own log. Keeping
      // the two apart in one stream is what the sigils are for.
      if (line.startsWith("< ")) this.#deliver(line.slice(2));
      else if (line.length) this.onLog(line);
    }
  }

  /** The watchdog on a raw read: this long with nothing arriving, not this
   *  long altogether. A file is as long as it is, and a timeout measured
   *  against its whole length would either refuse a big one or forgive a
   *  device that had stopped talking halfway through a small one. */
  #rawTick() {
    if (!this.raw) return;
    clearTimeout(this.raw.timer);
    this.raw.timer = setTimeout(() => {
      const stalled = this.raw;
      this.raw = null;
      stalled.reject(new Error(
        `the device sent ${stalled.at} of ${stalled.want} bytes and stopped`));
    }, this.timeout);
  }

  /** Exactly `want` bytes, counted rather than searched for.
   *
   * Set up before the bytes can be read out of the buffer, and then the buffer
   * is chewed again - because on a fast device the whole file is already
   * sitting in `rest` by the time the head line has been parsed. */
  #readRaw(want) {
    if (want === 0) return Promise.resolve(new Uint8Array(0));
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(this.failure || new Error("the cable was unplugged"));
        return;
      }
      this.raw = { want, into: new Uint8Array(want), at: 0, resolve, reject,
                   timer: null };
      // The bytes have somewhere to go now, so the stream can be read again.
      this.holding = false;
      this.#rawTick();
      this.#chew();
    });
  }

  #deliver(line) {
    /* Set here rather than in get(), because here is the only moment that is
       still inside #chew()'s pass. By the time get() sees this line the loop
       has already had its chance to eat the file. */
    if (line !== null && line.startsWith("data ")) this.holding = true;
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

  /* A command means the conversation has resumed, whatever happened to the
     last one. Without this a `get` that threw between its head and its read -
     a size that would not parse, a caller that gave up - would leave the
     reader holding for ever, and every later answer would sit unread in
     `rest`. Cheap, and it makes the flag impossible to get stuck in. */
  async send(text) {
    this.holding = false;
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
    // Every line of the greeting, not only the slow one: which line the walk
    // sits behind is the firmware's business, and it has already moved once.
    {
      // firmware starts empty rather than at some placeholder version, and
      // empty is a real answer rather than a missing one: it is what a device
      // flashed before 2026-08-28 says, because it has no such line to say.
      // Whatever reads this has to be able to write the sentence "it did not
      // say", and giving that state a name here is cheaper than every reader
      // inventing one.
      const answer = { version: 0, total: 0, free: 0, files: 0, firmware: "",
                       tiles: "", audio: "", collections: 1 };
      for (;;) {
        const { key, rest } = await this.expect(WALK_TIMEOUT);
        if (key === "end") return answer;              // "end hello"
        if (key === "vorlaut") answer.version = Number(rest);
        else if (key === "total") answer.total = Number(rest);
        else if (key === "free") answer.free = Number(rest);
        else if (key === "files") answer.files = Number(rest);
        // Which build is on the device, as opposed to which protocol it
        // speaks. Kept as the word the device said, and not parsed here: a
        // release says its tag and a sketch somebody compiled says "dev", and
        // this file has nothing to compare either against. Ordering two of
        // these is the business of whoever holds a second version to hold it
        // beside.
        else if (key === "firmware") answer.firmware = rest;
        // How many collections this device holds. One, where it does not say -
        // which is every talker flashed before 2026-08-31, and one is exactly
        // what those hold: a single layout.bin, swept and replaced whole. A
        // browser that assumed more would fill such a device's partition with
        // a file it will never read.
        else if (key === "collections") answer.collections = Number(rest);
        // Which tile form the device can draw, empty when it did not say -
        // and empty is the answer for every talker flashed before
        // 2026-08-31, which reads raw tiles and nothing else. Kept as the word
        // the device said and compared whole by whoever sends a tile: a
        // browser that guessed at a form the device did not name would be
        // sending it a file it draws as noise, and nothing would say so.
        else if (key === "tiles") answer.tiles = rest;
        // Which recording form the device can play, empty when it did not say.
        // Empty is the answer for every talker flashed before 2026-09-01,
        // which plays 16-bit PCM and nothing else, and it is a separate answer
        // from the tile form above because they are separate capabilities.
        else if (key === "audio") answer.audio = rest;
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
        const { key, rest } = await this.expect(WALK_TIMEOUT);
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
   * One file back off the device, as bytes.
   *
   * The seventh verb, and the one that lets the browser go on doing the
   * thinking now that a talker holds more than one collection. Working out
   * which tiles and recordings a removed collection leaves behind means
   * knowing what the collections that stay still name, and a collection file
   * IS that list - so the answer was either this or a device that walks its own
   * layouts. adr/0021 took this.
   *
   * The framing is a `put` read from the other side: a head line with the
   * length and the checksum, then exactly that many bytes with no newline in
   * front of them and none after, then a line saying how many really went. Two
   * things are compared and both of them have been silent failures on this wire
   * before - the count, which catches a stream that stopped, and the checksum,
   * which catches one that slipped.
   *
   * Only ever sent to a device that named a number above one in its greeting.
   * A talker flashed before 2026-08-31 answers "err verb", and nothing asks it:
   * it holds one collection, under one name, and there is nothing to work out.
   */
  get(name) {
    return this.#serial(async () => {
      await this.send(`get ${name}`);
      const { rest } = await this.expectOneOf(["data"]);
      // From the right: a name can hold neither a space nor the two numbers
      // after it, so the last two words are the length and the checksum
      // whatever the name turns out to be.
      const words = rest.split(" ");
      const sum = parseInt(words.pop(), 16) >>> 0;
      const size = Number(words.pop());
      const said = words.join(" ");
      if (!Number.isInteger(size) || size < 0) {
        throw new Error(`the device offered ${name} as ${size} bytes`);
      }
      const bytes = await this.#readRaw(size);
      const { rest: tail } = await this.expectOneOf(["sent"]);
      const sent = Number(tail.slice(tail.lastIndexOf(" ") + 1));
      if (sent !== size) {
        throw new Error(`the device offered ${size} bytes of ${said} `
                        + `and sent ${sent}`);
      }
      if (crc32(bytes) !== sum) {
        throw new Error(`${said} did not survive the way back: `
                        + `${hex8(crc32(bytes))} against ${hex8(sum)}`);
      }
      return bytes;
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

/** The one name a collection had while a device could only hold one.
 *
 * Still a name a device may be carrying, and therefore still a name this
 * client has to compare by checksum. What changed on 2026-08-31 is that it is
 * no longer the ONLY such name - see isCollection() below. */
export const LAYOUT_FILE = "layout.bin";

/** Whether a name is a collection's, and therefore one whose content this
 *  client cannot infer from the fact that it is there.
 *
 *  isCollectionFile() in loader/src/layout_format.ts, written a second time -
 *  this file deliberately imports nothing, because it is the half that runs
 *  under node against a mock as well as in a tab. The pair are held to
 *  device/fixtures/collections.expected.json from either side. */
export function isCollection(name) {
  return name === LAYOUT_FILE || /^c[0-9a-f]{32}\.bin$/.test(String(name ?? ""));
}

/**
 * What to send and what to throw away.
 *
 * @param want  Map name -> {bytes} or {size, crc}: what the build produced.
 * @param have  [{name, size}] as the device reported them.
 * @param room  {total, free, collections} out of hello(). `collections` is how
 *   many the device holds; one - the default - means every transfer is a
 *   replacement, which is what a talker flashed before 2026-08-31 is.
 * @param collectionCrc  the device's checksum of the collection file this
 *   payload carries, or null if it is not holding one under that name.
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
 * A collection file is the exception at both ends: its name is a hash of what
 * the collection IS rather than of what is in it, so it has to be compared by
 * checksum, and it is sent last because it is the file that decides what
 * everything else means. Until it lands the device still reads the old one, and
 * the old one still points at files that are all still there. That used to be a
 * sentence about layout.bin and one file; it is the same sentence about a
 * family of names now, which is the whole of what isCollection() is for.
 *
 * @returns {Plan}
 */
export function plan(want, have, room, collectionCrc = null) {
  const present = new Map(have.map((f) => [f.name, f]));
  const put = [];
  const keep = [];

  for (const [name, file] of want) {
    const sum = file.crc !== undefined ? file.crc : crc32(file.bytes);
    const size = file.size !== undefined ? file.size : file.bytes.length;
    if (isCollection(name)) {
      if (present.has(name) && collectionCrc === sum) keep.push(name);
      else put.push({ name, size, crc: sum });
    } else if (present.has(name) && present.get(name).size === size) {
      keep.push(name);
    } else {
      put.push({ name, size, crc: sum });
    }
  }

  // **Everything the device holds and this payload does not name, or nothing
  // at all**, and which of the two is what a device says about itself in its
  // greeting rather than a mode this page chooses.
  //
  // A talker that holds one collection holds it under one name, and a transfer
  // is a replacement: what is not in the new state is stale and goes. A talker
  // that holds several has no way to tell "stale" from "belongs to the other
  // game", because every tile and recording is named for its content and two
  // collections that use the same picture use the same file. So the sweep is
  // not merely wrong there, it is the one edit that would silently break a
  // collection nobody touched.
  //
  // Removing a collection is therefore a separate act with a subtraction of its
  // own, and it is not here: it needs the collections that STAY, which this
  // function is not given and loader/src/cable.ts reads off the device.
  const additive = (room.collections || 1) > 1;
  const remove = additive
    ? []
    : have.map((f) => f.name).filter((name) => !want.has(name));

  // Last, always. It is the commit.
  put.sort((a, b) => isCollection(a.name) - isCollection(b.name));

  const needed = put.reduce((sum, f) => sum + f.size, 0);
  // What this collection comes to altogether, and how much of it is already
  // there. Neither is what gets sent - `needed` is - and both are what somebody
  // deciding whether to press Send is actually asking: a page that says only
  // "1230 KiB to send" cannot say whether that is most of the collection or the
  // last tile of it.
  const total = [...want.values()].reduce(
    (sum, f) => sum + (f.size !== undefined ? f.size : f.bytes.length), 0);
  const already = total - needed;
  // How many collections the device would be holding afterwards, against how
  // many it says it can. The number comes off the wire and is not a constant
  // here, deliberately, for the same reason the window is not: the device is
  // the end that knows.
  const holds = have.filter((f) => isCollection(f.name)).length;
  const adding = put.filter((f) => isCollection(f.name))
    .filter((f) => !present.has(f.name)).length;
  const full = additive && holds + adding > (room.collections || 1);
  const frees = remove.reduce(
    (sum, name) => sum + (present.get(name)?.size || 0), 0);

  // Sending first and deleting afterwards means the device is never holding a
  // layout that points at a file which is no longer there. It costs room: for
  // the length of the transfer both the old files and the new ones are on the
  // same partition - 7040 KiB on a device flashed since 2026-08-31, 1536 KiB
  // on one that still carries the older table. Where everything does not fit
  // at once there is no choice but to clear the way first and accept that a
  // transfer breaking off in the middle leaves the device with silent keys
  // until it is finished. Which of the two it is never appears here: the room
  // comes from the device's own hello.
  const tight = needed > room.free;
  const shape = { put, remove, keep, needed, total, already, tight,
                  collections: holds + adding, room: room.collections || 1,
                  full };
  if (tight && needed > room.free + frees) return { ...shape, fits: false };
  return { ...shape, fits: true };
}

/**
 * What goes with a collection when it is removed.
 *
 * The same subtraction plan() makes, from the other end and with the arithmetic
 * turned round: there, what the device holds and the payload does not name is
 * stale; here, what the device holds and the collections that STAY do not name
 * is stale. It is one function rather than two because it is one idea, and it
 * is separate from plan() because the inputs are genuinely different - this one
 * needs the collections that remain, which only a `get` can produce.
 *
 * `keeping` is every tile and recording named by every collection that is not
 * going, and every collection file that is not going. A collection this page
 * could not read contributes nothing to it and must therefore be handled by the
 * caller: sweeping on behalf of a collection whose contents are unknown would
 * take the files it needs with it.
 *
 * @param have  [{name, size}] as the device reported them.
 * @param going  the collection file being removed.
 * @param keeping  Set of every name that must survive.
 * @returns {{remove: string[], frees: number}}
 */
export function planRemoval(have, going, keeping) {
  const remove = [];
  let frees = 0;
  for (const file of have) {
    if (file.name !== going && keeping.has(file.name)) continue;
    remove.push(file.name);
    frees += file.size || 0;
  }
  // **The collection first**, which is the opposite of a put's order and the
  // same reasoning read backwards. There, the collection file is the commit and
  // goes last so that nothing is half-replaced. Here it is the commit again and
  // therefore goes FIRST: the moment it is gone the device holds no collection
  // that names any of the rest, so a session that breaks off halfway leaves a
  // talker that has lost exactly what it was asked to lose and some files
  // nobody names. The other order would leave a collection still listed in the
  // menu whose keys have gone black.
  remove.sort((a, b) => (b === going) - (a === going));
  return { remove, frees };
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
