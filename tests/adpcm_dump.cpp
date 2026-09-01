// The firmware's own recording reader, on the computer.
//
// One file in, what the device would play out. seekToWavData() out of
// wav_format.h finds the data chunk and says which codec it is in, and
// adpcmDecodeBlock() out of adpcm_format.h turns the blocks back into samples
// - the same two calls playWav() makes, with the LittleFS file replaced by a
// buffer and the I2S write replaced by stdout.
//
// A file of its own rather than a mode of tests/device_host.cpp, and that is
// worth a line: this reads one thing and prints it, the way tests/layout_dump.cpp
// and tests/texts_dump.cpp do, and tests/test_adpcm.py is the only caller.
//
//   adpcm_dump <file>
//
//     accepts <0|1>       whether seekToWavData() found a data chunk
//     format_tag <n>      what fmt declared, or 1 for a file with no fmt
//     block_align <n>     one ADPCM block, or 0
//     data_bytes <n>      what the data chunk says it holds
//     samples <n>         how many the device would play
//     pcm <hex>           those samples, little-endian, as I2S would get them
//
// Build:
//   g++ -std=c++17 -Wall -Wextra -Werror -O1 -o adpcm_dump tests/adpcm_dump.cpp

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>

#include "../firmware/vorlaut/wav_format.h"
#include "../firmware/vorlaut/adpcm_format.h"

// The same shim device_host.cpp uses, and for the same reason: the readers are
// templates over something with read(), seek(), position() and available(),
// so a buffer is a file as far as they are concerned.
struct Bytes {
  const uint8_t *data;
  uint32_t length;
  uint32_t at = 0;

  int read(uint8_t *into, uint32_t want) {
    const uint32_t got = want < length - at ? want : length - at;
    memcpy(into, data + at, got);
    at += got;
    return (int)got;
  }
  uint32_t available() const { return length - at; }
  uint32_t position() const { return at; }
  void seek(uint32_t to) { at = to < length ? to : length; }
};

static std::string slurp(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) { fprintf(stderr, "cannot read: %s\n", path); exit(2); }
  std::string out;
  char buffer[4096];
  size_t got;
  while ((got = fread(buffer, 1, sizeof(buffer), f)) > 0) out.append(buffer, got);
  fclose(f);
  return out;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: adpcm_dump <file>\n");
    return 2;
  }
  const std::string file = slurp(argv[1]);
  Bytes reader{ (const uint8_t *)file.data(), (uint32_t)file.size() };

  uint32_t dataBytes = 0;
  WavShape shape;
  const bool ok = seekToWavData(reader, dataBytes, &shape);
  printf("accepts %d\n", ok ? 1 : 0);
  printf("format_tag %u\n", (unsigned)shape.formatTag);
  printf("block_align %u\n", (unsigned)shape.blockAlign);
  if (!ok) return 0;
  printf("data_bytes %u\n", (unsigned)dataBytes);

  // Against what is really there as well as what is declared, the way playWav()
  // ends up doing it: a read that comes back short stops the word.
  uint32_t remaining = dataBytes < reader.available() ? dataBytes : reader.available();

  std::vector<uint8_t> out;
  if (shape.formatTag == WAV_FORMAT_IMA_ADPCM) {
    // One block at a time, exactly as the device will: the block is read into
    // a buffer of its own and decoded out of it, so nothing between two
    // samples ever goes back to the file system.
    const uint32_t align =
        shape.blockAlign >= 5 && shape.blockAlign <= ADPCM_BLOCK_BYTES
            ? shape.blockAlign : ADPCM_BLOCK_BYTES;
    uint8_t block[ADPCM_BLOCK_BYTES];
    int16_t samples[ADPCM_BLOCK_SAMPLES];
    while (remaining > 0) {
      const uint32_t want = remaining < align ? remaining : align;
      const uint32_t got = (uint32_t)reader.read(block, want);
      if (got == 0) break;
      const uint32_t made = adpcmDecodeBlock(block, got, samples);
      for (uint32_t i = 0; i < made; i++) {
        out.push_back((uint8_t)((uint16_t)samples[i] & 0xff));
        out.push_back((uint8_t)(((uint16_t)samples[i] >> 8) & 0xff));
      }
      remaining -= got;
    }
  } else {
    out.resize(remaining);
    if (remaining) out.resize((size_t)reader.read(out.data(), remaining));
  }

  printf("samples %u\n", (unsigned)(out.size() / 2));
  printf("pcm ");
  for (size_t i = 0; i < out.size(); i++) printf("%02x", out[i]);
  printf("\n");
  return 0;
}
