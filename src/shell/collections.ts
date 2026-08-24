/* The Sammlungen: the list down the side, the name in the work head, and the
 * four things somebody can do to the list.
 *
 * A Sammlung is a whole layout - one per child, one per room, one to try
 * something out in - and the sets inside it are the talker's five keys. Those
 * are two different levels, and the word "board" is not either of them any
 * more: it means one page of an Open Board Format document, which is what
 * exchange/SPEC.md has always used it for. `Collection` in the code and
 * *Sammlung* on screen is the family's convention, settled in design.md §3.6.
 *
 * Nothing here knows what a set is. How many things are inside one is asked of
 * the editor (core/editor.ts), because that is the device's answer.
 *
 * Where each control lives is conventions.md §1 and §3, and is worth restating
 * because the arrangement looks arbitrary until you try the other one:
 *
 *   the list, and "+ Neue Sammlung"   in the sidebar - this is their level
 *   the name                          in the work head, as the field that renames
 *   export, delete                    in the work head's ⋯
 *
 * The last line is the one worth defending. Both act on exactly the Sammlung
 * that is open, and a button sitting in a list of five can never say which one
 * it means - so they live beside the name of the one they will act on.
 * Renaming has no menu entry at all: the name on screen is the field.
 */
import { $, status } from "./dom.js";
import { menuOn } from "@lautstark/design/menu";
import { confirmDialog } from "@lautstark/design/dialog";
import { reason } from "../core/errors.js";
import {
  createCollection, deleteCollection, exportBoard,
  layoutOf, listCollections, readSettings, renameCollection, useCollection,
  writeSettings,
} from "../backend/index.js";
import { editor } from "../core/editor.js";
import { state } from "../core/state.js";
import { load, saveNow } from "../core/save.js";
import { t } from "../core/texts.js";
import { LANG } from "../core/boot.js";
import type { CollectionList } from "../core/types.js";

/** The list as it was last read. Kept so that the name field and the menu do
 *  not each have to go back to the store to find out which one is open. */
let held: CollectionList = { collections: [], current: null };

/** What to call a Sammlung nobody has named.
 *
 * Only the one carried across from the single-layout database is ever unnamed -
 * everything made since is named for the day - so this is a fallback for one
 * row in one browser, and it is deliberately not derived from where that row
 * sits. It was "Sammlung {n}" from its position, which reads fine in a list
 * ordered by creation and renames itself in a list ordered by what was written
 * last: making a second Sammlung would have turned "Sammlung 1" into
 * "Sammlung 2" without anybody touching it. */
const nameOf = (name: string): string => name.trim() || t("ui.collection_unnamed");

/** A new one is named for the day, the way a new notebook is.
 *
 * Both halves follow the page's language: the words through t(), and the date
 * through LANG, so an English page does not read "Sammlung vom 08/24/2026" or a
 * German one "Collection of 24.08.2026". Every caller has to be somewhere the
 * language is already settled - see nameIfUnnamed(). */
const defaultName = (): string =>
  t("ui.collection_default", { date: new Date().toLocaleDateString(LANG, {
    day: "2-digit", month: "2-digit", year: "numeric",
  }) });

/* --- Drawing ---------------------------------------------------------------- */

