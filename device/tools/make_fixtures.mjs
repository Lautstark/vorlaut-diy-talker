#!/usr/bin/env node
// Builds the conformance fixtures in ../fixtures.
//
// This is fixture tooling, not an implementation of the device interface. It
// writes the artefacts and, from the same literals, the expectation beside
// each one. One source per fixture is the point: an expectation written
// separately from the artefact it describes drifts from it, and a drifted
// expectation passes whatever an implementation does.
//
// Two rules, both borrowed from exchange/tools/make_fixtures.mjs, and both
// load-bearing here for the reason docs/frozen-references.md gives:
//
//   * Nothing here reads its own output back. There is no parser in this file
//     and there must never be one - a generator that checked its own output
//     would be comparing a thing against itself.
//   * Nothing here imports src/, tools/ or firmware/. The bytes below are
//     laid out by hand from the field values, NOT by calling
//     renderLayoutBin() with different arguments. A fixture derived from a
//     writer is a capture of that writer, and a capture can only ever contain
//     what its writer emits - which is why tests/reference/layout.lock.json
//     has seventeen valid layouts in it and not one refusal.
//
// Needs nothing but node. Byte-reproducible: running it on any machine
// produces exactly the files that are committed.

import { crc32 } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "fixtures");

/** German fixture content, kept in fixtures/source/ so this file stays
 *  English like the rest of the code. See the note in that file. */
const de = JSON.parse(readFileSync(join(OUT, "source", "names.de.json"), "utf8"));

const index = [];

/** Writes one artefact and its expectation, and lists it in the index. */
function fixture({ kind, name, dir, file, artefact, expected, outcome, summary }) {
  const listed = { fixture: name, kind, outcome, summary };
  if (file) {
    listed.file = `${dir}/${file}`;
    writeFileSync(join(OUT, dir, file), artefact);
  }
  listed.expected = dir ? `${dir}/${name}.expected.json`
                        : `${name}.expected.json`;
  writeFileSync(join(OUT, listed.expected),
                JSON.stringify(expected, null, 2) + "\n");
  index.push(listed);
}

const hex = (buffer) => Buffer.from(buffer).toString("hex");
const b64 = (buffer) => Buffer.from(buffer).toString("base64");
const hex8 = (value) => (value >>> 0).toString(16).padStart(8, "0");
const hex4 = (value) => (value & 0xffff).toString(16).padStart(4, "0");

// =============================================================================
// layout.bin
// =============================================================================
//
// Laid out here from the strides rather than from either implementation, so
// that a stride moving on one side is a fixture that fails rather than a
// fixture that moves with it.

const LAYOUT_MAGIC = "MTRD";
const LAYOUT_VERSION = 2;
const LAYOUT_HEADER_BYTES = 12;
const NAME_BYTES = 32;
const HASH_BYTES = 16;
const SLOTS_PER_SET = 4;
const SLOT_BYTES = HASH_BYTES + HASH_BYTES + 1 + 1;                      // 34
const SET_BYTES = NAME_BYTES + HASH_BYTES + SLOTS_PER_SET * SLOT_BYTES;  // 184

// The sleep timeout's range, stated here the same way the strides are: from
// the rule, not from either implementation. The field is a uint32 and holds
// far more than this - narrowing it is the whole point, because the device
// multiplies by 1000 into an unsigned long and wraps above 4294967 seconds.
const SLEEP_MIN = 10;
const SLEEP_MAX = 86400;
const SLEEP_DEFAULT = 600;

/** The length of time a field means, which is not always the number in it. */
const idleFor = (sleep) =>
  sleep === 0 ? SLEEP_DEFAULT
  : sleep < SLEEP_MIN ? SLEEP_MIN
  : sleep > SLEEP_MAX ? SLEEP_MAX
  : sleep;

/** Sixteen hash bytes from a short spelling: "01" fills them with 0x01. */
function hash(seed) {
  return Buffer.alloc(HASH_BYTES, parseInt(seed, 16));
}
const NO_HASH = Buffer.alloc(HASH_BYTES);

/** The 32 name bytes as the field holds them: UTF-8, cut after the 32nd
 *  BYTE and not after the 32nd character, zero-padded from there. */
function nameField(text) {
  const field = Buffer.alloc(NAME_BYTES);
  Buffer.from(text, "utf8").subarray(0, NAME_BYTES).copy(field);
  return field;
}

/** What a reader must hand back for a name field: the bytes up to the first
 *  zero, or all 32 where there is none. Stated as hex because a name cut in
 *  the middle of a character is not text and cannot be compared as text. */
function nameAsRead(field) {
  const zero = field.indexOf(0);
  return hex(zero < 0 ? field : field.subarray(0, zero));
}

/**
 * One set entry, 184 bytes.
 *
 * `reserved` is the byte after each slot's has-audio flag. A writer puts zero
 * there; what a reader does with anything else is exactly the kind of thing
 * that is written down nowhere, so one fixture below sets it.
 */
function setEntry({ name, label, slots }) {
  const parts = [nameField(name), label];
  for (const one of slots) {
    parts.push(one.image, one.audio,
               Buffer.from([one.hasAudio ?? 0, one.reserved ?? 0]));
  }
  const entry = Buffer.concat(parts);
  if (entry.length !== SET_BYTES) {
    throw new Error(`set entry is ${entry.length} bytes, not ${SET_BYTES}`);
  }
  return entry;
}

/**
 * A whole layout.bin.
 *
 * Every field a malformed fixture needs to lie about is a parameter, because
 * the refusals are the half no capture can reach: the magic, the version, the
 * header's set count (which a truncation fixture makes disagree with the
 * entries), the slot count, and whatever is stuck on the end.
 */
function layoutBytes({ magic = LAYOUT_MAGIC, version = LAYOUT_VERSION,
                       setCountByte = null, slotCountByte = SLOTS_PER_SET,
                       language = 0, sleep = 0, entries = [],
                       trailer = null, cut = null }) {
  const header = Buffer.alloc(LAYOUT_HEADER_BYTES);
  header.write(magic, 0, "latin1");
  header[4] = version;
  header[5] = setCountByte ?? entries.length;
  header[6] = slotCountByte;
  header[7] = language;
  header.writeUInt32LE(sleep >>> 0, 8);
  const whole = Buffer.concat([header, ...entries, trailer ?? Buffer.alloc(0)]);
  return cut === null ? whole : Buffer.from(whole.subarray(0, cut));
}

/** The file name the 16 bytes in a slot are the head of: hashPath() in
 *  vorlaut.ino writes "/t<32 hex>.bin", and the browser reads the same 16
 *  bytes back out of the same spelling. Lower case, always 32 digits. */
const tileName = (h) => `t${hex(h)}.bin`;
const audioName = (h) => `a${hex(h)}.wav`;

/** The reader's answer for a layout that parses. */
function readsAs({ sets, language, sleep, entries }) {
  return {
    result: "ok",
    sets,
    language,
    sleep_seconds: sleep,
    // The field, and then what it means. A reader hands the first back
    // untouched - that is the rule byte 7 follows too - and the second is the
    // length of time the device really waits.
    idle_seconds: idleFor(sleep),
    entries: entries.map((entry) => ({
      name: nameAsRead(nameField(entry.name)),
      name_text: entry.nameText ?? null,
      label: hex(entry.label),
      slots: entry.slots.map((one) => ({
        image: hex(one.image),
        audio: hex(one.audio),
        has_audio: Boolean(one.hasAudio),
      })),
    })),
  };
}

/** The builder input, in the shape renderLayoutBin() takes it. */
function writtenFrom({ language, sleep, entries }) {
  return {
    layout: {
      language,
      sleep_timeout_seconds: sleep,
      sets: entries.map((entry) => ({ name: entry.name })),
    },
    label: entries.map((entry) => tileName(entry.label)),
    images: entries.map((entry) => entry.slots.map((s) => tileName(s.image))),
    sounds: entries.map((entry) =>
      entry.slots.map((s) => (s.hasAudio ? audioName(s.audio) : ""))),
  };
}

/**
 * The layout fixture, both directions at once.
 *
 * `read` is what any reader must produce, and every fixture has one. `write`
 * is the builder input a conforming writer must turn into exactly these
 * bytes, and it is null wherever no writer can produce the file: every
 * refusal, and every case that lies about a reserved byte.
 */
function layoutFixture({ name, summary, bytes, read, write = null, notes = [] }) {
  fixture({
    kind: "layout", name, dir: "layout", file: `${name}.bin`, artefact: bytes,
    outcome: read.result === "ok" ? "accepted" : "refused",
    summary,
    expected: {
      fixture: name, kind: "layout", file: `layout/${name}.bin`,
      summary, bytes: bytes.length, read, write, notes,
    },
  });
}

const slot = (image, audio) => ({
  image: hash(image),
  audio: audio ? hash(audio) : NO_HASH,
  hasAudio: audio ? 1 : 0,
});

// --- The accepted shapes -----------------------------------------------------

