// Turning text into something the panels can actually draw.
//
// The built-in Adafruit-GFX font is not Unicode. It draws one byte as one
// glyph, and for bytes above 0x7F it uses code page 437 - the old PC
// character set. A UTF-8 source file hands it two bytes for "ü", so the
// panel drew two glyphs: "zurück" came out as "zur├╝ck", and because the
// centring counted bytes it sat six pixels off as well.
//
// So both jobs happen here, and they are the same walk through the string:
// translate the bytes, and count the glyphs.
//
// Deliberately without any Arduino dependency, like layout_format.h: that way
// tests/test_texts.py can compile it on the computer and check every string
// in texts.h against the width of a display.

#pragma once
#include <stdint.h>

// Latin-1 and a few neighbours, as far as code page 437 has them. Not a
// complete table - it holds what the languages in texts.h need plus the
// accented letters of the western European languages, so the next translation
// does not have to touch this file.
//
// What is missing has no glyph in the font at all: ø, ł, ő, the Polish,
// Turkish, Czech and Cyrillic letters. Those need a font of their own
// (GFXfont), which is a different job - see docs/firmware.md.
struct Cp437Entry { uint16_t code; uint8_t byte; };

static const Cp437Entry CP437_TABLE[] = {
  {0xC4, 0x8E}, {0xC5, 0x8F}, {0xC6, 0x92}, {0xC7, 0x80}, {0xC9, 0x90},
  {0xD1, 0xA5}, {0xD6, 0x99}, {0xDC, 0x9A}, {0xDF, 0xE1},
  {0xE0, 0x85}, {0xE1, 0xA0}, {0xE2, 0x83}, {0xE4, 0x84}, {0xE5, 0x86},
  {0xE6, 0x91}, {0xE7, 0x87}, {0xE8, 0x8A}, {0xE9, 0x82}, {0xEA, 0x88},
  {0xEB, 0x89}, {0xEC, 0x8D}, {0xED, 0xA1}, {0xEE, 0x8C}, {0xEF, 0x8B},
  {0xF1, 0xA4}, {0xF2, 0x95}, {0xF3, 0xA2}, {0xF4, 0x93}, {0xF6, 0x94},
  {0xF9, 0x97}, {0xFA, 0xA3}, {0xFB, 0x96}, {0xFC, 0x81}, {0xFF, 0x98},
};

#define CP437_COUNT (sizeof(CP437_TABLE) / sizeof(CP437_TABLE[0]))

// A letter the font does not have. Better a visible gap than a random glyph:
// whoever sees it knows the translation needs a different word.
#define CP437_UNKNOWN '?'

static inline uint8_t cp437Byte(uint16_t code) {
  if (code < 0x80) return (uint8_t)code;
  for (uint8_t i = 0; i < CP437_COUNT; i++) {
    if (CP437_TABLE[i].code == code) return CP437_TABLE[i].byte;
  }
  return CP437_UNKNOWN;
}

// Converts UTF-8 into the bytes the font draws and returns the number of
// GLYPHS, which is what the centring needs - not the number of bytes.
//
// outSize counts the terminating zero. Anything that does not fit is dropped;
// a label too long is a mistake to catch in the test, not something to crash
// over here.
static inline uint8_t toPanelText(const char *in, char *out, uint8_t outSize) {
  uint8_t n = 0;
  if (!out || outSize == 0) return 0;
  if (!in) { out[0] = '\0'; return 0; }

  while (*in && n + 1 < outSize) {
    const uint8_t c = (uint8_t)*in;
    uint16_t code;
    if (c < 0x80) {
      code = c;
      in += 1;
    } else if ((c & 0xE0) == 0xC0 && (in[1] & 0xC0) == 0x80) {
      code = (uint16_t)((c & 0x1F) << 6) | (in[1] & 0x3F);
      in += 2;
    } else {
      // Three bytes or more, or a broken sequence: one placeholder, and skip
      // every continuation byte that follows.
      code = CP437_UNKNOWN;
      in += 1;
      while ((*in & 0xC0) == 0x80) in++;
    }
    out[n++] = (char)cp437Byte(code);
  }
  out[n] = '\0';
  return n;
}
