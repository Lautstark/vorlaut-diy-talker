import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { checkPackage } from "../src/data/app_package.js";
import { readPackage } from "./obz.js";
import { openCollectionSettings, openPanel, openSettings, openVoices }
  from "./sheets.js";

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
/* Getting around, now that the pages are a list in the sidebar rather than a
 * path and a row of tiles over the board.
 *
 * Every page is one press from every other, which is what the list bought and
 * what neither the tabs nor the row could offer: a page nothing links to is a
 * row like any other. So there is no "go home by the anchor" and no "reach a
 * page from a page that opens it" - both are the same press now.
 */
const pageRow = (page: Page, name: string | RegExp) =>
  page.locator(".pagelist__item", { hasText: name });
const goPage = (page: Page, name: string | RegExp) => pageRow(page, name).click();
const goHome = (page: Page) =>
  page.locator(".pagelist__item", { has: page.locator(".pagelist__home") }).click();
/** Which page the editor is standing on. The name over the board is the field
 *  that renames it, so what it says is its value rather than its text. */
const standingOn = (page: Page) => page.locator("#appPageName");
/** The whole-Sammlung act, which is an entry in the ⋯ beside its name now. */
async function exportPackage(page: Page): Promise<void> {
  await page.locator("#collectionMenu").click();
  await page.getByRole("menuitem", { name: label("ui.collection_export_this") }).click();
}

const VOICES_LIST = /tts\.speech\.microsoft\.com\/cognitiveservices\/voices\/list/;
const SYNTHESIS = /tts\.speech\.microsoft\.com\/cognitiveservices\/v1/;
/* The other network this file reaches, and it reaches it without being asked:
 * a sheet carries its own symbol search and seeds it with the word already on
 * the button, so opening one runs a search. A word the collection does not
 * hold comes back 404, which the console guard below reads as a failure - and
 * whether it arrives before the test ends is a matter of how long the sheet
 * stays open. Answered here rather than left to the network, for the reason
 * the two above are: what these tests are about is everything after an answer
 * arrives. */
const SYMBOL_SEARCH = /api\.arasaac\.org\/v1\//;
/* ARASAAC's *other* endpoint on the same host, and the reason this pattern is
 * anchored on /v1/ rather than on the host alone.
 *
 * A pictogram rendered in greyscale comes from the API host rather than from
 * static.arasaac.org - see bildquelle's MONO_IMAGE, and the measurement behind
 * it. A stand-in matching the whole host therefore answered a request for a
 * picture with the empty JSON array above, and what got stored as the start
 * key's picture was the two bytes "[]". Nothing said so until an <img> failed
 * to decode them, several tests downstream, as a console error with a blob URL
 * in it and no hint of where the blob came from.
 *
 * So the two are told apart the way ARASAAC tells them apart, and this one
 * answers with a real PNG - which is also what lets the export below assert
 * that the start key carries an image_id at all. */
const SYMBOL_PICTURE = /api\.arasaac\.org\/api\/pictograms\//;

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
  await page.route(SYMBOL_SEARCH, (route) => route.fulfill({
    contentType: "application/json", body: "[]",
  }));
  await page.route(SYMBOL_PICTURE, (route) => route.fulfill({
    contentType: "image/png", body: readFileSync(join(HERE, "fixtures", "symbol.png")),
  }));
  await page.route(SYNTHESIS, (route) => {
    const said = route.request().postData() ?? "";
    route.fulfill({ contentType: "audio/wav", body: wav(0.8, 200 + said.length) });
  });
}

/* --- driving the editor -------------------------------------------------- */

const cells = (page: Page) => page.locator("#appGrid .cell");
/** What a press lands on. The cell is the box around it. */
const hit = (page: Page, at: number) => cells(page).nth(at).locator(".cell__open");
/** The button sheet, which a press on any cell opens. */
const buttonSheet = (page: Page) => sheet(page, "ui.app_button_title");

/** Which of the sheet's three kinds carries an act.
 *
 * The mapping is the whole of what the sheet's own naming changed, so a test
 * that named the entries directly would be asserting the labels rather than
 * the wiring. `Act` itself is untouched: `home` is an entry in the page
 * option's target list rather than a kind of its own, and the two speaking
 * kinds differ only in whether the word joins the sentence - which is what the
 * viewer always did.
 *
 * The three bar controls are not here because the sheet no longer offers them:
 * the viewer draws Speak, Undo and Clear on the message bar itself, so a grid
 * button for one spent a cell duplicating chrome that is always on screen. */
const DOES: Record<string, string> = {
  append: "word", speak: "shout", goto: "goto", home: "goto", carry: "carry",
};

/** The start page, as the target list spells it. Above the pages themselves,
 *  and kept as the act `home` rather than a `goto` at whichever page is home
 *  today - the two part company the moment somebody moves the start page. */
const HOME = "ui.app_act_home";

/** Chooses from one of the sheet's dropdowns.
 *
 * They were selects and are a button and a menu now, for the reason
 * components.css gives: a select's open list is the operating system's drawing
 * and is the one control on a page that cannot follow the tokens. So there is
 * no value to select by, and an entry is reached by its own words.
 *
 * Which does not make this a test of the labels: the words come out of the
 * same table the page reads, and what is passed in is still the key. The
 * mapping under it - `append` is "Wort" - is what DOES above holds and what
 * these tests are for.
 *
 * menuitemradio rather than button: these are alternatives with one in force,
 * which is what `checked` on every item buys. */
const entry = (page: Page, key: string) =>
  page.getByRole("menuitemradio", { name: label(key) });

/** The same words, unanchored, for the one entry `entry` cannot reach.
 *
 * components.css draws the tick on a checked item as generated content, and
 * generated content joins both the text and the accessible name - so the entry
 * in force reads as its label followed by a check, and an anchored match for
 * the label alone finds nothing. Every entry `entry` is asked for is one that
 * is about to be chosen, which is by definition not that one. */
const among = (key: string) => new RegExp(
  LANGUAGES.map((l) =>
    (TEXTS as Record<string, Record<string, string>>)[l][key]
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));

async function pick(page: Page, trigger: string, key: string): Promise<void> {
  await page.locator(trigger).click();
  await entry(page, key).click();
}

/** What a dropdown's trigger says, which is where the chosen answer now
 *  reads. A select displayed its own selected option; a button's text is ours,
 *  so this is the assertion that would catch a trigger left naming the answer
 *  somebody switched away from. */
