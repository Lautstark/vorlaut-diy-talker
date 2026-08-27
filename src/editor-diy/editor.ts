// The five-key talker's editor: the set tabs, the board as the device really
// lays it out, and the two sheets a press opens - one for a speech key, one
// for the set.
//
// This is the device-specific half. Four keys to a set, at most five sets on
// the device at once, a hole where the speaker is: none of that is
// true of AAC in general and all of it is true of this hardware, which is why
// it sits under editor-diy/ and why nothing in the shell may import it. The
// shell reaches it through core/editor.ts instead, and `diy` at the foot of
// this file is what it reaches.
//
// dragSet, dragSlot and `current` live here and nowhere else.
//
// ## The board is 2x3 with a hole in it, and always was
//
// docs/hardware.md: the speaker sits top left, the set key below it, and the
// four speech keys to the right as a 2x2 block. data/obf.ts's grid() has
// exported exactly that arrangement - nulls and all - since it was written.
// What this editor drew was a set tile and four tiles in a row of three, which
// meant the one screen somebody arranges a board on was the one place the
// arrangement was wrong. The hole is drawn as the speaker rather than captioned
// as an absence, because that is what is there.
//
// The hole and the set key are not drop targets and do not move: their
// positions are the hardware's. Only the four speech keys trade places.
//
// ## The tile is gone and there are two sheets instead
//
// A press opens everything about the thing pressed, which is the arrangement
// editor-app already had and design's docs/mocks/vorlaut-editor-sheet.html
// draws for both. The scaffolding is shell/sheet.ts's - an editor may not
// import out of another editor, so what the two share lives one floor down -
// and what is left here is the rows, which are the part that is genuinely this
// device's. There is one of them on a key: no word class, because the device
// draws no colour at all - the five displays carry the picture and nothing
// round it - and no row for what a press does, because there is no sentence
// bar for a key to put anything into.
import { $, negationCross } from "../shell/dom.js";
import { symbolInto } from "../backend/index.js";
import { state } from "../core/state.js";
import type { Editor } from "../core/editor.js";
import { isDiy } from "../core/types.js";
import type { BoardSet, DiyLayout, Layout } from "../core/types.js";
import { LANG, limits } from "../core/boot.js";
import { t } from "../core/texts.js";
import { save } from "../core/save.js";
import { paintOpenCollection } from "../shell/collections.js";
import { speak } from "../shell/speech.js";
import { formRow, missing, openSheet, textField } from "../shell/sheet.js";
import type { Left } from "../shell/sheet.js";
import { confirmDialog } from "@lautstark/design/dialog";

let dragSet: number | null = null;    // index of the dragged set
let dragSlot: number | null = null;   // index of the dragged speech key
/* Which set is being edited. It was `state.current` while the page held one
 * board and every module that touched a set index was allowed to know about
 * it. Now it is an index into whichever board is open, so it belongs to the
 * thing that draws the sets, and it is reset by adopt() rather than clamped by
 * the save loop. */
let current = 0;

/* state.layout, as the shape this editor is the editor for.
 *
 * The shell holds one layout and it may be either kind - core/types.ts's union
 * - and this file may only ever be looking at the DIY half, because the
 * composition root installs it for a DIY Sammlung and for nothing else. So
 * this is that guarantee written down once instead of a cast at each of the
 * forty places below.
 *
 * It throws for the reason $() throws: reaching here with a tablet Sammlung on
 * screen is not a case to handle, it is a composition root that has installed
 * the wrong editor, and the complaint should say so once. */
function board(): DiyLayout {
  const held = state.layout;
  if (!isDiy(held)) throw new Error("the five-key editor was given a tablet Sammlung");
  return held;
}

/** The set on screen. */
function set(): BoardSet {
  return board().sets[current]!;
}

/**
 * Redrawn now, written after - the same order and the same reason as
 * editor-app's commit(), which is where the argument is written out: an
 * IndexedDB round trip between a press and the page reflecting it is merely
 * slow for most of these, and for a sheet that has just written a key it is
 * long enough for a test driving the page to see the old board.
 *
 * Nothing is risked by drawing first. save() does not touch state.layout, and
 * the writes are serialised in a chain inside it.
 */
