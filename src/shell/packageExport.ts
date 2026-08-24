/* The Sammlung as the package the Android viewer opens, and the wait in front
 * of it.
 *
 * The export itself is one call into backend/. What is here is the sheet
 * around it, and it exists because of a number: every distinct sentence in a
 * Sammlung is synthesised before it can be encoded, and a full tablet
 * Sammlung - six pages of a 6x11 grid - is on the order of four hundred of
 * them. Each is a piper inference or a round trip to Azure. On the five-key
 * device the same loop was at most twenty sentences and a status line reading
 * "exportiert ..." covered it; four hundred is minutes, and a page that says
 * one thing at the start and nothing after is indistinguishable from a page
 * that has died.
 *
 * So: what is about to happen, then a count while it happens, then a way to
 * stop. The same three the transfer sheet in editor-diy/release.ts settles on
 * for the same reason, and this is deliberately the smaller version of it -
 * there is no port to choose and no log worth keeping, so there is one line
 * and one button.
 *
 * In the shell rather than in either editor, because both targets export one.
 * A talker Sammlung goes to a tablet through exactly this path - that is what
 * vorlaut-app's BuilderPackageTest opens - so the sheet cannot belong to the
 * editor that happens to be on screen.
 */
import { openDialog } from "@lautstark/design/dialog";
import { status } from "./dom.js";
import { reason } from "../core/errors.js";
import { t } from "../core/texts.js";
import { exportAppPackage } from "../backend/index.js";

/** Hands a finished file to the browser as a download.
 *
 * The revoke is late rather than immediate: the click returns before the
 * browser has opened the URL, and a blob revoked in that gap is a download
 * that silently never begins.
 */
export function offer(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Opens the sheet, and writes the package if somebody presses the button.
 *
 * Two steps in one dialog, which does not close between them: what is about to
 * be written, then the writing. It stays open at the end for long enough to
 * hand over the file and then closes itself - there is nothing to read
 * afterwards, unlike the transfer log, and a sheet that has to be dismissed
 * after a download is a click that says nothing.
 */
export function openPackageExport(name: string, stem: string): void {
  // Set by the confirming press and read by the progress callback, which is
  // called from inside the export loop. A module-level flag would leak between
  // two sheets; this one dies with the closure.
  let stopped = false;
  let running = false;

  const line = document.createElement("p");
  line.textContent = t("ui.package_lead", { name });

  const go = document.createElement("button");
  go.className = "btn primary";
  go.type = "button";
  go.textContent = t("ui.package_go");

  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.type = "button";
  cancel.textContent = t("ui.stop");

  const sheet = openDialog({
    title: t("ui.package_title"),
    closeLabel: t("ui.close"),
    body: [line],
    footer: [go, cancel],
    // Closing the sheet mid-run is the same act as pressing Abbrechen, and it
    // has to be, or the corner ✕ would leave a loop running against a dialog
    // nobody can see - which is the shape of the hang design.md §3.4 warns
    // about, arrived at from the other end.
    onClose: () => { stopped = true; },
  });

  cancel.onclick = () => { stopped = true; sheet.close(); };

  go.onclick = () => {
    if (running) return;
    running = true;
    go.disabled = true;
    // Abbrechen keeps its label and its job: before the press it declines,
    // after it it stops. One button, because they are the same sentence.
    void write();
  };

  async function write(): Promise<void> {
    try {
      const made = await exportAppPackage((at) => {
        if (stopped) return false;
        line.textContent = at.total === 0 || at.done === at.total
          ? t("ui.package_packing")
          : t("ui.package_speaking", { done: at.done + 1, total: at.total });
        return true;
      });
      // null is somebody having stopped it, which is a decision rather than a
      // failure - see exportAppPackage(). Nothing was written and nothing is
      // said beyond saying so.
      if (!made) {
        sheet.close();
        status(t("ui.package_stopped"));
        return;
      }
      offer(made.blob, `${stem}-app.obz`);
      sheet.close();
      // Missing pictures are worth a sentence rather than a refusal: the
      // package works, the viewer marks those buttons, and the usual cause is
      // a METACOM folder this browser has not been given back yet.
      status(made.missing
        ? t("ui.collection_exported_app_gaps", { n: made.missing })
        : t("ui.collection_exported_app"));
    } catch (error) {
      sheet.close();
      status(t("ui.collection_export_failed", { error: reason(error) }));
    }
  }
}
