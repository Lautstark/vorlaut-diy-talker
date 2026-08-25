// The symbol dialog: searching two sources, picking a result, uploading an
// image of your own, and handing the outcome back to whoever opened it.
//
// pickTarget and searchToken live here and nowhere else. Which sources are
// available is bildquelle's answer now, not a variable of ours.
import { $, say, status} from "./dom.js";
import { reason } from "../core/errors.js";
import { pickSymbol, readSettings, uploadSymbol } from "../backend/index.js";
import * as symbols from "../data/symbols.js";
import { t } from "../core/texts.js";

/** What the dialog was opened for.
 *
 * `apply` rather than a target the picker then writes into, and that is the
 * whole of what makes this module the shell's. It used to take {kind: "set"}
 * or {kind: "slot", index} and write the chosen file name into
 * state.layout.sets[state.current] itself - which meant the symbol dialog knew
 * what a set was, how many keys were in one, and which of them was on screen.
 * None of that is true of a device this page has not met yet. Now the caller
 * says where the symbol goes, and choosing one is the whole of what is left.
 */
export interface PickRequest {
  /** What to put in the search field. Usually the word already on the key. */
  seed?: string;
  /** Where the chosen symbol goes. `label` is the collection's word for it,
   *  "" when it has none; the caller decides whether to write it anywhere,
   *  and every caller so far only fills a field that is still empty. */
  apply: (symbol: string, label: string) => void | Promise<void>;
}

let pickTarget: PickRequest | null = null;
let searchToken = 0;        // so a slow answer cannot overtake a newer one

/* --- The seam ------------------------------------------------------------
 *
 * Three operations, exported so that a caller can put the search where it is
 * standing instead of opening this dialog on top of its own.
 *
 * The tablet editor is that caller: its button sheet carries the picture, its
 * search and the upload in its own left column, and a second modal over a
 * modal to choose a symbol would be the dialog this design set out to remove.
 * What it must not do is carry a second copy of the reasoning below - which
 * source is active, what an empty answer means, and the fact that an ARASAAC
 * pick is a download while a METACOM one is a reference. All three stay here;
 * only the markup is the caller's. */

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

export function openPicker(request: PickRequest) {
  pickTarget = request;
  $<HTMLInputElement>("q").value = (request.seed || "").trim();
  $("results").innerHTML = "";
  $<HTMLDialogElement>("picker").showModal();
  $<HTMLInputElement>("q").focus();
  if ($<HTMLInputElement>("q").value) doSearch();
}

// Searching happens here now, not on the server. /api/search and /api/thumb
// still exist and still work; nothing on this page calls them. See
// docs/symbol-search.md.

async function doSearch() {
  const word = $<HTMLInputElement>("q").value.trim();
  if (!word) return;
  const box = $("results");
  const mine = ++searchToken;
  say(box, t("ui.searching"));

  // No group heading any more: there is one collection to show, and a heading
  // over the whole of it named the only thing on screen.
  const show = (items) => {
    box.innerHTML = "";
    items.forEach((item) => {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = item.url;
      image.loading = "lazy";
      image.alt = "";
      const caption = document.createElement("figcaption");
      // textContent instead of innerHTML: the caption comes from a foreign
      // data source and is not markup. The hint tells twins apart - four
      // METACOM tiles captioned "ja" differ only in rendering - and stays a
      // separate field because applySymbol may write item.label onto the key.
      caption.textContent = (item.label || item.id) + (item.hint ? ` · ${item.hint}` : "");
      figure.append(image, caption);
      figure.onclick = () => pick(item);
      box.appendChild(figure);
    });
  };

  // Both the empty answer and the failed one come back as a sentence in
  // `empty` - see findSymbols above, which is where that reading lives now.
  const answer = await findSymbols(word);
  if (mine !== searchToken) return;
  show(answer.hits);
  if (answer.empty) say(box, answer.empty);
}

// Hands a finished symbol to whoever opened the dialog, then closes it.
// label is the word for the symbol, if the source supplies one.
async function applySymbol(filename: string, label?: string) {
  // Saving and redrawing are the caller's: it is the one that knows what it
  // just changed, and this module no longer knows what a key is.
  await pickTarget?.apply(filename, (label || "").trim());
  $<HTMLDialogElement>("picker").close();
}

async function pick(item: SymbolHit) {
  status(t(item.source === "metacom" ? "ui.taking_symbol" : "ui.loading_symbol"));
  try {
    // Which of the two sources this is, and what that costs, is takeSymbol's -
    // the dialog only has to know where the answer goes.
    const taken = await takeSymbol(item);
    await applySymbol(taken.symbol, taken.label);
    status("");
  } catch (error) {
    status(t("ui.symbol_failed", { error: reason(error) }));
  }
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
    // The picker still opens, on the source that needs no folder. This runs
    // unawaited from start(), so a throw here would be nobody's to catch.
  }
  showSources();
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
 * Exported because there are two search fields now and only one answer. The
 * dialog below has one; shell/sheet.ts's pick column is the other, and it is
 * the one both editors actually reach - a sheet carries its own search rather
 * than opening this dialog on top of itself. A second copy of this line is how
 * a field comes to name a collection it is not searching, which is the bug
 * adoptSource() below was written for. */
export const searchPlaceholder = (): string =>
  t(symbols.activeSource() === "metacom" ? "ui.search_metacom" : "ui.search_arasaac");

/** What is owed for the collection being searched, as one line.
 *
 * Exported for the same reason and with more riding on it: ARASAAC is
 * CC BY-NC-SA and the wording is a condition of the licence, so wherever its
 * pictures are shown this sentence has to be shown too. That used to be one
 * place, because there was one place pictures were shown. There are two now.
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

export function showSources() {
  $<HTMLInputElement>("q").placeholder = searchPlaceholder();
  $("credits").textContent = creditLine();
}

export function wirePicker() {
  // Own picture. Where it goes and what happens to it is backend.js's
  // business; all that matters here is that a symbol comes back.
  $<HTMLButtonElement>("uploadBtn").onclick = () => $<HTMLInputElement>("fileInput").click();
  $<HTMLInputElement>("fileInput").onchange = async () => {
    const file = $<HTMLInputElement>("fileInput").files[0];
    $<HTMLInputElement>("fileInput").value = "";
    if (!file) return;
    status(t("ui.uploading"));
    try {
      await applySymbol(await uploadOwn(file));
      status(t("ui.upload_done"));
    } catch (error) {
      status(t("ui.upload_failed", { error: reason(error) }));
    }
  };

  $<HTMLButtonElement>("searchBtn").onclick = doSearch;
  $<HTMLInputElement>("q").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); doSearch(); } };
  $<HTMLButtonElement>("closeBtn").onclick = () => $<HTMLDialogElement>("picker").close();
}
