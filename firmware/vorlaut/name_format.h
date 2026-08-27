// How sixteen hash bytes become a file name.
//
// The name rule is stated three times in this repository: hashBytes() in
// loader/src/layout_format.ts reads a hash back out of a name, hashPath() below
// writes one, and cableNameOk() in cable_format.h independently decides which
// names the device is willing to store. The third has to be a superset of the
// first two or a file silently never arrives - no error anywhere, one black
// key - and until device/fixtures/names.expected.json nothing said so.
//
// hashPath() was in vorlaut.ino, which is why nothing could ask it anything.
// It is here for the same reason TILE_W is in tile_format.h.
//
// The rule, in words:
//
//   a slash, then t or a, then exactly 32 LOWER-CASE hex digits, then the
//   suffix. The 32 digits are the first sixteen bytes of a hash OF THE INPUT
//   that produced the file - the source picture and the pipeline version, the
//   sentence and the voice - and never of the file's own bytes. A name says
//   which content was meant; it can never say which content arrived, and that
//   is what the cable's checksum is for.

#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>

// For HASH_BYTES, and the dependency is the right way round: the sixteen
// bytes are a field of layout.bin and this is how that field is spelled.
#include "layout_format.h"

// Builds the file name out of 16 hash bytes: /t<32 hex>.bin or /a....wav
static inline void hashPath(char *out, char kind, const uint8_t *hash,
                            const char *ext) {
  out[0] = '/';
  out[1] = kind;
  for (uint8_t i = 0; i < HASH_BYTES; i++) {
    // snprintf and not the sprintf this was: two digits and a terminator
    // either way, and the terminator is overwritten by the next digit pair or
    // by the suffix below. The bound is here because the moment this file
    // became includable it started being compiled by a host toolchain that
    // refuses sprintf outright, which is a fair thing to be refused.
    snprintf(out + 2 + i * 2, 3, "%02x", hash[i]);
  }
  strcpy(out + 2 + HASH_BYTES * 2, ext);
}
