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
 *   the exports, the settings, delete in the work head's ⋯
 *
 * The last line is the one worth defending. All of them are about exactly the
 * Sammlung that is open, and a button sitting in a list of five can never say
 * which one it means - so they live beside the name of the one they act on.
 * Renaming has no menu entry at all: the name on screen is the field.
 *
 * §3.6 says the ⋯ holds what *acts* on a Sammlung, and the word "acts" is now
 * too narrow for what is in here. The tablet's grid card stretched it first
 * and nobody noticed; the Sammlung's own settings sheet is the second, and it
 * is deliberate rather than accidental. The sentence §3.6 needs is that the ⋯
 * holds what is true of one Sammlung - what acts on it, and what it is set to
 * - because both answer the question a menu in a list of five cannot: which
 * one. docs/sammlung-settings.md carries the wording; ~/Code/design is its own
 * session and this file may not edit it.
 */
import { $, status } from "./dom.js";
import { menuOn, type AddItem } from "@lautstark/design/menu";
import { confirmDialog, openDialog } from "@lautstark/design/dialog";
import { renameField, type RenameField } from "@lautstark/design/rename";
import { drawCollections } from "@lautstark/design/collections";
import { reason } from "../core/errors.js";
import {
  createCollection, deleteCollection, exportBoard,
  layoutOf, listCollections, readSettings, renameCollection, useCollection,
  writeSettings,
} from "../backend/index.js";
import { editorFor, editorOf, FIRST_TARGET } from "../core/editor.js";
import { offer, openPackageExport } from "./packageExport.js";
import { openCollectionSettings } from "./voices.js";
import { state } from "../core/state.js";
import { load, saveNow } from "../core/save.js";
import { t } from "../core/texts.js";
// A pure rule about names, not a way out of the page - which is why it comes
// from the module that owns it rather than through backend/index.ts. It owns it
// because the first thing it makes safe is an object-store key; a download's
// file name is the same question asked about a different destination.
import { safeName } from "../data/store.js";
import { GRID, LANG, LANGUAGE_NAMES, LANGUAGES } from "../core/boot.js";
import { isApp } from "../core/types.js";
import type { CollectionList, GridSize, Layout, Target } from "../core/types.js";

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

/** The second line under a name in the sidebar: which device this Sammlung is
 * built for, and - on a tablet - how big its pages are.
 *
 * The one fact the row was missing. A count means *sets* on the talker and
 * *buttons* on a tablet, so 5 and 78 sat in one column of tabular figures as
 * if they were comparable, and two Sammlungen for two different devices were
 * indistinguishable until one was opened.
 *
 * The package draws this line and does not compose it (its `subtitle` field
 * says why): it holds no vocabulary, so the words are here, in TEXTS, beside
 * the rest of vorlaut's German and English. The grid rides in the same string
 * rather than in a column of its own - ~/Code/design's
 * docs/mocks/vorlaut-sammlung-zeile.html measured six answers to this, and a
 * second column cost a third of the name on exactly the names §1.5 mints
 * unaided.
 *
 * isApp rather than a bare target check, for the reason types.ts gives: "diy"
 * is written on nothing saved before there were two editors. */
function rowSubtitle(layout: Layout): string {
  return isApp(layout)
    ? t("ui.collection_row_app",
        { rows: layout.grid.rows, columns: layout.grid.columns })
    : t("ui.collection_row_diy");
}

/** What each row's second line and count last worked out to, by Sammlung.
 *
 * Held rather than local to the paint, because of which row can change while
 * somebody is working: only the open one. Every other row is a layout nobody
 * on this page can touch, so what was read of it at the last full paint is
 * still true - which is what lets paintOpenCollection() below redraw the list
 * without going back to the store for any of them.
 *
 * Emptied by every full paint rather than updated in place, so that a deleted
 * Sammlung cannot leave a number behind for an id that is coming round again.
 */
const counts = new Map<string, number>();
const subtitles = new Map<string, string>();

