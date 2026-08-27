/* The two exports that have to speak before they can be written, and the wait
 * in front of each.
 *
 * Each export is one call into backend/. What is here is the sheet around it,
 * and it exists because of a number: every distinct sentence in a Sammlung is
 * synthesised before it can be packaged, and each is a piper inference or a
 * round trip to Azure. A full tablet Sammlung - six pages of a 6x11 grid - is
 * on the order of four hundred of them, which is minutes, and a page that says
 * one thing at the start and nothing after is indistinguishable from a page
 * that has died. A talker Sammlung is at most twenty, which a status line once
 * covered; it does not any more, and that is adr/0011's doing. The device
 * export used to be instant because it copied a build that had already been
 * paid for, and there is no build here now - it speaks for itself, like the
 * other one.
 *
 * So: what is about to happen, then a count while it happens, then a way to
 * stop.
 *
 * **One sheet, two doors, and the difference matters.** exchange/SPEC.md §5.2
 * requires the *exports* to be separate entry points - "a different function,
 * not the same one behind a flag" - and adr/0010 is emphatic that no helper
 * may cross that line, because a shared helper is where a flag grows. A
 * progress dialog is not one of those helpers: it knows a count and a word,
 * never a picture or a licence, and each caller below names its own door. What
 * would be forbidden is a `run` that decided between the two.
 *
 * In the shell rather than in either editor, because both targets export a
 * package. A talker Sammlung goes to a tablet through exactly this path - that
 * is what vorlaut-app's BuilderPackageTest opens - so the sheet cannot belong
 * to the editor that happens to be on screen.
 */
import { openDialog } from "@lautstark/design/dialog";
import { status } from "./dom.js";
import { reason } from "../core/errors.js";
import { t } from "../core/texts.js";
import { exportAppPackage, exportDevicePackage } from "../backend/index.js";
import type { PackageProgress } from "../backend/local.js";

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

/** One export, as the sheet needs to know it.
 *
 * `write` is the door, handed in rather than chosen here: that is the whole of
 * what keeps this file on the right side of §5.2. It answers null for
 * "somebody stopped it", which is a decision rather than a failure.
 */
interface Offered {
  title: string;
  /** What is about to happen, before the press. */
  lead: string;
  go: string;
  filename: string;
  write(
    onProgress: (at: PackageProgress) => boolean | void,
  ): Promise<{ blob: Blob; missing: number } | null>;
  /** The status line afterwards, given how many pictures resolved to nothing. */
  told(missing: number): string;
  /** What the sheet keeps saying after the file has been handed over, or
   *  nothing. The device export uses it to say where the file goes next; the
   *  app package has nowhere to point, because the file goes to a tablet. */
  next?: () => HTMLElement;
}

/**
 * Opens the sheet, and writes the package if somebody presses the button.
 *
 * Two steps in one dialog, which does not close between them: what is about to
 * be written, then the writing. What happens at the end depends on whether
 * there is anything left to read - an export with a `next` keeps the sheet up,
 * because the sentence it adds is the point of having pressed the button at
 * all, and one without closes itself, since a sheet that has to be dismissed
 * after a download is a click that says nothing.
 */
