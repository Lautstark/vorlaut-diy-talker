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

// --- The compressed form -----------------------------------------------------
//
// A tile is 32768 bytes of RGB565, and what that costs is **the wait at the
// cable**. A full board is five sets of four keys and their labels, which is
// 25 pictures and 800 KB, and the cable moves 60 KB a second (docs/cable.md,
// "A full payload of ten files"). Thirteen seconds of somebody holding a
// talker still, for pictures alone, every time a board changes.
//
// It is deliberately *not* about the room on the partition any more. That was
// the reason this was started on 2026-08-31 - 1536 KiB held 48 tiles and the
// speech had to fit beside them - and ADR 0018 landed the same day and made
// the file area 7040 KiB, which is 220 raw tiles. A board can hold 25. So the
// space argument is gone and the seconds are what is left, which is a smaller
// case than the one this was begun for and is still a real one: those seconds
// are in front of a person every time they change a board.
//
// **The raw form keeps the right of way**, and the order the two tests are
// applied in is the whole of it:
//
//   1. exactly TILE_BYTES long          the raw form. The only length a
//                                       conforming writer emits for it, and
//                                       it is decided before the bytes are
//                                       looked at, so a picture whose first
//                                       pixels happen to spell the magic is
//                                       still a picture.
//   2. otherwise, the magic below       the compressed form.
//   3. otherwise                        the raw form again, with the
//                                       forgiveness it has always had - a
//                                       short file draws black from where it
//                                       stopped, a long one is read to
//                                       TILE_BYTES and the tail ignored.
//
// Step 3 is why this is not simply "the length says which". The first draft
// was, and device/fixtures/tile/over-long caught it inside a minute: 32784
// bytes is not TILE_BYTES and carries no magic, and a rule with only two
// branches would have started refusing a file the device has always drawn.
// The fixtures were written for that boundary before there was a second form
// to confuse it with, and this is them doing the job.
//
// A writer must still never emit a compressed file of exactly TILE_BYTES -
// step 1 would read it as raw. encodeTile() on the browser side falls back to
// the raw bytes whenever the encoding is not smaller, so the case cannot
// arise there, and device/fixtures/tile/ states it as a rule.
//
//   'v' 't' '1'   the magic
//   1 byte        palette entries, minus one: 1..256
//   n * 2         the palette, RGB565 big-endian, same order as the file
//   the stream    one opcode byte at a time:
//
//     0x00..0x7f  a run of (op + 2) pixels of the palette index that follows.
//                 Two is the shortest run worth writing: one pixel costs two
//                 bytes as a run and one as a literal.
//     0x80..0xbf  (op & 0x3f) + 1 palette indices follow, one byte each.
//     0xc0..0xff  (op & 0x3f) + 1 pixels follow, two bytes each, RGB565
//                 big-endian and not in the palette at all.
//
// The third opcode is what makes the palette optional rather than a limit. An
// anti-aliased symbol goes past 256 colours often enough - five of the
// fourteen frozen tiles do - and without an escape those files would have had
// to stay raw. With it the palette holds the 256 that pay for themselves and
// everything else is written out; see adr/0019.
//
// Two things are deliberately NOT in the file: the width and the height. They
// are agreed out of band exactly as they are for the raw form, so there is one
// agreement about a tile's size rather than two that can disagree.

#define TILE_MAGIC_0 'v'
#define TILE_MAGIC_1 't'
#define TILE_MAGIC_2 '1'
#define TILE_PALETTE_MAX 256
#define TILE_PIXELS ((uint32_t)TILE_W * (uint32_t)TILE_H)

// Read in blocks rather than a byte at a time: every read() is a call into the
// file system, and a tile is tens of thousands of opcodes.
#define TILE_INPUT_BYTES 128

// Everything the decoder carries between two rows. About 700 bytes, and one
// of these is enough for the whole device because drawTile() draws one tile at
// a time - it is declared static there for that reason.
struct TileStream {
  uint16_t palette[TILE_PALETTE_MAX];
  uint16_t colours;         // how many of them the file actually named
  bool compressed;
  uint32_t pixelsLeft;      // what the tile still owes, in pixels
  uint32_t runLeft;         // a run that did not fit in the last row
  uint16_t runValue;
  uint32_t literalLeft;     // likewise a literal stretch
  bool literalRaw;          // ... of pixels rather than of indices
  uint8_t in[TILE_INPUT_BYTES];
  uint32_t inAt, inHave;
  bool ended;               // the file ran out; everything after is black
};

