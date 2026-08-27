// The wire format of the cable, and nothing else.
//
// The cable replaces the Wi-Fi sync for a browser that has no server behind
// it any more: a page cannot be an HTTP server, and a page served over HTTPS
// may not talk to a plain-HTTP device on the LAN. What is left is the USB-C
// socket the device is charged through anyway - see docs/cable.md for the
// whole protocol and the reasoning.
//
// Deliberately without any Arduino dependency, like layout_format.h and
// pair_format.h: that way tests/test_cable_format.py can compile it on the
// computer and check it against what tools/cable.js really sends, instead of
// on a device that stores the wrong bytes and says nothing about why.
//
// Lines, not JSON - the same reason as the manifest in sync.h. A parser on
// the ESP32 means a library, a heap and a class of failure that a fixed line
// format does not have. Unknown keywords are skipped, so the browser can gain
// a field without a device already in a drawer falling over.

#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>

// Bumped when a device that speaks the old protocol could no longer be driven
// correctly by a browser that speaks the new one. Adding a keyword is not
// that - both sides skip what they do not know.
//
// 2 is the acknowledged transfer: "go" carries a window, every window of file
// content is answered with "ack", and the browser sends nothing until it has
// been. A version 1 browser would send a whole file into a device that is
// waiting to be asked, and a version 1 device would never answer the window
// the browser is waiting for - so this is a break in both directions, made on
// purpose while every device was still on the desk.
#define CABLE_VERSION 2

// Every protocol line is marked, in both directions, because this stream is
// shared with the serial log. The device prints prose to Serial while it
// works ("menu opened", "key 1: /a....wav"), and the browser has no way to
// tell that apart from an answer unless the answers are marked. So:
//
//   the browser writes lines beginning "> " and ignores everything that does
//   not begin "< ", which leaves the log readable in the same window;
//   the device answers with "< " and ignores everything that does not begin
//   "> ", which makes it deaf to a serial monitor somebody left open.
#define CABLE_HOST_SIGIL '>'
#define CABLE_DEVICE_SIGIL '<'

// "put <34 characters> <7 digits> <8 hex>" is 56. Generous on purpose.
#define CABLE_LINE_MAX 128

// A content name is 34 characters ("t" + 32 hex + ".bin"). This leaves room
// for a longer one later without reaching LittleFS's own limit.
#define CABLE_NAME_MAX 63

// Where a file lands until it is whole. The same name sync.h uses, because
// the two never run at once and its sweep already knows to leave it alone.
#define CABLE_PART_FILE "/.part"

// The one file the Wi-Fi sync keeps its bookkeeping in. A cable session that
// changed anything deletes it, so a later Wi-Fi sync does not believe a
// stamp that describes content the cable has since replaced.

// What the device does when the bytes of a file stop arriving. Short enough
// that a browser tab that was closed mid-transfer does not leave the device
// staring at the cable, long enough to survive a garbage collection pause in
// LittleFS. A device that hangs here no longer speaks, and speaking is the
// one thing it is for - the same rule as the setup portal's timeout.
//
// What this has to outlast changed with CABLE_WINDOW below. It used to have
// to cover a flash pause, because the browser sent whether or not the device
// was listening and the device's wait was where that showed up. Now the
// device only ever waits for bytes it has just asked for, so what this covers
// is one round trip and a browser's own scheduling - milliseconds, against
// four seconds. It stays generous rather than being tuned down: the thing it
// is really for is a browser that has gone away, and noticing that a little
// late costs nothing.
#define CABLE_QUIET_MS 4000

// The most file content the device will take without saying it has it.
//
// This is the flow control, and it is the whole reason there is no longer a
// number here for how far behind the device may fall. The device sends this
// figure with its "go", reads at most this many bytes, writes them, and only
// then answers "ack". The browser sends nothing until it has. So the bytes in
// flight are bounded by what the device asked for rather than by how fast the
// browser can write, and a flash write that takes an age costs time instead of
// content.
//
// What it replaced was CABLE_RX_BUFFER, 64 KB of receive buffer sized against
// a burst: USB fills an empty buffer at about 490 KB/s and the longest single
// LittleFS write measured 46 ms, so 22 KB could arrive with nowhere to go. The
// interrupt reads the USB FIFO, finds no room and discards, and CDC has no way
// to tell the other end - the browser reports every chunk written and the
// device is quietly short. 16 KB was tried first and lost 214 bytes of 26912.
// 64 KB was that worst case with room over it, and it was still a bound rather
// than a guarantee: a longer stall on a fuller file system would have overrun
// it too, silently, in exactly the same way.
//
// The receive buffer is now sized FROM this rather than against a guess -
// vorlaut.ino passes CABLE_WINDOW to Serial.setRxBufferSize(), and one window
// is by construction the most that can be in flight. 4096 because it is small
// enough that the buffer costs 4 KB of RAM instead of 64, and large enough
// that a megabyte of content is 250 round trips rather than 2000.
#define CABLE_WINDOW 4096