function openExport(what: Offered): void {
  // Set by the confirming press and read by the progress callback, which is
  // called from inside the export loop. A module-level flag would leak between
  // two sheets; this one dies with the closure.
  let stopped = false;
  let running = false;

  const line = document.createElement("p");
  line.textContent = what.lead;

  const go = document.createElement("button");
  go.className = "btn primary";
  go.type = "button";
  go.textContent = what.go;

  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.type = "button";
  cancel.textContent = t("ui.stop");

  const close = document.createElement("button");
  close.className = "btn primary";
  close.type = "button";
  close.textContent = t("ui.close");
  close.hidden = true;

  const sheet = openDialog({
    title: what.title,
    closeLabel: t("ui.close"),
    body: [line],
    footer: [go, cancel, close],
    // Closing the sheet mid-run is the same act as pressing Abbrechen, and it
    // has to be, or the corner ✕ would leave a loop running against a dialog
    // nobody can see - which is the shape of the hang design.md §3.4 warns
    // about, arrived at from the other end.
    onClose: () => { stopped = true; },
  });

  cancel.onclick = () => { stopped = true; sheet.close(); };
  close.onclick = () => sheet.close();

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
      const made = await what.write((at) => {
        if (stopped) return false;
        line.textContent = at.total === 0 || at.done === at.total
          ? t("ui.package_packing")
          : t("ui.package_speaking", { done: at.done + 1, total: at.total });
        return true;
      });
      // null is somebody having stopped it, which is a decision rather than a
      // failure. Nothing was written and nothing is said beyond saying so.
      if (!made) {
        sheet.close();
        status(t("ui.package_stopped"));
        return;
      }
      offer(made.blob, what.filename);
      // Missing pictures are worth a sentence rather than a refusal: the
      // package works, and the usual cause is a METACOM folder this browser
      // has not been given back yet.
      status(what.told(made.missing));
      if (!what.next) { sheet.close(); return; }
      sheet.body.replaceChildren(what.next());
      cancel.hidden = true;
      go.hidden = true;
      close.hidden = false;
      close.focus();
    } catch (error) {
      sheet.close();
      status(t("ui.collection_export_failed", { error: reason(error) }));
    }
  }
}

/** The Sammlung as the package the Android viewer opens. */
export function openPackageExport(name: string, stem: string): void {
  openExport({
    title: t("ui.package_title"),
    lead: t("ui.package_lead", { name }),
    go: t("ui.package_go"),
    // .zip rather than .obz, and only on this export. Chrome on Android goes
    // by the blob's media type for an unregistered extension, so a file
    // declared application/zip and named .obz is one the download manager will
    // not take — the package never reaches the tablet it was made for. The
    // bytes are unchanged and the viewer never looks at a filename, so the
    // rename costs nothing it can see. exchange/SPEC.md §2 says which of the
    // two an importer goes by. The two exports beside this one keep .obz:
    // other AAC software looks for that extension, and the talker's is read by
    // a page that takes whatever it is given.
    filename: `${stem}-app.zip`,
    write: (onProgress) => exportAppPackage(onProgress),
    told: (missing) => missing
      ? t("ui.collection_exported_app_gaps", { n: missing })
      : t("ui.collection_exported_app"),
  });
}

/** The Sammlung as the talker's own package, and where to take it.
 *
 * The hand-off is the reason this one keeps its sheet open. Everything before
 * it happens on this page and the last step does not: the file is on somebody's
 * disk and the talker is on the table, and the page that joins the two is a
 * second address they have no reason to know. A link, at the moment the file
 * exists, is the whole of what stands between "exported" and a device.
 *
 * Built from import.meta.env.BASE_URL rather than written out, for the reason
 * docs/repository-map.md gives about the three places the base already is
 * written out literally: each of them is a place a rename breaks in silence,
 * and this would have been a fourth.
 */
export function openDeviceExport(name: string, stem: string): void {
  openExport({
    title: t("ui.device_export_title"),
    lead: t("ui.device_export_lead", { name }),
    go: t("ui.device_export_go"),
    filename: `${stem}-device.obz`,
    write: (onProgress) => exportDevicePackage(onProgress),
    told: (missing) => missing
      ? t("ui.collection_exported_device_gaps", { n: missing })
      : t("ui.collection_exported_device"),
    next: () => {
      const said = document.createElement("p");
      said.textContent = t("ui.device_export_next");
      const link = document.createElement("a");
      link.href = new URL("loader/", new URL(import.meta.env.BASE_URL,
                                             location.href)).href;
      link.textContent = t("ui.device_export_open");
      // A new tab, because the Sammlung on this one is still open and going
      // back to it should not be a reload of everything.
      link.target = "_blank";
      link.rel = "noopener";
      said.append(" ", link);
      return said;
    },
  });
}
