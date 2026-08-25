import { expect, test, type Locator, type Page } from "@playwright/test";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { hits, key, keySheet, openBoard, put, search } from "./diy.js";
import { openCollectionSettings, openPanel, openSettings, openVoices } from "./sheets.js";

/* Two languages, and the whole point of these is that they are two.
 *
 * A menu that flips the page is the easy half and passed with the whole of the
 * choice living in a variable. What these check is that the choice is still
 * there after a reload - it lasted exactly as long as the tab did once - that
 * it beats what the browser asks for, which is the thing that made that bug
 * hard to see, and that the page's language and the device's no longer move
 * each other.
 *
 * They were one control: `setLanguage(code)` and `state.layout.language = code`
 * on the same keystroke. So a carer whose page is German could not build an
 * English talker without turning their own page English, and opening a
 * Sammlung re-languaged the page around them. Half of what follows is about
 * that not happening any more, which is why the pair of tests at the bottom
 * assert that something does NOT change.
 *
 * So the locale is pinned rather than left to the runner, and every test
 * switches *away* from what it asks for. theme.spec.ts holds the same shape
 * for the scheme; the two are the page's only preferences that outlive a tab.
 */

const table = TEXTS as Record<string, Record<string, string>>;

/** The browser asks for this; the tests then choose the other one. Pinned so
 *  the switch is a real change on a German laptop and on CI alike. */
const ASKED = "de";
const CHOSEN = LANGUAGES.find((code) => code !== ASKED)!;

test.use({ locale: `${ASKED}-DE` });

/** What each language calls itself. Both menus name them this way on purpose -
 *  see voices.ts - so these are the one pair of literals that belong here. */
const OWN_NAME: Record<string, string> = { de: "Deutsch", en: "English" };

/** The menu item for a language. menuitemradio rather than button - the items
 *  are a set of alternatives with one in force, which is what dom.ts builds. */
const option = (page: Page, code: string) =>
  page.getByRole("menuitemradio", { name: OWN_NAME[code], exact: true });

/** Opens Einstellungen and picks the language of this page. */
async function choose(page: Page, code: string): Promise<void> {
  await openSettings(page);
  await openPanel(page, "#languagePanel");
  await page.click("#langPick");
  await option(page, code).click();
}

/** The same for the other one: the language the device's menu speaks, which
 *  belongs to the Sammlung and so is behind that Sammlung's ⋯ rather than in
 *  Einstellungen at all. That the two are on two sheets is most of the point -
 *  one is a fact about this browser, the other travels with an export. */
async function chooseForCollection(page: Page, code: string): Promise<void> {
  await openCollectionSettings(page);
  await openPanel(page, "#collectionLanguagePanel");
  await page.click("#collectionLangPick");
  await option(page, code).click();
}

/** A label the page can be recognised by, in the language given. Read out of
 *  the same table the page reads: a literal here would only say again, in a
 *  second place, what the page already believes. */
const says = (code: string, key: string) => table[code][key];

/** The language in the layout that is open, read out of the store rather than
 *  off the screen - it is a property of the Sammlung, and the only place it
 *  shows is the file and what is built from it. */
const inTheLayout = (page: Page) =>
  page.evaluate(() => new Promise<string | null>((resolve) => {
    const open = indexedDB.open("vorlaut");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      // Whichever Sammlung is open: there is a list of them now, each one's
      // layout is a record of its own in `layouts`, and which one is open is a
      // mark beside them.
      const tx = open.result.transaction(["marks", "layouts"], "readonly");
      const current = tx.objectStore("marks").get("current");
      current.onerror = () => resolve(null);
      current.onsuccess = () => {
        const got = tx.objectStore("layouts").get(current.result as string);
        got.onerror = () => resolve(null);
        got.onsuccess = () => {
          try {
            resolve(JSON.parse((got.result as { text: string }).text).language ?? null);
          } catch {
            resolve(null);
          }
        };
      };
    };
  }));

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  // The board is what says the layout has been read; before that the page is
  // still wearing the labels it painted from the browser's own preference.
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await expect(page.locator("html")).toHaveAttribute("lang", ASKED);
});

test("a chosen language is in force, and the menu says which", async ({ page }) => {
  await choose(page, CHOSEN);

  await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);
  await expect(page.locator("#langPick")).toHaveText(OWN_NAME[CHOSEN]);
  await expect(page.locator("#settingsHeading"))
    .toHaveText(says(CHOSEN, "ui.settings"));
});

