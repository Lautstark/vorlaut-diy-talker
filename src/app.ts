// Wiring the page up, once its structure is in the document.
//
// This is the whole of what main.ts used to do below its imports. It is a
// separate module for one reason, and it is a real one: an ES import runs
// before any statement in the file that imports it, so nothing here could be
// guaranteed to happen after the templates had mounted while it lived beside
// them. editor.ts looked #removeSet up at module level, and under the old
// single-file page that element was already in the document when the first
// module loaded. It stopped being so, and the failure was the page throwing
// before it drew anything - which is exactly the shape of breakage this
// repository shipped once already. That button is in the set's own card now
// and the lookup went with it; the ordering this file exists for has not
// changed, because #previewToggle is reached the same way.
//
// main.ts mounts, then imports this. The ordering is then a fact about the
// module graph rather than a convention somebody has to keep.
//
// This is also the composition root: the one module that names all three
// parts of the page. The shell owns the Sammlungen, the storage, the symbols,
// the voices and the settings; editor-diy owns the five-key device; editor-app
// owns the tablet. useEditors() below is where the two editors are handed to
// the shell, and it is the only place any of those arrows exists -
// tests/unit/layers.test.ts holds the rest of src/shell/ to importing nothing
// out of either editor, and each editor to importing nothing out of the other.
//
// The editors' markup mounts here rather than in main.ts, and that is the
// whole reason this file grew a mount function. Which editor a page needs is a
// fact about the Sammlung, so it cannot be known until the store has answered
// - and the two must not both be in the document, or a tablet Sammlung would
// carry a #releaseBtn that the shell could reach without importing anything.
// That is the shape of coupling this split exists to remove and the shape the
// layers test cannot see.
import { reason } from "./core/errors.js";
import { $, status} from "./shell/dom.js";
import { t, applyTexts } from "./core/texts.js";
import { load, wireConflict } from "./core/save.js";
import { editor, haveEditor, useEditors } from "./core/editor.js";
import { wireRelease } from "./editor-diy/release.js";
import { diy, wireEditor } from "./editor-diy/editor.js";
import { wireBuildEntry } from "./editor-diy/folder_build.js";
import * as diyBoard from "./editor-diy/templates/board.js";
import { app, wireEditor as wireApp } from "./editor-app/editor.js";
import * as appBoard from "./editor-app/templates/board.js";
import { ensureCollection, nameIfUnnamed, paintCollections, wireCollections }
  from "./shell/collections.js";
import { loadSources } from "./shell/picker.js";
import { forgetAzureKey, openSettings, saveAzure, wireLanguage } from "./shell/voices.js";
import { wireSymbolFolder, wireImport, wireData, wireSources } from "./shell/settings.js";
import { wireLegal } from "./shell/legal.js";
import { subscribeMetacom } from "./data/symbols.js";
import { exportEverything } from "./data/backup.js";
import { onChanged } from "./data/changed.js";
import { onBlocked } from "./data/store.js";
import { Sicherung } from "@lautstark/sicherung";

/* The standing backup. `exportEverything` is what it is handed and the only
 * thing it is ever handed - the audited artefact, which carries the board and
 * the pictures in symbols/ and drops the Azure key and the METACOM folder
 * path on the way out. A chosen folder is very likely inside Dropbox, so what
 * goes in it leaves the machine: a credential there would be posted to
 * somebody's cloud, and a METACOM path is derived from a folder that is
 * licensed per person. tests/unit/backup_payload.test.ts holds this wiring in
 * place, and a failure there is a licence or a leak rather than a bug. */
const backup = new Sicherung({
  app: "vorlaut",
  // The notice travels inside the file, so it is written in the language the
  // page is in - and it comes from the table, because this repository keeps
  // German in boot_data.ts alone (tests/test_language.py).
  produce: () => exportEverything(t("ui.data_notice")),
});

// Every write that changes what a Sicherung would contain, through the one
// notifier in data/store.ts. Debounced inside Sicherung, so a burst of edits
// on a board is one file.
onChanged(() => backup.schedule());

/** Empties the two holes the frame leaves, so that whichever editor is coming
 *  next is the only one in the page.
 *
 *  Both, and always both: the work head's slot is as much a place a stale
 *  #releaseBtn can survive in as #editor is, and it is the one that would be
 *  missed, because it holds one button and looks like furniture. */
function clearEditor(): void {
  $("editor").replaceChildren();
  $("collectionAction").replaceChildren();
}

