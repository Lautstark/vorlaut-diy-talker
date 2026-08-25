// The tablet editor: the page strip, the grid, and the panel for one button.
//
// This is the second device-specific half. Pages of a grid, a sentence bar
// composed by pressing buttons, a colour per word class: none of that is true
// of the five-key talker and all of it is true of a MetaTalk-style board,
// which is why it sits under editor-app/ and why nothing in the shell may
// import it. The shell reaches it through core/editor.ts, and `app` at the
// foot of this file is what it reaches.
//
// `here` and `chosen` live here and nowhere else. They are where the editor is
// standing - which page, which button - and they are reset by adopt() for the
// same reason editor-diy's `current` is: page three of the kitchen Sammlung
// and page three of the nursery Sammlung have nothing to do with each other.
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
import { save, saveSoon } from "../core/save.js";
import { openPicker } from "../shell/picker.js";
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
/** Which button the panel is showing, by id. "" for none. */
let chosen = "";
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

    tab.onclick = () => { here = one.id; chosen = ""; render(); };
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
    chosen = id;
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
    // One press puts a button here and selects it, so the next thing somebody
    // does is type its label. Asking what kind of button first would put a
    // form in front of the common case, which is a word on a cell.
    const make = () => {
      const made = blankButton(row, col);
      on.buttons.push(made);
      chosen = made.id;
      commit();
      // Straight into the label, because a button somebody has just put down
      // is a button they are about to name. Safe to reach for immediately now
      // that commit() draws before it writes - it is the field the line above
      // has just made.
      $<HTMLInputElement>("appLabel").focus();
    };
    hit.onclick = make;
    hit.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      make();
    };
    return box;
  }

  const hit = opener(held.label || t("ui.app_button_empty"));
  hit.classList.toggle("current", held.id === chosen);
  hit.setAttribute("aria-pressed", held.id === chosen ? "true" : "false");
  box.classList.toggle("current", held.id === chosen);
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

  const label = document.createElement("span");
  label.className = "appcell__label";
  label.textContent = held.label || "";
  box.appendChild(label);

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

  const select = () => { chosen = held.id; render(); };
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
    chosen = held.id;
    commit();
    // render() rebuilt every cell, so the element that had focus is gone. It
    // follows the button rather than staying at the coordinate, which is what
    // makes a run of presses move one thing across the board.
    ($("appGrid").children[(to[0] * grid.columns) + to[1]]
      ?.querySelector(".appcell__open") as HTMLElement)?.focus();
  };
  return box;
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

/* --- The panel ----------------------------------------------------------- */

function drawPanel(): void {
  const panel = $("appPanel");
  panel.innerHTML = "";
  const held = page().buttons.find((one) => one.id === chosen);
  if (!held) {
    panel.appendChild(pageControls());
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = t("ui.app_button_none");
    panel.appendChild(note);
    return;
  }
  panel.appendChild(pageControls());
  panel.appendChild(buttonControls(held));
}

/** What can be done to the page itself: its name, its colour, whether it is
 *  home, and deleting it. Above the button panel rather than beside the strip,
 *  because a tab is one line and these are four controls. */
function pageControls(): HTMLElement {
  const layout = board();
  const on = page();
  const box = document.createElement("div");
  box.className = "apppanel__page";

  const name = field(t("ui.app_page_name"), on.name, (value) => {
    on.name = value;
    saveSoon();
    // Only the strip, and only the text: a full render would rebuild the field
    // being typed in and take the caret with it.
    for (const [index, tab] of [...$("appPages").children].entries()) {
      if (layout.pages[index]?.id !== on.id) continue;
      tab.lastChild!.textContent = value || t("ui.app_page_n", { n: index + 1 });
    }
  });
  box.appendChild(name);

  if (on.id !== layout.home) {
    const home = document.createElement("button");
    home.type = "button";
    home.className = "btn quiet sm";
    home.textContent = t("ui.app_page_home_set");
    home.onclick = () => { layout.home = on.id; commit(); };
    box.appendChild(home);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn quiet sm destructive";
  remove.textContent = t("ui.app_page_delete");
  remove.onclick = () => { void askDelete(on); };
  box.appendChild(remove);

  return box;
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
async function askDelete(on: AppPage): Promise<void> {
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
  })) return;

  deletePage(layout, on.id);
  here = layout.pages[0]!.id;
  chosen = "";
  commit();
}

