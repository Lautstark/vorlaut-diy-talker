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
import { reason } from "./core/errors.js";
import { $, status} from "./ui/dom.js";
import { runBuild } from "./backend/index.js";
import { t, applyTexts } from "./core/texts.js";
import { load, saveNow, markReleaseState, wireConflict } from "./core/save.js";
import { render, wireEditor } from "./ui/editor.js";
import { loadSources, wirePicker } from "./ui/picker.js";
import { confirmPair, watchPair } from "./ui/pairing.js";
import { forgetAzureKey, openVoices, saveAzure, wireLanguage } from "./ui/voices.js";
import { wireSymbolFolder, wireBoard, wireSources } from "./ui/settings.js";
import { subscribeMetacom } from "./data/symbols.js";

export function start(): void {
  wireConflict();
// The board's own pictures follow the METACOM provider: a folder arriving -
// restored on load, reconnected, or freshly picked - re-renders the board, or
// every metacom: key keeps the placeholder it drew while there was no folder,
// and connecting one looks like it did nothing.
subscribeMetacom(render);
  wireEditor();
  wirePicker();
  wireSymbolFolder();
  wireSources();
  wireBoard();
  wireLanguage();

  $<HTMLButtonElement>("releaseBtn").onclick = async () => {
    // Releasing what is on screen, not what the last debounce happened to
    // catch: saveNow() writes and cancels the pending one, otherwise it fires
    // afterwards and writes the same thing a second time.
    await saveNow();
    $<HTMLButtonElement>("releaseBtn").disabled = true;
    status(t("ui.releasing"));
    $("log").style.display = "block";
    $("log").textContent = t("ui.running");
    try {
      const result = await runBuild();
      $("log").textContent = result.log.join("\n");
      markReleaseState("1");
      status(t("ui.released"));
    } catch (error) {
      $("log").textContent = t("ui.log_error", { error: reason(error) });
      status(t("ui.release_failed"));
    } finally {
      $<HTMLButtonElement>("releaseBtn").disabled = false;
    }
  };

  $<HTMLButtonElement>("pairConfirm").onclick = confirmPair;
  $<HTMLButtonElement>("gear").onclick = openVoices;
  // The cross in the corner is the only way out now, because there is nothing
  // to confirm or to abandon: everything in the sheet is already written.
  $<HTMLButtonElement>("voiceClose").onclick = () => $<HTMLDialogElement>("voices").close();
  $<HTMLButtonElement>("azureSave").onclick = saveAzure;
  $<HTMLButtonElement>("azureForget").onclick = forgetAzureKey;

  // Labels first: without them the page shows empty buttons for as long as
  // the first request takes.
  applyTexts();
  loadSources();
  // The voices are not asked for here: nothing outside the settings shows them,
  // and the sheet fetches them itself when it opens.
  watchPair();
  load().catch((error) => status(t("ui.load_failed", { error: reason(error) })));
}
