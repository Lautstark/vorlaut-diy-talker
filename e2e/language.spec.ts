import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { put } from "./diy.js";

/* Two languages, and the whole point of these is that they are two.
 *
 * A menu that flips the page is the easy half and passed with the whole of the
 * choice living in a variable. What these check is that the choice is still
 * there after a reload - it lasted exactly as long as the tab did once - that
 * it beats what the browser asks for, which is the thing that made that bug
 * hard to see, and that the page's language and the device's no longer move
 * each other.
 *
 * They were one control: `setLanguage(code)` and `state.layout.language = code`
 * on the same keystroke. So a carer whose page is German could not build an
 * English talker without turning their own page English, and opening a
 * Sammlung re-languaged the page around them. Half of what follows is about
 * that not happening any more, which is why the pair of tests at the bottom
 * assert that something does NOT change.
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

/** What each language calls itself. Both menus name them this way on purpose -
 *  see voices.ts - so these are the one pair of literals that belong here. */
const OWN_NAME: Record<string, string> = { de: "Deutsch", en: "English" };

/** The menu item for a language. menuitemradio rather than button - the items
 *  are a set of alternatives with one in force, which is what dom.ts builds. */
const option = (page: Page, code: string) =>
  page.getByRole("menuitemradio", { name: OWN_NAME[code], exact: true });

/** Opens the settings sheet and picks the language of this page. */
async function choose(page: Page, code: string): Promise<void> {
  await page.click("#settingsLink");
  await openPanel(page, "#languagePanel");
  await page.click("#langPick");
  await option(page, code).click();
}

/** The same for the other one: the language the device's menu speaks, which
 *  belongs to the Sammlung and is a panel of its own further down the sheet. */
async function chooseForCollection(page: Page, code: string): Promise<void> {
  await page.click("#settingsLink");
  await openPanel(page, "#collectionLanguagePanel");
  await page.click("#collectionLangPick");
  await option(page, code).click();
}

/** A label the page can be recognised by, in the language given. Read out of
 *  the same table the page reads: a literal here would only say again, in a
 *  second place, what the page already believes. */
const says = (code: string, key: string) => table[code][key];

/** The language in the layout that is open, read out of the store rather than
 *  off the screen - it is a property of the Sammlung, and the only place it
 *  shows is the file and what is built from it. */
const inTheLayout = (page: Page) =>
  page.evaluate(() => new Promise<string | null>((resolve) => {
    const open = indexedDB.open("vorlaut");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      // Whichever Sammlung is open: there is a list of them now, each one's
      // layout is a record of its own in `layouts`, and which one is open is a
      // mark beside them.
      const tx = open.result.transaction(["marks", "layouts"], "readonly");
      const current = tx.objectStore("marks").get("current");
      current.onerror = () => resolve(null);
      current.onsuccess = () => {
        const got = tx.objectStore("layouts").get(current.result as string);
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
  }));

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  // The board is what says the layout has been read; before that the page is
  // still wearing the labels it painted from the browser's own preference.
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await expect(page.locator("html")).toHaveAttribute("lang", ASKED);
});

/** Unfolds one panel. The sheet's panels are one exclusive group now - opening
 *  one closes the rest - so anything acting inside a panel has to open that
 *  panel first rather than assuming an earlier one stayed put. */
async function openPanel(page: Page, id: string) {
  const panel = page.locator(id);
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
}

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

    await page.reload();
    await expect(page.locator("#device .cell")).toHaveCount(6);

    // The whole bug: this was the browser's answer again, every time.
    await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);
    await expect(page.locator("#releaseBtn")).toHaveText(says(CHOSEN, "ui.release"));
    // And the sheet's own controls, which are painted from LANG rather than
    // carried by the markup and so are not covered by applyTexts().
    await page.click("#settingsLink");
    await expect(page.locator("#langPick")).toHaveText(OWN_NAME[CHOSEN]);
    await expect(page.locator("#languageState")).toHaveText(OWN_NAME[CHOSEN]);
  });

