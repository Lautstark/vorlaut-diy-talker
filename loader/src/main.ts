// The page somebody opens with a talker in front of them.
//
// Choose a file, check it, compile it, connect, send - in that order, saying
// what it found at each step. adr/0011 is why this page exists at all; what
// follows is why it is shaped the way it is.
//
// ## Five steps down a page, and not a dialog
//
// The editor put the whole transfer in one sheet, and that was right there:
// the press came from a button in the work head, beside the Sammlung's name,
// and everything after it was a modal job over a page that was doing something
// else. Here there is nothing else. The flow *is* the page, so it is a column
// of five steps that are all visible from the start - a reader can see how far
// there is to go before choosing a file, and the log at the end has a whole
// page to stay on rather than a sheet somebody has to remember not to close.
//
// ## Nothing leaves this machine, and the page says so before it is asked
//
// The file is read with the File API and compiled here. exchange/SPEC.md §5.2
// permits a METACOM licensee to bake their own symbols into a package for the
// person they support and sideload it, which is exactly what a device package
// is; a page that uploaded one anywhere would turn that blessed case into the
// travelling file the rule exists to prevent. adr/0002 says the same thing
// about this product generally. So: no fetch, no form, no analytics, and the
// note is above the first step rather than in a footer, because it answers a
// question somebody has while they are deciding whether to pick a file.
//
// ## The order is forced, and by the same fact it always was
//
// requestPort() needs transient activation and Chrome expires it in about five
// seconds. That is why connecting is a step of its own with a button of its
// own, rather than something the send press does on the way past: a chooser
// opened from a press that had already spent seconds compiling would never
// open at all. The editor learned this twice and wrote it down at length in
// what used to be src/editor-diy/release.ts; the rule survives the move, and
// what it costs here is nothing, because a compile that has already happened
// is not paid for twice.
//
// What it saves is the whole of that file's longest note. There, a dead port
// cost a full build - minutes of synthesis - because the build had to come
// first and the port could only be discovered afterwards. Here the compile is
// seconds and needs no network at all, so a wrong port costs a second press.
import "@lautstark/design/tokens/vorlaut.css";
import "@lautstark/design/components.css";
import "./style.css";

import { initTheme } from "@lautstark/design/theme";
import { LANG, t } from "../../src/core/boot.js";
import { Trouble, reason } from "../../src/core/errors.js";
import {
  readDevicePackage, type ReadDevicePackage,
} from "../../src/data/device_package.js";
import { browserHost } from "./browser_host.js";
import { type Build, cableSupported, sendToDevice, type Plan } from "./cable.js";
import { compileDevice } from "./compile.js";
import { connectDevice, devices, haveDevice, watchForDevices } from "./device.js";
import { chooseBuildFolder, folderExportSupported, writeBuildTo } from "./folder.js";
import { readPackageFile } from "./read.js";
import { NotAPackage } from "./unzip.js";
import { check, summarise, type Finding } from "./validate.js";

initTheme("vorlaut.theme");
document.documentElement.lang = LANG;
document.title = t("load.title");

const KIB = (bytes: number) => Math.round(bytes / 1024);

/* --------------------------------------------------------------- a step --- */

/** One of the five, and everything that can be written into one.
 *
 * A tiny class rather than a template module, because there is one shape and
 * five instances of it. The editor's templates/ exist because its markup is
 * large and belongs beside the modules that wire it; four methods do not need
 * that arrangement and would only make this flow readable in two files.
 */
class Step {
  readonly root = document.createElement("section");
  private readonly body = document.createElement("div");

  constructor(titleKey: string) {
    this.root.className = "step";
    this.root.dataset.state = "waiting";
    const heading = document.createElement("h2");
    heading.textContent = t(titleKey);
    this.body.className = "body";
    this.root.append(heading, this.body);
  }

  /** Wipes whatever this step was saying and marks it live. Every step redraws
   *  itself whole rather than appending, so that a second file dropped on the
   *  page cannot leave a line from the first one standing. */
  begin(): void {
    this.root.dataset.state = "doing";
    this.body.replaceChildren();
  }

  waiting(): void {
    this.root.dataset.state = "waiting";
    this.body.replaceChildren();
  }

  done(): void { this.root.dataset.state = "done"; }

