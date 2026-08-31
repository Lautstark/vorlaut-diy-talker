// layout.bin - the table the firmware reads, written in the browser.
//
// A port of render_layout_bin() from layout_format.py, byte for byte. The app
// became a static site, so the writer had to exist here as well; the firmware
// did not change with it, which left exactly one acceptable output - the one
// Python produced. That Python went on 2026-08-22, and tests/test_layout_format.py
// went with it. What holds this module to that output now is
// tests/test_layout_frozen.py: the bytes are compared against the ones frozen
// from the Python writer while it was still here, and the firmware's own C
// reader, compiled at test time, reads the file this module produced.
//
// The structure itself is written down in firmware/vorlaut/layout_format.h and
// is not spelled out again here. The strides below are repeated as the same
// sums for the same reason: the sum is the thing that has to keep agreeing.
//
// Two places deviate from the Python on purpose, both only for input the
// Python does not survive either - they are marked where they are.
//
// Two places deviate on purpose and not only for bad input, and both are a
// version byte rather than a quirk. Version 2: the set entry no longer opens
// with a colour. Version 3: every key carries what it does and where it goes,
// and the set key is a key like the other four. What the frozen bytes can
// still say about either is worked out in tests/test_layout_frozen.py, under
// THE_COLOUR_IS_GONE and THE_KEYS_ARE_FIVE.

export const LAYOUT_BIN = "layout.bin";
export const LAYOUT_MAGIC = "MTRD";
// 3 since every key gained what it does and where it goes - see the note on
// the same constant in firmware/vorlaut/layout_format.h for why a longer
// entry needs a new version rather than passing as a longer file.
export const LAYOUT_VERSION = 3;

export const SLOTS_PER_SET = 4;
/** The set key beside the four speech keys: the five panels the device
 *  lights. KEY_COUNT in firmware/vorlaut/layout_format.h. */
export const KEYS_PER_SET = SLOTS_PER_SET + 1;
/* How many sets the device has room for, which is MAX_SETS in
 * firmware/vorlaut/layout_format.h and the size of the array it reads them
 * into. Not a limit this writer enforces: renderLayoutBin() below writes as
 * many sets as fit in one byte, because the count and the length are the same
 * refusal at the far end - readLayout() answers LAYOUT_BAD_LENGTH for a set
 * past the last one there is room for, and
 * device/fixtures/layout/sets-past-max.expected.json is that case written
 * down.
 *
 * It is exported because somebody has to say so before the file gets there.
 * The editor could once be trusted to, since it was the only writer and could
 * not make a sixth set; now that a file arrives from elsewhere it is the
 * loader's to check, and loader/src/validate.ts is where it is checked. A
 * talker that refuses its layout shows nothing and says nothing about why.
 *
 * It was 5 until 2026-08-31 and adr/0020 is why it is 64. */
export const MAX_SETS = 64;
export const NAME_BYTES = 32;
export const HASH_BYTES = 16;
// Fixed strides - the firmware works with the same numbers.
export const KEY_BYTES = HASH_BYTES + HASH_BYTES + 1 + 1 + 1 + 1;    // 36
export const SET_BYTES = NAME_BYTES + KEYS_PER_SET * KEY_BYTES;      // 212
export const HEADER_BYTES = 4 + 4 + 4;                               // 12

// The index the device labels its own menu by - see
// device/fixtures/language.expected.json, which states the table, and
// LANGUAGES in firmware/vorlaut/texts.h.
export const LANGUAGE_CODES = { en: 0, de: 1 };
export const DEFAULT_LANGUAGE = "en";

/** What a key does when it is pressed, as the byte spells it.
 *
 * The same table LANGUAGE_CODES is: a word on this side, a number in the file,
 * and LAYOUT_KEY_SPEAK, LAYOUT_KEY_SPEAK_AND_GO and LAYOUT_KEY_GO in
 * firmware/vorlaut/layout_format.h on the other. The editor's three names for
 * them are Wort, Wort & weiter and weiter.
 *
 * In an `.obz` this is not one field but two: a key that goes somewhere has a
 * `load_board`, and `ext_lautstark_speak_on_navigate` beside it says whether
 * it also says its own word. loader/src/device_package.ts is where the two
 * become one.
 */
export const KEY_DOES = { speak: 0, "speak-and-go": 1, go: 2 };
/** The three words, as a type. The only annotation in this file, and it earns
 *  its place: `does` travels through four modules as a string, and a typo in
 *  one of them is a RangeError at compile time on somebody's talker. */
export type KeyDoes = "speak" | "speak-and-go" | "go";
/** What a key does when nothing says: it speaks, which is every key of a
 *  version-2 layout. */
