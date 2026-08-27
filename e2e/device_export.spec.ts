import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
/* The labels are asserted out of the table the page reads them from, rather
 * than written out here in one language. */
import { TEXTS } from "../src/core/boot_data.js";
import { pickFromMenu } from "./sheets.js";
/* Out of the modules that decide them rather than written here: a rule this
 * test spelled out for itself would agree with nothing. */
import { isDeviceWav, wavFormat } from "../src/data/device_package.js";
import { SLOTS_PER_SET } from "../loader/src/layout_format.js";
import { unzip } from "./obz.js";

/* The language this page comes up in, pinned rather than left to the runner.
 *
 * Every label asserted below is one the page draws, and the page's language is
 * this browser's - so on a German laptop and on CI it has to be the same one
 * or half these assertions read a page nobody is looking at. It used to be
 * taken from BOARD.language instead, and that was right only while opening a
 * board re-languaged the editor: the Sammlung's language and the page's are
 * separate settings now, and BOARD.language below is the device's alone.
 *
 * German, because BOARD is German and the sentences in the log read better
 * beside a board in the same language - not because anything requires it. */
const PAGE_LANG = "de";
test.use({ locale: `${PAGE_LANG}-DE` });

/* The talker's own export, written by the real page and read back off disk.
 *
 * This file used to be about a build: press Release, then ask IndexedDB what
 * it left. There is no build here now - adr/0011 took it out of the editor
 * along with the cable - and what took its place is this export, which is the
 * only thing that reaches a talker at all. The half that then puts the file on
 * a device is loader.spec.ts.
 *
 * The claims are the same ones the build's file listing used to carry, made
 * about an archive instead of a store, and they are the ones that show up
 * nowhere in a log line: the same picture on three keys is one member, the
 * same sentence in two sets is synthesised once, a crossed-out key is a flag
 * rather than a second picture, and every recording is the shape the device
 * plays. tests/unit/device_roundtrip.test.ts holds the mapping over data;
 * what is only reachable from here is a browser, a real synthesis chain, and a
 * zip a file manager could open.
 *
 * Two things are deliberately not the real article.
 *
 * Piper is intercepted. The model is 63 MB from a mirror and the sentence
 * after it is seconds of inference, so a test that fetched one would be a
 * test of somebody else's uptime. The interception is at the network rather
 * than inside the package, and since local.ts drives piper itself - the
 * usePiperRuntime() handover - there are three doors where vits-web's one
 * bundle used to be:
 *
 *   - the phonemizer, the one piece Vite bundles, so the door is its chunk.
 *     The stand-in answers with the export shape Rollup gave the real one -
 *     `p`, a namespace whose default is the factory - which couples this
 *     file to a bundler internal on purpose: if a Vite upgrade renames it,
 *     the build here fails loudly rather than the test quietly measuring a
 *     stand-in that no longer stands in.
 *   - onnxruntime, still a pinned CDN URL, exactly as vits-web arrived.
 *   - the model and its config, from the Hugging Face mirror.
 *
 * Everything downstream of the three stays the real article - the id
 * remapping against the config's own table, the levelling, the fade, the
 * pad, the resample to 16 kHz, the naming, the storing and the pruning.
 * What none of it checks is the real phonemizer wasm booting in a page;
 * that is one press of a play button against the real vendor/ directory,
 * not something to put in front of every commit.
 *
 * The store is seeded through IndexedDB rather than through the interface.
 * Typing sentences is what page.spec.ts already does; symbols cannot be added
 * that way without ARASAAC, and an export with no pictures in it would not
 * exercise images/ at all.
 */

/** The database store.ts keeps, opened without importing it: the built bundle
 *  has no module URL to reach, and reading the raw records is what a check of
 *  "what did the build leave" should be doing anyway. */
