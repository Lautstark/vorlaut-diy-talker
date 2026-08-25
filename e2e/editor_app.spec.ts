import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { checkPackage } from "../src/data/app_package.js";
import { readPackage } from "./obz.js";
import { openPanel, openSettings, openVoices } from "./sheets.js";

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
/* The other network this file reaches, and it reaches it without being asked:
 * a sheet carries its own symbol search and seeds it with the word already on
 * the button, so opening one runs a search. A word the collection does not
 * hold comes back 404, which the console guard below reads as a failure - and
 * whether it arrives before the test ends is a matter of how long the sheet
 * stays open. Answered here rather than left to the network, for the reason
 * the two above are: what these tests are about is everything after an answer
 * arrives. */
const SYMBOL_SEARCH = /api\.arasaac\.org\//;

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
  append: "word", speak: "shout", goto: "goto", home: "goto",
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
  gotoPage?: string; upload?: string;
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
  // "Neue Seite ..." mints the page on Fertig rather than on the press, so it
  // is named from the label as it finally reads.
  if (fields.gotoPage) await pick(page, "#appGoto", fields.gotoPage);
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
  await expect(page.locator("#appPages .tab")).toHaveCount(2);
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // Onto the new page, by the strip. Pressing the navigation button itself
  // opens its sheet rather than following it, or it would be the one button on
  // the board nobody could ever edit - so the strip is the way across, and it
  // holds every page including the ones nothing leads to yet.
  await page.locator("#appPages .tab", { hasText: "Essen" }).click();
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

test("deleting a page keeps the buttons that led to it", async ({ page }) => {
  await standIn(page);
  await build(page);

  // Standing on the Essen page, which one button on the start page leads to.
  // The way in is the ... on the current tab: a page has no cell on a tablet,
  // so the tab is the thing it can be pressed on.
  await page.locator("#appPages .tab[aria-current=true] .tab__more").click();
  const card = sheet(page, "ui.app_page_title");
  await expect(card).toBeVisible();
  // And it is the narrow sheet. Measured, because the two classes it carries
  // both set a width and nothing on screen says which one won: `.sheet--page`
  // once lost 520px to `dialog.sheet--button`'s 720px on specificity alone,
  // and the card drew as a single column of fields adrift in the wide sheet.
  await expect(card).toHaveCSS("width", "520px");
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
  const essen = page.locator("#appGrid .cell", { hasText: "Essen" });
  await expect(essen).toHaveCount(1);
  await expect(essen).toHaveAttribute("style", /--cell-color:\s*#d8af97/);
  // The → badge is what said it led somewhere, and it does not any more.
  await expect(essen.locator(".cell__act")).toHaveCount(0);
});

/** The card behind the ⋯ beside the Sammlung's name: the grid size and the
 *  colour of a word class, which are the two things true of every page. */
async function openGrid(page: Page) {
  await page.locator("#collectionMenu").click();
  await page.locator('[role="menuitem"]', { hasText: label("ui.app_grid") }).click();
  const card = sheet(page, "ui.app_grid");
  await expect(card).toBeVisible();
  return card;
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
   * re-index. So there is nothing to warn about, and the footer is the
   * ordinary apply rather than the destructive one. */
  let card = await openGrid(page);
  await size(card, 6, 11).click();
  await expect(card.locator(".notice")).toHaveCount(0);
  await card.locator("button", { hasText: label("ui.app_grid_apply") }).click();
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
  await card.locator("button", { hasText: label("ui.cancel") }).click();

  // Declined: nothing was written, so the board is the size it was and the
  // button that would have gone is still on it.
  await expect(cells(page)).toHaveCount(66);
  await expect(page.locator("#appGrid .cell", { hasText: "Ecke" })).toHaveCount(1);
  await expect(page.locator("#appGrid .cell", { hasText: "Start" })).toHaveCount(1);

  // Said, and only then done. The button outside goes; the ones inside stay
  // exactly where they were, because none of them was ever re-indexed.
  card = await openGrid(page);
  await size(card, 3, 5).click();
  await card.locator("button", { hasText: label("ui.app_grid_shrink_go") }).click();
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
  await page.locator("#appPages .tab").first().click();
  const ich = page.locator("#appGrid .cell")
    .filter({ has: page.locator(".cell__word", { hasText: /^ich$/ }) });

  // A fill is what a Sammlung wears when nobody has said otherwise, which is
  // also what every layout stored before the choice existed wears.
  await expect(ich).toHaveAttribute("style", /--cell-color:\s*#fdfd96/);

  // The border says the same thing and leaves the picture under it alone.
  let card = await openGrid(page);
  await card.locator(".does__opt")
    .filter({ has: page.locator("b", { hasText: label("ui.app_word_color_border") }) })
    .click();
  await card.locator("button", { hasText: label("ui.app_grid_apply") }).click();
  await page.locator("#appPages .tab").first().click();
  await expect(ich).toHaveAttribute("style", /--cell-edge:\s*#fdfd96/);
  await expect(ich).not.toHaveAttribute("style", /--cell-color/);

  // Off is not colourless - the page keeps its own - but no cell says what
  // kind of word is on it any more.
  card = await openGrid(page);
  await card.locator(".does__opt")
    .filter({ has: page.locator("b", { hasText: label("ui.app_word_color_off") }) })
    .click();
  await card.locator("button", { hasText: label("ui.app_grid_apply") }).click();
  await page.locator("#appPages .tab").first().click();
  await expect(ich).not.toHaveAttribute("style", /--cell-(color|edge)/);

  // And it belongs to the Sammlung, so it is still true after a reload - which
  // is the half a rendering test cannot see: that the choice was written.
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });
  await page.reload();
  await expect(ich).toBeVisible();
  await expect(ich).not.toHaveAttribute("style", /--cell-(color|edge)/);
});

test("a button moves to another cell, by keyboard and by drag", async ({ page }) => {
  await standIn(page);
  await build(page);

  // Back to the start page, where the words are.
  await page.locator("#appPages .tab").first().click();
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
    await page.locator("#appPages .tab").first().click();

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
  await page.locator("#appPages .tab").first().click();

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
    await page.locator("#appPages .tab").first().click();

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
    await page.locator("#appPages .tab").first().click();

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
    await page.locator("#appPages .tab").first().click();
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
    await page.locator("#appPages .tab").first().click();

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
    await page.locator("#appPages .tab", { hasText: "Essen" }).click();
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
    await page.locator("#appPages .tab").first().click();
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
    await page.locator("#appPages .tab").first().click();

    /* It opens, and it opens saying `sayBar` - not re-read as "Wort", which is
     * the silent way for a board to change under somebody who only came to fix
     * a typo. A fourth entry that only such a button has. */
    await hit(page, 10).click();
    await showing(page, "#appDoes", "ui.app_act_say_bar");
    // And it is in the list too, as a fourth alternative rather than a command
    // among three radios - which is what would happen if `checked` were left
    // off the one entry that is not one of the three.
    await page.click("#appDoes");
    await expect(page.locator(".menu button")).toHaveCount(4);
    const inForce = page.locator('.menu button[aria-checked="true"]');
    await expect(inForce).toHaveCount(1);
    await expect(inForce).toHaveText(among("ui.app_act_say_bar"));
    await page.keyboard.press("Escape");

    // And Fertig on a sheet nobody changed leaves the act where it was. Only
    // choosing one of the three replaces it.
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
    await page.locator("#appPages .tab").first().click();

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
    await card().locator("button", { hasText: label("ui.done") }).click();
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
