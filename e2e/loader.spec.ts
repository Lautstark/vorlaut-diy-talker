import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
/* The labels are asserted out of the table the page reads them from, rather
 * than written out here in one language. */
import { TEXTS } from "../loader/src/boot_data.js";
/* And the substitution itself, rather than a second copy of it here. It is a
 * module of its own precisely so that this file can have it: boot.ts reads
 * navigator.languages while it loads and there is no browser in this process,
 * and a label with a plural in it cannot be asserted by a helper that does not
 * know how one is chosen. */
import { fill } from "../loader/src/fill.js";
/* Out of the modules that decide them rather than written here: a stride this
 * test spelled out for itself would agree with nothing. */
import { HEADER_BYTES, MAX_SETS, SET_BYTES } from "../loader/src/layout_format.js";
import { TILE_SIZE } from "../loader/src/tiles.js";
import { LONG, SPOKEN, packageBytes } from "./package.js";

/* The file, on the talker - the whole of the second half.
 *
 * These tests were e2e/build.spec.ts's, driving a transfer out of the editor,
 * and they are here because the transfer is. adr/0011 moved it: the editor
 * writes a file and stops, this page takes one and puts it on a device. What
 * has not moved is why they exist at all - a transfer nobody tests is how the
 * byte-loss fault survived - so every one of them is the same claim about the
 * same wire, made about a page that now has a file where it used to have a
 * store.
 *
 * Three things are cheaper here than they were there, and one is new.
 *
 * **Nothing is synthesised.** The page compiles from a file and needs no
 * voice, no model, no network and no Azure key, so the piper stand-ins that
 * half of build.spec.ts was made of are gone. What arrives is e2e/package.ts,
 * written through the editor's own writer.
 *
 * **Nothing is seeded into IndexedDB.** There is no database on this page at
 * all, which is also the strongest single statement adr/0011 makes: what the
 * device gets is a file somebody can see, not the contents of one browser.
 *
 * **The checks are new.** The talker's constraints used to be implicit in the
 * only program that could write the file. They are questions now, and the
 * tests that ask them have no ancestor.
 *
 * The device is loader/tools/cable_mock.js - a Map that answers the way
 * cable.h is written to answer. On its own that would be a comfortable lie,
 * because a mock and a client written by the same hand agree with each other
 * by construction; what stops it being one is tests/test_cable_format.py,
 * which records the bytes this same client writes and replays them into the C
 * reader compiled out of the sketch. So the format is held by the C, and what
 * is held here is the wiring the C knows nothing about: that a file is read,
 * that what is compiled out of it is what goes down the wire, that the diff is
 * against what the device really holds, and that a second press sends nothing.
 */

const PAGE_LANG = "de";
test.use({ locale: `${PAGE_LANG}-DE` });

const SPEAKS = (TEXTS as Record<string, Record<string, string>>)[PAGE_LANG];

/** One line of the page's own text with its blanks filled in - the same
 *  substitution t() does, so that a count is asserted against the sentence
 *  somebody actually reads rather than against a fragment of it. */
const filled = (key: string, params: Record<string, string | number>) =>
  fill(SPEAKS[key]!, params, PAGE_LANG);

/** The longest run of a line that carries no blank, for the ones whose numbers
 *  this test does not want to predict.
 *
 * The longest rather than the first, and that is not fussiness: several of
 * these labels open with `{written}` or `{stored}`, so the first run is the
 * empty string - and `toContainText("")` passes against a page that says
 * nothing at all. One of them did, and the test it made green was the one
 * asserting that a folder had been written. */
const opening = (key: string) =>
  SPEAKS[key].split(/\{[a-z_]+(?:\|[^{}]*)?\}/).map((one) => one.trim())
    .reduce((longest, one) => (one.length > longest.length ? one : longest), "");

const HERE = dirname(fileURLToPath(import.meta.url));

/** The five steps, by their headings. The page draws all of them from the
 *  start, so a step that never runs is present and empty rather than absent -
 *  which is what makes "did step 4 open?" a question worth asking. */
const step = (page: Page, key: string) =>
  page.locator("section.step").filter({
    has: page.getByRole("heading", { name: SPEAKS[key], exact: true }),
  });