const showing = (page: Page, trigger: string, key: string) =>
  expect(page.locator(trigger)).toHaveText(label(key));

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
  gotoPage?: string; upload?: string; negated?: boolean;
}): Promise<void> {
  await hit(page, at).click();
  const box = buttonSheet(page);
  await expect(box).toBeVisible();
  await box.locator("#appLabel").fill(fields.label);
  if (fields.act) {
    await pick(page, "#appDoes", `ui.app_does_${DOES[fields.act]!}`);
    // Navigation is one question - "where does this lead" - and the start page
    // is one of the answers, so it is an entry in the target list rather than
    // a kind of its own.
    if (fields.act === "home") await pick(page, "#appGoto", HOME);
  }
  // After the act, and that order is the sheet's rather than this helper's:
  // Gesprochen is not on screen for a button that leads to a page, so a fill
  // before the act is chosen would be typing into a row about to be hidden.
  if (fields.spoken !== undefined) await box.locator("#appSpoken").fill(fields.spoken);
  if (fields.wordClass) await pick(page, "#appClass", `ui.wordclass_${fields.wordClass}`);
  /* "Neue Seite ..." mints the page on Fertig rather than on the press, so it
   * is named from the label as it finally reads.
   *
   * A key for that entry and the start page, and a page's own name for the
   * pages themselves - those are not in the text table, because they are what
   * somebody typed. The one in force wears a tick in its accessible name (see
   * `among`), and a page being chosen is by definition not the one in force,
   * so an exact match is safe here. */
  if (fields.gotoPage) {
    await page.locator("#appGoto").click();
    await (fields.gotoPage.startsWith("ui.")
      ? entry(page, fields.gotoPage)
      : page.getByRole("menuitemradio", { name: fields.gotoPage, exact: true })).click();
  }
  if (fields.upload) {
    // The upload is reached from inside the sheet: a modal over a modal to
    // choose a symbol is the second dialog this design removed.
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      box.locator("button", { hasText: label("ui.symbol_own") }).click(),
    ]);
    await chooser.setFiles(fields.upload);
    await expect(box.locator(".pick__preview img")).toBeVisible();
  }
  // After the picture, because there is nothing to cross out before there is
  // one and the control is not on screen until there is.
  if (fields.negated) await box.locator(".pick__negate input").check();
  await box.locator("button", { hasText: label("ui.done") }).click();
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

  /* How much fits on a page, asked in the same breath and as pictures rather
   * than as a pair of numbers. Four of them, and the first is pressed already
   * - a first board is big cells and few of them, and growing later costs
   * nothing. This takes the offered default, which is what the counts below
   * are about. */
  const sizes = asked.locator(".size");
  await expect(sizes).toHaveCount(4);
  await expect(sizes.first()).toHaveAttribute("aria-pressed", "true");
  await expect(sizes.first()).toContainText("3");
  // The choice selects; the footer is what writes anything at all.
  await asked.locator("button", { hasText: label("ui.collection_create") }).click();

  // A name of its own. Both Sammlungen a browser has at this point are named
  // for the day, so the date name cannot tell them apart - and the sidebar
  // reorders by last edited, so neither can a position.
  await page.locator("#collectionName").fill("Tablet");
  await expect(page.locator("#collectionList")).toContainText("Tablet");

  // 3x5 is what a new one starts as, and the bar over the board is the pages
  // and nothing else: the size is the Sammlung's, so it lives in the menu
  // beside its name.
  await expect(cells(page)).toHaveCount(15);
  await expect(page.locator("#appRows")).toHaveCount(0);
  await expect(page.locator("#appCols")).toHaveCount(0);

  /* And then the three things a new Sammlung is handed, deliberately set aside.
   *
   * A blank tablet Sammlung arrives with no colour by word class, with the
   * first column already the Sammlung's, a gap drawn under it and a way back
   * to the start page standing in the corner - see app.blank(). None of the
   * tests below is about any of that, and every one of them is about something
   * those four change the shape of: cell 10 is not an empty cell any more,
   * cell 0 belongs to every page rather than to this one, the gap puts a
   * spacer track between the first column and the second, and three tests read
   * a Fitzgerald colour off a cell or out of the archive. Building the fixture
   * board on top of that would be measuring two things at once.
   *
   * So the board is put back to a plain fifteen cells wearing their classes,
   * through the controls somebody really does use for it - one press of Apply
   * for all three settings, which is what the panel is for. What the defaults
   * *are* is asserted on its own, at the foot of this file, against a Sammlung
   * nothing has been done to.
   */
  await hit(page, 10).click();
  await buttonSheet(page)
    .locator("button", { hasText: label("ui.app_first_column_remove") }).click();
  const plain = await openGrid(page);
  // Fill, border, off - and the first of them is what every layout stored
  // before the choice existed is drawn as, which is why these tests were
  // written against it.
  await plain.getByRole("radio").first().check();
  // Then the share switch, then the gap under it. Each press redraws the panel
  // - the gap's own sentence changes with the switch above it - so the second
  // is found again rather than held from before the first.
  await plain.getByRole("checkbox").first().uncheck();
  await plain.getByRole("checkbox").nth(1).uncheck();
  await plain.locator("button", { hasText: label("ui.app_grid_apply") }).click();
  await closeSheet(page);
  await expect(page.locator("#appGrid .cell--shared")).toHaveCount(0);
  await expect(cells(page).locator(".cell__word")).toHaveCount(0);

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
  /* An exclamation, which is the other thing a word button can be: §7.3's
   * `ext_lautstark_speak_immediately`, said at once and left out of the
   * sentence. The two bar-control buttons that used to stand here are gone
   * with the choice that made them - the viewer draws Speak, Undo and Clear on
   * the message bar itself, so a grid button for one of them spent a cell out
   * of fifteen duplicating a control that is always on screen. */
  await put(page, 10, { label: "Hallo", wordClass: "social", act: "speak" });

  // A way to a page that does not exist yet. "Neue Seite …" is the whole
  // interaction: it mints the page, names it after the button and points the
  // button at it, because making somebody leave, make a page and come back is
  // one thought in three steps.
  await put(page, 3, { label: "Essen", wordClass: "category", act: "goto",
                       gotoPage: "ui.app_goto_new" });
  // The button made a page and pointed at it, so the row over the board - what
  // *this* page opens - has one tile on it, and the picker counts two pages.
  // The button made a page and pointed at it, so the list has two rows and the
  // button carries the corner that follows it.
  await expect(page.locator(".pagelist__item")).toHaveCount(2);
  await expect(page.locator("#appGrid .cell__follow")).toHaveCount(1);
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // Onto the new page, by the row. Pressing the navigation button itself opens
  // its sheet rather than following it, or it would be the one button on the
  // board nobody could ever edit - so the row is the way across, and it holds
  // exactly the pages this page's buttons lead to.
  await goPage(page, "Essen");
  await expect(cells(page).locator(".cell__word")).toHaveCount(0);
  await put(page, 0, { label: "Mehr", wordClass: "descriptor" });
  await put(page, 14, { label: "Start", wordClass: "other", act: "home" });
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // The voice, which decides what the package sounds like and what its boards
  // say their locale is.
  // Two sheets, because they are two scopes: the key stocks the list for every
  // Sammlung on this machine, and the tick binds exactly this one.
  await openSettings(page);
  await openPanel(page, "#azurePanel");
  await page.locator("#azureKey").fill("0000fakekeyfakekeyfakekey0000");
  await page.locator("#azureRegion").fill("westeurope");
  await page.locator("#azureSave").click();

  await openVoices(page);
  await page.locator("#voiceList .voiceRow", { hasText: "Katja" }).locator("button.voice").click();
  await expect(page.locator('#voiceList .voice[aria-checked="true"]')).toHaveCount(1);
  await page.locator("#collectionSheetClose").click();
  await expect(page.locator("#collectionSheet")).toBeHidden();
}

/* --- the tests ----------------------------------------------------------- */

test("a tablet Sammlung leaves as a package, and it passes the spec's own checks",
  async ({ page }) => {
    await standIn(page);
    await build(page);

    // The one whole-Sammlung act for this target, in the work head beside the
    // name - conventions.md §3.3, and the reason the ⋯ does not offer it here.
    await exportPackage(page);
    const asked = sheet(page, "ui.package_title");
    await expect(asked).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      asked.locator("button", { hasText: label("ui.package_go") }).click(),
    ]);

    const path = await download.path();
    expect(path).toBeTruthy();
    // .zip, not .obz. Chrome on Android goes by the media type for an
    // unregistered extension, so a blob declared application/zip and named
    // .obz is one the download manager refuses — see exchange/SPEC.md 2.
    expect(download.suggestedFilename()).toMatch(/-app\.zip$/);

    const bytes = new Uint8Array(readFileSync(path!));
    // Where the round-trip sample comes from. The check no test on this side
    // can make is whether the *other* program agrees, so the file goes into
    // vorlaut-app and its importer opens it - see
    // boardpackage/src/test/resources/builder/README.md there.
    if (process.env.DUMP_TO) writeFileSync(process.env.DUMP_TO, bytes);
    const { pkg } = readPackage(bytes);

    expect(checkPackage(pkg)).toEqual([]);
    expect(pkg.manifest.format).toBe("open-board-0.1");
    expect(pkg.manifest.ext_lautstark_spec_version).toBe("1.2.0");
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

    await exportPackage(page);
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

    // Navigation, and the exclamation.
    expect(at("board-1-r1c4").load_board?.id).toBe("board-2");
    expect(at("board-1-r1c4").load_board?.path).toBe("boards/board-2.obf");
    expect(at("board-1-r3c1").ext_lautstark_speak_immediately).toBe(true);
    expect(at("board-1-r3c1").action).toBeUndefined();

    /* The one §7.4 action the sheet still makes, and the reason it still does:
     * nothing in the viewer's chrome goes home, so a home button needs a cell.
     * It is written as `:home` rather than as a `load_board` at whichever page
     * is home today, because the two part company the moment somebody moves
     * the start page. */
    const food = pkg.boards.find((one) => one.id === "board-2")!;
    expect(food.buttons.find((one) => one.id === "board-2-r3c5")!.action).toBe(":home");

    // A clip only where pressing the button speaks its own text. The viewer
    // utters on Append and SpeakImmediately and on nothing else, so a clip on
    // a navigation button would be an archive member nothing can ever play.
    // The picture, baked into the archive as pixels rather than left as a
    // reference - which is what separates this export from the talker's.
    const pictured = at("board-1-r1c3");
    expect(pictured.image_id).toBeTruthy();
    const image = start.images.find((one) => one.id === pictured.image_id)!;
    expect(pkg.files.get(image.path)).toBeTruthy();
    expect(image.content_type).toBe("image/png");

    expect(at("board-1-r1c1").sound_id).toBeTruthy();
    expect(at("board-1-r1c4").sound_id).toBeUndefined();
    // The exclamation does speak its own text, so it carries one.
    expect(at("board-1-r3c1").sound_id).toBeTruthy();
    expect(food.buttons.find((one) => one.id === "board-2-r3c5")!.sound_id)
      .toBeUndefined();
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

