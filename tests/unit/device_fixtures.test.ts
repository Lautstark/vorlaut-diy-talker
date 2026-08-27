import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./harness.js";

import {
  renderLayoutBin, hashBytes, LANGUAGE_CODES, DEFAULT_LANGUAGE,
  LAYOUT_VERSION, HEADER_BYTES, SET_BYTES, SLOT_BYTES, SLOTS_PER_SET,
  NAME_BYTES, HASH_BYTES,
} from "../../src/data/layout_format.js";
import { TILE_SIZE, rgbTo565, toRgb565Be } from "../../src/data/tiles.js";
import {
  DEVICE_SAMPLE_RATE, DEVICE_CHANNELS, DEVICE_BITS_PER_SAMPLE,
} from "../../src/data/audio_format.js";
import { Cable, CABLE_VERSION, crc32, hex8 } from "../../tools/cable.js";

/* The builder's half of device/fixtures/.
 *
 * The same index the firmware's host runner reads from the other side. Each
 * end meets the fixture and never the other end, which is the trade
 * docs/device-interface.md section 5 describes: the live check where node's
 * bytes go straight into the compiled C reader still exists next door in
 * tests/test_cable_format.py and tests/test_layout_frozen.py, and this is the
 * third artefact both are held against rather than a replacement for either.
 *
 * What is asked of this side, fixture by fixture:
 *
 *   layout   for every fixture with a `write` half, renderLayoutBin() must
 *            produce exactly the bytes in the .bin. The refusals have no
 *            write half and are the firmware runner's business alone.
 *   tile     the geometry, and the colour truncation that decides what a
 *            pixel becomes.
 *   audio    the three numbers a writer is bound by. The reader's tolerance
 *            is the firmware runner's half.
 *   names    the hash a name carries, read back out of the name.
 *   language the table, and what a writer does with a language not in it.
 *   cable    the client, driven through the transcript from the browser end:
 *            given these device lines it must write exactly these host lines.
 *
 * Nothing here reads the C. Nothing there reads this.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "..", "device", "fixtures");

const read = (name: string) => readFileSync(join(FIXTURES, name));
const readJson = (name: string) => JSON.parse(read(name).toString("utf8"));

const index = readJson("index.json");
const listed: any[] = index.fixtures;

check("the fixture index is there and lists something",
      Array.isArray(listed) && listed.length > 0,
      `${listed?.length} fixtures, device interface ${index.device_interface_version}`);

const expectations = new Map<string, any>(
  listed.map((one) => [one.fixture, readJson(one.expected)]));

/** Which fixtures of one kind, in the index's order. */
const ofKind = (kind: string) =>
  listed.filter((one) => one.kind === kind)
        .map((one) => ({ listed: one, want: expectations.get(one.fixture) }));

const hex = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString("hex");

// --- layout.bin --------------------------------------------------------------

/* The strides first, because everything below is a consequence of them and a
 * fixture that failed for a stride would otherwise fail 30 times over. */
check("the browser's strides are the ones the fixtures were laid out from",
      HEADER_BYTES === 12 && SET_BYTES === 184 && SLOT_BYTES === 34
      && SLOTS_PER_SET === 4 && NAME_BYTES === 32 && HASH_BYTES === 16
      && LAYOUT_VERSION === 2,
      `header ${HEADER_BYTES}, set ${SET_BYTES}, slot ${SLOT_BYTES}, `
      + `version ${LAYOUT_VERSION}`);

let written = 0;
for (const { listed: one, want } of ofKind("layout")) {
  const bytes = read(one.file);

  check(`${one.fixture}: the fixture is the length it says it is`,
        bytes.length === want.bytes, `${bytes.length} bytes`);

  if (!want.write) {
    /* No writer produces this file, which is the whole point of the ones that
     * have no write half: a refusal, a reserved byte set, a language index no
     * builder can reach. A capture of a correct writer can hold none of them. */
    continue;
  }

  const w = want.write;
  let made: Uint8Array | string;
  try {
    made = renderLayoutBin(w.layout, w.label, w.images, w.sounds);
  } catch (error) {
    made = `refused: ${(error as Error).message}`;
  }
  const got = typeof made === "string" ? made : hex(made);
  check(`${one.fixture}: the browser writes the fixture's ${want.bytes} bytes`,
        got === hex(bytes),
        got === hex(bytes) ? "" : firstDifference(bytes, made));
  written++;
}
check("every layout fixture that a builder can produce was written by one",
      written > 0, `${written} of ${ofKind("layout").length}`);

