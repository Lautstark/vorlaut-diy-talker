// The firmware's half of device/fixtures/, compiled on the computer.
//
// Every reader below is the one the device runs: parseLayout out of
// layout_format.h, seekToWavData out of wav_format.h, tileReadRow out of
// tile_format.h, hashPath out of name_format.h, cableParse and cableNameOk
// out of cable_format.h, and setLanguage out of texts.h. Not one of them is
// restated here - a harness that reimplemented the rule would be a third
// implementation agreeing with itself, which is the whole failure
// docs/frozen-references.md is about.
//
// This prints what it read; tests/test_device_host.py compares that with the
// expectation beside each fixture. Same shape as layout_dump.cpp, and for the
// same reason: the comparing wants a language with JSON in it, and the reading
// wants the language the device is written in.
//
// Modes, one per kind of thing in the index:
//
//   layout <file>   parse it and print every field, or the refusal
//   tile <file>     read it row by row the way drawTile() does
//   audio <file>    walk to the data chunk the way playWav() does
//   names           cableNameOk() and hashPath(), one name per line on stdin
//   language        the table's size, its default, and what an index past it
//                   falls back to
//   sleep           the timeout range, and what layoutIdleSeconds() makes of a
//                   field outside it - one number per line on stdin
//   cable           a whole transcript on stdin, replayed into a device made
//                   of a std::map, a window of file content at a time

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <map>
#include <vector>

#include "../firmware/vorlaut/layout_format.h"
#include "../firmware/vorlaut/tile_format.h"
#include "../firmware/vorlaut/wav_format.h"
#include "../firmware/vorlaut/name_format.h"
#include "../firmware/vorlaut/cable_format.h"
#include "../firmware/vorlaut/texts.h"

// --- Reading a file ----------------------------------------------------------

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

/** What seekToWavData() and tileReadRow() are handed on the device: something
 *  with read, available, seek and position. A LittleFS File there, a buffer
 *  here, and the walker itself is the same code either way. */
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

static void hex(const uint8_t *p, int n) {
  for (int i = 0; i < n; i++) printf("%02x", p[i]);
}

// --- layout.bin --------------------------------------------------------------

static const char *layoutResultName(LayoutResult r) {
  switch (r) {
    case LAYOUT_OK: return "ok";
    case LAYOUT_TOO_SHORT: return "LAYOUT_TOO_SHORT";
    case LAYOUT_BAD_MAGIC: return "LAYOUT_BAD_MAGIC";
    case LAYOUT_BAD_VERSION: return "LAYOUT_BAD_VERSION";
    case LAYOUT_BAD_SLOT_COUNT: return "LAYOUT_BAD_SLOT_COUNT";
    case LAYOUT_BAD_LENGTH: return "LAYOUT_BAD_LENGTH";
  }
  return "unknown";
}

static int layoutMode(const char *path) {
  const std::string file = slurp(path);
  // Not LAYOUT_MAX_BYTES: a fixture may be longer than the device has room
  // for, and cutting it here would turn a refusal into a different refusal.
  Layout layout;
  const LayoutResult r = parseLayout((const uint8_t *)file.data(),
                                     (uint32_t)file.size(), layout);
  printf("result %s\n", layoutResultName(r));
  if (r != LAYOUT_OK) return 0;

  printf("sets %u\n", layout.setCount);
  printf("language %u\n", layout.language);
  printf("sleep %u\n", layout.sleepSeconds);
  // The field as it stands, and then the length of time it means. Two lines
  // because they are two answers: parseLayout hands byte 8 back untouched, and
  // layoutIdleSeconds() is what vorlaut.ino waits on. A fixture that only had
  // the first could not tell a device that sleeps in ten minutes from one that
  // sleeps in 136 years.
  printf("idle_seconds %u\n", layoutIdleSeconds(layout.sleepSeconds));
  for (uint8_t i = 0; i < layout.setCount; i++) {
    const SetEntry &e = layout.sets[i];
    // The name as hex rather than as text: the field may hold a character cut
    // in half, and what a reader hands back is the bytes up to the first zero.
    printf("set %u name ", i);
    hex((const uint8_t *)e.name, (int)strlen(e.name));
    printf(" label ");
    hex(e.label, HASH_BYTES);
    printf("\n");
    for (uint8_t j = 0; j < SLOT_COUNT; j++) {
      printf("slot %u %u image ", i, j);
      hex(e.slots[j].image, HASH_BYTES);
      printf(" audio ");
      hex(e.slots[j].audio, HASH_BYTES);
      printf(" has %d\n", e.slots[j].hasAudio ? 1 : 0);
    }
  }
  return 0;
}