layoutFixture({
  name: "no-sets",
  summary: "A header and nothing after it. Twelve bytes, zero sets, and it parses.",
  bytes: layoutBytes({ entries: [] }),
  read: readsAs({ sets: 0, language: 0, sleep: 0, entries: [] }),
  write: writtenFrom({ language: "en", sleep: 0, entries: [] }),
  notes: [
    "A layout with no sets is not an error. The device shows its 'no content' panel, which is a true sentence.",
    "Its sleep timeout is zero, which is the unset field rather than a timeout of nothing: the reader hands back 0 and the device waits the default of 600 seconds. This is the one accepted fixture where sleep_seconds and idle_seconds differ by more than a clamp, and it is the case a reader treating the field as a plain clamp would get wrong - see sleep.expected.json.",
  ],
});

const ONE_SET = [{
  name: de.breakfast,
  nameText: de.breakfast,
  label: hash("11"),
  slots: [slot("21", "31"), slot("22", "32"), slot("23", null), slot("24", "34")],
}];

layoutFixture({
  name: "one-set",
  summary: "One set, four slots, one of them without a sound. A sleep timeout that reads as nonsense if it is taken big-endian.",
  bytes: layoutBytes({ entries: ONE_SET.map(setEntry), sleep: 3600 }),
  read: readsAs({ sets: 1, language: 0, sleep: 3600, entries: ONE_SET }),
  write: writtenFrom({ language: "en", sleep: 3600, entries: ONE_SET }),
  notes: [
    "3600 is 0x00000E10. Read the wrong way round it is 269352960 - a device that sleeps in eighty years rather than in an hour, and a device that works and is wrong.",
    "The third slot has no sound: its audio hash is sixteen zero bytes and its has-audio flag is 0. A hash of zeros is not a file name, it is the absence of one.",
  ],
});

{
  const names = [de.breakfast, de.outside, de.feelings, "Zoo", "Bus"];
  const entries = names.map((name, i) => ({
    name,
    nameText: name,
    label: hash(`4${i}`),
    slots: [slot(`5${i}`, `6${i}`), slot(`7${i}`, null),
            slot(`8${i}`, `9${i}`), slot(`a${i}`, `b${i}`)],
  }));
  layoutFixture({
    name: "five-sets",
    summary: "Five sets, which is MAX_SETS. 932 bytes, the largest file that parses.",
    bytes: layoutBytes({ entries: entries.map(setEntry), language: 1, sleep: 900 }),
    read: readsAs({ sets: 5, language: 1, sleep: 900, entries }),
    write: writtenFrom({ language: "de", sleep: 900, entries }),
    notes: [
      "12 + 5 * 184. A sixth set is refused rather than truncated - see sets-past-max.",
    ],
  });
}

{
  const entries = [{
    name: de.exactly_32_bytes,
    nameText: de.exactly_32_bytes,
    label: hash("c1"),
    slots: [slot("c2", "c3"), slot("c4", null), slot("c5", null), slot("c6", null)],
  }];
  if (Buffer.from(de.exactly_32_bytes, "utf8").length !== NAME_BYTES) {
    throw new Error("this fixture wants a name of exactly 32 bytes");
  }
  layoutFixture({
    name: "name-fills-the-field",
    summary: "A name of exactly 32 bytes, so the field has no zero in it at all.",
    bytes: layoutBytes({ entries: entries.map(setEntry), sleep: 60 }),
    read: readsAs({ sets: 1, language: 0, sleep: 60, entries }),
    write: writtenFrom({ language: "en", sleep: 60, entries }),
    notes: [
      "The name a reader hands back is the bytes up to the first zero, or all 32 where there is none. A reader looking for a terminator inside the field finds none here and must not read past it.",
    ],
  });
}

{
  const entries = [{
    name: de.cut_mid_character,
    nameText: null,
    label: hash("d1"),
    slots: [slot("d2", "d3"), slot("d4", "d5"), slot("d6", null), slot("d7", null)],
  }];
  const field = nameField(de.cut_mid_character);
  if (field[NAME_BYTES - 1] !== 0xc3
      || Buffer.from(de.cut_mid_character, "utf8").length <= NAME_BYTES) {
    throw new Error("this fixture is only worth anything if the 32nd byte is a "
                    + "lead byte whose continuation was cut off");
  }
  layoutFixture({
    name: "name-cut-mid-character",
    summary: "A name whose UTF-8 crosses the 32-byte cut, so the field ends with a lead byte and no continuation.",
    bytes: layoutBytes({ entries: entries.map(setEntry), sleep: 60 }),
    read: readsAs({ sets: 1, language: 0, sleep: 60, entries }),
    write: writtenFrom({ language: "en", sleep: 60, entries }),
    notes: [
      "The cut is after the 32nd BYTE, not after the 32nd character. A writer that cuts the string first disagrees with one that cuts the bytes the moment a name has an umlaut in it, and both look right in the editor.",
      "What is left is not text. A reader hands the bytes back as they stand rather than repairing them or refusing the file: the device draws them, and a panel showing one broken glyph is better than a set with no name.",
    ],
  });
}

layoutFixture({
  name: "sleep-timeout-max",
  summary: "A sleep timeout of 0xffffffff, the largest a uint32 holds. It parses, and it is not a length of time the device can wait.",
  bytes: layoutBytes({ entries: ONE_SET.map(setEntry), sleep: 0xffffffff }),
  read: readsAs({ sets: 1, language: 0, sleep: 4294967295, entries: ONE_SET }),
  notes: [
    "Four bytes wide and unsigned. Read as sixteen bits it is 65535 and read as signed it is -1, and neither of those is a length of time.",
    "It is not one read CORRECTLY either, and that is the finding this fixture used to stop one step short of. 4294967295 seconds is 136 years, and the device computes idle * 1000UL - which wraps where unsigned long is 32 bits, so the wait it produces is neither 136 years nor an error but some other number entirely. Anything above 4294967 seconds has that problem.",
    "So the reader hands the field back as it stands and the timeout is clamped to SLEEP_MAX where the number becomes a length of time. Both halves are in this fixture: sleep_seconds is what parseLayout returns, idle_seconds is what the device waits.",
    "The write half went when the range was written down. A conforming builder emits between 10 and 86400, so none produces this file - the same reason trailing-bytes and slot-reserved-byte-set have no write half. renderLayoutBin() will still put these four bytes in a file if it is handed them, and must: tests/reference/layout.lock.json has frozen its output for exactly this input, and normalizeLayout() rather than the byte writer is what holds a builder to the range.",
  ],
});

layoutFixture({
  name: "sleep-timeout-at-max",
  summary: "A sleep timeout of 86400 - one day, the longest the device honours as written.",
  bytes: layoutBytes({ entries: ONE_SET.map(setEntry), sleep: SLEEP_MAX }),
  read: readsAs({ sets: 1, language: 0, sleep: SLEEP_MAX, entries: ONE_SET }),
  write: writtenFrom({ language: "en", sleep: SLEEP_MAX, entries: ONE_SET }),
  notes: [
    "The top of the range, and the case that says the clamp is a clamp rather than a ceiling one lower. A reader that brought 86400 back to something smaller would pass sleep-timeout-max and fail here.",
    "It has a write half where sleep-timeout-max no longer does, which is the line between the two: this is the largest timeout a builder may emit.",
  ],
});

layoutFixture({
  name: "sleep-timeout-under-min",
  summary: "A sleep timeout of 5 seconds. Below the range, and brought up to it rather than obeyed.",
  bytes: layoutBytes({ entries: ONE_SET.map(setEntry), sleep: 5 }),
  read: readsAs({ sets: 1, language: 0, sleep: 5, entries: ONE_SET }),
  notes: [
    "The other end of the same rule. Five seconds is a device that goes back to sleep between one key press and the next, which is a device that cannot be used - so the floor is 10 and a field below it means 10.",
    "Zero is not this case and does not clamp to 10: it is the unset field and means the default of 600. no-sets is where that is pinned.",
    "No write half. normalizeLayout() clamps to the range before any builder here reaches the byte writer, so this file is one only a foreign builder or a hand-written layout.bin produces - which is exactly who this rule is for.",
  ],
});

// --- The rules nothing states -----------------------------------------------

{
  const entries = ONE_SET.map((entry) => ({
    ...entry,
    slots: entry.slots.map((s) => ({ ...s, reserved: 0xff })),
  }));
  layoutFixture({
    name: "slot-reserved-byte-set",
    summary: "The reserved byte after each has-audio flag written as 0xff. A reader ignores it and reads the same fields.",
    bytes: layoutBytes({ entries: entries.map(setEntry), sleep: 3600 }),
    read: readsAs({ sets: 1, language: 0, sleep: 3600, entries: ONE_SET }),
    notes: [
      "This is the layout's second piece of reserved space, beside byte 7 of the header, and it works the same way: a reader ignores it, a writer writes zero, and a later MINOR version may give a meaning to a value whose zero is the old behaviour.",
      "No writer produces this file, which is why it has no write half. That is the whole argument for authoring fixtures rather than freezing them - a capture of a correct writer can never contain a byte the writer does not emit.",
    ],
  });
}

