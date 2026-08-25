// Picking a symbol: searching the active source, resolving a hit to what a
// layout stores, uploading an image of your own, and saying which collection
// that was and what is owed for it.
//
// Which sources are available is bildquelle's answer, not a variable of ours.
//
// ## There is no dialog here any more
//
// This module was a modal - a search field, a grid of results, a credit line -
// and every caller opened it on top of whatever they were doing. Both editors
// now carry the picture, its search and the upload in the left column of the
// sheet a press opens, so the modal had no way in and nothing to do. What is
// left is what the callers could not have written for themselves and must not
// each own a copy of: which source is active, what an empty answer means, the
// fact that an ARASAAC pick is a download while a METACOM one is a reference,
// and the sentence the licence requires. See shell/sheet.ts's drawPick(),
// which is the only thing that draws any of it now.
//
// The name survives the dialog because the job did: this is still where a
// symbol is picked. What went is one way of asking.
import { readSettings, pickSymbol, uploadSymbol } from "../backend/index.js";
import { reason } from "../core/errors.js";
import * as symbols from "../data/symbols.js";
import { t } from "../core/texts.js";

/* --- The seam ------------------------------------------------------------
 *
 * Three operations, so that a caller can put the search where it is standing.
 * Both editors do: a second modal over a modal to choose a symbol is the
 * dialog this design set out to remove, and removing it is what left this file
 * as the seam alone. What a caller must not do is carry a second copy of the
 * reasoning below; only the markup is the caller's. */

/** One hit, as the two sources between them describe it. */
export type SymbolHit = Awaited<ReturnType<typeof symbols.searchActive>>[number];

/** A finished search: the hits, and - when there are none - the sentence that
 *  says which of the two silences this was.
 *
 *  Packaged together rather than left to the caller, because the difference is
 *  the part that is easy to get wrong: a provider's search() must not throw,
 *  so ARASAAC answers [] for a failed fetch as well as for a word it does not
 *  have, and "nothing found" is the wrong sentence for a browser with no
 *  network. */
export interface SymbolAnswer {
  hits: SymbolHit[];
  /** "" when there are hits. */
  empty: string;
}

/** Searches the active source. Never throws: a failure is a sentence in
 *  `empty`, because every caller has a place to put one and none of them has
 *  anything else to do about it. */
export async function findSymbols(word: string): Promise<SymbolAnswer> {
  const term = word.trim();
  if (!term) return { hits: [], empty: "" };
  try {
    const hits = await symbols.searchActive(term);
    if (hits.length) return { hits, empty: "" };
    const state = symbols.activeStatus();
    return { hits, empty: state.kind === "ready"
      ? t("ui.nothing_found", { word: term })
      : t("ui.search_no_answer", { word: term }) };
  } catch (error) {
    return { hits: [], empty: t("ui.search_failed", { error: reason(error) }) };
  }
}

/** A hit, resolved to what a layout stores: a reference and the collection's
 *  own word for it. Throws, because a caller that asked for this one symbol
 *  has somewhere to say so. */
export async function takeSymbol(item: SymbolHit): Promise<{ symbol: string; label: string }> {
  if (item.source === "metacom") {
    // Nothing to fetch and nothing to copy: the layout holds the reference
    // and the picture stays in the licensed folder, which is the whole of
    // the METACOM rule. The browser resolved it, so the server is not asked.
    return { symbol: item.ref, label: (item.label || "").trim() };
  }
  // ARASAAC still goes through the server, and this is the one place the page
  // has not left it. The reference an ARASAAC pick *should* become is its id -
  // that is the decision in docs/symbol-search.md - but build.py resolves a
  // symbol by looking in symbols/, so writing an id today would produce
  // layouts the build cannot build. The download stays until the build itself
  // moves into the browser, and then this branch goes - and with it the last
  // symbol call behind the seam.
  const result = await pickSymbol({
    source: item.source,
    id: item.id,
    label: item.label || "",
  });
  return { symbol: result.symbol, label: (result.label || "").trim() };
}

/** Somebody's own picture, stored and handed back as a reference. */
export async function uploadOwn(file: File): Promise<string> {
  const result = await uploadSymbol(file);
  return result.symbol;
}

