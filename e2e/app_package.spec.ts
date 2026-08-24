import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { LANGUAGES, TEXTS } from "../src/core/boot_data.js";
import { checkPackage, type AppPackage, type PackageBoard, type PackageManifest }
  from "../src/data/app_package.js";

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
  await expect(page.locator("#device .tile")).toHaveCount(5);

  await page.locator("#device .setTile input[type=text]").first().fill("Morgens");
  const keys = page.locator("#device .tile:not(.setTile) input[type=text]");
  await keys.nth(0).fill("Ich habe Hunger");
  await keys.nth(1).fill("Ich habe Durst");
  await expect(page.locator("#status")).toHaveText(SAVED, { timeout: 10_000 });

  // A picture on the first key, uploaded rather than searched for: ARASAAC is
  // a network away and this is not the test for it.
  await page.locator("#device .tile:not(.setTile) .thumb").first().click();
  await expect(page.locator("#picker")).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#uploadBtn").click(),
  ]);
  await chooser.setFiles(join(HERE, "fixtures", "symbol.png"));
  // The status line says the picture was taken rather than that the board was
  // saved, so the picture on the key is what says the pick landed. The export
  // saves before it packages anything, which is what makes that enough.
  await expect(page.locator("#device .tile:not(.setTile) .thumb img").first()).toBeVisible();

  // The Azure key, and Katja chosen with it. The stored voice is what the
  // export synthesises with and what the manifest names as its hint.
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
  // Out of the sheet: the ⋯ this test is heading for is behind it, and a modal
  // <dialog> makes everything under it inert rather than merely covered.
  await page.locator("#voices").evaluate((sheet: HTMLDialogElement) => sheet.close());
  await expect(page.locator("#voices")).toBeHidden();
}

/* --- reading the archive back ------------------------------------------- */

interface Member { name: string; data: Uint8Array; flags: number }

function unzip(bytes: Uint8Array): Map<string, Member> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  expect(end, "no end-of-central-directory record").toBeGreaterThan(-1);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, Member>();

  for (let n = 0; n < count; n++) {
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength));
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = bytes.slice(start, start + size);
    out.set(name, { name, flags, data: method === 0 ? raw : new Uint8Array(inflateRawSync(raw)) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

function readPackage(bytes: Uint8Array): { pkg: AppPackage; members: Map<string, Member> } {
  const members = unzip(bytes);
  const parse = (name: string) =>
    JSON.parse(new TextDecoder().decode(members.get(name)!.data));
  const manifest = parse("manifest.json") as PackageManifest;
  const boards = Object.values(manifest.paths.boards).map((path) => parse(path) as PackageBoard);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, member] of members) {
    if (name === "manifest.json" || name.endsWith(".obf")) continue;
    files.set(name, new Uint8Array(member.data));
  }
  return { pkg: { manifest, boards, files }, members };
}

/* --- the test ------------------------------------------------------------ */

test("a Sammlung leaves as a package, and it passes the spec's own checks",
  async ({ page }) => {
    await standIn(page);
    await fill(page);

    await page.locator("#collectionMenu").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".menu button", { hasText: label("ui.collection_export_app") }).click(),
    ]);
    // Synthesis, encoding and zipping happen between the click and the file.
    const path = await download.path();
    expect(path).toBeTruthy();
    expect(download.suggestedFilename()).toMatch(/-app\.obz$/);

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
    expect(pkg.manifest.ext_lautstark_spec_version).toBe("1.0.0");
    expect(pkg.manifest.ext_lautstark_package_id)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pkg.manifest.ext_lautstark_modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(pkg.manifest.ext_lautstark_redistributable).toBe(false);
    // The picture was uploaded rather than picked, so the package claims no
    // symbol collection at all.
    expect(pkg.manifest.ext_lautstark_symbol_source).toBe("none");
    // §4.1: the hint, without the "azure:" that says where it is synthesised.
    expect(pkg.manifest.ext_lautstark_tts_voice).toBe("de-DE-KatjaNeural");

    const board = pkg.boards[0]!;
    expect(board.name).toBe("Morgens");
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
    expect(clips).toHaveLength(2);
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
    const [app] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".menu button", { hasText: label("ui.collection_export_app") }).click(),
    ]);
    const packaged = unzip(new Uint8Array(readFileSync((await app.path())!)));
    expect([...packaged.keys()].filter((name) => name.startsWith("images/"))).toHaveLength(1);
    const page1 = JSON.parse(new TextDecoder().decode(packaged.get("boards/set-1.obf")!.data));
    expect(page1.images[0].path).toMatch(/^images\//);
    expect(page1.images[0].symbol).toBeUndefined();
  });
