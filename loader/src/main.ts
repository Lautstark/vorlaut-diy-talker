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
//
// ## Where the rest of it is
//
// This file used to be the whole page, at two thousand lines. What is here now
// is the boot; the parts are modules beside it, cut along the sections this
// file used to have: step.ts (one step, and everything that can be written
// into one), page.ts (the frame every view sits in), flow.ts (the file, chosen
// to compiled), sending.ts (the connect step and the transfer), collections.ts
// (what is already on the talker), program.ts (the firmware), views.ts (the
// door, the talker, sending), state.ts (what the page holds between presses)
// and words.ts (a size, a language, a voice, a port, a failure, as a person
// reads them).
import "@lautstark/design/tokens/vorlaut.css";
import "@lautstark/design/components.css";
import "./style.css";

import { initTheme } from "@lautstark/design/theme";
import { LANG, t } from "./boot.js";
import { cableSupported } from "./cable.js";
import { watchForDevices } from "./device.js";
import { carriedFirmware } from "./firmware.js";
import { mountPage } from "./page.js";
import { startFlow } from "./flow.js";
import { firmwareSection } from "./program.js";
import { held, redraw } from "./state.js";
import { render } from "./views.js";

initTheme("vorlaut.theme");
document.documentElement.lang = LANG;
document.title = t("load.title");

mountPage();
startFlow();

/* --------------------------------------------------------------- boot --- */

/* Asked on load, and again whenever a cable is plugged in or pulled out - so a
 * page opened before the talker was does not need reloading. It costs nothing
 * and no gesture, and knowing the answer before the press is the whole reason
 * one press is enough later. */
watchForDevices();
render();

/* What this deploy carries, on load and without a gesture. A manifest that
 * says there is no image leaves the section unbuilt, and then the talker view
 * simply has no firmware panel in it - absent rather than present and empty,
 * which is what it has always been. */
if (cableSupported()) {
  void carriedFirmware().then((found) => {
    if (!found) return;
    held.carried = found;
    firmwareSection();
    if (held.view === "talker") redraw.talker();
  });
}
