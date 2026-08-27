// The tablet editor: the page strip, the grid, and the two sheets a press
// opens - one for a button, one for a page.
//
// This is the second device-specific half. Pages of a grid, a sentence bar
// composed by pressing buttons, a colour per word class: none of that is true
// of the five-key talker and all of it is true of a MetaTalk-style board,
// which is why it sits under editor-app/ and why nothing in the shell may
// import it. The shell reaches it through core/editor.ts, and `app` at the
// foot of this file is what it reaches.
//
// `here` lives here and nowhere else. It is where the editor is standing -
// which page - and it is reset by adopt() for the same reason editor-diy's
// `current` is: page three of the kitchen Sammlung and page three of the
// nursery Sammlung have nothing to do with each other.
//
// There is no `chosen` beside it any more. A button was once selected and the
// panel showed it, so which one that was had to be remembered between renders;
// now a press opens a sheet that carries its own copy and closes over it, and
// the board goes back to having nothing on it that outlives a press.
//
// The graph itself is in pages.ts, deliberately without a document anywhere
// near it: what happens to the buttons that pointed at a deleted page is the
// part of this that is expensive to get wrong, so it is the part that can be
// tested without a browser.
import { $, negationCross, status } from "../shell/dom.js";
import { symbolInto } from "../backend/index.js";
import { state } from "../core/state.js";
import type { Editor } from "../core/editor.js";
import { isApp } from "../core/types.js";
import type {
  Act, AppButton, AppLayout, AppPage, GridSize, Layout, WordColor,
} from "../core/types.js";
import { GRID, LANG, WORD_CLASSES } from "../core/boot.js";
import { t } from "../core/texts.js";
import { save, saveSoon } from "../core/save.js";
import { speak } from "../shell/speech.js";
import { confirmDialog } from "@lautstark/design/dialog";
/* The sheet is the shell's now, and the whole of what this file hands it is a
 * title, a picture, some rows and three labelled things to do. It was written
 * here, and moving it is what let the talker have the same one: an editor may
 * not import out of another editor - tests/unit/layers.test.ts - so anything
 * genuinely shared between the two belongs in the shell. */
import { dropdown, formRow, hint, missing, openSheet, textField }
  from "../shell/sheet.js";
import type { Choice, Left } from "../shell/sheet.js";
import {
  collectionMenuExtras, collectionPages, exportApp, paintOpenCollection,
  paintPages, sizeChoices,
} from "../shell/collections.js";
/* Which house a start key opens with, and which collection it comes out of.
 * The shell's, not this file's: exchange/SPEC.md §5.1 allows one symbol source
 * per package, so "the prescribed picture" is a different answer per
 * collection, and which collection is in force is something a browser knows
 * and an editor does not. */
import { HOME_TONES, homeSymbol, homeSymbolSource, homeWord }
  from "../shell/homekey.js";
import { collectionSheetPanel } from "../shell/voices.js";
/* §7.3's rule about which presses put an entry in the bar, which the exporter
 * needs for the recordings and this file needs for the play buttons. One
 * definition, in the module that owns the format. */
import { appends } from "../data/app_package.js";
import {
  addPage, blankButton, blankPage, buttonAt, deletePage,
  inboundTo, isShared, moveButton, moveShared, opens, outside, pageById,
  reachable, resize, shareFirstColumn, shared, sharedAt, sharedColumn,
  spreadFirstColumn,
} from "./pages.js";
import { effortByPage, pageEffort } from "./effort.js";

/** Which page is being edited, by id. An id rather than an index because
 *  deleting a page shifts every index after it and would silently move where
 *  somebody is standing. */
let here = "";
/** The button being dragged, by id. Null when nothing is. */
let dragging: string | null = null;

/* state.layout, as the shape this editor is the editor for.
 *
 * The shell holds one layout and it may be either kind. This file may only
 * ever be looking at the tablet half, because the composition root installs it
 * for an app Sammlung and for nothing else - so the guarantee is written down
 * once here instead of being asserted at every read below.
 *
 * It throws for the reason $() throws: reaching here with a talker Sammlung on
 * screen is not a case to handle, it is a composition root that has installed
 * the wrong editor. */
function board(): AppLayout {
  const held = state.layout;
  if (!isApp(held)) throw new Error("the tablet editor was given a talker Sammlung");
  return held;
}

/** The page on screen. Falls back to the first rather than to nothing: `here`
 *  can name a page that has just been deleted, and an editor standing on
 *  nothing is a blank screen with no way out of it. */
function page(): AppPage {
  const layout = board();
  return pageById(layout, here) ?? layout.pages[0]!;
}

/* --- Writing ------------------------------------------------------------- */

/**
 * Redrawn now, written after: for the changes that move structure - a page
 * added, a button placed, an act changed. Typing goes through saveSoon().
 *
 * **The order is the point, and it was the other way round first.** `await
 * save(); render();` puts an IndexedDB round trip between a press and the page
 * reflecting it, and for most of these that is merely slow. For one of them it
 * loses what somebody typed: pressing an empty cell makes a button and moves
 * the panel to it, so during that gap the panel on screen still belongs to the
 * *previous* button, with its label field focused - and anything typed into it
 * goes to the wrong button. It is a small window and it is exactly as long as
 * a database write, which is to say long enough that a test driving the page
 * hit it every time.
 *
 * Nothing is risked by drawing first. save() does not touch state.layout - it
 * writes what is there and compares what comes back - and the writes are
 * serialised in a chain inside it, so an unawaited call cannot overtake an
 * earlier one.
 */
function commit(): void {
  render();
  /* The sidebar row for this Sammlung counts its buttons and names its grid,
   * both off the layout this has just changed - so a button placed leaves the
   * row at its old number, and a resize leaves it naming the old size while
   * the panel that did the resizing names the new one an inch away. Cheap by
   * construction: the open row is the one row paintOpenCollection() need not
   * go to the store for. See there for why it is not hung off the save. */
  paintOpenCollection();
  void save();
}
/* --- The page: its own head, and the two facts about it -------------------
 *
 * What stood here was a path, a row of tiles and a picker, and all three are
 * gone. The row showed the pages the page on screen opened, so it was empty on
 * every board nobody had linked yet - which is every board for its whole first
 * sitting. Five drawings were tried against that (see the mock pages in the
 * design session) and each of them made a claim about the graph that the graph
 * does not support: a level, a parent, a set of neighbours.
 *
 * **The path went for a reason worth writing down.** `route()` walks
 * breadth-first and takes the shortest chain, so where two ways reach a page it
 * showed one of them, arbitrarily, as though it were *the* way. On a graph
 * where a Food page hangs off both Meals and Morning - the ordinary case this
 * editor is built for - a breadcrumb cannot be truthful. What it was really
 * trying to answer is "what leads here", and that question has an exact answer
 * in inboundTo(): all of them, not one.
 *
 * So the chrome over the board is now two lines. The page's own head - its
 * name, which is the field that renames it - and one line of numbers, each of
 * which unfolds. Which pages exist, and getting to them, is the list in the
 * sidebar; where a page leads is the buttons on the board, each of which
 * carries a corner that follows it.
 */

/** Two decimals, in the page's language. The effort numbers sit in a column in
 *  the sidebar and beside each other in the facts line, so they are formatted
 *  once, here, rather than by each caller. */
const decimals = new Intl.NumberFormat(LANG, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** What a page is called in the strip. Its name, or its position where nobody
 *  has named it - the same fallback the delete question uses. */
const pageName = (one: AppPage): string =>
  one.name || t("ui.app_page_n", { n: board().pages.indexOf(one) + 1 });

/**
 * The page's own head: the name, and the two things that can be done to it.
 *
 * **The name is the field that renames it.** shell/templates/frame.ts settles
 * that for a Sammlung - "renaming a thing you are looking at should be typing
 * over its name" - and a page was the last name in this editor that had to go
 * through a menu to change. With renaming out of it, the ⋯ that used to sit
 * beside the path held two entries, and then one, and a menu with one entry is
 * not a menu.
 *
 * **The ⌂ appears only on the start page.** It is a mark for a state, not a
 * switch for one: on any other page it would be a house standing over a page
 * that is not the start page, which is the sort of thing a reader has to test
 * by pressing. Getting there is an act, so it is an act - a quiet word at the
 * right end, and only where it would do something.
 */
function drawPageHead(found: Set<string>): void {
  const layout = board();
  const one = page();

  const house = $("appPageHome");
  house.hidden = one.id !== layout.home;
  house.textContent = "\u2302";
  house.title = t("ui.app_page_home");

  const name = $<HTMLInputElement>("appPageName");
  name.setAttribute("aria-label", t("ui.app_page_name"));
  name.placeholder = t("ui.app_page_n", { n: layout.pages.indexOf(one) + 1 });
  // Only when it is not the field somebody is typing in: writing the value
  // back under the caret moves it to the end on every keystroke.
  if (document.activeElement !== name) name.value = one.name;

  const warn = $("appPageWarn");
  warn.hidden = found.has(one.id);
  warn.textContent = "\u26a0";
  warn.title = t("ui.app_page_unreachable");

  const start = $<HTMLButtonElement>("appPageStart");
  start.hidden = one.id === layout.home;
  start.textContent = t("ui.app_page_home_set");

  const remove = $<HTMLButtonElement>("appPageDelete");
  remove.textContent = t("ui.app_page_delete");
}

/**
 * One line of numbers: what leads here, where it leads, what it costs, how much
 * is on it. Three of the four unfold.
 *
 * **Both directions are real edges.** inboundTo() and opens() are the graph
 * read forwards and backwards; nothing here is derived from a walk that had to
 * pick a parent. That is the whole difference between this line and the five
 * drawings it replaces.
 *
 * **Only one zero is a fault, and only it is coloured.** Nothing leading to a
 * page that is not the start page is the state that makes it invisible on the
 * tablet. A page leading nowhere is a leaf, and most pages of a board are
 * leaves - a board where every page led onward would be a board with no words
 * on it. Colouring that would be an editor tutting at ordinary work.
 *
 * The start page has nothing leading to it and that is not a fault either: the
 * tablet opens with it. Its zero is left plain and says so when unfolded.
 */
function drawFacts(found: Set<string>): void {
  const layout = board();
  const one = page();
  const row = $("appFacts");
  row.innerHTML = "";

  const into = inboundPages(layout, one.id);
  const outOf = opens(layout, one.id);
  const cost = effortByPage(layout).get(one.id);

  row.appendChild(fact("in", t("ui.app_page_here"), into.length,
    into.length === 0 && one.id !== layout.home));
  row.appendChild(dot());
  row.appendChild(fact("out", t("ui.app_page_from_here"), outOf.length, false));
  row.appendChild(dot());
  if (cost === undefined) {
    const nil = document.createElement("span");
    nil.className = "facts__plain facts__zero";
    nil.textContent = t("ui.app_page_unreachable");
    row.appendChild(nil);
  } else {
    row.appendChild(fact("cost", t("ui.app_page_effort"), cost, false));
  }
  row.appendChild(dot());
  const n = one.buttons.length + sharedColumn(layout).length;
  row.appendChild(fact("full", "", n, false));

  drawUnfolded(found, into, outOf, cost);
}

/** The separator between two facts. A middot rather than a rule: the line is a
 *  sentence of numbers, and a rule would make it a toolbar. */
function dot(): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "facts__dot";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "\u00b7";
  return mark;
}

