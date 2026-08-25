import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { cells, hits, key, keySheet, query, search } from "./diy.js";

/* Which collection the sheet offers, across a reload.
 *
 * It is the sheet's own picture column that names it now, not a standing
 * dialog: a press on a key opens the picture, its search and the upload
 * together, in both editors. Which source that column is searching, and what
 * is owed for it, come from one place - searchPlaceholder() and creditLine()
 * in src/shell/picker.ts - so that a second copy cannot say something the
 * search is not doing, which is the bug below in its other form.
 *
 * The bug this holds shut: the chosen source was read out of storage by
 * loadSettings(), and the only thing that ever called loadSettings() was the
 * settings sheet opening. So a page that had just been reloaded ran on the
 * "arasaac" the module starts life with - the field said ARASAAC, a search
 * went to ARASAAC - and both changed their mind the moment somebody pressed
 * the gear. It looked like the search working sometimes and not others.
 *
 * A METACOM folder cannot be picked from a test: showDirectoryPicker wants a
 * real directory and a real gesture. What bildquelle actually keeps is a
 * handle and a filename index, in its own database, so that is what is put
 * there - the handle as a bare object, which is enough because a stored handle
 * with no queryPermission() reads as granted, and no picture is asked for
 * below. Nothing licensed is involved: the index is filenames.
 */