function commit(): void {
  render();
  /* The sidebar row for this Sammlung counts its sets, off the layout this has
   * just changed - so adding or removing one leaves the row at its old number
   * until something redraws it. Cheap by construction: the open row is the one
   * row paintOpenCollection() need not go to the store for. See there for why
   * it is not hung off the save instead. */
  paintOpenCollection();
  void save();
}

/* --- The board ------------------------------------------------------------
 *
 * The six cells in reading order: `null` is the hole where the speaker sits,
 * `"set"` is the set key, and a number is that one of the four speech slots.
 *
 *     .        key 1    key 2
 *     set      key 3    key 4
 *
 * The one place this arrangement is written down in this editor, so that the
 * grid, the drop targets and where Alt+Arrow may go cannot drift apart. It is
 * the same table data/obf.ts's grid() exports; the two agreeing is the point
 * of the change that made this file look like this.
 */
const CELLS: (null | "set" | number)[] = [null, 0, 1, "set", 2, 3];

/** Which cell in the grid holds a speech slot. */
const cellOf = (slot: number): number => CELLS.indexOf(slot);

function clearDragMarks(): void {
  for (const one of document.querySelectorAll(".dragover")) {
    one.classList.remove("dragover");
  }
}

// Where a set lands, whether dropped or moved by Alt+Arrow. The moved set
// becomes the edited one, as it always has on drop; focus follows its tab
// because render() rebuilds the row, and the keyboard would otherwise be
// left standing on nothing.
function moveSet(from: number, to: number): void {
  const moved = board().sets.splice(from, 1)[0]!;
  board().sets.splice(to, 0, moved);
  current = to;
  commit();
  ($("tabs").children[to] as HTMLElement).focus();
}

/** Where a swap of two speech keys lands, whether dropped or made with
 *  Alt+Arrow. Focus follows the key rather than staying at the cell, which is
 *  what makes a run of presses carry one key across the block. */
function swapSlots(a: number, b: number): void {
  const slots = set().slots;
  [slots[a], slots[b]] = [slots[b]!, slots[a]!];
  commit();
  ($("device").children[cellOf(b)]
    ?.querySelector(".cell__open") as HTMLElement)?.focus();
}

function emptySet(index: number): BoardSet {
  return {
    name: "Set " + (index + 1),
    symbol: "",
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  };
}

/* There was a toggle here that drew every key the way the display draws it -
 * scaled to 128x128, rounded to RGB565, life-size at 15.21 mm - and it is on
 * the loader page now, after a compile, showing the tiles that are about to go
 * down the cable rather than a prediction of them. adr/0013 has the decision
 * and states what the move costs, which is that the picture arrives later than
 * it used to. docs/split-crossings.md has the costing behind it.
 *
 * What is left on a cell is the stored symbol, which is what this board drew
 * before the preview existed and what a tablet cell has always drawn. */

/** The picture on a cell: the symbol, as it was put there.
 *
 * A crossed-out key comes back wrapped, because the cross has to be the size
 * of the picture rather than of the cell - see .cell__crossed. Only then:
 * every key that is not negated is the bare <img> it has always been. */
function picture(symbol: string, negated = false): HTMLElement {
  const image = document.createElement("img");
  image.className = "cell__pic";
  image.alt = "";
  symbolInto(image, symbol);
  // Two different absences, and the words point at different remedies. The
  // reading is shell/sheet.ts's, because both editors' cells and the sheet's
  // own preview all have to make it.
  image.onerror = () => { image.replaceWith(missing(symbol)); };
  if (!negated) return image;
  const box = document.createElement("span");
  box.className = "cell__crossed";
  box.append(image, negationCross());
  return box;
}

