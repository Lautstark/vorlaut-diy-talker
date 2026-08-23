/* Opening the three pages the footer points at.
 *
 * There is no state here worth the name: one dialog, three sections, and the
 * only decision is which one is not hidden. It is a module rather than four
 * lines in app.ts because the pages have to agree on that - a second caller
 * showing one section without hiding the other two would put the Impressum
 * under the privacy notice, and the dialog would still look right until
 * somebody scrolled.
 */
import { $ } from "./dom.js";
import { t } from "../core/texts.js";

/** The three sections, and the heading each of them opens under. The heading
 *  is also the dialog's accessible name - see the template. */
const PAGES = {
  aboutPage: "ui.legal_about",
  impressumPage: "ui.legal_impressum",
  privacyPage: "ui.legal_privacy",
} as const;

type Page = keyof typeof PAGES;

function open(page: Page): void {
  for (const id of Object.keys(PAGES) as Page[]) $(id).hidden = id !== page;
  $("legalHeading").textContent = t(PAGES[page]);
  // From the top every time. The sheet keeps its scroll position, and the
  // privacy notice is long enough that reopening it half way down reads as a
  // page that starts in the middle of a sentence.
  $("legal").querySelector(".body")!.scrollTop = 0;
  $<HTMLDialogElement>("legal").showModal();
}

export function wireLegal(): void {
  $<HTMLButtonElement>("aboutLink").onclick = () => open("aboutPage");
  $<HTMLButtonElement>("impressumLink").onclick = () => open("impressumPage");
  $<HTMLButtonElement>("privacyLink").onclick = () => open("privacyPage");
  $<HTMLButtonElement>("legalClose").onclick = () =>
    $<HTMLDialogElement>("legal").close();
}
