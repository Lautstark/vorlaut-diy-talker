import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAppPackage, checkPackage, localeFor, packageBytes, symbolSource,
  type AppPackage, type PackageInput,
} from "../../src/data/app_package.js";
import { readPackage, readPackageFile, unzip } from "./obz.js";
import type {
  AppButton, AppLayout, AppPage, CollectionRef, DiyLayout, Layout,
} from "../../src/core/types.js";

/* The app package: the mapping, and the refusals.
 *
 * Two halves, and the second is the one that earns its place. The mapping is
 * ordinary and would go wrong loudly - a missing button is a button somebody
 * can see is missing. The checks are what stand between a wrong package and a
 * tablet in somebody's kitchen, where the person who finds the fault is a
 * caregiver with no way to fix it, so each of them is exercised here by
 * breaking a package on purpose and watching it be refused.
 *
 * The last describe() is the one that keeps this honest against something
 * outside this repository: the conformance fixtures under exchange/, written
 * by a different program against the same specification. A checker that has
 * only ever read its own builder's output is a checker agreeing with itself.
 */

const FIXTURES = join(import.meta.dirname, "..", "..", "exchange", "fixtures");

const collection = (over: Partial<CollectionRef> = {}): CollectionRef => ({
  id: "1f0a5c2e-0000-4000-8000-000000000001",
  name: "Zuhause",
  updatedAt: Date.UTC(2026, 7, 24, 9, 0, 0),
  ...over,
});

const slot = (text: string, symbol = "") => ({ text, symbol });

const layout = (): DiyLayout => ({
  language: "de",
  voice: "piper:de_DE-thorsten-medium",
  sleep_timeout_seconds: 600,
  sets: [
    {
      name: "Essen", symbol: "arasaac-31337.png", color: "#3B5BDB",
      slots: [slot("Ich habe Hunger", "arasaac-2462.png"), slot("Ich habe Durst"),
              slot(""), slot("Mehr bitte", "arasaac-2462.png")],
    },
    {
      name: "Spielen", symbol: "", color: "#2F9E44",
      slots: [slot("Noch einmal"), slot(""), slot(""), slot("")],
    },
  ],
});

const baked = (key: string) => ({
  key,
  // Enough of a PNG for pngSize() to read: signature, then an IHDR saying
  // 512x512. The checker reads the header and nothing else, which is what
  // §5.3 asks an importer to do before it allocates a bitmap.
  bytes: png(512, 512),
  width: 512, height: 512,
});

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(33));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function ogg(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(40));
  bytes.set(new TextEncoder().encode("OggS"), 0);
  bytes.set(new TextEncoder().encode("OpusHead"), 28);
  return bytes;
}

const input = (over: Partial<PackageInput> = {}): PackageInput => ({
  collection: collection(),
  layout: layout(),
  images: new Map([["arasaac-2462.png", baked("aaaa1111")],
                   ["arasaac-31337.png", baked("bbbb2222")]]),
  sounds: new Map([
    ["Ich habe Hunger", { key: "cccc3333", bytes: ogg(), seconds: 1.4 }],
    ["Ich habe Durst", { key: "dddd4444", bytes: ogg(), seconds: 1.2 }],
    ["Mehr bitte", { key: "eeee5555", bytes: ogg(), seconds: 0.9 }],
    ["Noch einmal", { key: "ffff6666", bytes: ogg(), seconds: 1.1 }],
  ]),
  voice: "piper:de_DE-thorsten-medium",
  ...over,
});

const board = (pkg: AppPackage, id: string) => pkg.boards.find((one) => one.id === id)!;
const button = (pkg: AppPackage, boardId: string, id: string) =>
  board(pkg, boardId).buttons.find((one) => one.id === id)!;