test("this browser is what carries it, not the Sammlung", async ({ page }) => {
  const before = await inTheLayout(page);
  await choose(page, CHOSEN);
  await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);

  // Beside the scheme, in the store that can be read before the first paint,
  // because this is a fact about this browser and this reader. It used to be
  // written into the layout - which is how it also became the device's answer,
  // and the reason a page could not be one language while a talker was
  // another.
  expect(await page.evaluate(() => localStorage.getItem("vorlaut.language")))
    .toBe(CHOSEN);
  // And the Sammlung is exactly where it was - checked after an edit that
  // writes, not straight after the switch. Straight after the switch this
  // passes even with the old line put back, because the switch no longer
  // saves: `state.layout.language = code` would sit in memory until the next
  // write carried it out, which is the same bug arriving one keystroke later.
  await page.click("#voiceClose");
  await put(page, 0, "Hallo");
  await expect.poll(() => inTheLayout(page)).toBe(before);
});

/* The other half of the split. These two are the bug, from each side. */

test("the Sammlung's language is written to the layout, and moves nothing here",
  async ({ page }) => {
    await chooseForCollection(page, CHOSEN);

    // Where it has to be for the device to get it: beside the voice, in the
    // layout. A board exported from here and flashed onto a talker carries the
    // menu language with it - that is why this one is not in localStorage the
    // way the page's language and the scheme are.
    await expect.poll(() => inTheLayout(page)).toBe(CHOSEN);
    await expect(page.locator("#collectionLangPick")).toHaveText(OWN_NAME[CHOSEN]);
    await expect(page.locator("#collectionLanguageState")).toHaveText(OWN_NAME[CHOSEN]);

    // And the page is still the reader's. This is the carer with a German
    // editor building an English talker, which was not possible at all.
    await expect(page.locator("html")).toHaveAttribute("lang", ASKED);
    await expect(page.locator("#settingsHeading"))
      .toHaveText(says(ASKED, "ui.settings"));
    expect(await page.evaluate(() => localStorage.getItem("vorlaut.language")))
      .toBe(null);
  });

test("opening a Sammlung does not re-language the editor", async ({ page }) => {
  // A Sammlung whose device speaks the other language, saved and let go of.
  await chooseForCollection(page, CHOSEN);
  await expect.poll(() => inTheLayout(page)).toBe(CHOSEN);
  await page.click("#voiceClose");

  // Read back the way somebody comes back to it: a reload is load(), which is
  // where the language used to be adopted. Nothing else on this page has
  // changed, so the editor must still be in the language the browser asked
  // for - it used to arrive in the board's, which is the half of the bug
  // nobody chose and could not undo without changing the board.
  await page.reload();
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await expect(page.locator("html")).toHaveAttribute("lang", ASKED);
  await expect(page.locator("#releaseBtn")).toHaveText(says(ASKED, "ui.release"));

  // The Sammlung kept its own answer through all of that.
  await page.click("#settingsLink");
  await openPanel(page, "#collectionLanguagePanel");
  await expect(page.locator("#collectionLangPick")).toHaveText(OWN_NAME[CHOSEN]);
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
  await page.click("#settingsLink");
  await openPanel(page, "#dataPanel");
  const line = page.locator("#folderState");
  await expect(line).toBeVisible();
  const before = (await line.textContent())?.trim() ?? "";
  // Nothing chosen yet, so this is the "off" sentence - in the language the
  // browser asked for, which is the baseline the switch has to move.
  expect(before).toContain(says(ASKED, "ui.folder_off"));

  await openPanel(page, "#languagePanel");
  await page.click("#langPick");
  await option(page, CHOSEN).click();

  await expect(line).toContainText(says(CHOSEN, "ui.folder_off"));
  await expect(page.locator("#folderActions button").first())
    .toHaveText(says(CHOSEN, "ui.folder_choose"));
});
