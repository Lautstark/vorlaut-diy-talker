// Taking content over the USB-C cable instead of over Wi-Fi.
//
// The editor is becoming a page with no server behind it, and that makes the
// old way impossible rather than merely awkward: a browser tab cannot be an
// HTTP server for the device to fetch from, and a page served over HTTPS is
// not allowed to talk to a plain-HTTP device on the local network at all. The
// cable is what is left, and it was always there - it is how the battery gets
// charged, which is why the socket reaches the edge of the case.
//
// The protocol and the reasoning are in docs/cable.md; the wire format, with
// no Arduino in it so that it can be compiled and checked on a computer, is
// in cable_format.h. What is here is the part that needs a device: Serial,
// LittleFS, and the half-written file.
//
// This does NOT replace sync.h. Both are compiled in and both work, until the
// cable has been shown to do the job on real hardware.
//
// Three things are worth knowing before reading on:
//
//   * The device is deliberately stupid. It lists, checksums, stores, deletes
//     and says goodbye. It does not work out what is missing - the browser
//     does that, because the browser is the end with the memory and the
//     language for it. Over Wi-Fi it was the other way round only because the
//     server could not push.
//
//   * There is no pairing and no key. Over the network, five digits on the
//     displays proved somebody was standing in front of the device. Whoever
//     has hold of the cable is standing in front of the device already, so
//     the proof is the plug.
//
//   * Nothing here may hang. A device parked in a transfer no longer speaks,
//     and speaking is the one thing it is for - the same rule the setup
//     portal's timeout follows.

#pragma once
#include <Arduino.h>
#include <LittleFS.h>
#include "cable_format.h"

// Read from the file system in pieces of this size. Small enough that a
// buffer this size on the stack is not a problem, large enough that a WAV is
// not a thousand round trips through LittleFS.
#define CABLE_CHUNK 512

// What the session did, so the caller can say so on the displays and decide
// whether the content has to be read in again.
struct CableResult {
  bool ran;              // a browser really did say hello
  bool ok;               // it got as far as "done"
  uint16_t stored;
  uint16_t removed;
  uint32_t bytes;
  const char *error;     // nullptr unless it ended badly
};

// Called as the session goes along, so the caller can draw something. All five
// displays showing nothing for half a minute looks exactly like a device that
// has died. what is "hello", "put", "rm" or "done".
typedef void (*CableProgress)(const char *what, uint16_t done, uint32_t bytes);

// Where a line is up to. Kept per session rather than in a static, so that
// half a line left over from a browser that vanished cannot be glued onto the
// front of the next browser's hello.
struct CableLine {
  size_t at;
  char buffer[CABLE_LINE_MAX];
};

// Returning true ends the session. The caller uses this for the set key, the
// same way the pairing is interruptible.
typedef bool (*CableAbort)();

class Cable {
 public:
  // Is a browser talking to us? Cheap enough to ask on every pass of loop().
  //
  // This only says that something arrived, not that it is ours - the serial
  // monitor shares this wire and so does anything else that opens the port.
  // Deciding is serve()'s job, and it costs nothing when the answer is no.
  static bool waiting() { return Serial.available() > 0; }