test("a button puts its word in the sentence and leads onward in one press",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    /* The carrier phrase, which exchange/SPEC.md §7.3 had no way to say before
     * 1.2.0: "ich will" belongs in the sentence, and the page its object is on
     * is where the next press has to happen. Built as two buttons that is two
     * presses, the second of them on a page somebody has just left.
     *
     * Beside "Essen" from build(), which leads to the same page and says
     * nothing. The pair is what makes the assertions below about the flag
     * rather than about the navigation. */
    await put(page, 4, { label: "Ich will", spoken: "ich will",
                         wordClass: "verb", act: "carry", gotoPage: "Essen" });

    await hit(page, 4).click();
    const box = buttonSheet(page);
    await showing(page, "#appDoes", "ui.app_does_carry");
    // The one kind that draws both rows: it says something, and it leads
    // somewhere. Every other choice draws one or neither.
    await expect(box.locator("#appSpoken")).toBeVisible();
    await expect(box.locator("#appSpoken")).toHaveValue("ich will");
    await expect(box.locator("#appGoto")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(box).toHaveCount(0);

    // It speaks, so it can be auditioned from the board - and what goes to the
    // synthesiser is the vocalization, the same as on a word button.
    const said = page.waitForRequest((r) => SYNTHESIS.test(r.url()));
    await cells(page).nth(4).hover();
    await cells(page).nth(4).locator(".cell__play").click();
    expect((await said).postData() ?? "").toContain("ich will");

    await exportPackage(page);
    const asked = sheet(page, "ui.package_title");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      asked.locator("button", { hasText: label("ui.package_go") }).click(),
    ]);
    const { pkg } = readPackage(new Uint8Array(readFileSync((await download.path())!)));
    expect(checkPackage(pkg)).toEqual([]);

    const start = pkg.boards.find((one) => one.id === "board-1")!;
    const at = (id: string) => start.buttons.find((one) => one.id === id)!;

    // One button, both halves. The entry it appends is its vocalization, which
    // is what §7.3 puts in the bar.
    expect(at("board-1-r1c5").load_board?.id).toBe("board-2");
    expect(at("board-1-r1c5").ext_lautstark_append_on_navigate).toBe(true);
    expect(at("board-1-r1c5").vocalization).toBe("ich will");
    // Appending is what utters, so it carries a clip like any word button.
    expect(at("board-1-r1c5").sound_id).toBeTruthy();

    // And "Essen", which leads to the same board and says nothing: absent
    // rather than false, and silent rather than carrying a clip nothing plays.
    expect(at("board-1-r1c4").load_board?.id).toBe("board-2");
    expect(at("board-1-r1c4").ext_lautstark_append_on_navigate).toBeUndefined();
    expect(at("board-1-r1c4").sound_id).toBeUndefined();
  });

