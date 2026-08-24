/* The boards: the list down the side, the name in the header, and the four
 * things somebody can do to the list.
 *
 * A board is a whole layout - one per child, one per room, one to try
 * something out in - and the sets inside it are the talker's five keys. Those
 * are two different levels and the words for them collide badly, so: this file
 * is about the outer one. Nothing in it knows what a set is. What an empty
 * board looks like is asked of the editor (core/editor.ts), because that is
 * the device's answer and not the shell's.
 *
 * Where each control lives was decided before it was built and is worth
 * restating, because the arrangement looks arbitrary until you try the other
 * one:
 *
 *   the list, and "+ Board"   in the sidebar - this is the level they are at
 *   the name                  in the header, as the field that renames it
 *   duplicate, delete         in the header's ⋯ menu
 *
 * The last line is the one worth defending. Both act on exactly the board that
 * is open, and a button sitting in a list of five boards can never say which
 * one it means - so they live beside the name of the one they will act on.
 * Renaming has no menu entry at all: the name on screen is the field, which is
 * bildhaft's title input and the reason there is no rename dialog to cancel.
 */
import { $, status } from "./dom.js";
import { closeMenus, menuOn } from "@lautstark/design/menu";
import { reason } from "../core/errors.js";
import {
  createBoard, deleteBoard, duplicateBoard, listBoards, renameBoard, useBoard,
} from "../backend/index.js";
import { editor } from "../core/editor.js";
import { state } from "../core/state.js";
import { load, saveNow } from "../core/save.js";
import { t } from "../core/texts.js";
import { ask } from "./confirm.js";
import type { BoardList } from "../core/types.js";

/** The list as it was last read. Kept so that the name field and the menu do
 *  not each have to go back to the store to find out which board is open. */
let held: BoardList = { boards: [], current: null };

/** What to call a board nobody has named. Its place in the list rather than
 *  its id: "Board 2" is what somebody would call it, and a UUID is what
 *  nobody would. */
const nameOf = (index: number, name: string): string =>
  name.trim() || t("ui.board_n", { n: index + 1 });

/* --- Drawing ---------------------------------------------------------------- */

/** The sidebar and the name field, from whatever the store last said. */
export async function paintBoards(): Promise<void> {
  held = await listBoards();
  const list = $("boardList");
  list.textContent = "";
  list.setAttribute("aria-label", t("ui.boards"));

  held.boards.forEach((board, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "boardRow" + (board.id === held.current ? " active" : "");
    // The name and nothing else. A set count here would be a fact about the
    // board's insides at the one moment the question is only which board this
    // is - and it would be the number that is wrong first, since the sidebar
    // is not redrawn while somebody edits.
    row.textContent = nameOf(index, board.name);
    if (board.id === held.current) row.setAttribute("aria-current", "true");
    row.onclick = () => { void open(board.id); };
    list.appendChild(row);
  });

  const field = $<HTMLInputElement>("boardName");
  const at = held.boards.findIndex((board) => board.id === held.current);
  // The placeholder carries the fallback name rather than the value: a board
  // called "Board 2" because nobody named it must not start answering to that
  // as though somebody had typed it. Typing over a placeholder is a name;
  // typing over a value that was never chosen is a name somebody inherited.
  field.value = at < 0 ? "" : held.boards[at]!.name;
  field.placeholder = at < 0 ? t("ui.board_name") : nameOf(at, "");
  field.disabled = at < 0;
}

/* --- The four things --------------------------------------------------------- */

/** Put a different board on screen.
 *
 * Anything typed in the last second is written first. The save is debounced,
 * so switching board straight after a keystroke would otherwise fire the
 * pending write *after* load() had replaced state.layout - and it would write
 * the old board's text into the new board, under the new board's version.
 */
async function open(id: string): Promise<void> {
  if (id === held.current) return;
  await saveNow();
  await useBoard(id);
  // load() re-reads the layout, adopts the board's own language, resets the
  // version this page holds and tells the editor to let go of where it was.
  await load();
  await paintBoards();
}

