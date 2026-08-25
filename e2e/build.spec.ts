import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
/* The labels are asserted out of the table the page reads them from, rather
 * than written out here in one language. */
import { TEXTS } from "../src/core/boot_data.js";
import { put } from "./diy.js";
/* Out of the modules that decide them rather than written here: a stride
 * this test spelled out for itself would agree with nothing. */
import { HEADER_BYTES, SET_BYTES } from "../src/data/layout_format.js";
import { TILE_SIZE } from "../src/data/tiles.js";

/* The Release button, pressed for real, and what it left in the store.
 *
 * page.spec.ts checks a board is on the screen. This goes the step further
 * that runBuild() needed: it seeds a board, presses Release, and then asks
 * IndexedDB what is in it. That is the only place the answer can be - the
 * build answers with its log and nothing else, deliberately, and the files it
 * makes are read back by name afterwards the way the device reads them.
 *
 * What it is really holding down is the hashing, because none of it shows in a
 * log line: the same symbol in two sets is one file, the same sentence in two
 * sets is one WAV, and a build cannot leave the previous version of either
 * behind. Those are three counts in a file listing.
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
 * that way without ARASAAC, and a build with no pictures in it would not
 * exercise the tiles at all.
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
 * pictures used nine times between them, three references that resolve to
 * nothing - two blank ones and a name no symbol answers to - which must share
 * one placeholder tile, and five distinct sentences across seven slots with
 * text. */
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
      slots: [{ symbol: "red.png", text: "Danke" },
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

/** A browser with no WebSerial - Firefox, Safari, anything on Android.
 *
 * The press asks for a port before it builds, and does nothing when nobody
 * picks one, so a test that only wants a build has to be somewhere the
 * question is never asked. That is not a contrivance: it is the path half the
 * browsers in the world take, where the build is the whole of what the button
 * can do. */
async function withoutCable(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serial", {
      configurable: true, value: undefined,
    });
  });
}

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

/** The transfer sheet, whichever step it is on. openDialog() appends it to the
 *  body and takes it away again on close, so its presence is also the question
 *  "is the flow still running".
 *
 *  By its accessible name rather than by `dialog.sheet`: the settings and the
 *  three legal pages are sheets too and are in the markup from the first paint,
 *  so that selector matches three elements before this one exists. */
const sheetOf = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: SPEAKS["ui.release"], exact: true });

/** One of the sheet's footer buttons, by the word on it. The corner cross has
 *  a name of its own - ui.transfer_close_sheet - precisely so that an exact
 *  match on "Close" finds the one button that is the way out. */
const footBtn = (page: import("@playwright/test").Page, key: string) =>
  sheetOf(page).getByRole("button", { name: SPEAKS[key], exact: true });

/** Presses it, presses the sheet's own confirm, and waits for the sheet to
 *  arrive at its last step.
 *
 *  The press is no longer the whole job: it opens a sheet that says what is
 *  about to be written and waits to be told to go. What "it is over" looks
 *  like from out here is the footer coming down to one button, which is what
 *  run() offers however the transfer ended - so this waits for that rather
 *  than for a promise it cannot reach.
 *
 *  The log is read out of the sheet, which is still standing: that is the
 *  point of it staying open, and it is also what makes these assertions
 *  possible at all. */
async function release(
  page: import("@playwright/test").Page, { grant = false } = {},
) {
  await page.click("#releaseBtn");
  await expect(sheetOf(page)).toBeVisible();
  /* With no port granted the first step is ours rather than Chrome's: an
     explanation and a button, and the browser's chooser opens from that
     button's own click. `grant` is the test saying it expects to be standing
     there - a sheet that offered Send instead would fail on the next line
     rather than quietly proceeding. */
  if (grant) await footBtn(page, "ui.device_connect").click();
  await footBtn(page, "ui.transfer_go").click();
  /* Generously: a build here synthesises four sentences through the stand-ins
     and then pushes nine files down a mocked wire. */
  await expect(footBtn(page, "ui.close")).toBeVisible({ timeout: 120_000 });

  return await page.evaluate(`(async () => {
    ${IDB}
    const files = await all(await open(), "data");
    return {
      log: document.querySelector("dialog[open] .log").textContent,
      primary: document.getElementById("releaseBtn").classList.contains("primary"),
      names: files.map((f) => f.name),
      sizes: Object.fromEntries(files.map((f) => [f.name, f.size])),
      spoken: (globalThis.__spoken ?? []).slice(),
    };
  })()`) as {
    log: string; primary: boolean; names: string[];
    sizes: Record<string, number>; spoken: string[];
  };
}

