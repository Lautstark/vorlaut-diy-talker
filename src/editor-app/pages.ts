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
 *
 * A shared first-column button counts once, and it counts even when the page
 * it leads to is the page being asked about. Both follow from what it is: it
 * was authored once, so deletePage() has one edge to take from it - and it is
 * drawn on every other page too, so it really does lead here from elsewhere.
 * The rule above it - a page does not lead to itself - is about a button
 * sitting on the very page it points at, and a shared button sits on all of
 * them.
 */
export function inboundTo(layout: AppLayout, pageId: string): AppButton[] {
  const found: AppButton[] = [];
  for (const page of layout.pages) {
    if (page.id === pageId) continue;
    for (const button of page.buttons) {
      if (button.act.kind === "goto" && button.act.page === pageId) found.push(button);
    }
  }
  for (const button of sharedColumn(layout)) {
    if (button.act.kind === "goto" && button.act.page === pageId) found.push(button);
  }
  return found;
}

/** Which pages can be got to from home, by following `goto` edges.
 *
 * A `:home` button is not an edge for this purpose: it leads to the page the
 * walk starts from, so it can never make anything reachable that was not.
 *
 * A shared first-column button is an edge from every page, which is the whole
 * of what makes the column persistent - so one `goto` in it puts its target
 * one press from anywhere, and the strip must stop calling that target
 * unreachable. Walked per page rather than seeded once at home, because that
 * is what it is, and because a Sammlung whose home page is missing then still
 * reaches nothing rather than reaching the column's targets out of nowhere.
 */
export function reachable(layout: AppLayout): Set<string> {
  const seen = new Set<string>();
  const queue = pageById(layout, layout.home) ? [layout.home] : [];
  const column = sharedColumn(layout);
  while (queue.length) {
    const at = queue.shift()!;
    if (seen.has(at)) continue;
    seen.add(at);
    const page = pageById(layout, at);
    if (!page) continue;
    for (const button of [...page.buttons, ...column]) {
      if (button.act.kind === "goto" && !seen.has(button.act.page)) {
        queue.push(button.act.page);
      }
    }
  }
  return seen;
}

/**
 * The pages nothing leads to.
 *
 * Read in three places, which is what it costs to keep such a page findable
 * once the strip stopped listing every page. The row shows what the page on
 * screen opens, and a page nothing opens is in nobody's row - so the row draws
 * this list as a marked run of its own at its end, the count beside the picker
 * says how many there are when the run has been folded away, and the mark
 * inside the picker finds them in the one list that is always complete. That
 * is the whole of why the picker is not polish. Without it this list would
 * name pages that had become unopenable, which is worse than the wrapping
 * strip it replaced.
 *
 * Also read for the page somebody is standing on, which is the one page no row
 * of tiles can carry: the path marks it instead.
 */
export function unreachable(layout: AppLayout): AppPage[] {
  const found = reachable(layout);
  return layout.pages.filter((one) => !found.has(one.id));
}

/**
 * The pages the shared first column leads to, if there is one.
 *
 * The other half of opens()'s decision. Those pages are one press from
 * anywhere, so they are in no page's row and no page's path - and something
 * has to say so, or the column's targets are simply missing from the strip
 * with nothing to explain it. The picker is where they are said, once, because
 * the picker is the list that is already complete.
 */
export function columnTargets(layout: AppLayout): Set<string> {
  const found = new Set<string>();
  for (const button of sharedColumn(layout)) {
    if (button.act.kind === "goto") found.add(button.act.page);
  }
  return found;
}

/* --- What the strip walks ------------------------------------------------ */

/**
 * The pages this page's own buttons open, each once, in cell order.
 *
 * The strip's row is drawn from this, and so is the path above it, and that is
 * on purpose: every crumb in the path is a step somebody could have taken
 * through a row, because both are the same set of edges.
 *
 * **The shared first column is left out, and it is the only thing left out.**
 * reachable() above says why it would otherwise dominate: a `goto` in the
 * column is an edge from *every* page, so its targets are what this page opens
 * and also what all the others open, identically. Appended to each row they
 * would be the same two or three tiles forever, spending the row's fixed
 * height on the one fact in it that never changes; drawn in the path they
 * would be a step nobody could retrace. So the row is what this page *adds*,
 * and the column - which belongs to the Sammlung and not to any page - is said
 * once, in the picker, where every page is listed anyway.
 *
 * Cell order rather than authoring order, so the row reads in the order the
 * buttons sit on the board: reading order is the only order somebody looking
 * at the page can predict.
 */
