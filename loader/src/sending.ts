// The talker on the end of the cable, and the transfer: the connect step,
// which is the recovery surface, and step four.
import { t } from "./boot.js";
import { Trouble } from "./errors.js";
import { CABLE_AUDIO_FORM } from "../tools/cable.js";
import { cableSupported, costOnDevice, sendToDevice, type Plan } from "./cable.js";
import { connectDevice, devices, haveDevice } from "./device.js";
import { announce, bringIntoView } from "./page.js";
import { held, redraw, steps } from "./state.js";
import { KIB, portName, saying } from "./words.js";

/* --------------------------------------------------------- the talker --- */

/** Step four. Draws itself again after every answer, because what it should be
 *  offering is entirely a question of whether there is a port yet.
 *
 * `andSend` is what keeps a finished transfer on the screen. This step opens
 * the one below it when it finds a port, which is right on the way in and
 * wrong on the way back: send() redraws this step afterwards - a port that did
 * not answer has to offer the chooser again - and a cascade from there would
 * wipe the log that had just explained why. The log is the most useful thing
 * there is when something went wrong, and it must not vanish with the last
 * line. */
export function connectStep({ andSend = true } = {}): void {
  steps.connect.begin();
  if (!cableSupported()) {
    /* Not a refusal of the file: everything up to here worked. But it is not
     * a step that is waiting either - nothing is coming and there is nothing
     * to press - so both this and the one below it are marked blocked, which
     * is a dashed marker and no body. The gate at the top of the page has
     * already said why, before a file was ever chosen. */
    steps.connect.say(t("cable.no_serial"), "aside");
    steps.connect.chip(t("load.chip_blocked"));
    steps.connect.blocked();
    steps.send.blocked();
    return;
  }

  const granted = devices();
  if (!haveDevice() || held.askAgain) {
    steps.connect.say(t("load.connect_lead"));
    const button = steps.connect.button(t("load.connect"), () => void grant(button),
                                        "btn primary");
    steps.connect.row(button);
    bringIntoView(steps.connect);
    return;
  }

  steps.connect.say(granted.length > 1
    ? t("load.ports", { n: granted.length })
    : portName(granted[0]!));
  steps.connect.row(
    steps.connect.button(t("load.connect"), () => void grant()),
  );
  steps.connect.done();
  if (andSend) {
    sendStep();
    bringIntoView(steps.send);
  }
}

/** Chrome's chooser, from a click of ours, with our words already read.
 *
 * A dismissed chooser says nothing and changes nothing: it is somebody
 * deciding not to, which is not a failure and must not read as one. The step
 * is redrawn either way, because on a yes it now names a port and on a no it
 * is still the true step to be standing on.
 */
async function grant(button?: HTMLButtonElement): Promise<void> {
  if (button) button.disabled = true;
  try {
    if (await connectDevice()) held.askAgain = false;
  } finally {
    connectStep();
    /* The step may have just stopped being wanted, and a satisfied recovery
       surface should not stay on screen saying so. */
    if (held.view === "send") redraw.send();
  }
}

/* ------------------------------------------------------------- sending --- */

/** What a transfer would cost, in the words somebody deciding needs.
 *
 * Three numbers and not one, because "1230 KiB to send" does not say whether
 * that is most of a game or the last tile of it. What the collection comes to,
 * how much of it is already on the device, and what is left over afterwards -
 * and the device is the only end that can answer the middle one, which is why
 * this needs a session at all.
 *
 * One function because two callers say it: the button that asks before
 * anything is sent, and the transfer itself on its way past. Two copies of a
 * sentence is two chances for the numbers to be assembled differently. */
function costSaid(work: Plan): string[] {
  const said = [t("cable.cost", {
    total: KIB(work.total), already: KIB(work.already),
    needed: KIB(work.needed), free: KIB(work.freeAfter),
  })];
  said.push(work.room > 1
    ? t("cable.cost_collections", { on: work.collections, room: work.room })
    : t("cable.cost_one"));
  /* And the one line in here that is not a number: a name the device's menu
     would be showing twice once this has landed. It rides with the cost rather
     than standing on its own because it is wanted at the same moment and by
     the same person - somebody with a finger over Send, deciding - and because
     the only remedy is upstream of that press. Nothing is broken by two
     entries with one name, so this is prose and not a refusal; adr/0021 is
     where that is argued and sameNameOnDevice() in cable.ts is what finds it.

     Last, after the numbers, so that a step somebody is reading for the size
     still leads with the size. */
  if (work.sameName) said.push(t("cable.same_name", { name: work.sameName }));
  return said;
}

export function sendStep(): void {
  steps.send.begin();
  steps.send.say(t("load.send_lead"));
  /* Above the buttons rather than below them, because it changes what both of
     them do - Send and the quiet "what would this cost" both send or count the
     form this decides. A choice under the button it modifies is a choice
     somebody has already walked past. */
  steps.send.show(steps.send.choice(
    t("load.smaller"), t("load.smaller_lead"), held.smallerRecordings,
    (now) => { held.smallerRecordings = now; }));
  const go = steps.send.button(t("load.send"), () => void send(go), "btn primary");
  /* Asking first is a press of its own, and it is the quiet one. Nothing about
     the cost can be known without talking to the device - which files it
     already holds IS the answer - and asking is not free at the far end: the
     talker draws "cable" on all five displays for it. So it happens because
     somebody pressed a button, never on a timer, and pressing Send straight
     away says the same sentence on the way past rather than making this a
     step. */
  const ask = steps.send.button(t("load.cost"), () => void cost(ask), "btn quiet");
  steps.send.row(go, ask);
}

