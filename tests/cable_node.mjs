// Drives loader/tools/cable.js against loader/tools/cable_mock.js and reports what happened.
//
// The report carries the exact bytes the client wrote. tests/test_cable_format.py
// hands those to the compiled C reader out of the sketch and checks that it
// arrives at the same files - which is the only way, without a board on the
// bench, to ask whether the two halves of this protocol agree.
//
//     node tests/cable_node.mjs <scenario>
//
// Every scenario starts against an empty device and seeds it by sending, so
// that the C reader - which also starts empty and can only be reached through
// the wire - goes through the same states. Nothing is set up behind its back.

import { Cable, plan, push, crc32, hex8, LAYOUT_FILE } from "../loader/tools/cable.js";
import { MockDevice } from "../loader/tools/cable_mock.js";

// --- Content that is the same every run --------------------------------------

/** A small deterministic generator, so a failure can be reproduced. */
function stream(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;  state >>>= 0;
    return state & 0xff;
  };
}

function blob(seed, length) {
  const next = stream(seed);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = next();
  return bytes;
}

/** Names shaped like the real ones: "t" or "a" plus 32 hex, plus layout.bin. */
function payload(seed, count, { layout = seed } = {}) {
  const made = new Map();
  for (let i = 0; i < count; i++) {
    const hash = (seed * 2654435761 + i * 40503) >>> 0;
    const name = (i % 2 ? "a" : "t")
      + hex8(hash) + hex8(hash ^ 0x5bf03635) + hex8(hash + i) + hex8(i)
      + (i % 2 ? ".wav" : ".bin");
    made.set(name, { bytes: blob(hash, 400 + i * 137) });
  }
  // The one whose name never changes. Its content does, which is why the
  // device is asked for its checksum rather than for its presence.
  made.set(LAYOUT_FILE, { bytes: blob(layout, 942) });
  return made;
}

// --- A session ---------------------------------------------------------------

async function session(device, made, log) {
  const cable = new Cable(device.open(), {
    onLog: (line) => log.push(`device said: ${line}`),
    timeout: 4000,
  });
  const hello = await cable.hello();
  if (hello.version !== 2) throw new Error(`protocol ${hello.version}, not 2`);
  const have = await cable.list();

  // Only layout.bin needs asking about; every other name answers by existing.
  let layoutCrc = null;
  if (have.some((f) => f.name === LAYOUT_FILE)) layoutCrc = await cable.crc(LAYOUT_FILE);

  const theplan = plan(made, have, hello, layoutCrc);
  log.push(`plan: ${theplan.put.length} to send, ${theplan.remove.length} to remove, `
    + `${theplan.keep.length} already there, ${theplan.needed} bytes`
    + (theplan.tight ? ", not enough room to send first" : ""));
  if (!theplan.fits) throw new Error("it does not fit even after clearing out");

  const result = await push(cable, made, theplan, (what, name) =>
    log.push(`${what} ${name}`));
  await cable.close();
  return { hello, have, plan: theplan, result };
}

// --- The scenarios -----------------------------------------------------------

const SCENARIOS = {
  // Nothing on the device, everything has to go across.
  async fresh() {
    const device = new MockDevice({});
    const made = payload(1, 6);
    const run = await session(device, made, this.log);
    return { device, runs: [run], made: [made] };
  },

  // The one that matters in daily use: one symbol and one sentence changed,
  // so almost nothing should move.
  async incremental() {
    const device = new MockDevice({});
    const before = payload(1, 6);
    const first = await session(device, before, this.log);

    // Two files swapped out, one dropped, and a layout that has changed.
    const after = payload(1, 6, { layout: 99 });
    const names = [...after.keys()].filter((n) => n !== LAYOUT_FILE);
    after.delete(names[0]);                                  // a file falls away
    after.set("t" + hex8(7).repeat(4) + ".bin", { bytes: blob(7, 511) });  // a new one
    const second = await session(device, after, this.log);
    return { device, runs: [first, second], made: [before, after] };
  },

  // The same, with the device chattering into the same wire the whole time.
  async noise() {
    const device = new MockDevice({ noise: true });
    const made = payload(3, 5);
    const run = await session(device, made, this.log);
    return { device, runs: [run], made: [made] };
  },

  // A partition too small to hold the old content and the new at once, which
  // forces the order that clears out first.
  async tight() {
    const device = new MockDevice({});
    const before = payload(4, 5);
    const first = await session(device, before, this.log);

    const room = [...before.values()].reduce((n, f) => n + f.bytes.length, 0);
    device.total = Math.floor(room * 1.4);        // not room for two sets of it
    const after = payload(5, 5, { layout: 6 });
    const second = await session(device, after, this.log);
    if (!second.plan.tight) throw new Error("this was supposed to be a tight fit");
    return { device, runs: [first, second], made: [after] };
  },
};

