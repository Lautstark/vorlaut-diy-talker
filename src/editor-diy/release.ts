// The one button, and the dialog behind it.
//
// It used to be an onclick in app.ts, and it was four lines: save, build, put
// the log on the screen. The build is still those four lines; what has grown
// around them is the half that was missing - the files reaching the talker -
// and it brought a port, a progress line and a way to stop with it. That is
// more than a page-wiring file should hold, so it is here.
//
// ## Why the whole flow is one dialog
//
// The log used to render underneath the button, in the page, and the press
// went straight into a build with no chance to look at it first. Two things
// were wrong with that. Nobody was told what was about to be written before it
// was - a Sammlung, a number of sets, a number of keys, and which talker - and
// a page that grew a scrolling log under its work head was reporting a modal
// job in a place that is not modal. So the press opens a sheet, everything
// happens inside it, and it does not close between the steps: what is about
// to go, then the transfer with its log, then how it ended. It stays open
// after that until somebody dismisses it, because the log is the most useful
// thing there is when it went wrong and it must not vanish with the last line.
//
// conventions.md §3.3 keeps the *button* in the work head beside the name it
// acts on. Only what happens after the click is in here.
//
// ## The picker, and why the ordering is forced
//
// The first press asks which port the talker is, and every press after it goes
// straight through - getPorts() hands back a granted port with no gesture at
// all. requestPort() needs transient activation and Chrome expires it in about
// five seconds, so the dialog cannot come after a build.
//
// Which makes the dismissal the case to get right, and it was wrong once in
// each direction. It used to build anyway and then report that nothing was
// sent, so closing a dialog cost minutes of synthesis. Then the picker moved
// out of the press altogether, which fixed that by taking away the thing
// somebody had actually pressed the button for.
//
// The sheet settles it better than either. Chrome's chooser is opened by a
// button *in* the sheet, so that button's own click is the activation and no
// build is waiting behind it - and a dismissed chooser now leaves somebody
// standing on the first step rather than ending the press. Our own words come
// first, which is the only part of that chooser we can reach: the browser's
// own dialog cannot be styled and nothing here tries.
//
// Changing the port later is still in the settings, under Device.
import { openDialog, type OpenDialog } from "@lautstark/design/dialog";
import { $, status } from "../shell/dom.js";
import { reason, Trouble } from "../core/errors.js";
import { t } from "../core/texts.js";
import { state } from "../core/state.js";
import { isDiy } from "../core/types.js";
import type { DiyLayout } from "../core/types.js";
import { onBuildState, saveNow } from "../core/save.js";
import { runBuild, cableSupported, sendToDevice, type Plan } from "../backend/index.js";
import { connectDevice, devices, haveDevice, watchForDevices } from "./device.js";

/* Set when nothing on the wire answered as a talker. The next press asks for
 * the port again, which is the way back for somebody who chose the wrong one:
 * without it a page holding one useless port would keep trying that one and
 * never offer the chooser again. */
let askAgain = false;

/* Whether a build or a transfer is under way. The button is disabled from it
 * rather than from the sheet being open, and the two are not the same thing:
 * a build cannot be stopped, so dismissing the sheet mid-build leaves one
 * running with nowhere to report, and a second press would start a second. */
let busy = false;

/** Where a build says what it did.
 *
 * runBuild() answers with its whole log at once rather than streaming it, so
 * this replaces rather than appends - and the caller that has no log to show
 * passes nothing. */
type Told = (lines: string[]) => void;

/** Build what is on the screen, and say so while it happens.
 *
 * Two callers: the sheet below, and the folder export in the settings. The
 * second is why it is a function rather than a stretch of the press - the
 * export cannot write a build that is not there, and sending somebody back to
 * a button they have already pressed to fix that is not an answer. One build
 * path also means one place where the "release is due" mark is cleared.
 *
 * The log is the caller's now. It used to be written straight into a #log in
 * the page, which is the element that has moved into the sheet; the settings
 * sheet's export passes nothing, because its build log went to an element
 * behind an open sheet where nobody could read it anyway, and what that panel
 * reports is its own line.
 *
 * Throws when the build does, having already told the caller the reason. The
 * caller's own job is only to stop.
 */
