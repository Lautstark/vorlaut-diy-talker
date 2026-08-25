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
import { $, status } from "../shell/dom.js";
import { symbolInto } from "../backend/index.js";
import { state } from "../core/state.js";
import type { Editor } from "../core/editor.js";
import { isApp } from "../core/types.js";
import type {
  Act, AppButton, AppLayout, AppPage, GridSize, Layout, WordColor,
} from "../core/types.js";
import { GRID, LANG, WORD_CLASSES } from "../core/boot.js";
import { t } from "../core/texts.js";
import { save } from "../core/save.js";
import { speak } from "../shell/speech.js";
import { confirmDialog, openDialog } from "@lautstark/design/dialog";
/* The sheet is the shell's now, and the whole of what this file hands it is a
 * title, a picture, some rows and three labelled things to do. It was written
 * here, and moving it is what let the talker have the same one: an editor may
 * not import out of another editor - tests/unit/layers.test.ts - so anything
 * genuinely shared between the two belongs in the shell. */
import { dropdown, formRow, hint, missing, openSheet, textField }
  from "../shell/sheet.js";
import type { Choice, Left } from "../shell/sheet.js";
import { collectionMenuExtras, exportApp, sizeChoices }
  from "../shell/collections.js";
import {
  addPage, blankButton, blankPage, buttonAt, deletePage, inboundTo, isShared,
  moveButton, moveShared, outside, pageById, reachable, resize,
  shareFirstColumn, shared, sharedAt, spreadFirstColumn,
} from "./pages.js";

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
  void save();
}

/* --- The page strip ------------------------------------------------------ */

