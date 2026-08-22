import { expect, test } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

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
  await expect(page.locator("#device .tile")).toHaveCount(5);
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
  await expect(page.locator("#device .tile")).toHaveCount(5);

  /* A key's sentence, not the set's name and not the colour field - the set
   * tile carries both of those and comes first in the document. */
  const keyText = page.locator("#device .tile:not(.setTile) input[type=text]");
  const sentence = "Ich will nach draussen";
  await keyText.first().fill(sentence);

  /* The save is debounced, so the reload has to wait for it. The status line
   * saying so is the page's own signal that it landed, which is a better thing
   * to wait on than a timer somebody would have to keep tuning. */
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await page.reload();
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await expect(keyText.first()).toHaveValue(sentence);

  expect(problems, problems.join("\n")).toEqual([]);
});

test("the settings sheet opens", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await page.locator("#gear").click();
  await expect(page.locator("#voices")).toBeVisible();
  // Populated rather than merely present: the voice list comes from the
  // catalogue, which is the half that would be empty if the licence gate or
  // the package import had gone wrong.
  await expect(page.locator("#voiceList, #voiceHint")).not.toHaveCount(0);
});
