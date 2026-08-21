// Structure of layout.bin - shared by the firmware and the test.
//
// Deliberately without any Arduino dependency: that way the same code can be
// compiled on the computer and checked against a file produced by build.py.
// Strides and byte order are exactly the places one gets wrong, and on the
// device it only shows once it has been flashed.
//
// The file is produced by build.py - the same structure is written down there.

#pragma once
#include <stdint.h>
#include <string.h>

#define SLOT_COUNT 4
#define MAX_SETS 5
#define HASH_BYTES 16
#define NAME_BYTES 32
#define LAYOUT_VERSION 1

// Fixed strides. Have to agree with build.py.
#define LAYOUT_HEADER_BYTES 12
#define LAYOUT_SLOT_BYTES (HASH_BYTES + HASH_BYTES + 1 + 1)          // 34
#define LAYOUT_SET_BYTES (2 + NAME_BYTES + HASH_BYTES + SLOT_COUNT * LAYOUT_SLOT_BYTES)  // 186
#define LAYOUT_MAX_BYTES (LAYOUT_HEADER_BYTES + MAX_SETS * LAYOUT_SET_BYTES)             // 942

struct Slot {
  uint8_t image[HASH_BYTES];
  uint8_t audio[HASH_BYTES];
  bool hasAudio;
};

struct SetEntry {
  uint16_t color;
  char name[NAME_BYTES + 1];
  uint8_t label[HASH_BYTES];
  Slot slots[SLOT_COUNT];
};

struct Layout {
  uint8_t setCount;
  // Index into LANGUAGES in texts.h. It rides along in the content and not
  // in the program, so the same firmware image speaks every language and a
  // change needs no cable - exactly like set names and colours.
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

// Small helpers instead of memcpy onto structs: the file is little-endian,
// regardless of how the compiler aligns structs.
static inline uint16_t layoutU16(const uint8_t *p) {
  return (uint16_t)(p[0] | (p[1] << 8));
}

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
  // Byte 7 was reserved and written as zero, and zero is English - so an old
  // layout.bin stays readable and simply gets the default.
  out.language = data[7];
  out.sleepSeconds = layoutU32(data + 8);

  for (uint8_t i = 0; i < sets; i++) {
    const uint8_t *s = data + LAYOUT_HEADER_BYTES + (uint32_t)i * LAYOUT_SET_BYTES;
    SetEntry &e = out.sets[i];
    e.color = layoutU16(s);
    memcpy(e.name, s + 2, NAME_BYTES);
    e.name[NAME_BYTES] = '\0';
    memcpy(e.label, s + 2 + NAME_BYTES, HASH_BYTES);
    const uint8_t *slots = s + 2 + NAME_BYTES + HASH_BYTES;
    for (uint8_t j = 0; j < SLOT_COUNT; j++) {
      const uint8_t *t = slots + (uint32_t)j * LAYOUT_SLOT_BYTES;
      memcpy(e.slots[j].image, t, HASH_BYTES);
      memcpy(e.slots[j].audio, t + HASH_BYTES, HASH_BYTES);
      e.slots[j].hasAudio = t[2 * HASH_BYTES] != 0;
    }
  }
  return LAYOUT_OK;
}