const IDB = `
  /* No version: the page has already opened this database and knows which
     version it is at. Naming one here means guessing, and guessing low throws
     rather than opening - which is a seed that fails as a browser bug. */
  const open = () => new Promise((keep, drop) => {
    const request = indexedDB.open("vorlaut");
    request.onsuccess = () => keep(request.result);
    request.onerror = () => drop(request.error);
  });
  const get = (db, store, key) => new Promise((keep, drop) => {
    const held = db.transaction([store], "readonly").objectStore(store).get(key);
    held.onsuccess = () => keep(held.result);
    held.onerror = () => drop(held.error);
  });
  /* The layout of whichever Sammlung is open. There is a list of them now, and
     each one's layout is a record of its own in "layouts", so a seed has to ask
     which one the page is editing rather than write to a fixed key. The page has
     loaded by the time this runs, so there is always one.

     No key argument on that put: "layouts" has a keyPath of "id", so the record
     carries its own key and passing a second one is a DataError rather than an
     override. */
  const seedLayout = async (db, text) => {
    const id = await get(db, "marks", "current");
    await put(db, "layouts", { id, text, version: "seeded" });
  };
  const put = (db, store, value, key) => new Promise((keep, drop) => {
    const tx = db.transaction([store], "readwrite");
    if (key === undefined) tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
    tx.oncomplete = keep;
    tx.onerror = () => drop(tx.error);
  });
  const all = (db, store) => new Promise((keep, drop) => {
    const tx = db.transaction([store], "readonly");
    const box = tx.objectStore(store);
    const keys = box.getAllKeys();
    const values = box.getAll();
    tx.oncomplete = () => keep(keys.result.map((name, i) => ({
      name, size: values.result[i] ? values.result[i].byteLength : 0 })));
    tx.onerror = () => drop(tx.error);
  });
`;

/* Chosen so that every count below has something to be wrong about: four
 * pictures used nine times between them, five distinct sentences across seven
 * slots with text, and - the part this board is really built for - both ways a
 * key can end up without a picture, which are two different things and were
 * one tile until 2026-08-27.
 *
 * A key that wanted a picture and has none draws the placeholder: "weg.png",
 * which no symbol answers to, and the third key of the second set, which has
 * the word "Bitte" and no symbol. They share one tile, because they are the
 * same sentence about two keys.
 *
 * A key holding neither a word nor a picture draws tiles.blank() instead -
 * the last key of the first set and the last three of the third. Nothing was
 * asked for there, so nothing is missing, and the grey cross those keys used
 * to get made an untouched board look like a broken one. */
const BOARD = {
  sleep_timeout_seconds: 600,
  language: "de",
  /* Kerstin, explicitly: she only speaks through the owned runtime, so a
   * build in her name is the test that the ownsInference claim travels from
   * the board all the way to the licence gate. A board with no voice would
   * default to Thorsten, who passes that gate even unclaimed. */
  voice: "piper:de_DE-kerstin-low",
  sets: [
    { name: "Erste", symbol: "red.png", color: "#3B5BDB",
      slots: [{ symbol: "red.png", text: "Hallo" },
              { symbol: "blue.png", text: "Danke" },
              { symbol: "green.png", text: "Hallo" },
              { symbol: "", text: "" }] },
    { name: "", symbol: "blue.png", color: "#159947",
      /* The first key here is red.png crossed out, and the first key of the
         set above is red.png plain. One reference, one member of the archive,
         one flag - which is form rule 2, and the one thing that goes wrong
         silently if the export ever bakes the cross instead. */
      slots: [{ symbol: "red.png", text: "Danke", negated: true },
              { symbol: "weg.png", text: "Tsch\u00fcss" },   // escaped: tests/test_language.py
              { symbol: "", text: "Bitte" },
              { symbol: "green.png", text: "" }] },
    { name: "Aus", symbol: "yellow.png", color: "#FF6B35",
      slots: [{ symbol: "yellow.png", text: "Niemals" },
              { symbol: "", text: "" }, { symbol: "", text: "" },
              { symbol: "", text: "" }] },
  ],
};

/** The phonemizer, in place of the 90 kB Emscripten chunk.
 *
 * callMain gets the text - it rides in the --input JSON - so this is where
 * every synthesis is recorded, which is how "one WAV per distinct sentence"
 * is checked from the other end. The ids it prints remap onto CONFIG's
 * phoneme_id_map without composing, so the real remapPhonemeIds runs and
 * changes nothing. */
const PHONEMIZER = `
const createPiperPhonemize = (options) => Promise.resolve({
  callMain(args) {
    const { text } = JSON.parse(args[args.indexOf("--input") + 1])[0];
    (globalThis.__spoken ??= []).push(text);
    options.print(JSON.stringify({ phonemes: ["a"], phoneme_ids: [1, 0, 5, 0, 2] }));
  },
});
export const p = { default: createPiperPhonemize };
export default createPiperPhonemize;
`;

/** onnxruntime, in place of the 143 kB from the CDN: a session whose answer
 * is half a second of a tone, at the amplitude the old vits-web stand-in
 * used. Real audio rather than silence, because the chain decodes and trims
 * it - silence would be trimmed away to nothing before the levelling ever
 * saw it. */
const ORT = `
export const env = { wasm: {} };
export class Tensor {
  constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
}
export const InferenceSession = {
  async create() {
    return { async run() {
      const rate = 22050, count = rate / 2;
      const data = new Float32Array(count);
      for (let i = 0; i < count; i++) data[i] = Math.sin(2 * Math.PI * 440 * i / rate) * 0.37;
      return { output: { data } };
    } };
  },
};
`;