/** One number, pressable, with what it says beside it.
 *
 * The button count is the one that reads the other way round - "12 Tasten"
 * rather than "Tasten 12" - because it is a quantity of things and the two
 * before it are directions with a count. So it composes its own words and this
 * takes them whole. */
function fact(key: string, label: string, value: number, bad: boolean): HTMLElement {
  const shown = key === "cost" ? decimals.format(value) : String(value);
  const one = document.createElement("button");
  one.type = "button";
  one.className = "facts__one" + (bad ? " facts__zero" : "");
  one.textContent = key === "full"
    ? t(value === 1 ? "ui.app_pages_buttons_one" : "ui.app_pages_buttons", { n: value })
    : `${label} ${shown}`;
  one.setAttribute("aria-expanded", String(unfolded === key));
  one.onclick = (event) => {
    event.stopPropagation();
    unfolded = unfolded === key ? null : key;
    render();
  };
  return one;
}

/** Which fact is open, or none. Module state rather than the DOM's, because
 *  every render throws the line away and rebuilds it. */
let unfolded: string | null = null;

/**
 * What the open number says, under the line.
 *
 * Text links with middots between them, not chips: a row of names reads as a
 * sentence and a row of boxes reads as a second toolbar, which is the thing
 * this whole change is removing.
 */
function drawUnfolded(found: Set<string>, into: AppPage[], outOf: AppPage[],
                      cost: number | undefined): void {
  const layout = board();
  const box = $("appFactLinks");
  box.innerHTML = "";
  box.hidden = unfolded === null;
  if (unfolded === null) return;

  /* How full the page is, which is the fact the bare count was missing.
   *
   * Twelve buttons means something different on a 3x5 than on a 6x11, and the
   * difference is not cosmetic: `field_size` in the effort number grows with
   * every button on screen, so how full a page is *is* part of what it costs.
   * The second line is the shared first column, which is on this page and on
   * every other one - it is counted here because it is drawn here, and said
   * because somebody wondering why a page has more buttons than they put on it
   * deserves the answer. */
  if (unfolded === "full") {
    const { rows, columns } = layout.grid;
    const own = page().buttons.length;
    const column = sharedColumn(layout).length;
    const fill = document.createElement("span");
    fill.className = "factlinks__line";
    fill.textContent = t("ui.app_page_buttons_fill",
                         { n: own + column, all: rows * columns });
    box.appendChild(fill);
    if (column) {
      const shared = document.createElement("span");
      shared.className = "factlinks__line";
      shared.textContent = t("ui.app_page_buttons_shared", { n: column });
      box.appendChild(shared);
    }
    return;
  }

  if (unfolded === "cost") {
    if (cost === undefined) { box.hidden = true; return; }
    box.appendChild(sum(layout));
    const what = document.createElement("span");
    what.className = "factlinks__line";
    what.textContent = t("ui.app_page_effort_what", { n: decimals.format(1) });
    box.appendChild(what);
    /* Where the arithmetic comes from, and deliberately nothing more. The CARE
     * numbers published beside it average this over English core word lists,
     * so they are no yardstick for a German board - see effort.ts. */
    const more = document.createElement("a");
    more.className = "factlinks__line";
    more.href = "https://www.openaac.org/vocabularies/";
    more.target = "_blank";
    more.rel = "noreferrer noopener";
    more.textContent = t("ui.app_page_effort_more");
    box.appendChild(more);
    return;
  }

  const set = unfolded === "in" ? into : outOf;
  if (!set.length) {
    const nil = document.createElement("span");
    nil.className = "factlinks__line";
    if (unfolded === "out") {
      nil.textContent = t("ui.app_page_opens_none");
    } else if (page().id === layout.home) {
      nil.textContent = t("ui.app_page_here_home");
    } else {
      nil.className += " facts__zero";
      nil.textContent = t("ui.app_page_here_none");
    }
    box.appendChild(nil);
    return;
  }
  set.forEach((one, at) => {
    if (at) box.appendChild(dot());
    const link = document.createElement("button");
    link.type = "button";
    link.className = "factlinks__to";
    if (!found.has(one.id)) {
      const lost = document.createElement("span");
      lost.className = "tab__lost";
      lost.textContent = "\u26a0";
      lost.title = t("ui.app_page_unreachable");
      link.appendChild(lost);
    }
    link.appendChild(document.createTextNode(pageName(one)));
    link.onclick = (event) => { event.stopPropagation(); goToPage(one.id); };
    box.appendChild(link);
  });
}

/** The arithmetic, page by page along the cheapest way here. Shown rather than
 *  summarised, because a number somebody is asked to act on should be one they
 *  can check. */
function sum(layout: AppLayout): HTMLElement {
  const line = document.createElement("span");
  line.className = "factlinks__line factlinks__sum";
  const cost = effortByPage(layout);
  const parts: string[] = [];
  for (const one of cheapestWay(layout, page().id)) {
    const own = decimals.format(pageEffort(layout, one));
    parts.push(parts.length
      ? `+ ${decimals.format(1)} + ${own} (${pageName(one)})`
      : `${own} (${pageName(one)})`);
  }
  const total = cost.get(page().id);
  line.textContent = total === undefined ? "" : parts.join(" ");
  return line;
}

/**
 * The pages passed through on the cheapest way from the start page, ending on
 * this one.
 *
 * Not route(). That walks breadth-first and answers "the fewest page changes",
 * which is a different question from "the least effort" and was the reason the
 * old path could be wrong - see effortByPage(). This one is derived from the
 * costs themselves: step back to whichever neighbour the total was reached
 * through.
 */
function cheapestWay(layout: AppLayout, pageId: string): AppPage[] {
  const cost = effortByPage(layout);
  const out: AppPage[] = [];
  let at = pageById(layout, pageId);
  const seen = new Set<string>();
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    out.unshift(at);
    if (at.id === layout.home) break;
    const here = cost.get(at.id);
    if (here === undefined) break;
    const own = pageEffort(layout, at);
    let from: AppPage | undefined;
    for (const other of layout.pages) {
      const theirs = cost.get(other.id);
      if (theirs === undefined || other.id === at.id) continue;
      const leadsOn = opens(layout, other.id).some((x) => x.id === at!.id)
        || sharedColumn(layout).some((b) =>
             b.act.kind === "goto" && b.act.page === at!.id);
      if (!leadsOn) continue;
      if (Math.abs(theirs + 1 + own - here) < 1e-9) { from = other; break; }
    }
    at = from;
  }
  return out;
}

/** Every page whose buttons lead to this one, each once.
 *
 * inboundTo() answers in buttons, because that is what the delete question
 * counts. The line over the board answers in pages: two buttons on one page
 * leading here is one place to go back to, not two. */
function inboundPages(layout: AppLayout, pageId: string): AppPage[] {
  const out: AppPage[] = [];
  const seen = new Set<string>();
  for (const one of layout.pages) {
    if (one.id === pageId || seen.has(one.id)) continue;
    if (one.buttons.some((b) => b.act.kind === "goto" && b.act.page === pageId)) {
      seen.add(one.id);
      out.push(one);
    }
  }
  return out;
}

/** Somebody chose a page - from the sidebar list, from an unfolded fact, or by
 *  following a button's corner. The one way in, so that the list and the board
 *  cannot disagree about where they are. */
export function goToPage(id: string): void {
  if (!pageById(board(), id)) return;
  const fromList = document.activeElement instanceof HTMLElement
    && document.activeElement.classList.contains("pagelist__item");
  here = id;
  unfolded = null;
  wantFocus = fromList;
  render();
}

/* --- The grid ------------------------------------------------------------ */

function drawGrid(): void {
  const layout = board();
  const grid = $("appGrid");
  grid.innerHTML = "";
  grid.style.setProperty("--rows", String(layout.grid.rows));
  grid.style.setProperty("--cols", String(layout.grid.columns));
  /* The gap the package asks a viewer for, drawn here too - see
   * AppLayout.firstColumnGap. The board on this screen is a picture of the
   * board on the tablet, and a hint that only showed up after export would be
   * a setting somebody had to take on faith. */
  grid.classList.toggle("grid--gap", layout.firstColumnGap === true);

  for (let row = 0; row < layout.grid.rows; row++) {
    for (let col = 0; col < layout.grid.columns; col++) {
      grid.appendChild(cell(page(), row, col));
    }
  }
}

/** Every cell is a drop target, filled or not: dropping onto an empty one is
 *  a move and onto a full one is a swap, and both are the same gesture.
 *
 * Except across the two regions a shared first column makes of the board. A
 * button dragged out of that column would stop being on every page, and one
 * dragged into it would start being on all of them - which is not a move, it
 * is a change of what the button *is*, and no drag should carry that much. So
 * the cell simply does not become a drop target, which is the same silent "no"
 * this function already gives a button dropped where it already sits.
 */
