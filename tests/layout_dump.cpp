// Reads a layout.bin with exactly the code the firmware uses and prints what
// comes out of it. The Python script next door compares that output with what
// build.py wrote in.

#include <stdio.h>
#include <stdlib.h>
#include "../firmware/vorlaut/layout_format.h"

static void hex(const uint8_t *p, int n) {
  for (int i = 0; i < n; i++) printf("%02x", p[i]);
}

/** One key, as the reader made of it: the two hashes and the flag, then the
 *  field that says what it does and the two answers that field MEANS. Both,
 *  and separately, for the reason layoutIdleSeconds() is printed beside the
 *  sleep field - a reader that quietly repaired an unknown value would print
 *  the right meaning and the wrong field. */
static void printKey(const char *at, const Key &key, uint8_t setCount) {
  printf("key %s image ", at);
  hex(key.image, HASH_BYTES);
  printf(" audio ");
  hex(key.audio, HASH_BYTES);
  printf(" has %d does %u target %u speaks %d to %d\n",
         key.hasAudio ? 1 : 0, (unsigned)key.does, (unsigned)key.target,
         layoutKeySpeaks(key.does) ? 1 : 0,
         (int)layoutKeyGoesTo(key.does, key.target, setCount));
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: layout_dump <layout.bin>\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { fprintf(stderr, "cannot read: %s\n", argv[1]); return 2; }
  static uint8_t buffer[LAYOUT_MAX_BYTES];
  size_t n = fread(buffer, 1, sizeof(buffer), f);
  fclose(f);

  Layout layout;
  LayoutResult r = parseLayout(buffer, (uint32_t)n, layout);
  if (r != LAYOUT_OK) { printf("ERROR %d\n", (int)r); return 1; }

  printf("bytes %zu\n", n);
  printf("sets %u\n", layout.setCount);
  printf("language %u\n", layout.language);
  printf("sleep %u\n", layout.sleepSeconds);
  for (uint8_t i = 0; i < layout.setCount; i++) {
    const SetEntry &e = layout.sets[i];
    printf("set %u name %s\n", i, e.name);
    char at[16];
    snprintf(at, sizeof(at), "%u set", i);
    printKey(at, e.key, layout.setCount);
    for (uint8_t j = 0; j < SLOT_COUNT; j++) {
      snprintf(at, sizeof(at), "%u %u", i, j);
      printKey(at, e.slots[j], layout.setCount);
    }
  }
  return 0;
}
