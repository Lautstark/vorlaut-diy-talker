// What the talker cannot do, said before anything is sent.
//
// This is the job that did not exist while the editor was the only writer.
// The talker's constraints were implicit in the thing that made the file: the
// editor only ever offered two rows of three, only ever spoke at once, capped
// a Sammlung at five sets because boot_data.ts's LIMITS said so, and the build
// assumed all of it. A package arriving from somewhere else - another copy of
// the editor, a later version of it, somebody's script, a file edited by hand
// at a bench - has none of that behind it, so every assumption has to become a
// question.
//
// ## Two kinds of answer, and the difference is the whole design
//
// A **refusal** means the device would not read the file, or would read it
// wrong. Nothing is sent. docs/device-interface.md §6 is the section this
// comes out of: a key that says the wrong sentence is worse than one that says
// nothing, because it is said to somebody who believes it. A talker that
// refuses its own layout.bin is worse again - it shows nothing at all and
// there is no screen anywhere saying why.
//
// A **note** means the file will go and something in it will not survive the
// journey intact: a key that will be silent, a picture that will be a grey
// cross, a name that will be cut. Those are not errors. A Sammlung with no
// voice set is a normal Sammlung, and a package with one gap is worth sending.
// What they must not be is invisible, because every one of them looks like a
// broken device from the other side of the room.
//
// ## And they are sentences, not a stack trace
//
// Whoever reads this page has a talker in front of them and a child waiting
// for it. Every line below names the thing that is wrong, where it is, and
// what it will look like on the device. The words themselves are in the label
// table with everything else - see loader/README.md for why there is no second
// one.
import { t } from "../../src/core/boot.js";
import type { DevicePlan, ReadDevicePackage }
  from "../../src/data/device_package.js";
import { wavFormat, wavSeconds } from "../../src/data/device_package.js";
import {
  LANGUAGE_CODES, MAX_SETS, NAME_BYTES, SLEEP_MAX, SLEEP_MIN, SLOTS_PER_SET,
  layoutIdleSeconds,
} from "./layout_format.js";

/** How long a clip may run before it is worth mentioning.
 *
 * Not a device limit: the firmware plays whatever is in the data chunk and
 * has no opinion about how long that is. It is a fact about the *keys*.
 * playWav() blocks for the length of the word and pollButtons() only
 * remembers one press while it does, so for the whole of a clip the talker
 * answers nothing - vorlaut.ino says so in as many words, and says that
 * interrupting a word was tried on hardware and was worse.
 *
 * Ten seconds because that is well past any sentence a key on this device is
 * for, and far short of anything a normal export produces - a spoken key is
 * one or two seconds. So this fires on the thing it is meant to fire on:
 * somebody who has put a story on a key and will otherwise find out at the
 * table that the key has gone dead.
 */
export const LONG_CLIP_SECONDS = 10;

export interface Finding {
  /** Whether the file may go on. A refusal stops the flow; a note does not. */
  refuses: boolean;
  /** The line, already in the reader's language. */
  says: string;
}

/** What the file turned out to hold, for the line above the findings.
 *
 * Counted rather than described: somebody who exported the wrong Sammlung
 * recognises it here, before a transfer, which is the cheapest moment there
 * is to find out. */
export interface Summary {
  sets: number;
  /** Keys with a word or a picture on them, out of every key there is. */
  filled: number;
  keys: number;
  pictures: number;
  sounds: number;
  language: string;
  voice: string;
}

/** The set's name as it is said in a finding: "Page 2", or "Page 2 (Food)".
 *
 * Exported because the preview captions its boards with it (preview.ts), and a
 * second spelling of the same two sentences would drift: a reader looking at a
 * note about "Page 2 (Food)" and a picture captioned "Set 2" would have to
 * work out that they are the same set. */
export function setLabel(plan: DevicePlan, at: number): string {
  const name = plan.sets[at]!.name.trim();
  return name ? t("load.set_named", { n: at + 1, name }) : t("load.set", { n: at + 1 });
}

export function summarise(read: ReadDevicePackage): Summary {
  const { plan } = read;
  const slots = plan.sets.flatMap((set) => set.slots);
  return {
    sets: plan.sets.length,
    keys: slots.length,
    filled: slots.filter((slot) => !slot.empty).length,
    pictures: read.sources.size,
    sounds: read.sounds.size,
    language: plan.language,
    voice: plan.voice,
  };
}

/**
 * Everything worth saying about this package, refusals first.
 *
 * Refusals first because that is the order somebody reads in and because the
 * first line should be the one that decides whether there is anything else to
 * do. Within each kind the order is the file's own - set by set, key by key -
 * so that a reader can follow it with the Sammlung open beside them.
 *
 * Pure, and takes no host: everything here is a question about the plan and
 * the media that came with it. What a picture actually decodes to is not
 * knowable without a browser, so that one finding is made later, by the
 * compile step, and added to this list. See main.ts.
 */