function acceptsDrop(box: HTMLElement, on: AppPage, row: number, col: number): void {
  const takes = (id: string): boolean =>
    isShared(board(), id) === inColumn(col);
  box.ondragover = (event) => {
    if (dragging === null || !takes(dragging)) return;
    const already = cellHolder(on, row, col);
    if (already && already.id === dragging) return;
    // Only a prevented dragover marks an element as a drop target at all.
    event.preventDefault();
    box.classList.add("dragover");
  };
  box.ondragleave = () => box.classList.remove("dragover");
  box.ondrop = (event) => {
    event.preventDefault();
    clearDragMarks();
    if (dragging === null || !takes(dragging)) return;
    const id = dragging;
    dragging = null;
    if (inColumn(col)) moveShared(board(), id, row);
    else moveButton(on, id, row, col);
    commit();
  };
}

/** Whether this column of the board is the Sammlung's shared one rather than
 *  the page's. Column zero, and only while the Sammlung has such a column. */
const inColumn = (col: number): boolean => col === 0 && shared(board());

/** What sits in one cell of the board on screen, from whichever of the two
 *  stores owns that cell. */
const cellHolder = (on: AppPage, row: number, col: number): AppButton | undefined =>
  inColumn(col) ? sharedAt(board(), row) : buttonAt(on, row, col);

function clearDragMarks(): void {
  for (const one of document.querySelectorAll(".cell.dragover")) {
    one.classList.remove("dragover");
  }
}

/** The widget inside a cell: what a press lands on.
 *
 * A div wearing role="button" rather than a <button>, for the reason
 * editor-diy's tabs give: its parent is dragged, and a real button captures
 * the mousedown that would start the drag. So the two things the element would
 * have brought - a place in the tab order, and acting on Enter and Space - are
 * written out at each call site. */
function opener(label: string): HTMLElement {
  const hit = document.createElement("div");
  hit.className = "cell__open";
  hit.setAttribute("role", "button");
  hit.tabIndex = 0;
  hit.setAttribute("aria-label", label);
  /* What a press actually does, said rather than left to be found out. This
   * was aria-pressed while the panel existed, which described a button that
   * stays down - and once every cell opened a sheet instead, a screen reader
   * was announcing a toggle state for something that toggles nothing. */
  hit.setAttribute("aria-haspopup", "dialog");
  return hit;
}

function cell(on: AppPage, row: number, col: number): HTMLElement {
  const held = cellHolder(on, row, col);
  /* The cell is a box, not a control. It holds two controls side by side: one
   * filling it, and - once there is something to hear - one in the corner that
   * plays. Nesting the second inside the first would be a control inside a
   * control, which no keyboard can reach and no markup validator allows. */
  const box = document.createElement("div");
  box.className = "cell";
  // What the gap is drawn against - see .grid--gap. On the cell rather than
  // by counting children in CSS, because nth-child cannot be told how wide the
  // grid is.
  if (col === 0) box.classList.add("cell--first");
  if (inColumn(col)) box.classList.add("cell--shared");
  /* Placed rather than left to auto-flow, but only while the gap is drawn.
   *
   * .grid--gap puts a real spacer track between the first column and the
   * second, which is the only way to set a column apart without making it
   * narrower than the ones beside it - a margin comes out of the cell, and a
   * first column 5% short of the rest is a board that looks slightly wrong
   * rather than deliberately spaced. A spacer track is a track, though, and
   * auto-flow would drop the second cell of every row into it. So every cell
   * says which track it is in, and the empty one stays empty. */
  if (board().firstColumnGap === true) {
    box.style.gridColumn = String(col === 0 ? 1 : col + 2);
  }
  acceptsDrop(box, on, row, col);

  if (!held) {
    box.classList.add("cell--empty");
    box.title = t("ui.app_button_add");
    const hit = opener(t("ui.app_button_add"));
    box.appendChild(hit);
    /* The sheet opens with nothing filled in, and the button comes into being
     * on Fertig. Pressing an empty cell used to mint one immediately, which
     * meant an accidental press left a blank button on the board - and a
     * dialog somebody closes must cost nothing. */
    const make = () => { void editButton(row, col); };
    hit.onclick = make;
    hit.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      make();
    };
    return box;
  }

  /* What a screen reader calls the cell. A button carrying a picture and no
   * word is a deliberate button rather than an unfinished one, so it is not
   * announced as empty: what it says when pressed names it, and where it says
   * nothing the picture is named as the whole of it. Only a button with
   * neither is empty. */
  const named = held.label
    || (held.symbol ? held.vocalization.trim() || t("ui.app_button_symbol") : "");
  const hit = opener(named || t("ui.app_button_empty"));
  // A word with no picture is its own kind of button, and takes the room the
  // picture would have had. The class carries it; see .cell--words.
  box.classList.toggle("cell--words", !held.symbol);
  box.appendChild(hit);
  /* The word class, worn as the Sammlung says: a fill, a border, or nothing.
   *
   * Two different custom properties rather than one and a class on the grid,
   * because the fill is what decides the *text* colour - a label over a light
   * Fitzgerald fill is dark whatever the theme is, and a label on a bordered
   * cell is the theme's own. ui.css keys both off which property is set, so a
   * cell cannot end up dark text on a dark surface by having the class and not
   * the fill. "off" sets neither, and the cell is left as any other. */
  const colour = classColor(held.wordClass);
  if (colour && wordColor(board()) === "fill") {
    box.style.setProperty("--cell-color", colour);
  } else if (colour && wordColor(board()) === "border") {
    box.style.setProperty("--cell-edge", colour);
  }

  /* The one cell whose look is the viewer's rather than the collection's.
   *
   * Everything else on this board is a word: paper under the picture because
   * AAC symbols are drawn for white, a Fitzgerald tint saying which kind of
   * word, the label spelling it. A start key is none of those, and the tablet
   * draws it as what it is - the picture's luminance on a dark plate, the same
   * two tones the bar controls wear. Until this class existed the editor drew
   * it as a word anyway, so the one cell the editor could not preview was the
   * one cell that does not look like its own picture.
   *
   * The condition is BoardScreen.kt's `chrome`, restated rather than
   * approximated, because the two have to answer alike on the same button:
   *
   *   - a bare `home`. An appending one - a word that is also said on the way
   *     back - really is a word, and keeps its paper and its tint there;
   *   - no fill and no border. A key wearing a colour has been given one on
   *     purpose, and neither renderer takes it away for the sake of a default.
   *
   * The plate comes from HOME_TONES for the reason sheet.ts gives at its own
   * copy of this line: it is the tablet's colour, not a theme token, so it is
   * read from the module that owns what a key looks like rather than written a
   * second time in ui.css. */
  /* Every way back to the start page wears a heavier edge, coloured or not.
   *
   * `.cell--home` below is narrower than this on purpose: it is the plate a
   * key gets when it carries no colour of its own, so a home key somebody has
   * given a Fitzgerald colour keeps that colour and would have had no mark at
   * all. The edge is the mark; the plate is a default.
   *
   * The `home` act rather than a `goto` that happens to point at today's start
   * page. They are different things - see the start key's own comment - and
   * only one of them follows the start page when it moves. */
  if (held.act.kind === "home") box.classList.add("cell--tohome");

  const chrome = held.act.kind === "home" && held.act.alsoAppend !== true
    && !box.style.getPropertyValue("--cell-color")
    && !box.style.getPropertyValue("--cell-edge");
  if (chrome) {
    box.classList.add("cell--home");
    box.style.setProperty("--home-plate", HOME_TONES.plate);
    /* The strokes' tone, for the things on the plate that are not the picture
     * - the act badge in the corner. The picture gets there through the filter
     * instead, which is the same two numbers by the other route. */
    box.style.setProperty("--home-ink", HOME_TONES.light);
  }

  if (held.symbol) {
    const image = document.createElement("img");
    image.className = "cell__pic";
    symbolInto(image, held.symbol);
    // Two different absences, and the words point at different remedies. The
    // reading is shell/sheet.ts's, because the sheet's own preview and both
    // editors' cells all have to make it and it was three copies of one
    // sentence-picking rule.
    image.onerror = () => { image.replaceWith(missing(held.symbol)); };
    // Crossed out, and only then wrapped: the cross has to be the size of the
    // picture rather than of the cell - see .cell__crossed - and an ordinary
    // button keeps the <img> as its own flex item.
    if (held.negated) {
      const crossed = document.createElement("span");
      crossed.className = "cell__crossed";
      crossed.append(image, negationCross());
      box.appendChild(crossed);
    } else {
      box.appendChild(image);
    }
  }

  /* The word, where there is one.
   *
   * A picture with no word is ordinary AAC and the format allows it -
   * exchange/SPEC.md §7.2 - so nothing stands in for the word that is not
   * there. An empty slot on a board is furniture announcing an absence, and
   * the way to fill it is a press away. */
  if (held.label) box.appendChild(wordSpan(held.label));

  // What the button does, where it is not the default. An appending button is
  // the common case and carries no mark: marking every ordinary cell would
  // make the marks worth nothing.
  const badge = actBadge(held.act);
  if (badge) {
    const tag = document.createElement("span");
    tag.className = "cell__act";
    tag.textContent = badge;
    tag.title = t(`ui.app_act_${actKey(held.act.kind)}`);
    box.appendChild(tag);
  }

  /* Hearing it, without opening anything.
   *
   * The five-key editor has had a play button on every key since it was
   * written, and it is what somebody uses while looking at the board to check
   * it reads right. It appears under the pointer or on focus rather than
   * standing there: a control nobody is reaching for should not be taking room
   * from the word. A real <button>, because nothing drags it.
   *
   * Only where there is something to say. The four bar controls speak nothing
   * when pressed on the tablet, and nor does a navigation button - unless it
   * is one that carries its word into the sentence on the way, which speaks
   * exactly like the word button it also is. Offering to audition any of the
   * others would be offering silence. */
  const saying = (held.vocalization || held.label).trim();
  if (saying && (appends(held.act) || held.act.kind === "speak")) {
    const play = document.createElement("button");
    play.type = "button";
    play.className = "cell__play";
    play.textContent = "▶";
    play.title = t("ui.play_title");
    play.setAttribute("aria-label", t("ui.play_title"));
    play.onclick = (event) => {
      // The cell behind it opens the sheet; this one does not.
      event.stopPropagation();
      void speak(saying, play);
    };
    box.appendChild(play);
  }

  /* And the corner that follows a navigation button.
   *
   * The row of page tiles over the board is gone, and this is where the half
   * of it that was not duplication went: a `goto` button already carries the
   * name of the page it opens, so the way there belongs on the button rather
   * than on a copy of it two centimetres higher.
   *
   * **Top right, and the play control is top left.** Both seats are fixed and
   * neither moves for the other: a `goto` button that carries its word into
   * the sentence on the way - §7.3's `ext_lautstark_append_on_navigate` - has
   * something to audition *and* a page to follow, and the two used to share one
   * seat with this one stepping aside.
   *
   * The act badge shares this seat rather than the play control's, and that is
   * forced rather than chosen: the play control is the one thing that turns up
   * beside either of the other two, so it needs the seat nobody else uses. A
   * `goto` has carried no badge since this corner replaced its arrow, so these
   * two can never meet. ui.css has the table.
   *
   * The press itself still opens the button's own sheet, for the reason
   * templates/board.ts gives: a `goto` button that navigated when pressed
   * would be the one button on the board nobody could ever edit. */
  if (held.act.kind === "goto") {
    const to = pageById(board(), held.act.page);
    if (to) {
      const follow = document.createElement("button");
      follow.type = "button";
      follow.className = "cell__follow";
      follow.textContent = "\u203a";
      follow.title = t("ui.app_page_follow", { name: pageName(to) });
      follow.setAttribute("aria-label", follow.title);
      follow.onclick = (event) => {
        event.stopPropagation();
        goToPage(to.id);
      };
      box.appendChild(follow);
    }
  }

  const select = () => { void editButton(held.row, held.col); };
  hit.onclick = select;

  box.draggable = true;
  box.ondragstart = (event) => {
    dragging = held.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", held.id);
    }
  };
  box.ondragend = () => { dragging = null; clearDragMarks(); };

  /* Alt and an arrow moves a button one cell, which is the same key this
   * product already uses to reorder the talker's sets. The alternative -
   * editor-diy's arm-with-Enter, drop-with-Enter - reads well on four keys in
   * a fixed square and badly on sixty-six, where the two ends of the gesture
   * can be a screen apart.
   *
   * Claimed even where the move has nowhere to go: Alt+Left is history-back in
   * some engines, and rearranging a board must never walk off the page. */
  hit.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight");
  hit.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
      return;
    }
    const step = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0],
                    ArrowLeft: [0, -1], ArrowRight: [0, 1] } as const)[
                      event.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"];
    if (!event.altKey || !step) return;
    event.preventDefault();
    const grid = board().grid;
    const to = [held.row + step[0], held.col + step[1]] as const;
    if (to[0] < 0 || to[0] >= grid.rows || to[1] < 0 || to[1] >= grid.columns) return;
    /* The keyboard move stops at the same boundary the drag does, and stopping
     * is all it does: a shared button walks its own column, and a page button
     * may not walk into it. Claimed and then ignored rather than left
     * unclaimed, for the reason the shortcut is claimed at all - Alt+Left is
     * history-back in some engines, and rearranging a board must never walk
     * off the page. */
    if (inColumn(to[1]) !== inColumn(held.col)) return;
    if (inColumn(held.col)) moveShared(board(), held.id, to[0]);
    else moveButton(on, held.id, to[0], to[1]);
    commit();
    // render() rebuilt every cell, so the element that had focus is gone. It
    // follows the button rather than staying at the coordinate, which is what
    // makes a run of presses move one thing across the board.
    ($("appGrid").children[(to[0] * grid.columns) + to[1]]
      ?.querySelector(".cell__open") as HTMLElement)?.focus();
  };
  return box;
}

