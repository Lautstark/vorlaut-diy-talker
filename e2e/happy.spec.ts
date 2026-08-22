import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

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
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** A label in whichever language the runner's browser picked, from the same
 *  table the page reads - asserting a literal here would pass on a German
 *  machine and fail in CI, or the other way round. */
const label = (key: string) => new RegExp(
  `^(${LANGUAGES.map((l) =>
    (TEXTS as Record<string, Record<string, string>>)[l][key]
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

const SAVED = label("ui.saved");

async function openBoard(page: Page) {
  await page.goto("./");
  await expect(page.locator("#device .tile")).toHaveCount(5);
}

/** Opens the Board panel inside the settings sheet, whatever state the
 *  <details> was left in - it keeps its fold across closings of the sheet. */
async function openBoardPanel(page: Page) {
  await page.locator("#gear").click();
  const panel = page.locator("#boardPanel");
  if ((await panel.getAttribute("open")) === null) {
    await panel.locator("summary").click();
  }
}

/** The sentence inputs on the four speech keys, set tile excluded. */
const keyText = (page: Page) =>
  page.locator("#device .tile:not(.setTile) input[type=text]");

test("a set can be named, coloured, filled and kept", async ({ page }) => {
  await openBoard(page);

  await page.locator("#device .setTile input[type=text]").first().fill("Morgens");
  await keyText(page).first().fill("Ich will nach draussen");
  // The second swatch: a real recolour, not the seeded default.
  await page.locator("#device .setTile .swatch").nth(1).click();
  await expect(page.locator("#device .setTile .swatch.active"))
    .toHaveCount(1);
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await page.reload();
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await expect(page.locator("#device .setTile input[type=text]").first())
    .toHaveValue("Morgens");
  await expect(keyText(page).first()).toHaveValue("Ich will nach draussen");
});

test("a second set can be added and removed again", async ({ page }) => {
  await openBoard(page);
  const tabs = page.locator("#tabs .tab:not(.add)");
  await expect(tabs).toHaveCount(1);

  await page.locator("#tabs .tab.add").click();
  await expect(tabs).toHaveCount(2);
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#removeSet").click();
  await expect(tabs).toHaveCount(1);
});

test("an own picture lands on a key and renders", async ({ page }) => {
  await openBoard(page);

  // Through the picker, the way a person does it: the key's thumb opens the
  // dialog and "own image" reaches the hidden file input. Uploading exercises
  // the store write and symbolInto's blob rendering - the path that shipped
  // setting img.src to "[object Promise]".
  await page.locator("#device .tile:not(.setTile) .thumb").first().click();
  await expect(page.locator("#picker")).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#uploadBtn").click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", "symbol.png"));

  const image = page.locator("#device .tile:not(.setTile) .thumb img").first();
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 16);
});

test("the board leaves as a .obz and comes back whole", async ({ page }) => {
  await openBoard(page);
  await keyText(page).first().fill("Das bleibt");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await openBoardPanel(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#boardExport").click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();

  // Scribble over the sentence, then bring the exported board back and watch
  // the scribble go: import is only real if it replaces.
  await page.locator("#voiceCancel").click();
  await keyText(page).first().fill("Uebergeschrieben");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  await openBoardPanel(page);
  page.once("dialog", (dialog) => dialog.accept());
  const [importChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#boardImport").click(),
  ]);
  await importChooser.setFiles(file!);
  await expect(page.locator("#boardState")).toHaveText(label("ui.board_imported"));

  await page.locator("#voiceCancel").click();
  await expect(keyText(page).first()).toHaveValue("Das bleibt");
});

test("a voice can be chosen and is still ticked on reopening", async ({ page }) => {
  await openBoard(page);
  await page.locator("#gear").click();
  await expect(page.locator("#voices")).toBeVisible();

  // A fresh board folds the list to the chosen voice - which is none - so
  // the sheet opens on nothing but the "show all" row. That is the exact
  // state the deployed screenshot showed.
  await page.locator("#voiceList .voiceMore button").click();
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

  const picked = (await rows.first().locator(".pick span").first().textContent())!;
  await rows.first().locator("button.pick").click();
  await expect(page.locator("#voiceList .voiceRow.on")).toHaveCount(1);
  await page.locator("#voiceSave").click();
  await expect(page.locator("#voices")).not.toBeVisible();

  // Reopened, the folded list is the chosen row, marked. The regression this
  // pins: listVoices() once dropped `chosen`, and the sheet opened with
  // nothing marked every time.
  await page.locator("#gear").click();
  const on = page.locator("#voiceList .voiceRow.on");
  await expect(on).toHaveCount(1);
  await expect(on.locator(".pick span").first()).toHaveText(picked);
  await page.locator("#voiceCancel").click();
});

test("pressing play with no voice says what to do, not that it failed", async ({ page }) => {
  await openBoard(page);
  await keyText(page).first().fill("Hallo");
  await page.locator("#device .tile:not(.setTile) button.play").first().click();
  // The words come from the table; what must NOT appear is the catalogue's
  // refusal of an empty name, which is what every press produced before.
  await expect(page.locator("#status")).toHaveText(label("ui.no_voice_yet"));
});
