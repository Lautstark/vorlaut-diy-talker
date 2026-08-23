// The Azure key and the METACOM folder live in .env, not in layout.json: they
// belong to this installation, not to the content. So they save through their
// own endpoint - and the key only from the machine itself, see the server.
//
// This is the lower half of the settings sheet. The sheet itself, and its one
// Save, are in voices.js.
import { $, closeMenus, menuOn, status } from "./dom.js";
import { reason, Trouble } from "../core/errors.js";
import type { Settings, WantedSettings } from "../core/types.js";
import { readSettings, writeSettings, exportBoard, importBoard, azureState,
  exportBuild, folderExportSupported } from "../backend/index.js";
import { applyTheme, readTheme, saveTheme, THEMES, type Theme }
  from "@lautstark/design/theme";
import { t } from "../core/texts.js";
import { LANG } from "../core/boot.js";
import { replaceLayout } from "../core/save.js";
import { showSources } from "./picker.js";
import * as symbols from "../data/symbols.js";
import { exportEverything, importBackup, isBackup, TOO_NEW } from "../data/backup.js";
import { paintBackupFolder, wireBackupFolder } from "./backupFolder.js";
import { connectDevice, haveDevice, onDevices } from "./device.js";
import type { Sicherung } from "@lautstark/sicherung";

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
  renderRenderings();
}

/* The rendering chooser. METACOM ships the same symbols several times over -
 * with and without a frame, with and without the word printed on the picture -
 * as parallel folders holding identical file names, and bildquelle derives the
 * list from the index rather than from any list of known folder names, because
 * a user's copy is theirs.
 *
 * Ordering only: nothing is filtered out, so a symbol that lives in just one
 * of them stays reachable, and a key that already holds a picture keeps it.
 * Only shown when the folder holds more than one - a copy pointed straight at
 * a single rendering has nothing to choose between, and an empty dropdown is
 * a question with one answer. */
function renderRenderings() {
  const box = $("renderingBox");
  const pick = $("renderingPick");
  const found = symbols.metacomReady() ? symbols.metacomRenderings() : [];
  box.hidden = found.length < 2;
  if (box.hidden) return;

  $("renderingLabel").textContent = t("ui.rendering");
  $("renderingNote").textContent = t("ui.rendering_note");

  /* A button and a menu rather than a select, for the reason dom.ts gives:
     the open list of a select is the operating system's drawing and is the
     one thing on this page that cannot follow the tokens. */
  const label = (segment: string | null): string =>
    segment === null
      ? t("ui.rendering_none")
      : t("ui.rendering_option",
          { segment, count: found.find((e) => e.segment === segment)?.count ?? 0 });

  const paint = (): void => { pick.textContent = label(symbols.preferredRendering() || null); };
  paint();

  pick.onclick = () => menuOn(pick, (add) => {
    const live = symbols.preferredRendering() || null;
    const choose = (chosen: string | null) => () => {
      closeMenus();
      // Told to the provider and written down, in that order: the provider
      // ranks the next search by it, and without the second half the choice
      // lasted exactly as long as the tab did.
      symbols.preferRendering(chosen);
      void saveSettings({ metacomRendering: chosen });
      paint();
    };
    add(label(null), choose(null), { checked: live === null });
    for (const entry of found)
      add(label(entry.segment), choose(entry.segment), { checked: live === entry.segment });
  });
}

/* The state line of every panel, re-read rather than remembered. Called when
 * the sheet opens, after a save, and after a language switch - which is the
 * one that matters, because a heading that keeps its old language while the
 * body changes is worse than one that never changed at all. */
/* Which collection the picker offers, and the one control that changes it.
 *
 * Marked on both panels rather than only on the active one: a heading saying
 * "Aktive Quelle" tells you which is on, and a heading that says nothing tells
 * you the other is off only if you already knew that is what silence meant.
 * The button appears on the panel that is NOT active, because a button saying
 * "use this" on the thing already in use is a no-op somebody has to read
 * twice.
 *
 * METACOM cannot be chosen without a folder, so its button is absent then -
 * the panel above already says why, and readSettings() refuses the value. */
function paintSources() {
  const active = settings.activeProvider || "arasaac";

  const useArasaac = $<HTMLButtonElement>("arasaacUse");
  useArasaac.textContent = t("ui.source_use");
  useArasaac.hidden = active === "arasaac";

  const useMetacom = $<HTMLButtonElement>("metacomUse");
  useMetacom.textContent = t("ui.source_use");
  useMetacom.hidden = active === "metacom" || !symbols.metacomReady();
}

/** Switches the collection the picker offers. Nothing on any board moves. */
async function useSource(source: "arasaac" | "metacom") {
  if ((settings.activeProvider || "arasaac") === source) return;
  symbols.setActiveSource(source);
  await saveSettings({ activeProvider: source });
  showSources();
}

export function wireSources() {
  $<HTMLButtonElement>("arasaacUse").onclick = () => void useSource("arasaac");
  $<HTMLButtonElement>("metacomUse").onclick = () => void useSource("metacom");
}