const stateOf = (page: Page, key: string) =>
  step(page, key).getAttribute("data-state");

/** A serial port that is the mock talker, installed before anything of the
 *  page runs.
 *
 *  Before, because the page asks getPorts() on load - that question, asked
 *  early, is what lets one press be enough later. A port that only appeared
 *  afterwards would be a page that had already decided it had none.
 *
 *  The two modules are served into the page rather than bundled with it. The
 *  page has no business importing a mock, and a route is the whole of what it
 *  takes to let one arrive as a module the way any other would. */
async function withDevice(page: Page, { granted = true } = {}) {
  for (const name of ["cable.js", "cable_mock.js"]) {
    await page.route(`**/__cable/${name}`, (route) => route.fulfill({
      contentType: "text/javascript",
      body: readFileSync(join(HERE, "..", "loader", "tools", name), "utf8"),
    }));
  }
  await page.addInitScript(({ granted }) => {
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
    let held: unknown = granted ? ready : null;
    (globalThis as Record<string, unknown>).__asked = 0;
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: async () => (held ? [await held] : []),
        requestPort: async () => {
          const counted = globalThis as Record<string, unknown>;
          counted.__asked = (counted.__asked as number) + 1;
          held = ready;
          return await ready;
        },
        addEventListener: () => {},
      },
    });
  }, { granted });
}

/** What the device is holding. The counters are not read: the device clears
 *  them when it says goodbye, exactly as cable.h does, so what it did is in
 *  the log rather than on the object. */
async function onDevice(page: Page) {
  return await page.evaluate(`(() => {
    const device = globalThis.__device;
    return {
      names: [...device.files.keys()].sort(),
      sizes: Object.fromEntries([...device.files].map(([n, b]) => [n, b.length])),
    };
  })()`) as { names: string[]; sizes: Record<string, number> };
}

/** Opens the page and hands it a file, the way somebody with a talker does.
 *
 * setInputFiles rather than a click on the button: the button opens the
 * browser's own picker, which no test can answer, and the input behind it is
 * the thing the page actually reads. The bytes are the real article. */
async function choose(page: Page, bytes: Buffer, name = "kitchen-device.obz") {
  await page.goto("./loader/");
  await expect(page.getByRole("heading", { name: SPEAKS["load.title"] }))
    .toBeVisible();
  await page.setInputFiles("input[type=file]", {
    name, mimeType: "application/zip", buffer: bytes,
  });
}

/** Waits for the compile to have finished, which is the point every test past
 *  the checks is standing on. */
async function compiled(page: Page) {
  await expect(step(page, "load.step_compile").locator("p").first())
    .toContainText(opening("load.compiled"), { timeout: 30_000 });
}

const findings = (page: Page, key: string) => step(page, key).locator("li");

/* -------------------------------------------------------- reading a file --- */

test("it says what is in the file before it does anything with it",
     async ({ page }) => {
  await withDevice(page);
  await choose(page, packageBytes());

  /* The counts somebody recognises their own Sammlung by, and the cheapest
     moment there is to notice they exported the wrong one. Two sets, eight
     keys, six of them with something on - the two that are neither a word nor
     a picture are the empty one in set two and the picture-only key in set
     one, which has a picture and so counts. */
  await expect(step(page, "load.step_check")).toContainText(filled("load.holds", {
    sets: 2, filled: 7, keys: 8, pictures: 2, sounds: SPOKEN.length,
  }));
  await expect(step(page, "load.step_check"))
    .toContainText(filled("load.holds_language", { name: SPEAKS["lang.de"]! }));
});

test("it names every key that will not be what the Sammlung says it is",
     async ({ page }) => {
  await withDevice(page);
  await choose(page, packageBytes());
  await compiled(page);

  /* Three notes, and each is a different way a key ends up not saying what
     somebody typed. None of them is an error and none of them stops the file:
     a Sammlung with a gap is worth sending, and what it must not be is
     invisible, because from the other side of the room all three look like a
     device that is broken. */
  const said = await findings(page, "load.step_check").allTextContents();

  // A picture the file does not carry: the key draws the grey cross.
  expect(said.some((line) => line.includes("fehlt.png"))).toBe(true);
  // A word with no recording beside it: the key is silent.
  expect(said.some((line) => line.includes("Niemals"))).toBe(true);
  // And a clip long enough that the key answers nothing while it runs.
  expect(said.some((line) => line.includes(LONG.toFixed(1)))).toBe(true);

  /* Notes, not refusals - so the flow went on and the device step is open. */
  expect(await stateOf(page, "load.step_connect")).not.toBe("waiting");
});

