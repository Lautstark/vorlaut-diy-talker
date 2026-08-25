// Writing the layout back, and everything that can go wrong doing it.
//
// saveTimer, unsaved and layoutVersion live here and nowhere else. They were
// three of the eleven at the top of the old script; nothing outside this file
// ever read them, and nothing can now.
import { $, status} from "../shell/dom.js";
import { reason } from "./errors.js";
import { loadLayout, saveLayout } from "../backend/index.js";
import { state } from "./state.js";
import { t } from "./texts.js";
import { paintCollectionLanguage } from "../shell/voices.js";
import { editorFor, FIRST_TARGET, showEditorFor } from "./editor.js";
import type { Layout } from "./types.js";

let saveTimer = null;
let layoutVersion = null;   // the state this page loaded
// What the page holds and the store does not. Set by every caller that has
// something to write (see save()), put down again by the write that lands it,
// and read by two: the prompt on the way out of the window, and saveNow(),
// which declines to write when there is nothing behind the call.
let unsaved = false;

/* The arriving layout's language, shown - and deliberately not put in force.
 *
 * This function used to call setLanguage(): a Sammlung carried one language
 * field, and opening one re-languaged the editor around whoever opened it.
 * That was the reading half of a single control that wrote both - somebody
 * building an English talker had to work in an English page, and switching
 * Sammlung moved their page under them. The layout's language is the device's
 * own menu language now, and this page's is remembered in this browser (see
 * CHOICE in boot.ts), which is why nothing here touches LANG, applyTexts() or
 * the button naming the page's language.
 *
 * What is left is the one thing that does go stale when a layout arrives: the
 * control that names *this Sammlung's* language, over in the settings sheet.
 * At every arrival rather than only at load, because the sheet can be open
 * while a layout is replaced - importing a board is a button inside it.
 *
 * The sheet's markup is mounted once with the page, so there is always
 * something there to paint, whether or not anybody has opened it. */
function sayCollectionLanguage() {
  paintCollectionLanguage();
}

export async function load() {
  // The seed is an editor's, and it is only ever used on a browser that has
  // never had a Sammlung in it. Asking for it unconditionally is cheaper than
  // the round trip that would tell us whether it is needed.
  //
  // From the registry rather than from the editor on screen, and that is not
  // interchangeable: on the very first load there is no editor on screen,
  // because which one to show is read off the layout this line is fetching.
  // FIRST_TARGET is what a browser with nothing in it gets.
  const fresh = await loadLayout(editorFor(FIRST_TARGET).blank());
  layoutVersion = fresh.version;
  state.layout = fresh.layout;
  // The order here no longer carries an argument. It did while this line put a
  // language in force: everything below draws labels, so a switch after them
  // left the page half in the language the browser had guessed. Nothing is
  // switched now - this paints one control in a sheet nothing else here
  // touches - and it stays first only because that is where it has always been.
  sayCollectionLanguage();
  tellBuildState(fresh.buildCurrent);
  $("conflict").classList.remove("show");
  unsaved = false;
  status("");
  // Which editor this Sammlung needs, put on screen, and then told to let go
  // of wherever it was standing. Both halves of that are core/editor.ts's:
  // this file may not name an editor, and until there were two of them the
  // second half was the whole of it.
  showEditorFor(state.layout);
}

/* Whether the build in data/ still matches the layout - told, not asked.
 *
 * This used to be markReleaseState(), and it reached straight into
 * `$("releaseBtn")` from here. That is a button only editor-diy mounts, and
 * $() throws by design, so the first tablet Sammlung to be opened took the
 * page down inside load() before it had drawn anything. Nothing could have
 * caught it: tests/unit/layers.test.ts proves that src/shell/ imports nothing
 * out of an editor, and this was never an import - it was an element id, which
 * is a dependency the module graph cannot see.
 *
 * So the flag is published and whoever cares subscribes. That is the shape
 * this repository already uses three times for the same reason - onChanged(),
 * onBlocked(), subscribeMetacom() - and it puts the knowledge that a build is
 * a thing that can be out of date back in the half that owns the build.
 *
 * The value itself is not the editor's to work out: it comes off the storage
 * layer with the layout (HeldLayout.buildCurrent) and this is only the relay.
 */
