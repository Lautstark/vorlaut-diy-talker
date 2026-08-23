import { expect, test } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* The two pickers in the settings sheet, which were native selects.
 *
 * They went because a select's open list is drawn by the operating system and
 * is the one control on the page that cannot follow the tokens - survivable
 * while this page committed to a dark ground, and not once the scheme became a
 * choice. What replaced them is a button and components.css's menu.
 *
 * The check that matters most here is the one the select used to do for free:
 * a <select> displays its own selected option, so nothing had to redraw it. A
 * button's text is ours, and the first version of this change left the trigger
 * saying the language somebody had just switched away from. */
const table = TEXTS as Record<string, Record<string, string>>;
const either = (key: string) =>
  new RegExp(`^(${LANGUAGES.map((l) => table[l][key]).join("|")})$`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.click("#gear");
});

test("the language picker is a button and a menu, not a select", async ({ page }) => {
  await expect(page.locator("#langPick")).toHaveJSProperty("tagName", "BUTTON");
  // Nothing on this page may be one any more; the OS list is the whole reason.
  expect(await page.locator("select").count()).toBe(0);

  const trigger = page.locator("#langPick");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // One choice with several answers, so the items are radios and exactly one
  // is checked - a plain list would read as two equal commands.
  const items = page.locator(".menu button");
  await expect(items).toHaveCount(LANGUAGES.length);
  await expect(page.locator('.menu button[aria-checked="true"]')).toHaveCount(1);
});

test("choosing a language moves the page and the trigger with it", async ({ page }) => {
  const trigger = page.locator("#langPick");
  const was = await trigger.textContent();
  const other = was === "Deutsch" ? "English" : "Deutsch";

  await trigger.click();
  await page.locator(".menu button", { hasText: other }).click();

  // The heading follows, as it always did.
  await expect(page.locator("#languageState")).toHaveText(other);
  // And so does the trigger. This is the assertion that would have failed.
  await expect(trigger).toHaveText(other);
  // The menu closes behind the choice.
  await expect(page.locator(".menu")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("Escape dismisses the menu and leaves the sheet standing", async ({ page }) => {
  const trigger = page.locator("#langPick");
  const sheet = page.locator("#voices");

  await trigger.click();
  await expect(page.locator(".menu")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await expect(page.locator(".menu")).toHaveCount(0);
  // The half that was wrong before: this sheet is a <dialog> opened with
  // showModal(), so the browser closes it on Escape too, and one press took
  // the whole of it. Dismissing a drop-down is not a request to leave.
  await expect(sheet).toHaveJSProperty("open", true);
});

test("Escape still leaves the sheet when no menu is open", async ({ page }) => {
  // The other half: with nothing to dismiss, Escape has to keep doing what it
  // always did, because it is the way out.
  const sheet = page.locator("#voices");
  await expect(sheet).toHaveJSProperty("open", true);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveJSProperty("open", false);
});

test("a press outside the menu closes it", async ({ page }) => {
  const trigger = page.locator("#langPick");
  await trigger.click();
  await expect(page.locator(".menu")).toHaveCount(1);
  await page.locator("#settingsHeading").click();
  await expect(page.locator(".menu")).toHaveCount(0);
});

test("the settings heading is the one label the language button never takes", async ({ page }) => {
  // Fixed and bilingual, because somebody who cannot read the page is exactly
  // who reaches for this control.
  await expect(page.locator("#langPick")).toHaveAttribute("aria-label", "Sprache / Language");
  // Whereas the panel around it is translated like everything else.
  await expect(page.locator("#languageSection")).toHaveText(either("ui.language"));
});