// --- Scenarios that only test this side --------------------------------------
//
// The C reader cannot be asked about these: it has no clock, so it cannot be
// made to give up on a transfer, and it has no way to be told to fail. What
// they check is that the client notices and says something useful, which is
// worth its own run even though only half of the pair is in it.

const CLIENT_ONLY = {
  // A verb that speaks out of turn.
  //
  // cable.h answers nothing but hello until it has answered one - `open`
  // starts false in every session - and the way back in after a lost transfer
  // is the same door. This goes straight at the wire rather than through
  // Cable, because Cable always greets first and so could never ask the
  // question. Both stand-ins for the device had drifted off this rule in the
  // same direction, each modelling only the lost-transfer half, which is
  // exactly why neither caught the other.
  async ungreeted() {
    const device = new MockDevice({});
    const wire = device.open();
    const writer = wire.writable.getWriter();
    const reader = wire.readable.getReader();
    const bytes = new TextEncoder();
    const text = new TextDecoder();
    let buffer = "";

    // The device's own log shares this wire, so an answer is a "< " line and
    // everything else is stepped over - the rule the protocol states
    // everywhere.
    const answer = async () => {
      for (;;) {
        const cut = buffer.indexOf("\n");
        if (cut >= 0) {
          const line = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 1);
          if (line.startsWith("< ")) return line;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("the mock closed without answering");
        buffer += text.decode(value, { stream: true });
      }
    };

    await writer.write(bytes.encode("> list\n"));
    const refused = await answer();
    // And the refusal is not a dead end: the next hello still gets in.
    await writer.write(bytes.encode("> hello\n"));
    const admitted = await answer();
    await writer.close().catch(() => {});

    if (refused !== "< err session") {
      throw new Error(`a verb before hello was answered "${refused}"`);
    }
    if (admitted !== "< vorlaut 2") {
      throw new Error(`hello after a refusal was answered "${admitted}"`);
    }
    return { refused, admitted };
  },

  // The waiting itself, against a mock whose flash takes a moment.
  //
  // This is the scenario the protocol was changed for, and the one nothing
  // else here could ask. Everywhere else the device is a Map that answers
  // instantly, so a client that never waited for an ack would finish the file
  // before the mock had a chance to mind - which is precisely the shape of the
  // fault on real hardware, where "instantly" is a 4 ms flash write and the
  // bytes that arrive during it are gone without a word.
  //
  // So: a small window, a real pause before every ack, and a file that needs
  // several. The mock throws away anything beyond a window and gives up, the
  // way a full receive buffer does. A client that sends and hopes fails here.
  // `outran` next door is the control that says so rather than assuming it.
  async windows() {
    const device = new MockDevice({ window: 256, stallMs: 3 });
    // Not a whole multiple of the window on purpose: the last one is 130
    // bytes, and the end of the file ends the window whether it is full or not.
    // 256 rather than the mock's own default, so that a client which had kept
    // a chunk size of its own would agree with the default and fail here.
    const content = blob(15, 2178);
    const name = "t" + hex8(15).repeat(4) + ".bin";
    const cable = new Cable(device.open(), { onLog: () => {} });
    await cable.hello();

    const steps = [];
    const began = Date.now();
    const stored = await cable.put(name, content,
                                   { onProgress: (at) => steps.push(at) });
    const took = Date.now() - began;
    await cable.close();

    const wanted = Math.ceil(content.length / 256);
    if (device.overran) throw new Error(`the client outran the device: ${device.overran}`);
    if (stored.size !== content.length) {
      throw new Error(`stored ${stored.size} of ${content.length}`);
    }
    if (steps.length !== wanted) {
      throw new Error(`${content.length} bytes in ${steps.length} windows `
        + `of 256, expected ${wanted}`);
    }
    if (steps[steps.length - 1] !== content.length) {
      throw new Error(`the last window ended at ${steps[steps.length - 1]} of `
        + `${content.length}`);
    }
    // Every window was paid for. Not a measurement of anything - the mock's
    // pause is a setTimeout - but a client that did not wait could not have
    // taken this long, and a client that waited once could not either.
    if (took < wanted * 3) {
      throw new Error(`${wanted} windows at 3 ms each went by in ${took} ms, `
        + "which is not long enough to have waited for any of them");
    }
    return { windows: steps.length, of: content.length, took };
  },

  // The control under the one above: a client that sends the whole file the
  // moment it is told to go.
  //
  // Without this, `windows` proves only that the client and the mock agree,
  // and they would agree just as happily if the mock minded nothing at all.
  // This is the same wire and the same mock, driven by hand past the window,
  // and it has to fail - silently discarded bytes, then the timeout, which is
  // what the bench really did before any of this existed.
  async outran() {
    const device = new MockDevice({ window: 256, stallMs: 3 });
    const content = blob(16, 2178);
    const name = "t" + hex8(16).repeat(4) + ".bin";
    const wire = device.open();
    const writer = wire.writable.getWriter();
    const reader = wire.readable.getReader();
    const bytes = new TextEncoder();
    const text = new TextDecoder();
    let buffer = "";

    const answer = async () => {
      for (;;) {
        const cut = buffer.indexOf("\n");
        if (cut >= 0) {
          const line = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 1);
          if (line.startsWith("< ")) return line;
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("the mock closed without answering");
        buffer += text.decode(value, { stream: true });
      }
    };

    await writer.write(bytes.encode("> hello\n"));
    while (await answer() !== "< end hello") { /* the rest of the greeting */ }
    await writer.write(bytes.encode(
      `> put ${name} ${content.length} ${hex8(crc32(content))}\n`));
    const go = await answer();
    // Everything at once, which is what version 1 of this protocol did.
    await writer.write(content);
    const refused = await answer();
    await writer.close().catch(() => {});

    if (!go.startsWith("< go 256")) throw new Error(`the go was "${go}"`);
    if (refused !== `< err short ${name}`) {
      throw new Error(`sending past the window was answered "${refused}"`);
    }
    if (!device.overran) throw new Error("the mock did not notice the overrun");
    if (device.files.has(name)) throw new Error("the file was stored anyway");
    if (device.greeted) throw new Error("the session stayed open after a loss");
    return { go, refused, overran: device.overran };
  },

  // An ack that disagrees with what was sent.
  //
  // The reason the acks carry a running total rather than the size of the
  // piece: a per-piece count agrees with itself all the way down a stream that
  // has slipped, and a total does not. Nothing that is working can produce
  // this, which is exactly why it needs forcing - without this scenario the
  // client could stop comparing and every test here would still pass.
  async slipped() {
    const device = new MockDevice({ window: 256 });
    const content = blob(17, 900);
    const name = "t" + hex8(17).repeat(4) + ".bin";
    device.failAt = { name, how: "ack" };
    const cable = new Cable(device.open(), { onLog: () => {} });
    await cable.hello();
    let caught = null;
    try {
      await cable.put(name, content);
    } catch (error) {
      caught = error.message;
    }
    await cable.close();
    if (!caught) throw new Error("an ack that was one byte out went unnoticed");
    if (!/acknowledged/.test(caught)) {
      throw new Error(`it stopped, but for another reason: ${caught}`);
    }
    if (device.files.has(name)) throw new Error("and stored it anyway");
    return { caught };
  },

  // A device that stores the file and then finds the checksum wrong.
  async badcrc() {
    const device = new MockDevice({ failAt: null });
    const made = payload(8, 2);
    const name = [...made.keys()][0];
    device.failAt = { name, how: "crc" };
    const cable = new Cable(device.open(), { onLog: () => {} });
    await cable.hello();
    let caught = null;
    try {
      await cable.put(name, made.get(name).bytes);
    } catch (error) {
      caught = { word: error.word, message: error.message };
    }
    await cable.close();
    if (!caught || caught.word !== "crc") throw new Error("a bad checksum went unnoticed");
    return { caught };
  },

  // A transfer given up on. Everything afterwards is refused until hello.
  async short() {
    const device = new MockDevice({});
    const made = payload(9, 2);
    const name = [...made.keys()][0];
    device.failAt = { name, how: "short" };
    const cable = new Cable(device.open(), { onLog: () => {} });
    await cable.hello();
    let caught = null;
    try {
      await cable.put(name, made.get(name).bytes);
    } catch (error) {
      caught = { word: error.word };
    }
    let afterwards = null;
    try {
      await cable.list();
    } catch (error) {
      afterwards = error.word;
    }
    const recovered = (await cable.hello()).version;
    await cable.close();
    if (caught?.word !== "short") throw new Error("a lost transfer went unnoticed");
    if (afterwards !== "session") throw new Error("the device kept talking after a lost transfer");
    if (recovered !== 2) throw new Error("hello did not get the session back");
    return { caught, afterwards, recovered };
  },

  // A file already there under the right name but the wrong length.
  //
  // Under the device's own rules this cannot happen - it writes to /.part and
  // renames only on a matching checksum, so a name never exists until the
  // bytes under it are whole. This is the net under that: if it ever were to
  // happen, keeping the file on its name alone would mean never sending it
  // again, and layout.bin would end up pointing at something truncated.
  async truncated() {
    const made = payload(11, 3);
    const [name, file] = [...made.entries()][0];
    const have = [...made.entries()].map(([n, f]) => ({ n, f }))
      .map(({ n, f }) => ({ name: n, size: f.bytes.length }));
    const room = { total: 1441792, free: 1400000 };

    const clean = plan(made, have, room, crc32(made.get(LAYOUT_FILE).bytes));
    if (clean.put.length !== 0) {
      throw new Error(`nothing changed, yet ${clean.put.length} would be sent`);
    }

    // The same device, with one file short of what it should be.
    const short = have.map((f) =>
      f.name === name ? { name: f.name, size: f.size - 100 } : f);
    const repaired = plan(made, short, room, crc32(made.get(LAYOUT_FILE).bytes));
    const names = repaired.put.map((f) => f.name);
    if (!names.includes(name)) {
      throw new Error("a file of the wrong length was kept for its name alone");
    }
    if (repaired.keep.includes(name)) throw new Error("kept and sent at once");
    return { kept: clean.keep.length, resent: names, bytes: file.bytes.length };
  },

  // Stopping partway. Nothing after the abort, and above all no "done" - that
  // is what makes the device read its new layout in.
  async cancel() {
    const device = new MockDevice({});
    const made = payload(12, 6);
    const cable = new Cable(device.open(), { onLog: () => {} });
    const hello = await cable.hello();
    const work = plan(made, await cable.list(), hello, null);

    const stop = new AbortController();
    let stopped = null;
    try {
      await push(cable, made, work, {
        signal: stop.signal,
        onStep: (_what, _name, index) => { if (index === 2) stop.abort(); },
      });
    } catch (error) {
      stopped = error.name;
    }
    const sent = new TextDecoder().decode(device.transcript());
    await cable.close();

    if (stopped !== "AbortError") throw new Error(`stopped with ${stopped}`);
    if (sent.includes("> done")) throw new Error("done was sent after an abort");
    // The device is still usable: an abort between files leaves nothing in
    // flight, which is the whole reason it is checked there.
    if (!device.greeted) throw new Error("aborting left the session shut");
    return { stopped, stored: device.stored, of: work.put.length };
  },

  // Aborting on the last step. The check inside the loop cannot catch this
  // one - there is no next turn of the loop - so it is the only case that
  // proves the guard in front of "done" is load-bearing.
  async cancelLast() {
    const device = new MockDevice({});
    const made = payload(13, 4);
    const cable = new Cable(device.open(), { onLog: () => {} });
    const hello = await cable.hello();
    const work = plan(made, await cable.list(), hello, null);

    const stop = new AbortController();
    let stopped = null;
    try {
      await push(cable, made, work, {
        signal: stop.signal,
        onStep: (_w, _n, index, total) => { if (index === total - 1) stop.abort(); },
      });
    } catch (error) {
      stopped = error.name;
    }
    const sent = new TextDecoder().decode(device.transcript());
    await cable.close();
    if (stopped !== "AbortError") throw new Error(`stopped with ${stopped}`);
    if (sent.includes("> done")) {
      throw new Error("done was sent after aborting on the last step");
    }
    return { stopped, stored: device.stored };
  },

  // The device reports gap and stall before every ok, and the client has to
  // step over them AND record them. A client that stopped skipping unknown
  // keywords would read "gap" where it expects "ok".
  async timings() {
    const device = new MockDevice({});
    const made = payload(14, 3);
    const cable = new Cable(device.open(), { onLog: () => {} });
    const hello = await cable.hello();
    const work = plan(made, await cable.list(), hello, null);
    const result = await push(cable, made, work);
    const seen = { gap: cable.worstGap, stall: cable.worstStall };
    await cable.close();
    if (result.stored !== work.put.length) {
      throw new Error(`stored ${result.stored} of ${work.put.length}`);
    }
    if (!(seen.gap > 0) || !(seen.stall > 0)) {
      throw new Error(`the timings did not arrive: ${JSON.stringify(seen)}`);
    }
    return seen;
  },

  // Room the device has not got. Refused before "go", so nothing is sent.
  async nospace() {
    const device = new MockDevice({ total: 300 });   // smaller than the first file
    const made = payload(10, 2);
    const name = [...made.keys()][0];
    const cable = new Cable(device.open(), { onLog: () => {} });
    await cable.hello();
    let caught = null;
    try {
      await cable.put(name, made.get(name).bytes);
    } catch (error) {
      caught = { word: error.word };
    }
    // Nothing after the refusal: the bytes never went out.
    const sent = new TextDecoder().decode(device.transcript());
    await cable.close();
    if (caught?.word !== "nospace") throw new Error("a full device went unnoticed");
    if (!sent.trimEnd().endsWith(`put ${name} ${made.get(name).bytes.length} `
        + hex8(crc32(made.get(name).bytes)))) {
      throw new Error("something was sent after the refusal");
    }
    return { caught, sentBytes: device.transcript().length };
  },
};