test("the choice survives a reload, over what the browser asks for",
  async ({ page }) => {
    await choose(page, CHOSEN);
    await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);

    await page.reload();
    await expect(page.locator("#device .cell")).toHaveCount(6);

    // The whole bug: this was the browser's answer again, every time.
    await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);
    await expect(page.locator("#releaseBtn")).toHaveText(says(CHOSEN, "ui.release"));
    // And the sheet's own controls, which are painted from LANG rather than
    // carried by the markup and so are not covered by applyTexts().
    await openSettings(page);
    await expect(page.locator("#langPick")).toHaveText(OWN_NAME[CHOSEN]);
    await expect(page.locator("#languageState")).toHaveText(OWN_NAME[CHOSEN]);
  });

test("this browser is what carries it, not the Sammlung", async ({ page }) => {
  const before = await inTheLayout(page);
  await choose(page, CHOSEN);
  await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);

  // Beside the scheme, in the store that can be read before the first paint,
  // because this is a fact about this browser and this reader. It used to be
  // written into the layout - which is how it also became the device's answer,
  // and the reason a page could not be one language while a talker was
  // another.
  expect(await page.evaluate(() => localStorage.getItem("vorlaut.language")))
    .toBe(CHOSEN);
  // And the Sammlung is exactly where it was - checked after an edit that
  // writes, not straight after the switch. Straight after the switch this
  // passes even with the old line put back, because the switch no longer
  // saves: `state.layout.language = code` would sit in memory until the next
  // write carried it out, which is the same bug arriving one keystroke later.
  await page.click("#voiceClose");
  await put(page, 0, "Hallo");
  await expect.poll(() => inTheLayout(page)).toBe(before);
});

/* The other half of the split. These two are the bug, from each side. */

test("the Sammlung's language is written to the layout, and moves nothing here",
  async ({ page }) => {
    await chooseForCollection(page, CHOSEN);

    // Where it has to be for the device to get it: beside the voice, in the
    // layout. A board exported from here and flashed onto a talker carries the
    // menu language with it - that is why this one is not in localStorage the
    // way the page's language and the scheme are, and why the control that
    // sets it is on the Sammlung's sheet rather than in Einstellungen.
    await expect.poll(() => inTheLayout(page)).toBe(CHOSEN);
    await expect(page.locator("#collectionLangPick")).toHaveText(OWN_NAME[CHOSEN]);
    await expect(page.locator("#collectionLanguageState")).toHaveText(OWN_NAME[CHOSEN]);

    // And the page is still the reader's. This is the carer with a German
    // editor building an English talker, which was not possible at all.
    await expect(page.locator("html")).toHaveAttribute("lang", ASKED);
    await expect(page.locator("#collectionSheetHeading"))
      .toHaveText(says(ASKED, "ui.collection_settings"));
    expect(await page.evaluate(() => localStorage.getItem("vorlaut.language")))
      .toBe(null);
  });

/* The third thing hanging off the split, and the one that would fail silently.
 *
 * The voice a Sammlung starts on is picked by a language, and there are two of
 * them in the sheet now. Reading the wrong one would make a German carer's
 * English board speak German - audible only after a build, and by then every
 * recording carries it. So this asserts which of the two moves it, from both
 * sides: the Sammlung's does, and the page's does not.
 *
 * The voice's own row names the language it speaks, which is what is read
 * here. Not the voice's id and not its name: which voice a language starts on
 * belongs to stimmquelle's catalogue, and a second English voice arriving
 * ahead of Kristin must not make this test wrong.
 */