/** Dismisses whatever release() left standing, so a test that presses twice
 *  starts its second press against a page with no sheet on it. */
async function dismiss(page: import("@playwright/test").Page) {
  await footBtn(page, "ui.close").click();
  await expect(sheetOf(page)).toHaveCount(0);
}

const tilesOf = (names: string[]) => names.filter((n) => /^t[0-9a-f]{32}\.bin$/.test(n));
const wavsOf = (names: string[]) => names.filter((n) => /^a[0-9a-f]{32}\.wav$/.test(n));

test("it builds a board into the store, one file per distinct thing", async ({ page }) => {
  await withoutCable(page);
  await seed(page);
  const built = await release(page);

  /* The message runBuild() used to throw, in case this ever runs against a
   * page where the build is not written. */
  expect(built.log).not.toContain("not written yet");

  /* A key that reached the screen because nobody put it in the table. The
   * build log was 19 labels that no longer existed when it was ported. */
  expect(built.log.split("\n").filter((l) => /^(build|ui|err)\.[a-z_.]+$/.test(l)))
    .toEqual([]);

  expect(tilesOf(built.names)).toHaveLength(5);   // four pictures, one placeholder
  expect(wavsOf(built.names)).toHaveLength(5);    // Hallo, Danke, Tschuess, Bitte, Niemals
  expect(built.spoken).toHaveLength(5);           // and each spoken exactly once
  expect(built.names).toContain("layout.bin");
  /* Every set the Sammlung holds went in: 5 + 5 + the table. */
  expect(built.names).toHaveLength(11);

  /* The table is all three sets, and every tile is a whole frame. */
  expect(built.sizes["layout.bin"]).toBe(HEADER_BYTES + 3 * SET_BYTES);
  for (const tile of tilesOf(built.names)) {
    expect(built.sizes[tile]).toBe(TILE_SIZE * TILE_SIZE * 2);
  }

  /* The button stops asking to be pressed. */
  expect(built.primary).toBe(false);
});

test("a second build replaces what changed and leaves nothing behind", async ({ page }) => {
  await withoutCable(page);
  await seed(page);
  const first = await release(page);
  await dismiss(page);

  /* Changed through the interface, so that nothing here depends on reaching a
     module the bundle has renamed. The symbol is changed in both places it
     stands, or it would - correctly - keep its tile and the count would be
     measuring nothing. */
  await page.locator("#tabs .tab").nth(1).click();
  await put(page, 2, "Guten Tag");
  await page.waitForTimeout(1500);

  const second = await release(page);
  await dismiss(page);

  const gone = first.names.filter((n) => !second.names.includes(n));
  const fresh = second.names.filter((n) => !first.names.includes(n));

  expect(second.names).toHaveLength(11);
  expect(gone).toHaveLength(1);          // the WAV for "Bitte"
  expect(fresh).toHaveLength(1);         // the WAV for "Guten Tag"
  expect(gone[0]).toMatch(/^a[0-9a-f]{32}\.wav$/);
  /* And it said so, in whichever language the runner opened the page in. */
  expect(second.log).toMatch(/^(removed|entfernt): a[0-9a-f]{32}\.wav$/m);
  /* Only the new sentence cost anything: the other four came back out of the
     store under the names their text still hashes to. */
  expect(second.spoken).toEqual([...first.spoken, "Guten Tag"]);

  /* A third run over an unchanged board is free and takes nothing away. */
  const third = await release(page);
  expect(third.names).toEqual(second.names);
  expect(third.spoken).toEqual(second.spoken);
  expect(third.log).not.toMatch(/^(removed|entfernt): /m);
});

