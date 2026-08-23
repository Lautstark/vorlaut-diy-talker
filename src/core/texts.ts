// Only the ui.* entries of the chosen language - see texts.py. Every label on
// this page goes through t(), so no string sits in the markup twice.
import { $ } from "../ui/dom.js";
import { LANG, TEXTS } from "./boot.js";

// A label and its address, both out of the table. Everything else on this page
// arrives through textContent, which is inert whatever it says; an href is the
// one thing that is not, so it is checked rather than trusted. The table is our
// own source, not anybody's content - but that is exactly the assumption the
// old __TEXTS__ hole rested on, and it only has to stop being true once.
function outward(id: string, labelKey: string, urlKey: string) {
  const link = $<HTMLAnchorElement>(id);
  const url = t(urlKey);
  link.textContent = t(labelKey);
  link.href = url.startsWith("https://") ? url : "";
}

export function t(key: string, params?: Record<string, string | number>): string {
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
  $<HTMLButtonElement>("releaseBtn").textContent = t("ui.release");
  $<HTMLButtonElement>("overwriteBtn").textContent = t("ui.keep_mine");
  $<HTMLButtonElement>("reloadBtn").textContent = t("ui.reload");
  $<HTMLButtonElement>("removeSet").textContent = t("ui.remove_set");
  $<HTMLButtonElement>("searchBtn").textContent = t("ui.search");
  $<HTMLButtonElement>("uploadBtn").textContent = t("ui.own_image");
  $<HTMLButtonElement>("closeBtn").textContent = t("ui.close");
  $<HTMLInputElement>("q").placeholder = t("ui.search_arasaac");
  $("settingsHeading").textContent = t("ui.settings");
  $("voiceSection").textContent = t("ui.voice");
  $<HTMLInputElement>("voiceQuery").placeholder = t("ui.voice_search_hint");
  $<HTMLInputElement>("voiceQuery").setAttribute("aria-label", t("ui.voice_search_hint"));
  $("azureSection").textContent = t("ui.azure");
  $("azureIntro").textContent = t("ui.azure_intro");
  outward("azureLink", "ui.azure_link", "ui.azure_link_url");
  $("azureKeyLabel").textContent = t("ui.azure_key");
  $<HTMLInputElement>("azureKey").placeholder = t("ui.azure_key_placeholder");
  $("azureRegionLabel").textContent = t("ui.azure_region");
  $("languageSection").textContent = t("ui.language");
  // Under the picker, in the size of a footnote, because that is what it is:
  // the heading above already says Language. What it adds is the half nobody
  // guesses - that this switch reaches the device as well.
  $("languageNote").textContent = t("ui.language_title");
  $("symbolsSection").textContent = t("ui.symbols");
  $("metacomIntro").textContent = t("ui.metacom_intro");
  outward("metacomLink", "ui.metacom_link", "ui.metacom_link_url");
  $("metacomLabel").textContent = t("ui.metacom_path");
  $("boardSection").textContent = t("ui.board");
  $("boardNote").textContent = t("ui.board_note");
  $<HTMLButtonElement>("boardExport").textContent = t("ui.board_export");
  $<HTMLButtonElement>("boardImport").textContent = t("ui.board_import");
  $<HTMLButtonElement>("gear").title = t("ui.settings");
  $<HTMLButtonElement>("gear").setAttribute("aria-label", t("ui.settings"));
  $<HTMLButtonElement>("azureSave").textContent = t("ui.azure_save");
  $("arasaacSection").textContent = t("ui.arasaac");
  $<HTMLButtonElement>("voiceClose").setAttribute("aria-label", t("ui.close"));
  $<HTMLButtonElement>("voiceClose").title = t("ui.close");
  $("pairTitle").textContent = t("ui.pair_title");
  $("pairNote").textContent = t("ui.pair_note");
  $<HTMLButtonElement>("pairConfirm").textContent = t("ui.pair_confirm");

  // Set here rather than in the markup: the language is one of the values the
  // server hands over in the bootstrap block, and that block is now the only
  // thing it injects. An attribute in ui.html would mean a second hole.
  document.documentElement.lang = LANG;
}
