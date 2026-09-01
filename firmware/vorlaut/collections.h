// Several collections on one device, and which of them is showing.
//
// A collection is one file. That is the whole of the idea and everything else
// here follows from it: the list of collections is not a structure anybody
// maintains, it is what lies in the directory. Adding one is `put`, removing
// one is `rm`, and both of those verbs already existed - see
// adr/0021-the-device-holds-several-collections.md.
//
// The file is a layout.bin under a name of its own. Not a new format and not a
// new version: `c<32 hex>.bin` holds exactly the bytes layout_format.h has
// always read, so a collection is parsed by parseLayout() and by nothing else.
// What is here is the three questions that arrive with there being more than
// one of them - which files are collections, what each is called, and which
// one the device is showing - and none of those is a byte in the file.
//
// Deliberately without any Arduino dependency, like layout_format.h and
// key_press.h. vorlaut.ino supplies the directory walk and the reads; every
// decision is below, so tests/device_host.cpp makes the same ones and
// device/fixtures/collections.expected.json holds them from outside.

#pragma once
#include <stdint.h>
#include <string.h>

#include "layout_format.h"
// MENU_MAX_CHARS - how much of a name a panel can hold - and utf8Step(), which
// is how a name is counted in glyphs rather than in bytes.
#include "texts.h"
#include "panel_text.h"

// --- Which files are collections ---------------------------------------------

/** The letter a collection file's name begins with.
 *
 * `t` is a tile and `a` is a recording; this is the third, and it goes through
 * the same three places the other two do - hashBytes() in
 * loader/src/layout_format.ts, hashPath() in name_format.h, and cableNameOk()
 * in cable_format.h. The third of those has to be a superset of the first two
 * or a file silently never arrives, and docs/device-interface.md says so at
 * length. cableNameOk() takes any printable name with no slash and no leading
 * dot, so it already admits this one; device/fixtures/names.expected.json is
 * where that is written down rather than assumed. */
#define COLLECTION_PREFIX 'c'
#define COLLECTION_SUFFIX ".bin"

/** "c" + 32 hex digits + ".bin". Not counting the terminator. */
#define COLLECTION_FILE_CHARS (1 + HASH_BYTES * 2 + 4)      // 37

/** The one collection a device from before this had, under the one name it had.
 *
 * A talker flashed before 2026-08-31 holds `/layout.bin` and nothing else, and
 * it must go on working - as "the one collection", with its own name in the
 * menu like any other. That is the same care 8a15dc0 took over compressed
 * tiles, from the other side: there it was a new device reading an old file,
 * here it is a new firmware finding an old one.
 *
 * Nothing writes this name any more. The loader sends `c<hash>.bin`, and a
 * legacy file simply stays where it is until somebody removes it from the
 * loader page - which is the least destructive thing a page can do with a file
 * whose collection it cannot identify. */
#define COLLECTION_LEGACY_FILE "layout.bin"

/** How many collections the device will list.
 *
 * Not a limit the format has - the directory can hold whatever fits - and not
 * one RAM imposes either: the table below is 16 * 71 bytes, and the whole
 * point of parsing only the active collection is that SRAM stops scaling with
 * the count at all. What binds is the menu. Four names to a screen and three
 * once it has to page, so sixteen is six screens; past that, choosing a
 * collection is more pressing than a person with a talker in their hands
 * should have to do, and the file partition is 7040 KiB against a game's 3260.
 *
 * A device that somehow holds more lists the first sixteen in order and says
 * how many it left on the serial port. The loader refuses to send past the
 * number the device names in its greeting, which is where this is really
 * enforced - a browser that guessed would be back to assuming a constant it
 * was never told. */
#define MAX_COLLECTIONS 16

/** Enough of a collection file to name it: the header, and the first set's
 *  name after it. */
#define COLLECTION_HEAD_BYTES (LAYOUT_HEADER_BYTES + NAME_BYTES)   // 44

/** Whether this file name is a collection's, and which kind. */
enum CollectionKind {
  COLLECTION_NOT = 0,   // a tile, a recording, anything else in the root
  COLLECTION_NAMED,     // c<32 hex>.bin - what the loader writes
  COLLECTION_LEGACY,    // layout.bin - the one collection of an older device
};

