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
/** What a press lands on. The cell is the box around it. */
const hit = (page: Page, at: number) => cells(page).nth(at).locator(".appcell__open");
/** The button sheet, which a press on any cell opens. */
const buttonSheet = (page: Page) => sheet(page, "ui.app_button_title");

/** Which of the sheet's four kinds carries an act.
 *
 * The mapping is the whole of what the relabelling changed, so a test that
 * named the radios directly would be asserting the labels rather than the
 * wiring. `Act` itself is untouched: the four bar controls are one kind here
 * and four acts on the wire, and the two speaking kinds differ only in whether
 * the word joins the sentence - which is what the viewer already did. */
const DOES: Record<string, string> = {
  append: "word", speak: "shout", goto: "goto",
  sayBar: "bar", backspace: "bar", clear: "bar", home: "bar",
};

/** Puts a button in one cell and fills it in, through the sheet.
 *
 * `act` and `wordClass` go through the controls the sheet draws, which is the
 * whole point of driving it this way rather than writing a layout into the
 * store: those are where the format's exclusivity lives, and a test that set
 * the fields directly would never exercise the control that keeps a board to
 * what the format can hold.
 *
 * Nothing is written until Fertig, which is the other thing this exercises -
 * see the dismissal test below. */
async function put(page: Page, at: number, fields: {
  label: string; spoken?: string; wordClass?: string; act?: string;
  gotoPage?: string; upload?: string;
}): Promise<void> {
  await hit(page, at).click();
  const box = buttonSheet(page);
  await expect(box).toBeVisible();
  await box.locator("#appLabel").fill(fields.label);
  if (fields.spoken !== undefined) await box.locator("#appSpoken").fill(fields.spoken);
  if (fields.wordClass) await box.locator("#appClass").selectOption(fields.wordClass);
  if (fields.act) {
    await box.locator(`#appDoes_${DOES[fields.act]}`).check();
    // The bar's four are one kind and a select under it, rather than four
    // entries in a list beside "Wort" - two different questions, told apart.
    if (DOES[fields.act] === "bar") await box.locator("#appBar").selectOption(fields.act);
  }
  // "Neue Seite ..." mints the page on Fertig rather than on the press, so it
  // is named from the label as it finally reads.
  if (fields.gotoPage) await box.locator("#appGoto").selectOption(fields.gotoPage);
  if (fields.upload) {
    // The upload is reached from inside the sheet: a modal over a modal to
    // choose a symbol is the second dialog this design removed.
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      box.locator("button", { hasText: label("ui.app_symbol_own") }).click(),
    ]);
    await chooser.setFiles(fields.upload);
    await expect(box.locator(".pick__preview img")).toBeVisible();
  }
  await box.locator("button", { hasText: label("ui.app_done") }).click();
  await expect(box).toBeHidden();
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
  // A picture on that one, uploaded rather than searched for: ARASAAC is a
  // network away and this is not the test for it. An upload belongs to no
  // symbol collection, so the package still claims none - §5.1's third value.
  await put(page, 2, { label: "Apfel", spoken: "einen Apfel", wordClass: "noun",
                       upload: join(HERE, "fixtures", "symbol.png") });
  await expect(cells(page).nth(2).locator("img")).toBeVisible();
  // The bar's own controls, which are §7.4 actions rather than words.
  await put(page, 10, { label: "Sprich", wordClass: "other", act: "sayBar" });
  await put(page, 11, { label: "Weg", wordClass: "other", act: "clear" });

  // A way to a page that does not exist yet. "Neue Seite …" is the whole
  // interaction: it mints the page, names it after the button and points the
  // button at it, because making somebody leave, make a page and come back is
  // one thought in three steps.
  await put(page, 3, { label: "Essen", wordClass: "category", act: "goto",
                       gotoPage: "+" });
  await expect(page.locator("#appPages .tab")).toHaveCount(2);
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // Onto the new page, by the strip. Pressing the navigation button itself
  // opens its sheet rather than following it, or it would be the one button on
  // the board nobody could ever edit - so the strip is the way across, and it
  // holds every page including the ones nothing leads to yet.
  await page.locator("#appPages .tab", { hasText: "Essen" }).click();
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
    expect(pkg.manifest.ext_lautstark_spec_version).toBe("1.1.0");
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
  // The way in is the ... on the current tab: a page has no cell on a tablet,
  // so the tab is the thing it can be pressed on.
  await page.locator("#appPages .tab[aria-current=true] .tab__more").click();
  const card = sheet(page, "ui.app_page_title");
  await expect(card).toBeVisible();
  await card.locator("button", { hasText: label("ui.app_page_delete") }).click();
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

