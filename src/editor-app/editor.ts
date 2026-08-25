// The tablet editor: the page strip, the grid, and the panel for one button.
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
import { $, say, status } from "../shell/dom.js";
import { symbolInto } from "../backend/index.js";
import { state } from "../core/state.js";
import type { Editor } from "../core/editor.js";
import { isApp } from "../core/types.js";
import type {
  Act, AppButton, AppLayout, AppPage, GridSize, Layout, WordColor,
} from "../core/types.js";
import { GRID, LANG, WORD_CLASSES } from "../core/boot.js";
import { t } from "../core/texts.js";
import { reason } from "../core/errors.js";
import { save } from "../core/save.js";
import { findSymbols, takeSymbol, uploadOwn } from "../shell/picker.js";
import type { SymbolHit } from "../shell/picker.js";
import { speak } from "../shell/speech.js";
import { confirmDialog, openDialog } from "@lautstark/design/dialog";
import { collectionMenuExtras, exportApp, sizeChoices }
  from "../shell/collections.js";
import {
  addPage, blankButton, blankPage, buttonAt, deletePage, inboundTo, moveButton,
  outside, pageById, reachable, resize,
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
     * order and acting on Enter and Space - are written out here. */
    if (one.id === page().id) {
      const more = document.createElement("span");
      more.className = "tab__more";
      more.setAttribute("role", "button");
      more.tabIndex = 0;
      more.setAttribute("aria-label", t("ui.app_page_more"));
      more.textContent = "\u22ef";
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
      tab.appendChild(more);
    }

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

  for (let row = 0; row < layout.grid.rows; row++) {
    for (let col = 0; col < layout.grid.columns; col++) {
      grid.appendChild(cell(page(), row, col));
    }
  }
}

/** Every cell is a drop target, filled or not: dropping onto an empty one is
 *  a move and onto a full one is a swap, and both are the same gesture. */
function acceptsDrop(box: HTMLElement, on: AppPage, row: number, col: number): void {
  box.ondragover = (event) => {
    if (dragging === null) return;
    const already = buttonAt(on, row, col);
    if (already && already.id === dragging) return;
    // Only a prevented dragover marks an element as a drop target at all.
    event.preventDefault();
    box.classList.add("dragover");
  };
  box.ondragleave = () => box.classList.remove("dragover");
  box.ondrop = (event) => {
    event.preventDefault();
    clearDragMarks();
    if (dragging === null) return;
    const id = dragging;
    dragging = null;
    moveButton(on, id, row, col);
    commit();
  };
}