test("a file that is not a package is refused in words, and nothing else runs",
     async ({ page }) => {
  await withDevice(page);
  // A .obz that is a perfectly good zip and holds no manifest is the near
  // miss; something that is not a zip at all is the common one. This is the
  // common one: a picture dropped on the wrong page.
  await choose(page, Buffer.from(readFileSync(join(HERE, "fixtures", "symbol.png"))),
               "symbol.png");

  const refusals = findings(page, "load.step_check").filter({ hasText: "✖" });
  await expect(refusals).toHaveCount(1);
  await expect(refusals.first()).toContainText("symbol.png");
  await expect(step(page, "load.step_check")).toContainText(SPEAKS["load.refused"]);

  /* And nothing past it opened. The claim is not only that it said so - it is
     that a file it could not read never reached a compile, let alone a
     cable. */
  expect(await stateOf(page, "load.step_compile")).toBe("waiting");
  expect(await stateOf(page, "load.step_send")).toBe("waiting");
});

test("a Sammlung with more sets than the device has room for is refused",
     async ({ page }) => {
  await withDevice(page);
  /* The check that has no ancestor, and the reason it exists. The editor could
     not make a sixth set - LIMITS.maxSets is five - so the build never had to
     ask. A file from anywhere else can, renderLayoutBin() will happily write
     it, and readLayout() on the device answers LAYOUT_BAD_LENGTH: a talker
     that takes the transfer and then shows nothing, with no screen anywhere
     saying why. device/fixtures/layout/sets-past-max.expected.json is that
     refusal written down. */
  await choose(page, packageBytes("too-many-sets"));

  const refusals = findings(page, "load.step_check").filter({ hasText: "✖" });
  await expect(refusals).toHaveCount(1);
  await expect(refusals.first())
    .toContainText(filled("load.too_many_sets", { sets: MAX_SETS + 1, max: MAX_SETS }));
  expect(await stateOf(page, "load.step_compile")).toBe("waiting");
});

test("a recording that is not the WAV the device plays is refused",
     async ({ page }) => {
  await withDevice(page);
  /* The device does not refuse a 24 kHz file - it finds the data chunk and
     plays whatever is in it at the rate I2S was started with, which is a word
     at the wrong pitch on a talker with nothing anywhere saying why. So the
     rule is kept on this side, and this is the last place it can be. */
  /* Written past the writer's own refusal on purpose: buildDevicePackage()
     would not write this, which is right, and is why the fixture was tampered
     with after it. The file this page has to be ready for is one the editor
     did not write - see e2e/fixtures/packages/README.md. */
  await choose(page, packageBytes("sound-at-the-wrong-rate"));

  await expect(findings(page, "load.step_check").filter({ hasText: "✖" }).first())
    .toContainText("24000");
  expect(await stateOf(page, "load.step_compile")).toBe("waiting");
});

/* ---------------------------------------------------------- compiling it --- */