export async function buildNow(told: Told = () => {}): Promise<void> {
  // Building what is on screen, not what the last debounce happened to catch:
  // saveNow() writes and cancels the pending one, otherwise it fires
  // afterwards and writes the same thing a second time.
  await saveNow();
  told([t("ui.running")]);
  status(t("ui.building"));
  try {
    const result = await runBuild();
    told(result.log.slice());
    markReleaseState("1");
    status(t("ui.built"));
  } catch (error) {
    told([t("ui.log_error", { error: reason(error) })]);
    status(t("ui.build_failed"));
    throw error;
  }
}

/** One element with a class and some text. Local and deliberately small - the
 *  sheet's contents are four kinds of node and none of them needs a
 *  templating layer. */
function make<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pressable(className: string, label: string, run: () => void): HTMLButtonElement {
  const button = make("button", className, label);
  button.type = "button";
  button.onclick = run;
  return button;
}

/** One row of the summary: what it is, and what it says. */
function row(list: HTMLElement, label: string, value: string): void {
  list.append(make("dt", "", label), make("dd", "", value));
}

/** A granted port, in the only words the browser has for one.
 *
 * WebSerial hands over a vendor and a product id and nothing else - there is
 * no name, no path and no serial number - so this is `USB 303a:1001` rather
 * than anything a person chose. It is still worth showing: it is the
 * difference between "some port" and "the same port as last time", which is
 * the question somebody looking at this step is actually asking.
 */
function portName(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId === undefined && info.usbProductId === undefined) {
    return t("ui.transfer_port_plain");
  }
  const hex = (value: number | undefined) => (value ?? 0).toString(16).padStart(4, "0");
  return t("ui.transfer_port", {
    vendor: hex(info.usbVendorId), product: hex(info.usbProductId),
  });
}

/** Which talker this is going to, in one line. */
function deviceLine(): string {
  if (!cableSupported()) return t("ui.transfer_no_serial");
  const granted = devices();
  if (granted.length === 0) return t("ui.device_none");
  // Several is not a problem to solve here: sendToDevice() opens each in turn
  // and keeps the one that answers as a talker, so a laptop with a dongle and
  // a printer granted still needs no chooser. Saying how many is honest about
  // why the first moments of a transfer are spent looking.
  if (granted.length > 1) return t("ui.transfer_ports", { n: granted.length });
  return portName(granted[0]!);
}

/** The sheet: what is about to be written, the transfer, and how it ended.
 *
 * One dialog for all three, whose body is rewritten in place - closing and
 * reopening between the steps would lose the log, and the log is the reason
 * the sheet stays open at the end.
 */