export function opens(layout: AppLayout, pageId: string): AppPage[] {
  const from = pageById(layout, pageId);
  if (!from) return [];
  const out: AppPage[] = [];
  const seen = new Set<string>();
  const inOrder = [...from.buttons].sort(
    (a, b) => (a.row - b.row) || (a.col - b.col));
  for (const button of inOrder) {
    if (button.act.kind !== "goto") continue;
    const to = button.act.page;
    if (to === pageId || seen.has(to)) continue;
    const page = pageById(layout, to);
    if (!page) continue;                  // an edge to a page that has gone
    seen.add(to);
    out.push(page);
  }
  return out;
}

/**
 * The way from the start page to this one: every page passed through, ending
 * on this one.
 *
 * The shortest one, breadth-first. The graph is not a tree - a Food page
 * reached from both Meals and Morning is the ordinary case this file's head
 * describes - so there is no such thing as *the* way here, and any of them
 * would be truthful. Shortest is the one worth drawing: it is the fewest
 * crumbs, it is stable under the order pages happen to sit in, and it is the
 * route somebody would actually press.
 *
 * Empty for a page that is not there. A lone entry - the page and nothing
 * before it - for a page no run of `goto` buttons reaches, which is both an
 * orphan and a page only the shared first column leads to. The strip draws
 * that as the anchor and one crumb, which is as much as is true.
 */
export function route(layout: AppLayout, pageId: string): AppPage[] {
  const target = pageById(layout, pageId);
  if (!target) return [];
  if (!pageById(layout, layout.home)) return [target];

  const back = new Map<string, string>();
  const seen = new Set<string>([layout.home]);
  const queue = [layout.home];
  while (queue.length) {
    const at = queue.shift()!;
    if (at === pageId) {
      const path: AppPage[] = [];
      for (let step: string | undefined = pageId; step;
           step = back.get(step)) {
        path.unshift(pageById(layout, step)!);
      }
      return path;
    }
    for (const next of opens(layout, at)) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      back.set(next.id, at);
      queue.push(next.id);
    }
  }
  return [target];
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

/**
 * A button moves to another cell, trading places with whatever is there.
 *
 * Swap rather than refuse, and swap rather than push: refusing means a full
 * board cannot be rearranged at all, and pushing would move a third button
 * somebody did not touch. Trading places moves exactly the two cells the
 * gesture named, which is what a person dropping one tile onto another
 * expects - and it is what the five-key editor has always done, where a fixed
 * 2x2 made swapping the only unambiguous answer.
 *
 * Dropping onto an empty cell is the same operation with nothing to trade, so
 * there is one function rather than a move and a swap.
 */
export function moveButton(page: AppPage, id: string, row: number, col: number): void {
  const moving = page.buttons.find((one) => one.id === id);
  if (!moving) return;
  const sitting = buttonAt(page, row, col);
  if (sitting && sitting.id === id) return;
  if (sitting) {
    sitting.row = moving.row;
    sitting.col = moving.col;
  }
  moving.row = row;
  moving.col = col;
}

/** The buttons that would fall outside a grid of this size.
 *
 * Asked before a resize, so the question can name the number. Growing never
 * has any - which is the point of buttons carrying their own coordinates
 * rather than living in a dense array of cells: 3x5 to 6x11 moves nothing and
 * re-indexes nothing.
 *
 * The shared column is walked with everything else and counted **once**, not
 * once per page: it is authored once and a number that multiplied it by the
 * page count would say four buttons are about to go when one is. Fewer rows is
 * the only way it can lose anything - every button in it sits at column zero,
 * and there is no grid narrower than one column.
 */
export function outside(layout: AppLayout, rows: number, columns: number): AppButton[] {
  return allButtons(layout).filter(
    (one) => one.row >= rows || one.col >= columns);
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
  const inside = (one: AppButton): boolean =>
    one.row < layout.grid.rows && one.col < layout.grid.columns;
  for (const page of layout.pages) page.buttons = page.buttons.filter(inside);
  /* The shared column is trimmed by the same predicate, and by the same call:
   * a row that is gone is gone from every page at once, which is what the
   * column being one thing means.
   *
   * Narrowing to a single column leaves the shared column and nothing else,
   * and that is left to happen rather than refused. It is not a state anybody
   * reaches from the four offered sizes - the narrowest is five columns wide -
   * and every page button it costs was already counted by outside(), so the
   * question that got here named the whole number. */
  if (layout.firstColumn) layout.firstColumn = layout.firstColumn.filter(inside);
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, Math.trunc(value) || low));

/* --- The first column, when it belongs to the Sammlung -------------------- */

/**
 * The Sammlung's own first column, or an empty list where each page owns its.
 *
 * The array and the flag are one thing - see AppLayout.firstColumn - so this
 * is the reader for the buttons and shared() below is the reader for whether
 * there are any to have. Both exist because `layout.firstColumn ?? []` at
 * thirty call sites is thirty chances to write `?? undefined` once.
 */
