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
import { createHash } from "node:crypto";
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
const LAYOUT_VERSION = 3;
const LAYOUT_HEADER_BYTES = 12;
const NAME_BYTES = 32;
const HASH_BYTES = 16;
const SLOTS_PER_SET = 4;
/** The set key beside the four speech keys - the five panels the device
 *  lights. It was a picture and nothing else until version 3. */
const KEYS_PER_SET = SLOTS_PER_SET + 1;
const KEY_BYTES = HASH_BYTES + HASH_BYTES + 1 + 1 + 1 + 1;   // 36
const SET_BYTES = NAME_BYTES + KEYS_PER_SET * KEY_BYTES;     // 212

/** How much room a conforming reader has. Stated here from the rule rather
 *  than read out of either implementation, which is what makes the pair
 *  sets-at-max / sets-past-max say something about both. */
const MAX_SETS = 64;

/** What a key does, as the byte spells it. The editor's three names for these
 *  are Wort, Wort & weiter and weiter. */
const SPEAK = 0;
const SPEAK_AND_GO = 1;
const GO = 2;

/** Whether a key says its own word: anything but "go" does. */
const keySpeaks = (does) => does !== GO;

/** Which set a key really goes to, or -1 for none. Two ways to go nowhere and
 *  one answer: a key that does not navigate, and a target no set stands
 *  behind. */
const keyGoesTo = (does, target, sets) =>
  (does !== SPEAK_AND_GO && does !== GO) || target >= sets ? -1 : target;

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
 * One key, 36 bytes: two hashes, the has-audio flag, what the key does, where
 * it goes, and one byte spare.
 *
 * `reserved` is that spare byte. A writer puts zero there; what a reader does
 * with anything else is exactly the kind of thing that is written down
 * nowhere, so one fixture below sets it.
 */
function keyBytes(one) {
  const bytes = Buffer.concat([
    one.image, one.audio,
    Buffer.from([one.hasAudio ?? 0, one.does ?? SPEAK, one.target ?? 0,
                 one.reserved ?? 0]),
  ]);
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`key is ${bytes.length} bytes, not ${KEY_BYTES}`);
  }
  return bytes;
}

/**
 * One set entry, 212 bytes: the name, the set key, and the four speech keys.
 *
 * The set key comes first, where the label hash sat in version 2 - so a
 * version-2 entry is this one with twenty bytes taken out of the middle of it
 * and two off the end of every speech key, which is what
 * tests/test_layout_frozen.py has to derive in the other direction.
 */
function setEntry({ name, key, slots }) {
  const entry = Buffer.concat(
    [nameField(name), keyBytes(key), ...slots.map(keyBytes)]);
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

/** One key as a reader must hand it back.
 *
 * The two fields the file holds, then the two answers they mean. Both halves,
 * the way sleep_seconds and idle_seconds are both halves: a reader that
 * quietly repaired a value it did not know would give the right meaning and
 * the wrong field, and no fixture holding only one of them could say so.
 */
const keyAsRead = (one, sets) => ({
  image: hex(one.image),
  audio: hex(one.audio),
  has_audio: Boolean(one.hasAudio),
  does: one.does ?? SPEAK,
  target: one.target ?? 0,
  speaks: keySpeaks(one.does ?? SPEAK),
  goes_to: keyGoesTo(one.does ?? SPEAK, one.target ?? 0, sets),
});

/**
 * A layout, pressed - the joining game played with no display and no clock.
 *
 * `presses` is a list of key indices with a word about each: 0 to 3 are the
 * speech keys and SLOTS_PER_SET is the set key, which is the fifth key of a
 * set and the fifth panel on the device. What comes out is what any conforming
 * device must do with them, one line per press.
 *
 * Derived here from the two rules above - keySpeaks and keyGoesTo - and from
 * the key's own has-audio flag, and from nothing else. There is no model of a
 * device in this file and there must not be one: the walk is the fixture's
 * arithmetic over the fields it already states, which is why it can be put to
 * a firmware and to a browser without either being what produced it.
 *
 * Where a walk cannot go is time. The pause after a word and the deafness
 * after a board change have no place in a list of presses - they are
 * press.expected.json, and this is the half about which board you end up on.
 */
function walkOf(entries, sets, presses) {
  let at = 0;
  return {
    starts_at: 0,
    presses: presses.map((one, nth) => {
      const key = one.key === SLOTS_PER_SET ? entries[at].key
                                            : entries[at].slots[one.key];
      const does = key.does ?? SPEAK;
      const plays = keySpeaks(does) && Boolean(key.hasAudio)
        ? `/${audioName(key.audio)}` : null;
      const goes = keyGoesTo(does, key.target ?? 0, sets);
      const from = at;
      if (goes >= 0) at = goes;
      return {
        press: nth,
        what: one.what,
        on_set: from,
        key: one.key,
        plays,
        goes_to: goes,
        now_on_set: at,
      };
    }),
  };
}

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
      key: keyAsRead(entry.key, sets),
      slots: entry.slots.map((one) => keyAsRead(one, sets)),
    })),
  };
}

/** The builder input, in the shape renderLayoutBin() takes it.
 *
 * What each key DOES and where it GOES rides on the layout rather than on a
 * list of file names, because it is a fact about the key and not about a file
 * a compiler resolved. The two lists beside it are the set key's tile and the
 * set key's recording - `label` and `label_sounds`, one entry per set.
 */
function writtenFrom({ language, sleep, entries }) {
  return {
    layout: {
      language,
      sleep_timeout_seconds: sleep,
      sets: entries.map((entry) => ({
        name: entry.name,
        key: { does: doesWord(entry.key.does ?? SPEAK),
               target: entry.key.target ?? 0 },
        slots: entry.slots.map((one) => ({
          does: doesWord(one.does ?? SPEAK), target: one.target ?? 0,
        })),
      })),
    },
    label: entries.map((entry) => tileName(entry.key.image)),
    label_sounds: entries.map((entry) =>
      (entry.key.hasAudio ? audioName(entry.key.audio) : "")),
    images: entries.map((entry) => entry.slots.map((s) => tileName(s.image))),
    sounds: entries.map((entry) =>
      entry.slots.map((s) => (s.hasAudio ? audioName(s.audio) : ""))),
  };
}

/** The word a builder says for a byte. KEY_DOES in
 *  loader/src/layout_format.ts is the same table from the other side. */
const doesWord = (does) =>
  does === GO ? "go" : does === SPEAK_AND_GO ? "speak-and-go" : "speak";

/**
 * The layout fixture, both directions at once.
 *
 * `read` is what any reader must produce, and every fixture has one. `write`
 * is the builder input a conforming writer must turn into exactly these
 * bytes, and it is null wherever no writer can produce the file: every
 * refusal, and every case that lies about a reserved byte.
 */
function layoutFixture({ name, summary, bytes, read, write = null, walk = null,
                        notes = [] }) {
  fixture({
    kind: "layout", name, dir: "layout", file: `${name}.bin`, artefact: bytes,
    outcome: read.result === "ok" ? "accepted" : "refused",
    summary,
    expected: {
      fixture: name, kind: "layout", file: `layout/${name}.bin`,
      summary, bytes: bytes.length, read, write, walk, notes,
    },
  });
}

const slot = (image, audio) => ({
  image: hash(image),
  audio: audio ? hash(audio) : NO_HASH,
  hasAudio: audio ? 1 : 0,
});

/** The set key of set `at`, in a layout of `sets`, doing what set keys did
 *  before the file could say it: no word of its own, and on to the next set,
 *  round to the first from the last. A one-set layout points at itself, which
 *  is `(current + 1) % 1` and is a key that visibly does nothing. */
const ringKey = (image, at, sets) => ({
  image: hash(image),
  audio: NO_HASH,
  hasAudio: 0,
  does: GO,
  target: (at + 1) % sets,
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
  key: ringKey("11", 0, 1),
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
    key: ringKey(`4${i}`, i, names.length),
    slots: [slot(`5${i}`, `6${i}`), slot(`7${i}`, null),
            slot(`8${i}`, `9${i}`), slot(`a${i}`, `b${i}`)],
  }));
  layoutFixture({
    name: "five-sets",
    summary: "Five sets, each with its own name, its own key and four slots. 1072 bytes.",
    bytes: layoutBytes({ entries: entries.map(setEntry), language: 1, sleep: 900 }),
    read: readsAs({ sets: 5, language: 1, sleep: 900, entries }),
    write: writtenFrom({ language: "de", sleep: 900, entries }),
    notes: [
      "12 + 5 * 212. Five was MAX_SETS until 2026-08-31 and this fixture was the largest file that parses; it is now an ordinary layout of five sets, and sets-at-max is the one at the edge.",
      "The five set keys are the ring: each goes to the next and the last comes back round to the first. That was arithmetic in the device before version 3 and it is a field now, so it is a thing a fixture can be wrong about.",
    ],
  });
}

{
  // Every set the reader has room for. The bytes are dull on purpose - what
  // this fixture is about is the count and the length, and a name or a hash
  // worth looking at would only make the diff harder to read.
  const entries = Array.from({ length: MAX_SETS }, (_, i) => {
    const at = (n) => ((i * 5 + n) & 0xff).toString(16).padStart(2, "0");
    return {
      name: `Set ${i + 1}`,
      nameText: `Set ${i + 1}`,
      key: ringKey(at(0), i, MAX_SETS),
      slots: [slot(at(1), at(1)), slot(at(2), null),
              slot(at(3), at(3)), slot(at(4), null)],
    };
  });
  layoutFixture({
    name: "sets-at-max",
    summary: "MAX_SETS sets, which is 64. The largest file that parses.",
    bytes: layoutBytes({ entries: entries.map(setEntry), sleep: 900 }),
    read: readsAs({ sets: MAX_SETS, language: 0, sleep: 900, entries }),
    write: writtenFrom({ language: "en", sleep: 900, entries }),
    notes: [
      "12 + 64 * 212 = 13580 bytes. One set more is refused rather than truncated - see sets-past-max, which is this file plus one entry.",
      "MAX_SETS is not in the file. It is how much room the reader has, and a reader with less of it than this refuses a layout a conforming builder wrote - so the number is not a detail of one implementation but a thing both ends have to know. This fixture and sets-past-max are how it is stated without either end reading the other.",
      "It was five until 2026-08-31 and adr/0020 is why it is 64: a set is a round of the joining game, twenty rounds is a session, and the file partition runs out somewhere near forty rounds while SRAM would hold hundreds.",
    ],
  });
}

// --- What a key does, and where it goes --------------------------------------

{
  // Two rounds of the joining game, which is the thing version 3 exists for.
  // The set key shows the two halves and says them; one of the four speech
  // keys carries the word they make and is the only key on the board that
  // goes anywhere. There is no notion of "right" here and there must not be:
  // what the file says is that one key goes to the next round, and being the
  // only one that does is what makes it the answer.
  const round = (at, halves, sets) => ({
    name: halves,
    nameText: halves,
    key: {
      image: hash(`${at}0`), audio: hash(`${at}1`), hasAudio: 1,
      // The set key SPEAKS and goes nowhere, where a talker's set key goes to
      // the next set. That is the whole of "it only goes on with the right
      // key": if this key still cycled, every round would have a way out of it
      // that has nothing to do with the word.
      does: SPEAK, target: 0,
    },
    slots: [
      // `at` is the round, counted from one, so the set it sits in is at - 1
      // and the round after it is at % sets.
      { ...slot(`${at}2`, `${at}2`), does: SPEAK_AND_GO, target: at % sets },
      slot(`${at}3`, `${at}3`),
      slot(`${at}4`, `${at}4`),
      slot(`${at}5`, null),
    ],
  });
  // The words themselves are in the package fixture next door, where a key has
  // text on it. What reaches layout.bin is hashes, so what this file can say
  // about a round is its shape.
  const entries = [round(1, de.mirror_egg, 2), round(2, de.sun_flower, 2)];
  // The second round's set key is the ring key a talker writes, so all three
  // values of the field are in one file: SPEAK on a set key that says a word,
  // SPEAK_AND_GO on the key that carries the answer, and GO on a key that
  // switches sets and says nothing.
  entries[1].key = ringKey("20", 1, 2);
  layoutFixture({
    name: "keys-that-go",
    summary: "Two rounds of the joining game: a set key that speaks and stays, one speech key per round that speaks and goes on, and a set key that goes and says nothing.",
    bytes: layoutBytes({ entries: entries.map(setEntry), language: 1, sleep: 600 }),
    read: readsAs({ sets: 2, language: 1, sleep: 600, entries }),
    write: writtenFrom({ language: "de", sleep: 600, entries }),
    walk: walkOf(entries, 2, [
      { key: SLOTS_PER_SET, what: "the set key of the first round, which says the two halves and stays where it is" },
      { key: 2, what: "a key that is not the answer: it says its own word and the board does not move" },
      { key: 0, what: "the key that carries the word the halves make - the only one on this board that goes anywhere" },
      { key: 3, what: "a key with no recording behind it. Nothing is played and nothing moves, which is a key that is visibly doing nothing rather than one that quietly did something" },
      { key: SLOTS_PER_SET, what: "the second round's set key, which is a ring key: it says nothing at all and goes back to the first round" },
      { key: 0, what: "and the first round's answer again, so the chain is walked twice rather than once" },
    ]),
    notes: [
      "All three values of the field, in one file. 0 is speak, 1 is speak and then go, 2 is go without speaking - and the third is what a set key has always done, written down for the first time rather than left to `(current + 1) % setCount` in the firmware.",
      "The first round's set key carries a recording, which no set key could before: the fifth panel is a key like the other four now, with a picture, a word, a sound and a target of its own.",
      "Every key that goes nowhere still carries a target byte, and it is zero. The field is written either way and a reader only looks at it when `does` says to - the same 'meaningless rather than absent' the has-audio flag has beside a hash of zeros.",
    ],
  });
}

{
  // A key that goes somewhere AND carries a recording. `does` says go, so the
  // recording is never played - and the file holds it anyway.
  //
  // The two fields are independent and this is the only file where they
  // disagree in this direction. The other direction is everywhere: a key that
  // means to speak and has no sound behind it is one-set's third slot, and a
  // silent distractor in four-rounds. What was missing is a sound that is on
  // the device, named by a key, and correctly never heard.
  const entries = [0, 1].map((i) => ({
    name: `Set ${i + 1}`,
    nameText: `Set ${i + 1}`,
    key: {
      image: hash(`e${i}`), audio: hash(`f${i}`), hasAudio: 1,
      does: GO, target: (i + 1) % 2,
    },
    slots: [slot(`e${i}`, `f${i}`), slot(`c${i}`, null),
            slot(`d${i}`, `d${i}`), slot(`b${i}`, null)],
  }));
  layoutFixture({
    name: "a-sound-behind-a-key-that-goes",
    summary: "A set key whose `does` is go and which carries a recording all the same. The sound is on the device, named by the key, and never played.",
    bytes: layoutBytes({ entries: entries.map(setEntry), sleep: 600 }),
    read: readsAs({ sets: 2, language: 0, sleep: 600, entries }),
    write: writtenFrom({ language: "en", sleep: 600, entries }),
    walk: walkOf(entries, 2, [
      { key: SLOTS_PER_SET, what: "the set key. It goes to the other set and says nothing, though there is a recording behind it - `does` decides, not the has-audio flag" },
      { key: 0, what: "a speech key on the set it arrived at, which is the walk saying which board that was" },
      { key: SLOTS_PER_SET, what: "and back again, silently, the same way" },
    ]),
    notes: [
      "Whether a word comes out is two fields and one answer, and the two can disagree. `does` is the one that decides: a key that goes without speaking stays silent however much sound is named beside it. A device that played it would say a word at a moment nobody asked for one, in the half-second before the board changes.",
      "It is not refused, and must not be. A spare recording is a file that costs space and nothing else; refusing the layout over it would take away the whole board. The device stores the file, never opens it, and says nothing about either - which is the same treatment a picture nothing references gets.",
      "The pair this completes: one-set's third slot is a key that means to speak with no sound behind it, and this is a key with a sound behind it that means not to speak. Both come out silent, by two different routes, and a reader that collapsed the two fields into one would get exactly one of them right.",
    ],
  });
}

