import { expect, type Locator, type Page } from "@playwright/test";
import { label } from "./diy.js";

/* The two settings surfaces, and getting into either one.
 *
 * There is one of each and they are not the same sheet, which is the whole
 * reason this file exists rather than a `#settingsLink` click copied into
 * fourteen specs:
 *
 *   Einstellungen        at the foot of the sidebar - this browser, this
 *                        installation. The page's language, the scheme, which
 *                        voices this machine has, the symbol sources, Daten.
 *   the Sammlung's own   behind the ⋯ beside its name - the voice it speaks
 *                        in, and on a talker the language its device shows
 *                        its own menu in.
 *
 * Helpers only, no tests, so `playwright test` does not pick it up as a spec -
 * the same shape e2e/diy.ts and e2e/obz.ts are here in.
 *
 * Both openers close whatever modal is already up first. Two <dialog>s opened
 * with showModal() stack, and the one underneath is inert - so a spec that
 * saved an Azure key and then went looking for the voice list would click into
 * a scrim and time out on an element that is on screen.
 */

/** Whatever is open, closed. Either sheet's cross, whichever is showing. */
async function closeSheets(page: Page): Promise<void> {
  for (const [dialog, cross] of [["#voices", "#voiceClose"],
                                 ["#collectionSheet", "#collectionSheetClose"]] as const) {
    if (await page.locator(dialog).isVisible()) await page.locator(cross).click();
  }
}

/** Einstellungen, at the foot of the sidebar. */
export async function openSettings(page: Page): Promise<Locator> {
  await closeSheets(page);
  await page.locator("#settingsLink").click();
  const sheet = page.locator("#voices");
  await expect(sheet).toBeVisible();
  return sheet;
}

/** One entry of the ⋯ beside the Sammlung's name, pressed by its label. */
export async function pickFromMenu(page: Page, key: string): Promise<void> {
  await closeSheets(page);
  await page.locator("#collectionMenu").click();
  await page.locator('[role="menuitem"]', { hasText: label(key) }).click();
}

/** One export of a talker Sammlung, from that entry and then from its card.
 *
 * Two presses rather than one since the three entries became one: the menu
 * says the act, and the sheet behind it asks what the file is for. `which` is
 * the card - "talker", "app" or "other" - and the three behind them are still
 * three functions, which is exchange/SPEC.md §5.2 and not this file's problem.
 *
 * Nothing is written by getting here. Two of the three cards open a sheet that
 * asks again, and the third writes a file that costs no synthesis; a caller
 * waiting on a download waits after this returns.
 */
export async function pickExport(page: Page, which: string): Promise<void> {
  await pickFromMenu(page, "ui.collection_export");
  /* By the heading rather than by the card, and the click lands on the heading
   * and bubbles. label() is anchored, and a card's own text is its heading and
   * its sentence run together - so a card matches nothing and the press times
   * out waiting for a download that was never asked for. */
  await page.locator("dialog.sheet--choices button.choice strong",
                     { hasText: label(`ui.collection_export_for_${which}`) }).click();
}

/** The Sammlung's own sheet, from that menu. */
export async function openCollectionSettings(page: Page): Promise<Locator> {
  await pickFromMenu(page, "ui.collection_settings");
  const sheet = page.locator("#collectionSheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Unfolds one panel, whatever state the <details> was left in.
 *
 * A blind click toggles, and the panels of a sheet are one exclusive group -
 * opening one closes the rest - so anything acting inside a panel has to ask
 * for that panel rather than assume an earlier step left it open. */
export async function openPanel(page: Page, id: string): Promise<void> {
  const panel = page.locator(id);
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
}

/** The voice list, which is in the Sammlung's sheet: what this one speaks in.
 *  What this machine *has* is a different panel on the other sheet. */
export async function openVoices(page: Page): Promise<Locator> {
  const sheet = await openCollectionSettings(page);
  await openPanel(page, "#voicePanel");
  return sheet;
}