test("it compiles the file into exactly what a talker holds", async ({ page }) => {
  await withDevice(page);
  await choose(page, packageBytes());
  await compiled(page);
  await step(page, "load.step_send")
    .getByRole("button", { name: SPEAKS["load.send"], exact: true }).click();
  await expect(step(page, "load.step_send"))
    .toContainText(opening("cable.sent"), { timeout: 60_000 });

  const held = await onDevice(page);

  /* The table is both sets, and every tile is a whole frame. Two facts the
     compiler cannot get wrong quietly: a layout.bin of the wrong length is
     refused by the device outright, and a tile of the wrong length is drawn
     as whatever the next file's bytes happen to be. */
  expect(held.sizes["layout.bin"]).toBe(HEADER_BYTES + 2 * SET_BYTES);
  const tiles = held.names.filter((n) => /^t[0-9a-f]{32}\.bin$/.test(n));
  for (const tile of tiles) {
    expect(held.sizes[tile]).toBe(TILE_SIZE * TILE_SIZE * 2);
  }

  /* Five distinct tiles, and the count is the whole of what hashing buys.
     symbol.png is on three keys and a set key and is one file; the same
     picture crossed out is a second, because the cross is baked into the
     pixels; wide.png is a third; the grey cross for the reference nothing
     resolves is a fourth; and the blank for the key holding nothing at all is
     a fifth. The set key of the second set has no picture, so it draws the
     same grey cross as the unresolved reference - one file, not two. */
  expect(tiles).toHaveLength(5);

  /* And one WAV per sentence the file carries a recording for. "Niemals" has
     none, which is the silent key the checks named. */
  const wavs = held.names.filter((n) => /^a[0-9a-f]{32}\.wav$/.test(n));
  expect(wavs).toHaveLength(SPOKEN.length);
});

test("it shows the compiled tiles at the size a key really is", async ({ page }) => {
  /* The picture adr/0013 moved here. It used to be a toggle in the editor,
     drawn while a pictogram was being chosen, and it was the one place the
     editor ran the device's own tile pipeline; here it is what the compile
     just made, which is a stronger claim than the one it replaced - those are
     the bytes about to go down the cable rather than a prediction of them.

     So what is asserted is the three things that would each make it a
     different picture: the arrangement, the millimetres, and that the pixels
     are the tile rather than the source. */
  await withDevice(page);
  await choose(page, packageBytes());
  await compiled(page);

  const preview = step(page, "load.step_compile").locator(".preview");
  await expect(preview.getByRole("heading", { name: SPEAKS["load.preview"] }))
    .toBeVisible();

  /* One board per set, and each is the hardware's own six places: the speaker
     is a hole and the other five are screens. A row of five would be a
     different device. */
  const boards = preview.locator(".preview__set");
  await expect(boards).toHaveCount(2);
  await expect(boards.first().locator(".device__hole")).toHaveCount(1);
  await expect(boards.first().locator(".device__key")).toHaveCount(5);
  await expect(boards.first().locator("figcaption"))
    .toHaveText(filled("load.set_named", { n: 1, name: "Erste" }));

  /* 15.21 mm, which is the whole visible area of a ScreenKey -
     docs/hardware.md - so this is life-size and a pictogram that does not
     survive the trip can be seen not to. Within a tenth of a pixel rather than
     exactly: the browser resolves a millimetre in its own precision, and
     pinning that rounding would assert Chromium's arithmetic rather than that
     the rule is in millimetres at all. */
  const width = await boards.first().locator(".device__key").first()
    .evaluate((el) => parseFloat(getComputedStyle(el).width));
  expect(Math.abs(width - (15.21 / 25.4 * 96))).toBeLessThan(0.1);

  /* And the pixels are the compiled tile, which is what nothing about the
     layout above can show. Keys 1 and 2 of the first set are the same source
     picture, and the second is crossed out: the cross is baked into the tile
     by the compiler, so two tiles differ. A preview drawing the source image
     would have drawn one picture twice. */
  const asData = (nth: number, board = 0) =>
    boards.nth(board).locator(".device__key").nth(nth)
      .evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  expect(await asData(0)).not.toBe(await asData(1));

  /* The other half of the same claim, from the empty end: key 2 of the second
     set holds neither word nor picture, and what the device shows there is the
     blank tile - white, and not the grey cross a missing picture gets.
     loader/src/tiles.ts's blank() is the whole argument for those being two
     different tiles. */
  const white = await boards.nth(1).locator(".device__key").nth(1).evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const { data } = canvas.getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height);
    // Every channel and the alpha alike: blank() fills the tile with 255 and
    // the panel is opaque, so one number covers all four.
    return data.every((value) => value === 255);
  });
  expect(white).toBe(true);
});