export const DEFAULT_KEY_DOES = "speak";

// The sleep timeout's range, beside the strides because it is the same kind of
// thing: a number both halves have to hold. The firmware states it in
// LAYOUT_SLEEP_MIN, LAYOUT_SLEEP_MAX and LAYOUT_SLEEP_DEFAULT in
// layout_format.h, and device/fixtures/sleep.expected.json is what holds the
// two ends to it without either reading the other.
//
// The field is a uint32, so the format can hold far more than this. What it
// cannot do is mean it: the device computes `idle * 1000UL` and that wraps
// above 4294967 seconds, so the range is narrower than the field on purpose
// and that is the whole of L1 in docs/format-freeze.md.
export const SLEEP_MIN = 10;
export const SLEEP_MAX = 86400;
export const SLEEP_DEFAULT = 600;

/** What the device really waits, given what the field holds.
 *
 * layoutIdleSeconds() in firmware/vorlaut/layout_format.h, written a second
 * time - the same relation renderLayoutBin() has to parseLayout(). Zero is the
 * default rather than "never" or "at once", and either end past the range is
 * brought back inside it.
 *
 * This is not called on the way to a file and must not be: renderLayoutBin()
 * writes the field as it is handed it, because tests/reference/layout.lock.json
 * has frozen its bytes for a timeout of 0 and one of 0xffffffff. What holds a
 * builder to the range is normalizeLayout() in obf.ts, and what this is for is
 * saying - on this side, checkably - what the device would do with a file that
 * never went through it.
 */
export function layoutIdleSeconds(sleepSeconds) {
  if (sleepSeconds === 0) return SLEEP_DEFAULT;
  if (sleepSeconds < SLEEP_MIN) return SLEEP_MIN;
  if (sleepSeconds > SLEEP_MAX) return SLEEP_MAX;
  return sleepSeconds;
}

/** Which set a key really goes to, or -1 where it goes nowhere.
 *
 * layoutKeyGoesTo() in firmware/vorlaut/layout_format.h, written a second time
 * for the same reason layoutIdleSeconds() is: what the field says and what it
 * means are two answers, and device/fixtures/ holds both ends to both without
 * either reading the other. A value this version does not know is a key that
 * speaks and stays put, and a target no set stands behind is the same answer.
 */
export function layoutKeyGoesTo(does, target, setCount) {
  if (does !== KEY_DOES["speak-and-go"] && does !== KEY_DOES.go) return -1;
  if (!(target >= 0) || target >= setCount) return -1;
  return target;
}

/** Whether a key says its own word. Anything but "go" does. */
export const layoutKeySpeaks = (does) => does !== KEY_DOES.go;

const encoder = new TextEncoder();

/** What Path(name).stem does: the file name without its last suffix. */
function stem(filename) {
  const name = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // A leading dot is part of the name and not a suffix, and a name of nothing
  // but dots has no suffix at all.
  if (dot <= 0 || /^\.+$/.test(name)) return name;
  return name.slice(0, dot);
}

