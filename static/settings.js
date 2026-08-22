// The Azure key and the METACOM folder live in .env, not in layout.json: they
// belong to this installation, not to the content. So they save through their
// own endpoint - and the key only from the machine itself, see the server.
//
// This is the lower half of the settings sheet. The sheet itself, and its one
// Save, are in voices.js.
import { $, status } from "./dom.js";
import { readSettings, writeSettings } from "./backend.js";
import { t } from "./texts.js";
import * as symbols from "./symbols.js";

let settings = { azureKey: { set: false, hint: "" }, azureRegion: "",
                 metacom: { path: "", ok: false, count: 0, keywords: false,
                            fixed: false },
                 local: true };

// What a stored key looks like in the field: the four characters it ends in,
// behind enough dots to read as a secret. It is the placeholder and not the
// value, which is the point - the field stays empty, so it still means "leave
// the key alone" and there is nothing here to submit, copy or mistake for the
// key itself. Typing replaces it the way typing replaces any placeholder.
const MASK = "\u2022\u2022\u2022\u2022";

function keyPlaceholder() {
  if (!settings.azureKey.set) return t("ui.azure_key_placeholder");
  // Away from the machine itself the last four are not handed over - see
  // settings_state() in app.py. Then the dots alone say a key is there.
  return MASK + (settings.azureKey.hint || MASK);
}

function renderSettings() {
  $("azureRegion").value = settings.azureRegion || "";
  $("metacomPath").value = settings.metacom.path || "";
  // The key is never sent back to the page, so the field starts empty and
  // means "leave it alone" until somebody types in it.
  $("azureKey").value = "";
  $("azureKey").placeholder = keyPlaceholder();
  $("azureKey").disabled = !settings.local;
  // Only the one thing the field cannot show by itself. That a key is stored,
  // and which one, is in the placeholder above and in the heading below.
  $("azureKeyState").textContent = settings.local ? "" : t("ui.azure_local_only");
  $("azureState").textContent = settings.azureKey.set
    ? t("ui.azure_key_stored")
    : t("ui.azure_key_none");

  $("metacomState").textContent = metacomWord(false);
  $("symbolsState").textContent = metacomWord(true);
  // A folder that was set and cannot be read is the one state worth unfolding
  // for: somebody meant to configure this and it is not working.
  if (settings.metacom.path && !settings.metacom.ok) $("symbolsPanel").open = true;

  // Handed in from outside - the container. The path in the field is the one
  // inside it, a host path typed here could not take effect, and the write
  // would land in the .env that the mount is read from. Same shape as the
  // Azure key above: disabled, and the line under the field says why rather
  // than leaving somebody to wonder at a save that changed nothing.
  //
  // That line replaces what was found rather than adding to it: the heading
  // is already saying it, two lines up.
  $("metacomPath").disabled = !!settings.metacom.fixed;
  if (settings.metacom.fixed) {
    $("metacomState").textContent = t("ui.metacom_fixed");
  }

  renderHere();
}

/* --------------------------------------- the folder this browser can read ---

 * Two folders, briefly, and the panel says so rather than pretending
 * otherwise. Searching happens in the browser now and reads the folder chosen
 * here; the build still runs in Python and reads the path in the field above.
 * They are the same collection in every sane setup - a metacom: reference is
 * a file name, so the two agree as long as both point at a METACOM - and when
 * the build moves into the browser the field above goes and this is all that
 * is left.
 *
 * Nothing here uploads, copies or stores a symbol. The folder is read where it
 * lies; see docs/symbol-search.md.
 */
function renderHere() {
  $("metacomHereLabel").textContent = t("ui.metacom_here");
  $("metacomChoose").textContent = t("ui.metacom_choose");
  $("metacomForget").textContent = t("ui.metacom_forget");
  $("metacomBuildNote").textContent = t("ui.metacom_build_uses");
  $("metacomForget").hidden = !symbols.metacomReady();

  const state = symbols.metacomStatus();
  if (symbols.metacomReady()) {
    $("metacomHereState").textContent = t("ui.metacom_here_ok", {
      count: symbols.metacomCount(),
      root: symbols.metacomRoot(),
    });
  } else if (state.kind === "loading") {
    $("metacomHereState").textContent = t("ui.metacom_here_busy");
  } else if (state.kind === "error") {
    $("metacomHereState").textContent = t("ui.metacom_here_failed");
  } else {
    $("metacomHereState").textContent = t("ui.metacom_here_none");
  }
}

export function wireSymbolFolder() {
  // Chromium remembers the choice; everywhere else the file input reads the
  // folder for this session only. One button either way, so the difference
  // does not become a thing to explain.
  $("metacomChoose").onclick = async () => {
    try {
      if (symbols.remembersFolder) await symbols.chooseMetacomFolder();
      else $("metacomFiles").click();
    } catch (error) {
      // An abandoned picker throws, and is not a failure worth reporting.
      if (error && error.name !== "AbortError") status(error.message);
    }
  };
  $("metacomFiles").onchange = async (event) => {
    const files = event.target.files;
    event.target.value = "";
    if (files && files.length) await symbols.readMetacomFiles(files);
  };
  $("metacomForget").onclick = () => symbols.forgetMetacom();

  // The provider says when a folder arrives or goes; nothing here polls.
  symbols.subscribeMetacom(renderHere);
}

// Where the symbols come from, in one line. Twice over, because the heading
// has room for two words and the line under the field has room for a
// sentence - and only the "nothing set" case differs between the two.
function metacomWord(short) {
  const where = settings.metacom;
  if (!where.path) return t(short ? "ui.metacom_short_none" : "ui.metacom_none");
  if (!where.ok) return t("ui.metacom_bad");
  return t("ui.metacom_ok", {
    count: where.count,
    kind: t(where.keywords ? "ui.metacom_keywords" : "ui.metacom_names"),
  });
}

export async function loadSettings() {
  try {
    settings = await readSettings();
    renderSettings();
  } catch (error) {
    status(t("ui.voice_failed", { error: error.message }));
  }
}

export async function saveSettings() {
  const wanted = {
    azureRegion: $("azureRegion").value.trim(),
    metacom: $("metacomPath").value.trim(),
  };
  // Only when something was typed: an untouched field must not wipe the key.
  const typed = $("azureKey").value.trim();
  if (typed) wanted.azureKey = typed;
  settings = await writeSettings(wanted);
  renderSettings();
}
