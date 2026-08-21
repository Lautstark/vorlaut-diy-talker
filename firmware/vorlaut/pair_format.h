// The wire format of the pairing, and nothing else.
//
// Pairing is how the device gets its token without anybody typing one. It
// shows five digits, one per display, and the browser confirms them - see
// docs/software.md. This file holds the two pieces of that which are easy to
// get quietly wrong: turning a random number into five digits, and reading
// the server's answer.
//
// Deliberately without any Arduino dependency, like layout_format.h and
// panel_text.h: that way tests/test_pair_format.py can compile it on the
// computer and check it there, instead of on a device that shows a wrong
// digit and says nothing about why.
//
// Lines, not JSON - the same reason as the manifest in sync.h. A parser on
// the ESP32 means a library, a heap and a class of failure that a fixed line
// format does not have.

#pragma once
#include <stdint.h>
#include <string.h>

// Five digits, because there are five displays. One digit each, and the
// position on the device is the position in the browser - so nobody has to
// remember an order.
#define PAIR_CODE_DIGITS 5
#define PAIR_CODE_RANGE 100000u

// The largest multiple of PAIR_CODE_RANGE that still fits in 32 bits.
// Anything above it is thrown away and drawn again: 2^32 does not divide
// evenly by 100000, so plain "random % 100000" would let the lower codes come
// up a hair more often. It costs one extra draw in 4000 and removes the
// question entirely.
#define PAIR_CODE_LIMIT 4294900000u

// 16 bytes as hex. Not shown anywhere - see the note on the secret in
// pairing.h.
#define PAIR_SECRET_BYTES 16
#define PAIR_SECRET_CHARS (PAIR_SECRET_BYTES * 2)

// The device id is the Wi-Fi MAC as hex, so it survives a reflash without
// anything having to be stored for it.
#define PAIR_DEVICE_CHARS 12

// secrets.token_urlsafe(24) is 32 characters. Generous on purpose, so a
// server that hands out something longer later does not silently get cut off
// here - the device would then carry half a token and blame the key.
#define PAIR_TOKEN_MAX 96

// Where the device is in the pairing. PAIR_STATE_UNKNOWN is also what an
// answer that says nothing we understand comes out as - a newer server must
// not be able to make an older device believe it is done.
enum PairState {
  PAIR_STATE_UNKNOWN = 0,
  PAIR_STATE_WAITING,   // the digits are on the displays, nobody has typed them yet
  PAIR_STATE_READY,     // confirmed, and the token is in the answer
  PAIR_STATE_EXPIRED,   // the code was too old
  PAIR_STATE_DENIED,    // too many wrong attempts, or somebody said no
};

struct PairAnswer {
  PairState state;
  bool accepted;            // "ok 1" on the pairing request
  uint16_t expires;         // seconds the code is good for
  uint16_t interval;        // seconds the server would like between polls
  char token[PAIR_TOKEN_MAX];
};

static inline void pairAnswerClear(PairAnswer *answer) {
  answer->state = PAIR_STATE_UNKNOWN;
  answer->accepted = false;
  answer->expires = 0;
  answer->interval = 0;
  answer->token[0] = '\0';
}

// True when this random number may be used as a code. See PAIR_CODE_LIMIT.
static inline bool pairCodeUsable(uint32_t random) {
  return random < PAIR_CODE_LIMIT;
}

// Writes PAIR_CODE_DIGITS digits plus the terminating zero into out, so out
// needs PAIR_CODE_DIGITS + 1 bytes. Leading zeros are kept: a code is five
// characters, always, otherwise the displays would not all be filled.
//
// out[0] belongs on key 1, out[1] on key 2, out[2] on key 3, out[3] on key 4
// and out[4] on the set key. That order is the whole agreement between the
// device and the browser - it is written down in docs/software.md.
static inline void pairCodeFrom(uint32_t random, char *out) {
  uint32_t value = random % PAIR_CODE_RANGE;
  for (int8_t i = PAIR_CODE_DIGITS - 1; i >= 0; i--) {
    out[i] = (char)('0' + (value % 10u));
    value /= 10u;
  }
  out[PAIR_CODE_DIGITS] = '\0';
}

// --- Reading the answer ------------------------------------------------------

// Digits up to a non-digit, capped instead of wrapping. The value stops at
// whatever follows it in the line - \r, \n or the end of the body - because
// none of those is a digit.
static inline uint16_t pairNumber(const char *value) {
  uint32_t number = 0;
  for (; *value >= '0' && *value <= '9'; value++) {
    number = number * 10u + (uint32_t)(*value - '0');
    if (number > 65535u) return 65535u;
  }
  return (uint16_t)number;
}

static inline PairState pairStateFrom(const char *value, size_t length) {
  if (length == 7 && memcmp(value, "waiting", 7) == 0) return PAIR_STATE_WAITING;
  if (length == 5 && memcmp(value, "ready", 5) == 0)   return PAIR_STATE_READY;
  if (length == 7 && memcmp(value, "expired", 7) == 0) return PAIR_STATE_EXPIRED;
  if (length == 6 && memcmp(value, "denied", 6) == 0)  return PAIR_STATE_DENIED;
  return PAIR_STATE_UNKNOWN;
}

// Walks "keyword value" lines. Keywords it does not know are skipped on
// purpose - the same rule as the manifest reader in sync.h, so the server can
// gain a field without a device already in the field falling over.
static inline void pairParse(const char *body, PairAnswer *answer) {
  if (!body) return;
  while (*body) {
    const char *newline = strchr(body, '\n');
    const char *stop = newline ? newline : body + strlen(body);
    const char *end = stop;
    if (end > body && end[-1] == '\r') end--;   // a server that sends CRLF

    const char *space =
        (const char *)memchr(body, ' ', (size_t)(end - body));
    if (space) {
      const size_t keyLength = (size_t)(space - body);
      const char *value = space + 1;
      const size_t valueLength = (size_t)(end - value);

      if (keyLength == 5 && memcmp(body, "state", 5) == 0) {
        answer->state = pairStateFrom(value, valueLength);
      } else if (keyLength == 5 && memcmp(body, "token", 5) == 0) {
        const size_t fits = valueLength < PAIR_TOKEN_MAX - 1
                          ? valueLength : PAIR_TOKEN_MAX - 1;
        memcpy(answer->token, value, fits);
        answer->token[fits] = '\0';
      } else if (keyLength == 7 && memcmp(body, "expires", 7) == 0) {
        answer->expires = pairNumber(value);
      } else if (keyLength == 8 && memcmp(body, "interval", 8) == 0) {
        answer->interval = pairNumber(value);
      } else if (keyLength == 2 && memcmp(body, "ok", 2) == 0) {
        answer->accepted = valueLength >= 1 && value[0] == '1';
      }
    }
    body = newline ? newline + 1 : stop;
  }
}

// "state ready" without a usable token is not ready. A confirmation the
// device cannot act on would otherwise store an empty key and then blame the
// key on every sync from here on.
static inline bool pairAnswerComplete(const PairAnswer *answer) {
  return answer->state == PAIR_STATE_READY && answer->token[0] != '\0';
}
