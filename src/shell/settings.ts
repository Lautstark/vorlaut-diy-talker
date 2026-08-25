// The Azure key and the METACOM folder live in .env, not in layout.json: they
// belong to this installation, not to the content. So they save through their
// own endpoint - and the key only from the machine itself, see the server.
//
// This is the lower half of the settings sheet. The sheet itself, and its one
// Save, are in voices.js.
import { $, status } from "./dom.js";
import { menuOn } from "@lautstark/design/menu";
import { confirmDialog } from "@lautstark/design/dialog";
import { reason } from "../core/errors.js";
import type { Settings, WantedSettings } from "../core/types.js";
import { readSettings, writeSettings, importBoard, azureState, createCollection,
  listCollections, useCollection } from "../backend/index.js";
import { applyTheme, readTheme, saveTheme, THEMES, type Theme }
  from "@lautstark/design/theme";
import { t } from "../core/texts.js";
import { LANG } from "../core/boot.js";
import { load } from "../core/save.js";
import { paintCollections } from "./collections.js";
import * as symbols from "../data/symbols.js";
import { exportEverything, importBackup, isBackup, TOO_NEW } from "../data/backup.js";
import { paintBackupFolder, wireBackupFolder } from "./backupFolder.js";
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
  // Here as well as in paintStates(), and both callers have their own reason.
  // There it is redrawn because its label is translated and a language switch
  // has to move it. Here it is redrawn because whether METACOM can be chosen
  // at all is derived from whether the folder answers, which is what has just
  // been re-read - and without this the one control that chooses METACOM
  // stayed hidden for as long as the sheet stayed open.
  paintSources();
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

/** Switches the collection a search offers. Nothing on any board moves.
 *
 *  Nothing to repaint afterwards either: the field that names the collection
 *  and the line that credits it are read as a sheet is built - see
 *  picker.ts's searchPlaceholder() and creditLine() - so the next sheet to
 *  open is already right and there is no open one to correct. */
async function useSource(source: "arasaac" | "metacom") {
  if ((settings.activeProvider || "arasaac") === source) return;
  symbols.setActiveSource(source);
  await saveSettings({ activeProvider: source });
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
  // And every panel this file does not own, for the same reason. The Device
  // panel is the one there is: it says whether a port has been granted, which
  // is a state rather than a label, so applyTexts() never touches it. Without
  // this it kept whatever language the page started in - and the page starts
  // in the browser's and then adopts the board's, so on a German board that
  // line was reliably the one English sentence on screen.
  //
  // Through a list rather than by name, because the panel belongs to
  // editor-diy now and the shell may not import it. Registering is how a panel
  // that draws its own state asks to be included in a language switch.
  for (const paint of painters) paint();
}

/* Panels wired outside this file, redrawn whenever the language moves. */
const painters: (() => void)[] = [];

/** Ask to be redrawn with the rest of the sheet. Called at wiring time, so a
 *  panel that hid itself for want of a browser feature never registers and is
 *  never asked. */
export function onPaintPanels(listener: () => void): void {
  painters.push(listener);
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
  const line = $("metacomHereState");
  /* The one state that is a thing to do rather than a thing to read: the folder
   * is still here and the browser has downgraded the permission on it, which
   * Chromium does between visits. It is drawn as a warning rather than as
   * another grey note, because the collection is silently unavailable until
   * somebody presses the button above - and a grey line saying so reads like
   * the others, which are all descriptions. components.css's .notice.bad. */
  const needsAccess = state.kind === "needs-setup" && state.code === "permission-needed";
  // Whether to draw it as a warning is bildquelle's answer; which sentence is
  // this page's. The two differ: `error` needs attention too and has its own
  // words below.
  const attention = symbols.needsAttention(state);
  line.className = attention ? "notice bad" : "note";

  if (needsAccess) {
    line.textContent = t("ui.metacom_confirm");
  } else if (symbols.metacomReady()) {
    line.textContent = t("ui.metacom_here_ok", {
      count: symbols.metacomCount(),
      root: symbols.metacomRoot(),
    });
  } else if (state.kind === "loading") {
    line.textContent = t("ui.metacom_here_busy");
  } else if (state.kind === "error") {
    line.textContent = t("ui.metacom_here_failed");
  } else {
    line.textContent = t("ui.metacom_here_none");
  }
}

/* ------------------------------------------ a Sammlung as a document ---
 *
 * Open Board Format, which is what other AAC software reads. Only the way *in*
 * is here: exporting is in the work head's ⋯, beside the Sammlung it would
 * export, because that is an act on one particular Sammlung and this is not.
 *
 * **It adds; it never replaces.** A file arriving joins the Sammlungen already
 * here, as a new one, named after the file it came from. Replacing was the old
 * behaviour and the argument for it was thin: the two acts are asked for in
 * different words - "open this" and "put my machine back" - and only the second
 * is destructive. Replacing on import made the file's contents and the
 * library's mutually exclusive for no reason anybody asked for; the person has
 * both, and wanted both. conventions.md §1.10.
 *
 * There is nothing to confirm, which is the other half of adding: nothing is
 * lost, so nothing has to be agreed to first.
 */
