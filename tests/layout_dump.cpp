// Liest eine layout.bin mit genau dem Code, den auch die Firmware benutzt,
// und gibt aus, was dabei herauskommt. Das Python-Skript daneben vergleicht
// die Ausgabe mit dem, was build.py hineingeschrieben hat.

#include <stdio.h>
#include <stdlib.h>
#include "../firmware/vorlaut/layout_format.h"

static void hex(const uint8_t *p, int n) {
  for (int i = 0; i < n; i++) printf("%02x", p[i]);
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "Aufruf: layout_dump <layout.bin>\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { fprintf(stderr, "nicht lesbar: %s\n", argv[1]); return 2; }
  static uint8_t puffer[LAYOUT_MAX_BYTES];
  size_t n = fread(puffer, 1, sizeof(puffer), f);
  fclose(f);

  Layout layout;
  LayoutResult r = parseLayout(puffer, (uint32_t)n, layout);
  if (r != LAYOUT_OK) { printf("FEHLER %d\n", (int)r); return 1; }

  printf("bytes %zu\n", n);
  printf("sets %u\n", layout.setCount);
  printf("sleep %u\n", layout.sleepSeconds);
  for (uint8_t i = 0; i < layout.setCount; i++) {
    const SetEntry &e = layout.sets[i];
    printf("set %u color %04x name %s label ", i, e.color, e.name);
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