/** The widget inside a cell: what a press lands on.
 *
 * A div wearing role="button" rather than a <button>, for the reason
 * editor-app's opener() gives: its parent is dragged, and a real button
 * captures the mousedown that would start the drag. So the two things the
 * element would have brought - a place in the tab order, and acting on Enter
 * and Space - are written out at each call site. */
function opener(label: string): HTMLElement {
  const hit = document.createElement("div");
  hit.className = "cell__open";
  hit.setAttribute("role", "button");
  hit.tabIndex = 0;
  hit.setAttribute("aria-label", label);
  hit.setAttribute("aria-haspopup", "dialog");
  return hit;
}

/** Hearing a key without opening it. The five-key board has had this on every
 *  key since it was written, and it is what somebody uses while looking at the
 *  board to check it reads right. A real <button>, because nothing drags it. */
function playButton(saying: string): HTMLElement {
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
  return play;
}

/** The cell where the speaker is. Not a control, not a drop target, and not
 *  something anybody can put a key in: it is a hole in the board because there
 *  is a 40 mm cone behind it. Drawn as the thing rather than captioned as an
 *  absence - the mock has the glyph. */
function holeCell(): HTMLElement {
  const box = document.createElement("div");
  box.className = "cell cell--hole";
  const line = document.createElement("span");
  line.innerHTML =
    `<svg viewBox="0 0 40 40" aria-hidden="true">`
    + `<circle cx="20" cy="20" r="17" stroke-width="1.5"/>`
    + `<circle cx="20" cy="20" r="11" stroke-width="1.2"/>`
    + `<circle cx="20" cy="20" r="4" stroke-width="1.5" fill="currentColor"/></svg>`;
  line.append(t("ui.speaker"));
  box.appendChild(line);
  return box;
}

/** The set key, which is a display like the other four and is also the set
 *  itself: it carries the set's picture and name on the device, and a press on
 *  the device cycles to the next set. So pressing it here opens the set's own
 *  card - the same one the ⋯ on its tab opens, because they are one thing
 *  drawn twice. */
function setCell(entry: BoardSet): HTMLElement {
  const box = document.createElement("div");
  box.className = "cell cell--setkey";

  const name = entry.name || t("ui.set_n", { n: current + 1 });
  const hit = opener(t("ui.set_more"));
  const open = () => { void openSetSheet(); };
  hit.onclick = open;
  hit.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  };
  box.appendChild(hit);

  const eyebrow = document.createElement("span");
  eyebrow.className = "cell__eyebrow";
  eyebrow.textContent = t("ui.set_key");
  box.appendChild(eyebrow);

  if (entry.symbol) box.appendChild(picture(entry.symbol));
  const word = document.createElement("span");
  word.className = "cell__word";
  word.textContent = name;
  box.appendChild(word);
  return box;
}