describe("a DIY Sammlung as a board package", () => {
  it("says who it is in the way SPEC.md §8 asks", () => {
    const { manifest } = buildAppPackage(input());

    // The Sammlung's own id, minted when it was created and never re-derived
    // here: §8's rule is that it survives renaming, editing and re-export, and
    // an id computed at export time would survive none of them.
    expect(manifest.ext_lautstark_package_id).toBe(collection().id);
    expect(manifest.ext_lautstark_package_name).toBe("Zuhause");
    // Off the Sammlung's updatedAt rather than the clock, so that re-exporting
    // an unchanged Sammlung does not look to the viewer like an update.
    expect(manifest.ext_lautstark_modified).toBe("2026-08-24T09:00:00Z");
    expect(manifest.ext_lautstark_spec_version).toBe("1.1.0");
    expect(manifest.format).toBe("open-board-0.1");
    expect(manifest.root).toBe("boards/set-1.obf");
  });

  it("never claims a package may be passed on", () => {
    // §5.2 requires false for METACOM and permits true for ARASAAC. This
    // builder writes false either way: a package carries somebody's recordings
    // in somebody's voice, and the flag is an instruction the viewer keeps.
    expect(buildAppPackage(input()).manifest.ext_lautstark_redistributable).toBe(false);
    const own = input({ layout: { ...layout(), sets: layout().sets.map((set) => ({
      ...set, symbol: "metacom:ja", slots: set.slots.map((s) => ({ ...s, symbol: "" })),
    })) } });
    const metacom = buildAppPackage({ ...own, images: new Map([["metacom:ja", baked("9999")]]) });
    expect(metacom.manifest.ext_lautstark_symbol_source).toBe("metacom");
    expect(metacom.manifest.ext_lautstark_redistributable).toBe(false);
  });

  it("keeps the keys where they sit on the case", () => {
    const pkg = buildAppPackage(input());
    // Two rows of three with the top left empty, because that is where the
    // speaker is. A viewer that re-flowed five keys into a row would take away
    // what somebody knows with their hand.
    expect(board(pkg, "set-1").grid).toEqual({
      rows: 2,
      columns: 3,
      order: [
        [null, "set-1-key-1", "set-1-key-2"],
        ["set-1-set", null, "set-1-key-4"],
      ],
    });
    // Slot three was empty, so its cell is empty and no button pretends to be
    // there. Slot two has text and no picture and is still a button.
    expect(button(pkg, "set-1", "set-1-key-2").label).toBe("Ich habe Durst");
    expect(button(pkg, "set-1", "set-1-key-2").image_id).toBeUndefined();
  });

  it("speaks at once rather than filling a message bar", () => {
    const pkg = buildAppPackage(input());
    expect(button(pkg, "set-1", "set-1-key-1").ext_lautstark_speak_immediately).toBe(true);
    // The set key navigates, and §7.3 says navigation must not touch the bar,
    // so it carries no speak flag at all.
    expect(button(pkg, "set-1", "set-1-set").ext_lautstark_speak_immediately).toBeUndefined();
  });

  it("cycles the sets the way the device does", () => {
    const pkg = buildAppPackage(input());
    expect(button(pkg, "set-1", "set-1-set").load_board)
      .toEqual({ id: "set-2", name: "Spielen", path: "boards/set-2.obf" });
    // The ring wraps, which is the device's behaviour and not a mistake: the
    // last set's key comes back round to the first.
    expect(button(pkg, "set-2", "set-2-set").load_board?.id).toBe("set-1");
  });

  it("carries the set colour as a page colour and a border", () => {
    const pkg = buildAppPackage(input());
    // §4.2: OBF colours buttons, never pages, and a page told apart by colour
    // is how somebody who does not read finds it.
    expect(board(pkg, "set-1").ext_lautstark_board_color).toBe("#3b5bdb");
    expect(button(pkg, "set-1", "set-1-key-1").border_color).toBe("rgb(59, 91, 219)");
  });

  it("writes one file per distinct picture and per distinct sentence", () => {
    const pkg = buildAppPackage(input());
    // "apfel.png" is on two keys of set-1 and is one member of the archive.
    expect([...pkg.files.keys()].filter((p) => p.startsWith("images/"))).toEqual(
      ["images/aaaa1111.png", "images/bbbb2222.png"]);
    expect(button(pkg, "set-1", "set-1-key-1").image_id)
      .toBe(button(pkg, "set-1", "set-1-key-4").image_id);
    expect([...pkg.files.keys()].filter((p) => p.startsWith("sounds/"))).toHaveLength(4);
  });

  it("names the voice as a hint, without vorlaut's own bookkeeping", () => {
    // "piper:" says where a voice is synthesised, which an Android viewer can
    // do nothing with. §4.1 makes the field a hint that must never fail.
    expect(buildAppPackage(input()).manifest.ext_lautstark_tts_voice)
      .toBe("de_DE-thorsten-medium");
    expect(buildAppPackage(input({ voice: "", sounds: new Map() }))
      .manifest.ext_lautstark_tts_voice).toBeUndefined();
  });

  it("is a normal package when nothing has been recorded", () => {
    // §9.2: a board built for text to speech is not degraded, and a viewer
    // that marked every such button would put a fault marker on all of them.
    const pkg = buildAppPackage(input({ sounds: new Map(), voice: "" }));
    expect(checkPackage(pkg)).toEqual([]);
    expect(pkg.boards.every((one) => one.sounds.length === 0)).toBe(true);
    expect([...pkg.files.keys()].some((p) => p.startsWith("sounds/"))).toBe(false);
  });

  it("refuses a Sammlung with nothing in it", () => {
    expect(() => buildAppPackage(input({ layout: { sets: [] } })))
      .toThrow(/nothing in this Sammlung/i);
  });
});

