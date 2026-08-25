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
  for (const [at, word] of WORDS.entries()) {
    const box = cells.nth(at);
    await box.click();
    await expect(box).toHaveAttribute("aria-pressed", "true");
    await page.locator("#appLabel").fill(word);
    await page.locator(".apppanel__button select").first()
      .selectOption(["pronoun", "verb", "noun", "social"][at]!);
  }
  await page.locator(".apppanel__page input[type=text]").fill(SCREEN);
  await page.locator(".apppanel__page input[type=text]").blur();
  // Nothing selected, so the panel is in its "pick one" state - the same
  // moment the five-key shot above is in.
  await page.locator("#appPages .tab").first().click();
  await settled(page);
  await shot(page, "app-2-a-screen");

  await cells.nth(0).click();
  await expect(cells.nth(0)).toHaveAttribute("aria-pressed", "true");
  await page.locator("#appLabel").focus();
  await shot(page, "app-3-editing");

  await page.locator(".apppanel__page button").last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "app-4-delete");
});
