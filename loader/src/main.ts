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
import { LANG, says, t } from "./boot.js";
import { Trouble, reason } from "./errors.js";
import {
  readDevicePackage, type ReadDevicePackage,
} from "./device_package.js";
import { browserHost } from "./browser_host.js";
import {
  askForDevice, askTalker, type Build, cableSupported, costOnDevice,
  type OnDevice, readCollections, removeCollection, sendToDevice,
  type Plan, type Talker,
} from "./cable.js";
import { compileDevice, type DeviceBuild } from "./compile.js";
import { connectDevice, devices, haveDevice, watchForDevices } from "./device.js";
import {
  type Carried, carriedFirmware, firmwareBytes, firmwareVerdict,
} from "./firmware.js";
import { intoWriteMode, WRITE_MODE_MS, writeFirmware } from "./flash.js";
import { LANGUAGE_CODES } from "./layout_format.js";
import { chooseBuildFolder, folderExportSupported, writeBuildTo } from "./folder.js";
import { previewBoards } from "./preview.js";
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
 *
 * Six instances now, and the sixth has no number - the firmware section, which
 * adr/0017 added. It is not a step of the flow and must not read as one: a
 * person with a talker in front of them does the five, in order, every time,
 * and touches the firmware once ever. So it is the same object with the same
 * lines and buttons and log, drawn without the marker that says where in a
 * sequence something is.
 */
class Step {
  readonly root = document.createElement("section");
  private readonly body = document.createElement("div");
  private readonly mark = document.createElement("span");
  private readonly badge = document.createElement("span");

  constructor(private readonly n: number | null, titleKey: string) {
    this.root.className = n === null ? "step step--aside" : "step";
    this.root.dataset.state = "waiting";

    const head = document.createElement("div");
    head.className = "step__head";

    /* The number, in a marker of its own, so that the heading can be prose and
       so that a finished step can carry a check instead. aria-hidden on
       purpose: the sections are named by their headings and read in their own
       order, and an ordinal announced in front of each of five is noise. */
    this.mark.className = "step__mark";
    this.mark.textContent = n === null ? "" : String(n);
    this.mark.hidden = n === null;
    this.mark.setAttribute("aria-hidden", "true");

    const heading = document.createElement("h2");
    heading.id = `step-${n}`;
    heading.textContent = t(titleKey);
    /* Which turns five unnamed regions into five named ones. A <section> is a
       landmark only when it has a name, and landmark navigation is exactly how
       somebody gets back up to "Verbinden" from the bottom of a log. */
    this.root.setAttribute("aria-labelledby", heading.id);

    this.badge.className = "chip";
    this.badge.hidden = true;

    head.append(this.mark, heading, this.badge);
    this.body.className = "body";
    this.root.append(head, this.body);
  }

  /** What this step came to, beside its heading: a count of notes, a size, a
   *  refusal. The outcome of a step is what somebody scrolling past is looking
   *  for, and it was four sentences into the body. */
  chip(text: string | null, kind = ""): void {
    this.badge.hidden = !text;
    this.badge.textContent = text ?? "";
    this.badge.className = kind ? `chip chip--${kind}` : "chip";
  }

  /** Wipes whatever this step was saying and marks it live. Every step redraws
   *  itself whole rather than appending, so that a second file dropped on the
   *  page cannot leave a line from the first one standing. */
  begin(): void {
    this.root.dataset.state = "doing";
    this.mark.textContent = this.n === null ? "" : String(this.n);
    this.chip(null);
    this.body.replaceChildren();
  }

  waiting(): void {
    this.root.dataset.state = "waiting";
    this.mark.textContent = this.n === null ? "" : String(this.n);
    this.chip(null);
    this.body.replaceChildren();
  }

  /** Nothing to press, and nothing coming - which is not what waiting means
   *  and must not look like it. The state a step is left in when this browser
   *  cannot do it at all. */
  blocked(): void {
    this.root.dataset.state = "blocked";
    this.mark.textContent = this.n === null ? "" : String(this.n);
  }

