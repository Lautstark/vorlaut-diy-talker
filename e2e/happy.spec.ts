import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  KEY_CELL, cells, expectSaid, key, keySheet, label, nameSet, openBoard, press, within,
  put, search, searchNote, setCard, setKey, word,
} from "./diy.js";
import { openSettings, openVoices } from "./sheets.js";

/* The whole editing loop, end to end, in one browser.
 *
 * page.spec.ts asks whether the page opens; this asks whether somebody can
 * actually make a board with it. It exists because the deployed page shipped
 * with the loop broken in two places no smaller test saw: the play button
 * refused every press because the seam forgot that "" means the board's own
 * voice, and a symbol upload had never worked because an unawaited Promise is
 * truthy. Each step below is one of the things a parent sitting down with this
 * for an evening would do.
 *
 * What it deliberately does not do is speak. A real synthesis fetches a piper
 * model from a CDN - tens of megabytes, minutes of onnx - and what it would
 * prove is stimmquelle's business, tested in that repository. The line drawn
 * here is: everything up to the seam, and the page's own answer when there is
 * no voice to speak with.
 *
 * ## What moved, and why so much of it
 *
 * The board stopped being a place you type into. A key was a tile holding a
 * thumb, a sentence field and a play button; it is a cell now, and everything
 * about it is in a sheet a press opens - the same arrangement editor-app has,
 * which is what the convergence was for. So the sentences below are typed
 * through that sheet, by e2e/diy.ts's put(), and what the board is asked for
 * is what it *draws*.
 *
 * That is a better question than the one this file used to ask. A filled field
 * proves the field was filled; a word on a cell proves the editor believes it,
 * which is the thing a person actually looks at.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const SAVED = label("ui.saved");

/** Opens the Board panel inside the settings sheet, whatever state the
 *  <details> was left in - it keeps its fold across closings of the sheet. */
async function openBoardPanel(page: Page) {
  await openSettings(page);
  const panel = page.locator("#boardPanel");
  if ((await panel.getAttribute("open")) === null) {
    await panel.locator("summary").click();
  }
}

test("the board is the device: a hole, the set key and four speech keys", async ({ page }) => {
  /* The arrangement, asserted because it is the thing that was wrong. This
   * editor drew a set tile and four tiles in a row of three while
   * data/obf.ts's grid() exported two rows of three with a hole in it, so the
   * one screen somebody arranges a board on disagreed with the file that board
   * becomes. docs/hardware.md is the authority for both. */
  await openBoard(page);
  await expect(cells(page).nth(0)).toHaveClass(/cell--hole/);
  await expect(cells(page).nth(3)).toHaveClass(/cell--setkey/);
  // The hole is neither a control nor a drop target: nothing in it is
  // focusable and it cannot be dragged.
  await expect(cells(page).nth(0).locator(".cell__open")).toHaveCount(0);
  await expect(cells(page).nth(0)).not.toHaveAttribute("draggable", "true");
  // Nor does the set key move: its position is the hardware's.
  await expect(cells(page).nth(3)).not.toHaveAttribute("draggable", "true");
  // The four that do.
  for (const at of KEY_CELL) {
    await expect(cells(page).nth(at)).toHaveAttribute("draggable", "true");
  }
});

test("a set can be named, coloured, filled and kept", async ({ page }) => {
  await openBoard(page);

  await nameSet(page, "Morgens");
  await put(page, 0, "Ich will nach draussen");

  // The colour is one row in the set's card now, and one control in it: the
  // swatches. It was three - swatches, a colour input and a hex field - spread
  // through a tile, which is why moving it was worth doing before the firmware
  // stops reading it at all.
  await setKey(page).click();
  const card = setCard(page);
  await card.locator(".swatch").nth(1).click();
  await expect(card.locator(".swatch.active")).toHaveCount(1);
  await press(card, "ui.done");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await page.reload();
  await expect(cells(page)).toHaveCount(6);
  await expect(cells(page).nth(3).locator(".cell__word")).toHaveText("Morgens");
  await expectSaid(page, 0, "Ich will nach draussen");
});

test("a dismissed sheet writes nothing", async ({ page }) => {
  /* The rule the whole draft model exists for, and the one an empty cell makes
   * unavoidable: pressing one must not leave a blank key behind. The tile
   * wrote as you typed, because it was always on screen and there was nothing
   * to dismiss. */
  await openBoard(page);
  await key(page, 0).click();
  await keySheet(page).locator("#diyKeyText").fill("Nicht bestaetigt");
  await page.keyboard.press("Escape");
  await expect(keySheet(page)).toHaveCount(0);
  await expectSaid(page, 0, "");
  await expect(cells(page).nth(KEY_CELL[0])).toHaveClass(/cell--empty/);
});