/* ------------------------------------------------------------ the scheme ---
 *
 * localStorage rather than the settings this module otherwise reads and writes,
 * and the reason is timing rather than taste: the scheme has to be readable
 * before the first paint or the page comes up in the OS's answer and corrects
 * itself a frame later, which is a white flash on exactly the setup somebody
 * chose dark to avoid. readSettings() is asynchronous. The inline script in
 * index.html is the half that runs before this module exists;
 * @lautstark/design/theme carries the rest, and both siblings share it.
 *
 * It is not written into the board either. A board travels - it is exported,
 * imported and flashed onto a device - and how bright this browser is on this
 * tablet is not a property of the board.
 */
const THEME_KEY = "vorlaut.theme";

const themeLabel = (theme: Theme): string => t(`ui.theme_${theme}`);

/** The three answers, with the one in force pressed. */
export function paintTheme() {
  const current = readTheme(THEME_KEY);
  const box = $("themePick");
  box.textContent = "";
  for (const theme of THEMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = themeLabel(theme);
    button.setAttribute("aria-pressed", String(theme === current));
    button.onclick = () => {
      saveTheme(THEME_KEY, theme);
      applyTheme(theme);
      // This control and its heading, and nothing else: the tokens carry the
      // scheme to everything else on the page, which is what tokens are for.
      paintTheme();
      $("themeState").textContent = themeLabel(theme);
    };
    box.appendChild(button);
  }
}

export function paintStates() {
  $("languageState").textContent = LANGUAGE_NAMES[LANG] || LANG;
  $("themeState").textContent = themeLabel(readTheme(THEME_KEY));
  // The three labels are drawn from here rather than carried by the markup, so
  // applyTexts() cannot reach them and a language switch has to redraw them.
  paintTheme();
  const active = settings.activeProvider || "arasaac";
  $("arasaacState").textContent =
    active === "arasaac" ? t("ui.source_active") : t("ui.arasaac_state");
  $("arasaacIntro").textContent = t("ui.arasaac_intro");
  $("arasaacCredit").textContent = symbols.attributionFor(["arasaac"]).join(" ");
  $("symbolsState").textContent =
    active === "metacom" ? t("ui.source_active") : metacomWord(true);
  paintSources();
  // Base line first, then ask Azure - the same pair renderSettings() draws,
  // and in the same order. Setting only the base here is what broke the two
  // Azure tests: "stored" describes this database and would sit on top of the
  // probe's answer, which is the only line that describes whether the key
  // works. That answer is the whole reason azureState() exists.
  $("azureState").textContent = settings.azureKey.set
    ? t("ui.azure_key_stored")
    : t("ui.azure_key_none");
  probeAzure();
  // The Daten panel's own state line, which is drawn by the module that owns
  // the folder rather than from here - it is the one panel whose sentence is
  // built from a status this file never sees.
  paintBackupFolder();
  // And the Device panel's, for the same reason: it says whether a port has
  // been granted, which is a state rather than a label, so applyTexts() never
  // touches it. Without this it kept whatever language the page started in -
  // and the page starts in the browser's and then adopts the board's, so on a
  // German board this line was reliably the one English sentence on screen.
  paintDevice();
}

/** The languages this page offers, by their own names. */
export const LANGUAGE_NAMES: Record<string, string> = { de: "Deutsch", en: "English" };

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

/* Whether a port has been granted, in words.
 *
 * Null until the panel is wired, and hidden panels have no stale sentence to
 * fix - the same shape paintBackupFolder() uses, and for the same reason: this
 * runs from paintStates() after a language switch, which can happen before
 * anybody has opened the sheet. */
let sayLink: () => void = () => {};

export function paintDevice(): void {
  sayLink();
}

/** The Device panel: connecting to a talker, and the build written where
 *  something other than this page can pick it up.
 *
 * One button, one picker, and no state kept between runs - the reasoning for
 * all three is at the head of backend/folder.ts. The panel hides itself where
 * there is no picker rather than explaining, the way the backup folder does:
 * a browser that cannot do this should not be handed a paragraph about it.
 */
export function wireDevice() {
  const box = $("devicePanel");
  if (!folderExportSupported()) {
    box.hidden = true;
    return;
  }

  // Assigned before anything calls it, and subscribed through a wrapper: a
  // listener registered with the value of `sayLink` would hold whichever
  // function was there at the time, which is the empty one above.
  sayLink = () => {
    $("deviceLink").textContent =
      haveDevice() ? t("ui.device_connected") : t("ui.device_none");
  };
  sayLink();
  onDevices(() => sayLink());

  const connect = $<HTMLButtonElement>("deviceConnect");
  connect.onclick = async () => {
    // The gesture is why this is a button, and why it is not behind anything
    // slow: requestPort() is refused without one and Chrome expires it in
    // about five seconds.
    connect.disabled = true;
    try {
      // A dismissed picker says nothing. Somebody closed a dialog; that is an
      // answer, not a failure, and the line above still says what is true.
      if (await connectDevice()) $("deviceState").textContent = "";
    } finally {
      connect.disabled = false;
    }
  };

  const button = $<HTMLButtonElement>("buildExport");
  button.onclick = async () => {
    $("deviceState").textContent = "";
    button.disabled = true;
    try {
      // The gesture is why this is a button: showDirectoryPicker() is refused
      // without one.
      const done = await exportBuild({
        onFile: (_name, at, total) =>
          { $("deviceState").textContent = t("ui.build_writing", { done: at, total }); },
      });
      // Dismissed. Somebody changed their mind, and the panel says nothing.
      if (!done) { $("deviceState").textContent = ""; return; }
      $("deviceState").textContent = t("ui.build_written", {
        folder: done.folder, written: done.written, removed: done.removed,
        size: Math.round(done.bytes / 1024),
      });
    } catch (error) {
      $("deviceState").textContent = error instanceof Trouble
        ? t(`err.${error.word}`)
        : t("ui.data_failed", { error: reason(error) });
    } finally {
      button.disabled = false;
    }
  };
}