  done(): void {
    this.root.dataset.state = "done";
    this.mark.textContent = this.n === null ? "" : "✓";
  }

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
    list.className = "findings";
    for (const one of all) {
      const item = document.createElement("li");
      item.className = one.refuses ? "finding--refuses" : "finding--note";
      /* The marker in an element of its own rather than in the same text run.
         It stays text, which is the half of the original decision that was
         right - what was wrong is that the browser drew its own disc in front
         of it, so every line on the page began with two bullets. */
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = one.refuses ? "✖" : "•";
      const words = document.createElement("span");
      words.textContent = one.says;
      item.append(mark, words);
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

  /** A control that has to read as a link rather than as a button, which is
   *  what components.css keeps .linklike for: "a button that has to read as a
   *  link, because it opens a dialog rather than navigating". Which is
   *  literally what its one caller does - showDirectoryPicker(). */
  link(label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linklike";
    button.textContent = label;
    button.onclick = run;
    return button;
  }

  /** Anything that is not a sentence, a list or a control. Two callers: the
   *  board picture, which is a block of its own and brings its own layout,
   *  and the line naming the file. */
  show(element: HTMLElement): void {
    this.body.append(element);
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
  logging(): {
    now: (line: string) => void;
    add: (line: string) => void;
    far: (done: number, total: number) => void;
  } {
    const doing = document.createElement("p");
    doing.className = "doing";
    doing.setAttribute("role", "status");
    /* How far along, under the line that says it in words. onStep is already
       handed done and total; what the bar adds is that they can be read from
       where somebody actually is, which is over the talker with a cable in
       their hand rather than in front of the screen. */
    const bar = document.createElement("div");
    bar.className = "bar";
    const far = document.createElement("span");
    far.style.width = "0%";
    bar.append(far);
    const log = document.createElement("pre");
    log.className = "log";
    this.body.append(doing, bar, log);
    const lines: string[] = [];
    return {
      now: (line) => { doing.textContent = line; },
      far: (done, total) => {
        far.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
      },
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
  file: new Step(1, "load.step_file"),
  check: new Step(2, "load.step_check"),
  compile: new Step(3, "load.step_compile"),
  connect: new Step(4, "load.step_connect"),
  send: new Step(5, "load.step_send"),
};

/** Whether this browser can reach the device at all, said above the first step
 *  rather than found out at the fourth.
 *
 * It was a note inside the connect step, which meant somebody on Firefox chose
 * a file, waited through a compile and only then read that the cable needs
 * Chrome - having spent the whole page to learn the one fact that decided
 * whether the page was any use to them. And the sentence it read was not true:
 * it offered the folder as what still works here, and the folder is
 * showDirectoryPicker(), which those browsers have not got either, so no
 * button was ever drawn under it.
 *
 * Not a refusal, and not styled as one. Checking a file and seeing the boards
 * is worth opening this page for on any browser, which is what it says. */
function gate(): HTMLElement {
  const box = document.createElement("div");
  box.className = "gate";
  const mark = document.createElement("span");
  mark.className = "gate__mark";
  mark.textContent = "!";
  mark.setAttribute("aria-hidden", "true");
  const words = document.createElement("div");
  for (const key of ["load.gate", "load.gate_more"]) {
    const line = document.createElement("p");
    line.textContent = t(key);
    words.append(line);
  }
  box.append(mark, words);
  return box;
}

/* What just happened, once, for somebody who is not looking at the screen.
 *
 * Every step redraws itself whole and says a great deal, and none of it was
 * announced: a reader who pressed the load.pick button heard nothing back
 * about a check that had just found three things and a compile that had run.
 * One polite line, set when a step settles. The transfer keeps its own live
 * region - that one is a running commentary and this one is an outcome, which
 * is the same division the send step already makes internally. */
const announcer = document.createElement("p");
announcer.className = "sr";
announcer.setAttribute("role", "status");

const announce = (line: string) => { announcer.textContent = line; };

const page = document.createElement("main");
const heading = document.createElement("h1");
heading.textContent = t("load.title");
const lead = document.createElement("p");
lead.className = "lead";
lead.textContent = t("load.lead");
const here = document.createElement("p");
here.className = "here";
here.textContent = t("load.here");
page.append(heading, lead, here);
if (!cableSupported()) page.append(gate());
page.append(announcer, ...Object.values(steps).map((one) => one.root));
document.body.append(page);

/** The step somebody is now meant to be standing on, brought to where they can
 *  see it.
 *
 * Choosing a file draws three steps and opens a fourth, all of them below the
 * fold on a laptop, and nothing moved: the next thing to press was off the
 * screen and unannounced. Not focus - taking that from under somebody's hands
 * is worse than a scroll - and `nearest`, so a step already in view stays
 * where it is. */
function bringIntoView(step: Step): void {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  step.root.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
}

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
/* Out of the tab order and out of the accessibility tree. It is a square of
 * one pixel behind a button that clicks it, and it carried an accessible name
 * of its own - so a keyboard reader's first Tab landed on something invisible,
 * and a screen reader announced load.pick twice, once for each. The button
 * beside it is the control; this is the mechanism. */
picker.tabIndex = -1;
picker.setAttribute("aria-hidden", "true");

/** Step one, before a file: the hint, and the two ways to hand one over. */
function offerPicker(): void {
  steps.file.begin();
  steps.file.say(t("load.pick_hint"));

  /* A target as well as a button. The .obz has just been written by the editor
     and is sitting in a folder somebody has open in front of them; dragging it
     here is the gesture they already have in their hand. The picker stays for
     everybody who would rather not, and for every browser that would rather
     not either. */
  const zone = document.createElement("div");
  zone.className = "drop";
  const words = document.createElement("span");
  words.className = "drop__text";
  words.textContent = t("load.drop");
  zone.append(words,
              steps.file.button(t("load.pick"), () => picker.click(), "btn primary"),
              picker);
  steps.file.show(zone);
}

/** The file, dropped anywhere on the page.
 *
 * On the document rather than on the drop zone, for the reason every page that
 * does this ends up there: a drop the page does not take is a drop the browser
 * takes, and what the browser does with a .obz is navigate away from the page
 * somebody was halfway through. So the whole window refuses it, and the zone -
 * when there is one - lights up to say where it is going. */
function acceptDrops(): void {
  const zone = () => page.querySelector(".drop");
  const over = (on: boolean) => zone()?.classList.toggle("drop--over", on);
  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    over(true);
  });
  document.addEventListener("dragleave", () => over(false));
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    over(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void chose(file);
  });
}

offerPicker();
acceptDrops();

picker.onchange = () => {
  const file = picker.files?.[0];
  if (file) void chose(file);
};

/** The line naming the file, and the way back to the picker.
 *
 * `primary` is the way back promoted. A refusal leaves five steps on the
 * screen with exactly one thing left to do on them, and that one thing is four
 * steps above where the eye has got to - so the button that does it stops
 * being the quiet one. */
function chosenFile(name: string, size: number, { primary = false } = {}): void {
  steps.file.begin();

  const line = document.createElement("p");
  line.className = "file";
  const named = document.createElement("span");
  named.className = "file__name";
  named.textContent = name;
  const sized = document.createElement("span");
  sized.className = "file__size";
  sized.textContent = t("load.chip_size", { size });
  line.append(named, sized);
  steps.file.show(line);

  steps.file.say(t("load.pick_hint"), "aside");
  steps.file.row(picker, steps.file.button(t("load.again"), () => picker.click(),
                                           primary ? "btn primary" : "btn"));
  steps.file.done();
}

/** The device's own two languages, by name. LANGUAGE_CODES is the table that
 *  decides which ones the device can be labelled in at all, so it is also the
 *  one that decides which have a name to give - anything else is a code, and
 *  a code is what validate.ts is already complaining about on the next line. */
function languageName(code: string): string {
  return Object.hasOwn(LANGUAGE_CODES, code) && says(`lang.${code}`)
    ? t(`lang.${code}`)
    : code;
}

/** The voice, in the half of its name a person recognises.
 *
 * plan.voice is a model id - `piper:de_DE-thorsten-medium` - and printing it
 * whole put a line of machinery in the middle of four sentences a carer is
 * reading to decide whether this is the right file. The name is the second
 * field, and anything that is not shaped like one is left exactly as it came:
 * a voice from somewhere other than piper is still true, and a wrong guess at
 * a name would not be. */
function voiceName(voice: string): string {
  const model = voice.slice(voice.indexOf(":") + 1);
  const name = model.split("-")[1] ?? "";
  if (!/^[a-z]+$/i.test(name)) return voice;
  return name[0]!.toUpperCase() + name.slice(1);
}

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