function clearDragMarks(): void {
  for (const one of document.querySelectorAll(".appcell.dragover")) {
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
  hit.className = "appcell__open";
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
  const held = buttonAt(on, row, col);
  /* The cell is a box, not a control. It holds two controls side by side: one
   * filling it, and - once there is something to hear - one in the corner that
   * plays. Nesting the second inside the first would be a control inside a
   * control, which no keyboard can reach and no markup validator allows. */
  const box = document.createElement("div");
  box.className = "appcell";
  acceptsDrop(box, on, row, col);

  if (!held) {
    box.classList.add("appcell--empty");
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
  // picture would have had. The class carries it; see .appcell--words.
  box.classList.toggle("appcell--words", !held.symbol);
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
    symbolInto(image, held.symbol);
    // Two different absences, and the words point at different remedies - the
    // same reading editor-diy makes of the same two cases.
    image.onerror = () => {
      image.replaceWith(mark(held.symbol.startsWith("metacom:")
        ? t("ui.symbol_needs_folder") : t("ui.symbol_missing")));
    };
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
    tag.className = "appcell__act";
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
    play.className = "appcell__play";
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
    moveButton(on, held.id, to[0], to[1]);
    commit();
    // render() rebuilt every cell, so the element that had focus is gone. It
    // follows the button rather than staying at the coordinate, which is what
    // makes a run of presses move one thing across the board.
    ($("appGrid").children[(to[0] * grid.columns) + to[1]]
      ?.querySelector(".appcell__open") as HTMLElement)?.focus();
  };
  return box;
}

/** The word on a cell. One maker, kept as one now that it has a single caller:
 *  it was two because paintCell() also had to put a word there as it was typed
 *  into the panel, and the panel and its live redraw are both gone. */
function wordSpan(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "appcell__label";
  span.textContent = text;
  return span;
}

function mark(text: string): HTMLElement {
  const line = document.createElement("span");
  line.className = "blank";
  line.textContent = text;
  return line;
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
 * which is no less true of an existing button. The panel wrote as you typed
 * because it was always on screen and there was nothing to dismiss.
 *
 * **Each promise settles from the presses, with a guard.** design.md §3.4, and
 * the comment in shell/collections.ts's askTarget() is where the reasoning is
 * written out: `close` is what a *host* fires, and a host that hides a dialog
 * without firing it would leave the promise pending for the life of the page -
 * a button that did nothing, with no error anywhere. So the presses resolve for
 * themselves and `close` only carries the dismissal.
 */

/** How a sheet was left. `null` is every way out that wrote nothing. */
type Left = "done" | "next" | null;

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
  return new Promise((resolve) => {
    const layout = board();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
      // After resolving, so a close event arriving as a consequence of this
      // call finds the guard already set.
      sheet?.close();
    };

    let name = on.name;
    // Drafted like the name beside it. Pressing it on a page that is not home
    // swaps this row for the notice, so the sheet says what it will be once
    // Fertig is pressed - and dismissing leaves home where it was.
    let makeHome = false;

    const form = document.createElement("div");
    form.className = "form";

    const pageName = textField(name, (value) => { name = value; });
    pageName.id = "appPageName";
    form.appendChild(formRow(t("ui.app_page_name"), pageName,
                             t("ui.app_page_name_note")));

    // Rebuilt in place rather than redrawn whole: the name field above is
    // being typed in, and replacing the form would take the caret with it.
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
    form.appendChild(homeRow);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn destructive";
    remove.textContent = t("ui.app_page_delete");
    remove.onclick = () => {
      // The question is askDelete's, and it draws a dialog of its own over
      // this one. Only a yes closes this sheet, because a no leaves somebody
      // exactly where they were.
      void askDelete(on).then((gone) => { if (gone) finish(); });
    };

    const done = document.createElement("button");
    done.type = "button";
    done.className = "btn primary";
    done.textContent = t("ui.app_done");
    done.onclick = () => {
      on.name = name;
      if (makeHome) layout.home = on.id;
      finish();
      commit();
    };

    const right = document.createElement("span");
    right.className = "foot__right";
    right.appendChild(done);

    const sheet: ReturnType<typeof openDialog> | undefined = openDialog({
      title: t("ui.app_page_title"),
      closeLabel: t("ui.close"),
      body: [form],
      footer: [remove, right],
      onClose: finish,
    });
    // Two columns are the button sheet's; a page has one thing to say, so the
    // narrower sheet the mock draws is what this one takes.
    sheet.dialog.classList.add("sheet--button", "sheet--page");
  });
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

/** The four kinds the sheet offers, which are not the seven the union holds.
 *
 * A relabelling and nothing else - `Act` is unchanged and so is everything in
 * data/app_package.ts. The old list mixed two different questions, what a word
 * does and what a bar control does, and put them in one dropdown where they
 * read as alternatives to each other. Worse, its first two named a distinction
 * that does not exist: "In die Satzleiste" against "Sofort sprechen" says one
 * of them speaks and the other does not, and vorlaut-app's BoardViewModel
 * calls utter() for `append` *and* `speak`. Both speak. The only difference is
 * whether the word joins the sentence, which is what the labels now say.
 */
type Does = "word" | "shout" | "goto" | "bar";

/** The four sentence-bar controls, which are one kind here and four acts on
 *  the wire - exchange/SPEC.md §7.4. */
const BAR_KINDS = ["sayBar", "backspace", "clear", "home"] as const;

const doesOf = (act: Act): Does =>
  act.kind === "append" ? "word"
  : act.kind === "speak" ? "shout"
  : act.kind === "goto" ? "goto"
  : "bar";

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
  return new Promise((resolve) => {
    const layout = board();
    let settled = false;
    const finish = (how: Left) => {
      if (settled) return;
      settled = true;
      resolve(how);
      sheet?.close();
    };

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
     * option was chosen. The panel minted immediately and took the label it
     * had, which was usually the empty one. */
    let wantsNewPage = false;

    /* --- the picture, its search and the upload --- */

    const pick = document.createElement("div");
    pick.className = "pick";

    const preview = document.createElement("div");
    const drawPreview = () => {
      preview.innerHTML = "";
      preview.className = "pick__preview";
      if (!draft.symbol) {
        preview.classList.add("pick__preview--none");
        preview.setAttribute("role", "img");
        preview.setAttribute("aria-label", t("ui.app_symbol_none"));
        preview.innerHTML =
          `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18"`
          + ` height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/>`
          + `<path d="M21 16l-5-5-5 5-3-3-5 5"/></svg>`;
        return;
      }
      preview.removeAttribute("role");
      preview.removeAttribute("aria-label");
      const image = document.createElement("img");
      image.alt = "";
      symbolInto(image, draft.symbol);
      // Two different absences, and the words point at different remedies -
      // the same reading the cell behind this sheet makes of the same two
      // cases. Not the "no picture yet" glyph: there is one, and saying there
      // is not would send somebody to pick a second.
      image.onerror = () => {
        image.replaceWith(mark(draft.symbol.startsWith("metacom:")
          ? t("ui.symbol_needs_folder") : t("ui.symbol_missing")));
      };
      preview.appendChild(image);
    };
    drawPreview();
    pick.appendChild(preview);

    const query = document.createElement("input");
    query.type = "search";
    query.className = "field";
    query.autocomplete = "off";
    query.placeholder = t("ui.app_symbol_search");
    query.setAttribute("aria-label", t("ui.app_symbol_search"));
    // Seeded with the word already on the button, which is what somebody is
    // most likely looking for a picture of.
    query.value = draft.label.trim();
    pick.appendChild(query);

    const results = document.createElement("div");
    results.className = "pick__results";
    pick.appendChild(results);

    /** A chosen picture, however it was chosen. Fills an empty label from the
     *  collection's own word for the symbol but never writes over one somebody
     *  typed - the same rule both editors have always kept, and for the same
     *  reason: the symbol may be called "zustimmen" while the button should
     *  say "Ja!". */
    const took = (symbol: string, caption: string) => {
      draft.symbol = symbol;
      if (caption && !draft.label.trim()) {
        draft.label = caption;
        labelInput.value = caption;
      }
      drawPreview();
      drawResults();
    };

    let hits: SymbolHit[] = [];
    const drawResults = () => {
      results.innerHTML = "";
      for (const hit of hits) {
        const one = document.createElement("button");
        one.type = "button";
        one.className = "pick__hit";
        // The hint tells twins apart - four METACOM tiles captioned "ja"
        // differ only by picture - and is display only, never the reference.
        one.setAttribute("aria-label",
          hit.label + ("hint" in hit && hit.hint ? ` - ${hit.hint}` : ""));
        const image = document.createElement("img");
        image.src = hit.url;
        image.loading = "lazy";
        image.alt = "";
        one.appendChild(image);
        one.onclick = () => {
          status(t(hit.source === "metacom" ? "ui.taking_symbol" : "ui.loading_symbol"));
          void takeSymbol(hit).then(
            (taken) => { took(taken.symbol, taken.label); status(""); },
            (error: unknown) => status(t("ui.symbol_failed", { error: reason(error) })));
        };
        results.appendChild(one);
      }
    };

    // So a slow answer cannot overtake a newer one. The sheet's own, because
    // the sheet is its own search: the picker dialog is not open behind it.
    let token = 0;
    const search = () => {
      const word = query.value.trim();
      if (!word) return;
      const mine = ++token;
      say(results, t("ui.searching"));
      void findSymbols(word).then((answer) => {
        if (mine !== token) return;
        hits = answer.hits;
        drawResults();
        // Both silences - a word the collection does not have, and a browser
        // that never managed to ask - come back as a sentence from the seam.
        if (answer.empty) say(results, answer.empty);
      });
    };
    query.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      // The sheet is not a form, but Enter in a search field inside a dialog
      // is otherwise the browser's own way to close it.
      event.preventDefault();
      search();
    };

    /* Somebody's own picture, reached from inside the sheet rather than by
     * opening the picker dialog on top of it. A modal over a modal to choose a
     * symbol is the second dialog this design set out to remove. */
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.hidden = true;
    file.onchange = () => {
      const chose = file.files?.[0];
      file.value = "";
      if (!chose) return;
      status(t("ui.uploading"));
      void uploadOwn(chose).then(
        (symbol) => { took(symbol, ""); status(t("ui.upload_done")); },
        (error: unknown) => status(t("ui.upload_failed", { error: reason(error) })));
    };
    const own = document.createElement("button");
    own.type = "button";
    own.className = "btn quiet";
    own.textContent = t("ui.app_symbol_own");
    own.onclick = () => file.click();
    pick.append(own, file);

    /* --- the fields --- */

    const form = document.createElement("div");
    form.className = "form";

    const labelInput = textField(draft.label, (value) => { draft.label = value; });
    labelInput.id = "appLabel";
    labelInput.placeholder = t("ui.app_button_label_hint");
    form.appendChild(formRow(t("ui.app_button_label"), labelInput,
                         t("ui.app_button_label_note")));

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
    // and the label where there is not - exchange/SPEC.md §7.2's rule, said
    // out loud rather than described.
    play.onclick = () => {
      const saying = (draft.vocalization || draft.label).trim();
      if (saying) void speak(saying, play);
    };
    const withPlay = document.createElement("div");
    withPlay.className = "form__withplay";
    withPlay.append(spoken, play);
    form.appendChild(formRow(t("ui.app_button_spoken"), withPlay, "", spoken.id));

    const classes = document.createElement("select");
    classes.className = "field";
    classes.id = "appClass";
    classes.append(option("", t("ui.wordclass_none")));
    for (const one of WORD_CLASSES) {
      classes.append(option(one.key, t(`ui.wordclass_${one.key}`)));
    }
    classes.value = draft.wordClass;
    classes.onchange = () => { draft.wordClass = classes.value; };
    form.appendChild(formRow(t("ui.app_button_class"), classes));

    /* --- what a press does --- */

    const does = document.createElement("div");
    does.className = "does";
    does.setAttribute("role", "radiogroup");
    /** Which page a navigation button leads to, and the four bar controls:
     *  what a choice needs once it is chosen, tucked under it rather than in a
     *  fifth control that is dead most of the time. */
    const more: Partial<Record<Does, HTMLElement>> = {};

    const targets = document.createElement("select");
    targets.className = "field";
    targets.id = "appGoto";
    for (const [index, one] of layout.pages.entries()) {
      targets.append(option(one.id, one.name || t("ui.app_page_n", { n: index + 1 })));
    }
    targets.append(option("+", t("ui.app_goto_new")));
    targets.setAttribute("aria-label", t("ui.app_goto_page"));
    targets.value = draft.act.kind === "goto" && draft.act.page ? draft.act.page : page().id;
    targets.onchange = () => {
      wantsNewPage = targets.value === "+";
      draft.act = { kind: "goto", page: wantsNewPage ? "" : targets.value };
    };
    more.goto = targets;

    const bar = document.createElement("select");
    bar.className = "field";
    bar.id = "appBar";
    for (const kind of BAR_KINDS) bar.append(option(kind, t(`ui.app_act_${actKey(kind)}`)));
    bar.setAttribute("aria-label", t("ui.app_does_bar_which"));
    bar.value = doesOf(draft.act) === "bar" ? draft.act.kind : "sayBar";
    bar.onchange = () => { draft.act = { kind: bar.value } as Act; };
    more.bar = bar;

    const chose = doesOf(draft.act);
    for (const kind of ["word", "shout", "goto", "bar"] as const) {
      const opt = document.createElement("label");
      opt.className = "does__opt";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "appDoes";
      radio.value = kind;
      radio.id = `appDoes_${kind}`;
      radio.checked = kind === chose;
      const head = document.createElement("b");
      head.textContent = t(`ui.app_does_${kind}`);
      const note = document.createElement("small");
      note.textContent = t(`ui.app_does_${kind}_note`);
      opt.append(radio, head, note);
      if (more[kind]) {
        const box = document.createElement("span");
        box.className = "does__more";
        box.appendChild(more[kind]!);
        opt.appendChild(box);
      }
      radio.onchange = () => {
        if (!radio.checked) return;
        // A `goto` is never left pointing at nothing: a button with no target
        // exports as an ordinary appending button, which is not what the list
        // said was chosen. So it takes whatever the target select is standing
        // on, which is the current page until somebody changes it.
        draft.act = kind === "word" ? { kind: "append" }
          : kind === "shout" ? { kind: "speak" }
          : kind === "goto" ? { kind: "goto", page: targets.value === "+" ? "" : targets.value }
          : { kind: bar.value } as Act;
        wantsNewPage = kind === "goto" && targets.value === "+";
      };
      does.appendChild(opt);
    }
    form.appendChild(formRow(t("ui.app_button_act"), does));

    /* --- the foot --- */

    /** The draft, written where it belongs. Everything the sheet changed lands
     *  in one press, including the button's own existence. */
    const keep = () => {
      if (draft.act.kind === "goto" && wantsNewPage) {
        // Named from the label as it finally reads. The authoring move is
        // "this button should lead somewhere new", and making somebody leave,
        // make a page, come back and select it is one thought in three steps.
        draft.act = { kind: "goto", page: addPage(layout, draft.label.trim()).id };
      } else if (draft.act.kind === "goto" && !draft.act.page) {
        draft.act = { kind: "goto", page: page().id };
      }
      const on = page();
      const target = held ?? blankButton(at[0], at[1]);
      if (!held) on.buttons.push(target);
      Object.assign(target, {
        label: draft.label, vocalization: draft.vocalization,
        symbol: draft.symbol, wordClass: draft.wordClass, act: draft.act,
      });
    };

    const foot: HTMLElement[] = [];
    // Only where there is something to delete. On an empty cell the button
    // would close a sheet that had written nothing, which is what the corner
    // and Escape already do.
    if (held) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn destructive";
      remove.textContent = t("ui.app_button_remove");
      // No question. What goes is one button on the page somebody is looking
      // at, and putting it back is one press in the cell it came from - which
      // is a smaller act than the dialog would be.
      remove.onclick = () => {
        const on = page();
        on.buttons = on.buttons.filter((one) => one.id !== held.id);
        finish("done");
        commit();
      };
      foot.push(remove);
    } else {
      // The foot puts the destructive act on the left and the confirming one
      // on the right; with nothing on the left the spacer is what keeps the
      // right where it is on every other sheet.
      const spacer = document.createElement("span");
      foot.push(spacer);
    }

    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn quiet";
    next.textContent = t("ui.app_button_next");
    next.onclick = () => { keep(); finish("next"); commit(); };

    const done = document.createElement("button");
    done.type = "button";
    done.className = "btn primary";
    done.textContent = t("ui.app_done");
    done.onclick = () => { keep(); finish("done"); commit(); };

    const right = document.createElement("span");
    right.className = "foot__right";
    right.append(next, done);
    foot.push(right);

    const sheet: ReturnType<typeof openDialog> | undefined = openDialog({
      title: t("ui.app_button_title"),
      closeLabel: t("ui.close"),
      body: [pick, form],
      footer: foot,
      onClose: () => finish(null),
    });
    sheet.dialog.classList.add("sheet--button");

    if (query.value) search();
    // Into the label, because a button somebody has just opened is a button
    // they are about to name. showModal() would otherwise land focus on the
    // corner close.
    labelInput.focus();
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
    const how = await openButtonSheet(buttonAt(on, r, c) ?? null, [r, c]);
    if (how !== "next" || at + 1 >= grid.rows * grid.columns) break;
    at += 1;
  }
}

