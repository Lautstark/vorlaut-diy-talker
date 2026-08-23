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

test("tabs, swatches and thumbs answer the keyboard", async ({ page }) => {
  await openBoard(page);

  // A second set, then back to the first, without touching the mouse.
  await page.locator("#tabs .tab.add").focus();
  await page.keyboard.press("Enter");
  const tabs = page.locator("#tabs .tab:not(.add)");
  await expect(tabs).toHaveCount(2);
  await tabs.first().focus();
  await page.keyboard.press("Enter");
  await expect(tabs.first()).toHaveClass(/active/);

  // Space recolours through a swatch...
  const swatch = page.locator("#device .setTile .swatch").nth(1);
  await swatch.focus();
  await page.keyboard.press("Space");
  await expect(swatch).toHaveClass(/active/);

  // ...and Enter on a key's thumb opens the picker.
  await page.locator("#device .tile:not(.setTile) .thumb").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#picker")).toBeVisible();
});

test("sets move and keys swap without a mouse", async ({ page }) => {
  await openBoard(page);

  // A second set, so there is somewhere to move to. It arrives current and
  // named "Set 2", which is what the order is read off below.
  await page.locator("#tabs .tab.add").focus();
  await page.keyboard.press("Enter");
  const tabs = page.locator("#tabs .tab:not(.add)");
  await expect(tabs).toHaveCount(2);

  // Alt+Arrow moves the focused tab, and focus travels with it.
  await tabs.nth(1).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(tabs.first()).toHaveText(/Set 2/);
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(tabs.nth(1)).toHaveText(/Set 2/);
  await expect(tabs.nth(1)).toBeFocused();

  // Two keys with distinguishable sentences, to see the swap by its work.
  const texts = keyText(page);
  await texts.first().fill("Eins");
  await texts.nth(1).fill("Zwei");

  // Enter on a grip arms the swap, Escape lets go of it again...
  const grips = page.locator("#device .grip");
  await grips.first().focus();
  await page.keyboard.press("Enter");
  await expect(grips.first()).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(grips.first()).toHaveAttribute("aria-pressed", "false");

  // ...and Enter on a second grip completes it. Focus lands where the armed
  // key went.
  await page.keyboard.press("Enter");
  await grips.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(texts.first()).toHaveValue("Zwei");
  await expect(texts.nth(1)).toHaveValue("Eins");
  await expect(grips.nth(1)).toBeFocused();
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
  await page.locator("#voiceClose").click();
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

  await page.locator("#voiceClose").click();
  await expect(keyText(page).first()).toHaveValue("Das bleibt");
});

test("a voice can be chosen and is still ticked on reopening", async ({ page }) => {
  await openBoard(page);
  await page.locator("#gear").click();
  await expect(page.locator("#voices")).toBeVisible();

  // The list is not folded any more - it stands open in a box that scrolls,
  // narrowed by the search field and the language chips above it rather than
  // by a "show all" row. A fresh board has nothing chosen, and what the sheet
  // opens on is the whole list.
  // The voice list lives in a folded panel now, like every other section.
  await page.locator("#voicePanel summary").click();
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
  await page.locator("#voiceClose").click();
  await expect(page.locator("#voices")).not.toBeVisible();

  // Reopened, exactly one row is marked and it is the one that was picked.
  // The regression this pins: listVoices() once dropped `chosen`, and the
  // sheet opened with nothing marked every time.
  await page.locator("#gear").click();
  await page.locator("#voicePanel summary").click();
  const on = page.locator('#voiceList .voice[aria-checked="true"]');
  await expect(on).toHaveCount(1);
  await expect(on.locator(".voice__name")).toHaveText(picked);
  await page.locator("#voiceClose").click();
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
  await page.locator("#gear").click();
  await page.locator("#voicePanel summary").click();
  await expect(page.locator("#voiceList .voiceRow").first()).toBeVisible();

  const kerstin = page.locator("#voiceList .voiceRow", { hasText: "Kerstin" });
  await expect(kerstin).toHaveCount(1);
  await expect(kerstin.locator(".voice__hint")).toHaveText(label("ui.voice_rushes"));

  // Two Thorstens are offered and neither is flagged, so this counts across
  // both rather than picking one of them.
  const thorsten = page.locator("#voiceList .voiceRow", { hasText: "Thorsten" });
  expect(await thorsten.count()).toBeGreaterThan(0);
  await expect(thorsten.locator(".voice__hint")).toHaveCount(0);

  await page.locator("#voiceClose").click();
});

test("pressing play with no voice says what to do, not that it failed", async ({ page }) => {
  await openBoard(page);
  await keyText(page).first().fill("Hallo");
  await page.locator("#device .tile:not(.setTile) button.play").first().click();
  // The words come from the table; what must NOT appear is the catalogue's
  // refusal of an empty name, which is what every press produced before.
  await expect(page.locator("#status")).toHaveText(label("ui.no_voice_yet"));
});

test("a whole sentence finds the symbol its words point at", async ({ page }) => {
  // The collection answers for one word only: the lemma. Everything the picker
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
  await page.locator("#device .tile:not(.setTile) .thumb").first().click();
  await expect(page.locator("#picker")).toBeVisible();

  // Typed as somebody would write it on a key: a sentence, with a full stop.
  // Before this, the raw string went to the collection and came back empty.
  await page.locator("#q").fill("Ich bin durstig.");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#results figure")).toHaveCount(1);

  // And it got there by asking for the word, not the sentence.
  expect(asked).toContain("durstig");
  expect(asked).not.toContain("Ich bin durstig.");
});
