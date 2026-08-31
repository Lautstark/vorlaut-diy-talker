// Structure of layout.bin - shared by the firmware and the test.
//
// Deliberately without any Arduino dependency: that way the same code can be
// compiled on the computer and checked against a file the builder really
// produced. Strides and byte order are exactly the places one gets wrong, and
// on the device it only shows once it has been flashed.
//
// The file is produced by renderLayoutBin() in loader/src/layout_format.ts,
// which is where the same structure is written down a second time. That was
// build.py's job until 2026-08-22, alongside layout_format.py and
// static/layout_format.js; all three went when the Python half did, and the
// browser is the only writer now. tests/test_layout_frozen.py compiles this
// header and reads what that writer produced.

#pragma once
#include <stdint.h>
#include <string.h>

#define SLOT_COUNT 4
// The set key beside the four speech keys. It became a key like the others in
// version 3 - see the note on LAYOUT_VERSION - and this is the number of
// panels the device lights, which is DISPLAY_COUNT in pins.h arrived at from
// the file rather than from the wiring.
#define KEY_COUNT (SLOT_COUNT + 1)
// How much room the reader has for sets. Not a number in the file: a layout
// naming more than this is refused, and a device flashed with a smaller one
// cannot be given a larger one afterwards. adr/0020 is where 64 comes from
// and what it costs; the short version is that the file partition runs out
// somewhere around forty sets of a game's size while SRAM would hold hundreds,
// so this is set past the ceiling that actually binds.
#define MAX_SETS 64
#define HASH_BYTES 16
#define NAME_BYTES 32
// 3 rather than 2: every key of a set now carries what it DOES and where it
// GOES, and the set key carries a sound of its own, so a set entry is 212
// bytes where it was 184. A version-2 file is shorter than the length rule
// asks for rather than longer, so it would be refused for its length even
// without this - but "refused for the wrong reason" is a check that has
// stopped running, and a version-2 file with a set count that happened to make
// the arithmetic work out is not a case worth relying on being impossible.
// Refused here instead, which loadLayout() shows as a device with no content
// on it and a line on the serial port saying which reason.
//
// 2 was the set entry losing its colour; 1 was before that.
#define LAYOUT_VERSION 3

// The sleep timeout: the range a builder may write, and what the device does
// with everything else.
//
// The field is a uint32 and parseLayout hands it back exactly as it stands.
// That is the same rule byte 7 follows and it is deliberate twice over: what a
// number MEANS is not a parser's business, and tests/reference/layout.lock.json
// holds this reader to handing back 0 and 0xffffffff unchanged. So the meaning
// is settled here, at the point the number becomes a length of time, and both
// ends of the field are settled rather than left to arithmetic:
//
//   zero      What a writer leaves in the field when it has nothing to say.
//             It means LAYOUT_SLEEP_DEFAULT - which is what the device already
//             did, in a `? :` in vorlaut.ino with a bare 600 in it. The same
//             600 was written down a second time as DEFAULT_SLEEP_TIMEOUT in
//             src/data/obf.ts, and the two agreed by coincidence rather than
//             because either knew about the other. This is that number, once.
//   the top   0xffffffff seconds is 136 years, and `idle * 1000UL` wraps where
//             unsigned long is 32 bits. Anything above 4294967 seconds is a
//             different length of time from the one written, silently and
//             without a wrong-looking byte anywhere - so the largest timeout
//             the format can express was not one the device could wait for.
//             Clamped, so that it is.
//
// A conforming builder writes between LAYOUT_SLEEP_MIN and LAYOUT_SLEEP_MAX,
// or zero for the default, and normalizeLayout() in src/data/obf.ts already
// holds every builder here to exactly that. What this function is for is
// everything that does not go through it: a second builder, a hand-written
// layout.bin, a file from a version of this project that has not been written
// yet. A flashed device cannot be given a writer rule afterwards, which is why
// this half exists at all rather than only the sentence in the specification.
#define LAYOUT_SLEEP_MIN 10u
#define LAYOUT_SLEEP_MAX 86400u
#define LAYOUT_SLEEP_DEFAULT 600u

