import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* The language, and the half of it that only shows on the second visit.
 *
 * A menu that flips the page is the easy half and passed with the whole of the
 * choice living in a variable. What these check is that the choice is still
 * there after a reload - it was written to the layout on every switch and read
 * back on none, so it lasted exactly as long as the tab did - and that it
 * beats what the browser asks for, which is the thing that made the bug hard
 * to see: on a machine whose browser already asks for German, a German page
 * after a reload looks exactly like a preference that was kept.
 *
 * So the locale is pinned rather than left to the runner, and every test
 * switches *away* from what it asks for. theme.spec.ts holds the same shape
 * for the scheme; the two are the page's only preferences that outlive a tab.
 */

const table = TEXTS as Record<string, Record<string, string>>;

/** The browser asks for this; the tests then choose the other one. Pinned so
 *  the switch is a real change on a German laptop and on CI alike. */
const ASKED = "de";
const CHOSEN = LANGUAGES.find((code) => code !== ASKED)!;

test.use({ locale: `${ASKED}-DE` });

/** What each language calls itself. The menu names them this way on purpose -
 *  see voices.ts - so these are the one pair of literals that belong here. */
const OWN_NAME: Record<string, string> = { de: "Deutsch", en: "English" };

/** The menu item for a language. menuitemradio rather than button - the items
 *  are a set of alternatives with one in force, which is what dom.ts builds. */
const option = (page: Page, code: string) =>
  page.getByRole("menuitemradio", { name: OWN_NAME[code], exact: true });

/** Opens the settings sheet and picks a language. */
async function choose(page: Page, code: string): Promise<void> {
  await page.click("#gear");
  await page.click("#langPick");
  await option(page, code).click();
}

/** A label the page can be recognised by, in the language given. Read out of
 *  the same table the page reads: a literal here would only say again, in a
 *  second place, what the page already believes. */
const says = (code: string, key: string) => table[code][key];

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  // The board is what says the layout has been read; before that the page is
  // still wearing the labels it painted from the browser's own preference.
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await expect(page.locator("html")).toHaveAttribute("lang", ASKED);
});

test("a chosen language is in force, and the menu says which", async ({ page }) => {
  await choose(page, CHOSEN);

  await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);
  await expect(page.locator("#langPick")).toHaveText(OWN_NAME[CHOSEN]);
  await expect(page.locator("#settingsHeading"))
    .toHaveText(says(CHOSEN, "ui.settings"));
});

test("the choice survives a reload, over what the browser asks for",
  async ({ page }) => {
    await choose(page, CHOSEN);
    await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);

    // The switch redraws the page before it has finished writing, so the
    // attribute above is true a moment before the layout holding it is in the
    // store. Wait for the page's own word that the write landed, the way
    // page.spec.ts does - a reload racing it reads back the previous language
    // and fails here for a reason that has nothing to do with what is checked.
    await expect(page.locator("#status")).toHaveText(says(CHOSEN, "ui.saved"),
      { timeout: 10_000 });

    await page.reload();
    await expect(page.locator("#device .tile")).toHaveCount(5);

    // The whole bug: this was the browser's answer again, every time.
    await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);
    await expect(page.locator("#releaseBtn")).toHaveText(says(CHOSEN, "ui.release"));
    // And the sheet's own controls, which are painted from LANG rather than
    // carried by the markup and so are not covered by applyTexts().
    await page.click("#gear");
    await expect(page.locator("#langPick")).toHaveText(OWN_NAME[CHOSEN]);
    await expect(page.locator("#languageState")).toHaveText(OWN_NAME[CHOSEN]);
  });

test("the layout is what carries it, not this browser", async ({ page }) => {
  await choose(page, CHOSEN);
  await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);

  // Where it has to be for the device to get it too: beside the voice, in the
  // layout, rather than in a key next to it. A board exported from here and
  // flashed onto a talker carries the menu language with it - that is why this
  // preference is not in localStorage the way the scheme is.
  await expect.poll(() => page.evaluate(() => new Promise<string | null>((resolve) => {
    const open = indexedDB.open("vorlaut");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      // Whichever Sammlung is open: there is a list of them now, and each one's
      // layout stands under a key of its own. The language is still in the
      // layout rather than beside it, which is the whole of what this asserts.
      const content = open.result.transaction("content", "readonly")
        .objectStore("content");
      const list = content.get("collections");
      list.onerror = () => resolve(null);
      list.onsuccess = () => {
        const got = content.get("layout:" + (list.result as { current: string }).current);
        got.onerror = () => resolve(null);
        got.onsuccess = () => {
          try {
            resolve(JSON.parse((got.result as { text: string }).text).language ?? null);
          } catch {
            resolve(null);
          }
        };
      };
    };
  }))).toBe(CHOSEN);

  expect(await page.evaluate(() => Object.keys(localStorage)))
    .not.toContain("vorlaut.language");
});

/* The Daten panel, which is where a captured LANG showed itself.
 *
 * Its sentence is built by Intl.RelativeTimeFormat, and the formatter used to
 * be made once at import out of whatever LANG said then. boot.ts asks that
 * nothing capture that binding into a local, and this is what happens when
 * something does: the page goes German and the line under the folder goes on
 * saying "3 minutes ago". The panel is also redrawn only when the backup's
 * status moves, so a switch on a quiet page left it in the old language even
 * once the formatter followed - both halves are needed and this covers both. */
test("the folder's own line follows a switch, formatter and all", async ({ page }) => {
  await page.click("#gear");
  await page.locator("#dataPanel summary").click();
  const line = page.locator("#folderState");
  await expect(line).toBeVisible();
  const before = (await line.textContent())?.trim() ?? "";
  // Nothing chosen yet, so this is the "off" sentence - in the language the
  // browser asked for, which is the baseline the switch has to move.
  expect(before).toContain(says(ASKED, "ui.folder_off"));

  await page.click("#langPick");
  await option(page, CHOSEN).click();

  await expect(line).toContainText(says(CHOSEN, "ui.folder_off"));
  await expect(page.locator("#folderActions button").first())
    .toHaveText(says(CHOSEN, "ui.folder_choose"));
});