/* ------------------------------------------------- a tablet Sammlung --- */

const page = (over: Partial<AppPage> = {}): AppPage => ({
  id: "p-start", name: "Start", buttons: [], ...over,
});

const key = (over: Partial<AppButton> = {}): AppButton => ({
  id: "k", row: 0, col: 0, label: "", vocalization: "", symbol: "",
  wordClass: "", act: { kind: "append" }, ...over,
});

const tablet = (): AppLayout => ({
  target: "app",
  language: "de",
  voice: "piper:de_DE-thorsten-medium",
  grid: { rows: 2, columns: 3 },
  home: "p-start",
  pages: [
    page({
      buttons: [
        key({ id: "k1", row: 0, col: 0, label: "ich", wordClass: "pronoun" }),
        // Shows one word, says another - §7.3's case, and the reason the
        // sounds map is keyed by what is spoken rather than by the label.
        key({ id: "k2", row: 0, col: 1, label: "Apfel",
              vocalization: "einen Apfel", wordClass: "noun",
              symbol: "arasaac-2462.png" }),
        key({ id: "k3", row: 0, col: 2, label: "Essen", wordClass: "category",
              act: { kind: "goto", page: "p-food" } }),
        key({ id: "k4", row: 1, col: 0, label: "Aua", wordClass: "social",
              act: { kind: "speak" } }),
        key({ id: "k5", row: 1, col: 1, label: "Sprich", act: { kind: "sayBar" } }),
        key({ id: "k6", row: 1, col: 2, label: "Start", act: { kind: "home" } }),
      ],
    }),
    page({
      id: "p-food", name: "Essen",
      buttons: [key({ id: "f1", row: 1, col: 2, label: "Mehr" })],
    }),
  ],
});

const tabletInput = (over: Partial<PackageInput> = {}): PackageInput => ({
  collection: collection(),
  layout: tablet(),
  images: new Map([["arasaac-2462.png", baked("aaaa1111")]]),
  sounds: new Map([
    ["ich", { key: "1111aaaa", bytes: ogg(), seconds: 0.4 }],
    ["einen Apfel", { key: "2222bbbb", bytes: ogg(), seconds: 0.9 }],
    ["Aua", { key: "3333cccc", bytes: ogg(), seconds: 0.5 }],
    ["Mehr", { key: "4444dddd", bytes: ogg(), seconds: 0.4 }],
    // Nothing will ask for these: a navigation button and the bar controls
    // never speak their own text. Here so that the assertion below is about
    // the builder declining to use them rather than about them being absent.
    ["Essen", { key: "5555eeee", bytes: ogg(), seconds: 0.6 }],
    ["Sprich", { key: "6666ffff", bytes: ogg(), seconds: 0.6 }],
  ]),
  voice: "piper:de_DE-thorsten-medium",
  ...over,
});