{
  const entries = ONE_SET.map((entry) => ({
    ...entry,
    slots: entry.slots.map((s) => ({ ...s, hasAudio: s.hasAudio ? 0x2a : 0 })),
  }));
  layoutFixture({
    name: "has-audio-not-one",
    summary: "The has-audio flag written as 42. Any non-zero value means the slot has a sound.",
    bytes: layoutBytes({ entries: entries.map(setEntry), sleep: 3600 }),
    read: readsAs({ sets: 1, language: 0, sleep: 3600, entries: ONE_SET }),
    notes: [
      "A writer writes 1. A reader tests for non-zero, and a reader testing for equality with 1 would silence three keys out of four on a file it otherwise read perfectly.",
    ],
  });
}

layoutFixture({
  name: "trailing-bytes",
  summary: "A valid one-set layout with four bytes stuck on the end. A reader ignores them.",
  bytes: layoutBytes({
    entries: ONE_SET.map(setEntry), sleep: 3600,
    trailer: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
  }),
  read: readsAs({ sets: 1, language: 0, sleep: 3600, entries: ONE_SET }),
  notes: [
    "The length rule is a floor and not an equality: the file holds at least 12 + sets * 184 bytes, and anything past that is not read.",
    "That is NOT a way to extend the format. The header carries no length of its own, so a reader has no way to tell a trailing field from a file something was appended to by accident, and nothing would tell it what the field means. Byte 7 remains the only forward compatibility this format has.",
    "A writer must not emit them, which is why this has no write half.",
  ],
});

// --- The five refusals -------------------------------------------------------
//
// None of these can be captured. Every one of them was authored in an
// afternoon, which is the measurement docs/device-interface.md section 2
// makes: seventeen frozen cases reach none of these branches.

const REFUSALS = [
  {
    name: "too-short",
    result: "LAYOUT_TOO_SHORT",
    summary: "Eleven bytes: one short of the header itself.",
    bytes: layoutBytes({ entries: [], cut: LAYOUT_HEADER_BYTES - 1 }),
    notes: [
      "Refused before the magic is looked at, because looking at it would read past the end of the file.",
    ],
  },
  {
    name: "bad-magic",
    result: "LAYOUT_BAD_MAGIC",
    summary: "MTRE where MTRD belongs - one bit out in the last letter.",
    bytes: layoutBytes({ magic: "MTRE", entries: ONE_SET.map(setEntry) }),
    notes: [
      "Everything after the magic is a perfectly good layout, which is the point: the magic is what stops some other file on the device being read as one.",
    ],
  },
  {
    name: "version-one",
    result: "LAYOUT_BAD_VERSION",
    summary: "Version 1, the layout from before the set colour went. Refused rather than read two bytes out of step.",
    bytes: layoutBytes({ version: 1, entries: ONE_SET.map(setEntry) }),
    notes: [
      "A version-1 set entry was 186 bytes, not 184, so a version-1 file is LONGER than the length rule asks for rather than shorter. Its length adds up, and without the version byte a reader would take it and hand back every name and hash two bytes late.",
      "That is docs/device-interface.md section 6 exactly: the dangerous mistakes are the ones that parse. The version byte turns this one into a refusal, which is the silence section 6 calls the good outcome.",
    ],
  },
  {
    name: "version-three",
    result: "LAYOUT_BAD_VERSION",
    summary: "Version 3, from a builder newer than the device. Refused, because the reader cannot skip what it does not know.",
    bytes: layoutBytes({ version: 3, entries: ONE_SET.map(setEntry) }),
    notes: [
      "This is the rule the cable does the opposite of. parseLayout reads fixed strides, has no room for an unknown field and no way to step over one, so a version it does not know is refused outright rather than read as far as it goes.",
      "A flashed device cannot be updated, so this refusal is permanent for that device: a MAJOR change to this format strands every talker already in a house. That asymmetry is why the MAJOR rule is written about a flashed device misreading a payload rather than about the builder.",
      "docs/device-interface.md section 3 asks for 'a version byte of 2' here. It was written on the morning of the day the set colour went, when LAYOUT_VERSION was still 1; by the afternoon 2 was the valid version and the refusable one had moved up to 3. The fixture follows the code, and the disagreement is recorded rather than smoothed over - it is what a specification kept as prose does within a week, and the argument for writing the fixtures first.",
    ],
  },
  {
    name: "slot-count-three",
    result: "LAYOUT_BAD_SLOT_COUNT",
    summary: "A header claiming three slots per set on a device that has four keys.",
    bytes: layoutBytes({ slotCountByte: 3, entries: ONE_SET.map(setEntry) }),
    notes: [
      "The slot count is in the file although it can only ever be 4, and this is what it is for: it is the stride of everything after it, so a file written for a different device is refused rather than read at the wrong pitch.",
    ],
  },
  {
    name: "sets-past-max",
    result: "LAYOUT_BAD_LENGTH",
    summary: "A header claiming six sets on a device with room for five.",
    bytes: layoutBytes({
      setCountByte: 6,
      entries: Array.from({ length: 6 }, (_, i) => setEntry({
        name: `Set ${i}`, label: hash("11"),
        slots: [slot("21", "31"), slot("22", null), slot("23", null), slot("24", null)],
      })),
    }),
    notes: [
      "Refused for its length rather than for its count, and those are the same enum value: MAX_SETS is how much room the reader has, and a file naming more of them has no answer that fits.",
    ],
  },
  {
    name: "one-set-short",
    result: "LAYOUT_BAD_LENGTH",
    summary: "A header claiming two sets on a file holding one and a half.",
    bytes: layoutBytes({
      setCountByte: 2,
      entries: [
        setEntry({
          name: de.breakfast, label: hash("11"),
          slots: [slot("21", "31"), slot("22", null), slot("23", null),
                  slot("24", null)],
        }),
        Buffer.alloc(SET_BYTES - 1, 0x5a),
      ],
    }),
    notes: [
      "One byte short of what the header promises. The first set is complete and would read perfectly, and a reader parsing as far as it could would come up with one good set and no complaint - a device that works and is wrong about how much it is holding.",
    ],
  },
];

for (const refusal of REFUSALS) {
  layoutFixture({
    name: refusal.name,
    summary: refusal.summary,
    bytes: refusal.bytes,
    read: { result: refusal.result },
    notes: refusal.notes,
  });
}

// --- Byte 7, the one extension point -----------------------------------------

layoutFixture({
  name: "language-german",
  summary: "Byte 7 set to 1, which is German. The same firmware image, a different set of words on the menu.",
  bytes: layoutBytes({ entries: ONE_SET.map(setEntry), language: 1, sleep: 3600 }),
  read: readsAs({ sets: 1, language: 1, sleep: 3600, entries: ONE_SET }),
  write: writtenFrom({ language: "de", sleep: 3600, entries: ONE_SET }),
  notes: [
    "The language rides in the content and not in the program, which is why a translation needs no cable.",
  ],
});

layoutFixture({
  name: "language-past-the-table",
  summary: "Byte 7 set to 7, an index no table stands behind. The layout still parses; the words fall back to English.",
  bytes: layoutBytes({ entries: ONE_SET.map(setEntry), language: 7, sleep: 3600 }),
  read: {
    ...readsAs({ sets: 1, language: 7, sleep: 3600, entries: ONE_SET }),
    renders_language_index: 0,
  },
  notes: [
    "Two rules, separate on purpose. The layout reader takes byte 7 as it stands - what the number means is not its business. The text layer is where the fallback happens, and an index past the end of the table gives the default rather than a read past the end of it.",
    "A layout.bin from a newer builder must not be able to crash a device. This is the only field in the format where a newer builder can say anything at all, and it is possible because the byte was reserved and written as zero long before it meant anything, and zero was then made to mean the old behaviour. That trick is the format's whole forward compatibility, and here it is a stated rule rather than a comment in a header.",
    "No builder writes this file: LANGUAGE_CODES has two entries and an unknown language falls back to the default before the byte is ever written. So it has no write half - and it is a case a capture of the builder could never contain.",
  ],
});

// =============================================================================
// t<hash>.bin - the tile payload
// =============================================================================
//
// 128 by 128 pixels of RGB565, big-endian, no header, row by row from the top
// left. The size is in neither end of the file, so it is agreed here or by
// coincidence.

const TILE_W = 128;
const TILE_H = 128;
const TILE_BYTES = TILE_W * TILE_H * 2;

/** RGB888 to RGB565, the five-six-five truncation both ends do. */
const rgb565 = (r, g, b) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);

/** A tile whose every pixel says where it is.
 *
 * The 16-bit value at (x, y) is (y << 8) | x, so big-endian the two bytes are
 * literally [y, x]. Every way to get this wrong - rows and columns swapped,
 * the two bytes swapped, a stride a pixel out, rows bottom-up - moves a byte
 * this file can name.
 */
function addressTile() {
  const out = Buffer.alloc(TILE_BYTES);
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const at = (y * TILE_W + x) * 2;
      out[at] = y;
      out[at + 1] = x;
    }
  }
  return out;
}

const tileProbes = (pixels) => pixels.map(([x, y]) => ({
  x, y, byte: (y * TILE_W + x) * 2, value: hex(Buffer.from([y, x])),
}));

