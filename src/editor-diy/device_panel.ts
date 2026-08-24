/* The Device panel in the settings sheet: which talker this page may speak to,
 * and the build written where something other than this page can pick it up.
 *
 * It sat in src/shell/settings.ts with the Azure key and the METACOM folder,
 * which was right while the settings sheet was one file's worth of panels and
 * stopped being right the moment the shell had to be able to stand without a
 * device behind it. A serial port, a build and a file system laid out the way
 * a talker reads it are the five-key device's business from end to end.
 *
 * The sheet's markup still holds the panel - one document, mounted once - and
 * this is the module that fills it in. paintStates() reaches it through
 * onPaintPanels() rather than by name, which is the whole of what keeps the
 * shell from importing this file.
 */
import { $ } from "../shell/dom.js";
import { reason, Trouble } from "../core/errors.js";
import { chooseBuildFolder, writeBuildTo, folderExportSupported }
  from "../backend/index.js";
import { t } from "../core/texts.js";
import { onPaintPanels } from "../shell/settings.js";
import { connectDevice, haveDevice, onDevices } from "./device.js";
import { buildNow } from "./release.js";
import { buildIsCurrent } from "../data/built.js";

/* Whether a port has been granted, in words.
 *
 * Null until the panel is wired, and hidden panels have no stale sentence to
 * fix - the same shape paintBackupFolder() uses, and for the same reason: this
 * runs from paintStates() after a language switch, which can happen before
 * anybody has opened the sheet. */
let sayLink: () => void = () => {};

function paintDevice(): void {
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
  // Only once there is a panel to paint. A browser with no directory picker
  // hides the whole section above and never registers, so a language switch
  // has nothing here to redraw and does not go looking.
  onPaintPanels(paintDevice);

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
      // The folder first: showDirectoryPicker() needs the activation this
      // click is, and it expires in about five seconds - so a build cannot
      // come before it. A dismissed dialog ends here and says nothing.
      const folder = await chooseBuildFolder();
      if (!folder) { $("deviceState").textContent = ""; return; }

      // Then a build, if there is not a current one. The press that usually
      // builds asks for a port and does nothing without one, so on a machine
      // with no talker on it this is the only way to produce the files - and
      // it is exactly the machine that needs them.
      if (!await buildIsCurrent()) {
        $("deviceState").textContent = t("ui.building");
        await buildNow();
      }

      const done = await writeBuildTo(folder, {
        onFile: (_name, at, total) =>
          { $("deviceState").textContent = t("ui.build_writing", { done: at, total }); },
      });
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
