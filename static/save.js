// Writing the layout back, and everything that can go wrong doing it.
//
// saveTimer, unsaved and layoutVersion live here and nowhere else. They were
// three of the eleven at the top of the old script; nothing outside this file
// ever read them, and nothing can now.
import { $, status } from "./dom.js";
import { loadLayout, saveLayout } from "./backend.js";
import { state } from "./state.js";
import { t } from "./texts.js";
import { render } from "./editor.js";

let saveTimer = null;
let layoutVersion = null;   // the state this page loaded
let unsaved = false;        // there are changes not yet in the file

export async function load() {
  const fresh = await loadLayout();
  layoutVersion = fresh.version;
  markReleaseState(fresh.buildCurrent);
  state.layout = fresh.layout;
  if (state.current >= state.layout.sets.length) {
    state.current = Math.max(0, state.layout.sets.length - 1);
  }
  $("conflict").classList.remove("show");
  unsaved = false;
  status("");
  render();
}

// The build button says for itself whether it is due: highlighted while
// data/ does not match the layout, subdued otherwise. That way nobody has to
// remember when a build is needed.
export function markReleaseState(flag) {
  if (flag === null || flag === undefined) return;
  const needed = flag !== "1";
  const button = $("releaseBtn");
  button.classList.toggle("primary", needed);
  button.title = needed
    ? t("ui.release_needed")
    : t("ui.release_current");
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

// Brings the layout into the same shape the server makes of it. Only then can
// the two states be compared meaningfully.
function comparable(l) {
  return JSON.stringify({
    sets: (l.sets || []).map((entry) => ({
      name: (entry.name || "").trim(),
      symbol: (entry.symbol || "").trim(),
      color: (entry.color || "").trim().toUpperCase(),
      slots: (entry.slots || []).map((slot) => ({
        text: (slot.text || "").trim(),
        symbol: (slot.symbol || "").trim(),
      })),
    })),
  });
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
    markReleaseState(result.buildCurrent);
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
    status(t("ui.save_failed", { error: error.message }));
  }
}

// The conflict banner, and the two ways out of it. Wired here rather than in
// main.js because both answers are about layoutVersion, which does not leave
// this file.
export function wireConflict() {
  // Deliberately force through what this page holds.
  $("overwriteBtn").onclick = async () => {
    const fresh = await loadLayout();
    layoutVersion = fresh.version;
    markReleaseState(fresh.buildCurrent);
    await save();
  };
  $("reloadBtn").onclick = () => load();

  // Whoever closes the window while something is outstanding should notice.
  window.addEventListener("beforeunload", (event) => {
    if (!unsaved) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
