// Reads a layout.bin with exactly the code the firmware uses and prints what
// comes out of it. The Python script next door compares that output with what
// build.py wrote in.

#include <stdio.h>
#include <stdlib.h>
#include "../firmware/vorlaut/layout_format.h"

static void hex(const uint8_t *p, int n) {
  for (int i = 0; i < n; i++) printf("%02x", p[i]);
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
    printf("set %u name %s label ", i, e.name);
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