function tileFixture({ name, summary, artefact, expected, outcome = "accepted" }) {
  fixture({
    kind: "tile", name, dir: "tile", file: `${name}.bin`, artefact, outcome,
    summary,
    expected: {
      fixture: name, kind: "tile", file: `tile/${name}.bin`, summary,
      geometry: {
        width: TILE_W, height: TILE_H, encoding: "rgb565-be",
        bytes_per_pixel: 2, row_bytes: TILE_W * 2, conforming_bytes: TILE_BYTES,
      },
      bytes: artefact.length,
      ...expected,
    },
  });
}

tileFixture({
  name: "addressed",
  summary: "Every pixel spells out its own coordinates: the value at (x, y) is (y << 8) | x, so the bytes are [y, x].",
  artefact: addressTile(),
  expected: {
    conforming: true,
    read: {
      accepts: true,
      probes: tileProbes([[0, 0], [1, 0], [0, 1], [127, 0], [0, 127],
                          [127, 127], [63, 31]]),
    },
    write: null,
    notes: [
      "This is the fixture that says which way round the file is. A reader that transposes it reads (31, 63) where (63, 31) stands; one that swaps the two bytes reads 0x1f3f where 0x3f1f stands; one whose stride is a pixel out drifts by two bytes a row and is a whole row wrong by the bottom.",
      "Nothing here is a picture. What the browser's renderer makes of a real symbol is tests/reference/tiles.lock.json's business, and that lock never crossed this boundary - it compares one implementation against pixels frozen from a Pillow that is gone.",
    ],
  },
});

tileFixture({
  name: "solid-red",
  summary: "32768 bytes of 0xf800: pure red, and the value that says which way round the two bytes go.",
  artefact: Buffer.from(
    Array.from({ length: TILE_W * TILE_H }, () => [0xf8, 0x00]).flat()),
  expected: {
    conforming: true,
    read: {
      accepts: true,
      probes: [{ x: 0, y: 0, byte: 0, value: "f800" },
               { x: 127, y: 127, byte: TILE_BYTES - 2, value: "f800" }],
      colour: { rgb565: "f800", rgb888: [248, 0, 0] },
    },
    write: {
      // The other half of the number: a tile is these bytes because a colour
      // becomes this value, and the truncation is where the two could differ.
      rgb565_of: [
        { rgb: [255, 0, 0], value: hex4(rgb565(255, 0, 0)) },
        { rgb: [0, 255, 0], value: hex4(rgb565(0, 255, 0)) },
        { rgb: [0, 0, 255], value: hex4(rgb565(0, 0, 255)) },
        { rgb: [255, 255, 255], value: hex4(rgb565(255, 255, 255)) },
        { rgb: [0, 0, 0], value: hex4(rgb565(0, 0, 0)) },
        { rgb: [7, 3, 7], value: hex4(rgb565(7, 3, 7)) },
        { rgb: [8, 4, 8], value: hex4(rgb565(8, 4, 8)) },
        { rgb: [173, 51, 44], value: hex4(rgb565(173, 51, 44)) },
      ],
    },
    notes: [
      "Big-endian is the panel's order, not the machine's. The same file read the other way round is 0x00f8, a dark blue, and every tile on the device would be the wrong colour without a single byte being out of place.",
      "The last three are the truncation rather than the layout: 7, 3, 7 all round down to nothing and 8, 4, 8 are the first values of each channel that survive it.",
    ],
  },
});

{
  // An ODD number of bytes missing, so the cut lands inside a pixel and not
  // merely inside a row. That is the difference between a fixture that can
  // see the fill and one that only sees where the file stopped.
  const CUT = TILE_BYTES - 259;
  const short = Buffer.from(addressTile().subarray(0, CUT));
  const rowBytes = TILE_W * 2;
  const completeRows = Math.floor(CUT / rowBytes);

  /** What a pixel reads as once the fill has happened: the pattern where the
   *  file reached, and zero past it. Worked out from the cut rather than read
   *  back out of the bytes above - this file has no parser and must not grow
   *  one. */
  const filled = (x, y) => {
    const at = (y * TILE_W + x) * 2;
    return hex(Buffer.from([at < CUT ? y : 0, at + 1 < CUT ? x : 0]));
  };
  const probe = (x, y) => ({
    x, y, byte: (y * TILE_W + x) * 2, value: filled(x, y),
  });

  tileFixture({
    name: "short",
    summary: "259 bytes missing, so the cut lands inside a pixel. The reader zero-fills and says nothing.",
    artefact: short,
    expected: {
      conforming: false,
      read: {
        accepts: true,
        complete_rows: completeRows,
        partial_row: completeRows,
        bytes_in_partial_row: CUT - completeRows * rowBytes,
        blank_rows_from: completeRows + 1,
        // The counts above say WHERE the file ran out; these say what is
        // there instead, and only they can see the fill. A reader that drew
        // whatever happened to be in its row buffer would report exactly the
        // same counts and put the previous row on the panel - which is the
        // worst thing a truncated tile can look like, because it looks right.
        probes: [
          probe(125, completeRows),          // the last whole pixel
          probe(126, completeRows),          // one byte of the file, one of fill
          probe(127, completeRows),          // wholly fill, inside a row that arrived
          probe(0, completeRows + 1),        // a row that never arrived at all
          probe(127, TILE_H - 1),
        ],
      },
      write: null,
      notes: [
        "This is the format behaviour docs/device-interface.md section 1 says is written down nowhere. drawTile() reads a row at a time and zero-fills whatever did not arrive, so a truncated tile draws partly black and the device reports nothing at all.",
        "Stated rather than changed. A reader MAY draw what it has; a writer MUST NOT emit a file of any length but 32768. The gap this closes is that neither half was said out loud, not that the reader is wrong to be forgiving - a key that draws half a symbol is still a key somebody can press.",
        "Black is also what a missing file draws, so from across a room a truncated tile and an absent one look the same. That is the argument for the length rule living on the writer's side.",
      ],
    },
  });
}

tileFixture({
  name: "over-long",
  summary: "Sixteen bytes too many. The reader takes 32768 of them and never looks at the rest.",
  artefact: Buffer.concat([addressTile(), Buffer.alloc(16, 0xa5)]),
  expected: {
    conforming: false,
    read: {
      accepts: true,
      bytes_read: TILE_BYTES,
      probes: tileProbes([[0, 0], [127, 127]]),
    },
    write: null,
    notes: [
      "The reader stops after TILE_H rows, so the tail is never read and never drawn. Like the layout's trailing bytes, that is a floor and not an extension point: nothing would tell a reader what a longer file meant.",
    ],
  },
});

// =============================================================================
// a<hash>.wav - the audio payload
// =============================================================================

const WAV_SAMPLE_RATE = 16000;
const WAV_CHANNELS = 1;
const WAV_BITS = 16;

/** One RIFF chunk. An odd body is followed by a pad byte the size does not
 *  count, and a reader that forgets it lands one byte out. */