static inline bool collectionHexDigit(char c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
}

/** Which kind of name this is. Lower case only, and exactly the one length:
 *  half a hash is a different file, and it would be listed as a collection
 *  whose bytes nobody wrote. */
static inline CollectionKind collectionKind(const char *name) {
  if (!name) return COLLECTION_NOT;
  if (strcmp(name, COLLECTION_LEGACY_FILE) == 0) return COLLECTION_LEGACY;
  if (strlen(name) != COLLECTION_FILE_CHARS) return COLLECTION_NOT;
  if (name[0] != COLLECTION_PREFIX) return COLLECTION_NOT;
  for (uint8_t i = 0; i < HASH_BYTES * 2; i++) {
    if (!collectionHexDigit(name[1 + i])) return COLLECTION_NOT;
  }
  return strcmp(name + 1 + HASH_BYTES * 2, COLLECTION_SUFFIX) == 0
      ? COLLECTION_NAMED : COLLECTION_NOT;
}

// --- What a collection is called ---------------------------------------------

/**
 * The name a collection goes under in the menu: its first set's.
 *
 * **There is no name field, and that is a decision rather than an omission.**
 * The header is twelve bytes with nothing spare in it, so a name of its own
 * would be a longer header, a new LAYOUT_VERSION and a MAJOR of the whole
 * device interface - and it would hold the same string this does. A `.obz`
 * carries no name for a Sammlung; what it carries is the root board's name,
 * the root board is the first set, and the first set's name is already in the
 * file at a fixed offset. Spending a format break to copy it twelve bytes
 * earlier would buy nothing and cost every talker in a drawer.
 *
 * What it does mean, and it is worth a builder knowing: **the first set's name
 * is what a person reads in the menu.** adr/0021 is where that is argued.
 *
 * A file whose header this reader cannot make sense of is not named and is not
 * listed. That is deliberate and it is the same rule everywhere else here: a
 * collection the device could not read would be a name somebody can choose and
 * then a talker with nothing on it, which docs/device-interface.md section 6 is
 * a whole section about. A layout with no sets at all is refused for the same
 * reason - there is nothing behind it to show.
 *
 * The 44 bytes are read rather than the whole file, and that is what keeps the
 * cost of holding many collections a directory walk instead of a parse.
 */
static inline bool collectionHeadName(const uint8_t *head, uint32_t length,
                                      char *name) {
  if (length < COLLECTION_HEAD_BYTES) return false;
  if (memcmp(head, "MTRD", 4) != 0) return false;
  if (head[4] != LAYOUT_VERSION) return false;
  if (head[5] == 0) return false;                 // no sets: nothing to show
  if (head[6] != SLOT_COUNT) return false;
  memcpy(name, head + LAYOUT_HEADER_BYTES, NAME_BYTES);
  name[NAME_BYTES] = '\0';
  return true;
}

// --- A name on a key ---------------------------------------------------------

/** Room for one line of a name. MENU_MAX_CHARS glyphs, and a glyph is at most
 *  four bytes of UTF-8. */
#define MENU_LINE_BYTES (MENU_MAX_CHARS * 4 + 1)

/**
 * A collection's name broken over the two lines a key has.
 *
 * The space is the panel and not a preference: at text size 2 a glyph is
 * twelve pixels and the frame leaves 116, which is the MENU_MAX_CHARS of
 * texts.h - nine characters, twice. **About ten characters a line and two
 * lines is the whole of what a name has to be recognised in**, and a name
 * longer than that is cut rather than shrunk: a smaller font would fit more
 * and be unreadable across a room, which is the only distance this ever gets
 * looked at from.
 *
 * Broken at spaces, so that a name of two short words reads as two words
 * rather than with the break falling in the middle of the first one. A word
 * longer than a line on its own is cut across the break, because the
 * alternative is a key with nothing on it.
 *
 * Counted in glyphs through utf8Step(), which is the walk toPanelText() draws
 * with. Counting bytes would put every name with an umlaut in it a character
 * short of where it belongs.
 */