describe("a tablet Sammlung as a board package", () => {
  it("writes one board per page, at the Sammlung's own grid", () => {
    const pkg = buildAppPackage(tabletInput());
    expect(checkPackage(pkg)).toEqual([]);
    expect(pkg.boards.map((one) => one.name)).toEqual(["Start", "Essen"]);
    // §7.1: exactly `rows` rows of exactly `columns` cells, on every board,
    // including the one holding a single button - a mismatch there is a
    // package-level fault and the viewer rejects the whole thing.
    for (const one of pkg.boards) {
      expect(one.grid.rows).toBe(2);
      expect(one.grid.columns).toBe(3);
      expect(one.grid.order).toHaveLength(2);
      for (const row of one.grid.order) expect(row).toHaveLength(3);
    }
    // The grid is the Sammlung's, not the page's: a button in the same cell of
    // two pages is under the same thumb, which is the whole reason position is
    // learnable across pages.
    expect(board(pkg, "board-2").grid.order[1]![2]).toBe("board-2-r2c3");
    expect(board(pkg, "board-2").grid.order[0]).toEqual([null, null, null]);
  });

  it("puts every button in the cell it was authored in", () => {
    const pkg = buildAppPackage(tabletInput());
    expect(board(pkg, "board-1").grid.order).toEqual([
      ["board-1-r1c1", "board-1-r1c2", "board-1-r1c3"],
      ["board-1-r2c1", "board-1-r2c2", "board-1-r2c3"],
    ]);
  });

  it("maps each act to the one thing §7.3 makes it", () => {
    const pkg = buildAppPackage(tabletInput());
    const at = (id: string) => button(pkg, "board-1", id);

    // Appending is the default and the common case: no action, no flag, and
    // nothing said about it at all.
    expect(at("board-1-r1c1").action).toBeUndefined();
    expect(at("board-1-r1c1").ext_lautstark_speak_immediately).toBeUndefined();
    expect(at("board-1-r1c1").load_board).toBeUndefined();

    // Navigation resolves to the *board* id, not the page's UUID.
    expect(at("board-1-r1c3").load_board)
      .toEqual({ id: "board-2", name: "Essen", path: "boards/board-2.obf" });
    expect(at("board-1-r1c3").action).toBeUndefined();

    expect(at("board-1-r2c1").ext_lautstark_speak_immediately).toBe(true);
    expect(at("board-1-r2c2").action).toBe(":speak");
    expect(at("board-1-r2c3").action).toBe(":home");
  });

  it("writes the vocalization, so the bar reads as the sentence it will say", () => {
    const pkg = buildAppPackage(tabletInput());
    const apple = button(pkg, "board-1", "board-1-r1c2");
    // §7.3: the bar shows the vocalization and falls back to the label, so a
    // button whose label is one word and whose vocalization is a phrase puts
    // the phrase in the bar. Fixture `message-bar` is the authority.
    expect(apple.label).toBe("Apfel");
    expect(apple.vocalization).toBe("einen Apfel");
  });

  it("colours a button by its word class, from the Fitzgerald key", () => {
    const pkg = buildAppPackage(tabletInput());
    // The layout stores the class; this is where it becomes a colour. Values
    // are AsTeRICS Grid's light ramp - see WORD_CLASSES in boot_data.ts.
    expect(button(pkg, "board-1", "board-1-r1c1").background_color)
      .toBe("rgb(253, 253, 150)");          // Pronomen, gelb
    expect(button(pkg, "board-1", "board-1-r1c2").background_color)
      .toBe("rgb(255, 218, 137)");          // Nomen, orange
    // A button carrying no class says nothing, so the viewer's own default
    // stands - which is a better answer than a colour meaning a word class
    // nobody chose.
    expect(button(pkg, "board-1", "board-1-r2c2").background_color).toBeUndefined();
    // Nothing wears a border while the Sammlung wears fills. The two fields
    // are alternatives, not a pair - a button carrying both would say the same
    // thing twice and leave a viewer to pick.
    expect(button(pkg, "board-1", "board-1-r1c1").border_color).toBeUndefined();
  });

  it("wears the same colour as a border when the Sammlung asks for one", () => {
    const pkg = buildAppPackage(tabletInput({
      layout: { ...tablet(), wordColor: "border" },
    }));
    // The same hexes, in the other OBF field. Both are the format's own, which
    // is what makes this an ordinary package rather than an extension - and
    // the drawing is baked in, so a viewer that has never heard of the
    // preference still draws the board the way it was built.
    expect(button(pkg, "board-1", "board-1-r1c1").border_color)
      .toBe("rgb(253, 253, 150)");          // Pronomen, gelb
    expect(button(pkg, "board-1", "board-1-r1c2").border_color)
      .toBe("rgb(255, 218, 137)");          // Nomen, orange
    expect(button(pkg, "board-1", "board-1-r1c1").background_color).toBeUndefined();
    // A button with no class still says nothing, whichever field is in use.
    expect(button(pkg, "board-1", "board-1-r2c2").border_color).toBeUndefined();
  });

  it("writes no word-class colour at all when the Sammlung wears none", () => {
    const pkg = buildAppPackage(tabletInput({
      layout: { ...tablet(), wordColor: "off" },
    }));
    // "Off" is not colourless: the page keeps whatever colour it has, and what
    // goes is the colour that means *what a word is* rather than *where you
    // are*. Here that is both fields left unwritten on every button.
    for (const one of pkg.boards) {
      for (const button of one.buttons) {
        expect(button.background_color).toBeUndefined();
        expect(button.border_color).toBeUndefined();
      }
    }
  });

  it("colours by word class when the Sammlung predates the choice", () => {
    // Every layout stored before AppLayout.wordColor existed has no field at
    // all, and there is no migration: absent counts as a fill, so an old
    // Sammlung exports exactly the package it exported yesterday.
    const before = tablet();
    expect("wordColor" in before).toBe(false);
    const pkg = buildAppPackage(tabletInput({ layout: before }));
    expect(button(pkg, "board-1", "board-1-r1c1").background_color)
      .toBe("rgb(253, 253, 150)");
  });

  it("gives a page no colour of its own", () => {
    const pkg = buildAppPackage(tabletInput());
    // §4.2's ext_lautstark_board_color is optional and stays defined in the
    // format; a page has nothing to put in it while colouring a *page* is
    // being reconsidered. A button's colour is untouched - that one is the
    // Fitzgerald key and means a word class, which is a different job.
    for (const one of pkg.boards) {
      expect(one.ext_lautstark_board_color).toBeUndefined();
    }
    // And the talker's boards still carry one, from the set. Asserted here so
    // that removing it from the other half is a deliberate act rather than
    // something this change quietly did to both.
    const talker = buildAppPackage(input());
    expect(board(talker, "set-1").ext_lautstark_board_color).toBe("#3b5bdb");
  });

  it("carries a clip only where pressing the button speaks its own text", () => {
    const pkg = buildAppPackage(tabletInput());
    const at = (id: string) => button(pkg, "board-1", id);
    // The viewer utters on Append and on SpeakImmediately, and on nothing
    // else: navigation is silent, and `:speak` always synthesises the composed
    // sentence because the bar has no clip of its own. A clip on those would
    // be an archive member nothing can play, on a board that may have four
    // hundred buttons.
    expect(at("board-1-r1c1").sound_id).toBe("snd-1111aaaa");
    expect(at("board-1-r2c1").sound_id).toBe("snd-3333cccc");
    expect(at("board-1-r1c3").sound_id).toBeUndefined();   // goto
    expect(at("board-1-r2c2").sound_id).toBeUndefined();   // :speak
    expect(at("board-1-r2c3").sound_id).toBeUndefined();   // :home
    // And the archive holds only the four that are used, not the six offered.
    expect([...pkg.files.keys()].filter((one) => one.startsWith("sounds/")))
      .toHaveLength(4);
  });

  it("keys a recording by what is spoken, not by what is shown", () => {
    const pkg = buildAppPackage(tabletInput());
    // The bug this is against shipped the wrong clip on exactly the buttons
    // the vocalization field exists for.
    expect(button(pkg, "board-1", "board-1-r1c2").sound_id).toBe("snd-2222bbbb");
  });

  it("takes the root from the page the layout names, not the first one", () => {
    const layout = tablet();
    layout.home = "p-food";
    const pkg = buildAppPackage(tabletInput({ layout }));
    // §3's root and §7.4's `:home` are the same page. An index would mean that
    // reordering the strip silently changed what a child's tablet opens on.
    expect(pkg.manifest.root).toBe("boards/board-2.obf");
    expect(checkPackage(pkg)).toEqual([]);
  });

  it("leaves a cell empty rather than writing a button with nothing on it", () => {
    const layout = tablet();
    layout.pages[0]!.buttons.push(key({ id: "blank", row: 1, col: 1 }));
    layout.pages[0]!.buttons = [key({ id: "blank", row: 0, col: 0 })];
    const pkg = buildAppPackage(tabletInput({ layout }));
    // §7.2 would render an empty button as an empty cell anyway; leaving it
    // out says the same thing without asking the viewer to draw nothing.
    expect(board(pkg, "board-1").buttons).toEqual([]);
    expect(board(pkg, "board-1").grid.order[0]![0]).toBeNull();
  });

  it("keeps a bare control button even with nothing written on it", () => {
    const layout = tablet();
    layout.pages[0]!.buttons = [
      key({ id: "bs", row: 0, col: 0, act: { kind: "backspace" } })];
    const pkg = buildAppPackage(tabletInput({ layout }));
    // The exception to the rule above, and it is a real board: a backspace
    // drawn as a symbol somebody has not chosen yet is still a button that
    // does something, unlike an empty appending one.
    expect(board(pkg, "board-1").buttons).toHaveLength(1);
    expect(board(pkg, "board-1").buttons[0]!.action).toBe(":backspace");
  });

  it("drops a goto whose page is gone rather than dangling", () => {
    const layout = tablet();
    layout.pages = [layout.pages[0]!];
    const pkg = buildAppPackage(tabletInput({ layout }));
    const gone = button(pkg, "board-1", "board-1-r1c3");
    // Not a case the editor can produce - deletePage() turns such a button
    // back into an appending one - and the export refuses to write it anyway,
    // because a load_board pointing nowhere is a button that looks live on a
    // tablet and ignores whoever presses it (§7.4).
    expect(gone.load_board).toBeUndefined();
    expect(gone.label).toBe("Essen");
    expect(checkPackage(pkg)).toEqual([]);
  });

  it("refuses a Sammlung with no pages, the way it refuses one with no sets", () => {
    const layout = tablet();
    layout.pages = [];
    expect(() => buildAppPackage(tabletInput({ layout })))
      .toThrow(/nothing in this Sammlung/);
  });

  it("asks for the gap after the first column only where the layout does", () => {
    // §4.1's hint, and it is written only when it is true: the field defaults
    // to false, and a manifest saying so in as many words would be a package
    // asserting the absence of something it never had.
    const plain = buildAppPackage(tabletInput());
    expect("ext_lautstark_first_column_gap" in plain.manifest).toBe(false);

    const layout = tablet();
    layout.firstColumnGap = true;
    const pkg = buildAppPackage(tabletInput({ layout }));
    expect(pkg.manifest.ext_lautstark_first_column_gap).toBe(true);
    expect(checkPackage(pkg)).toEqual([]);
  });

  it("changes nothing but the manifest when the gap is asked for", () => {
    // The hint is about drawing and nothing else. An importer that has never
    // heard of it produces the same boards, the same grid and the same ids -
    // which is what makes this a minor version rather than a major one (§12).
    const layout = tablet();
    layout.firstColumnGap = true;
    const withGap = buildAppPackage(tabletInput({ layout }));
    const without = buildAppPackage(tabletInput());
    expect(withGap.boards).toEqual(without.boards);
    expect([...withGap.files.keys()]).toEqual([...without.files.keys()]);
  });

  it("never asks for it on a talker Sammlung", () => {
    // The device's first column is the set key and the speaker's empty corner,
    // which is not a column of anything to set apart.
    expect("ext_lautstark_first_column_gap" in buildAppPackage(input()).manifest)
      .toBe(false);
  });

  it("finds a mixed symbol source across pages", () => {
    const layout = tablet();
    layout.pages[1]!.buttons[0]!.symbol = "metacom:essen.png";
    // §5.1 is one source per package, and the walker has to reach every place
    // a symbol can sit - a new one that a walker never learned about is how
    // that rule gets broken quietly.
    expect(() => symbolSource(layout)).toThrow(/two symbol collections/);
  });

  it("reads one source correctly out of a tablet layout", () => {
    const layout = tablet();
    expect(symbolSource(layout)).toBe("arasaac");
    layout.pages[0]!.buttons[1]!.symbol = "metacom:apfel.png";
    expect(symbolSource(layout)).toBe("metacom");
  });
});