function chunk(id, body) {
  const head = Buffer.alloc(8);
  head.write(id, 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body,
                        body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function fmtChunk({ rate = WAV_SAMPLE_RATE, channels = WAV_CHANNELS,
                    bits = WAV_BITS } = {}) {
  const body = Buffer.alloc(16);
  body.writeUInt16LE(1, 0);                                    // PCM
  body.writeUInt16LE(channels, 2);
  body.writeUInt32LE(rate, 4);
  body.writeUInt32LE(rate * channels * (bits / 8), 8);         // byte rate
  body.writeUInt16LE(channels * (bits / 8), 12);               // block align
  body.writeUInt16LE(bits, 14);
  return chunk("fmt ", body);
}

/** A short deterministic ramp, so the samples are not all the same byte. */
function samples(count) {
  const out = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    out.writeInt16LE(((i * 257) % 8000) - 4000, i * 2);
  }
  return out;
}

function riff(...chunks) {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WAVE", 8, "latin1");
  return Buffer.concat([head, body]);
}

function audioFixture({ name, summary, artefact, read, write = null,
                        conforming, notes = [] }) {
  fixture({
    kind: "audio", name, dir: "audio", file: `${name}.wav`, artefact,
    outcome: read.accepts ? "accepted" : "refused",
    summary,
    expected: {
      fixture: name, kind: "audio", file: `audio/${name}.wav`, summary,
      bytes: artefact.length, conforming, read, write, notes,
    },
  });
}

{
  const body = samples(400);
  audioFixture({
    name: "spoken",
    summary: "What the build writes: 16 kHz mono 16-bit PCM, fmt then data, nothing else.",
    artefact: riff(fmtChunk(), chunk("data", body)),
    conforming: true,
    read: { accepts: true, data_offset: 44, data_bytes: body.length },
    write: {
      sample_rate: WAV_SAMPLE_RATE, channels: WAV_CHANNELS,
      bits_per_sample: WAV_BITS, format: "pcm",
    },
    notes: [
      "44 is 12 for the RIFF header, 8 + 16 for fmt, 8 for the data header. Stated as a number because a reader that walks the chunks and a reader that assumes 44 agree here and nowhere else - see extra-chunk.",
    ],
  });
}

{
  const body = samples(200);
  const list = chunk("LIST", Buffer.from("INFOISFTvorlau", "latin1").subarray(0, 13));
  audioFixture({
    name: "extra-chunk",
    summary: "A LIST chunk of odd length between fmt and data. The pad byte after it is what a reader has to step over.",
    artefact: riff(fmtChunk(), list, chunk("data", body)),
    conforming: false,
    read: { accepts: true, data_offset: 44 + 8 + 13 + 1, data_bytes: body.length },
    notes: [
      "Thirteen bytes of body, then one pad byte the size does not count. A reader that seeks by the size alone lands on the pad, reads the four bytes after it as a chunk id, and walks off the end of the file - and the key goes silent, with a line about it on a serial port nobody is watching.",
      "No builder emits this. It is here because a reader's tolerance is part of the format, and the only way to state it is to hand a reader something to tolerate.",
    ],
  });
}

{
  const body = samples(256);
  const head = Buffer.alloc(8);
  head.write("data", 0, "latin1");
  head.writeUInt32LE(body.length * 4, 4);        // four times what is there
  audioFixture({
    name: "data-longer-than-file",
    summary: "A data chunk claiming four times the samples the file actually holds.",
    artefact: riff(fmtChunk(), Buffer.concat([head, body])),
    conforming: false,
    read: {
      accepts: true, data_offset: 44,
      data_bytes_declared: body.length * 4,
      data_bytes_available: body.length,
    },
    notes: [
      "The reader believes the declared length and then runs out of file. What happens next is not in the acceptor at all - the player stops when a read comes back empty - so the word is short rather than wrong, and nothing says so.",
      "This is the audio half of the truncated tile: a short word and a black key are the two failures somebody would have to notice from the outside.",
    ],
  });
}

audioFixture({
  name: "stereo-44k",
  summary: "44.1 kHz stereo. The device accepts it - it never reads fmt - and plays it out at 16 kHz mono.",
  artefact: riff(fmtChunk({ rate: 44100, channels: 2 }), chunk("data", samples(300))),
  conforming: false,
  read: { accepts: true, data_offset: 44, data_bytes: 600 },
  notes: [
    "The reader walks past fmt like any other chunk. Rate, channel count and sample width are never looked at, so this file is taken and then played at the one rate I2S was started with: a word about a third as long as it should be, at the wrong pitch, in a voice nobody chose.",
    "A device that works and is wrong, which is the dangerous kind. The fixture records it as it stands rather than blessing it: a writer MUST emit 16 kHz mono 16-bit, and the reader as it is today does not check. Whether it should is a change to the firmware and a decision this fixture set does not make - it makes the decision visible.",
  ],
});

const AUDIO_REFUSALS = [
  {
    name: "not-riff",
    summary: "A file that is not a RIFF at all, under a .wav name.",
    artefact: Buffer.concat([Buffer.from("OggS", "latin1"), samples(100)]),
    notes: [
      "The name says what a file is for and the first four bytes say what it is. Only one of those is checked, and it is the right one.",
    ],
  },
  {
    name: "riff-not-wave",
    summary: "A RIFF whose form is AVI rather than WAVE.",
    artefact: (() => {
      const f = riff(fmtChunk(), chunk("data", samples(100)));
      f.write("AVI ", 8, "latin1");
      return f;
    })(),
    notes: [
      "Both halves of the twelve-byte header are checked, four bytes apart, which is why they are one refusal and not two.",
    ],
  },
  {
    name: "no-data-chunk",
    summary: "A well-formed WAV with a fmt chunk and no data chunk.",
    artefact: riff(fmtChunk(), chunk("LIST", Buffer.from("INFO", "latin1"))),
    notes: [
      "Walked to the end of the file without finding anything to play. Refused rather than played as silence: a key that says nothing and a key that is broken want telling apart.",
    ],
  },
  {
    name: "header-truncated",
    summary: "Eight bytes. Not even the RIFF header is whole.",
    artefact: Buffer.from("RIFF    ", "latin1"),
    notes: [
      "The first read asks for twelve and gets eight, and a reader that took what it got would compare four bytes of nothing against WAVE.",
    ],
  },
];

for (const refusal of AUDIO_REFUSALS) {
  audioFixture({
    name: refusal.name,
    summary: refusal.summary,
    artefact: refusal.artefact,
    conforming: false,
    read: { accepts: false },
    notes: refusal.notes,
  });
}

// =============================================================================
// The name rule
// =============================================================================
//
// Stated three times in the repository - hashBytes() reads a hash out of a
// name, hashPath() writes one, and cableNameOk() decides independently which
// names the device is willing to store. The third has to be a superset of the
// first two or a file silently never arrives, and nothing said so anywhere.

const NAME_HASH = "0123456789abcdef0123456789abcdef";
const AUDIO_HASH = "fedcba9876543210fedcba9876543210";

/**
 * One name.
 *
 * `emitted` is whether a conforming builder may produce this name; `stored`
 * is whether the device is willing to create, checksum or delete it. The
 * relation between the two is the rule: emitted implies stored, always.
 * `hash` is the sixteen bytes layout.bin carries for it, or null where the
 * name carries none. `path` is what the device opens it as - the same name
 * with a leading slash, which is also why the slash is not allowed inside it.
 */
const NAMES = [
  { what: "a tile", name: `t${NAME_HASH}.bin`, emitted: true, stored: true,
    hash: NAME_HASH, path: `/t${NAME_HASH}.bin` },
  { what: "a recording", name: `a${AUDIO_HASH}.wav`, emitted: true, stored: true,
    hash: AUDIO_HASH, path: `/a${AUDIO_HASH}.wav` },
  { what: "the layout, the one name that is not a hash", name: "layout.bin",
    emitted: true, stored: true, hash: null, path: "/layout.bin" },

  { what: "upper-case hex", name: `t${NAME_HASH.toUpperCase()}.bin`,
    emitted: false, stored: true, hash: null, path: null,
    note: "The device stores it happily and then looks for the lower-case spelling, so the file is on the device and the key is black. hashBytes() reads it as the same sixteen bytes, which is laxer than the rule and the reason this case is here." },
  { what: "half a hash", name: `t${NAME_HASH.slice(0, 16)}.bin`,
    emitted: false, stored: true, hash: null, path: null,
    note: "Exactly 32 hex digits, never fewer. hashBytes() takes what there is and leaves the rest of the sixteen bytes zero, so a short name is a hash that is quietly half zeroes and a slot pointing at a file that cannot exist." },
  { what: "an odd number of hex digits", name: `t${NAME_HASH.slice(0, 31)}.bin`,
    emitted: false, stored: true, hash: null, path: null,
    throws: true,
    note: "hashBytes() refuses this one rather than writing half a byte. It is the only one of the three malformed spellings that is caught today." },

  { what: "nothing at all", name: "", emitted: false, stored: false },
  { what: "a folder", name: `sets/t${NAME_HASH}.bin`, emitted: false, stored: false },
  { what: "the way out of the folder", name: "../layout.bin",
    emitted: false, stored: false },
  { what: "a bare walk up", name: "..", emitted: false, stored: false },
  { what: "the half-written file", name: ".part", emitted: false, stored: false },
  { what: "anything hidden", name: ".hidden", emitted: false, stored: false },
  { what: "a space in it", name: "two words.bin", emitted: false, stored: false },
  { what: "a byte above ASCII", name: "tileÿ.bin", emitted: false, stored: false },
  { what: "63 characters, the longest the device takes",
    name: "x".repeat(63), emitted: false, stored: true },
  { what: "64 characters", name: "x".repeat(64), emitted: false, stored: false },
];

fixture({
  kind: "names", name: "names", outcome: "accepted",
  summary: "Which names a builder may emit, which names the device will store, and the fact that the first set is inside the second.",
  expected: {
    fixture: "names", kind: "names",
    summary: "Which names a builder may emit, which names the device will store, and the fact that the first set is inside the second.",
    rule: {
      emitted: "A slash, then t or a, then exactly 32 lower-case hex digits, then .bin or .wav - or the literal name layout.bin. The 32 digits are the first sixteen bytes of a hash OF THE INPUT that produced the file, not of the file's own bytes.",
      stored: "One to 63 bytes, no leading dot, and every byte strictly between space and 0x7f, slash excluded.",
      superset: "Every name a builder emits must be a name the device will store. The two rules are written in different files, in different languages, by different hands, and a name that satisfies the first and not the second is a file that silently never arrives - no error anywhere, one black key.",
      path: "The device opens a stored name with a leading slash in front of it. Everything it holds lies flat in the root, which is why the slash may not appear inside a name.",
    },
    hash_bytes: HASH_BYTES,
    cases: NAMES.map((one) => ({
      what: one.what,
      name: one.name,
      emitted: one.emitted,
      stored: one.stored,
      hash: one.hash ?? null,
      path: one.path ?? null,
      hash_read_refused: Boolean(one.throws),
      note: one.note ?? null,
    })),
    notes: [
      "The three malformed spellings in the middle are the finding rather than the fixture. Two of them - upper case and a short hash - are accepted by hashBytes() and by cableNameOk(), so a builder emitting either would be caught by nothing at all until somebody looked at a black key. The rule is stated here; whether either end should enforce it is a change to the code and not to this file.",
    ],
  },
});

// =============================================================================
// The language enumeration
// =============================================================================
//
// A field of the layout header - byte 7, the index into the device's table -
// and not the panel texts themselves, which cross no boundary at all. This
// table replaces the regex tests/test_texts.py used to run over
// src/data/layout_format.ts: a regex over somebody else's file is a
// paraphrase, and docs/frozen-references.md has the account of what happened
// the last time a paraphrase stood in for an oracle.

fixture({
  kind: "language", name: "language", outcome: "accepted",
  summary: "Which language rides in which byte, what an unknown index means, and how many tables the device has to have.",
  expected: {
    fixture: "language", kind: "language",
    summary: "Which language rides in which byte, what an unknown index means, and how many tables the device has to have.",
    field: {
      file: "layout.bin", byte: 7, width: 1,
      meaning: "The index of the language the device labels its own menu in.",
    },
    languages: [
      { index: 0, code: "en" },
      { index: 1, code: "de" },
    ],
    default_index: 0,
    default_code: "en",
    unknown_index_falls_back_to: 0,
    rules: [
      "A writer given a language it has no index for writes the default index rather than refusing the layout. A Sammlung in a language the device cannot label its menu in is still a Sammlung, and its keys still speak.",
      "A reader hands byte 7 back as it stands. An index with no table behind it falls back to the default at the point the words are chosen, not at the point the file is parsed - so a layout.bin from a newer builder is read normally and merely labelled in English.",
      "Every index a builder can write must have a table behind it. That is the direction that matters: a builder with three languages and a device with two is a device reading past the end of an array.",
      "Byte 7 is reserved space that was given a meaning, and it is the only place in this format where that can happen. Zero was what a writer put there before the byte meant anything, and zero was then made to mean English, so a file from before the language existed still reads correctly. Any further use of reserved space follows the same rule, and it is the only thing a MINOR version may do.",
    ],
    notes: [
      "The panel texts themselves are not here and are not part of this interface. Ten characters a display, code page 437, the struct order against the initialiser order: none of that needs the browser, and tests/test_texts.py keeps all of it. Exactly one thing crosses, and it is this table.",
    ],
  },
});

// =============================================================================
// The sleep timeout
// =============================================================================
//
// A field of the layout header - bytes 8 to 11, a uint32 little-endian - and
// the one field in this format where what the bytes hold and what they MEAN
// come apart. The reader hands the number back untouched; the range below is
// what the device can actually wait, and the two ends of the field that lie
// outside it are the whole of L1 in docs/format-freeze.md.
//
// Stated as its own fixture rather than only inside the layout ones for the
// same reason names.expected.json exists: the relation between what a builder
// may emit and what the device honours is a rule, it is written in two
// languages in two files, and nothing was holding either end to it.

const SLEEP_CASES = [
  { what: "the unset field", sleep: 0, idle: SLEEP_DEFAULT, emitted: false,
    note: "Zero is what a writer leaves when it has nothing to say, and it means the default of 600 - not 'never sleep' and not 'sleep at once'. The device did this already, in a `? :` in vorlaut.ino with a bare 600 in it; what is new is that the number is written down once instead of twice." },
  { what: "one below the floor", sleep: SLEEP_MIN - 1, idle: SLEEP_MIN,
    emitted: false, note: null },
  { what: "the floor", sleep: SLEEP_MIN, idle: SLEEP_MIN, emitted: true,
    note: null },
  { what: "ten minutes, which is also the default", sleep: 600, idle: 600,
    emitted: true, note: "The default is inside the range, so a builder may write it and it means itself. Nothing distinguishes it from any other honoured value once it is in the field - only zero is special." },
  { what: "an hour", sleep: 3600, idle: 3600, emitted: true, note: null },
  { what: "the ceiling", sleep: SLEEP_MAX, idle: SLEEP_MAX, emitted: true,
    note: null },
  { what: "one past the ceiling", sleep: SLEEP_MAX + 1, idle: SLEEP_MAX,
    emitted: false, note: null },
  { what: "the largest wait that does not wrap", sleep: 4294967, idle: SLEEP_MAX,
    emitted: false, note: "4294967 * 1000 is the largest product that fits in a 32-bit unsigned long. Above this the device's own arithmetic gives a different length of time from the one written, which is why the range is narrower than the field rather than the field being the range." },
  { what: "the largest the field holds", sleep: 4294967295, idle: SLEEP_MAX,
    emitted: false, note: "136 years as written, and something else entirely once multiplied. See layout/sleep-timeout-max." },
];

fixture({
  kind: "sleep", name: "sleep", outcome: "accepted",
  summary: "The range of sleep timeouts a builder may write, what the device waits for everything else, and the fact that the first is inside the second.",
  expected: {
    fixture: "sleep", kind: "sleep",
    summary: "The range of sleep timeouts a builder may write, what the device waits for everything else, and the fact that the first is inside the second.",
    field: {
      file: "layout.bin", byte: 8, width: 4,
      meaning: "Seconds of no key pressed before the device goes into deep sleep. Little-endian, unsigned.",
    },
    min: SLEEP_MIN,
    max: SLEEP_MAX,
    default: SLEEP_DEFAULT,
    unset_value: 0,
    rules: [
      "A builder writes a timeout between 10 and 86400 inclusive, or zero to mean the default. The field is a uint32 and holds far more; the range is narrower than the field on purpose.",
      "A reader hands the four bytes back as they stand, unclamped. The same rule byte 7 follows: what a number means is settled where it is used, not where it is parsed. tests/reference/layout.lock.json has frozen this reader's answer for a field of 0 and one of 0xffffffff, and that lock cannot be rewritten.",
      "The device brings the field inside the range at the point it becomes a length of time - layoutIdleSeconds() in layout_format.h, which vorlaut.ino waits on. Zero means the default; anything below the floor means the floor; anything above the ceiling means the ceiling.",
      "Every timeout a builder emits must be one the device waits for exactly. That is the direction that matters and it is the same shape as the name rule's: a builder may emit fewer values than the device will take, and the one thing that must never happen is a builder emitting a number the device silently turns into a different one.",
      "The ceiling is not arbitrary. The device computes idle * 1000UL, which wraps where unsigned long is 32 bits, so a timeout above 4294967 seconds is neither honoured nor refused but quietly turned into some other number. 86400 is a day, which is the longest a talker sitting in a room has any use for, and it is comfortably below the wrap.",
    ],
    cases: SLEEP_CASES.map((one) => ({
      what: one.what,
      sleep_seconds: one.sleep,
      idle_seconds: one.idle,
      emitted: one.emitted,
      note: one.note ?? null,
    })),
    notes: [
      "The zero case is why this is a range with a hole in it rather than a plain clamp. Zero is below the floor and does not clamp to the floor - it means the default, which is sixty times larger. A reader that treated the field as a simple clamp would put a device to sleep ten minutes early on every file that leaves the field unset.",
      "Nothing here reaches a clock. That the device waits this long is not checked by any fixture and cannot be; what is checked is that both halves compute the same number of seconds from the same field.",
    ],
  },
});

// =============================================================================
// The cable
// =============================================================================
//
// Not a document but a conversation, so a fixture is a transcript: an ordered
// list of lines with a direction on each, together with the state it has to
// leave the device in.
//
// `ends` says which halves are held to a transcript, and it is there because
// some lines only one end can be asked about. A browser client never writes a
// verb the firmware does not have; a device formatter never writes a keyword
// it does not know. Each of those is exactly one direction of the cable's
// extension rule, and each can only be checked from the side that reads it.

const CABLE_VERSION = 2;
const CAPACITY = 1441792;

// The window a transcript's device announces in its "go", and the most file
// content it takes before answering "ack". Written here rather than taken from
// CABLE_WINDOW in the firmware, on purpose: what a fixture pins is one
// conversation, and a fixture that followed the header would move whenever the
// header did and could never hold a browser to reading the number it was given
// rather than one it assumed. A transcript may announce 256 where the firmware
// announces 4096 and both are conformant - `several-windows` below does.
const WINDOW = 4096;

const TILE_FILE = `t${NAME_HASH}.bin`;
const AUDIO_FILE = `a${AUDIO_HASH}.wav`;

/** A file's worth of bytes, deterministic and not all the same. */
function content(seed, length) {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = (i * 37 + seed) & 0xff;
  return out;
}

const host = (line) => ({ from: "host", line });
const device = (line) => ({ from: "device", line });
const raw = (bytes) => ({ from: "host", raw: b64(bytes), bytes: bytes.length });

/** A file's content as it really crosses: a window at a time, each window
 *  answered before the next one is sent.
 *
 * This is the shape of the whole change, and it is why a transcript is the
 * right thing to state it in. The rule is not "an ack per file" - it is that
 * the host has at most one window outstanding, which only an ordered list of
 * who-said-what can express. `at` is the running total the device sends back,
 * so a stream that slipped disagrees with itself out loud. */
function windows(bytes, window) {
  const steps = [];
  for (let at = 0; at < bytes.length; ) {
    const end = Math.min(at + window, bytes.length);
    steps.push(raw(bytes.subarray(at, end)));
    at = end;
    steps.push(device(`< ack ${at}`));
  }
  return steps;
}

/** A device line whose position among its neighbours is not specified.
 *
 * There is exactly one such run in this protocol - the "file" lines of a
 * listing - and it is here because the first draft of greet-and-list asserted
 * an order the format does not have. The device walks its directory and says
 * what it finds, and a file system does not promise an order; the C harness
 * next door happens to use a sorted map and so happens to be alphabetical,
 * which is precisely the sort of accident a fixture must not freeze.
 *
 * A run of these is compared as a multiset by whichever end reads it. What is
 * still ordered is that the run ends with "end list".
 */
const anyOrder = (line) => ({ from: "device", line, any_order: true });

function cableFixture({ name, summary, ends, start = [], steps, end = null,
                        script = null, notes = [], window = WINDOW,
                        spoken = CABLE_VERSION, verdict = "ok" }) {
  fixture({
    kind: "cable", name, dir: "cable", outcome: "accepted", summary,
    expected: {
      fixture: name, kind: "cable", summary,
      ends,
      // What this client speaks, and what the device in THIS transcript says
      // it speaks. Two fields because they are two facts, and the whole of C2
      // is that they were never compared: the browser read the second, tested
      // it for truthiness, and drove the device as though it were the first.
      protocol_version: CABLE_VERSION,
      device_speaks: spoken,
      // What the client must conclude from that pair before it sends anything
      // else. "ok" on every transcript that gets past hello, by construction.
      version_verdict: verdict,
      window,
      device_starts_with: start.map((f) => ({
        name: f.name, size: f.bytes.length, crc: hex8(crc32(f.bytes)),
        content: b64(f.bytes),
      })),
      capacity: CAPACITY,
      steps,
      device_ends_with: end,
      client_script: script,
      notes,
    },
  });
}

{
  const held = [
    { name: TILE_FILE, bytes: content(3, 640) },
    { name: "layout.bin", bytes: content(9, 196) },
  ];
  cableFixture({
    name: "greet-and-list",
    summary: "Hello, list, done. The whole of what a browser learns before it decides anything.",
    ends: ["device", "browser"],
    start: held,
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY - 640 - 196}`),
      device("< files 2"),
      device("< end hello"),
      host("> list"),
      anyOrder(`< file ${TILE_FILE} 640`),
      anyOrder("< file layout.bin 196"),
      device("< end list 2"),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: {
      files: held.map((f) => ({
        name: f.name, size: f.bytes.length, crc: hex8(crc32(f.bytes)),
      })),
      stored: 0, removed: 0, bytes: 0,
    },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY - 640 - 196, files: 2 } },
      { call: "list", returns: [{ name: TILE_FILE, size: 640 },
                                { name: "layout.bin", size: 196 }] },
      { call: "done", returns: { stored: 0, removed: 0, bytes: 0 } },
    ],
    notes: [
      "The device does no comparing. It says what it holds and the browser works out the difference, because the browser is the end with memory and a language to do it in.",
      "The two file lines are marked any_order, and that is a rule rather than a convenience. The device walks its directory and says what it finds; a file system promises no order, so the format promises none either. A browser must not depend on one - it holds the names in a map the moment it has them.",
      "This is the one place a fixture nearly froze an accident. The first draft listed them in the order they were written, the C harness holds its files in a sorted map and said them alphabetically, and the two disagreed - which is the fixture set doing its job on its first run, three fixtures in.",
    ],
  });
}

{
  const payload = content(11, 1024);
  const sum = crc32(payload);
  cableFixture({
    name: "put-one-file",
    summary: "One file across: the size and the checksum on the command line, the bytes between go and ok.",
    ends: ["device", "browser"],
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< files 0"),
      device("< end hello"),
      host(`> put ${AUDIO_FILE} ${payload.length} ${hex8(sum)}`),
      device(`< go ${WINDOW}`),
      ...windows(payload, WINDOW),
      device(`< ok ${AUDIO_FILE} ${payload.length}`),
      host("> done"),
      device("< bye 1 0 1024"),
    ],
    end: {
      files: [{ name: AUDIO_FILE, size: payload.length, crc: hex8(sum) }],
      stored: 1, removed: 0, bytes: payload.length,
    },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
      { call: "put", name: AUDIO_FILE, content: b64(payload),
        returns: { name: AUDIO_FILE, size: payload.length } },
      { call: "done", returns: { stored: 1, removed: 0, bytes: 1024 } },
    ],
    notes: [
      "The bytes follow the go with no newline in front of them and no newline after them. That is why a reader of this stream has to count rather than search: anything looking for the next command at a line start misses it after every file, and anything searching for the text of a command finds one inside a recording sooner or later.",
      "The checksum is of the file's own bytes and not of its name. The names are hashes of the INPUT that produced a file - the source picture and the pipeline version, the sentence and the voice - so a name proves which content was meant and never which arrived.",
      "The go carries a window and the ack carries a running total. The file fits inside one window here, so there is one of each - see several-windows for the cadence when it does not. What the pair is for is that the device writes to flash between them: the ack means the bytes are in the file system, and until it arrives the browser sends nothing, so a slow write costs time instead of the content that would have landed during it.",
    ],
  });
}

{
  const payload = content(5, 512);
  cableFixture({
    name: "skip-unknown-keyword",
    summary: "The device says two things the browser has never heard of. The browser steps over both and takes the ok.",
    ends: ["browser"],
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device("< spleen 4"),
      device(`< free ${CAPACITY}`),
      device("< files 0"),
      device("< end hello"),
      host(`> put ${TILE_FILE} ${payload.length} ${hex8(crc32(payload))}`),
      device(`< go ${WINDOW}`),
      raw(payload),
      device("< blether 7"),
      device(`< ack ${payload.length}`),
      device("< gap 12"),
      device("< quirk something entirely new"),
      device(`< ok ${TILE_FILE} ${payload.length}`),
    ],
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
      { call: "put", name: TILE_FILE, content: b64(payload),
        returns: { name: TILE_FILE, size: payload.length } },
    ],
    notes: [
      "This is the cable's extension rule, and it is the opposite of the layout's. A reader skips keywords it does not know, in both directions and on purpose, so a browser can gain a field without a device in a drawer falling over - and a device can gain one without a browser that has not been reloaded falling over.",
      "The browser half only, because the device's formatters cannot produce a keyword the device does not have. A firmware that gained one would have to gain a function to write it, and the fixture it would then be held to is this one with the line moved into the device half.",
      "'gap 12' is not invented: the firmware reports its timings that way already, and until it started doing so this client waited for exactly one line and would have read the first extra keyword as a failed transfer.",
      "'blether 7' sits where the browser is waiting for an ack, which is the one place the extension rule was newly at risk. A client that read the very next line as its acknowledgement would take 7 for a byte count, disagree with what it had sent, and fail a transfer that was going perfectly well.",
    ],
  });
}

// --- The version, told apart in both directions ------------------------------
//
// The two transcripts C2 was waiting for. Until 2026-08-27 the version was a
// field nothing read: `findTalker()` tested it for truthiness, so any non-zero
// number was accepted and the device was then driven as whatever the browser
// spoke. All eight cable fixtures said "< vorlaut 2" and none exercised a
// mismatch, so nothing that runs could tell a version 1 device from a version 2
// one - at a moment when both really existed, the acknowledged transfer having
// landed the same day.
//
// The browser half only, both of them, and that is a property of the protocol
// rather than a gap. The device announces CABLE_VERSION out of the header it
// was compiled from; it has no way to say a number that is not its own, so a
// firmware harness cannot produce either of these transcripts. What holds the
// device's end is the mutation "the protocol version moves", which every one of
// the transcripts below catches.
//
// Both stop after the greeting, which is the point. A refusal that arrives
// before anything is sent leaves the device exactly as it was.

for (const [name, spoken, verdict, summary, remedy] of [
  ["version-older-device", CABLE_VERSION - 1, "device_older",
   "A device one version behind this browser. It answers, and it cannot be driven.",
   "An older device needs newer firmware, and nothing else will do: the browser cannot fall back to a protocol it no longer implements, and a device on a shelf cannot be updated by a deploy."],
  ["version-newer-device", CABLE_VERSION + 1, "device_newer",
   "A device one version ahead of this browser. It answers, and it cannot be driven.",
   "A newer device means this page is the stale half - a tab open since before the last deploy, or a service worker holding an old bundle. Reloading is the remedy, and it is the opposite of the one above, which is why the two are told apart rather than sharing a sentence."],
]) {
  cableFixture({
    name,
    summary,
    ends: ["browser"],
    spoken,
    verdict,
    steps: [
      host("> hello"),
      device(`< vorlaut ${spoken}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< files 0"),
      device("< end hello"),
    ],
    script: [
      { call: "hello", returns: { version: spoken, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
    ],
    notes: [
      "hello() reads the greeting and does not refuse it. That is deliberate: the same call is how the browser tells a talker from a dongle, and a throw here would put a device that answered into the same bucket as a port that said nothing - which reads to whoever is holding the cable as 'nothing answered', and sends them to check the cable rather than the firmware.",
      "So the greeting is returned whole and the verdict is a separate answer, stated by this fixture as version_verdict and computed by versionVerdict() in tools/cable.js. What acts on it is findTalker() in src/backend/cable.ts, which keeps walking the remaining ports - somebody with two boards plugged in should still reach the one that works - and reports the mismatch only if no port is drivable.",
      remedy,
      "Refused rather than warned, in both directions. cable_format.h defines a bump as the case where the two ends can no longer drive each other, and says that adding a keyword is not one - unknown keywords cost no version at all. So a number that is not ours is a statement that these ends do not work together, and sending anyway means finding out mid-transfer: for version 2 that is a browser waiting forever for an ack, or a device overrun and failing on a checksum, either of which can leave a talker with silent keys.",
      "The transcript ends after 'end hello' because the browser sends nothing more. The other end of that rule is the runner's: a client that ran ahead has written bytes nobody asked for, and that is visible at the moment the device speaks.",
    ],
  });
}

{
  // The cadence, and the only fixture whose window is not the usual one.
  //
  // 256 is small enough that 640 bytes takes three of them and the last is a
  // remainder, which are the two things one window could never show: that the
  // browser sends the announced amount and waits, and that the end of the file
  // ends the window whether or not it is full.
  //
  // A different number from every other transcript on purpose. A browser that
  // had quietly kept a chunk size of its own would agree with all of them and
  // disagree with this one.
  const SMALL = 256;
  const payload = content(23, 640);
  const sum = crc32(payload);
  cableFixture({
    name: "several-windows",
    summary: "A file that takes three windows, the last of them short. The browser sends what it was told and waits to be told again.",
    ends: ["device", "browser"],
    window: SMALL,
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< files 0"),
      device("< end hello"),
      host(`> put ${TILE_FILE} ${payload.length} ${hex8(sum)}`),
      device(`< go ${SMALL}`),
      ...windows(payload, SMALL),
      device(`< ok ${TILE_FILE} ${payload.length}`),
      host("> done"),
      device(`< bye 1 0 ${payload.length}`),
    ],
    end: {
      files: [{ name: TILE_FILE, size: payload.length, crc: hex8(sum) }],
      stored: 1, removed: 0, bytes: payload.length,
    },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
      { call: "put", name: TILE_FILE, content: b64(payload),
        returns: { name: TILE_FILE, size: payload.length } },
      { call: "done", returns: { stored: 1, removed: 0, bytes: payload.length } },
    ],
    notes: [
      "This is the flow control, written down as the only thing that can express it: an order. The rule is not that a file is acknowledged - it is that the host never has more than one window outstanding, and no single line says that. Three sends and three acks, strictly alternating, does.",
      "The window is the device's number and the browser must take it off the wire. The device is the end that knows how much room it has; a browser choosing for itself is the guess this replaced. 256 here against 4096 in every other transcript is what makes a client that ignored it fail rather than pass by luck.",
      "The last window is 128 bytes and is acknowledged like the others. The end of the file ends the window, so there is no full-or-partial case to get wrong on either side - cable.h acks on `got - acked >= window || got == size` and the browser sends `min(window, what is left)`.",
      "The acks carry a running total rather than the size of the piece. A per-piece count would agree with itself all the way down a stream that had slipped; a total disagrees with what the browser has sent, at the first window, out loud.",
      "What this cannot show is the part it exists for. There is no clock in a transcript, so nothing here proves the device was busy between an ack and the next window - only that it said so in the right places. The timing is docs/cable.md's table and a board on a desk.",
      "No gap and no stall here, for that same reason and not by oversight. Both are held to the device end, and the harness that plays the device end has no clock to produce them with - a fixture that carried them would be asking a compiled header for a measurement. They appear in skip-unknown-keyword, which is the browser's end only, where what is being asked is whether they are stepped over.",
    ],
  });
}

