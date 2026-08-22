// Runs the cable wire format from the sketch on this machine and prints what
// it makes of its input. The Python script next door compares that with what
// tools/cable.js really sends and with what the device is supposed to answer.
//
// Four modes, because there are four things worth checking separately:
//
//   limits          the constants, so both sides agree on the shape
//   parse           reads command lines on stdin, one report per line
//   crc             checksums stdin, so it can be held against zlib.crc32
//   session         plays a whole command stream through, raw bytes and all,
//                   and prints a transcript of what the device would do
//
// The session mode is the one that matters most. It is fed the exact bytes
// the browser client produced, so it answers the question no unit test can:
// whether the two halves agree when one of them is driving.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <string>
#include <map>
#include "../firmware/vorlaut/cable_format.h"

static const char *verbName(CableVerb verb) {
  switch (verb) {
    case CABLE_HELLO:   return "hello";
    case CABLE_LIST:    return "list";
    case CABLE_CRC:     return "crc";
    case CABLE_PUT:     return "put";
    case CABLE_RM:      return "rm";
    case CABLE_DONE:    return "done";
    case CABLE_UNKNOWN: return "unknown";
    default:            return "none";
  }
}

static int limits(void) {
  printf("version %d\n", CABLE_VERSION);
  printf("line_max %d\n", CABLE_LINE_MAX);
  printf("name_max %d\n", CABLE_NAME_MAX);
  printf("host_sigil %c\n", CABLE_HOST_SIGIL);
  printf("device_sigil %c\n", CABLE_DEVICE_SIGIL);
  printf("part %s\n", CABLE_PART_FILE);
  printf("version_file %s\n", CABLE_VERSION_FILE);
  printf("quiet_ms %d\n", CABLE_QUIET_MS);
  printf("drain_ms %d\n", CABLE_DRAIN_MS);
  return 0;
}

// One report per input line. Blank output fields are printed as "-" so that
// the Python side can split on spaces without an empty name swallowing the
// next column.
static int parse(void) {
  char line[4096];
  while (fgets(line, sizeof(line), stdin)) {
    CableCommand command;
    const CableVerb verb = cableParse(line, &command);
    printf("%s %d %s %lu %08lx\n", verbName(verb), command.complete ? 1 : 0,
           command.name[0] ? command.name : "-",
           (unsigned long)command.size, (unsigned long)command.crc);
  }
  return 0;
}

// cableNameOk on its own, one name per line. Worth asking separately from the
// parse mode: through a command the word count refuses some names before the
// validator ever sees them, so a fault in the validator can hide behind the
// parser. cable.h also calls it directly, on every entry of the directory.
static int names(void) {
  char line[4096];
  while (fgets(line, sizeof(line), stdin)) {
    size_t length = strlen(line);
    while (length && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
      line[--length] = '\0';
    }
    printf("%s\n", cableNameOk(line) ? "ok" : "no");
  }
  return 0;
}

static int crc(void) {
  uint32_t value = CABLE_CRC_INIT;
  uint8_t buffer[4096];
  size_t got;
  // Fed in chunks on purpose: the device checksums a file while it arrives
  // and never holds one whole, so the running form is the one it uses.
  while ((got = fread(buffer, 1, sizeof(buffer), stdin)) > 0) {
    value = cableCrc32(value, buffer, got);
  }
  printf("crc %08lx\n", (unsigned long)value);
  return 0;
}

// Every kind of line the device can send, composed by the same formatters
// the firmware uses. The Python side checks the text, and then hands it to
// the browser client so that both ends of every line have been through the
// code that will really produce and consume it.
static void say(const char *text) { fputs(text, stdout); }