  // Reads and answers until the browser says done, or until it stops talking.
  //
  // The device starts every call refusing everything except hello. That is
  // the same state it falls back into when a transfer is given up on, so
  // there is one rule rather than two: whatever went wrong, the way back in
  // is to introduce yourself again.
  static CableResult serve(CableProgress progress = nullptr,
                           CableAbort abort = nullptr) {
    CableResult result = {false, false, 0, 0, 0, nullptr};
    bool open = false;                     // a hello has been answered
    const uint32_t began = millis();
    uint32_t lastLine = millis();
    CableLine line = {0, {0}};

    for (;;) {
      if (millis() - began > CABLE_SESSION_MS) {
        result.error = "the session ran too long";
        break;
      }
      // Silence. Before a hello this is over in a quarter of a second,
      // because whatever is on the wire is then most likely not a browser at
      // all and the keys are waiting. Afterwards it is the full wait, because
      // a browser between two files is entitled to think for a moment.
      if (millis() - lastLine > (result.ran ? CABLE_QUIET_MS : CABLE_GREET_MS)) {
        if (!result.ran) return result;    // nobody ever said hello
        result.error = "the browser stopped talking";
        break;
      }
      if (abort && abort()) {
        result.error = "stopped at the device";
        break;
      }

      char text[CABLE_LINE_MAX];
      if (!readLine(line, text, sizeof(text))) { delay(1); continue; }
      lastLine = millis();

      CableCommand command;
      const CableVerb verb = cableParse(text, &command);
      // Not marked as ours: the serial monitor, an echo, a stray keystroke.
      // Answering it would put noise into the stream the browser is reading.
      if (verb == CABLE_NONE) continue;

      if (verb != CABLE_HELLO && !open) { say("err", "session"); continue; }
      if (!command.complete) {
        say("err", verb == CABLE_UNKNOWN ? "verb" : "bad");
        continue;
      }

      switch (verb) {
        case CABLE_HELLO:
          open = true;
          result.ran = true;
          sayHello();
          if (progress) progress("hello", 0, 0);
          break;

        case CABLE_LIST:
          sayList();
          break;

        case CABLE_CRC:
          sayCrc(command.name);
          break;

        case CABLE_RM:
          if (!LittleFS.exists(path(command.name))) {
            say("err", "missing", command.name);
          } else if (!LittleFS.remove(path(command.name))) {
            say("err", "write", command.name);
          } else {
            result.removed++;
            sayWord("gone", command.name);
            if (progress) progress("rm", result.removed, result.bytes);
          }
          break;

        case CABLE_PUT: {
          const char *why = receive(command, abort);
          if (why) {
            say("err", why, command.name);
            // Everything after a lost transfer is refused until hello: the
            // rest of the file is still coming down the wire, and reading it
            // as commands is the one way this protocol could quietly store
            // the wrong thing.
            if (strcmp(why, "short") == 0 || strcmp(why, "lost") == 0) {
              drain();
              line.at = 0;      // whatever was half-read is not a command
              open = false;
            }
          } else {
            result.stored++;
            result.bytes += command.size;
            // Before the "ok", and skippable: a browser that does not know
            // these keywords steps over them, which is the rule this protocol
            // states everywhere else and is worth actually exercising.
            sayNumber("gap", gap_);
            sayNumber("stall", stall_);
            sayNameNumber("ok", command.name, command.size);
            if (progress) progress("put", result.stored, result.bytes);
          }
          break;
        }

        case CABLE_DONE:
          sayBye(result.stored, result.removed, result.bytes);
          if (progress) progress("done", result.stored, result.bytes);
          result.ok = true;
          return result;

        default:
          break;
      }
    }
    return result;
  }

 private:
  // Everything the device holds lies flat in the root - cableNameOk() is what
  // keeps it that way, so this is only ever a slash and a name.
  static String path(const char *name) { return String("/") + name; }

  // --- Talking ---------------------------------------------------------------
  //
  // Every line goes out through the formatters in cable_format.h, so that the
  // wire text sits in the file tests/test_cable_format.py compiles rather
  // than being spelled out again here.
  //
  // The device's own Serial.printf() log carries on during all of this and is
  // not gagged. It arrives unmarked, the browser puts it in its log pane, and
  // that is the most useful thing on the wire when something goes wrong.

  static void put(int length, const char *text) {
    if (length > 0) Serial.write((const uint8_t *)text, (size_t)length);
  }

  // "< go" - the only line with nothing after the keyword.
  static void sayBare(const char *key) {
    char out[CABLE_LINE_MAX];
    put(cableSayBare(out, sizeof(out), key), out);
  }

  static void say(const char *word, const char *detail,
                  const char *extra = nullptr) {
    char out[CABLE_LINE_MAX];
    if (strcmp(word, "err") == 0) {
      put(cableSayErr(out, sizeof(out), detail, extra), out);
    } else {
      put(cableSayWord(out, sizeof(out), word, detail), out);
    }
  }

  static void sayWord(const char *key, const char *word) {
    char out[CABLE_LINE_MAX];
    put(cableSayWord(out, sizeof(out), key, word), out);
  }

  static void sayNumber(const char *key, uint32_t number) {
    char out[CABLE_LINE_MAX];
    put(cableSayNumber(out, sizeof(out), key, number), out);
  }

  static void sayNameNumber(const char *key, const char *name, uint32_t n) {
    char out[CABLE_LINE_MAX];
    put(cableSayNameNumber(out, sizeof(out), key, name, n), out);
  }

