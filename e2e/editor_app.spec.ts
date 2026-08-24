import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { checkPackage } from "../src/data/app_package.js";
import { readPackage } from "./obz.js";

/* A tablet Sammlung, built through the page and exported.
 *
 * tests/unit/app_pages.test.ts holds the page graph and
 * tests/unit/app_package.test.ts holds the mapping, both over plain data. What
 * this adds is everything between a person and those two: that the target
 * dialog makes the right kind of Sammlung, that a press in an empty cell makes
 * a button, that a navigation button can be given a page that does not exist
 * yet, and that the whole thing comes out of the browser as an archive which
 * passes the same checks the conformance fixtures do.
 *
 * It is also where the round-trip sample is cut from. See the DUMP_TO note
 * further down and vorlaut-app's boardpackage/src/test/resources/builder/.
 *
 * Azure stands in for Microsoft, for the reason app_package.spec.ts gives: a
 * real piper synthesis fetches tens of megabytes of onnx from a CDN. What is
 * real here is everything after the samples arrive.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const label = (key: string) => new RegExp(
  `^(${LANGUAGES.map((l) =>
    (TEXTS as Record<string, Record<string, string>>)[l][key]
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);

const SAVED = label("ui.saved");

/** The one open sheet, named by its heading rather than by its whole text.
 *
 * `hasText` matches against everything inside the element, so an anchored
 * label matched against a <dialog> is matched against its title *and* its body
 * *and* its buttons - which never matches, and reads like the dialog failing
 * to open. The heading is the part that names it. */
const sheet = (page: Page, key: string) => page.locator("dialog[open]")
  .filter({ has: page.getByRole("heading", { name: label(key) }) });
const VOICES_LIST = /tts\.speech\.microsoft\.com\/cognitiveservices\/voices\/list/;
const SYNTHESIS = /tts\.speech\.microsoft\.com\/cognitiveservices\/v1/;

function wav(seconds = 0.8, hz = 220): Buffer {
  const rate = 16000;
  const frames = Math.round(rate * seconds);
  const out = Buffer.alloc(44 + frames * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + frames * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(frames * 2, 40);
  for (let at = 0; at < frames; at++) {
    out.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * at / rate) * 8000), 44 + at * 2);
  }
  return out;
}

async function standIn(page: Page): Promise<void> {
  await page.route(VOICES_LIST, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([
      { ShortName: "de-DE-KatjaNeural", Locale: "de-DE", Gender: "Female",
        DisplayName: "Katja", LocalName: "Katja" },
    ]),
  }));
  await page.route(SYNTHESIS, (route) => {
    const said = route.request().postData() ?? "";
    route.fulfill({ contentType: "audio/wav", body: wav(0.8, 200 + said.length) });
  });
}

/* --- driving the editor -------------------------------------------------- */

const cells = (page: Page) => page.locator("#appGrid .appcell");
const panel = (page: Page) => page.locator(".apppanel__button");

/** Puts a button in one cell and fills it in.
 *
 * `act` and `wordClass` go through the two selects the panel draws, which is
 * the whole point of driving it this way rather than writing a layout into the
 * store: those two are where the format's exclusivity lives, and a test that
 * set the fields directly would never exercise the control that keeps a board
 * to what the format can hold. */
async function put(page: Page, at: number, fields: {
  label: string; spoken?: string; wordClass?: string; act?: string;
}): Promise<void> {
  const box = cells(page).nth(at);
  await box.click();
  // Wait for the panel to be *this* cell's before typing into it. Pressing an
  // empty cell makes a button and moves the panel to it, and the panel is
  // rebuilt wholesale - so a fill that raced the rebuild would land in the
  // previous button's field. aria-pressed is what says the move has happened.
  await expect(box).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page)).toBeVisible();
  await page.locator("#appLabel").fill(fields.label);
  if (fields.spoken !== undefined) {
    await panel(page).locator("input[type=text]").nth(1).fill(fields.spoken);
  }
  if (fields.wordClass) {
    await panel(page).locator("select").nth(0).selectOption(fields.wordClass);
  }
  if (fields.act) {
    await panel(page).locator("select").nth(1).selectOption(fields.act);
  }
}