function firstDifference(want: Buffer, got: Uint8Array | string): string {
  if (typeof got === "string") return got;
  if (got.length !== want.length) {
    return `${got.length} bytes instead of ${want.length}`;
  }
  for (let i = 0; i < want.length; i++) {
    if (want[i] !== got[i]) {
      return `first difference at byte ${i}: fixture ${want[i]
        .toString(16).padStart(2, "0")}, browser ${got[i]
        .toString(16).padStart(2, "0")}`;
    }
  }
  return "no difference found, which should not be reachable";
}

// --- t<hash>.bin -------------------------------------------------------------

for (const { listed: one, want } of ofKind("tile")) {
  const bytes = read(one.file);
  const g = want.geometry;

  check(`${one.fixture}: the browser's tile is ${g.width} square`,
        TILE_SIZE === g.width && TILE_SIZE === g.height, `TILE_SIZE ${TILE_SIZE}`);
  check(`${one.fixture}: which is ${g.conforming_bytes} bytes`,
        TILE_SIZE * TILE_SIZE * g.bytes_per_pixel === g.conforming_bytes,
        `${TILE_SIZE * TILE_SIZE * g.bytes_per_pixel}`);

  if (want.conforming) {
    check(`${one.fixture}: and the fixture is exactly that long`,
          bytes.length === g.conforming_bytes, `${bytes.length} bytes`);
  } else {
    check(`${one.fixture}: a writer must never emit this length`,
          bytes.length !== g.conforming_bytes, `${bytes.length} bytes`);
  }

  for (const probe of want.read?.probes ?? []) {
    const at = (probe.y * g.width + probe.x) * g.bytes_per_pixel;
    check(`${one.fixture}: pixel (${probe.x}, ${probe.y}) is at byte ${probe.byte}`,
          at === probe.byte, `${at}`);
  }

  for (const { rgb, value } of want.write?.rgb565_of ?? []) {
    const got = (rgbTo565(rgb[0], rgb[1], rgb[2]) & 0xffff)
      .toString(16).padStart(4, "0");
    check(`${one.fixture}: rgb(${rgb.join(", ")}) becomes ${value}`,
          got === value, got);
  }
}

/* The byte order, asked of the function that decides it rather than inferred
 * from a file. Two pixels, so a swap inside one of them and a swap between
 * them are different failures. */
{
  const pixels = {
    width: 2, height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
  };
  const got = hex(toRgb565Be(pixels));
  check("the browser writes RGB565 big-endian, high byte first",
        got === "f800001f", got);
}

// --- a<hash>.wav -------------------------------------------------------------

for (const { listed: one, want } of ofKind("audio")) {
  const bytes = read(one.file);
  check(`${one.fixture}: the fixture is the length it says it is`,
        bytes.length === want.bytes, `${bytes.length} bytes`);

  if (!want.write) continue;
  const w = want.write;
  check(`${one.fixture}: the browser writes ${w.sample_rate} Hz, `
        + `${w.channels} channel, ${w.bits_per_sample}-bit`,
        DEVICE_SAMPLE_RATE === w.sample_rate
        && DEVICE_CHANNELS === w.channels
        && DEVICE_BITS_PER_SAMPLE === w.bits_per_sample,
        `${DEVICE_SAMPLE_RATE} Hz, ${DEVICE_CHANNELS} channel, `
        + `${DEVICE_BITS_PER_SAMPLE}-bit`);
}

// --- the name rule -----------------------------------------------------------