{
  // Four rounds that lead into one another and come back round to the first -
  // a whole small game rather than a file with the three field values in it.
  //
  // keys-that-go above says what one key does. This says what a device does,
  // and they are not the same claim: a chain is where being off by one, or
  // moving before the finger came off, or reading the answer off the set the
  // press started on rather than the set it ended on, all stop being invisible.
  // Four rounds because three would let a device that always went to set 0
  // pass two of the four hops, and because the answer sits at a different one
  // of the four keys in every round - a device that had quietly decided the
  // first key is the answer gets one round right and then stops.
  //
  // Nothing here is a game mode. Every round is a set, every set key says its
  // halves and stays, and the only way on is the one key of the four that goes
  // anywhere. There is no counter, no memory of the round before, and no way
  // to be stuck: whatever is pressed, the device is on a board with a way out
  // of it.
  const ROUNDS = [de.mirror_egg, de.sun_flower, de.hand_shoe, de.fire_defence];
  // Eight hash seeds per round, of which six are used: the set key's picture
  // and sound, and one for each of the four keys below it. Spaced so that a
  // fixture diff shows at a glance which round a byte belongs to.
  const seed = (round, nth) =>
    (0x30 + round * 8 + nth).toString(16).padStart(2, "0");
  const entries = ROUNDS.map((halves, i) => ({
    name: halves,
    nameText: halves,
    // The set key speaks and stays, the way the first round of keys-that-go
    // does. A set key that switched anyway would be a way past every round
    // that has nothing to do with the word, which is the one gesture this
    // device deliberately does not have.
    key: {
      image: hash(seed(i, 0)), audio: hash(seed(i, 1)), hasAudio: 1,
      does: SPEAK, target: 0,
    },
    slots: [0, 1, 2, 3].map((j) => {
      // The answer moves round the board: key 1 in the first round, key 2 in
      // the second, and so on. Nothing in the format says it has to, and a
      // device is not allowed to notice that it usually does.
      if (j === i) {
        return {
          image: hash(seed(i, 2 + j)), audio: hash(seed(i, 2 + j)), hasAudio: 1,
          does: SPEAK_AND_GO, target: (i + 1) % ROUNDS.length,
        };
      }
      // One key in the third round has no recording: a distractor that is
      // silent because there is nothing to play, not because its `does` said
      // so. The two are one answer on the device and two fields in the file.
      const silent = i === 2 && j === 0;
      return slot(seed(i, 2 + j), silent ? null : seed(i, 2 + j));
    }),
  }));
  layoutFixture({
    name: "four-rounds",
    summary: "Four rounds of the joining game, chained: every round's answer key leads to the next and the last leads back to the first. The answer sits at a different key in each round.",
    bytes: layoutBytes({ entries: entries.map(setEntry), language: 1, sleep: 600 }),
    read: readsAs({ sets: 4, language: 1, sleep: 600, entries }),
    write: writtenFrom({ language: "de", sleep: 600, entries }),
    walk: walkOf(entries, ROUNDS.length, [
      { key: SLOTS_PER_SET, what: "the halves of the first round, said out loud. The set key is a key like the others and this is the one thing it does" },
      { key: 1, what: "a wrong key in the first round. It says its own word, which is the whole of what happens" },
      { key: 0, what: "the first round's answer, which is its first key" },
      { key: 3, what: "a wrong key in the second round, to say that arriving somewhere new did not make the next press special" },
      { key: 1, what: "the second round's answer, which is its second key - a device that had decided the answer is key 0 stops here" },
      { key: 0, what: "the third round's silent distractor: nothing is played and the board does not move" },
      { key: SLOTS_PER_SET, what: "the third round's halves, said again. Pressing the set key mid-round is the thing a child does when she has forgotten the question" },
      { key: 2, what: "the third round's answer, which is its third key" },
      { key: 3, what: "the fourth round's answer, which leads back to the first - the ring closed by four keys rather than by a modulo in the firmware" },
      { key: SLOTS_PER_SET, what: "and the first round's halves again, which is how a walk says it really came back to where it started rather than to somewhere that looks like it" },
    ]),
    notes: [
      "A round is a set and the game is the chain between them. Nothing in layout.bin says 'round', 'answer' or 'right' - the answer key is the only key on the board whose `does` is speak-and-go, and everything the device does with that is in this walk.",
      "The last round leads back to the first, so this file has no end and needs none. A round nothing leads out of would be a device a child cannot get off without the menu, and the format allows one - keys-that-go's first round is exactly that until its ring key is pressed. What makes this file the one to walk is that it never puts the device anywhere it cannot leave.",
      "The answer is at key 1 in the first round, key 2 in the second, key 3 in the third and key 4 in the fourth. That is not a rule of the format and no builder has to do it: it is here so that a device deciding for itself which key is the answer fails on the second hop rather than never.",
      "One key in the third round has no recording, and it is a distractor rather than the answer. Its `does` says speak and its has-audio flag says there is nothing to speak, so the device plays nothing and stays - which is the same outcome as a key that says nothing by instruction, reached the other way round.",
    ],
  });
}

{
  const entries = ONE_SET.map((entry) => ({
    ...entry,
    slots: entry.slots.map((one, at) =>
      (at === 1 ? { ...one, does: 7, target: 0 } : one)),
  }));
  layoutFixture({
    name: "key-does-past-the-table",
    summary: "A key whose `does` is 7, a value no version has given a meaning. It speaks and stays where it is.",
    bytes: layoutBytes({ entries: entries.map(setEntry), sleep: 3600 }),
    read: readsAs({ sets: 1, language: 0, sleep: 3600, entries }),
    walk: walkOf(entries, 1, [
      { key: 1, what: "the key whose `does` is 7. It says its own word and stays put, which is what every key of a version-2 layout did" },
    ]),
    notes: [
      "The same shape as language-past-the-table and the same reason. A reader hands the field back as it stands - what the number means is not the parser's business - and the meaning is settled beside it, where an index past the end of the table gives the old behaviour rather than a read past the end of it.",
      "The old behaviour is the one a version-2 key had: it says its own word and goes nowhere. So a layout from a builder that knows a fourth value cannot strand a child on a board or send them somewhere arbitrary. It can only make a key quieter than its author meant.",
      "No builder writes this file. KEY_DOES has three entries and a word that is not in it is refused before the byte is written - which is where this differs from the language, whose unknown value falls back rather than refusing. A device with the wrong menu language still works; a key doing something other than what its layout meant does not.",
    ],
  });
}

{
  const entries = ONE_SET.map((entry) => ({
    ...entry,
    key: { ...entry.key, does: GO, target: 3 },
  }));
  layoutFixture({
    name: "key-goes-past-the-last-set",
    summary: "A set key pointing at set 3 in a layout that holds one. It goes nowhere.",
    bytes: layoutBytes({ entries: entries.map(setEntry), sleep: 3600 }),
    read: readsAs({ sets: 1, language: 0, sleep: 3600, entries }),
    walk: walkOf(entries, 1, [
      { key: SLOTS_PER_SET, what: "the set key that names a set which is not there. Nothing is said, because its `does` is go, and nothing moves - the one press in this directory that a reader could answer by reading past the end of an array" },
      { key: 0, what: "and a speech key afterwards, to say which board the device is still on: the same one" },
    ]),
    notes: [
      "The target is a uint8 and so is the set count, so the format can say this and the array cannot hold it. Reading past the end of sets[] is the one outcome a parser must never have, and the answer is that the key stays where it is.",
      "Staying put rather than falling back to set 0. docs/device-interface.md section 6 is the argument: a key that jumps somewhere arbitrary looks like it worked, and what it teaches the person pressing it is untrue. A key that does nothing is visibly broken.",
      "The field comes back as it stands beside the meaning - target 3, goes_to -1 - which is the pair sleep_seconds and idle_seconds are. A reader that clamped inside the parse would give the right meaning and the wrong field, and nothing checking only the meaning could say so.",
      "No builder writes it: loader/src/device_package.ts resolves every target out of the boards the package actually holds, and refuses a `load_board` naming one it does not.",
    ],
  });
}

