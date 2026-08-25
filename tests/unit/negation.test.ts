import { describe, expect, it } from "vitest";
import { placeholder, renderSymbol, rgbTo565, TILE_SIZE } from "../../src/data/tiles.js";
import { documentToLayout, layoutToDocument, normalizeLayout } from "../../src/data/obf.js";
import { pictureKey, symbolPlaces } from "../../src/data/app_package.js";
import type { AppLayout, DiyLayout } from "../../src/core/types.js";

/* Crossing a picture out, on every side of the seam that has to agree about it.
 *
 * German AAC negates by drawing a cross over the symbol rather than by using a
 * picture of its own - see Slot.negated. A collection holds one drawing of
 * bread; the board says whether this key means bread or not-bread. So the same
 * reference has to be able to produce two different pictures, and everything
 * that files a picture under its reference has to know that.
 *
 * That is the whole risk in this feature and it is what this file is about. A
 * cross that draws in the wrong place is a bug somebody sees. A cross that
 * makes two keys share one baked file is a board that says the opposite of
 * what it was built to say, on a device, silently.
 */

/* --------------------------------------------------------------- pixels --- */

/** RGB565 big-endian back to the value, so a tile can be asked about colours. */
const values = (bytes: Uint8Array): Set<number> => {
  const seen = new Set<number>();
  for (let at = 0; at < bytes.length; at += 2) seen.add((bytes[at]! << 8) | bytes[at + 1]!);
  return seen;
};

/** design's --danger, light, as the panel would show it. tiles.ts writes the
 *  same three numbers; this is the colour arriving at the other end. */
const RED = rgbTo565(173, 51, 44);

describe("the tile the device gets", () => {
  /* renderSymbol(null) is the one path through it that needs no canvas: a
   * reference that resolves to nothing draws the placeholder. It is also a
   * real key rather than a contrivance - a METACOM board opened in a browser
   * that has not been given the folder back is every key on it. */

  it("draws no cross unless it is asked to", () => {
    // The frozen tiles are the other half of this - tests/test_tile_render_js.py
    // holds every fixture byte for byte - but they were frozen before this
    // option existed and would pass by never exercising it. This says the
    // default is still the tile they were frozen from.
    expect([...renderSymbol(null)]).toEqual([...renderSymbol(null, { negated: false })]);
    expect(values(renderSymbol(null)).has(RED)).toBe(false);
  });

  it("bakes the cross into the pixels when it is", () => {
    const crossed = renderSymbol(null, { negated: true });
    // Baked, not flagged: the firmware is never told about negation and never
    // will be. What reaches it is a tile that is already crossed out.
    expect(values(crossed).has(RED)).toBe(true);
    expect(crossed.length).toBe(TILE_SIZE * TILE_SIZE * 2);
  });

  it("makes a different file of it, which is what keeps two keys apart", () => {
    // The tile's name is a hash of these bytes - see storeTile() in
    // backend/local.ts. Equal bytes would mean one file for "Brot" and "kein
    // Brot", and whichever was drawn first would end up on both.
    expect([...renderSymbol(null, { negated: true })])
      .not.toEqual([...renderSymbol(null)]);
  });

  it("draws the same bytes every time, so a rebuild changes nothing", () => {
    // A tile that differed run to run would rename itself on every build and
    // the device would re-fetch the whole board for nothing.
    expect([...renderSymbol(null, { negated: true })])
      .toEqual([...renderSymbol(null, { negated: true })]);
  });

  it("leaves the placeholder itself alone", () => {
    // placeholder() is frozen too, and the cross is drawn over what it
    // returns rather than into it.
    expect(values(new Uint8Array(placeholder().data.buffer.slice(0))).size)
      .toBeGreaterThan(0);
    expect(values(renderSymbol(null)).has(RED)).toBe(false);
  });
});

/* ------------------------------------------------------------- the keys --- */

const talker = (slots: { text: string; symbol: string; negated?: boolean }[]): DiyLayout =>
  normalizeLayout({
    sleep_timeout_seconds: 600,
    language: "de",
    sets: [{ name: "Set", color: "#3B5BDB", symbol: "set.png", slots }],
  }) as DiyLayout;

