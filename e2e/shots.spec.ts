import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* Not a test. A camera.
 *
 * Eight screenshots - four states of each editor, same window, same content as
 * far as the two targets allow - so that the two can be looked at side by side
 * rather than described in a table. It asserts almost nothing on purpose: what
 * it produces is for a person to judge, and an assertion here would only be
 * this file agreeing with itself.
 *
 * Run it deliberately, never as part of the suite:
 *
 *   SHOTS=/somewhere E2E_PORT=8843 npx playwright test e2e/shots.spec.ts
 *
 * Skipped without SHOTS so that `npm run test:e2e` does not spend twenty
 * seconds writing images nobody asked for.
 */

const SHOTS = process.env.SHOTS;

const label = (key: string) => new RegExp(
  `^(${LANGUAGES.map((l) =>
    (TEXTS as Record<string, Record<string, string>>)[l][key]
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
const SAVED = label("ui.saved");

test.skip(!SHOTS, "set SHOTS=<dir> to write the comparison screenshots");
test.describe.configure({ mode: "serial" });

/** The same window for both, because half of what is being compared is how
 *  much room each one takes. */
const WINDOW = { width: 1180, height: 760 };

/** The same words on both boards. Four, because that is what a DIY set holds -
 *  the tablet could carry more and showing it fuller would be comparing the
 *  targets rather than the editors. */
const WORDS = ["Ich habe Hunger", "Ich habe Durst", "Mehr bitte", "Fertig"];
const SCREEN = "Morgens";

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Waits for the write to land, so the status line reads the same in both
 *  editors' shots rather than being one of the differences.
 *
 *  Called where something has just been typed, and not before the first-run
 *  shots: load() clears the status, so a freshly opened Sammlung correctly
 *  says nothing at all - in both editors, which is the point. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });
}

/** Answers the target question that now stands in front of every new Sammlung. */
async function make(page: Page, which: "diy" | "app"): Promise<void> {
  await page.locator("#collectionNew").click();
  const asked = page.locator("dialog[open]").filter({ has: page.locator("h2") });
  await expect(asked).toBeVisible();
  await asked.locator("button.choice").nth(which === "diy" ? 0 : 1).click();
  // The choice selects, the footer makes it - see the note in the target
  // dialog, and the size question that sits inside it for the tablet.
  await asked.locator("button", { hasText: label("ui.collection_create") }).click();
  /* Making a Sammlung writes, switches, re-reads, redraws, and only then puts
   * the caret in the name. Typing before that last step renames whichever one
   * was open a moment ago and leaves the new one sitting there unnamed - which
   * is exactly what the first cut of these shots caught. Focus is the signal
   * because it is deliberately the last thing create() does. */
  await expect(page.locator("#collectionName")).toBeFocused();
  // The same name on both, so the work head is not one of the differences.
  await page.locator("#collectionName").fill("Kitchen");
  await page.locator("#collectionName").blur();
}

test("the five-key editor, four states", async ({ page }) => {
  await page.setViewportSize(WINDOW);
  await page.goto("./");
  await make(page, "diy");
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await shot(page, "diy-1-first-run");

  await page.locator("#device .setTile input[type=text]").first().fill(SCREEN);
  const keys = page.locator("#device .tile:not(.setTile) input[type=text]");
  for (const [at, word] of WORDS.entries()) await keys.nth(at).fill(word);
  await page.locator("#device .setTile .swatch").nth(1).click();
  // Nothing focused, to match the tablet shot where nothing is selected: this
  // state is "a screen with buttons on it" and the next one is "one of them
  // being edited".
  await page.locator("#tabs .tab").first().click();
  await settled(page);
  await shot(page, "diy-2-a-screen");

  // "One button being edited" is not a state this editor has - every key is a
  // live field at all times. The nearest thing is a caret in one of them, so
  // that is what is photographed.
  await keys.nth(0).focus();
  await shot(page, "diy-3-editing");

  await page.locator("#removeSet").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "diy-4-delete");
});

test("the tablet editor, four states", async ({ page }) => {
  await page.setViewportSize(WINDOW);
  await page.goto("./");
  await make(page, "app");
  await expect(page.locator("#appGrid .appcell")).toHaveCount(15);
  await shot(page, "app-1-first-run");

  const cells = page.locator("#appGrid .appcell");
  const open = page.locator("dialog[open]");
  /* Each word goes in through the sheet a press opens, which is what there is
   * to photograph now: the property row under the grid is gone, and with it
   * the "pick one" state the five-key shot above is still in. */
  for (const [at, word] of WORDS.entries()) {
    await cells.nth(at).locator(".appcell__open").click();
    await expect(open).toBeVisible();
    await open.locator("#appLabel").fill(word);
    await open.locator("#appClass")
      .selectOption(["pronoun", "verb", "noun", "social"][at]!);
    await open.locator("button", { hasText: label("ui.app_done") }).click();
    await expect(open).toBeHidden();
  }

  // The page's name is the page sheet's now, reached from the ... on the tab.
  await page.locator("#appPages .tab[aria-current=true] .tab__more").click();
  await expect(open).toBeVisible();
  await open.locator("#appPageName").fill(SCREEN);
  await open.locator("button", { hasText: label("ui.app_done") }).click();
  await expect(open).toBeHidden();
  await settled(page);
  // Nothing but the strip and the grid, which is the whole of what this
  // redesign left on the board.
  await shot(page, "app-2-a-screen");

  await cells.nth(0).locator(".appcell__open").click();
  await expect(open).toBeVisible();
  await shot(page, "app-3-editing");
  await page.keyboard.press("Escape");
  await expect(open).toBeHidden();

  await page.locator("#appPages .tab[aria-current=true] .tab__more").click();
  await expect(open).toBeVisible();
  await open.locator("button", { hasText: label("ui.app_page_delete") }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(2);
  await shot(page, "app-4-delete");
});
