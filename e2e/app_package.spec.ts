import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { checkPackage } from "../src/data/app_package.js";
import { readPackage, unzip } from "./obz.js";
import { KEY_CELL, cells, key, keySheet, nameSet, press, put } from "./diy.js";
import { openPanel, openSettings, openVoices } from "./sheets.js";

/* The app package, made by the real page and read back off disk.
 *
 * tests/unit/app_package.test.ts checks the mapping and the refusals over
 * data. This is the other half: a browser, a canvas, the platform's own Opus
 * encoder and a zip that a file manager could open. Everything in here that
 * matters is a thing the unit tests structurally cannot see - a PNG that came
 * out of a canvas, an Ogg stream that came out of WebCodecs, and the whole of
 * it going through the same checker the conformance fixtures do.
 *
 * Microsoft is played by two routes, for the reason happy.spec.ts states about
 * not speaking: a real piper synthesis fetches tens of megabytes of onnx from
 * a CDN. What is real here is everything after the bytes arrive - the
 * levelling, the encoder, the container, the archive.
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

/** A second of 16 kHz mono PCM, which is the shape Azure is asked for.
 *
 * A tone rather than silence: the levelling chain measures loudness and a
 * silent clip is the one input where "it came out quiet" says nothing. */
function wav(seconds = 0.8, hz = 220): Buffer {
  const rate = 16000;
  const frames = Math.round(rate * seconds);
  const out = Buffer.alloc(44 + frames * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + frames * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);          // PCM
  out.writeUInt16LE(1, 22);          // mono
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
  // A different tone per sentence, taken from the SSML Azure was sent. With
  // one tone for everything the two sentences come back byte-identical and the
  // content-addressed naming quite correctly writes one file - which is right
  // behaviour and a test that proves nothing about two.
  await page.route(SYNTHESIS, (route) => {
    const said = route.request().postData() ?? "";
    route.fulfill({ contentType: "audio/wav", body: wav(0.8, 200 + said.length) });
  });
}

/** Everything up to having a Sammlung worth exporting: two sentences, a
 *  picture on one key, and a voice that can be spoken without a CDN. */