  static void sayBye(uint16_t stored, uint16_t removed, uint32_t bytes) {
    char out[CABLE_LINE_MAX];
    put(cableSayBye(out, sizeof(out), stored, removed, bytes), out);
  }

  // How the browser tells a vorlaut from whatever else the person picked in
  // the port dialog - and how it finds out whether what it wants to send will
  // fit before it starts sending it.
  static void sayHello() {
    char out[CABLE_LINE_MAX];
    put(cableSayNumber(out, sizeof(out), "vorlaut", CABLE_VERSION), out);
    put(cableSayNumber(out, sizeof(out), "total",
                       (uint32_t)LittleFS.totalBytes()), out);
    put(cableSayNumber(out, sizeof(out), "free",
                       (uint32_t)(LittleFS.totalBytes() - LittleFS.usedBytes())),
        out);
    put(cableSayNumber(out, sizeof(out), "files", count()), out);
    put(cableSayWord(out, sizeof(out), "end", "hello"), out);
  }

  // Straight out of the directory as it is walked. Nothing is collected
  // first: the list is the one thing the device has that the browser has not,
  // and holding all of it in a String to hand over in one piece is exactly
  // the sort of heap the line format exists to avoid.
  static void sayList() {
    char out[CABLE_LINE_MAX];
    uint32_t found = 0;
    File dir = LittleFS.open("/");
    if (dir) {
      for (File entry = dir.openNextFile(); entry; entry = dir.openNextFile()) {
        if (entry.isDirectory()) continue;
        const char *name = bare(entry.name());
        if (!cableNameOk(name)) continue;   // the half-written file
        put(cableSayNameNumber(out, sizeof(out), "file", name,
                               (uint32_t)entry.size()), out);
        found++;
      }
      dir.close();
    }
    put(cableSayNameNumber(out, sizeof(out), "end", "list", found), out);
  }

  // For layout.bin, whose name stays the same when its content changes. Every
  // other name is a hash of what produced the file and answers the question
  // by existing at all - see the note in cable_format.h on why a name is not
  // a checksum.
  static void sayCrc(const char *name) {
    char out[CABLE_LINE_MAX];
    File file = LittleFS.open(path(name), "r");
    if (!file) { say("err", "missing", name); return; }
    uint32_t value = CABLE_CRC_INIT;
    uint8_t buffer[CABLE_CHUNK];
    for (;;) {
      const int got = file.read(buffer, sizeof(buffer));
      if (got <= 0) break;
      value = cableCrc32(value, buffer, (size_t)got);
    }
    file.close();
    put(cableSayNameHex(out, sizeof(out), "crc", name, value), out);
  }

  static uint32_t count() {
    uint32_t found = 0;
    File dir = LittleFS.open("/");
    if (!dir) return 0;
    for (File entry = dir.openNextFile(); entry; entry = dir.openNextFile()) {
      if (!entry.isDirectory() && cableNameOk(bare(entry.name()))) found++;
    }
    dir.close();
    return found;
  }

  // LittleFS is not consistent about the leading slash between versions.
  static const char *bare(const char *name) {
    return name && name[0] == '/' ? name + 1 : name;
  }

  // --- Listening -------------------------------------------------------------

  // One line without its newline, or false if there is not a whole one yet.
  // Never waits: the caller is in a loop that also watches the clock and the
  // keys, and blocking here would take both away from it.
  //
  // A line longer than the buffer is cut off. What is left of it arrives as a
  // line of its own, which will not carry the sigil and is therefore ignored,
  // and the cut-off half is refused by the parser rather than acted on.
  static bool readLine(CableLine &line, char *out, size_t cap) {
    while (Serial.available() > 0) {
      const int c = Serial.read();
      if (c < 0) break;
      if (c == '\n') {
        const size_t length = line.at < cap - 1 ? line.at : cap - 1;
        memcpy(out, line.buffer, length);
        out[length] = '\0';
        line.at = 0;
        return true;
      }
      if (line.at + 1 < sizeof(line.buffer)) line.buffer[line.at++] = (char)c;
    }
    return false;
  }

  // The two numbers a green run would otherwise not tell anybody. See the note
  // on measuring rather than guessing in docs/cable.md.
  //
  // gap_  is the longest stretch this transfer spent with nothing arriving. It
  //       is what CABLE_QUIET_MS is measured against, so it is the margin.
  // stall_ is the longest single write into LittleFS. That is where a garbage
  //       collection pause shows up, and it does NOT appear in gap_ - the
  //       device is inside file.write() at the time, not waiting for bytes.
  //
  // Two numbers rather than one because they are two different risks, and one
  // of them would hide the other.
  static uint32_t gap_;
  static uint32_t stall_;

