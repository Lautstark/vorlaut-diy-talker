// Aufbau von layout.bin - gemeinsam genutzt von der Firmware und vom Test.
//
// Absichtlich ohne jede Arduino-Abhängigkeit: so lässt sich derselbe Code auf
// dem Rechner übersetzen und gegen eine von build.py erzeugte Datei prüfen.
// Schrittweiten und Byte-Reihenfolge sind genau die Stellen, an denen man sich
// vertut, und auf dem Gerät merkt man es erst beim Flashen.
//
// Erzeugt wird die Datei von build.py - dort steht dieselbe Struktur.

#pragma once
#include <stdint.h>
#include <string.h>

#define SLOT_COUNT 4
#define MAX_SETS 5
#define HASH_BYTES 16
#define NAME_BYTES 32
#define LAYOUT_VERSION 1

// Feste Schrittweiten. Müssen mit build.py übereinstimmen.
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
  uint32_t sleepSeconds;
  SetEntry sets[MAX_SETS];
};

enum LayoutResult {
  LAYOUT_OK = 0,
  LAYOUT_ZU_KURZ,
  LAYOUT_KENNUNG,
  LAYOUT_VERSION_FALSCH,
  LAYOUT_TASTENZAHL,
  LAYOUT_LAENGE,
};

// Kleine Helfer statt memcpy auf Strukturen: die Datei ist little-endian,
// unabhängig davon, wie der Übersetzer Strukturen ausrichtet.
static inline uint16_t layoutU16(const uint8_t *p) {
  return (uint16_t)(p[0] | (p[1] << 8));
}

static inline uint32_t layoutU32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16)
       | ((uint32_t)p[3] << 24);
}

static inline LayoutResult parseLayout(const uint8_t *daten, uint32_t laenge,
                                       Layout &out) {
  if (laenge < LAYOUT_HEADER_BYTES) return LAYOUT_ZU_KURZ;
  if (memcmp(daten, "MTRD", 4) != 0) return LAYOUT_KENNUNG;
  if (daten[4] != LAYOUT_VERSION) return LAYOUT_VERSION_FALSCH;

  const uint8_t sets = daten[5];
  if (daten[6] != SLOT_COUNT) return LAYOUT_TASTENZAHL;
  if (sets > MAX_SETS) return LAYOUT_LAENGE;
  if (laenge < (uint32_t)LAYOUT_HEADER_BYTES + (uint32_t)sets * LAYOUT_SET_BYTES) {
    return LAYOUT_LAENGE;
  }

  out.setCount = sets;
  out.sleepSeconds = layoutU32(daten + 8);

  for (uint8_t i = 0; i < sets; i++) {
    const uint8_t *s = daten + LAYOUT_HEADER_BYTES + (uint32_t)i * LAYOUT_SET_BYTES;
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
