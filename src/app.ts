// Wiring the page up, once its structure is in the document.
//
// This is the whole of what main.ts used to do below its imports. It is a
// separate module for one reason, and it is a real one: an ES import runs
// before any statement in the file that imports it, so nothing here could be
// guaranteed to happen after the templates had mounted while it lived beside
// them. editor.ts looks #removeSet up at module level, and under the old
// single-file page that element was already in the document when the first
// module loaded. It is not any more, and the failure was the page throwing
// before it drew anything - which is exactly the shape of breakage this
// repository shipped once already.
//
// main.ts mounts, then imports this. The ordering is then a fact about the
// module graph rather than a convention somebody has to keep.
//
// This is also the composition root: the one module that names both halves of
// the page. The shell owns the boards, the storage, the symbols, the voices
// and the settings; editor-diy owns the five-key device. useEditor() below is
// where the second is handed to the first, and it is the only place either
// direction of that arrow exists - tests/unit/layers.test.ts holds the rest of
// src/shell/ to importing nothing out of src/editor-diy/.
import { reason } from "./core/errors.js";
import { $, status} from "./shell/dom.js";
import { t, applyTexts } from "./core/texts.js";
import { load, wireConflict } from "./core/save.js";
import { useEditor } from "./core/editor.js";
import { wireRelease } from "./editor-diy/release.js";
import { diy, render, wireEditor } from "./editor-diy/editor.js";
import { wireDevice } from "./editor-diy/device_panel.js";
import { ensureCollection, nameIfUnnamed, paintCollections, wireCollections }
  from "./shell/collections.js";
import { loadSources, wirePicker } from "./shell/picker.js";
import { forgetAzureKey, openVoices, saveAzure, wireLanguage } from "./shell/voices.js";
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

export function start(): void {
  // First, and before anything that could reach for it. core/texts.ts asks the
  // editor for its own labels, core/save.ts asks it what an empty board is,
  // and both of those run inside the wiring below.
  useEditor(diy);

  wireConflict();
  // Never prompts - there is no gesture here. A folder that needs its
  // permission re-confirmed lands in needs-permission and says so in the
  // Daten panel, which is where the click can happen.
  void backup.restore().catch(() => undefined);
// The board's own pictures follow the METACOM provider: a folder arriving -
// restored on load, reconnected, or freshly picked - re-renders the board, or
// every metacom: key keeps the placeholder it drew while there was no folder,
// and connecting one looks like it did nothing.
subscribeMetacom(render);
  wireEditor();
  wireCollections();
  wirePicker();
  wireSymbolFolder();
  wireSources();
  wireImport();
  wireData(backup);
  wireDevice();
  wireLanguage();
  wireLegal();

  // Build, and then put it on the talker. It was four lines here while it was
  // only the build; the cable brought a port, a progress line and a way to
  // stop with it, and all three live in ui/release.ts.
  wireRelease();

  // One entrance, at the foot of the sidebar. There was a gear in a page-wide
  // header as well; the header has gone, and design.md §3.4 settles the
  // placement - two doors to one sheet is two things to keep in step for no
  // gain.
  $<HTMLButtonElement>("settingsLink").onclick = openVoices;
  // The cross in the corner is the only way out now, because there is nothing
  // to confirm or to abandon: everything in the sheet is already written.
  $<HTMLButtonElement>("voiceClose").onclick = () => $<HTMLDialogElement>("voices").close();
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
