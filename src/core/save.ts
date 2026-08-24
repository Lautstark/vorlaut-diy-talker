// Writing the layout back, and everything that can go wrong doing it.
//
// saveTimer, unsaved and layoutVersion live here and nowhere else. They were
// three of the eleven at the top of the old script; nothing outside this file
// ever read them, and nothing can now.
import { $, status} from "../shell/dom.js";
import { reason } from "./errors.js";
import { loadLayout, saveLayout } from "../backend/index.js";
import { state } from "./state.js";
import { applyTexts, t } from "./texts.js";
import { LANG, setLanguage } from "./boot.js";
import { paintLanguage } from "../shell/voices.js";
import { showSources } from "../shell/picker.js";
import { editorFor, FIRST_TARGET, showEditorFor } from "./editor.js";
import type { Layout } from "./types.js";

let saveTimer = null;
let layoutVersion = null;   // the state this page loaded
let unsaved = false;        // there are changes not yet in the file

/* The language the arriving layout was written in, put in force.
 *
 * boot.ts opens the page in the reader's own language because that is the only
 * answer it has before the store has said anything - and it says so: the one
 * in the layout wins once it has been read. This is the reading. Without it
 * the choice was written on every switch and read back on none, so it lasted
 * exactly as long as the tab did.
 *
 * At every arrival rather than only at load, because an imported board is
 * saved as it lands: a page that kept the old language here would come up in
 * the board's at the next reload anyway, and the two answers must not differ.
 *
 * Only the fixed labels and the button naming the language. applyTexts() also
 * carries the lang attribute on <html>, so that is not set again here. The
 * caller renders the board, and the settings sheet paints its own state lines
 * when it opens - which is why nothing here reaches into a sheet that has
 * never been opened and has nothing loaded to paint. */
function adoptLanguage(layout) {
  // setLanguage() refuses a code the page does not speak, so an unreadable
  // language in a layout leaves everything as it was rather than emptying it.
  if (!layout.language || layout.language === LANG) return;
  setLanguage(layout.language);
  applyTexts();
  paintLanguage();
  // The symbol dialog's credit line, which applyTexts() does not reach: it is
  // written by showSources() and by nothing else, so it alone kept whatever
  // language the browser guessed. Everything else in that dialog is a fixed
  // label and was already being redrawn - which is why the line sat there in
  // English under a German heading rather than looking broken enough to find.
  showSources();
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
  // Before the two below, and that is the order rather than the arrangement:
  // a build-mark subscriber writes its button's title through t() and the
  // editor draws the board, so a language adopted after them would leave both
  // saying what the browser guessed until something else redrew them.
  adoptLanguage(state.layout);
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

// Save what is on screen now, and drop the pending debounce - otherwise it
// fires afterwards and writes the same thing a second time. The release
// button is the one caller: it exists so that saveTimer need not leave this
// file.
export function saveNow() {
  clearTimeout(saveTimer);
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
  adoptLanguage(state.layout);
  // An imported Sammlung may be for the other target than the one on screen,
  // so this is the same call load() makes rather than a bare adopt().
  showEditorFor(state.layout);
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
