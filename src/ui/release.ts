// The one button, and everything behind it.
//
// It used to be an onclick in app.ts, and it was four lines: save, build, put
// the log on the screen. The build is still those four lines; what has grown
// around them is the half that was missing - the files reaching the talker -
// and it brought a port, a progress line and a way to stop with it. That is
// more than a page-wiring file should hold, so it is here.
//
// This press never opens a dialog. It builds, and then sends to whatever the
// person has already granted - which getPorts() answers with no gesture at
// all. Choosing a port is a button of its own in the settings, for the reason
// ui/device.ts sets out: a picker here would have to come before the build,
// and then dismissing it costs a build nobody asked for.
import { $, status } from "./dom.js";
import { reason } from "../core/errors.js";
import { t } from "../core/texts.js";
import { markReleaseState, saveNow } from "../core/save.js";
import { runBuild, cableSupported, sendToDevice, type Plan } from "../backend/index.js";
import { devices, haveDevice, watchForDevices } from "./device.js";
import { Trouble } from "../core/errors.js";

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

export function wireRelease(): void {
  const button = $<HTMLButtonElement>("releaseBtn");
  const stop = $<HTMLButtonElement>("releaseStop");

  watchForDevices();

  stop.onclick = () => stopper?.abort();

  button.onclick = async () => {
    // Releasing what is on screen, not what the last debounce happened to
    // catch: saveNow() writes and cancels the pending one, otherwise it fires
    // afterwards and writes the same thing a second time.
    await saveNow();
    button.disabled = true;
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