static int sayAll(void) {
  char out[CABLE_LINE_MAX];
  cableSayNumber(out, sizeof(out), "vorlaut", CABLE_VERSION); say(out);
  cableSayNumber(out, sizeof(out), "total", 1441792u); say(out);
  cableSayNumber(out, sizeof(out), "free", 1146880u); say(out);
  cableSayNumber(out, sizeof(out), "files", 37u); say(out);
  cableSayWord(out, sizeof(out), "end", "hello"); say(out);
  cableSayNameNumber(out, sizeof(out), "file",
                     "t3bd7a1c045e29f8b6d0a4e17c93f5028.bin", 26912u); say(out);
  cableSayNameNumber(out, sizeof(out), "end", "list", 37u); say(out);
  cableSayNameHex(out, sizeof(out), "crc", "layout.bin", 0x1a2b3c4du); say(out);
  cableSayBare(out, sizeof(out), "go"); say(out);
  cableSayNameNumber(out, sizeof(out), "ok",
                     "a8c1e9b0d4f2a6c3b7e5d1908a4c2f6b.wav", 41008u); say(out);
  cableSayWord(out, sizeof(out), "gone", "layout.bin"); say(out);
  cableSayBye(out, sizeof(out), 12u, 3u, 486400u); say(out);
  cableSayErr(out, sizeof(out), "nospace", NULL); say(out);
  cableSayErr(out, sizeof(out), "crc", "layout.bin"); say(out);
  // A checksum whose top bit is set, because that is where an int that should
  // have been unsigned turns into "ffffffff8..." and eight digits into eleven.
  cableSayNameHex(out, sizeof(out), "crc", "layout.bin", 0xdeadbeefu); say(out);
  // And one with leading zeros, which is the other half of the same question.
  // Every value above happens to have eight significant digits, so all of them
  // survive a format string that lost its zero padding - this one does not.
  cableSayNameHex(out, sizeof(out), "crc", "layout.bin", 0x0000beefu); say(out);
  return 0;
}

// --- The session -------------------------------------------------------------
//
// A device made of a std::map instead of LittleFS. It answers with the real
// formatters out of cable_format.h and follows the same rules the firmware
// does, so that what it prints is what a device would have sent.

struct Fake {
  std::map<std::string, std::string> files;
  bool broken = false;      // a transfer was given up on; only hello clears it
  uint32_t stored = 0, removed = 0, bytes = 0;
  size_t free_ = 1441792;
};

// Reads one line, or returns false at end of input. Raw bytes are read
// separately, so this must not read past the newline.
static bool readLine(std::string &out) {
  out.clear();
  int c;
  while ((c = fgetc(stdin)) != EOF) {
    if (c == '\n') return true;
    out.push_back((char)c);
  }
  return !out.empty();
}

static int session(void) {
  Fake device;
  char out[CABLE_LINE_MAX];
  std::string line;

  while (readLine(line)) {
    CableCommand command;
    const CableVerb verb = cableParse(line.c_str(), &command);
    if (verb == CABLE_NONE) continue;          // log noise, or the host's echo

    if (verb != CABLE_HELLO && device.broken) {
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
        device.broken = false;
        size_t used = 0;
        for (const auto &f : device.files) used += f.second.size();
        cableSayNumber(out, sizeof(out), "vorlaut", CABLE_VERSION); say(out);
        cableSayNumber(out, sizeof(out), "total", (uint32_t)device.free_); say(out);
        cableSayNumber(out, sizeof(out), "free", (uint32_t)(device.free_ - used)); say(out);
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
          const uint32_t value = cableCrc32(
              CABLE_CRC_INIT, (const uint8_t *)it->second.data(),
              it->second.size());
          cableSayNameHex(out, sizeof(out), "crc", command.name, value);
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
        if (used + command.size > device.free_) {
          // Refused before "go", so the browser never starts sending. That is
          // the whole reason "go" exists.
          cableSayErr(out, sizeof(out), "nospace", command.name);
          say(out);
          break;
        }
        cableSayBare(out, sizeof(out), "go");
        say(out);

        std::string payload;
        payload.resize(command.size);
        const size_t got = command.size
            ? fread(&payload[0], 1, command.size, stdin) : 0;
        if (got != command.size) {
          device.broken = true;
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

  // What the device is left holding, so the Python side can compare it with
  // what the browser believed it had sent.
  for (const auto &f : device.files) {
    printf("# holds %s %zu %08lx\n", f.first.c_str(), f.second.size(),
           (unsigned long)cableCrc32(CABLE_CRC_INIT,
                                     (const uint8_t *)f.second.data(),
                                     f.second.size()));
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "limits") == 0) return limits();
  if (argc >= 2 && strcmp(argv[1], "parse") == 0) return parse();
  if (argc >= 2 && strcmp(argv[1], "names") == 0) return names();
  if (argc >= 2 && strcmp(argv[1], "crc") == 0) return crc();
  if (argc >= 2 && strcmp(argv[1], "say") == 0) return sayAll();
  if (argc >= 2 && strcmp(argv[1], "session") == 0) return session();
  fprintf(stderr,
          "usage: cable_dump limits | parse | names | crc | say | session\n");
  return 2;
}