describe("the language a package says it is in", () => {
  /* §7.1's locale is the fallback that picks a voice when the tts hint is
   * unavailable - which on Android is nearly always, since the hint names a
   * piper model or an Azure voice. So this field is what decides how a package
   * sounds, and taking it from the builder's own UI language was wrong: a
   * German board built in an English browser went out saying "en", and the
   * tablet reads German sentences in an English voice. Found by exporting a
   * package and opening it in the viewer. */
  it("takes it from the chosen voice, whichever backend named it", () => {
    expect(localeFor("azure:de-DE-KatjaNeural", "en")).toBe("de-DE");
    expect(localeFor("piper:de_DE-thorsten-medium", "en")).toBe("de-DE");
    expect(localeFor("piper:en_GB-alba-medium", "de")).toBe("en-GB");
  });

  it("falls back to the page's language when no voice is chosen", () => {
    expect(localeFor("", "de")).toBe("de");
    expect(localeFor("", "en")).toBe("en");
    // A language this page does not have is not a locale to write down.
    expect(localeFor("", "kl")).toBe("en");
    expect(localeFor("", undefined)).toBe("en");
  });

  it("puts it on every board", () => {
    const pkg = buildAppPackage(input());
    expect(pkg.boards.map((one) => one.locale)).toEqual(["de-DE", "de-DE"]);
  });
});