/** The sidebar and the work head, from whatever the store last said. */
export async function paintCollections(): Promise<void> {
  held = await listCollections();

  /* How much is in each one. The open one is counted from what is on screen
   * rather than from the store, because the store is up to a second behind it -
   * the save is debounced, and a count that lags the thing it is beside reads
   * as a bug. The rest are read; there are a handful of them and each is a
   * small JSON, which is cheaper than keeping a denormalised number in the
   * registry and being wrong about it. */
  const counts = new Map<string, number>();
  await Promise.all(held.collections.map(async (one) => {
    if (one.id === held.current) { counts.set(one.id, editor().count(state.layout)); return; }
    const layout = await layoutOf(one.id);
    if (layout) counts.set(one.id, editor().count(layout));
  }));

  const list = $("collectionList");
  list.textContent = "";
  list.setAttribute("aria-label", t("ui.collections"));

  held.collections.forEach((one) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "collectionRow" + (one.id === held.current ? " active" : "");
    const name = document.createElement("span");
    name.className = "collectionRow__name";
    name.textContent = nameOf(one.name);
    // How much is in it. The one fact that tells two similarly named
    // Sammlungen apart, and the number the delete question will count with -
    // which is why it is on screen before that question rather than appearing
    // for the first time at the moment something is about to go.
    const count = document.createElement("span");
    count.className = "collectionRow__count";
    count.textContent = String(counts.get(one.id) ?? "");
    row.append(name, count);
    if (one.id === held.current) row.setAttribute("aria-current", "true");
    row.onclick = () => { void open(one.id); };
    list.appendChild(row);
  });

  const at = held.collections.findIndex((one) => one.id === held.current);
  const field = $<HTMLInputElement>("collectionName");
  /* Not while it is being typed in. mitreden's drawRail() carries the same
   * guard and gives one reason - the caret jumps to the end mid-word - and
   * there is a second, worse one: a repaint can be in flight while somebody is
   * typing, and assigning here puts the stored name back over what they have
   * just written. Making a Sammlung is exactly that case, because the field is
   * filled the moment the row appears and the paint that made the row is still
   * running. */
  if (document.activeElement !== field) {
    field.value = at < 0 ? "" : held.collections[at]!.name;
  }
  field.placeholder = at < 0 ? t("ui.collection_name") : t("ui.collection_unnamed");
  field.disabled = at < 0;

}

/** There is always one, and it has a name.
 *
 * The store will seed a layout for a browser that has none - that is its
 * guarantee and it stays - but it has no language to name one with, so what it
 * seeds arrives blank. This gets in first, on the one visit where it matters,
 * so that "unnamed" is a state only the Sammlung carried across from the
 * single-layout database is ever in. conventions.md §1.5 and §1.9.
 */
export async function ensureCollection(): Promise<void> {
  const list = await listCollections();
  if (list.collections.length) return;
  // Unnamed on purpose: the language is not settled until load() has read the
  // layout this creates. nameIfUnnamed() below is what names it, afterwards.
  await createCollection("", editor().blank());
}

/** Gives the open Sammlung a name if it has none, in the language the page has
 *  settled on.
 *
 * Two arrive without one and both are named here rather than where they are
 * made: the seed above, because the language it will put the page into is
 * inside the layout it is seeding, and the Sammlung carried across from the
 * single-layout database, which never had a name at all. Naming either one
 * earlier means naming it in whatever language the browser guessed. */
export async function nameIfUnnamed(): Promise<void> {
  const list = await listCollections();
  const open = list.collections.find((one) => one.id === list.current);
  if (!open || open.name.trim()) return;
  await renameCollection(open.id, defaultName());
}

/* --- The four things --------------------------------------------------------- */

/** Put a different Sammlung on screen.
 *
 * Anything typed in the last second is written first. The save is debounced, so
 * switching straight after a keystroke would otherwise fire the pending write
 * *after* load() had replaced state.layout - and it would write the old text
 * into the new Sammlung, under the new one's version.
 */
async function open(id: string): Promise<void> {
  if (id === held.current) return;
  await saveNow();
  await useCollection(id);
  // load() re-reads the layout, adopts its own language, resets the version
  // this page holds and tells the editor to let go of where it was.
  await load();
  await paintCollections();
}

async function create(): Promise<void> {
  await saveNow();
  const id = await createCollection(defaultName(), editor().blank());
  await useCollection(id);
  await load();
  await paintCollections();
  // Straight into the name, selected: the first keystroke replaces the date it
  // was given. Focusing without selecting would make the invented name a chore
  // to delete rather than a suggestion to type over.
  const field = $<HTMLInputElement>("collectionName");
  field.focus();
  field.select();
}