// --- t<hash>.bin -------------------------------------------------------------

static int tileMode(const char *path) {
  const std::string file = slurp(path);
  Bytes reader{ (const uint8_t *)file.data(), (uint32_t)file.size() };

  printf("width %d\n", TILE_W);
  printf("height %d\n", TILE_H);
  printf("row_bytes %d\n", TILE_W * 2);
  printf("conforming_bytes %u\n", (unsigned)TILE_BYTES);

  std::vector<uint8_t> row((size_t)TILE_W * 2);
  uint32_t completeRows = 0, partialAt = TILE_H, partialBytes = 0,
           blankFrom = TILE_H;
  // Every row the device would draw, kept so that a pixel can be asked about
  // afterwards. The device draws each one and forgets it; the only difference
  // here is that nothing is thrown away.
  std::vector<uint8_t> drawn;
  for (uint16_t y = 0; y < TILE_H; y++) {
    const uint32_t got = tileReadRow(reader, row.data());
    drawn.insert(drawn.end(), row.begin(), row.end());
    if (got == (uint32_t)TILE_W * 2) {
      completeRows++;
    } else if (got > 0) {
      partialAt = y;
      partialBytes = got;
    } else if (blankFrom == TILE_H) {
      blankFrom = y;
    }
  }
  printf("complete_rows %u\n", completeRows);
  printf("partial_row %u\n", partialAt);
  printf("bytes_in_partial_row %u\n", partialBytes);
  printf("blank_rows_from %u\n", blankFrom);
  printf("bytes_read %u\n", reader.position());

  // Probe pixels, asked for on stdin as "x y" pairs so that the fixture
  // decides which ones matter rather than this file.
  int x, y;
  while (scanf("%d %d", &x, &y) == 2) {
    const size_t at = ((size_t)y * TILE_W + (size_t)x) * 2;
    printf("pixel %d %d byte %zu value ", x, y, at);
    hex(drawn.data() + at, 2);
    printf("\n");
  }
  return 0;
}

// --- a<hash>.wav -------------------------------------------------------------

static int audioMode(const char *path) {
  const std::string file = slurp(path);
  Bytes reader{ (const uint8_t *)file.data(), (uint32_t)file.size() };
  uint32_t dataBytes = 0;
  const bool ok = seekToWavData(reader, dataBytes);
  printf("accepts %d\n", ok ? 1 : 0);
  printf("sample_rate %u\n", (unsigned)WAV_SAMPLE_RATE);
  printf("channels %u\n", (unsigned)WAV_CHANNELS);
  printf("bits_per_sample %u\n", (unsigned)WAV_BITS_PER_SAMPLE);
  if (!ok) return 0;
  printf("data_offset %u\n", reader.position());
  printf("data_bytes %u\n", dataBytes);
  printf("data_bytes_available %u\n", reader.available());
  return 0;
}

// --- The name rule -----------------------------------------------------------

