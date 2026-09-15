// What the page holds between presses, and the five steps it holds it in.
//
// main.ts used to be one script of two thousand lines, and its `let`s at the
// top of each section were read by the sections below. The sections are their
// own modules now - flow, sending, collections, program, views - and this is
// the one thing they share: the facts that outlive a press, as fields on one
// object, and the two views a module may ask to be redrawn.
import type { Build, OnDevice, Talker, readCollections } from "./cable.js";
import { cableSupported } from "./cable.js";
import { haveDevice } from "./device.js";
import type { Carried } from "./firmware.js";
import { Step } from "./step.js";

/** What the device said when it was asked what it holds. */
export type Holding = Awaited<ReturnType<typeof readCollections>>;

export type View = "door" | "talker" | "send";

export const held = {
  /* What the file turned out to be, kept because the steps after the compile
   * need it and because pressing Send twice must not re-read the file. Null
   * until a file has been through the checks, which is also the guard on every
   * later step: nothing here is reachable without one, because the button that
   * would reach it has not been drawn. */
  build: null as Build | null,

  /* Set when nothing on the wire answered as a talker, so that the next attempt
   * offers the chooser again. Without it a page holding one useless port would
   * keep trying that one for ever - the same flag the editor's transfer sheet
   * carried, and it is here for the same reason and under the same name. */
  askAgain: false,

  /** Whether the recordings may travel compressed, as somebody answered it.
   *
   * Here rather than in the checkbox, because every step redraws itself whole -
   * a second file dropped on the page rebuilds this step, and an answer that
   * lived in the DOM would quietly become "no" again while still looking like
   * whatever it was. False to begin with: a talker exists to be understood, so
   * the form that loses nothing is what a transfer nobody thought about sends.
   */
  smallerRecordings: false,

  /** What the device said last time it was asked, or null for "not asked yet". */
  onDevice: null as Holding | null,

  /** The collection a press has offered to remove, waiting for the second press.
   *  Cleared by anything that redraws, which is what makes walking away from the
   *  question cost nothing. */
  removing: null as string | null,

  /** Whether a look is in flight, and what the last one came to. Both are read
   *  by the talker view, which is the only thing that draws either. */
  looking: false,
  lookFailed: null as string | null,
  /** What the talker printed while it was being asked. Shown under a failure
   *  and nowhere else: on the way to an answer it is noise, and on the way to a
   *  refusal it is the only thing that names which file and how far. */
  heard: [] as string[],

  /** What the deploy carries, once. Null until the manifest has been read, and
   *  null for ever on a deploy that has no image - see carriedFirmware(). */
  carried: null as Carried | null,

  /** The last thing the device said about itself, or null for "not asked yet".
   *  Kept because the offer under it depends on it and because a press that
   *  writes must not have to ask again - the port it would ask on is about to
   *  stop existing. */
  deviceSays: null as (Talker & { port: SerialPort }) | null,

  /** True once a probe has run and found nothing. Told apart from "not asked"
   *  because the two lead to opposite offers: a device that has not been asked
   *  gets a check button, and one that answered nothing gets the offer of a
   *  first flash. */
  nothingAnswered: false,

  /** Which of the three the page is showing. */
  view: "door" as View,
};

/** The one thing a collection row needs from the device's answer. */
export type { OnDevice };

export const steps = {
  file: new Step(1, "load.step_file"),
  check: new Step(2, "load.step_check", "load.step_check_ahead"),
  compile: new Step(3, "load.step_compile", "load.step_compile_ahead"),
  /* Not a number any more, and that is the whole of what the door changed.
     Connecting happens before a file is chosen now, so it is not a rung on the
     ladder - it is the thing that was already true when the ladder started.
     What is left here is the recovery surface: a talker that went to sleep
     mid-flow, or a browser that never had a port to grant. It joins the send
     view only when it has something to ask for. */
  connect: new Step(null, "load.step_connect"),
  send: new Step(4, "load.step_send", "load.step_send_ahead"),
};

/** Whether the connection wants a press before anything can cross the cable.
 *
 * Asked rather than remembered: a port can be revoked, a talker can be
 * unplugged, and askAgain is set by every failure that turned out to be
 * nothing on the other end. */
export function connectionWanting(): boolean {
  return !cableSupported() || !haveDevice() || held.askAgain;
}

/* The two views a module may ask to have redrawn. views.ts owns the drawing
 * and hands both in once at load through useViews(); everything else only
 * asks. A slot rather than an import, because views.ts imports every module
 * that would import it back, and a cycle that happens to work is one nobody
 * can reason about. */
const notWired = (): never => { throw new Error("the loader's views are not wired"); };
export const redraw = { talker: notWired as () => void, send: notWired as () => void };

/** Called once, by views.ts, when the module that draws is loaded. */
export function useViews(views: { talker: () => void; send: () => void }): void {
  redraw.talker = views.talker;
  redraw.send = views.send;
}