static inline void collectionMenuLines(const char *name, char *first,
                                       char *second) {
  first[0] = '\0';
  second[0] = '\0';
  if (!name) return;

  char *out = first;
  uint8_t glyphs = 0;      // on the line being filled
  uint8_t at = 0;          // bytes written to it
  uint8_t line = 0;

  const char *in = name;
  while (*in == ' ') in++;                       // a leading space is nothing

  while (*in) {
    // How long the word starting here is, in glyphs, and how many bytes that
    // is. Measured before anything is copied: whether a word goes on this line
    // or the next is a question about the whole word.
    uint8_t wordGlyphs = 0, wordBytes = 0;
    for (const char *walk = in; *walk && *walk != ' '; ) {
      uint8_t took = 0;
      utf8Step(walk, &took);
      walk += took;
      wordBytes += took;
      wordGlyphs++;
    }

    if (glyphs && glyphs + 1 + wordGlyphs > MENU_MAX_CHARS) {
      // It does not fit after what is already on this line. On to the next.
      out[at] = '\0';
      if (line == 1) return;                     // and there is no next
      line = 1;
      out = second;
      at = 0;
      glyphs = 0;
      continue;                                  // without eating the space
    }
    if (glyphs) {                                // the space between two words
      out[at++] = ' ';
      glyphs++;
    }

    // The word itself, glyph by glyph, so that a word too long for a line is
    // cut where a glyph ends rather than inside one.
    //
    // Nothing bounds `at` beyond this, and nothing needs to: a name is
    // NAME_BYTES long at most, so a line of it is at most NAME_BYTES bytes
    // where MENU_LINE_BYTES is 37.
    while (wordBytes && glyphs < MENU_MAX_CHARS) {
      uint8_t took = 0;
      utf8Step(in, &took);
      memcpy(out + at, in, took);
      at += took;
      in += took;
      wordBytes -= took;
      glyphs++;
    }
    out[at] = '\0';
    if (wordBytes) {
      // What is left of a word that did not fit. It goes on the next line, and
      // where there is no next line it is dropped.
      if (line == 1) return;
      line = 1;
      out = second;
      at = 0;
      glyphs = 0;
      continue;
    }
    while (*in == ' ') in++;
  }
  out[at] = '\0';
}

// --- The list, and which one is showing --------------------------------------

/** One collection, as the device holds it while it is not the one being
 *  shown: a name to draw and a file to open. Not a Layout - that is the whole
 *  economy of this, and it is why the count costs 71 bytes each rather than
 *  the 13580 a parsed layout does. */
struct Collection {
  char file[COLLECTION_FILE_CHARS + 1];
  char name[NAME_BYTES + 1];
};

/** Why a file offered to the list was not taken into it. */
enum CollectionTaken {
  COLLECTION_TAKEN = 0,
  COLLECTION_NOT_ONE,       // the name is not a collection's
  COLLECTION_UNREADABLE,    // it is, and the header is not one this build reads
  COLLECTION_NO_ROOM,       // MAX_COLLECTIONS already
};

struct Collections {
  Collection at[MAX_COLLECTIONS];
  uint8_t count;
  /** Which one is showing, as an index into `at`. Meaningless where the count
   *  is zero, and zero there rather than left over from before. */
  uint8_t active;
  /** How many collection files were found and not taken - unreadable, or past
   *  MAX_COLLECTIONS. Kept so that the device can say so rather than a name
   *  simply not being there. */
  uint8_t refused;
};

static inline void collectionsClear(Collections &into) {
  into.count = 0;
  into.active = 0;
  into.refused = 0;
}

/** Where two collections sit relative to one another in the menu.
 *
 * By the name a person reads, and by the file name where two collections are
 * called the same thing. Bytewise rather than by any language's alphabet: what
 * this has to be is the SAME order every time the device starts, because a
 * menu whose entries move between one morning and the next is a menu nobody
 * can learn. A file system promises no order of its own - the cable's own
 * `list` is marked any_order for exactly that reason - so the order is made
 * here or it is an accident.
 */
static inline int collectionOrder(const Collection &a, const Collection &b) {
  const int byName = strcmp(a.name, b.name);
  return byName ? byName : strcmp(a.file, b.file);
}

/**
 * One file out of the directory, offered to the list.
 *
 * Inserted where it belongs rather than appended and sorted afterwards. There
 * are at most sixteen of them and the walk hands them over one at a time, so
 * an insertion is the whole of the sorting and there is no second pass to get
 * wrong.
 */
