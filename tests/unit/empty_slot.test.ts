import { describe, expect, it } from "vitest";
import { buildAppPackage, slotIsEmpty, type PackageInput }
  from "../../src/data/app_package.js";
import { blank, placeholder, TILE_SIZE, toRgb565Be } from "../../src/data/tiles.js";
import type { CollectionRef, DiyLayout } from "../../src/core/types.js";

/* A talker key with nothing on it, on both sides of the seam.
 *
 * The two halves used to answer this differently and nothing noticed, because
 * nothing here reads both: the build walks a Layout and writes tiles, the
 * export walks the same Layout and writes an .obz, and neither one has ever
 * read the other's output. So an untouched key was an empty cell on a tablet
 * and tiles.placeholder() on the device - the grey cross that means "no
 * picture yet", said about a key nobody had asked anything of. Found on
 * 2026-08-27 by comparing what runBuild() takes from a Layout against what
 * diyBoards() emits, which is a comparison no test performs.
 *
 * What binds them now is slotIsEmpty(), so the assertion worth having is not
 * that each half is right on its own. It is that the export's grid and the
 * predicate the build asks agree cell for cell, which is the statement that
 * goes false again if either side starts deciding for itself.
 *
 * The build's own half is not driven here: runBuild() wants a canvas, a store
 * and a synthesiser. What can be held is the pair of tiles it chooses between,
 * and that they are not the same picture.
 */

const collection = (): CollectionRef => ({
  id: "1f0a5c2e-0000-4000-8000-000000000002",
  name: "Zuhause",
  updatedAt: Date.UTC(2026, 7, 27, 9, 0, 0),
});

const slot = (text: string, symbol = "") => ({ text, symbol });

/** Every shape a key can be empty or not empty in, on one board. */
const layout = (): DiyLayout => ({
  language: "de",
  voice: "piper:de_DE-thorsten-medium",
  sleep_timeout_seconds: 600,
  sets: [
    {
      name: "Essen", symbol: "arasaac-31337.png",
      slots: [
        slot("Ich habe Hunger", "arasaac-2462.png"),  // both
        slot("Ich habe Durst"),                        // a word, no picture
        slot("", "arasaac-2462.png"),                  // a picture, no word
        slot(""),                                      // neither
      ],
    },
    {
      name: "Spielen", symbol: "",
      // Whitespace is not a word. The export trims and the build asks the
      // export, so this key is as empty as the one above it.
      slots: [slot("   "), slot(""), slot(""), slot("")],
    },
  ],
});

const input = (): PackageInput => ({
  collection: collection(),
  layout: layout(),
  images: new Map(),
  sounds: new Map(),
  voice: "piper:de_DE-thorsten-medium",
});

describe("what counts as an empty key", () => {
  it("is a key with no word and no picture, and nothing else", () => {
    expect(slotIsEmpty(slot(""))).toBe(true);
    expect(slotIsEmpty(slot("   "))).toBe(true);
    expect(slotIsEmpty(slot("Brot"))).toBe(false);
    expect(slotIsEmpty(slot("", "arasaac-2462.png"))).toBe(false);
    // Whitespace is not a word; a file name is not whitespace. A reference is
    // a key into a store, which either holds it or does not, and trimming one
    // would quietly rename it.
    expect(slotIsEmpty(slot("   ", "  "))).toBe(false);
  });

  it("survives a slot that is not there at all", () => {
    expect(slotIsEmpty(undefined)).toBe(true);
    expect(slotIsEmpty(null)).toBe(true);
    expect(slotIsEmpty({})).toBe(true);
  });
});

describe("the two halves agree", () => {
  it("leaves a grid cell empty exactly where the build draws a blank tile", () => {
    const made = layout();
    const pkg = buildAppPackage({ ...input(), layout: made });

    for (const [index, set] of made.sets.entries()) {
      const board = pkg.boards[index]!;
      // grid() puts the four keys at these cells and the set key at [1][0].
      const cells = [board.grid.order[0]![1], board.grid.order[0]![2],
                     board.grid.order[1]![1], board.grid.order[1]![2]];
      for (const [at, one] of set.slots.entries()) {
        // The whole assertion: no cell is null unless the predicate says so,
        // and none is filled where it does.
        expect(cells[at] === null).toBe(slotIsEmpty(one));
      }
    }
  });

  it("gives the second set four empty keys and one set key", () => {
    // Guards the fixture rather than the code: a board whose keys are all
    // filled would let the assertion above pass while proving nothing.
    const pkg = buildAppPackage(input());
    const board = pkg.boards[1]!;
    expect(board.grid.order.flat().filter(Boolean)).toEqual(["set-2-set"]);
    expect(board.buttons.map((one) => one.id)).toEqual(["set-2-set"]);
  });
});

describe("the tile a blank key gets", () => {
  it("is white, the whole panel", () => {
    const pixels = blank();
    expect(pixels.width).toBe(TILE_SIZE);
    expect(pixels.height).toBe(TILE_SIZE);
    expect(new Set(pixels.data)).toEqual(new Set([255]));
  });

  it("is not the missing-picture cross", () => {
    // The two say different things and must not be one file: an unresolved
    // reference still draws placeholder(), and a name is a hash of the bytes,
    // so identical pixels would silently make them one key on the device.
    expect(toRgb565Be(blank())).not.toEqual(toRgb565Be(placeholder()));
  });
});
