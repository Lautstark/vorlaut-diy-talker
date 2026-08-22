import { expect, test, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";

/* The Azure key flow, with Microsoft's server played by a route.
 *
 * This spec exists because of one evening: a stored key, a mistyped region,
 * and a page whose only answer was Azure rows that silently were not there
 * under a panel saying "stored". Both halves of the fix are pinned here - the
 * failure gets words on the panel, and the save that changes where voices
 * come from keeps the sheet open so the answer lands on the screen the
 * question was asked from.
 *
 * The route stands in for Microsoft alone: everything else - storage, the
 * seam, the probe, the list, the words - is the real page.
 */

const table = (key: string) =>
  LANGUAGES.map((l) => (TEXTS as Record<string, Record<string, string>>)[l][key]);

/** "{count} voices available" in whichever language, count made flexible. */
const AZURE_OK = new RegExp(`^(${table("ui.azure_ok")
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{count\\}", "\\d+"))
  .join("|")})$`);
const AZURE_UNREACHABLE = new RegExp(`^(${table("ui.azure_unreachable")
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
const AZURE_NONE = new RegExp(`^(${table("ui.azure_key_none")
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

/* A regex, not a glob: the region rides in the SUBDOMAIN
 * (westeurope.tts.speech...), and a glob's "**\/" wants a slash exactly where
 * the hostname has a dot - the first version of this pattern matched nothing
 * and the test talked to real Microsoft, whose real 401 read like a pass of
 * the wrong test. */
const VOICES_LIST = /tts\.speech\.microsoft\.com\/cognitiveservices\/voices\/list/;

async function typeKeyAndSave(page: Page, region: string) {
  await page.goto("./");
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await page.locator("#gear").click();
  await page.locator("#azurePanel summary").click();
  await page.locator("#azureKey").fill("0000fakekeyfakekeyfakekey0000");
  await page.locator("#azureRegion").fill(region);
  await page.locator("#voiceSave").click();
}

test("a working key answers with its voices, sheet still open", async ({ page }) => {
  await page.route(VOICES_LIST, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([
      { ShortName: "de-DE-KatjaNeural", Locale: "de-DE", Gender: "Female",
        DisplayName: "Katja", LocalName: "Katja" },
      { ShortName: "en-US-JennyNeural", Locale: "en-US", Gender: "Female",
        DisplayName: "Jenny", LocalName: "Jenny" },
    ]),
  }));
  await typeKeyAndSave(page, "westeurope");

  // The sheet did NOT close: this save changed where voices come from, and
  // the refreshed list plus the panel's answer belong on this screen.
  await expect(page.locator("#voices")).toBeVisible();
  await expect(page.locator("#azureState")).toHaveText(AZURE_OK);
  await expect(page.locator("#voiceList .voiceRow", { hasText: "Katja" }))
    .toBeVisible();

  // And the choice completes: pick Katja, save - that save closes.
  await page.locator("#voiceList .voiceRow", { hasText: "Katja" })
    .locator("button.pick").click();
  await page.locator("#voiceSave").click();
  await expect(page.locator("#voices")).not.toBeVisible();
});

test("a region that is not one gets said on the panel, not swallowed", async ({ page }) => {
  await page.route(VOICES_LIST, (route) => route.abort("failed"));
  await typeKeyAndSave(page, "wsteurope");

  await expect(page.locator("#voices")).toBeVisible();
  await expect(page.locator("#azureState")).toHaveText(AZURE_UNREACHABLE);
  // The piper voices survive a broken Azure - that part of the old behaviour
  // was right and stays. The stay-open save already unfolds the list (there
  // is nothing chosen to fold to), so no "show all" click: the button there
  // now reads "show less", and pressing it was how the first version of this
  // test hid the very rows it asserted.
  await expect(page.locator("#voiceList .voiceRow", { hasText: "Thorsten" }).first())
    .toBeVisible();
});

test("a stored key can be removed, and the azure rows leave with it", async ({ page }) => {
  await page.route(VOICES_LIST, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([
      { ShortName: "de-DE-KatjaNeural", Locale: "de-DE", Gender: "Female",
        DisplayName: "Katja", LocalName: "Katja" },
    ]),
  }));
  await typeKeyAndSave(page, "westeurope");
  await expect(page.locator("#voiceList .voiceRow", { hasText: "Katja" }))
    .toBeVisible();

  // Its own button, not a reading of the empty field - the empty field means
  // "leave the key alone". The sheet stays open: the rows this removal costs
  // leave in front of the person who asked.
  await page.locator("#azureForget").click();
  await expect(page.locator("#voices")).toBeVisible();
  await expect(page.locator("#azureState")).toHaveText(AZURE_NONE);
  await expect(page.locator("#voiceList .voiceRow", { hasText: "Katja" }))
    .toHaveCount(0);
  await expect(page.locator("#voiceList .voiceRow", { hasText: "Thorsten" }).first())
    .toBeVisible();
  // Gone from the button too: nothing left to remove.
  await expect(page.locator("#azureForget")).toBeHidden();

  // And gone from storage, not just from the screen: a fresh visit holds no
  // key and asks Azure nothing.
  await page.reload();
  await expect(page.locator("#device .tile")).toHaveCount(5);
  await page.locator("#gear").click();
  await expect(page.locator("#azureState")).toHaveText(AZURE_NONE);
});