export function start(): void {
  // First, and before anything that could reach for one. core/texts.ts asks
  // the editor on screen for its own labels, core/save.ts asks the registry
  // what an empty Sammlung is, and both of those run inside the wiring below.
  //
  // Registering is not showing: nothing is in the page until load() has read a
  // layout and core/editor.ts's showEditorFor() has mounted the half that
  // layout needs.
  useEditors({
    diy: {
      editor: diy,
      mount: () => {
        clearEditor();
        diyBoard.render($("editor"), $("collectionAction"));
      },
      // Three, because wireRelease() binds #releaseBtn and #previewToggle is
      // wireEditor()'s - both elements the mount above has just made - and
      // wireBuildEntry() puts the build into the ⋯ beside the Sammlung's name.
      // All three belong to this editor now: the one piece of talker wiring
      // that used to sit outside it, in the settings sheet, was the Device
      // panel, and that has gone entirely.
      //
      // Two of the three answer with a teardown and this composes them: one
      // subscribes to the build mark and the other holds a menu entry, and
      // both of those are the shell's and outlive this editor's markup. A
      // tablet Sammlung must not be offered a build for hardware it is not
      // for, which is what taking the entry back is about.
      wire: () => {
        wireEditor();
        const stopRelease = wireRelease();
        const stopBuildEntry = wireBuildEntry();
        return () => { stopRelease(); stopBuildEntry(); };
      },
    },
    app: {
      editor: app,
      mount: () => {
        clearEditor();
        appBoard.render($("editor"), $("collectionAction"));
      },
      wire: wireApp,
    },
  });

  wireConflict();
  // Never prompts - there is no gesture here. A folder that needs its
  // permission re-confirmed lands in needs-permission and says so in the
  // Daten panel, which is where the click can happen.
  void backup.restore().catch(() => undefined);
  /* The board's own pictures follow the METACOM provider: a folder arriving -
   * restored on load, reconnected, or freshly picked - re-renders the board,
   * or every metacom: key keeps the placeholder it drew while there was no
   * folder, and connecting one looks like it did nothing.
   *
   * Whichever board is on screen, and guarded because there may be none: this
   * runs before the first layout has been read, and a folder restored that
   * quickly would otherwise ask an editor that does not exist yet to draw. */
  subscribeMetacom(() => { if (haveEditor()) editor().render(); });
  wireCollections();
  wireSymbolFolder();
  wireSources();
  wireImport();
  wireData(backup);
  wireLanguage();
  wireLegal();

  // One entrance, at the foot of the sidebar. There was a gear in a page-wide
  // header as well; the header has gone, and design.md §3.4 settles the
  // placement - two doors to one sheet is two things to keep in step for no
  // gain.
  $<HTMLButtonElement>("settingsLink").onclick = openSettings;
  // The cross in the corner is the only way out of either sheet, because there
  // is nothing to confirm or to abandon: everything in both is already
  // written. The Sammlung's has no entrance here - it opens from the ⋯ beside
  // the name it belongs to, which shell/collections.ts wires.
  $<HTMLButtonElement>("voiceClose").onclick = () => $<HTMLDialogElement>("voices").close();
  $<HTMLButtonElement>("collectionSheetClose").onclick =
    () => $<HTMLDialogElement>("collectionSheet").close();
  $<HTMLButtonElement>("azureSave").onclick = saveAzure;
  $<HTMLButtonElement>("azureForget").onclick = forgetAzureKey;

  /* The one failure the chain below cannot report on its own.
   *
   * Everything after this reaches the database, and .catch() covers all of it
   * - except the case where the open neither succeeds nor fails, because an
   * older connection somewhere else is holding the version back. That waits
   * without settling, so the catch never runs and the page sits there looking
   * like an empty first visit. See the blocked() callback in data/store.ts.
   *
   * Before applyTexts() rather than after, because this is the one message
   * whose language is genuinely the browser's guess: the layout that would say
   * otherwise is behind the database that will not open. */
  onBlocked(() => status(t("ui.db_blocked")));

  // Labels first: without them the page shows empty buttons for as long as
  // the first request takes.
  applyTexts();
  loadSources();
  // The sidebar, before the Sammlung it points at: the list comes out of the
  // registry and does not wait on a layout, so drawing it first means the page
  // is never briefly a Sammlung with no idea which one it is.
  void paintCollections();
  // The voices are not asked for here: nothing outside the settings shows them,
  // and the sheet fetches them itself when it opens.
  //
  // And again once the layout is in force, because on a first visit that load
  // is what *makes* the first Sammlung - and because the row's count and the
  // work head's are read off the layout, which is not there until it lands.
  // e2e/collections.spec.ts is what caught the first half; a browser that had
  // been here before never showed it.
  /* A Sammlung to load, then the load, then its name.
   *
   * The order is the point. The store seeds a blank layout for a browser that
   * has none and has no language to name it with; load() is what adopts the
   * language the layout carries, which on a first visit is the seed's. Naming
   * before that meant minting "Collection of 24.08.2026" and then switching the
   * page to German around it. nameIfUnnamed() runs after, so the name is in the
   * language the page settled on - and it catches the Sammlung carried across
   * from the single-layout database too, which never had one. */
  ensureCollection()
    .then(load)
    .then(nameIfUnnamed)
    .then(paintCollections)
    .catch((error) => status(t("ui.load_failed", { error: reason(error) })));
}
