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
// This replaced sync.h. Both were compiled in and both worked for a day, the
// intention being to keep the radio until the cable had been shown to do the
// job on real hardware. That is not how it went: sync.h, and the rest of the
// Wi-Fi stack with it, was deleted on 2026-08-23 with none of that bar met,
// because the other end of the Wi-Fi path had already gone. This is the only
// way in now - see docs/cable.md, "The Wi-Fi path is gone".
//
// Three things are worth knowing before reading on:
//
//   * The device is deliberately stupid. It lists, checksums, hands back,
//     stores, deletes and says goodbye. It does not work out what is missing -
//     the browser does that, because the browser is the end with the memory
//     and the language for it. Over Wi-Fi it was the other way round only
//     because the server could not push.
//
//     Handing back is the newest of those and it is here to KEEP that true.
//     With several collections on one device, deciding which tiles a removed
//     one leaves behind means reading the collections that stay; the choice
//     was a verb that hands a file over or a device that walks its own
//     layouts, and adr/0021 took the verb.
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
#include "collections.h"
#include "version.h"

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
  /** The last collection file this session stored, or empty.
   *
   * The one thing in here that is not a tally, and it is here because the
   * alternative is a transfer that looks from the outside like nothing
   * happened: somebody sends a second collection, the talker goes on showing
   * the first, and the only way to see that it arrived is to go into the menu
   * and look. So the device shows what it was just given - see
   * adr/0021 - and this is how vorlaut.ino finds out which that was.
   *
   * The name, not a flag: a session may carry several, and the last one is the
   * one the person was working on. Kept as an array rather than a pointer into
   * the command, which dies with the loop. */
  char collection[CABLE_NAME_MAX + 1];
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
    CableResult result = {false, false, 0, 0, 0, nullptr, {0}};
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
      //
      // Silence *since the device stopped talking*, which is the assignment at
      // the foot of this loop and not the one after readLine(). The difference
      // is the whole of what this window is for: it is the browser's to spend,
      // and measuring it from a command's arrival spent it on the answer to
      // that command instead.
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

        case CABLE_GET:
          sayFile(command.name);
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
            // Everything after a lost transfer is refused until hello: what
            // is left of the window may still be coming down the wire, and
            // reading it as commands is the one way this protocol could
            // quietly store the wrong thing. The window is why this is now at
            // most a few thousand bytes rather than most of a WAV, but it is
            // not why the rule exists, and the rule does not change with it.
            if (strcmp(why, "short") == 0 || strcmp(why, "lost") == 0) {
              drain();
              line.at = 0;      // whatever was half-read is not a command
              open = false;
            }
          } else {
            result.stored++;
            result.bytes += command.size;
            // Which of them was a collection, so that the device can come back
            // showing the one it was just handed. Asked of the name rather
            // than assumed from the order: the browser sends the collection
            // last because it is the commit, and a rule that depended on that
            // would be this file believing something it was never told.
            if (collectionKind(command.name) != COLLECTION_NOT) {
              strncpy(result.collection, command.name,
                      sizeof(result.collection) - 1);
              result.collection[sizeof(result.collection) - 1] = '\0';
            }
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

      // The answer has gone out; the browser's wait starts here. Before this,
      // a `get` was charged to the browser: sayFile() reads the file twice and
      // blocks in Serial.write() until the host drains it, and every one of
      // those milliseconds came off a window that was supposed to measure
      // somebody else's silence. A browser that replied the instant it had the
      // file could still arrive after the window had gone, and then the next
      // verb met a shut session and came back "err session" - with nothing
      // wrong at either end.
      //
      // Reading a run of collections back is where this showed, because a get
      // is slow and there are several of them in a row. It is not the only
      // verb exposed to it: receive() has its own clock for the bytes, but the
      // time it spends is charged to this window just the same the moment it
      // returns, so a put slow enough would have shut the session on the way
      // out of a file that stored perfectly. That it has not is a fact about
      // how fast a window-and-ack transfer happens to be, not a difference in
      // the rule - and it stops being a fact the day a file gets bigger.
      // Which is the argument for fixing it here, in the one place both verbs
      // come back to, rather than in the one that complained.
      //
      // One assignment and no new words: the wire says exactly what it said
      // before, and a browser cannot tell this version from the last except by
      // it working.
      lastLine = millis();
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

  // **Serial.write() is not a promise.** On the S3's native USB it returns how
  // many bytes it managed, and a full transmit queue makes that fewer than it
  // was asked for - the call gives up on its own timeout rather than blocking
  // until the host catches up. Ignoring that number is how a device comes to
  // count bytes it never sent: the browser waits for a file that is short by
  // exactly the amount dropped and eventually says "sent 570 of 1072 bytes and
  // stopped", which is true and names the wrong culprit.
  //
  // receive() has always checked the other direction - a short file.write() is
  // "lost" and ends the transfer - and this is that same check on the way out.
  //
  // The delay is what makes retrying worth anything rather than a spin: the
  // bytes leave when the USB task runs, and it cannot run while this loop has
  // the core. Giving up after CABLE_QUIET_MS keeps the rule the rest of this
  // file is built on - the device gives up first, so it is the end that gets
  // to say why.
  //
  // Returns what really went out, so a caller can stop counting on it.
  static size_t writeAll(const uint8_t *bytes, size_t length) {
    size_t gone = 0;
    uint32_t moved = millis();
    while (gone < length) {
      const size_t wrote = Serial.write(bytes + gone, length - gone);
      if (wrote > 0) {
        gone += wrote;
        moved = millis();
        continue;
      }
      if (millis() - moved > CABLE_QUIET_MS) break;   // nobody is reading
      delay(1);
    }
    return gone;
  }

  static void put(int length, const char *text) {
    if (length > 0) writeAll((const uint8_t *)text, (size_t)length);
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

  static void sayNameNumberHex(const char *key, const char *name, uint32_t n,
                               uint32_t value) {
    char out[CABLE_LINE_MAX];
    put(cableSayNameNumberHex(out, sizeof(out), key, name, n, value), out);
  }

  static void sayBye(uint16_t stored, uint16_t removed, uint32_t bytes) {
    char out[CABLE_LINE_MAX];
    put(cableSayBye(out, sizeof(out), stored, removed, bytes), out);
  }

  // How the browser tells a vorlaut from whatever else the person picked in
  // the port dialog - and how it finds out whether what it wants to send will
  // fit before it starts sending it.
  //
  // The second line is which firmware this is, and it answers a different
  // question from the first: `vorlaut` is the protocol, which stands still for
  // releases at a time, and `firmware` is the build. See version.h for where
  // the word comes from and why a device that was built on somebody's desk
  // says `dev` rather than a number. A browser that has never heard of the
  // keyword skips it, which is what makes this a line the firmware may gain
  // without the protocol version moving.
  static void sayHello() {
    char out[CABLE_LINE_MAX];
    put(cableSayNumber(out, sizeof(out), "vorlaut", CABLE_VERSION), out);
    put(cableSayWord(out, sizeof(out), "firmware", VORLAUT_VERSION), out);
    put(cableSayNumber(out, sizeof(out), "total",
                       (uint32_t)LittleFS.totalBytes()), out);
    put(cableSayNumber(out, sizeof(out), "free",
                       (uint32_t)(LittleFS.totalBytes() - LittleFS.usedBytes())),
        out);
    // No `files` line. It was here, and saying it cost a walk of the whole
    // root - a lookup per entry - on every greeting: measured at 6.4 s on a
    // 7040 KiB partition holding 322 files, against a browser that gives an
    // answer five. So a talker that had been filled up stopped answering the
    // loading page, in the words for a device that is not there, and the
    // remedy on that side was patience rather than speed.
    //
    // Nothing read the number. The page works in `total` and `free`, and what
    // is actually on the device it asks for with `list`, which walks once and
    // is asked when somebody wants the answer. This was a walk paid on every
    // connect for a line nobody listened to.
    //
    // Dropping it costs no protocol version, for the same reason the notes
    // below give for gaining one: a browser that hears no `files` keeps
    // whatever it started with, which is zero, and nothing asks it anything.
    // The same walk was taken out of waking on 2026-09-01 - see
    // scanCollections() in vorlaut.ino - and this is the greeting's half of it.
    // How many collections this device will hold, which is the one thing a
    // browser cannot work out from the file list: a talker flashed before
    // 2026-08-31 holds exactly one, under the name layout.bin, and sending it
    // a second would be a file that fills the partition and is never read. A
    // browser that has never heard of the keyword skips it, and silence means
    // one - which is true of every device already in a drawer. That is the
    // whole of why several collections cost no protocol version.
    put(cableSayNumber(out, sizeof(out), "collections", MAX_COLLECTIONS), out);
    // Which tile forms this firmware can draw. A browser that has never heard
    // of the keyword skips it, and a device that never says it gets raw tiles
    // - which is every talker flashed before 2026-08-31 and is exactly what
    // they were being sent anyway. That is why compression costs no protocol
    // version: the older device is not broken by it, it is not offered it.
    put(cableSayWord(out, sizeof(out), "tiles", CABLE_TILE_FORMS), out);
    // And which recording forms it can play, on exactly the same terms. The
    // two are separate words because they are separate capabilities: a
    // firmware could gain one without the other, and a browser that read one
    // answer for both would be sending a file on the strength of an unrelated
    // yes.
    put(cableSayWord(out, sizeof(out), "audio", CABLE_AUDIO_FORMS), out);
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

  // One file back the way it came, so that the browser can work out what a
  // collection still needs.
  //
  // The head line carries the length and the checksum, and then exactly that
  // many bytes follow with no newline in front of them and none after - the
  // same framing a `put` has, read from the other side, and for the same
  // reason: a reader that searched for the next command at a line start would
  // find one inside a recording sooner or later.
  //
  // There is no flow control here and none is needed. It is the browser that
  // is reading, and a browser drains a stream as fast as it arrives; the
  // window exists because the DEVICE is the slow end when it is the one
  // writing into flash.
  //
  // Any name, not only a collection's. Deciding which files a browser is
  // entitled to read back would be the device having an opinion about content,
  // and it has none - it lists what it holds and hands over what it is asked
  // for. What the browser actually asks for is collections, which are a few
  // kilobytes; a `get` of a recording is slow and harmless.
  static void sayFile(const char *name) {
    File file = LittleFS.open(path(name), "r");
    if (!file) { say("err", "missing", name); return; }
    const uint32_t size = (uint32_t)file.size();

    // Twice through the file: once for the checksum, once for the bytes. The
    // head has to carry the checksum and the head goes first, and holding a
    // whole file in RAM to avoid a second read is exactly the thing this
    // device does not have the RAM for.
    uint32_t value = CABLE_CRC_INIT;
    uint8_t buffer[CABLE_CHUNK];
    for (;;) {
      const int got = file.read(buffer, sizeof(buffer));
      if (got <= 0) break;
      value = cableCrc32(value, buffer, (size_t)got);
    }
    file.seek(0);
    sayNameNumberHex("data", name, size, value);
    uint32_t sent = 0;
    while (sent < size) {
      const int got = file.read(buffer, sizeof(buffer));
      if (got <= 0) break;
      // What went out rather than what was handed over. A chunk that could not
      // be finished ends the file here: carrying on would put the rest of it
      // into a stream the browser is already counting wrong, and the "sent"
      // line below is the one thing that can still tell the truth about it.
      const size_t wrote = writeAll(buffer, (size_t)got);
      sent += (uint32_t)wrote;
      if (wrote < (size_t)got) break;
    }
    file.close();
    // The count the device really sent, which is the head's number on a file
    // system that behaved and a smaller one on a file that shrank underneath
    // it. The browser compares the two: a short answer is loud here, where a
    // stream that simply stopped would look like the next line being late.
    sayNameNumber("sent", name, sent);
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
  //
  // What gap_ means changed when the window did. It used to be the browser
  // being late, and a full buffer made it read 4001 ms because the bytes it
  // was waiting for had been thrown away rather than delayed. Now the device
  // waits after every "ack" for a window it has just asked for, so gap_ is a
  // round trip - it is expected to be small and non-zero rather than zero, and
  // a zero would mean the acknowledging is not happening at all.
  static uint32_t gap_;
  static uint32_t stall_;

  // One file. Returns nullptr when it is stored, or the word to send back.
  //
  // "go" goes out only once the half-written file is open, and the browser
  // sends nothing before it. Without that handshake a refusal would be
  // followed by a file's worth of content arriving in readLine(), where some
  // of it would eventually look like a command.
  //
  // The "go" carries CABLE_WINDOW, and that number is the whole of the flow
  // control. The browser sends at most a window and then waits; this loop
  // answers "ack" with the running total only once those bytes are in the file
  // system. So the device is never behind the browser by more than it asked
  // for, and a flash write that takes an age costs a pause rather than the
  // bytes that arrived during it.
  //
  // Nothing here is a second idea of being in a session. The window and the
  // running total live for one file and die with it; the one state that
  // outlives a put is `open` in serve(), which this function does not touch.
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
    sayNumber("go", CABLE_WINDOW);

    uint32_t got = 0;
    uint32_t acked = 0;
    uint32_t value = CABLE_CRC_INIT;
    uint8_t buffer[CABLE_CHUNK];
    uint32_t lastByte = millis();
    gap_ = 0;
    stall_ = 0;

    // An empty file never goes round this loop, so it is never acknowledged.
    // That is the rule read literally rather than a case to remember: every
    // window of content is answered, and there are no windows.
    while (got < command.size) {
      const int there = Serial.available();
      if (there <= 0) {
        const uint32_t waited = millis() - lastByte;
        if (waited > gap_) gap_ = waited;
        if (waited > CABLE_QUIET_MS) {
          // Unmarked, so it is the device's log rather than an answer - the
          // browser steps over it and a person reading the wire gets the one
          // number that says whether this was a trickle of loss or a wall.
          Serial.printf("cable: short after %u of %u bytes"
                        " (gap %u ms, longest flash write %u ms)\n",
                        (unsigned)got, (unsigned)command.size,
                        (unsigned)gap_, (unsigned)stall_);
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

      // Everything up to here is in the file system, so it can be admitted to.
      // Answering early would give the number away before the flash had it,
      // which is the one thing an acknowledgement must not do - the browser
      // would go on sending during exactly the write this exists to wait out.
      //
      // The running total rather than the size of the piece: the browser
      // compares it with what it has sent, so a stream that slipped is loud
      // where a per-piece count would agree with itself all the way down.
      if (got - acked >= CABLE_WINDOW || got == command.size) {
        acked = got;
        sayNumber("ack", acked);
      }
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
    // the same rule sync.h followed, and for the same reason.
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
  //
  // Bounded by CABLE_WINDOW now: a browser that is following the protocol has
  // at most one window out at any moment. It waits on the wire going quiet
  // rather than on that number, because the browser that has to be drained
  // after is by definition one that stopped behaving.
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
