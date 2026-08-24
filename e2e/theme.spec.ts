import { expect, test } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* The scheme, and the one thing about it that is easy to get wrong.
 *
 * A toggle that flips the page is the easy half and would pass with the whole
 * of it in the bundle. What these check is the half that only shows up on the
 * second visit: the choice has to survive a reload, and it has to be in force
 * before the bundle runs rather than a frame later - which is what the inline
 * script in index.html is for and what nothing else would notice if it went.
 *
 * The labels come out of the same table the page reads, for the reason
 * page.spec.ts gives: the runner picks its own language, and a word written
 * here in one of them passes on one machine and fails on another. */
const table = TEXTS as Record<string, Record<string, string>>;

/** The label for a key, in whichever language this page opened in. */
const label = (page: import("@playwright/test").Page, key: string) =>
  page.evaluate(
    ([texts, k]) => (texts as Record<string, Record<string, string>>)[
      document.documentElement.lang || "en"]?.[k as string]
      ?? (texts as Record<string, Record<string, string>>)["en"][k as string],
    [table, key] as const);

/** Every language's word for a key, for a match that does not depend on which. */
const either = (key: string) =>
  new RegExp(`^(${LANGUAGES.map((l) => table[l][key]).join("|")})$`);

async function openTheme(page: import("@playwright/test").Page): Promise<void> {
  await page.click("#settingsLink");
  await page.locator("#themePanel summary").click();
  await expect(page.locator("#themePick button")).toHaveCount(3);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("opens following the device, and says so in the heading", async ({ page }) => {
  await openTheme(page);
  await expect(page.locator("#themeState")).toHaveText(either("ui.theme_system"));
  // The absence of the attribute is what "follows the OS" is: a page that wrote
  // data-theme here would have picked one, and picked it in the dark.
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expect(page.locator('#themePick button[aria-pressed="true"]'))
    .toHaveText(either("ui.theme_system"));
});

test("a chosen scheme is in force, named in the heading, and survives a reload",
  async ({ page }) => {
    await openTheme(page);
    await page.locator("#themePick button")
      .filter({ hasText: either("ui.theme_dark") }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#themeState")).toHaveText(either("ui.theme_dark"));

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

test("the scheme is in force before the bundle has run", async ({ page }) => {
  await openTheme(page);
  await page.locator("#themePick button")
    .filter({ hasText: either("ui.theme_light") }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Hold every script the page asks for. Whatever sets the attribute while
  // these are stalled is, by construction, not in the bundle - and the inline
  // script in index.html is the only other thing there is.
  let release = (): void => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/*.js", async (route) => { await held; await route.continue(); });

  // "commit" rather than the default "load": load cannot fire while the bundle
  // is held, and anything earlier races the navigation itself.
  await page.goto("/", { waitUntil: "commit" });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? null))
    .toBe("light");

  release();
});

test("going back to the device setting removes the choice rather than storing one",
  async ({ page }) => {
    await openTheme(page);
    await page.locator("#themePick button")
      .filter({ hasText: either("ui.theme_light") }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.locator("#themePick button")
      .filter({ hasText: either("ui.theme_system") }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    // Not the word "system" written into storage: an absent key is what a later
    // reader has to see to know nobody chose, and it is what the inline script
    // above is written against.
    expect(await page.evaluate(() => localStorage.getItem("vorlaut.theme"))).toBeNull();
    // And the label is still the one for this page's language.
    expect(await label(page, "ui.theme_system")).toBeTruthy();
  });

test("opening a panel closes the one open before it", async ({ page }) => {
  await page.click("#settingsLink");
  // Language starts open, so a second panel is enough to show the group at work.
  await expect(page.locator("#languagePanel")).toHaveJSProperty("open", true);

  await page.locator("#themePanel summary").click();
  await expect(page.locator("#themePanel")).toHaveJSProperty("open", true);
  // The browser does this, not us: the panels share a name, which makes them
  // one group with radio semantics. Asserting the effect rather than the
  // attribute, so a scripted accordion would keep this green.
  await expect(page.locator("#languagePanel")).toHaveJSProperty("open", false);
});
