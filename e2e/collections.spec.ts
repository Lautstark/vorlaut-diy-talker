import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { expectSaid, put } from "./diy.js";
import { openCollectionSettings, openPanel, pickFromMenu } from "./sheets.js";

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

/** The device language of whichever Sammlung is open, out of the database
 *  rather than off the screen. The same read e2e/language.spec.ts makes, and
 *  for the same reason: the layout is where this field has to end up for a
 *  flashed talker to show its menu in it. */
const inTheLayout = (page: Page) =>
  page.evaluate(() => new Promise<string | null>((resolve) => {
    const open = indexedDB.open("vorlaut");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
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

async function openCollection(page: Page) {
  await page.goto("./");
  await expect(page.locator("#device .cell")).toHaveCount(6);
}

/** Makes a Sammlung and gives it a name, the way somebody does: the field in
 *  the work head IS the rename, and it lands on blur.
 *
 *  The new one is at the top, not the bottom: the list is ordered by what was
 *  written last, and making one is a write. */
async function newCollection(page: Page, name: string) {
  const before = await rows(page).count();
  await page.locator("#collectionNew").click();
  /* Which editor it is for, asked once and never again. Nothing is written
   * until it is answered - dismissing this makes no Sammlung at all - so this
   * is part of making one rather than a step after it.
   *
   * The talker, because that is what everything below this helper is about.
   * The tablet's own path is e2e/editor_app.spec.ts. */
  const asked = page.locator("dialog[open]")
    .filter({ has: page.getByRole("heading", { name: label("ui.collection_target") }) });
  await expect(asked).toBeVisible();
  await asked.locator("button.choice")
    .filter({ has: page.locator("strong", { hasText: label("ui.collection_target_diy") }) })
    .click();
  // The choice selects; the footer makes it. Two presses because the tablet
  // has a second question inside this one - how big a page is - and a choice
  // that made the Sammlung on the way past would ask it too late.
  await asked.locator("button", { hasText: label("ui.collection_create") }).click();
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

/* --- what the ⋯ holds about one Sammlung ---------------------------------- */

/** The languages by their own names, which is what both language controls
 *  offer - "Deutsch" stays "Deutsch" whatever the page is set to. */
const OWN_NAME: Record<string, string> = { de: "Deutsch", en: "English" };

/** Makes one of whichever target and stops on the dialog, unanswered. */
async function askTarget(page: Page, target: "diy" | "app") {
  await page.locator("#collectionNew").click();
  const asked = page.locator("dialog[open]")
    .filter({ has: page.getByRole("heading", { name: label("ui.collection_target") }) });
  await expect(asked).toBeVisible();
  await asked.locator("button.choice")
    .filter({ has: page.locator("strong",
                                { hasText: label(`ui.collection_target_${target}`) }) })
    .click();
  return asked;
}

/* The two target-conditional questions, and that each is asked of exactly one
 * target.
 *
 * Both halves matter and one of them was silently broken: .sizeask carries
 * `display: grid`, which is an author rule and beats the user agent's
 * [hidden], so setting .hidden on the grid question did nothing at all and it
 * sat under the talker choice offering to size a board with no grid. Asserting
 * visibility rather than the attribute is what catches that - the attribute
 * was correct the whole time.
 */
test("the create dialog asks the talker about a language and the tablet about a grid",
  async ({ page }) => {
    await openCollection(page);

    const forDiy = await askTarget(page, "diy");
    const lang = forDiy.locator("#collectionNewLangLabel");
    await expect(lang).toBeVisible();
    await expect(forDiy.getByRole("group", { name: label("ui.app_grid_size") }))
      .toBeHidden();

    // The same dialog, the other choice: the two swap over rather than adding
    // up, because they are answers to different questions about different
    // hardware.
    await forDiy.locator("button.choice")
      .filter({ has: page.locator("strong",
                                  { hasText: label("ui.collection_target_app") }) })
      .click();
    await expect(lang).toBeHidden();
    await expect(forDiy.getByRole("group", { name: label("ui.app_grid_size") }))
      .toBeVisible();
  });

/* The answer is carried into the Sammlung, which is the half a hidden control
 * cannot prove. It is pre-filled from the page's language, so this changes it
 * to the other one - a guess that happened to be right would pass with the
 * field wired to nothing at all. */
test("the language chosen while making a talker Sammlung is the one it keeps",
  async ({ page }) => {
    await openCollection(page);
    const asked = await askTarget(page, "diy");

    const page_language = await page.evaluate(() => document.documentElement.lang);
    const other = page_language === "de" ? "en" : "de";
    await asked.locator("#collectionNewLangLabel + .menu-anchor button").click();
    await page.getByRole("menuitemradio", { name: OWN_NAME[other], exact: true }).click();
    await asked.locator("button", { hasText: label("ui.collection_create") }).click();
    await expect(page.locator("#collectionName")).toBeFocused();

    // Read off the stored layout rather than off the control that set it: a
    // field that only paints itself is a field wired to nothing.
    await expect.poll(() => inTheLayout(page)).toBe(other);

    // And the sheet behind the ⋯ says the same thing, which is where somebody
    // would go to change it afterwards.
    await openCollectionSettings(page);
    await openPanel(page, "#collectionLanguagePanel");
    await expect(page.locator("#collectionLangPick")).toHaveText(OWN_NAME[other]);
  });

/* Which panels a Sammlung's own sheet has, by target.
 *
 * The language is the talker's alone: on a tablet package localeFor() reads
 * the locale off the chosen voice first, so the field is nearly vestigial
 * there and offering it would be a control with nothing downstream of it. The
 * voice is both targets' - it is what every recording is spoken with either
 * way.
 */
test("the Sammlung's sheet offers the language to a talker and not to a tablet",
  async ({ page }) => {
    await openCollection(page);
    await openCollectionSettings(page);
    await expect(page.locator("#collectionLanguagePanel")).toBeVisible();
    await expect(page.locator("#voicePanel")).toBeVisible();
    await page.locator("#collectionSheetClose").click();

    const asked = await askTarget(page, "app");
    await asked.locator("button", { hasText: label("ui.collection_create") }).click();
    await expect(page.locator("#collectionName")).toBeFocused();

    await openCollectionSettings(page);
    await expect(page.locator("#collectionLanguagePanel")).toBeHidden();
    // And the voice is still asked, which is what makes it a sheet rather than
    // an empty one.
    await expect(page.locator("#voicePanel")).toBeVisible();
    await expect(page.locator("#voicePanel")).toHaveAttribute("open", "");
  });

/* What the ⋯ offers, by target, in the order it offers it.
 *
 * The order is the claim: the acts on a Sammlung first, then what it is set
 * to, then the delete which stays last wherever it appears. A tablet has no
 * .obz - obf.ts writes the five-key device - and no build, because the build
 * is a talker's file system; it has the grid card instead. */
test("the ⋯ holds this Sammlung's acts, then its settings, then the delete",
  async ({ page }) => {
    await openCollection(page);
    await page.locator("#collectionMenu").click();
    const entries = page.locator('[role="menuitem"]');
    await expect(entries).toHaveText([
      label("ui.collection_export"), label("ui.collection_export_app"),
      label("ui.build_export"), label("ui.collection_settings"),
      label("ui.collection_delete"),
    ]);
    await page.keyboard.press("Escape");

    const asked = await askTarget(page, "app");
    await asked.locator("button", { hasText: label("ui.collection_create") }).click();
    await expect(page.locator("#collectionName")).toBeFocused();

    await page.locator("#collectionMenu").click();
    await expect(entries).toHaveText([
      label("ui.app_grid"), label("ui.collection_settings"),
      label("ui.collection_delete"),
    ]);
  });

/* The build is an act on one Sammlung, so it is in the ⋯ beside the name of
 * the one it would build - not in Einstellungen, which is about this browser.
 * Where it lands is e2e/build.spec.ts's; that it is not left behind in the
 * settings sheet is this one's. */
test("the settings sheet has no per-Sammlung control left in it", async ({ page }) => {
  await openCollection(page);
  await page.locator("#settingsLink").click();
  await expect(page.locator("#voices")).toBeVisible();
  for (const gone of ["#voicePanel", "#collectionLanguagePanel", "#buildExport"]) {
    await expect(page.locator(`#voices ${gone}`)).toHaveCount(0);
  }
});

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
  await put(page, 0, "The first one speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await newCollection(page, "Nursery");
  // A new one is empty rather than a copy of the one that was open.
  await expectSaid(page, 0, "");
  await put(page, 0, "The second one speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await newCollection(page, "Garden");
  await put(page, 0, "The third one speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await expect(rows(page)).toHaveCount(3);

  // Back to the first, and it still says what was typed on it.
  await switchTo(page, first);
  await expectSaid(page, 0, "The first one speaks");

  await switchTo(page, "Nursery");
  await expectSaid(page, 0, "The second one speaks");
  await expect(page.locator("#collectionName")).toHaveValue("Nursery");

  // And all three survive the page being closed and opened again, which is
  // the whole of what "kept" means here.
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
  await expectSaid(page, 0, "The second one speaks");
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
  await put(page, 0, "Something typed here");
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
    await put(page, 0, "Second collection");
    await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

    await switchTo(page, "Kitchen");
    await expectSaid(page, 0, "");

    // And now the race this test is for: typed, and switched away from inside
    // the one-second debounce, with no wait for "saved" in between. The switch
    // writes what is on screen before it moves, or the pending write fires
    // afterwards and puts these words in the collection that is arriving.
    await put(page, 0, "Meant for the first collection");
    await switchTo(page, "Second");
    await expectSaid(page, 0, "Second collection");

    await switchTo(page, "Kitchen");
    await expectSaid(page, 0, "Meant for the first collection");
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
  await expect(page.locator("#device .cell")).toHaveCount(6);
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
        /* A real close, minus the one thing a promise must not depend on.
         *
         * This used to skip the real close and drop the `open` attribute
         * instead, which suppressed the event but also left the dialog in the
         * top layer - so the rest of the page stayed inert for ever after.
         * That was invisible while only one dialog was ever opened here and
         * nothing was pressed afterwards; it stopped being invisible when
         * making a Sammlung grew a question of its own, and every later step
         * failed for a reason that had nothing to do with what is under test.
         *
         * A capture listener on the dialog itself runs before any listener the
         * page registered on it, so stopping propagation there swallows the
         * event and nothing else. */
        if (value !== undefined) this.returnValue = value;
        this.addEventListener("close",
          (event) => event.stopImmediatePropagation(),
          { capture: true, once: true });
        real.call(this);
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
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await expectSaid(page, 0, "");
});

/* A rename lands on the Sammlung it was typed for, and not on the next one.
 *
 * The field is debounced, so between the last keystroke and the write there is
 * a window - and switching Sammlung inside it is not a strange thing to do, it
 * is what somebody does when they rename one and immediately go back to the one
 * they were working in. If the write reads "the open Sammlung" when it finally
 * runs rather than the one that was open when it was typed, the name lands on
 * whichever one is on screen by then: the Sammlung they switched *to* silently
 * takes the name they gave to the one they switched *from*.
 *
 * What keeps it right here is an ordering rather than a precaution: pressing a
 * row moves focus off the field first, the blur writes, and only then does the
 * switch happen - so by the time anything reads "the open Sammlung" the write
 * has already used the right one. That is worth a test precisely because it is
 * an ordering nobody wrote down. The obvious ways to break it are a switch that
 * does not go through a press, and a write that stops flushing on blur; both
 * would leave every other test in this file green.
 *
 * bildhaft does not rely on the ordering - it captures the id on the keystroke
 * instead - and @lautstark/design/rename leaves the choice to the caller on
 * purpose, because it owns the timing and not what is being renamed.
 *
 * A real-input test rather than a unit one, because the whole thing turns on
 * where focus is, and focus is exactly what a page poked from a console has
 * not got: driven that way the blur never fires, the debounce comes due after
 * the switch, and the name lands on the Sammlung that was switched to. That is
 * the failure this pins - it is just not reachable with a mouse.
 */
test("a rename lands on the collection it was typed for, not the next one", async ({ page }) => {
  await openCollection(page);
  // The seeded one has to be on screen before another is made: newCollection()
  // counts the rows first, and counting them before the first paint lands
  // makes every count after it one short.
  await expect(rows(page)).toHaveCount(1);
  await newCollection(page, "Kitchen");
  await newCollection(page, "Nursery");

  // Nursery is open. Type a new name for it and, without waiting for the write,
  // click Kitchen.
  await page.locator("#collectionName").fill("Bathroom");
  await row(page, "Kitchen").click();

  // Kitchen is what is open, and it is still called Kitchen.
  await expect(page.locator("#collectionName")).toHaveValue("Kitchen");
  await expect(row(page, "Kitchen")).toHaveCount(1);
  // The name went where it was typed.
  await expect(row(page, "Bathroom")).toHaveCount(1);
  await expect(row(page, "Nursery")).toHaveCount(0);

  // And it survives a reload, so this is the store and not just the drawing.
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
  await expect(row(page, "Bathroom")).toHaveCount(1);
  await expect(row(page, "Kitchen")).toHaveCount(1);
});