async function create(): Promise<void> {
  await saveNow();
  const id = await createBoard(t("ui.board_n", { n: held.boards.length + 1 }),
                               editor().blank());
  await useBoard(id);
  await load();
  await paintBoards();
  // The name field is where somebody would go next, and it is already holding
  // the name this just invented.
  $<HTMLInputElement>("boardName").focus();
}

/** The same board again, under an identity of its own.
 *
 * The id is minted by the store and never inherited - see the note on
 * duplicateBoard() there, and exchange/SPEC.md §8 for what it costs when a
 * copy keeps its original's. The copy is written from what is in the store,
 * so anything typed in the last second goes in first.
 */
async function duplicate(): Promise<void> {
  const from = held.current;
  if (!from) return;
  await saveNow();
  const at = held.boards.findIndex((board) => board.id === from);
  const id = await duplicateBoard(from, t("ui.board_copy",
                                          { name: nameOf(at, held.boards[at]!.name) }));
  await useBoard(id);
  await load();
  await paintBoards();
}

/** Gone, once somebody has said so to a question that named what goes.
 *
 * The number of sets is in the question because a board is a folder somebody
 * cannot see into from the sidebar - the row shows a name, so "delete this
 * board" on its own does not say whether three evenings' work is in there. Closing
 * the dialog any other way deletes nothing.
 */
async function remove(): Promise<void> {
  const id = held.current;
  if (!id) return;
  const at = held.boards.findIndex((board) => board.id === id);
  const name = nameOf(at, held.boards[at]!.name);
  const sets = state.layout.sets?.length ?? 0;
  // One set is the common case and "1 Set(s)" is not a sentence anybody wrote.
  // Two keys rather than a plural rule: this page has two languages and both
  // of them want a different word here, and a rule that covered German and
  // English would still be wrong for the third.
  const one = sets === 1 ? "_one" : "";
  if (!await ask({
    title: t("ui.board_delete"),
    text: t(`ui.board_delete_ask${one}`, { name, n: sets }),
    go: t(`ui.board_delete_go${one}`, { n: sets }),
  })) return;

  await deleteBoard(id);
  // Whatever the store made current, or a fresh board where it made nothing:
  // load() seeds one when the list has been emptied, which is what a first
  // visit gets and is a better answer than a page with no board on it.
  await load();
  await paintBoards();
}

/* --- Wiring ------------------------------------------------------------------ */

let renameTimer: ReturnType<typeof setTimeout> | null = null;

export function wireBoards(): void {
  $<HTMLButtonElement>("boardNew").onclick = () => { void create(); };

  const field = $<HTMLInputElement>("boardName");
  const write = async () => {
    if (renameTimer) clearTimeout(renameTimer);
    renameTimer = null;
    if (!held.current) return;
    try {
      await renameBoard(held.current, field.value.trim());
      await paintBoards();
    } catch (error) {
      status(t("ui.save_failed", { error: reason(error) }));
    }
  };
  // Debounced while typing, and again when the field is left, so that a name
  // typed and then clicked away from is written even if the last keystroke was
  // inside the debounce. Repainting moves nothing under the caret: the field
  // is only assigned in paintBoards(), and it is assigned the value it holds.
  field.oninput = () => {
    if (renameTimer) clearTimeout(renameTimer);
    renameTimer = setTimeout(() => { void write(); }, 600);
  };
  field.onchange = () => { void write(); };

  $<HTMLButtonElement>("boardMenu").onclick = (event) => {
    event.stopPropagation();
    menuOn($("boardMenu"), (add) => {
      add(t("ui.board_duplicate"), () => { closeMenus(); void duplicate(); });
      add(t("ui.board_delete"), () => { closeMenus(); void remove(); },
          { danger: true });
    });
  };
}