test("a second set can be added and removed again", async ({ page }) => {
  await openBoard(page);
  const tabs = page.locator("#tabs .tab:not(.add)");
  await expect(tabs).toHaveCount(1);

  await page.locator("#tabs .tab.add").click();
  await expect(tabs).toHaveCount(2);
  // Something on it, so the question below has a number to carry.
  await put(page, 0, "Noch einmal");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  /* This used to be `page.once("dialog", d => d.accept())` - a native
   * confirm(), which conventions.md §3.4 forbids and which asked "really
   * delete?" with an OK button and no idea what was inside.
   *
   * What replaced it is the shape §1.7 asks for and the one editor-app already
   * uses a floor down: a <dialog> that counts what goes and names the act on
   * the button. Both halves are asserted here, because the count is the whole
   * reason the question exists and a button reading OK would still pass a test
   * that only checked the set disappeared.
   *
   * It is reached from the set's own card now rather than from a red button
   * under the board, which is where every other destructive act in this
   * product sits. */
  await setKey(page).click();
  await press(setCard(page), "ui.remove_set");
  const asked = page.getByRole("dialog", { name: label("ui.remove_set") });
  await expect(asked).toBeVisible();
  await expect(asked.locator(".body")).toContainText(/(einen Taste|one key)/);

  // Dismissed deletes nothing - the rule this repository keeps everywhere -
  // and it leaves the card it was asked from standing, because a no leaves
  // somebody exactly where they were.
  await asked.locator("button", { hasText: label("ui.cancel") }).click();
  await expect(setCard(page)).toBeVisible();
  await expect(tabs).toHaveCount(2);

  await press(setCard(page), "ui.remove_set");
  await asked.locator("button", { hasText: label("ui.set_delete_go") }).click();
  await expect(tabs).toHaveCount(1);
  // And this time the card goes with the set it was about.
  await expect(setCard(page)).toHaveCount(0);
});

test("tabs and cells answer the keyboard", async ({ page }) => {
  await openBoard(page);

  // A second set, then back to the first, without touching the mouse.
  await page.locator("#tabs .tab.add").focus();
  await page.keyboard.press("Enter");
  const tabs = page.locator("#tabs .tab:not(.add)");
  await expect(tabs).toHaveCount(2);
  await tabs.first().focus();
  await page.keyboard.press("Enter");
  await expect(tabs.first()).toHaveClass(/active/);

  // Enter on a cell opens its sheet, which is the whole of what a press does
  // now - there is nothing on the board to reach past it to.
  await key(page, 0).focus();
  await page.keyboard.press("Enter");
  await expect(keySheet(page)).toBeVisible();
  await page.keyboard.press("Escape");

  // And the ⋯ on the current tab opens the set's card, the same one the set
  // key opens. Two doors to one set, which is not what conventions.md §3.2
  // forbids: the tab and the set key are the same set drawn twice.
  await page.locator("#tabs .tab.active .tab__more").focus();
  await page.keyboard.press("Enter");
  await expect(setCard(page)).toBeVisible();
});

