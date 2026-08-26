/* What a page costs, by OpenAAC's effort algorithm.
 *
 * Pure functions over an AppLayout, like pages.ts beside it: no document, no
 * storage. tests/unit/app_effort.test.ts checks them against the tables
 * OpenAAC published with the algorithm, which is the whole reason this is a
 * file of its own rather than four lines inside editor.ts - the numbers have an
 * oracle, and an oracle that is not checked is a number nobody can defend.
 *
 * ## Where it comes from
 *
 * "AAC Effort Algorithms", version 0.2, by OpenAAC - the same people whose Open
 * Board Format this editor exports. Direct selection only; the document leaves
 * scanning and gaze as TBD, and vorlaut's tablet half is touch.
 *
 *     button_size = 0.09 * (rows + columns) / 2
 *     field_size  = 0.005 * buttons on screen
 *     visual_scan = 0.015 * buttons before this one, reading order
 *     distance    = 0.4 * hypot(dx, dy) / sqrt(2), from the resting hand
 *     effort      = the four added, plus 1.0 for every page change on the way
 *
 * The weights are theirs and are not tuned here. They are stated as
 * intuition-based in the document itself and expected to move; when they do,
 * this file changes and the frozen table in the test changes with it, which is
 * the arrangement that makes a change visible instead of silent.
 *
 * ## What it is *not*
 *
 * Not a CARE score. That averages this number over core word lists, a fringe
 * list and whole sentences, all of which are language-bound, and every
 * published value is for an English vocabulary. This number is language-blind -
 * it never looks at a word, only at how big the grid is, how full the page is,
 * where the button sits and how many pages away it is - so it is the half that
 * transfers to a German board unchanged. Nothing here should grow a comparison
 * against published vocabularies for that reason.
 *
 * Not a verdict either. There is no threshold for good or bad, in the document
 * or here; smaller is better and that is the whole of what may be said.
 */
import { allButtons, opens, pageById, sharedColumn } from "./pages.js";
import type { AppLayout, AppPage } from "../core/types.js";

/** Every button drawn on one page: its own, plus the shared first column where
 *  the Sammlung has one. What the person using the tablet sees, which is what
 *  all four terms are about. */
function onScreen(layout: AppLayout, page: AppPage) {
  return [...page.buttons, ...sharedColumn(layout)];
}

/**
 * What one cell costs to find and hit, before any page change.
 *
 * Exported for the test, which drives it directly against the per-cell table
 * OpenAAC printed for a full 2x2. Nothing else should need it: a cell's cost is
 * not shown anywhere, because on the grids vorlaut offers the spread across a
 * page is about a tenth of what one page change costs, so fifteen numbers that
 * differ in the second decimal would be noise laid over the board being made.
 */
export function cellEffort(
  rows: number, columns: number, row: number, column: number, visible: number,
): number {
  const buttonSize = 0.09 * (rows + columns) / 2;
  const fieldSize = 0.005 * visible;
  const visualScan = 0.015 * (row * columns + column);
  /* Relative to the screen, so no pixels are needed: Fitts's law makes the
   * smaller target on the smaller screen cancel the shorter distance, which is
   * the document's argument for normalising. The hand rests at the bottom
   * right and returns there before a new word. */
  const dx = 1 - (column + 0.5) / columns;
  const dy = 1 - (row + 0.5) / rows;
  const distance = 0.4 * Math.hypot(dx, dy) / Math.SQRT2;
  return buttonSize + fieldSize + visualScan + distance;
}

/**
 * What an average button on this page costs, ignoring how far in the page is.
 *
 * The mean over the buttons that are actually there, not over every cell: an
 * empty cell is nothing to find and nothing to hit, and counting it would make
 * a nearly empty 6x11 look as expensive as a full one when the opposite is the
 * case - `field_size` and `visual_scan` both fall as a page empties.
 *
 * Zero for a page with nothing on it. A page with no buttons costs nothing to
 * use because there is nothing on it to use, and the alternative - some
 * notional cost for a cell nobody can press - would be a number about a button
 * that does not exist.
 */
export function pageEffort(layout: AppLayout, page: AppPage): number {
  const drawn = onScreen(layout, page);
  if (!drawn.length) return 0;
  const { rows, columns } = layout.grid;
  let sum = 0;
  for (const one of drawn) {
    sum += cellEffort(rows, columns, one.row, one.col, drawn.length);
  }
  return sum / drawn.length;
}

/**
 * What every page costs from the start page, by id. Pages nothing leads to are
 * absent rather than Infinity - see reach() in the caller; "no number" and "a
 * very large number" are different facts and the strip says them differently.
 *
 * **The cheapest way, not the shortest.** The document is explicit: where
 * several routes reach a word, the one with the lowest effort is the one that
 * counts. That is not the same as the fewest page changes - two hops across
 * small, thinly filled pages can cost less than one across a full 6x11 - and
 * route() in pages.ts, which draws a walk for a person rather than costing one,
 * answers the other question. Dijkstra rather than a walk for exactly that
 * reason.
 *
 * A page change costs a flat 1.0 on top of the page it lands on. The shared
 * first column is an edge from every page, so its targets are one change from
 * wherever somebody is - which is the whole of what makes a column persistent,
 * and it falls out of the walk below without a special case.
 */
export function effortByPage(layout: AppLayout): Map<string, number> {
  const cost = new Map<string, number>();
  const home = pageById(layout, layout.home);
  if (!home) return cost;

  const mean = new Map<string, number>();
  for (const page of layout.pages) mean.set(page.id, pageEffort(layout, page));

  cost.set(home.id, mean.get(home.id)!);
  const settled = new Set<string>();
  for (;;) {
    let at: string | null = null;
    for (const [id, value] of cost) {
      if (settled.has(id)) continue;
      if (at === null || value < cost.get(at)!) at = id;
    }
    if (at === null) break;
    settled.add(at);
    const page = pageById(layout, at);
    if (!page) continue;
    for (const next of opens(layout, at)) {
      const through = cost.get(at)! + 1.0 + mean.get(next.id)!;
      const known = cost.get(next.id);
      if (known === undefined || through < known) cost.set(next.id, through);
    }
    for (const button of sharedColumn(layout)) {
      if (button.act.kind !== "goto") continue;
      const to = pageById(layout, button.act.page);
      if (!to || to.id === at) continue;
      const through = cost.get(at)! + 1.0 + mean.get(to.id)!;
      const known = cost.get(to.id);
      if (known === undefined || through < known) cost.set(to.id, known === undefined
        ? through : Math.min(known, through));
    }
  }
  return cost;
}

/** How many buttons are in the whole Sammlung. The count the sidebar row used
 *  to carry, kept here because it is the same walk and the same file's
 *  business - see allButtons() for why a shared button counts once. */
export const buttonCount = (layout: AppLayout): number => allButtons(layout).length;