export const sharedColumn = (layout: AppLayout): AppButton[] =>
  layout.firstColumn ?? [];

/** Whether the first column is the Sammlung's rather than each page's. */
export const shared = (layout: AppLayout): boolean =>
  Array.isArray(layout.firstColumn);

/** What sits at this row of the shared column, or undefined. `buttonAt` for
 *  the column that has no page. */
export const sharedAt = (layout: AppLayout, row: number): AppButton | undefined =>
  sharedColumn(layout).find((one) => one.row === row);

/** Whether this button is one of the shared ones. What the sheets ask before
 *  they say that an edit lands on every page. */
export const isShared = (layout: AppLayout, id: string): boolean =>
  sharedColumn(layout).some((one) => one.id === id);

/** Every button in the Sammlung, each counted once.
 *
 * A shared button is authored once and drawn on every page, so the walk that
 * answers "how much is in here" has to meet it once - see the Editor port's
 * count(). Page buttons first, in page order, because that is the order every
 * other walk in this file uses.
 */
export function allButtons(layout: AppLayout): AppButton[] {
  const out: AppButton[] = [];
  for (const page of layout.pages) out.push(...page.buttons);
  out.push(...sharedColumn(layout));
  return out;
}

/**
 * The first-column buttons that are not on the page whose column will be kept.
 *
 * Asked before the column becomes the Sammlung's, so the question can name the
 * number - the same shape as outside(), and for the same reason: what goes is
 * on pages nobody is looking at.
 *
 * There is no merge to offer instead. Five pages with five different buttons
 * in row 0 have five answers to "what is in row 0 now", and any rule for
 * picking between them - first page wins, the fullest column wins - is the
 * editor deciding what a core word is. One page's column, named in the
 * question, is the answer somebody can predict before they press it.
 */
export function elsewhere(layout: AppLayout, keepPageId: string): AppButton[] {
  const found: AppButton[] = [];
  for (const page of layout.pages) {
    if (page.id === keepPageId) continue;
    for (const button of page.buttons) if (button.col === 0) found.push(button);
  }
  return found;
}

/**
 * The first column becomes the Sammlung's, taken from one page.
 *
 * The named page's column zero is moved - the same objects, so ids, labels,
 * symbols and edges all survive - and every other page's column zero goes.
 * Answers with what went, which is what elsewhere() counted beforehand.
 *
 * Moved rather than copied onto a Sammlung-level list that shadows the pages:
 * two stores holding the same button is two things to keep in step, and the
 * one that is not drawn is the one that goes stale without anybody seeing it.
 *
 * A page that is not there names an empty column, which is switching the
 * feature on with nothing in it - a legal state and the one somebody who wants
 * to author the column from scratch is asking for.
 */
export function shareFirstColumn(layout: AppLayout, keepPageId: string): AppButton[] {
  const gone = elsewhere(layout, keepPageId);
  const keep = layout.pages.find((one) => one.id === keepPageId);
  const taken = keep ? keep.buttons.filter((one) => one.col === 0) : [];
  for (const page of layout.pages) {
    page.buttons = page.buttons.filter((one) => one.col !== 0);
  }
  layout.firstColumn = taken;
  return gone;
}

/**
 * The first column goes back to being each page's own, and every page keeps it.
 *
 * The inverse of the export rather than of shareFirstColumn(): the column is
 * written onto every page, exactly as data/app_package.ts writes it onto every
 * board. So nothing is lost, and there is nothing to ask about - which is why
 * this half has no question where the other half has one.
 *
 * Fresh ids per page, because the copies are now separate buttons that can be
 * edited apart from each other, and two buttons in one Sammlung sharing an id
 * would make "which one did I just change" unanswerable.
 */
export function spreadFirstColumn(layout: AppLayout): void {
  const column = sharedColumn(layout);
  for (const page of layout.pages) {
    for (const one of column) page.buttons.push({ ...one, id: mint() });
  }
  delete layout.firstColumn;
}

/** A shared button moves up or down its column, trading places with whatever
 *  is at the row it lands on.
 *
 * moveButton()'s rule, in one dimension: the column is one cell wide, so there
 * is nowhere sideways to go and the swap is the whole of it. Crossing between
 * the column and the page is not a move at all - it changes whether a button
 * is on one page or on all of them - so it is not offered as one. */
export function moveShared(layout: AppLayout, id: string, row: number): void {
  const column = sharedColumn(layout);
  const moving = column.find((one) => one.id === id);
  if (!moving || moving.row === row) return;
  const sitting = sharedAt(layout, row);
  if (sitting) sitting.row = moving.row;
  moving.row = row;
}
