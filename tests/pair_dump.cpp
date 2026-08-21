// Runs the pairing wire format from the sketch on this machine and prints
// what it makes of its input. The Python script next door compares that with
// what the server side is supposed to send and with what the browser is
// supposed to be told to type.
//
// Three modes, because there are three things worth checking separately:
//
//   limits          the constants, so both sides agree on the shape
//   code <number>   what a given random number turns into
//   parse           reads an answer body on stdin and prints the fields

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../firmware/vorlaut/pair_format.h"

static const char *stateName(PairState state) {
  switch (state) {
    case PAIR_STATE_WAITING: return "waiting";
    case PAIR_STATE_READY:   return "ready";
    case PAIR_STATE_EXPIRED: return "expired";
    case PAIR_STATE_DENIED:  return "denied";
    default:                 return "unknown";
  }
}

static int limits(void) {
  printf("digits %d\n", PAIR_CODE_DIGITS);
  printf("range %u\n", PAIR_CODE_RANGE);
  printf("limit %u\n", PAIR_CODE_LIMIT);
  printf("secret_chars %d\n", PAIR_SECRET_CHARS);
  printf("device_chars %d\n", PAIR_DEVICE_CHARS);
  printf("token_max %d\n", PAIR_TOKEN_MAX);
  return 0;
}

static int code(const char *text) {
  const uint32_t drawn = (uint32_t)strtoul(text, NULL, 10);
  char digits[PAIR_CODE_DIGITS + 1];
  pairCodeFrom(drawn, digits);
  printf("code %s\n", digits);
  printf("usable %d\n", pairCodeUsable(drawn) ? 1 : 0);
  return 0;
}

static int parse(void) {
  // Bigger than any answer the server sends, so nothing is cut off before the
  // reader has seen it - the point here is what the reader does, not what
  // this harness does.
  static char body[8192];
  const size_t got = fread(body, 1, sizeof(body) - 1, stdin);
  body[got] = '\0';

  PairAnswer answer;
  pairAnswerClear(&answer);
  pairParse(body, &answer);

  printf("state %s\n", stateName(answer.state));
  printf("accepted %d\n", answer.accepted ? 1 : 0);
  printf("expires %u\n", answer.expires);
  printf("interval %u\n", answer.interval);
  printf("token %s\n", answer.token);
  printf("complete %d\n", pairAnswerComplete(&answer) ? 1 : 0);
  return 0;
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "limits") == 0) return limits();
  if (argc >= 3 && strcmp(argv[1], "code") == 0) return code(argv[2]);
  if (argc >= 2 && strcmp(argv[1], "parse") == 0) return parse();
  fprintf(stderr, "usage: pair_dump limits | code <number> | parse\n");
  return 2;
}
