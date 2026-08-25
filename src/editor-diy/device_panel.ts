/* Two halves of what used to be one Device panel: which talker this page may
 * speak to, and the build written where something other than this page can
 * pick it up.
 *
 * It sat in src/shell/settings.ts with the Azure key and the METACOM folder,
 * which was right while the settings sheet was one file's worth of panels and
 * stopped being right the moment the shell had to be able to stand without a
 * device behind it. A serial port, a build and a file system laid out the way
 * a talker reads it are the five-key device's business from end to end.
 *
 * They are two halves now because they are two scopes. A granted port belongs
 * to this browser and is used by whichever Sammlung is released next, so it
 * stays in Einstellungen. A build is a folder full of *this* Sammlung's files,
 * which is an act on one particular Sammlung - so it is an entry in the ⋯
 * beside that Sammlung's name, with the two exports it is a third kind of.
 * docs/sammlung-settings.md.
 *
 * The sheet's markup still holds the panel - one document, mounted once - and
 * this is the module that fills it in. paintStates() reaches it through
 * onPaintPanels() rather than by name, which is the whole of what keeps the
 * shell from importing this file.
 *
 * ## The open question about the button that is left
 *
 * Once the build moved out, the connect button's only remaining job is
 * granting a port *ahead of time*. Nothing needs that: release.ts's transfer
 * sheet offers the same connect at the step where it finds it has no port, and
 * device.ts's whole design is one explicit connect and silent reconnect for
 * ever after through getPorts(). So a panel whose one control duplicates a
 * step another flow already takes, with better words around it, is a panel
 * that has probably outlived its reason.
 *
 * Probably, and not removed: that is a decision about what Einstellungen is
 * for, and it belongs to whoever owns that question rather than to the change
 * that emptied the panel out. It is written down in docs/sammlung-settings.md
 * as a proposal, and the panel stays until it is answered. What it still buys
 * is the one case release.ts cannot cover: choosing a *different* port after a
 * change of cable, which the transfer sheet never asks about once one is
 * granted.
 */
import { $, status } from "../shell/dom.js";
import { reason, Trouble } from "../core/errors.js";
import { chooseBuildFolder, writeBuildTo, folderExportSupported }
  from "../backend/index.js";
import { t } from "../core/texts.js";
import { collectionMenuExtras } from "../shell/collections.js";
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

/** The Device panel: connecting to a talker, and nothing else any more.
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
  //
  // In the summary rather than under the button now. The panel has one thing
  // to say about itself - whether a port is granted - and §3.5 wants that in
  // the heading, where it reads without unfolding anything.
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
      // A dismissed picker says nothing at all. Somebody closed a dialog; that
      // is an answer, not a failure, and the line in the heading - which
      // onDevices() redraws either way - still says what is true.
      await connectDevice();
    } finally {
      connect.disabled = false;
    }
  };
}

/** The build, written into a folder somebody chooses.
 *
 * A third kind of export and it says so by where it is: an .obz is a board
 * other software reads, an app package is a Sammlung a tablet opens, and this
 * is the shape a talker's own file system should have. Sharing an entry with
 * either would blur all three into "export", which is the argument the panel
 * comment made when all three were panels.
 *
 * What it says while it runs goes to the page's status line rather than into a
 * panel: the menu it was pressed in has closed by then, so there is no heading
 * left to write under. That is the same place exportOne() reports from, which
 * is the entry directly above it.
 */
export async function buildToFolder(): Promise<void> {
  status("");
  try {
    // The folder first: showDirectoryPicker() needs the activation this click
    // is, and it expires in about five seconds - so a build cannot come before
    // it. A dismissed dialog ends here and says nothing.
    const folder = await chooseBuildFolder();
    if (!folder) return;

    // Then a build, if there is not a current one. The press that usually
    // builds asks for a port and does nothing without one, so on a machine
    // with no talker on it this is the only way to produce the files - and
    // it is exactly the machine that needs them.
    if (!await buildIsCurrent()) {
      status(t("ui.building"));
      await buildNow();
    }

    const done = await writeBuildTo(folder, {
      onFile: (_name, at, total) =>
        { status(t("ui.build_writing", { done: at, total })); },
    });
    status(t("ui.build_written", {
      folder: done.folder, written: done.written, removed: done.removed,
      size: Math.round(done.bytes / 1024),
    }));
  } catch (error) {
    status(error instanceof Trouble
      ? t(`err.${error.word}`)
      : t("ui.data_failed", { error: reason(error) }));
  }
}

/** Puts the build in the ⋯ beside the Sammlung's name, for as long as a talker
 *  Sammlung is the one on screen.
 *
 * Registered with the editor rather than once at start-up, and taken back by
 * the teardown, for the reason EditorHalf.wire() gives: the shell outlives
 * every editor, and a tablet Sammlung must not be offered a build for hardware
 * it is not for.
 *
 * Nothing at all where the browser has no directory picker - Safari, Firefox,
 * anything on Android. A menu entry that opens a picker that does not exist is
 * worse than an absent one, and it is the same answer wireDevice() gives one
 * floor up.
 */
export function wireBuildEntry(): () => void {
  if (!folderExportSupported()) return () => {};
  collectionMenuExtras((add) => add(t("ui.build_export"), () => { void buildToFolder(); }));
  return () => collectionMenuExtras(null);
}