describe("one symbol collection per package", () => {
  const withSymbols = (...refs: string[]): Layout => ({
    sets: [{
      name: "Set", symbol: "", color: "#3B5BDB",
      slots: refs.map((symbol) => ({ text: "x", symbol })),
    }],
  });

  it("reads the source off what the keys actually reference", () => {
    expect(symbolSource(withSymbols("arasaac-2462.png", "arasaac-99.png"))).toBe("arasaac");
    expect(symbolSource(withSymbols("metacom:ja", "metacom:nein"))).toBe("metacom");
    expect(symbolSource(withSymbols("", ""))).toBe("none");
  });

  it("refuses a mixed Sammlung rather than picking a winner", () => {
    // §5.1 leaves enforcement to the builder because an importer has no symbol
    // library to check against. In this project a mixed Sammlung has only ever
    // been a bug - the picker offers one source at a time.
    expect(() => symbolSource(withSymbols("arasaac-2462.png", "metacom:ja")))
      .toThrow(/two symbol collections/i);
  });

  it("counts an uploaded picture towards neither", () => {
    // A photograph somebody took is not a symbol collection, and calling a
    // package ARASAAC's because it holds one would be a licence claim about a
    // file ARASAAC never saw. It also must not make a METACOM board mixed: a
    // photo of a grandmother among METACOM symbols is an ordinary board.
    expect(symbolSource(withSymbols("oma.png", "hund.jpg"))).toBe("none");
    expect(symbolSource(withSymbols("metacom:ja", "oma.png"))).toBe("metacom");
    expect(symbolSource(withSymbols("arasaac-2462.png", "oma.png"))).toBe("arasaac");
  });
});

