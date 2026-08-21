// The symbol dialog: searching two sources, picking a result, uploading an
// image of your own, and writing the outcome into the layout.
//
// pickTarget, searchToken and sources live here and nowhere else.
import { $, api, say, status } from "./dom.js";
import { state } from "./state.js";
import { t } from "./texts.js";
import { save } from "./save.js";
import { render } from "./editor.js";

let pickTarget = null;      // {kind: "set"} or {kind: "slot", index: n}
let sources = { metacom: false };
let searchToken = 0;        // so a slow answer cannot overtake a newer one

export function openPicker(target, seed) {
  pickTarget = target;
  $("q").value = (seed || "").trim();
  $("results").innerHTML = "";
  $("picker").showModal();
  $("q").focus();
  if ($("q").value) doSearch();
}

async function ask(word, source) {
  const url = "/api/search?source=" + source + "&q=" + encodeURIComponent(word);
  return await (await api(url)).json();
}

async function doSearch() {
  const word = $("q").value.trim();
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
    if (sources.metacom) {
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
      say(box, error.message);
    }
  }
}

// Enters a finished symbol where the dialog was opened.
// label is the word for the symbol, if the source supplies one.
async function applySymbol(filename, label) {
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
  $("picker").close();
  render();
}

async function pick(item) {
  status(t(item.source === "metacom" ? "ui.taking_symbol" : "ui.loading_symbol"));
  try {
    const result = await (await api("/api/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: item.source,
        id: item.id,
        ref: item.ref,
        label: item.label || $("q").value,
      }),
    })).json();
    await applySymbol(result.symbol, result.label);
    status("");
  } catch (error) {
    status(t("ui.symbol_failed", { error: error.message }));
  }
}

// Which symbol sources exist is fixed at start - asking once is enough.
// If that fails, it stays with ARASAAC alone.
export async function loadSources() {
  try {
    sources = await (await api("/api/sources")).json();
  } catch (error) {
    sources = { metacom: false };
  }
  $("q").placeholder = t(sources.metacom ? "ui.search_both" : "ui.search_arasaac");
  if (sources.metacom) {
    $("quellen").textContent = t("ui.credits_both");
  } else {
    // Where somebody is standing when they wish the pictograms were better.
    // Nobody opens settings to find out that a licence they own would be
    // searched too.
    $("quellen").textContent =
      t("ui.metacom_offer") + " " + t("ui.credits_arasaac");
  }
}

export function wirePicker() {
  // Own picture: the file goes to the server raw, the name sits in the query
  // string. That way no multipart form is needed.
  $("uploadBtn").onclick = () => $("fileInput").click();
  $("fileInput").onchange = async () => {
    const file = $("fileInput").files[0];
    $("fileInput").value = "";
    if (!file) return;
    status(t("ui.uploading"));
    try {
      const result = await (await api(
        "/api/upload?name=" + encodeURIComponent(file.name),
        { method: "POST", body: file }
      )).json();
      await applySymbol(result.symbol);
      status(t("ui.upload_done"));
    } catch (error) {
      status(t("ui.upload_failed", { error: error.message }));
    }
  };

  $("searchBtn").onclick = doSearch;
  $("q").onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); doSearch(); } };
  $("closeBtn").onclick = () => $("picker").close();
}