test("sets move and keys swap without a mouse", async ({ page }) => {
  await openBoard(page);

  // A second set, so there is somewhere to move to. It arrives current and
  // named "Set 2", which is what the order is read off below.
  await page.locator("#tabs .tab.add").focus();
  await page.keyboard.press("Enter");
  const tabs = page.locator("#tabs .tab:not(.add)");
  await expect(tabs).toHaveCount(2);

  // Alt+Arrow moves the focused tab, and focus travels with it. On this device
  // the order of the sets *is* the navigation - the firmware advances with
  // `rtcCurrentSet = (rtcCurrentSet + 1) % layout.setCount` - so this is not
  // presentation the way the tablet's page strip is.
  await tabs.nth(1).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(tabs.first()).toHaveText(/Set 2/);
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(tabs.nth(1)).toHaveText(/Set 2/);
  await expect(tabs.nth(1)).toBeFocused();

  /* Four keys with distinguishable sentences, to see a move by its work.
   *
   * Alt+Arrow on a cell replaces the grip that armed a swap with Enter and
   * completed it with a second Enter. It is the key editor-app uses for the
   * same act, and it needs no state between two ends - so there is nothing to
   * arm, nothing to mark and nothing to let go of with Escape. */
  await put(page, 0, "Eins");
  await put(page, 1, "Zwei");
  await put(page, 2, "Drei");
  await put(page, 3, "Vier");

  await key(page, 0).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expectSaid(page, 0, "Zwei");
  await expectSaid(page, 1, "Eins");
  // Focus follows the key rather than staying at the cell, which is what makes
  // a run of presses carry one key across the block.
  await expect(key(page, 1)).toBeFocused();

  await page.keyboard.press("Alt+ArrowDown");
  await expectSaid(page, 1, "Vier");
  await expectSaid(page, 3, "Eins");
  await expect(key(page, 3)).toBeFocused();

  /* And the block is the whole of where a key may go. The cells to the left of
   * it are the speaker's hole and the set key, and neither is a place a key
   * can be: their positions are the hardware's. */
  const slots = [0, 1, 2, 3];
  const was = await Promise.all(slots.map((slot) => word(page, slot).textContent()));
  await key(page, 2).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await key(page, 0).focus();
  await page.keyboard.press("Alt+ArrowUp");
  expect(await Promise.all(slots.map((slot) => word(page, slot).textContent())))
    .toEqual(was);
});

test("an own picture lands on a key and renders", async ({ page }) => {
  await openBoard(page);

  /* Through the sheet, the way a person does it: the cell opens it and "own
   * image" reaches the hidden file input in its picture column. Uploading
   * exercises the store write and symbolInto's blob rendering - the path that
   * shipped setting img.src to "[object Promise]".
   *
   * There is no second dialog in front of this any more. The picture, its
   * search and the upload are the sheet's left column, which is what a modal
   * over a modal to choose a symbol was replaced by. */
  await key(page, 0).click();
  const box = keySheet(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    box.locator(".pick button", { hasText: label("ui.symbol_own") }).click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", "symbol.png"));

  // The sheet's own preview takes it first.
  await expect(box.locator(".pick__preview img")).toBeVisible();
  await press(box, "ui.done");

  // And then the cell behind it.
  const image = cells(page).nth(KEY_CELL[0]).locator(".cell__pic");
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 16);
});