/** A Sammlung for the app: two pages, a way between them, and a voice. */
async function build(page: Page): Promise<void> {
  // Anything the page throws is a failure of this test, said where it
  // happened rather than three assertions later as a missing element.
  page.on("pageerror", (error) => { throw error; });
  page.on("console", (one) => {
    if (one.type() === "error") throw new Error(`console: ${one.text()}`);
  });
  await page.goto("./");
  await page.locator("#collectionNew").click();

  // The target is asked once, before anything is written, and never again.
  const asked = sheet(page, "ui.collection_target");
  await expect(asked).toBeVisible();
  // By its heading, not by its whole text: a choice is a heading *and* the
  // sentence under it that makes the choice, so an anchored label never
  // matches the button as a whole.
  await asked.locator("button.choice")
    .filter({ has: page.locator("strong", { hasText: label("ui.collection_target_app") }) })
    .click();

  // A name of its own. Both Sammlungen a browser has at this point are named
  // for the day, so the date name cannot tell them apart - and the sidebar
  // reorders by last edited, so neither can a position.
  await page.locator("#collectionName").fill("Tablet");
  await expect(page.locator("#collectionList")).toContainText("Tablet");

  // 3x5 is what a new one starts as.
  await expect(cells(page)).toHaveCount(15);
  await expect(page.locator("#appRows")).toHaveValue("3");
  await expect(page.locator("#appCols")).toHaveValue("5");

  await put(page, 0, { label: "ich", wordClass: "pronoun" });
  await put(page, 1, { label: "will", wordClass: "verb" });
  // Shows one word, says another - §7.3's case, and the one the sounds map
  // used to get wrong by keying on the label.
  await put(page, 2, { label: "Apfel", spoken: "einen Apfel", wordClass: "noun" });
  // A picture on that one, uploaded rather than searched for: ARASAAC is a
  // network away and this is not the test for it. An upload belongs to no
  // symbol collection, so the package still claims none - §5.1's third value.
  await panel(page).locator("button", { hasText: label("ui.pick_symbol") }).click();
  await expect(page.locator("#picker")).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#uploadBtn").click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", "symbol.png"));
  await expect(cells(page).nth(2).locator("img")).toBeVisible();
  // The bar's own controls, which are §7.4 actions rather than words.
  await put(page, 10, { label: "Sprich", wordClass: "other", act: "sayBar" });
  await put(page, 11, { label: "Weg", wordClass: "other", act: "clear" });

  // A way to a page that does not exist yet. "Neue Seite …" is the whole
  // interaction: it mints the page, names it after the button and points the
  // button at it, because making somebody leave, make a page and come back is
  // one thought in three steps.
  await put(page, 3, { label: "Essen", wordClass: "category", act: "goto" });
  await panel(page).locator("select").nth(2).selectOption("+");
  await expect(page.locator("#appPages .tab")).toHaveCount(2);
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // Onto the new page, by following the edge rather than by picking the tab -
  // the control that exists because selecting a navigation button must not
  // navigate, or it would be the one button nobody could ever edit.
  await panel(page).locator("button", { hasText: label("ui.app_goto_follow") }).click();
  await expect(cells(page).locator(".appcell__label")).toHaveCount(0);
  await put(page, 0, { label: "Mehr", wordClass: "descriptor" });
  await put(page, 14, { label: "Start", wordClass: "other", act: "home" });
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // The voice, which decides what the package sounds like and what its boards
  // say their locale is.
  await page.locator("#settingsLink").click();
  const azure = page.locator("#azurePanel");
  if ((await azure.getAttribute("open")) === null) await azure.locator("summary").click();
  await page.locator("#azureKey").fill("0000fakekeyfakekeyfakekey0000");
  await page.locator("#azureRegion").fill("westeurope");
  await page.locator("#azureSave").click();

  const voices = page.locator("#voicePanel");
  if ((await voices.getAttribute("open")) === null) await voices.locator("summary").click();
  await page.locator("#voiceList .voiceRow", { hasText: "Katja" }).locator("button.voice").click();
  await expect(page.locator('#voiceList .voice[aria-checked="true"]')).toHaveCount(1);
  await page.locator("#voices").evaluate((sheet: HTMLDialogElement) => sheet.close());
  await expect(page.locator("#voices")).toBeHidden();
}

/* --- the tests ----------------------------------------------------------- */

