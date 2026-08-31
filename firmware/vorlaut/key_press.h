// What a press does - the half of layout.bin version 3 that is not a byte.
//
// layout_format.h reads `does` and `target` out of the file and says what they
// MEAN, in layoutKeySpeaks() and layoutKeyGoesTo(). Nothing acted on the second
// of those: vorlaut.ino played a word and switched sets by arithmetic, and
// layoutKeyGoesTo() was called by no one but a test. This is where the meaning
// becomes behaviour.
//
// Beside vorlaut.ino rather than in it, and for the reason TILE_W and TILE_H
// were moved out of it: a number in a .ino is a number no test can include.
// Everything here is Arduino-free, so tests/device_host.cpp compiles the same
// decisions the device makes and device/fixtures/ holds them - layout/ for the
// walk through a chained layout, press.expected.json for the timings and the
// order.
//
// What the device is for is a joining game: a round is a set, the set key
// shows a tile split diagonally into two word halves and says them, and one of
// the four keys below it carries the word those halves make. There is no game
// in here and there must not be - no round counter, no notion of an answer
// being right. The right key is simply the only key on the board that goes
// anywhere.

#pragma once
#include "layout_format.h"

// --- Which key -------------------------------------------------------------

/** Where the set key sits among a set's KEY_COUNT keys.
 *
 * The fifth, after the four speech keys, which is the order layoutReadKey()
 * fills them in and the order the panels are wired in - SET_BUTTON in pins.h.
 * vorlaut.ino asserts the two are the same number; here it is the index into
 * the file's own structure, and nothing in this header knows about a pin. */
#define SET_KEY_INDEX SLOT_COUNT

// --- How long a key has to be held -----------------------------------------

static const uint32_t DEBOUNCE_MS = 80;    // this long a key has to stay down
// The set key needs longer. An accidental switch takes away the word she was
// about to say, and she first has to find her way back - that is more annoying
// than hitting the wrong word.
static const uint32_t SET_HOLD_MS = 400;

/** How long this key has to be held before it triggers. */
static inline uint32_t keyHoldMs(uint8_t index) {
  return index == SET_KEY_INDEX ? SET_HOLD_MS : DEBOUNCE_MS;
}

// --- What one press comes to -------------------------------------------------

/** A press, resolved: which key it was, whether a word really comes out of it,
 *  and where the device is afterwards. */
struct KeyPress {
  /** The key that was pressed, or null where there is no such key - a set
   *  index past the last set, or a key index past the fifth. Neither is
   *  reachable from the five buttons on a device holding content, and both
   *  are what a walk driven from a file could ask for. */
  const Key *key;
  /** Whether a recording is really played.
   *
   *  Two things, and they are one answer because a silent key is a silent key
   *  either way: what `does` says, and whether the key carries a sound at all.
   *  A key whose `does` is "go" says nothing by instruction; a key with no
   *  audio hash says nothing because there is nothing to say. The fields
   *  themselves stay readable beside this - layoutKeySpeaks() and hasAudio -
   *  so a fixture can tell the two apart where it wants to. */
  bool plays;
  /** The set the device is on when the press is finished, or -1 to stay.
   *
   *  layoutKeyGoesTo(), which is the one thing this whole header exists to
   *  finally call. A key that goes nowhere and a key naming a set that is not
   *  there are the same answer: stay put. */
  int16_t goesTo;
};

/** What pressing key `index` on set `at` comes to. */
static inline KeyPress keyPress(const Layout &layout, uint8_t at,
                                uint8_t index) {
  KeyPress out = { nullptr, false, -1 };
  if (at >= layout.setCount || index >= KEY_COUNT) return out;
  const SetEntry &entry = layout.sets[at];
  out.key = index == SET_KEY_INDEX ? &entry.key : &entry.slots[index];
  out.plays = layoutKeySpeaks(out.key->does) && out.key->hasAudio;
  out.goesTo = layoutKeyGoesTo(out.key->does, out.key->target,
                               layout.setCount);
  return out;
}

// --- Going somewhere ---------------------------------------------------------

/**
 * The steps between a key that goes somewhere and the board it goes to, in
 * order.
 *
 * An enumeration the device walks rather than four statements in a row,
 * because the ORDER is the thing that goes wrong and prose about it in a .ino
 * is prose no test reads. vorlaut.ino runs `for (step = 0; step <
 * KEY_CHANGE_STEPS; step++)` over these, so moving one of them here moves what
 * the device does, and press.expected.json is where the order is written down
 * from outside.
 *
 * Why each of them:
 *
 *   CHANGE_PAUSE    A whole second after the word ends, not the 200 ms that
 *                   would be enough to look smooth. This is the moment a child
 *                   notices she was right, and it is the only part of the game
 *                   the device can give her - there is no cheer, no score and
 *                   no second panel. Spending a second on it is the point of
 *                   the second, not waste at the end of one.
 *   CHANGE_RELEASE  Her finger is still on the key. Drawing the next round
 *                   under it puts a different picture beneath a finger that
 *                   has not moved, and whatever she does next lands on
 *                   something she never chose.
 *   CHANGE_SHOW     The new set on the panels.
 *   CHANGE_DEAF     And then a stretch in which nothing is heard, so that a
 *                   finger bouncing back or a second press meant for the old
 *                   board does not answer the new one. Same worry as
 *                   SET_HOLD_MS above, from the other side: a board that
 *                   changed without being asked is worse than a word that did
 *                   not come.
 */
enum ChangeStep {
  CHANGE_PAUSE = 0,
  CHANGE_RELEASE,
  CHANGE_SHOW,
  CHANGE_DEAF,
};
#define KEY_CHANGE_STEPS 4

/** The step's name, for anything that has to say what it did. */
static inline const char *changeStepName(ChangeStep step) {
  switch (step) {
    case CHANGE_PAUSE: return "pause";
    case CHANGE_RELEASE: return "release";
    case CHANGE_SHOW: return "show";
    case CHANGE_DEAF: return "deaf";
  }
  return "unknown";
}

/** The pause between the end of the word and the next board.
 *
 * A second, deliberately, and see CHANGE_PAUSE for what the second is for. */
static const uint32_t KEY_WORD_PAUSE_MS = 1000;

/** How long the device hears nothing after the board has changed.
 *
 * SET_HOLD_MS rather than a number of its own. That constant is already this
 * repository's answer to "how much accidental switching is too much", and
 * saying it twice would be two answers to one question. */
static const uint32_t KEY_SETTLE_MS = SET_HOLD_MS;