test("a picture can be taken off a key again", async ({ page }) => {
  /* The other half of the one above. Until this control existed a picture
   * could only be replaced, never removed: every way out of the sheet either
   * kept the symbol or put a different one in its place, so a key that had
   * been given the wrong picture was stuck with a picture.
   *
   * Nothing downstream had to change for it - `symbol: ""` is what a key
   * without a picture has always been - which is exactly what this asserts:
   * the cell behind the sheet goes back to drawing its word. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    box.locator(".pick button", { hasText: label("ui.symbol_own") }).click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", "symbol.png"));
  await expect(box.locator(".pick__preview img")).toBeVisible();

  // Only once there is something to take off: with no picture there is nothing
  // for it to do, and a control that is permanently dead reads as broken.
  const off = box.locator(".pick button", { hasText: label("ui.symbol_off") });
  await off.click();
  await expect(box.locator(".pick__preview img")).toHaveCount(0);
  await expect(box.locator(".pick__preview--none")).toBeVisible();
  await expect(off).toBeHidden();
  await press(box, "ui.done");

  await expect(cells(page).nth(KEY_CELL[0]!).locator(".cell__pic")).toHaveCount(0);
});

test("a picture can be crossed out, which is how a key says \"not\"", async ({ page }) => {
  /* German AAC negates by crossing the symbol out rather than by using a
   * picture of its own - METACOM ships no "nicht" and never will. Until this
   * existed the only way to build "kein Brot" here was a picture of bread with
   * nothing on the key to say it meant the opposite.
   *
   * The control is the picture column's, which is one column shared by both
   * editors - see drawPick() in src/shell/sheet.ts. What is editor-specific is
   * the cell, and that is what the last two assertions are about. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    box.locator(".pick button", { hasText: label("ui.symbol_own") }).click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", "symbol.png"));
  await expect(box.locator(".pick__preview img")).toBeVisible();

  // Nothing to cross out until there is a picture, and something to cross out
  // as soon as there is.
  const negate = box.locator(".pick__negate input");
  await expect(negate).toBeVisible();
  await expect(negate).not.toBeChecked();
  await negate.check();
  // The sheet's own preview says so before anything is kept, because the
  // question somebody is answering is what the key will look like.
  await expect(box.locator(".pick__preview .negate")).toBeVisible();
  await press(box, "ui.done");

  // And the cell behind it. The picture stays - crossing out is not removing.
  const cell = cells(page).nth(KEY_CELL[0]!);
  await expect(cell.locator(".cell__pic")).toBeVisible();
  await expect(cell.locator(".cell__crossed .negate")).toBeVisible();

  // Reopening shows the answer that was given rather than a fresh no, and
  // taking it back takes the cross off the board.
  await key(page, 0).click();
  await expect(box.locator(".pick__negate input")).toBeChecked();
  await box.locator(".pick__negate input").uncheck();
  await press(box, "ui.done");
  await expect(cell.locator(".negate")).toHaveCount(0);
  await expect(cell.locator(".cell__pic")).toBeVisible();
});

test("the preview draws the keys the way the display will", async ({ page }) => {
  /* The one thing on this board that the mock does not cover, because a tablet
   * has no display to preview. It replaces the cell's picture rather than
   * adding a strip under it - editor-diy's deviceImage() is where that is
   * argued - so what is asserted is that the picture on the cell becomes the
   * device's rendering, at the millimetres the device really shows.
   *
   * Nothing here checks the pixels. What previewInto() produces is
   * data/tiles.ts's business and tests/reference/tiles.lock.json is the
   * outside opinion on it; this is the wiring. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    box.locator(".pick button", { hasText: label("ui.symbol_own") }).click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", "symbol.png"));
  await expect(box.locator(".pick__preview img")).toBeVisible();
  await press(box, "ui.done");

  const image = cells(page).nth(KEY_CELL[0]).locator(".cell__pic");
  await expect(image).not.toHaveClass(/cell__pic--device/);

  // The label, not the box: .toggle hides the checkbox at 0x0 and draws the
  // pill, which is what a person presses and what carries the focus ring.
  await page.locator("#previewLabel").click();
  await expect(image).toHaveClass(/cell__pic--device/);
  /* 15.21 mm, which is the whole visible area of a ScreenKey -
     docs/hardware.md. Life-size on screen, so a pictogram that does not
     survive the trip can be seen not to.

     Within a tenth of a pixel rather than exactly: the browser resolves a
     millimetre length in its own precision, and pinning the rounding would be
     asserting Chromium's arithmetic rather than that the rule is in
     millimetres at all. A percentage of the cell - which is what every other
     picture on the board takes - would be off by tens of pixels, not by a
     hundredth of one. */
  const width = parseFloat(await image.evaluate((el) => getComputedStyle(el).width));
  expect(Math.abs(width - (15.21 / 25.4 * 96))).toBeLessThan(0.1);

  await page.locator("#previewLabel").click();
  await expect(image).not.toHaveClass(/cell__pic--device/);
});

test("a Sammlung leaves as a .obz and comes back beside the others", async ({ page }) => {
  await openBoard(page);
  await put(page, 0, "Das bleibt");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // Exporting is in the work head's ⋯, beside the Sammlung it exports.
  await page.locator("#collectionMenu").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".menu button", { hasText: label("ui.collection_export") }).click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();

  // Scribble over the sentence. The import must NOT take it back: a file
  // arriving joins what is here rather than replacing it, so the scribble
  // survives and the file arrives beside it as a second Sammlung.
  await put(page, 0, "Uebergeschrieben");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  const rows = page.locator("#collectionList .collections__item");
  await expect(rows).toHaveCount(1);

  // Importing is inside Einstellungen now: the sidebar holds the list, the way
  // to make one, and the way out of the page.
  await openBoardPanel(page);
  const [importChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#boardImport").click(),
  ]);
  await importChooser.setFiles(file!);

  await page.locator("#voiceClose").click();
  await expect(rows).toHaveCount(2);
  // The one that arrived is open, and it holds what was exported.
  await expectSaid(page, 0, "Das bleibt");

  // And the one it was imported next to still has the scribble.
  await rows.filter({ hasNotText: "board" }).last().click();
  await expectSaid(page, 0, "Uebergeschrieben");
});

/** A Sicherung, as the bytes a file chooser would hand over. Written here
 *  rather than kept as a fixture: what is being tested is the shape the
 *  product itself writes, and a fixture beside it would go stale the day that
 *  shape changes while this file went on passing. */
