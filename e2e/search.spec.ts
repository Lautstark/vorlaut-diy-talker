import { expect, test, type Locator, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { key, keySheet, openBoard, search, searchNote } from "./diy.js";

/* What the search says when it does not work.
 *
 * It is the sheet's own search now rather than a dialog opened on top of the
 * board - both editors carry the picture, its search and the upload in the
 * left column of the sheet a press opens. What is under test is unchanged and
 * is not the markup: findSymbols() in src/shell/picker.ts is the one place
 * that decides which of these three sentences a caller gets, and it is the
 * seam both sheets go through.
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

/** What the search says instead of results. say() writes a bare <p>. */
const note = (box: Locator) => searchNote(box);

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

/** A key's sheet, open, with its picture column showing. */
async function openPicker(page: Page): Promise<Locator> {
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await expect(box.locator(".pick")).toBeVisible();
  return box;
}

/** Enter runs it: there is no search button beside the field, because the
 *  sheet is not a form and Enter in a search field inside a dialog is
 *  otherwise the browser's own way to close it. */
const searchFor = (box: Locator, word: string) => search(box, word);

test("a collection that cannot be reached does not read as an empty one", async ({ page }) => {
  // Not a refusal and not an empty answer: no answer at all, which is what a
  // tablet off the wifi gets. bildquelle's providers must not throw, so this
  // reaches the page as [] and a status, and the status is the only place the
  // difference still exists.
  await page.route("**/api.arasaac.org/**", (route) => route.abort());

  const box = await openPicker(page);
  await searchFor(box, "trinken");

  await expect(note(box)).toHaveText(filled("ui.search_no_answer", "trinken"));
  await expect(note(box)).not.toHaveText(filled("ui.nothing_found", "trinken"));
});

test("a word the collection really does not hold still says so", async ({ page }) => {
  // The other side of the same line: ARASAAC answered, and answered nothing.
  // If this went to the failure sentence, the fix above would have replaced
  // one wrong message with another.
  await arasaacAnswers(page);

  const box = await openPicker(page);
  await searchFor(box, "Kaugummiautomat");

  await expect(note(box)).toHaveText(filled("ui.nothing_found", "Kaugummiautomat"));
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
  let box = await openPicker(page);
  page.on("request", (request) => {
    if (/\/assets\/.*\.js$/.test(request.url())) chunks.add(request.url());
  });
  await searchFor(box, "trinken");
  await expect(box.locator(".pick__hit")).toHaveCount(1);
  expect(chunks.size).toBeGreaterThan(0);

  // Again from cold, with exactly those chunks refused.
  const blocked = [...chunks];
  await page.route((url) => blocked.includes(url.href), (route) => route.abort());
  box = await openPicker(page);
  await searchFor(box, "trinken");

  await expect(note(box)).toHaveText(opening("ui.search_failed"));
  await expect(note(box)).not.toHaveText(filled("ui.nothing_found", "trinken"));
});