  say(text: string, className = ""): HTMLParagraphElement {
    const line = document.createElement("p");
    line.className = className;
    line.textContent = text;
    this.body.append(line);
    return line;
  }

  /** The findings, as a list rather than as paragraphs.
   *
   * A list because it is one, and because "3 items" is what a screen reader
   * says on the way in - which is the count somebody wants before they read
   * any of them. The marker is text in the item rather than a ::before, for
   * the same reason: it has to reach a reader who is not looking at colour. */
  findings(all: Finding[]): void {
    if (!all.length) return;
    const list = document.createElement("ul");
    for (const one of all) {
      const item = document.createElement("li");
      item.className = one.refuses ? "refuses" : "notes";
      item.textContent = `${one.refuses ? "✖" : "•"} ${one.says}`;
      list.append(item);
    }
    this.body.append(list);
  }

  button(label: string, run: () => void, className = "btn"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.onclick = run;
    return button;
  }

  row(...items: HTMLElement[]): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "row";
    row.append(...items);
    this.body.append(row);
    return row;
  }

  /** A live region for the running commentary, and a log under it.
   *
   * Two elements rather than one: the log is minutes of lines and must not be
   * read out as it grows, while the one line above it is the thing somebody
   * standing back from the screen needs announced. Same division the editor's
   * transfer sheet arrived at. */
  logging(): { now: (line: string) => void; add: (line: string) => void } {
    const doing = document.createElement("p");
    doing.className = "doing";
    doing.setAttribute("role", "status");
    const log = document.createElement("pre");
    log.className = "log";
    this.body.append(doing, log);
    const lines: string[] = [];
    return {
      now: (line) => { doing.textContent = line; },
      add: (line) => {
        lines.push(line);
        log.textContent = lines.join("\n");
        // Whatever is happening is happening at the bottom.
        log.scrollTop = log.scrollHeight;
      },
    };
  }
}

/* ---------------------------------------------------------------- page --- */

const steps = {
  file: new Step("load.step_file"),
  check: new Step("load.step_check"),
  compile: new Step("load.step_compile"),
  connect: new Step("load.step_connect"),
  send: new Step("load.step_send"),
};

const page = document.createElement("main");
const heading = document.createElement("h1");
heading.textContent = t("load.title");
const lead = document.createElement("p");
lead.className = "lead";
lead.textContent = t("load.lead");
const here = document.createElement("p");
here.className = "here";
here.textContent = t("load.here");
page.append(heading, lead, here, ...Object.values(steps).map((one) => one.root));
document.body.append(page);

/* What the file turned out to be, kept because the steps after the compile
 * need it and because pressing Send twice must not re-read the file. Null
 * until a file has been through the checks, which is also the guard on every
 * later step: nothing here is reachable without one, because the button that
 * would reach it has not been drawn. */
let build: Build | null = null;

/* ------------------------------------------------------------ choosing --- */

const picker = document.createElement("input");
picker.type = "file";
// .obz first because that is what the editor writes; .zip beside it because
// Chrome on Android goes by the media type for an unregistered extension, and
// somebody who has re-saved the file may well have it under the other name.
picker.accept = ".obz,.zip,application/zip";
picker.setAttribute("aria-label", t("load.pick"));

steps.file.begin();
steps.file.say(t("load.pick_hint"));
steps.file.row(
  picker,
  steps.file.button(t("load.pick"), () => picker.click(), "btn primary"),
);

picker.onchange = () => {
  const file = picker.files?.[0];
  if (file) void chose(file);
};

/** A file, from the moment it is chosen to the moment it is compiled.
 *
 * The three steps run one after another with no press in between, and that is
 * deliberate: checking and compiling are fast, need no permission and change
 * nothing anywhere, so making somebody press twice to find out whether their
 * file is any good would be ceremony. The first press that decides anything is
 * the one that opens the port chooser, and the second is Send.
 */
