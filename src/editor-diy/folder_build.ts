/* The build written into a folder something other than this page can pick up.
 *
 * This file was the Device panel in the settings sheet, and it held two things
 * that turned out not to belong together. Both have left, in opposite
 * directions, and the split is worth keeping written down because each move
 * had its own reason:
 *
 *   the build      to the ⋯ beside the Sammlung's name, next to the two
 *                  exports. It writes *this* Sammlung's files, so it is an act
 *                  on one particular Sammlung rather than anything this
 *                  installation is set to.
 *   the connect    nowhere. It granted a serial port ahead of time, for a flow
 *                  that grants on demand: release.ts's transfer sheet offers
 *                  the chooser at the step where it finds it has no port, with
 *                  the words about what is about to be written already read,
 *                  and device.ts is built on one explicit connect and silent
 *                  reconnect for ever after through getPorts(). A panel
 *                  somebody has to know to visit first, duplicating a step
 *                  that explains itself better where it stands, is furniture.
 *
 * What went with it, named rather than pretended away: choosing a *different*
 * port while a granted one still enumerates. The recovery is one press - a
 * transfer against a stale port fails with cable_no_device, which sets
 * release.ts's askAgain, and the next press offers the chooser again. So it
 * costs an attempt rather than a reload, and the sheet says why.
 *
 * docs/sammlung-settings.md is the argument in full.
 */
import { status } from "../shell/dom.js";
import { reason, Trouble } from "../core/errors.js";
import { chooseBuildFolder, writeBuildTo, folderExportSupported }
  from "../backend/index.js";
import { t } from "../core/texts.js";
import { collectionMenuExtras } from "../shell/collections.js";
import { buildNow } from "./release.js";
import { buildIsCurrent } from "../data/built.js";

/** The build, written into a folder somebody chooses.
 *
 * A third kind of export and it says so by where it is: an .obz is a board
 * other software reads, an app package is a Sammlung a tablet opens, and this
 * is the shape a talker's own file system should have. Sharing an entry with
 * either would blur all three into "export", which is the argument this file
 * made when all three were panels.
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
 * worse than an absent one, and hiding a control that cannot work beats
 * handing somebody a paragraph about their browser.
 */
export function wireBuildEntry(): () => void {
  if (!folderExportSupported()) return () => {};
  collectionMenuExtras((add) => add(t("ui.build_export"), () => { void buildToFolder(); }));
  return () => collectionMenuExtras(null);
}