// --- Reading what the C formatters wrote --------------------------------------
//
// Fed the output of "cable_dump say" on stdin: the exact lines the firmware
// composes, out of the code that composes them. Serving them back to the real
// client closes the other half of the loop - the transcript check proves the
// device understands the browser, and this proves the browser understands the
// device.

async function readback(text) {
  const lines = text.split("\n").filter((l) => l.length);
  const groups = {
    hello: lines.filter(
      (l) => /^< (vorlaut|firmware|total|free|files|tiles|end hello)/.test(l)),
    list: lines.filter((l) => /^< (file|end list)/.test(l)),
    crc: [lines.find((l) => l.startsWith("< crc layout.bin 1a2b3c4d"))],
    big: [lines.find((l) => l.startsWith("< crc layout.bin deadbeef"))],
    padded: [lines.find((l) => l.startsWith("< crc layout.bin 0000beef"))],
  };

  const encoder = new TextEncoder();
  const toDevice = new TransformStream();
  const fromDevice = new TransformStream();
  const out = fromDevice.writable.getWriter();
  const cable = new Cable(
    { readable: fromDevice.readable, writable: toDevice.writable },
    { onLog: () => {} });

  // Answers each command with the lines the C harness printed for it.
  (async () => {
    const reader = toDevice.readable.getReader();
    let rest = "";
    let asked = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
      let cut;
      while ((cut = rest.indexOf("\n")) >= 0) {
        const line = rest.slice(0, cut);
        rest = rest.slice(cut + 1);
        const verb = line.slice(2).split(" ")[0];
        const which = verb === "crc" ? ["crc", "big", "padded"][asked++] : verb;
        for (const answer of groups[which] || []) {
          await out.write(encoder.encode(answer + "\n"));
        }
      }
    }
  })();

  const seen = {
    hello: await cable.hello(),
    list: await cable.list(),
    crc: hex8(await cable.crc(LAYOUT_FILE)),
    big: hex8(await cable.crc(LAYOUT_FILE)),
    padded: hex8(await cable.crc(LAYOUT_FILE)),
  };
  await cable.close();
  return seen;
}