test("a picture that will not decode is a grey cross and a line, not a failure",
     async ({ page }) => {
  await withDevice(page);
  /* The one finding that cannot be made before the compile: whether a source
     actually decodes is a question only a browser answers, and the compiler's
     answer to "it does not" is the same tile it draws for a picture that is
     not there. Right, and silent - so the host keeps a list and the page says
     it. */
  await choose(page, packageBytes("picture-that-will-not-decode"));
  await compiled(page);

  await expect(findings(page, "load.step_compile").filter({ hasText: "wide.png" }))
    .toHaveCount(1);
  /* It is a note: the file still goes, and the rest of the Sammlung with it. */
  expect(await stateOf(page, "load.step_connect")).not.toBe("waiting");
});

/* ------------------------------------------------------------- the cable --- */

test("one press puts the compiled file on the talker", async ({ page }) => {
  await withDevice(page);
  await choose(page, packageBytes());
  await compiled(page);

  const compiledLine = await step(page, "load.step_compile")
    .locator("p").first().textContent();
  const files = Number(compiledLine!.match(/\d+/)![0]);

  await step(page, "load.step_send")
    .getByRole("button", { name: SPEAKS["load.send"], exact: true }).click();
  await expect(step(page, "load.step_send"))
    .toContainText(opening("cable.sent"), { timeout: 60_000 });

  /* The device holds the compile. Not a file more, not a file fewer - which is
     the whole claim, because a name here is a hash of what went into the file
     and says nothing at all about what arrived. */
  const held = await onDevice(page);
  expect(held.names).toHaveLength(files);

  /* And it says what it did, with the numbers in it. */
  const payload = Object.values(held.sizes).reduce((sum, n) => sum + n, 0);
  await expect(step(page, "load.step_send")).toContainText(filled("cable.sent", {
    stored: files, removed: 0, size: Math.round(payload / 1024), keep: 0,
  }));

  /* The two numbers docs/cable.md is waiting for reach the log, because that
     table is meant to be filled in from a run and this is where a run says
     them. */
  await expect(step(page, "load.step_send")).toContainText(opening("cable.timings"));
});

test("a second press sends nothing, because the device already has it",
     async ({ page }) => {
  await withDevice(page);
  await choose(page, packageBytes());
  await compiled(page);

  const send = () => step(page, "load.step_send")
    .getByRole("button", { name: SPEAKS["load.send"], exact: true }).last().click();

  await send();
  await expect(step(page, "load.step_send"))
    .toContainText(opening("cable.sent"), { timeout: 60_000 });
  const after = await onDevice(page);

  /* Nothing has changed, so nothing is missing on the device. layout.bin is
     the one that cannot be answered by its name - it never changes - so this
     is also the check that its checksum is asked for and believed. */
  await send();
  await expect(step(page, "load.step_send"))
    .toContainText(SPEAKS["cable.nothing"], { timeout: 60_000 });
  const held = await onDevice(page);
  expect(held.sizes).toEqual(after.sizes);
  await expect(step(page, "load.step_send")).toContainText(filled("cable.sent", {
    stored: 0, removed: 0, size: 0, keep: after.names.length,
  }));
});

test("with no port granted, the connect step offers the chooser and nothing else",
     async ({ page }) => {
  await withDevice(page, { granted: false });
  await choose(page, packageBytes());
  await compiled(page);

  /* requestPort() needs transient activation and Chrome expires it in about
     five seconds, which is why connecting is a step with a button of its own
     rather than something the send press does on the way past. What that costs
     here is nothing - the compile has already happened and is not paid for
     twice - and what it used to cost, in the editor, was a whole build per
     dismissed dialog. */
  await expect(step(page, "load.step_connect")
    .getByRole("button", { name: SPEAKS["load.connect"], exact: true })).toBeVisible();
  expect(await stateOf(page, "load.step_send")).toBe("waiting");

  await step(page, "load.step_connect")
    .getByRole("button", { name: SPEAKS["load.connect"], exact: true }).click();

  expect(await page.evaluate("globalThis.__asked")).toBe(1);
  /* And now there is a port, so the send step is the one to be standing on. */
  await expect(step(page, "load.step_send")
    .getByRole("button", { name: SPEAKS["load.send"], exact: true })).toBeVisible();
});

