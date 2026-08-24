import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* Several boards in one browser: making them, switching, copying, deleting.
 *
 * happy.spec.ts asks whether somebody can make a board. This asks whether they
 * can keep more than one - one per child, one per room - and tell them apart
 * afterwards. The failure it is really here for is the quiet one: switching
 * board and finding the other board's sentences, or an edit landing in the
 * board that is not on screen. Both would look like the page having lost work,
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

const rows = (page: Page) => page.locator("#boardList .boardRow");

/** Puts a board on screen and waits until it is actually the one on screen.
 *
 * A row's press starts an async errand - write what is open, switch, re-read,
 * redraw - and the click returns long before it. The row gaining `active` is
 * the last thing that errand does, so it is the one honest signal that the
 * switch is over. Waiting on the board's *content* instead is the trap: two
 * empty boards look identical, so an assertion that the key is empty passes
 * before the switch as happily as after it, and everything typed next lands in
 * the board that is on its way out. That cost an afternoon. */
async function switchTo(page: Page, at: number) {
  await rows(page).nth(at).click();
  await expect(rows(page).nth(at)).toHaveClass(/active/);
}
/** The sentence inputs on the four speech keys, set tile excluded. */
const keyText = (page: Page) =>
  page.locator("#device .tile:not(.setTile) input[type=text]");

async function openBoard(page: Page) {
  await page.goto("./");
  await expect(page.locator("#device .tile")).toHaveCount(5);
}

/** Makes a board and gives it a name, the way somebody does: the field in the
 *  header IS the rename, and it lands on blur. */
async function newBoard(page: Page, name: string) {
  const before = await rows(page).count();
  await page.locator("#boardNew").click();
  await expect(rows(page)).toHaveCount(before + 1);
  await page.locator("#boardName").fill(name);
  await page.locator("#boardName").blur();
  await expect(rows(page).last()).toHaveText(name);
}

test("a first visit has one board, and it is open", async ({ page }) => {
  await openBoard(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveClass(/active/);
  // Unnamed, so the list draws a name for it rather than showing a blank row.
  await expect(rows(page).first()).toHaveText(label("ui.board_n", { n: 1 }));
});

test("three boards can be made, switched between, and keep their own words", async ({ page }) => {
  await openBoard(page);

  await keyText(page).first().fill("Board one speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await newBoard(page, "Nursery");
  // A new board is empty rather than a copy of the one that was open.
  await expect(keyText(page).first()).toHaveValue("");
  await keyText(page).first().fill("Board two speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await newBoard(page, "Garden");
  await keyText(page).first().fill("Board three speaks");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await expect(rows(page)).toHaveCount(3);

  // Back to the first, and it still says what was typed on it.
  await switchTo(page, 0);
  await expect(keyText(page).first()).toHaveValue("Board one speaks");

  await switchTo(page, 1);
  await expect(keyText(page).first()).toHaveValue("Board two speaks");
  await expect(page.locator("#boardName")).toHaveValue("Nursery");

  // And all three survive the page being closed and opened again, which is
  // the whole of what "kept" means here.
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
  await expect(keyText(page).first()).toHaveValue("Board two speaks");
});

/* An edit is a debounced save, so switching board straight after typing is the
 * race that loses work: the pending write fires after the other board is on
 * screen and lands the old text under the new board's stamp. */
test("typing and switching at once does not spill one board into the other",
  async ({ page }) => {
    await openBoard(page);
    await newBoard(page, "Second");
    // Something to tell the second board by, so that arriving on it is
    // distinguishable from not having left the first yet.
    await keyText(page).first().fill("Second board");
    await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

    await switchTo(page, 0);
    await expect(keyText(page).first()).toHaveValue("");

    // And now the race this test is for: typed, and switched away from inside
    // the one-second debounce, with no wait for "saved" in between. The switch
    // writes what is on screen before it moves, or the pending write fires
    // afterwards and puts these words in the board that is arriving.
    await keyText(page).first().fill("Meant for the first board");
    await switchTo(page, 1);
    await expect(keyText(page).first()).toHaveValue("Second board");

    await switchTo(page, 0);
    await expect(keyText(page).first()).toHaveValue("Meant for the first board");
  });

test("a duplicate is a board of its own, and editing it leaves the original alone",
  async ({ page }) => {
    await openBoard(page);
    await page.locator("#boardName").fill("Kitchen");
    await page.locator("#boardName").blur();
    await keyText(page).first().fill("The original");
    await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

    await page.locator("#boardMenu").click();
    await page.locator(".menu button", { hasText: label("ui.board_duplicate") }).click();

    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(1)).toHaveClass(/active/);
    await expect(keyText(page).first()).toHaveValue("The original");

    // The copy is what is open. Editing it must not reach the board it came
    // from - which is the whole reason a copy gets an identity of its own.
    await keyText(page).first().fill("Only on the copy");
    await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });
    await switchTo(page, 0);
    await expect(keyText(page).first()).toHaveValue("The original");
  });

/* The two halves of a destructive question, and the second one is the half
 * that gets left untested: a dialog somebody closes has to cost nothing. */
test("deleting asks first, and a dismissed question deletes nothing", async ({ page }) => {
  await openBoard(page);
  await newBoard(page, "Doomed");
  await expect(rows(page)).toHaveCount(2);

  const dialog = page.getByRole("dialog", { name: label("ui.board_delete") });

  // Dismissed with the other button.
  await page.locator("#boardMenu").click();
  await page.locator(".menu button", { hasText: label("ui.board_delete") }).click();
  await expect(dialog).toBeVisible();
  // It names the board and says how much goes with it - the row in the list
  // shows a name only, so "delete this" alone does not say what is inside.
  await expect(dialog.locator(".body")).toContainText("Doomed");
  await dialog.locator(".foot button").first().click();
  await expect(dialog).not.toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  // Dismissed with Escape, which is the way out that answers nothing at all.
  await page.locator("#boardMenu").click();
  await page.locator(".menu button", { hasText: label("ui.board_delete") }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  // And then answered.
  await page.locator("#boardMenu").click();
  await page.locator(".menu button", { hasText: label("ui.board_delete") }).click();
  await dialog.locator(".foot button").last().click();
  await expect(dialog).not.toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  // Never a page with no board on it: what took its place is open.
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
 * returnValue in a close listener, the board below survives and this goes red.
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

    await openBoard(page);
    await newBoard(page, "Doomed");
    await expect(rows(page)).toHaveCount(2);

    await page.locator("#boardMenu").click();
    await page.locator(".menu button", { hasText: label("ui.board_delete") }).click();
    const sheet = page.getByRole("dialog", { name: label("ui.board_delete") });
    await sheet.waitFor();
    await sheet.locator(".foot button").last().click();

    // The answer arrived, so the board went. Before the guard, this stayed 2.
    await expect(rows(page)).toHaveCount(1);
  });

test("deleting the last board leaves a fresh one rather than nothing", async ({ page }) => {
  await openBoard(page);
  await expect(rows(page)).toHaveCount(1);

  await page.locator("#boardMenu").click();
  await page.locator(".menu button", { hasText: label("ui.board_delete") }).click();
  await page.getByRole("dialog", { name: label("ui.board_delete") })
    .locator(".foot button").last().click();

  // The seed steps in, the same as a first visit. A page with no board on it
  // is the one outcome that has nothing to offer.
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await expect(keyText(page).first()).toHaveValue("");
});