async function fill(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#device .cell")).toHaveCount(6);

  await nameSet(page, "Morgens");
  await put(page, 0, "Ich habe Hunger");
  await put(page, 1, "Ich habe Durst");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // A picture on the first key, uploaded rather than searched for: ARASAAC is
  // a network away and this is not the test for it. It goes in through the
  // key's own sheet, whose left column carries the picture, the search and the
  // upload together.
  await key(page, 0).click();
  const box = keySheet(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    box.locator(".pick button", { hasText: label("ui.symbol_own") }).click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", "symbol.png"));
  // The status line says the picture was taken rather than that the board was
  // saved, so the picture is what says the pick landed. The export saves
  // before it packages anything, which is what makes that enough.
  await expect(box.locator(".pick__preview img")).toBeVisible();
  await press(box, "ui.done");
  await expect(cells(page).nth(KEY_CELL[0]!).locator(".cell__pic")).toBeVisible();

  // A second set, so the package has two boards and a ring between them. One
  // board would leave load_board pointing at itself, which is legal and proves
  // nothing about navigation.
  await page.locator("#tabs .tab.add").click();
  await expect(page.locator("#tabs .tab")).toHaveCount(3);   // two sets and the +
  await nameSet(page, "Spielen");
  await put(page, 0, "Noch einmal");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // The Azure key, and Katja chosen with it. The stored voice is what the
  // export synthesises with and what the manifest names as its hint.
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
  // Out of the sheet: the ⋯ this test is heading for is behind it, and a modal
  // <dialog> makes everything under it inert rather than merely covered.
  await page.locator("#collectionSheetClose").click();
  await expect(page.locator("#collectionSheet")).toBeHidden();
}

/* --- the test ------------------------------------------------------------ */

test("a Sammlung leaves as a package, and it passes the spec's own checks",
  async ({ page }) => {
    await standIn(page);
    await fill(page);

    await page.locator("#collectionMenu").click();
    await page.locator(".menu button", { hasText: label("ui.collection_export_app") }).click();
    // The export is behind a sheet now: it names the Sammlung, counts the
    // sentences as it speaks them and offers a way to stop, because a full
    // tablet Sammlung is hundreds of syntheses and a status line that says one
    // thing at the start covers a wait of minutes with silence.
    const asked = sheet(page, "ui.package_title");
    await expect(asked).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      asked.locator("button", { hasText: label("ui.package_go") }).click(),
    ]);
    // Synthesis, encoding and zipping happen between the click and the file.
    const path = await download.path();
    expect(path).toBeTruthy();
    // .zip, not .obz. Chrome on Android goes by the media type for an
    // unregistered extension, so a blob declared application/zip and named
    // .obz is one the download manager refuses — see exchange/SPEC.md 2.
    expect(download.suggestedFilename()).toMatch(/-app\.zip$/);

    const bytes = new Uint8Array(readFileSync(path!));
    // A way out for the check no test here can make: dump the package and put
    // it through ffmpeg, or through the Android viewer. docs/exchange.md has
    // the command.
    if (process.env.DUMP_TO) writeFileSync(process.env.DUMP_TO, bytes);
    const { pkg, members } = readPackage(bytes);

    // The whole point of the round trip: the package a browser just wrote
    // passes the same checks the conformance fixtures are held to.
    expect(checkPackage(pkg)).toEqual([]);

    // §3: what a package must say about itself.
    expect(pkg.manifest.format).toBe("open-board-0.1");
    expect(pkg.manifest.ext_lautstark_spec_version).toBe("1.2.0");
    expect(pkg.manifest.ext_lautstark_package_id)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pkg.manifest.ext_lautstark_modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(pkg.manifest.ext_lautstark_redistributable).toBe(false);
    // The picture was uploaded rather than picked, so the package claims no
    // symbol collection at all.
    expect(pkg.manifest.ext_lautstark_symbol_source).toBe("none");
    // §4.1: the hint, without the "azure:" that says where it is synthesised.
    expect(pkg.manifest.ext_lautstark_tts_voice).toBe("de-DE-KatjaNeural");

    // Two boards, and a ring: each set key names the next, the last comes back
    // round to the first. That is the device's behaviour and what a viewer has
    // to be able to follow.
    expect(pkg.boards.map((one) => one.name)).toEqual(["Morgens", "Spielen"]);
    // §7.1's locale, and it comes off the chosen voice rather than off the
    // browser this test happens to run in: the page here is English and the
    // sentences are German, which is exactly the case that used to ship a
    // package the tablet would read aloud in the wrong language.
    expect(pkg.boards.map((one) => one.locale)).toEqual(["de-DE", "de-DE"]);
    const board = pkg.boards[0]!;
    expect(board.buttons.find((one) => one.id === "set-1-set")!.load_board)
      .toEqual({ id: "set-2", name: "Spielen", path: "boards/set-2.obf" });
    expect(pkg.boards[1]!.buttons.find((one) => one.id === "set-2-set")!.load_board!.id)
      .toBe("set-1");
    expect(board.buttons.find((one) => one.id === "set-1-key-1")!.label)
      .toBe("Ich habe Hunger");

    // §5: a real PNG, baked, and never a reference.
    const png = [...pkg.files].find(([name]) => name.endsWith(".png"))![1];
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    // The fixture is 16x16 and stays 16x16: fitted to the cap, never enlarged.
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([16, 16]);
    expect(board.images[0]!.path).toMatch(/^images\/[0-9a-f]{16}\.png$/);

    // §6: two sentences, two clips, and each one a real Ogg Opus stream out of
    // the browser's own encoder rather than anything this repository asserts
    // into existence.
    const clips = [...pkg.files].filter(([name]) => name.endsWith(".opus"));
    expect(clips).toHaveLength(3);      // three sentences across the two sets
    // Both keys carry one, and §9.2's "promised and missing" case does not
    // arise: every sound_id on the board resolves to a file in the archive.
    for (const id of ["set-1-key-1", "set-1-key-2"]) {
      expect(board.buttons.find((one) => one.id === id)!.sound_id).toBeTruthy();
    }
    for (const [, clip] of clips) {
      const head = new TextDecoder().decode(clip.slice(0, 64));
      expect(head.startsWith("OggS")).toBe(true);
      expect(head).toContain("OpusHead");
      // Mono, and 24 kHz in: the two fields §6 constrains, read out of the
      // OpusHead the encoder wrote.
      // Page 0 is a 27 byte header, one segment byte, then the OpusHead.
      const opusHeadAt = 28;
      expect(clip[opusHeadAt + 9]).toBe(1);                                  // channels
      expect(new DataView(clip.buffer, clip.byteOffset).getUint32(opusHeadAt + 12, true))
        .toBe(24000);                                                        // input rate
      // The stream ends, and says so - the flag a truncated file lacks.
      expect(clip.length).toBeGreaterThan(200);
    }
    for (const board of pkg.boards) {
      for (const sound of board.sounds) expect(sound.duration).toBeLessThan(30);
    }

    // §2: the archive says its names are UTF-8, and the two media kinds are
    // stored rather than deflated a second time.
    for (const member of members.values()) expect(member.flags & 0x0800).toBe(0x0800);
    expect([...members.keys()][0]).toBe("manifest.json");
  });

