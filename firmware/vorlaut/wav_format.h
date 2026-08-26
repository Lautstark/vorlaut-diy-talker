// What the device will accept as an a<hash>.wav, and where the samples are.
//
// This was seekToWavData() inside vorlaut.ino, which meant the answer to
// "what is a valid recording" was whatever that function happened to walk
// past, in a file no test could include. It is a template here for one
// reason: the device reads from a LittleFS File and a host test reads from a
// buffer, and the only thing either has to be is something with read(), seek(),
// position() and available(). The body is unchanged - a rewritten reader would
// be a second implementation of the rule rather than the rule itself.
//
// Held against device/fixtures/audio/ from both ends.

#pragma once
#include <stdint.h>
#include <string.h>

// What the build writes and what I2S is started at. A file at another rate is
// not refused below - see the note there - it simply plays at this one.
#define WAV_SAMPLE_RATE 16000u
#define WAV_CHANNELS 1u
#define WAV_BITS_PER_SAMPLE 16u

// Finds the data chunk in the WAV. Returns false if the file does not fit.
//
// Worth knowing what this does NOT look at, because it is the difference
// between what a builder must write and what a device will take: the fmt
// chunk is walked past like any other. Rate, channel count and sample width
// are never read, so a 44.1 kHz stereo file is accepted here and then played
// out at WAV_SAMPLE_RATE mono. device/fixtures/audio/ states both halves.
template <class Reader>
static bool seekToWavData(Reader &file, uint32_t &dataBytes) {
  char header[12];
  if (file.read((uint8_t *)header, 12) != 12) return false;
  if (memcmp(header, "RIFF", 4) != 0 || memcmp(header + 8, "WAVE", 4) != 0) {
    return false;
  }
  while (file.available() >= 8) {
    char id[4];
    uint32_t size = 0;
    if (file.read((uint8_t *)id, 4) != 4) return false;
    if (file.read((uint8_t *)&size, 4) != 4) return false;  // WAV is little-endian
    if (memcmp(id, "data", 4) == 0) {
      dataBytes = size;
      return true;
    }
    file.seek(file.position() + size + (size & 1));  // chunks have an even length
  }
  return false;
}
