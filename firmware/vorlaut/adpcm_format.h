// The compressed form of an a<hash>.wav, and nothing else.
//
// A recording is 16-bit PCM at 16 kHz, so a second of speech is 32000 bytes,
// and what that costs is both of the things a tile costs. Four collections
// beside each other are 6031 KiB of speech against about 6500 KiB of file
// area once the pictures are in it - 93 per cent of what is occupied - and the
// cable moves 60 KB a second, which is a hundred seconds of somebody holding a
// talker still. IMA ADPCM is four bits a sample, so both numbers divide by
// roughly four.
//
// It stays a WAV. IMA ADPCM is WAVE format tag 0x11, the container does not
// change, seekToWavData() still walks to the data chunk, and the reader
// branches on the tag in fmt rather than on a new file extension. A codec
// change, not a container change - which is why this file sits beside
// wav_format.h rather than replacing it.
//
// Deliberately without any Arduino dependency, like tile_format.h and
// layout_format.h: that way tests/adpcm_dump.cpp can compile it on the
// computer and hold it against what loader/src/audio_encode.ts really wrote,
// instead of on a device that plays noise and says nothing about why.
//
// What this file is NOT is a streaming reader. playWav() already has the whole
// word in RAM or a chunk of it in a buffer, and a block is decoded out of
// bytes the caller is holding. That matters more here than it looks: the
// decoder runs inside the loop that feeds I2S, docs/bring-up.md stage 5 is
// what a starved bus sounds like, and a decoder that could go to the file
// system mid-block would be a new way to starve it.

#pragma once
#include <stdint.h>

// The tag itself is a field of the fmt chunk rather than of this codec, so
// WAV_FORMAT_IMA_ADPCM lives in wav_format.h beside the reader that reports
// it. What is here is what the tag means once it has been seen.

// One block of encoded samples, in bytes. 256 is what every other writer of
// this format uses, and the reason to follow them is the bench: these files
// are opened in something else when a word sounds wrong, and a block size
// nobody else emits would make that a test of the reader.
#define ADPCM_BLOCK_BYTES 256u

// What one block decodes to: the first sample comes out of the block header
// whole, and every byte after the header carries two. 505 samples, 1010 bytes,
// about 32 ms - the same order as the AUDIO_CHUNK playWav() already writes, so
// the decoder changes the size of a write and not the shape of the loop.
#define ADPCM_BLOCK_SAMPLES (1u + (ADPCM_BLOCK_BYTES - 4u) * 2u)

// The two tables IMA ADPCM is. Fixed by the format rather than chosen here,
// and written out in both halves of this repository on purpose: an encoder and
// a decoder that disagree about one entry produce a word that drifts into
// noise over its own length rather than one that fails, and
// tests/test_adpcm.py is what runs one against the other so that a typo here
// is a red test instead of a talker that has started slurring.
static const int16_t ADPCM_STEP[89] = {
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
};
static const int8_t ADPCM_INDEX[16] = {
  -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
};

// Where the decoder is between two samples. Held across the nibbles of one
// block and thrown away at the next, because every block states both numbers
// in its own header - which is what makes a block readable on its own and is
// the reason a word can be decoded straight out of the middle of a file.
struct AdpcmState {
  int32_t predictor;   // wider than a sample so the clamp is a clamp
  int32_t index;       // into ADPCM_STEP
};

// One nibble into one sample, moving the state exactly as the encoder did.
//
// The three shifts are added up rather than the difference being recomputed
// from the nibble afterwards, and the same three are added up in
// encodeSample() over in audio_encode.ts. That is not a shortcut: it is what
// keeps the encoder's idea of where the signal is and this one's the same
// number at every sample of the word.
static inline int16_t adpcmSample(uint8_t nibble, AdpcmState &s) {
  const int32_t step = ADPCM_STEP[s.index];
  int32_t diff = step >> 3;
  if (nibble & 4) diff += step;
  if (nibble & 2) diff += step >> 1;
  if (nibble & 1) diff += step >> 2;
  s.predictor = (nibble & 8) ? s.predictor - diff : s.predictor + diff;
  if (s.predictor < -32768) s.predictor = -32768;
  if (s.predictor > 32767) s.predictor = 32767;
  s.index += ADPCM_INDEX[nibble];
  if (s.index < 0) s.index = 0;
  if (s.index > 88) s.index = 88;
  return (int16_t)s.predictor;
}

// One block, decoded into `out`, which must hold ADPCM_BLOCK_SAMPLES. Returns
// how many samples it wrote.
//
// `bytes` is what the caller actually has, not what a block is supposed to be,
// and the difference is the forgiveness this format needs: a file that stops
// mid-block decodes to however many nibbles are there, the same way a short
// tile draws black from where it stopped and a short WAV plays a short word.
// Fewer than five bytes is not a block at all - four of header and nothing to
// say - and comes back as nothing.
//
// The step index out of the header is brought inside the table rather than
// trusted. A block whose header says 200 is a corrupt file, and the choice is
// between a clamp and an array read past the end of ADPCM_STEP; on a device
// with no memory protection the second one is not a failure, it is whatever
// happened to be in flash.
static inline uint32_t adpcmDecodeBlock(const uint8_t *in, uint32_t bytes,
                                        int16_t *out) {
  if (bytes < 5) return 0;
  if (bytes > ADPCM_BLOCK_BYTES) bytes = ADPCM_BLOCK_BYTES;

  AdpcmState s;
  s.predictor = (int16_t)((uint16_t)in[0] | ((uint16_t)in[1] << 8));
  s.index = in[2];
  if (s.index < 0) s.index = 0;
  if (s.index > 88) s.index = 88;
  // in[3] is reserved. Written as zero and not read - the same "meaningless
  // rather than absent" the reserved byte after each has-audio flag in
  // layout_format.h has.

  uint32_t at = 0;
  out[at++] = (int16_t)s.predictor;
  const uint32_t nibbles = (bytes - 4u) * 2u;
  for (uint32_t i = 0; i < nibbles; i++) {
    const uint8_t byte = in[4u + (i >> 1)];
    // Low nibble first, which is the order every other reader of this format
    // unpacks in and the one audio_encode.ts packs in.
    out[at++] = adpcmSample((i & 1u) ? (uint8_t)(byte >> 4) : (uint8_t)(byte & 0x0f), s);
  }
  return at;
}