/** The Sammlung as a document other AAC software opens. */
async function exportOne(): Promise<void> {
  const at = held.collections.findIndex((one) => one.id === held.current);
  if (at < 0) return;
  try {
    await saveNow();
    const blob = await exportBoard();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${nameOf(held.collections[at]!.name).replace(/[^\w.-]+/g, "_")}.obz`;
    link.click();
    // Revoked later rather than here: the click returns before the browser has
    // opened the URL, and a blob revoked in that gap is a download that
    // silently never begins.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status(t("ui.collection_exported"));
  } catch (error) {
    status(t("ui.collection_failed", { error: reason(error) }));
  }
}

/** Gone, once somebody has said so to a question that named what goes.
 *
 * The number of sets is in the question because a Sammlung is a folder somebody
 * cannot see into from the sidebar - the row shows a name and a count, and the
 * count is the thing that could change their mind. Closing the dialog any other
 * way deletes nothing.
 */
async function remove(): Promise<void> {
  const id = held.current;
  if (!id) return;
  const at = held.collections.findIndex((one) => one.id === id);
  const name = nameOf(held.collections[at]!.name);
  const sets = editor().count(state.layout);
  // One set is the common case and "1 Set(s)" is not a sentence anybody wrote.
  // Two keys rather than a plural rule: this page has two languages and both
  // want a different word here, and a rule covering German and English would
  // still be wrong for the third.
  const one = sets === 1 ? "_one" : "";
  if (!await confirmDialog({
    title: t("ui.collection_delete"),
    body: t(`ui.collection_delete_ask${one}`, { name, n: sets }),
    confirmLabel: t(`ui.collection_delete_go${one}`, { n: sets }),
    cancelLabel: t("ui.cancel"),
    // Never the same word as the button beside it: two dismissals sharing an
    // accessible name is ambiguous to anyone navigating by it.
    closeLabel: t("ui.close"),
    danger: true,
  })) return;

  await deleteCollection(id);
  // Whatever the store made current, or a fresh one where it made nothing:
  // load() seeds one when the list has been emptied, which is what a first
  // visit gets and is a better answer than a page with nothing on it.
  await load();
  await paintCollections();
}

/* --- The sidebar itself ------------------------------------------------------- */

/* Whether the column is there at all. A choice about the shape of the window is
 * not one to make every visit, so it is remembered - and in the settings record
 * with every other preference rather than in localStorage, because a preference
 * living in two stores is one that gets restored by one and overwritten by the
 * other. conventions.md §1.3. */
async function showSidebar(open: boolean, remember = true): Promise<void> {
  document.body.classList.toggle("collapsed", !open);
  $("sidebarShow").hidden = open;
  if (remember) await writeSettings({ sidebarOpen: open });
}

/* --- Wiring ------------------------------------------------------------------ */

let renameTimer: ReturnType<typeof setTimeout> | null = null;

export function wireCollections(): void {
  $<HTMLButtonElement>("collectionNew").onclick = () => { void create(); };
  $<HTMLButtonElement>("sidebarHide").onclick = () => { void showSidebar(false); };
  $<HTMLButtonElement>("sidebarShowBtn").onclick = () => { void showSidebar(true); };
  void readSettings().then((held) => showSidebar(held.sidebarOpen !== false, false));

  const field = $<HTMLInputElement>("collectionName");
  const write = async () => {
    if (renameTimer) clearTimeout(renameTimer);
    renameTimer = null;
    if (!held.current) return;
    try {
      await renameCollection(held.current, field.value.trim());
      await paintCollections();
    } catch (error) {
      status(t("ui.save_failed", { error: reason(error) }));
    }
  };
  // Debounced while typing, and again when the field is left, so a name typed
  // and then clicked away from is written even if the last keystroke was inside
  // the debounce. Repainting moves nothing under the caret: the field is only
  // assigned in paintCollections(), and it is assigned the value it holds.
  field.oninput = () => {
    if (renameTimer) clearTimeout(renameTimer);
    renameTimer = setTimeout(() => { void write(); }, 600);
  };
  field.onchange = () => { void write(); };
  field.onkeydown = (event) => { if (event.key === "Enter") field.blur(); };

  $<HTMLButtonElement>("collectionMenu").onclick = (event) => {
    event.stopPropagation();
    menuOn($("collectionMenu"), (add) => {
      add(t("ui.collection_export"), () => { void exportOne(); });
      add(t("ui.collection_delete"), () => { void remove(); }, { danger: true });
    });
  };
}