/** The model's config, in place of the mirror's: the four ids PHONEMIZER
 * prints, and the rate the ORT stand-in answers at. The model itself is
 * fulfilled as a few bytes the ORT stand-in never reads - and, being shorter
 * than the catalogue says, it is evicted from the cache on every read and
 * re-fetched, which costs nothing when the fetch is a route. */
const CONFIG = JSON.stringify({
  audio: { sample_rate: 22050 },
  espeak: { voice: "de" },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
  phoneme_id_map: { "^": [1], "$": [2], "_": [0], "a": [5] },
});

/* The language the labels come back in, which is this page's rather than the
 * Sammlung's - the sheet is drawn into the page, and it is the page's own
 * labels these assertions are made of. Pinned at the head of this file; see
 * the note on PAGE_LANG there. */
const SPEAKS = (TEXTS as Record<string, Record<string, string>>)[PAGE_LANG];

/** Everything the page needs before the button is worth pressing. */
async function seed(page: import("@playwright/test").Page) {
  await page.route("**/piper_phonemize*.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: PHONEMIZER }));
  // The CDN and the mirror are cross-origin, so the answers need the header
  // the real servers send, or the page's fetch refuses them.
  const CORS = { "Access-Control-Allow-Origin": "*" };
  await page.route("**/ort.wasm.min.js", (route) =>
    route.fulfill({ contentType: "text/javascript", headers: CORS, body: ORT }));
  await page.route("**/*.onnx.json", (route) =>
    route.fulfill({ contentType: "application/json", headers: CORS, body: CONFIG }));
  await page.route("**/*.onnx", (route) =>
    route.fulfill({ contentType: "application/octet-stream", headers: CORS,
                    body: "stand-in" }));

  await page.goto("./");
  await expect(page.locator("#device .cell")).toHaveCount(6);

  await page.evaluate(`(async () => {
    ${IDB}
    const db = await open();
    const png = async (colour) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d");
      context.fillStyle = colour;
      context.fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      return await blob.arrayBuffer();
    };
    for (const [name, colour] of [["red.png", "#cc2222"], ["blue.png", "#2222cc"],
                                  ["green.png", "#22cc22"], ["yellow.png", "#cccc22"]]) {
      await put(db, "symbols", await png(colour), name);
    }
    /* Any version string does: the page reads it, hands it straight back as
       the one it expects, and the first save replaces it with a real hash. */
    await seedLayout(db, ${JSON.stringify(JSON.stringify(BOARD, null, 2) + "\n")});
  })()`);

  /* Reloaded rather than carried on with: the Release button saves what is on
     screen first, so a board that never reached the editor would be written
     straight back over by the one that did. */
  await page.reload();
  await expect(page.locator("#device .cell")).toHaveCount(6);
}

/** The export sheet, by its accessible name.
 *
 * openDialog() appends it to the body and takes it away again on close, so its
 * presence is also the question "is the flow still running". By name rather
 * than by `dialog.sheet`: the settings and the three legal pages are sheets
 * too and are in the markup from the first paint, so that selector matches
 * three elements before this one exists. */
const sheetOf = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: SPEAKS["ui.device_export_title"], exact: true });

const footBtn = (page: import("@playwright/test").Page, key: string) =>
  sheetOf(page).getByRole("button", { name: SPEAKS[key], exact: true });

/**
 * Presses the export in the ⋯, confirms it, and hands back the file.
 *
 * The download is the only way out: the export answers with a Blob and the
 * page hands it to the browser, so what a test can get at is what a person
 * gets - a file on a disk. Everything asserted below is read out of those
 * bytes rather than out of anything the page kept.
 */
async function exportDevice(page: import("@playwright/test").Page) {
  await pickFromMenu(page, "ui.collection_export_device");
  await expect(sheetOf(page)).toBeVisible();

  const coming = page.waitForEvent("download");
  await footBtn(page, "ui.device_export_go").click();
  /* Generously: five sentences through the stand-in chain, then a zip. */
  const download = await coming;
  const path = await download.path();
  const bytes = readFileSync(path!);

  const spoken = await page.evaluate("(globalThis.__spoken ?? []).slice()") as string[];
  return { name: download.suggestedFilename(), bytes, spoken,
           members: unzip(bytes) };
}

const boardsIn = (members: Map<string, { data: Uint8Array }>) =>
  [...members.keys()].filter((one) => one.endsWith(".obf")).sort()
    .map((one) => JSON.parse(new TextDecoder().decode(members.get(one)!.data)));

const membersUnder = (members: Map<string, unknown>, prefix: string) =>
  [...members.keys()].filter((one) => one.startsWith(prefix));