  /* Kept for the refusal path below, which redraws this step to promote the
   * way out and has to name the same file at the same size. */
  let size = 0;
  let read: ReadDevicePackage;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    size = KIB(bytes.length);
    chosenFile(file.name, size);

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
    refused();
    chosenFile(file.name, size, { primary: true });
    return;
  }

  const findings = checked(read);
  if (findings.some((one) => one.refuses)) {
    chosenFile(file.name, size, { primary: true });
    return;
  }
  await compile(read, findings);
}

/** The sentence that decides whether there is anything else to do, and the
 *  step marked so that it can be seen from the top of the page. */
function refused(): void {
  steps.check.say(t("load.refused"), "refusal");
  steps.check.chip(t("load.chip_refuses", { n: 1 }), "refuses");
  steps.check.done();
  announce(t("load.refused"));
  bringIntoView(steps.check);
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
  /* What the device's own menu will call this collection. It is the first
     set's name, because a `.obz` carries no name for a Sammlung and the header
     has no field for one - see collectionHeadName() in
     firmware/vorlaut/collections.h, which is where that is argued. Worth
     saying here rather than leaving somebody to discover it on the talker:
     a first page called "Runde 1" makes a poor entry in a menu, and the way to
     fix it is in the editor, before the file is written. */
  const first = read.plan.sets[0]?.name;
  if (first) steps.check.say(t("load.holds_collection", { name: first }));
  if (held.language) {
    steps.check.say(t("load.holds_language", { name: languageName(held.language) }));
  }
  steps.check.say(held.voice
    ? t("load.holds_voice", { voice: voiceName(held.voice) })
    : t("load.holds_no_voice"));
  steps.check.findings(findings);

  const refusals = findings.filter((one) => one.refuses).length;
  if (refusals) {
    steps.check.say(t("load.refused"), "refusal");
    steps.check.chip(t("load.chip_refuses", { n: refusals }), "refuses");
    announce(t("load.refused"));
    bringIntoView(steps.check);
  } else if (!findings.length) {
    steps.check.say(t("load.nothing_wrong"));
    announce(t("load.nothing_wrong"));
  } else {
    steps.check.chip(t("load.chip_notes", { n: findings.length }));
    announce(t("load.chip_notes", { n: findings.length }));
  }
  steps.check.done();
  return findings;
}