export function wireImport() {
  // One way in, and it is here rather than in the sidebar: the sidebar holds
  // the list, the way to make one, and the way out of the page. Importing is
  // rare, and it belongs beside the prose that says what the format is.
  $<HTMLButtonElement>("boardImport").onclick = () => $<HTMLInputElement>("boardFile").click();
  $<HTMLInputElement>("boardFile").onchange = async () => {
    const file = $<HTMLInputElement>("boardFile").files[0];
    $<HTMLInputElement>("boardFile").value = "";
    if (!file) return;
    $("boardState").textContent = "";
    try {
      const layout = await importBoard(file);
      // The file's own name, minus its extension: it is what the person called
      // the thing, and it is the only name in the transaction. An .obz carries
      // a name per board - per OBF page - and no name for the document.
      const name = file.name.replace(/\.[^.]+$/, "").trim() || t("ui.collection_name");
      const id = await createCollection(name, layout);
      await useCollection(id);
      await load();
      await paintCollections();
      $("boardState").textContent = t("ui.collection_imported", { name });
    } catch (error) {
      $("boardState").textContent = t("ui.collection_failed", { error: reason(error) });
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
      /* Read first, ask second: a file that turns out to be unreadable should
       * not have cost anybody a question, and this restore replaces every
       * Sammlung here rather than merging into them - a merge would have to
       * decide what an arriving Sammlung and a stored one with the same id
       * are, and every answer to that is a rule the person holding the file
       * cannot see. data/backup.ts argues it at length. conventions.md §1.10
       * allows the replacement; it is the one act that is a whole-library
       * restore rather than an import.
       *
       * The question is a <dialog>, not window.confirm (§3.4). This was the
       * last native one in the family and it was on the most destructive path
       * in the product - the one surface no token reaches, asking about
       * everything somebody has.
       *
       * And it counts what goes (§1.7). "Fortfahren?" named nothing: a person
       * with one Sammlung and a person with nine were asked the same question,
       * and the number is the only thing in it that could change a mind. Two
       * keys rather than a plural rule, the way the delete question does it -
       * the singular differs by more than an ending in both languages. */
      const here = (await listCollections()).collections.length;
      const one = here === 1 ? "_one" : "";
      if (!await confirmDialog({
        title: t("ui.data_replace"),
        body: t(`ui.data_replace_ask${one}`, { n: here }),
        confirmLabel: t(`ui.data_replace_go${one}`, { n: here }),
        cancelLabel: t("ui.cancel"),
        // Never the same word as the button beside it: two dismissals sharing
        // an accessible name is ambiguous to anyone navigating by it.
        closeLabel: t("ui.close"),
        danger: true,
      })) return;
      const done = await importBackup(parsed);
      // The store has them; this page is still holding the board it had.
      // load() re-reads whichever board the file says was open, adopts its
      // language and resets the stamp this page writes against.
      // replaceLayout() was here and is wrong on both counts now: it would
      // write the restored board straight back under the version from before
      // the restore, which is this tab conflicting with itself.
      await load();
      await paintCollections();
      $("dataState").textContent =
        t("ui.data_imported", { boards: done.boards, symbols: done.symbols });
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
    // Copied out, not just referenced. input.files hands back the same
    // FileList object every time, and clearing the value empties that object
    // in place - so the length was read as 0 a line later and the folder was
    // never read at all. This is the Firefox and Safari path, where it was
    // the only way to connect a collection.
    const files = Array.from(input.files || []);
    input.value = "";
    if (files.length) await symbols.readMetacomFiles(files);
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
    }
  };

  // The provider says when a folder arrives or goes; nothing here polls.
  //
  // The whole sheet and not just this panel. A folder arriving changes more
  // than the line that names it: whether METACOM can be the active source is
  // derived from whether it answers, so paintSources() was still drawing the
  // answer from before - and the one control that chooses METACOM stayed
  // hidden on the panel that had just become choosable. Reconnecting with the
  // sheet open left no way to pick it short of closing and opening again.
  symbols.subscribeMetacom(() => void loadSettings());
}

// Where the symbols come from, in one line. Twice over, because the heading
// has room for two words and the line under the field has room for a
// sentence - and only the "nothing set" case differs between the two.
function metacomWord(short) {
  const where = settings.metacom;
  // The folder is there and one click re-confirms it - a different sentence
  // from "not set" and from "unreadable", because the remedy is different.
  const state = symbols.metacomStatus();
  /* A state, not an instruction. This returned the whole sentence telling
   * somebody which button to press, and it is written into the panel's summary
   * - where design.md says a heading carries what a section IS set to. A
   * summary is one line and gets truncated, so the instruction arrived as its
   * own first half and stopped mid-clause. The
   * sentence is in the body now, where it has room and where the button it
   * names is. bildhaft's panel does the same: a short state above, the words
   * about what to do beside the control. */
  if (state.kind === "needs-setup" && state.code === "permission-needed") {
    return t("ui.metacom_needs_access");
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