/** The 16 raw hash bytes out of "t3bd7a62….bin". */
export function hashBytes(filename) {
  const out = new Uint8Array(HASH_BYTES);
  if (!filename) return out;
  const core = stem(String(filename)).slice(1);   // drop the leading t or a
  // Python raises here rather than writing a hash that is not one, and so do
  // we: a silently zeroed hash would be a key without a picture on the
  // device, and nothing on the way there would say why.
  if (core.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(core)) {
    throw new Error(`not a hashed file name: ${filename}`);
  }
  for (let i = 0; i < Math.min(HASH_BYTES, core.length / 2); i++) {
    out[i] = parseInt(core.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** The byte for what a key does, out of whatever the layout put there.
 *
 * A word out of KEY_DOES, and the default where a layout says nothing. A word
 * that is not in the table is refused rather than defaulted: an unknown
 * LANGUAGE falls back because a device with the wrong menu language still
 * works, and a key doing something other than what its layout meant does not.
 */
function keyDoes(said, fallback) {
  const word = said === undefined || said === null ? fallback : String(said);
  if (!Object.hasOwn(KEY_DOES, word)) {
    throw new RangeError(`not something a key can do: ${said}`);
  }
  return KEY_DOES[word];
}

/** The byte for where a key goes. Not checked against the set count here -
 *  see the note in renderLayoutBin(). */
function keyTarget(said, fallback) {
  const at = said === undefined || said === null ? fallback : said;
  if (!Number.isInteger(at) || at < 0 || at > 0xff) {
    throw new RangeError(`not a set a key can go to: ${said}`);
  }
  return at;
}

/**
 * The bytes of layout.bin - what build.py used to write, and the frozen answer
 * in tests/reference/layout.lock.json is that writer's.
 *
 * layout is a normalized layout, the four lists are per set and in its order
 * - exactly what builder.py handed the Python, and what backend/local.ts's
 * build hands this. `labelSounds` is the fifth and the newest: the set key
 * gained a sound of its own in version 3, and a layout with nothing to say on
 * that key is a layout that passes four arguments as it always did.
 *
 * What each key DOES and where it GOES comes off the layout rather than out of
 * a fifth and sixth array, because it is a fact about the key and not about a
 * file the compiler resolved. A layout that says nothing gets what version 2
 * did: every speech key speaks, and the set key goes to the next set, which is
 * the ring vorlaut.ino used to do in arithmetic.
 *
 * A target is written as it stands, including one that names no set. That is
 * the same division the sleep timeout is under: the reader decides what an
 * out-of-range value MEANS - layoutKeyGoesTo() says it goes nowhere - and
 * loader/src/validate.ts is what tells a person about it before anything is
 * sent. A writer that quietly repaired it would hand the device a layout
 * nobody asked for.
 */
export function renderLayoutBin(layout, labelFiles, tileFiles, audioFiles,
                                labelSounds = []) {
  // Every set in the layout: a Sammlung is the selection, so there is nothing
  // to filter out here. The file lists are built the same way, and setCount in
  // the header has to match them.
  const sets = layout.sets || [];
  if (sets.length > 0xff) {
    throw new RangeError(`${sets.length} sets do not fit in one byte`);
  }
  const language = Object.hasOwn(LANGUAGE_CODES, layout.language)
    ? LANGUAGE_CODES[layout.language]
    : LANGUAGE_CODES[DEFAULT_LANGUAGE];
  const sleep = layout.sleep_timeout_seconds;
  if (!Number.isInteger(sleep) || sleep < 0 || sleep > 0xffffffff) {
    throw new RangeError(`sleep_timeout_seconds is not a uint32: ${sleep}`);
  }

  // The size is known before the first byte is written, and the buffer starts
  // zeroed - which is what every padding in this format is made of.
  const bytes = new Uint8Array(HEADER_BYTES + sets.length * SET_BYTES);
  const view = new DataView(bytes.buffer);
  let at = 0;

  for (let i = 0; i < LAYOUT_MAGIC.length; i++) {
    view.setUint8(at++, LAYOUT_MAGIC.charCodeAt(i));
  }
  view.setUint8(at++, LAYOUT_VERSION);
  view.setUint8(at++, sets.length);
  view.setUint8(at++, SLOTS_PER_SET);
  view.setUint8(at++, language);
  // Little-endian, spelled out at every call: DataView writes big-endian
  // unless told otherwise, while the firmware assembles its numbers out of
  // single bytes low one first (layoutU32 in layout_format.h).
  view.setUint32(at, sleep, true);
  at += 4;

  /** One key: two hashes, the has-audio flag, the two fields that say what it
   *  is for, and the spare byte after them. */
  const key = (tile, sound, does, target) => {
    bytes.set(hashBytes(tile), at);
    at += HASH_BYTES;
    bytes.set(hashBytes(sound), at);
    at += HASH_BYTES;
    view.setUint8(at++, sound ? 1 : 0);
    view.setUint8(at++, does);
    view.setUint8(at++, target);
    view.setUint8(at++, 0);          // reserved
  };

  sets.forEach((entry, index) => {
    // Cut after the 32nd byte, not after the 32nd character. A name of
    // umlauts is half as long as it looks, and cutting the string first would
    // make the two writers disagree the moment one is used.
    bytes.set(encoder.encode(String(entry.name ?? "")).subarray(0, NAME_BYTES), at);
    at += NAME_BYTES;
    // The set key. Where a layout says nothing it is the ring: on to the next
    // set, and round to the first from the last, which is what
    // `(current + 1) % setCount` did in vorlaut.ino before the file could say
    // it. A one-set layout therefore points at itself, and pressing the key
    // does what it did before - nothing anybody can see.
    const said = entry.key ?? {};
    key(labelFiles[index], labelSounds[index] ?? "",
        keyDoes(said.does, "go"),
        keyTarget(said.target, (index + 1) % (sets.length || 1)));
    for (let slot = 0; slot < SLOTS_PER_SET; slot++) {
      const saidHere = (entry.slots ?? [])[slot] ?? {};
      key(tileFiles[index][slot], audioFiles[index][slot],
          keyDoes(saidHere.does, DEFAULT_KEY_DOES),
          keyTarget(saidHere.target, 0));
    }
  });
  return bytes;
}