/** One of the four speech keys. */
function keyCell(entry: BoardSet, index: number): HTMLElement {
  const slot = entry.slots[index]!;
  const said = (slot.text || "").trim();
  const box = document.createElement("div");
  box.className = "cell";

  /* Every speech cell is a drop target, filled or not: the four slots always
   * exist, so a drop is always a swap and the other key moves exactly where
   * this one came from. The hole and the set key have no ondragover at all,
   * which is what keeps them out of it - only a prevented dragover marks an
   * element as a drop target. */
  box.ondragover = (event) => {
    if (dragSlot === null || dragSlot === index) return;
    event.preventDefault();
    box.classList.add("dragover");
  };
  box.ondragleave = () => box.classList.remove("dragover");
  box.ondrop = (event) => {
    event.preventDefault();
    clearDragMarks();
    if (dragSlot === null || dragSlot === index) return;
    const from = dragSlot;
    dragSlot = null;
    swapSlots(from, index);
  };

  if (!said && !slot.symbol) box.classList.add("cell--empty");
  /* A key with a picture and no sentence is a deliberate key rather than an
   * unfinished one, so it is not announced as empty: the number names it, and
   * only a key with neither is empty. Reading editor-app's cell() makes of the
   * same two cases. */
  const hit = opener(said || (slot.symbol ? t("ui.key_n", { n: index + 1 })
                                          : t("ui.diy_key_add")));
  box.appendChild(hit);

  if (slot.symbol) box.appendChild(picture(slot.symbol, slot.negated));
  if (said) {
    const word = document.createElement("span");
    word.className = "cell__word";
    word.textContent = said;
    box.appendChild(word);
  }
  if (said) box.appendChild(playButton(said));

  const open = () => { void editKey(index); };
  hit.onclick = open;

  box.draggable = true;
  box.ondragstart = (event) => {
    dragSlot = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    }
  };
  box.ondragend = () => { dragSlot = null; clearDragMarks(); };

  /* Alt and an arrow moves a key one place, which is the key editor-app uses
   * for the same act and the one this editor already used to reorder sets. It
   * replaces arm-with-Enter, drop-with-Enter: that gesture had two ends and a
   * state between them, which needed a grip to hang the state on, a mark on
   * the grip, a sentence in the status line and an Escape to let go - all of
   * it for a swap inside a square of four.
   *
   * Within the 2x2 block only. Slot n sits at row n>>1, column n&1 of it, and
   * a move that would leave the block does nothing: the cells around it are
   * the speaker and the set key, and neither is a place a key can go.
   *
   * Claimed even where the move has nowhere to go: Alt+Left is history-back in
   * some engines, and rearranging a board must never walk off the page. */
  hit.setAttribute("aria-keyshortcuts",
                   "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight");
  hit.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
      return;
    }
    const step = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0],
                    ArrowLeft: [0, -1], ArrowRight: [0, 1] } as const)[
                      event.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"];
    if (!event.altKey || !step) return;
    event.preventDefault();
    const to = [(index >> 1) + step[0], (index & 1) + step[1]] as const;
    if (to[0] < 0 || to[0] > 1 || to[1] < 0 || to[1] > 1) return;
    swapSlots(index, (to[0] * 2) + to[1]);
  };
  return box;
}

/* --- The set strip -------------------------------------------------------- */