// Which sources exist is no longer fixed at start: METACOM arrives when a
// folder is chosen and leaves when it is forgotten, both without a reload. So
// this runs again whenever the provider says something changed.
/* Which of them the picker offers is a setting, and this is what reads it.
 *
 * Nothing did: the only caller of loadSettings() is the settings sheet
 * opening, so until somebody pressed the gear the page ran on the "arasaac"
 * that symbols.ts starts life with. A METACOM chosen last visit was searched
 * as ARASAAC, the field said ARASAAC, and both quietly changed their mind the
 * first time the sheet was opened.
 *
 * Read rather than remembered, and read again whenever the folder's state
 * changes, because the answer is derived from it: readSettings() only hands
 * back "metacom" once the collection actually answers. That is not a
 * technicality on Chromium - a stored folder handle usually comes back
 * needing its permission re-confirmed, so at load there is honestly no
 * collection and METACOM only exists a click later. Reading once at boot
 * would have been right about that moment and wrong from then on. */
async function adoptSource() {
  try {
    const settings = await readSettings();
    symbols.setActiveSource(settings.activeProvider || "arasaac");
  } catch {
    // A search still works, on the source that needs no folder. This runs
    // unawaited from start(), so a throw here would be nobody's to catch.
  }
}

export async function loadSources() {
  // Before the subscription and not through it: a folder that is not there
  // sends no notification, and that case still has a setting to honour.
  await symbols.restoreMetacom();
  await adoptSource();
  symbols.subscribeMetacom(() => void adoptSource());
}

/** Which collection is being searched, as the words a search field wears.
 *
 * Read by the pick column as it is built, which is why nothing has to repaint
 * it: a sheet that is not open has no stale field in it, and a sheet that is
 * opening asks this afresh. Five calls to a showSources() existed to keep the
 * dialog's copy of this honest, and all five went with the dialog. */
export const searchPlaceholder = (): string =>
  t(symbols.activeSource() === "metacom" ? "ui.search_metacom" : "ui.search_arasaac");

/** What is owed for the collection being searched, as one line.
 *
 * Read the same way, with more riding on it: ARASAAC is CC BY-NC-SA and the
 * wording is a condition of the licence, so wherever its pictures are shown
 * this sentence has to be shown too. The place that is now is the pick column
 * of whichever sheet is open - and, standing rather than per-screen, the
 * ARASAAC panel in Einstellungen, which draws the same notice from the same
 * package.
 *
 * The notice itself is not written here and is not in the text table: it comes
 * from the package that owns the provider - a translated paraphrase beside it
 * is how the two drifted apart, and the copy that was here had lost both
 * arasaac.org and the Regierung von Aragón. METACOM returns nothing, on
 * purpose: it is the user's own licensed copy and owes no notice.
 *
 * Ours to say, and only where it applies: that METACOM is referenced rather
 * than copied, or - when it is not the source - that a licence somebody owns
 * could be one. Nobody opens settings to find that out, so it is said where
 * they are standing.
 *
 * Three cases and not two, because "no collection" was covering a state it has
 * no business covering. A folder chosen last visit comes back needing its
 * permission re-confirmed - routine on Chromium, where the grant is scoped to
 * the site rather than to the app - and the line asked somebody who had
 * already set METACOM up whether they happened to own a licence. The remedy is
 * a click, so the sentence names it, and names the answer in the browser's own
 * prompt that stops it being asked again.
 */
export function creditLine(): string {
  const metacom = symbols.activeSource() === "metacom";
  // The one source the picker is offering. A key already on the board may have
  // come from the other one - switching source never took anything off a board
  // - but what is owed here is owed for what is on this screen.
  const owed = symbols.attributionFor([symbols.activeSource()]).join(" ");
  const state = symbols.metacomStatus();
  const waiting = state.kind === "needs-setup" && state.code === "permission-needed";
  const ours = metacom ? t("ui.credits_metacom")
    : waiting ? t("ui.metacom_waiting")
    : symbols.metacomReady() ? "" : t("ui.metacom_offer");
  return `${ours} ${owed}`.trim();
}