// How long the device waits for a whole line before it has been greeted.
// Deliberately far shorter than CABLE_QUIET_MS: until a browser has said
// hello, anything on this wire is as likely to be a serial monitor or one
// stray byte, and every millisecond spent here is a millisecond the keys are
// not being read. "> hello" arrives in one piece or it was not one.
#define CABLE_GREET_MS 250

// After a transfer is given up on, the rest of the file is still coming down
// the wire. The device throws bytes away until this long has passed with none
// arriving, so that file content is never mistaken for commands.
#define CABLE_DRAIN_MS 400

// A whole session, however well it is going, ends here. Nothing may park the
// device in the cable for an afternoon.
#define CABLE_SESSION_MS 600000

enum CableVerb {
  // Not a protocol line at all: log output, a stray newline, something a
  // serial monitor typed. Silently ignored - answering it would put noise
  // into the stream the browser is reading.
  CABLE_NONE = 0,
  CABLE_HELLO,   // who are you
  CABLE_LIST,    // what have you got
  CABLE_CRC,     // checksum of one file
  CABLE_PUT,     // one file follows as raw bytes, a window at a time
  CABLE_RM,      // throw one away
  CABLE_DONE,    // that is all
  // Marked as ours but a verb this firmware does not have. Answered with an
  // error rather than ignored: a browser waiting for a reply that never comes
  // looks exactly like a broken cable, and the two want telling apart.
  CABLE_UNKNOWN,
};

struct CableCommand {
  CableVerb verb;
  char name[CABLE_NAME_MAX + 1];
  uint32_t size;
  uint32_t crc;
  // Every field this verb needs is present, within range, and the name is one
  // the device is willing to touch. A command that is not complete is
  // answered with an error and never acted on.
  bool complete;
};

// --- The checksum ------------------------------------------------------------
//
// The file names are hashes, so a name means one content - that is what lets
// the browser work out what is missing without asking. It does NOT let the
// device check what it received: the names are hashes of the *input* (the
// source image plus the pipeline version, the text plus the voice), not of
// the bytes that come out. docs/software.md says so, and it is easy to read
// past. So each file carries a checksum of its own.
//
// CRC-32 rather than something cryptographic, because the thing being guarded
// against is a transfer that went wrong, not somebody choosing bytes to fool
// us - and whoever is on the cable can write whatever they like anyway.
// Truncation, a byte count off by one, a full file system: those are what
// this catches, and they are all silent without it.
//
// The same CRC-32 as zlib.crc32 and as every other tool anybody will reach
// for, so the value can be checked by hand. Sixteen entries rather than the
// usual 256: a quarter of a kilobyte of table is not worth saving here, but
// the nibble version is short enough to read in one go, and it is fast enough
// that the checksum is not what makes a transfer slow.
#define CABLE_CRC_INIT 0u

static inline uint32_t cableCrc32(uint32_t crc, const uint8_t *data,
                                  size_t length) {
  static const uint32_t table[16] = {
    0x00000000u, 0x1db71064u, 0x3b6e20c8u, 0x26d930acu,
    0x76dc4190u, 0x6b6b51f4u, 0x4db26158u, 0x5005713cu,
    0xedb88320u, 0xf00f9344u, 0xd6d6a3e8u, 0xcb61b38cu,
    0x9b64c2b0u, 0x86d3d2d4u, 0xa00ae278u, 0xbdbdf21cu,
  };
  crc = ~crc;
  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    crc = (crc >> 4) ^ table[crc & 0x0fu];
    crc = (crc >> 4) ^ table[crc & 0x0fu];
  }
  return ~crc;
}

// --- Names -------------------------------------------------------------------

// Whether the device is willing to create, checksum or delete this name.
//
// The browser is on the other end of a cable somebody plugged in, so this is
// not a defence against an attacker - it is a defence against a bug. A name
// with a slash in it would put a file somewhere the sweep never looks; a name
// beginning with a dot would collide with the half-written file; and the
// Wi-Fi sync's own bookkeeping is not content and is not the browser's to
// write. Each of those is silent on a device and obvious here.
static inline bool cableNameOk(const char *name) {
  if (!name) return false;
  const size_t length = strlen(name);
  if (length == 0 || length > CABLE_NAME_MAX) return false;
  // No directories. Everything the device holds lies flat in the root, and a
  // name that walked out of it would not be swept up again.
  if (name[0] == '.') return false;
  for (size_t i = 0; i < length; i++) {
    const unsigned char c = (unsigned char)name[i];
    if (c <= ' ' || c >= 0x7f || c == '/') return false;
  }
  // CABLE_PART_FILE, the one name the device keeps for itself, is caught by
  // the leading dot already. There was a second - "version", the note the
  // Wi-Fi sync kept about what it last fetched - and it went with the sync.
  // Nothing writes that file now, and letting the name through is what sweeps
  // it off a device that was synced before the radio was removed.
  return true;
}

