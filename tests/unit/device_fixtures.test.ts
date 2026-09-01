import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./harness.js";

import {
  renderLayoutBin, hashBytes, LANGUAGE_CODES, DEFAULT_LANGUAGE,
  LAYOUT_VERSION, HEADER_BYTES, SET_BYTES, KEY_BYTES, KEYS_PER_SET,
  SLOTS_PER_SET, NAME_BYTES, HASH_BYTES, MAX_SETS, KEY_DOES,
  SLEEP_MIN, SLEEP_MAX, SLEEP_DEFAULT, layoutIdleSeconds,
  layoutKeyGoesTo, layoutKeySpeaks, isCollectionFile, readLayoutBin,
} from "../../loader/src/layout_format.js";
import { TILE_SIZE, rgbTo565, toRgb565Be } from "../../loader/src/tiles.js";
import { decodeTile } from "../../loader/src/tile_encode.js";
import {
  DEVICE_SAMPLE_RATE, DEVICE_CHANNELS, DEVICE_BITS_PER_SAMPLE,
} from "../../loader/src/audio_format.js";
import {
  Cable, CABLE_VERSION, crc32, hex8, isCollection, versionVerdict,
} from "../../loader/tools/cable.js";

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
 *   sleep    the range, and that every wait layoutIdleSeconds() settles on is
 *            inside it and settled. What the editor's normalizer emitted was
 *            asked here until the split took that function to vorlaut-editor.
 *   press    nothing, and it says so. The hold times, the pause after a word
 *            and the deafness after a board change are the device's alone -
 *            no byte of them crosses, so there is nothing on this side to
 *            hold to them. A kind that is skipped out loud is visible; one
 *            that is unlisted has been forgotten.
 *   collections
 *            one thing, and the rest of it is said to be the device's. Which
 *            names are collections crosses, because a name this side says yes
 *            to and the device says no to is a file the page offers to remove
 *            and the talker never lists - and the other way round is the page
 *            sweeping up the file the talker is reading. The wrapping, the
 *            order and the fallback are the device's alone.
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
      HEADER_BYTES === 12 && SET_BYTES === 212 && KEY_BYTES === 36
      && KEYS_PER_SET === 5 && SLOTS_PER_SET === 4 && NAME_BYTES === 32
      && HASH_BYTES === 16 && LAYOUT_VERSION === 3,
      `header ${HEADER_BYTES}, set ${SET_BYTES}, key ${KEY_BYTES}, `
      + `version ${LAYOUT_VERSION}`);

/* The three words a key can be given, against the three numbers the fixtures
 * were laid out from. Written out rather than compared as a table, because a
 * table compared against itself is the shape this whole directory exists to
 * avoid - and because the numbers are what cross the boundary, while the words
 * are only this side's spelling of them. */
check("the browser's three answers for what a key does are 0, 1 and 2",
      KEY_DOES.speak === 0 && KEY_DOES["speak-and-go"] === 1
      && KEY_DOES.go === 2,
      JSON.stringify(KEY_DOES));

/* How many sets the device has room for, read out of the fixtures rather than
 * written here beside the constant it is checking.
 *
 * MAX_SETS is not a limit renderLayoutBin() enforces - it writes as many sets
 * as fit in a byte - so nothing on the writing side would notice the number
 * moving. It matters because loader/src/validate.ts refuses a package with a
 * sixth set before anything is sent, and a wrong number there is a talker that
 * takes a file and then shows nothing: readLayout() answers LAYOUT_BAD_LENGTH
 * and there is no screen anywhere saying why.
 *
 * So the fixtures are asked. The most sets any accepted layout is read with is
 * the room there is, and the file with one more than that is the refusal -
 * which is the same pair of facts device/fixtures/layout/five-sets and
 * sets-past-max were written to state. */
{
  const accepted = ofKind("layout")
    .map(({ want }) => want.read)
    .filter((read) => read?.result === "ok" && typeof read.sets === "number")
    .map((read) => read.sets as number);
  const most = Math.max(...accepted);
  check("the browser's MAX_SETS is the most sets a fixture is accepted with",
        MAX_SETS === most, `${MAX_SETS} against the fixtures' ${most}`);

  const past = expectations.get("sets-past-max");
  check("and a file with one more set than that is the one the device refuses",
        past.read.result === "LAYOUT_BAD_LENGTH"
        && past.bytes === HEADER_BYTES + (MAX_SETS + 1) * SET_BYTES,
        `${past.bytes} bytes, ${past.read.result}`);
}

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
    made = renderLayoutBin(w.layout, w.label, w.images, w.sounds,
                           w.label_sounds);
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