/** The open Sammlung's row, from what is on screen rather than from the store.
 *
 * The store is up to a second behind it - the save is debounced - and a count
 * that lags the thing it is beside reads as a bug. */
function readOpen(): void {
  if (!held.current) return;
  counts.set(held.current, editorOf(state.layout).count(state.layout));
  subtitles.set(held.current, rowSubtitle(state.layout));
}

/** The sidebar and the work head, from whatever the store last said. */
export async function paintCollections(): Promise<void> {
  held = await listCollections();

  /* How much is in each one, and which device it is for - the second line
   * costing no read that was not already happening. The open one is not read
   * at all (see readOpen); the rest are, because there are a handful of them
   * and each is a small JSON, which is cheaper than keeping a denormalised
   * number in the registry and being wrong about it. */
  counts.clear();
  subtitles.clear();
  await Promise.all(held.collections.map(async (one) => {
    if (one.id === held.current) return readOpen();
    const layout = await layoutOf(one.id);
    // Each Sammlung counted by *its own* editor, not by whichever one is on
    // screen. This read `editor().count(...)` while there was one, and the
    // first tablet Sammlung in a list opened on a talker Sammlung would have
    // been counted in sets, found none, and drawn "0" beside sixty buttons.
    if (layout) {
      counts.set(one.id, editorOf(layout).count(layout));
      subtitles.set(one.id, rowSubtitle(layout));
    }
  }));

  drawList();

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

/** The open Sammlung's row, brought back into line with what is on screen.
 *
 * An editor's commit() is the caller - both of them - because that is what a
 * structural change *is* on this page: the layout in memory has moved, and
 * everything drawn from it has to move with it. The sidebar row was the one
 * thing that did not, so placing a button left the row's count at its old
 * number and resizing a tablet's grid left the row naming the old size while
 * the panel that had just changed it named the new one, an inch away.
 *
 * Not in save(), which was the other obvious home for it. The row goes stale
 * the moment state.layout changes, not when it reaches the disk: hanging the
 * repaint off the write would make the row lag by the save's debounce for
 * everything that goes through saveSoon(), and would leave it *wrong* rather
 * than merely late whenever a write comes back conflicted - the screen would
 * have the change and the row beside it would not. A notification out of the
 * save loop is the same timing wearing the onBuildState() shape, and it buys a
 * decoupling that is not needed here: an editor may import the shell, and only
 * the other direction is forbidden (tests/unit/layers.test.ts).
 *
 * Not debounced either, and that is what this function is for. What made a
 * repaint too expensive to do on every change was reading every other
 * Sammlung's layout out of the store - and the open row is the one row that
 * needs no read, because it is drawn from state.layout. So the maps above are
 * kept, the open entry is recomputed, and what is left is rebuilding a handful
 * of rows: a fraction of the render() that commit() has just done anyway.
 */
export function paintOpenCollection(): void {
  if (!held.current) return;
  readOpen();
  drawList();
}

/** The rows, from the two maps above.
 *
 * The rows themselves are @lautstark/design/collections'. What is left here
 * is what a row means in this product: the fallback name for an unnamed
 * Sammlung, the count - the one fact that tells two similarly named ones
 * apart, and the number the delete question will count with, which is why it
 * is on screen before that question rather than appearing for the first time
 * when something is about to go - and what pressing one does.
 *
 * `open` is a set of one, because a Sammlung here is a whole layout and so
 * cannot be in two (§4.1). The additive flag the package reports is ignored
 * for the same reason: there is no second thing to add.
 */
function drawList(): void {
  const list = $("collectionList");
  list.setAttribute("aria-label", t("ui.collections"));
  drawCollections(list, {
    rows: held.collections.map((one) => ({
      id: one.id, name: nameOf(one.name), count: counts.get(one.id),
      subtitle: subtitles.get(one.id),
    })),
    open: held.current ? [held.current] : [],
    onPick: (id) => { closeOnPick(); void open(id); },
  });
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
  // The talker's, because this is the seed a browser with nothing in it gets
  // and there is nobody to ask yet - the target dialog belongs to a press on
  // "+ Neue Sammlung", and this runs before the page has drawn.
  await createCollection("", editorFor(FIRST_TARGET).blank());
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

/* --- The size of a tablet Sammlung's grid ---------------------------------- */

/** What askTarget() answers with: which editor, and - for a tablet - how big
 *  its pages are. `grid` is absent for the talker, which has no grid. */
export interface Made {
  target: Target;
  grid?: GridSize;
  /** Which language the device shows its own menu in. The talker's only: on a
   *  tablet package localeFor() reads the locale off the voice first, so this
   *  would be a field with nothing downstream of it. */
  language?: string;
}

/** The four sizes, drawn rather than named, with the one on `chosen` pressed.
 *
 * A row of pictures instead of two number fields, because what somebody is
 * choosing is how much fits on a page - "6 x 11" is the answer to that, not
 * the question - and because a number field is a place to mistype 1 for 11 and
 * lose two pages of buttons.
 *
 * Exported because it is drawn in two places that are a whole Sammlung apart:
 * here while one is being made, and in the grid panel editor-app puts in that
 * Sammlung's own sheet once it exists. The arrow only runs one way
 * (tests/unit/layers.test.ts), so the shared control lives on the shell side
 * and the editor reaches for it - the same direction editor-app already takes
 * to exportApp() below.
 *
 * The mini grid is an `<i>` per cell rather than a picture, so that 3x5 and
 * 6x11 differ in the way the real thing does: the same width, smaller cells,
 * more of them. `aria-pressed` says which one is in force, and the accessible
 * name spells the pair out - "3 x 5" read aloud is a multiplication.
 */
export function sizeChoices(chosen: GridSize,
                            onPick: (size: GridSize) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "sizes";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", t("ui.app_grid_size"));

  for (const size of GRID.sizes) {
    const one = document.createElement("button");
    one.type = "button";
    one.className = "size";
    const held = size.rows === chosen.rows && size.columns === chosen.columns;
    one.setAttribute("aria-pressed", held ? "true" : "false");

    const mini = document.createElement("span");
    mini.className = "size__mini";
    mini.setAttribute("aria-hidden", "true");
    mini.style.setProperty("--c", String(size.columns));
    mini.style.setProperty("--r", String(size.rows));
    for (let n = 0; n < size.rows * size.columns; n++) {
      mini.appendChild(document.createElement("i"));
    }

    const pair = document.createElement("b");
    pair.textContent = `${size.rows} \u00d7 ${size.columns}`;
    const many = document.createElement("small");
    many.textContent = t("ui.app_grid_size_buttons", { n: size.rows * size.columns });
    one.setAttribute("aria-label",
      `${size.rows} ${t("ui.app_grid_rows")} \u00d7 `
      + `${size.columns} ${t("ui.app_grid_columns")}, ${many.textContent}`);

    one.append(mini, pair, many);
    one.onclick = () => onPick(size);
    row.appendChild(one);
  }
  return row;
}

/* --- The four things --------------------------------------------------------- */

/** Put a different Sammlung on screen.
 *
 * Anything typed in the last second is written first. The save is debounced, so
 * switching straight after a keystroke would otherwise fire the pending write
 * *after* load() had replaced state.layout - and it would write the old text
 * into the new Sammlung, under the new one's version.
 */
/* Choosing one closes the drawer: the layer is in the way of the thing that was
 * just asked for. Only where it is a layer - on a desktop the column stays. */
function closeOnPick(): void {
  if (narrow()) closeDrawer();
}

async function open(id: string): Promise<void> {
  if (id === held.current) return;
  await saveNow();
  await useCollection(id);
  // load() re-reads the layout, adopts its own language, resets the version
  // this page holds and tells the editor to let go of where it was - which now
  // includes installing a different editor when the two Sammlungen are for
  // different things.
  await load();
  await paintCollections();
}

/* Which editor a new Sammlung gets, asked once and never again.
 *
 * A dialog rather than two buttons in the sidebar, because "+ Neue Sammlung"
 * is one act with a question inside it and two entries would put the whole of
 * this decision in the width of a rail. Dismissing it makes nothing at all -
 * the rule this page keeps everywhere, and the reason the question comes
 * before the write rather than after.
 *
 * The note under the two says it does not change later. That is the one thing
 * somebody could reasonably expect to be able to undo, and the moment to say
 * so is while they are choosing rather than when they go looking for a switch.
 */
function askTarget(): Promise<Made | null> {
  return new Promise((resolve) => {
    /* Settled from the presses, with a guard, and the `close` event only for
     * the ways out that are not a press. That is design.md §3.4's rule, and
     * this file talked itself out of it once: the reasoning was that the
     * presses close the dialog, so one exit through `close` covers everything.
     * It does not. `close` is what a *host* fires, and a host that hides the
     * dialog without firing it leaves this promise pending for the life of the
     * page - what somebody sees is a button that did nothing, with no error
     * anywhere. e2e/collections.spec.ts makes the host into exactly that one,
     * and it is the test that caught this.
     *
     * So the making button resolves for itself, `close` resolves null for the
     * dismissal, and `settled` makes the second of those a no-op. A host that
     * fires `close` twice still resolves once; a host that fires none still
     * resolves. */
    let settled = false;
    const finish = (made: Made | null) => {
      if (settled) return;
      settled = true;
      resolve(made);
      // After resolving, so that a close event arriving as a consequence of
      // this call finds the guard already set.
      sheet?.close();
    };

    /* What the two presses set rather than what they resolve, which is the
     * change: a tablet Sammlung has a second question inside the first, and a
     * button that made the Sammlung on the way past would ask it too late.
     * The talker goes through the same footer press for one press more,
     * because two ways out of one sheet is two things to keep in step. */
    let target: Target | null = null;
    let size: GridSize = { rows: GRID.rows, columns: GRID.columns };
    /* The page's own language, which is the best guess there is at the moment
     * of making: somebody working in German is more likely than not building a
     * German talker. Both blank() implementations already start a Sammlung off
     * this way; what is new is that it is on screen and can be corrected while
     * the Sammlung is being made rather than found afterwards.
     *
     * Asked here rather than answered by a "default language" setting in
     * Einstellungen. A deferred default is one control whose effect appears
     * somewhere else, later, and unseen - which is the shape of the bug this
     * whole change removes. */
    let language = LANG;

    const body: HTMLElement[] = [];
    const choices = new Map<Target, HTMLButtonElement>();
    for (const one of ["diy", "app"] as const) {
      const choice = document.createElement("button");
      choice.className = "btn choice";
      choice.type = "button";
      choice.setAttribute("aria-pressed", "false");
      const head = document.createElement("strong");
      head.textContent = t(`ui.collection_target_${one}`);
      const note = document.createElement("span");
      note.textContent = t(`ui.collection_target_${one}_note`);
      choice.append(head, note);
      choice.onclick = () => pick(one);
      choices.set(one, choice);
      body.push(choice);
    }

    /* How much fits on a page, asked only of the target that has pages.
     *
     * Under the tablet choice rather than inside it: a control inside a
     * control is markup no keyboard can walk and no validator allows, which
     * is the same reason a cell in the grid is a box holding two widgets
     * rather than a button holding a button.
     *
     * Beside it rather than after the Sammlung exists, because it is the one
     * thing about a new board somebody already knows - and it says so of
     * itself that it is not final: growing later costs nothing. */
    const sizes = document.createElement("div");
    sizes.className = "sizeask";
    sizes.hidden = true;
    const asks = document.createElement("span");
    asks.className = "lbl";
    asks.textContent = t("ui.app_grid_size");
    const later = document.createElement("p");
    later.className = "note";
    later.textContent = t("ui.app_grid_later");
    const drawSizes = () => {
      sizes.replaceChildren(asks, sizeChoices(size, (picked) => {
        size = picked;
        drawSizes();
      }), later);
    };
    drawSizes();
    body.push(sizes);

    /* The language of the device's own menu, asked only of the target that has
     * one to show.
     *
     * Target-conditional the way the grid above it is, which is the shape this
     * dialog already had: one act with a question inside it, and the question
     * differs by what is being made. The voice is deliberately not here - a
     * new Sammlung starts on whatever the catalogue says its language speaks
     * with, which is a sensible answer nobody has to give, and the Sammlung's
     * own sheet is where it is corrected. */
    const langAsk = document.createElement("div");
    langAsk.className = "sizeask";
    langAsk.hidden = true;
    const asksLang = document.createElement("span");
    asksLang.className = "lbl";
    asksLang.id = "collectionNewLangLabel";
    asksLang.textContent = t("ui.collection_language");
    const anchor = document.createElement("span");
    anchor.className = "menu-anchor start";
    const langPick = document.createElement("button");
    langPick.className = "btn quiet sm dropdown";
    langPick.type = "button";
    langPick.setAttribute("aria-haspopup", "menu");
    langPick.setAttribute("aria-expanded", "false");
    langPick.setAttribute("aria-labelledby", asksLang.id);
    // The options name themselves, out of the same table the two other
    // language controls read - see LANGUAGE_NAMES in core/boot.ts.
    const sayLang = () => { langPick.textContent = LANGUAGE_NAMES[language] || language; };
    sayLang();
    langPick.onclick = () => menuOn(langPick, (add) => {
      for (const code of LANGUAGES) {
        add(LANGUAGE_NAMES[code] || code, () => { language = code; sayLang(); },
            { checked: code === language });
      }
    });
    anchor.appendChild(langPick);
    const langNote = document.createElement("p");
    langNote.className = "note";
    langNote.textContent = t("ui.collection_language_note");
    langAsk.append(asksLang, anchor, langNote);
    body.push(langAsk);

    const note = document.createElement("p");
    note.className = "note";
    note.textContent = t("ui.collection_target_note");
    body.push(note);

    const make = document.createElement("button");
    make.className = "btn primary";
    make.type = "button";
    make.disabled = true;
    make.textContent = t("ui.collection_create");
    make.onclick = () => {
      if (!target) return;
      finish(target === "app" ? { target, grid: size } : { target, language });
    };

    function pick(one: Target): void {
      target = one;
      for (const [which, choice] of choices) {
        choice.setAttribute("aria-pressed", which === one ? "true" : "false");
      }
      sizes.hidden = one !== "app";
      langAsk.hidden = one !== "diy";
      make.disabled = false;
    }

    const sheet: ReturnType<typeof openDialog> | undefined = openDialog({
      title: t("ui.collection_target"),
      closeLabel: t("ui.close"),
      body,
      footer: [make],
      onClose: () => finish(null),
    });
    /* The rhythm between the things in the body, which this body has to ask
     * for. components.css spaces a sheet body with `p + p` - right for the
     * sheets that are prose, and it reaches nothing here: the two choices are
     * buttons, the two conditional questions are divs, and so the closing note
     * had no space above it at all. A modifier on the shared component rather
     * than a redefinition of it, which is the move the button sheet already
     * makes for its two columns; ui.css carries what the gap is and why. */
    sheet.dialog.classList.add("sheet--target");
  });
}

async function create(): Promise<void> {
  const made = await askTarget();
  // Dismissed. Nothing was written and nothing is said: a dialog somebody
  // closes should cost exactly what it looked like it would.
  if (!made) return;
  await saveNow();
  const blank = editorFor(made.target).blank(made.grid);
  /* What was chosen while it was being made. blank() already starts a Sammlung
   * off at the page's language, so this only ever differs when somebody
   * changed the field - but it is written unconditionally rather than
   * compared, because "the answer the dialog gave" is the thing this line is
   * about and a guess that happens to agree is still a guess. */
  if (made.language) blank.language = made.language;
  const id = await createCollection(defaultName(), blank);
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

/** The open Sammlung's name as somebody would read it, fallback included. */
const currentName = (): string => {
  const at = held.collections.findIndex((one) => one.id === held.current);
  return at < 0 ? "" : nameOf(held.collections[at]!.name);
};

/** The name of the Sammlung, as something a file system will take. safeName()
 *  is the store's, so a downloaded file and a file written into a folder are
 *  named by the same rule. */
const fileStem = (): string => safeName(currentName());

/** The Sammlung as a document other AAC software opens: symbols by reference.
 *
 *  The talker's, and only the talker's: obf.ts writes sets, the ring and the
 *  hole where the speaker is. The ⋯ does not offer it on a tablet Sammlung. */
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
 * Exported, because it is the one whole-Sammlung act a tablet Sammlung has and
 * editor-app puts it in the work head's slot beside the name (conventions.md
 * §3.3), exactly as the talker puts its transfer there. For a talker Sammlung
 * it stays in the ⋯ with the other export - getting one onto the *device* is
 * what that slot means there, and this is a second way out rather than the way
 * out.
 *
 * The wait, the count and the way to stop are in shell/packageExport.ts, and
 * they are there because a full tablet Sammlung is hundreds of syntheses.
 */
export async function exportApp(): Promise<void> {
  if (held.collections.findIndex((one) => one.id === held.current) < 0) return;
  await saveNow();
  openPackageExport(currentName(), fileStem());
}

/** Gone, once somebody has said so to a question that named what goes.
 *
 * The count is in the question because a Sammlung is a folder somebody cannot
 * see into from the sidebar - the row shows a name and a number, and the
 * number is the thing that could change their mind. Closing the dialog any
 * other way deletes nothing.
 */
async function remove(): Promise<void> {
  const id = held.current;
  if (!id) return;
  const at = held.collections.findIndex((one) => one.id === id);
  const name = nameOf(held.collections[at]!.name);
  const which = editorOf(state.layout);
  const n = which.count(state.layout);
  // What is being counted is the editor's answer - sets on the device, buttons
  // on a tablet - so the *word* is too. A shared sentence with a {unit} hole
  // would not survive German: the two nouns take different articles, so the
  // singular sentence differs in a word no plural rule reaches.
  //
  // One is the common case and "1 Set(s)" is not a sentence anybody wrote. Two
  // keys rather than a plural rule: this page has two languages and both want
  // a different word here, and a rule covering German and English would still
  // be wrong for the third.
  const one = n === 1 ? "_one" : "";
  if (!await confirmDialog({
    title: t("ui.collection_delete"),
    body: t(`ui.collection_delete_ask_${which.unit}${one}`, { name, n }),
    confirmLabel: t(`ui.collection_delete_go_${which.unit}${one}`, { n }),
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
 * other. conventions.md §1.3.
 *
 * A desktop question only. Below 820px there is no column to collapse, only a
 * layer to dismiss - see openDrawer() below - and the remembered answer is
 * deliberately not consulted down there. */
async function showSidebar(open: boolean, remember = true): Promise<void> {
  document.body.classList.toggle("collapsed", !open);
  $("sidebarShow").hidden = open;
  if (remember) await writeSettings({ sidebarOpen: open });
}

/** Below this the sidebar is a layer over the work, not a column beside it.
 *  The number is conventions.md §3.1's, and it is the one the stylesheet
 *  breaks at - the two have to agree or the controls and the layout disagree
 *  about which arrangement is on screen. */
const narrow = (): boolean => matchMedia("(max-width: 820px)").matches;

/* The drawer. Opening is a moment rather than a preference, so nothing here is
 * written down: closing the tab closes it, which is what somebody expects of a
 * thing they slid over their work. §1.3 is about the column, not this. */
function openDrawer(): void {
  $("sidebar").classList.add("open");
  $("scrim").hidden = false;
}

function closeDrawer(): void {
  $("sidebar").classList.remove("open");
  $("scrim").hidden = true;
}

/* --- Wiring ------------------------------------------------------------------ */

/** Entries the editor on screen adds to the menu beside the Sammlung's name.
 *
 * The menu is the shell's - it acts on the Sammlung, which is the shell's
 * level - but not everything that acts on one is: writing a talker's build
 * into a folder is editor-diy's, and the shell may not import an editor
 * (tests/unit/layers.test.ts), so the editor hands its entries in instead.
 *
 * This carried the tablet's grid card as well until the grid became a panel in
 * the Sammlung's own sheet - which is the same hand-over one floor along, and
 * voices.ts's collectionSheetPanel() is where it is now. What is left here is
 * an act rather than a setting, which is what this menu is for.
 *
 * Registered by an editor's wire() and taken back by the teardown it answers
 * with, for the reason EditorHalf.wire() gives: the shell outlives every
 * editor, so anything left behind here would draw a tablet's entry over a
 * talker Sammlung and reach for elements that are no longer in the page.
 */
let extras: ((add: AddItem) => void) | null = null;

export function collectionMenuExtras(build: ((add: AddItem) => void) | null): void {
  extras = build;
}

export function wireCollections(): void {
  $<HTMLButtonElement>("collectionNew").onclick = () => { void create(); closeOnPick(); };
  $<HTMLButtonElement>("sidebarHide").onclick = () => { void showSidebar(false); };
  $<HTMLButtonElement>("sidebarShowBtn").onclick = () => { void showSidebar(true); };
  $<HTMLButtonElement>("sidebarOpenBtn").onclick = openDrawer;
  $<HTMLButtonElement>("sidebarClose").onclick = closeDrawer;
  $("scrim").onclick = closeDrawer;
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
      /* Both exports for a talker Sammlung; for a tablet's, neither here.
       *
       * The document export is obf.ts's, and obf.ts writes the five-key
       * device: sets, the ring, the hole where the speaker is. It has nothing
       * to say about a page of a grid, and a menu entry that would produce a
       * wrong file is worse than no entry - exchange/SPEC.md §7.4's argument
       * about a button that looks live and does the wrong thing, one floor up.
       *
       * The package export is not missing on a tablet Sammlung, it has moved:
       * it is that Sammlung's one whole-Sammlung act, so editor-app puts it in
       * the work head beside the name (conventions.md §3.3). Two doors to one
       * act is two things to keep in step for no gain - the same argument that
       * took the gear out of the page header. */
      if (!isApp(state.layout)) {
        add(t("ui.collection_export"), () => { void exportOne(); });
        add(t("ui.collection_export_app"), () => { void exportApp(); });
      }
      /* Whatever act the editor on screen has to add - for the talker, the
       * build written into a folder, which is a third kind of export and so
       * belongs directly under the two above it. A tablet adds none: its grid
       * was here, and it was the one entry in this menu that was a setting
       * rather than an act. */
      extras?.(add);
      /* Then what this Sammlung is set to, rather than what can be done with
       * it: the voice it speaks in, the grid a tablet's pages are on, and - on
       * a talker - the language the device shows its own menu in. All of them
       * are layout.json fields and all travel in an export. The first two were
       * in the settings sheet at the foot of the sidebar until it turned out
       * that a panel whose answer changes when you click a different row in
       * the list is not a setting of the app; the grid came the other way,
       * from an entry of its own directly above this one, because two doors to
       * "what is this Sammlung set to" is one too many.
       *
       * Below the acts and above the delete. The delete stays last wherever it
       * appears; everything else in this menu reads as "with this Sammlung, do
       * X" and this one reads as "about this Sammlung", which is the weaker
       * claim and so goes second. */
      add(t("ui.collection_settings"), () => { void openCollectionSettings(); });
      add(t("ui.collection_delete"), () => { void remove(); }, { danger: true });
    });
  };
}
