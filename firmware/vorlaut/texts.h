// Every word the device shows, in one place.
//
// The firmware itself contains almost no text - four menu labels and two
// notices. But they are the only thing on the device that is tied to a
// language, and they used to sit as literals in the middle of the drawing
// code. Collected here they can be translated without touching the logic.
//
// English is the default and the fallback: it is what an empty device shows,
// because the language is chosen by the content and an empty device has none.
//
// Which language is used comes from layout.bin - see LANGUAGE_CODES below and
// the header description in build.py. The tables are all compiled in; together
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
  const char *fetch1;        // key 2: fetch content over Wi-Fi, line 1
  const char *fetch2;        //                                 line 2
  const char *wifiNew1;      // key 3: teach it another network, line 1
  const char *wifiNew2;      //                                 line 2
  const char *portalHint;    // ... the portal is open, go to the phone
  const char *wifi;          // ... looking for the network
  const char *loading;       // ... transferring, with a count underneath
  const char *done;          // ... and it worked
  const char *failed;        // ... and it did not, with a reason below
  const char *noWifi;        // reasons, each one word
  const char *noServer;
  const char *badKey;
  const char *switchedOff;
  const char *noAnswer;      // ... nothing answered at that address
};

// The order has to match LANGUAGE_CODES in build.py - the file stores the
// index, not the name.
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
    /* fetch1          */ "Fetch",
    /* fetch2          */ "content",
    /* wifiNew1        */ "new",
    /* wifiNew2        */ "Wi-Fi",
    /* portalHint      */ "on phone",
    /* wifi            */ "Wi-Fi",
    /* loading         */ "loading",
    /* done            */ "done",
    /* failed          */ "failed",
    /* noWifi          */ "no Wi-Fi",
    /* noServer        */ "no server",
    /* badKey          */ "wrong key",
    /* switchedOff     */ "shut",
    /* noAnswer        */ "no answer",
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
    /* fetch1          */ "Inhalte",
    /* fetch2          */ "holen",
    /* wifiNew1        */ "neues",
    /* wifiNew2        */ "WLAN",
    /* portalHint      */ "am Handy",
    /* wifi            */ "WLAN",
    /* loading         */ "lädt",
    /* done            */ "fertig",
    /* failed          */ "Fehler",
    /* noWifi          */ "kein WLAN",
    /* noServer        */ "kein Ziel",
    /* badKey          */ "Schlüssel",
    /* switchedOff     */ "zu",
    /* noAnswer        */ "nicht da",
  },
};

#define LANGUAGE_COUNT (sizeof(LANGUAGES) / sizeof(LANGUAGES[0]))
#define LANGUAGE_DEFAULT 0

static uint8_t languageIndex = LANGUAGE_DEFAULT;

// An unknown code falls back to English rather than reading past the table.
// A layout.bin from a newer build.py must not be able to crash the device.
static inline void setLanguage(uint8_t code) {
  languageIndex = code < LANGUAGE_COUNT ? code : LANGUAGE_DEFAULT;
}

static inline const Strings &text() {
  return LANGUAGES[languageIndex];
}
