// A device on the end of a cable, made of a Map.
//
// There is no way to unit-test a protocol against a talker that is on a desk
// somewhere, and until the boards are on the bench there is no talker at all.
// So this answers the way firmware/vorlaut/cable.h is written to answer, and
// tools/serialcheck.html can be driven all the way through without any
// hardware.
//
// That would be a comfortable lie on its own - a mock written by the same
// hand as the client will agree with the client. What stops it being one is
// tests/test_cable_format.py: it records the exact bytes the client sent
// while talking to this, and then feeds those bytes to the compiled C reader
// out of the sketch. The mock proves the client runs; the C proves the client
// is understood by the code that will really be listening.
//
// It also prints unmarked lines on purpose. A real device is talking to its
// serial log the whole time this is going on, and a client that only works on
// a silent wire does not work.
//
// And it can be slow, which matters more than it looks. A device made of a Map
// answers instantly, so a client that never waited for an acknowledgement
// would pass against it forever - the thing the acknowledgement exists for is
// a flash write that takes tens of milliseconds, and a mock without one proves
// nothing about it. So `stallMs` puts a real pause before every ack, and
// anything that arrives beyond the window while it is in there is DISCARDED,
// which is exactly what a full USB receive buffer does and exactly how silent
// the loss is. The transfer then fails the way the bench failed before any of
// this existed: "err short", session shut, nothing stored.

import { CABLE_VERSION, crc32, hex8 } from "./cable.js";

/** The window this mock announces, and the most it will hold at once.
 *
 * Not CABLE_WINDOW out of the firmware, and deliberately much smaller than it.
 * The browser reads this off the wire, so a mock carrying the same constant
 * could not tell a client that reads the number from one that assumes it - and
 * small enough that the files in tests/cable_node.mjs take two and three
 * windows each, which is where the cadence is exercised rather than merely
 * mentioned. */
export const MOCK_WINDOW = 512;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Rough imitations of what vorlaut.ino prints while it is running. Not
 *  decoration: they are the thing the "< " marking exists to survive. */
const NOISE = [
  "menu opened",
  "key 1: /a8c1e9b0d4f2a6c3b7e5d1908a4c2f6b.wav",
  "LittleFS: 486400 of 1441792 bytes used",
  "set 1: Grundwortschatz",
];

export class MockDevice {
  /**
   * @param {{files?: Map<string,Uint8Array>, total?: number, noise?: boolean,
   *          failAt?: {name: string, how: "short"|"crc"|"nospace"|"ack"}}} options
   *   failAt forces one file to go wrong, which is the only way to reach the
   *   paths that matter most and never run when everything works.
   *   stallMs is how long the flash takes, so that a client which does not
   *   wait for an ack really does outrun this rather than merely being able to.
   */
  constructor({ files = new Map(), total = 1441792, noise = false,
                failAt = null, window = MOCK_WINDOW, stallMs = 0 } = {}) {
    this.files = files;
    this.total = total;
    this.noise = noise;
    this.failAt = failAt;
    this.window = window;
    this.stallMs = stallMs;
    // Set when more than a window arrived without being asked for, which is a
    // client that is not waiting for its acknowledgements. The transfer fails
    // as a real one would; this is here so the harness can say which fault it
    // was rather than reporting a mysterious short.
    this.overran = null;
    // Whether a hello has been answered. cable.h calls this `open`, starts
    // every session with it false, and clears it again when a transfer is
    // given up on - one rule rather than two, so that "not greeted yet" and
    // "just lost a file" are the same state. It was `broken` here and only
    // guarded the second of those, which made the mock answer a pre-hello
    // verb as though it had been greeted.
    this.greeted = false;
    this.stored = 0;
    this.removed = 0;
    this.bytes = 0;
    this.sent = [];               // every byte the host wrote, for the C reader
    this.noiseAt = 0;
  }

  get used() {
    let sum = 0;
    for (const bytes of this.files.values()) sum += bytes.length;
    return sum;
  }

  get free() { return this.total - this.used; }