/** The word on a cell. One maker, kept as one now that it has a single caller:
 *  it was two because paintCell() also had to put a word there as it was typed
 *  into the panel, and the panel and its live redraw are both gone. */
function wordSpan(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "cell__word";
  span.textContent = text;
  return span;
}

/** One character for what a press does. Deliberately the glyphs the format's
 *  own actions suggest rather than words: a cell is small, and the panel
 *  spells it out for whichever button is selected. */
function actBadge(act: Act): string {
  switch (act.kind) {
    /* Two of the seven carry no badge, because each has something better on
     * the same cell.
     *
     * A `goto` has the corner that follows it - a second arrow in the opposite
     * corner said the same thing twice, and the one that does something is the
     * one worth keeping. A `home` has a heavier edge, which marks the whole
     * cell rather than a corner of it: on a board the way back is the one
     * button somebody looks for without reading, and an edge is visible from
     * further away than an 11px glyph. */
    case "goto": return "";
    case "home": return "";
    case "speak": return "🔊";
    case "clear": return "✕";
    case "backspace": return "⌫";
    case "sayBar": return "▶";
    case "append": return "";
  }
}

/** The text-key stem for an act. `sayBar` is the one that differs, because the
 *  table spells it the way the sentence reads. */
const actKey = (kind: Act["kind"]): string => (kind === "sayBar" ? "say_bar" : kind);

const classColor = (key: string): string =>
  WORD_CLASSES.find((one) => one.key === key)?.color ?? "";

/** How this Sammlung wears a word class. Absent counts as "fill", which is
 *  what every layout written before the field existed was drawn as - so an old
 *  Sammlung opens looking exactly as it did. See AppLayout.wordColor. */
const wordColor = (layout: AppLayout): WordColor => layout.wordColor ?? "fill";

/* --- The two sheets ------------------------------------------------------
 *
 * Everything about one button, and everything about one page, each in a modal
 * opened by pressing the thing itself. This is what replaced the property row
 * that used to sit under the grid.
 *
 * **Why a sheet rather than a row.** The row could only ever hold what fits on
 * one line, which is why the picture and the sound had to stay in the cell and
 * why a dense board had to give its tools up. A sheet has room for all of it at
 * every board size, so the eleven-column case stops being a degradation and
 * becomes the same interaction as the three-column one. What it costs is the
 * fast path - fifteen new buttons is fifteen open-type-close cycles rather than
 * fifteen presses and some typing - and the foot's "next" button is the
 * mitigation, which is worth stating plainly rather than hiding.
 *
 * **Nothing is written until Fertig.** Both sheets edit a draft and copy it
 * back on the confirming press, so every way out that is not that press costs
 * exactly nothing - which is the rule an empty cell made unavoidable (pressing
 * one must not leave a blank button behind when the sheet is dismissed) and
 * which is no less true of an existing button.
 *
 * **What is left here is the rows.** The frame - the picture column with its
 * search, the foot with the destructive act on the left, and the promise that
 * settles from the presses rather than from `close` alone - is
 * shell/sheet.ts's, and the head of that file is where the reasoning for each
 * of those now lives. This file says what a *button* has on it and what a
 * *page* has on it, which is the half that is genuinely the tablet's.
 */

/* --- The page sheet ------------------------------------------------------ */

/**
 * The question asked before a page goes.
 *
 * Three facts, and the third is the one that earns the dialog: what is on the
 * page, what happens to it, and **how many buttons on other pages lead here**.
 * The first two somebody can see from where they are standing. The third they
 * cannot - it is on five other pages - and it is the only thing in the
 * question that could change their mind. conventions.md §1.7, one level down
 * from a Sammlung.
 */
async function askDelete(on: AppPage): Promise<boolean> {
  const layout = board();
  const name = on.name || t("ui.app_page_n",
                            { n: layout.pages.indexOf(on) + 1 });
  const n = on.buttons.length;
  const inbound = inboundTo(layout, on.id).length;

  const lines = [
    t(n === 0 ? "ui.app_page_delete_ask_none"
       : n === 1 ? "ui.app_page_delete_ask_one" : "ui.app_page_delete_ask",
      { name, n }),
  ];
  if (inbound) {
    lines.push(t(inbound === 1 ? "ui.app_page_delete_links_one"
                               : "ui.app_page_delete_links", { n: inbound }));
  }
  // The last page leaves an empty one behind rather than nothing, and somebody
  // about to press the button should know that is what they are getting.
  if (layout.pages.length === 1) lines.push(t("ui.app_page_last"));

  if (!await confirmDialog({
    title: t("ui.app_page_delete"),
    body: lines.join(" "),
    confirmLabel: t("ui.app_page_delete_go"),
    cancelLabel: t("ui.cancel"),
    closeLabel: t("ui.close"),
    danger: true,
  })) return false;

  deletePage(layout, on.id);
  here = layout.pages[0]!.id;
  commit();
  return true;
}

/** Everything about one button. */
/* --- The button sheet ---------------------------------------------------- */

/** What the sheet is editing: a copy, until Fertig writes it back. */
interface Draft {
  label: string;
  vocalization: string;
  symbol: string;
  negated: boolean;
  wordClass: string;
  act: Act;
}

/** The four kinds the sheet offers, which are not the seven the union holds.
 *
 * A question about a *word*, and nothing else - `Act` is unchanged and so is
 * everything in data/app_package.ts. Two things it used to ask are gone.
 *
 * The first two used to name a distinction that does not exist: one label
 * said "into the sentence bar" and the other "speak at once", as though one
 * of them spoke and the other did not, and vorlaut-app's BoardViewModel calls
 * utter() for `append` *and* `speak`. Both speak. The only difference is
 * whether the word joins the sentence, which is what the labels say now.
 *
 * The fourth kind is gone with three of the four acts under it. `sayBar`,
 * `backspace` and `clear` are drawn by the viewer as permanent chrome on the
 * message bar - TalkerScreen.kt, per design.md §4.3, with Speak as the
 * screen's one primary - so a grid button for any of them spends a cell out of
 * fifteen on a control that is already on screen at all times, and a second
 * Speak competes with that primary. `home` has no such chrome and does need a
 * cell, but it is navigation rather than bar operation: it is an entry in the
 * page option's target list now, where it says what it does.
 *
 * exchange/SPEC.md §7.4 still names all four, and so does `Act`: a package
 * from another AAC tool may carry any of them, and vorlaut-app has to read it.
 * This is about what this editor offers to make.
 *
 * The fourth kind is the third one wearing §7.3's append-on-navigate: a button
 * that puts its word in the sentence and *then* leads onward, which is how a
 * sentence starter is built. It is a kind here rather than a checkbox under
 * the target list, because the question this dropdown asks is already the
 * right one - what does one press do - and a checkbox would leave the third
 * kind's own label naming two different behaviours depending on a control
 * underneath it.
 */
