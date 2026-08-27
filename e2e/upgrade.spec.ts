import { expect, test, type Page } from "@playwright/test";
import { label } from "./diy.js";

/* A browser that has been here before, opening a page that has moved on.
 *
 * The unit suite proves the migration against a database at version 3 in node.
 * This is the same event in a real Chromium, through the whole page: the
 * sidebar, the board on screen, and the sentence a person actually reads. It
 * is here because the failure it guards is invisible from inside store.ts -
 * an upgrade that migrated everything correctly and said nothing would pass
 * every unit test in the repository, and adr/0015 is as much about the
 * sentence as about the records.
 *
 * The seeding runs as an init script rather than after a load, and that is
 * the one subtle part. Requests to open the same database are served in the
 * order they are made, and the whole of version 3 - the stores and the records
 * - is written inside its own upgrade transaction, so by the time the page's
 * modules have loaded and asked for version 4 there is a complete version 3
 * database underneath them. Seeding after a load would mean deleting a
 * database the page is holding open, which is the hang e2e cannot report.
 */

const KITCHEN = "3f1c0a4e-0000-4000-8000-000000000001";
const BEDROOM = "3f1c0a4e-0000-4000-8000-000000000002";
const SAYS = "I want to go outside";

/** Version 3, written the way version 3 wrote it. */
async function seedVersionThree(page: Page): Promise<void> {
  await page.addInitScript(({ kitchen, bedroom, says }) => {
    const board = (name: string, first: string) => ({
      sleep_timeout_seconds: 600,
      language: "de",
      sets: [{
        name, symbol: "", color: "#3B5BDB",
        slots: [
          { text: first, symbol: "" },
          { text: "", symbol: "" },
          { text: "", symbol: "" },
          { text: "", symbol: "" },
        ],
      }],
    });
    const held = (layout: unknown) =>
      ({ text: JSON.stringify(layout, null, 2) + "\n", version: "aaaaaaaaaaaaaaaa" });

    const request = indexedDB.open("vorlaut", 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("collections", { keyPath: "id" })
        .createIndex("updatedAt", "updatedAt");
      db.createObjectStore("layouts", { keyPath: "id" });
      db.createObjectStore("settings");
      db.createObjectStore("marks");
      db.createObjectStore("symbols");
      db.createObjectStore("data");
      // Written through the upgrade transaction itself, so that the database
      // is complete the moment this request succeeds and nothing the page does
      // can interleave with it.
      const tx = request.transaction!;
      tx.objectStore("collections").put({ id: kitchen, name: "Kitchen", updatedAt: 1000 });
      tx.objectStore("collections").put({ id: bedroom, name: "Bedroom", updatedAt: 2000 });
      tx.objectStore("layouts").put({ id: kitchen, ...held(board("Morning", says)) });
      tx.objectStore("layouts").put({ id: bedroom, ...held(board("Night", "story please")) });
      tx.objectStore("marks").put(kitchen, "current");
      tx.objectStore("data").put(new Uint8Array([9, 9, 9]).buffer, "tiles.bin");
    };
    request.onsuccess = () => {
      // Let go before the page asks for version 4, or its open is blocked and
      // waits with no error anywhere - see onBlocked in src/data/store.ts.
      request.result.onversionchange = () => request.result.close();
      request.result.close();
    };
  }, { kitchen: KITCHEN, bedroom: BEDROOM, says: SAYS });
}

test("a browser holding version 3 keeps its Sammlungen, and is told so", async ({ page }) => {
  await seedVersionThree(page);
  await page.goto("./");

  // The sidebar, last written first: Bedroom was stamped later than Kitchen.
  // The step to 4 never touches a collection record, so these stamps are the
  // ones version 3 wrote - which is the strongest form this assertion has.
  const rows = page.locator("#collectionList .collections__item");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Bedroom");
  await expect(rows.nth(1)).toContainText("Kitchen");

  // The one that was open is still the one that is open, and what is on it is
  // what was on it.
  await expect(page.locator("#device")).toContainText(SAYS);

  // And the page says what happened, which is half of what adr/0015 is for.
  await expect(page.locator("#status")).toHaveText(label("ui.db_carried", { n: 2, from: 3 }));
});

/** A database calling itself version 3 that is not the shape version 3 has.
 *
 * Seeded the same way and for the same reason as version 3 above. The step to
 * 4 in data/migrations.ts expects to find `collections` and `layouts`; a
 * database holding `boards` fails that precondition, so the upgrade aborts and
 * every record is still here afterwards.
 */
async function seedSomethingUnreadable(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const request = indexedDB.open("vorlaut", 3);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("boards", { keyPath: "id" });
      request.transaction!.objectStore("boards")
        .put({ id: "one", whatever: "a shape from the future" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      request.result.close();
    };
  });
}

test("a database no step can migrate stops the page, and hands the data over first",
     async ({ page }) => {
       await seedSomethingUnreadable(page);
       await page.goto("./");

       const sheet = page.getByRole("dialog", { name: label("ui.rescue_title") });
       await expect(sheet).toBeVisible();

       /* The forcing function, and the reason this test is in a real browser:
        * the button that throws the data away cannot be pressed until the file
        * has been taken. A unit test can assert the flag; only this can assert
        * that a person cannot get past it. */
       const discard = sheet.locator("button.destructive");
       await expect(discard).toBeDisabled();

       const download = page.waitForEvent("download");
       await sheet.locator("button.primary").click();
       expect(await (await download).path()).toBeTruthy();
       await expect(discard).toBeEnabled();

       // And only then does anything get destroyed - after which the page is
       // an ordinary first visit rather than a reload somebody has to know to
       // do.
       await discard.click();
       await expect(sheet).toBeHidden();
       await expect(page.locator("#device .cell")).toHaveCount(6);
       await expect(page.locator("#collectionList .collections__item")).toHaveCount(1);
     });