  // One file. Returns nullptr when it is stored, or the word to send back.
  //
  // "go" goes out only once the half-written file is open, and the browser
  // sends nothing before it. Without that handshake a refusal would be
  // followed by a file's worth of content arriving in readLine(), where some
  // of it would eventually look like a command.
  static const char *receive(const CableCommand &command, CableAbort abort) {
    LittleFS.remove(CABLE_PART_FILE);

    // Refused before "go", so nothing is sent and nothing has to be drained.
    // The half-written file is what needs the room: the name it will take
    // over is not removed until the rename, so for the length of the transfer
    // both are on the partition at once.
    const size_t free = LittleFS.totalBytes() - LittleFS.usedBytes();
    if (command.size > free) return "nospace";

    // Both of these are refused before "go", so nothing is sent and there is
    // nothing to drain afterwards.
    File file = LittleFS.open(CABLE_PART_FILE, "w");
    if (!file) return "write";
    sayBare("go");

    uint32_t got = 0;
    uint32_t value = CABLE_CRC_INIT;
    uint8_t buffer[CABLE_CHUNK];
    uint32_t lastByte = millis();
    gap_ = 0;
    stall_ = 0;

    while (got < command.size) {
      const int there = Serial.available();
      if (there <= 0) {
        const uint32_t waited = millis() - lastByte;
        if (waited > gap_) gap_ = waited;
        if (waited > CABLE_QUIET_MS) {
          file.close();
          LittleFS.remove(CABLE_PART_FILE);
          return "short";
        }
        if (abort && abort()) {
          file.close();
          LittleFS.remove(CABLE_PART_FILE);
          return "short";
        }
        delay(1);
        continue;
      }
      uint32_t want = command.size - got;
      if (want > sizeof(buffer)) want = sizeof(buffer);
      if ((uint32_t)there < want) want = (uint32_t)there;
      const size_t take = Serial.readBytes(buffer, want);
      if (take == 0) continue;

      const uint32_t before = millis();
      const size_t wrote = file.write(buffer, take);
      const uint32_t took = millis() - before;
      if (took > stall_) stall_ = took;
      if (wrote != take) {
        // The file system stopped taking bytes partway through - a full
        // partition, most likely. A different word from "write" on purpose:
        // this one happened after "go", so the browser is still sending and
        // the caller has to drain before it can trust the wire again.
        file.close();
        LittleFS.remove(CABLE_PART_FILE);
        return "lost";
      }
      value = cableCrc32(value, buffer, take);
      got += (uint32_t)take;
      lastByte = millis();
    }
    file.close();

    // The name is a hash of what went into the file, not of what came out of
    // it, so it cannot stand in for this. A truncated transfer, a byte count
    // one out, a file system that quietly stopped writing: all silent
    // without the checksum, all caught by it.
    if (value != command.crc) {
      LittleFS.remove(CABLE_PART_FILE);
      return "crc";
    }

    // Only now under its real name. A transfer that breaks off leaves .part
    // behind and not half a file under a name that promises whole content -
    // the same rule sync.h follows, and for the same reason.
    const String target = path(command.name);
    LittleFS.remove(target);
    if (!LittleFS.rename(CABLE_PART_FILE, target)) {
      LittleFS.remove(CABLE_PART_FILE);
      return "write";     // nothing left in flight: the file arrived whole
    }
    return nullptr;
  }

  // Throw away whatever is still arriving, until the wire has been quiet for
  // a moment. This is what makes it safe to go back to reading lines after a
  // transfer was given up on halfway.
  static void drain() {
    uint8_t scratch[CABLE_CHUNK];
    uint32_t last = millis();
    while (millis() - last < CABLE_DRAIN_MS) {
      const int there = Serial.available();
      if (there <= 0) { delay(1); continue; }
      Serial.readBytes(scratch, (size_t)there < sizeof(scratch)
                                    ? (size_t)there : sizeof(scratch));
      last = millis();
    }
  }

};

// One sketch, one copy. Defined out of line rather than as inline members so
// that this header stays buildable on the older C++ an Arduino core may pick.
uint32_t Cable::gap_ = 0;
uint32_t Cable::stall_ = 0;
