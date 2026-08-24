import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* What the picker says when a search does not work.
 *
 * searchActive() used to catch everything and return [], so every way a search
 * could fail arrived at the dialog wearing the same words: "nichts gefunden zu
 * X". A browser with no network was told the collection held nothing about a
 * word it holds thousands of, and the arm in doSearch() that was written to
 * report a failure had been dead since it was written.
 *
 * Two failures are worth telling apart and both are here: the collection that
 * cannot be reached, which bildquelle reports as a status rather than by
 * throwing, and the search that could not be run at all.
 */

const table = TEXTS as Record<string, Record<string, string>>;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole sentence out of the table, in whichever language the runner picked. */
const filled = (key: string, word: string) => new RegExp(
  `^(${LANGUAGES.map((l) => escape(table[l][key].split("{word}").join(word))).join("|")})$`);

/** The part of a sentence before the raw error it carries. */
const opening = (key: string) => new RegExp(
  `^(${LANGUAGES.map((l) => escape(table[l][key].split("{")[0])).join("|")})`);

const note = (page: Page) => page.locator("#results p");

/** ARASAAC, answering with one hit for "trinken" and nothing else. */
async function arasaacAnswers(page: Page) {
  await page.route("**/api.arasaac.org/**", (route) => {
    const term = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(term.toLowerCase() === "trinken"
        ? [{ _id: 4242, keywords: [{ keyword: "trinken" }] }]
        : []),
    });
  });
  await page.route("**/static.arasaac.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }));
}

async function openPicker(page: Page) {
  await page.goto("./");
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await page.locator("#device .tile:not(.setTile) .thumb").first().click();
  await expect(page.locator("#picker")).toBeVisible();
}

async function searchFor(page: Page, word: string) {
  await page.locator("#q").fill(word);
  await page.locator("#searchBtn").click();
}

test("a collection that cannot be reached does not read as an empty one", async ({ page }) => {
  // Not a refusal and not an empty answer: no answer at all, which is what a
  // tablet off the wifi gets. bildquelle's providers must not throw, so this
  // reaches the page as [] and a status, and the status is the only place the
  // difference still exists.
  await page.route("**/api.arasaac.org/**", (route) => route.abort());

  await openPicker(page);
  await searchFor(page, "trinken");

  await expect(note(page)).toHaveText(filled("ui.search_no_answer", "trinken"));
  await expect(note(page)).not.toHaveText(filled("ui.nothing_found", "trinken"));
});

test("a word the collection really does not hold still says so", async ({ page }) => {
  // The other side of the same line: ARASAAC answered, and answered nothing.
  // If this went to the failure sentence, the fix above would have replaced
  // one wrong message with another.
  await arasaacAnswers(page);

  await openPicker(page);
  await searchFor(page, "Kaugummiautomat");

  await expect(note(page)).toHaveText(filled("ui.nothing_found", "Kaugummiautomat"));
});

test("a search that could not be run says so, rather than finding nothing", async ({ page }) => {
  /* The German tables are a lazy chunk - 42 KB nobody should pay for until a
   * word is typed - and they are fetched, so they can fail to arrive. That
   * used to be swallowed into "nichts gefunden", which is the worst of the
   * three: the collection is fine, the word is fine, and the page never
   * managed to ask.
   *
   * Which chunk it is has a content hash in its name, so it is watched for
   * rather than named: the first search below is only there to find out what
   * the second one has to be denied.
   *
   * The sentence tells the reader to reload, and that is not a platitude. A
   * module that failed to fetch is remembered as failed by the browser for as
   * long as the document lives - a retried import() rejects without asking
   * again - so reloading really is the only way out of it. */
  await arasaacAnswers(page);

  const chunks = new Set<string>();
  await openPicker(page);
  page.on("request", (request) => {
    if (/\/assets\/.*\.js$/.test(request.url())) chunks.add(request.url());
  });
  await searchFor(page, "trinken");
  await expect(page.locator("#results figure")).toHaveCount(1);
  expect(chunks.size).toBeGreaterThan(0);

  // Again from cold, with exactly those chunks refused.
  const blocked = [...chunks];
  await page.route((url) => blocked.includes(url.href), (route) => route.abort());
  await openPicker(page);
  await searchFor(page, "trinken");

  await expect(note(page)).toHaveText(opening("ui.search_failed"));
  await expect(note(page)).not.toHaveText(filled("ui.nothing_found", "trinken"));
});
