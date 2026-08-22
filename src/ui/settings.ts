// The Azure key and the METACOM folder live in .env, not in layout.json: they
// belong to this installation, not to the content. So they save through their
// own endpoint - and the key only from the machine itself, see the server.
//
// This is the lower half of the settings sheet. The sheet itself, and its one
// Save, are in voices.js.
import { $, status} from "./dom.js";
import { reason } from "../core/errors.js";
import type { Settings, WantedSettings } from "../core/types.js";
import { readSettings, writeSettings, exportBoard, importBoard, azureState } from "../backend/index.js";
import { t } from "../core/texts.js";
import { replaceLayout } from "../core/save.js";
import * as symbols from "../data/symbols.js";

let settings: Settings = { azureKey: { set: false, hint: "" }, azureRegion: "",
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
  $<HTMLInputElement>("azureRegion").value = settings.azureRegion || "";
  $<HTMLInputElement>("metacomPath").value = settings.metacom.path || "";
  // The key is never sent back to the page, so the field starts empty and
  // means "leave it alone" until somebody types in it.
  $<HTMLInputElement>("azureKey").value = "";
  $<HTMLInputElement>("azureKey").placeholder = keyPlaceholder();
  $<HTMLInputElement>("azureKey").disabled = !settings.local;
  // Only the one thing the field cannot show by itself. That a key is stored,
  // and which one, is in the placeholder above and in the heading below.
  $("azureKeyState").textContent = settings.local ? "" : t("ui.azure_local_only");
  probeAzure();
  $("azureState").textContent = settings.azureKey.set
    ? t("ui.azure_key_stored")
    : t("ui.azure_key_none");
  const forget = $<HTMLButtonElement>("azureForget");
  forget.textContent = t("ui.azure_forget");
  // Only when there is a key to remove, and only where the key can be touched
  // at all - away from the machine the whole panel is read-only.
  forget.hidden = !settings.azureKey.set || !settings.local;

  $("metacomState").textContent = metacomWord(false);
  $("symbolsState").textContent = metacomWord(true);
  // A folder that was set and cannot be read is the one state worth unfolding
  // for: somebody meant to configure this and it is not working.
  if (settings.metacom.path && !settings.metacom.ok) $<HTMLDetailsElement>("symbolsPanel").open = true;

  // Handed in from outside - the container. The path in the field is the one
  // inside it, a host path typed here could not take effect, and the write
  // would land in the .env that the mount is read from. Same shape as the
  // Azure key above: disabled, and the line under the field says why rather
  // than leaving somebody to wonder at a save that changed nothing.
  //
  // That line replaces what was found rather than adding to it: the heading
  // is already saying it, two lines up.
  $<HTMLInputElement>("metacomPath").disabled = !!settings.metacom.fixed;
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
  $<HTMLButtonElement>("metacomChoose").textContent = t("ui.metacom_choose");
  $<HTMLButtonElement>("metacomForget").textContent = t("ui.metacom_forget");
  $("metacomBuildNote").textContent = t("ui.metacom_build_uses");
  $<HTMLButtonElement>("metacomForget").hidden = !symbols.metacomReady();

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

/* ------------------------------------------------- the board as a document ---
 *
 * Open Board Format, which is what other AAC software reads. The buttons live
 * in the settings sheet rather than the header because this is not something
 * anybody does while editing - it is how a board leaves or arrives.
 */
export function wireBoard() {
  $<HTMLButtonElement>("boardExport").onclick = async () => {
    $("boardState").textContent = "";
    try {
      const blob = await exportBoard();
      // Handed to the browser as a download rather than kept anywhere: the
      // point of the export is that it leaves.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "board.obz";
      link.click();
      // Revoked later rather than here. The click returns before the browser
      // has opened the URL, and a blob revoked in that gap is a download that
      // silently never begins - the e2e's waitForEvent("download") is what
      // caught it. A minute is arbitrary and generous; the cost of holding a
      // small blob that long is nothing next to an export that sometimes
      // does not happen.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      $("boardState").textContent = t("ui.board_exported");
    } catch (error) {
      $("boardState").textContent = t("ui.board_failed", { error: reason(error) });
    }
  };

  $<HTMLButtonElement>("boardImport").onclick = () => $<HTMLInputElement>("boardFile").click();
  $<HTMLInputElement>("boardFile").onchange = async () => {
    const file = $<HTMLInputElement>("boardFile").files[0];
    $<HTMLInputElement>("boardFile").value = "";
    if (!file) return;
    $("boardState").textContent = "";
    try {
      const layout = await importBoard(file);
      // Read first, ask second: a board that turns out to be unreadable should
      // not have cost anybody a question, and this is the only chance to say
      // what is about to be replaced while both still exist.
      if (!confirm(t("ui.board_replace_ask"))) return;
      await replaceLayout(layout);
      $("boardState").textContent = t("ui.board_imported");
    } catch (error) {
      $("boardState").textContent = t("ui.board_failed", { error: reason(error) });
    }
  };
}

export function wireSymbolFolder() {
  // Chromium remembers the choice; everywhere else the file input reads the
  // folder for this session only. One button either way, so the difference
  // does not become a thing to explain.
  $<HTMLButtonElement>("metacomChoose").onclick = async () => {
    try {
      // A folder chosen on an earlier visit is usually still here, one
      // permission click away - reconnect first, and only open the picker
      // when there is nothing to reconnect to. Without this, every return
      // visit cost re-picking the folder from scratch.
      const status = symbols.metacomStatus();
      if (status.kind === "needs-setup" && status.code === "permission-needed"
          && await symbols.reconnectMetacom()) return;
      if (symbols.remembersFolder) await symbols.chooseMetacomFolder();
      else $<HTMLInputElement>("metacomFiles").click();
    } catch (error) {
      // An abandoned picker throws, and is not a failure worth reporting.
      if (!(error instanceof DOMException) || error.name !== "AbortError") status(reason(error));
    }
  };
  $<HTMLInputElement>("metacomFiles").onchange = async (event) => {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    input.value = "";
    if (files && files.length) await symbols.readMetacomFiles(files);
  };
  $<HTMLButtonElement>("metacomForget").onclick = () => symbols.forgetMetacom();

  // The provider says when a folder arrives or goes; nothing here polls.
  symbols.subscribeMetacom(renderHere);
}

// Where the symbols come from, in one line. Twice over, because the heading
// has room for two words and the line under the field has room for a
// sentence - and only the "nothing set" case differs between the two.
function metacomWord(short) {
  const where = settings.metacom;
  // The folder is there and one click re-confirms it - a different sentence
  // from "not set" and from "unreadable", because the remedy is different.
  const state = symbols.metacomStatus();
  if (state.kind === "needs-setup" && state.code === "permission-needed") {
    return t("ui.metacom_confirm");
  }
  if (!where.path) return t(short ? "ui.metacom_short_none" : "ui.metacom_none");
  if (!where.ok) return t("ui.metacom_bad");
  return t("ui.metacom_ok", {
    count: where.count,
    kind: t(where.keywords ? "ui.metacom_keywords" : "ui.metacom_names"),
  });
}

/** Replaces "stored" with whether the key actually works, asynchronously.
 *
 * "stored" is a statement about this database; the person who typed a key
 * wants to know whether Azure answers. A wrong region used to cost the Azure
 * rows in silence - the fetch fails before any status exists, listVoices()
 * keeps the piper voices alive by swallowing it, and nothing anywhere said
 * why the list looked exactly as if no key had been typed. */
async function probeAzure() {
  if (!settings.azureKey.set || !settings.azureRegion) return;
  const summary = $("azureState");
  summary.textContent = t("ui.azure_checking");
  const state = await azureState();
  if (!state.configured) return;
  summary.textContent = state.ok
    ? t("ui.azure_ok", { count: state.count })
    : t(state.code === "unreachable" ? "ui.azure_unreachable"
      : state.code === "refused" ? "ui.azure_refused" : "ui.azure_probe_failed");
}

export async function loadSettings() {
  try {
    settings = await readSettings();
    renderSettings();
  } catch (error) {
    status(t("ui.voice_failed", { error: reason(error) }));
  }
}

export async function saveSettings(): Promise<{ azureChanged: boolean }> {
  const wanted: WantedSettings = {
    azureRegion: $<HTMLInputElement>("azureRegion").value.trim(),
    metacom: $<HTMLInputElement>("metacomPath").value.trim(),
  };
  // Only when something was typed: an untouched field must not wipe the key.
  const typed = $<HTMLInputElement>("azureKey").value.trim();
  if (typed) wanted.azureKey = typed;
  const azureChanged = !!typed || wanted.azureRegion !== (settings.azureRegion || "");
  settings = await writeSettings(wanted);
  renderSettings();
  return { azureChanged };
}

/** Drops the stored key, as its own act.
 *
 * The empty field already means "leave the key alone" - the guard above - so
 * the field cannot double as the way to remove one. Until this existed it did
 * not merely fail to: there was no way to remove a key at all, because
 * writeSettings only ever set it. The region and the METACOM path ride along
 * exactly as a save would take them; the null is the whole difference. */
export async function forgetKey() {
  settings = await writeSettings({
    azureRegion: $<HTMLInputElement>("azureRegion").value.trim(),
    metacom: $<HTMLInputElement>("metacomPath").value.trim(),
    azureKey: null,
  });
  renderSettings();
}
