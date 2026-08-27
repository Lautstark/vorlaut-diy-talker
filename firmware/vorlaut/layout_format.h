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
#define MAX_SETS 5
#define HASH_BYTES 16
#define NAME_BYTES 32
// 2 rather than 1: the set entry lost its colour and is two bytes shorter,
// so a layout.bin written before that is not a shorter file but a
// differently shaped one. Its length still adds up - 186 per set is more
// than 184, not less - so without this the reader would take it and hand
// back names and hashes read two bytes late. Refused here instead, which
// loadLayout() shows as a device with no content on it and a line on the
// serial port saying which reason.
#define LAYOUT_VERSION 2

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

// Fixed strides. Have to agree with loader/src/layout_format.ts.
#define LAYOUT_HEADER_BYTES 12
#define LAYOUT_SLOT_BYTES (HASH_BYTES + HASH_BYTES + 1 + 1)          // 34
#define LAYOUT_SET_BYTES (NAME_BYTES + HASH_BYTES + SLOT_COUNT * LAYOUT_SLOT_BYTES)  // 184
#define LAYOUT_MAX_BYTES (LAYOUT_HEADER_BYTES + MAX_SETS * LAYOUT_SET_BYTES)         // 932

struct Slot {
  uint8_t image[HASH_BYTES];
  uint8_t audio[HASH_BYTES];
  bool hasAudio;
};

struct SetEntry {
  char name[NAME_BYTES + 1];
  uint8_t label[HASH_BYTES];
  Slot slots[SLOT_COUNT];
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
    memcpy(e.label, s + NAME_BYTES, HASH_BYTES);
    const uint8_t *slots = s + NAME_BYTES + HASH_BYTES;
    for (uint8_t j = 0; j < SLOT_COUNT; j++) {
      const uint8_t *t = slots + (uint32_t)j * LAYOUT_SLOT_BYTES;
      memcpy(e.slots[j].image, t, HASH_BYTES);
      memcpy(e.slots[j].audio, t + HASH_BYTES, HASH_BYTES);
      e.slots[j].hasAudio = t[2 * HASH_BYTES] != 0;
    }
  }
  return LAYOUT_OK;
}
