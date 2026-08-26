import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/editor-app/editor.js";
import { asksForHome, homeSymbol } from "../../src/shell/homekey.js";
import { setActiveSource } from "../../src/data/symbols.js";
import { buildAppPackage, type PackageInput } from "../../src/data/app_package.js";
import { isApp } from "../../src/core/types.js";
import type { AppLayout, CollectionRef } from "../../src/core/types.js";

/* What a new tablet Sammlung is handed, and what becomes of it on export.
 *
 * A blank() is the one piece of content in this product nobody chose. Every
 * other button on every other board was put there by somebody who can see it
 * and change it; these values arrive before anybody has looked, and they are
 * what a first board *is* for as long as it takes to notice they can be
 * changed. So they are asserted rather than left to whatever the constructor
 * happens to write, and the reason each one is here is on the value in
 * editor-app/editor.ts.
 *
 * The second half is the one that could fail quietly. A start key that is
 * right in the editor and wrong in the package is a key that works while
 * somebody is building the board and does nothing on the tablet it was built
 * for - which is a fault nobody sees until the board is on a table in front of
 * a child. §7.4's `:home` and §5.3's picture are the two things that have to
 * survive the trip, so a package is built from an actual blank() here rather
 * than from a hand-written layout that resembles one.
 */

const blank = (grid?: { rows: number; columns: number }): AppLayout => {
  const made = app.blank(grid);
  if (!isApp(made)) throw new Error("the tablet editor made something else");
  return made;
};

/** The single button a blank Sammlung comes with. */
const startKey = (layout: AppLayout) => {
  const column = layout.firstColumn ?? [];
  expect(column).toHaveLength(1);
  return column[0]!;
};

/* Which collection is in force is a fact about the browser, and blank() reads
 * it every time. Set explicitly rather than left at whatever a previous file
 * happened to leave it - the module holds one `let` for the whole run. */
beforeEach(() => { setActiveSource("arasaac"); });

describe("a new tablet Sammlung", () => {
  it("draws no colour by word class", () => {
    // Written rather than left to a fallback, and not the same decision as the
    // `?? "fill"` two readers make of a layout stored before the field
    // existed: that one is about a board keeping the look it was drawn with.
    expect(blank().wordColor).toBe("off");
  });

  it("owns its first column, and draws it set apart", () => {
    const made = blank();
    // An array rather than an absent field is the whole of what "shared"
    // means - see AppLayout.firstColumn.
    expect(Array.isArray(made.firstColumn)).toBe(true);
    expect(made.firstColumnGap).toBe(true);
  });

  it("stands a way back to the start page in the lower-left cell", () => {
    const key = startKey(blank());
    expect(key.col).toBe(0);
    // The bottom row of the grid the Sammlung was made at.
    expect(key.row).toBe(blank().grid.rows - 1);
    // `home`, not a `goto` at whichever page is home today: the two part
    // company the moment another page is made the start page, and on a button
    // that is on every page at once that is the whole difference.
    expect(key.act).toEqual({ kind: "home" });
    // Navigation is not a word, so there is no Fitzgerald class to be right
    // about, and a `home` press puts nothing in the bar to have said.
    expect(key.wordClass).toBe("");
    expect(key.vocalization).toBe("");
    expect(key.label).toBeTruthy();
  });

  it("puts the key on the bottom row of whatever size was asked for", () => {
    // The size comes from the dialog that made the Sammlung, so "the bottom
    // row" is not 2. A key placed outside the grid is dropped by the exporter
    // without a word - see appBoards() - so this is the assertion that stops
    // a larger board losing its way home silently.
    expect(startKey(blank({ rows: 6, columns: 11 })).row).toBe(5);
    expect(startKey(blank({ rows: 4, columns: 7 })).row).toBe(3);
  });

  it("takes the house from the collection this browser is drawn in", () => {
    // §5.1 allows one symbol source per package and app_package.ts refuses to
    // build a mixed one, so a prescribed picture out of a fixed collection
    // would break every Sammlung drawn in the other - on the first export, for
    // a key nobody chose.
    expect(startKey(blank()).symbol).toBe("arasaac-6964-sw.png");
    setActiveSource("metacom");
    expect(startKey(blank()).symbol).toBe("metacom:Haus/haus4SW");
  });

  it("takes the black-and-white variant from either collection", () => {
    // The key is drawn light-on-dark by mapping luminance onto two tones, and
    // that only holds on a greyscale source - a coloured pictogram put through
    // it comes out tinted. Each collection offers one its own way: ARASAAC
    // renders it on demand, which is what the `-sw` file is; METACOM ships it
    // as a separate file, which is what the `SW` suffix is. Neither suffix is
    // decoration and dropping either one leaves a picture that still renders.
    expect(homeSymbol("arasaac")).toMatch(/-sw\.png$/);
    expect(homeSymbol("metacom")).toMatch(/SW$/);
  });
});

