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
 *   the two exports, delete           in the work head's ⋯
 *
 * The last line is the one worth defending. Both act on exactly the Sammlung
 * that is open, and a button sitting in a list of five can never say which one
 * it means - so they live beside the name of the one they will act on.
 * Renaming has no menu entry at all: the name on screen is the field.
 */
import { $, status } from "./dom.js";
import { menuOn } from "@lautstark/design/menu";
import { confirmDialog } from "@lautstark/design/dialog";
import { renameField, type RenameField } from "@lautstark/design/rename";
import { reason } from "../core/errors.js";
import {
  createCollection, deleteCollection, exportAppPackage, exportBoard,
  layoutOf, listCollections, readSettings, renameCollection, useCollection,
  writeSettings,
} from "../backend/index.js";
import { editor } from "../core/editor.js";
import { state } from "../core/state.js";
import { load, saveNow } from "../core/save.js";
import { t } from "../core/texts.js";
// A pure rule about names, not a way out of the page - which is why it comes
// from the module that owns it rather than through backend/index.ts. It owns it
// because the first thing it makes safe is an object-store key; a download's
// file name is the same question asked about a different destination.
import { safeName } from "../data/store.js";
import { LANG } from "../core/boot.js";
import type { CollectionList } from "../core/types.js";

/** The list as it was last read. Kept so that the name field and the menu do
 *  not each have to go back to the store to find out which one is open. */
let held: CollectionList = { collections: [], current: null };

/** The bound name field, once wireCollections() has bound it. Held because
 *  paintCollections() may only reach the input through it - see there. */
let name: RenameField | null = null;

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
  // Through refresh() rather than by assigning, which is the whole reason that
  // function exists: it declines while the field is being typed in and while a
  // keystroke is still waiting out its debounce, so a repaint cannot put the
  // stored name back over what somebody has just written. Making a Sammlung is
  // the case where that is guaranteed rather than likely - the field is filled
  // the moment the row appears, and the paint that made the row is still
  // running.
  //
  // Optional only because the binding is module state: app.ts wires before it
  // paints and always has, so in practice there is always a field here.
  name?.refresh(at < 0 ? "" : held.collections[at]!.name);
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

/** Hands a finished file to the browser as a download.
 *
 * The revoke is late rather than immediate: the click returns before the
 * browser has opened the URL, and a blob revoked in that gap is a download
 * that silently never begins.
 */
function offer(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The name of the Sammlung, as something a file system will take. safeName()
 *  is the store's, so a downloaded file and a file written into a folder are
 *  named by the same rule. */
const fileStem = (): string => {
  const at = held.collections.findIndex((one) => one.id === held.current);
  return safeName(nameOf(held.collections[at]!.name));
};

/** The Sammlung as a document other AAC software opens: symbols by reference. */
async function exportOne(): Promise<void> {
  if (held.collections.findIndex((one) => one.id === held.current) < 0) return;
  try {
    await saveNow();
    offer(await exportBoard(), `${fileStem()}.obz`);
    status(t("ui.collection_exported"));
  } catch (error) {
    status(t("ui.collection_failed", { error: reason(error) }));
  }
}

/** The Sammlung as the package the Android viewer opens: pictures and
 * recordings baked in as files.
 *
 * A second entry rather than an option on the first, all the way down to the
 * backend - exchange/SPEC.md §5.2, and the note above exportAppPackage().
 *
 * It can take a while, because every sentence with no recording yet is
 * synthesised before it can be encoded. The status line says so first, since
 * this is the one thing in the menu that is not instant.
 */
async function exportApp(): Promise<void> {
  if (held.collections.findIndex((one) => one.id === held.current) < 0) return;
  try {
    await saveNow();
    status(t("ui.collection_exporting_app"));
    const { blob, missing } = await exportAppPackage();
    offer(blob, `${fileStem()}-app.obz`);
    // Missing pictures are worth a sentence rather than a refusal: the package
    // works, the viewer marks those buttons, and the usual cause is a METACOM
    // folder this browser has not been given back yet.
    status(missing
      ? t("ui.collection_exported_app_gaps", { n: missing })
      : t("ui.collection_exported_app"));
  } catch (error) {
    status(t("ui.collection_export_failed", { error: reason(error) }));
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

export function wireCollections(): void {
  $<HTMLButtonElement>("collectionNew").onclick = () => { void create(); };
  $<HTMLButtonElement>("sidebarHide").onclick = () => { void showSidebar(false); };
  $<HTMLButtonElement>("sidebarShowBtn").onclick = () => { void showSidebar(true); };
  void readSettings().then((held) => showSidebar(held.sidebarOpen !== false, false));

  // The debounce, the write on the way out, and the rule that a repaint never
  // types over you are all @lautstark/design/rename's now. What is left here is
  // the half that is this product's: trimming, which Sammlung is being renamed,
  // and what to say when the write fails.
  name = renameField($<HTMLInputElement>("collectionName"), async (typed) => {
    if (!held.current) return;
    try {
      await renameCollection(held.current, typed.trim());
      await paintCollections();
    } catch (error) {
      status(t("ui.save_failed", { error: reason(error) }));
    }
  });

  $<HTMLButtonElement>("collectionMenu").onclick = (event) => {
    event.stopPropagation();
    menuOn($("collectionMenu"), (add) => {
      add(t("ui.collection_export"), () => { void exportOne(); });
      add(t("ui.collection_export_app"), () => { void exportApp(); });
      add(t("ui.collection_delete"), () => { void remove(); }, { danger: true });
    });
  };
}
