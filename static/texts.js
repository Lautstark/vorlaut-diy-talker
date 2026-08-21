// Only the ui.* entries of the chosen language - see texts.py. Every label on
// this page goes through t(), so no string sits in the markup twice.
import { $ } from "./dom.js";
import { LANG, LANGUAGES, TEXTS } from "./boot.js";
import { state } from "./state.js";
import { save } from "./save.js";

export function t(key, params) {
  let out = TEXTS[key] || key;
  if (params) {
    for (const name in params) {
      out = out.split("{" + name + "}").join(params[name]);
    }
  }
  return out;
}

// Fills in every fixed label. Runs once - the page is served in one language
// and reloads when it changes, so nothing here has to react later.
export function applyTexts() {
  document.documentElement.style.setProperty(
    "--pick-label", JSON.stringify(t("ui.pick_symbol")));
  $("previewLabel").title = t("ui.preview_title");
  $("previewText").textContent = t("ui.preview");
  $("releaseBtn").textContent = t("ui.release");
  $("overwriteBtn").textContent = t("ui.keep_mine");
  $("reloadBtn").textContent = t("ui.reload");
  $("removeSet").textContent = t("ui.remove_set");
  $("searchBtn").textContent = t("ui.search");
  $("uploadBtn").textContent = t("ui.own_image");
  $("closeBtn").textContent = t("ui.close");
  $("q").placeholder = t("ui.search_arasaac");
  $("quellen").textContent = t("ui.credits_arasaac");
  $("settingsHeading").textContent = t("ui.settings");
  $("voiceSection").textContent = t("ui.voice");
  $("azureSection").textContent = t("ui.azure");
  $("azureIntro").textContent = t("ui.azure_intro");
  $("azureKeyLabel").textContent = t("ui.azure_key");
  $("azureKey").placeholder = t("ui.azure_key_placeholder");
  $("azureRegionLabel").textContent = t("ui.azure_region");
  $("symbolsSection").textContent = t("ui.symbols");
  $("metacomIntro").textContent = t("ui.metacom_intro");
  $("metacomLabel").textContent = t("ui.metacom_path");
  $("gear").title = t("ui.settings");
  $("gear").setAttribute("aria-label", t("ui.settings"));
  $("voiceSave").textContent = t("ui.save");
  $("voiceCancel").textContent = t("ui.cancel");
  $("voiceClose").setAttribute("aria-label", t("ui.close"));
  $("voiceClose").title = t("ui.close");
  $("pairTitle").textContent = t("ui.pair_title");
  $("pairNote").textContent = t("ui.pair_note");
  $("pairConfirm").textContent = t("ui.pair_confirm");

  // Set here rather than in the markup: the language is one of the values the
  // server hands over in the bootstrap block, and that block is now the only
  // thing it injects. An attribute in ui.html would mean a second hole.
  document.documentElement.lang = LANG;

  // Just the code. "Deutsch" and "English" read nicer but cost a third of
  // the header on a phone, and a two-letter language code is the one label
  // that needs no translation. The title says what the thing is.
  const names = { de: "DE", en: "EN" };
  const pick = $("langPick");
  pick.title = t("ui.language_title");
  for (const code of LANGUAGES) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = names[code] || code;
    option.selected = code === LANG;
    pick.appendChild(option);
  }
  // Saved like any other change, then reloaded: the labels are baked into the
  // page by the server, so switching them in place would mean a second copy
  // of every string in the browser.
  pick.onchange = async () => {
    state.layout.language = pick.value;
    await save();
    location.reload();
  };
}