describe("the picker's word for it", () => {
  it("answers to the words for the key, in both languages", () => {
    for (const word of ["home", "Haus", "start", " Startseite ", "HOUSE"]) {
      expect(asksForHome(word)).toBe(true);
    }
  });

  it("does not answer to words that merely start the same way", () => {
    // A closed list rather than a stem match: "started" and "haust" are other
    // words, and a tile offered for them would be the picker guessing.
    for (const word of ["started", "haust", "hausaufgabe", "", "hom"]) {
      expect(asksForHome(word)).toBe(false);
    }
  });
});

describe("a new tablet Sammlung, exported", () => {
  const collection = (): CollectionRef => ({
    id: "1f0a5c2e-0000-4000-8000-000000000009",
    name: "Neu",
    updatedAt: Date.UTC(2026, 7, 26, 9, 0, 0),
  });

  /* Enough of a PNG for the checker's header read - §5.3 asks an importer to
   * read the header before it allocates a bitmap, so the builder writes files
   * that have one. The bytes stand in for the house; what is asserted is that
   * the button ends up pointing at a picture at all. */
  function png(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(new ArrayBuffer(33));
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    bytes.set(new TextEncoder().encode("IHDR"), 12);
    view.setUint32(16, 512);
    view.setUint32(20, 512);
    return bytes;
  }

  const built = () => {
    const layout = blank();
    const input: PackageInput = {
      collection: collection(),
      layout,
      // Keyed the way the bake loop keys them - pictureKey(reference, negated)
      // - so the one picture in this Sammlung is found where the builder looks.
      images: new Map([[startKey(layout).symbol,
                        { key: "aaaa1111", bytes: png(), width: 512, height: 512 }]]),
      sounds: new Map(),
      voice: "",
    };
    return { layout, pkg: buildAppPackage(input) };
  };

  it("writes the start key as :home, with its picture", () => {
    const { layout, pkg } = built();
    const board = pkg.boards[0]!;
    // The lower-left cell of the one board there is.
    const at = `${board.id}-r${layout.grid.rows}c1`;
    const key = board.buttons.find((one) => one.id === at)!;
    expect(key).toBeDefined();
    // §7.4's action, which is what the viewer reads as "go to manifest.root".
    expect(key.action).toBe(":home");
    expect(key.image_id).toBeTruthy();
    // No modifier: the key navigates and says nothing on the way, which is
    // what the dialog that describes it says it does.
    expect(key.ext_lautstark_append_on_navigate).toBeUndefined();
  });

  it("colours no button, because the Sammlung colours by nothing", () => {
    // "off" writes neither field. Not the same as a button with no class -
    // it reaches the same place, which is the viewer's own default - but this
    // is the assertion that a fresh package carries no Fitzgerald colour at
    // all, on any button, on any board.
    const { pkg } = built();
    for (const board of pkg.boards) {
      for (const key of board.buttons) {
        expect(key.background_color).toBeUndefined();
        expect(key.border_color).toBeUndefined();
      }
    }
  });

  it("asks the viewer for the gap under the first column", () => {
    // §4.1's hint, written only where it is asked for - so its presence here
    // is the whole of what makes the tablet draw the column the editor drew.
    expect(built().pkg.manifest.ext_lautstark_first_column_gap).toBe(true);
  });
});