test("the export carries one member per distinct picture and per distinct sentence",
     async ({ page }) => {
  await seed(page);
  const made = await exportDevice(page);

  expect(made.name).toMatch(/-device\.obz$/);

  /* Four pictures - red, blue, green, yellow - used nine times between them.
     "weg.png" resolves to nothing and travels as a reference with no member,
     which is the gap the export records rather than hides. */
  expect(membersUnder(made.members, "images/")).toHaveLength(4);

  /* Five distinct sentences across seven slots that have text: Hallo, Danke,
     Tschuess, Bitte, Niemals. Each synthesised exactly once, which is the
     claim that shows up nowhere else - a second synthesis of the same words
     would produce the same name and the same bytes, and the archive would look
     identical. Only the count of what the chain was actually asked for says
     it. */
  expect(membersUnder(made.members, "sounds/")).toHaveLength(5);
  expect(made.spoken).toHaveLength(5);
  expect(new Set(made.spoken).size).toBe(5);
});

test("every recording in it is the WAV the device plays", async ({ page }) => {
  await seed(page);
  const made = await exportDevice(page);

  /* Form rule 3, from the far end: 16 kHz, mono, 16-bit, under a name
     layout.bin can carry. The device does not check any of it - it finds the
     data chunk and plays whatever is in it at the rate I2S was started with -
     so a file at another rate is a word at the wrong pitch on a talker, and
     this side is where the rule has to be kept. */
  const sounds = membersUnder(made.members, "sounds/");
  expect(sounds.length).toBeGreaterThan(0);
  for (const path of sounds) {
    expect(path).toMatch(/^sounds\/a[0-9a-f]{32}\.wav$/);
    expect(isDeviceWav(wavFormat(made.members.get(path)!.data)), path).toBe(true);
  }
});

test("a crossed-out key is a flag beside one picture, not a second picture",
     async ({ page }) => {
  await seed(page);
  const made = await exportDevice(page);

  /* Form rule 2. The app package bakes the cross, so the same reference is two
     PNGs there; here it is one member and a flag, and the compiler on the
     other side draws two tiles out of it. Both halves are worth pinning:
     baking would add a member, and dropping the flag would put the same tile
     on both keys. */
  expect(membersUnder(made.members, "images/")).toHaveLength(4);
  const crossed = boardsIn(made.members)
    .flatMap((board) => board.buttons as { ext_vorlaut_negated?: boolean }[])
    .filter((one) => one.ext_vorlaut_negated === true);
  expect(crossed).toHaveLength(1);
});

test("it carries the language the device labels itself in, and every set",
     async ({ page }) => {
  await seed(page);
  const made = await exportDevice(page);

  const boards = boardsIn(made.members);
  /* Every set the Sammlung holds is a board, because a Sammlung is itself the
     selection - BOARD has three. */
  expect(boards).toHaveLength(3);
  /* Form rule 4: layout.language itself, not a locale derived from the voice.
     BOARD speaks a de_DE voice, and localeFor() would answer "de-DE", which is
     not in LANGUAGE_CODES at all and would land the device's own prompts in
     English. */
  for (const board of boards) expect(board.locale).toBe("de");
  /* And no board carries more keys than the device has room for - the fifth
     would be written and never arrive. */
  for (const board of boards) {
    const keys = (board.buttons as { load_board?: unknown }[])
      .filter((one) => !one.load_board);
    expect(keys.length).toBeLessThanOrEqual(SLOTS_PER_SET);
  }
});

test("the sheet says where the file goes next, and it is a page that exists",
     async ({ page }) => {
  await seed(page);
  await exportDevice(page);

  /* The hand-off, and it is the reason this sheet stays open where the app
     package's closes itself. Everything before this happens on this page and
     the last step does not: the file is on a disk and the talker is on the
     table, and the page that joins them is an address nobody has a reason to
     know. */
  const link = sheetOf(page).getByRole("link", {
    name: SPEAKS["ui.device_export_open"], exact: true,
  });
  await expect(link).toBeVisible();

  /* Under the base a project site is really served from, because that is the
     one thing about this link that can be wrong in a way no other test sees:
     it is built from import.meta.env.BASE_URL rather than written out, and a
     literal here would have been a fourth place a rename breaks in silence. */
  const href = await link.getAttribute("href");
  expect(new URL(href!).pathname).toBe(new URL("./loader/", page.url()).pathname);

  /* And it really is a page. A dead link at the end of an export is worse than
     no link: it is the one moment somebody is sure they did the right thing. */
  const answered = await page.request.get(href!);
  expect(answered.status()).toBe(200);
});