static inline CollectionTaken collectionsOffer(Collections &into,
                                               const char *file,
                                               const uint8_t *head,
                                               uint32_t length) {
  if (collectionKind(file) == COLLECTION_NOT) return COLLECTION_NOT_ONE;
  Collection one;
  if (!collectionHeadName(head, length, one.name)) {
    into.refused++;
    return COLLECTION_UNREADABLE;
  }
  if (into.count >= MAX_COLLECTIONS) {
    into.refused++;
    return COLLECTION_NO_ROOM;
  }
  // Refused rather than truncated, the same way cableWord() refuses: half a
  // name is a different file, and it would be opened without a word of
  // complaint. Nothing can reach this - collectionKind() has already measured
  // the name - and it is here so that the buffer below is safe by inspection.
  if (strlen(file) > COLLECTION_FILE_CHARS) return COLLECTION_NOT_ONE;
  strcpy(one.file, file);

  uint8_t place = into.count;
  while (place > 0 && collectionOrder(one, into.at[place - 1]) < 0) {
    into.at[place] = into.at[place - 1];
    place--;
  }
  into.at[place] = one;
  into.count++;
  return COLLECTION_TAKEN;
}

/** Where a file sits in the list, or -1. */
static inline int8_t collectionsFind(const Collections &of, const char *file) {
  if (!file || !*file) return -1;
  for (uint8_t i = 0; i < of.count; i++) {
    if (strcmp(of.at[i].file, file) == 0) return (int8_t)i;
  }
  return -1;
}

/** What choosing came to. */
enum CollectionChoice {
  COLLECTION_NOTHING = 0,   // there are none, and the device has no content
  COLLECTION_ASKED,         // the one that was asked for
  COLLECTION_FELL_BACK,     // it is not there any more, so the first instead
};

/**
 * Which collection the device shows, given the one it was told to.
 *
 * **The one that was asked for can be gone**, and that is the ordinary case
 * rather than a corruption: removing a collection from the loader page is one
 * press, and the name in NVS survives it. A device that answered that with a
 * black screen would be a device somebody broke by tidying up. So the fallback
 * is the first in the order - a real collection, chosen the same way every
 * time - and the device says on the serial port that it fell back.
 *
 * Falling back does NOT write the new choice anywhere. What is in NVS is what
 * a person last chose, and a collection that came back - restored from the
 * editor, or sent again - should be showing again without their having to ask
 * for it twice.
 */
static inline CollectionChoice collectionsChoose(Collections &of,
                                                 const char *wanted) {
  of.active = 0;
  if (of.count == 0) return COLLECTION_NOTHING;
  const int8_t at = collectionsFind(of, wanted);
  if (at < 0) return COLLECTION_FELL_BACK;
  of.active = (uint8_t)at;
  return COLLECTION_ASKED;
}

// --- The menu's own arithmetic -----------------------------------------------

/** How many names fit on one screen of the collection menu.
 *
 * Four keys, and four names where four is all there is. Past that the fourth
 * key has to become the way to the rest, so a screen holds three - which is
 * the whole of the paging and the reason it is arithmetic here rather than
 * four conditions in the drawing code. */
#define COLLECTION_KEYS 4

static inline uint8_t collectionsPerPage(uint8_t count) {
  return count > COLLECTION_KEYS ? COLLECTION_KEYS - 1 : COLLECTION_KEYS;
}

static inline uint8_t collectionsPages(uint8_t count) {
  const uint8_t per = collectionsPerPage(count);
  return count == 0 ? 1 : (uint8_t)((count + per - 1) / per);
}

/** Which collection key `key` on page `page` shows, or -1 for a dark key. */
static inline int8_t collectionsOnPage(uint8_t count, uint8_t page,
                                       uint8_t key) {
  const uint8_t per = collectionsPerPage(count);
  if (key >= per) return -1;                       // the paging key, or beyond
  const uint16_t at = (uint16_t)page * per + key;
  return at < count ? (int8_t)at : -1;
}

/** Whether the fourth key is the way to the next page rather than a name. */
static inline bool collectionsPaging(uint8_t count) {
  return count > COLLECTION_KEYS;
}