{
  const entries = [{
    name: de.exactly_32_bytes,
    nameText: de.exactly_32_bytes,
    key: ringKey("c1", 0, 1),
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
    key: ringKey("d1", 0, 1),
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
    key: { ...entry.key, reserved: 0xff },
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
      "A version-1 set entry was 186 bytes, not 212, so a version-1 file is SHORTER than the length rule asks for and would be refused for its length even without the version byte. That was not true when this fixture was written: the entry was 184 bytes then, one byte less than a version-1 entry, and the length adding up was the whole reason the version byte had to catch it.",
      "That is docs/device-interface.md section 6 exactly: the dangerous mistakes are the ones that parse. Refusing for the version rather than for the length is what keeps the check honest - a file refused for the right reason today may be one refused for a coincidence tomorrow.",
    ],
  },
  {
    name: "version-two",
    result: "LAYOUT_BAD_VERSION",
    summary: "Version 2, the layout from before every key said what it does. Refused rather than read at the wrong pitch.",
    bytes: layoutBytes({ version: 2, entries: ONE_SET.map(setEntry) }),
    notes: [
      "A version-2 set entry was 184 bytes and a version-3 one is 212, so a file with the same set count is 28 bytes short per set and would be refused for its length. That coincidence is not what this fixture rests on: the set count is a byte a writer chooses, and there is nothing stopping a file whose count and length happen to add up.",
      "The talkers that were flashed before 2026-08-31 refuse a version-3 file the same way - the mirror of this fixture, from the other side, and the reason the version byte moved rather than the strides quietly growing. adr/0020 is that decision.",
    ],
  },
  {
    name: "version-four",
    result: "LAYOUT_BAD_VERSION",
    summary: "Version 4, from a builder newer than the device. Refused, because the reader cannot skip what it does not know.",
    bytes: layoutBytes({ version: 4, entries: ONE_SET.map(setEntry) }),
    notes: [
      "This is the rule the cable does the opposite of. parseLayout reads fixed strides, has no room for an unknown field and no way to step over one, so a version it does not know is refused outright rather than read as far as it goes.",
      "A flashed device cannot be updated, so this refusal is permanent for that device: a MAJOR change to this format strands every talker already in a house. That asymmetry is why the MAJOR rule is written about a flashed device misreading a payload rather than about the builder.",
      "docs/device-interface.md section 3 asks for 'a version byte of 2' here, and this fixture has now been version 3 and version 4. It was written on the morning of the day the set colour went, when LAYOUT_VERSION was still 1. The fixture follows the code and the disagreement is recorded rather than smoothed over - it is what a specification kept as prose does within a week, and the argument for writing the fixtures first.",
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
    summary: "A header claiming one set more than the device has room for.",
    bytes: layoutBytes({
      setCountByte: MAX_SETS + 1,
      entries: Array.from({ length: MAX_SETS + 1 }, (_, i) => setEntry({
        name: `Set ${i}`, key: ringKey("11", i, MAX_SETS + 1),
        slots: [slot("21", "31"), slot("22", null), slot("23", null), slot("24", null)],
      })),
    }),
    notes: [
      "Refused for its length rather than for its count, and those are the same enum value: MAX_SETS is how much room the reader has, and a file naming more of them has no answer that fits.",
      "The pair with sets-at-max, and neither says anything on its own. Together they state the number: the most sets a fixture is accepted with is the room there is, and this is the file with one more.",
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
          name: de.breakfast, key: ringKey("11", 0, 2),
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

// --- the compressed form -----------------------------------------------------
//
// Laid out by hand, opcode by opcode, and not by calling an encoder. That is
// the rule this whole directory runs on and it matters more here than
// anywhere else in it: an encoder's output is a statement about that encoder,
// and what a conformance fixture has to state is the format. The bytes below
// are readable as a sentence - this many of that colour, then these pixels
// literally - and a reader that disagrees with them is wrong even if every
// encoder in the repository agrees with it.

const TILE_MAGIC = [0x76, 0x74, 0x31];        // "vt1"

/** A compressed tile, written out from its palette and its opcodes. */
const compressed = (palette, stream) => Buffer.from([
  ...TILE_MAGIC, palette.length - 1,
  ...palette.flatMap((value) => [value >> 8, value & 0xff]),
  ...stream,
]);

/** A run of `count` pixels of palette entry `index`. 2..129 per opcode. */
const run = (count, index) => [count - 2, index];
/** `values` palette entries, one byte each. 1..64 per opcode. */
const indices = (values) => [0x80 | (values.length - 1), ...values];
/** `values` RGB565 pixels, two bytes each, that the palette does not hold. */
const literals = (values) =>
  [0xc0 | (values.length - 1), ...values.flatMap((v) => [v >> 8, v & 0xff])];

/** Whole rows of one colour, as few opcodes as the run length allows. */
function rowsOf(count, index) {
  const out = [];
  for (let left = count; left > 0;) {
    const take = Math.min(left, 129);
    out.push(...run(take, index));
    left -= take;
  }
  return out;
}

{
  // Every one of the three opcodes, in one file, with a picture simple enough
  // to write the expectation for by hand: two rows of red, one row that is
  // half white and half a colour the palette does not hold, and black to the
  // bottom.
  const RED = rgb565(255, 0, 0);          // f800
  const WHITE = rgb565(255, 255, 255);    // ffff
  const BLACK = 0x0000;
  const STRANGER = 0x1234;                // in no palette entry, so a literal
  const palette = [BLACK, RED, WHITE];    // black first, so index 0 is black

  const third = [
    ...indices(Array.from({ length: 64 }, () => 2)),   // 64 white, as indices
    ...literals(Array.from({ length: 64 }, () => STRANGER)),
  ];
  const artefact = compressed(palette, [
    ...rowsOf(TILE_W * 2, 1),                          // two rows of red
    ...third,                                          // the third row
    ...rowsOf(TILE_W * (TILE_H - 3), 0),               // black to the bottom
  ]);

  tileFixture({
    name: "compressed",
    summary: "A palette of three and all three opcodes: runs of red, sixty-four white as palette indices, sixty-four of a colour the palette does not hold.",
    artefact,
    expected: {
      conforming: true,
      form: "vt1",
      palette: { colours: 3, entries: palette.map((v) => hex4(v)) },
      read: {
        accepts: true,
        probes: [
          { x: 0, y: 0, byte: 0, value: hex4(RED) },
          { x: 127, y: 1, byte: (1 * TILE_W + 127) * 2, value: hex4(RED) },
          { x: 0, y: 2, byte: (2 * TILE_W) * 2, value: hex4(WHITE) },
          { x: 63, y: 2, byte: (2 * TILE_W + 63) * 2, value: hex4(WHITE) },
          { x: 64, y: 2, byte: (2 * TILE_W + 64) * 2, value: hex4(STRANGER) },
          { x: 127, y: 2, byte: (2 * TILE_W + 127) * 2, value: hex4(STRANGER) },
          { x: 0, y: 3, byte: (3 * TILE_W) * 2, value: hex4(BLACK) },
          { x: 127, y: 127, byte: TILE_BYTES - 2, value: hex4(BLACK) },
        ],
      },
      write: null,
      notes: [
        "The three opcodes are three different bargains and a reader that muddles two of them draws something plausible rather than nothing. A run misread as a literal stretch eats the pixels after it; a palette literal misread as a raw one halves the row and shifts everything following.",
        "Runs cross rows on purpose. The stream is one sequence of pixels and the rows are only where the panel wants them, so a reader that restarts its decoder at each row would draw the first row correctly and nothing else.",
        "The third opcode is what makes the palette optional rather than a ceiling. Five of the fourteen tiles in tests/reference/tiles/ hold more than 256 colours after anti-aliasing, and without an escape every one of them would have had to travel raw.",
      ],
    },
  });
}

{
  // The same forgiveness the raw form has, in the compressed one: a stream
  // that stops mid-tile leaves the rest black and nobody is told.
  const GREEN = rgb565(0, 255, 0);
  const artefact = compressed([GREEN], rowsOf(TILE_W * 4, 0));

  tileFixture({
    name: "compressed-short",
    summary: "A compressed tile whose stream ends after four rows. The rest is black and the device says nothing, exactly as for a truncated raw one.",
    artefact,
    expected: {
      conforming: false,
      form: "vt1",
      palette: { colours: 1, entries: [hex4(GREEN)] },
      read: {
        accepts: true,
        complete_rows: 4,
        blank_rows_from: 4,
        probes: [
          { x: 0, y: 0, byte: 0, value: hex4(GREEN) },
          { x: 127, y: 3, byte: (3 * TILE_W + 127) * 2, value: hex4(GREEN) },
          { x: 0, y: 4, byte: (4 * TILE_W) * 2, value: "0000" },
          { x: 127, y: 127, byte: TILE_BYTES - 2, value: "0000" },
        ],
      },
      write: null,
      notes: [
        "One rule for both forms, which is the point of stating it twice. A writer MUST emit a stream that covers all 16384 pixels; a reader draws what arrived and blacks out the rest, and neither form reports anything.",
        "A stream that stops is not the same as a file that lies about its palette - see compressed-lying-palette, which is refused. The difference is that this one is readable to its last opcode and that one is not readable at all.",
      ],
    },
  });
}

{
  // The one way a tile can be refused: it says it is compressed and then the
  // palette it claims is not there.
  const artefact = Buffer.from([...TILE_MAGIC, 0xff, 0x00, 0x00, 0x01]);

  tileFixture({
    name: "compressed-lying-palette",
    summary: "The magic, a claim of 256 colours, and four bytes of palette. Refused rather than drawn.",
    artefact,
    outcome: "refused",
    expected: {
      conforming: false,
      form: "vt1",
      read: {
        accepts: false,
      },
      write: null,
      notes: [
        "The only refusal at this boundary, and it is deliberately narrow: everything else that is the wrong length is read as a raw tile of the wrong length, because that is what it was before there was a second form. A reader that refused more than this would start refusing files the device has always drawn.",
        "Refused means black, which is also what a missing file draws and what a truncated one mostly draws. Nothing on the device distinguishes them, and that is the argument for the length rules living on the writer's side rather than the reader's.",
      ],
    },
  });
}

{
  // A raw tile whose first three bytes spell the magic. It is exactly
  // TILE_BYTES long, so the length decides before the bytes are looked at.
  const raw = addressTile();
  raw[0] = 0x76; raw[1] = 0x74; raw[2] = 0x31;

  tileFixture({
    name: "raw-that-spells-the-magic",
    summary: "A raw tile whose first pixels happen to read 'vt1'. It is 32768 bytes long, so it is a picture and not a header.",
    artefact: raw,
    expected: {
      conforming: true,
      form: "raw",
      read: {
        accepts: true,
        bytes_read: TILE_BYTES,
        probes: [
          { x: 0, y: 0, byte: 0, value: "7674" },
          { x: 1, y: 0, byte: 2, value: "3101" },
          ...tileProbes([[127, 127]]),
        ],
      },
      write: null,
      notes: [
        "This is why the length is tested before the magic and not after. 0x7674 is a green a real symbol can contain, and a reader that sniffed the first three bytes first would draw one picture in sixteen million as a palette followed by noise.",
        "It is also why a compressed file must never come out at exactly 32768 bytes: it would be read as this. encodeTile() returns the raw bytes whenever the encoding is not smaller, so a conforming writer cannot produce one.",
      ],
    },
  });
}

// =============================================================================
// a<hash>.wav - the audio payload
// =============================================================================

const WAV_SAMPLE_RATE = 16000;
const WAV_CHANNELS = 1;
const WAV_BITS = 16;
// The two WAVE format tags a recording may declare. The device reads exactly
// this field to decide which codec the data chunk is in - wav_format.h - and
// it is the only thing that tells the two forms apart. adr/0022.
const WAV_FORMAT_PCM = 0x0001;
const WAV_FORMAT_IMA_ADPCM = 0x0011;
const ADPCM_BLOCK_BYTES = 256;
const ADPCM_BLOCK_SAMPLES = 1 + (ADPCM_BLOCK_BYTES - 4) * 2;

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
  body.writeUInt16LE(WAV_FORMAT_PCM, 0);
  body.writeUInt16LE(channels, 2);
  body.writeUInt32LE(rate, 4);
  body.writeUInt32LE(rate * channels * (bits / 8), 8);         // byte rate
  body.writeUInt16LE(channels * (bits / 8), 12);               // block align
  body.writeUInt16LE(bits, 14);
  return chunk("fmt ", body);
}

/** The fmt chunk of a compressed recording: twenty bytes rather than sixteen,
 *  because a codec that is not PCM carries a cbSize and what that size is for.
 *
 *  Written out here rather than encoded by loader/src/audio_encode.ts, and
 *  that is the point of this fixture. What device/fixtures/audio/ states is
 *  the ACCEPTOR - whether a file is taken, where its samples start, and which
 *  codec it declares - and the acceptor must not be checked with bytes our own
 *  encoder produced. Whether the samples come back as the word that went in is
 *  a different question, asked in tests/test_adpcm.py against the four real
 *  recordings in example/speech/. */
function adpcmFmtChunk() {
  const body = Buffer.alloc(20);
  body.writeUInt16LE(WAV_FORMAT_IMA_ADPCM, 0);
  body.writeUInt16LE(WAV_CHANNELS, 2);
  body.writeUInt32LE(WAV_SAMPLE_RATE, 4);
  body.writeUInt32LE(
    Math.floor(WAV_SAMPLE_RATE * ADPCM_BLOCK_BYTES / ADPCM_BLOCK_SAMPLES), 8);
  body.writeUInt16LE(ADPCM_BLOCK_BYTES, 12);
  body.writeUInt16LE(4, 14);                                   // bits a sample
  body.writeUInt16LE(2, 16);                                   // cbSize
  body.writeUInt16LE(ADPCM_BLOCK_SAMPLES, 18);
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
  // Which codec the file declares and how long one block of it is, stated on
  // every one of these rather than only on the compressed one. The acceptor
  // reads two fields out of fmt and walked past all of them yesterday, so what
  // needs holding is that the other ten files still report exactly what they
  // always meant.
  //
  // The default pair is what fmtChunk() writes: plain PCM, two bytes to a
  // frame. A file that never reaches a fmt chunk states its own - both fields
  // come back as what a reader assumes when nothing said otherwise, and that
  // assumption is the behaviour every talker in the field has.
  read = { format_tag: WAV_FORMAT_PCM, block_align: WAV_CHANNELS * (WAV_BITS / 8),
           ...read };
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
  // Two whole blocks of a compressed recording. The bytes are a deterministic
  // ramp rather than an encoding of anything: what this fixture states is that
  // the container is walked and the codec is read out of it, and both halves
  // answer that from the header alone. What the nibbles decode to is
  // tests/test_adpcm.py's question, asked of real speech.
  const blocks = Buffer.alloc(2 * ADPCM_BLOCK_BYTES);
  for (let i = 0; i < blocks.length; i++) blocks[i] = (i * 37) & 0xff;
  // Each block's header holds the sample it starts from and the step index it
  // starts at, so those two are written as something a decoder can use rather
  // than left as ramp. The reserved fourth byte is zero, which is what a
  // writer emits and what a reader ignores.
  for (let b = 0; b < 2; b++) {
    const at = b * ADPCM_BLOCK_BYTES;
    blocks.writeInt16LE(b === 0 ? 0 : -1200, at);
    blocks[at + 2] = 12;
    blocks[at + 3] = 0;
  }
  const fact = Buffer.alloc(4);
  fact.writeUInt32LE(2 * ADPCM_BLOCK_SAMPLES, 0);
  audioFixture({
    name: "spoken-compressed",
    summary: "The other form a recording may travel in: IMA ADPCM, WAVE format tag 0x11, in the same container as every other recording.",
    artefact: riff(adpcmFmtChunk(), chunk("fact", fact), chunk("data", blocks)),
    // Not what a builder writes, which is why there is no `write` beside this
    // and why it is not conforming in the sense the other nine are. **A device
    // package carries the plain form** - form rule 3 at the head of
    // loader/src/device_package.ts, and adr/0008 for why a recording is never
    // derived - and readDevicePackage() refuses this file for that reason. It
    // is made on the way to a talker that said it can play one, out of a PCM
    // recording that was already in the package, and it exists nowhere else.
    conforming: false,
    read: {
      accepts: true, data_offset: 12 + 8 + 20 + 8 + 4 + 8,
      data_bytes: blocks.length,
      format_tag: WAV_FORMAT_IMA_ADPCM, block_align: ADPCM_BLOCK_BYTES,
    },
    notes: [
      "There is no `write` here and that is the statement, not an omission. What a builder must emit is 16 kHz mono 16-bit PCM and nothing else; this form is made at the cable, by the browser, for one device, and a package that carried it would have thrown away the master it was made from. isDeviceWav() answers false to this file on purpose.",
      "A codec change and not a container change, which is the whole shape of adr/0022. The file is still a RIFF/WAVE, seekToWavData() still walks the chunks to `data`, and the only thing that says which form it is in is the tag in fmt - so a device that reads the tag plays it and one that does not plays the nibbles as though they were samples.",
      "That second device is why this form is offered only to a talker that named it in its hello. Sent blind, a compressed recording is not a quiet fault: it is a full-volume hiss where a word should be, at the moment somebody pressed a key expecting one. device/fixtures/cable/audio-form-named-in-the-hello is the other half of this.",
      "The fmt chunk is twenty bytes rather than sixteen - a cbSize and the samples one block holds - and the fact chunk states the sample count before padding. Neither is read by the device, and both are here because a bench tool reads them and because a writer that omitted them would be writing a file other readers refuse.",
      "The block length is what the device reads a block at a time into a 1024-byte buffer, so it is taken from fmt and then brought inside what a block can be. A corrupt fmt claiming a longer one is the difference between a refused file and a read past the end of that buffer.",
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
  // Four bytes to a frame, because this one is stereo - and it is the whole
  // point of this fixture that the device reads that number and then ignores
  // what it means. The block length is only ever used to size an ADPCM block;
  // for PCM it is read, reported and never acted on.
  read: { accepts: true, data_offset: 44, data_bytes: 600, block_align: 4 },
  notes: [
    "The reader walks past fmt like any other chunk. Rate, channel count and sample width are never looked at, so this file is taken and then played at the one rate I2S was started with: a word about a third as long as it should be, at the wrong pitch, in a voice nobody chose.",
    "A device that works and is wrong, which is the dangerous kind. The fixture records it as it stands rather than blessing it: a writer MUST emit 16 kHz mono 16-bit, and the reader as it is today does not check. Whether it should is a change to the firmware and a decision this fixture set does not make - it makes the decision visible.",
  ],
});

const AUDIO_REFUSALS = [
  {
    name: "not-riff",
    read: { block_align: 0 },
    summary: "A file that is not a RIFF at all, under a .wav name.",
    artefact: Buffer.concat([Buffer.from("OggS", "latin1"), samples(100)]),
    notes: [
      "The name says what a file is for and the first four bytes say what it is. Only one of those is checked, and it is the right one.",
    ],
  },
  {
    name: "riff-not-wave",
    read: { block_align: 0 },
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
    read: { block_align: 0 },
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
    // Two of these are refused on the twelve-byte header and one never has
    // twelve bytes, so no chunk of any kind is walked and fmt is never
    // reached. What the reader reports then is what it assumes: plain PCM, and
    // a block length of nothing, which is exactly what it assumed about every
    // file before it read fmt at all.
    read: { accepts: false, ...(refusal.read ?? {}) },
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
  { what: "a collection", name: `c${NAME_HASH}.bin`, emitted: true, stored: true,
    hash: NAME_HASH, path: `/c${NAME_HASH}.bin`,
    note: "The third letter, 2026-08-31. What goes into the hash is the collection's IDENTITY - the root board's id out of the package - and not the file's bytes, so a collection edited and sent again lands on the same name and a device replaces it rather than holding two. Which means this is a name whose content it does not promise, and therefore one the cable compares by checksum: exactly the exception layout.bin was, now a family of names." },
  { what: "the layout, under the one name a device used to hold it by",
    name: "layout.bin",
    emitted: false, stored: true, hash: null, path: "/layout.bin",
    note: "Not emitted any more and still stored, which is the one case in this table where those two come apart in that direction and is not a fault. A talker flashed before 2026-08-31 is carrying one and its firmware reads it as the one collection it has always been, so the device must go on storing, checksumming and deleting the name - a page that could not remove it could not tidy such a device up at all." },

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
      emitted: "A slash, then t, a or c, then exactly 32 lower-case hex digits, then .bin for a tile or a collection and .wav for a recording. The 32 digits are the first sixteen bytes of a hash OF THE INPUT that produced the file, not of the file's own bytes. layout.bin was a fourth shape until 2026-08-31 and is no longer emitted; it is still stored, because devices are carrying it.",
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
// loader/src/layout_format.ts: a regex over somebody else's file is a
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
// What a press does
// =============================================================================
//
// The other half of the layout walks, and the half a list of presses cannot
// hold: how long a key has to be held, how long the device waits between the
// word and the next board, how long it hears nothing afterwards, and the order
// those things happen in.
//
// Stated as its own fixture for the reason sleep.expected.json is: it is a
// rule rather than a file. Nothing about it is in layout.bin and nothing about
// it crosses the cable - but a builder is entitled to know it, the same way it
// is entitled to know that a timeout of zero means ten minutes, and until
// 2026-08-31 the numbers lived in vorlaut.ino where no test could read them.
//
// Written here from the reasons rather than from firmware/vorlaut/key_press.h.
// A fixture that took the numbers out of the header would agree with the
// header by construction and say nothing.

/** The four steps between a key that goes somewhere and the board it goes to.
 *
 * An ordered list rather than four sentences, because the order is the part
 * that goes wrong: showing the new board before the finger came off it is a
 * different picture under a finger that has not moved, and hearing again
 * before the bounce has died out is a press meant for the old board answering
 * the new one. */
const CHANGE_STEPS = [
  { step: "pause",
    what: "A whole second after the word has finished, before anything moves.",
    why: "The moment a child works out that she was right happens in it. There is no cheer, no score and no second panel on this device, so this second is the whole of what it gives back - it is the point of the second rather than slack at the end of one. 200 ms would be enough to look smooth and would land the next board while she is still listening." },
  { step: "release",
    what: "Wait until no key is down.",
    why: "Her finger is still on the key that did this. Drawing the next round under it puts a different picture beneath a finger that has not moved, and whatever she does next lands on something she never chose." },
  { step: "show",
    what: "The new set on the panels.",
    why: "Everything before it is about not doing this too early." },
  { step: "deaf",
    what: "A stretch in which no press is heard at all, and a press made during it is thrown away rather than answered afterwards.",
    why: "A finger bouncing back, or a second press meant for the board that has gone, must not answer the new one. Thrown away rather than queued: a press that arrives late on the wrong board is the same fault as a press that arrives early on it." },
];

fixture({
  kind: "press", name: "press", outcome: "accepted",
  summary: "How long a key has to be held, what happens between a key that goes somewhere and the board it goes to, and in which order.",
  expected: {
    fixture: "press", kind: "press",
    summary: "How long a key has to be held, what happens between a key that goes somewhere and the board it goes to, and in which order.",
    /** Which key is which. The set key is the fifth of the five, in the file
     *  and on the device, and it is the only index with a rule of its own. */
    set_key_index: SLOTS_PER_SET,
    holds: [
      { key: 0, ms: 80, what: "a speech key" },
      { key: 1, ms: 80, what: "a speech key" },
      { key: 2, ms: 80, what: "a speech key" },
      { key: 3, ms: 80, what: "a speech key" },
      { key: SLOTS_PER_SET, ms: 400, what: "the set key" },
    ],
    after_a_key_that_goes: {
      pause_ms: 1000,
      deaf_ms: 400,
      order: CHANGE_STEPS.map((one) => one.step),
      steps: CHANGE_STEPS,
    },
    rules: [
      "Every key of a set is read the same way, and what it does is the byte the file carries. A device that switched sets by arithmetic - the next set, round to the first from the last - is a device with a way past every round of the joining game that has nothing to do with the word, whatever the file said.",
      "A key that goes somewhere goes there by itself. There is no second press to confirm it and no gesture to skip a round: with four answers on the board, trying is what gets a child through, and a device whose only hidden gesture is the menu is one whose behaviour a parent can describe in a sentence.",
      "The set key is held four times as long as a speech key, and that has not changed. An accidental switch takes away the word she was about to say and she has to find her way back, which is worse than hitting the wrong word - the same sentence the deaf stretch below is another answer to.",
      "The pause and the deaf stretch are lengths of time and no fixture reaches a clock, exactly as the sleep timeout's are. What is stated here is the numbers and their order, which is what two implementations can be held to.",
      "Nothing is remembered across a board change. The device does not know which round it is on, how it got there or whether the last press was right - so there is no state for it to be stuck in, and a walk through a layout is the whole of what it does.",
    ],
    notes: [
      "80 and 400 were in vorlaut.ino from the beginning and are unchanged; 1000 and the four steps are 2026-08-31, when the device first acted on what a key says it does. The deaf stretch is SET_HOLD_MS rather than a number of its own, because 'how much accidental switching is too much' is one question and this repository has already answered it once.",
      "This is the only fixture here about the device alone. layout.bin says nothing about any of it and the cable never mentions it, so a browser has nothing to be held to - which is why device/fixtures/ says so out loud rather than leaving the kind unlisted. A kind that is skipped is visible; a kind that was forgotten is not.",
    ],
  },
});

// =============================================================================
// Several collections on one device
// =============================================================================
//
// A collection is one file, so the list of collections on a talker is what
// lies in its directory. That single sentence is what this kind states, and
// everything in it is a consequence: which names count, what each is called,
// what order they come out in, which one is showing after a removal, and how
// four keys hold more than four names.
//
// **Nothing here is a byte of layout.bin.** The format did not move for this -
// a collection file holds exactly the bytes version 3 has always held - so
// there is no artefact under `collections/` and no refusal code to cover. What
// there is instead is a set of decisions the firmware makes about files, and
// the reason they are stated here rather than left in vorlaut.ino is the reason
// `press` is: a decision in the one file no test can include is a decision
// nothing holds.
//
// Like `press`, this kind has **almost no browser half**. What crosses is the
// name rule - the loader has to agree about which names are collections, or it
// offers to remove a file the device never lists, or sweeps up the one the
// device is showing - and that is one predicate. The wrapping, the ordering
// and the fallback are the device's alone and are checked from the C side only.

/** The letter, and what a name has to look like to be a collection at all. */
const COLLECTION_PREFIX = "c";
const COLLECTION_LEGACY = "layout.bin";
const MAX_COLLECTIONS = 16;
/** The header, and the first set's name after it - all a device reads to put a
 *  name in its menu. */
const COLLECTION_HEAD_BYTES = LAYOUT_HEADER_BYTES + NAME_BYTES;   // 44
/** Nine characters a line, twice. MENU_MAX_CHARS in firmware/vorlaut/texts.h,
 *  which is 116 pixels inside the frame divided by the twelve a glyph takes at
 *  text size 2. Written here from the arithmetic rather than taken from that
 *  header, like every other number in this file. */
const MENU_MAX_CHARS = 9;

const COLLECTION_NAMES = [
  { what: "a collection the loader wrote", name: `c${NAME_HASH}.bin`,
    kind: "named" },
  { what: "the one name a device used to hold its only collection under",
    name: COLLECTION_LEGACY, kind: "legacy" },
  { what: "a tile", name: `t${NAME_HASH}.bin`, kind: "not" },
  { what: "a recording", name: `a${AUDIO_HASH}.wav`, kind: "not" },
  { what: "upper-case hex", name: `c${NAME_HASH.toUpperCase()}.bin`,
    kind: "not",
    note: "Lower case only, and refused rather than folded. The device opens the name it was given; a name it read one way and opened another would be a collection in the menu that shows nothing." },
  { what: "half a hash", name: `c${NAME_HASH.slice(0, 16)}.bin`, kind: "not",
    note: "Exactly 32 digits. A short name is a name no builder writes, so a file under one is a file whose bytes nobody here wrote - and listing it as a collection would put a name in the menu on the strength of a guess." },
  { what: "the right length and the wrong suffix", name: `c${NAME_HASH}.wav`,
    kind: "not" },
  { what: "nothing at all", name: "", kind: "not" },
];

/** A collection file's first 44 bytes, from the fields. */
const collectionHead = ({ magic = LAYOUT_MAGIC, version = LAYOUT_VERSION,
                          sets = 1, slots = SLOTS_PER_SET, language = 0,
                          sleep = 0, name = "", cut = 0 }) => {
  const head = Buffer.concat([
    layoutBytes({ magic, version, setCountByte: sets, slotCountByte: slots,
                  language, sleep, entries: [] }),
    nameField(name),
  ]);
  return cut ? Buffer.from(head.subarray(0, cut)) : head;
};

const COLLECTION_HEADS = [
  { what: "an ordinary collection", head: collectionHead({ name: de.at_home }),
    name: de.at_home },
  { what: "a name that fills the field",
    head: collectionHead({ name: de.exactly_32_bytes }),
    name: de.exactly_32_bytes },
  { what: "sixty-four sets", head: collectionHead({ sets: MAX_SETS, name: de.shadow_game }),
    name: de.shadow_game },
  { what: "no sets at all", head: collectionHead({ sets: 0, name: de.at_home }),
    name: null,
    note: "Parsed happily by parseLayout and still not a collection anybody can choose: there is nothing behind the name to show. A device holding only this one has no collections, which is the same state as an empty device and is drawn the same way." },
  { what: "a version this build does not read",
    head: collectionHead({ version: LAYOUT_VERSION + 1, name: de.at_home }),
    name: null,
    note: "A name in the menu leading to a talker with nothing on it is the failure docs/device-interface.md section 6 is a whole section about. So a file whose head this build cannot read is not named and not listed - it is simply not there, as far as the menu is concerned." },
  { what: "the wrong magic",
    head: collectionHead({ magic: "MTRE", name: de.at_home }), name: null },
  { what: "the wrong slot count",
    head: collectionHead({ slots: SLOTS_PER_SET + 1, name: de.at_home }),
    name: null },
  { what: "a file shorter than the head",
    head: collectionHead({ name: de.at_home, cut: COLLECTION_HEAD_BYTES - 1 }),
    name: null,
    note: "Forty-four bytes or it is not readable. That is the whole of what a device reads to build its menu, and it is why holding sixteen collections costs a directory walk instead of sixteen parses." },
];

/** A name broken over the two lines a key has. */
const COLLECTION_MENU = [
  { name: de.mirror_and_egg_game, lines: de.mirror_and_egg_game_on_a_key,
    note: "Two words and a bit, broken at a space, which is why there is a wrap at all rather than a cut at eighteen characters. Breaking mid-word here would be the same letters and a different thing to read." },
  { name: de.shadow_game, lines: de.shadow_game_on_a_key,
    note: "One word longer than a line, cut where the line ends and not where the syllable does. The two lines read down as the word, which is what makes it legible; hyphenating properly needs a dictionary per language, and the failure of a wrong guess at one is a name that reads as a different word." },
  { name: de.question_game, lines: de.question_game_on_a_key,
    note: "Ten characters, and the tenth is on a line of its own. The panel is nine glyphs wide at text size 2 and this is what the edge of it looks like." },
  { name: de.at_home, lines: de.at_home_on_a_key },
  { name: de.greetings, lines: de.greetings_on_a_key,
    note: "Five glyphs and seven bytes. Counted in glyphs, through the same walk toPanelText() draws with - a wrapper counting bytes puts every name with an umlaut in it two characters short of where it belongs." },
  { name: de.morning_with_mum, lines: de.morning_with_mum_on_a_key,
    note: "Two lines and no more. The last two words are dropped rather than shrunk: a smaller font would fit them and would be unreadable across a room, which is the only distance this is ever looked at from." },
  { name: de.leading_space, lines: de.leading_space_on_a_key,
    note: "A leading space is nothing. It would otherwise be a glyph of the nine, spent on air." },
  { name: "", lines: ["", ""] },
];

/** Files as a directory hands them over, and the order the menu puts them in.
 *
 * Deliberately not in the order they come out in, and deliberately with two
 * called the same thing: a file system promises no order, and the case where
 * the names tie is the one a person really meets - the same collection exported
 * twice under two identities. */
const COLLECTION_LISTING = [
  { file: `c${"11".repeat(HASH_BYTES)}.bin`, name: de.shadow_game },
  { file: COLLECTION_LEGACY, name: de.at_home },
  { file: `c${"22".repeat(HASH_BYTES)}.bin`, name: de.mirror_and_egg_game },
  { file: `c${"00".repeat(HASH_BYTES)}.bin`, name: de.mirror_and_egg_game },
].map((one) => ({ ...one, head: hex(collectionHead({ name: one.name })) }));

/** What offering a file to the list comes to, one file at a time. */
const COLLECTION_OFFERS = [
  { what: "a collection", file: `c${NAME_HASH}.bin`,
    head: hex(collectionHead({ name: de.at_home })), taken: "taken" },
  { what: "a tile", file: `t${NAME_HASH}.bin`,
    head: hex(collectionHead({ name: de.at_home })), taken: "not_one",
    note: "Refused on the name alone, before the head is looked at. Everything on the partition goes past this - every tile and every recording of every collection - so the cheap question is asked first and the read only happens for the handful that pass it." },
  { what: "a collection this build cannot read",
    file: `c${AUDIO_HASH}.bin`,
    head: hex(collectionHead({ version: LAYOUT_VERSION + 1, name: de.at_home })),
    taken: "unreadable",
    note: "Counted rather than merely dropped. A device that quietly showed one name fewer than there are files would be indistinguishable from one that had lost a file, and the serial log is where the difference is said." },
];

/** Seventeen files where there is room for sixteen. */
const COLLECTION_TOO_MANY = Array.from(
  { length: MAX_COLLECTIONS + 1 },
  (_, at) => `c${String(at).padStart(2, "0").repeat(HASH_BYTES)}.bin`);

/** What choosing comes to, given what NVS was holding. */
const COLLECTION_CHOICES = [
  { what: "the one that was showing is still there",
    asked: COLLECTION_LEGACY, chose: COLLECTION_LEGACY, outcome: "asked" },
  { what: "it has been removed since",
    asked: `c${"99".repeat(HASH_BYTES)}.bin`,
    chose: `c${"11".repeat(HASH_BYTES)}.bin`, outcome: "fell_back",
    note: "The ordinary case rather than a corruption: removing a collection from the loader page is one press and the name in NVS survives it. A device that answered that with a black screen would be a device somebody broke by tidying up." },
  { what: "nothing was ever chosen", asked: "",
    chose: `c${"11".repeat(HASH_BYTES)}.bin`, outcome: "fell_back",
    note: "A device out of the box, and a device whose stored name this build refuses to believe. Both are the first collection in the order." },
];

/** Four keys, and more than four names. */
const COLLECTION_PAGING = [
  { count: 0, per_page: 4, pages: 1, keys: [[-1, -1, -1, -1]] },
  { count: 1, per_page: 4, pages: 1, keys: [[0, -1, -1, -1]] },
  { count: 4, per_page: 4, pages: 1, keys: [[0, 1, 2, 3]] },
  { count: 5, per_page: 3, pages: 2, keys: [[0, 1, 2, -1], [3, 4, -1, -1]] },
  { count: 7, per_page: 3, pages: 3, keys: [[0, 1, 2, -1], [3, 4, 5, -1],
                                            [6, -1, -1, -1]] },
];

fixture({
  kind: "collections", name: "collections", outcome: "accepted",
  summary: "Which files on a device are collections, what each is called, in what order the menu lists them, which one is showing, and how four keys hold more than four names.",
  expected: {
    fixture: "collections", kind: "collections",
    summary: "Which files on a device are collections, what each is called, in what order the menu lists them, which one is showing, and how four keys hold more than four names.",
    name_rule: {
      prefix: COLLECTION_PREFIX,
      digits: HASH_BYTES * 2,
      suffix: ".bin",
      legacy: COLLECTION_LEGACY,
      what_is_hashed: "The collection's identity - the root board's id out of the package - and never its bytes. A collection edited and exported again keeps its name, which is what makes a device replace it rather than hold two of it.",
    },
    max: MAX_COLLECTIONS,
    head_bytes: COLLECTION_HEAD_BYTES,
    names: COLLECTION_NAMES.map((one) => ({
      what: one.what, name: one.name, kind: one.kind, note: one.note ?? null,
    })),
    heads: COLLECTION_HEADS.map((one) => ({
      what: one.what, head: hex(one.head), name: one.name, note: one.note ?? null,
    })),
    menu_max_chars: MENU_MAX_CHARS,
    menu: COLLECTION_MENU.map((one) => ({
      name: one.name, first: one.lines[0], second: one.lines[1],
      note: one.note ?? null,
    })),
    offering: COLLECTION_OFFERS.map((one) => ({
      what: one.what, file: one.file, head: one.head, taken: one.taken,
      note: one.note ?? null,
    })),
    over_the_limit: {
      files: COLLECTION_TOO_MANY,
      head: hex(collectionHead({ name: de.at_home })),
      taken: MAX_COLLECTIONS,
      refused: COLLECTION_TOO_MANY.length - MAX_COLLECTIONS,
      note: "The seventeenth is refused and counted. Nothing writes seventeen collection files - the loader refuses to send past the number the device names in its greeting - so this is the case where something else has: a folder export, an image built by hand, a device that was flashed with a smaller limit than the one that wrote it.",
    },
    listing: {
      given: COLLECTION_LISTING,
      // By the name a person reads, and by the file where two are called the
      // same. Written out rather than computed, because a fixture that sorted
      // its own expectation would agree with whatever it sorted by.
      order: [
        `c${"11".repeat(HASH_BYTES)}.bin`,   // shadow_game
        `c${"00".repeat(HASH_BYTES)}.bin`,   // mirror_and_egg_game
        `c${"22".repeat(HASH_BYTES)}.bin`,   // mirror_and_egg_game, later file
        COLLECTION_LEGACY,                    // at_home
      ],
      note: "Two of them are called the same thing, which is the case the tie-break exists for and the one a person really meets: the same collection exported twice under two identities. The file name decides, and the pair sit next to each other in the menu rather than swapping places between one start and the next.",
    },
    choosing: COLLECTION_CHOICES.map((one) => ({
      what: one.what, asked: one.asked, chose: one.chose, outcome: one.outcome,
      note: one.note ?? null,
    })),
    keys: 4,
    paging: COLLECTION_PAGING,
    rules: [
      "A collection is one file. The list of collections on a device is what lies in its directory - there is no index, nothing to keep in step, and adding one is `put` while removing one is `rm`.",
      "A collection file holds exactly the bytes of layout.bin version 3. Nothing about the format moved for this, which is why a talker flashed before 2026-08-31 can still be sent a collection: what changed is the name it goes under and how many of them a device will hold.",
      "The name a person reads in the menu is the FIRST SET'S name. The header has no field for one and a `.obz` carries no name for a Sammlung; the root board is the first set, and its name is already in the file at a fixed offset. A builder should therefore name the first page of a collection after the collection.",
      "A device reads the head of each collection file and parses only the one it is showing. That is what keeps the cost of holding a second game disk rather than SRAM, and it is why the head is 44 bytes and not the whole file.",
      "A file whose head this build cannot read is not a collection. It is not named, not listed and not choosable - a name in a menu leading to a talker with nothing on it is worse than a name that is not there.",
      "layout.bin is a collection. A device carrying one from before this existed shows it as the one collection it has always been, with a name of its own like any other.",
      "The order is by the name shown and then by the file name. A file system promises no order, so a menu that took the directory's would move between one morning and the next - and a menu nobody can learn is worse than an order nobody chose.",
      "Which collection is showing is kept outside the format, beside the volume. It is something the person in the room changes, so it is not a field in a file; and it is the FILE NAME rather than a position, because a position means something different the moment a collection is added or removed.",
      "The collection that was showing can be gone. Then the first in the order is shown instead, and the name that was asked for is left where it is - a collection that comes back should be showing again without anybody asking for it twice.",
      "Four names to a screen, and three once there are more than four, because the fourth key has to become the way to the rest.",
    ],
    notes: [
      "There is no artefact for this kind and no refusal code. Nothing here is a byte of layout.bin - it is what a device does with files that hold those bytes, which is a different question and one that had no fixture at all.",
      "Only the name rule crosses. The loader has to agree about which names are collections, because a name it says yes to and the device says no to is a file the page offers to remove and the device never shows, and the other way round is the page sweeping up the file the talker is reading. Everything else here - the wrapping, the order, the fallback, the paging - is the device's alone and has no browser half, which is the shape `press` already has.",
      "Nothing here reaches a clock or a display. That the two lines are legible on a real panel is not a question a fixture can answer; what it can say is how many glyphs of a name reach it and where the break falls.",
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
                        spoken = CABLE_VERSION, verdict = "ok",
                        firmware = "", tiles = "", audio = "",
                        collections = 0 }) {
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
      // Which build the device in this transcript says it is carrying, and
      // empty where it says nothing at all. Unlike the two above, this is not
      // a number either end may compare: the device names its build, the
      // browser writes the name down, and nothing in the interface orders two
      // of them. See firmware/vorlaut/version.h.
      //
      // Empty is the common case here on purpose. Every device flashed before
      // 2026-08-28 says nothing, so eight of these transcripts describe one,
      // and firmware-named-in-the-hello describes the other. A client that
      // treated silence as a fault would pass the one and fail the eight.
      //
      // The device runner takes this as an argument the way it takes the
      // capacity and the window, which the note on cableMode() in
      // tests/device_host.cpp is about: a fixture states the conversation, and
      // a harness that read this out of a header instead could only ever
      // produce the one transcript its own build allows.
      device_firmware: firmware,
      // Which tile forms the device in this transcript says it can draw, and
      // empty where it says nothing. Empty is the common case here for the
      // same reason it is for the firmware word above: every talker flashed
      // before 2026-08-31 says nothing, and a browser that read silence as a
      // fault would fail on all of them. What silence means is raw tiles, and
      // raw tiles are what those devices were being sent anyway.
      device_tiles: tiles,
      // And which recording forms it says it plays, empty where it says
      // nothing. A separate field from the tile forms above because they are
      // separate capabilities: a firmware may gain one without the other, and
      // between 2026-08-31 and 2026-09-01 every talker was exactly that - it
      // drew a compressed tile and played no compressed recording. A fixture
      // set that could not state that pair would be stating a device that has
      // never existed.
      //
      // Empty is the common case here for the third time, and it carries the
      // sharpest consequence of the three. Silence means 16-bit PCM, which is
      // what those devices were being sent anyway; a browser that guessed at a
      // form the device did not name would put a full-volume hiss where a word
      // should be, out loud, in a house nobody here knows about.
      device_audio: audio,
      // How many collections the device in this transcript says it holds, and
      // zero where it says nothing at all. Zero is not one: it is the ABSENCE
      // of the line, and what a client must make of the absence is one - which
      // is what a talker flashed before 2026-08-31 really holds and is exactly
      // why the keyword cost no protocol version. The two are separate fields
      // for the same reason `firmware` is, and the eight transcripts that say
      // nothing are again the ones that matter.
      device_collections: collections,
      window,
      device_starts_with: start.map((f) => ({
        name: f.name, size: f.bytes.length, crc: hex8(crc32(f.bytes)),
        content: b64(f.bytes),
      })),
      capacity: CAPACITY,
      steps,
      device_ends_with: end,
      // hello's answer carries the firmware word, and it is filled in from
      // the same argument as the transcript above rather than written out a
      // second time beside it: the two saying different things is the one
      // disagreement a fixture cannot usefully state.
      //
      // Appended last, and that is load-bearing. The runner in
      // tests/unit/device_fixtures.test.ts compares what the client returned
      // against this with JSON.stringify, so the key ORDER here has to be the
      // order the object literal in tools/cable.js is written in - where
      // firmware comes after files, for exactly this reason.
      client_script: script && script.map((step) => (
        step.call === "hello"
          ? { ...step, returns: { ...step.returns, firmware, tiles, audio,
                                  collections: collections || 1 } }
          : step)),
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
                                  free: CAPACITY - 640 - 196, files: 0 } },
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

// --- The build, which is not the protocol ------------------------------------
//
// The first keyword this protocol has ever gained, and the transcript that
// makes the extension rule something that runs rather than something written
// down. cable_format.h has said since it was written that unknown keywords are
// skipped on both sides and cost no version at all; until this fixture, no
// conversation anywhere exercised a keyword one end had not always known.

{
  // A tag-shaped example, and an example is all it is. What the interface
  // fixes is the shape - one word after "firmware", in the greeting - and not
  // which word: a release says its own tag and a sketch compiled on a desk
  // says "dev". A fixture naming the newest tag would go stale on the next
  // one and would be read as a requirement by whoever found it stale.
  const BUILD = "v0.4";
{
  // The keyword a browser has to see before it may send a compressed tile,
  // and the reason compression cost no protocol version. A device that says
  // nothing here gets raw tiles - which is what it was getting anyway, and is
  // why the eight transcripts beside this one are the important ones.
  const FORMS = "vt1";
  cableFixture({
    name: "tiles-named-in-the-hello",
    summary: "A device that says which tile forms it can draw. Silence means raw, and silence is what every talker flashed before 2026-08-31 says.",
    ends: ["device", "browser"],
    tiles: FORMS,
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device(`< tiles ${FORMS}`),
      device("< end hello"),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
      { call: "done", returns: { stored: 0, removed: 0, bytes: 0 } },
    ],
    notes: [
      "The word is matched whole rather than parsed. A firmware that could draw a second form would say a different word here, not a list, so that two ends can never half-agree about what a tile is - and half-agreeing is the failure that puts a palette on a panel as though it were pixels.",
      "A browser that treated the absence of this line as a fault would refuse every talker in the field. Absence means raw, raw is what those devices have always been sent, and that is the whole of why a compressed tile format did not have to move CABLE_VERSION: an older device is not broken by it, it is simply not offered it.",
      "It sits after 'free' and before 'end hello' because that is where the firmware puts it, and the browser skips keywords it does not know in any position - see skip-unknown-keyword. The order is stated here so that a device which moved it would be noticed, not because a reader may depend on it.",
    ],
  });
}

{
  // The recording form, on the same terms as the tile form above and with a
  // louder failure behind it. A tile a device cannot read is a panel of noise
  // somebody can look away from; a recording it cannot read is a full-volume
  // hiss out of the speaker, at the moment a child pressed a key expecting a
  // word. adr/0022.
  const FORMS = "va1";
  cableFixture({
    name: "audio-named-in-the-hello",
    summary: "A device that draws compressed tiles and plays only plain recordings. Two capabilities, two words, and this is the device that has one of them.",
    ends: ["device", "browser"],
    tiles: "vt1",
    audio: "",
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< tiles vt1"),
      device("< end hello"),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
      { call: "done", returns: { stored: 0, removed: 0, bytes: 0 } },
    ],
    notes: [
      "Every talker flashed between 2026-08-31 and 2026-09-01 is this device, and it is why the two forms are two words rather than one. A browser that read `tiles vt1` as a general yes would send it a compressed recording on the strength of an answer about pictures.",
      "The absence of a line is the answer, not a gap in the transcript. Silence means 16-bit PCM, which is what these devices were always sent, and that is the whole of why a second codec cost no protocol version either.",
    ],
  });

  cableFixture({
    name: "audio-form-named-in-the-hello",
    summary: "A device that says which recording forms it plays. Silence means 16-bit PCM, and silence is what every talker flashed before 2026-09-01 says.",
    ends: ["device", "browser"],
    audio: FORMS,
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device(`< audio ${FORMS}`),
      device("< end hello"),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
      { call: "done", returns: { stored: 0, removed: 0, bytes: 0 } },
    ],
    notes: [
      "The word is matched whole rather than parsed or ordered, exactly as the tile form is. There is no newer here: a browser that read an unknown word as 'newer, so probably fine' would be sending a file it cannot know the device can play, and what comes out of the speaker is the loudest wrong answer this device can give.",
      "Naming the form is only half of what has to be true before a recording is compressed. The other half is a person saying that this collection is one where four bits a sample is bearable - a game rather than a collection somebody is understood through - and no package says which it is. adr/0022 is why that question is asked on the browser's side.",
      "It sits after 'tiles' and before 'end hello' because that is where the firmware puts it. The order is stated so that a device which moved it would be noticed, not because a reader may depend on it - see skip-unknown-keyword.",
    ],
  });
}

  cableFixture({
    name: "firmware-named-in-the-hello",
    summary: "A device that says which build it is carrying, as well as which protocol it speaks. Two questions, two words.",
    ends: ["device", "browser"],
    firmware: BUILD,
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< firmware ${BUILD}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< end hello"),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
      { call: "done", returns: { stored: 0, removed: 0, bytes: 0 } },
    ],
    notes: [
      "The two words answer different questions and a browser that confused them would be wrong for a year at a time. 'vorlaut 2' is the protocol: it moves only when the two ends can no longer drive each other, so every device across many releases says the same number. 'firmware v0.4' is the build, and it moves with every release without the protocol moving at all. Which firmware a talker is carrying is not answerable from the first line, and that is why there is a second.",
      "The word is not compared here, and no rule in this interface orders two of them. A release says its tag, a sketch compiled from the Arduino IDE says 'dev', and a client holding one of each has nothing to sort them by. What a client must do is keep the word it was given; what it must not do is invent an ordering the device never promised.",
      "Every other cable transcript has this line absent, which is the other real device rather than an omission: anything flashed before 2026-08-28 has no such line to say. Silence is 'it did not say', not 'it said nothing useful' and not a fault - a client that refused such a device would refuse every talker already in a drawer.",
      "This is the extension rule the header has always claimed, running for the first time. The device gained a keyword and CABLE_VERSION did not move, because a browser that has never heard of the word skips it and reaches 'end hello' exactly as before - which is what the eight transcripts that predate the keyword are now also evidence of, from the other side.",
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
                                  free: CAPACITY - held.length, files: 0 } },
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
      device("< end hello"),
      host("> reboot"),
      device("< err verb"),
      host("> hello 2 please"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
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

// --- Several collections, and the verb that arrived with them ---------------
//
// Two things landed on 2026-08-31 and the transcripts below are the pair of
// them: a keyword saying how many collections a device holds, and a verb that
// hands a file back. Neither moved CABLE_VERSION - one is a keyword, which
// both ends skip, and the other is a word an older device answers with an
// error nobody has to send it. adr/0021 is the argument for both.

{
  const HOLDS = 16;
  cableFixture({
    name: "collections-named-in-the-hello",
    summary: "A device that says how many collections it holds. Silence means one, and silence is what every talker flashed before 2026-08-31 says.",
    ends: ["device", "browser"],
    collections: HOLDS,
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device(`< collections ${HOLDS}`),
      device("< end hello"),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY, files: 0 } },
      { call: "done", returns: { stored: 0, removed: 0, bytes: 0 } },
    ],
    notes: [
      "A number and not a flag, because the browser has to refuse a payload that would push a device past it - and a browser that assumed a number would be back to guessing at a constant it was never told, which is exactly what the window stopped doing.",
      "Absence means one. That is not a default chosen for tidiness: a talker flashed before this keyword existed really does hold exactly one collection, under the one name layout.bin, and a transfer to it really is a replacement. A browser that read silence as 'unknown' and sent additively would fill such a device's partition with a file it will never read.",
      "This is also what says whether the `get` below may be sent at all. The verb and the capability arrived in the same firmware, so a device that names a number above one has both; nothing has to probe for a verb.",
    ],
  });
}

{
  const COLLECTION = `c${NAME_HASH}.bin`;
  const payload = content(23, 224);
  const sum = crc32(payload);
  cableFixture({
    name: "get-a-collection-back",
    summary: "One file the other way. The head line carries the length and the checksum, then that many raw bytes, then what really went.",
    ends: ["device", "browser"],
    collections: 16,
    start: [{ name: COLLECTION, bytes: payload }],
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY - payload.length}`),
      device("< collections 16"),
      device("< end hello"),
      host(`> get ${COLLECTION}`),
      device(`< data ${COLLECTION} ${payload.length} ${hex8(sum)}`),
      { from: "device", raw: b64(payload), bytes: payload.length },
      device(`< sent ${COLLECTION} ${payload.length}`),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: {
      files: [{ name: COLLECTION, size: payload.length, crc: hex8(sum) }],
      stored: 0, removed: 0, bytes: 0,
    },
    script: [
      { call: "hello", returns: { version: CABLE_VERSION, total: CAPACITY,
                                  free: CAPACITY - payload.length, files: 0 } },
      { call: "get", name: COLLECTION, returns: b64(payload) },
      { call: "done", returns: { stored: 0, removed: 0, bytes: 0 } },
    ],
    notes: [
      "The bytes come from the DEVICE here, which is the first time anything in this fixture set does. A transcript's raw step has a direction like every other step, and a runner that assumed raw meant host would walk this one backwards.",
      "Two things are compared and both have been silent failures on this wire before: the count, which catches a stream that stopped partway, and the checksum, which catches one that slipped. The name catches neither - it is a hash of what went INTO the file and says nothing about the bytes.",
      "No window and no acknowledgement, and that is not an oversight. The window exists because the device is the slow end when it is the one writing into flash; here the browser is reading, and a browser drains a stream as fast as it arrives.",
      "What this verb is FOR is keeping the deciding on the browser's side. A collection file lists every tile and recording it names, so reading the collections that stay is how a page works out what a removed one leaves behind. The alternative was a device that walks its own layouts, and the device is deliberately stupid.",
    ],
  });

  cableFixture({
    name: "get-what-is-not-there",
    summary: "Asking for a file the device does not hold. The same word a checksum of one gets.",
    // The device's end only. What a client does with an "err" is not a line it
    // writes, so a transcript cannot state it - the same reason the transcripts
    // full of refusals beside this one are one-ended.
    ends: ["device"],
    collections: 16,
    steps: [
      host("> hello"),
      device(`< vorlaut ${CABLE_VERSION}`),
      device(`< total ${CAPACITY}`),
      device(`< free ${CAPACITY}`),
      device("< collections 16"),
      device("< end hello"),
      host(`> get ${COLLECTION}`),
      device(`< err missing ${COLLECTION}`),
      host("> done"),
      device("< bye 0 0 0"),
    ],
    end: { files: [], stored: 0, removed: 0, bytes: 0 },
    notes: [
      "An error rather than a head line saying zero bytes. A zero-length answer would be indistinguishable from an empty file, and an empty collection file and a missing one are different things to a page deciding what may be removed.",
      "It arrives before any raw bytes, so there is nothing to drain and the session carries on - the same shape a refused put has.",
    ],
  });
}

// =============================================================================
// The device package - the .obz between the editor and the loader page
// =============================================================================
//
// Everything above this line is bytes between a browser and the talker. This
// kind is not: it is the file the editor writes and the loader page reads, and
// neither end of it is the device. adr/0014 is where that widening of this
// directory is argued, and the short version is that the faults it catches
// arrive at the party that cannot move, one step further upstream - a reader
// that misunderstands a package does not fail on the page, it compiles
// confidently and hands a talker bytes.
//
// The two rules at the head of this file hold here and are the whole reason
// this is a fixture kind rather than a lock file. Nothing below imports
// src/data/device_package.ts or loader/, and nothing reads its own output
// back: the manifest, the board documents and the archive framing are laid out
// from the field values. That is what makes a refusal possible at all -
// buildDevicePackage() will never emit a package that names a board it does
// not hold, so no capture of it could ever contain one.

const PACKAGE_FORMAT = "open-board-0.1";
const OWN_SET = "vorlaut";
const METACOM_SET = "metacom";

/** The extension a content type gets in the archive. The member says what it
 *  is twice - in content_type, which is the authority, and in the name, which
 *  is what somebody running `unzip -l` reads. Anything unrecognised keeps
 *  .bin, because the extension decides nothing. */
const MEDIA_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** Sixteen hex characters of SHA-256: what a source picture is named for in
 *  the archive. Written out from the rule rather than imported, like every
 *  other number in this file. Sixteen and not thirty-two, because this is the
 *  ARCHIVE member's name and never reaches layout.bin, where the device's own
 *  tile hash goes. */
const memberKey = (bytes) => sha256(bytes).slice(0, 16);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Sorted keys, indented by two, a newline at the end.
 *
 * The shape a manifest and a board document are written in, so that a diff of
 * two exports is about the Sammlung rather than about object order. A rule of
 * the format, so it is implemented here rather than borrowed. */
function packageJson(value) {
  const sortDeep = (one) =>
    Array.isArray(one) ? one.map(sortDeep)
    : one && typeof one === "object"
      ? Object.fromEntries(Object.keys(one).sort().map((k) => [k, sortDeep(one[k])]))
      : one;
  return Buffer.from(JSON.stringify(sortDeep(value), null, 2) + "\n", "utf8");
}

/**
 * A zip with every member stored, and no compressor anywhere near it.
 *
 * Stored is a property of the FIXTURE and not of the format. A committed
 * artefact that tests/test_device_fixtures.py has to regenerate byte for byte
 * must not depend on a deflate implementation, whose output is a property of
 * whichever zlib happens to be installed - which is the same reason nothing
 * else in this file compresses anything. A conforming writer may deflate the
 * JSON, and src/data/zip.ts does.
 *
 * So what these fixtures state about the container is its framing and its
 * member ORDER - manifest, then boards, then media - and never its bytes.
 * exchange/SPEC.md section 2 is where the framing rules come from: the central
 * directory is what an importer must read, names are UTF-8 with bit 11 set to
 * say so, and there is no Zip64 and no encryption.
 */
function storedZip(members) {
  const LOCAL = 0x04034b50;
  const CENTRAL = 0x02014b50;
  const END = 0x06054b50;
  const NEEDED = 20;
  const STORED = 0;
  const UTF8 = 0x0800;
  const MADE_BY = 0x031e;                          // unix
  const EXTERNAL = (0o100644 << 16) >>> 0;
  // 1980-01-01, the DOS epoch and the earliest a zip can say. One fixed
  // timestamp rather than a clock, so two runs of this file are one file.
  const DOS_TIME = 0;
  const DOS_DATE = 0x0021;

  const pieces = [];
  const central = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.path.normalize("NFC"), "utf8");
    const body = member.bytes;
    const sum = crc32(body) >>> 0;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(NEEDED, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(STORED, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    pieces.push(local, body);

    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(CENTRAL, 0);
    entry.writeUInt16LE(MADE_BY, 4);
    entry.writeUInt16LE(NEEDED, 6);
    entry.writeUInt16LE(UTF8, 8);
    entry.writeUInt16LE(STORED, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(EXTERNAL, 38);
    entry.writeUInt32LE(offset, 42);
    name.copy(entry, 46);
    central.push(entry);
    offset += local.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...pieces, directory, end]);
}

/**
 * A 24-bit BMP, bottom-up, laid out from the pixel values.
 *
 * A picture format with no compressor in it, which is what this file can have.
 * sniffImageType() has never heard of "BM", so these arrive as
 * application/octet-stream - deliberately not a refusal, because decoding is
 * the host's and a browser takes formats that list has never heard of.
 *
 * They are also the only pictures here that a reader can actually turn into
 * pixels, which is what lets tests/unit/device_compile.test.ts compile one of
 * these packages the whole way into what a talker reads.
 */
function bmp(width, height, colourAt) {
  const stride = (width * 3 + 3) & ~3;
  const body = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colourAt(x, y);
      const at = (height - 1 - y) * stride + x * 3;      // rows run bottom-up
      body[at] = b;
      body[at + 1] = g;
      body[at + 2] = r;
    }
  }
  const head = Buffer.alloc(54);
  head.write("BM", 0, "latin1");
  head.writeUInt32LE(54 + body.length, 2);
  head.writeUInt32LE(54, 10);                            // pixels start here
  head.writeUInt32LE(40, 14);                            // BITMAPINFOHEADER
  head.writeInt32LE(width, 18);
  head.writeInt32LE(height, 22);
  head.writeUInt16LE(1, 26);                             // one plane
  head.writeUInt16LE(24, 28);                            // bits per pixel
  head.writeUInt32LE(0, 30);                             // BI_RGB
  head.writeUInt32LE(body.length, 34);
  return Buffer.concat([head, body]);
}

/** One device WAV and the length its own header says it runs for.
 *
 * The seconds are worked out here rather than taken from a reader, because
 * they go into the board document as `sounds[].duration` and a reader is then
 * held to agreeing with them. A duration nobody checks is the quiet kind of
 * wrong: OBF has the field and a person at a bench has no other way to see how
 * long a clip is. */
function packageWav(count, { rate = WAV_SAMPLE_RATE, channels = WAV_CHANNELS,
                             bits = WAV_BITS } = {}) {
  const body = samples(count);
  const perFrame = channels * (bits / 8);
  return {
    bytes: riff(fmtChunk({ rate, channels, bits }), chunk("data", body)),
    seconds: body.length / perFrame / rate,
  };
}

const splitReference = (reference) =>
  reference.startsWith(`${METACOM_SET}:`)
    ? { set: METACOM_SET, filename: reference.slice(METACOM_SET.length + 1) }
    : { set: OWN_SET, filename: reference };

const boardIdAt = (at) => `set-${at + 1}`;
const boardFile = (id) => `boards/${id}.obf`;
const memberStem = (path) =>
  path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/** Whether a key holds nothing at all: no word, and no picture.
 *
 * One predicate rather than three walks, because the three walks answering
 * differently is the divergence this whole boundary was built to close - an
 * untouched key was an empty cell on a tablet and a missing-picture cross on
 * the device, and nothing could see it because the two paths never met. Here
 * it decides which key the compiler draws a blank tile for. */
const keyIsEmpty = (slot) =>
  !String(slot.text ?? "").trim() && !String(slot.symbol ?? "");

/** The five keys where they really sit - two rows of three, the top left cell
 *  empty because that is where the speaker is. Every slot gets a cell,
 *  including one that holds nothing: the device has five panels and they are
 *  always lit, so a key holding nothing is still a key. */
function packageGrid(id, slots) {
  const key = (at) => (at < slots ? `${id}-key-${at + 1}` : null);
  return {
    rows: 2,
    columns: 3,
    order: [[null, key(0), key(1)], [`${id}-set`, key(2), key(3)]],
  };
}

/**
 * A Sammlung, its pictures and its recordings, as the package that carries
 * them - and as the answers a reader must come back with.
 *
 * Written from the four form rules rather than from any writer:
 *
 *   1. The sources travel as they are stored. No resampling, no re-encoding,
 *      no fitted PNG - what went in is what is in images/.
 *   2. A crossed-out key is a FLAG beside the same picture, not a second
 *      baked one. One member, two buttons, two tiles at the far end.
 *   3. The recordings are the device's own WAVs under the device's own names,
 *      so nothing derives one delivered artefact from another.
 *   4. The language is the Sammlung's own, not one worked out from the voice.
 *
 * A reference that resolved to nothing still gets an entry, with no `path`.
 * Dropping it would lose the reference, the Sammlung would come back with an
 * empty key where it had a picture nobody could find, and - if that key has no
 * word either - the key the build drew a grey cross for would compile to a
 * blank. So the gap travels as a gap.
 */
function packageOf({ layout, voice, sources = [], sounds = [],
                     collection = PACKAGE_COLLECTION }) {
  const sourceBy = new Map(sources.map((one) => [one.reference, one]));
  const soundBy = new Map(sounds.map((one) => [one.text, one]));
  const members = new Map();

  /** What a key does and where it goes, out of what the Sammlung said.
   *
   *  `goesTo` is a set index, or null for a key that goes nowhere. Absent on
   *  a speech key means nowhere; absent on a set key means the ring, which is
   *  what every set key did before the file could say anything else. */
  const goingOf = (key, ring) => {
    const at = key.goesTo === undefined ? ring : key.goesTo;
    if (at === null || at === undefined) return { does: "speak", target: 0 };
    return { does: key.speakOnGo ? "speak-and-go" : "go", target: at };
  };

  const plan = {
    language: layout.language,
    voice,
    sleep_timeout_seconds: layout.sleep_timeout_seconds,
    sets: layout.sets.map((set, at) => ({
      name: set.name,
      // The set key - the fifth panel. Its word is its `vocalization` where it
      // has one and the board's name otherwise, which is what a reader taking
      // `vocalization ?? label` finds: the switch key has always carried the
      // set's name as its label.
      key: {
        text: (set.key?.text ?? "") || set.name,
        symbol: set.symbol ?? "",
        negated: false,
        empty: keyIsEmpty({ text: (set.key?.text ?? "") || set.name,
                            symbol: set.symbol ?? "" }),
        ...goingOf(set.key ?? {}, (at + 1) % layout.sets.length),
      },
      // Cut at four and deliberately NOT padded up to it: a short set is one
      // layout.bin writes zero hashes for, which is what the device already
      // does with one.
      slots: set.slots.slice(0, SLOTS_PER_SET).map((slot) => ({
        text: slot.text ?? "",
        symbol: slot.symbol ?? "",
        negated: Boolean(slot.negated),
        empty: keyIsEmpty(slot),
        ...goingOf(slot, null),
      })),
    })),
  };

  const ids = plan.sets.map((_, at) => boardIdAt(at));
  const readSources = new Map();
  const readSounds = new Map();
  const boards = [];

  for (const [at, set] of plan.sets.entries()) {
    const id = ids[at];
    // What the Sammlung said, beside what a reader must come back with. Only
    // one thing is needed from it: whether the set key was given a word of its
    // own, which a reader cannot tell from the plan because a set key with no
    // word of its own comes back carrying the board's name.
    const said = layout.sets[at];
    const images = new Map();
    const soundEntries = new Map();
    const buttons = [];

    const putImage = (reference) => {
      if (!reference) return undefined;
      const source = sourceBy.get(reference);
      let entry;
      if (source && source.bytes) {
        const key = memberKey(source.bytes);
        const path =
          `images/${key}.${MEDIA_EXTENSIONS[source.content_type] ?? "bin"}`;
        entry = {
          id: `img-${key}`,
          path,
          content_type: source.content_type,
          symbol: splitReference(reference),
        };
        members.set(path, source.bytes);
        readSources.set(reference, {
          reference, key, content_type: source.content_type, path,
        });
      } else {
        // No bytes, so no content hash to be named for. The reference itself
        // is what is left, and it names no member of the archive: there is
        // none.
        entry = {
          id: `img-none-${reference.replace(/[^A-Za-z0-9._-]+/g, "-")}`,
          symbol: splitReference(reference),
        };
      }
      images.set(entry.id, entry);
      return entry.id;
    };

    const putSound = (text) => {
      const sound = text ? soundBy.get(text) : undefined;
      if (!sound) return undefined;
      const path = `sounds/${sound.name}`;
      const entry = {
        id: `snd-${memberStem(sound.name)}`,
        path,
        content_type: "audio/wav",
        duration: sound.seconds,
      };
      soundEntries.set(entry.id, entry);
      members.set(path, sound.bytes);
      readSounds.set(text, { text, name: sound.name, path });
      return entry.id;
    };

    /** A key's `load_board`, and the flag that rides on it.
     *
     *  Two fields in the document for one field in layout.bin: a key that goes
     *  somewhere has a `load_board`, and `ext_lautstark_speak_on_navigate`
     *  beside it says whether it also says its own word first. Written only
     *  where each is true, so a Sammlung whose keys all speak is the file it
     *  was before either field existed. */
    const goingInto = (button, key) => {
      if (key.does === "speak") return;
      const board = ids[key.target];
      button.load_board = {
        id: board, name: plan.sets[key.target].name, path: boardFile(board),
      };
      if (key.does === "speak-and-go") {
        button.ext_lautstark_speak_on_navigate = true;
      }
    };

    for (const [key, slot] of set.slots.entries()) {
      // Both, and the same sentence: the label is what any other editor shows,
      // the vocalization is what gets spoken. The device writes no caption, so
      // on this profile they are one sentence - but saying it twice is what
      // keeps the spoken half right if somebody later shortens the label.
      const button = { id: `${id}-key-${key + 1}`, label: slot.text };
      if (slot.text) button.vocalization = slot.text;
      const picture = putImage(slot.symbol);
      if (picture) button.image_id = picture;
      // Written only when true, so a Sammlung with no crossed-out key is the
      // file it was before this field existed.
      if (slot.negated) button.ext_vorlaut_negated = true;
      const recording = putSound(slot.text);
      if (recording) button.sound_id = recording;
      goingInto(button, slot);
      buttons.push(button);
    }

    const switchKey = { id: `${id}-set`, label: set.name };
    goingInto(switchKey, set.key);
    const setPicture = putImage(set.key.symbol);
    if (setPicture) switchKey.image_id = setPicture;
    // A vocalization only where the set key was given a word of its own.
    // Without one the label IS the word - a reader takes
    // `vocalization ?? label` - and writing it twice would say nothing the
    // file does not already say.
    if (said.key?.text) switchKey.vocalization = said.key.text;
    const setRecording = putSound(said.key?.text ?? "");
    if (setRecording) switchKey.sound_id = setRecording;
    buttons.push(switchKey);

    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const board = {
      format: PACKAGE_FORMAT,
      id,
      locale: plan.language,
      name: set.name,
      buttons,
      grid: packageGrid(id, set.slots.length),
      images: [...images.values()].sort(byId),
      sounds: [...soundEntries.values()].sort(byId),
    };
    // Root board only, all four. A manifest is an index of a zip and gets
    // rebuilt by any tool that touches it; a board is the document.
    if (at === 0) {
      board.ext_vorlaut_sleep_timeout_seconds = plan.sleep_timeout_seconds;
      board.ext_vorlaut_voice = plan.voice;
      // Which Sammlung this is and what it is called. OBF identifies boards
      // and never packages, and a device that holds several collections needs
      // both: the id is what its file on the talker is named for, and the name
      // is what its menu shows. See adr/0021.
      board.ext_lautstark_package_id = collection.id;
      board.ext_lautstark_package_name = collection.name;
    }
    boards.push(board);
  }

  const listed = (prefix, mark) => {
    const paths = [...members.keys()].filter((one) => one.startsWith(prefix)).sort();
    return paths.length
      ? Object.fromEntries(paths.map((path) => [`${mark}-${memberStem(path)}`, path]))
      : undefined;
  };
  const manifest = {
    format: PACKAGE_FORMAT,
    root: boardFile(ids[0]),
    paths: {
      boards: Object.fromEntries(boards.map((one) => [one.id, boardFile(one.id)])),
    },
  };
  const images = listed("images/", "img");
  const recordings = listed("sounds/", "snd");
  if (images) manifest.paths.images = images;
  if (recordings) manifest.paths.sounds = recordings;

  return {
    manifest,
    boards,
    members,
    read: {
      plan,
      // What the reader answers about the package itself rather than about the
      // Sammlung inside it. Separate from `plan` because it is: the plan is
      // what the device shows, this is which collection is showing it.
      package: { id: collection.id, name: collection.name },
      sources: [...readSources.values()],
      sounds: [...readSounds.values()],
    },
  };
}

/** The archive, in the order the format describes itself in: manifest, then
 *  boards, then media sorted by path. */
function packageArchive(pkg) {
  return [
    { path: "manifest.json", bytes: packageJson(pkg.manifest) },
    ...pkg.boards.map((board) => ({
      path: boardFile(board.id), bytes: packageJson(board),
    })),
    ...[...pkg.members.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, bytes]) => ({ path, bytes })),
  ];
}

/**
 * One package fixture: the archive, and what each half is held to.
 *
 * The two halves never meet. The writer is given `write` - a Sammlung, the
 * pictures behind its references and the recordings behind its sentences - and
 * must produce the `manifest` and `boards` stated here and exactly these
 * members. The reader is given the archive and must come back with `read`.
 * Neither one ever sees the other's output, which is the whole reason this
 * kind exists: after the split no repository holds both.
 */
function packageFixture({ name, summary, outcome, conforming, pkg = null,
                          read, write, notes = [] }) {
  const archive = pkg ? packageArchive(pkg) : null;
  const artefact = archive ? storedZip(archive) : null;
  fixture({
    kind: "package", name, dir: "package",
    file: artefact ? `${name}.obz` : undefined,
    artefact, outcome, summary,
    expected: {
      fixture: name, kind: "package",
      file: artefact ? `package/${name}.obz` : null,
      summary,
      bytes: artefact ? artefact.length : null,
      conforming,
      members: archive
        ? archive.map((one) => ({
            path: one.path, bytes: one.bytes.length, sha256: sha256(one.bytes),
          }))
        : null,
      manifest: pkg ? pkg.manifest : null,
      boards: pkg ? pkg.boards : null,
      read, write, notes,
    },
  });
}

// --- What the packages are made of ------------------------------------------

/* One voice for all of them. What every WAV is named for, and a field the
 * device never reads - it is here so that a Sammlung comes back out of the
 * file as the Sammlung it was, which is what makes the export something
 * somebody can archive rather than a build artefact. */
const PACKAGE_VOICE = "piper:de_DE-thorsten-medium";

/* One Sammlung identity for all of them, for the same reason as the voice.
 *
 * The id is the editor's own CollectionRef.id and is opaque here on purpose -
 * nothing derives it from the content, which is the whole point: it survives a
 * rename, and two Sammlungen that happen to hold the same boards are still two.
 * That is what the talker names a collection's file after, and what stops a
 * second game replacing the first. */
const PACKAGE_COLLECTION = {
  id: "c8f21a04-6b3d-4e57-9a10-2d7f5c0e8b46",
  name: de.collection,
};

/* Two pictures that really are pictures, one that really is an SVG, and one
 * that is a magic number and nothing behind it.
 *
 * The BMPs are the only ones anything here can turn into pixels, and that is
 * on purpose: a fixture directory that must regenerate byte for byte cannot
 * hold a PNG, because writing one needs a compressor. What the JPEG states is
 * what the sniffer answers and where the bytes land, which is all this kind
 * claims about it - nothing in a device package decodes a picture. */
const PICTURE_JA = bmp(10, 8, (x, y) => [250 - x * 20, 40 + y * 12, 60]);
const PICTURE_NEIN = bmp(8, 8, (x, y) => [30, 200 - y * 14, 90 + x * 16]);
const PICTURE_HILFE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
  + '<circle cx="12" cy="12" r="10"/></svg>\n', "utf8");
const PICTURE_FOTO = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("a JFIF magic number and no picture behind it", "utf8"),
  Buffer.from([0xff, 0xd9]),
]);

/* Sources by the reference a key carries.
 *
 * "foto.png" holds JPEG bytes on purpose. A reference is a store key and an
 * upload keeps whatever name its file had, so the extension is not evidence -
 * the magic number is, and the member is filed under .jpg because content_type
 * is what a compiler decodes by. A writer that believed the reference would
 * file this one wrong and say so in the document. */
const SOURCES = {
  ja: { reference: "ja.bmp", bytes: PICTURE_JA,
        content_type: "application/octet-stream" },
  nein: { reference: "nein.bmp", bytes: PICTURE_NEIN,
          content_type: "application/octet-stream" },
  hilfe: { reference: "metacom:hilfe.svg", bytes: PICTURE_HILFE,
           content_type: "image/svg+xml" },
  foto: { reference: "foto.png", bytes: PICTURE_FOTO,
          content_type: "image/jpeg" },
};

/** A reference behind which there is nothing: the picture went, or the METACOM
 *  folder was never picked. The entry travels with no path and the compiler
 *  draws the same grey cross the build drew. */
const MISSING_REFERENCE = "metacom:nicht-da.png";

const soundNamed = (fill, count, options) => ({
  name: `a${fill.repeat(32).slice(0, 32)}.wav`,
  ...packageWav(count, options),
});

/* The recordings, under the names a build gave them. The name travels rather
 * than being worked out here: what it hashes is the sentence, the voice, the
 * pipeline version and every option that changes how a sentence sounds, and
 * that rule lives beside the synthesis. Carrying the name keeps it in one
 * place; re-deriving it here would be a second copy of it. */
const SOUND_HUNGRY = { text: de.hungry, ...soundNamed("a1", 160) };
const SOUND_NOT_HUNGRY = { text: de.not_hungry, ...soundNamed("b2", 240) };
const SOUND_THIRSTY = { text: de.thirsty, ...soundNamed("c3", 80) };
const SOUND_OUTSIDE = { text: de.go_outside, ...soundNamed("d4", 320) };
const SOUND_HOME = { text: de.go_home, ...soundNamed("e5", 160) };

const imagePathOf = (source) =>
  `images/${memberKey(source.bytes)}.`
  + `${MEDIA_EXTENSIONS[source.content_type] ?? "bin"}`;

/** What a key does and where it goes, said the way the plan says it. The same
 *  rule packageOf()'s goingOf() applies, and deliberately written twice: this
 *  is what a WRITER is handed, that is what a READER must come back with, and
 *  a fixture whose two halves shared a function would be one half. */
const goesAs = (key, ring) => {
  const at = key.goesTo === undefined ? ring : key.goesTo;
  if (at === null || at === undefined) return { does: "speak", target: 0 };
  return { does: key.speakOnGo ? "speak-and-go" : "go", target: at };
};

/** The `write` half: the Sammlung a conforming writer is given, and where the
 *  bytes behind it are to be found in this fixture's own archive. */
function writeHalf({ layout, sources = [], sounds = [], refuses = null,
                     bytesFrom = {}, collection = PACKAGE_COLLECTION }) {
  return {
    // Which Sammlung is being written out. An input rather than something the
    // layout carries: a layout does not know which Sammlung holds it, and the
    // id has to outlive every rename of the one that does.
    collection,
    layout: {
      language: layout.language,
      voice: PACKAGE_VOICE,
      sleep_timeout_seconds: layout.sleep_timeout_seconds,
      sets: layout.sets.map((set, at) => ({
        name: set.name,
        key: {
          text: (set.key?.text ?? "") || set.name,
          symbol: set.symbol ?? "",
          ...goesAs(set.key ?? {}, (at + 1) % layout.sets.length),
        },
        slots: set.slots.map((slot) => ({
          text: slot.text ?? "",
          symbol: slot.symbol ?? "",
          negated: Boolean(slot.negated),
          ...goesAs(slot, null),
        })),
      })),
    },
    voice: PACKAGE_VOICE,
    sources: sources.map((one) => ({
      reference: one.reference,
      key: memberKey(one.bytes),
      content_type: one.content_type,
      member: imagePathOf(one),
    })),
    sounds: sounds.map((one) => ({
      text: one.text,
      name: one.name,
      member: bytesFrom[one.name] ?? `sounds/${one.name}`,
    })),
    refuses,
  };
}

const cloned = (pkg) => ({
  manifest: JSON.parse(JSON.stringify(pkg.manifest)),
  boards: JSON.parse(JSON.stringify(pkg.boards)),
  members: new Map(pkg.members),
  read: JSON.parse(JSON.stringify(pkg.read)),
});

const readOk = (pkg) => ({ result: "ok", ...pkg.read });
const refused = (at, because) => ({ result: "refused", at, because });

// --- The packages that are packages ------------------------------------------

/* The smallest thing that is a package: one board, and a key in each of the
 * four shapes a key comes in. A fixture where every key is filled would let a
 * whole runner pass while proving one case. */
const ONE_SET_LAYOUT = {
  language: "de",
  sleep_timeout_seconds: 600,
  sets: [{
    name: de.breakfast,
    symbol: SOURCES.foto.reference,
    slots: [
      { text: de.hungry, symbol: SOURCES.ja.reference },      // word and picture
      { text: de.thirsty, symbol: "" },                       // a word alone
      { text: "", symbol: SOURCES.nein.reference },           // a picture alone
      { text: "", symbol: "" },                               // nothing at all
    ],
  }],
};
const ONE_SET_SOURCES = [SOURCES.ja, SOURCES.nein, SOURCES.foto];
const ONE_SET_SOUNDS = [SOUND_HUNGRY, SOUND_THIRSTY];

{
  const pkg = packageOf({
    layout: ONE_SET_LAYOUT, voice: PACKAGE_VOICE,
    sources: ONE_SET_SOURCES, sounds: ONE_SET_SOUNDS,
  });
  packageFixture({
    name: "one-board",
    summary: "One board and a key in each of the four shapes: a word with a picture, a word alone, a picture alone, and a key holding nothing.",
    outcome: "accepted",
    conforming: true,
    pkg,
    read: readOk(pkg),
    write: writeHalf({ layout: ONE_SET_LAYOUT, sources: ONE_SET_SOURCES,
                       sounds: ONE_SET_SOUNDS }),
    notes: [
      "The fourth key holds nothing and is still a key: it has a cell in the grid, a button in the document and `empty` true in the plan. A tablet grid may leave a cell out; the device has five panels and they are always lit.",
      "The set key's picture is filed as images/<key>.jpg although the reference says .png. The reference is a store key and an upload keeps its own name, so the magic number is the evidence and content_type is the authority - a writer that believed the reference would file this one under a lie.",
      "The ring closes after one hop: set-1's key loads set-1. One board is a ring of one, and a reader that special-cased the last board would come back with nothing.",
    ],
  });
}

/* Two boards, and everything about a package that only appears once there is
 * more than one of them. */
const TWO_SET_LAYOUT = {
  language: "de",
  sleep_timeout_seconds: 1800,
  sets: [
    {
      name: de.breakfast,
      symbol: SOURCES.hilfe.reference,
      slots: [
        { text: de.hungry, symbol: SOURCES.ja.reference },
        // The same reference crossed out. One member, two buttons, two tiles
        // at the far end: form rule 2, and the thing that goes wrong silently
        // if a writer bakes the cross instead of flagging it.
        { text: de.not_hungry, symbol: SOURCES.ja.reference, negated: true },
        { text: de.thirsty, symbol: "" },
        { text: "", symbol: SOURCES.nein.reference },
      ],
    },
    {
      // Longer than the 32 bytes layout.bin cuts a name at, with a two-byte
      // character landing across the cut. Nothing in the package cuts it - the
      // document carries the whole name - which is the point: a writer that
      // shortened it here would hand the device a name it had already decided
      // about.
      name: de.cut_mid_character,
      symbol: "",
      slots: [
        { text: de.go_outside, symbol: SOURCES.nein.reference },
        { text: "", symbol: "" },
        // Spaces and nothing else. Empty by the predicate and not by the
        // field, which is the difference that used to be answered two ways.
        { text: "   ", symbol: "" },
        // A reference nothing resolves to: the entry travels with no path.
        { text: de.go_home, symbol: MISSING_REFERENCE },
      ],
    },
  ],
};
const TWO_SET_SOURCES = [SOURCES.ja, SOURCES.nein, SOURCES.hilfe];
const TWO_SET_SOUNDS = [SOUND_HUNGRY, SOUND_NOT_HUNGRY, SOUND_THIRSTY,
                        SOUND_OUTSIDE, SOUND_HOME];

const TWO_SETS = packageOf({
  layout: TWO_SET_LAYOUT, voice: PACKAGE_VOICE,
  sources: TWO_SET_SOURCES, sounds: TWO_SET_SOUNDS,
});

packageFixture({
  name: "two-sets-and-the-ring",
  summary: "Two boards and the ring between them, a crossed-out key sharing one picture with a plain one, a METACOM reference, a name past the 32 bytes layout.bin cuts at, and a reference behind which there is nothing.",
  outcome: "accepted",
  conforming: true,
  pkg: TWO_SETS,
  read: readOk(TWO_SETS),
  write: writeHalf({ layout: TWO_SET_LAYOUT, sources: TWO_SET_SOURCES,
                     sounds: TWO_SET_SOUNDS }),
  notes: [
    "The crossed-out key and the plain one carry the same image_id, so images/ holds one member for the two of them and the flag is what tells them apart. Baking the cross would make the archive hold a second picture; dropping the flag would make layout.bin hold the same tile hash twice.",
    "The missing reference is listed in images[] with a `symbol` and no `path`. Dropping the entry would lose the reference, and the key would come back as a key that never had a picture - which, on a key with no word either, is a blank tile where the build drew the grey cross.",
    "The sleep timeout and the voice are on the root board only. They are the document's, not the manifest's: a manifest is an index of a zip and any tool that touches the archive rebuilds it.",
    "The set names are the boards' `name`, uncut. What cuts a name at 32 bytes is layout.bin, four steps further on - device/fixtures/layout/name-cut-mid-character is where that rule lives, and it is the reader's business rather than this file's.",
  ],
});

/* A Sammlung with five keys in a set, which the device has no room for. */
const FIVE_KEY_LAYOUT = {
  language: "de",
  sleep_timeout_seconds: 600,
  sets: [{
    name: de.outside,
    symbol: "",
    slots: [
      { text: de.hungry, symbol: SOURCES.ja.reference },
      { text: de.thirsty, symbol: "" },
      { text: "", symbol: SOURCES.nein.reference },
      { text: de.go_home, symbol: "" },
      // The fifth. Everything about it - its sentence, its recording, its
      // place in the grid - is gone by the time the package is written.
      { text: de.all_done, symbol: "" },
    ],
  }],
};
const SOUND_ALL_DONE = { text: de.all_done, ...soundNamed("f6", 160) };
const FIVE_KEY_SOUNDS = [SOUND_HUNGRY, SOUND_THIRSTY, SOUND_HOME,
                         SOUND_ALL_DONE];

{
  const pkg = packageOf({
    layout: FIVE_KEY_LAYOUT, voice: PACKAGE_VOICE,
    sources: [SOURCES.ja, SOURCES.nein],
    sounds: FIVE_KEY_SOUNDS,
  });
  packageFixture({
    name: "five-keys-cut-to-four",
    summary: "A set with five keys in it. Four reach the package, and the fifth key's picture and recording are not in the archive at all.",
    outcome: "accepted",
    conforming: true,
    pkg,
    read: readOk(pkg),
    write: writeHalf({
      layout: FIVE_KEY_LAYOUT,
      sources: [SOURCES.ja, SOURCES.nein],
      sounds: FIVE_KEY_SOUNDS,
      // The fifth key's recording is in what the writer is given and in
      // nothing it writes, so this fixture has no member of its own for it.
      // The bytes are borrowed from a member that is here; what is being
      // stated is that a recording handed in under this name comes back out
      // of nothing.
      bytesFrom: { [SOUND_ALL_DONE.name]: `sounds/${SOUND_HUNGRY.name}` },
    }),
    notes: [
      "Four keys, because that is what a set holds. Cut and deliberately not padded: a short set is one layout.bin writes zero hashes for, which is what the device already does with one.",
      "The fifth key's recording is listed in what the writer was given and is in nothing it wrote. That is the half of the cut a member list can show: a package carrying a recording no button names would be one that had kept a key it cannot deliver.",
      "A package carrying a fifth key would be a package of something that cannot reach the device, which is worse than one that carries four: it would import as a Sammlung nobody could build.",
    ],
  });
}

/* A round of the joining game, twice over: what layout.bin version 3 exists
 * for, said in the format one step upstream.
 *
 * The set key shows a tile split down the diagonal with the two halves of a
 * compound word on it and says them out loud - so it carries a vocalization
 * and a recording, which no set key did before - and it goes NOWHERE. One of
 * the four speech keys carries the word those halves make, and it is the only
 * key on the board that leads anywhere at all. That is the whole game: there
 * is no mode, no round counter and no notion of "right" in any of this, and
 * the answer is simply the key that is the only way on.
 *
 * Both boards therefore hang off each other by a SPEECH key. A reader that
 * followed only the set keys would find one board and refuse the package for
 * the other; a reader that took the first `load_board` it found on a board as
 * the set key would put a word on the fifth panel and a set on a speech key. */
const JOINING_LAYOUT = {
  language: "de",
  sleep_timeout_seconds: 600,
  sets: [
    {
      name: de.mirror_egg,
      symbol: SOURCES.ja.reference,
      key: { text: de.mirror_egg, goesTo: null },
      slots: [
        { text: de.egg_cup, symbol: SOURCES.nein.reference },
        // The answer, and the only key that goes anywhere.
        { text: de.fried_egg, symbol: SOURCES.hilfe.reference,
          goesTo: 1, speakOnGo: true },
        { text: de.mirror_image, symbol: SOURCES.nein.reference,
          negated: true },
        { text: "", symbol: "" },
      ],
    },
    {
      name: de.sun_flower,
      symbol: SOURCES.foto.reference,
      key: { text: de.sun_flower, goesTo: null },
      slots: [
        { text: de.sunflower, symbol: SOURCES.ja.reference,
          goesTo: 0, speakOnGo: true },
        { text: de.flower_pot, symbol: SOURCES.nein.reference },
        { text: de.sunshine, symbol: SOURCES.hilfe.reference },
        { text: "", symbol: "" },
      ],
    },
  ],
};
const JOINING_SOURCES = [SOURCES.ja, SOURCES.nein, SOURCES.hilfe, SOURCES.foto];
const JOINING_SOUNDS = [
  { text: de.mirror_egg, ...soundNamed("11", 200) },
  { text: de.fried_egg, ...soundNamed("12", 120) },
  { text: de.egg_cup, ...soundNamed("13", 120) },
  { text: de.mirror_image, ...soundNamed("14", 120) },
  { text: de.sun_flower, ...soundNamed("21", 200) },
  { text: de.sunflower, ...soundNamed("22", 120) },
  { text: de.flower_pot, ...soundNamed("23", 120) },
  { text: de.sunshine, ...soundNamed("24", 120) },
];

{
  const pkg = packageOf({
    layout: JOINING_LAYOUT, voice: PACKAGE_VOICE,
    sources: JOINING_SOURCES, sounds: JOINING_SOUNDS,
  });
  packageFixture({
    name: "a-key-that-goes-on",
    summary: "Two rounds of the joining game: a set key that speaks and goes nowhere, and one speech key per board that speaks and then loads the next.",
    outcome: "accepted",
    conforming: true,
    pkg,
    read: readOk(pkg),
    write: writeHalf({ layout: JOINING_LAYOUT, sources: JOINING_SOURCES,
                       sounds: JOINING_SOUNDS }),
    notes: [
      "`ext_lautstark_speak_on_navigate` is the only field in this file from the other extension namespace, and it is written only where it is true - so a Sammlung whose keys all speak is the file it was before the field existed. adr/0001 keeps the namespaces apart and adr/0020 is why this one crosses.",
      "The boards are reached through a speech key rather than a set key, which is the whole reason the walk over this package is a graph and not a ring. The order the sets come back in is the order they are first reached from the root, and it is that order the `target` in every key counts in.",
      "The set keys carry a vocalization and a recording. That is new: a set key was a picture and nothing else until layout.bin version 3, and there was no field in the format for the sentence the fifth panel says.",
      "One key is crossed out and one holds nothing at all, so this package is not only about navigation - a fixture whose every key was the same shape would let a runner pass on one case.",
    ],
  });
}

{
  const pkg = cloned(packageOf({
    layout: ONE_SET_LAYOUT, voice: PACKAGE_VOICE,
    sources: ONE_SET_SOURCES, sounds: ONE_SET_SOUNDS,
  }));
  // The cell keeps a name; the button it names goes.
  const grid = pkg.boards[0].grid.order;
  grid[grid.length - 1][0] = "set-1-nowhere";
  packageFixture({
    name: "set-key-cell-names-nothing",
    summary: "A grid whose set-key cell names a button the board does not hold.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "puts a button in the set key's cell"),
    write: null,
    notes: [
      "Which button is the set key is a question only the grid answers. It used to be answered by `load_board` - the set key was the one button on a board that went anywhere - and layout.bin version 3 ended that, because a speech key can go somewhere now too.",
      "Refused rather than guessed at. A reader that shrugged here would read all five buttons as speech keys, put four of them on the panels and drop the fifth, and light the set panel with nothing on it: a talker that parses and is wrong, which docs/device-interface.md section 6 is a section about.",
      "No writer produces this file. The grid and the buttons are written from one list, so a cell naming a button that is not there is a package somebody hand-edited or a tool wrote badly - which is exactly who this rule is for.",
    ],
  });
}

// --- Two packages that are taken, and should not have been written -----------

/* The audio kind has stereo-44k, which records a divergence without blessing
 * it. These two are the same thing at this boundary: a reader takes them, the
 * far end is wrong, and stating so is what makes the gap visible instead of
 * leaving it to be discovered. */

{
  const layout = { ...ONE_SET_LAYOUT, language: "de-DE" };
  const pkg = packageOf({
    layout, voice: PACKAGE_VOICE,
    sources: ONE_SET_SOURCES, sounds: ONE_SET_SOUNDS,
  });
  packageFixture({
    name: "locale-not-in-the-table",
    summary: "A locale of \"de-DE\", which is not a language the device has. The reader takes it as it stands and byte 7 falls back to English.",
    outcome: "accepted",
    conforming: false,
    pkg,
    read: readOk(pkg),
    write: writeHalf({ layout, sources: ONE_SET_SOURCES,
                       sounds: ONE_SET_SOUNDS }),
    notes: [
      "The language travels as the Sammlung's own and is not worked out from the voice - form rule 4. \"de-DE\" is what localeFor() would answer off this voice, and it is not what the device wants: LANGUAGE_CODES has \"de\", the two are close enough to look interchangeable, and the difference is a device whose own menu is in English.",
      "Neither half refuses it. The plan comes back saying \"de-DE\" and renderLayoutBin() writes the default index for a language it has no code for, which is device/fixtures/language.expected.json's rule working exactly as stated.",
      "What stands between this and a talker is loader/src/validate.ts, which says load.unknown_language on the page before anything is sent. That is a sentence somebody reads, not a refusal, and it is the reason this is recorded here rather than closed here: a writer MUST NOT emit a locale outside the table, and the reader as it stands does not check.",
    ],
  });
}

{
  const pkg = cloned(TWO_SETS);
  // The two root-only fields, on the second board as well, saying something
  // else.
  pkg.boards[1].ext_vorlaut_sleep_timeout_seconds = 30;
  pkg.boards[1].ext_vorlaut_voice = "piper:de_DE-eva_k-x_low";
  packageFixture({
    name: "sleep-on-a-later-board",
    summary: "The sleep timeout and the voice on a board that is not the root, saying something different from the root's. Only the root's are read, and the other two are lost without a word.",
    outcome: "accepted",
    conforming: false,
    pkg,
    read: readOk(pkg),
    write: null,
    notes: [
      "A conforming writer emits these two fields on the root board and nowhere else, so there is no write half here: this package is one nothing in the editor produces.",
      "The reader takes the first board the ring reaches and never looks at the others, so a package written this way loses whichever of the two a person actually meant. Thirty seconds is a talker that sleeps while a child is still looking at it, and nothing anywhere says the field was seen and dropped.",
      "Stated rather than closed, the way audio/stereo-44k is. Refusing a second copy of a root-only field is a change to the reader and a decision this fixture set does not make - what it makes is the silence visible.",
    ],
  });
}

{
  const pkg = cloned(TWO_SETS);
  // A file that has been through another editor: a short caption on the key
  // and the whole sentence to be spoken.
  const button = pkg.boards[0].buttons[0];
  button.label = de.breakfast;
  pkg.read.plan.sets[0].slots[0].text = button.vocalization;
  packageFixture({
    name: "label-and-vocalization-differ",
    summary: "A key whose label is a caption and whose vocalization is the sentence. What the device says is the vocalization.",
    outcome: "accepted",
    conforming: false,
    pkg,
    read: readOk(pkg),
    write: null,
    notes: [
      "A writer here emits the two the same, so this package is not one the editor produces and there is no write half. It is a package somebody could hand the loader page all the same: OBF has both fields, other editors use them for different things, and a device that read the wrong one would say a caption out loud.",
      "The device writes no caption, so on this profile the two collapse into one sentence - which is exactly why a reader that quietly took the label would look right on every package this repository writes and be wrong on the first one it did not.",
      "The recording is still filed under the sentence it says, so the key that speaks it is found by its vocalization and not by what is printed on it.",
    ],
  });
}

// --- What a reader must refuse ------------------------------------------------

/* Eleven of them, and they exist for the reason ADR 0009 built this directory:
 * a capture of a writer contains none of these, because no writer here emits
 * one. What they aim at is the quiet failures - a package that parses and is
 * wrong - rather than the ones that throw on their own.
 *
 * Each says WHERE it is refused, and the two places are not interchangeable.
 * `archive` is loader/src/read.ts, which decides whether there is a package at
 * all; `package` is readDevicePackage(), which decides whether it is one that
 * can be compiled. Keeping them apart is what lets each say something specific
 * instead of "this file is broken". */

{
  const pkg = cloned(TWO_SETS);
  pkg.manifest.paths.boards = {};
  packageFixture({
    name: "no-boards",
    summary: "A manifest that names no boards, with the boards still in the archive beside it.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("archive", "names no boards"),
    write: null,
    notes: [
      "The boards are there. The manifest is what is wrong, and the manifest is what is believed: its order is the order the device cycles its sets in, so falling back to \"every .obf in the archive\" would be guessing at that order. The editor's own importer does fall back, on purpose, and the two doors want opposite things - src/data/obf.ts is tolerant because a hand-written manifest is usually the half that is wrong and the boards are still all there.",
    ],
  });
}

{
  const pkg = cloned(TWO_SETS);
  // The manifest goes on naming both; the archive holds one.
  pkg.boards = [pkg.boards[0]];
  packageFixture({
    name: "board-named-and-not-there",
    summary: "A manifest naming two boards over an archive holding one.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("archive", "is named by this package and is not in it"),
    write: null,
    notes: [
      "A truncated archive and a hand-edited manifest look the same from here, and both are refused. The first board's key loads set-2, so a reader that skipped the missing one would come back with a ring pointing at nothing.",
    ],
  });
}

{
  const layout = {
    ...TWO_SET_LAYOUT,
    sets: [...TWO_SET_LAYOUT.sets, {
      name: de.feelings, symbol: "",
      slots: [{ text: de.thirsty, symbol: "" }, { text: "", symbol: "" },
              { text: "", symbol: "" }, { text: "", symbol: "" }],
    }],
  };
  const pkg = packageOf({
    layout, voice: PACKAGE_VOICE,
    sources: TWO_SET_SOURCES, sounds: TWO_SET_SOUNDS,
  });
  // set-2 loads set-1 instead of set-3, so the ring closes over two of three.
  const key = pkg.boards[1].buttons.find((one) => one.load_board);
  key.load_board = { id: "set-1", name: pkg.boards[0].name,
                     path: "boards/set-1.obf" };
  packageFixture({
    name: "a-board-nothing-reaches",
    summary: "Three boards, and the keys on them lead to only two. The third is filed, named by the manifest, and there is no way to it.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "holds a board that nothing in it reaches"),
    write: null,
    notes: [
      "The quiet one. Everything parses, every member is present, and the talker cycles two sets forever while the third sits in the file - a device that works and is wrong, said to somebody who believes it.",
      "The keys are followed rather than the manifest's key order, because a manifest is an index any tool may rewrite and the keys are what a person can actually press. A reader that walked the manifest instead would find all three boards here and report nothing.",
      "It was called ring-misses-a-board until 2026-08-31, when the walk stopped being a ring: a speech key can carry a `load_board` since layout.bin version 3, so the boards a package can be navigated between are a graph rather than a cycle. What is refused is unchanged, and so is why - a board nothing reaches is a set nobody can get to.",
    ],
  });
}

{
  const pkg = cloned(TWO_SETS);
  // Every picture entry keeps its path; the members go.
  for (const path of [...pkg.members.keys()]) {
    if (path.startsWith("images/")) pkg.members.delete(path);
  }
  packageFixture({
    name: "pictures-named-and-not-there",
    summary: "A talker document: references and entries with paths, and not one picture behind them.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "is named by this package and is not in it"),
    write: null,
    notes: [
      "The failure this refusal exists to make impossible. The editor's talker export is also an .obz, also carries ext_vorlaut_negated, also names its boards set-1 and set-2 - and has no bytes behind images[]. Compiling one would draw the grey cross on every single key.",
      "Not the same thing as a reference that resolved to nothing, and telling the two apart is the point. That one has no `path` and is a gap the writer recorded on purpose; this one declares a path and has no member behind it, which is either a truncated archive or a document that was never a device package.",
    ],
  });
}

{
  const pkg = cloned(TWO_SETS);
  pkg.boards[0].images[0].symbol = { set: "vorlaut", filename: "" };
  packageFixture({
    name: "picture-with-no-reference",
    summary: "A picture entry with bytes behind it and no reference beside them.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "carries a picture with no reference behind it"),
    write: null,
    notes: [
      "images[] carries `symbol` as well as `path` so that the file still reads as a Sammlung: the pixels are what a compiler wants, and the reference is what makes the package importable by everything that already reads a talker document.",
      "Quiet if it were taken: the picture would compile, and the Sammlung would come back with a key whose picture had no name - so re-exporting it would drop the picture and nobody would know which one it had been.",
    ],
  });
}

{
  const pkg = cloned(TWO_SETS);
  pkg.boards[0].buttons[0].image_id = "img-nothing-here";
  packageFixture({
    name: "picture-not-on-the-board",
    summary: "A key naming a picture its own board does not list.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "names a picture the board does not list"),
    write: null,
    notes: [
      "The entry is the only place the reference lives, so a key pointing at one that is not there is a key whose picture cannot be named even to say it is missing. Taken quietly it would be a key that silently lost its picture, which is a different thing from a key that never had one.",
    ],
  });
}

{
  const pkg = cloned(TWO_SETS);
  for (const path of [...pkg.members.keys()]) {
    if (path.startsWith("sounds/")) { pkg.members.delete(path); break; }
  }
  packageFixture({
    name: "sound-named-and-not-there",
    summary: "A recording named by a board and not in the archive.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "is named by this package and is not in it"),
    write: null,
    notes: [
      "A key that says nothing is not the same as a key that was never given a word, and this package cannot tell anybody which one it is. The device would light a panel with a picture on it and stay silent when a child pressed it.",
    ],
  });
}

{
  const pkg = cloned(TWO_SETS);
  const button = pkg.boards[0].buttons.find((one) => one.sound_id);
  button.sound_id = "snd-nothing-here";
  packageFixture({
    name: "sound-not-on-the-board",
    summary: "A key naming a recording its own board does not list.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "names a recording the board does not list"),
    write: null,
    notes: [
      "The mirror of picture-not-on-the-board, and refused for the same reason: the entry is where the path lives, so a key pointing past it names a file nothing can find.",
    ],
  });
}

{
  const wrong = { text: de.thirsty, name: SOUND_THIRSTY.name,
                  ...packageWav(120, { rate: 24000 }) };
  const sounds = [SOUND_HUNGRY, wrong];
  const pkg = packageOf({
    layout: ONE_SET_LAYOUT, voice: PACKAGE_VOICE,
    sources: ONE_SET_SOURCES, sounds,
  });
  packageFixture({
    name: "sound-at-the-wrong-rate",
    summary: "A recording at 24 kHz. The device does not refuse one - it plays it at 16 - so both halves of this boundary refuse it instead.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "is not the WAV the device plays"),
    write: writeHalf({
      layout: ONE_SET_LAYOUT, sources: ONE_SET_SOURCES, sounds,
      refuses: "is not the WAV the device plays",
    }),
    notes: [
      "The quietest failure this whole kind is aimed at. seekToWavData() finds the data chunk and plays whatever is in it at the one rate I2S was started with, so this file is taken and comes out about a third too fast, in a voice nobody chose, on a talker in front of a child. Nothing refuses it and nothing can report it - device/fixtures/audio/stereo-44k is the same divergence one step further down.",
      "So the rule is kept on both sides of this boundary rather than on either end of the one below it, and this is the one refusal here that both halves make. A reader that took it would be handing bytes to the only party that cannot be made to move.",
      "The duration in the board document is worked out from this file's own header, so it is right about the file and wrong about what anybody will hear.",
    ],
  });
}

{
  // Sixteen hex digits where there should be thirty-two: the near miss rather
  // than the obvious one. hashBytes() takes a short name and fills the rest of
  // the hash with zeroes, so this is the shape that reaches a device and
  // addresses a file that is not there.
  const wrong = { text: de.thirsty, name: "a0123456789abcdef.wav",
                  ...packageWav(80) };
  const sounds = [SOUND_HUNGRY, wrong];
  const pkg = packageOf({
    layout: ONE_SET_LAYOUT, voice: PACKAGE_VOICE,
    sources: ONE_SET_SOURCES, sounds,
  });
  packageFixture({
    name: "sound-named-for-nothing",
    summary: "A recording under a name layout.bin cannot carry. Refused here, at both ends, rather than at the far end of a build nobody is watching.",
    outcome: "refused",
    conforming: false,
    pkg,
    read: refused("package", "is not a name layout.bin can carry"),
    write: writeHalf({
      layout: ONE_SET_LAYOUT, sources: ONE_SET_SOURCES, sounds,
      refuses: "is not a name layout.bin can carry",
    }),
    notes: [
      "\"a\" and thirty-two hex characters, because that is what a slot in layout.bin holds and what hashBytes() reads back out of it - device/fixtures/names.expected.json is the rule.",
      "A short name is the case worth authoring, and it is one device/README.md lists under what the fixtures do NOT cover: hashBytes() accepts fewer than thirty-two digits and fills the rest of the hash with zeroes, so neither end of the device interface enforces the length. This boundary does, and this fixture is where that is written down - a package with a name like this one compiles into a layout.bin whose slot addresses a file nobody wrote.",
      "Both halves refuse it, and that is deliberate: a writer that let one through would have written a package no reader could compile, and a reader that let one through would compile a package into a build with a file the device cannot address.",
    ],
  });
}

{
  packageFixture({
    name: "nothing-to-export",
    summary: "A Sammlung with no sets in it. There is no artefact, because there is no package a writer could have written.",
    outcome: "refused",
    conforming: false,
    pkg: null,
    read: null,
    write: writeHalf({
      layout: { language: "de", sleep_timeout_seconds: 600, sets: [] },
      refuses: "nothing in this Sammlung",
    }),
    notes: [
      "The one refusal in this kind with no read half, because there is nothing to read. A package with no boards is refused at the archive - no-boards is that fixture - and this is the step before it: the writer never gets far enough to make one.",
      "It is here rather than left to a unit test because it is a statement about the format: a device package holds at least one board, and the ring a device cycles cannot be empty.",
    ],
  });
}

// =============================================================================

// MAJOR.MINOR.PATCH over the whole interface, which ADR 0009 is explicit is
// neither LAYOUT_VERSION nor CABLE_VERSION - those are a byte in a file and a
// number on a wire, and all three drift apart on purpose.
//
// No pre-release suffix, and none is coming back. This said 0.1.0-draft from
// the day it was written until 2026-08-27, which would have made device-v1 a
// tag contradicting the thing it tags. Whether the interface is ratified is the
// tag's statement, not this string's - the same division exchange/ has, where
// spec_version is a plain 1.2.0 and "draft, not ratified" is a sentence in
// SPEC.md. device/ has no prose to carry that sentence, which is how the word
// ended up inside the number.
//
// tests/test_device_fixtures.py refuses a suffix here, and refuses this file
// and the committed index.json disagreeing about the version at all.
const INDEX = {
  // 2.3.0 is 2026-09-01, later the same day, and it is what 2.2.0 could not
  // do. A device package gained ext_lautstark_package_id and
  // ext_lautstark_package_name on its root board: which Sammlung it is, and
  // what a talker's menu calls it. Without the first, every package the editor
  // wrote carried the root board id `set-1`, so every collection hashed to one
  // file name and a second game replaced the first - the failure 2.2.0 was
  // built to prevent, through the one door it did not look at.
  //
  // MINOR, and by the same reading as the two below: two optional fields
  // added, nothing existing changed, and a package written without them
  // compiles to exactly the file it compiled to before. adr/0021, "The
  // amendment".
  //
  // 2.2.0 is 2026-09-01: the device holds several collections. The greeting
  // gained a "collections" keyword, the cable gained a `get`, and a collection
  // travels as c<hash>.bin instead of layout.bin.
  //
  // MINOR, by the same reading 1.2.0 and 1.3.0 took: on the cable both ends
  // skip what they do not know, so a talker already flashed neither misreads
  // the addition nor sees it. Nothing the device reads out of a file moved -
  // a collection is the bytes layout_format.h has always parsed, under a
  // different name - so LAYOUT_VERSION did not move either, and neither did
  // CABLE_VERSION, because gaining a verb is not two ends failing to drive
  // each other. adr/0021.
  //
  // 2.1.0 is 2026-08-31, later the same day, and it is what 2.0.0 left out.
  // The bytes of version 3 arrived without anything saying what a device does
  // with them: layout/ stated `does` and `target` key by key, and no fixture
  // anywhere walked a device from one set to the next. There is a kind for
  // that now - press - and the layout fixtures carry walks.
  //
  // MINOR, and by the plainest reading of the rule: nothing the talker reads
  // moved. Not a stride, not a byte, not a keyword. This directory described
  // an interface it was silent about half of, and now it is not - which is
  // the same shape as 1.1.0, where the silence was about the device package.
  //
  // 2.0.0 was earlier on 2026-08-31: layout.bin version 3. Every key of a set now says
  // what it does and where it goes, the set key is a key like the other four,
  // and the reader has room for 64 sets rather than 5.
  //
  // MAJOR, and the rule in docs/device-interface.md section 7 is written about
  // MISREADING rather than about rejecting - which this is not, because the
  // version byte moved with the strides. The rule is still satisfied and the
  // number still has to be MAJOR: a conforming builder at 1.3.0 writes a file
  // a 2.0.0 device refuses, and a 2.0.0 builder writes one every talker
  // flashed before today refuses. Neither can read the other, which is what a
  // MAJOR says. What the version byte buys is that both refusals are silent
  // and legible instead of a set of names and hashes read at the wrong pitch,
  // and that is the difference between an expensive change and a dangerous
  // one - adr/0020.
  //
  // 1.3.0 was 2026-08-30: a tile may travel compressed. 1.2.0 was 2026-08-28:
  // the cable's greeting gained a "firmware" keyword. Both MINOR, because on
  // the cable both ends skip what they do not know, so a device already
  // flashed neither misreads the addition nor sees it.
  device_interface_version: "2.3.0",
  generated_by: "device/tools/make_fixtures.mjs",
  fixtures: index,
};
writeFileSync(join(OUT, "index.json"), JSON.stringify(INDEX, null, 2) + "\n");

process.stdout.write(`${index.length} fixtures written to device/fixtures/\n`);
