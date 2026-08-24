import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* Several Sammlungen in one browser: making them, switching, copying, deleting.
 *
 * happy.spec.ts asks whether somebody can make a collection. This asks whether they
 * can keep more than one - one per child, one per room - and tell them apart
 * afterwards. The failure it is really here for is the quiet one: switching
 * collection and finding the other collection's sentences, or an edit landing in the
 * collection that is not on screen. Both would look like the page having lost work,
 * and neither raises anything.
 *
 * The confirm dialog is checked here rather than only in the unit suite for a
 * reason worth writing down: it is a native <dialog>, and native dialog
 * behaviour is exactly what a non-browser host gets wrong. This suite runs the
 * built page in a real Chromium, which is the only place the answer counts.
 */

/** A label in whichever language the runner's browser picked, from the same
 *  table the page reads - asserting a literal here would pass on a German
 *  machine and fail in CI, or the other way round. */
const label = (key: string, params: Record<string, string | number> = {}) => {
  const one = (language: string) => {
    let text = (TEXTS as Record<string, Record<string, string>>)[language]![key]!;
    for (const name in params) text = text.split(`{${name}}`).join(String(params[name]));
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };
  return new RegExp(`^(${LANGUAGES.map(one).join("|")})$`);
};

const SAVED = label("ui.saved");

const rows = (page: Page) => page.locator("#collectionList .collections__item");

/** The default name, in whichever language the runner's browser picked.
 *
 *  The date is left as a pattern rather than formatted here: the page writes it
 *  in the page's language, so a literal would be asserting the runner's locale
 *  twice - once through the table and once through the separators, which are
 *  dots in German and slashes in English. What is being tested is that a new
 *  Sammlung is named for the day, not how a browser punctuates one. */
const namedForToday = () => new RegExp(
  `^(${LANGUAGES.map((l) =>
    (TEXTS as Record<string, Record<string, string>>)[l]["ui.collection_default"]!
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace("\\{date\\}", "[\\d./]+")).join("|")})$`);

/** A row by the name on it, which is what a person clicks. Positions move under
 *  this suite now - every write reorders the list - so nothing here addresses a
 *  Sammlung by its index.
 *
 *  Matched against the name span exactly, not as a substring of the row: the
 *  row also carries a count, so a substring match on the whole row would be
 *  comparing a name against a name and a number. */
const row = (page: Page, name: string) =>
  rows(page).filter({
    has: page.locator(".collections__name", {
      hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    }),
  });

/** Puts a collection on screen and waits until it is actually the one on screen.
 *
 * A row's press starts an async errand - write what is open, switch, re-read,
 * redraw - and the click returns long before it. The row gaining `active` is
 * the last thing that errand does, so it is the one honest signal that the
 * switch is over. Waiting on the collection's *content* instead is the trap: two
 * empty collections look identical, so an assertion that the key is empty passes
 * before the switch as happily as after it, and everything typed next lands in
 * the collection that is on its way out. That cost an afternoon. */
async function switchTo(page: Page, name: string) {
  await row(page, name).click();
  await expect(row(page, name)).toHaveClass(/active/);
}
/** The sentence inputs on the four speech keys, set tile excluded. */
const keyText = (page: Page) =>
  page.locator("#device .tile:not(.setTile) input[type=text]");

async function openCollection(page: Page) {
  await page.goto("./");
  await expect(page.locator("#device .tile")).toHaveCount(5);
}

/** Makes a Sammlung and gives it a name, the way somebody does: the field in
 *  the work head IS the rename, and it lands on blur.
 *
 *  The new one is at the top, not the bottom: the list is ordered by what was
 *  written last, and making one is a write. */
async function newCollection(page: Page, name: string) {
  const before = await rows(page).count();
  await page.locator("#collectionNew").click();
  await expect(rows(page)).toHaveCount(before + 1);
  /* The row appearing is not the end of the errand - making a Sammlung writes,
   * switches, re-reads, redraws, and only then puts the caret in the name.
   * Typing before that last step raced the repaint that follows it. Focus is
   * the signal because it is deliberately the last thing create() does, for
   * the same reason it does it at all: the name it invented is a suggestion to
   * type over. */
  await expect(page.locator("#collectionName")).toBeFocused();
  await page.locator("#collectionName").fill(name);
  await page.locator("#collectionName").blur();
  // That it is in the list, not where in the list: the order is last-written
  // first and two writes inside one millisecond sort by nothing, so asserting a
  // position here would be asserting the clock. Ordering has its own test.
  await expect(row(page, name)).toHaveCount(1);
}