async function chose(file: File): Promise<void> {
  build = null;
  for (const step of [steps.check, steps.compile, steps.connect, steps.send]) {
    step.waiting();
  }

  steps.file.begin();
  steps.file.say(t("load.pick_hint"));
  steps.file.say(t("load.reading", { name: file.name }));
  steps.file.row(
    picker,
    steps.file.button(t("load.again"), () => picker.click()),
  );

  let read: ReadDevicePackage;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    steps.file.begin();
    steps.file.say(t("load.file_is", { name: file.name, size: KIB(bytes.length) }));
    steps.file.row(picker, steps.file.button(t("load.again"), () => picker.click()));
    steps.file.done();

    // Two readers, two kinds of complaint, and both are shown as the check
    // rather than as a crash. readPackageFile() answers for the archive - is
    // this a zip, is there a manifest, do the boards parse - and
    // readDevicePackage() answers for what is in it: the ring, a picture named
    // and not there, a WAV that is not the device's, a name layout.bin cannot
    // carry. Every one of those is already a sentence.
    read = readDevicePackage(await readPackageFile(bytes));
  } catch (error) {
    steps.check.begin();
    steps.check.findings([{
      refuses: true,
      says: error instanceof NotAPackage
        ? t("load.not_a_package", { name: file.name, why: error.message })
        : reason(error),
    }]);
    steps.check.say(t("load.refused"));
    return;
  }

  const findings = checked(read);
  if (findings.some((one) => one.refuses)) return;
  await compile(read, findings);
}

/** Step two: what is in the file, and what the device will make of it. */
function checked(read: ReadDevicePackage): Finding[] {
  const held = summarise(read);
  const findings = check(read);

  steps.check.begin();
  steps.check.say(t("load.holds", {
    sets: held.sets, filled: held.filled, keys: held.keys,
    pictures: held.pictures, sounds: held.sounds,
  }));
  if (held.language) steps.check.say(t("load.holds_language", { code: held.language }));
  steps.check.say(held.voice
    ? t("load.holds_voice", { voice: held.voice })
    : t("load.holds_no_voice"));
  steps.check.findings(findings);
  if (findings.some((one) => one.refuses)) {
    steps.check.say(t("load.refused"));
  } else if (!findings.length) {
    steps.check.say(t("load.nothing_wrong"));
  }
  steps.check.done();
  return findings;
}

/** Step three: the tiles, the WAVs and layout.bin - exactly the files a talker
 *  holds, which is what tests/unit/device_roundtrip.test.ts holds this to. */
async function compile(read: ReadDevicePackage, findings: Finding[]): Promise<void> {
  steps.compile.begin();
  steps.compile.say(t("load.compiling"));

  const host = browserHost(read.sources);
  let made: Build;
  try {
    made = await compileDevice(read, host);
  } catch (error) {
    steps.compile.findings([{ refuses: true, says: t("load.compile_failed", {
      error: reason(error),
    }) }]);
    return;
  }

  build = made;
  const bytes = [...made.values()].reduce((total, one) => total + one.length, 0);
  steps.compile.begin();
  steps.compile.say(t("load.compiled", { files: made.size, size: KIB(bytes) }));
  /* The one finding that cannot be made before this point. Everything
   * validate.ts asks is a question about the plan; whether a picture actually
   * decodes is a question only a browser answers, and the compiler's answer to
   * "it did not" is the grey cross - which is right, and silent. So the host
   * kept a list and it is shown here, beside the earlier notes rather than
   * instead of them. */
  const undecodable = host.undecodable.map((symbol) => ({
    refuses: false, says: t("load.wont_decode", { symbol }),
  }));
  steps.compile.findings([...undecodable, ...findings.filter((one) => !one.refuses)]);
  steps.compile.done();

  offerFolder();
  connectStep();
}

/* ---------------------------------------------------------- the folder --- */

/** The other way in, and it is not a fallback.
 *
 * mklittlefs turns a directory into a file system image and esptool writes it
 * straight into the partition, which is the path that works when the cable
 * protocol itself is wrong - and tools/serialcheck.html can push a folder at a
 * device independently of this page. That is the only thing standing between a
 * cable that turns out to be broken on hardware and no way in at all, so it
 * keeps its place here rather than becoming something somebody has to know to
 * look for. loader/src/folder.ts has the rest of the argument.
 *
 * Nothing at all where the browser has no directory picker - Safari, Firefox,
 * anything on Android. A button that opens a picker that does not exist is
 * worse than an absent one.
 */
function offerFolder(): void {
  if (!folderExportSupported()) return;
  steps.compile.say(t("load.folder_lead"));
  const button = steps.compile.button(t("load.folder"), () => void intoFolder(button));
  steps.compile.row(button);
}

