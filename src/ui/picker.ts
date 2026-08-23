// The symbol dialog: searching two sources, picking a result, uploading an
// image of your own, and writing the outcome into the layout.
//
// pickTarget and searchToken live here and nowhere else. Which sources are
// available is bildquelle's answer now, not a variable of ours.
import { $, say, status} from "./dom.js";
import { reason } from "../core/errors.js";
import { pickSymbol, uploadSymbol } from "../backend/index.js";
import * as symbols from "../data/symbols.js";
import type { ProviderId } from "@lautstark/bildquelle";
import { state } from "../core/state.js";
import { t } from "../core/texts.js";
import { save } from "../core/save.js";
import { render } from "./editor.js";

let pickTarget = null;      // {kind: "set"} or {kind: "slot", index: n}
let searchToken = 0;        // so a slow answer cannot overtake a newer one

export function openPicker(target, seed) {
  pickTarget = target;
  $<HTMLInputElement>("q").value = (seed || "").trim();
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

  try {
    const hits = await symbols.searchActive(word);
    if (mine !== searchToken) return;
    show(hits);
    if (!hits.length) say(box, t("ui.nothing_found", { word: word }));
  } catch (error) {
    if (mine !== searchToken) return;
    say(box, reason(error));
  }
}

// Enters a finished symbol where the dialog was opened.
// label is the word for the symbol, if the source supplies one.
async function applySymbol(filename: string, label?: string) {
  const entry = state.layout.sets[state.current];
  const word = (label || "").trim();
  if (pickTarget.kind === "set") {
    entry.symbol = filename;
    // Only prefill an empty field, never overwrite anything: the symbol is
    // called "zustimmen", but your key should say "Ja!".
    if (word && !entry.name.trim()) entry.name = word;
  } else {
    const slot = entry.slots[pickTarget.index];
    slot.symbol = filename;
    if (word && !slot.text.trim()) slot.text = word;
  }
  await save();
  $<HTMLDialogElement>("picker").close();
  render();
}

async function pick(item) {
  status(t(item.source === "metacom" ? "ui.taking_symbol" : "ui.loading_symbol"));
  try {
    if (item.source === "metacom") {
      // Nothing to fetch and nothing to copy: the layout holds the reference
      // and the picture stays in the licensed folder, which is the whole of
      // the METACOM rule. The browser resolved it, so the server is not asked.
      await applySymbol(item.ref, item.label);
    } else {
      // ARASAAC still goes through the server, and this is the one place the
      // page has not left it. The reference an ARASAAC pick *should* become is
      // its id - that is the decision in docs/symbol-search.md - but build.py
      // resolves a symbol by looking in symbols/, so writing an id today would
      // produce layouts the build cannot build. The download stays until the
      // build itself moves into the browser, and then this branch goes - and
      // with it the last symbol call behind the seam.
      const result = await pickSymbol({
        source: item.source,
        id: item.id,
        label: item.label || $<HTMLInputElement>("q").value,
      });
      await applySymbol(result.symbol, result.label);
    }
    status("");
  } catch (error) {
    status(t("ui.symbol_failed", { error: reason(error) }));
  }
}

// Which sources exist is no longer fixed at start: METACOM arrives when a
// folder is chosen and leaves when it is forgotten, both without a reload. So
// this runs again whenever the provider says something changed.
export async function loadSources() {
  await symbols.restoreMetacom();
  symbols.subscribeMetacom(showSources);
  showSources();
}

export function showSources() {
  const metacom = symbols.activeSource() === "metacom";
  $<HTMLInputElement>("q").placeholder = t(metacom ? "ui.search_metacom" : "ui.search_arasaac");

  // The notice is not written here and is not in the text table. ARASAAC is
  // CC BY-NC-SA and the wording is a condition of the licence, so it comes
  // from the package that owns the provider - a translated paraphrase beside
  // it is how the two drifted apart, and the copy that was here had lost both
  // arasaac.org and the Regierung von Aragón. METACOM returns nothing, on
  // purpose: it is the user's own licensed copy and owes no notice.
  //
  // The one source the picker is offering. A key already on the board may
  // have come from the other one - switching source never took anything off a
  // board - but what is owed here is owed for what is on this screen.
  const sources: ProviderId[] = [symbols.activeSource()];
  const owed = symbols.attributionFor(sources).join(" ");

  // What is ours to say stays ours to say and stays translated: that METACOM
  // is only referenced, and - where no folder is connected - that a licence
  // somebody owns would be searched too. Nobody opens settings to find that
  // out, so it is said where they are standing.
  // Ours to say, and only where it applies: that METACOM is referenced rather
  // than copied, or - when it is not the source - that a licence somebody owns
  // could be one. Nobody opens settings to find that out.
  const ours = metacom ? t("ui.credits_metacom")
    : symbols.metacomReady() ? "" : t("ui.metacom_offer");
  $("credits").textContent = `${ours} ${owed}`.trim();
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
      const result = await uploadSymbol(file);
      await applySymbol(result.symbol);
      status(t("ui.upload_done"));
    } catch (error) {
      status(t("ui.upload_failed", { error: reason(error) }));
    }
  };

  $<HTMLButtonElement>("searchBtn").onclick = doSearch;
  $<HTMLInputElement>("q").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); doSearch(); } };
  $<HTMLButtonElement>("closeBtn").onclick = () => $<HTMLDialogElement>("picker").close();
}