/* --- and onto a device ------------------------------------------------------
 *
 * Everything above stops where builder.py stopped: files in a store. This is
 * the half that was missing until the cable was wired into the page, and it is
 * the only place that half can be checked without a talker on the desk.
 *
 * The device is tools/cable_mock.js - a Map that answers the way cable.h is
 * written to answer. On its own that would be a comfortable lie, because a
 * mock and a client written by the same hand agree with each other by
 * construction; what stops it being one is tests/test_cable_format.py, which
 * records the bytes this same client writes and replays them into the C reader
 * compiled out of the sketch. So the format is held by the C, and what is held
 * here is the wiring the C knows nothing about: that a press builds, that the
 * build is what gets read back out of the store, that the diff is against what
 * the device really holds, and that a second press sends nothing.
 *
 * It is served into the page rather than bundled with it. The page has no
 * business importing a mock, and a route is the whole of what it takes to let
 * one arrive as a module the way any other would.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

async function withDevice(page: import("@playwright/test").Page) {
  for (const name of ["cable.js", "cable_mock.js"]) {
    await page.route(`**/__cable/${name}`, (route) => route.fulfill({
      contentType: "text/javascript",
      body: readFileSync(join(HERE, "..", "tools", name), "utf8"),
    }));
  }
  /* Installed before anything of the page runs, because wireRelease() asks
     getPorts() on load - that question, asked early, is what lets one press be
     enough later. A port that only appeared afterwards would be a page that
     had already decided it had none. */
  await page.addInitScript(() => {
    const ready = import(new URL("__cable/cable_mock.js", location.href).href)
      .then(({ MockDevice }) => {
        /* Chattering on purpose: a real device prints its own serial log
           straight through a transfer, and a client that only works on a
           silent wire does not work. */
        const device = new MockDevice({ noise: true });
        (globalThis as Record<string, unknown>).__device = device;
        let streams: { readable: ReadableStream; writable: WritableStream } | null = null;
        return {
          async open() { streams = device.open(); },
          async close() { streams = null; },
          get readable() { return streams!.readable; },
          get writable() { return streams!.writable; },
          getInfo: () => ({}),
          async setSignals() {},
        };
      });
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: () => ready.then((port) => [port]),
        requestPort: () => ready,
        addEventListener: () => {},
      },
    });
  });
}

/* The language the log comes back in, which is the board's rather than the
 * runner's. BOARD says "de" and the page follows what the layout says, so
 * pinning a language here asserts against a page nobody is looking at - it
 * only passed while the layout's language was written and never read back.
 * Taken from the same field the page reads, so that changing BOARD moves
 * these assertions with it rather than breaking them. */
const SPEAKS = (TEXTS as Record<string, Record<string, string>>)[BOARD.language];

/** One line of the page's own log, with its blanks filled in - the same
 *  substitution t() does, so that a count is asserted against the sentence the
 *  person actually reads rather than against a fragment of it. */
const filled = (key: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce(
    (line, [name, value]) => line.split(`{${name}}`).join(String(value)),
    SPEAKS[key]);

/** What the device is holding. The counters are not read here: the device
 *  clears them when it says goodbye, exactly as cable.h does, so what it did
 *  is in the log rather than on the object. */
async function onDevice(page: import("@playwright/test").Page) {
  return await page.evaluate(`(() => {
    const device = globalThis.__device;
    return {
      names: [...device.files.keys()].sort(),
      sizes: Object.fromEntries([...device.files].map(([n, b]) => [n, b.length])),
    };
  })()`) as { names: string[]; sizes: Record<string, number> };
}

test("one press builds it and puts it on the talker", async ({ page }) => {
  await withDevice(page);
  await seed(page);
  await page.waitForFunction("globalThis.__device !== undefined");

  const built = await release(page);
  const held = await onDevice(page);

  /* The device holds the build. Not a file more, not a file fewer, and every
     one of them the length the store says - which is the whole claim, because
     a name here is a hash of what went into the file and says nothing about
     what arrived. */
  expect(held.names).toEqual([...built.names].sort());
  expect(held.sizes).toEqual(built.sizes);
  /* And it says what it did, with the numbers in it. The third one is what
     went down the wire this session rather than what the device holds - the
     firmware adds command.size per put - so it is the size of the payload. */
  const payload = Object.values(built.sizes).reduce((sum, n) => sum + n, 0);
  expect(built.log).toContain(filled("cable.sent", {
    stored: built.names.length, removed: 0, size: Math.round(payload / 1024),
  }));

  /* The two numbers docs/cable.md is waiting for reach the log, because that
     table is meant to be filled in from a run and this is where a run says
     them. */
  expect(built.log).toContain(SPEAKS["cable.timings"].split("{")[0].trim());
});

/* The first step of the sheet: what is about to be written, before it is.
 *
 * This is the half the page never had. The log used to appear under the work
 * head once the build had already started, so the first thing anybody was told
 * about a transfer was that it was under way. The counts are the ones a
 * decision rests on - a Sammlung switched underneath you, or a set left with
 * nothing on it, are exactly what somebody would want to catch here.
 */
test("the sheet says what is about to go, and keeps the log after it went",
     async ({ page }) => {
  await withDevice(page);
  await seed(page);
  await page.waitForFunction("globalThis.__device !== undefined");

  await page.click("#releaseBtn");
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();

  const values = sheet.locator("dl.transfer dd");
  /* The name out of the field somebody is looking at rather than a literal:
     a Sammlung nobody has renamed is named for the day it was made. */
  await expect(values.nth(0)).toHaveText(await page.inputValue("#collectionName"));
  /* BOARD has three sets, and all three go: a Sammlung is the selection. */
  await expect(values.nth(1))
    .toHaveText(filled("ui.transfer_sets", { n: 3 }));
  /* Twelve keys across the three sets, four of them blank in both halves.
     "Has something on it" is the build's own test, so the number promised
     here is the one the build then keeps. */
  await expect(values.nth(2))
    .toHaveText(filled("ui.transfer_keys", { n: 8, total: 12 }));
  /* WebSerial gives a vendor and a product id and nothing else; the mock port
     answers getInfo() with neither, which is the one case that has no numbers
     to show. */
  await expect(values.nth(3)).toHaveText(SPEAKS["ui.transfer_port_plain"]);

  await footBtn(page, "ui.transfer_go").click();
  await expect(footBtn(page, "ui.close")).toBeVisible({ timeout: 120_000 });

  /* Still standing, and still holding the log - which is the whole reason it
     does not close itself. The summary is gone: the same sheet, a later step. */
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("dl.transfer")).toHaveCount(0);
  await expect(sheet.locator(".log")).toContainText(SPEAKS["cable.looking"]);

  await dismiss(page);
});

test("a second press sends nothing, because the device already has it",
     async ({ page }) => {
  await withDevice(page);
  await seed(page);
  await page.waitForFunction("globalThis.__device !== undefined");

  const first = await release(page);
  await dismiss(page);
  const after = await onDevice(page);
  expect(after.names).toEqual([...first.names].sort());

  /* Nothing has changed on the board, so nothing is missing on the device.
     layout.bin is the one that cannot be answered by its name - it never
     changes - so this is also the check that its checksum is asked for and
     believed. */
  const again = await release(page);
  const held = await onDevice(page);
  expect(held.names).toEqual([...again.names].sort());
  expect(held.sizes).toEqual(after.sizes);
  expect(again.log).toContain(SPEAKS["cable.nothing"]);
  expect(again.log).toContain(filled("cable.sent",
                                     { stored: 0, removed: 0, size: 0 }));
});

/* --- and into a folder ------------------------------------------------------
 *
 * The other way out of the store, and the one that matters when the cable is
 * wrong: the same files on a disk, where the bench and mklittlefs can reach
 * them. tests/unit/build_export.test.ts holds the part that could destroy
 * something - which names the tidy-up is allowed to remove - against a
 * directory made of a Map. What is left for here is the wiring that unit test
 * cannot see: that the panel exists, that its labels resolve, that the button
 * runs the export the seam names, and that the sentence afterwards carries the
 * counts.
 *
 * showDirectoryPicker() opens a dialog no test can answer, so it is stood in
 * for. Everything on this side of it is the real article.
 */
async function withPicker(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const files = new Map<string, number[]>();
    (globalThis as Record<string, unknown>).__folder = files;
    const directory = {
      kind: "directory", name: "bench",
      async getFileHandle(name: string) {
        return {
          async createWritable() {
            const chunks: number[] = [];
            return {
              async write(chunk: Uint8Array) { chunks.push(...chunk); },
              async close() { files.set(name, chunks); },
            };
          },
        };
      },
      async *values() {
        for (const name of [...files.keys()]) yield { kind: "file", name };
      },
      async removeEntry(name: string) { files.delete(name); },
    };
    (window as unknown as Record<string, unknown>).showDirectoryPicker =
      async () => directory;
  });
}

test("the build can be written into a folder, and says what it wrote",
     async ({ page }) => {
  await withPicker(page);
  await withoutCable(page);
  await seed(page);
  const built = await release(page);
  // The settings are behind a modal sheet until this one is out of the way,
  // which is the point of it: nothing else on the page is reachable while a
  // transfer is being reported.
  await dismiss(page);

  await page.locator("#settingsLink").click();
  await expect(page.locator("#voices")).toBeVisible();
  const panel = page.locator("#devicePanel");
  // Chromium has the picker, so the panel is offered rather than hidden.
  await expect(panel).toBeVisible();
  await panel.locator("summary").click();
  await panel.locator("#buildExport").click();

  const written = filled("ui.build_written", {
    folder: "bench", written: built.names.length, removed: 0,
    size: Math.round(
      Object.values(built.sizes).reduce((sum, n) => sum + n, 0) / 1024),
  });
  await expect(page.locator("#deviceState")).toHaveText(written);

  /* And the folder really holds the build - every name, with the length the
     store says. A sentence about files that were never written is the failure
     this is aimed at. */
  const held = await page.evaluate(`(() => {
    const files = globalThis.__folder;
    return Object.fromEntries([...files].map(([name, bytes]) => [name, bytes.length]));
  })()`) as Record<string, number>;
  expect(held).toEqual(built.sizes);
});

/* A dismissed chooser costs nothing at all.
 *
 * A port has to be granted before the build: requestPort() needs transient
 * activation and it expires in about five seconds. So the case to get right is
 * the dismissal, and it was wrong in both directions before this. It built
 * anyway and then reported that nothing was sent, which read as the dialog
 * having been ignored; then the chooser was moved out of the press altogether,
 * which fixed that by removing the thing somebody had pressed the button for.
 *
 * The sheet settles it: our own words come first, Chrome's chooser opens from
 * a button inside them, and closing that chooser leaves somebody standing on
 * that step rather than back at a page that said nothing. Nothing is built,
 * nothing is logged, and the release mark still stands.
 */
test("a dismissed chooser builds nothing and leaves the sheet where it was",
     async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as Record<string, unknown>).__asked = 0;
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: async () => [],
        requestPort: async () => {
          const counted = globalThis as Record<string, unknown>;
          counted.__asked = (counted.__asked as number) + 1;
          // What a browser throws when somebody closes the dialog.
          throw new DOMException("dismissed", "AbortError");
        },
        addEventListener: () => {},
      },
    });
  });
  await seed(page);

  await page.click("#releaseBtn");
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();

  /* Our explanation, and no Send: there is nothing to send to yet, and the
     step says so in words rather than by handing over to the browser. */
  await expect(sheet.locator(".lead")).toHaveText(SPEAKS["ui.transfer_connect_lead"]);
  await expect(footBtn(page, "ui.transfer_go")).toHaveCount(0);
  await expect(sheet.locator("dl.transfer dd").nth(3))
    .toHaveText(SPEAKS["ui.device_none"]);

  await footBtn(page, "ui.device_connect").click();

  expect(await page.evaluate("globalThis.__asked")).toBe(1);
  /* Still here, still the same step. A closed chooser is somebody deciding
     not to, and what they were doing is not over. */
  await expect(sheet).toBeVisible();
  await expect(footBtn(page, "ui.device_connect")).toBeVisible();
  await expect(sheet.locator(".log")).toHaveCount(0);

  const store = await page.evaluate(`(async () => {
    ${IDB}
    return (await all(await open(), "data")).map((f) => f.name);
  })()`) as string[];
  // The build writes layout.bin first of all, so an empty data store is the
  // whole claim: nothing ran.
  expect(store).toEqual([]);
  // And the button still says a release is due, because none happened.
  expect(await page.locator("#releaseBtn").evaluate(
    (node) => node.classList.contains("primary"))).toBe(true);

  // Leaving costs nothing either, and takes the sheet with it.
  await footBtn(page, "ui.cancel").click();
  await expect(sheet).toHaveCount(0);
});

/* Asked once, then never again - the shape docs/cable.md concluded from the
 * two facts about the browser, walked through end to end.
 */
test("the port is asked for once, and the next press goes straight through",
     async ({ page }) => {
  for (const name of ["cable.js", "cable_mock.js"]) {
    await page.route(`**/__cable/${name}`, (route) => route.fulfill({
      contentType: "text/javascript",
      body: readFileSync(join(HERE, "..", "tools", name), "utf8"),
    }));
  }
  await page.addInitScript(() => {
    const ready = import(new URL("__cable/cable_mock.js", location.href).href)
      .then(({ MockDevice }) => {
        const device = new MockDevice({ noise: true });
        (globalThis as Record<string, unknown>).__device = device;
        let streams: { readable: ReadableStream; writable: WritableStream } | null = null;
        return {
          async open() { streams = device.open(); },
          async close() { streams = null; },
          get readable() { return streams!.readable; },
          get writable() { return streams!.writable; },
          getInfo: () => ({}),
          async setSignals() {},
        };
      });
    // getPorts() answers with what requestPort() has handed over, which is
    // what a browser does with a granted port.
    let granted: unknown = null;
    (globalThis as Record<string, unknown>).__asked = 0;
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: async () => (granted ? [granted] : []),
        requestPort: async () => {
          const counted = globalThis as Record<string, unknown>;
          counted.__asked = (counted.__asked as number) + 1;
          granted = await ready;
          return granted;
        },
        addEventListener: () => {},
      },
    });
  });
  await seed(page);

  const first = await release(page, { grant: true });
  await dismiss(page);
  expect(await page.evaluate("globalThis.__asked")).toBe(1);
  expect((await onDevice(page)).names).toEqual([...first.names].sort());

  // And again, with no chooser in between - the sheet goes straight to the
  // step that offers Send, because getPorts() already has the port.
  const second = await release(page);
  await dismiss(page);
  expect(await page.evaluate("globalThis.__asked")).toBe(1);
  expect(second.log).toContain(SPEAKS["cable.nothing"]);

  // The settings still offer a way to change it, which is the other half of
  // "asked once": a wrong port must not be a page reload to undo.
  await page.locator("#settingsLink").click();
  const panel = page.locator("#devicePanel");
  await panel.locator("summary").click();
  await expect(panel.locator("#deviceLink")).toHaveText(SPEAKS["ui.device_connected"]);
  await panel.locator("#deviceConnect").click();
  expect(await page.evaluate("globalThis.__asked")).toBe(2);
});

/* The export stands on its own, and it has to.
 *
 * The press that usually builds asks for a port first and does nothing without
 * one - so on a machine with no talker on it, this button is the only way to
 * produce the files. That machine is exactly the one that needs them: the
 * folder is what the bench sends and what mklittlefs images when the cable is
 * the thing that is wrong.
 */
test("the folder export builds first when there is nothing built",
     async ({ page }) => {
  await withPicker(page);
  await withoutCable(page);
  await seed(page);

  // Deliberately no press of the release button: nothing has been built.
  await page.locator("#settingsLink").click();
  const panel = page.locator("#devicePanel");
  await panel.locator("summary").click();
  await panel.locator("#buildExport").click();

  await expect(panel.locator("#deviceState"))
    .toContainText(SPEAKS["ui.build_written"].split("{")[0].trim(), { timeout: 15_000 });

  const held = await page.evaluate(`(() => {
    const files = globalThis.__folder;
    return Object.fromEntries([...files].map(([name, bytes]) => [name, bytes.length]));
  })()`) as Record<string, number>;
  expect(Object.keys(held)).toContain("layout.bin");
  expect(Object.keys(held).length).toBeGreaterThan(1);
});