{
  // A payload whose checksum begins with a zero byte, which is the only kind
  // that can tell "%08lx" from "%lx". Every other value in this repository
  // happens to have eight significant digits, and a format string that lost
  // its padding agreed with all of them - which is a fault that was caught
  // once already, by tools/cablemutate.py, and would be uncatchable here
  // without this file.
  const held = content(39, 64);
  const sum = crc32(held);
  if ((sum >>> 24) !== 0) {
    throw new Error("this fixture is only worth anything if the checksum has "
                    + "a leading zero byte");
  }
  cableFixture({
    name: "checksum-with-a-leading-zero",
    summary: "A checksum whose top byte is zero, asked for by name. Eight digits always, lower case always.",
    ends: ["device", "browser"],
    start: [{ name: TILE_FILE, bytes: held }],
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY - held.length}`),
      device("< files 1"),
      device("< end hello"),
      host(`> crc ${TILE_FILE}`),
      device(`< crc ${TILE_FILE} ${hex8(sum)}`),
    ],
    end: {
      files: [{ name: TILE_FILE, size: held.length, crc: hex8(sum) }],
      stored: 0, removed: 0, bytes: 0,
    },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY - held.length, files: 1 } },
      { call: "crc", name: TILE_FILE, returns: hex8(sum) },
    ],
    notes: [
      "Always eight digits, always lower case, so the browser can compare the text rather than having to parse it first. A value that lost its padding would be four digits here and eight everywhere else, and the file would be sent again on every release for as long as nobody looked.",
      "This is the one file on the device whose name does not say what is in it - every other name is a hash, so it answers the question by existing. layout.bin keeps its name when its content changes, which is the whole reason the crc verb is in the protocol.",
    ],
  });
}

{
  cableFixture({
    name: "unknown-verb",
    summary: "A verb from a newer browser. Answered with an error, not ignored.",
    ends: ["device"],
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< files 0"),
      device("< end hello"),
      host("> reboot"),
      device("< err verb"),
      host("> hello 2 please"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< files 0"),
      device("< end hello"),
      host("menu opened"),
      host("< end hello"),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    notes: [
      "The other half of the extension rule, and the reason it is not simply 'skip everything'. An unknown KEYWORD in an answer is stepped over; an unknown VERB in a command is refused out loud, because a browser waiting for a reply that never comes looks exactly like a broken cable and the two want telling apart.",
      "'hello 2 please' is complete. A verb that takes no arguments ignores what follows rather than refusing it, so a later browser may start saying something there.",
      "The two unmarked lines are the device's own serial log and the browser's own echo, on the same wire. Both are read as nothing at all. That is what the sigils are for, and it is why a device is deaf to a serial monitor somebody left open.",
    ],
  });
}

{
  cableFixture({
    name: "refused-before-hello",
    summary: "Nothing gets in before a hello has been answered - and the refusal is the way back in, not the end of the session.",
    ends: ["device"],
    steps: [
      host("> list"),
      device("< err session"),
      host("> rm layout.bin"),
      device("< err session"),
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< files 0"),
      device("< end hello"),
      host("> list"),
      device("< end list 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    notes: [
      "One state, not two: a session starts ungreeted and a transfer given up on returns it to exactly that. Both stand-ins for the device had drifted off this in the same direction once, each guarding only the second half, so neither could catch the other.",
    ],
  });
}

{
  const payload = content(7, 300);
  cableFixture({
    name: "names-and-errors",
    summary: "A name the device will not touch, a file that arrived wrong, and a file with no room for it.",
    ends: ["device"],
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< files 0"),
      device("< end hello"),
      host("> rm ../secrets"),
      device("< err bad"),
      host("> rm sets/layout.bin"),
      device("< err bad"),
      host("> rm .part"),
      device("< err bad"),
      host(`> put ${TILE_FILE} ${payload.length} 00000000`),
      device(`< go ${WINDOW}`),
      ...windows(payload, WINDOW),
      device(`< err crc ${TILE_FILE}`),
      host(`> put ${AUDIO_FILE} ${CAPACITY + 1} deadbeef`),
      device(`< err nospace ${AUDIO_FILE}`),
      host("> crc layout.bin"),
      device("< err missing layout.bin"),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    notes: [
      "Nothing is left behind by any of these. A refused checksum throws the half-written file away and nothing appears under the real name, which is why the device ends holding nothing at all.",
      "The bad file is acknowledged and THEN refused, in that order, because the acknowledgement is about the bytes arriving and says nothing about whether they were the right ones. cable.h acks inside the loop that reads the file and only looks at the checksum once that loop has run out of file, so an ack before an err crc is not a contradiction - it is the only order there is.",
      "The no-space refusal comes BEFORE the go, so the browser never starts sending. That is the whole reason go exists as a step of its own.",
      "One word for what went wrong and an optional second for whoever is reading. The first word is what a browser acts on; the second is for a person.",
    ],
  });
}

// =============================================================================

const INDEX = {
  device_interface_version: "0.1.0-draft",
  generated_by: "device/tools/make_fixtures.mjs",
  fixtures: index,
};
writeFileSync(join(OUT, "index.json"), JSON.stringify(INDEX, null, 2) + "\n");

process.stdout.write(`${index.length} fixtures written to device/fixtures/\n`);
