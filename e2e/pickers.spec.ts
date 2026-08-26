import { expect, test } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* The pickers in the settings sheet, which were native selects.
 *
 * They went because a select's open list is drawn by the operating system and
 * is the one control on the page that cannot follow the tokens - survivable
 * while this page committed to a dark ground, and not once the scheme became a
 * choice. That reason still stands and is what the first test holds.
 *
 * What replaced the language one has since changed again. It was a button and
 * components.css's menu; it is a segmented group now, the same control as the
 * scheme directly beneath it, because two facts about this page were being
 * offered two different ways in one sheet. A menu is for a list of things to
 * do, and this is a list of what the page already is.
 *
 * The check that matters most survived the change intact: a <select> displays
 * its own selected option, so nothing had to redraw it, and anything replacing
 * it has to be redrawn by us. The old menu shipped with a trigger still naming
 * the language somebody had just switched away from; the segmented version can
 * fail the same way through aria-pressed, so that is what is asserted.
 *
 * The menu keyboard behaviour moved to menu.spec.ts with the menu itself - the
 * Sammlung's language picker is the subject there now, and it stays a menu on
 * purpose. */
const table = TEXTS as Record<string, Record<string, string>>;
const either = (key: string) =>
  new RegExp(`^(${LANGUAGES.map((l) => table[l][key]).join("|")})$`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.click("#settingsLink");
});

test("the language picker is a segmented group, and nothing is a select", async ({ page }) => {
  const group = page.locator("#langPick");
  await expect(group).toHaveJSProperty("tagName", "DIV");
  await expect(group).toHaveAttribute("role", "group");
  // Nothing on this page may be one any more; the OS list is the whole reason.
  expect(await page.locator("select").count()).toBe(0);

  // One choice with several answers, all of them on screen at once, and the one
  // in force marked rather than left to be inferred from a closed control.
  const options = group.locator("button");
  await expect(options).toHaveCount(LANGUAGES.length);
  await expect(group.locator('button[aria-pressed="true"]')).toHaveCount(1);
});

test("choosing a language moves the page and the mark with it", async ({ page }) => {
  const group = page.locator("#langPick");
  const was = await group.locator('button[aria-pressed="true"]').textContent();
  const other = was === "Deutsch" ? "English" : "Deutsch";

  await group.locator("button", { hasText: other }).click();

  // The heading follows, as it always did.
  await expect(page.locator("#languageState")).toHaveText(other);
  // And so does the mark. This is the assertion the old trigger failed: the
  // control has to be redrawn by us, which is the whole cost of not being a
  // <select> that displayed its own selected option.
  await expect(group.locator('button[aria-pressed="true"]')).toHaveText(other);
});

test("Escape still leaves the sheet when no menu is open", async ({ page }) => {
  // The other half: with nothing to dismiss, Escape has to keep doing what it
  // always did, because it is the way out.
  const sheet = page.locator("#voices");
  await expect(sheet).toHaveJSProperty("open", true);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveJSProperty("open", false);
});

test("the settings heading is the one label the language control never takes", async ({ page }) => {
  // Fixed and bilingual, because somebody who cannot read the page is exactly
  // who reaches for this control. It moved from the button to the group around
  // the buttons, which is where the accessible name of a segmented set belongs.
  await expect(page.locator("#langPick")).toHaveAttribute("aria-label", "Sprache / Language");
  // Whereas the panel around it is translated like everything else.
  await expect(page.locator("#languageSection")).toHaveText(either("ui.language"));
});