export function check(read: ReadDevicePackage): Finding[] {
  const { plan } = read;
  const refusals: Finding[] = [];
  const notes: Finding[] = [];

  const refuse = (says: string) => refusals.push({ refuses: true, says });
  const note = (says: string) => notes.push({ refuses: false, says });

  /* The device reads its sets into an array of MAX_SETS and answers
   * LAYOUT_BAD_LENGTH for a file naming more - device/fixtures/layout/
   * sets-past-max.expected.json. renderLayoutBin() would happily write six,
   * because the count and the length are one refusal at the far end and it is
   * not this side's to make; so it is made here instead, once, before a
   * megabyte goes down a 115200-baud cable to a talker that will then show
   * nothing. */
  if (plan.sets.length > MAX_SETS) {
    refuse(t("load.too_many_sets", { sets: plan.sets.length, max: MAX_SETS }));
  }

  /* Two different answers about the same field, and the difference is what a
   * refusal is for.
   *
   * A value the header cannot carry at all is a refusal: renderLayoutBin()
   * throws a RangeError rather than writing a header the firmware would read as
   * something else, and a throw in the middle of a compile is a page saying
   * "RangeError" at somebody holding a cable.
   *
   * A value the header carries and the device will not honour is a note. The
   * firmware clamps - layoutIdleSeconds() in its own layout_format.h, with a
   * range this file reads out of the browser's half of the same pair - so the
   * file goes and the talker simply sleeps after a different length of time
   * from the one written. Saying which is the whole of what is owed: a talker
   * that goes to sleep after ten seconds when the file said two, and no screen
   * anywhere explaining it, is indistinguishable from a fault. */
  const sleep = plan.sleepTimeoutSeconds;
  if (!Number.isInteger(sleep) || sleep < 0 || sleep > 0xffffffff) {
    refuse(t("load.bad_sleep", { value: String(sleep) }));
  } else if (sleep !== 0 && (sleep < SLEEP_MIN || sleep > SLEEP_MAX)) {
    note(t("load.sleep_clamped", {
      value: sleep, used: layoutIdleSeconds(sleep), min: SLEEP_MIN, max: SLEEP_MAX,
    }));
  }

  /* Not a refusal: renderLayoutBin() writes the default index for a language
   * it has no number for, so the file is perfectly readable and merely
   * labelled in a language nobody chose. Worth a line because the symptom -
   * a German Sammlung whose device menu is in English - looks like a bug in
   * the device and is a missing row in a table. */
  if (plan.language && !Object.hasOwn(LANGUAGE_CODES, plan.language)) {
    note(t("load.unknown_language", { code: plan.language }));
  }

  for (const [at, set] of plan.sets.entries()) {
    const where = setLabel(plan, at);

    if (set.slots.length > SLOTS_PER_SET) {
      note(t("load.too_many_keys", {
        label: where, keys: set.slots.length, max: SLOTS_PER_SET,
      }));
    }
    // Bytes, not characters: renderLayoutBin() cuts the encoded name at
    // NAME_BYTES, so a name of umlauts is half as long as it looks and this
    // has to measure the same thing the writer cuts.
    const nameBytes = new TextEncoder().encode(set.name).length;
    if (nameBytes > NAME_BYTES) {
      note(t("load.name_cut", { label: where, bytes: nameBytes, max: NAME_BYTES }));
    }

    for (const [nth, slot] of set.slots.slice(0, SLOTS_PER_SET).entries()) {
      const key = nth + 1;
      // A reference with no bytes filed under it. readDevicePackage() has
      // already refused the case where a picture is *named* and missing; this
      // is the other one, which the export writes on purpose - a reference
      // that resolved to nothing when the file was made. The device draws the
      // grey cross for it, so the file is honest and the line says what will
      // be on the key.
      if (slot.symbol && !read.sources.has(slot.symbol)) {
        note(t("load.no_picture", { label: where, slot: key, symbol: slot.symbol }));
      }
      if (!slot.text) continue;

      const sound = read.sounds.get(slot.text);
      if (!sound) {
        note(t("load.silent_key", { label: where, slot: key, text: slot.text }));
        continue;
      }
      const format = wavFormat(sound.bytes);
      // isDeviceWav() is readDevicePackage()'s refusal and has already run, so
      // anything here is the device's own shape and the only open question is
      // how long it is.
      const seconds = format ? wavSeconds(format) : 0;
      if (seconds > LONG_CLIP_SECONDS) {
        note(t("load.long_clip", {
          label: where, slot: key, text: slot.text, seconds: seconds.toFixed(1),
        }));
      }
    }
  }

  return [...refusals, ...notes];
}