test("a button moves to another cell, by keyboard and by drag", async ({ page }) => {
  await standIn(page);
  await build(page);

  // Back to the start page, where the words are.
  await page.locator("#appPages .tab").first().click();
  const at = (n: number) => cells(page).nth(n).locator(".appcell__label");

  // Alt and an arrow: the same key that reorders the talker's sets. "ich" is
  // in the first cell; one press down puts it in the sixth, which is empty.
  await hit(page, 0).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(at(0)).toHaveCount(0);
  await expect(at(5)).toHaveText("ich");

  // Focus follows the button rather than staying at the cell, so a run of
  // presses moves one thing across the board.
  await page.keyboard.press("Alt+ArrowRight");
  await expect(at(6)).toHaveText("ich");

  // And back onto an occupied cell: the two trade places rather than one
  // overwriting the other or the move being refused.
  await page.keyboard.press("Alt+ArrowUp");
  await expect(at(1)).toHaveText("ich");
  await expect(at(6)).toHaveText("will");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  /* And it is really stored, which is the whole of what "moved" has to mean.
   *
   * Through a Sammlung switch rather than a reload. A structural edit writes
   * without awaiting - commit() draws first and lets the write follow - so
   * three presses queue three writes, and the status line reads "saved" from
   * the first of them while the last is still in flight. A reload there races
   * it and reads the board one move short, which is exactly what this
   * assertion caught. Switching goes through open(), which awaits saveNow()
   * before it reads anything back, so the round trip is the product's own. */
  const rows = page.locator("#collectionList > *");
  await rows.filter({ hasText: /^(Sammlung vom|Collection of)/ }).first().click();
  await expect(page.locator("#releaseBtn")).toBeVisible();
  await rows.filter({ hasText: "Tablet" }).click();
  await expect(at(1)).toHaveText("ich");
  await expect(at(6)).toHaveText("will");

  // And the mouse gesture, which is the same operation reached differently.
  // Cell 10 holds "Sprich", so this is the swap rather than the plain move:
  // the two named cells trade and nothing else on the board shifts.
  await cells(page).nth(1).dragTo(cells(page).nth(10));
  await expect(at(10)).toHaveText("ich");
  await expect(at(1)).toHaveText("Sprich");
  await expect(at(6)).toHaveText("will");
});

test("a button can be heard from the board, and only where there is something to hear",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await page.locator("#appPages .tab").first().click();

    // On a word, and it is the vocalization that goes to the synthesiser -
    // "Apfel" shows, "einen Apfel" is what the tablet will say.
    const said = page.waitForRequest((r) => SYNTHESIS.test(r.url()));
    await cells(page).nth(2).hover();
    await cells(page).nth(2).locator(".appcell__play").click();
    expect((await said).postData() ?? "").toContain("einen Apfel");

    // Not on the navigation button or the bar controls: pressing those on the
    // tablet says nothing, so offering to audition them would offer silence.
    await expect(cells(page).nth(3).locator(".appcell__play")).toHaveCount(0);
    await expect(cells(page).nth(10).locator(".appcell__play")).toHaveCount(0);
    await expect(cells(page).nth(11).locator(".appcell__play")).toHaveCount(0);

    // And a press on it does not open the cell behind it.
    await expect(cells(page).nth(2).locator(".appcell__open"))
      .toHaveAttribute("aria-pressed", "false");
  });