test("a port that answers nothing gets the chooser offered again, and says so",
     async ({ page }) => {
  /* The way back from a port that is not the talker: a dongle or a second dev
     board, which opens perfectly well and simply is not a vorlaut. Nothing on
     it answers `hello`, so findTalker() throws cable_no_device, the page sets
     askAgain, and the connect step is back to offering the chooser.
     err.cable_no_device says so in as many words, which is why this asserts
     the sentence and not only the button: somebody has to be told that
     pressing again is worth doing. */
  await page.addInitScript(() => {
    const silent = {
      async open() {},
      async close() {},
      readable: new ReadableStream({ start() { /* never a byte */ } }),
      writable: new WritableStream({ write() {} }),
      getInfo: () => ({}),
      async setSignals() {},
    };
    (globalThis as Record<string, unknown>).__asked = 0;
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: async () => [silent],
        requestPort: async () => {
          const counted = globalThis as Record<string, unknown>;
          counted.__asked = (counted.__asked as number) + 1;
          return silent;
        },
        addEventListener: () => {},
      },
    });
  });
  await choose(page, packageBytes());
  await compiled(page);

  // A port is granted, so the send step is offered rather than the chooser.
  await step(page, "load.step_send")
    .getByRole("button", { name: SPEAKS["load.send"], exact: true }).click();
  await expect(step(page, "load.step_send"))
    .toContainText(SPEAKS["err.cable_no_device"], { timeout: 60_000 });

  // And the connect step is back at the chooser, without anybody having gone
  // looking for a settings panel.
  await expect(step(page, "load.step_connect")
    .getByRole("button", { name: SPEAKS["load.connect"], exact: true })).toBeVisible();
});

/* ------------------------------------------------------------ the folder --- */

test("the compiled files can be written into a folder instead", async ({ page }) => {
  /* The other way in, and it is not a fallback: mklittlefs turns a directory
     into an image that esptool writes straight into the partition, which is
     the path that works when the cable protocol itself is wrong.
     tests/unit/build_export.test.ts holds the part that could destroy
     something - which names the tidy-up may remove - against a directory made
     of a Map. What is left for here is the wiring that unit test cannot see:
     that the button is on the page, that it runs the export the page names,
     and that the sentence afterwards carries the counts.

     showDirectoryPicker() opens a dialog no test can answer, so it is stood in
     for. Everything on this side of it is the real article. */
  await page.addInitScript(() => {
    const files = new Map<string, Uint8Array>();
    (globalThis as Record<string, unknown>).__folder = files;
    const directory = {
      kind: "directory", name: "bench",
      async getFileHandle(name: string) {
        return {
          async createWritable() {
            const chunks: Uint8Array[] = [];
            return {
              async write(chunk: Uint8Array) { chunks.push(chunk.slice()); },
              async close() {
                /* Joined rather than spread into an array of numbers, which is
                   what this stood in with until a tile arrived: a whole frame
                   is 32768 bytes and `push(...bytes)` is 32768 arguments, so
                   the write threw "Maximum call stack size exceeded" halfway
                   down the file list. The page caught it and said so, and the
                   assertion here could not see it - which is a second finding
                   and is why `opening()` above takes the longest run rather
                   than the first. */
                const size = chunks.reduce((total, one) => total + one.length, 0);
                const all = new Uint8Array(size);
                let at = 0;
                for (const one of chunks) { all.set(one, at); at += one.length; }
                files.set(name, all);
              },
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
  await withDevice(page);
  await choose(page, packageBytes());
  await compiled(page);

  await step(page, "load.step_compile")
    .getByRole("button", { name: SPEAKS["load.folder"], exact: true }).click();
  await expect(step(page, "load.step_compile"))
    .toContainText(opening("load.folder_written"), { timeout: 30_000 });

  /* And the folder really holds the files - every name, with the length the
     compile made. A sentence about files that were never written is the
     failure this is aimed at. */
  const held = await page.evaluate(`(() => {
    const files = globalThis.__folder;
    return Object.fromEntries([...files].map(([name, bytes]) => [name, bytes.length]));
  })()`) as Record<string, number>;
  expect(Object.keys(held)).toContain("layout.bin");
  expect(held["layout.bin"]).toBe(HEADER_BYTES + 2 * SET_BYTES);
});