type Does = "word" | "shout" | "goto" | "carry";

/** Which kind an act reads as, or null for one of the three bar controls the
 *  sheet no longer offers. The sheet keeps such a button saying what it is
 *  rather than letting it re-read as the first kind in the list. */
const doesOf = (act: Act): Does | null =>
  act.kind === "append" ? "word"
  : act.kind === "speak" ? "shout"
  : act.kind === "goto" || act.kind === "home" ? (act.alsoAppend ? "carry" : "goto")
  : null;

/** The two entries in the target list that are not a page: the start page,
 *  which is the act `home` rather than a `goto` at whichever page is home
 *  today, and one that mints a page on Fertig. Page ids are UUIDs, so neither
 *  can collide with one. */
const GOTO_HOME = "⌂";
const GOTO_NEW = "+";

/**
 * One button, opened by pressing its cell.
 *
 * `held` is null for an empty cell, and that is the case the whole draft model
 * is built around: the sheet opens with nothing filled in and the button comes
 * into being on Fertig, so a sheet somebody closes leaves the cell as empty as
 * they found it. Pressing an empty cell used to mint a button immediately and
 * move the panel to it, which meant an accidental press left a blank button on
 * the board.
 */
function openButtonSheet(held: AppButton | null, at: [number, number]): Promise<Left> {
  const layout = board();

  const draft: Draft = held
    ? { label: held.label, vocalization: held.vocalization, symbol: held.symbol,
        negated: Boolean(held.negated), wordClass: held.wordClass, act: held.act }
    : { label: "", vocalization: "", symbol: "", negated: false, wordClass: "",
        act: { kind: "append" } };
  /* Whether "Neue Seite ..." is what the target select is standing on.
   *
   * Held here rather than written straight into the layout, so that the page
   * is minted by the same press that writes everything else - and named from
   * the label as it finally reads, rather than as it read at the moment the
   * option was chosen. The panel minted immediately and took the label it had,
   * which was usually the empty one. */
  let wantsNewPage = false;

  /* --- the fields --- */

  const rows: HTMLElement[] = [];

  /* A button in the shared column is one button on every page, and the sheet
   * says so before anything is typed into it.
   *
   * The surprise this heads off is not the edit, it is *where* the edit
   * lands: somebody standing on page three, changing a word, has no way to
   * see that pages one, two and four changed with it - and the same press
   * that renames it can delete it from all of them. conventions.md's rule
   * about counting what somebody cannot see, one floor down from the page
   * delete question. It is a notice rather than a question because nothing
   * is lost and nothing is hidden: the board behind the sheet redraws with
   * the change on it, and every other page is one tab away. */
  let notice: HTMLElement | undefined;
  if (inColumn(at[1])) {
    notice = document.createElement("div");
    notice.className = "notice";
    notice.textContent = t("ui.app_first_column_button");
  }

  const labelInput = textField(draft.label, (value) => { draft.label = value; });
  labelInput.id = "appLabel";
  labelInput.placeholder = t("ui.app_button_label_hint");
  /* The hint rides on the caption's line rather than under the field.
   *
   * It is a qualification of the question - what an empty one means - and it
   * is short enough to read as one. Under the control it was a third stacked
   * line saying something the placeholder in the field had half said already;
   * beside the caption it says the half the placeholder cannot, and costs no
   * height at all.
   *
   * Short enough is a measured claim rather than a hope. The caption's line
   * is the form column less the caption, which is 312px here, and the whole
   * sentence has to fit in one of them - a note that wraps there is taller
   * than the row it was moved out of, which is the modifier costing the
   * height it was written to save. The sentence this row used to carry filled
   * that line with nothing to spare; the one in ui.app_button_label_note now
   * says the same thing in half of it, which is the margin a longer caption
   * or a larger text size needs. ui.app_button_spoken_note is the same
   * sentence about the other field, and the two are written to read as a
   * pair. */
  const labelRow = formRow(t("ui.app_button_label"), labelInput,
                           t("ui.app_button_label_note"));
  labelRow.classList.add("form__row--caption");
  rows.push(labelRow);

  /* --- what a press does, and the rows that follow from it ---------------
   *
   * Asked second, directly under the label, because it decides whether the
   * rows under it mean anything at all. A navigation button says nothing, so
   * its Gesprochen field and its play button are two dead controls - and
   * asked last, as this was, they were dead in silence, with nothing on
   * screen saying why typing into one changes nothing.
   *
   * A dropdown rather than the radiogroup it was, which is what makes the
   * move affordable: four boxed options with their notes under them were most
   * of this sheet's height, and a sheet that has to be scrolled to reach
   * Fertig is worse than one asking its questions in the wrong order. What
   * the radiogroup carried and a bare dropdown would throw away is each
   * option's own line - ui.app_does_word_note against ui.app_does_shout_note,
   * "says itself and joins the sentence" against "says itself but does not",
   * which is the only thing explaining a distinction people otherwise get
   * wrong. So the chosen option's note follows the control as a hint, and the
   * sheet still says it.
   */
  const kinds: Choice[] = (["word", "shout", "goto", "carry"] as const)
    .map((kind) => ({ value: kind, label: t(`ui.app_does_${kind}`) }));
  const chose = doesOf(draft.act);
  /* A button made in this editor before the sheet stopped offering the bar
   * controls keeps its act, and keeps saying what that act is: a fourth entry
   * that only such a button has. The alternative is a `sayBar` button that
   * opens reading "Wort" and quietly becomes one on Fertig.
   *
   * Nothing general is built for this, because nothing general can arrive.
   * importObz() has no mapping for these acts on the way in and reads into a
   * talker layout rather than a tablet one, so no board from another AAC tool
   * can carry one here. The only source is this editor's own past, in this
   * browser's IndexedDB.
   */
  if (!chose) {
    kinds.push({ value: draft.act.kind,
                 label: t(`ui.app_act_${actKey(draft.act.kind)}`) });
  }

  const note = hint();
  note.id = "appDoesNote";
  const does = dropdown(kinds, chose ?? draft.act.kind, () => { chosen(); });
  does.button.id = "appDoes";
  /* Named to the trigger by hand, because this row builds its sentence rather
   * than handing formRow() one: it is rewritten on every choice, so the row
   * cannot be given a string once. What the association buys is the same
   * thing it buys everywhere else - "Wort" on its own does not say what a
   * word does, and this is the distinction people get wrong. */
  does.button.setAttribute("aria-describedby", note.id);
  /* Beside the caption, the same as Aufschrift and Gesprochen.
   *
   * It sat beside the *trigger* while the trigger was a narrow button, on the
   * argument that "Ausruf" left three quarters of a line empty. The trigger
   * spans the row now, so that line is gone - and the wider point is that a
   * reader should not have to work out a different rule per row. A note rides
   * beside the caption that names the question; nowhere else.
   *
   * This one is longer than the other two and will wrap here, which is the
   * cost of the consistency and is worth paying rather than hiding. It has a
   * better home waiting: the descriptions belong on the menu items themselves,
   * where all three are readable while somebody is choosing between them
   * instead of one at a time afterwards. That needs a second line on
   * @lautstark/design's menu items, which `AddItem` has no room for today. */
  const actRow = formRow(t("ui.app_button_act"), does.anchor, "", does.button);
  actRow.classList.add("form__row--caption");
  actRow.appendChild(note);
  rows.push(actRow);

  /* Where a navigation button leads, with the start page as the first entry
   * above the pages themselves.
   *
   * `home` is kept as its own act rather than written as a `goto` at whichever
   * page is home today, because the two behave differently the moment somebody
   * makes another page the start page: a `goto` stays pointing where it
   * pointed, and a home button follows. That is the whole reason it is worth
   * an entry of its own - and on a first-column button, which is on every page
   * at once, it is the difference between "back to the start" and "back to the
   * page that used to be the start".
   */
  const where: Choice[] = [
    { value: GOTO_HOME, label: t("ui.app_act_home") },
    ...layout.pages.map((one, index) =>
      ({ value: one.id, label: one.name || t("ui.app_page_n", { n: index + 1 }) })),
    { value: GOTO_NEW, label: t("ui.app_goto_new") },
  ];
  /** What the target list is standing on, as an act. A `goto` is never left
   *  pointing at nothing - a button with no target exports as an ordinary
   *  appending button, which is not what the list said was chosen - so it
   *  takes whatever is selected, which is the current page until somebody
   *  changes it. */
  const leadsTo = (): Act => {
    // Absent rather than false where the button only navigates - Act's own
    // note, and what keeps a button made before this existed byte-identical.
    const carrying = does.value === "carry" ? { alsoAppend: true } : {};
    return targets.value === GOTO_HOME
      ? { kind: "home", ...carrying }
      : { kind: "goto", page: targets.value === GOTO_NEW ? "" : targets.value,
          ...carrying };
  };
  const targets = dropdown(where,
    draft.act.kind === "home" ? GOTO_HOME
      : draft.act.kind === "goto" && draft.act.page ? draft.act.page : page().id,
    () => {
      wantsNewPage = targets.value === GOTO_NEW;
      draft.act = leadsTo();
    });
  targets.button.id = "appGoto";
  const targetRow = formRow(t("ui.app_goto_page"), targets.anchor, "", targets.button);
  rows.push(targetRow);

  const spoken = textField(draft.vocalization, (value) => {
    draft.vocalization = value;
  });
  spoken.id = "appSpoken";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "btn";
  play.textContent = "▶";
  play.setAttribute("aria-label", t("ui.play_title"));
  play.title = t("ui.play_title");
  // What the tablet would say, which is the vocalization where there is one
  // and the label where there is not - exchange/SPEC.md §7.2's rule, said out
  // loud rather than described.
  play.onclick = () => {
    const saying = (draft.vocalization || draft.label).trim();
    if (saying) void speak(saying, play);
  };
  const withPlay = document.createElement("div");
  withPlay.className = "form__withplay";
  withPlay.append(spoken, play);
  /* The same treatment as Aufschrift, and the same sentence about the other
   * field: leave it empty and the label is what gets said.
   *
   * It was the field's placeholder, which is one place too few and one too
   * many at once. Too few, because a placeholder is gone the moment somebody
   * types - and the thing it says is about the empty field, so it disappears
   * exactly when somebody might want to undo their way back to it. Too many,
   * because the row would otherwise say it twice. So it moves onto the
   * caption's line, where it stays put and costs no height, and the field is
   * left bare. */
  const spokenRow = formRow(t("ui.app_button_spoken"), withPlay,
                            t("ui.app_button_spoken_note"), spoken.id);
  spokenRow.classList.add("form__row--caption");
  rows.push(spokenRow);

  /* Eleven entries, which is the longest list in the product and the one that
   * decides whether an open menu still fits inside a sheet. See fit() in
   * shell/sheet.ts: it opens upward from here and caps itself at what is
   * above, rather than hanging out of the body and taking the sheet's own
   * scrollbar with it. */
  const classes = dropdown(
    [{ value: "", label: t("ui.wordclass_none") },
     ...WORD_CLASSES.map((one) =>
       ({ value: one.key, label: t(`ui.wordclass_${one.key}`) }))],
    draft.wordClass, (value) => { draft.wordClass = value; });
  classes.button.id = "appClass";
  rows.push(formRow(t("ui.app_button_class"), classes.anchor, "", classes.button));

  /** The rows that depend on the answer above them, and the note under it.
   *
   * Hidden rather than disabled: the question is not whether somebody may type
   * into Gesprochen, it is whether this button says anything at all, and a
   * greyed field still reads as a field they have failed to reach.
   *
   * Wortart stays for all four, which looks like an oversight and is not. A
   * page-leading button is coloured as a category on real German boards, and
   * BuilderTabletPackageTest asserts exactly that of the navigating button in
   * the round-trip sample - #D8AF97, the category colour.
   *
   * Nothing is cleared on a change of act. The draft is a copy that reaches
   * the layout only on Fertig, so what somebody typed before changing their
   * mind is still there if they change it back.
   */
  const follow = () => {
    // "carry" is the one that answers both with yes: it says its word and it
    // leads onward, so it is the only choice that draws Zielseite and
    // Gesprochen at once.
    const goes = does.value === "goto" || does.value === "carry";
    const speaks = does.value === "word" || does.value === "shout"
                || does.value === "carry";
    note.textContent = goes || speaks ? t(`ui.app_does_${does.value}_note`)
                                      : t("ui.app_does_bar_kept");
    targetRow.hidden = !goes;
    spokenRow.hidden = !speaks;
  };
  /* A declaration rather than the assignment the select's onchange was, and
   * hoisting is the whole reason: the dropdown is built above the two rows it
   * governs, so what it is handed has to be nameable before they exist. */
  function chosen(): void {
    draft.act = does.value === "word" ? { kind: "append" }
      : does.value === "shout" ? { kind: "speak" }
      : does.value === "goto" || does.value === "carry" ? leadsTo()
      : { kind: does.value } as Act;
    wantsNewPage = (does.value === "goto" || does.value === "carry")
      && targets.value === GOTO_NEW;
    follow();
  }
  follow();

  /** The draft, written where it belongs. Everything the sheet changed lands
   *  in one press, including the button's own existence. */
  const keep = () => {
    if (draft.act.kind === "goto" && wantsNewPage) {
      // Named from the label as it finally reads. The authoring move is "this
      // button should lead somewhere new", and making somebody leave, make a
      // page, come back and select it is one thought in three steps.
      //
      // Spread rather than rebuilt, so that a carrying button is still one
      // after the page it leads to has been minted.
      draft.act = { ...draft.act, page: addPage(layout, draft.label.trim()).id };
    } else if (draft.act.kind === "goto" && !draft.act.page) {
      draft.act = { ...draft.act, page: page().id };
    }
    const on = page();
    const target = held ?? blankButton(at[0], at[1]);
    // Into the column when the cell is the column's, and onto the page
    // otherwise. An existing button is already in whichever store it belongs
    // to, and nothing here moves it between them - see acceptsDrop().
    if (!held) {
      if (inColumn(at[1])) layout.firstColumn!.push(target);
      else on.buttons.push(target);
    }
    Object.assign(target, {
      label: draft.label, vocalization: draft.vocalization,
      symbol: draft.symbol, wordClass: draft.wordClass, act: draft.act,
    });
    // Present only when it is true, never a stored false - see Slot.negated.
    // A button that has never been crossed out is written exactly as it was
    // written before this field existed.
    if (draft.negated) target.negated = true;
    else delete target.negated;
    commit();
  };

  return openSheet({
    title: t("ui.app_button_title"),
    pick: {
      symbol: draft.symbol,
      // Seeded with the word already on the button, which is what somebody is
      // most likely looking for a picture of.
      seed: draft.label,
      negated: draft.negated,
      /* Fills an empty label from the collection's own word for the symbol but
       * never writes over one somebody typed - the same rule both editors have
       * always kept, and for the same reason: the symbol may be called
       * "zustimmen" while the button should say "Ja!". */
      onPick: (symbol, caption) => {
        draft.symbol = symbol;
        if (caption && !draft.label.trim()) {
          draft.label = caption;
          labelInput.value = caption;
        }
      },
      onNegate: (negated) => { draft.negated = negated; },
    },
    rows,
    ...(notice ? { notice } : {}),
    /* Only where there is something to delete. On an empty cell the button
     * would close a sheet that had written nothing, which is what the corner
     * and Escape already do.
     *
     * A shared button leaves every page at once, so the button that does it
     * says that rather than "delete this button". Still no question: the
     * notice at the head of the sheet has said what the column is, and putting
     * it back is one press in the cell it came from. */
    ...(held ? {
      remove: {
        label: t(inColumn(at[1]) ? "ui.app_first_column_remove"
                                 : "ui.app_button_remove"),
        onPress: (settle: () => void) => {
          if (inColumn(at[1])) {
            layout.firstColumn = (layout.firstColumn ?? [])
              .filter((one) => one.id !== held.id);
          } else {
            const on = page();
            on.buttons = on.buttons.filter((one) => one.id !== held.id);
          }
          settle();
          commit();
        },
      },
    } : {}),
    next: { label: t("ui.app_button_next"), onPress: keep },
    done: { label: t("ui.done"), onPress: keep },
    // Into the label, because a button somebody has just opened is a button
    // they are about to name.
    focus: labelInput,
  });
}