function sicherung(boards: { id: string; name: string }[]) {
  const page = (label: string) => ({
    id: "start", name: "start",
    buttons: [{
      id: "b1", row: 0, col: 1, label, vocalization: "",
      symbol: "arasaac-2483.png", wordClass: "misc", act: { kind: "append" },
    }],
  });
  return {
    name: "sicherung-2026-08-26.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      format: "vorlaut-backup",
      version: 2,
      exportedAt: "2026-08-26T00:00:00.000Z",
      boards: boards.map(({ id, name }) => ({
        id, name,
        layout: { target: "app", grid: { rows: 3, columns: 5 },
                  pages: [page(name)], home: "start" },
      })),
      current: boards[0]!.id,
      // One picture, so the sentence about pictures has something to count.
      symbols: [{ name: "arasaac-2483.png", data: "iVBORw0KGgo=" }],
      settings: {},
      notice: "",
    })),
  };
}

interface Handed { name: string; mimeType: string; buffer: Buffer }

/** Hands a file to the Board panel's import button. */
async function importFile(page: Page, file: Handed) {
  await openBoardPanel(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#boardImport").click(),
  ]);
  await chooser.setFiles(file);
}

test("a Sicherung of one Sammlung comes in beside the others, not over them",
  async ({ page }) => {
  await openBoard(page);
  await put(page, 0, "Das bleibt");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  const rows = page.locator("#collectionList .collections__item");
  await expect(rows).toHaveCount(1);

  await importFile(page, sicherung([{ id: "kept-id", name: "Kueche" }]));

  // The sentence counts the pictures, because a Sicherung brings its own and
  // an .obz does not.
  await expect(page.locator("#boardState"))
    .toHaveText(label("ui.collection_imported_pictures", { name: "Kueche", n: 1 }));
  await page.locator("#voiceClose").click();

  // Beside, not over: two rows, and the Sammlung that was here still has its
  // sentence.
  await expect(rows).toHaveCount(2);
  // Named for what the file called the Sammlung, not for the file - the file
  // is called sicherung-2026-08-26.
  await expect(rows.filter({ hasText: "Kueche" })).toHaveCount(1);
  await rows.filter({ hasNotText: "Kueche" }).last().click();
  await expectSaid(page, 0, "Das bleibt");
});

test("a Sicherung of the whole library is refused, and says which button reads it",
  async ({ page }) => {
  await openBoard(page);
  const rows = page.locator("#collectionList .collections__item");
  await expect(rows).toHaveCount(1);

  await importFile(page, sicherung([
    { id: "a", name: "Kueche" }, { id: "b", name: "Kinderzimmer" },
  ]));

  await expect(page.locator("#boardState"))
    .toHaveText(label("ui.collection_many", { n: 2 }));
  await page.locator("#voiceClose").click();
  // Refused whole: nothing was added, and nothing was replaced either.
  await expect(rows).toHaveCount(1);
});

test("a voice can be chosen and is still ticked on reopening", async ({ page }) => {
  await openBoard(page);
  // The voice is this Sammlung's, so it is behind this Sammlung's ⋯ rather
  // than in Einstellungen: what a talker sounds like is not a fact about the
  // browser it was built in.
  await openVoices(page);
  const rows = page.locator("#voiceList .voiceRow");
  await expect(rows.first()).toBeVisible();

  // Offered because this page owns the piper runtime, and for no other
  // reason: vits-web can phonemise neither of these two. Kerstin is the one
  // voice that reaches the device at its own 16 kHz with no resample, so her
  // row going missing is broken wiring, not a catalogue opinion.
  await expect(page.locator("#voiceList .voiceRow", { hasText: "Kerstin" }))
    .toHaveCount(1);
  await expect(page.locator("#voiceList .voiceRow", { hasText: "John" }))
    .toHaveCount(1);

  const picked = (await rows.first().locator(".voice__name").textContent())!;
  await rows.first().locator("button.voice").click();
  await expect(page.locator('#voiceList .voice[aria-checked="true"]')).toHaveCount(1);
  // No Save: choosing wrote it. The board's own status line is the proof,
  // and it is what every other edit on this page already says.
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });
  await page.locator("#collectionSheetClose").click();
  await expect(page.locator("#collectionSheet")).not.toBeVisible();

  // Reopened, exactly one row is marked and it is the one that was picked.
  // The regression this pins: listVoices() once dropped `chosen`, and the
  // sheet opened with nothing marked every time.
  await openVoices(page);
  const on = page.locator('#voiceList .voice[aria-checked="true"]');
  await expect(on).toHaveCount(1);
  await expect(on.locator(".voice__name")).toHaveText(picked);
  await page.locator("#collectionSheetClose").click();
});