function drawPages(): void {
  const layout = board();
  const strip = $("appPages");
  strip.innerHTML = "";
  const found = reachable(layout);

  layout.pages.forEach((one, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab";
    tab.classList.toggle("current", one.id === page().id);
    tab.setAttribute("aria-current", one.id === page().id ? "true" : "false");
    if (one.id === layout.home) {
      const home = document.createElement("span");
      home.className = "tab__home";
      home.textContent = "⌂";
      home.title = t("ui.app_page_home");
      tab.appendChild(home);
    }
    // A mark rather than a hiding. Nothing leads here yet is an ordinary state
    // - it is what every page is between being made and being linked - and the
    // page nobody can reach is the one somebody most needs to open.
    if (!found.has(one.id)) {
      const lost = document.createElement("span");
      lost.className = "tab__lost";
      lost.textContent = "⚠";
      lost.title = t("ui.app_page_unreachable");
      tab.appendChild(lost);
    }

    const name = document.createElement("span");
    name.textContent = one.name || t("ui.app_page_n", { n: index + 1 });
    tab.appendChild(name);

    /* The way into the page itself, on the tab that is already open.
     *
     * A page has no cell on a tablet - its name and its start-page-ness belong
     * to nothing on the board - so the current tab is the thing they can be
     * pressed on. The same `...` the work head uses for a Sammlung, one level
     * down, on the thing it acts on.
     *
     * A <span> wearing role="button" rather than a <button>, for the reason
     * opener() gives: its parent is a <button> already, and a control inside a
     * control is invalid markup that no keyboard can reach the inner half of.
     * So the two things the element would have brought - a place in the tab
     * order and acting on Enter and Space - are written out here.
     *
     * Every tab gets the element and only the current one gets the control.
     * The strip reflowed on every page change otherwise - one tab grew a `...`
     * as another lost one, and every tab to the right of them slid - which is
     * a moving target in the one row somebody is aiming at. The reserved
     * copies are `visibility: hidden`, so they hold the width and are in
     * neither the accessibility tree nor the tab order. */
    const more = document.createElement("span");
    more.className = "tab__more";
    more.textContent = "\u22ef";
    if (one.id === page().id) {
      more.setAttribute("role", "button");
      more.tabIndex = 0;
      more.setAttribute("aria-label", t("ui.app_page_more"));
      const open = (event: Event) => {
        // Or the press falls through to the tab, which would redraw the strip
        // out from under the sheet that is opening.
        event.stopPropagation();
        void openPageSheet(one);
      };
      more.onclick = open;
      more.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(event);
      };
    } else {
      more.classList.add("tab__more--idle");
      more.setAttribute("aria-hidden", "true");
    }
    tab.appendChild(more);

    tab.onclick = () => { here = one.id; render(); };
    strip.appendChild(tab);
  });
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

  if (held.symbol) {
    const image = document.createElement("img");
    image.className = "cell__pic";
    symbolInto(image, held.symbol);
    // Two different absences, and the words point at different remedies. The
    // reading is shell/sheet.ts's, because the sheet's own preview and both
    // editors' cells all have to make it and it was three copies of one
    // sentence-picking rule.
    image.onerror = () => { image.replaceWith(missing(held.symbol)); };
    box.appendChild(image);
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
   * Only where there is something to say. A navigation button and the four bar
   * controls speak nothing when pressed on the tablet, so offering to audition
   * them would be offering silence. */
  const saying = (held.vocalization || held.label).trim();
  if (saying && (held.act.kind === "append" || held.act.kind === "speak")) {
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
    case "goto": return "→";
    case "speak": return "🔊";
    case "clear": return "✕";
    case "backspace": return "⌫";
    case "sayBar": return "▶";
    case "home": return "⌂";
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
 * The page itself: its name, whether it is the start page, and deleting it.
 *
 * Reached from the `...` on the current tab, because a page has no cell on a
 * tablet - its name belongs to nothing on the board - so the tab is the thing
 * it can be pressed on.
 *
 * Two variants rather than a control that would do nothing: on any other page
 * the sheet offers "make this the start page", and on the start page it says
 * that it already is. Deleting works either way - deletePage() moves home to
 * the first page left - and the sentence under the notice says so, because
 * that is the part somebody standing here cannot see.
 */
function openPageSheet(on: AppPage): Promise<void> {
  const layout = board();

  let name = on.name;
  // Drafted like the name beside it. Pressing it on a page that is not home
  // swaps this row for the notice, so the sheet says what it will be once
  // Fertig is pressed - and dismissing leaves home where it was.
  let makeHome = false;

  const pageName = textField(name, (value) => { name = value; });
  pageName.id = "appPageName";

  // Rebuilt in place rather than redrawn whole: the name field above is being
  // typed in, and replacing the form would take the caret with it.
  const homeRow = document.createElement("div");
  const drawHome = () => {
    homeRow.innerHTML = "";
    if (on.id === layout.home || makeHome) {
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.textContent = t("ui.app_page_home_is");
      homeRow.appendChild(formRow("", notice, t("ui.app_page_home_is_note")));
      return;
    }
    const make = document.createElement("button");
    make.type = "button";
    make.className = "btn";
    make.textContent = t("ui.app_page_home_set");
    make.onclick = () => { makeHome = true; drawHome(); };
    homeRow.appendChild(formRow("", make, t("ui.app_page_home_note")));
  };
  drawHome();

  /* No picture column: a page on a tablet has none. That is also what makes
   * this the narrower sheet - see openSheet, which takes the single-column
   * shape when there is nothing to show. The talker's own page card *does*
   * have one, because its page has a key on the device that shows a picture. */
  return openSheet({
    title: t("ui.app_page_title"),
    rows: [
      formRow(t("ui.app_page_name"), pageName, t("ui.app_page_name_note")),
      homeRow,
    ],
    remove: {
      label: t("ui.app_page_delete"),
      // The question is askDelete's, and it draws a dialog of its own over
      // this one. Only a yes closes this sheet, because a no leaves somebody
      // exactly where they were.
      onPress: (settle) => {
        void askDelete(on).then((gone) => { if (gone) settle(); });
      },
    },
    done: {
      label: t("ui.done"),
      onPress: () => {
        on.name = name;
        if (makeHome) layout.home = on.id;
        commit();
      },
    },
  }).then(() => undefined);
}

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
  wordClass: string;
  act: Act;
}

/** The three kinds the sheet offers, which are not the seven the union holds.
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
 */
type Does = "word" | "shout" | "goto";

/** Which kind an act reads as, or null for one of the three bar controls the
 *  sheet no longer offers. The sheet keeps such a button saying what it is
 *  rather than letting it re-read as the first kind in the list. */
const doesOf = (act: Act): Does | null =>
  act.kind === "append" ? "word"
  : act.kind === "speak" ? "shout"
  : act.kind === "goto" || act.kind === "home" ? "goto"
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
        wordClass: held.wordClass, act: held.act }
    : { label: "", vocalization: "", symbol: "", wordClass: "",
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
   * height at all. */
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
  const kinds: Choice[] = (["word", "shout", "goto"] as const)
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
  const does = dropdown(kinds, chose ?? draft.act.kind, () => { chosen(); });
  does.button.id = "appDoes";
  /* The note sits beside the trigger rather than under it, which is what the
   * trigger being a button rather than a full-width field buys: "Ausruf" is
   * three quarters of an empty line, and the sentence that tells it from
   * "Wort" is the one thing on this row that has to be read. */
  const actRow = formRow(t("ui.app_button_act"), does.anchor, "", does.button);
  actRow.classList.add("form__row--beside");
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
  const leadsTo = (): Act => targets.value === GOTO_HOME
    ? { kind: "home" }
    : { kind: "goto", page: targets.value === GOTO_NEW ? "" : targets.value };
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
  spoken.placeholder = t("ui.app_button_spoken_hint");
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
  const spokenRow = formRow(t("ui.app_button_spoken"), withPlay, "", spoken.id);
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
   * Wortart stays for all three, which looks like an oversight and is not. A
   * page-leading button is coloured as a category on real German boards, and
   * BuilderTabletPackageTest asserts exactly that of the navigating button in
   * the round-trip sample - #D8AF97, the category colour.
   *
   * Nothing is cleared on a change of act. The draft is a copy that reaches
   * the layout only on Fertig, so what somebody typed before changing their
   * mind is still there if they change it back.
   */
  const follow = () => {
    const goes = does.value === "goto";
    const speaks = does.value === "word" || does.value === "shout";
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
      : does.value === "goto" ? leadsTo()
      : { kind: does.value } as Act;
    wantsNewPage = does.value === "goto" && targets.value === GOTO_NEW;
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
      draft.act = { kind: "goto", page: addPage(layout, draft.label.trim()).id };
    } else if (draft.act.kind === "goto" && !draft.act.page) {
      draft.act = { kind: "goto", page: page().id };
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
    commit();
  };

  return openSheet({
    title: t("ui.app_button_title"),
    pick: {
      symbol: draft.symbol,
      // Seeded with the word already on the button, which is what somebody is
      // most likely looking for a picture of.
      seed: draft.label,
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
  drawPages();
  drawGrid();
}

/** The card that holds what is true of the whole Sammlung: how big a page is,
 * how a word class is worn, and what the first column is.
 *
 * Every one of them is one decision for every page, which is why none belongs
 * in the bar over the board where everything else is about the *page* on
 * screen. They share a card for the same reason they are the same kind of
 * decision: made once, and then in force wherever somebody goes.
 *
 * The first column is the newest and the one that most needs the company. It
 * is the same argument the grid size is made with, one column narrower - what
 * a person learns on a board of this kind is where a word *is*, and core words
 * only stay put while every page puts them in the same place. The gap under it
 * is not a second feature but the way that fact is drawn; it sits directly
 * beneath, because a gap switched on over a column that is not shared marks
 * something that is not true.
 *
 * Nothing is written until the footer is pressed. That is what lets the card
 * say what a smaller grid would cost while the choice is still being made -
 * and it is why the footer button changes: growing or leaving the size alone
 * is an ordinary "apply", and shrinking past something, or taking one page's
 * first column over the rest, is the destructive act the notices above it have
 * just counted.
 */
function openGrid(): void {
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

  const cancel = document.createElement("button");
  cancel.className = "btn quiet";
  cancel.type = "button";
  cancel.textContent = t("ui.cancel");
  cancel.onclick = () => sheet.close();

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
    sheet.close();
    commit();
  };

  const sheet: ReturnType<typeof openDialog> = openDialog({
    title: t("ui.app_grid"),
    closeLabel: t("ui.close"),
    body: [],
    footer: [cancel, go],
  });

  /* Redrawn whole on each choice, because the two things that follow from one
   * are a pressed state somewhere else in the row and a number in a sentence -
   * and threading those through by hand is how a card comes to disagree with
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
    const does = document.createElement("div");
    does.className = "does";
    does.setAttribute("role", "radiogroup");
    does.setAttribute("aria-label", t("ui.app_word_color"));
    for (const one of ["fill", "border", "off"] as const) {
      const opt = document.createElement("label");
      opt.className = "does__opt";
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
      does.appendChild(opt);
    }
    body.push(does);

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
    switches.className = "does";
    switches.setAttribute("role", "group");
    switches.setAttribute("aria-label", t("ui.app_first_column"));
    const flag = (key: string, on: boolean, set: (on: boolean) => void,
                  note: string): void => {
      const opt = document.createElement("label");
      opt.className = "does__opt";
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

    sheet.body.replaceChildren(...body);

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
  $<HTMLButtonElement>("appPageNew").onclick = () => {
    const made = addPage(board());
    here = made.id;
    commit();
  };

  $<HTMLButtonElement>("appExport").onclick = () => { void exportApp(); };

  /* The card is opened from the menu beside the Sammlung's name, which is the
   * shell's - so the entry is handed over rather than drawn here. Taken back
   * when this editor leaves the page: the shell outlives it, and a talker
   * Sammlung must not be offered a grid to resize. */
  collectionMenuExtras((add) => add(t("ui.app_grid"), openGrid));
  return () => collectionMenuExtras(null);
}

/* What the shell is handed, and the whole of what it may ask for.
 *
 * Seven members, and each one is a question the shell has that only this
 * target can answer - see core/editor.ts. app.ts registers this object against
 * the "app" target; nothing in src/shell/ imports this file, and
 * tests/unit/layers.test.ts is what says so.
 */
export const app: Editor = {
  /* What a new tablet Sammlung starts as: one empty page, at the first colour
   * of the palette, on the smallest grid worth having. 3x5 rather than 6x11
   * because a first board is big cells and few of them - and because the size
   * is a number now, so growing into the larger one costs nothing. */
  blank(grid?: GridSize): Layout {
    const first = blankPage();
    return {
      target: "app",
      // The Sammlung's own language, started off from the language the page is
      // already in and changed in the settings sheet if that guess is wrong.
      // Read at the moment the Sammlung is made rather than captured at module
      // level: LANG is a live binding and a language switch moves it. The same
      // reasoning as editor-diy's.
      language: LANG,
      // What was chosen while it was being made, or the first of the offered
      // sizes for the callers that make one without asking - the seed a
      // browser with nothing in it gets, and an import.
      grid: grid ? { ...grid } : { rows: GRID.rows, columns: GRID.columns },
      pages: [first],
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
    $<HTMLButtonElement>("appPageNew").textContent = t("ui.app_page_new");
    $<HTMLButtonElement>("appExport").textContent = t("ui.package_export");
    status("");
  },
};