test("the Sammlung's language picks its voice, and the page's does not",
  async ({ page }) => {
    /** What the marked row says it speaks, in the words the page is wearing. */
    const speaking = async () => {
      await openVoices(page);
      const facts = page.locator('#voiceList .voice[aria-checked="true"] .voice__facts');
      await expect(facts).toHaveCount(1);
      return (await facts.textContent())!;
    };

    // Both languages named in the language the page is currently in, so the
    // assertions below compare words rather than codes.
    const named = (code: string, inLanguage: string) =>
      new Intl.DisplayNames([inLanguage], { type: "language" }).of(code)!;
    const own = await page.evaluate(
      ([codes, reading]) => codes.map(
        (code) => new Intl.DisplayNames([reading], { type: "language" }).of(code)!),
      [[ASKED, CHOSEN], ASKED] as [string[], string]);
    const [asked, chosen] = own;
    expect(asked).not.toBe(chosen);       // or nothing below can tell them apart

    // Nobody has chosen a voice, so the Sammlung's language is the whole of
    // the answer. It starts on the page-wide default, which is neither
    // language's fault - what matters is that moving it moves the voice.
    await chooseForCollection(page, CHOSEN);
    expect(await speaking()).toContain(chosen);

    await chooseForCollection(page, ASKED);
    expect(await speaking()).toContain(asked);

    // And the other control does not touch it. This is the carer working in a
    // German editor on a talker that speaks English: the page's language is
    // about the labels around them and says nothing about what the child's
    // device should say.
    await chooseForCollection(page, CHOSEN);
    await choose(page, CHOSEN);
    // Read back in the page's new language, so the word for it changes too.
    const stillChosen = named(CHOSEN, CHOSEN);
    expect(await speaking()).toContain(stillChosen);
    await page.click("#collectionSheetClose");
  });

test("a voice somebody chose does not move when the Sammlung's language does",
  async ({ page }) => {
    // Only a guess may be revisited. A voice ticked on purpose is somebody's
    // arrangement - a German voice on an English board is a thing people do -
    // and re-languaging the Sammlung must not quietly undo it.
    await openVoices(page);
    await expect(page.locator("#voiceList .voiceRow").first()).toBeVisible();
    const rows = page.locator("#voiceList .voiceRow");
    const picked = (await rows.last().locator(".voice__name").textContent())!;
    await rows.last().locator("button.voice").click();
    await expect(page.locator('#voiceList .voice[aria-checked="true"] .voice__name'))
      .toHaveText(picked);

    // The language is a panel away rather than a sheet away: both of these are
    // this Sammlung's, which is what put them on one sheet.
    await openPanel(page, "#collectionLanguagePanel");
    await page.click("#collectionLangPick");
    await option(page, CHOSEN).click();
    await expect.poll(() => inTheLayout(page)).toBe(CHOSEN);

    await openVoices(page);
    await expect(page.locator('#voiceList .voice[aria-checked="true"] .voice__name'))
      .toHaveText(picked);
    // And it is a choice rather than a guess, so it wears no note saying
    // otherwise.
    await expect(page.locator('#voiceList .voice[aria-checked="true"] .voice__facts'))
      .not.toContainText(table[ASKED]["ui.voice_auto_note"]!);
  });

test("opening a Sammlung does not re-language the editor", async ({ page }) => {
  // A Sammlung whose device speaks the other language, saved and let go of.
  await chooseForCollection(page, CHOSEN);
  await expect.poll(() => inTheLayout(page)).toBe(CHOSEN);
  await page.click("#collectionSheetClose");

  // Read back the way somebody comes back to it: a reload is load(), which is
  // where the language used to be adopted. Nothing else on this page has
  // changed, so the editor must still be in the language the browser asked
  // for - it used to arrive in the board's, which is the half of the bug
  // nobody chose and could not undo without changing the board.
  await page.reload();
  await expect(page.locator("#device .cell")).toHaveCount(6);
  await expect(page.locator("html")).toHaveAttribute("lang", ASKED);
  await expect(page.locator("#releaseBtn")).toHaveText(says(ASKED, "ui.release"));

  // The Sammlung kept its own answer through all of that.
  await openCollectionSettings(page);
  await openPanel(page, "#collectionLanguagePanel");
  await expect(page.locator("#collectionLangPick")).toHaveText(OWN_NAME[CHOSEN]);
});

/* The Daten panel, which is where a captured LANG showed itself.
 *
 * Its sentence is built by Intl.RelativeTimeFormat, and the formatter used to
 * be made once at import out of whatever LANG said then. boot.ts asks that
 * nothing capture that binding into a local, and this is what happens when
 * something does: the page goes German and the line under the folder goes on
 * saying "3 minutes ago". The panel is also redrawn only when the backup's
 * status moves, so a switch on a quiet page left it in the old language even
 * once the formatter followed - both halves are needed and this covers both. */
