/* The page graph, and the four things that can happen to it.
 *
 * Pure functions over an AppLayout: no document, no storage, no clock. That is
 * what lets tests/unit/app_pages.test.ts drive the cases that are expensive to
 * get wrong - a page deleted while others point at it, the home page deleted,
 * the last page deleted, a grid made smaller than what is on it - without a
 * browser. editor.ts is what draws the result and what saves it.
 *
 * ## What the graph is
 *
 * Directed, and neither a tree nor a list. The nodes are pages; the edges are
 * buttons whose act is `goto`. One node is distinguished: `home`, which is
 * what the tablet opens on, what `manifest.root` names, and where a `:home`
 * button goes.
 *
 * Not a tree, because a Food page reached from both a Meals page and a
 * Morning page is an ordinary board and a tree would make you build it twice.
 * No parent pointer and no separate notion of "back" either: a back button is
 * one more `goto` edge, and giving it a mechanism of its own would be two
 * things that can disagree about where back is.
 *
 * ## Reachability is reported, never enforced
 *
 * A page nothing leads to is legal - OBF allows a board no other board links
 * to, and the viewer reads boards from the manifest rather than by walking
 * from the root. It is also the ordinary state for the five seconds between
 * making a page and making the button that leads to it. So `unreachable()`
 * exists to put a mark in the page strip, and nothing here refuses anything
 * because of it. The page you cannot reach is the page you most need to get
 * to in order to fix it.
 */
import { GRID } from "../core/boot.js";
import type { AppButton, AppLayout, AppPage } from "../core/types.js";

/** A fresh id. The same rule as a Sammlung's - minted once, never derived from
 *  a name or a position, because buttons point at it and both of those move. */
const mint = (): string => crypto.randomUUID();

/** An empty page. */
export function blankPage(name = ""): AppPage {
  return { id: mint(), name, buttons: [] };
}

/** An empty button for one cell. Appending, with no word class: the default
 *  and the common case, so that putting a button somewhere is one press and
 *  then typing, rather than a form to fill in before anything appears. */
export function blankButton(row: number, col: number): AppButton {
  return {
    id: mint(), row, col,
    label: "", vocalization: "", symbol: "", wordClass: "",
    act: { kind: "append" },
  };
}

/** What sits in one cell, or undefined. */
export const buttonAt = (page: AppPage, row: number, col: number)
  : AppButton | undefined =>
  page.buttons.find((one) => one.row === row && one.col === col);

/** The page an id names, or undefined. */
export const pageById = (layout: AppLayout, id: string): AppPage | undefined =>
  layout.pages.find((one) => one.id === id);

/** Every button anywhere in the Sammlung that leads to this page.
 *
 * The number the delete question needs, and the only fact in it that somebody
 * cannot see from the page they are standing on: what is *on* a page is on
 * screen, what points *at* it is on five other pages.
 */
export function inboundTo(layout: AppLayout, pageId: string): AppButton[] {
  const found: AppButton[] = [];
  for (const page of layout.pages) {
    if (page.id === pageId) continue;
    for (const button of page.buttons) {
      if (button.act.kind === "goto" && button.act.page === pageId) found.push(button);
    }
  }
  return found;
}

/** Which pages can be got to from home, by following `goto` edges.
 *
 * A `:home` button is not an edge for this purpose: it leads to the page the
 * walk starts from, so it can never make anything reachable that was not.
 */
export function reachable(layout: AppLayout): Set<string> {
  const seen = new Set<string>();
  const queue = pageById(layout, layout.home) ? [layout.home] : [];
  while (queue.length) {
    const at = queue.shift()!;
    if (seen.has(at)) continue;
    seen.add(at);
    const page = pageById(layout, at);
    if (!page) continue;
    for (const button of page.buttons) {
      if (button.act.kind === "goto" && !seen.has(button.act.page)) {
        queue.push(button.act.page);
      }
    }
  }
  return seen;
}

