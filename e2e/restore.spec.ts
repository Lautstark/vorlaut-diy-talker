import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/*
 * Restoring a Sicherung: the one act in this product that throws work away.
 *
 * It replaces every Sammlung here rather than merging into them, which
 * conventions.md §1.10 allows — a whole-library restore is a different act from
 * an import, and merging would have to decide what an arriving Sammlung and a
 * stored one with the same id are.
 *
 * What it did *not* do was ask properly. The question was window.confirm() with
 * "Fortfahren?" — the one surface in the product no token reaches (§3.4),
 * asking about everything somebody has, and naming none of it. A person with
 * one Sammlung and a person with nine got the same sentence.
 *
 * This file is here because that path had no test at all, which is how it
 * stayed native long after the rest of the family had moved: nothing failed.
 */

const label = (key: string, params: Record<string, string | number> = {}) => {
  const one = (language: string) => {
    let text = (TEXTS as Record<string, Record<string, string>>)[language]![key]!;
    for (const name in params) text = text.split(`{${name}}`).join(String(params[name]));
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };
  return new RegExp(`^(${LANGUAGES.map(one).join("|")})$`);
};

async function openData(page: Page) {
  await page.goto("./");
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await page.locator("#settingsLink").click();
  const panel = page.locator("#dataPanel");
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
}

/** A backup of whatever is in the browser now, as a file on disk. */
async function exportBackup(page: Page): Promise<string> {
  const download = page.waitForEvent("download");
  await page.locator("#dataExport").click();
  return (await (await download).path())!;
}

test("the restore asks through a dialog, and counts what it would replace", async ({ page }) => {
  await openData(page);
  const file = await exportBackup(page);

  /* If this were still window.confirm(), Playwright dismisses it automatically
     and returns false — so the restore would silently not happen and no dialog
     would ever appear. That makes this assertion the one that tells the two
     apart. */
  await page.setInputFiles("#dataFile", file);

  // Named, because the settings sheet this was opened from is a <dialog> too.
  const question = page.getByRole("dialog", { name: label("ui.data_replace") });
  await expect(question).toBeVisible();
  // One Sammlung in a fresh browser, so the singular is what it has to say —
  // and the button names the act rather than "OK" (§1.7).
  await expect(question.locator("button.destructive").first())
    .toHaveText(label("ui.data_replace_go_one"));
  await expect(question).toContainText(
    new RegExp(LANGUAGES.map((l) => (TEXTS as Record<string, Record<string, string>>)[l]!
      ["ui.data_replace_ask_one"]!.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")),
  );
});

test("closing the question restores nothing", async ({ page }) => {
  // The rule this page keeps everywhere: a dialog somebody closes costs exactly
  // what it looked like it would.
  await openData(page);
  const file = await exportBackup(page);
  await page.setInputFiles("#dataFile", file);

  // Named, because the settings sheet this was opened from is a <dialog> too.
  const question = page.getByRole("dialog", { name: label("ui.data_replace") });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: label("ui.cancel") }).click();
  await expect(question).toBeHidden();

  // Nothing was written, so the line that reports a restore never appears.
  await expect(page.locator("#dataState")).toHaveText("");
});

test("confirming it restores, and says what came back", async ({ page }) => {
  await openData(page);
  const file = await exportBackup(page);
  await page.setInputFiles("#dataFile", file);

  // Named, because the settings sheet this was opened from is a <dialog> too.
  const question = page.getByRole("dialog", { name: label("ui.data_replace") });
  await question.locator("button.destructive").first().click();
  await expect(question).toBeHidden();

  await expect(page.locator("#dataState")).not.toHaveText("");
  // And the page is still usable afterwards: load() re-reads whichever
  // Sammlung the file says was open.
  await expect(page.locator("#device .cell")).toHaveCount(6);
});