const builds = new Set<(flag: string | null) => void>();

/** Listen for the build mark. Called with whatever is currently known, so a
 *  subscriber wired after the first load is not left waiting for the next
 *  write to find out where it stands.
 *
 * Hands back a way to stop, and that is not tidiness - it is the whole reason
 * this is safe. A listener here reaches an element in one editor's markup, and
 * that markup is taken out of the page when a Sammlung for the other target is
 * opened. A subscription that outlives its own elements is the same defect as
 * the one moving this out of save.ts fixed, one layer along: the first tablet
 * Sammlung saved after a talker Sammlung had been open reported "the page has
 * no #releaseBtn" from inside the save loop. core/editor.ts calls this before
 * it mounts a different editor. */
export function onBuildState(listener: (flag: string | null) => void): () => void {
  builds.add(listener);
  listener(buildFlag);
  return () => { builds.delete(listener); };
}

let buildFlag: string | null = null;

function tellBuildState(flag: string | null | undefined): void {
  if (flag === null || flag === undefined) return;
  buildFlag = flag;
  for (const listener of builds) listener(flag);
}

// One second after the last keystroke. Shorter gains nothing - it does not
// feel faster but produces markedly more writes.
export function saveSoon() {
  clearTimeout(saveTimer);
  unsaved = true;
  status(t("ui.unsaved"));
  saveTimer = setTimeout(save, 1000);
}

/* Save what is on screen now, if there is anything to save.
 *
 * The debounce is dropped first and unconditionally - otherwise it fires
 * afterwards and writes the same thing a second time, and worse, it fires
 * after the page has moved on and writes this layout into whatever Sammlung is
 * open by then.
 *
 * Then the question. Every caller here saves *before doing something else* -
 * switching Sammlung, making one, exporting one, building one - so that what
 * happens next reads a store the screen agrees with. None of them is an edit,
 * and until now all of them wrote anyway.
 *
 * That was not free. Every write is a touch of `updatedAt` (data/store.ts) and
 * the sidebar is ordered by it, so a write with no change behind it said
 * "somebody has just worked on this one" about a Sammlung nobody had touched -
 * and the list acted on it. Leaving a Sammlung floated it to the top, which
 * moved every row below it while somebody was looking at them; pressing the
 * top row twice landed in two different Sammlungen, because the first press
 * put the one just left where the finger already was. conventions.md §1.4 is
 * about the Sammlung *being worked on* rising, and visiting one is not working
 * on it.
 *
 * `unsaved` is what makes the question answerable: it means the page holds
 * something the store does not. save() below sets it, so every path that has
 * something to write goes on writing it - what is skipped here is only the
 * save that had nothing to say.
 *
 * The chain rather than a resolved promise, so this still keeps the guarantee
 * the callers actually wait on: a write already in flight - an editor's
 * commit() does not await its own - has landed by the time this settles.
 */
export function saveNow() {
  clearTimeout(saveTimer);
  if (!unsaved) return saveChain;
  return save();
}

/** Put a whole different layout in place of what is on screen, and write it.
 *
 * The board import is the caller. It saves rather than leaving the new board
 * unsaved: opening a file is somebody's decision already, and a page sitting
 * on an imported board that is not written anywhere is a state nobody can tell
 * apart from a saved one by looking.
 */
export async function replaceLayout(layout) {
  state.layout = layout;
  sayCollectionLanguage();
  // An imported Sammlung may be for the other target than the one on screen,
  // so this is the same call load() makes rather than a bare showEditor().
  showEditorFor(state.layout);
  // Said rather than assumed: what is on screen is a layout the store has never
  // seen, and saveNow() declines to write when nothing has said so.
  unsaved = true;
  await saveNow();
}