/** The Daten panel: the standing backup, and the one-file Sicherung under it.
 *
 * Separate from wireBoard above, and the separation is the point. That panel
 * hands out an .obz - a board, in the format other AAC software reads. This
 * one is about this browser's whole state, in a shape only vorlaut reads, and
 * the two would blur into "export" if they shared a panel. */
export function wireData(backup: Sicherung) {
  wireBackupFolder(backup, (message) => { $("dataState").textContent = message; });

  $<HTMLButtonElement>("dataExport").onclick = async () => {
    $("dataState").textContent = "";
    try {
      const blob = new Blob([JSON.stringify(await exportEverything(t("ui.data_notice")), null, 2)],
        { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      link.download = `vorlaut-sicherung-${stamp}.json`;
      link.click();
      // Revoked later rather than here, for the reason wireBoard records: the
      // click returns before the browser has opened the URL, and a blob
      // revoked in that gap is a download that silently never begins.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      $("dataState").textContent = t("ui.data_exported");
    } catch (error) {
      $("dataState").textContent = t("ui.data_failed", { error: reason(error) });
    }
  };

  $<HTMLButtonElement>("dataImport").onclick = () => $<HTMLInputElement>("dataFile").click();
  $<HTMLInputElement>("dataFile").onchange = async () => {
    const file = $<HTMLInputElement>("dataFile").files[0];
    $<HTMLInputElement>("dataFile").value = "";
    if (!file) return;
    $("dataState").textContent = "";
    try {
      const parsed = JSON.parse(await file.text());
      if (!isBackup(parsed)) throw new Error(t("ui.data_failed", { error: file.name }));
      // Read first, ask second: a file that turns out to be unreadable should
      // not have cost anybody a question, and this restore replaces the board
      // rather than merging into it - there is one board here, not a library
      // of them, and "merge two layouts" is not a thing anybody could describe.
      if (!confirm(t("ui.data_replace_ask"))) return;
      const done = await importBackup(parsed);
      // The store has it; the page is still holding the old one until it is
      // told. This is that telling.
      if (done.layout) await replaceLayout(done.layout);
      $("dataState").textContent = t("ui.data_imported", { symbols: done.symbols });
    } catch (error) {
      // The data layer has no language and answers with a code; this is where
      // the code becomes a sentence.
      $("dataState").textContent = error instanceof Error && error.message === TOO_NEW
        ? t("ui.data_too_new")
        : t("ui.data_failed", { error: reason(error) });
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
  // Forgetting the folder cannot leave METACOM as the source: the picker
  // would have nothing to search and would say so on every keystroke. The
  // fallback is written down rather than left to readSettings() to infer on
  // the next visit, so the answer is the same before and after a reload.
  $<HTMLButtonElement>("metacomForget").onclick = async () => {
    await symbols.forgetMetacom();
    if ((settings.activeProvider || "arasaac") === "metacom") {
      symbols.setActiveSource("arasaac");
      await saveSettings({ activeProvider: "arasaac" });
      showSources();
    }
  };

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
    // Before anything draws: the provider ranks its search results by this,
    // so a preference that arrives after the first search would silently not
    // have applied to it.
    symbols.preferRendering(settings.metacomRendering ?? null);
    // readSettings() has already refused "metacom" when no folder answers, so
    // this is the source the picker can actually search.
    symbols.setActiveSource(settings.activeProvider || "arasaac");
    renderSettings();
  } catch (error) {
    status(t("ui.voice_failed", { error: reason(error) }));
  }
}

/** Writes what the sheet's fields hold.
 *
 * `extra` is for the settings that are not fields - the rendering preference
 * is a select that acts on change, not something read back off the form when
 * some other panel is saved. It merges in last so a caller saying nothing
 * about a setting leaves it alone. */
export async function saveSettings(
  extra: Partial<WantedSettings> = {},
): Promise<{ azureChanged: boolean }> {
  const wanted: WantedSettings = {
    azureRegion: $<HTMLInputElement>("azureRegion").value.trim(),
    metacom: $<HTMLInputElement>("metacomPath").value.trim(),
    ...extra,
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