function drawTabs(): void {
  const tabs = $("tabs");
  tabs.innerHTML = "";
  board().sets.forEach((entry, index) => {
    const tab = document.createElement("div");
    // Which tab is the open one is the stylesheet's now rather than a colour
    // written on the element: it was the set's own colour on the border, with
    // a square of the same colour beside the name. Both went with the colour,
    // and the square would have been the worse thing to keep - the same value
    // on all five tabs, saying only that a set is a set.
    tab.className = "tab" + (index === current ? " active" : "");
    const name = document.createElement("span");
    name.textContent = entry.name || t("ui.set_n", { n: index + 1 });
    tab.appendChild(name);
    const open = () => { current = index; render(); };
    tab.onclick = open;
    // Not a <button>, although it is pressed like one: the tab is dragged to
    // reorder, and engines disagree on what dragging a button means. So the
    // div stays, and the two things the element would have brought - a place
    // in the tab order, acting on Enter and Space - are written out.
    tab.setAttribute("role", "button");
    tab.tabIndex = 0;
    if (index === current) tab.setAttribute("aria-current", "true");
    tab.setAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");
    tab.onkeydown = (event) => {
      if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        // Claimed even when the move has nowhere to go: Alt+Left is history
        // back in some engines, and reordering must never walk off the page.
        event.preventDefault();
        const to = index + (event.key === "ArrowRight" ? 1 : -1);
        if (to >= 0 && to < board().sets.length) moveSet(index, to);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    };

    /* The second way into the set's own card, on the tab that is already open.
     *
     * The same ⋯ editor-app puts on the last crumb of its path, and the same
     * card behind it. Here it is genuinely a second door - the set key opens
     * the same thing - and that is not what conventions.md §3.2 forbids: the
     * tab and the set key are the same set drawn twice, once as a card index
     * and once as what is on the device. Both lead to the thing itself.
     *
     * A <span> wearing role="button" for the reason the tab is a <div>: it is
     * inside something that is already pressed and dragged.
     *
     * Every set tab gets the element and only the current one gets the
     * control, which is editor-app's drawPages() and the same reason: the
     * strip reflowed on every switch, and here the tabs are also dragged to
     * reorder, so a row that resizes under the pointer is a row that resizes
     * mid-drag. The reserved copies are `visibility: hidden` - the box, and
     * nothing in the accessibility tree or the tab order. */
    const more = document.createElement("span");
    more.className = "tab__more";
    more.textContent = "⋯";
    if (index === current) {
      more.setAttribute("role", "button");
      more.tabIndex = 0;
      more.setAttribute("aria-label", t("ui.set_more"));
      const edit = (event: Event) => {
        // Or the press falls through to the tab, which would redraw the strip
        // out from under the sheet that is opening.
        event.stopPropagation();
        void openSetSheet();
      };
      more.onclick = edit;
      more.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        edit(event);
      };
    } else {
      more.classList.add("tab__more--idle");
      more.setAttribute("aria-hidden", "true");
    }
    tab.appendChild(more);

    // Reorder sets: the order determines how the set key cycles through, so on
    // this device it is the navigation rather than the presentation - the
    // firmware advances with `rtcCurrentSet = (rtcCurrentSet + 1) %
    // layout.setCount`.
    tab.draggable = true;
    tab.ondragstart = (event) => {
      dragSet = index;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
      }
    };
    tab.ondragover = (event) => {
      if (dragSet === null || dragSet === index) return;
      event.preventDefault();
      tab.classList.add("dragover");
    };
    tab.ondragleave = () => tab.classList.remove("dragover");
    tab.ondrop = (event) => {
      event.preventDefault();
      clearDragMarks();
      if (dragSet === null || dragSet === index) return;
      const from = dragSet;
      dragSet = null;
      moveSet(from, index);
    };
    tab.ondragend = () => { dragSet = null; clearDragMarks(); };

    tabs.appendChild(tab);
  });

  if (board().sets.length < limits.maxSets) {
    const add = document.createElement("button");
    add.className = "tab add";
    add.type = "button";
    add.textContent = t("ui.add_set");
    add.onclick = () => {
      board().sets.push(emptySet(board().sets.length));
      current = board().sets.length - 1;
      commit();
    };
    tabs.appendChild(add);
  }
}

export function render(): void {
  // A drag does not survive a redraw: the element that carried it is thrown
  // away with the rest of the board.
  dragSet = null;
  dragSlot = null;
  drawTabs();

  // How full the Sammlung is. There is nothing to warn about any more: every
  // set it holds goes onto the device, and it cannot hold more than fit.
  $("slots").textContent =
    t("ui.slots_used", { used: board().sets.length, max: limits.maxSets });

  const device = $("device");
  device.innerHTML = "";
  const entry = board().sets[current];
  if (!entry) {
    device.innerHTML = '<p style="color:var(--muted)"></p>';
    device.firstChild!.textContent = t("ui.no_sets");
    return;
  }
  for (const place of CELLS) {
    device.appendChild(place === null ? holeCell()
      : place === "set" ? setCell(entry)
      : keyCell(entry, place));
  }
}

/* --- The two sheets -------------------------------------------------------
 *
 * The frame is shell/sheet.ts's - the picture column with its search, the foot
 * with the destructive act on the left, and the promise that settles from the
 * presses rather than from `close` alone. What is here is the rows, and there
 * are fewer of them than on a tablet for reasons that are facts about this
 * device rather than simplifications of the other one.
 *
 * **Nothing is written until Fertig.** Both sheets edit a draft and copy it
 * back on the confirming press, so every way out that is not that press costs
 * nothing. The tile wrote as you typed because it was always on screen and
 * there was nothing to dismiss.
 */

/** One speech key: its picture, what it says, and hearing it.
 *
 * One text field and not two. A tablet button has an Aufschrift and a
 * Gesprochen because the tablet draws the one and says the other; this device
 * draws no caption at all - the key is the picture - so there is one thing to
 * type and `ui.text_placeholder` has been the words for it since this editor
 * was written.
 */