test("a tablet Sammlung leaves as a package, and it passes the spec's own checks",
  async ({ page }) => {
    await standIn(page);
    await build(page);

    // The one whole-Sammlung act for this target, in the work head beside the
    // name - conventions.md §3.3, and the reason the ⋯ does not offer it here.
    await page.locator("#appExport").click();
    const asked = sheet(page, "ui.package_title");
    await expect(asked).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      asked.locator("button", { hasText: label("ui.package_go") }).click(),
    ]);

    const path = await download.path();
    expect(path).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/-app\.obz$/);

    const bytes = new Uint8Array(readFileSync(path!));
    // Where the round-trip sample comes from. The check no test on this side
    // can make is whether the *other* program agrees, so the file goes into
    // vorlaut-app and its importer opens it - see
    // boardpackage/src/test/resources/builder/README.md there.
    if (process.env.DUMP_TO) writeFileSync(process.env.DUMP_TO, bytes);
    const { pkg } = readPackage(bytes);

    expect(checkPackage(pkg)).toEqual([]);
    expect(pkg.manifest.format).toBe("open-board-0.1");
    expect(pkg.manifest.ext_lautstark_spec_version).toBe("1.0.0");
    expect(pkg.manifest.ext_lautstark_tts_voice).toBe("de-DE-KatjaNeural");

    // Two pages, two boards, and the root is the page the layout calls home.
    expect(pkg.boards).toHaveLength(2);
    expect(pkg.manifest.root).toBe("boards/board-1.obf");
    for (const board of pkg.boards) {
      expect(board.locale).toBe("de-DE");
      expect(board.grid.rows).toBe(3);
      expect(board.grid.columns).toBe(5);
      expect(board.grid.order).toHaveLength(3);
      for (const row of board.grid.order) expect(row).toHaveLength(5);
    }
  });

test("what a press does survives the round trip through the archive",
  async ({ page }) => {
    await standIn(page);
    await build(page);

    await page.locator("#appExport").click();
    const asked = sheet(page, "ui.package_title");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      asked.locator("button", { hasText: label("ui.package_go") }).click(),
    ]);
    const { pkg } = readPackage(new Uint8Array(readFileSync((await download.path())!)));

    const start = pkg.boards.find((one) => one.id === "board-1")!;
    const at = (id: string) => start.buttons.find((one) => one.id === id)!;

    // The default, and the reason it is the default: nothing is written about
    // it at all.
    expect(at("board-1-r1c1").label).toBe("ich");
    expect(at("board-1-r1c1").action).toBeUndefined();
    expect(at("board-1-r1c1").ext_lautstark_speak_immediately).toBeUndefined();

    // §7.3's case: the bar shows the vocalization, so a button whose label is
    // one word and whose vocalization is a phrase puts the phrase in the bar.
    expect(at("board-1-r1c3").label).toBe("Apfel");
    expect(at("board-1-r1c3").vocalization).toBe("einen Apfel");

    // The word classes, as the Fitzgerald key's own light ramp.
    expect(at("board-1-r1c1").background_color).toBe("rgb(253, 253, 150)");
    expect(at("board-1-r1c2").background_color).toBe("rgb(199, 243, 199)");
    expect(at("board-1-r1c3").background_color).toBe("rgb(255, 218, 137)");

    // Navigation, and the two bar controls.
    expect(at("board-1-r1c4").load_board?.id).toBe("board-2");
    expect(at("board-1-r1c4").load_board?.path).toBe("boards/board-2.obf");
    expect(at("board-1-r3c1").action).toBe(":speak");
    expect(at("board-1-r3c2").action).toBe(":clear");

    const food = pkg.boards.find((one) => one.id === "board-2")!;
    expect(food.buttons.find((one) => one.id === "board-2-r3c5")!.action).toBe(":home");

    // A clip only where pressing the button speaks its own text. The viewer
    // utters on Append and SpeakImmediately and on nothing else, so a clip on
    // a navigation or bar-control button would be an archive member nothing
    // can ever play.
    // The picture, baked into the archive as pixels rather than left as a
    // reference - which is what separates this export from the talker's.
    const pictured = at("board-1-r1c3");
    expect(pictured.image_id).toBeTruthy();
    const image = start.images.find((one) => one.id === pictured.image_id)!;
    expect(pkg.files.get(image.path)).toBeTruthy();
    expect(image.content_type).toBe("image/png");

    expect(at("board-1-r1c1").sound_id).toBeTruthy();
    expect(at("board-1-r1c4").sound_id).toBeUndefined();
    expect(at("board-1-r3c1").sound_id).toBeUndefined();
    expect(at("board-1-r3c2").sound_id).toBeUndefined();
    // And every one it promises is really in the archive, as an Ogg Opus
    // stream rather than as a name.
    for (const board of pkg.boards) {
      for (const sound of board.sounds) {
        const clip = pkg.files.get(sound.path)!;
        expect(clip, `missing from the archive: ${sound.path}`).toBeTruthy();
        expect(new TextDecoder().decode(clip.slice(0, 4))).toBe("OggS");
        expect(new TextDecoder().decode(clip.slice(28, 36))).toBe("OpusHead");
      }
    }
  });