// --- a layout, pressed -------------------------------------------------------

/* The walks, from the browser's end.
 *
 * Nothing here plays a device and there is no model of one: what the browser
 * has is the two functions that say what a key MEANS - layoutKeySpeaks() and
 * layoutKeyGoesTo(), which are its copies of the rules the same-named
 * functions in firmware/vorlaut/layout_format.h state - and the name rule that
 * turns sixteen bytes into a file to play. A walk is those three applied to
 * the fields the fixture already carries, press by press, with the current set
 * carried along.
 *
 * That is the whole of what this side can be held to, and it is not nothing:
 * the firmware runner walks the same presses through keyPress() out of
 * key_press.h and never reads this, so a rule the two copies disagree about is
 * a fixture that fails on one side and passes on the other. What no browser
 * can be asked is when any of it happens - see press.expected.json, which is
 * the device's alone.
 */
{
  let pressed = 0;
  const moved: number[] = [];
  const stayed: number[] = [];

  for (const { listed: one, want } of ofKind("layout")) {
    if (!want.walk) continue;
    const entries = want.read.entries;
    const sets = want.read.sets;
    const problems: string[] = [];
    let at = want.walk.starts_at;

    for (const press of want.walk.presses) {
      const where = `press ${press.press} (key ${press.key})`;
      if (press.on_set !== at) {
        problems.push(`${where} is made on set ${press.on_set}, and the press `
                      + `before it left the device on set ${at}`);
        at = press.on_set;
      }
      const entry = entries[at];
      const key = press.key === SLOTS_PER_SET ? entry.key
                                              : entry.slots[press.key];

      const goes = layoutKeyGoesTo(key.does, key.target, sets);
      if (goes !== press.goes_to) {
        problems.push(`${where} goes to ${press.goes_to} in the fixture and `
                      + `to ${goes} by this side's rule`);
      }
      /* Whether a word comes out, which is two fields and one answer: what
         `does` says, and whether the key carries a recording at all. */
      const speaks = layoutKeySpeaks(key.does) && key.has_audio;
      if (speaks !== (press.plays !== null)) {
        problems.push(`${where} ${press.plays ? "plays" : "plays nothing"} in `
                      + `the fixture, and this side makes it ${speaks
                        ? "speak" : "silent"}`);
      }
      /* And that it is the pressed key's own recording. Read back out of the
         name with hashBytes() rather than spelled out here: the spelling is
         names.expected.json's rule and restating it would be a second
         opinion about it. */
      if (press.plays !== null && hex(hashBytes(press.plays)) !== key.audio) {
        problems.push(`${where} plays ${press.plays}, which is not the `
                      + `sixteen bytes the key carries`);
      }

      at = goes >= 0 ? goes : at;
      if (at !== press.now_on_set) {
        problems.push(`${where} leaves the fixture on set ${press.now_on_set} `
                      + `and this side on set ${at}`);
      }
      at = press.now_on_set;
      (press.goes_to >= 0 ? moved : stayed).push(press.goes_to);
      pressed++;
    }

    check(`${one.fixture}: the browser's two rules walk the fixture's `
          + `${want.walk.presses.length} presses the same way`,
          problems.length === 0, problems.slice(0, 3).join("; "));
  }

  check("every layout fixture with a walk was walked", pressed > 0,
        `${pressed} press(es)`);
  /* And that the walks are worth walking. A set of them where nothing ever
     moved would be satisfied by an end that ignores `target` altogether, and
     one where everything moved by an end that moves on any press at all. Said
     here rather than left to whoever writes the next walk - the same argument
     the cable transcripts make about a verdict that is not constant. */
  check("and the walks contain presses that move and presses that do not",
        moved.length > 0 && stayed.length > 0,
        `${moved.length} moved, ${stayed.length} stayed`);
}