test("deleting a page keeps the buttons that led to it", async ({ page }) => {
  await standIn(page);
  await build(page);

  // Standing on the Essen page, which one button on the start page leads to.
  // Deleting is a word at the right end of the page's own head: the page had a
  // card behind a ... beside the path, and both are gone with the path.
  await page.locator("#appPageDelete").click();
  const asked = sheet(page, "ui.app_page_delete");
  // The question names what is on the page *and* what points at it from
  // elsewhere - the second is the only fact in it somebody cannot see from
  // where they are standing, and it is the one that could change their mind.
  await expect(asked).toContainText("Essen");
  // The half of the question that names what points at this page from
   // elsewhere. Matched in either language, since the runner's browser picks.
   await expect(asked.locator(".body")).toContainText(/(hierher|leads? here)/);
  await asked.locator("button", { hasText: label("ui.app_page_delete_go") }).click();

  // The page is gone: one row left in the list, and the line over the board
  // says the start page now leads nowhere.
  await expect(page.locator(".pagelist__item")).toHaveCount(1);
  await expect(page.locator("#appFacts")).toContainText("0");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // The button that led there is still on the start page, with its label, its
  // colour and its cell. Only the edge is gone.
  const essen = page.locator("#appGrid .cell", { hasText: "Essen" });
  await expect(essen).toHaveCount(1);
  await expect(essen).toHaveAttribute("style", /--cell-color:\s*#d8af97/);
  // The → badge is what said it led somewhere, and it does not any more.
  await expect(essen.locator(".cell__act")).toHaveCount(0);
});

/** The grid panel, in the sheet behind the ⋯ beside the Sammlung's name: the
 *  grid size, the colour of a word class and the first column, which are the
 *  three things true of every page.
 *
 * It was an entry of its own in that menu, one line above the settings it is
 * now a panel of. Reached through the shared opener rather than by clicking
 * the menu here, because it is the same sheet as the voice and the language,
 * and closing whatever was left open is that opener's job. */
async function openGrid(page: Page) {
  await openCollectionSettings(page);
  await openPanel(page, "#collectionEditorPanel");
  const card = page.locator("#collectionEditorPanel");
  await expect(card).toBeVisible();
  return card;
}

/** Out of the Sammlung's sheet, back to the board behind it. The sheet is
 *  modal, so anything on the page under it is inert until this runs - and the
 *  grid panel no longer closes it, because applying a panel is not leaving a
 *  sheet. */
async function closeSheet(page: Page) {
  await page.locator("#collectionSheetClose").click();
  await expect(page.locator("#collectionSheet")).toBeHidden();
}

/** One of the four sizes, by the pair it draws. */
const size = (card: Locator, rows: number, columns: number) =>
  card.locator(".size").filter({ has: card.page().locator("b", {
    hasText: new RegExp(`^${rows} . ${columns}$`) }) });

test("the grid grows in silence and asks before it shrinks", async ({ page }) => {
  await standIn(page);
  await build(page);

  /* Growing moves nothing and loses nothing, which is what buttons carrying
   * their own coordinates buys: 3x5 to 6x11 is a bounds change, not a
   * re-index. So there is nothing to warn about, and the button at the foot of
   * the panel is the ordinary apply rather than the destructive one. */
  let card = await openGrid(page);

  /* The heading states the size, which is what §3.5 asks of a panel and what a
   * folded one has to answer on its own. It says the size the Sammlung *is*
   * at, so picking another one does not move it - only pressing does. */
  const stated = page.locator("#collectionEditorState");
  await expect(stated).toHaveText(/^3 . 5$/);
  await size(card, 6, 11).click();
  await expect(stated).toHaveText(/^3 . 5$/);
  await expect(card.locator(".notice")).toHaveCount(0);
  await card.locator("button", { hasText: label("ui.app_grid_apply") }).click();

  // Applied where it stands: the sheet is still open, because a panel that
  // took effect is not a reason to leave one - and the heading has moved.
  await expect(stated).toHaveText(/^6 . 11$/);
  await expect(page.locator("#collectionSheet")).toBeVisible();
  await closeSheet(page);
  await expect(cells(page)).toHaveCount(66);
  await expect(page.locator("#appGrid .cell", { hasText: "Mehr" })).toHaveCount(1);

  /* Something in the far corner, which only the big grid has: the last cell of
   * 6 x 11 is outside 3 x 5, and it is what makes going back a loss. Nothing
   * that was placed at 3 x 5 ever leaves - a button keeps its own coordinates,
   * so growing and shrinking again is not a round trip through a shredder. */
  await put(page, 65, { label: "Ecke", wordClass: "noun" });
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // Shrinking past something says so before it is pressed, and names how many
  // buttons would go - across every page, because the size is one decision for
  // all of them and the losses may be on a page nobody is looking at.
  card = await openGrid(page);
  await size(card, 3, 5).click();
  await expect(card.locator(".notice")).toContainText(/3.5/);

  /* Declined by leaving. There is no Cancel: what is pending lives in the
   * panel and nowhere else, so closing the sheet is how it is declined - and
   * the heading never said the smaller size, because it was never true. */
  await expect(stated).toHaveText(/^6 . 11$/);
  await closeSheet(page);

  // Nothing was written, so the board is the size it was and the button that
  // would have gone is still on it.
  await expect(cells(page)).toHaveCount(66);
  await expect(page.locator("#appGrid .cell", { hasText: "Ecke" })).toHaveCount(1);
  await expect(page.locator("#appGrid .cell", { hasText: "Start" })).toHaveCount(1);

  // Said, and only then done. The button outside goes; the ones inside stay
  // exactly where they were, because none of them was ever re-indexed.
  card = await openGrid(page);
  await size(card, 3, 5).click();
  await card.locator("button", { hasText: label("ui.app_grid_shrink_go") }).click();

  /* Done, and the panel is drawn against what it wrote: the heading is the new
   * size, the sentence that counted what would go has nothing left to count,
   * and the button is the ordinary apply again rather than the destructive one
   * it was a moment ago. */
  await expect(stated).toHaveText(/^3 . 5$/);
  await expect(card.locator(".notice")).toHaveCount(0);
  await expect(card.locator("button", { hasText: label("ui.app_grid_apply") }))
    .toBeVisible();
  await closeSheet(page);
  await expect(cells(page)).toHaveCount(15);
  await expect(page.locator("#appGrid .cell", { hasText: "Ecke" })).toHaveCount(0);
  await expect(page.locator("#appGrid .cell", { hasText: "Start" })).toHaveCount(1);
});

test("a word class is worn as a fill, as a border, or not at all", async ({ page }) => {
  await standIn(page);
  await build(page);

  /* Back to the start page, where the words are - build() finishes on the
   * page it made second. By its whole label rather than by a substring:
   * a cell that merely contains "ich" would match otherwise. */
  await goHome(page);
  const ich = page.locator("#appGrid .cell")
    .filter({ has: page.locator(".cell__word", { hasText: /^ich$/ }) });

  // A fill is what a Sammlung wears when nobody has said otherwise, which is
  // also what every layout stored before the choice existed wears.
  await expect(ich).toHaveAttribute("style", /--cell-color:\s*#fdfd96/);

  // The border says the same thing and leaves the picture under it alone.
  let card = await openGrid(page);
  await card.locator(".opts__opt")
    .filter({ has: page.locator("b", { hasText: label("ui.app_word_color_border") }) })
    .click();
  await card.locator("button", { hasText: label("ui.app_grid_apply") }).click();
  await closeSheet(page);
  await goHome(page);
  await expect(ich).toHaveAttribute("style", /--cell-edge:\s*#fdfd96/);
  await expect(ich).not.toHaveAttribute("style", /--cell-color/);

  // Off is not colourless - the page keeps its own - but no cell says what
  // kind of word is on it any more.
  card = await openGrid(page);
  await card.locator(".opts__opt")
    .filter({ has: page.locator("b", { hasText: label("ui.app_word_color_off") }) })
    .click();
  await card.locator("button", { hasText: label("ui.app_grid_apply") }).click();
  await closeSheet(page);
  await goHome(page);
  await expect(ich).not.toHaveAttribute("style", /--cell-(color|edge)/);

  // And it belongs to the Sammlung, so it is still true after a reload - which
  // is the half a rendering test cannot see: that the choice was written.
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });
  await page.reload();
  await expect(ich).toBeVisible();
  await expect(ich).not.toHaveAttribute("style", /--cell-(color|edge)/);

  /* A cell wearing no colour is where the picture's own ground shows, and
   * that ground stays white. AAC line art is drawn for white and carries none
   * of its own, so on a dark board a symbol without paper under it goes to
   * nothing - which is what .cell__pic's rule is for and why "off" is the
   * state that has to be checked for it.
   *
   * Here rather than beside the start key's own test, because this is the
   * rule and that one is the exception: the two-tone plate is for the single
   * cell whose look belongs to the viewer, and an ordinary symbol taking it
   * would be every board going two-tone. */
  await page.emulateMedia({ colorScheme: "dark" });
  const apfel = cells(page).nth(2);
  await expect(apfel).not.toHaveClass(/cell--home/);
  const ordinary = await apfel.evaluate((el) => {
    const picture = el.querySelector(".cell__pic")!;
    return {
      paper: getComputedStyle(picture).backgroundColor,
      filter: getComputedStyle(picture).filter,
    };
  });
  expect(ordinary.paper).toBe("rgb(255, 255, 255)");
  expect(ordinary.filter).toBe("none");
});

test("a button moves to another cell, by keyboard and by drag", async ({ page }) => {
  await standIn(page);
  await build(page);

  // Back to the start page, where the words are.
  await goHome(page);
  const at = (n: number) => cells(page).nth(n).locator(".cell__word");

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
  // Cell 10 holds "Hallo", so this is the swap rather than the plain move:
  // the two named cells trade and nothing else on the board shifts.
  await cells(page).nth(1).dragTo(cells(page).nth(10));
  await expect(at(10)).toHaveText("ich");
  await expect(at(1)).toHaveText("Hallo");
  await expect(at(6)).toHaveText("will");
});

test("a button can be heard from the board, and only where there is something to hear",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    // On a word, and it is the vocalization that goes to the synthesiser -
    // "Apfel" shows, "einen Apfel" is what the tablet will say.
    const said = page.waitForRequest((r) => SYNTHESIS.test(r.url()));
    await cells(page).nth(2).hover();
    await cells(page).nth(2).locator(".cell__play").click();
    expect((await said).postData() ?? "").toContain("einen Apfel");

    // On the exclamation too, which speaks its own text - the viewer utters on
    // Append and on SpeakImmediately alike, and only what a press really says
    // is worth auditioning.
    await expect(cells(page).nth(10).locator(".cell__play")).toHaveCount(1);

    // Not on the navigation button: pressing that on the tablet says nothing,
    // so offering to audition it would offer silence.
    await expect(cells(page).nth(3).locator(".cell__play")).toHaveCount(0);

    /* And a press on it does not open the cell behind it. Asserted as "no
     * sheet came up" rather than through aria-pressed, which is what said this
     * while the panel existed: a cell is not a thing that stays down, it is a
     * thing that opens a dialog, and it says so with aria-haspopup now. */
    await expect(buttonSheet(page)).toHaveCount(0);
  });

test("a cell says it opens a dialog, and carries no selected state", async ({ page }) => {
  await standIn(page);
  await build(page);
  await goHome(page);

  /* The mark that outlived its meaning. A button used to be selected and the
   * panel showed it, so the cell drew an accent border to say which one the
   * panel was about - and once the panel became a sheet that closes over the
   * board, the border was announcing a selection nothing could act on. It
   * survived a whole redesign because it was drawn from state nothing read. */
  await hit(page, 0).click();
  await expect(buttonSheet(page)).toBeVisible();
  await buttonSheet(page).locator("button", { hasText: label("ui.done") }).click();
  await expect(buttonSheet(page)).toBeHidden();
  await expect(page.locator("#appGrid .cell.current")).toHaveCount(0);
  await expect(hit(page, 0)).not.toHaveAttribute("aria-pressed", /.*/);

  // What it does say instead, on a filled cell and on an empty one - both open
  // the same sheet.
  await expect(hit(page, 0)).toHaveAttribute("aria-haspopup", "dialog");
  await expect(hit(page, 14)).toHaveAttribute("aria-haspopup", "dialog");
});