test("deleting a page keeps the buttons that led to it", async ({ page }) => {
  await standIn(page);
  await build(page);

  // Standing on the Essen page, which one button on the start page leads to.
  await page.locator(".apppanel__page button",
                     { hasText: label("ui.app_page_delete") }).click();
  const asked = sheet(page, "ui.app_page_delete");
  // The question names what is on the page *and* what points at it from
  // elsewhere - the second is the only fact in it somebody cannot see from
  // where they are standing, and it is the one that could change their mind.
  await expect(asked).toContainText("Essen");
  // The half of the question that names what points at this page from
   // elsewhere. Matched in either language, since the runner's browser picks.
   await expect(asked.locator(".body")).toContainText(/(hierher|leads? here)/);
  await asked.locator("button", { hasText: label("ui.app_page_delete_go") }).click();

  await expect(page.locator("#appPages .tab")).toHaveCount(1);
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // The button that led there is still on the start page, with its label, its
  // colour and its cell. Only the edge is gone.
  const essen = page.locator("#appGrid .appcell", { hasText: "Essen" });
  await expect(essen).toHaveCount(1);
  await expect(essen).toHaveAttribute("style", /--cell-color:\s*#d8af97/);
  // The → badge is what said it led somewhere, and it does not any more.
  await expect(essen.locator(".appcell__act")).toHaveCount(0);
});

test("the grid grows in silence and asks before it shrinks", async ({ page }) => {
  await standIn(page);
  await build(page);

  // Growing moves nothing and loses nothing, which is what buttons carrying
  // their own coordinates buys: 3x5 to 6x11 is a bounds change, not a
  // re-index.
  await page.locator("#appRows").fill("6");
  await page.locator("#appRows").blur();
  await expect(cells(page)).toHaveCount(30);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator("#appGrid .appcell", { hasText: "Mehr" })).toHaveCount(1);

  // Shrinking past something asks, and names how many buttons would go.
  await page.locator("#appRows").fill("1");
  await page.locator("#appRows").blur();
  const asked = sheet(page, "ui.app_grid_shrink");
  await expect(asked.locator(".body")).toContainText(/1×5/);
  await asked.locator("button", { hasText: label("ui.cancel") }).click();

  // Declined: the field goes back to what the board actually is, rather than
  // sitting there showing a size it is not.
  await expect(page.locator("#appRows")).toHaveValue("6");
  await expect(page.locator("#appGrid .appcell", { hasText: "Start" })).toHaveCount(1);
});

test("a talker Sammlung and a tablet Sammlung swap cleanly", async ({ page }) => {
  await standIn(page);
  await build(page);

  // The first Sammlung a browser gets is the talker's, and it is still in the
  // list. Going to it and back is the path that used to take the page down:
  // core/save.ts reached for #releaseBtn from inside load(), and the build
  // mark stayed subscribed after its own markup had gone.
  // By name, not by position: the sidebar is ordered last-edited-first
  // (conventions.md §1.4), so switching is exactly the act that moves the rows.
  const talker = page.locator("#collectionList > *")
    .filter({ hasText: /^(Sammlung vom|Collection of)/ });
  await talker.first().click();
  await expect(page.locator("#releaseBtn")).toBeVisible();
  await expect(page.locator("#appGrid")).toHaveCount(0);

  await page.locator("#collectionList > *", { hasText: "Tablet" }).click();
  await expect(page.locator("#appGrid")).toBeVisible();
  await expect(page.locator("#releaseBtn")).toHaveCount(0);

  // And a write on the tablet side still lands, which is what the stale
  // subscription broke: the save reported "the page has no #releaseBtn".
  await put(page, 4, { label: "bitte", wordClass: "social" });
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });
});
