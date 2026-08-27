// The geometry of a t<hash>.bin, and nothing else.
//
// These three numbers were #defines in vorlaut.ino, next to the display
// pixels they happen to equal. That put them somewhere no test could reach:
// the browser's TILE_SIZE in loader/src/tiles.ts is the same number written a
// second time, and nothing has ever compared them. A tile carries no header,
// so its size is agreed out of band or not at all - which makes this file the
// agreement.
//
// Deliberately without any Arduino dependency, like layout_format.h: that way
// tests/device_host.cpp can include it and hold it against
// device/fixtures/tile/.
//
// What a reader does with a file that is not TILE_BYTES long is format
// behaviour and is written down in device/fixtures/tile/, not here, because
// drawTile() is where it happens and drawTile() needs a display.

#pragma once
#include <stdint.h>
#include <string.h>

// The whole panel. A tile used to be the square inside a six-pixel border in
// the set's colour; the colour went on 2026-08-26 and the file is the whole
// display now.
#define TILE_W 128
#define TILE_H 128

// RGB565, big-endian, no header, row by row from the top left. The bytes go
// to the panel exactly as they stand in the file, which is why the endianness
// is the panel's rather than the machine's.
#define TILE_BYTES ((uint32_t)TILE_W * (uint32_t)TILE_H * 2u)

// --- Reading one -------------------------------------------------------------

// One row of a tile, with whatever did not arrive filled in as black.
//
// This is drawTile()'s inner loop, lifted out so that it can be asked a
// question without a display attached. The zero fill is the format behaviour
// that was written down nowhere: a file short of TILE_BYTES draws partly black
// and the device says nothing at all about it, and device/fixtures/tile/short
// is where that is now stated.
//
// Returns how many real bytes arrived, which the caller is free to ignore -
// the device does, and that is the behaviour rather than an oversight.
template <class Reader>
static inline uint32_t tileReadRow(Reader &file, uint8_t *row) {
  const uint32_t want = (uint32_t)TILE_W * 2u;
  const uint32_t got = (uint32_t)file.read(row, want);
  if (got < want) memset(row + got, 0, want - got);
  return got;
}