test("a move stops at the edge of the grid rather than walking off it",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    // "ich" is in the top left. Up and left have nowhere to go, and Alt+Left
    // is history-back in some engines - so both are claimed and neither moves
    // anything.
    await hit(page, 0).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(cells(page).nth(0).locator(".cell__word")).toHaveText("ich");
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
    await goHome(page);

    /* The rule this whole draft model exists for. Pressing an empty cell used
     * to mint a button and move the panel to it, so an accidental press left a
     * blank button on the board - and a dialog somebody closes must cost
     * exactly what it looked like it would. */
    const empty = cells(page).nth(5);
    await expect(empty).toHaveClass(/cell--empty/);
    await hit(page, 5).click();
    await expect(buttonSheet(page)).toBeVisible();
    await buttonSheet(page).locator("#appLabel").fill("weg damit");
    await page.keyboard.press("Escape");
    await expect(buttonSheet(page)).toBeHidden();
    // Still empty, and still empty after a reload - nothing was written to be
    // read back.
    await expect(empty).toHaveClass(/cell--empty/);
    await page.reload();
    await expect(cells(page).nth(5)).toHaveClass(/cell--empty/);

    // The same for a button that already exists: the draft is thrown away and
    // the label on the board is the one it had.
    await goHome(page);
    await hit(page, 0).click();
    await expect(buttonSheet(page)).toBeVisible();
    await buttonSheet(page).locator("#appLabel").fill("nicht ich");
    await page.keyboard.press("Escape");
    await expect(buttonSheet(page)).toBeHidden();
    await expect(cells(page).nth(0).locator(".cell__word")).toHaveText("ich");
  });

test("the three kinds carry the acts they always did, and the start page is a target",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    /* "Wort" and "Ausruf" are `append` and `speak`, and the reason they carry
     * those names is that the old pair described an axis that does not exist:
     * vorlaut-app's BoardViewModel calls utter() for both, so both speak and
     * the only difference is whether the word joins the sentence. What is
     * asserted here is that the labels are the sheet's and the wiring is the
     * format's. */
    await put(page, 6, { label: "Aua", wordClass: "social", act: "speak" });
    await hit(page, 6).click();
    await showing(page, "#appDoes", "ui.app_does_shout");
    // It speaks, so it is asked what it says.
    await expect(buttonSheet(page).locator("#appSpoken")).toBeVisible();
    await expect(buttonSheet(page).locator("#appGoto")).toBeHidden();
    await page.keyboard.press("Escape");

    /* The start page is an entry in the target list rather than a kind of its
     * own, because it is navigation - grouping it with the bar controls said
     * it did something to the sentence. The act underneath is still `home`,
     * which is what makes it follow a start page somebody moves. */
    await goPage(page, "Essen");
    await hit(page, 14).click();
    await showing(page, "#appDoes", "ui.app_does_goto");
    await showing(page, "#appGoto", HOME);

    /* A navigation button says nothing, so Gesprochen and its play button are
     * not on screen at all - they were two dead controls with nothing telling
     * anybody so. Wortart is *not* one of them, which looks like an oversight
     * and is not: a page-leading button is coloured as a category on real
     * German boards, and the round-trip sample above asserts that colour. */
    await expect(buttonSheet(page).locator("#appSpoken")).toBeHidden();
    await expect(buttonSheet(page).locator("#appClass")).toBeVisible();
    await page.keyboard.press("Escape");

    // And the default carries no mark on the board at all, which is what makes
    // the marks on the others worth reading.
    await goHome(page);
    await expect(cells(page).nth(0).locator(".cell__act")).toHaveCount(0);
    await expect(cells(page).nth(6).locator(".cell__act")).toHaveCount(1);
  });

/** Puts an act the sheet can no longer make onto a button, in the database.
 *
 * The only way to reach that state, and the reason it is worth reaching: a
 * `sayBar` button cannot be made here any more, and none can arrive either -
 * importObz() has no mapping for the bar acts on the way in and reads into a
 * talker layout rather than a tablet one. So such a button exists only as a
 * layout already sitting in somebody's browser, which is exactly where this
 * puts one.
 */
async function actInStore(page: Page, on: string, kind: string): Promise<void> {
  await page.evaluate(([on, kind]) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("vorlaut");
    open.onerror = () => reject(new Error("no database"));
    open.onsuccess = () => {
      const tx = open.result.transaction(["marks", "layouts"], "readwrite");
      const current = tx.objectStore("marks").get("current");
      current.onsuccess = () => {
        const layouts = tx.objectStore("layouts");
        const got = layouts.get(current.result as string);
        got.onsuccess = () => {
          const held = got.result as { id: string; text: string; version: string };
          const layout = JSON.parse(held.text);
          const button = layout.pages
            .flatMap((one: { buttons: { label: string }[] }) => one.buttons)
            .find((one: { label: string }) => one.label === on);
          if (!button) { reject(new Error(`no button labelled ${on}`)); return; }
          // The version stamp is left as it is: it is the hash of what was
          // last *written*, and nothing here writes through the app.
          button.act = { kind };
          layouts.put({ ...held, text: JSON.stringify(layout) });
          // Closed, so the app's own connection is never the one waiting.
          tx.oncomplete = () => { open.result.close(); resolve(); };
        };
      };
    };
  }), [on, kind]);
  await page.reload();
}

test("a button made before the bar controls went keeps saying what it is",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await actInStore(page, "Hallo", "sayBar");
    await goHome(page);

    /* It opens, and it opens saying `sayBar` - not re-read as "Wort", which is
     * the silent way for a board to change under somebody who only came to fix
     * a typo. An entry of its own that only such a button has. */
    await hit(page, 10).click();
    await showing(page, "#appDoes", "ui.app_act_say_bar");
    // And it is in the list too, as one more alternative rather than a command
    // among radios - which is what would happen if `checked` were left off the
    // one entry that is not one of the kinds the sheet offers.
    await page.click("#appDoes");
    await expect(page.locator(".menu button")).toHaveCount(5);
    const inForce = page.locator('.menu button[aria-checked="true"]');
    await expect(inForce).toHaveCount(1);
    await expect(inForce).toHaveText(among("ui.app_act_say_bar"));
    await page.keyboard.press("Escape");

    // And Fertig on a sheet nobody changed leaves the act where it was. Only
    // choosing one of the kinds it offers replaces it.
    await buttonSheet(page).locator("button", { hasText: label("ui.done") }).click();
    await expect(buttonSheet(page)).toBeHidden();
    await hit(page, 10).click();
    await showing(page, "#appDoes", "ui.app_act_say_bar");
    await pick(page, "#appDoes", "ui.app_does_word");
    await buttonSheet(page).locator("button", { hasText: label("ui.done") }).click();
    await expect(buttonSheet(page)).toBeHidden();
    await hit(page, 10).click();
    await showing(page, "#appDoes", "ui.app_does_word");
    await page.keyboard.press("Escape");
  });

test("the sheet's three questions are dropdowns, and the long one stays in the sheet",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    /* Not one select left in the product. The OS draws a select's open list,
     * so it is the one control on a page that cannot follow the tokens - the
     * settings sheet lost its two for that reason and this sheet held the
     * last three. */
    await hit(page, 7).click();
    const box = buttonSheet(page);
    await expect(box).toBeVisible();
    expect(await page.locator("select").count()).toBe(0);
    for (const which of ["#appDoes", "#appGoto", "#appClass"]) {
      await expect(box.locator(which)).toHaveJSProperty("tagName", "BUTTON");
      await expect(box.locator(which)).toHaveAttribute("aria-haspopup", "menu");
    }

    /* The word class is the longest list in the product - eleven entries - and
     * it hangs off the last row of a sheet whose body is its one scrolling
     * area. Left alone it lengthened what the sheet scrolls, which moves the
     * fields under it while somebody is choosing, and put its own last rows
     * behind the foot. fit() in shell/sheet.ts opens it upward and caps it at
     * the room there is; what is asserted is the outcome - the list is inside
     * the body, and the body scrolls no further than it did with the list
     * shut. */
    const scroll = () => box.locator(".body").evaluate(
      (one) => one.scrollHeight - one.clientHeight);
    const shut = await scroll();
    await box.locator("#appClass").click();
    const menu = page.locator(".menu");
    await expect(menu.locator("button")).toHaveCount(11);
    expect(await scroll()).toBe(shut);
    const inside = await menu.evaluate((one) => {
      const body = one.closest(".body")!.getBoundingClientRect();
      const list = one.getBoundingClientRect();
      return list.top >= body.top - 1 && list.bottom <= body.bottom + 1;
    });
    expect(inside).toBe(true);

    // One in force and the rest offered, which is what `checked` on every item
    // buys and a plain list of commands would leave to the drawing.
    await expect(page.locator('.menu button[aria-checked="true"]')).toHaveCount(1);

    // Escape dismisses the list and leaves the sheet standing, which is the
    // half a menu inside a <dialog> gets wrong by default.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(box).toBeVisible();

    // And the trigger follows the choice, which a select did for free.
    await pick(page, "#appClass", "ui.wordclass_verb");
    await showing(page, "#appClass", "ui.wordclass_verb");
    await page.keyboard.press("Escape");
  });