/** Step three: the tiles, the WAVs and layout.bin - exactly the files a talker
 *  holds, which is what tests/unit/device_compile.test.ts holds this to. */
async function compile(read: ReadDevicePackage, findings: Finding[]): Promise<void> {
  steps.compile.begin();
  steps.compile.say(t("load.compiling"));

  const host = browserHost(read.sources);
  let made: DeviceBuild;
  try {
    made = await compileDevice(read, host);
  } catch (error) {
    steps.compile.findings([{ refuses: true, says: t("load.compile_failed", {
      error: reason(error),
    }) }]);
    return;
  }

  build = made.files;
  const bytes = [...made.files.values()].reduce((total, one) => total + one.length, 0);
  steps.compile.begin();
  steps.compile.say(t("load.compiled", { files: made.files.size, size: KIB(bytes) }));
  /* The one finding that cannot be made before this point. Everything
   * validate.ts asks is a question about the plan; whether a picture actually
   * decodes is a question only a browser answers, and the compiler's answer to
   * "it did not" is the grey cross - which is right, and silent. So the host
   * kept a list and it is shown here, beside the earlier notes rather than
   * instead of them. */
  const undecodable = host.undecodable.map((symbol) => ({
    refuses: false, says: t("load.wont_decode", { symbol }),
  }));
  steps.compile.findings(undecodable);
  /* And the earlier notes are *not* repeated. They were, in full, two inches
   * under the identical list in the step above - which reads as a second thing
   * having gone wrong rather than as the same three things still being true.
   * One line says they still are, and it is only said when there are any. */
  if (findings.some((one) => !one.refuses)) steps.compile.say(t("load.notes_stand"), "aside");
  /* And the picture, under the words about it. Here rather than in a step of
   * its own, because it is not something to do: the five steps are five acts
   * and a sixth that said "look at this" would renumber the two everybody
   * presses for something nobody has to press. It belongs to this step because
   * this is where the pixels are - the tiles it draws are the ones the compile
   * just made, and nothing here renders any of its own. adr/0013. */
  steps.compile.show(previewBoards(read, made));
  steps.compile.chip(t("load.chip_size", { size: KIB(bytes) }), "size");
  steps.compile.done();
  announce(t("load.compiled", { files: made.files.size, size: KIB(bytes) }));

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

  /* One sentence with the control inside it, at .linklike rather than as a
   * button of its own. It was a full-tier button under two lines of lead,
   * directly above the load.connect button and pulling against it - two calls
   * to action on a page whose whole argument is that the steps happen in an
   * order. What this is is a footnote to the compile.
   *
   * It stays on the page rather than going behind a disclosure, because the
   * paragraph above is right: this is what works when the cable protocol
   * itself is wrong, and a way in you have to know to look for is no use on
   * the day you need it.
   *
   * The sentence is one line in the table with an {action} in it, and it is
   * split here rather than being written as two labels. Where the words go
   * around a control is a question about a language, and boot_data.ts is where
   * the answers to those are. */
  const line = document.createElement("p");
  line.className = "footnote";
  const button = steps.compile.link(t("load.folder"), () => void intoFolder(button));
  const [before = "", after = ""] = t("load.folder_lead").split("{action}");
  line.append(before, button, after);
  steps.compile.show(line);
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
  if (!haveDevice() || askAgain) {
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
    if (await connectDevice()) askAgain = false;
  } finally {
    connectStep();
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
  return said;
}

function sendStep(): void {
  steps.send.begin();
  steps.send.say(t("load.send_lead"));
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
  if (!build) return;
  ask.disabled = true;
  const line = steps.send.say(t("cable.looking"), "aside");
  try {
    const work = await costOnDevice(devices(), build);
    line.textContent = costSaid(work).join(" ");
    announce(line.textContent);
  } catch (error) {
    if (error instanceof Trouble) {
      if (error.word === "cable_no_device") askAgain = true;
      line.textContent = t(`err.${error.word}`, {
        size: KIB(error.facts.needed || 0), free: KIB(error.facts.free || 0),
        on: error.facts.on || 0, room: error.facts.room || 0,
      });
      connectStep({ andSend: false });
    } else {
      line.textContent = t("cable.failed", { error: reason(error) });
    }
  } finally {
    ask.disabled = false;
  }
}

async function send(go: HTMLButtonElement): Promise<void> {
  if (!build) return;
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
    const sent = await sendToDevice(devices(), build, {
      signal: stopper.signal,
      // The device's own serial output. Indented, because it is the device
      // talking and not this page, and it is the most useful thing on the wire
      // when something has gone wrong.
      onLog: (line) => add(`  ${line}`),
      // Which talker this is, before anything is sent. In the log rather than
      // beside the step's heading, because it is a fact about this run that is
      // worth having above the failure when there is one - and because a
      // device that does not name its firmware is not a fault to be badged,
      // only one that was flashed before the line existed.
      onFound: (who) => add(who.firmware
        ? t("cable.firmware", { version: who.firmware })
        : t("cable.firmware_unnamed")),
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
      if (error.word === "cable_no_device") askAgain = true;
      add(t(`err.${error.word}`, {
        size: KIB(error.facts.needed || 0), free: KIB(error.facts.free || 0),
        on: error.facts.on || 0, room: error.facts.room || 0,
        name: String(error.facts.name || ""),
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

/* --------------------------------------------- what is already on it --- */
/*
 * The collections a talker is holding, and the one press that removes one.
 *
 * Set apart from the five, like the firmware section and for a related reason:
 * the five steps are what somebody does when there is a new board to send, and
 * this is what they do when the device is getting full or a game is finished
 * with. It needs no file, which is why it is drawn whether or not one has been
 * chosen.
 *
 * **Removing is here and not in the device's own menu**, and that is the whole
 * argument for the section existing. An irreversible action on five keys that a
 * child is holding has nowhere to put a "are you sure" - and nowhere to say
 * what it would cost either. Here there is room for both, and the press that
 * does it is a second press with a sentence between them, exactly as the
 * firmware section's writes are.
 */
const collections = new Step(null, "load.collections_title");

/** What the device said last time it was asked, or null for "not asked yet". */
let onDevice: Awaited<ReturnType<typeof readCollections>> | null = null;

/** The collection a press has offered to remove, waiting for the second press.
 *  Cleared by anything that redraws, which is what makes walking away from the
 *  question cost nothing. */
let removing: string | null = null;

function collectionsSection(): void {
  collections.begin();
  if (!cableSupported()) {
    collections.say(t("cable.no_serial"), "aside");
    collections.blocked();
    return;
  }
  if (!onDevice) {
    collections.say(t("load.collections_lead"), "aside");
    const button = collections.button(t("load.collections_check"),
                                      () => void look(button));
    collections.row(button);
    return;
  }

  const room = onDevice.talker.collections;
  collections.say(t("load.collections_room", {
    on: onDevice.on.length, room, free: KIB(onDevice.free),
  }));
  if (room <= 1) {
    /* A talker from before this existed. It holds one collection under one
       name, this page cannot read that name back out of it, and sending a
       second would be a file it never looks at. Saying so beats a list of one
       nameless row with no explanation over it. */
    collections.say(t("load.collections_older"));
  }
  if (!onDevice.on.length) collections.say(t("load.collections_none"));

  for (const one of onDevice.on) {
    const row = document.createElement("p");
    row.className = "file";
    const named = document.createElement("span");
    named.className = "file__name";
    /* The name the DEVICE shows, which is the first set's. A collection this
       page could not read has none, and then the file name is the only true
       thing there is to call it. */
    named.textContent = one.name || one.file;
    const sized = document.createElement("span");
    sized.className = "file__size";
    sized.textContent = t("load.chip_size", { size: KIB(one.size) });
    row.append(named, sized);
    collections.show(row);
    if (one.unreadable) {
      collections.say(t("load.collections_unreadable", { file: one.file }),
                      "aside");
      continue;
    }
    if (removing === one.file) {
      collections.say(t("load.collections_warning", {
        name: one.name || one.file, frees: KIB(one.frees),
      }), "refusal");
      const go = collections.button(t("load.collections_really"),
                                    () => void drop(one, go), "btn primary");
      collections.row(go, collections.button(t("load.collections_keep"), () => {
        removing = null;
        collectionsSection();
      }, "btn quiet"));
    } else {
      collections.row(collections.button(t("load.collections_remove"), () => {
        removing = one.file;
        collectionsSection();
      }));
    }
  }
  collections.row(collections.button(t("load.collections_check"),
                                     () => void look()));
}

async function look(button?: HTMLButtonElement): Promise<void> {
  if (button) button.disabled = true;
  removing = null;
  collections.begin();
  const line = collections.say(t("cable.looking"), "aside");
  try {
    /* From the click, before anything that awaits for long - the same rule the
       connect step is built around. A dismissed picker leaves the section
       exactly as it was. */
    if (!haveDevice()) {
      if (!await connectDevice()) { collectionsSection(); return; }
    }
    onDevice = await readCollections(devices());
  } catch (error) {
    onDevice = null;
    if (error instanceof Trouble && error.word === "cable_no_device") {
      askAgain = true;
    }
    line.textContent = error instanceof Trouble
      ? t(`err.${error.word}`, { name: String(error.facts.name || "") })
      : t("cable.failed", { error: reason(error) });
    return;
  } finally {
    if (button) button.disabled = false;
  }
  collectionsSection();
  announce(t("load.collections_room", {
    on: onDevice.on.length, room: onDevice.talker.collections,
    free: KIB(onDevice.free),
  }));
}

async function drop(one: OnDevice, go: HTMLButtonElement): Promise<void> {
  go.disabled = true;
  collections.begin();
  const { now, add, far } = collections.logging();
  now(t("cable.looking"));
  add(t("cable.looking"));
  try {
    const gone = await removeCollection(devices(), one.file, {
      onLog: (line) => add(`  ${line}`),
      onStep: (_what, name, done, total) => {
        now(t("cable.removing", { done, total, name }));
        far(done, total);
      },
    });
    add(t("load.collections_removed", {
      name: one.name || one.file, files: gone.removed, size: KIB(gone.freed),
    }));
    now(t("load.collections_removed_short"));
    far(1, 1);
    announce(t("load.collections_removed_short"));
    /* And the list again, from the device rather than from what this page
       thinks it just did. It is one more session and it is worth it: what the
       talker holds afterwards is the only thing worth showing, and a list
       edited in memory would be this page's opinion of it. */
    removing = null;
    onDevice = null;
    collections.row(collections.button(t("load.collections_check"),
                                       () => void look()));
  } catch (error) {
    add(error instanceof Trouble
      ? t(`err.${error.word}`, { name: String(error.facts.name || "") })
      : t("cable.failed", { error: reason(error) }));
    now(t("cable.failed_short"));
    removing = null;
    onDevice = null;
    collections.row(collections.button(t("load.collections_check"),
                                       () => void look()));
  }
}

/* ------------------------------------------------------------ firmware --- */

/* The program on the device, as opposed to the content on it - adr/0017.
 *
 * Set apart from the five and drawn last, because that is what it is: the five
 * steps are what somebody does every time there is a new board to send, and
 * this is what they do once, when a talker is new or when a release has
 * happened. It is also the only part of this page that fetches anything, and
 * the only part that can leave a device worse than it found it, which is why
 * every write here is two presses with a sentence between them.
 *
 * It is absent, not empty, when this deploy carries no image. No `v*` release
 * has ever been cut in this repository, so that is every deploy so far. */
const firmware = new Step(null, "load.firmware_title");

/** What the deploy carries, once. Null until the manifest has been read, and
 *  null for ever on a deploy that has no image - see carriedFirmware(). */
let carried: Carried | null = null;

/** The last thing the device said about itself, or null for "not asked yet".
 *  Kept because the offer under it depends on it and because a press that
 *  writes must not have to ask again - the port it would ask on is about to
 *  stop existing. */
let deviceSays: (Talker & { port: SerialPort }) | null = null;

/** True once a probe has run and found nothing. Told apart from "not asked"
 *  because the two lead to opposite offers: a device that has not been asked
 *  gets a check button, and one that answered nothing gets the offer of a
 *  first flash. */
let nothingAnswered = false;

/** Draws the section for whatever is known, and answers with what it said.
 *
 * The sentences come back rather than only going onto the screen, so that the
 * one line a probe announces is the outcome and not the whole section read
 * out. announcer is a polite live region: what belongs in it is "the device
 * carries v0.3, this page carries v0.4", and what does not is a heading, a
 * warning and two buttons. */
function firmwareSection(): string[] {
  const said: string[] = [];
  const say = (text: string, className = "") => {
    said.push(text);
    return firmware.say(text, className);
  };
  if (!carried) return said;
  firmware.waiting();
  say(t("flash.carries", { release: carried.release }));

  if (!deviceSays && !nothingAnswered) {
    say(t("flash.check_lead"), "aside");
    const button = firmware.button(t("flash.check"), () => void probe(button));
    firmware.row(button);
    return said;
  }

  if (nothingAnswered) {
    say(t("flash.nothing_answered"));
    offerWrite("whole");
    return said;
  }

  const word = deviceSays!.firmware;
  say(word
    ? t("flash.device_says", { version: word })
    : t("flash.device_unnamed"));

  /* An empty word is not a version, so it does not go through the comparison -
     it goes straight to the answer the comparison would have given it anyway,
     with a sentence of its own above. */
  const verdict = word ? firmwareVerdict(word, carried.release) : "unorderable";
  if (verdict === "same" || verdict === "device_newer") {
    say(t(verdict === "same" ? "flash.same" : "flash.newer"));
    firmware.row(firmware.button(t("flash.check"), () => void probe()));
    return said;
  }
  say(verdict === "device_older" ? t("flash.older", { release: carried.release })
      : word ? t("flash.unorderable", { device: word, release: carried.release })
      // A device that said nothing has no word to put in that sentence, and
      // filling the blank with an empty string produced one starting "and
      // v0.5 cannot be compared" on a real screen. Two sentences rather than
      // one with a hole in it.
      : t("flash.unnamed_unorderable", { release: carried.release }));
  offerWrite("program");
  return said;
}

/** Ask the talker who it is. One session, opened and closed, and no package
 *  anywhere near it. */
async function probe(button?: HTMLButtonElement): Promise<void> {
  if (button) button.disabled = true;
  firmware.begin();
  firmware.say(t("flash.carries", { release: carried!.release }));
  const said = firmware.say(t("flash.checking"), "aside");
  try {
    if (!haveDevice()) {
      /* From the click, before anything that awaits for long - the same rule
         the connect step is built around. A dismissed picker leaves the
         section exactly as it was. */
      if (!await connectDevice()) { firmwareSection(); return; }
    }
    deviceSays = await askTalker(devices());
    nothingAnswered = false;
  } catch (error) {
    deviceSays = null;
    if (error instanceof Trouble && error.word === "cable_no_device") {
      nothingAnswered = true;
    } else {
      said.textContent = error instanceof Trouble
        ? t(`err.${error.word}`, {})
        : t("flash.failed", { error: reason(error) });
      return;
    }
  }
  announce(firmwareSection().join(" "));
}

/** The instruction, and the button that spends the gesture.
 *
 * Two presses on purpose, and the sentence between them is the whole reason:
 * the board has to be in download mode before the port picker opens, because
 * entering download mode is what makes the old port disappear and a new one
 * appear. A single button would have to ask for a port that does not exist
 * yet. */
function offerWrite(which: "whole" | "program"): void {
  firmware.say(t(which === "whole" ? "flash.whole_warning"
                                   : "flash.program_warning"));
  /* Which sentence depends on whether there is a talker to reboot. One that
     answered can be put into write mode from here; one that answered nothing
     cannot be told anything at all, and then the buttons on the board are the
     only way in - which somebody with an assembled talker cannot reach, and
     the sentence says that too rather than sending them to look for them. */
  firmware.say(t(deviceSays ? "flash.write_mode_here" : "flash.download_mode"));
  const go = firmware.button(t("flash.choose_and_write"),
                             () => void write(which, go), "btn primary");
  firmware.row(go, firmware.button(t("flash.check"), () => void probe()));
}

async function write(which: "whole" | "program",
                     go: HTMLButtonElement): Promise<void> {
  go.disabled = true;
  /* Into the bootloader first, and from here rather than from somebody's
     fingers: BOOT and RESET are inside the case of an assembled talker. Only
     possible when a talker answered - that is the port it answered on - and
     failures are ignored, because a device that has already restarted is
     exactly where this was trying to put it.

     It costs under two seconds, which matters: what follows is the port
     picker, and a picker needs the activation from the press that is still
     running. Chrome allows about five. */
  if (deviceSays) {
    go.textContent = t("flash.switching");
    await intoWriteMode(deviceSays.port).catch(() => {});
    await new Promise((wait) => setTimeout(wait, WRITE_MODE_MS));
    go.textContent = t("flash.choose_and_write");
  }
  /* And the picker from that same click, before the fetch: transient
     activation is spent by the time an image has been downloaded, which is the
     lesson release.ts learned twice and cable.ts's header records. */
  const port = await askForDevice();
  if (!port) { go.disabled = false; return; }

  firmware.begin();
  firmware.say(t("flash.carries", { release: carried!.release }));
  const { now, add, far } = firmware.logging();
  now(t("flash.fetching"));
  add(t("flash.fetching"));
  try {
    const piece = carried![which];
    const bytes = await firmwareBytes(piece);
    add(t("flash.fetched", { size: KIB(bytes.length) }));
    await writeFirmware(port, [{ piece, bytes }], carried!, {
      onLog: (line) => add(`  ${line}`),
      onStep: (written, total) => {
        now(t("flash.writing", { done: KIB(written), total: KIB(total) }));
        far(written, total);
      },
    });
    add(t("flash.written"));
    now(t("flash.written_short"));
    far(1, 1);
    firmware.done();
    announce(t("flash.written_short"));
    /* What the device says about itself is the proof that the write took, and
       it is a press away rather than automatic: the talker has just rebooted,
       its port is a third handle nobody has granted yet, and asking for one
       without being asked to would open a dialog nobody pressed a button
       for. */
    deviceSays = null;
    nothingAnswered = false;
    firmware.row(firmware.button(t("flash.check"), () => void probe()));
  } catch (error) {
    now(t("flash.failed_short"));
    add(error instanceof Trouble
      ? t(`err.${error.word}`, {})
      : t("flash.failed", { error: reason(error) }));
    firmware.row(firmware.button(t("flash.choose_and_write"),
                                 () => void write(which, go), "btn primary"));
  }
}

/* Asked on load, and again whenever a cable is plugged in or pulled out - so a
 * page opened before the talker was does not need reloading. It costs nothing
 * and no gesture, and knowing the answer before the press is the whole reason
 * one press is enough later. */
watchForDevices();

/* And what this deploy carries, also on load and also without a gesture. A
 * manifest that says there is no image leaves the section unbuilt, which is
 * why it is appended here rather than with the five - a section that appears
 * when a fetch comes back is honest about a page that sometimes has one and
 * sometimes does not. */
/* The collections section is on the page from the start, and unlike the
 * firmware one it is drawn whether or not this browser can reach a cable: on
 * Firefox it says so, which is a truer page than one where a whole section is
 * silently missing. It comes before the firmware section because it is about
 * content, which is what the five steps above it are about. */
page.append(collections.root);
collectionsSection();

if (cableSupported()) {
  void carriedFirmware().then((found) => {
    if (!found) return;
    carried = found;
    page.append(firmware.root);
    firmwareSection();
  });
}