/**
 * The sheet, and then the next cell's, for as long as somebody keeps pressing
 * "next".
 *
 * This is the property row's one advantage bought back. A board is built in
 * runs - fifteen words onto a page in a sitting - and a sheet that had to be
 * re-opened from the board fourteen more times would be slower than the row it
 * replaced. Reading order, and it stops at the end of the grid rather than
 * wrapping: walking off the last cell back to the first is a surprise, and the
 * board is right there to press.
 */
async function editButton(row: number, col: number): Promise<void> {
  const grid = board().grid;
  let at = (row * grid.columns) + col;
  for (;;) {
    const on = page();
    const [r, c] = [Math.floor(at / grid.columns), at % grid.columns];
    const how = await openButtonSheet(cellHolder(on, r, c) ?? null, [r, c]);
    if (how !== "next" || at + 1 >= grid.rows * grid.columns) break;
    at += 1;
  }
}

/* --- Drawing, and the two controls that are not in a sheet ---------------- */

export function render(): void {
  // A drag does not survive a redraw: the element that carried it is thrown
  // away with the rest of the grid.
  dragging = null;
  const layout = board();
  if (!pageById(layout, here)) here = layout.pages[0]!.id;
  const found = reachable(layout);
  drawPageHead(found);
  drawFacts(found);
  drawGrid();
  /* The list in the sidebar carries which page is open and what each costs,
   * and both change here. It belongs to the shell, so it is asked to repaint
   * rather than reached into - the layers test forbids the other direction. */
  paintPages();
}

/** The panel that holds what is true of the whole Sammlung: how big a page is,
 * how a word class is worn, and what the first column is.
 *
 * Every one of them is one decision for every page, which is why none belongs
 * in the bar over the board where everything else is about the *page* on
 * screen. They share a panel for the same reason they are the same kind of
 * decision: made once, and then in force wherever somebody goes.
 *
 * It was a card of its own behind the ⋯ beside the Sammlung's name, one entry
 * above that Sammlung's settings - two doors to "what is this Sammlung set
 * to", which is one too many. It is a panel in that sheet now, handed over
 * through collectionSheetPanel() because the shell may not import this file.
 * The heading says the size the Sammlung is at, the way every other panel on
 * that sheet states what it is set to.
 *
 * The first column is the newest and the one that most needs the company. It
 * is the same argument the grid size is made with, one column narrower - what
 * a person learns on a board of this kind is where a word *is*, and core words
 * only stay put while every page puts them in the same place. The gap under it
 * is not a second feature but the way that fact is drawn; it sits directly
 * beneath, because a gap switched on over a column that is not shared marks
 * something that is not true.
 *
 * Nothing is written until the button at the foot of the panel is pressed,
 * and that is the one rule this sheet does not otherwise have: every other
 * panel on it applies as it is touched. It has to be. Waiting is what lets the
 * panel say what a smaller grid would cost while the choice is still being
 * made, and it is why the button changes its words - growing or leaving the
 * size alone is an ordinary "apply", and shrinking past something, or taking
 * one page's first column over the rest, is the destructive act the notices
 * above it have just counted. A live-apply grid would throw the buttons away
 * and then mention it.
 *
 * The button is in the panel rather than on the dialog, which is where the
 * settings sheet's one unavoidable Save already sits for the Azure key: a Save
 * on the dialog would speak for the voice and the language too, and both of
 * those are already in force by the time anybody could press it. There is no
 * Cancel for the same reason there is none anywhere else here - the sheet's ✕
 * is the way out, and what is pending lives only in this closure, so closing
 * it is declining it.
 */