test("what the first column costs is said across the sheet, not above one field",
  async ({ page }) => {
    await standIn(page);
    await build(page);

    // The column becomes the Sammlung's rather than each page's, in the grid
    // panel of the sheet behind the ⋯ beside its name.
    const card = await openGrid(page);
    await card.getByRole("checkbox").first().check();
    await card.locator("button", { hasText: label("ui.app_first_column_take_go") }).click();
    await closeSheet(page);
    await expect(page.locator("#appGrid .cell--shared")).toHaveCount(3);

    await page.locator("#appGrid .cell--shared").first()
      .locator(".cell__open").click();
    const box = buttonSheet(page);
    const notice = box.locator(".notice");
    await expect(notice).toHaveText(label("ui.app_first_column_button"));

    /* It is about the button, not about the field it used to stand over. So it
     * is a child of the body spanning both columns rather than the first of
     * the rows that become the right-hand one - which is a fact about width:
     * it reaches wider than the form beside it. */
    await expect(notice).toHaveJSProperty("parentElement.className", "body");
    const spans = await notice.evaluate((one) =>
      Math.round(one.getBoundingClientRect().width)
      > Math.round(one.closest(".body")!.querySelector(".form")!
          .getBoundingClientRect().width));
    expect(spans).toBe(true);

    // A cell that is not the column's says nothing, which is what makes the
    // sentence worth reading where it is said.
    await page.keyboard.press("Escape");
    await hit(page, 7).click();
    await expect(buttonSheet(page).locator(".notice")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

/* The shared first column, and what it does to the list.
 *
 * A `goto` in the Sammlung's own first column is an edge from *every* page, so
 * its target is one press from anywhere - which is the whole of what makes the
 * column persistent. Two things follow, and they used to be said by a picker
 * that no longer exists.
 *
 * The target is reachable, so it wears no ⚠. And it is still not counted as
 * something this page leads onward to, because opens() leaves the column out
 * on purpose: it belongs to the Sammlung and not to any page, and counting it
 * per page would put the same two or three names on every page's line
 * forever.
 */
test("a way onward in the shared column reaches its page without being on it",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    const card = await openGrid(page);
    await card.getByRole("checkbox").first().check();
    await card.locator("button", { hasText: label("ui.app_first_column_take_go") }).click();
    await closeSheet(page);

    await put(page, 0, { label: "Woerter", wordClass: "category", act: "goto",
                         gotoPage: "ui.app_goto_new" });

    // Reachable from everywhere, so the list marks it like any other page.
    await expect(pageRow(page, "Woerter")).toBeVisible();
    await expect(pageRow(page, "Woerter").locator(".tab__lost")).toHaveCount(0);

    /* And on Essen, which opens nothing of its own, the line still says so.
     * The column leads onward from here as it does from every page, and that
     * is exactly why it is not counted as something *this* page does. */
    await goPage(page, "Essen");
    await expect(page.locator("#appFacts")).toContainText(
      new RegExp(`${label("ui.app_page_from_here").source.slice(1, -1)} 0`));
  });

/* The line of facts over the board, and the two directions in it.
 *
 * Both are real edges - inboundTo() read backwards and opens() read forwards -
 * which is the whole difference between this line and the row of tiles it
 * replaces. That row showed only what a page opened, so it was empty on every
 * board nobody had linked yet, and empty is most of a board's first sitting.
 *
 * The board's top edge is asserted too. It was the reason the row had a fixed
 * height, and the reason survives the row: chrome that grows when a page is
 * opened pushes the work off the bottom of the screen.
 */
test("the facts line says both directions, and the board does not move",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    const facts = page.locator("#appFacts");
    const top = async () => (await page.locator("#appGrid").boundingBox())!.y;

    // The start page opens Essen and nothing leads to it: the tablet opens
    // with it, which is the one page where a zero here is not a fault.
    await expect(facts).toContainText("0");
    await expect(facts).toContainText("1");
    const board = await top();

    // Onto Essen, which opens nothing and is led to by one page. The line says
    // both, and the grid has not moved.
    await goPage(page, "Essen");
    await expect(facts).toContainText("1");
    expect(await top()).toBe(board);

    /* Unfolding a number costs the board nothing either: what opens is under
     * the line and over the grid, and the grid is what may not jump. */
    await facts.locator("button").first().click();
    await expect(page.locator("#appFactLinks")).toBeVisible();
  });

/* The list in the sidebar, which is what keeps the editor complete.
 *
 * Every page is a row, whether anything leads to it or not, and every row is
 * one press. That is the promise a bar over the board could never make: a bar
 * cannot scroll, so every drawing of one had to hide something - fold it, pick
 * a level, choose one parent among several. A column can simply be longer.
 */
test("the sidebar lists every page, orphans and all, and opens one",
  async ({ page }) => {
    await standIn(page);
    await build(page);

    const rows = page.locator(".pagelist__item");
    await expect(rows).toHaveCount(2);
    // No ⚠ yet: both pages are reachable.
    await expect(page.locator(".pagelist__item .tab__lost")).toHaveCount(0);

    /* "+ Neue Seite" makes a page and links it to nothing, which is the
     * ordinary state for the five seconds before somebody makes the button
     * that leads to it. pages.ts reports that and refuses nothing. */
    await page.locator(".pagelist__new").click();
    await expect(rows).toHaveCount(3);
    await expect(page.locator(".pagelist__item .tab__lost")).toHaveCount(1);

    // The start page carries the house, and only it.
    await expect(page.locator(".pagelist__home")).toHaveCount(1);

    /* And the row is a way there. Standing on the new page, the name over the
     * board is the new page's - which is also the field that renames it. */
    await goHome(page);
    await expect(standingOn(page)).toHaveValue("");
    await goPage(page, /3/);
    await expect(page.locator(".pagehead__warn")).toBeVisible();
  });

/* The case the old row was blank on, which is every Sammlung before any of the
 * linking is done.
 *
 * The row over the board held the pages the page on screen opened, so on a
 * board where nothing opens anything it held nothing - and linking pages is
 * precisely the work this editor exists for. The list cannot have that failure:
 * a page is a row from the moment it is made, and being unreachable only adds
 * a mark to it.
 *
 * Both halves are asserted. A list that showed them without the mark would say
 * nothing about the one fact that matters - that the tablet cannot reach them.
 */
test("a page nothing leads to is a row from the moment it is made",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    const rows = page.locator(".pagelist__item");
    const marked = page.locator(".pagelist__item", { has: page.locator(".tab__lost") });
    await expect(marked).toHaveCount(0);

    await page.locator(".pagelist__new").click();
    await page.locator(".pagelist__new").click();

    // Both are in the list, both marked, and both one press away from here.
    await expect(rows).toHaveCount(4);
    await expect(marked).toHaveCount(2);

    /* Standing on the second of them: the head says it too, and the line under
     * it says why in words when the number is unfolded. */
    await expect(page.locator(".pagehead__warn")).toBeVisible();
    await page.locator("#appFacts button").first().click();
    await expect(page.locator("#appFactLinks"))
      .toHaveText(label("ui.app_page_here_none"));

    // And the page it really does open is unmarked, from the start page.
    await goHome(page);
    await expect(pageRow(page, "Essen").locator(".tab__lost")).toHaveCount(0);
  });