function openKeySheet(index: number): Promise<Left> {
  const entry = set();
  const slot = entry.slots[index]!;
  const draft = { text: slot.text, symbol: slot.symbol, negated: Boolean(slot.negated) };

  const spoken = textField(draft.text, (value) => { draft.text = value; });
  spoken.id = "diyKeyText";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "btn";
  play.textContent = "▶";
  play.title = t("ui.play_title");
  play.setAttribute("aria-label", t("ui.play_title"));
  play.onclick = () => {
    const saying = draft.text.trim();
    if (saying) void speak(saying, play);
  };
  const withPlay = document.createElement("div");
  withPlay.className = "form__withplay";
  withPlay.append(spoken, play);

  const keep = () => {
    slot.text = draft.text;
    slot.symbol = draft.symbol;
    // Present only when it is true, never a stored false: an ordinary key goes
    // on being written exactly as it was before this field existed, so nothing
    // that has never been crossed out looks changed to changed.ts.
    if (draft.negated) slot.negated = true;
    else delete slot.negated;
    commit();
  };

  return openSheet({
    title: t("ui.diy_key_title"),
    pick: {
      symbol: draft.symbol,
      seed: draft.text,
      negated: draft.negated,
      /* Only fill a field that is still empty, never write over one somebody
       * typed: the symbol is called "zustimmen", but your key should say
       * "Ja!". The same rule editor-app keeps, and it has been this editor's
       * since the picker had it. */
      onPick: (symbol, caption) => {
        draft.symbol = symbol;
        if (caption && !draft.text.trim()) {
          draft.text = caption;
          spoken.value = caption;
        }
      },
      onNegate: (negated) => { draft.negated = negated; },
    },
    rows: [formRow(t("ui.text_placeholder"), withPlay,
                   t("ui.diy_key_spoken_note"), spoken.id)],
    /* Emptied and not deleted, and only where there is something to empty.
     * A slot is one of a fixed four and cannot go; what the button does is put
     * it back the way an untouched key is, which is why its label says so - see
     * ui.diy_key_clear. No question in front of it, for editor-app's reason:
     * what goes is one key on the set somebody is looking at, and putting it
     * back is one press in the cell it came from. */
    ...((slot.text || slot.symbol) ? {
      remove: {
        label: t("ui.diy_key_clear"),
        onPress: (settle: () => void) => {
          slot.text = "";
          slot.symbol = "";
          // Putting a key back the way an untouched one is, and an untouched
          // key is not crossed out. A cross left behind on an empty key is
          // invisible - there is no picture under it - and comes back the
          // moment somebody picks the next picture.
          delete slot.negated;
          settle();
          commit();
        },
      },
    } : {}),
    /* The sheet's one cost bought back. Four keys is a smaller run than a
     * tablet page of sixty-six, but it is still a run, and stopping at the
     * last one rather than wrapping is the same choice editor-app made:
     * walking off the end back to the first is a surprise. */
    ...(index < 3 ? { next: { label: t("ui.diy_key_next"), onPress: keep } } : {}),
    done: { label: t("ui.done"), onPress: keep },
    focus: spoken,
  });
}

/** The sheet, and then the next key's, for as long as somebody keeps pressing
 *  "next". */
async function editKey(index: number): Promise<void> {
  for (let at = index; ; at += 1) {
    const how = await openKeySheet(at);
    if (how !== "next" || at + 1 >= 4) break;
  }
}