  /** A { readable, writable } pair that looks like a SerialPort to Cable.
   *
   *  May be called again for a second session against the same content - the
   *  device outlives the connection, exactly as a real one does. Each run
   *  keeps hold of its own writer rather than reading it off the object,
   *  because the previous session's reader may still be winding down when the
   *  next one opens, and it would otherwise close the new session's output. */
  open() {
    const toDevice = new TransformStream();
    const fromDevice = new TransformStream();
    const out = fromDevice.writable.getWriter();
    this.out = out;
    this.run(toDevice.readable, out).catch((error) => {
      if (error?.name !== "AbortError") console.error("mock device fell over:", error);
    });
    return { readable: fromDevice.readable, writable: toDevice.writable };
  }

  async say(text) { await this.out.write(encoder.encode(text)); }
  async reply(line) { await this.say(`< ${line}\n`); }

  /** An unmarked line, the way the firmware's own Serial.printf output looks. */
  async chatter() {
    if (!this.noise) return;
    await this.say(NOISE[this.noiseAt++ % NOISE.length] + "\n");
  }

  async run(readable, out) {
    // `bool open = false` at the top of serve(): the files outlive the
    // connection and the session does not, so a second connection has to
    // introduce itself again.
    this.greeted = false;
    const reader = readable.getReader();
    let buffer = new Uint8Array(0);
    let pending = null;        // {name, size, crc, got: Uint8Array} while a file arrives

    const append = (chunk) => {
      const next = new Uint8Array(buffer.length + chunk.length);
      next.set(buffer);
      next.set(chunk, buffer.length);
      buffer = next;
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      this.sent.push(value.slice());
      append(value);

      for (;;) {
        if (pending) {
          const still = pending.size - pending.at;
          if (buffer.length === 0) break;
          const take = Math.min(still, buffer.length);
          if (pending.since + take > pending.window) {
            // More than a window arrived without having been asked for. On a
            // device the receive buffer is full by now and the USB stack is
            // dropping what lands with no way to say so, which is why this
            // throws the bytes away rather than storing them: a mock that
            // quietly accepted them would let a client that never waits for an
            // ack pass, and that client is the whole fault this protects
            // against. What the device does next is give up on the silence.
            this.overran = `${pending.name}: ${pending.since + take} bytes for `
              + `a window of ${pending.window}`;
            buffer = buffer.subarray(take);
            this.greeted = false;
            await this.reply(`err short ${pending.name}`);
            pending = null;
            continue;
          }
          pending.got.set(buffer.subarray(0, take), pending.at);
          pending.at += take;
          pending.since += take;
          buffer = buffer.subarray(take);
          if (pending.at === pending.size) {
            // finish() sends the last ack. Whether that window was full or a
            // remainder is not a case here, for the same reason it is not one
            // in cable.h: the end of the file ends the window.
            await this.finish(pending);
            pending = null;
            continue;
          }
          if (pending.since >= pending.window) {
            await this.flash();
            pending.since = 0;
            await this.reply(`ack ${this.ackFor(pending)}`);
          }
          break;
        }
        const cut = buffer.indexOf(10);          // "\n"
        if (cut < 0) break;
        const line = decoder.decode(buffer.subarray(0, cut)).replace(/\r$/, "");
        buffer = buffer.subarray(cut + 1);
        pending = await this.command(line);
      }
    }
    await out.close().catch(() => {});
  }