/** The sentence, without sending anything. */
async function cost(ask: HTMLButtonElement): Promise<void> {
  if (!held.build) return;
  ask.disabled = true;
  const line = steps.send.say(t("cable.looking"), "aside");
  try {
    const work = await costOnDevice(devices(), held.build, () => {}, held.smallerRecordings);
    line.textContent = costSaid(work).join(" ");
    announce(line.textContent);
  } catch (error) {
    if (error instanceof Trouble) {
      if (error.word === "cable_no_device") held.askAgain = true;
      line.textContent = t(`err.${error.word}`, {
        size: KIB(error.facts.needed || 0), free: KIB(error.facts.free || 0),
        on: error.facts.on || 0, room: error.facts.room || 0,
      });
      connectStep({ andSend: false });
      /* And back into the view. connectStep() fills the step; what decides
         whether it is on screen is the send view, because the step joins the
         send view only when the connection wants something - which is exactly
         what has just become true. Filling a detached node was a recovery path
         that worked and could not be seen. */
      if (held.view === "send") redraw.send();
    } else {
      line.textContent = saying(error);
    }
  } finally {
    ask.disabled = false;
  }
}

async function send(go: HTMLButtonElement): Promise<void> {
  if (!held.build) return;
  go.disabled = true;
  steps.send.begin();
  const { now, add, far } = steps.send.logging();

  const stopper = new AbortController();
  const stop = steps.send.button(t("load.stop"), () => stopper.abort(), "btn quiet");
  steps.send.row(stop);

  /* What the plan turned out to be, kept because the message for a stopped
   * transfer depends on it: stopping is free in the ordinary order and is not
   * free once the clearing has already happened. */
  let cleared = false;

  now(t("cable.looking"));
  add(t("cable.looking"));
  try {
    const sent = await sendToDevice(devices(), held.build, {
      signal: stopper.signal,
      smallerRecordings: held.smallerRecordings,
      // The device's own serial output. Indented, because it is the device
      // talking and not this page, and it is the most useful thing on the wire
      // when something has gone wrong.
      onLog: (line) => add(`  ${line}`),
      // Which talker this is, before anything is sent. In the log rather than
      // beside the step's heading, because it is a fact about this run that is
      // worth having above the failure when there is one - and because a
      // device that does not name its firmware is not a fault to be badged,
      // only one that was flashed before the line existed.
      onFound: (who) => {
        add(who.firmware
          ? t("cable.firmware", { version: who.firmware })
          : t("cable.firmware_unnamed"));
        /* Only when somebody asked for it, and then always - including when
           the answer is no. A ticked box that quietly does nothing is the
           failure this line exists to prevent: the transfer would be four
           times the size somebody was expecting, succeed, and say nothing
           about why. */
        if (held.smallerRecordings) {
          add(who.audio === CABLE_AUDIO_FORM
            ? t("cable.smaller") : t("cable.smaller_unheard"));
        }
      },
      onPlan: (work: Plan) => {
        cleared = work.tight;
        add(t("cable.plan", {
          put: work.put, remove: work.remove, keep: work.keep,
          size: KIB(work.needed),
        }));
        // And what it costs, in the same words the button above says it in -
        // said here too because a transfer somebody started without asking
        // first should still have the numbers above its outcome.
        for (const line of costSaid(work)) add(line);
        if (work.tight) add(t("cable.tight"));
        if (!work.put && !work.remove) add(t("cable.nothing"));
      },
      onStep: (what, name, done, total) => {
        now(t(what === "put" ? "cable.sending" : "cable.removing",
              { done, total, name }));
        far(done, total);
      },
    });
    add(t("cable.sent", {
      stored: sent.stored, removed: sent.removed,
      size: KIB(sent.bytes), keep: sent.keep,
    }));
    // The two numbers docs/cable.md keeps its table of. In the log rather than
    // folded away, because that table is meant to be filled in from a real run
    // and this is where the run says them.
    add(t("cable.timings", { gap: sent.worstGap, stall: sent.worstStall }));
    now(t("cable.sent_short"));
    far(1, 1);
    steps.send.done();
  } catch (error) {
    now(t("cable.failed_short"));
    if ((error as Error)?.name === "AbortError") {
      // Stopping is the one "failure" that is somebody's decision, and what it
      // costs depends on the order the plan chose: nothing at all in the
      // ordinary one, and a device with silent keys once the clearing has
      // already run. Saying which is the difference between "try again
      // whenever" and "finish this before she wants it".
      add(t(cleared ? "cable.stopped_tight" : "cable.stopped"));
      now(t("cable.stopped_short"));
    } else if (error instanceof Trouble) {
      // Ask which port again next time: whatever is on the end of this one did
      // not answer as a talker.
      if (error.word === "cable_no_device") held.askAgain = true;
      add(t(`err.${error.word}`, {
        size: KIB(error.facts.needed || 0), free: KIB(error.facts.free || 0),
        on: error.facts.on || 0, room: error.facts.room || 0,
        name: String(error.facts.name || ""),
      }));
    } else {
      add(saying(error));
    }
  } finally {
    stop.remove();
    // The log stays, and the way back is a button under it rather than a
    // redraw: a second attempt is a second press, and after a port that did
    // not answer it is the connect step above that has changed rather than
    // this one. Which is also why that redraw is told not to cascade back
    // down here - it would take the log with it.
    const again = steps.send.button(t("load.send"), () => void send(again), "btn primary");
    steps.send.row(again);
    connectStep({ andSend: false });
    /* And back into the view. connectStep() fills the step; what decides
       whether it is on screen is the send view, because the step joins the
       send view only when the connection wants something - which is exactly
       what has just become true. Filling a detached node was a recovery path
       that worked and could not be seen. */
    if (held.view === "send") redraw.send();
    go.disabled = false;
  }
}