/**
 * The set itself: its picture, its name, its colour and deleting it.
 *
 * Reached from the ⋯ on the current tab and from the set key on the board,
 * which are the same set drawn twice. Everything in it stood in a tile beside
 * the board before - a thumb, a name field, a row of swatches, a colour input,
 * a hex field and a red button under all of it - and none of it was a cell.
 * With it gone the board is tabs and a grid and nothing else, which is what
 * the mock's last note asks for.
 *
 * **The colour has gone, and so has its row.** It was three controls in three
 * places, then one row of swatches held here until the firmware stopped
 * reading it. The firmware has, so the row went with it: what is left is a
 * name and a picture, which are what a set is told apart by on the device.
 *
 * BoardSet.color went with it, one change later. It outlived the row because
 * data/obf.ts wrote it into a .obf as ext_vorlaut_color and read it back, and
 * tests/reference/obf.lock.json froze both directions; narrowing that lock is
 * what let the field go.
 */
function openSetSheet(): Promise<void> {
  const entry = set();
  const draft = { name: entry.name, symbol: entry.symbol };

  const name = textField(draft.name, (value) => { draft.name = value; });
  name.id = "diySetName";
  name.placeholder = t("ui.set_name");

  return openSheet({
    title: t("ui.set_title"),
    /* A picture column, where the tablet's page card has none: this page has a
     * key on the device that shows one. */
    pick: {
      symbol: draft.symbol,
      seed: draft.name,
      onPick: (symbol, caption) => {
        draft.symbol = symbol;
        if (caption && !draft.name.trim()) {
          draft.name = caption;
          name.value = caption;
        }
      },
    },
    rows: [
      formRow(t("ui.set_name"), name, t("ui.set_name_note")),
    ],
    remove: {
      label: t("ui.remove_set"),
      // The question is askDelete's, and it draws a dialog of its own over
      // this one. Only a yes closes this sheet, because a no leaves somebody
      // exactly where they were.
      onPress: (settle) => {
        void askDelete().then((gone) => { if (gone) settle(); });
      },
    },
    done: {
      label: t("ui.done"),
      onPress: () => {
        entry.name = draft.name;
        entry.symbol = draft.symbol;
        commit();
      },
    },
    focus: name,
  }).then(() => undefined);
}

/**
 * The question asked before a set goes.
 *
 * A `<dialog>`, and this is the change: it was `window.confirm`, which
 * conventions.md §3.4 forbids outright - the browser's own chrome is the one
 * surface in the product no design token reaches, so it is the one place that
 * cannot follow the scheme. The divergence list named mitreden for this and
 * recorded vorlaut as compliant; vorlaut was not, and only this call site was
 * left.
 *
 * It also failed §1.7's shape twice over. The question named the set and
 * counted nothing inside it, so it asked somebody to decide without the one
 * fact that could change their mind; and the confirming button said OK, which
 * asks the reader to hold what it refers to in their head.
 *
 * What is counted is the keys with something on them rather than the four
 * slots, which are always four. An empty set is the case where there is
 * genuinely nothing to lose, and it says so instead of counting to zero.
 *
 * The same shape as editor-app's page delete, deliberately: they are the same
 * act on the same kind of object, one editor apart.
 */
async function askDelete(): Promise<boolean> {
  const sets = board().sets;
  if (!sets.length) return false;
  const entry = sets[current]!;
  const name = entry.name || t("ui.set_n", { n: current + 1 });
  const n = (entry.slots || []).filter(
    (slot) => (slot.text || "").trim() || (slot.symbol || "").trim()).length;

  if (!await confirmDialog({
    title: t("ui.remove_set"),
    body: t(n === 0 ? "ui.set_delete_ask_none"
             : n === 1 ? "ui.set_delete_ask_one" : "ui.set_delete_ask",
            { name, n }),
    confirmLabel: t("ui.set_delete_go"),
    cancelLabel: t("ui.cancel"),
    // Never the same word as the button beside it: two dismissals sharing an
    // accessible name is ambiguous to anyone navigating by it.
    closeLabel: t("ui.close"),
    danger: true,
  })) return false;

  sets.splice(current, 1);
  current = Math.max(0, current - 1);
  commit();
  return true;
}

/* wireEditor() stood here and bound one control: the preview toggle, which
 * went to the loader page with the picture it drew (adr/0013). There is
 * nothing on this editor's own markup left to bind - every control it has is
 * built by render() or by a sheet, with its handler attached as it is made -
 * so app.ts passes a wire step that does nothing rather than this file
 * exporting a function that does nothing. */