/** Everything about one button. */
function buttonControls(held: AppButton): HTMLElement {
  const box = document.createElement("div");
  box.className = "apppanel__button";

  const label = field(t("ui.app_button_label"), held.label, (value) => {
    held.label = value;
    saveSoon();
    paintCell(held);
  });
  label.querySelector("input")!.id = "appLabel";
  label.querySelector("input")!.placeholder = t("ui.app_button_label_hint");
  box.appendChild(label);

  const spoken = field(t("ui.app_button_spoken"), held.vocalization, (value) => {
    held.vocalization = value;
    saveSoon();
  });
  spoken.querySelector("input")!.placeholder = t("ui.app_button_spoken_hint");
  box.appendChild(spoken);

  // The picture. Seeded with the label, and it fills an empty label from the
  // collection's own word for the symbol but never writes over one somebody
  // typed - the same rule editor-diy keeps, and for the same reason: the
  // symbol may be called "zustimmen" while the button should say "Ja!".
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "btn quiet sm";
  pick.textContent = t("ui.pick_symbol");
  pick.onclick = () => openPicker({
    seed: held.label,
    apply: async (symbol, caption) => {
      held.symbol = symbol;
      if (caption && !held.label.trim()) held.label = caption;
      commit();
    },
  });
  box.appendChild(pick);

  box.appendChild(labelled(t("ui.app_button_class"), classPicker(held)));
  box.appendChild(labelled(t("ui.app_button_act"), actPicker(held)));
  if (held.act.kind === "goto") box.appendChild(gotoPicker(held));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn quiet sm destructive";
  remove.textContent = t("ui.app_button_remove");
  // No question. What goes is one button on the page somebody is looking at,
  // it is on screen while they press this, and putting it back is one press in
  // the cell it came from - which is a smaller act than the dialog would be.
  remove.onclick = () => {
    const on = page();
    on.buttons = on.buttons.filter((one) => one.id !== held.id);
    chosen = "";
    commit();
  };
  box.appendChild(remove);

  return box;
}

/** The Fitzgerald classes, in the scheme's own order. */
function classPicker(held: AppButton): HTMLSelectElement {
  const select = document.createElement("select");
  select.append(option("", t("ui.wordclass_none")));
  for (const one of WORD_CLASSES) {
    select.append(option(one.key, t(`ui.wordclass_${one.key}`)));
  }
  select.value = held.wordClass;
  select.onchange = () => { held.wordClass = select.value; commit(); };
  return select;
}

/** What a press does. One list, because exchange/SPEC.md §7.3 makes these
 *  exclusive on the wire - so a control that could pick two would be offering
 *  a board the format cannot hold. */
function actPicker(held: AppButton): HTMLSelectElement {
  const select = document.createElement("select");
  for (const kind of ["append", "speak", "goto", "sayBar",
                      "backspace", "clear", "home"] as const) {
    select.append(option(kind, t(`ui.app_act_${actKey(kind)}`)));
  }
  select.value = held.act.kind;
  select.onchange = () => {
    const kind = select.value as Act["kind"];
    // A `goto` needs somewhere to go, and the page it lands on by default is
    // the one somebody is looking at - which is wrong often enough that the
    // target select appears immediately underneath, already open to be
    // changed. It is never left pointing at nothing: a button with no target
    // exports as an ordinary appending button, which is not what the list
    // said was chosen.
    held.act = kind === "goto" ? { kind, page: page().id } : { kind } as Act;
    commit();
  };
  return select;
}