{
  const want = expectations.get("names");
  check("the browser carries the fixture's hash width",
        HASH_BYTES === want.hash_bytes, `${HASH_BYTES} bytes`);

  for (const one of want.cases) {
    if (one.hash) {
      const got = hex(hashBytes(one.name));
      check(`a name for ${one.what}: the browser reads ${one.hash} out of it`,
            got === one.hash, got);
    }
    if (one.hash_read_refused) {
      let refused = false;
      try { hashBytes(one.name); } catch { refused = true; }
      check(`${one.what}: the browser refuses to read a hash out of it`,
            refused);
    }
    /* Only one direction can be asked here. Whether the device would store a
     * name is cableNameOk()'s answer and the host runner's half; what this
     * side owns is that the names it emits carry the hash layout.bin holds. */
  }

  /* The superset itself, as far as this end can see it: every name a builder
   * may emit has a hash the builder can read back, or is the one name that
   * is not a hash at all. */
  const emitted = want.cases.filter((one: any) => one.emitted);
  const sound = emitted.every((one: any) =>
    one.hash === null || hex(hashBytes(one.name)) === one.hash);
  check("every name a builder may emit reads back the hash it carries",
        sound, `${emitted.length} names`);
}

// --- the language enumeration ------------------------------------------------

{
  const want = expectations.get("language");
  const table = Object.fromEntries(
    want.languages.map((l: any) => [l.code, l.index]));

  check("the browser's language table is the fixture's",
        JSON.stringify(LANGUAGE_CODES) === JSON.stringify(table),
        JSON.stringify(LANGUAGE_CODES));
  check("and its default is the fixture's default",
        DEFAULT_LANGUAGE === want.default_code
        && LANGUAGE_CODES[DEFAULT_LANGUAGE] === want.default_index,
        `${DEFAULT_LANGUAGE} is ${LANGUAGE_CODES[DEFAULT_LANGUAGE]}`);

  /* A language the writer has no index for. The rule is that it writes the
   * default rather than refusing, so the file is readable and merely
   * labelled in English - and byte 7 is where the answer lands. */
  const bytes = renderLayoutBin(
    { language: "kw", sleep_timeout_seconds: 0, sets: [] }, [], [], []);
  check("a language the browser has no index for is written as the default",
        bytes[7] === want.default_index, `byte 7 is ${bytes[7]}`);

  for (const l of want.languages) {
    const made = renderLayoutBin(
      { language: l.code, sleep_timeout_seconds: 0, sets: [] }, [], [], []);
    check(`${l.code} is written into byte 7 as ${l.index}`,
          made[7] === l.index, `${made[7]}`);
  }
}

// --- the cable ---------------------------------------------------------------

/**
 * A device made of the transcript.
 *
 * It answers with the fixture's device lines and holds the client to the
 * fixture's host lines, which is the browser end of "both sides run the same
 * file from opposite ends". It is not a model of a device and must not become
 * one: tools/cable_mock.js is that, and a second one would drift.
 */
function scriptedDevice(steps: any[]) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const toDevice = new TransformStream<Uint8Array, Uint8Array>();
  const fromDevice = new TransformStream<Uint8Array, Uint8Array>();
  const out = fromDevice.writable.getWriter();
  const incoming = toDevice.readable.getReader();

  const problems: string[] = [];
  let held = new Uint8Array(0);
  let done = false;

  async function more(): Promise<boolean> {
    if (done) return false;
    const { value, done: ended } = await incoming.read();
    if (ended) { done = true; return false; }
    const grown = new Uint8Array(held.length + value.length);
    grown.set(held);
    grown.set(value, held.length);
    held = grown;
    return true;
  }

  /** One line, without its newline. The bytes of a file are read by count
   *  and never by this, which is the same rule the device follows. */
  async function line(): Promise<string | null> {
    for (;;) {
      const cut = held.indexOf(10);
      if (cut >= 0) {
        const text = decoder.decode(held.subarray(0, cut)).replace(/\r$/, "");
        held = held.subarray(cut + 1);
        return text;
      }
      if (!await more()) return null;
    }
  }

  async function exactly(count: number): Promise<Uint8Array | null> {
    while (held.length < count) if (!await more()) return null;
    const taken = held.subarray(0, count);
    held = held.subarray(count);
    return taken;
  }

  const walk = (async () => {
    for (const step of steps) {
      if (step.from === "device") {
        /* Nothing of the host's may be waiting to be read at the moment the
         * device speaks. Every device line in every transcript is one the host
         * is waiting for, so a client that is behaving has written nothing
         * since the last thing this consumed.
         *
         * That is the only way a transcript can express the acknowledged
         * transfer at all. The bytes of a file are the same bytes whether they
         * were sent a window at a time or all at once, so comparing them says
         * nothing about the waiting - and the waiting is the whole change. What
         * distinguishes the two is that one of them has run ahead, and running
         * ahead is visible right here.
         *
         * One-directional, and deliberately: bytes present prove the client ran
         * ahead, and bytes absent prove nothing, since a write that has not
         * arrived yet looks the same. It catches the fault without ever
         * claiming the absence is a pass. */
        if (held.length > 0) {
          problems.push(`the client had already written ${held.length} byte(s) `
                        + `when the device said "${step.line}" - it is not `
                        + "waiting to be answered");
        }
        await out.write(encoder.encode(`${step.line}\n`));
        continue;
      }
      if (step.raw !== undefined) {
        const wanted = Buffer.from(step.raw, "base64");
        const got = await exactly(wanted.length);
        if (!got) {
          problems.push(`the client stopped before sending ${wanted.length} `
                        + "bytes of file content");
          return;
        }
        if (Buffer.compare(Buffer.from(got), wanted) !== 0) {
          problems.push("the client sent different bytes than the fixture's "
                        + `${wanted.length}`);
        }
        continue;
      }
      const said = await line();
      if (said === null) {
        problems.push(`the client stopped before writing "${step.line}"`);
        return;
      }
      if (said !== step.line) {
        problems.push(`the client wrote "${said}", the fixture says `
                      + `"${step.line}"`);
      }
    }
  })();

  return {
    port: { readable: fromDevice.readable, writable: toDevice.writable },
    problems,
    async settle() {
      let finished = false;
      await Promise.race([
        walk.then(() => { finished = true; }),
        new Promise((r) => setTimeout(r, 500)),
      ]);
      if (!finished) {
        problems.push("the transcript was not walked to its end - the client "
                      + "stopped saying things before the fixture ran out");
      }
      return problems;
    },
  };
}