/* --- Small builders ------------------------------------------------------ */

function option(value: string, text: string): HTMLOptionElement {
  const one = document.createElement("option");
  one.value = value;
  one.textContent = text;
  return one;
}

/** One labelled thing in a sheet: a label, a control, and a sentence under it.
 *
 * A <div> with a <label for>, rather than a <label> wrapped round the whole
 * row. A wrapping label owns every control inside it, which is right for one
 * input and wrong for a radio group or a control with a play button beside it -
 * pressing the caption would then land on whichever the browser picked first.
 * An empty `text` leaves the caption out, for a row that is a button.
 */
function formRow(text: string, control: HTMLElement, note = "",
                 forId = control.id): HTMLElement {
  const box = document.createElement("div");
  box.className = "form__row";
  if (text) {
    const caption = document.createElement("label");
    caption.className = "lbl";
    /* `for` where there is one control to point at, and aria-labelledby where
     * there is not. A radio group is four controls and a play button makes the
     * row two, so a wrapping <label> would hand the caption's press to
     * whichever the browser picked first - which is why this is a <div> with a
     * <label for> rather than a <label> round the row. */
    if (forId) caption.htmlFor = forId;
    else {
      caption.id = `row${++captions}`;
      control.setAttribute("aria-labelledby", caption.id);
    }
    caption.textContent = text;
    box.appendChild(caption);
  }
  box.appendChild(control);
  if (note) {
    const hint = document.createElement("span");
    hint.className = "form__hint";
    hint.textContent = note;
    box.appendChild(hint);
  }
  return box;
}
let captions = 0;

