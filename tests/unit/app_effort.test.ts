import { describe, expect, it } from "vitest";
import { cellEffort, effortByPage, pageEffort } from "../../src/editor-app/effort.js";
import { blankButton, blankPage } from "../../src/editor-app/pages.js";
import type { AppLayout, AppPage } from "../../src/core/types.js";

/* OpenAAC's effort algorithm, against OpenAAC's own printed numbers.
 *
 * This file is unusual for this repository in that it has a real oracle. The
 * document that defines the algorithm also prints, for a full 2x2, the effort
 * of each of the four cells, and the average for four grid sizes. Anything
 * that reproduces those has implemented the same arithmetic; anything that
 * does not has implemented something else, however plausible it looks.
 *
 * That matters more here than the usual "does it run", because every number
 * this produces is shown to somebody as a fact about their board. A weight
 * copied wrong, a row and a column swapped, a distance measured from the wrong
 * corner - none of those throws, none of those looks odd on screen, and all of
 * them would quietly rank one page against another the wrong way round.
 *
 * The tolerance is 0.005 because the document prints two decimals.
 */

const page = (name: string, cells: Array<[number, number]>): AppPage => {
  const one = blankPage(name);
  one.buttons = cells.map(([row, col]) => blankButton(row, col));
  return one;
};

const full = (rows: number, columns: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) out.push([row, col]);
  }
  return out;
};

const layoutOf = (rows: number, columns: number, pages: AppPage[]): AppLayout => ({
  target: "app", grid: { rows, columns }, pages, home: pages[0]!.id,
} as AppLayout);

describe("the effort of one cell, against the document's own table", () => {
  /* "Effort value for each cell in a fully-populated 2x2 grid (average: 0.43)",
   * printed as 0.50 / 0.44 / 0.45 / 0.35. The last is 0.345 and rounds up
   * there, which is why it is the one compared at two decimals rather than
   * three. */
  it("reproduces the four cells of a full 2x2", () => {
    const got = full(2, 2).map(([row, col]) => cellEffort(2, 2, row, col, 4));
    /* Half a unit in the last printed place, inclusive, is exact agreement:
     * the document prints two decimals, and the last cell is 0.345 there,
     * which it rounds up to 0.35. Neither toFixed nor toBeCloseTo says that -
     * toFixed(2) renders 0.345 as "0.34" because the binary value sits just
     * below, and toBeCloseTo's window is open at the boundary. Both would have
     * meant arguing with a rounding artefact instead of with the arithmetic. */
    [0.50, 0.44, 0.45, 0.35].forEach((want, at) => {
      expect(Math.abs(got[at]! - want)).toBeLessThanOrEqual(0.005 + 1e-12);
    });
  });

  it.each([
    [2, 2, 0.43],
    [4, 6, 0.96],
    [6, 10, 1.68],
    [8, 15, 2.74],
  ])("reproduces the average of a full %ix%i", (rows, columns, want) => {
    const cells = full(rows, columns);
    const sum = cells.reduce(
      (into, [row, col]) => into + cellEffort(rows, columns, row, col, cells.length), 0);
    expect(sum / cells.length).toBeCloseTo(want, 2);
  });

  /* The three terms that are not the distance each move the number the way the
   * document says they do, which is the check that catches a weight typed with
   * the wrong number of zeros - the kind of error the averages above would
   * still pass if two mistakes cancelled. */
  it("costs more on a bigger grid and on a fuller page", () => {
    expect(cellEffort(6, 11, 0, 0, 1)).toBeGreaterThan(cellEffort(3, 5, 0, 0, 1));
    expect(cellEffort(3, 5, 0, 0, 15)).toBeGreaterThan(cellEffort(3, 5, 0, 0, 1));
  });

  /* The one that reads backwards, and the reason it is frozen here.
   *
   * Scanning further down and to the right costs more - `visual_scan` counts
   * every button passed - but the hand rests at the bottom right corner, so
   * the distance term falls faster than the scan term rises. The last cell of
   * a grid is the *cheapest*, not the dearest, and the document's own 2x2
   * table says so: 0.50 at the top left against 0.35 at the bottom right.
   *
   * Written down because the opposite is the obvious guess - it was mine, and
   * this test failed on it - and because anybody optimising a board by this
   * number needs to know that the corner under the hand is the good seat. */
  it("makes the corner the hand rests in the cheapest, not the dearest", () => {
    const topLeft = cellEffort(3, 5, 0, 0, 15);
    const bottomRight = cellEffort(3, 5, 2, 4, 15);
    expect(bottomRight).toBeLessThan(topLeft);
    /* And the scan term is still there, outweighed rather than absent. Two
       cells mirrored across the anti-diagonal of a square grid sit exactly as
       far from the resting corner, so the only term left between them is the
       reading order: (2,0) is four buttons further along than (0,2). */
    expect(cellEffort(3, 3, 2, 0, 9) - cellEffort(3, 3, 0, 2, 9))
      .toBeCloseTo(0.015 * 4, 10);
  });
});

