import { expect, test } from "@playwright/test";

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
 * separately. The three suites now ask the same questions of three menus. */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.click("#settingsLink");
});

test("opening a menu puts focus in it", async ({ page }) => {
  await page.click("#langPick");
  await expect(page.locator(".menu button").first()).toBeFocused();
});

test("the arrows and Home/End walk the list", async ({ page }) => {
  await page.click("#langPick");
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
  const trigger = page.locator("#langPick");
  await trigger.click();
  await page.keyboard.press("Escape");

  await expect(page.locator(".menu")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  // Dropping focus on <body> sends a keyboard user back to the top of a sheet
  // they were part way down.
  await expect(trigger).toBeFocused();
});

test("the trigger says which kind of popup it opens", async ({ page }) => {
  // "true" is legal and says less. Both pickers were marked up by hand.
  await expect(page.locator("#langPick")).toHaveAttribute("aria-haspopup", "menu");
});

test("the checked item is visible and not only announced", async ({ page }) => {
  await page.click("#langPick");
  const [checked, plain] = await Promise.all([
    page.locator('.menu button[aria-checked="true"]').evaluate((n) => getComputedStyle(n).color),
    page.locator('.menu button[aria-checked="false"]').first()
      .evaluate((n) => getComputedStyle(n).color),
  ]);
  // This page has shipped two menuitemradio menus whose selection a sighted
  // user could only infer from the trigger behind the open list.
  expect(checked).not.toBe(plain);
});