test("the voice that rushes a single word says so, on its row alone", async ({ page }) => {
  /* The failure this pins is not a wrong string, it is a silent one. The
   * catalogue flags a voice that crams an unpunctuated word into a fixed slot;
   * nothing about that is audible until somebody has recorded a whole board of
   * one-word keys, so if the note stops rendering nothing else here goes red.
   *
   * Two rows are asserted rather than a count, on purpose. The catalogue owns
   * which voices carry the flag, and a second one arriving must not make this
   * test wrong - it would only have to make the note appear in one more place.
   * What is checked is the shape: the flagged voice has it, an unflagged one
   * does not. Nothing here synthesises; the note is drawn from the list. */
  await openBoard(page);
  await openVoices(page);
  await expect(page.locator("#voiceList .voiceRow").first()).toBeVisible();

  const kerstin = page.locator("#voiceList .voiceRow", { hasText: "Kerstin" });
  await expect(kerstin).toHaveCount(1);
  await expect(kerstin.locator(".voice__hint")).toHaveText(label("ui.voice_rushes"));

  // Two Thorstens are offered and neither is flagged, so this counts across
  // both rather than picking one of them.
  const thorsten = page.locator("#voiceList .voiceRow", { hasText: "Thorsten" });
  expect(await thorsten.count()).toBeGreaterThan(0);
  await expect(thorsten.locator(".voice__hint")).toHaveCount(0);

  await page.locator("#collectionSheetClose").click();
});

test("a Sammlung nobody has told anything opens on a voice, and says nobody chose it",
  async ({ page }) => {
    /* What used to be here was the opposite test: pressing play said "no voice
     * chosen yet, pick one in the gear". That sentence has gone, and so has
     * the guard that produced it - a fresh layout's empty `voice` field is not
     * the absence of an answer any more. The Sammlung's language picks one,
     * and the field stays empty because nobody has chosen anything, which is
     * a different fact and is the one the note on the row states.
     *
     * The two halves are asserted together on purpose. A mark with no note
     * would be the page claiming a choice nobody made; a note with no mark
     * would be the preselection not happening at all. */
    await openBoard(page);
    await openVoices(page);
    await expect(page.locator("#voiceList .voiceRow").first()).toBeVisible();

    const on = page.locator('#voiceList .voice[aria-checked="true"]');
    await expect(on).toHaveCount(1);
    await expect(on.locator(".voice__facts")).toContainText(within("ui.voice_auto_note"));

    // And the folded heading is the same answer rather than "none chosen yet",
    // which is the one line the panel is read for nine times out of ten.
    await expect(page.locator("#voiceState"))
      .toContainText((await on.locator(".voice__name").textContent())!);
    await expect(page.locator("#voiceState")).not.toHaveText(label("ui.voice_state_none"));
    await page.locator("#collectionSheetClose").click();
  });

test("a whole sentence finds the symbol its words point at", async ({ page }) => {
  // The collection answers for one word only: the lemma. Everything the search
  // is typed at below has to be reduced to it before ARASAAC is ever asked,
  // which is the whole of what bildquelle's German half is for.
  const asked: string[] = [];
  await page.route("**/api.arasaac.org/**", (route) => {
    const term = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    asked.push(term);
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(term.toLowerCase() === "durstig"
        ? [{ _id: 4242, keywords: [{ keyword: "durstig" }] }]
        : []),
    });
  });
  await page.route("**/static.arasaac.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }));

  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await expect(box).toBeVisible();

  // Typed as somebody would write it on a key: a sentence, with a full stop.
  // Before this, the raw string went to the collection and came back empty.
  await search(box, "Ich bin durstig.");
  await expect(searchNote(box)).toHaveCount(0);
  await expect(box.locator(".pick__hit")).toHaveCount(1);

  // And it got there by asking for the word, not the sentence.
  expect(asked).toContain("durstig");
  expect(asked).not.toContain("Ich bin durstig.");
});

test("the sheet says what is owed for the pictures it shows", async ({ page }) => {
  /* ARASAAC is CC BY-NC-SA and the wording is a condition of the licence, so
   * it has to appear wherever its pictures do. That used to be one place - the
   * picker dialog - because there was one place pictures were shown. A sheet
   * carries its own search now, in both editors, so the line is part of the
   * picture column rather than of the dialog nothing opens. */
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await expect(box.locator(".pick__credits")).not.toBeEmpty();
  await expect(box.locator(".pick__credits")).toContainText("ARASAAC");
});