// What the device really waits, given the field.
//
// Beside parseLayout and deliberately never inside it. The reason is worth
// stating exactly, because the obvious version of it is wrong: a clamp in
// there does NOT turn tests/reference/layout.lock.json red. Two of its
// seventeen cases hold the values that would move - "sleep of zero" and "sleep
// at both ends of the uint32" - and both are kind "bytes", whose recorded
// reader lines nothing compares. The nine cases that ARE compared field by
// field all carry timeouts inside the range, so they would go on passing.
//
// What a clamp in parseLayout would really do is leave that lock stating, of
// this reader, an answer this reader no longer gives - silently, with no test
// anywhere to notice, and with no way back: the oracle that wrote it went on
// 2026-08-22 and docs/frozen-references.md is explicit that refreezing from
// the module under test is never the answer. A red test is an argument that
// can be won by editing the test. A frozen reference quietly describing
// something that no longer exists is the failure that document is about.
//
// So the parse stays what it was, and device/fixtures/ is what holds this
// function: sleep_seconds and idle_seconds are checked separately there, which
// is the check the lock cannot make.
static inline uint32_t layoutIdleSeconds(uint32_t sleepSeconds) {
  if (sleepSeconds == 0) return LAYOUT_SLEEP_DEFAULT;
  if (sleepSeconds < LAYOUT_SLEEP_MIN) return LAYOUT_SLEEP_MIN;
  if (sleepSeconds > LAYOUT_SLEEP_MAX) return LAYOUT_SLEEP_MAX;
  return sleepSeconds;
}

// What a key does when it is pressed, and where it goes.
//
// Three values in one byte, and the same three the editor offers as Wort,
// Wort & weiter and weiter. They are a field rather than a mode: there is no
// game in this format and no notion of an answer being right. A key that goes
// somewhere is a key that goes somewhere, and a round of the joining game is
// four keys of which one happens to be the only one that does.
//
// The byte the file holds is handed back as it stands - the rule byte 7 and
// the sleep timeout already follow - and what it MEANS is settled in the two
// functions below, where device/fixtures/ can hold both halves separately.
// That matters for exactly one reason: a value neither this version nor any
// later one has to explain must not be able to break a flashed device. So an
// unknown value is not refused and is not a jump; it is a key that says its
// own word and stays where it is, which is what every key in version 2 did.
#define LAYOUT_KEY_SPEAK 0
#define LAYOUT_KEY_SPEAK_AND_GO 1
#define LAYOUT_KEY_GO 2

/** Whether the key says its own word. Anything but "go" does. */
static inline bool layoutKeySpeaks(uint8_t does) {
  return does != LAYOUT_KEY_GO;
}

/**
 * Which set the key really goes to, or -1 where it goes nowhere.
 *
 * Two ways to go nowhere, and they are one answer on purpose:
 *
 *   the key does not navigate    LAYOUT_KEY_SPEAK, and every value this
 *                                version does not know.
 *   the target names no set      A byte between the set count and 255. The
 *                                field is a uint8 and the count is a uint8,
 *                                so the format can say it; sets[] cannot
 *                                hold it, and reading past the array is the
 *                                one outcome a parser must never have.
 *
 * Staying put rather than falling back to set 0. docs/device-interface.md
 * section 6 is the argument: a key that does the wrong thing is worse than one
 * that does nothing, because a child pressing it learns something untrue about
 * their own talker. A key that does nothing is visibly broken; a key that
 * jumps somewhere arbitrary looks like it worked.
 */
static inline int16_t layoutKeyGoesTo(uint8_t does, uint8_t target,
                                      uint8_t setCount) {
  if (does != LAYOUT_KEY_SPEAK_AND_GO && does != LAYOUT_KEY_GO) return -1;
  if (target >= setCount) return -1;
  return (int16_t)target;
}

// Fixed strides. Have to agree with loader/src/layout_format.ts.
#define LAYOUT_HEADER_BYTES 12
// image, audio, has-audio, what it does, where it goes, and one byte spare.
// The spare byte is what the has-audio flag was followed by in version 2 and
// it is kept rather than spent: it was the only room this format had left, and
// spending the room while widening the structure would leave the next change
// with nowhere to go but another MAJOR. See docs/format-freeze.md section 4.
#define LAYOUT_KEY_BYTES (HASH_BYTES + HASH_BYTES + 1 + 1 + 1 + 1)            // 36
#define LAYOUT_SET_BYTES (NAME_BYTES + KEY_COUNT * LAYOUT_KEY_BYTES)          // 212
#define LAYOUT_MAX_BYTES (LAYOUT_HEADER_BYTES + MAX_SETS * LAYOUT_SET_BYTES)  // 13580