/* Up and down walk the list, which is what replaces a "previous page" and a
 * "next page" that a bar would have needed. Bound to the row rather than to
 * the document, because in the name field over the board those two keys belong
 * to the field - which is the half this asserts second.
 */
test("the arrow keys walk the page list, and leave the name field alone",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    await pageRow(page, /1/).click();
    await page.keyboard.press("ArrowDown");
    await expect(standingOn(page)).toHaveValue("Essen");
    await page.keyboard.press("ArrowUp");
    await expect(standingOn(page)).toHaveValue("");

    // At the end of the list nothing happens, rather than wrapping round.
    await page.keyboard.press("ArrowUp");
    await expect(standingOn(page)).toHaveValue("");

    /* In the field the keys are the field's. Typing then pressing Down must
     * leave the page where it is - the caret moves, not the editor. */
    await standingOn(page).click();
    await standingOn(page).fill("Morgens");
    await page.keyboard.press("ArrowDown");
    await expect(standingOn(page)).toHaveValue("Morgens");
  });

/* The status line says a Sammlung is saved, and then stops saying it.
 *
 * It is the one status that is true almost always, and a label that reads the
 * same whenever anybody looks stops being read - which is the worst thing that
 * can happen to the one line where a failed write appears. It fades rather
 * than being cleared: the words stay true until the next keystroke, so they
 * stay in the element for a reader who comes to the region.
 */
test("the saved status steps back, without taking its words with it",
  async ({ page }) => {
    await standIn(page);
    await build(page);

    const line = page.locator("#status");
    await expect(line).toHaveText(SAVED, { timeout: 10_000 });
    // Lit at first, and then only quiet - the text is still there.
    await expect(line).toHaveClass(/status--rested/, { timeout: 10_000 });
    await expect(line).toHaveText(SAVED);

    /* Anything else said wakes it. Typing puts the line back to "not written
     * yet", which is a state that must never inherit the fade. */
    await page.locator("#appPageName").fill("Morgens");
    await expect(line).not.toHaveClass(/status--rested/);
  });

/* The two marks a cell carries, and the two it no longer needs.
 *
 * A `goto` had an arrow in one corner and now has the corner that follows it in
 * the other; one of them said nothing the other did not. A `home` had a house
 * at 11px and now has a heavier edge, which marks the whole cell - on a board
 * the way back is the one button somebody reaches for without reading it.
 *
 * The edge is asserted in pixels because that is what it is. A class name would
 * pass whatever the rule under it said, including nothing.
 */
test("a way onward is marked by its corner and a way back by its edge",
  async ({ page }) => {
    await standIn(page);
    await build(page);
    await goHome(page);

    // The Essen button leads onward: one corner, and no arrow badge.
    const essen = cells(page).nth(3);
    await expect(essen.locator(".cell__follow")).toHaveCount(1);
    await expect(essen.locator(".cell__act")).toHaveCount(0);
    /* And the two corners have seats of their own. Measured against the cell
     * rather than by class, because the claim is where they are: the follow on
     * the left, the play - drawn here because this button carries its word
     * into the sentence - on the right, and no arithmetic keeping them
     * apart. */
    const box = await essen.boundingBox();
    const corner = await essen.locator(".cell__follow").boundingBox();
    expect(corner!.x - box!.x).toBeLessThan(box!.width / 2);

    /* And the way back, which build() puts in cell 14. A plain cell for the
     * comparison, so the assertion is a difference rather than a number
     * somebody has to look up. */
    await goPage(page, "Essen");
    const back = cells(page).nth(14);
    await expect(back.locator(".cell__act")).toHaveCount(0);
    const edge = async (at: number) => (await cells(page).nth(at)
      .evaluate((one) => getComputedStyle(one).borderTopWidth));
    expect(await edge(14)).toBe("5px");
    expect(await edge(0)).toBe("2px");
  });

/* The button count says how full the page is, which is the half the bare
 * number was missing: twelve buttons mean different things on a 3x5 and a
 * 6x11, and the difference is in the effort number beside it. */
test("the button count unfolds into how full the page is", async ({ page }) => {
  await standIn(page);
  await build(page);
  await goHome(page);

  const facts = page.locator("#appFacts");
  await facts.locator("button").last().click();
  // 3x5 is what build() leaves the Sammlung on.
  await expect(page.locator("#appFactLinks")).toContainText("15");
});

/* Everything about a page, now that it has no card.
 *
 * The ⋯ beside the path held three things and the path is gone, so each of them
 * had to earn its own place: the name became the field that renames it - which
 * is what frame.ts already says a name should be - the start page became a word
 * that only appears where it would do something, and deleting was the one act
 * left. A menu with one entry is not a menu.
 */
test("a page is renamed by typing over it, and the start page is a word",
  async ({ page }) => {
    await standIn(page);
    await build(page);

    // On Essen, which is not the start page: the offer is there and the house
    // is not.
    await goPage(page, "Essen");
    await expect(page.locator(".pagehead__home")).toBeHidden();
    await expect(page.locator("#appPageStart")).toBeVisible();

    // Renaming is typing. No sheet, no Fertig, and the sidebar row follows.
    await standingOn(page).fill("Mittags");
    await expect(pageRow(page, "Mittags")).toBeVisible();
    await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

    // Making it the start page moves the house here and takes the offer away,
    // because on the start page it would be a button that does nothing.
    await page.locator("#appPageStart").click();
    await expect(page.locator(".pagehead__home")).toBeVisible();
    await expect(page.locator("#appPageStart")).toBeHidden();
    await expect(pageRow(page, "Mittags").locator(".pagelist__home")).toHaveCount(1);

    // And deleting is still a question, wherever it is pressed from.
    await expect(page.locator("#appPageDelete")).toBeVisible();
  });

test("a crossed-out picture is its own picture in the package", async ({ page }) => {
  /* The tablet half of a convention the five-key editor is tested on in
   * happy.spec.ts: German AAC negates by crossing the symbol out rather than
   * by using a picture of its own.
   *
   * Two things are asserted and the second is why this test is here rather
   * than beside that one. The board says it - the cell draws the cross over
   * the picture. And the package says it in pixels: exchange/SPEC.md closes
   * its button extensions at v1 §4.3 and §5 already carries every image as a
   * file, so the cross is baked into the PNG instead of travelling as a flag,
   * and a viewer that has never heard of negation shows the button correctly.
   *
   * What that costs is a second member of the archive for one reference, and
   * that cost is the thing worth checking. Filed under the reference alone -
   * which is how every picture in this repository was filed until this - the
   * plain button and the crossed-out one shared one file, and whichever was
   * baked first won both. A board that says "Brot" where it was built to say
   * "kein Brot" is the failure this feature exists to prevent, and it is
   * silent everywhere except on the device.
   */
  await standIn(page);
  await build(page);
  await goHome(page);

  const picture = join(HERE, "fixtures", "symbol.png");
  await put(page, 1, { label: "Brot", upload: picture });
  await put(page, 2, { label: "kein Brot", upload: picture, negated: true });

  // The same uploaded picture on both cells, and one of them crossed out.
  await expect(cells(page).nth(1).locator(".cell__pic")).toBeVisible();
  await expect(cells(page).nth(1).locator(".negate")).toHaveCount(0);
  await expect(cells(page).nth(2).locator(".cell__pic")).toBeVisible();
  await expect(cells(page).nth(2).locator(".cell__crossed .negate")).toBeVisible();

  await exportPackage(page);
  const asked = sheet(page, "ui.package_title");
  await expect(asked).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    asked.locator("button", { hasText: label("ui.package_go") }).click(),
  ]);
  const { pkg, members } = readPackage(
    new Uint8Array(readFileSync((await download.path())!)));

  // Two PNGs from one upload: the drawing, and the drawing crossed out.
  const pngs = [...members.keys()].filter((name) => name.endsWith(".png"));
  expect(pngs).toHaveLength(2);

  // And the two buttons name different ones.
  const start = pkg.boards.find(
    (one) => one.buttons.some((two) => two.label === "Brot"))!;
  const shown = (word: string) =>
    start.buttons.find((one) => one.label === word)?.image_id;
  expect(shown("Brot")).toBeTruthy();
  expect(shown("kein Brot")).toBeTruthy();
  expect(shown("Brot")).not.toBe(shown("kein Brot"));

  // Still a package the format's own checks accept.
  expect(checkPackage(pkg)).toEqual([]);
});