/**
 * Which page a navigation button leads to.
 *
 * A select over every page, with "Neue Seite …" last. Choosing that mints a
 * page, names it after the button, and points the button at it - because the
 * authoring move is "this button should lead somewhere new", and making
 * somebody leave, make a page, come back and select it is one thought in three
 * steps. The new page is written immediately, like everything else on this
 * page; changing your mind afterwards leaves a spare empty page in the strip,
 * which is visible and deletable and better than an invisible half-state.
 *
 * Beside it, the way to follow the edge while editing. Separate from selecting
 * the button on purpose - see the note in templates/board.ts.
 */
function gotoPicker(held: AppButton): HTMLElement {
  const layout = board();
  const select = document.createElement("select");
  for (const [index, one] of layout.pages.entries()) {
    select.append(option(one.id, one.name || t("ui.app_page_n", { n: index + 1 })));
  }
  select.append(option("+", t("ui.app_goto_new")));
  select.value = held.act.kind === "goto" ? held.act.page : "";
  select.onchange = () => {
    if (select.value === "+") {
      const made = addPage(layout, held.label.trim());
      held.act = { kind: "goto", page: made.id };
    } else {
      held.act = { kind: "goto", page: select.value };
    }
    commit();
  };

  const follow = document.createElement("button");
  follow.type = "button";
  follow.className = "btn quiet sm";
  follow.textContent = t("ui.app_goto_follow");
  follow.onclick = () => {
    if (held.act.kind !== "goto") return;
    here = held.act.page;
    chosen = "";
    render();
  };

  const box = labelled(t("ui.app_goto_page"), select);
  box.appendChild(follow);
  return box;
}

/* --- Small builders ------------------------------------------------------ */

function option(value: string, text: string): HTMLOptionElement {
  const one = document.createElement("option");
  one.value = value;
  one.textContent = text;
  return one;
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  const box = document.createElement("label");
  box.className = "apppanel__field";
  const caption = document.createElement("span");
  caption.textContent = text;
  box.append(caption, control);
  return box;
}

/** A text field that writes as it is typed. No save button anywhere on this
 *  page - design.md §3.5 - so the debounce in saveSoon() is what stands
 *  between a keystroke and a write. */
function field(text: string, value: string,
               onInput: (value: string) => void): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.autocomplete = "off";
  input.oninput = () => onInput(input.value);
  return labelled(text, input);
}

/** One cell redrawn, for the case a full render would break: the label field
 *  is being typed in, and rebuilding the grid would not disturb it but
 *  rebuilding the panel would take the caret with it. */
function paintCell(held: AppButton): void {
  const at = (held.row * board().grid.columns) + held.col;
  const box = $("appGrid").children[at];
  const label = box?.querySelector(".appcell__label");
  if (label) label.textContent = held.label;
}

/* --- Drawing, and the two controls that are not in the panel -------------- */

export function render(): void {
  // A drag does not survive a redraw: the element that carried it is thrown
  // away with the rest of the grid.
  dragging = null;
  const layout = board();
  if (!pageById(layout, here)) here = layout.pages[0]!.id;
  drawPages();
  drawGrid();
  drawPanel();
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
    // Whatever was selected may have been one of the buttons that just went.
    chosen = "";
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

    for (const one of ["fill", "border", "off"] as const) {
      const choice = document.createElement("button");
      choice.className = "btn choice";
      choice.type = "button";
      choice.setAttribute("aria-pressed", one === colour ? "true" : "false");
      const head = document.createElement("strong");
      head.textContent = t(`ui.app_word_color_${one}`);
      const note = document.createElement("span");
      note.textContent = t(`ui.app_word_color_${one}_note`);
      choice.append(head, note);
      choice.onclick = () => { colour = one; draw(); };
      body.push(choice);
    }
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
    chosen = "";
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
   * clamped to wherever the last one was standing, and with nothing selected:
   * the panel would otherwise open on a button belonging to a board that is no
   * longer on screen. */
  adopt(): void {
    here = isApp(state.layout) ? state.layout.home : "";
    chosen = "";
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
