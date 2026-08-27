// Every word the device shows, in one place.
//
// The firmware itself contains almost no text - a dozen words, all of them on
// the menu or the info page. It was twice that until the Wi-Fi path went, and
// most of what went was reasons: no network, no server, wrong key, too late.
// A cable has none of those to report. But they are the only thing on the
// device tied to a language, and they used to sit as literals in the middle of
// the drawing code. Collected here they can be translated without touching the
// logic.
//
// English is the default and the fallback: it is what an empty device shows,
// because the language is chosen by the content and an empty device has none.
//
// Which language is used comes from layout.bin - see LANGUAGE_CODES below and
// the header description in loader/src/layout_format.ts. The tables are all compiled in; together
// they cost a few hundred bytes, and that way one and the same firmware image
// works for every language.

// Not called strings.h on purpose. POSIX has a <strings.h> of its own, the
// toolchain's <string.h> includes it, and because the sketch folder is on the
// include path the compiler picked this file instead - with an error message
// that points anywhere but here.
#pragma once
#include <stdint.h>

// --- The space -------------------------------------------------------------
//
// Text size 2 means 12 pixels per character, and inside the frame a display
// is 116 pixels wide. That leaves NINE characters per line, and there are two
// lines. This is not a guideline, it is the panel: anything longer is drawn
// past the edge.
//
// tests/test_texts.py checks every entry below against this number, so a
// translation that does not fit fails on the computer instead of on the
// device.
#define MENU_MAX_CHARS 9

struct Strings {
  const char *back;          // set key: leave the menu
  const char *info;          // key 1: open the info page
  const char *menu;          // shown while the menu gesture is held
  const char *sets;          // info page: label for the number of sets
  const char *storage1;      // info page: label for the file system, line 1
  const char *storage2;      //                                     line 2
  const char *storagePresent;   // ... and its two answers
  const char *storageMissing;
  const char *empty1;        // nothing on the device yet, line 1
  const char *empty2;        //                            line 2
  const char *cable;         // ... a browser is pushing content down the cable
  const char *done;          // ... and the transfer finished

  // The order of these declarations is the order of the initialisers below,
  // and nothing checks that but the compiler counting. The /* name */ comments
  // there are comments: they said `done`, `failed`, `cable` while the struct
  // said `cable`, `done`, `failed`, and for as long as that lasted a running
  // transfer drew "failed" on all five displays and a finished one drew
  // "cable". No test could see it - tests/test_texts.py measures what the
  // strings are, not which field ends up holding them - and no device has run
  // this yet, so nobody could see it either. Keep the two lists in step.
};

// The order has to match LANGUAGE_CODES in loader/src/layout_format.ts - the
// file stores the index, not the name.
static const Strings LANGUAGES[] = {
  {  // 0 - English
    /* back            */ "back",
    /* info            */ "Info",
    /* menu            */ "Menu",
    /* sets            */ "Sets",
    /* storage1        */ "File",
    /* storage2        */ "system",
    /* storagePresent  */ "ready",
    /* storageMissing  */ "missing",
    /* empty1          */ "no",
    /* empty2          */ "content",
    /* cable           */ "cable",
    /* done            */ "done",
  },
  {  // 1 - German
    /* back            */ "zurück",
    /* info            */ "Info",
    /* menu            */ "Menü",
    /* sets            */ "Sets",
    /* storage1        */ "Datei-",
    /* storage2        */ "system",
    /* storagePresent  */ "da",
    /* storageMissing  */ "fehlt",
    /* empty1          */ "keine",
    /* empty2          */ "Inhalte",
    /* cable           */ "Kabel",
    /* done            */ "fertig",
  },
};

#define LANGUAGE_COUNT (sizeof(LANGUAGES) / sizeof(LANGUAGES[0]))
#define LANGUAGE_DEFAULT 0

static uint8_t languageIndex = LANGUAGE_DEFAULT;

// An unknown code falls back to English rather than reading past the table.
// A layout.bin from a newer build must not be able to crash the device.
static inline void setLanguage(uint8_t code) {
  languageIndex = code < LANGUAGE_COUNT ? code : LANGUAGE_DEFAULT;
}

static inline const Strings &text() {
  return LANGUAGES[languageIndex];
}
