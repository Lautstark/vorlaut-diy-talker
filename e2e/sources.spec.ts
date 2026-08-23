import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* Which collection the picker offers, across a reload.
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
  await page.locator("#gear").click();
  await page.locator("#symbolsPanel summary").click();
  await page.locator("#metacomUse").click();
  await page.locator("#voiceClose").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await connectFolder(page);
  await page.reload();
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await useMetacom(page);
});

test("the chosen collection is the one named, before anything is opened", async ({ page }) => {
  await expect(page.locator("#q")).toHaveAttribute("placeholder", label("ui.search_metacom"));

  // And after a reload, which is the half that was broken: nothing had read
  // the setting yet, so the field named the collection it was not searching.
  await page.reload();
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await expect(page.locator("#q")).toHaveAttribute("placeholder", label("ui.search_metacom"));
});

test("a search after a reload asks the chosen collection, not ARASAAC", async ({ page }) => {
  // If ARASAAC is asked at all, this is the bug: the source was METACOM.
  let asked = false;
  await page.route("**/api.arasaac.org/**", (route) => {
    asked = true;
    route.fulfill({ contentType: "application/json", body: "[]" });
  });

  await page.reload();
  await expect(page.locator("#device .tile")).toHaveCount(5);

  await page.locator("#device .tile:not(.setTile) .thumb").first().click();
  await expect(page.locator("#picker")).toBeVisible();
  await page.locator("#q").fill("trinken");
  await page.locator("#searchBtn").click();

  await expect(page.locator("#results figure")).toHaveCount(1);
  await expect(page.locator("#results figcaption")).toHaveText("trinken");
  expect(asked).toBe(false);
});

test("a board arriving in another language leaves the collection named", async ({ page }) => {
  /* The other half of the same bug, and the one that survives a reload being
   * fixed: applyTexts() wrote "ARASAAC durchsuchen" flat, so every caller of
   * it put ARASAAC back over a field that was searching METACOM. A language
   * switch in the sheet repaints the picker afterwards and hid it; a board
   * arriving in a language the page is not in does not, and this is that
   * path - export in German, switch the page to English, bring the German
   * board back. */
  await page.locator("#gear").click();
  const board = page.locator("#boardPanel");
  if ((await board.getAttribute("open")) === null) await board.locator("summary").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#boardExport").click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();

  const table = TEXTS as Record<string, Record<string, string>>;
  const trigger = page.locator("#langPick");
  const was = (await trigger.textContent()) === "Deutsch" ? "de" : "en";
  const other = was === "de" ? "en" : "de";
  await trigger.click();
  await page.locator(".menu button", { hasText: other === "de" ? "Deutsch" : "English" }).click();
  // The switch itself repaints the picker, so the field is right going in.
  await expect(page.locator("#q"))
    .toHaveAttribute("placeholder", table[other]["ui.search_metacom"]);

  page.once("dialog", (dialog) => dialog.accept());
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#boardImport").click(),
  ]);
  await chooser.setFiles(file!);
  await expect(page.locator("#boardState")).toHaveText(label("ui.board_imported"));

  // The board carries its language and the page follows it back - and the
  // field has to name the collection, in the language it just landed in.
  await expect(trigger).toHaveText(was === "de" ? "Deutsch" : "English");
  await expect(page.locator("#q"))
    .toHaveAttribute("placeholder", table[was]["ui.search_metacom"]);
});
