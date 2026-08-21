// Prints every string from texts.h the way a panel would receive it: the
// code page 437 bytes and, separately, the number of glyphs. The Python
// script next door checks those numbers against the width of a display.

#include <stdio.h>
#include "../firmware/vorlaut/panel_text.h"
#include "../firmware/vorlaut/texts.h"

static void dump(unsigned lang, const char *field, const char *value) {
  char panel[64];
  const uint8_t glyphs = toPanelText(value, panel, sizeof(panel));
  printf("%u %s %u ", lang, field, glyphs);
  for (const char *p = panel; *p; p++) printf("%02x", (unsigned char)*p);
  printf(" %s\n", value);
}

int main(void) {
  for (unsigned i = 0; i < LANGUAGE_COUNT; i++) {
    const Strings &s = LANGUAGES[i];
    dump(i, "back", s.back);
    dump(i, "info", s.info);
    dump(i, "menu", s.menu);
    dump(i, "sets", s.sets);
    dump(i, "storage1", s.storage1);
    dump(i, "storage2", s.storage2);
    dump(i, "storagePresent", s.storagePresent);
    dump(i, "storageMissing", s.storageMissing);
    dump(i, "empty1", s.empty1);
    dump(i, "empty2", s.empty2);
  }
  printf("max %d\n", MENU_MAX_CHARS);
  printf("count %u\n", (unsigned)LANGUAGE_COUNT);
  return 0;
}