async function intoFolder(button: HTMLButtonElement): Promise<void> {
  if (!build) return;
  button.disabled = true;
  try {
    // The picker first and from this click: showDirectoryPicker() needs the
    // activation, and it expires in about five seconds.
    const folder = await chooseBuildFolder();
    if (!folder) return;
    const done = await writeBuildTo(folder, build);
    steps.compile.say(t("load.folder_written", {
      folder: done.folder, written: done.written, removed: done.removed,
      size: KIB(done.bytes),
    }));
  } catch (error) {
    steps.compile.say(t("load.folder_failed", { error: reason(error) }), "refuses");
  } finally {
    button.disabled = false;
  }
}

/* --------------------------------------------------------- the talker --- */

/* Set when nothing on the wire answered as a talker, so that the next attempt
 * offers the chooser again. Without it a page holding one useless port would
 * keep trying that one for ever - the same flag the editor's transfer sheet
 * carried, and it is here for the same reason and under the same name. */
let askAgain = false;

/** A granted port, in the only words the browser has for one.
 *
 * WebSerial hands over a vendor and a product id and nothing else - no name,
 * no path, no serial number. It is still worth showing: it is the difference
 * between "some port" and "the same port as last time", which is the question
 * somebody looking at this step is actually asking. */
function portName(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId === undefined && info.usbProductId === undefined) {
    return t("load.port_plain");
  }
  const hex = (value: number | undefined) => (value ?? 0).toString(16).padStart(4, "0");
  return t("load.port", {
    vendor: hex(info.usbVendorId), product: hex(info.usbProductId),
  });
}

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
function connectStep({ andSend = true } = {}): void {
  steps.connect.begin();
  if (!cableSupported()) {
    // Not a refusal of the file: everything up to here worked, and the folder
    // above is a real way in. So it is said as a note and the send step simply
    // never opens.
    steps.connect.findings([{ refuses: false, says: t("cable.no_serial") }]);
    steps.connect.done();
    return;
  }

  const granted = devices();
  if (!haveDevice() || askAgain) {
    steps.connect.say(t("load.connect_lead"));
    const button = steps.connect.button(t("load.connect"), () => void grant(button),
                                        "btn primary");
    steps.connect.row(button);
    return;
  }

  steps.connect.say(granted.length > 1
    ? t("load.ports", { n: granted.length })
    : portName(granted[0]!));
  steps.connect.row(
    steps.connect.button(t("load.connect"), () => void grant()),
  );
  steps.connect.done();
  if (andSend) sendStep();
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
    if (await connectDevice()) askAgain = false;
  } finally {
    connectStep();
  }
}

/* ------------------------------------------------------------- sending --- */

function sendStep(): void {
  steps.send.begin();
  steps.send.say(t("load.send_lead"));
  const go = steps.send.button(t("load.send"), () => void send(go), "btn primary");
  steps.send.row(go);
}

async function send(go: HTMLButtonElement): Promise<void> {
  if (!build) return;
  go.disabled = true;
  steps.send.begin();
  const { now, add } = steps.send.logging();

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
    const sent = await sendToDevice(devices(), build, {
      signal: stopper.signal,
      // The device's own serial output. Indented, because it is the device
      // talking and not this page, and it is the most useful thing on the wire
      // when something has gone wrong.
      onLog: (line) => add(`  ${line}`),
      onPlan: (work: Plan) => {
        cleared = work.tight;
        add(t("cable.plan", {
          put: work.put, remove: work.remove, keep: work.keep,
          size: KIB(work.needed),
        }));
        if (work.tight) add(t("cable.tight"));
        if (!work.put && !work.remove) add(t("cable.nothing"));
      },
      onStep: (what, name, done, total) => {
        now(t(what === "put" ? "cable.sending" : "cable.removing",
              { done, total, name }));
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
      if (error.word === "cable_no_device") askAgain = true;
      add(t(`err.${error.word}`, {
        size: KIB(error.facts.needed || 0), free: KIB(error.facts.free || 0),
      }));
    } else {
      add(t("cable.failed", { error: reason(error) }));
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
    go.disabled = false;
  }
}

/* Asked on load, and again whenever a cable is plugged in or pulled out - so a
 * page opened before the talker was does not need reloading. It costs nothing
 * and no gesture, and knowing the answer before the press is the whole reason
 * one press is enough later. */
watchForDevices();
