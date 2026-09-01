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

// The two WAVE format tags a recording may declare. Fields of the fmt chunk
// rather than of any codec, which is why they are here and not in
// adpcm_format.h: this is the file that says what the device will accept.
//
// A talker flashed before today reads neither of them - it never opened fmt at
// all - and plays whatever is in the data chunk as PCM. That is why the
// compressed form is offered only to a device that named it in its hello, the
// same way a compressed tile is: sent blind, it is a panel of noise in a house
// nobody here knows about, with no update channel.
#define WAV_FORMAT_PCM 0x0001u
#define WAV_FORMAT_IMA_ADPCM 0x0011u

// What the fmt chunk said, for a reader that has to know which form it is
// holding. Two fields and not five, and that is the whole change to this file:
// rate, channel count and sample width are still never read, so
// device/fixtures/audio/stereo-44k stays exactly as true as it was - a 44.1
// kHz stereo file is still accepted and still played at WAV_SAMPLE_RATE mono.
//
// A file with no fmt chunk at all reports WAV_FORMAT_PCM, because that is what
// the device did with one yesterday and a missing chunk is not a reason to
// start playing silence.
struct WavShape {
  uint16_t formatTag;
  uint16_t blockAlign;   // one ADPCM block; meaningless for PCM
};

// Finds the data chunk in the WAV. Returns false if the file does not fit.
//
// Worth knowing what this does NOT look at, because it is the difference
// between what a builder must write and what a device will take: **rate,
// channel count and sample width are never read**, so a 44.1 kHz stereo file
// is accepted here and then played out at WAV_SAMPLE_RATE mono.
// device/fixtures/audio/ states both halves.
//
// `shape` is the one thing that is read out of fmt, and only when a caller
// asks for it: which codec the data chunk is in, and how long one block of it
// is. That is the branch playWav() takes between PCM and IMA ADPCM, and it is
// deliberately not a refusal - a file whose tag this build has never heard of
// is played as PCM, which is what it would have been yesterday.
template <class Reader>
static bool seekToWavData(Reader &file, uint32_t &dataBytes,
                          WavShape *shape = nullptr) {
  if (shape) { shape->formatTag = (uint16_t)WAV_FORMAT_PCM; shape->blockAlign = 0; }
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
    // The fmt chunk is read for two of its fields and walked past for the
    // rest, which is a smaller change than it looks: the seek below still
    // starts from where the chunk began, so a caller that passed no shape
    // reads the identical bytes it always did. Only a caller that asked pays
    // the two reads, and only when fmt comes before data - which it does, in
    // every file this device has ever been sent.
    const uint32_t body = file.position();
    if (shape && memcmp(id, "fmt ", 4) == 0 && size >= 16) {
      uint8_t fmt[16];
      if (file.read(fmt, 16) == 16) {
        shape->formatTag = (uint16_t)((uint16_t)fmt[0] | ((uint16_t)fmt[1] << 8));
        shape->blockAlign = (uint16_t)((uint16_t)fmt[12] | ((uint16_t)fmt[13] << 8));
      }
    }
    file.seek(body + size + (size & 1));  // chunks have an even length
  }
  return false;
}
