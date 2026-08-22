// What the page does when it opens, and the buttons that belong to no one
// section. Every other module is imported from here, so this is the file to
// read first and the only one ui.html names.
import { $, status } from "./dom.js";
import { runBuild } from "./backend.js";
import { t, applyTexts } from "./texts.js";
import { load, saveNow, markReleaseState, wireConflict } from "./save.js";
import { wireEditor } from "./editor.js";
import { loadSources, wirePicker } from "./picker.js";
import { confirmPair, watchPair } from "./pairing.js";
import { openVoices, saveVoice, wireLanguage } from "./voices.js";
import { wireSymbolFolder, wireBoard } from "./settings.js";

wireConflict();
wireEditor();
wirePicker();
wireSymbolFolder();
wireBoard();
wireLanguage();

$("releaseBtn").onclick = async () => {
  // Releasing what is on screen, not what the last debounce happened to
  // catch: saveNow() writes and cancels the pending one, otherwise it fires
  // afterwards and writes the same thing a second time.
  await saveNow();
  $("releaseBtn").disabled = true;
  status(t("ui.releasing"));
  $("log").style.display = "block";
  $("log").textContent = t("ui.running");
  try {
    const result = await runBuild();
    $("log").textContent = result.log.join("\n");
    markReleaseState("1");
    status(t("ui.released"));
  } catch (error) {
    $("log").textContent = t("ui.log_error", { error: error.message });
    status(t("ui.release_failed"));
  } finally {
    $("releaseBtn").disabled = false;
  }
};

$("pairConfirm").onclick = confirmPair;
$("gear").onclick = openVoices;
$("voiceClose").onclick = () => $("voices").close();
$("voiceSave").onclick = saveVoice;
$("voiceCancel").onclick = () => $("voices").close();

// Labels first: without them the page shows empty buttons for as long as
// the first request takes.
applyTexts();
loadSources();
// The voices are not asked for here: nothing outside the settings shows them,
// and the sheet fetches them itself when it opens.
watchPair();
load().catch((error) => status(t("ui.load_failed", { error: error.message })));
