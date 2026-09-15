// The file, from the moment it is chosen to the moment it is compiled: steps
// one to three, and the folder as the other way out of the third.
import { t } from "./boot.js";
import { reason } from "./errors.js";
import { readDevicePackage, type ReadDevicePackage } from "./device_package.js";
import { browserHost } from "./browser_host.js";
import { compileDevice, type DeviceBuild } from "./compile.js";
import { chooseBuildFolder, folderExportSupported, writeBuildTo } from "./folder.js";
import { previewBoards } from "./preview.js";
import { readPackageFile } from "./read.js";
import { NotAPackage } from "./unzip.js";
import { check, summarise, type Finding } from "./validate.js";
import { announce, bringIntoView, page } from "./page.js";
import { connectionWanting, held, redraw, steps } from "./state.js";
import { connectStep, sendStep } from "./sending.js";
import { KIB, languageName, voiceName } from "./words.js";

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

/** Step one drawn, and both ways of handing a file over wired. Once, at boot. */
export function startFlow(): void {
  offerPicker();
  acceptDrops();
  picker.onchange = () => {
    const file = picker.files?.[0];
    if (file) void chose(file);
  };
}

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

/** A file, from the moment it is chosen to the moment it is compiled.
 *
 * The three steps run one after another with no press in between, and that is
 * deliberate: checking and compiling are fast, need no permission and change
 * nothing anywhere, so making somebody press twice to find out whether their
 * file is any good would be ceremony. The first press that decides anything is
 * the one that opens the port chooser, and the second is Send.
 */
async function chose(file: File): Promise<void> {
  held.build = null;
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
  /* What the device's own menu will call this collection. It is read off the
     head of the file, in the first set's name slot, because there is no field
     of its own - adr/0021 decision 2 refused one, and collectionHeadName() in
     firmware/vorlaut/collections.h is the other end of it.

     **The same fallback compileDevice() uses, and it has to be.** What goes
     into that slot is the Sammlung's name where the package carries one and
     the first set's where it does not; a line here that read the plan alone
     would name one thing while the talker showed another, silently, for every
     package written since the name started travelling.

     Worth saying at all rather than leaving somebody to find it on the device,
     because this is the name they will be choosing between games by - and the
     way to change it is in the editor, before the file is written. */
  const first = read.packageName || read.plan.sets[0]?.name;
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

  held.build = made.files;
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
  /* The steps are attached first and filled second, because connectStep() ends
     by scrolling to whichever step somebody is now standing on, and a node
     that is not in the document yet cannot be scrolled to. */
  redraw.send();
  if (connectionWanting()) {
    connectStep({ andSend: false });
    bringIntoView(steps.connect);
  } else {
    sendStep();
    bringIntoView(steps.send);
  }
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
  if (!held.build) return;
  button.disabled = true;
  try {
    // The picker first and from this click: showDirectoryPicker() needs the
    // activation, and it expires in about five seconds.
    const folder = await chooseBuildFolder();
    if (!folder) return;
    const done = await writeBuildTo(folder, held.build);
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