// --- what a press does -------------------------------------------------------

/* The one kind with nothing on this side, acknowledged rather than omitted.
 *
 * The same shape tests/test_device_host.py has for the package kind, and for
 * the same reason: a runner can only say what it does not check once it has
 * been taught which kinds it does. Everything in press.expected.json is a
 * length of time or an order of events inside the firmware; no byte of it
 * crosses to a browser, and a check here would be this file inventing an
 * opinion it has no way to hold. */
{
  const press = ofKind("press");
  check("the press rule is listed, and is the device's own half",
        press.length === 1
        && press[0]!.want.after_a_key_that_goes?.order?.length > 0,
        press.length === 1
          ? `${press[0]!.want.holds.length} hold time(s), `
            + `${press[0]!.want.after_a_key_that_goes.order.join(" then ")}`
          : `${press.length} press fixture(s)`);
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

  if (want.form === "vt1") {
    /* The rule that keeps the two forms apart, from this side. A compressed
     * file of exactly the raw length would be read as a raw one by every
     * device there is, so it is the one length this form may never have -
     * and being smaller than raw is the only reason to send it at all. */
    check(`${one.fixture}: is shorter than the ${g.conforming_bytes} raw bytes`,
          bytes.length < g.conforming_bytes, `${bytes.length} bytes`);
  } else if (want.conforming) {
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

  /* The compressed form, read by the browser's own decoder.
   *
   * The firmware's half of these same fixtures is tests/test_device_host.py,
   * and the two are asked the same questions on purpose: which form the file
   * is in, whether it is readable at all, and what stands at the pixels the
   * fixture names. A decoder that disagrees with the other one about any of
   * those puts a wrong picture on a talker with nothing red anywhere. */
  const decoded = decodeTile(bytes);
  if (want.form) {
    check(`${one.fixture}: the browser reads it as the ${want.form} form`,
          want.form === "raw"
            ? bytes.length === g.conforming_bytes
            : bytes.length !== g.conforming_bytes,
          `${bytes.length} bytes`);
  }
  if (want.read?.accepts === false) {
    check(`${one.fixture}: and refuses it`, decoded === null,
          decoded === null ? "" : "it was read");
  } else if (want.form === "vt1") {
    check(`${one.fixture}: and takes it`, decoded !== null,
          decoded === null ? "refused" : "");
    for (const probe of want.read?.probes ?? []) {
      const at = probe.byte;
      const got = decoded
        ? `${decoded[at]!.toString(16).padStart(2, "0")}` +
          `${decoded[at + 1]!.toString(16).padStart(2, "0")}`
        : "-";
      check(`${one.fixture}: (${probe.x}, ${probe.y}) decodes to ${probe.value}`,
            got === probe.value, got);
    }
  }
  if (want.palette) {
    check(`${one.fixture}: the palette holds ${want.palette.colours}`,
          bytes[3]! + 1 === want.palette.colours, `${bytes[3]! + 1}`);
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

// --- the sleep timeout -------------------------------------------------------

{
  const want = expectations.get("sleep");

  check("the browser's sleep range is the fixture's",
        SLEEP_MIN === want.min && SLEEP_MAX === want.max
        && SLEEP_DEFAULT === want.default,
        `[${SLEEP_MIN}, ${SLEEP_MAX}], default ${SLEEP_DEFAULT}`);

  /* The same clamp the firmware runner asks of layoutIdleSeconds() in
   * layout_format.h. Two implementations of one rule, each held to the fixture
   * and never to the other - a device and a browser that disagree about what
   * an unset field means is a talker that sleeps at a time nobody chose. */
  for (const one of want.cases) {
    const got = layoutIdleSeconds(one.sleep_seconds);
    check(`a timeout of ${one.sleep_seconds} - ${one.what} - `
          + `is a wait of ${one.idle_seconds}`,
          got === one.idle_seconds, `${got}`);
  }

  /* The writer does NOT clamp, and that is a rule rather than an oversight.
   * renderLayoutBin() puts in the field what it is handed, because
   * tests/reference/layout.lock.json froze its bytes for a timeout of 0 and
   * one of 0xffffffff and that lock cannot be rewritten. The gate is one layer
   * up, and after the split it is a different thing on each side: the editor's
   * normalizeLayout() over there, and loader/src/validate.ts here - which does
   * not clamp either, it says what the device will do instead. */
  for (const value of [0, 5, want.max + 1, 4294967295]) {
    const bytes = renderLayoutBin(
      { language: "en", sleep_timeout_seconds: value, sets: [] }, [], [], []);
    const wrote = new DataView(
      bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
    check(`the browser writes a timeout of ${value} into the field unchanged`,
          wrote === value, `${wrote}`);
  }

  /* And the superset, on the arrivals no fixture lists.
   *
   * This asked normalizeLayout() the same question until the split: everything
   * the editor's gate lets through is a timeout the device waits for exactly.
   * That function is vorlaut-editor's now, and the claim went with it - a
   * repository cannot hold a writer it does not have to anything. What is left
   * here is the half that is this side's, and it is the half the device
   * depends on: whatever value arrives, from any writer anywhere, the wait
   * layoutIdleSeconds() decides on is inside the range and is a value it would
   * not move again. A rule that is not idempotent is one where a document
   * round-tripped through any tool comes back asleep at a different time.
   *
   * What this no longer covers: a writer that emits a timeout the device
   * silently changes. Only a writer can be held to that, and there is none in
   * this repository - loader/src/validate.ts notes the clamp for a person
   * rather than applying one, which is deliberate and is checked next door in
   * e2e/loader.spec.ts. */
  const arrivals: number[] = [
    0, 1, 5, 9, 10, 11, 600, 3600, 86400, 86401,
    4294967, 4294967295, -1, -86400, 0.5, 600.7,
  ];
  const escaped: string[] = [];
  for (const given of arrivals) {
    const waited = layoutIdleSeconds(given);
    if (waited < SLEEP_MIN || waited > SLEEP_MAX
        || layoutIdleSeconds(waited) !== waited) {
      escaped.push(`${given} became ${waited}`);
    }
  }
  check("every wait the device settles on is in range and settled",
        escaped.length === 0,
        escaped.join("; ") || `${arrivals.length} foreign values`);
}

// --- the cable ---------------------------------------------------------------

/**
 * A device made of the transcript.
 *
 * It answers with the fixture's device lines and holds the client to the
 * fixture's host lines, which is the browser end of "both sides run the same
 * file from opposite ends". It is not a model of a device and must not become
 * one: loader/tools/cable_mock.js is that, and a second one would drift.
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

  /* How much the client has handed over, against how much this has taken out
   * of it. The difference is what the client wrote without waiting to be
   * answered, and it is counted at the writable end rather than read off
   * `held` because bytes the client has written but this has not asked for yet
   * are in the stream, invisible from in here - which is exactly where a
   * client that ran ahead puts them. */
  let written = 0;
  let consumed = 0;
  const inbound = toDevice.writable.getWriter();
  const counting = new WritableStream<Uint8Array>({
    write(chunk) { written += chunk.length; return inbound.write(chunk); },
    close() { return inbound.close(); },
    abort(reason) { return inbound.abort(reason); },
  });

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
        consumed += cut + 1;
        return text;
      }
      if (!await more()) return null;
    }
  }

  async function exactly(count: number): Promise<Uint8Array | null> {
    while (held.length < count) if (!await more()) return null;
    const taken = held.subarray(0, count);
    held = held.subarray(count);
    consumed += count;
    return taken;
  }

  /* A turn of the event loop, so that everything the client was going to write
   * has been written before it is counted. Without it the comparison below is
   * a race between two promise chains and would report whichever won. */
  const settleWrites = () => new Promise((r) => setTimeout(r, 0));

  const walk = (async () => {
    for (const step of steps) {
      if (step.from === "device" && step.raw !== undefined) {
        /* A file coming back. Written as bytes with no newline anywhere near
         * them - if this were sent as a line the client would read the first
         * 0x0a inside the file as the end of one. */
        await settleWrites();
        await out.write(new Uint8Array(Buffer.from(step.raw, "base64")));
        continue;
      }
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
        await settleWrites();
        if (written !== consumed) {
          problems.push(`the client had already written ${written - consumed} `
                        + `byte(s) more than were asked for when the device `
                        + `said "${step.line}" - it is not waiting to be `
                        + "answered");
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
    port: { readable: fromDevice.readable, writable: counting },
    problems,
    async settle() {
      let finished = false;
      await Promise.race([
        walk.then(() => { finished = true; }),
        new Promise((r) => setTimeout(r, 2000)),
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
        /* The one call whose answer is bytes. Compared as base64 because that
           is how the fixture holds it, and because a Uint8Array does not
           survive the JSON.stringify the answers are compared with. */
        case "get":
          seen.push(Buffer.from(await cable.get(step.name)).toString("base64"));
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

/* The keyword that says how many collections a device holds, and the same
 * argument the firmware word above gets. What the client returns is already
 * held to each transcript by the comparison above; what that comparison cannot
 * say is that the set contains both kinds of device. A client that dropped the
 * number would satisfy every transcript where the line is absent, and one that
 * refused a device without it would satisfy only the ones where it is there. */
{
  const said = ofKind("cable").map(({ want }) => want.device_collections);
  check("the transcripts cover a device that says how many collections it "
        + "holds and one that does not",
        said.includes(0) && said.some((n: number) => n > 1),
        said.map((n: number) => n || "(silent)").join(", "));
}

/* And what silence means, which is the whole of why the keyword cost no
 * protocol version. A client reading the absence as zero, or as unknown, would
 * send a second collection to a talker that holds one - a file that fills the
 * partition and is never read. */
for (const { listed: one, want } of ofKind("cable")) {
  if (!want.ends.includes("browser") || !want.client_script) continue;
  const hello = want.client_script.find((step: any) => step.call === "hello");
  if (!hello) continue;
  check(`${one.fixture}: a device that says ${want.device_collections || "nothing"}`
        + ` holds ${hello.returns.collections}`,
        hello.returns.collections === (want.device_collections || 1),
        `${hello.returns.collections}`);
}

check("the browser client speaks the fixtures' protocol version",
      CABLE_VERSION === expectations.get("greet-and-list").protocol_version,
      `${CABLE_VERSION}`);

/* And what it makes of the version the device announced - which for a year was
 * nothing at all. Every transcript states the pair and the conclusion, so the
 * two that carry a mismatch are checked by the same line as the eight that do
 * not, and a client that went back to testing for truthiness fails on both. */
for (const { listed: one, want } of ofKind("cable")) {
  const got = versionVerdict(want.device_speaks);
  check(`${one.fixture}: a device speaking ${want.device_speaks} is `
        + `"${want.version_verdict}" to a browser speaking ${CABLE_VERSION}`,
        got === want.version_verdict, got);
}

/* The verdict is only worth something if it is not constant. A client that
 * answered "ok" to everything would satisfy the eight transcripts that expect
 * it, so the fixture set has to contain both mismatches - and this says so out
 * loud rather than leaving it to whoever next adds a transcript. */
{
  const verdicts = new Set(
    ofKind("cable").map(({ want }) => want.version_verdict));
  check("the transcripts cover a mismatch in each direction, not only agreement",
        verdicts.has("ok") && verdicts.has("device_older")
        && verdicts.has("device_newer"),
        [...verdicts].join(", "));
}

/* The other word in the greeting, and the same argument one keyword along.
 * What the client returns is already held to each transcript by the comparison
 * above; what that comparison cannot say is that the set contains both kinds of
 * device. A client that dropped the word on the floor would satisfy the eight
 * transcripts where it is absent, and one that refused a device without it
 * would satisfy the one where it is there. */
{
  const said = ofKind("cable").map(({ want }) => want.device_firmware);
  check("the transcripts cover a device that names its build and one that does not",
        said.includes("") && said.some((word: string) => word !== ""),
        said.map((word: string) => word || "(silent)").join(", "));
}

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

// --- several collections -----------------------------------------------------
//
// One question of this kind crosses and the rest of it does not, and saying
// which is which out loud is the point of the section rather than a preamble to
// it: the wrapping, the order and the fallback are decisions a device makes
// about its own menu, and no byte of them reaches a browser.
//
// What does cross is which names are collections. There are two of those
// predicates - collectionKind() in the firmware and isCollectionFile() here,
// with a third in loader/tools/cable.js because that file imports nothing - and
// they have to agree in both directions. A name this side calls a collection
// and the device does not is a file the page offers to remove and the talker
// never lists; a name the device calls one and this side does not is the page
// sweeping up the very file the talker is reading.

for (const { want } of ofKind("collections")) {
  for (const one of want.names) {
    const wanted = one.kind !== "not";
    check(`${one.what} ${wanted ? "is" : "is not"} a collection to the browser`,
          isCollectionFile(one.name) === wanted,
          `${isCollectionFile(one.name)}`);
    /* And the copy inside the cable client, which cannot import the one above.
       Two files with one rule, held to the same list rather than to each
       other. */
    check(`${one.what}: the cable client agrees`,
          isCollection(one.name) === wanted, `${isCollection(one.name)}`);
  }

  /* Said out loud, the way `press` is: everything else in this fixture is the
     device's own and there is nothing on this side to hold to it.

     The heads in particular, which look at first as though they ought to
     cross. They do not, and the reason is what the head is FOR: a device reads
     44 bytes because it has sixteen files to name a menu from and no room to
     parse them all. A browser has the whole file - `get` hands it over - so it
     has no use for a reader that works on the first 44 bytes, and writing one
     to satisfy a fixture would be a second reader on this side that nothing
     else calls. What both ends do have to agree about is the NAME that comes
     out, and that is checked below against the whole collections. */
  check("the heads, the wrapping, the order and the fallback have no browser "
        + "half, and this runner says so rather than leaving them unlisted",
        Array.isArray(want.heads) && Array.isArray(want.menu)
        && Array.isArray(want.listing.order) && Array.isArray(want.choosing),
        `${want.heads.length} heads, ${want.menu.length} names wrapped, `
        + `${want.listing.order.length} ordered, ${want.choosing.length} `
        + "choices - all of them the device's");
}

/* And what the whole collection file is for on this side: every tile and
 * recording it names, which is what a removal subtracts against. Asked of the
 * layout fixtures rather than of a head, because a head has no keys in it -
 * the same files the firmware runner reads hash by hash out of the same
 * bytes. */
for (const { listed: one, want } of ofKind("layout")) {
  if (want.read.result !== "ok" || !want.read.sets?.length) continue;
  const got = readLayoutBin(new Uint8Array(read(one.file)));
  if (!got) {
    check(`${one.fixture}: the browser reads it back as a collection`, false);
    continue;
  }
  /* The name the device's menu will show, which is the first set's - the same
     answer collectionHeadName() gives on the other side, out of the same
     bytes. This page says it in the check step so that somebody sees it before
     the file is sent, and a page that named a collection differently from the
     talker would be a page nobody could act on.

     Through the field's bytes rather than against a string in the fixture,
     because a name may be cut in the middle of a character - the field is 32
     BYTES - and what a reader hands back for one of those is not text. */
  const named = Buffer.from(want.read.sets[0].name, "hex").toString("utf8");
  check(`${one.fixture}: and calls it what the first set is called`,
        got.name === named, `${got.name} against ${named}`);

  const wanted = new Set<string>();
  for (const set of want.read.sets) {
    for (const key of [set.key, ...set.slots]) {
      if (/[^0]/.test(key.image)) wanted.add(`t${key.image}.bin`);
      if (key.has_audio && /[^0]/.test(key.audio)) wanted.add(`a${key.audio}.wav`);
    }
  }
  check(`${one.fixture}: and names the ${wanted.size} file(s) the fixture says `
        + "it does",
        [...got.files].sort().join(" ") === [...wanted].sort().join(" "),
        [...got.files].sort().join(" "));
}