test("a move stops at the edge of the grid rather than walking off it",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await page.locator("#appPages .tab").first().click();

    // "ich" is in the top left. Up and left have nowhere to go, and Alt+Left
    // is history-back in some engines - so both are claimed and neither moves
    // anything.
    await hit(page, 0).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(cells(page).nth(0).locator(".appcell__label")).toHaveText("ich");
    expect(page.url()).toContain("vorlaut-diy-talker");
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

test("a sheet somebody closes costs nothing, on an empty cell and on a full one",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await page.locator("#appPages .tab").first().click();

    /* The rule this whole draft model exists for. Pressing an empty cell used
     * to mint a button and move the panel to it, so an accidental press left a
     * blank button on the board - and a dialog somebody closes must cost
     * exactly what it looked like it would. */
    const empty = cells(page).nth(5);
    await expect(empty).toHaveClass(/appcell--empty/);
    await hit(page, 5).click();
    await expect(buttonSheet(page)).toBeVisible();
    await buttonSheet(page).locator("#appLabel").fill("weg damit");
    await page.keyboard.press("Escape");
    await expect(buttonSheet(page)).toBeHidden();
    // Still empty, and still empty after a reload - nothing was written to be
    // read back.
    await expect(empty).toHaveClass(/appcell--empty/);
    await page.reload();
    await expect(cells(page).nth(5)).toHaveClass(/appcell--empty/);

    // The same for a button that already exists: the draft is thrown away and
    // the label on the board is the one it had.
    await page.locator("#appPages .tab").first().click();
    await hit(page, 0).click();
    await expect(buttonSheet(page)).toBeVisible();
    await buttonSheet(page).locator("#appLabel").fill("nicht ich");
    await page.keyboard.press("Escape");
    await expect(buttonSheet(page)).toBeHidden();
    await expect(cells(page).nth(0).locator(".appcell__label")).toHaveText("ich");
  });

test("the four kinds are a relabelling, and they carry the acts they always did",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await page.locator("#appPages .tab").first().click();

    /* "Wort" and "Ausruf" are `append` and `speak`, and the reason they were
     * renamed is that the old pair described an axis that does not exist:
     * vorlaut-app's BoardViewModel calls utter() for both, so both speak and
     * the only difference is whether the word joins the sentence. What is
     * asserted here is that the labels moved and the wiring did not. */
    await put(page, 6, { label: "Aua", wordClass: "social", act: "speak" });
    await hit(page, 6).click();
    await expect(buttonSheet(page).locator("#appDoes_shout")).toBeChecked();
    await expect(buttonSheet(page).locator("#appDoes_word")).not.toBeChecked();
    await page.keyboard.press("Escape");

    // The four bar controls are one kind and a select under it, rather than
    // four more entries in the list beside "Wort" - two different questions,
    // told apart. The act underneath is still the one the format names.
    await hit(page, 10).click();
    await expect(buttonSheet(page).locator("#appDoes_bar")).toBeChecked();
    await expect(buttonSheet(page).locator("#appBar")).toHaveValue("sayBar");
    await page.keyboard.press("Escape");

    // And the default carries no mark on the board at all, which is what makes
    // the marks on the others worth reading.
    await expect(cells(page).nth(0).locator(".appcell__act")).toHaveCount(0);
    await expect(cells(page).nth(6).locator(".appcell__act")).toHaveCount(1);
  });

test("the page sheet offers the start page, or says the page already is it",
  async ({ page }) => {
    await standIn(page);
    await build(page);

    const more = page.locator("#appPages .tab[aria-current=true] .tab__more");
    const card = () => sheet(page, "ui.app_page_title");

    // Standing on Essen, which is not the start page: the sheet offers to make
    // it one.
    await page.locator("#appPages .tab", { hasText: "Essen" }).click();
    await more.click();
    await expect(card()).toBeVisible();
    await expect(card().locator("button", { hasText: label("ui.app_page_home_set") }))
      .toHaveCount(1);
    await expect(card().locator(".notice")).toHaveCount(0);
    // Renaming through the sheet, which is where a page's name lives now.
    await card().locator("#appPageName").fill("Mittags");
    await card().locator("button", { hasText: label("ui.app_done") }).click();
    await expect(card()).toBeHidden();
    await expect(page.locator("#appPages .tab", { hasText: "Mittags" })).toHaveCount(1);

    /* On the start page the offer would be a button that does nothing, so the
     * sheet says it already is one instead - and delete still works, because
     * deletePage() moves home to the first page left. Three variants are drawn
     * in the mock and this is the fork between the two the tablet has. */
    await page.locator("#appPages .tab").first().click();
    await more.click();
    await expect(card()).toBeVisible();
    await expect(card().locator(".notice")).toHaveCount(1);
    await expect(card().locator("button", { hasText: label("ui.app_page_home_set") }))
      .toHaveCount(0);
    await expect(card().locator("button", { hasText: label("ui.app_page_delete") }))
      .toHaveCount(1);
  });
