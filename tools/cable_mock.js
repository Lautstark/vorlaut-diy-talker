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

import { crc32, hex8 } from "./cable.js";

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
   *          failAt?: {name: string, how: "short"|"crc"|"nospace"}}} options
   *   failAt forces one file to go wrong, which is the only way to reach the
   *   paths that matter most and never run when everything works.
   */
  constructor({ files = new Map(), total = 1441792, noise = false,
                failAt = null } = {}) {
    this.files = files;
    this.total = total;
    this.noise = noise;
    this.failAt = failAt;
    this.broken = false;          // a transfer was given up on
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
          pending.got.set(buffer.subarray(0, take), pending.at);
          pending.at += take;
          buffer = buffer.subarray(take);
          if (pending.at < pending.size) break;
          await this.finish(pending);
          pending = null;
          continue;
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

    if (this.broken && verb !== "hello") {
      await this.reply("err session");
      return null;
    }

    switch (verb) {
      case "hello":
        this.broken = false;
        await this.reply("vorlaut 1");
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
        await this.reply("go");
        await this.chatter();
        // Numbers a device made of a Map has no honest way to produce. Small
        // and fixed, so a run against the mock cannot be mistaken for a
        // measurement of anything.
        return { name, size, crc: sum, at: 0, got: new Uint8Array(size), forced,
                 gap: 1, stall: 2 };
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

  async finish(pending) {
    if (pending.forced === "short") {
      // What a cable pulled out halfway looks like from here: the device
      // gives up, throws its half-written file away, and refuses everything
      // until the host starts again with hello.
      this.broken = true;
      await this.reply(`err short ${pending.name}`);
      return;
    }
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