describe("the effort of a page", () => {
  it("averages over the buttons that are there, not over every cell", () => {
    const sparse = layoutOf(6, 11, [page("start", [[0, 0]])]);
    const packed = layoutOf(6, 11, [page("start", full(6, 11))]);
    expect(pageEffort(sparse, sparse.pages[0]!))
      .toBeLessThan(pageEffort(packed, packed.pages[0]!));
  });

  /* A page with nothing on it costs nothing, because there is nothing on it to
   * press. The alternative is a number about a button that does not exist. */
  it("is zero for an empty page", () => {
    const layout = layoutOf(3, 5, [page("start", [])]);
    expect(pageEffort(layout, layout.pages[0]!)).toBe(0);
  });
});

describe("the effort of getting to a page", () => {
  /** Start page with two ways onward, one of them also reachable the long way
   *  round, so the walk has something to choose between. */
  function board(): AppLayout {
    const start = page("start", [[0, 0], [0, 1]]);
    const near = page("near", [[0, 0]]);
    const far = page("far", full(3, 5));
    const deep = page("deep", [[0, 0]]);
    start.buttons[0]!.act = { kind: "goto", page: near.id };
    start.buttons[1]!.act = { kind: "goto", page: far.id };
    near.buttons[0]!.act = { kind: "goto", page: deep.id };
    far.buttons[0]!.act = { kind: "goto", page: deep.id };
    return layoutOf(3, 5, [start, near, far, deep]);
  }

  it("charges 1.0 for every page change, on top of the page landed on", () => {
    const layout = board();
    const cost = effortByPage(layout);
    const [start, near] = layout.pages;
    expect(cost.get(near!.id)!).toBeCloseTo(
      cost.get(start!.id)! + 1.0 + pageEffort(layout, near!), 6);
  });

  /* The document: "if there are multiple routes to get a word we always choose
   * the one with the lowest effort score". Both routes to `deep` are one page
   * change long, so fewest-hops cannot tell them apart - the cheap one goes
   * through the nearly empty page, and that is the one that has to win. */
  it("takes the cheapest way where two are the same length", () => {
    const layout = board();
    const cost = effortByPage(layout);
    const [start, near, far, deep] = layout.pages;
    const viaNear = cost.get(near!.id)! + 1.0 + pageEffort(layout, deep!);
    const viaFar = cost.get(far!.id)! + 1.0 + pageEffort(layout, deep!);
    expect(viaFar).toBeGreaterThan(viaNear);
    expect(cost.get(deep!.id)!).toBeCloseTo(viaNear, 6);
  });

  /* Absent, not Infinity and not zero: the strip says "nothing leads here" in
   * words, and a number would have to be either a lie or a special value that
   * every reader of this map would have to know about. */
  it("leaves out a page nothing leads to", () => {
    const layout = board();
    layout.pages.push(page("orphan", [[0, 0]]));
    expect(effortByPage(layout).has(layout.pages.at(-1)!.id)).toBe(false);
  });

  it("is empty where the start page is missing", () => {
    const layout = board();
    layout.home = "gone";
    expect(effortByPage(layout).size).toBe(0);
  });
});