/** The pages nothing leads to. For a mark in the strip, and for nothing else. */
export function unreachable(layout: AppLayout): AppPage[] {
  const found = reachable(layout);
  return layout.pages.filter((one) => !found.has(one.id));
}

/** A new page, appended, named for its position when nobody names it.
 *
 * Not linked to anything: making a page and deciding what leads to it are two
 * decisions, and the second one is a button. What does connect them in one
 * gesture is the "new page" entry on a `goto` button's target select -
 * editor.ts calls this and then points the button at what comes back.
 */
export function addPage(layout: AppLayout, name = ""): AppPage {
  const page = blankPage(name);
  layout.pages.push(page);
  return page;
}

/**
 * A page goes, and every button that led to it stays where it is.
 *
 * This is the decision the whole model turns on, so here is what it is not.
 *
 * *Refusing while anything points at it* would make you hunt the inbound edges
 * down by hand, and would leave a page that cannot be deleted for a reason
 * nothing on screen explains.
 *
 * *Leaving the buttons pointing at nothing* would put a dangling `load_board`
 * in the package, or make the exporter drop it silently. On a tablet that is a
 * button which looks live and ignores the person pressing it, which
 * exchange/SPEC.md §7.4 calls the one failure a communication aid cannot
 * afford.
 *
 * *Deleting the buttons too* would destroy work on a different page - a label,
 * a symbol, a colour, a recording - as a side effect of deleting this one.
 *
 * So: the button keeps its label, its symbol, its colour and its cell, and
 * loses only its edge. It was authored as a thing on a page, and its target is
 * one property of it; only that property has stopped meaning anything. A
 * button reading "Essen" with a food symbol on it is still worth having when
 * the Essen page goes, and the person deleting the page is the one who knows
 * what belongs there instead.
 *
 * Two edges of the same rule:
 *
 * - **The home page may go.** `home` moves to the first page left. Refusing
 *   would be the first rejected option wearing a different hat.
 * - **The last page may go**, and leaves a fresh empty one. That is
 *   conventions.md §1.9 - "there is always one" - a floor down: a button
 *   always belongs to a page, so a page always exists.
 *
 * Answers how many buttons were turned back into plain ones, which is the
 * number the question was asked with.
 */
export function deletePage(layout: AppLayout, pageId: string): number {
  const at = layout.pages.findIndex((one) => one.id === pageId);
  if (at < 0) return 0;

  const inbound = inboundTo(layout, pageId);
  for (const button of inbound) button.act = { kind: "append" };

  layout.pages.splice(at, 1);
  if (!layout.pages.length) layout.pages.push(blankPage());
  // Whether or not the deleted page was home: a home naming a page that is not
  // here is a package whose root does not resolve, and the same one-line fix
  // covers a layout that arrived that way.
  if (!pageById(layout, layout.home)) layout.home = layout.pages[0]!.id;
  return inbound.length;
}

/** The buttons that would fall outside a grid of this size.
 *
 * Asked before a resize, so the question can name the number. Growing never
 * has any - which is the point of buttons carrying their own coordinates
 * rather than living in a dense array of cells: 3x5 to 6x11 moves nothing and
 * re-indexes nothing.
 */
export function outside(layout: AppLayout, rows: number, columns: number): AppButton[] {
  const found: AppButton[] = [];
  for (const page of layout.pages) {
    for (const button of page.buttons) {
      if (button.row >= rows || button.col >= columns) found.push(button);
    }
  }
  return found;
}

/** The grid becomes this size, and anything outside it goes.
 *
 * The caller asks first where outside() is not empty - this does not ask,
 * because it is also how a layout that arrived with a button out of bounds is
 * brought back into line.
 */
export function resize(layout: AppLayout, rows: number, columns: number): void {
  layout.grid = {
    rows: clamp(rows, GRID.minRows, GRID.maxRows),
    columns: clamp(columns, GRID.minColumns, GRID.maxColumns),
  };
  for (const page of layout.pages) {
    page.buttons = page.buttons.filter(
      (one) => one.row < layout.grid.rows && one.col < layout.grid.columns);
  }
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, Math.trunc(value) || low));