describe("what the checker refuses", () => {
  /** A package built and then broken on purpose. */
  const broken = (damage: (pkg: AppPackage) => void): string[] => {
    const pkg = buildAppPackage(input());
    damage(pkg);
    return checkPackage(pkg);
  };

  it("passes a package it built itself", () => {
    expect(checkPackage(buildAppPackage(input()))).toEqual([]);
  });

  it("catches a grid that disagrees with its own shape", () => {
    // §7.1 makes this a package-level fault on import: a viewer guessing at a
    // grid puts buttons somewhere other than where the builder put them, which
    // for somebody navigating by position is worse than no board at all.
    expect(broken((pkg) => { board(pkg, "set-1").grid.rows = 3; }))
      .toEqual([expect.stringContaining("[grid-shape]")]);
    // A row too long is both: the shape disagrees, and the cell it added
    // names nothing. Both are worth saying - a package with one of them is a
    // different mistake from a package with the other.
    expect(broken((pkg) => { board(pkg, "set-1").grid.order[0]!.push("x"); }))
      .toEqual([expect.stringContaining("[grid-shape]"),
                expect.stringContaining("[grid-ids]")]);
  });

  it("catches a cell naming a button that is not there", () => {
    expect(broken((pkg) => { board(pkg, "set-1").grid.order[0]![1] = "set-1-key-9"; }))
      .toEqual([expect.stringContaining("[grid-ids]"),
                expect.stringContaining("[button-unplaced]")]);
  });

  it("catches a button no cell holds", () => {
    expect(broken((pkg) => {
      board(pkg, "set-1").buttons.push({ id: "set-1-key-7", label: "nowhere" });
    })).toEqual([expect.stringContaining("[button-unplaced]")]);
  });

  it("catches a picture or a recording that is not in the archive", () => {
    expect(broken((pkg) => { pkg.files.delete("images/aaaa1111.png"); }))
      .toEqual(expect.arrayContaining([expect.stringContaining("[image-unresolved]")]));
    expect(broken((pkg) => { pkg.files.delete("sounds/cccc3333.opus"); }))
      .toEqual(expect.arrayContaining([expect.stringContaining("[sound-unresolved]")]));
  });

  it("catches a link to a board that does not exist", () => {
    expect(broken((pkg) => { button(pkg, "set-1", "set-1-set").load_board!.id = "set-9"; }))
      .toEqual([expect.stringContaining("[load-board]")]);
  });

  it("catches a root that resolves to nothing", () => {
    expect(broken((pkg) => { pkg.manifest.root = "boards/nowhere.obf"; }))
      .toEqual([expect.stringContaining("[root-unresolved]")]);
  });

  it("catches an image over the size cap", () => {
    // §5.3: the cap is about decoded bitmap memory on a phone, so it is read
    // off the pixels and never off what the document declares.
    expect(broken((pkg) => { pkg.files.set("images/aaaa1111.png", png(2048, 2048)); }))
      .toEqual([expect.stringContaining("[image-oversized]")]);
  });

  it("catches a clip over the length cap", () => {
    expect(broken((pkg) => { board(pkg, "set-1").sounds[0]!.duration = 31; }))
      .toEqual([expect.stringContaining("[sound-too-long]")]);
  });

  it("catches a member name that escapes the archive", () => {
    // §2's zip-slip case, which on Android writes outside the app's storage.
    expect(broken((pkg) => { pkg.files.set("../escape.png", png(8, 8)); }))
      .toEqual(expect.arrayContaining([expect.stringContaining("[path-unsafe]")]));
  });

  it("catches the licence pair that must never be written", () => {
    expect(broken((pkg) => {
      pkg.manifest.ext_lautstark_symbol_source = "metacom";
      pkg.manifest.ext_lautstark_redistributable = true;
    })).toEqual([expect.stringContaining("[licence-inconsistent]")]);
  });

  it("catches a gap asked for on a board with nothing to separate", () => {
    // §4.1 leaves this to a builder: an importer must not fail over a hint, so
    // the only side that can still tell somebody is this one. A gap after the
    // first column of a one-column board is a gap after the only column.
    const layout = tablet();
    layout.firstColumnGap = true;
    layout.grid = { rows: 2, columns: 1 };
    const pkg = buildAppPackage(tabletInput({ layout }));
    expect(checkPackage(pkg))
      .toEqual(expect.arrayContaining([expect.stringContaining("[first-column-gap]")]));
  });

  it("catches a gap hint that is not a boolean", () => {
    expect(broken((pkg) => {
      (pkg.manifest as Record<string, unknown>).ext_lautstark_first_column_gap = "yes";
    })).toEqual([expect.stringContaining("[manifest]")]);
  });

  it("catches an image entry that is a reference rather than pixels", () => {
    // §5: the viewer resolves nothing - no url, no data_url, no symbol set.
    expect(broken((pkg) => {
      (board(pkg, "set-1").images[0] as Record<string, unknown>).url =
        "https://api.arasaac.org/api/pictograms/2462";
    })).toEqual([expect.stringContaining("[image-reference]")]);
  });

  it("refuses to write a package that does not pass", async () => {
    const pkg = buildAppPackage(input());
    pkg.manifest.root = "boards/nowhere.obf";
    await expect(packageBytes(pkg)).rejects.toThrow(/root-unresolved/);
  });
});