function gridPanel(into: HTMLElement,
                   heading: (section: string, state: string) => void): void {
  const layout = board();
  let size: GridSize = { ...layout.grid };
  let colour = wordColor(layout);
  let column = shared(layout);
  let gap = layout.firstColumnGap === true;

  /* What the pending choices would do, applied to a copy.
   *
   * A copy rather than arithmetic over the real layout, because the two
   * destructive halves overlap: a button in another page's first column can
   * *also* be outside a smaller grid, and two sentences each counting it would
   * between them claim two buttons are going when one is. Applying the same
   * sequence apply() will apply, to a throwaway, is the only way to count what
   * actually happens - and the pages are small enough that doing it on every
   * redraw of a card costs nothing worth measuring. */
  const trial = (): { dropped: number; lost: number } => {
    const copy = structuredClone(layout);
    const dropped = share(copy);
    return { dropped, lost: outside(copy, size.rows, size.columns).length };
  };

  /** The first-column half of the pending changes, in the order apply() runs
   *  it: before the resize, so that what the resize then counts is the board
   *  the column has already been made into. Answers how many buttons the
   *  sharing itself took. */
  const share = (into: AppLayout): number => {
    if (column && !shared(into)) {
      // The home page's column, not the page somebody happens to be standing
      // on. This card is opened from the Sammlung's menu and shows no board,
      // so a source that depended on which tab was last pressed would make the
      // same press do different things for a reason nothing here shows. Home
      // is the one page the Sammlung itself names, and the notice names it too.
      return shareFirstColumn(into, into.home).length;
    }
    if (!column && shared(into)) spreadFirstColumn(into);
    return 0;
  };

  const go = document.createElement("button");
  go.type = "button";
  go.onclick = () => {
    // The first column first, then the size: the same order trial() counted
    // in, so that what the notices said is what happens.
    share(layout);
    // resize() is what drops whatever is outside; it is also what clamps a
    // size into the bounds, so it runs whether or not anything moved.
    resize(layout, size.rows, size.columns);
    layout.wordColor = colour;
    // Absent rather than false, so a Sammlung that never asked for the gap
    // stays a Sammlung with no such field - which is what data/app_package.ts
    // reads when it decides whether to write the hint at all.
    if (gap) layout.firstColumnGap = true;
    else delete layout.firstColumnGap;
    commit();
    /* The panel stays where it is, so it is drawn again against what it has
     * just written rather than left showing a pending change that is no longer
     * pending: the heading takes the new size, the notices that counted the
     * cost have nothing left to count, and the button goes back to its
     * ordinary words. The two switches and the colour are already what they
     * were set to; the size and the column are read back off the layout,
     * because resize() clamps and share() is what decides the answer. */
    size = { ...layout.grid };
    column = shared(layout);
    draw();
  };

  // At the foot of the panel, in the row shape every other button on either
  // sheet is in.
  const row = document.createElement("div");
  row.className = "row";
  row.appendChild(go);

  /* Redrawn whole on each choice, because the two things that follow from one
   * are a pressed state somewhere else in the row and a number in a sentence -
   * and threading those through by hand is how a panel comes to disagree with
   * itself. There is nothing to type in here, so there is no caret to lose. */
  const draw = (): void => {
    const why = document.createElement("p");
    why.className = "note";
    why.textContent = t("ui.app_grid_all_pages");

    const { dropped, lost } = trial();
    const body: HTMLElement[] = [why, sizeChoices(size, (picked) => {
      size = picked;
      draw();
    })];

    // The same sentence the question used to ask on its own, said while the
    // choice is still open rather than after it. It names the number, because
    // the buttons that would go may be on a page nobody is looking at.
    if (lost) {
      const notice = document.createElement("div");
      notice.className = "notice bad";
      notice.textContent = t(lost === 1 ? "ui.app_grid_shrink_ask_one"
                                        : "ui.app_grid_shrink_ask",
                             { n: lost, rows: size.rows, cols: size.columns });
      body.push(notice);
    }

    const rule = document.createElement("hr");
    rule.className = "cardrule";
    const what = document.createElement("span");
    what.className = "lbl";
    what.textContent = t("ui.app_word_color");
    body.push(rule, what);

    /* Three alternatives, drawn the way the button sheet draws its four: one
     * radio group, so that which one is in force is said by the markup rather
     * than only by the colour it is drawn in. */
    const choices = document.createElement("div");
    choices.className = "opts";
    choices.setAttribute("role", "radiogroup");
    choices.setAttribute("aria-label", t("ui.app_word_color"));
    for (const one of ["fill", "border", "off"] as const) {
      const opt = document.createElement("label");
      opt.className = "opts__opt";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "appWordColor";
      radio.value = one;
      radio.checked = one === colour;
      const head = document.createElement("b");
      head.textContent = t(`ui.app_word_color_${one}`);
      const note = document.createElement("small");
      note.textContent = t(`ui.app_word_color_${one}_note`);
      opt.append(radio, head, note);
      radio.onchange = () => { if (radio.checked) colour = one; };
      choices.appendChild(opt);
    }
    body.push(choices);

    /* --- the first column ------------------------------------------------ */

    const rule2 = document.createElement("hr");
    rule2.className = "cardrule";
    const which = document.createElement("span");
    which.className = "lbl";
    which.textContent = t("ui.app_first_column");
    body.push(rule2, which);

    /* Two switches rather than one, and the second is only about drawing.
     *
     * They are not the same decision. The column being on every page is what
     * MetaTalk's handbook is describing when it says those keys stay reachable
     * - it is behaviour, and it is what the buttons themselves are. The gap is
     * the mark that says so to somebody looking at the board, and
     * exchange/SPEC.md §4.1 keeps them apart for the same reason: the
     * persistence needs no field because a builder repeats the buttons, and
     * the hint is a hint. Merging them into one switch would make the mark
     * unavailable to a Sammlung that repeats its column by hand, and would
     * make it impossible to see the column plainly for a moment.
     *
     * A checkbox in the shape the three word-colour choices above take, so
     * that the whole card reads as one list of decisions rather than as two
     * kinds of control that happen to share a sheet. */
    const switches = document.createElement("div");
    switches.className = "opts";
    switches.setAttribute("role", "group");
    switches.setAttribute("aria-label", t("ui.app_first_column"));
    const flag = (key: string, on: boolean, set: (on: boolean) => void,
                  note: string): void => {
      const opt = document.createElement("label");
      opt.className = "opts__opt";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = on;
      const head = document.createElement("b");
      head.textContent = t(`ui.${key}`);
      const hint = document.createElement("small");
      hint.textContent = note;
      opt.append(box, head, hint);
      box.onchange = () => { set(box.checked); draw(); };
      switches.appendChild(opt);
    };
    flag("app_first_column_share", column, (on) => { column = on; },
         t("ui.app_first_column_share_note"));
    flag("app_first_column_gap", gap, (on) => { gap = on; },
         t(column ? "ui.app_first_column_gap_note"
                  : "ui.app_first_column_gap_note_alone"));
    body.push(switches);

    /* What taking one page's column over the rest costs, counted while the
     * choice is still open. The same shape the shrink notice takes above, and
     * for the same reason: the columns that go are on pages nobody is looking
     * at, and the start page is named because which page is kept is the whole
     * of what somebody needs to predict here. */
    if (dropped) {
      const notice = document.createElement("div");
      notice.className = "notice bad";
      notice.textContent = t(dropped === 1 ? "ui.app_first_column_take_one"
                                           : "ui.app_first_column_take",
                             { n: dropped });
      body.push(notice);
    }
    // Turning it off costs nothing and says so: the column is written onto
    // every page, which is what the export has been doing with it all along,
    // so every page keeps exactly the buttons it was drawn with.
    if (!column && shared(layout)) {
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.textContent = t("ui.app_first_column_spread");
      body.push(notice);
    }

    body.push(row);
    into.replaceChildren(...body);

    /* The heading says the size the Sammlung *is* at, not the one that is
     * pending: a state line is what a panel would answer folded, and folded
     * there is no pending anything. Which size is picked is said where it is
     * picked, by the pressed option, and what pressing the button would cost
     * is said by the notices between the two. */
    heading(t("ui.app_grid"),
            `${layout.grid.rows} \u00d7 ${layout.grid.columns}`);

    /* Labelled with the act rather than with "OK", and drawn as the danger it
     * is exactly when it is one: the same press applies a colour and throws
     * buttons away, and only the second of those needs saying.
     *
     * Two acts can now be the one that throws them away, and they get
     * different words - "make it smaller" on a press that takes the first
     * column would name the wrong half. The size wins where both are pending,
     * because it is the one whose number is the larger reading of the same
     * press: every button the column costs is already inside the grid, and the
     * notices above have said which number is whose either way. */
    go.className = lost || dropped ? "btn destructive filled" : "btn primary";
    go.textContent = t(lost ? "ui.app_grid_shrink_go"
                       : dropped ? "ui.app_first_column_take_go"
                       : "ui.app_grid_apply");
  };
  draw();
}

export function wireEditor(): () => void {
  /* The page's name is the field that renames it, the way the Sammlung's is
   * one floor up. Typed straight into the page, saved on the debounce that
   * every other field here uses - no sheet, no Fertig, nothing to dismiss. */
  const named = $<HTMLInputElement>("appPageName");
  named.oninput = () => {
    page().name = named.value;
    /* The sidebar row for this page carries the same name, so it is repainted
     * with every keystroke - a handful of rows, and the alternative is a list
     * that disagrees with the field above it until something else happens. */
    paintPages();
    saveSoon();
  };

  $<HTMLButtonElement>("appPageStart").onclick = () => {
    board().home = page().id;
    commit();
  };

  $<HTMLButtonElement>("appPageDelete").onclick = () => {
    void askDelete(page());
  };

  /* The list of pages under the open Sammlung in the sidebar. Handed over
   * rather than drawn here for the reason the grid panel is: the sidebar is
   * the shell's, an editor may import the shell and not the other way round
   * (tests/unit/layers.test.ts), and a talker Sammlung must not be given a
   * list of pages when this editor leaves the page. */
  collectionPages(drawPageList);

  /* The package, as an entry in the ⋯ beside the Sammlung's name. It was a
   * filled button in the work head - see templates/board.ts for what that
   * symmetry was and why it is given up. */
  collectionMenuExtras((add) => {
    add(t("ui.collection_export_this"), () => { void exportApp(); });
  });

  /* The grid is a panel in the sheet behind that same ⋯, and unchanged by any
   * of this. Taken back with the rest when this editor leaves the page: the
   * shell outlives it, and a talker Sammlung must not be offered a grid to
   * resize. */
  collectionSheetPanel(gridPanel);
  return () => {
    collectionPages(null);
    collectionMenuExtras(null);
    collectionSheetPanel(null);
  };
}