// --- Reading a command -------------------------------------------------------

// Digits up to a non-digit. Anything that would not fit in 32 bits comes back
// as "too big" rather than wrapping, because a size that wrapped would open a
// file and then wait forever for bytes nobody is sending.
static inline bool cableNumber(const char *value, uint32_t *out) {
  if (*value < '0' || *value > '9') return false;
  uint64_t number = 0;
  for (; *value >= '0' && *value <= '9'; value++) {
    number = number * 10u + (uint64_t)(*value - '0');
    if (number > 0xffffffffull) return false;
  }
  *out = (uint32_t)number;
  return *value == '\0';
}

// Eight hex digits, lower or upper case. Exactly eight: a checksum that was
// cut short would otherwise compare unequal for a reason nobody could see.
static inline bool cableHex(const char *value, uint32_t *out) {
  uint32_t number = 0;
  int digits = 0;
  for (; *value; value++, digits++) {
    const char c = *value;
    uint32_t nibble;
    if (c >= '0' && c <= '9') nibble = (uint32_t)(c - '0');
    else if (c >= 'a' && c <= 'f') nibble = (uint32_t)(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') nibble = (uint32_t)(c - 'A' + 10);
    else return false;
    number = (number << 4) | nibble;
  }
  if (digits != 8) return false;
  *out = number;
  return true;
}

static inline void cableCommandClear(CableCommand *command) {
  command->verb = CABLE_NONE;
  command->name[0] = '\0';
  command->size = 0;
  command->crc = 0;
  command->complete = false;
}

// Copies a word out of the line, refusing rather than truncating: half a name
// is a different file, and it would be created without a word of complaint.
static inline bool cableWord(const char *from, size_t length, char *out,
                             size_t cap) {
  if (length == 0 || length >= cap) return false;
  memcpy(out, from, length);
  out[length] = '\0';
  return true;
}

// Reads one line from the browser. The line arrives without its newline; a
// trailing \r is tolerated, because a terminal on the other end may send one.
//
// A line that is not marked as ours comes back CABLE_NONE, which is how the
// device stays deaf to whatever else is on this wire.
static inline CableVerb cableParse(const char *line, CableCommand *command) {
  cableCommandClear(command);
  if (!line) return CABLE_NONE;

  size_t length = strlen(line);
  while (length && (line[length - 1] == '\r' || line[length - 1] == '\n')) {
    length--;
  }
  if (length < 2 || line[0] != CABLE_HOST_SIGIL || line[1] != ' ') {
    return CABLE_NONE;
  }

  const char *verb = line + 2;
  const char *stop = line + length;
  const char *space = (const char *)memchr(verb, ' ', (size_t)(stop - verb));
  const size_t verbLength = (size_t)((space ? space : stop) - verb);

  // The whole vocabulary. Six words, because each of them is one thing the
  // device can do - the deciding is all on the browser's side, which is the
  // side that has the memory and the language to do it in.
  if (verbLength == 5 && memcmp(verb, "hello", 5) == 0) command->verb = CABLE_HELLO;
  else if (verbLength == 4 && memcmp(verb, "list", 4) == 0) command->verb = CABLE_LIST;
  else if (verbLength == 3 && memcmp(verb, "crc", 3) == 0) command->verb = CABLE_CRC;
  else if (verbLength == 3 && memcmp(verb, "put", 3) == 0) command->verb = CABLE_PUT;
  else if (verbLength == 2 && memcmp(verb, "rm", 2) == 0) command->verb = CABLE_RM;
  else if (verbLength == 4 && memcmp(verb, "done", 4) == 0) command->verb = CABLE_DONE;
  else return (command->verb = CABLE_UNKNOWN);

  // The arguments. Counted rather than just walked, because how many there
  // are is part of the meaning: a name can never contain a space, so "rm two
  // words.bin" is not a name with a space in it - it is a command this
  // firmware does not understand, and taking its first word would delete a
  // file called "two". Only the first three are kept.
  const char *word[3] = {NULL, NULL, NULL};
  size_t wordLength[3] = {0, 0, 0};
  int words = 0;
  const char *at = space ? space + 1 : stop;
  while (at < stop) {
    const char *next = (const char *)memchr(at, ' ', (size_t)(stop - at));
    const char *wordEnd = next ? next : stop;
    if (words < 3) {
      word[words] = at;
      wordLength[words] = (size_t)(wordEnd - at);
    }
    words++;
    if (!next) break;
    at = next + 1;
  }

  char number[24], checksum[24];
  switch (command->verb) {
    case CABLE_HELLO:
    case CABLE_LIST:
    case CABLE_DONE:
      // These take nothing, and anything after them is ignored rather than
      // refused - there is nothing here for a stray word to be mistaken for,
      // so a browser may start sending one later.
      command->complete = true;
      break;
    case CABLE_CRC:
    case CABLE_RM:
      // Exactly one. See the note above on why a second word is refused
      // rather than ignored.
      command->complete =
          words == 1 &&
          cableWord(word[0], wordLength[0], command->name,
                    sizeof(command->name)) &&
          cableNameOk(command->name);
      break;
    case CABLE_PUT:
      // At least three. A fourth is ignored, so a later browser can add a
      // field here without a device already in a drawer refusing the file.
      command->complete =
          words >= 3 &&
          cableWord(word[0], wordLength[0], command->name,
                    sizeof(command->name)) &&
          cableNameOk(command->name) &&
          cableWord(word[1], wordLength[1], number, sizeof(number)) &&
          cableNumber(number, &command->size) &&
          cableWord(word[2], wordLength[2], checksum, sizeof(checksum)) &&
          cableHex(checksum, &command->crc);
      break;
    default:
      break;
  }

  // Nothing half-read may stay behind in the struct. The caller reports the
  // name back, and reporting one the device would not touch as though it had
  // is how a browser ends up retrying the same file forever; a size left over
  // from a line whose checksum was then refused is the same mistake, one
  // field along.
  if (!command->complete) {
    command->name[0] = '\0';
    command->size = 0;
    command->crc = 0;
  }
  return command->verb;
}

// --- Writing an answer -------------------------------------------------------
//
// Every byte the device sends is composed here rather than in cable.h, so the
// wire text sits in the file the test compiles. Each of these writes one
// whole line including its newline and returns its length, or 0 if it would
// not fit - a truncated answer is worse than none, because the browser would
// read the first half as a complete line.

static inline int cableFits(int written, size_t cap) {
  return (written > 0 && (size_t)written < cap) ? written : 0;
}

// "< end hello", "< gone t3bd7....bin"
static inline int cableSayWord(char *out, size_t cap, const char *key,
                               const char *word) {
  return cableFits(snprintf(out, cap, "%c %s %s\n", CABLE_DEVICE_SIGIL, key,
                            word), cap);
}

// "< vorlaut 2", "< free 1146880", "< go 4096", "< ack 8192"
//
// The two the acknowledged transfer added are both of this shape, so it gained
// no formatter of its own - which is worth noticing rather than only being
// convenient. A keyword and a number is what this protocol already was.
static inline int cableSayNumber(char *out, size_t cap, const char *key,
                                 uint32_t number) {
  return cableFits(snprintf(out, cap, "%c %s %lu\n", CABLE_DEVICE_SIGIL, key,
                            (unsigned long)number), cap);
}

// "< file t3bd7....bin 26912", "< ok a8c1....wav 41008", "< end list 37"
static inline int cableSayNameNumber(char *out, size_t cap, const char *key,
                                     const char *name, uint32_t number) {
  return cableFits(snprintf(out, cap, "%c %s %s %lu\n", CABLE_DEVICE_SIGIL, key,
                            name, (unsigned long)number), cap);
}

// "< crc layout.bin 1a2b3c4d". Lower case and always eight digits, so the
// browser can compare the text rather than having to parse it first.
static inline int cableSayNameHex(char *out, size_t cap, const char *key,
                                  const char *name, uint32_t value) {
  return cableFits(snprintf(out, cap, "%c %s %s %08lx\n", CABLE_DEVICE_SIGIL,
                            key, name, (unsigned long)value), cap);
}

// "< err nospace", "< err crc a8c1....wav". One word for what went wrong, so
// the browser can act on it, and an optional second for the reader.
static inline int cableSayErr(char *out, size_t cap, const char *word,
                              const char *detail) {
  if (detail && *detail) {
    return cableFits(snprintf(out, cap, "%c err %s %s\n", CABLE_DEVICE_SIGIL,
                              word, detail), cap);
  }
  return cableFits(snprintf(out, cap, "%c err %s\n", CABLE_DEVICE_SIGIL, word),
                   cap);
}

// "< bye 12 3 486400" - stored, removed, bytes written.
static inline int cableSayBye(char *out, size_t cap, uint32_t stored,
                              uint32_t removed, uint32_t bytes) {
  return cableFits(snprintf(out, cap, "%c bye %lu %lu %lu\n",
                            CABLE_DEVICE_SIGIL, (unsigned long)stored,
                            (unsigned long)removed, (unsigned long)bytes), cap);
}