  /** Handles one command line; returns a pending transfer if bytes follow. */
  async command(line) {
    if (!line.startsWith("> ")) return null;     // not ours: a monitor, an echo
    const [verb, ...args] = line.slice(2).split(" ");

    // cable.h refuses everything but hello until it has answered one, and it
    // does so before the verb is dispatched - so an unknown word arrives here
    // as "err session" rather than "err verb".
    if (verb !== "hello" && !this.greeted) {
      await this.reply("err session");
      return null;
    }

    switch (verb) {
      case "hello":
        this.greeted = true;
        // The client's own constant rather than a literal. A mock that carried
        // its own copy would go on greeting in a protocol nobody speaks any
        // more, and the version is precisely the thing a client checks.
        await this.reply(`vorlaut ${CABLE_VERSION}`);
        await this.reply(`total ${this.total}`);
        await this.reply(`free ${this.free}`);
        await this.reply(`files ${this.files.size}`);
        await this.reply("end hello");
        return null;

      case "list":
        await this.chatter();
        for (const [name, bytes] of this.files) {
          await this.reply(`file ${name} ${bytes.length}`);
        }
        await this.reply(`end list ${this.files.size}`);
        return null;

      case "crc": {
        const bytes = this.files.get(args[0]);
        if (!bytes) await this.reply(`err missing ${args[0]}`);
        else await this.reply(`crc ${args[0]} ${hex8(crc32(bytes))}`);
        return null;
      }

      case "rm":
        if (!this.files.has(args[0])) {
          await this.reply(`err missing ${args[0]}`);
        } else {
          this.files.delete(args[0]);
          this.removed++;
          await this.reply(`gone ${args[0]}`);
        }
        return null;

      case "put": {
        const [name, size, sum] = [args[0], Number(args[1]), parseInt(args[2], 16) >>> 0];
        const replacing = this.files.get(name)?.length || 0;
        const forced = this.failAt?.name === name ? this.failAt.how : null;
        if (forced === "nospace" || this.used - replacing + size > this.total) {
          // Before "go", so the host never starts sending. That is what the
          // handshake is for.
          await this.reply(`err nospace ${name}`);
          return null;
        }
        await this.reply(`go ${this.window}`);
        await this.chatter();
        // Numbers a device made of a Map has no honest way to produce. Small
        // and fixed, so a run against the mock cannot be mistaken for a
        // measurement of anything.
        return { name, size, crc: sum, at: 0, since: 0, window: this.window,
                 got: new Uint8Array(size), forced, gap: 1, stall: 2 };
      }

      case "done": {
        await this.reply(`bye ${this.stored} ${this.removed} ${this.bytes}`);
        this.stored = this.removed = this.bytes = 0;
        return null;
      }

      default:
        await this.reply(line.length > 2 ? "err verb" : "err bad");
        return null;
    }
  }

  /** The running total to acknowledge.
   *
   * Its own function only so that failAt can make it wrong. A device whose
   * acks disagree with what was sent is a stream that has slipped, and the
   * browser compares rather than assuming - so this is how that comparison is
   * reached, since nothing that is working can produce it. */
  ackFor(pending) {
    return pending.forced === "ack" ? pending.at - 1 : pending.at;
  }

  /** How long the flash takes. Zero by default, because most scenarios are
   *  about what is said rather than when - but a run with a real pause in here
   *  is the only kind that can tell a client which waits from one which does
   *  not. */
  async flash() {
    if (this.stallMs) await new Promise((r) => setTimeout(r, this.stallMs));
  }

  async finish(pending) {
    if (pending.forced === "short") {
      // What a cable pulled out halfway looks like from here: the device
      // gives up, throws its half-written file away, and refuses everything
      // until the host starts again with hello.
      this.greeted = false;
      await this.reply(`err short ${pending.name}`);
      return;
    }
    await this.flash();
    // The last window, acknowledged like every other one, and before the
    // checksum is looked at. That order is the firmware's: cable.h acks inside
    // the loop that reads the file and only checks the checksum once the loop
    // has run out of file. So a put that is about to be refused for its
    // contents is acknowledged first - the acknowledgement is about the bytes
    // arriving, and says nothing about whether they were the right ones.
    await this.reply(`ack ${this.ackFor(pending)}`);
    const sum = crc32(pending.got);
    if (pending.forced === "crc" || sum !== pending.crc) {
      await this.reply(`err crc ${pending.name}`);
      return;
    }
    this.files.set(pending.name, pending.got);
    this.stored++;
    this.bytes += pending.size;
    // The firmware reports these before every "ok" - see the note on
    // measuring rather than guessing in docs/cable.md. They are here so that
    // the client's stepping over keywords it does not act on is exercised by
    // every run rather than only by the one test that aims at it.
    await this.reply(`gap ${pending.gap ?? 0}`);
    await this.reply(`stall ${pending.stall ?? 0}`);
    await this.reply(`ok ${pending.name} ${pending.size}`);
  }

  /** Everything the host wrote, in one piece - this is what gets handed to
   *  the C reader so it can be asked whether it understood the same thing. */
  transcript() {
    let length = 0;
    for (const chunk of this.sent) length += chunk.length;
    const all = new Uint8Array(length);
    let at = 0;
    for (const chunk of this.sent) { all.set(chunk, at); at += chunk.length; }
    return all;
  }
}