// --- main --------------------------------------------------------------------

const which = process.argv[2];
const log = [];
const report = { scenario: which, log };

try {
  if (SCENARIOS[which]) {
    const context = { log };
    const { device: mock, runs, made } = await SCENARIOS[which].call(context);
    const device = runs[runs.length - 1];
    report.comparable = true;
    report.result = device.result;
    report.plan = {
      put: device.plan.put.map((f) => f.name),
      remove: device.plan.remove,
      keep: device.plan.keep,
      tight: device.plan.tight,
      needed: device.plan.needed,
    };
    // What the client believes the device is now holding. The C reader is
    // asked the same question about the same bytes.
    const wanted = made[made.length - 1];
    report.holds = [...wanted.entries()]
      .map(([name, file]) => ({ name, size: file.bytes.length, crc: hex8(crc32(file.bytes)) }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    report.transcript = Buffer.from(mock.transcript()).toString("base64");
  } else if (which === "readback") {
    report.comparable = false;
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    report.detail = await readback(Buffer.concat(chunks).toString("utf8"));
  } else if (CLIENT_ONLY[which]) {
    report.comparable = false;
    report.detail = await CLIENT_ONLY[which]();
  } else {
    throw new Error(`no scenario called "${which}". There is: `
      + [...Object.keys(SCENARIOS), ...Object.keys(CLIENT_ONLY), "readback"].join(", "));
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.message;
  report.stack = error.stack;
}

process.stdout.write(JSON.stringify(report));