struct Key {
  uint8_t image[HASH_BYTES];
  uint8_t audio[HASH_BYTES];
  bool hasAudio;
  /** LAYOUT_KEY_SPEAK, _SPEAK_AND_GO or _GO - as the file says it, not as it
   *  is meant. layoutKeySpeaks() and layoutKeyGoesTo() are the meaning. */
  uint8_t does;
  /** The set this key goes to, where it goes anywhere. Handed back as it
   *  stands, including a value no set stands behind. */
  uint8_t target;
};

struct SetEntry {
  char name[NAME_BYTES + 1];
  /** The fifth panel. It held a picture and nothing else until version 3 -
   *  the field was called `label`, the device drew it, and switching sets was
   *  arithmetic in vorlaut.ino rather than anything the file said. It is a key
   *  now, and the ring it used to be is what a conforming builder writes into
   *  it: LAYOUT_KEY_GO, to the next set. */
  Key key;
  Key slots[SLOT_COUNT];
};

struct Layout {
  uint8_t setCount;
  // Index into LANGUAGES in texts.h. It rides along in the content and not
  // in the program, so the same firmware image speaks every language and a
  // change needs no cable - exactly like the set names beside it.
  uint8_t language;
  uint32_t sleepSeconds;
  SetEntry sets[MAX_SETS];
};

enum LayoutResult {
  LAYOUT_OK = 0,
  LAYOUT_TOO_SHORT,
  LAYOUT_BAD_MAGIC,
  LAYOUT_BAD_VERSION,
  LAYOUT_BAD_SLOT_COUNT,
  LAYOUT_BAD_LENGTH,
};

// A helper instead of memcpy onto a struct: the file is little-endian,
// regardless of how the compiler aligns structs. There was a layoutU16 beside
// this one and the set colour was the only thing that read a u16; it went with
// the colour rather than staying as a helper nothing calls.
static inline uint32_t layoutU32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16)
       | ((uint32_t)p[3] << 24);
}

/** One key out of the LAYOUT_KEY_BYTES at `p`. The spare byte is not read. */
static inline void layoutReadKey(const uint8_t *p, Key &into) {
  memcpy(into.image, p, HASH_BYTES);
  memcpy(into.audio, p + HASH_BYTES, HASH_BYTES);
  into.hasAudio = p[2 * HASH_BYTES] != 0;
  into.does = p[2 * HASH_BYTES + 1];
  into.target = p[2 * HASH_BYTES + 2];
}

static inline LayoutResult parseLayout(const uint8_t *data, uint32_t length,
                                       Layout &out) {
  if (length < LAYOUT_HEADER_BYTES) return LAYOUT_TOO_SHORT;
  if (memcmp(data, "MTRD", 4) != 0) return LAYOUT_BAD_MAGIC;
  if (data[4] != LAYOUT_VERSION) return LAYOUT_BAD_VERSION;

  const uint8_t sets = data[5];
  if (data[6] != SLOT_COUNT) return LAYOUT_BAD_SLOT_COUNT;
  if (sets > MAX_SETS) return LAYOUT_BAD_LENGTH;
  if (length < (uint32_t)LAYOUT_HEADER_BYTES + (uint32_t)sets * LAYOUT_SET_BYTES) {
    return LAYOUT_BAD_LENGTH;
  }

  out.setCount = sets;
  // Byte 7 was reserved and written as zero, and zero is English. That was
  // once what let a file from before the language byte still be read; version
  // 2 refuses those outright now, so what is left of it is that zero means
  // English rather than an unset byte meaning nothing.
  out.language = data[7];
  out.sleepSeconds = layoutU32(data + 8);

  for (uint8_t i = 0; i < sets; i++) {
    const uint8_t *s = data + LAYOUT_HEADER_BYTES + (uint32_t)i * LAYOUT_SET_BYTES;
    SetEntry &e = out.sets[i];
    memcpy(e.name, s, NAME_BYTES);
    e.name[NAME_BYTES] = '\0';
    const uint8_t *keys = s + NAME_BYTES;
    // The set key first, where the label hash sat in version 2, and then the
    // four speech keys. Same order the panels are written down in everywhere
    // else: the set names its own key, and the keys it speaks with follow.
    layoutReadKey(keys, e.key);
    for (uint8_t j = 0; j < SLOT_COUNT; j++) {
      layoutReadKey(keys + (uint32_t)(j + 1) * LAYOUT_KEY_BYTES, e.slots[j]);
    }
  }
  return LAYOUT_OK;
}