test("the two exports are two different files, not one behind a flag",
  async ({ page }) => {
    await standIn(page);
    await fill(page);

    // exchange/SPEC.md §5.2: the talker's export writes symbols as references
    // and never as pixels, and that guarantee is structural rather than an
    // argument. Both entries are in the same menu, and what comes out of them
    // is different in exactly that way.
    await page.locator("#collectionMenu").click();
    const [plain] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".menu button", { hasText: label("ui.collection_export") }).click(),
    ]);
    const talker = unzip(new Uint8Array(readFileSync((await plain.path())!)));
    expect([...talker.keys()].some((name) => name.startsWith("images/"))).toBe(false);
    const board = JSON.parse(new TextDecoder().decode(talker.get("boards/set-1.obf")!.data));
    // A reference into a symbol set, which is what the viewer must never have
    // to resolve and what the talker's export must never bake.
    expect(board.images[0].symbol).toBeTruthy();
    expect(board.images[0].path).toBeUndefined();

    await page.locator("#collectionMenu").click();
    await page.locator(".menu button", { hasText: label("ui.collection_export_app") }).click();
    const asked = sheet(page, "ui.package_title");
    const [app] = await Promise.all([
      page.waitForEvent("download"),
      asked.locator("button", { hasText: label("ui.package_go") }).click(),
    ]);
    const packaged = unzip(new Uint8Array(readFileSync((await app.path())!)));
    expect([...packaged.keys()].filter((name) => name.startsWith("images/"))).toHaveLength(1);
    const page1 = JSON.parse(new TextDecoder().decode(packaged.get("boards/set-1.obf")!.data));
    expect(page1.images[0].path).toMatch(/^images\//);
    expect(page1.images[0].symbol).toBeUndefined();
  });

/* --- the refusal, and what it costs ------------------------------------- */

/** A Sammlung drawn in two collections at once, written straight into the
 *  store.
 *
 *  Through IndexedDB because the interface will not build one any more: the
 *  picture column follows the Sammlung's own source now, so a METACOM board
 *  is never offered an ARASAAC picture to take. That is the fix, and it is
 *  also why the state below has to be seeded - it is the Sammlung somebody
 *  already has, made before the picker followed anything or brought in from
 *  another machine, and the export is what it meets.
 *
 *  build.spec.ts seeds the same way and for the same reason. No version on the
 *  open: the page has the database open already and knows which one it is at.
 */
async function seedMixed(page: Page): Promise<void> {
  await page.evaluate(`(async () => {
    const db = await new Promise((keep, drop) => {
      const request = indexedDB.open("vorlaut");
      request.onsuccess = () => keep(request.result);
      request.onerror = () => drop(request.error);
    });
    const get = (store, key) => new Promise((keep, drop) => {
      const held = db.transaction([store], "readonly").objectStore(store).get(key);
      held.onsuccess = () => keep(held.result);
      held.onerror = () => drop(held.error);
    });
    const id = await get("marks", "current");
    const board = {
      sleep_timeout_seconds: 600,
      language: "de",
      voice: "azure:de-DE-KatjaNeural",
      sets: [{
        name: "Morgens", symbol: "", color: "#3B5BDB",
        slots: [
          { text: "Ich habe Hunger", symbol: "arasaac-2462.png" },
          { text: "Ich habe Durst", symbol: "arasaac-99.png" },
          { text: "Noch einmal", symbol: "metacom:PNG_ohne_Rahmen/ja" },
          { text: "", symbol: "" },
        ],
      }],
    };
    await new Promise((keep, drop) => {
      const tx = db.transaction(["layouts"], "readwrite");
      tx.objectStore("layouts").put({ id, text: JSON.stringify(board), version: "seeded" });
      tx.oncomplete = keep;
      tx.onerror = () => drop(tx.error);
    });
  })()`);
  await page.reload();
  await expect(page.locator("#device .cell")).toHaveCount(6);
}

test("a mixed Sammlung is refused before a syllable of it is synthesised",
  async ({ page }) => {
    /* §5.1 is one symbol collection per package, and buildAppPackage() is
     * where that is enforced. It has to be - the manifest names the
     * collection the package drew on and there is no honest answer for two -
     * but it is a pure function and it runs last, so the refusal used to
     * arrive after every distinct sentence in the Sammlung had been spoken.
     * On a full tablet Sammlung that is hundreds of inferences or round trips
     * to Azure, minutes of them, and then nothing to show for it.
     *
     * So the same function is called before the loop as well. What this test
     * watches is the cost: not one request to Azure may leave the page. */
    let spoken = 0;
    await standIn(page);
    await page.route(SYNTHESIS, (route) => {
      spoken++;
      route.fulfill({ contentType: "audio/wav", body: wav() });
    });
    await fill(page);
    await seedMixed(page);

    await page.locator("#collectionMenu").click();
    await page.locator(".menu button", { hasText: label("ui.collection_export_app") }).click();
    const asked = sheet(page, "ui.package_title");
    await asked.locator("button", { hasText: label("ui.package_go") }).click();

    // The sheet closes and the status line carries the refusal, which is the
    // ordinary shape of a failed export here.
    await expect(page.locator("#status")).toContainText(/two symbol collections/);
    // And it names the odd key out rather than leaving somebody to compare
    // references by eye - the one thing no editor shows.
    await expect(page.locator("#status")).toContainText('"Noch einmal" in "Morgens"');
    expect(spoken).toBe(0);
  });