test("the folder's own line follows a switch, formatter and all", async ({ page }) => {
  await openSettings(page);
  await openPanel(page, "#dataPanel");
  const line = page.locator("#folderState");
  await expect(line).toBeVisible();
  const before = (await line.textContent())?.trim() ?? "";
  // Nothing chosen yet, so this is the "off" sentence - in the language the
  // browser asked for, which is the baseline the switch has to move.
  expect(before).toContain(says(ASKED, "ui.folder_off"));

  await openPanel(page, "#languagePanel");
  await page.click("#langPick");
  await option(page, CHOSEN).click();

  await expect(line).toContainText(says(CHOSEN, "ui.folder_off"));
  await expect(page.locator("#folderActions button").first())
    .toHaveText(says(CHOSEN, "ui.folder_choose"));
});

/* The half of a language switch that was not switching.
 *
 * Everything above this point is labels, and labels were the whole of it: the
 * page went English and the symbols stayed German, because ARASAAC keeps its
 * keywords per language, the language is part of the request path, and
 * bildquelle had that path hardcoded to /de. The German pipeline ran on English
 * input for the same reason.
 *
 * It failed quietly, which is why it survived so long. ARASAAC's German
 * endpoint does not reject an English word - it answers one, out of its tags
 * and synsets - so "water" came back as a water-transport sign. Nobody saw an
 * error. They saw a board with the wrong picture on it, which is worse than an
 * empty square, because an empty square is something a carer fixes.
 *
 * So these assert on the requests rather than only on what is drawn: the
 * drawing was never the part that lied.
 */

/** One word that exists in each language, for asking each collection for. */
const WORD: Record<string, string> = { de: "trinken", en: "drink" };

/** ARASAAC, holding exactly WORD in each language, and writing down what it
 *  was asked for. The language is the fourth path segment:
 *  /v1/pictograms/en/search/drink */
async function arasaacPerLanguage(page: Page, asked: string[]): Promise<void> {
  await page.route("**/api.arasaac.org/**", (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    const lang = parts[3]!;
    const term = decodeURIComponent(parts[5]!);
    asked.push(`${lang}/${term}`);
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(WORD[lang] === term
        ? [{ _id: 4242, keywords: [{ keyword: term }] }]
        : []),
    });
  });
  await page.route("**/static.arasaac.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }));
}

/** A key's sheet, open, with the picture column that carries the search. */
async function openKeyPicker(page: Page): Promise<Locator> {
  await openBoard(page);
  await key(page, 0).click();
  const box = keySheet(page);
  await expect(box.locator(".pick")).toBeVisible();
  return box;
}

test("the symbols are searched in the language the page is set to", async ({ page }) => {
  const asked: string[] = [];
  await arasaacPerLanguage(page, asked);

  const box = await openKeyPicker(page);
  await search(box, WORD[ASKED]!);

  await expect(hits(box).first()).toBeVisible();
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((one) => one.startsWith(`${ASKED}/`))).toBe(true);
});

test("switching the page switches which collection is asked", async ({ page }) => {
  await choose(page, CHOSEN);

  const asked: string[] = [];
  await arasaacPerLanguage(page, asked);

  // openKeyPicker reloads, so this also says the choice outlived the tab.
  const box = await openKeyPicker(page);
  await expect(page.locator("html")).toHaveAttribute("lang", CHOSEN);
  await search(box, WORD[CHOSEN]!);

  await expect(hits(box).first()).toBeVisible();
  expect(asked.some((one) => one.startsWith(`${CHOSEN}/`))).toBe(true);
  // The one that matters: not a single request went to the other language.
  expect(asked.filter((one) => one.startsWith(`${ASKED}/`))).toEqual([]);
});

test("an inflected word is looked up under its lemma, in either language", async ({ page }) => {
  /* The pipeline follows the page too, and it has to: asking the English
   * endpoint with a German lemmatiser in front of it would fix the wrong half.
   * "drinks" is not a word ARASAAC holds and "drink" is, and only a pipeline
   * that knows English plurals gets from one to the other. */
  await choose(page, CHOSEN);

  const asked: string[] = [];
  await arasaacPerLanguage(page, asked);

  const box = await openKeyPicker(page);
  await search(box, `${WORD[CHOSEN]}s`);

  await expect(hits(box).first()).toBeVisible();
  expect(asked).toContain(`${CHOSEN}/${WORD[CHOSEN]}s`);
  expect(asked).toContain(`${CHOSEN}/${WORD[CHOSEN]}`);
});