for (const { listed: one, want } of ofKind("cable")) {
  if (!want.ends.includes("browser")) {
    /* The other end's half. A browser client never writes a verb the firmware
     * does not have, so a fixture about an unknown verb can only be asked of
     * the device - which is one direction of the cable's extension rule, and
     * the reason `ends` exists at all. */
    continue;
  }

  const device = scriptedDevice(want.steps);
  const cable = new Cable(device.port, { onLog: () => {} });
  let failure: string | null = null;
  const seen: any[] = [];

  try {
    for (const step of want.client_script) {
      switch (step.call) {
        case "hello": seen.push(await cable.hello()); break;
        case "list": seen.push(await cable.list()); break;
        case "crc": seen.push(hex8(await cable.crc(step.name))); break;
        case "rm": seen.push(await cable.rm(step.name)); break;
        case "done": seen.push(await cable.done()); break;
        case "put":
          seen.push(await cable.put(
            step.name, new Uint8Array(Buffer.from(step.content, "base64"))));
          break;
        default:
          failure = `the fixture asks for a call this runner has no name for: `
            + `${step.call}`;
      }
    }
  } catch (error) {
    failure = `the client fell over: ${(error as Error).message}`;
  }

  const problems = await device.settle();
  await cable.close().catch(() => {});

  check(`${one.fixture}: the browser client writes the fixture's host lines`,
        failure === null && problems.length === 0,
        failure ?? problems.join("; "));

  if (failure === null) {
    const wanted = want.client_script.map((s: any) => s.returns);
    check(`${one.fixture}: and makes the fixture's answers of what it reads`,
          JSON.stringify(seen) === JSON.stringify(wanted),
          JSON.stringify(seen));
  }
}

check("the browser client speaks the fixtures' protocol version",
      CABLE_VERSION === expectations.get("greet-and-list").protocol_version,
      `${CABLE_VERSION}`);

/* The transcripts' checksums came from node's zlib and the client computes
 * its own from a table it builds at load. Two implementations of CRC-32 that
 * agree on every payload in the fixture set, which is what lets a device say
 * "err crc" and a browser believe it. */
{
  const transcript = expectations.get("put-one-file");
  const payload = transcript.steps.find((s: any) => s.raw !== undefined);
  const said = transcript.steps.find(
    (s: any) => s.from === "host" && s.line?.startsWith("> put"));
  const stated = said.line.split(" ").pop();
  const computed = hex8(crc32(new Uint8Array(
    Buffer.from(payload.raw, "base64"))));
  check("the client checksums the fixture's file to the value it carries",
        computed === stated, `${computed} against ${stated}`);
}