function openTransfer(button: HTMLButtonElement): void {
  /* Whether this sheet is still the one on screen. Every callback that writes
   * into it checks this first: a build cannot be aborted, so a sheet dismissed
   * while one is running is a set of detached elements that a still-live
   * promise would otherwise keep painting into. */
  let live = true;
  let lines: string[] = [];
  let stopper: AbortController | null = null;

  const log = make("pre", "log");
  /* The sheet's own live region. The page's status line is behind an
   * aria-modal dialog and inert to a screen reader while this is open, so the
   * running commentary has to be in here; what stays out there is the one word
   * the work head should be left showing afterwards. */
  const doing = make("p", "doing");
  doing.setAttribute("role", "status");

  const paint = () => {
    log.textContent = lines.join("\n");
    // Whatever is happening is happening at the bottom.
    log.scrollTop = log.scrollHeight;
  };
  const told: Told = (all) => { if (live) { lines = all.slice(); paint(); } };
  const say = (line: string) => { if (live) { lines.push(line); paint(); } };
  const now = (text: string) => { if (live) doing.textContent = text; };

  const cancel = pressable("btn", t("ui.cancel"), () => sheet.close());
  const connect = pressable("btn primary", t("ui.device_connect"), () => void grant());
  const go = pressable("btn primary", t("ui.transfer_go"), () => void run());
  const stop = pressable("btn quiet", t("ui.stop"), () => stopper?.abort());
  const done = pressable("btn primary", t("ui.close"), () => sheet.close());
  const buttons = [cancel, stop, connect, go, done];

  /** Which of the five the footer is offering. Everything else is hidden
   *  rather than removed: the footer is fixed when the sheet is built, and
   *  these are the same five elements throughout its life. */
  const offer = (...wanted: HTMLButtonElement[]) => {
    for (const one of buttons) one.hidden = !wanted.includes(one);
  };

  const sheet: OpenDialog = openDialog({
    title: t("ui.release"),
    // Never the word on a footer button beside it: two dismissals sharing an
    // accessible name is ambiguous to anyone navigating by it, and this footer
    // carries both "Cancel" and "Close".
    closeLabel: t("ui.transfer_close_sheet"),
    body: [],
    footer: buttons,
    onClose: () => {
      live = false;
      // Dismissing the sheet stops what it was showing. A transfer nobody can
      // watch should not carry on, and the abort path already says what it
      // cost - the page's own line is what is left holding that. A build is
      // the one thing this cannot stop; run() checks `live` afterwards and
      // sends nothing.
      stopper?.abort();
    },
  });

  /** Step one: what is about to be written, and to which talker. */
  function ask(): void {
    const needsPort = cableSupported() && (!haveDevice() || askAgain);

    const list = make("dl", "transfer");
    row(list, t("ui.collection"), collectionName());
    row(list, t("ui.transfer_sets_label"), setsLine());
    row(list, t("ui.transfer_keys_label"), keysLine());
    row(list, t("ui.device_section"), deviceLine());

    sheet.body.replaceChildren(
      make("p", "lead", t(needsPort ? "ui.transfer_connect_lead" : "ui.transfer_lead")),
      list,
    );
    // No port yet means no transfer to offer: what this button promises is
    // content on a talker, and there is nothing else it could be asked to do.
    // The chooser is a step rather than the end of the press, so closing it
    // leaves somebody here rather than back at the page with nothing said.
    offer(cancel, needsPort ? connect : go);
  }

  /** Chrome's chooser, from a click of ours, with our words already read. */
  async function grant(): Promise<void> {
    connect.disabled = true;
    try {
      // A dismissed chooser says nothing and changes nothing. Redrawn either
      // way: on a yes the device row now names a port, and on a no this step
      // is still the true one.
      if (await connectDevice()) askAgain = false;
    } finally {
      connect.disabled = false;
      if (live) ask();
    }
  }

  /** Step two, then step three. The sheet does not close in between. */
  async function run(): Promise<void> {
    busy = true;
    button.disabled = true;
    lines = [];
    sheet.body.replaceChildren(doing, log);
    offer();
    try {
      try {
        now(t("ui.building"));
        await buildNow(told);
      } catch {
        // buildNow() has already put the reason in the log. What it cannot
        // say from in there is which half of this failed, and a sheet whose
        // whole content is a raw error message does not say either.
        now(t("ui.build_failed"));
        return;
      }
      // Dismissed while it built. The build stands - it is written, and the
      // mark says so - and nothing goes down the wire for a sheet that is not
      // there to report it.
      if (!live) return;
      await send();
    } finally {
      busy = false;
      button.disabled = false;
      // The log stays, and so does the sheet. One button, and it is the way
      // out rather than another go: a second transfer is a second press of the
      // button in the work head, which is where the state that decides whether
      // one is due is drawn.
      if (live) { offer(done); done.focus(); }
    }
  }

  async function send(): Promise<void> {
    say("");
    if (!cableSupported()) return say(t("cable.no_serial"));
    if (!haveDevice()) return say(t("cable.no_device_chosen"));

    // What the plan turned out to be, kept because the message for a cancelled
    // transfer depends on it: stopping is free in the ordinary order and is not
    // free once the clearing has already happened.
    let cleared = false;

    stopper = new AbortController();
    offer(stop);
    now(t("cable.looking"));
    say(t("cable.looking"));
    try {
      const sent = await sendToDevice(devices(), {
        signal: stopper.signal,
        // The device's own serial output. Indented, because it is the device
        // talking and not this page, and it is the most useful thing on the
        // wire when something has gone wrong.
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
          now(t(what === "put" ? "cable.sending" : "cable.removing",
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
      now(t("cable.sent_short"));
      status(t("cable.sent_short"));
    } catch (error) {
      now(t("cable.failed_short"));
      status(t("cable.failed_short"));
      // Stopping is the one "failure" that is somebody's decision, and what it
      // costs depends on the order the plan chose: nothing at all in the
      // ordinary one, and a device with silent keys once the clearing has
      // already run. Saying which is not a nicety - it is the difference
      // between "try again whenever" and "finish this before she wants it".
      if ((error as Error)?.name === "AbortError") {
        say(t(cleared ? "cable.stopped_tight" : "cable.stopped"));
        now(t("cable.stopped_short"));
        status(t("cable.stopped_short"));
      } else if (error instanceof Trouble) {
        // Ask which port again next time: whatever is on the end of this one
        // did not answer as a talker.
        if (error.word === "cable_no_device") askAgain = true;
        say(t(`err.${error.word}`, {
          size: Math.round((error.facts.needed || 0) / 1024),
          free: Math.round((error.facts.free || 0) / 1024),
        }));
      } else {
        say(t("cable.failed", { error: reason(error) }));
      }
    } finally {
      stopper = null;
    }
  }

  ask();
}

/** Whatever is in the work head's name field, which is what somebody is
 *  looking at while they read this. Blank is a Sammlung nobody has named, and
 *  the sidebar calls that something rather than nothing. */
function collectionName(): string {
  const typed = $<HTMLInputElement>("collectionName").value.trim();
  return typed || t("ui.collection_unnamed");
}

/** The Sammlung on screen, which for this file is always the device's - the
 *  transfer button only exists while a DIY editor is installed. Same guarantee
 *  and same complaint as editor.ts's board(). */
function board(): DiyLayout {
  const held = state.layout;
  if (!isDiy(held)) throw new Error("the transfer was reached from a tablet Sammlung");
  return held;
}

function activeSets() {
  return board().sets.filter((set) => set.active !== false);
}

function setsLine(): string {
  return t("ui.transfer_sets", {
    active: activeSets().length, total: board().sets.length,
  });
}

/* Only the active sets: a switched-off set puts nothing in the build, so
 * counting its keys here would promise the device something it will not get.
 * "Has something on it" is the same test the build applies - a key with
 * neither a word nor a picture is a blank one. */
function keysLine(): string {
  const slots = activeSets().flatMap((set) => set.slots || []);
  const filled = slots.filter((slot) => slot.text.trim() || slot.symbol).length;
  return t("ui.transfer_keys", { n: filled, total: slots.length });
}

/* The button says for itself whether a build is due: highlighted while data/
 * does not match the layout, subdued otherwise, so nobody has to remember.
 *
 * This lived in core/save.ts and reached for #releaseBtn from there, which is
 * a shell module holding the id of an element only this editor mounts - see
 * the note above onBuildState(). It is the same two lines; what changed is
 * which half of the page they run in. */
function markReleaseState(flag: string | null): void {
  if (flag === null) return;
  const needed = flag !== "1";
  const button = $<HTMLButtonElement>("releaseBtn");
  button.classList.toggle("primary", needed);
  button.title = needed ? t("ui.release_needed") : t("ui.release_current");
}

/** Answers with the way to undo the one subscription this editor makes.
 *
 * Everything else it binds is an `onclick` on an element that goes when the
 * markup goes. The build mark is not: it is a listener held by core/save.ts,
 * which outlives every editor, and one left behind would keep reaching for a
 * #releaseBtn that is no longer in the page. */
export function wireRelease(): () => void {
  const button = $<HTMLButtonElement>("releaseBtn");

  // Told where the build stands, now and on every write. Subscribing calls
  // back at once with what is already known, so a Sammlung loaded before this
  // ran does not leave the button unmarked until the next save.
  const stop = onBuildState(markReleaseState);

  watchForDevices();

  button.onclick = () => {
    // Nothing awaits before the sheet is up: the press is a gesture, and the
    // step inside it that spends one is Chrome's chooser, which has a button
    // of its own.
    if (!busy) openTransfer(button);
  };

  return stop;
}