/* The layout as one string, so that what came back can be held against what
 * went out.
 *
 * Structural, and that is a fix rather than a simplification. It used to walk
 * `sets`, trimming and upper-casing each field, because app.py normalised a
 * layout on the way into the file and the two ends had to be brought into one
 * shape before they could be compared. There is no app.py - writeLayout()
 * keeps the bytes it is handed - so the normalising was comparing against a
 * rule nothing applies any more.
 *
 * Once a layout could be a tablet's it was doing worse than nothing. Every app
 * Sammlung reduces to `{"sets":[]}`, so the one check standing between a wrong
 * write and silence agreed with itself about all of them: the pages could have
 * come back empty and this would have said the file holds what the screen
 * holds.
 *
 * Key order is settled rather than trusted. JSON.stringify walks an object in
 * insertion order, and the value coming back has been through a parse that
 * need not rebuild it in the order the page built it - so two objects meaning
 * the same thing can stringify differently, which would report a mismatch that
 * is not one.
 */
function comparable(layout: Layout): string {
  return JSON.stringify(canonical(layout));
}

/** The same value with every object's keys in sorted order, all the way down.
 *  Arrays keep their order, because in a layout an array is a sequence
 *  somebody arranged - the pages in the strip, the keys on a set. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonical((value as Record<string, unknown>)[key]);
  }
  return out;
}

// Process saves one after another. Two at once would reject each other via
// the state check - and the caller could no longer wait for the write to have
// actually happened.
let saveChain = Promise.resolve();

export function save() {
  /* A call here is the statement that there is something to write, and it is
   * the only one some callers can make. Typing says so through saveSoon() and
   * its flag; an editor's commit() has no other way to say it, and neither has
   * the conflict banner's "keep my version", which is this page deliberately
   * re-asserting a version the store disagrees with.
   *
   * So the flag is set here rather than at each of them. What it means is
   * exactly what saveNow() reads it as - the page holds something the store
   * does not - and doSave() below puts it down again once that has stopped
   * being true. */
  unsaved = true;
  saveChain = saveChain.then(doSave, doSave);
  return saveChain;
}

async function doSave() {
  clearTimeout(saveTimer);
  try {
    const result = await saveLayout(state.layout, layoutVersion);
    if (result.conflict) {
      // Nothing was written. Which of the two states counts is not this
      // page's decision to make.
      $("conflictText").textContent =
        t("ui.conflict_elsewhere");
      $("conflict").classList.add("show");
      status(t("ui.not_saved"));
      return;
    }
    layoutVersion = result.version;
    tellBuildState(result.buildCurrent);
    // Do NOT replace state.layout with the answer here. The input fields hang
    // off exactly these objects; a fresh graph from the server would leave
    // their handlers pointing at nothing, and everything typed afterwards
    // would be lost until the next render() rebuilds the fields.
    const saved = result.saved;

    // Verify instead of trust: does the file really hold what is on screen?
    // If not, better to say so loudly than to lose it quietly.
    if (comparable(saved) !== comparable(state.layout)) {
      $("conflictText").textContent =
        t("ui.conflict_mismatch");
      $("conflict").classList.add("show");
      status(t("ui.saved_wrong"));
      return;
    }

    unsaved = false;
    $("conflict").classList.remove("show");
    status(t("ui.saved"));
  } catch (error) {
    status(t("ui.save_failed", { error: reason(error) }));
  }
}

// The conflict banner, and the two ways out of it. Wired here rather than in
// main.js because both answers are about layoutVersion, which does not leave
// this file.
export function wireConflict() {
  // Deliberately force through what this page holds.
  $<HTMLButtonElement>("overwriteBtn").onclick = async () => {
    const fresh = await loadLayout(editorFor(FIRST_TARGET).blank());
    layoutVersion = fresh.version;
    tellBuildState(fresh.buildCurrent);
    await save();
  };
  $<HTMLButtonElement>("reloadBtn").onclick = () => load();

  // Whoever closes the window while something is outstanding should notice.
  window.addEventListener("beforeunload", (event) => {
    if (!unsaved) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
