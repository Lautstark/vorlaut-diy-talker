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
const VOICE_GONE = new RegExp(`(${table("ui.voice_gone")
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);

/* A regex, not a glob: the region rides in the SUBDOMAIN
 * (westeurope.tts.speech...), and a glob's "**\/" wants a slash exactly where
 * the hostname has a dot - the first version of this pattern matched nothing
 * and the test talked to real Microsoft, whose real 401 read like a pass of
 * the wrong test. */
const VOICES_LIST = /tts\.speech\.microsoft\.com\/cognitiveservices\/voices\/list/;

/** Unfolds one panel. The sheet's panels are one exclusive group now - opening
 *  one closes the rest - so anything acting inside a panel has to open that
 *  panel first rather than assuming an earlier one stayed put. */
async function openPanel(page: Page, id: string) {
  const panel = page.locator(id);
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
}

async function typeKeyAndSave(page: Page, region: string) {
  await page.goto("./");
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await page.locator("#settingsLink").click();
  await openPanel(page, "#azurePanel");
  await page.locator("#azureKey").fill("0000fakekeyfakekeyfakekey0000");
  await page.locator("#azureRegion").fill(region);
  await page.locator("#azureSave").click();
}

/** Unfolds the Voice panel, whatever state the <details> was left in - it
 *  keeps its fold across closings of the sheet, so a blind click toggles. */
const openVoicePanel = (page: Page) => openPanel(page, "#voicePanel");

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
  await openVoicePanel(page);
  await expect(page.locator("#voiceList .voiceRow", { hasText: "Katja" }))
    .toBeVisible();

  // And the choice completes: picking Katja writes her, with no Save to press
  // and no dialog closing underneath the person who picked. The board's own
  // status line is what says it landed.
  await page.locator("#voiceList .voiceRow", { hasText: "Katja" })
    .locator("button.voice").click();
  await expect(page.locator('#voiceList .voice[aria-checked="true"]')).toHaveCount(1);
  await expect(page.locator("#voices")).toBeVisible();
});

test("a region that is not one gets said on the panel, not swallowed", async ({ page }) => {
  await page.route(VOICES_LIST, (route) => route.abort("failed"));
  await typeKeyAndSave(page, "wsteurope");

  await expect(page.locator("#voices")).toBeVisible();
  await expect(page.locator("#azureState")).toHaveText(AZURE_UNREACHABLE);
  // The piper voices survive a broken Azure - that part of the old behaviour
  // was right and stays. The list is inside a folded panel now, so it has to
  // be unfolded before anything in it can be asserted visible.
  await openVoicePanel(page);
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
  await openVoicePanel(page);
  await expect(page.locator("#voiceList .voiceRow", { hasText: "Katja" }))
    .toBeVisible();

  // Its own button, not a reading of the empty field - the empty field means
  // "leave the key alone". The sheet stays open: the rows this removal costs
  // leave in front of the person who asked.
  await openPanel(page, "#azurePanel");
  await page.locator("#azureForget").click();
  // The list is in the voice panel, which the one above just closed.
  await openVoicePanel(page);
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
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await page.locator("#settingsLink").click();
  await expect(page.locator("#azureState")).toHaveText(AZURE_NONE);
});


test("a chosen Azure voice keeps its name after the key stops working", async ({ page }) => {
  await page.route(VOICES_LIST, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([
      { ShortName: "de-DE-KatjaNeural", Locale: "de-DE", Gender: "Female",
        DisplayName: "Katja", LocalName: "Katja" },
    ]),
  }));
  await typeKeyAndSave(page, "westeurope");
  await openVoicePanel(page);

  // Chosen while the key still works, which is the only moment anybody ever
  // sees this voice called anything.
  const katja = page.locator("#voiceList .voiceRow", { hasText: "Katja" });
  await expect(katja).toBeVisible();
  await katja.locator("button.voice").click();
  await expect(page.locator('#voiceList .voice[aria-checked="true"]')).toHaveCount(1);

  // And now the key goes. The voice stays chosen on purpose - dropping it
  // would throw away a deliberate decision - so it has to keep being shown,
  // and what it is shown as is the whole of this test.
  await openPanel(page, "#azurePanel");
  await page.locator("#azureForget").click();
  // The list is in the voice panel, which the one above just closed.
  await openVoicePanel(page);
  await expect(page.locator("#azureState")).toHaveText(AZURE_NONE);

  const gone = page.locator("#voiceList .voiceRow", { hasText: VOICE_GONE });
  await expect(gone).toHaveCount(1);
  // The name somebody picked her by, not the id she is stored under. This row
  // printed `azure:de-DE-KatjaNeural` before there was a name to print, and
  // stimmquelle's displayName() would have made it `DE-KatjaNeural`, which is
  // not better - it is the same string with less of it.
  await expect(gone.locator(".voice__name")).toHaveText("Katja");
  await expect(gone).not.toContainText("azure:");
  await expect(gone).not.toContainText("Neural");
  // The folded heading is the same answer in one line, and it fell back to the
  // same raw id.
  await expect(page.locator("#voiceState")).toContainText("Katja");
  await expect(page.locator("#voiceState")).not.toContainText("azure:");
});