/**
 * The pages of the open Sammlung, down the sidebar under its row.
 *
 * **Navigation and nothing else.** No ⋯, no menu, nothing that changes
 * anything: a row is a mark, a name and a number. That is what makes the
 * keyboard behaviour below unambiguous - one row, one stop, one target - and
 * it is why everything that acts on a page sits over the board instead.
 *
 * ⌂ on the start page and ⚠ on a page nothing leads to, both at the left where
 * a column of them can be read down. The number on the right is what the page
 * costs to reach, by effort.ts; it is the only thing here that is not a name,
 * and it is the same number the facts line over the board unfolds.
 */
function drawPageList(into: HTMLElement): void {
  const layout = board();
  const found = reachable(layout);
  const cost = effortByPage(layout);
  into.setAttribute("role", "listbox");
  into.setAttribute("aria-label", t("ui.app_pages_list"));

  layout.pages.forEach((one, at) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "pagelist__item";
    row.setAttribute("role", "option");
    const open = one.id === page().id;
    row.setAttribute("aria-selected", String(open));
    if (open) row.setAttribute("aria-current", "true");
    row.dataset.page = one.id;

    if (one.id === layout.home) {
      const house = document.createElement("span");
      house.className = "pagelist__home";
      house.textContent = "\u2302";
      house.title = t("ui.app_page_home");
      row.appendChild(house);
    }
    if (!found.has(one.id)) {
      const lost = document.createElement("span");
      lost.className = "tab__lost";
      lost.textContent = "\u26a0";
      lost.title = t("ui.app_page_unreachable");
      row.appendChild(lost);
    }
    const name = document.createElement("span");
    name.className = "pagelist__name";
    name.textContent = pageName(one);
    row.appendChild(name);

    const much = document.createElement("span");
    much.className = "pagelist__cost";
    const own = cost.get(one.id);
    much.textContent = own === undefined ? "\u2014" : decimals.format(own);
    row.appendChild(much);

    row.onclick = () => { goToPage(one.id); };
    /* Up and down walk the list, which is what replaces the "previous page"
     * and "next page" a bar would have needed. Bound to the row rather than to
     * the document on purpose: in the name field over the board, and in every
     * other field on this page, those two keys belong to the field. */
    row.onkeydown = (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = layout.pages[at + step];
      if (next) goToPage(next.id);
    };
    into.appendChild(row);
  });

  /* And the way to make one, under the list rather than over the board. It
   * belongs to the set of pages, not to the page on screen, which is the same
   * argument that puts "+ Neue Sammlung" under the list of Sammlungen. */
  const make = document.createElement("button");
  make.type = "button";
  make.className = "pagelist__new";
  make.textContent = t("ui.app_page_new");
  make.onclick = () => {
    const made = addPage(board());
    /* Straight onto it, so the name field over the board is the next thing
     * under the hand - the page was made in order to be filled in. */
    here = made.id;
    unfolded = null;
    wantFocus = false;
    commit();
    $<HTMLInputElement>("appPageName").focus();
  };
  into.appendChild(make);

  /* Keeps the keyboard where it was. goToPage() redraws this list, so the row
   * that had focus is a different element by the time the press is over. */
  if (into.contains(document.activeElement) || wantFocus) {
    wantFocus = false;
    (into.querySelector('.pagelist__item[aria-current="true"]') as HTMLElement | null)
      ?.focus();
  }
}

/** Set where a redraw should put the keyboard back into the list. */
let wantFocus = false;

/**
 * The key a new Sammlung starts with: bottom of the first column, and a way
 * back to the start page.
 *
 * The lower-left corner because that is where a thumb is on a tablet held in
 * two hands, and the first column because that is the column that stays put -
 * a way back that is only on the page you started from is not a way back.
 *
 * `home` rather than a `goto` at whichever page is home today, which is the
 * distinction the target list in the button sheet is made around: the two
 * behave differently the moment somebody makes another page the start page,
 * and a `goto` would stay pointing at the page that *used* to be the start.
 * On a shared button, which is on every page at once, that is the difference
 * between a board with a way home and a board with fifteen ways to one
 * particular page. It exports as §7.4's `action: ":home"`.
 *
 * No word class, and that is a value rather than an omission: the key is
 * navigation, not a word, so there is no Fitzgerald class it could be right
 * about. It carries no vocalization either - a `home` press puts nothing in
 * the bar, so there is nothing for it to have said.
 */
function homeKey(row: number): AppButton {
  const key = blankButton(row, 0);
  // Read at the moment the Sammlung is made, out of the same LANG that
  // blank() writes as the Sammlung's language, so the word on the key and the
  // language of the Sammlung it is on are the one answer.
  key.label = homeWord();
  key.symbol = homeSymbol(homeSymbolSource());
  key.act = { kind: "home" };
  return key;
}

/* What the shell is handed, and the whole of what it may ask for.
 *
 * Seven members, and each one is a question the shell has that only this
 * target can answer - see core/editor.ts. app.ts registers this object against
 * the "app" target; nothing in src/shell/ imports this file, and
 * tests/unit/layers.test.ts is what says so.
 */
export const app: Editor = {
  /* What a new tablet Sammlung starts as: one empty page, on the smallest
   * grid worth having, with the first column already the Sammlung's and a way
   * back to the start page standing in the corner of it. 3x5 rather than 6x11
   * because a first board is big cells and few of them - and because the size
   * is a number now, so growing into the larger one costs nothing.
   *
   * Every value here is a *starting* value and none of them is a constraint.
   * The colour, the shared column, the gap and the size are four presses away
   * in the panel behind the Sammlung's ⋯; the key in the corner is an ordinary
   * button and can be retyped, repointed or deleted like any other. What they
   * are is the answer somebody would otherwise have had to find before their
   * board did anything - a board with no way back from a subpage is the first
   * thing a new Sammlung gets wrong, and it gets it wrong silently.
   *
   * The colour is deliberately not "fill" here, and this is not the same
   * decision as the `?? "fill"` two readers make of a layout that has no such
   * field - see wordColor() above and app_package.ts's. Those two are about a
   * Sammlung drawn before the field existed, which has to keep looking the way
   * it was drawn; this is about a Sammlung being drawn now, which has nothing
   * to keep. So the value is written rather than left to a fallback, and
   * neither fallback moves.
   */
  blank(grid?: GridSize): Layout {
    const first = blankPage();
    // What was chosen while it was being made, or the first of the offered
    // sizes for the callers that make one without asking - the seed a
    // browser with nothing in it gets, and an import.
    const size = grid ? { ...grid } : { rows: GRID.rows, columns: GRID.columns };
    return {
      target: "app",
      // The Sammlung's own language, started off from the language the page is
      // already in and changed in the settings sheet if that guess is wrong.
      // Read at the moment the Sammlung is made rather than captured at module
      // level: LANG is a live binding and a language switch moves it. The same
      // reasoning as editor-diy's.
      language: LANG,
      grid: size,
      pages: [first],
      // No colour by word class. A first board is a handful of keys somebody
      // is still deciding the words for, and a Fitzgerald key that nobody has
      // assigned yet paints every one of them the same - which teaches the
      // colour means nothing. It is one press in the panel once the words are
      // there and the classes are worth telling apart.
      wordColor: "off",
      /* The first column is the Sammlung's from the start, and empty but for
       * the key below.
       *
       * An array rather than an absent field, which is the whole of what
       * "shared" is - see AppLayout.firstColumn. Switching it on afterwards is
       * the one act in that panel that throws buttons away, because by then
       * every page has a first column of its own and only one of them can be
       * kept; switching it on before there is anything to lose costs nothing
       * and is what the offer would have led to anyway.
       */
      firstColumn: [homeKey(size.rows - 1)],
      // Drawn set apart, because it is: those buttons stay put while the pages
      // behind them change, and the gap is how a board says so. It promises
      // nothing untrue here - the column above really is shared.
      firstColumnGap: true,
      home: first.id,
    };
  },

  /* A different Sammlung is in force. Back to its own home page rather than
   * clamped to wherever the last one was standing rather than at whichever
   * page the Sammlung before it happened to be open at. */
  adopt(): void {
    here = isApp(state.layout) ? state.layout.home : "";
    render();
  },

  render,

  /* A sentence somebody actually wrote, from the page on screen, so that
   * trying a voice out is heard on the content rather than on a specimen. What
   * a button *says* rather than what it shows - that is the text the voice
   * will be used on. */
  sample(): string {
    const held = page().buttons.find(
      (one) => (one.vocalization || one.label).trim());
    return held ? (held.vocalization || held.label).trim() : "";
  },

  /* Buttons, across every page.
   *
   * Not pages, and that is the interesting half. conventions.md §1.8 gives the
   * count two jobs - telling two similarly named Sammlungen apart, and making
   * the delete question credible before it is asked - and a page count does
   * neither: it reads 3, then 4, for weeks. Buttons differ from the first
   * afternoon, and "63 Tasten" is the sentence that could change somebody's
   * mind, because sixty-three buttons is the work. Each one carries a label, a
   * symbol, a colour and a recording; four pages is filing.
   *
   * The talker counts sets instead, and that is not an inconsistency: a set is
   * a fixed four keys there, so sets and work move together. A page here holds
   * anything between nothing and sixty-six. */
  count(layout: Layout): number {
    if (!isApp(layout)) return 0;
    /* The shared first column adds its own length once, not once per page.
     *
     * That is the count's own argument turned on the one case that could
     * break it: the number is here to say how much work is in a Sammlung, and
     * a persistent column is authored once however many pages it is drawn on.
     * Counting it per page would put eight buttons of credit on a Sammlung
     * holding two, grow that inflation with every page added, and make the
     * delete question overstate what is about to go - which is the one thing
     * conventions.md §1.8 asks this number to be honest about. */
    return (layout.pages ?? []).reduce(
      (total, one) => total + (one.buttons?.length ?? 0), 0)
      + (layout.firstColumn?.length ?? 0);
  },

  unit: "button",

  /* The fixed words on the controls this editor owns, re-read on every
   * language switch like every other label. Only the ones in the markup:
   * everything the panel and the grid draw is built fresh by render(), which
   * reads the table as it goes. */
  labels(): void {
    status("");
  },
};
