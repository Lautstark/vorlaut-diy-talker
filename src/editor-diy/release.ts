// The one button, and everything behind it.
//
// It used to be an onclick in app.ts, and it was four lines: save, build, put
// the log on the screen. The build is still those four lines; what has grown
// around them is the half that was missing - the files reaching the talker -
// and it brought a port, a progress line and a way to stop with it. That is
// more than a page-wiring file should hold, so it is here.
//
// The first press asks which port the talker is, and every press after it goes
// straight through - getPorts() hands back a granted port with no gesture at
// all. That ordering is forced: requestPort() needs the transient activation
// this press is, and Chrome expires it in about five seconds, so the dialog
// cannot come after a build.
//
// Which makes the dismissal the case to get right, and it was wrong once in
// each direction. It used to build anyway and then report that nothing was
// sent, so closing a dialog cost minutes of synthesis. Then the picker moved
// out of the press altogether, which fixed that by taking away the thing
// somebody had actually pressed the button for. It is here, and dismissing it
// does nothing at all: no build, no log, nothing on the screen changed.
//
// Changing the port later is in the settings, under Device.
import { $, status } from "../shell/dom.js";
import { reason } from "../core/errors.js";
import { t } from "../core/texts.js";
import { markReleaseState, saveNow } from "../core/save.js";
import { runBuild, cableSupported, sendToDevice, type Plan } from "../backend/index.js";
import { connectDevice, devices, haveDevice, watchForDevices } from "./device.js";
import { Trouble } from "../core/errors.js";

/* Set when nothing on the wire answered as a talker. The next press asks for
 * the port again, which is the way back for somebody who chose the wrong one:
 * without it a page holding one useless port would keep trying that one and
 * never offer the dialog again. */
let askAgain = false;

let stopper: AbortController | null = null;
let lines: string[] = [];

function show(): void {
  $("log").textContent = lines.join("\n");
  // Whatever is happening is happening at the bottom.
  $("log").scrollTop = $("log").scrollHeight;
}

function say(line: string): void {
  lines.push(line);
  show();
}

/** Build what is on the screen, and say so while it happens.
 *
 * Two callers: this button, and the folder export in the settings. The second
 * is why it is a function rather than a stretch of the press - the export
 * cannot write a build that is not there, and sending somebody back to a
 * button they have already pressed to fix that is not an answer. One build
 * path also means one place where the log is written and one where the
 * "release is due" mark is cleared.
 *
 * Throws when the build does, having already written the reason where the
 * caller would have written it. The caller's own job is only to stop.
 */
export async function buildNow(): Promise<void> {
  // Building what is on screen, not what the last debounce happened to catch:
  // saveNow() writes and cancels the pending one, otherwise it fires
  // afterwards and writes the same thing a second time.
  await saveNow();
  lines = [];
  $("log").style.display = "block";
  $("log").textContent = t("ui.running");
  status(t("ui.building"));
  try {
    const result = await runBuild();
    lines = result.log.slice();
    show();
    markReleaseState("1");
    status(t("ui.built"));
  } catch (error) {
    $("log").textContent = t("ui.log_error", { error: reason(error) });
    status(t("ui.build_failed"));
    throw error;
  }
}

export function wireRelease(): void {
  const button = $<HTMLButtonElement>("releaseBtn");
  const stop = $<HTMLButtonElement>("releaseStop");

  watchForDevices();

  stop.onclick = () => stopper?.abort();

  button.onclick = async () => {
    // The port first, and before anything that can await for long. A dismissed
    // picker ends the press here: this button says it puts content on a
    // talker, and without one there is nothing for it to do that somebody
    // asked for. Building anyway is what it used to do, and it read as the
    // dialog having been ignored.
    if (cableSupported() && (!haveDevice() || askAgain)) {
      if (!await connectDevice()) return;
      askAgain = false;
    }

    button.disabled = true;
    try {
      await buildNow();
    } catch {
      // buildNow() has already put the reason on the screen.
      button.disabled = false;
      return;
    }

    // The build is what the button always did. This is the part that was
    // missing, and a failure in it leaves the build standing: the files are
    // made, they are just still here.
    try {
      await send(stop);
    } finally {
      button.disabled = false;
    }
  };
}

async function send(stop: HTMLButtonElement): Promise<void> {
  say("");
  if (!cableSupported()) return say(t("cable.no_serial"));
  if (!haveDevice()) return say(t("cable.no_device_chosen"));

  // What the plan turned out to be, kept because the message for a cancelled
  // transfer depends on it: stopping is free in the ordinary order and is not
  // free once the clearing has already happened.
  let cleared = false;

  stopper = new AbortController();
  stop.hidden = false;
  status(t("cable.looking"));
  say(t("cable.looking"));
  try {
    const sent = await sendToDevice(devices(), {
      signal: stopper.signal,
      // The device's own serial output. Indented, because it is the device
      // talking and not this page, and it is the most useful thing on the wire
      // when something has gone wrong.
      onLog: (line) => say(`  ${line}`),
      onPlan: (work: Plan) => {
        cleared = work.tight;
        say(t("cable.plan", {
          put: work.put, remove: work.remove, keep: work.keep,
          size: Math.round(work.needed / 1024),
        }));
        if (work.tight) say(t("cable.tight"));
        if (!work.put && !work.remove) say(t("cable.nothing"));
      },
      onStep: (what, name, done, total) => {
        status(t(what === "put" ? "cable.sending" : "cable.removing",
                 { done, total, name }));
      },
    });
    say(t("cable.sent", {
      stored: sent.stored, removed: sent.removed,
      size: Math.round(sent.bytes / 1024), keep: sent.keep,
    }));
    // The two numbers docs/cable.md has been waiting for. They are in the log
    // rather than folded away, because the table in that document is meant to
    // be filled in from a real run and this is where the run says them.
    say(t("cable.timings", { gap: sent.worstGap, stall: sent.worstStall }));
    status(t("cable.sent_short"));
  } catch (error) {
    status(t("cable.failed_short"));
    // Stopping is the one "failure" that is somebody's decision, and what it
    // costs depends on the order the plan chose: nothing at all in the
    // ordinary one, and a device with silent keys once the clearing has
    // already run. Saying which is not a nicety - it is the difference
    // between "try again whenever" and "finish this before she wants it".
    if ((error as Error)?.name === "AbortError") {
      say(t(cleared ? "cable.stopped_tight" : "cable.stopped"));
      status(t("cable.stopped_short"));
    } else if (error instanceof Trouble) {
      // Ask which port again next time: whatever is on the end of this one did
      // not answer as a talker.
      if (error.word === "cable_no_device") askAgain = true;
      say(t(`err.${error.word}`, {
        size: Math.round((error.facts.needed || 0) / 1024),
        free: Math.round((error.facts.free || 0) / 1024),
      }));
    } else {
      say(t("cable.failed", { error: reason(error) }));
    }
  } finally {
    stop.hidden = true;
    stopper = null;
  }
}