/* What the shell is handed, and the whole of what it may ask for.
 *
 * Seven members, and each one is a question the shell has that only the device
 * can answer - see core/editor.ts for what each is and why it is not a general
 * "do something to the board" hook. app.ts registers this object against the
 * "diy" target; nothing in src/shell/ imports this file, and
 * tests/unit/layers.test.ts is what says so.
 */
export const diy: Editor = {
  /* What a new board starts as, and it is a fact about this hardware: one set
   * of four empty keys. app.py seeded
   * content/ from example/ so that nobody met an empty screen; this is that
   * idea at its smallest, because the examples are pictures and recordings
   * that would have to be fetched, and an empty board somebody can type into
   * is worth more than a wait. */
  blank(): Layout {
    return {
      sleep_timeout_seconds: 600,
      /* The language the device's own menu will be in, not a fixed "de".
       *
       * This is the Sammlung's language rather than the page's - the two were
       * one field and one control until they were split - and it is a starting
       * point that can be changed in the settings sheet afterwards. The page's
       * is the best guess there is at the moment of making: somebody working
       * in German is more likely than not building a German talker, and a
       * hardcoded "de" was rendering an English reader's first board in a
       * language they had not asked for, in a product whose whole audience is
       * people who need the words to be theirs.
       *
       * Read at the moment a board is made rather than captured at module
       * level: LANG is a live binding and a language switch moves it, so a
       * board made after the switch is made in the language on screen. */
      language: LANG,
      sets: [{
        name: "",
        symbol: "",
        slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
      }],
    };
  },

  /* A different board is in force. Back to its first set rather than clamped
   * to where the last board happened to be standing: set three of the kitchen
   * board and set three of the nursery board have nothing to do with each
   * other, and landing on one because the other was open reads as the page
   * having lost its place. */
  adopt(): void {
    current = 0;
    render();
  },

  render,

  /* A sentence somebody actually wrote, from the set on screen, so that trying
   * a voice out is heard on the content rather than on a specimen. "" when
   * this board has nothing typed on it yet; the settings sheet has its own
   * specimen for that, in the reader's language, which is not this file's to
   * choose. */
  sample(): string {
    const entry = board().sets[current];
    const slot = (entry ? entry.slots || [] : []).find(
      (one) => (one.text || "").trim());
    return slot ? slot.text.trim() : "";
  },

  /* How many sets are in a layout. The sidebar draws it beside the name and
   * the delete question counts with it, and neither of them knows the word
   * "set" - they ask for a number and `unit` below is what puts a word to it.
   *
   * Takes a layout rather than reading state.layout, and answers 0 for a
   * layout that is not this editor's: the sidebar counts every Sammlung it
   * lists, and one of them being a tablet's is the ordinary case rather than
   * a reason to throw the way board() does. */
  count(layout: Layout): number {
    return isDiy(layout) ? layout.sets?.length ?? 0 : 0;
  },

  /* Sets, because a set is a fixed four keys here: the number of sets and the
   * amount of work in a Sammlung move together, so one number does both of the
   * jobs conventions.md §1.8 gives it. That is not true on a tablet, where a
   * page holds anything from nothing to sixty-six - see editor-app. */
  unit: "set",

  /* The fixed words on the controls this editor owns, re-read on every
   * language switch - applyTexts() calls this rather than naming ids itself.
   *
   * None, now. There were four: the button that deleted a set went into the
   * set's own card, which builds its own label every time it opens; the button
   * that sent to the talker went to a page of its own (adr/0011); and the
   * preview toggle went with the picture it drew (adr/0013). Everything else
   * this editor puts on screen is built by render() or by a sheet, with its
   * words read at the moment it is made.
   *
   * Empty rather than absent: Editor.labels() is how the shell asks, and an
   * editor that answers "nothing" is a different statement from one the shell
   * cannot ask. */
  labels(): void {},
};
