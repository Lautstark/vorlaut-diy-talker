/** The Sicherung that keeps itself: a folder chosen once, written to from then
 * on without anybody remembering to.
 *
 * An addition to the two buttons beside it and never a replacement. The picker
 * exists only on Chromium on the desktop - not Safari, not Firefox, and on no
 * browser on Android - so this hides itself entirely elsewhere and the
 * download stays the whole offer. A talker's content must not be shown a
 * backup story the tablet it runs on cannot have. @lautstark/design design.md
 * 3.3 settles the wording, which is why the German here reads the same as
 * bildhaft's and mitreden's.
 *
 * What goes into the folder is exportEverything() from data/backup.ts, and
 * that function drops the Azure key and the METACOM folder path on the way
 * out. It matters more here than anywhere: choosing a folder is choosing to
 * have a sync client carry the file off the machine. */

import { Sicherung, type Status } from "@lautstark/sicherung";
import { LANG } from "../core/boot.js";
import { t } from "../core/texts.js";
import { actionsFor, ago as relative, needsAttention } from "@lautstark/sicherung/ui";
import { $ } from "./dom.js";

/* "vor 3 Minuten" / "3 minutes ago", against the language in force.
 *
 * The arithmetic and the unit boundaries are @lautstark/sicherung/ui's as of
 * v1.1.0; what stays here is where the locale comes from. LANG is a live
 * binding that moves under a language switch, and nothing may capture it into
 * a local - this file once did, back when the switch was still a reload, and
 * the Daten panel went on being English under a page that had gone German.
 *
 * The cache that used to sit here is gone with the arithmetic. It kept one
 * formatter and rebuilt it when LANG moved, defended in the margin as avoiding
 * "several per repaint" - but sentence() calls this exactly once per repaint,
 * on every branch, and a repaint happens when a backup is written rather than
 * per frame. That was one Intl construction saved on a rare event, in exchange
 * for a piece of invalidation logic that had already been wrong once. The
 * package builds its formatter per call and says why; this is the cheaper
 * arrangement in the only currency that turned out to matter. */
export const ago = (at: number, now = Date.now()): string => relative(at, LANG, now);

/** The age of the last real copy, or the admission that there has never been one. */
const lastCopy = (at: number | null): string =>
  at === null ? t("ui.folder_never") : t("ui.folder_last", { age: ago(at) });

/** The sentence for each state. The two that mean nothing is being written
 *  both carry the age: "es funktioniert nicht" is a sentence somebody can put
 *  off, "seit elf Tagen nichts gesichert" is not.
 *
 *  Exported for the test that holds that rule, which is the one thing about
 *  this panel still written out in three products with nothing checking they
 *  agree - @lautstark/sicherung/ui owns the rest, and deliberately not the
 *  words. Nothing outside this file calls it. */
export function sentence(status: Status): string {
  switch (status.kind) {
    case "unsupported": return "";
    case "off": return t("ui.folder_off");
    case "saving": return t("ui.folder_saving");
    case "idle": return status.lastWrite === null
      ? t("ui.folder_idle_never", { folder: status.folder })
      : t("ui.folder_idle", { folder: status.folder, age: ago(status.lastWrite) });
    case "needs-permission":
      return t("ui.folder_permission", { folder: status.folder, age: lastCopy(status.lastWrite) });
    case "failed":
      return t("ui.folder_failed", { reason: status.reason, age: lastCopy(status.lastWrite) });
  }
}

/* Redrawing the panel with nothing having happened to it.
 *
 * Every sentence and every button in here is written through t(), and the
 * panel is otherwise redrawn only when the Sicherung's status moves - so after
 * a language switch it sat in the old language until some save happened to
 * change something, which on a quiet page is never. paintStates() calls this
 * alongside the panels above it, for the reason it gives there: a heading that
 * keeps its old language while the body changes is worse than one that never
 * changed at all.
 *
 * Null where the browser has no folder to offer. wireBackupFolder() leaves
 * before there is anything drawn, and a panel that is hidden has no stale
 * language to fix. */
let repaint: (() => void) | null = null;

export function paintBackupFolder(): void {
  repaint?.();
}

export function wireBackupFolder(backup: Sicherung, say: (message: string) => void): void {
  const box = $("folderBox");
  if (!Sicherung.supported) {
    // Not disabled, not explained: a control that cannot exist here should not
    // spend a paragraph telling somebody their browser is wrong.
    box.hidden = true;
    return;
  }

  const line = $("folderState");
  const actions = $("folderActions");

  const button = (key: string, kind: string, run: () => Promise<unknown>) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = `btn ${kind}`;
    node.textContent = t(key);
    node.onclick = () => {
      // The gesture is why these are buttons: choose() and confirm() open a
      // browser prompt and are refused without one.
      node.disabled = true;
      void run().finally(() => { node.disabled = false; });
    };
    return node;
  };

  function paint(status: Status): void {
    // data-state takes the kind verbatim - components.css keys off exactly
    // these names, so there is no mapping here to disagree with it.
    line.setAttribute("data-state", status.kind);
    /* Whether this state is somebody's to act on is the package's answer, not
     * a judgement made here - the same arrangement as the buttons below. All
     * three products drew `needs-permission` as one more grey line beside
     * "gesichert vor 3 Minuten", which is what it looks like when each of them
     * decides for itself. conventions.md §3.7. */
    line.classList.toggle("notice", needsAttention(status));
    line.classList.toggle("bad", needsAttention(status));
    line.textContent = "";
    const dot = document.createElement("span");
    dot.className = "dot";
    const words = document.createElement("span");
    words.textContent = sentence(status);
    line.append(dot, words);

    /* Which buttons belong to this state is the package's answer now. It was
     * the same six-branch switch in all three products - one contract with
     * three copies and nothing checking they agreed, which is the arrangement
     * where one of them quietly stops offering a way out of `failed`. What
     * stays here is the drawing and the words: the ids the table returns are
     * the i18n keys after "ui.folder_", so this is a lookup rather than a
     * mapping table that could disagree with it.
     *
     * Two of that table's decisions were argued in this margin and are worth
     * keeping findable. `idle` offers no "save now": the folder is written on
     * every change already, so the button sat directly above the one that
     * writes a file and differed from it by a word naming the wrong axis -
     * timing rather than destination. `saving` offers nothing rather than
     * disabled buttons, which would flicker greyed on every debounce. */
    actions.textContent = "";
    for (const action of actionsFor(backup, status))
      actions.append(button(`ui.folder_${action.id}`, action.primary ? "primary" : "quiet",
        async () => {
          await action.run();
          // The only one that says anything out loud: the rest are reported by
          // the status line repainting underneath.
          if (action.id === "forget") say(t("ui.folder_forgotten"));
        }));
  }

  paint(backup.status);
  backup.subscribe(paint);
  repaint = () => paint(backup.status);
}
