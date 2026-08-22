// The symbol dialog: searching two sources, picking a result, uploading an
// image of your own, and writing the outcome into the layout.
//
// pickTarget and searchToken live here and nowhere else. Which sources are
// available is bildquelle's answer now, not a variable of ours.
import { $, say, status} from "./dom.js";
import { reason } from "../core/errors.js";
import { pickSymbol, uploadSymbol } from "../backend/index.js";
import * as symbols from "../data/symbols.js";
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
const ask = (word, source) => symbols.search(word, source);

async function doSearch() {
  const word = $<HTMLInputElement>("q").value.trim();
  if (!word) return;
  const box = $("results");
  const mine = ++searchToken;
  say(box, t("ui.searching"));

  let cleared = false;
  let total = 0;
  const show = (title, items) => {
    if (!cleared) { box.innerHTML = ""; cleared = true; }
    if (!items.length) return;
    const head = document.createElement("div");
    head.className = "group";
    head.textContent = title;
    box.appendChild(head);
    items.forEach((item) => {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = item.url;
      image.loading = "lazy";
      image.alt = "";
      const caption = document.createElement("figcaption");
      // textContent instead of innerHTML: the caption comes from a foreign
      // data source and is not markup.
      caption.textContent = item.label || item.id;
      figure.append(image, caption);
      figure.onclick = () => pick(item);
      box.appendChild(figure);
    });
    total += items.length;
  };

  try {
    // The licensed collection sits locally and is there at once. ARASAAC
    // goes over the network and comes afterwards - that way something is
    // already on screen while the second source is still answering.
    if (symbols.metacomReady()) {
      const hits = await ask(word, "metacom");
      if (mine !== searchToken) return;
      show("METACOM", hits);
    }
    const remote = await ask(word, "arasaac");
    if (mine !== searchToken) return;
    show("ARASAAC", remote);
    if (!total) say(box, t("ui.nothing_found", { word: word }));
  } catch (error) {
    if (mine !== searchToken) return;
    if (total) {
      const note = document.createElement("p");
      note.textContent = t("ui.arasaac_down");
      box.appendChild(note);
    } else {
      say(box, reason(error));
    }
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

function showSources() {
  const metacom = symbols.metacomReady();
  $<HTMLInputElement>("q").placeholder = t(metacom ? "ui.search_both" : "ui.search_arasaac");
  if (metacom) {
    $("credits").textContent = t("ui.credits_both");
  } else {
    // Where somebody is standing when they wish the pictograms were better.
    // Nobody opens settings to find out that a licence they own would be
    // searched too.
    $("credits").textContent =
      t("ui.metacom_offer") + " " + t("ui.credits_arasaac");
  }
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