// One line in, one line out: whether the device would store the name, and -
// where the line is 32 hex digits and a kind - the path hashPath() builds.
//
// Both halves on purpose. cableNameOk() decides what arrives and hashPath()
// decides what is looked for, they are written in two files, and a name that
// passes the first and is spelled differently by the second is a file on the
// device that nothing ever opens.
static int namesMode(void) {
  char line[4096];
  while (fgets(line, sizeof(line), stdin)) {
    size_t length = strlen(line);
    while (length && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
      line[--length] = '\0';
    }
    if (strncmp(line, "path ", 5) == 0) {
      // "path t 0123..." - the kind, then HASH_BYTES * 2 hex digits.
      const char kind = line[5];
      uint8_t bytes[HASH_BYTES];
      for (int i = 0; i < HASH_BYTES; i++) {
        unsigned value = 0;
        sscanf(line + 7 + i * 2, "%2x", &value);
        bytes[i] = (uint8_t)value;
      }
      char out[2 + HASH_BYTES * 2 + 8];
      hashPath(out, kind, bytes, kind == 't' ? ".bin" : ".wav");
      printf("path %s\n", out);
      continue;
    }
    // "name <the name>", so that an empty name can be asked about at all.
    const char *name = strncmp(line, "name ", 5) == 0 ? line + 5 : line;
    printf("stored %s\n", cableNameOk(name) ? "ok" : "no");
  }
  return 0;
}

// --- The sleep timeout -------------------------------------------------------

// The range the device honours, and what it does with a field outside it. One
// number per line on stdin, one answer per line out, so the fixture decides
// which values matter rather than this file - the same arrangement the name
// rule has.
//
// Asked of layoutIdleSeconds() rather than restated, because the whole point
// of L1 is that the clamp is a function both halves can be held to instead of
// a `? :` in the one file no test can include.
static int sleepMode(void) {
  printf("min %u\n", (unsigned)LAYOUT_SLEEP_MIN);
  printf("max %u\n", (unsigned)LAYOUT_SLEEP_MAX);
  printf("default %u\n", (unsigned)LAYOUT_SLEEP_DEFAULT);
  char line[64];
  while (fgets(line, sizeof(line), stdin)) {
    const unsigned long asked = strtoul(line, nullptr, 10);
    printf("idle %lu %u\n", asked, layoutIdleSeconds((uint32_t)asked));
  }
  return 0;
}

// --- The language enumeration ------------------------------------------------

static int languageMode(void) {
  printf("count %u\n", (unsigned)LANGUAGE_COUNT);
  printf("default %u\n", (unsigned)LANGUAGE_DEFAULT);
  // What an index past the end of the table falls back to. Asked of
  // setLanguage() rather than restated, because that is the function a
  // layout.bin from a newer builder reaches.
  for (unsigned i = 0; i < 260; i++) {
    setLanguage((uint8_t)(i & 0xff));
    if (i < LANGUAGE_COUNT) {
      printf("index %u renders %u\n", i, (unsigned)languageIndex);
    } else if (i == LANGUAGE_COUNT || i == 7 || i == 255) {
      printf("past %u renders %u\n", i, (unsigned)languageIndex);
    }
  }
  return 0;
}

// --- The cable ---------------------------------------------------------------
//
// A device made of a std::map, answering with the real formatters out of
// cable_format.h. The same Fake tests/cable_dump.cpp has, with one thing
// added that the transcripts need: it can be told what the device was already
// holding before the browser arrived.

struct Fake {
  std::map<std::string, std::string> files;
  bool greeted = false;
  uint32_t stored = 0, removed = 0, bytes = 0;
  size_t capacity = 1441792;
};

static void say(const char *text) { fputs(text, stdout); }

static bool readLine(std::string &out) {
  out.clear();
  int c;
  while ((c = fgetc(stdin)) != EOF) {
    if (c == '\n') return true;
    out.push_back((char)c);
  }
  return !out.empty();
}