// One byte of the stream, or false at the end of the file.
template <class Reader>
static inline bool tileByte(Reader &file, TileStream &s, uint8_t *out) {
  if (s.inAt == s.inHave) {
    s.inHave = (uint32_t)file.read(s.in, TILE_INPUT_BYTES);
    s.inAt = 0;
    if (s.inHave == 0) { s.ended = true; return false; }
  }
  *out = s.in[s.inAt++];
  return true;
}

// Opens a tile and says whether it can be drawn at all.
//
// `length` is the file's size, and it is the first of the two tests above; the
// caller has it and the reader does not, so it is passed rather than guessed.
//
// False means a file that says it is compressed and then is not: the magic is
// there and the palette it claims does not fit. That is the only way a tile
// can be refused, and the device draws black for it - which is what it already
// draws for a file that will not open. Everything else is a raw tile, however
// long, because that is what it was yesterday.
template <class Reader>
static inline bool tileBegin(Reader &file, uint32_t length, TileStream &s) {
  memset(&s, 0, sizeof(s));
  s.pixelsLeft = TILE_PIXELS;
  if (length == TILE_BYTES) return true;      // the raw form, unchanged

  // Read straight from the file rather than through the buffer below, so that
  // putting these bytes back costs a seek rather than a second code path: a
  // file that turns out to be raw has to be read from its first byte, and
  // seek() is what wav_format.h uses for the same reason.
  uint8_t head[4];
  if (file.read(head, 4) != 4 ||
      head[0] != TILE_MAGIC_0 || head[1] != TILE_MAGIC_1 ||
      head[2] != TILE_MAGIC_2) {
    file.seek(0);
    return true;                              // raw, of a length nobody meant
  }

  const uint16_t colours = (uint16_t)head[3] + 1;
  for (uint16_t i = 0; i < colours; i++) {
    uint8_t pair[2];
    if (file.read(pair, 2) != 2) return false;   // says it is, and is not
    s.palette[i] = (uint16_t)((uint16_t)pair[0] << 8 | pair[1]);
  }
  // Everything past the palette stays zero, so an index the file has no
  // colour for draws black rather than reading whatever was there before.
  s.colours = colours;
  s.compressed = true;
  return true;
}

// The next row, black wherever the file had nothing left to say.
//
// Same shape and same silence as tileReadRow() above, and the same return
// value: how many bytes of real content arrived. A run may cross the end of a
// row - the stream is one sequence of pixels and the rows are only where the
// panel wants them - so what is left of it is carried in the stream.
template <class Reader>
static inline uint32_t tileNextRow(Reader &file, TileStream &s, uint8_t *row) {
  if (!s.compressed) return tileReadRow(file, row);

  uint32_t at = 0;
  const uint32_t want = (uint32_t)TILE_W * 2u;
  while (at < want && s.pixelsLeft > 0) {
    if (s.runLeft > 0) {
      row[at++] = (uint8_t)(s.runValue >> 8);
      row[at++] = (uint8_t)(s.runValue & 0xff);
      s.runLeft--; s.pixelsLeft--;
      continue;
    }
    if (s.literalLeft > 0) {
      uint8_t a, b;
      if (!tileByte(file, s, &a)) break;
      if (s.literalRaw) {
        if (!tileByte(file, s, &b)) break;
        row[at++] = a; row[at++] = b;
      } else {
        const uint16_t value = s.palette[a];
        row[at++] = (uint8_t)(value >> 8);
        row[at++] = (uint8_t)(value & 0xff);
      }
      s.literalLeft--; s.pixelsLeft--;
      continue;
    }
    uint8_t op;
    if (!tileByte(file, s, &op)) break;
    if (op < 0x80) {
      uint8_t index;
      if (!tileByte(file, s, &index)) break;
      s.runValue = s.palette[index];
      s.runLeft = (uint32_t)op + 2u;
    } else if (op < 0xc0) {
      s.literalLeft = (uint32_t)(op & 0x3f) + 1u;
      s.literalRaw = false;
    } else {
      s.literalLeft = (uint32_t)(op & 0x3f) + 1u;
      s.literalRaw = true;
    }
  }
  if (at < want) memset(row + at, 0, want - at);
  return at;
}
