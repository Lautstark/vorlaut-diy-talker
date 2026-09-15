// The frame every view sits in: the name of the page, what it does, where the
// file stays, and the one polite line that announces an outcome.
import { t } from "./boot.js";
import { cableSupported } from "./cable.js";
import type { Step } from "./step.js";

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

export const announce = (line: string) => { announcer.textContent = line; };

export const page = document.createElement("main");

/* What the page is showing. Everything above this line is on every view -
   the name of the page, what it does, where the file stays - and everything
   below it is swapped. */
export const viewRoot = document.createElement("div");

/** The frame, built once and put in the document. */
export function mountPage(): void {
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
  page.append(announcer, viewRoot);
  document.body.append(page);
}

/** The step somebody is now meant to be standing on, brought to where they can
 *  see it.
 *
 * Choosing a file draws three steps and opens a fourth, all of them below the
 * fold on a laptop, and nothing moved: the next thing to press was off the
 * screen and unannounced. Not focus - taking that from under somebody's hands
 * is worse than a scroll - and `nearest`, so a step already in view stays
 * where it is. */
export function bringIntoView(step: Step): void {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  step.root.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
}