// The window comes from the fixture rather than from CABLE_WINDOW, and that
// is deliberate. A transcript pins one conversation, and the number in its
// "go" is part of that conversation; taking it from the header instead would
// mean the fixture silently followed the firmware wherever it went, and could
// never hold a browser to reading a window it was given rather than one it
// assumed. So a fixture may announce 256 where the firmware announces 4096,
// and both are conformant.
//
// The firmware word arrives the same way and for a sharper version of the same
// reason. VORLAUT_VERSION is not a constant of the interface at all - it is
// whatever the build was named, "dev" unless release.yml named it - so a
// harness that said its own would be able to produce exactly one transcript,
// and the two that matter are a device that names a build and a device from
// before the keyword existed. An empty word is the second of those, and it is
// said by saying nothing.
static int cableMode(uint32_t capacity, uint32_t window, const char *firmware) {
  Fake device;
  device.capacity = capacity;
  char out[CABLE_LINE_MAX];
  std::string line;

  // The preload, and then the wire. Lines up to "wire" say what the device
  // was already holding: "preload <name> <size>" and then exactly that many
  // raw bytes, counted rather than searched for, the same way the wire is.
  while (readLine(line)) {
    if (line == "wire") break;
    char name[CABLE_NAME_MAX + 1];
    unsigned long size = 0;
    if (sscanf(line.c_str(), "preload %63s %lu", name, &size) != 2) {
      fprintf(stderr, "cannot read the preload: %s\n", line.c_str());
      return 2;
    }
    std::string payload;
    payload.resize(size);
    if (size && fread(&payload[0], 1, size, stdin) != size) {
      fprintf(stderr, "the preload of %s stopped short\n", name);
      return 2;
    }
    device.files[name] = payload;
  }

  while (readLine(line)) {
    CableCommand command;
    const CableVerb verb = cableParse(line.c_str(), &command);
    if (verb == CABLE_NONE) continue;          // log noise, or the host's echo

    if (verb != CABLE_HELLO && !device.greeted) {
      cableSayErr(out, sizeof(out), "session", nullptr);
      say(out);
      continue;
    }
    if (!command.complete) {
      cableSayErr(out, sizeof(out), verb == CABLE_UNKNOWN ? "verb" : "bad",
                  nullptr);
      say(out);
      continue;
    }

    switch (verb) {
      case CABLE_HELLO: {
        device.greeted = true;
        size_t used = 0;
        for (const auto &f : device.files) used += f.second.size();
        cableSayNumber(out, sizeof(out), "vorlaut", CABLE_VERSION); say(out);
        if (firmware && *firmware) {
          cableSayWord(out, sizeof(out), "firmware", firmware); say(out);
        }
        cableSayNumber(out, sizeof(out), "total", (uint32_t)device.capacity); say(out);
        cableSayNumber(out, sizeof(out), "free", (uint32_t)(device.capacity - used)); say(out);
        cableSayNumber(out, sizeof(out), "files", (uint32_t)device.files.size()); say(out);
        cableSayWord(out, sizeof(out), "end", "hello"); say(out);
        break;
      }
      case CABLE_LIST: {
        for (const auto &f : device.files) {
          cableSayNameNumber(out, sizeof(out), "file", f.first.c_str(),
                             (uint32_t)f.second.size());
          say(out);
        }
        cableSayNameNumber(out, sizeof(out), "end", "list",
                           (uint32_t)device.files.size());
        say(out);
        break;
      }
      case CABLE_CRC: {
        auto it = device.files.find(command.name);
        if (it == device.files.end()) {
          cableSayErr(out, sizeof(out), "missing", command.name);
        } else {
          cableSayNameHex(out, sizeof(out), "crc", command.name,
                          cableCrc32(CABLE_CRC_INIT,
                                     (const uint8_t *)it->second.data(),
                                     it->second.size()));
        }
        say(out);
        break;
      }
      case CABLE_RM: {
        auto it = device.files.find(command.name);
        if (it == device.files.end()) {
          cableSayErr(out, sizeof(out), "missing", command.name);
        } else {
          device.files.erase(it);
          device.removed++;
          cableSayWord(out, sizeof(out), "gone", command.name);
        }
        say(out);
        break;
      }
      case CABLE_PUT: {
        size_t used = 0;
        for (const auto &f : device.files) used += f.second.size();
        auto had = device.files.find(command.name);
        if (had != device.files.end()) used -= had->second.size();
        if (used + command.size > device.capacity) {
          // Refused before "go", so the browser never starts sending.
          cableSayErr(out, sizeof(out), "nospace", command.name);
          say(out);
          break;
        }
        cableSayNumber(out, sizeof(out), "go", window);
        say(out);

        // A window at a time, acknowledged after each. Nothing here waits on
        // an ack - this replays a transcript rather than talking to anybody -
        // but the acks have to fall in the right places, because the fixture
        // says where they are and the browser end of the same fixture waits
        // for them one by one.
        std::string payload;
        payload.resize(command.size);
        uint32_t got = 0;
        while (got < command.size) {
          size_t want = command.size - got;
          if (want > (size_t)window) want = (size_t)window;
          const size_t took = fread(&payload[got], 1, want, stdin);
          got += (uint32_t)took;
          if (took != want) break;
          cableSayNumber(out, sizeof(out), "ack", got);
          say(out);
        }
        if (got != command.size) {
          device.greeted = false;
          cableSayErr(out, sizeof(out), "short", command.name);
          say(out);
          break;
        }
        const uint32_t value = cableCrc32(
            CABLE_CRC_INIT, (const uint8_t *)payload.data(), payload.size());
        if (value != command.crc) {
          // .part is thrown away and nothing appears under the real name.
          cableSayErr(out, sizeof(out), "crc", command.name);
          say(out);
          break;
        }
        device.files[command.name] = payload;
        device.stored++;
        device.bytes += command.size;
        cableSayNameNumber(out, sizeof(out), "ok", command.name, command.size);
        say(out);
        break;
      }
      case CABLE_DONE: {
        cableSayBye(out, sizeof(out), device.stored, device.removed,
                    device.bytes);
        say(out);
        device.stored = device.removed = device.bytes = 0;
        break;
      }
      default:
        break;
    }
  }

  for (const auto &f : device.files) {
    printf("# holds %s %zu %08lx\n", f.first.c_str(), f.second.size(),
           (unsigned long)cableCrc32(CABLE_CRC_INIT,
                                     (const uint8_t *)f.second.data(),
                                     f.second.size()));
  }
  printf("# tally %u %u %u\n", device.stored, device.removed, device.bytes);
  return 0;
}

