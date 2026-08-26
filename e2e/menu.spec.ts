import { expect, test } from "@playwright/test";
import { openCollectionSettings, openPanel } from "./sheets.js";

/* That an open menu can be reached without a mouse.
 *
 * pickers.spec.ts already holds the roles and the checked item in place - this
 * page got those right when the selects went. What it never had is the rest of
 * the menu button pattern: focus went into the list on open and had nowhere to
 * go afterwards, so Escape dropped it on <body> and the arrows did nothing at
 * all.
 *
 * The file is here rather than folded into pickers.spec.ts because this is the
 * half that is shared with mitreden and bildhaft, which grew the same gap
 * separately. The three suites now ask the same questions of three menus.
 *
 * The menu it asks them of used to be the page's language picker. That one is a
 * segmented control now - the same shape as the scheme beside it - so the
 * subject moved to the Sammlung's language, which stays a button and a menu on
 * purpose: it is a property of the Sammlung rather than a preference of whoever
 * is reading, and it travels in an export. That makes it the better exemplar
 * anyway, because it is the one that is not going to change shape. */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openCollectionSettings(page);
  await openPanel(page, "#collectionLanguagePanel");
});

test("opening a menu puts focus in it", async ({ page }) => {
  await page.click("#collectionLangPick");
  await expect(page.locator(".menu button").first()).toBeFocused();
});

test("the arrows and Home/End walk the list", async ({ page }) => {
  await page.click("#collectionLangPick");
  const items = page.locator(".menu button");
  const count = await items.count();
  expect(count).toBeGreaterThan(1);

  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(items.nth(0)).toBeFocused();
  // Round rather than stopping, so a short list is faster to leave by the top.
  await page.keyboard.press("ArrowUp");
  await expect(items.nth(count - 1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.nth(0)).toBeFocused();
});

test("Escape closes the menu and hands focus back", async ({ page }) => {
  const trigger = page.locator("#collectionLangPick");
  await trigger.click();
  await page.keyboard.press("Escape");

  await expect(page.locator(".menu")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  // Dropping focus on <body> sends a keyboard user back to the top of a sheet
  // they were part way down.
  await expect(trigger).toBeFocused();
});

test("the trigger says which kind of popup it opens", async ({ page }) => {
  // "true" is legal and says less. Marked up by hand, so worth holding.
  await expect(page.locator("#collectionLangPick")).toHaveAttribute("aria-haspopup", "menu");
});

test("the checked item is visible and not only announced", async ({ page }) => {
  await page.click("#collectionLangPick");
  const [checked, plain] = await Promise.all([
    page.locator('.menu button[aria-checked="true"]').evaluate((n) => getComputedStyle(n).color),
    page.locator('.menu button[aria-checked="false"]').first()
      .evaluate((n) => getComputedStyle(n).color),
  ]);
  // This page shipped menuitemradio menus whose selection a sighted user could
  // only infer from the trigger behind the open list.
  expect(checked).not.toBe(plain);
});

test("Escape dismisses the menu and leaves the sheet standing", async ({ page }) => {
  const trigger = page.locator("#collectionLangPick");
  const sheet = page.locator("#collectionSheet");

  await trigger.click();
  await expect(page.locator(".menu")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await expect(page.locator(".menu")).toHaveCount(0);
  // The half that was wrong before: these sheets are <dialog>s opened with
  // showModal(), so the browser closes them on Escape too, and one press took
  // the whole of it. Dismissing a drop-down is not a request to leave.
  await expect(sheet).toHaveJSProperty("open", true);
});

test("a press outside the menu closes it", async ({ page }) => {
  const trigger = page.locator("#collectionLangPick");
  await trigger.click();
  await expect(page.locator(".menu")).toHaveCount(1);
  await page.locator("#collectionSheetHeading").click();
  await expect(page.locator(".menu")).toHaveCount(0);
});