describe("the archive the builder writes", () => {
  it("is a zip that reads back as the package it was", async () => {
    const pkg = buildAppPackage(input());
    const back = readPackage(await packageBytes(pkg));

    expect(back.manifest).toEqual(pkg.manifest);
    expect(back.boards.map((one) => one.id).sort()).toEqual(["set-1", "set-2"]);
    expect([...back.files.keys()].sort()).toEqual([...pkg.files.keys()].sort());
    // And it passes the same checks on the way back in as it did on the way
    // out, which is the round trip this whole file is for.
    expect(checkPackage(back)).toEqual([]);
  });

  it("says its names are UTF-8, and normalises them", async () => {
    const entries = unzip(await packageBytes(buildAppPackage(input())));
    for (const entry of entries.values()) {
      // §2: bit 11, so an importer is told rather than left to guess between
      // UTF-8 and CP437.
      expect(entry.flags & 0x0800).toBe(0x0800);
      expect(entry.name).toBe(entry.name.normalize("NFC"));
    }
    expect([...entries.keys()][0]).toBe("manifest.json");
  });

  it("is the same file twice for an unchanged Sammlung", async () => {
    // No clock anywhere in it: not in the zip's per-member timestamps, not in
    // the manifest. Two exports of a Sammlung nobody touched are one file.
    const once = await packageBytes(buildAppPackage(input()));
    const twice = await packageBytes(buildAppPackage(input()));
    expect(Buffer.from(twice)).toEqual(Buffer.from(once));
  });

  it("stores what is already compressed and deflates what is not", async () => {
    const entries = unzip(await packageBytes(buildAppPackage(input())));
    expect(entries.get("manifest.json")!.method).toBe(8);
    expect(entries.get("images/aaaa1111.png")!.method).toBe(0);
    expect(entries.get("sounds/cccc3333.opus")!.method).toBe(0);
  });
});

describe("the checker against the conformance fixtures", () => {
  /* exchange/fixtures holds packages written by make_fixtures.mjs, which
   * enforces its own coherence rules before it is allowed to write one. These
   * are the fixtures a conformant importer accepts with no warnings at all -
   * which is exactly the set a builder could have produced - so checkPackage()
   * must find nothing wrong with any of them.
   *
   * When this fails, one of two things is true and they are worth telling
   * apart: either a rule here is stricter than the specification, or a fixture
   * has moved. SPEC.md §13 settles it - the fixture is normative.
   */
  const index = JSON.parse(readFileSync(join(FIXTURES, "index.json"), "utf8")) as {
    fixtures: { fixture: string; file: string; expected: string }[];
  };
  const clean = index.fixtures.filter(({ expected }) => {
    const what = JSON.parse(readFileSync(join(FIXTURES, expected), "utf8"));
    return what.outcome === "accepted" && (what.warnings ?? []).length === 0;
  });

  it("has fixtures to check against", () => {
    expect(clean.length).toBeGreaterThan(3);
  });

  for (const one of clean) {
    it(`agrees with ${one.fixture}`, () => {
      expect(checkPackage(readPackageFile(join(FIXTURES, one.file)))).toEqual([]);
    });
  }
});