const tablet = (buttons: { symbol: string; negated?: boolean }[]): AppLayout => ({
  target: "app",
  grid: { rows: 1, columns: buttons.length },
  home: "p-start",
  pages: [{
    id: "p-start", name: "Start",
    buttons: buttons.map((one, at) => ({
      id: `k${at}`, row: 0, col: at, label: `k${at}`, vocalization: "",
      symbol: one.symbol, wordClass: "", act: { kind: "append" } as const,
      ...(one.negated ? { negated: true } : {}),
    })),
  }],
});

describe("the picture a place wants", () => {
  it("is two pictures for one reference, on either kind of Sammlung", () => {
    // The bake loop in backend/local.ts fetches one source per key here and
    // bakes each one once. Keyed by the reference alone it baked one.
    const keys = (places: { reference: string; negated: boolean }[]) =>
      places.filter((one) => one.reference)
        .map((one) => pictureKey(one.reference, one.negated));

    expect(new Set(keys(symbolPlaces(tablet([
      { symbol: "brot.png" }, { symbol: "brot.png", negated: true },
    ]))))).toEqual(new Set(["brot.png", "!brot.png"]));

    expect(new Set(keys(symbolPlaces(talker([
      { text: "Brot", symbol: "brot.png" },
      { text: "kein Brot", symbol: "brot.png", negated: true },
    ]))))).toEqual(new Set(["set.png", "brot.png", "!brot.png"]));
  });

  it("is one picture when nothing is crossed out", () => {
    // The other side of it: two keys showing the same picture are still one
    // file in the archive and one decode on the phone.
    const places = symbolPlaces(tablet([{ symbol: "brot.png" }, { symbol: "brot.png" }]));
    expect(new Set(places.map((one) => pictureKey(one.reference, one.negated))))
      .toEqual(new Set(["brot.png"]));
  });

  it("says a set key is not crossed out, because there is nothing on it to be", () => {
    // A set key is navigation rather than a word - there is no field on
    // BoardSet and the picture column offers no control for one.
    const places = symbolPlaces(talker([{ text: "Ja", symbol: "ja.png", negated: true }]));
    const setKey = places.find((one) => one.where.includes("set key"));
    expect(setKey?.negated).toBe(false);
  });
});

/* ------------------------------------------------------- the round trip --- */

describe("a board that leaves as a document", () => {
  it("comes back still crossed out", async () => {
    const before = talker([{ text: "kein Brot", symbol: "brot.png", negated: true }]);
    const after = documentToLayout(await layoutToDocument(before));
    expect(after.sets[0]!.slots[0]!.negated).toBe(true);
  });

  it("says so in this repository's own namespace, not the package format's", async () => {
    /* ext_vorlaut_, which is obf.ts's, and deliberately not ext_lautstark_:
     * that list belongs to exchange/SPEC.md, is closed at v1 §4.3, and is read
     * by software that is not this repository. A round trip alone cannot catch
     * a field written under the wrong name - both ends would agree on it - so
     * the name is asserted here rather than left to close over itself. */
    const document = await layoutToDocument(
      talker([{ text: "kein Brot", symbol: "brot.png", negated: true }]));
    const keys = Object.values(document.boards)
      .flatMap((board: { buttons: Record<string, unknown>[] }) => board.buttons)
      .flatMap((button) => Object.keys(button));
    expect(keys).toContain("ext_vorlaut_negated");
    expect(keys.filter((key) => key.startsWith("ext_lautstark_"))).toEqual([]);
  });

  it("writes nothing at all for a key that is not", async () => {
    // Which is what keeps every board frozen in tests/reference/obf.lock.json
    // the document it was: those boards have no crossed-out key, so this field
    // never appears in one and the lock did not have to move.
    const document = await layoutToDocument(talker([{ text: "Brot", symbol: "brot.png" }]));
    for (const board of Object.values(document.boards) as { buttons: object[] }[]) {
      for (const button of board.buttons) {
        expect(Object.hasOwn(button, "ext_vorlaut_negated")).toBe(false);
      }
    }
  });

  it("does not invent one for a board written by other software", async () => {
    // No such field, and no cross. An importer that read a missing field as
    // anything but "no" would cross out every key of every board that ever
    // came from somewhere else.
    const plain = documentToLayout(await layoutToDocument(
      talker([{ text: "Brot", symbol: "brot.png" }])));
    expect(Object.hasOwn(plain.sets[0]!.slots[0]!, "negated")).toBe(false);
  });
});
