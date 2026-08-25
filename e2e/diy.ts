import { expect, type Locator, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* Driving the five-key board, for the eleven specs that have to open one.
 *
 * It is one module because the board stopped being a place you type into. A
 * key's sentence used to be an <input> in a tile, so every spec that wanted a
 * board with something on it wrote `#device .tile input` and was done; now it
 * is a field in a sheet that a press opens and Fertig closes, and eleven
 * copies of that sequence is eleven places to fix the next time it moves.
 *
 * The same reasoning e2e/obz.ts is here for, and the same shape: helpers only,
 * no tests, so `playwright test` does not pick it up as a spec.
 *
 * What it deliberately does not hide is the assertions. `put()` drives the
 * controls a person drives - it does not write a layout into the store -
 * because the sheet is exactly what these specs are now covering on the way
 * past.
 */

const table = TEXTS as Record<string, Record<string, string>>;

/** A label in whichever language the runner's browser picked, from the same
 *  table the page reads - asserting a literal here would pass on a German
 *  machine and fail in CI, or the other way round. */
export const label = (key: string) => new RegExp(
  `^(${LANGUAGES.map((l) => table[l][key]!
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

/** The six cells of the board: the hole, the set key and the four speech keys,
 *  in the reading order src/editor-diy/editor.ts's CELLS lays them out in.
 *
 *      0 hole     1 key 1    2 key 2
 *      3 set key  4 key 3    5 key 4
 */
export const cells = (page: Page) => page.locator("#device .cell");

/** The cell index a speech slot is drawn in. The four slots are the 2x2 block
 *  to the right of the speaker and the set key, which is where the hardware
 *  puts them - docs/hardware.md. */
export const KEY_CELL = [1, 2, 4, 5] as const;

/** What a press on a speech key lands on. The cell is the box around it. */
export const key = (page: Page, slot: number) =>
  cells(page).nth(KEY_CELL[slot]!).locator(".cell__open");

/** The set key, bottom left, which opens the set's own card - it is the set,
 *  drawn as the thing the device shows. */
export const setKey = (page: Page) => cells(page).nth(3).locator(".cell__open");

/** The one open sheet, named by its heading rather than by its whole text.
 *
 * `hasText` matches against everything inside the element, so an anchored
 * label matched against a <dialog> is matched against its title *and* its body
 * *and* its buttons - which never matches, and reads like the dialog failing
 * to open. The heading is the part that names it. */
export const sheet = (page: Page, key: string) => page.locator("dialog[open]")
  .filter({ has: page.getByRole("heading", { name: label(key) }) });

/** The sheet a press on a speech key opens. */
export const keySheet = (page: Page) => sheet(page, "ui.diy_key_title");
/** The card the ⋯ on the current tab and the set key both open. */
export const setCard = (page: Page) => sheet(page, "ui.set_title");

/** Presses a foot button by its label. */
export const press = (box: Locator, key: string) =>
  box.locator(".foot button", { hasText: label(key) }).click();

/** A board, open and drawn. Six cells, which is the assertion that the editor
 *  came up at all - it was five tiles before the board became the device's own
 *  2x3 with the speaker's hole in it. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto("./");
  await expect(cells(page)).toHaveCount(6);
}

/** The word one speech key is drawn with.
 *
 * Read off the cell rather than out of a field, because there is no field on
 * the board any more: the word on a cell is what the editor believes, which is
 * the thing worth asserting. An empty key has no word element at all, so the
 * locator resolves to nothing rather than to "".
 */
export const word = (page: Page, slot: number) =>
  cells(page).nth(KEY_CELL[slot]!).locator(".cell__word");

/** What one speech key says, once it says it.
 *
 * A retrying assertion rather than a read, and that is not a detail: switching
 * Sammlung and reloading both go through IndexedDB, so the board on screen at
 * the moment of a bare `textContent()` is still the previous one about half
 * the time. A one-shot read of it passed locally and failed under load, which
 * is the worst shape a test can have.
 *
 * "" asserts the key is empty, which is the absence of the element rather than
 * an element holding nothing.
 */
export async function expectSaid(page: Page, slot: number, text: string): Promise<void> {
  if (!text) await expect(word(page, slot)).toHaveCount(0);
  else await expect(word(page, slot)).toHaveText(text);
}

/** Puts a sentence on one speech key, through the sheet a person would use.
 *
 * Nothing is written until Fertig - see the head of src/shell/sheet.ts - so
 * this is also what exercises that, on the way to every board these specs
 * need.
 */
export async function put(page: Page, slot: number, text: string): Promise<void> {
  await key(page, slot).click();
  const box = keySheet(page);
  await expect(box).toBeVisible();
  await box.locator("#diyKeyText").fill(text);
  await press(box, "ui.done");
  await expect(box).toHaveCount(0);
  await expect(cells(page).nth(KEY_CELL[slot]!).locator(".cell__word"))
    .toHaveText(text);
}

/** Names the set on screen, through its card. */
export async function nameSet(page: Page, name: string): Promise<void> {
  await setKey(page).click();
  const card = setCard(page);
  await expect(card).toBeVisible();
  await card.locator("#diySetName").fill(name);
  await press(card, "ui.done");
  await expect(card).toHaveCount(0);
}

/** The sheet's own picture column, which is where a symbol is chosen now: a
 *  sheet carries its own search rather than opening the picker dialog on top
 *  of itself. */
export const pick = (box: Locator) => box.locator(".pick");
export const query = (box: Locator) => box.locator(".pick input[type=search]");
export const hits = (box: Locator) => box.locator(".pick__hit");
/** What a search says when it has nothing to show: say() writes a bare <p>. */
export const searchNote = (box: Locator) => box.locator(".pick__results p");

/** Types a word into the sheet's search and runs it. Enter, because that is
 *  what the field answers to - there is no search button beside it. */
export async function search(box: Locator, word: string): Promise<void> {
  await query(box).fill(word);
  await query(box).press("Enter");
}
