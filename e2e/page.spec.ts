import { expect, test } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { expectSaid, put } from "./diy.js";

/* The page opens in whatever language the browser asks for, and a test runner
 * picks its own. So the label to wait for comes out of the same table the page
 * reads rather than being written here in one language - which would pass on a
 * German machine and fail on the runner, or the other way round. */
const SAVED = new RegExp(
  `^(${LANGUAGES.map((l) => (TEXTS as Record<string, Record<string, string>>)[l]["ui.saved"]).join("|")})$`);

/* The page opens, and a board is on it.
 *
 * This exists because of what happened without it. Deleting the Python half
 * left the page with a bootstrap block nobody filled in, seven absolute paths
 * nothing served, and a seam importing routes that were gone. Every check in
 * the repository stayed green, because not one of them opened the page: they
 * read files, compared bytes and walked imports, and all of that was still true
 * of a page that rendered nothing at all.
 *
 * So this one is deliberately shallow and deliberately end to end.
 */

/** Anything the page said went wrong, collected for the whole test. */
function watch(page: import("@playwright/test").Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`threw: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    problems.push(`failed: ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      problems.push(`${response.status()}: ${response.url()}`);
    }
  });
  return problems;
}

test("it opens with a board on it and asks no server for anything", async ({ page }) => {
  const problems = watch(page);
  await page.goto("./");

  // The set tile and its four keys. They only appear if the module graph
  // loaded, boot.ts handed over the texts and the store seeded a first
  // layout - which is the whole page in one assertion.
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await expect(page.locator("#tabs .tab").first()).toBeVisible();

  expect(problems, problems.join("\n")).toEqual([]);

  // Nothing is behind this page. A request to /api/ would mean a module still
  // believes otherwise, and the failure would be a button that does nothing.
  const api = await page.evaluate(() =>
    performance.getEntriesByType("resource")
      .map((r) => r.name).filter((n) => n.includes("/api/")));
  expect(api).toEqual([]);
});

test("what is typed survives a reload", async ({ page }) => {
  const problems = watch(page);
  await page.goto("./");
  await expect(page.locator("#device .cell")).toHaveCount(6);

  /* A key's sentence, typed where it is typed now: in the sheet the key
   * opens. It is not on the board at all any more - the board draws what a key
   * says and a press is how it is changed. */
  const sentence = "Ich will nach draussen";
  await put(page, 0, sentence);

  /* The save is debounced, so the reload has to wait for it. The status line
   * saying so is the page's own signal that it landed, which is a better thing
   * to wait on than a timer somebody would have to keep tuning. */
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await page.reload();
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await expectSaid(page, 0, sentence);

  expect(problems, problems.join("\n")).toEqual([]);
});

test("the settings sheet opens", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await page.locator("#settingsLink").click();
  await expect(page.locator("#voices")).toBeVisible();
  // Populated rather than merely present: the voice list comes from the
  // catalogue, which is the half that would be empty if the licence gate or
  // the package import had gone wrong.
  await expect(page.locator("#voiceList, #voiceHint")).not.toHaveCount(0);
});

/* The one entrance to the settings is at the foot of the sidebar (design.md
 * §3.4), and this holds that it is *reachable* there - on screen, without
 * scrolling anything, on a window the board does not fit in.
 *
 * It went wrong because the frame's height was a floor rather than a height:
 * a board taller than the window grew the page, the sidebar is stretched to
 * the page, and its foot went down with it. So the failure was not in the
 * sidebar at all, and it only appeared on a short window - which is every
 * laptop, and none of the twenty-odd specs that click #settingsLink, because
 * Playwright scrolls to whatever it clicks and never says that it had to.
 *
 * Hence a viewport shorter than the board and the precondition asserted
 * outright: if the board ever fits, this test proves nothing and should say so
 * rather than pass.
 */
test("the way into Einstellungen is on screen on a window the board does not fit", async ({ page }) => {
  /* Shorter than the window this used to need. The board became the device's
     own two rows of 4:3 cells, where it was five tall tiles with a field, a
     row of swatches and a colour picker in them, so 600px stopped being a
     window it overflows. The precondition below is what said so rather than
     letting this pass while testing nothing. */
  await page.setViewportSize({ width: 1280, height: 380 });
  await page.goto("./");
  await expect(page.locator("#device .cell")).toHaveCount(6);

  /* The board is taller than the window - the case this is about. Measured
   * against the window rather than against the column's own client height:
   * the broken layout has no scrolling column to compare with, and a
   * precondition that only holds once the bug is fixed would abort this test
   * on the very code it is meant to catch. */
  const tallerThanWindow = await page.evaluate(() =>
    document.querySelector("main")!.scrollHeight > window.innerHeight);
  expect(tallerThanWindow, "the board fits this window, so nothing here is being tested").toBe(true);

  // And the page does not scroll for it. The board does, inside its column.
  const pageScrolls = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollHeight > d.clientHeight;
  });
  expect(pageScrolls, "the whole page scrolls, so the sidebar scrolls away with it").toBe(false);

  // The foot of the sidebar, fully within the window, with nothing scrolled.
  const link = page.locator("#settingsLink");
  await expect(link).toBeVisible();
  const box = (await link.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(380);
});
