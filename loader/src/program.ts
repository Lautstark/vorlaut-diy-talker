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
 * has ever been cut in this repository, so that is every deploy so far.
 */
import { t } from "./boot.js";
import { Trouble, reason } from "./errors.js";
import { askForDevice, askTalker } from "./cable.js";
import { connectDevice, devices, haveDevice } from "./device.js";
import { firmwareBytes, firmwareVerdict } from "./firmware.js";
import { intoWriteMode, WRITE_MODE_MS, writeFirmware } from "./flash.js";
import { announce } from "./page.js";
import { held } from "./state.js";
import { Step } from "./step.js";
import { KIB } from "./words.js";

export const firmware = new Step(null, "load.firmware_title");

/** Draws the section for whatever is known, and answers with what it said.
 *
 * The sentences come back rather than only going onto the screen, so that the
 * one line a probe announces is the outcome and not the whole section read
 * out. announcer is a polite live region: what belongs in it is "the device
 * carries v0.3, this page carries v0.4", and what does not is a heading, a
 * warning and two buttons. */
/** The two builds, as a pair rather than as two sentences.
 *
 * `dev -> v0.11` says what the talker has, what the page has, and that there
 * is a difference, before a word of prose is read. It replaces the two lines
 * that used to open this section - flash.carries and flash.device_says - which
 * said the same thing at four times the length and put the sentence that
 * mattered third.
 *
 * The arrow only where the two are ordered. Where they are not - a build
 * somebody compiled themselves, which carries no number - the pair is still
 * worth showing and the claim that one follows the other is not. */
function fwPair(theirs: string | null, ours: string, behind: boolean): HTMLElement {
  const panel = document.createElement("div");
  panel.className = behind ? "fw fw--behind" : "fw";

  const label = document.createElement("span");
  label.className = "fw__label";
  label.textContent = t("talker.fact_firmware");

  const now = document.createElement("b");
  now.className = "fw__now";
  now.textContent = theirs || "-";
  panel.append(label, now);

  if (theirs !== ours) {
    const to = document.createElement("span");
    to.className = "fw__to";
    /* An arrow claims an order. Two dots claim only that there are two. */
    to.textContent = behind ? "→" : "··";
    to.setAttribute("aria-hidden", "true");
    const next = document.createElement("b");
    next.className = "fw__next";
    next.textContent = ours;
    panel.append(to, next);
  }
  return panel;
}

export function firmwareSection(): string[] {
  const said: string[] = [];
  const say = (text: string, className = "") => {
    said.push(text);
    return firmware.say(text, className);
  };
  const carried = held.carried;
  if (!carried) return said;
  firmware.waiting();

  /* Nothing has been asked yet. Rare now that arriving at the talker asks, and
     still reachable: a look that failed for a reason other than silence leaves
     the device unnamed. */
  if (!held.deviceSays && !held.nothingAnswered) {
    firmware.show(fwPair(null, carried.release, false));
    say(t("flash.carries", { release: carried.release }), "aside");
    say(t("flash.check_lead"), "aside");
    const button = firmware.button(t("flash.check"), () => void probe(button));
    firmware.row(button);
    return said;
  }

  if (held.nothingAnswered) {
    firmware.show(fwPair(null, carried.release, false));
    say(t("flash.nothing_answered"));
    offerWrite("whole", t("flash.write_to", { release: carried.release }));
    return said;
  }

  const word = held.deviceSays!.firmware;
  /* An empty word is not a version, so it does not go through the comparison -
     it goes straight to the answer the comparison would have given it anyway. */
  const verdict = word ? firmwareVerdict(word, carried.release) : "unorderable";
  firmware.show(fwPair(word || null, carried.release,
                       verdict === "device_older"));

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
  offerWrite("program", verdict === "device_older"
    ? t("flash.update_to", { release: carried.release })
    : t("flash.write_to", { release: carried.release }));
  return said;
}

/** Ask the talker who it is. One session, opened and closed, and no package
 *  anywhere near it. */
async function probe(button?: HTMLButtonElement): Promise<void> {
  if (button) button.disabled = true;
  firmware.begin();
  firmware.say(t("flash.carries", { release: held.carried!.release }));
  const said = firmware.say(t("flash.checking"), "aside");
  try {
    if (!haveDevice()) {
      /* From the click, before anything that awaits for long - the same rule
         the connect step is built around. A dismissed picker leaves the
         section exactly as it was. */
      if (!await connectDevice()) { firmwareSection(); return; }
    }
    held.deviceSays = await askTalker(devices());
    held.nothingAnswered = false;
  } catch (error) {
    held.deviceSays = null;
    if (error instanceof Trouble && error.word === "cable_no_device") {
      held.nothingAnswered = true;
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
/**
 * The offer, and then the warning, and then the write.
 *
 * **Still two presses with a sentence between them** - which is the rule this
 * section has always been built around - but the sentence is now behind the
 * first press instead of in front of it. Four paragraphs about partition
 * tables and write mode were the first thing anybody read about their talker,
 * every time, including the many times they were only looking. They belong to
 * the person who has said they want to write, and that is who now sees them.
 *
 * The offer removes itself rather than sitting above its own consequence: two
 * buttons that both write, one of them a step further along, is a way to press
 * the wrong one.
 */
function offerWrite(which: "whole" | "program", label: string): void {
  const chip = document.createElement("span");
  chip.className = "warnchip";
  chip.textContent = t("flash.writes_device");

  const go = firmware.button(label, () => {
    row.remove();
    firmware.say(t(which === "whole" ? "flash.whole_warning"
                                     : "flash.program_warning"));
    /* Which sentence depends on whether there is a talker to reboot. One that
       answered can be put into write mode from here; one that answered nothing
       cannot be told anything at all, and then the buttons on the board are
       the only way in - which somebody with an assembled talker cannot reach,
       and the sentence says that too rather than sending them to look. */
    firmware.say(t(held.deviceSays ? "flash.write_mode_here"
                                   : "flash.download_mode"));
    const write2 = firmware.button(t("flash.choose_and_write"),
                                   () => void write(which, write2),
                                   "btn primary");
    firmware.row(write2, firmware.button(t("flash.check"), () => void probe()));
  }, "btn primary");

  const row = firmware.row(go, chip);
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
  if (held.deviceSays) {
    go.textContent = t("flash.switching");
    await intoWriteMode(held.deviceSays.port).catch(() => {});
    await new Promise((wait) => setTimeout(wait, WRITE_MODE_MS));
    go.textContent = t("flash.choose_and_write");
  }
  /* And the picker from that same click, before the fetch: transient
     activation is spent by the time an image has been downloaded, which is the
     lesson release.ts learned twice and cable.ts's header records. */
  const port = await askForDevice();
  if (!port) { go.disabled = false; return; }

  const carried = held.carried!;
  firmware.begin();
  firmware.say(t("flash.carries", { release: carried.release }));
  const { now, add, far } = firmware.logging();
  now(t("flash.fetching"));
  add(t("flash.fetching"));
  try {
    const piece = carried[which];
    const bytes = await firmwareBytes(piece);
    add(t("flash.fetched", { size: KIB(bytes.length) }));
    await writeFirmware(port, [{ piece, bytes }], carried, {
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
    held.deviceSays = null;
    held.nothingAnswered = false;
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
