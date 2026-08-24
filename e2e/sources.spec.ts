import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

/** The same, unanchored: the picker's credit line is one of these sentences
 *  followed by the licence notice, which bildquelle owns and we do not quote. */
const phrase = (key: string) => new RegExp(
  `(${LANGUAGES.map((l) =>
    (TEXTS as Record<string, Record<string, string>>)[l][key]
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);

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
  await expect(page.locator("#device .tile")).toHaveCount(5);

  // With nothing connected, the line under the picker offers METACOM to
  // somebody who might own a licence. That is the branch it is for, and the
  // one it used to cover a folder that was already set up as well.
  await expect(page.locator("#credits")).toContainText(phrase("ui.metacom_offer"));

  await supplyFiles(page);
  await page.locator("#metacomUse").click();
  await page.locator("#voiceClose").click();
  await expect(page.locator("#q")).toHaveAttribute("placeholder", label("ui.search_metacom"));
  // And METACOM is owed its own line rather than ARASAAC's.
  await expect(page.locator("#credits")).toContainText(phrase("ui.credits_metacom"));

  // The folder is genuinely gone now, and ARASAAC is the honest answer.
  await page.reload();
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await expect(page.locator("#q")).toHaveAttribute("placeholder", label("ui.search_arasaac"));

  // Handing it back is the reconnect click. The choice was never withdrawn,
  // so it is METACOM that is being searched again - and it has to say so.
  await supplyFiles(page);
  await page.locator("#voiceClose").click();
  await expect(page.locator("#q")).toHaveAttribute("placeholder", label("ui.search_metacom"));

  // And the field is not the only thing that has to have moved with it.
  let asked = false;
  await page.route("**/api.arasaac.org/**", (route) => {
    asked = true;
    route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.locator("#device .tile:not(.setTile) .thumb").first().click();
  await page.locator("#q").fill("trinken");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#results figure")).toHaveCount(1);
  expect(asked).toBe(false);
});

/** Unfolds one panel. The sheet's panels are one exclusive group now - opening
 *  one closes the rest - so anything acting inside a panel has to open that
 *  panel first rather than assuming an earlier one stayed put. */
async function openPanel(page: Page, id: string) {
  const panel = page.locator(id);
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
}

test.describe("with the folder already connected at load", () => {
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
    // The switch itself repaints the picker, so the field is right going in.
    await expect(page.locator("#q"))
      .toHaveAttribute("placeholder", table[other]["ui.search_metacom"]);

    // Back to the panel the import button is in: the language switch above
    // happened in another one, and one panel is open at a time.
    await openPanel(page, "#boardPanel");
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("#boardImport").click(),
    ]);
    await chooser.setFiles(file!);
    await expect(page.locator("#boardState")).toContainText(":");

    // The board carries its language and the page follows it back - and the
    // field has to name the collection, in the language it just landed in.
    await expect(trigger).toHaveText(was === "de" ? "Deutsch" : "English");
    await expect(page.locator("#q"))
      .toHaveAttribute("placeholder", table[was]["ui.search_metacom"]);
  });
});
