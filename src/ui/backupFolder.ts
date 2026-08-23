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
import { $ } from "./dom.js";

const STEPS: [limit: number, unit: Intl.RelativeTimeFormatUnit, per: number][] = [
  [60_000, "second", 1000],
  [3_600_000, "minute", 60_000],
  [86_400_000, "hour", 3_600_000],
  [Infinity, "day", 86_400_000],
];

/* The formatter behind "vor 3 Minuten" / "3 minutes ago".
 *
 * Built for the language in force rather than once at import, and that is the
 * rule boot.ts asks for rather than a preference: LANG is a live binding that
 * moves under a language switch, and nothing may capture it into a local. This
 * did - it was written when the switch was still a reload, so a formatter made
 * once was a formatter made once per language - and the sentence in the Daten
 * panel went on being English under a page that had gone German.
 *
 * Kept between calls all the same. Every state line here is built through
 * ago(), several of them per repaint, and building a formatter per sentence to
 * answer a question whose answer changes twice a year is waste. */
let relative: Intl.RelativeTimeFormat | null = null;
let relativeLang = "";

export function ago(at: number, now = Date.now()): string {
  if (!relative || relativeLang !== LANG) {
    relative = new Intl.RelativeTimeFormat(LANG, { numeric: "auto" });
    relativeLang = LANG;
  }
  const gap = Math.max(0, now - at);
  const [, unit, per] = STEPS.find(([limit]) => gap < limit)!;
  return relative.format(-Math.round(gap / per), unit);
}

/** The age of the last real copy, or the admission that there has never been one. */
const lastCopy = (at: number | null): string =>
  at === null ? t("ui.folder_never") : t("ui.folder_last", { age: ago(at) });

/** The sentence for each state. The two that mean nothing is being written
 *  both carry the age: "es funktioniert nicht" is a sentence somebody can put
 *  off, "seit elf Tagen nichts gesichert" is not. */
function sentence(status: Status): string {
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
    line.textContent = "";
    const dot = document.createElement("span");
    dot.className = "dot";
    const words = document.createElement("span");
    words.textContent = sentence(status);
    line.append(dot, words);

    const forget = button("ui.folder_forget", "quiet", async () => {
      await backup.forget();
      say(t("ui.folder_forgotten"));
    });

    actions.textContent = "";
    switch (status.kind) {
      case "off":
        actions.append(button("ui.folder_choose", "primary", () => backup.choose()));
        break;
      case "needs-permission":
        actions.append(button("ui.folder_confirm", "primary", () => backup.confirm()), forget);
        break;
      case "failed":
        actions.append(button("ui.folder_retry", "primary", () => backup.save()), forget);
        break;
      case "idle":
        // No "save now". The folder is written on every change already, so a
        // button offering to do it again sat directly above the one that
        // writes a file, and differed from it by a word naming the wrong axis
        // - timing rather than destination. "Erneut versuchen" below is not
        // the same button: after a failure there is nothing happening to be
        // redundant with.
        actions.append(forget);
        break;
      case "saving":
        // Nothing while it writes. Two greyed buttons flickering on every
        // debounce is worse than a moment with none.
        break;
      case "unsupported":
        break;
    }
  }

  paint(backup.status);
  backup.subscribe(paint);
  repaint = () => paint(backup.status);
}