test("a first visit has one collection, and it is open", async ({ page }) => {
  await openCollection(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveClass(/active/);
  // Named for the day it was made, not left blank for the list to paper over.
  // The name span, not the row: the row also carries the count.
  await expect(rows(page).first().locator(".collections__name"))
    .toHaveText(namedForToday());
});

test("three can be made, switched between, and keep their own words", async ({ page }) => {
  await openCollection(page);

  // The first visit's Sammlung is unnamed, so the list draws one for it.
  const first = (await rows(page).first().locator(".collections__name").innerText()).trim();
  await keyText(page).first().fill("The first one speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await newCollection(page, "Nursery");
  // A new one is empty rather than a copy of the one that was open.
  await expect(keyText(page).first()).toHaveValue("");
  await keyText(page).first().fill("The second one speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await newCollection(page, "Garden");
  await keyText(page).first().fill("The third one speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await expect(rows(page)).toHaveCount(3);

  // Back to the first, and it still says what was typed on it.
  await switchTo(page, first);
  await expect(keyText(page).first()).toHaveValue("The first one speaks");

  await switchTo(page, "Nursery");
  await expect(keyText(page).first()).toHaveValue("The second one speaks");
  await expect(page.locator("#collectionName")).toHaveValue("Nursery");

  // And all three survive the page being closed and opened again, which is
  // the whole of what "kept" means here.
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
  await expect(keyText(page).first()).toHaveValue("The second one speaks");
});

/* The order the sidebar shows: last written first. What makes it worth a test
 * is that it is the one thing about the list somebody could reasonably expect
 * to be creation order, and it is not. */
test("the one just edited is at the top of the list", async ({ page }) => {
  await openCollection(page);
  await newCollection(page, "Nursery");
  await newCollection(page, "Garden");
  await expect(rows(page).first()).toContainText("Garden");

  await switchTo(page, "Nursery");
  await keyText(page).first().fill("Something typed here");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await page.reload();
  await expect(rows(page).first()).toContainText("Nursery");
});

/* An edit is a debounced save, so switching collection straight after typing is the
 * race that loses work: the pending write fires after the other collection is on
 * screen and lands the old text under the new collection's stamp. */
test("typing and switching at once does not spill one collection into the other",
  async ({ page }) => {
    await openCollection(page);
    // Both named, because switching is by name and the first visit's is not.
    await page.locator("#collectionName").fill("Kitchen");
    await page.locator("#collectionName").blur();
    await expect(row(page, "Kitchen")).toHaveCount(1);
    await newCollection(page, "Second");
    // Something to tell the second one by, so that arriving on it is
    // distinguishable from not having left the first yet.
    await keyText(page).first().fill("Second collection");
    await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

    await switchTo(page, "Kitchen");
    await expect(keyText(page).first()).toHaveValue("");

    // And now the race this test is for: typed, and switched away from inside
    // the one-second debounce, with no wait for "saved" in between. The switch
    // writes what is on screen before it moves, or the pending write fires
    // afterwards and puts these words in the collection that is arriving.
    await keyText(page).first().fill("Meant for the first collection");
    await switchTo(page, "Second");
    await expect(keyText(page).first()).toHaveValue("Second collection");

    await switchTo(page, "Kitchen");
    await expect(keyText(page).first()).toHaveValue("Meant for the first collection");
  });

/* The two halves of a destructive question, and the second one is the half
 * that gets left untested: a dialog somebody closes has to cost nothing. */
test("deleting asks first, and a dismissed question deletes nothing", async ({ page }) => {
  await openCollection(page);
  await newCollection(page, "Doomed");
  await expect(rows(page)).toHaveCount(2);

  const dialog = page.getByRole("dialog", { name: label("ui.collection_delete") });

  // Dismissed with the other button.
  await page.locator("#collectionMenu").click();
  await page.locator(".menu button", { hasText: label("ui.collection_delete") }).click();
  await expect(dialog).toBeVisible();
  // It names the collection and says how much goes with it - the row in the list
  // shows a name only, so "delete this" alone does not say what is inside.
  await expect(dialog.locator(".body")).toContainText("Doomed");
  await dialog.locator(".foot button").first().click();
  await expect(dialog).not.toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  // Dismissed with Escape, which is the way out that answers nothing at all.
  await page.locator("#collectionMenu").click();
  await page.locator(".menu button", { hasText: label("ui.collection_delete") }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  // And then answered.
  await page.locator("#collectionMenu").click();
  await page.locator(".menu button", { hasText: label("ui.collection_delete") }).click();
  await dialog.locator(".foot button").last().click();
  await expect(dialog).not.toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  // Never a page with no collection on it: what took its place is open.
  await expect(rows(page).first()).toHaveClass(/active/);
  await expect(page.locator("#device .tile")).toHaveCount(5);
});

/* The failure that has no failing assertion.
 *
 * The confirm used to resolve from the dialog's `close` event alone, reading
 * returnValue. That is the tidier shape and it hangs forever on a host that
 * closes the dialog without firing the event: the caller sits awaiting a
 * promise for the life of the page, and what the person sees is a button that
 * did nothing - no error, no dialog, nothing in the console. It was found by
 * hand, because a promise that stays pending fails no test.
 *
 * So the host is made into that one here. close() still hides the dialog, and
 * fires nothing. If the shared confirm is ever simplified back to reading
 * returnValue in a close listener, the collection below survives and this goes red.
 */
test("a host that closes the dialog without firing the event still answers",
  async ({ page }) => {
    await page.addInitScript(() => {
      const real = HTMLDialogElement.prototype.close;
      HTMLDialogElement.prototype.close = function (value?: string) {
        // What a close does, minus the one thing the promise must not depend on.
        if (value !== undefined) this.returnValue = value;
        this.removeAttribute("open");
        void real;
      };
    });

    await openCollection(page);
    await newCollection(page, "Doomed");
    await expect(rows(page)).toHaveCount(2);

    await page.locator("#collectionMenu").click();
    await page.locator(".menu button", { hasText: label("ui.collection_delete") }).click();
    const sheet = page.getByRole("dialog", { name: label("ui.collection_delete") });
    await sheet.waitFor();
    await sheet.locator(".foot button").last().click();

    // The answer arrived, so the collection went. Before the guard, this stayed 2.
    await expect(rows(page)).toHaveCount(1);
  });

test("deleting the last collection leaves a fresh one rather than nothing", async ({ page }) => {
  await openCollection(page);
  await expect(rows(page)).toHaveCount(1);

  await page.locator("#collectionMenu").click();
  await page.locator(".menu button", { hasText: label("ui.collection_delete") }).click();
  await page.getByRole("dialog", { name: label("ui.collection_delete") })
    .locator(".foot button").last().click();

  // The seed steps in, the same as a first visit. A page with no collection on it
  // is the one outcome that has nothing to offer.
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await expect(keyText(page).first()).toHaveValue("");
});
