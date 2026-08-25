import { expect, test, type Locator, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { key, keySheet, openBoard, search, searchNear, searchNote } from "./diy.js";

/* What the search says when it does not work.
 *
 * It is the sheet's own search now rather than a dialog opened on top of the
 * board - both editors carry the picture, its search and the upload in the
 * left column of the sheet a press opens. What is under test is unchanged and
 * is not the markup: findSymbols() in src/shell/picker.ts is the one place
 * that decides which of these sentences a caller gets, and it is the seam both
 * sheets go through.
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
 *
 * And one answer that is not a failure. A search can come back full and still
 * not hold the word - "nicht" against a collection whose only near neighbour
 * is "nichtbinaer" - and that used to look exactly like a search that worked.
 * It is a fourth sentence rather than a third: the hits stay on the screen and
 * the line stands over them, which is why it is not written with say().
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

/** What it says about results it is still showing. */
const near = (box: Locator) => searchNear(box);

/** ARASAAC, holding exactly these words and nothing else.
 *
 *  The keyword a pictogram is filed under is what decides the whole of this
 *  file's fourth case, so it is given per search rather than fixed: a search
 *  for "nicht" answered by a pictogram called "nichtbinaer" is a full answer
 *  that holds nothing of what was asked. */
async function arasaacHolding(page: Page, held: Record<string, string[]>) {
  await page.route("**/api.arasaac.org/**", (route) => {
    const term = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    const keywords = held[term.toLowerCase()] ?? [];
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(keywords.map((keyword, at) => ({
        _id: 4242 + at, keywords: [{ keyword }],
      }))),
    });
  });
  await page.route("**/static.arasaac.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }));
}

/** ARASAAC, answering with one hit for "trinken" and nothing else. */
const arasaacAnswers = (page: Page) => arasaacHolding(page, { trinken: ["trinken"] });

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

test("a full answer that holds nothing of the word says so, and keeps it", async ({ page }) => {
  /* The case this was written for, with ARASAAC standing in for the
   * collection that showed it. METACOM has no "nicht" symbol - German AAC
   * negates by crossing out the symbol being negated - so a search for it came
   * back as a grid of "nichtbinaer" renderings wearing the same confident face
   * a real answer wears. Somebody had to know the collection to tell.
   *
   * Both halves are asserted here because either one alone is a different
   * feature: the sentence without the hits is an empty state, and the hits
   * without the sentence is what this replaced. */
  await arasaacHolding(page, { nicht: ["nichtbinaer"], trinken: ["trinken"] });

  const box = await openPicker(page);
  await searchFor(box, "nicht");

  await expect(near(box)).toHaveText(filled("ui.search_near", "nicht"));
  await expect(box.locator(".pick__hit")).toHaveCount(1);
  // Not one of the two sentences that replace the results: nothing here is
  // empty and nothing failed.
  await expect(note(box)).toHaveCount(0);

  // And the word the collection does hold gets no line at all - a line over
  // every answer is a line nobody reads.
  await searchFor(box, "trinken");
  await expect(box.locator(".pick__hit")).toHaveCount(1);
  await expect(near(box)).toBeHidden();
});