const label = (key: string) => new RegExp(
  `^(${LANGUAGES.map((l) =>
    (TEXTS as Record<string, Record<string, string>>)[l][key]
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

/** The same, unanchored: the credit line is one of these sentences followed
 *  by the licence notice, which bildquelle owns and we do not quote. */
const phrase = (key: string) => new RegExp(
  `(${LANGUAGES.map((l) =>
    (TEXTS as Record<string, Record<string, string>>)[l][key]
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);

/** A key's sheet, open. The picture column is inside it, which is where a
 *  symbol is searched for now - a sheet carries its own search rather than
 *  opening a second modal on top of itself. */
async function openSheet(page: Page) {
  // Whatever was open first. A sheet is modal, so a press on the cell behind
  // one never lands - and dismissing costs nothing, which is the rule the
  // draft model exists for.
  while (await page.locator("dialog[open]").count()) {
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  }
  await key(page, 0).click();
  const box = keySheet(page);
  await expect(box.locator(".pick")).toBeVisible();
  return box;
}

/** Asserts which collection the sheet says it is searching, and closes it
 *  again.
 *
 *  Opened fresh each time on purpose: the placeholder is read as the sheet is
 *  built, so a sheet opened after a folder arrived is the only thing that can
 *  prove the page noticed. Closed again because everything these tests do
 *  next is in the settings sheet, and a modal is a modal - a press on the gear
 *  behind one never lands. */
async function expectSource(page: Page, expected: string | RegExp): Promise<void> {
  const box = await openSheet(page);
  await expect(query(box)).toHaveAttribute("placeholder", expected);
  await shut(page);
}

/** The same for the line under the pictures saying what is owed for them. */
async function expectCredits(page: Page, expected: RegExp): Promise<void> {
  const box = await openSheet(page);
  await expect(box.locator(".pick__credits")).toContainText(expected);
  await shut(page);
}

/** Closes whatever sheet is open. Dismissing writes nothing - that is the rule
 *  the whole draft model exists for - so this is free. */
async function shut(page: Page): Promise<void> {
  while (await page.locator("dialog[open]").count()) {
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));

const ROOT = "METACOM_9";
const FILES = ["trinken.png", "essen.png", "spielen.png"];

/** bildquelle's own database, written the way bildquelle writes it. The store
 *  names, keys and shapes are the package's; if they move, this fails loudly
 *  rather than silently seeding a folder nobody reads. */
async function connectFolder(page: Page) {
  await page.evaluate(({ root, files }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("bildquelle", 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const [name, keyPath] of [["arasaacSearch", "query"], ["arasaacImages", "id"],
                                     ["metacomIndex", "key"], ["metacomHandles", "key"]] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const entries = files.map((name) => ({
        path: `${root}/PNG_ohne_Rahmen/${name}`,
        label: name.replace(/\.png$/, ""),
        terms: [name.replace(/\.png$/, "")],
      }));
      const tx = db.transaction(["metacomIndex", "metacomHandles"], "readwrite");
      tx.objectStore("metacomIndex")
        .put({ key: "metacom", rootName: root, entries, ts: Date.now() });
      // No queryPermission on it, which bildquelle reads as "granted".
      tx.objectStore("metacomHandles").put({ key: "metacomDir", handle: { name: root } });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), { root: ROOT, files: FILES });
}

/** Chooses METACOM through the sheet, the way somebody would. */
async function useMetacom(page: Page) {
  await page.locator("#settingsLink").click();
  await openPanel(page, "#symbolsPanel");
  await page.locator("#metacomUse").click();
  await page.locator("#voiceClose").click();
}

/** The folder as this browser's other half reads it: an <input webkitdirectory>,
 *  which is what Firefox and Safari get and what Chromium falls back to. Held
 *  for the session only - there is no handle to store - so every reload starts
 *  with no collection connected, which is exactly the state a Chromium handle
 *  waiting for its permission click is in.
 *
 *  The files are built in the page rather than read off disk: Playwright's
 *  directory upload hands this input an empty list, and what is being tested
 *  is what the app does when a folder arrives, not the file plumbing. The
 *  relative path is defined onto each File because that is the field
 *  bildquelle indexes by, and a directory input is the only thing that
 *  normally sets it. */
async function supplyFiles(page: Page) {
  await page.locator("#settingsLink").click();
  await openPanel(page, "#symbolsPanel");
  await page.evaluate(({ root, files }) => {
    const carrier = new DataTransfer();
    for (const name of files) {
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
      Object.defineProperty(file, "webkitRelativePath", {
        value: `${root}/PNG_ohne_Rahmen/${name}`,
      });
      carrier.items.add(file);
    }
    const input = document.getElementById("metacomFiles") as HTMLInputElement;
    input.files = carrier.files;
    input.dispatchEvent(new Event("change"));
  }, { root: ROOT, files: FILES });
  // Connected, said by the control that only exists when there is something
  // to forget. Not "use this": whether that one is offered depends on which
  // collection is active, which is the thing under test.
  await expect(page.locator("#metacomForget")).toBeVisible();
}

test("a folder arriving after the page did brings its collection back", async ({ page }) => {
  /* The half a boot-time read cannot cover, and the one the bug was actually
   * seen through: on Chromium a stored folder handle usually comes back
   * needing its permission re-confirmed, so at load there is no collection,
   * readSettings() honestly answers "arasaac", and METACOM only appears a
   * click later. Nothing reconsidered the stored choice at that point, so the
   * field kept saying ARASAAC over a folder that was sitting right there.
   *
   * Driven here through the file input rather than a handle, because that is
   * the same arrival with a shape a test can produce. */
  await page.goto("./");
  await expect(cells(page)).toHaveCount(6);

  // With nothing connected, the line under the pictures offers METACOM to
  // somebody who might own a licence. That is the branch it is for, and the
  // one it used to cover a folder that was already set up as well.
  await expectCredits(page, phrase("ui.metacom_offer"));

  await supplyFiles(page);
  // No second press. Going and finding a licensed collection is somebody
  // saying which one they want searched, and it used to take two steps for
  // that one intention - the folder, and then "Diese Quelle verwenden".
  // Switching source changes what every search from here on answers with, so
  // it is said out loud rather than left to be noticed.
  await expect(page.locator("#status")).toHaveText(label("ui.metacom_now_active"));
  // And the button that did it is gone, because it names the move that has
  // just been made.
  await expect(page.locator("#metacomUse")).toBeHidden();
  await page.locator("#voiceClose").click();
  await expectSource(page, label("ui.search_metacom"));
  // And METACOM is owed its own line rather than ARASAAC's.
  await expectCredits(page, phrase("ui.credits_metacom"));

  // The folder is genuinely gone now, and ARASAAC is the honest answer.
  await page.reload();
  await expect(cells(page)).toHaveCount(6);
  await expectSource(page, label("ui.search_arasaac"));

  // Handing it back is the reconnect click. The choice was never withdrawn,
  // so it is METACOM that is being searched again - and it has to say so.
  await supplyFiles(page);
  await page.locator("#voiceClose").click();
  await expectSource(page, label("ui.search_metacom"));

  // And the field is not the only thing that has to have moved with it.
  let asked = false;
  await page.route("**/api.arasaac.org/**", (route) => {
    asked = true;
    route.fulfill({ contentType: "application/json", body: "[]" });
  });
  const box = await openSheet(page);
  await search(box, "trinken");
  await expect(hits(box)).toHaveCount(1);
  expect(asked).toBe(false);
});

/** Unfolds one panel. The sheet's panels are one exclusive group now - opening
 *  one closes the rest - so anything acting inside a panel has to open that
 *  panel first rather than assuming an earlier one stayed put. */
async function openPanel(page: Page, id: string) {
  const panel = page.locator(id);
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
}

test("a folder restored at boot does not decide which source is active", async ({ page }) => {
  /* The other side of adopting, and the one that would be a silent
   * regression: somebody with a METACOM folder set up who is deliberately
   * searching ARASAAC. Their folder comes back on every visit - that is what
   * bildquelle stores a handle for - and a page load must not read that as an
   * answer to which source they want. bildhaft passes its adopt flag per call
   * for exactly this.
   *
   * connectFolder() plants the handle and the index the way bildquelle keeps
   * them, so the reload below is a real restore rather than a pick. */
  await page.goto("./");
  await connectFolder(page);
  await page.reload();
  await expect(cells(page)).toHaveCount(6);

  // The folder is here - there is something to forget - and ARASAAC is still
  // what a search asks.
  await page.locator("#settingsLink").click();
  await openPanel(page, "#symbolsPanel");
  await expect(page.locator("#metacomForget")).toBeVisible();
  // Offered rather than taken: the control that would switch is on screen and
  // has not been pressed.
  await expect(page.locator("#metacomUse")).toBeVisible();
  await expect(page.locator("#status")).not.toHaveText(label("ui.metacom_now_active"));
  await page.locator("#voiceClose").click();
  await expectSource(page, label("ui.search_arasaac"));
});

test.describe("with the folder already connected at load", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("./");
    await connectFolder(page);
    await page.reload();
    await expect(page.locator("#device .cell")).toHaveCount(6);
    await useMetacom(page);
});

  test("the chosen collection is the one named, before anything is opened", async ({ page }) => {
    await expectSource(page, label("ui.search_metacom"));

    // And after a reload, which is the half that was broken: nothing had read
    // the setting yet, so the field named the collection it was not searching.
    await page.reload();
    await expect(cells(page)).toHaveCount(6);
    await expectSource(page, label("ui.search_metacom"));
  });

  test("a search after a reload asks the chosen collection, not ARASAAC", async ({ page }) => {
    // If ARASAAC is asked at all, this is the bug: the source was METACOM.
    let asked = false;
    await page.route("**/api.arasaac.org/**", (route) => {
      asked = true;
      route.fulfill({ contentType: "application/json", body: "[]" });
    });

    await page.reload();
    await expect(page.locator("#device .cell")).toHaveCount(6);

    const box = await openSheet(page);
    await search(box, "trinken");

    await expect(hits(box)).toHaveCount(1);
    // The hit names itself out of the collection's own index, which is what
    // says the answer came from METACOM rather than from an empty ARASAAC.
    await expect(hits(box)).toHaveAttribute("aria-label", /trinken/);
    expect(asked).toBe(false);
  });

  test("a board arriving in another language leaves the collection named", async ({ page }) => {
    /* The other half of the same bug, and the one that survives a reload being
     * fixed: applyTexts() wrote "ARASAAC durchsuchen" flat, so every caller of
     * it put ARASAAC back over a field that was searching METACOM. A language
     * switch in the sheet repaints the picker afterwards and hid it; a board
     * arriving in a language the page is not in did not, and this is that
     * path - export in German, switch the page to English, bring the German
     * board back.
     *
     * What the import can do to the page has since shrunk to nothing: the
     * board's language is the device's now, and opening one no longer moves
     * the language of the page it is opened on. So the second half below
     * asserts that the field is still naming the collection, in the language
     * the page was already in and stays in. */
    // Exporting is in the work head's ⋯ now, beside the Sammlung it exports.
    await page.locator("#collectionMenu").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".menu button", { hasText: label("ui.collection_export") }).click(),
    ]);
    const file = await download.path();
    expect(file).toBeTruthy();

    await page.locator("#settingsLink").click();

    const table = TEXTS as Record<string, Record<string, string>>;
    const trigger = page.locator("#langPick");
    const was = (await trigger.textContent()) === "Deutsch" ? "de" : "en";
    const other = was === "de" ? "en" : "de";
    await openPanel(page, "#languagePanel");
    await trigger.click();
    await page.locator(".menu button", { hasText: other === "de" ? "Deutsch" : "English" }).click();
    // The switch itself moves the sheet's own words, so the field is right
    // going in. Checking it means opening a key's sheet, which means leaving
    // the settings sheet - so the settings sheet is opened again after.
    await page.locator("#voiceClose").click();
    await expectSource(page, table[other]["ui.search_metacom"]!);

    // Back to the panel the import button is in: the language switch above
    // happened in another one, and one panel is open at a time.
    await page.locator("#settingsLink").click();
    await openPanel(page, "#boardPanel");
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("#boardImport").click(),
    ]);
    await chooser.setFiles(file!);
    await expect(page.locator("#boardState")).toContainText(":");

    // The board carries its own language to the device and leaves this page
    // alone - and the field still has to name the collection, in the language
    // the page is in.
    await expect(trigger).toHaveText(other === "de" ? "Deutsch" : "English");
    await expectSource(page, table[other]["ui.search_metacom"]!);
  });
});