test("the start key is drawn as the tablet draws it, not as the collection does",
  async ({ page }) => {
    /* The second test in this file that does not call build(), and for the
     * same reason as the one below it: build() puts a word in the corner cell,
     * and the start key is one of the things it sets aside.
     *
     * This cell is the one place on the board whose appearance belongs to the
     * viewer rather than to the collection. Everything else here is a word -
     * paper under the picture because AAC line art is drawn for white, a
     * Fitzgerald tint saying which kind of word, the label spelling it - and
     * BoardScreen.kt draws `:home` as none of those: a dark plate with the
     * picture's luminance mapped onto two tones. The editor drew it as a word
     * anyway, so the one cell it could not preview was the one cell that does
     * not look like its own picture.
     *
     * Asserted through the computed style rather than by photographing it,
     * because what regresses here is wiring: the filter losing the element,
     * the grid's white rule reclaiming it, or the plate becoming a theme token
     * and following the editor's scheme instead of the tablet's.
     */
    await standIn(page);
    page.on("pageerror", (error) => { throw error; });
    await page.goto("./");
    await page.locator("#collectionNew").click();
    const asked = sheet(page, "ui.collection_target");
    await asked.locator("button.choice")
      .filter({ has: page.locator("strong", { hasText: label("ui.collection_target_app") }) })
      .click();
    await asked.locator("button", { hasText: label("ui.collection_create") }).click();
    await expect(cells(page)).toHaveCount(15);

    // The lower left of a 3x5, which is where a thumb is - and the only cell
    // the board arrives with anything in.
    const home = page.locator("#appGrid .cell--home");
    await expect(home).toHaveCount(1);
    await expect(cells(page).nth(10)).toHaveClass(/cell--home/);
    // The picture arrives behind the making of the Sammlung, so the treatment
    // has something to apply to.
    await expect(home.locator(".cell__pic")).toBeVisible();

    const drawn = await home.evaluate((el) => {
      const picture = el.querySelector(".cell__pic")!;
      const word = el.querySelector(".cell__word");
      return {
        plate: getComputedStyle(el).backgroundColor,
        filter: getComputedStyle(picture).filter,
        paper: getComputedStyle(picture).backgroundColor,
        word: word ? getComputedStyle(word).display : "absent",
      };
    });
    // HOME_TONES.plate. Deliberately not a theme token - see .cell--home in
    // ui.css, and the same sentence at .pick__hit--home.
    expect(drawn.plate).toBe("rgb(36, 36, 42)");
    expect(drawn.filter).toContain("#homeTone");
    // The white rule's one declared exception: paper is what makes a cell read
    // as a word, and this cell is not one.
    expect(drawn.paper).toBe("rgba(0, 0, 0, 0)");
    // The tablet drops the word on this button, so this does too. It is still
    // on the button and still exported - the test below is what says so - and
    // it is still what a screen reader is given.
    expect(drawn.word).toBe("none");
    await expect(home.locator(".cell__open"))
      .toHaveAttribute("aria-label", label("ui.app_home_key"));

    /* Nothing follows the editor's scheme, because nothing on this cell is the
     * editor's. The same three values in the other scheme, which is the whole
     * of what "this is the tablet's tile" means. */
    await page.emulateMedia({ colorScheme: "light" });
    const light = await home.evaluate((el) => ({
      plate: getComputedStyle(el).backgroundColor,
      paper: getComputedStyle(el.querySelector(".cell__pic")!).backgroundColor,
    }));
    expect(light).toEqual({ plate: drawn.plate, paper: drawn.paper });
  });

test("a Sammlung nobody has touched exports as the board it was handed",
  async ({ page }) => {
    /* The one test in this file that does not call build(), and the reason
     * build() may put the defaults aside: this is where they are held to.
     *
     * A new tablet Sammlung is handed four things nobody chose - no colour by
     * word class, a first column that belongs to the Sammlung, a gap under it,
     * and a way back to the start page in the corner of that column. Three of
     * them are only worth anything if they survive the export, because the
     * board somebody builds here is not the board a child uses: that one is
     * read out of the archive by another program entirely. A start key that is
     * right in the editor and absent from the package is a key that works for
     * as long as somebody is looking at it.
     *
     * Nothing is done to the Sammlung between making it and exporting it. That
     * is the whole design of the test - every other assertion in this file is
     * about an act, and this one is about what arrives before any act.
     */
    await standIn(page);
    page.on("pageerror", (error) => { throw error; });
    page.on("console", (one) => {
      if (one.type() === "error") throw new Error(`console: ${one.text()}`);
    });
    await page.goto("./");
    await page.locator("#collectionNew").click();
    const asked = sheet(page, "ui.collection_target");
    await asked.locator("button.choice")
      .filter({ has: page.locator("strong", { hasText: label("ui.collection_target_app") }) })
      .click();
    await asked.locator("button", { hasText: label("ui.collection_create") }).click();

    /* The board, as it arrives. The start key is the lower left of a 3x5, which
     * is cell 10, and it is in the column the Sammlung owns rather than on the
     * page - so it is one of three shared cells and it is the only one of them
     * with anything in it. */
    await expect(cells(page)).toHaveCount(15);
    await expect(page.locator("#appGrid .cell--shared")).toHaveCount(3);
    await expect(page.locator("#appGrid.grid--gap")).toHaveCount(1);
    await expect(cells(page).locator(".cell__word")).toHaveCount(1);
    /* The word is on the button, which is what this asserts - not that it is
     * drawn. The tablet leaves it off the plate and so does the board; the
     * test above is where that is held. It still exports, still opens in
     * Aufschrift, and is still what a screen reader is given. */
    await expect(cells(page).nth(10).locator(".cell__word")).toHaveText(
      label("ui.app_home_key"));
    /* And its picture, which arrives after the board does - the download runs
     * behind the Sammlung being made rather than in front of it, so that a
     * first board never waits on the network. This is the assertion that the
     * repaint afterwards actually happens: without it the cell would hold a
     * reference to a file that is in the store and was not there when the cell
     * decided there was no picture. */
    await expect(cells(page).nth(10).locator(".cell__pic")).toBeVisible();
    /* No wait for "gespeichert" here, unlike everywhere else in this file, and
     * that is the point rather than an omission: the status line says a save
     * happened, and nothing has been edited. createCollection() wrote the
     * Sammlung, and the export below reads what it wrote. */

    await exportPackage(page);
    const sending = sheet(page, "ui.package_title");
    await expect(sending).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      sending.locator("button", { hasText: label("ui.package_go") }).click(),
    ]);
    const { pkg } = readPackage(
      new Uint8Array(readFileSync((await download.path())!)));

    // §4.1's hint, which is what makes the tablet draw the column the way the
    // editor drew it. Written only where it is asked for, so its presence here
    // is the whole of the assertion.
    expect(pkg.manifest.ext_lautstark_first_column_gap).toBe(true);

    // §7.4's action, on the lower-left cell of the one board there is, with the
    // picture that was fetched behind the making of it.
    const board = pkg.boards[0]!;
    const start = board.buttons.find((one) => one.id === `${board.id}-r3c1`)!;
    expect(start).toBeDefined();
    expect(start.action).toBe(":home");
    expect(start.image_id).toBeTruthy();
    // The key navigates and says nothing on the way, which is what the sheet
    // that describes it says it does.
    expect(start.ext_lautstark_append_on_navigate).toBeUndefined();

    // No colour by word class means neither field on any button, which is what
    // "off" writes - not a colour, and not a default colour either.
    for (const one of pkg.boards.flatMap((b) => b.buttons)) {
      expect(one.background_color).toBeUndefined();
      expect(one.border_color).toBeUndefined();
    }

    // And still a package the format's own checks accept.
    expect(checkPackage(pkg)).toEqual([]);
  });
