// Drives tools/cable.js against tools/cable_mock.js and reports what happened.
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

import { Cable, plan, push, crc32, hex8, LAYOUT_FILE } from "../tools/cable.js";
import { MockDevice } from "../tools/cable_mock.js";

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
  if (hello.version !== 1) throw new Error(`protocol ${hello.version}, not 1`);
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
    if (recovered !== 1) throw new Error("hello did not get the session back");
    return { caught, afterwards, recovered };
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
    hello: lines.filter((l) => /^< (vorlaut|total|free|files|end hello)/.test(l)),
    list: lines.filter((l) => /^< (file|end list)/.test(l)),
    crc: [lines.find((l) => l.startsWith("< crc layout.bin 1a2b3c4d"))],
    big: [lines.find((l) => l.startsWith("< crc layout.bin deadbeef"))],
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
        const which = verb === "crc" ? (asked++ ? "big" : "crc") : verb;
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