/** A text field that writes into the draft as it is typed. Nothing reaches the
 *  layout until the sheet's confirming press - see the note at the head of the
 *  sheets - so there is no debounce here and nothing to save yet. */
function textField(value: string, onInput: (value: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "field";
  input.value = value;
  input.autocomplete = "off";
  input.oninput = () => onInput(input.value);
  return input;
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
 * and how a word class is worn.
 *
 * Both are one decision for every page, which is why neither belongs in the
 * bar over the board where everything else is about the *page* on screen.
 * They share a card for the same reason they are the same kind of decision:
 * made once, and then in force wherever somebody goes.
 *
 * Nothing is written until the footer is pressed. That is what lets the card
 * say what a smaller grid would cost while the choice is still being made -
 * and it is why the footer button changes: growing or leaving the size alone
 * is an ordinary "apply", and shrinking past something is the destructive act
 * the notice above it has just counted.
 */
function openGrid(): void {
  const layout = board();
  let size: GridSize = { ...layout.grid };
  let colour = wordColor(layout);

  const cancel = document.createElement("button");
  cancel.className = "btn quiet";
  cancel.type = "button";
  cancel.textContent = t("ui.cancel");
  cancel.onclick = () => sheet.close();

  const go = document.createElement("button");
  go.type = "button";
  go.onclick = () => {
    // resize() is what drops whatever is outside; it is also what clamps a
    // size into the bounds, so it runs whether or not anything moved.
    resize(layout, size.rows, size.columns);
    layout.wordColor = colour;
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

    const lost = outside(layout, size.rows, size.columns).length;
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
    sheet.body.replaceChildren(...body);

    // Labelled with the act rather than with "OK", and drawn as the danger it
    // is exactly when it is one: the same press applies a colour and throws
    // buttons away, and only the second of those needs saying.
    go.className = lost ? "btn destructive filled" : "btn primary";
    go.textContent = t(lost ? "ui.app_grid_shrink_go" : "ui.app_grid_apply");
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
      // The language the page is already in, read at the moment the Sammlung
      // is made rather than captured at module level: LANG is a live binding
      // and a language switch moves it. The same reasoning as editor-diy's.
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
    return (layout.pages ?? []).reduce(
      (total, one) => total + (one.buttons?.length ?? 0), 0);
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