// -----------------------------------------------------------------------------

int main(int argc, char **argv) {
  if (argc >= 3 && strcmp(argv[1], "layout") == 0) return layoutMode(argv[2]);
  if (argc >= 3 && strcmp(argv[1], "tile") == 0) return tileMode(argv[2]);
  if (argc >= 3 && strcmp(argv[1], "audio") == 0) return audioMode(argv[2]);
  if (argc >= 2 && strcmp(argv[1], "names") == 0) return namesMode();
  if (argc >= 2 && strcmp(argv[1], "language") == 0) return languageMode();
  if (argc >= 2 && strcmp(argv[1], "sleep") == 0) return sleepMode();
  if (argc >= 4 && strcmp(argv[1], "cable") == 0) {
    // The firmware word is optional at the command line and required of the
    // runner: a fixture always states it, and states it empty where the device
    // says nothing. Defaulted here so that driving this by hand is one
    // argument shorter than driving it from the transcripts.
    return cableMode((uint32_t)strtoul(argv[2], nullptr, 10),
                     (uint32_t)strtoul(argv[3], nullptr, 10),
                     argc >= 5 ? argv[4] : "");
  }
  fprintf(stderr, "usage: device_host layout <file> | tile <file> | "
                  "audio <file> | names | language | sleep | "
                  "cable <capacity> <window> [firmware]\n");
  return 2;
}
