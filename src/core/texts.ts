// Only the ui.* entries of the chosen language - see texts.py. Every label on
// this page goes through t(), so no string sits in the markup twice.
import { $ } from "../shell/dom.js";
import { LANG, TEXTS } from "./boot.js";
import { editor, haveEditor } from "./editor.js";
import { activeSource } from "../data/symbols.js";

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

// The same for an address somebody is meant to write to. It is its own setter
// rather than a second call to outward() with a "mailto:" already glued on,
// because then the table would hold the scheme and the guard above would have
// to let one more through. Here the table holds an address and nothing else,
// and this is the only place that can turn one into a link.
function mailward(id: string, key: string) {
  const link = $<HTMLAnchorElement>(id);
  const address = t(key);
  link.textContent = address;
  link.href = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? `mailto:${address}` : "";
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
  // The controls the editor owns - the device preview, Release - name
  // themselves. They used to be five lines here, in a file that also fills in
  // the imprint: this function would have had to know about "sets" and about a
  // cable, which are the two things the shell deliberately does not. See
  // core/editor.ts.
  //
  // Guarded, and it is the one place a missing editor is a real state rather
  // than a broken page: this runs at the first paint so that the shell's own
  // labels are up before the first round trip, and at that moment no editor is
  // on screen, because which editor is a fact about a Sammlung that has not
  // been read yet. showEditorFor() calls labels() itself when one arrives.
  if (haveEditor()) editor().labels();
  $<HTMLButtonElement>("overwriteBtn").textContent = t("ui.keep_mine");
  $<HTMLButtonElement>("reloadBtn").textContent = t("ui.reload");

  // The sidebar. The rows in it are not here - they carry names somebody typed,
  // and shell/collections.ts draws them whenever the list moves. What is here
  // is the furniture around them.
  $("collectionsHeading").textContent = t("ui.collections");
  $<HTMLButtonElement>("collectionNew").textContent = t("ui.collection_new");
  $<HTMLButtonElement>("settingsLink").textContent = t("ui.settings");
  for (const [id, key] of [["sidebarHide", "ui.collections_hide"],
                           ["sidebarShowBtn", "ui.collections_show"]] as const) {
    $<HTMLButtonElement>(id).title = t(key);
    $<HTMLButtonElement>(id).setAttribute("aria-label", t(key));
  }
  // A field with no visible label: the Sammlung's name is its own heading, and
  // a word in front of it would be a second one. So the name has to be said to
  // whoever cannot see that, and the menu beside it likewise - it is one
  // character wide and that character is not a word.
  $<HTMLInputElement>("collectionName").setAttribute("aria-label", t("ui.collection_name"));
  $<HTMLButtonElement>("collectionMenu").title = t("ui.collection_menu");
  $<HTMLButtonElement>("collectionMenu").setAttribute("aria-label", t("ui.collection_menu"));
  $<HTMLButtonElement>("searchBtn").textContent = t("ui.search");
  $<HTMLButtonElement>("uploadBtn").textContent = t("ui.own_image");
  $<HTMLButtonElement>("closeBtn").textContent = t("ui.close");
  // Named after the collection actually being offered, not after ARASAAC.
  // This line said "ui.search_arasaac" flat, which was true of a first visit
  // and of nothing else: applyTexts() runs again on every language switch and
  // on a board arriving in another language, and each of those put ARASAAC
  // back over a field that was searching METACOM. picker.ts writes the same
  // placeholder when the source changes; this is the same answer at the one
  // moment the picker has nothing to react to.
  $<HTMLInputElement>("q").placeholder =
    t(activeSource() === "metacom" ? "ui.search_metacom" : "ui.search_arasaac");
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
  $("themeSection").textContent = t("ui.theme");
  // The panel's accessible name as well as its heading: the group of buttons
  // inside it is three unlabelled words without one.
  $("themePick").setAttribute("aria-label", t("ui.theme"));
  // The counterpart to the note above, and it exists for the same reason: this
  // switch is the one that does NOT reach the device, and the language sitting
  // directly above it is the reason somebody would assume it did.
  $("themeNote").textContent = t("ui.theme_note");
  $("symbolsSection").textContent = t("ui.symbols");
  $("metacomIntro").textContent = t("ui.metacom_intro");
  outward("metacomLink", "ui.metacom_link", "ui.metacom_link_url");
  $("metacomLabel").textContent = t("ui.metacom_path");
  $("boardSection").textContent = t("ui.collection");
  $("boardNote").textContent = t("ui.collection_note");
  $("deviceSection").textContent = t("ui.device_section");
  $("deviceNote").textContent = t("ui.device_note");
  $<HTMLButtonElement>("deviceConnect").textContent = t("ui.device_connect");
  $("buildNote").textContent = t("ui.build_note");
  $<HTMLButtonElement>("buildExport").textContent = t("ui.build_export");
  $("dataSection").textContent = t("ui.data_section");
  $("dataNote").textContent = t("ui.data_note");
  $("dataExport").textContent = t("ui.data_export");
  $("dataImport").textContent = t("ui.data_import");
  // The standing backup's own line and buttons are NOT set here. They are
  // rebuilt from the table on every status change instead, because the state
  // decides which words and which buttons there are - see ui/backupFolder.ts.
  $("folderLead").textContent = t("ui.folder_lead");
  $<HTMLButtonElement>("boardImport").textContent = t("ui.collection_import");
  $<HTMLButtonElement>("azureSave").textContent = t("ui.azure_save");
  $("arasaacSection").textContent = t("ui.arasaac");
  $<HTMLButtonElement>("voiceClose").setAttribute("aria-label", t("ui.close"));
  $<HTMLButtonElement>("voiceClose").title = t("ui.close");

  // The footer and the three pages it opens. Filled here with everything else
  // rather than when a dialog is opened: the labels on the footer itself are
  // on screen from the first paint, and a page whose prose arrives only on the
  // second visit is a page that was empty on the first.
  $<HTMLButtonElement>("aboutLink").textContent = t("ui.legal_about");
  $<HTMLButtonElement>("impressumLink").textContent = t("ui.legal_impressum");
  $<HTMLButtonElement>("privacyLink").textContent = t("ui.legal_privacy");
  outward("sourceLink", "ui.legal_source", "ui.legal_source_url");

  $("aboutLead").textContent = t("ui.about_lead");
  $("aboutLeavesHead").textContent = t("ui.about_leaves_head");
  $("aboutLeaves").textContent = t("ui.about_leaves");
  $("aboutSymbolsHead").textContent = t("ui.about_symbols_head");
  $("aboutSymbols").textContent = t("ui.about_symbols");
  $("aboutSourceHead").textContent = t("ui.about_source_head");
  $("aboutSource").textContent = t("ui.about_source");
  outward("aboutRepo", "ui.about_repo", "ui.about_repo_url");
  outward("aboutMitreden", "ui.about_mitreden", "ui.about_mitreden_url");
  outward("aboutBildhaft", "ui.about_bildhaft", "ui.about_bildhaft_url");

  $("impAngabenHead").textContent = t("ui.imp_angaben_head");
  $("impAddress").textContent = t("ui.imp_address");
  $("impContactHead").textContent = t("ui.imp_contact_head");
  $("impContactLead").textContent = t("ui.imp_contact_lead");
  mailward("impMail", "ui.legal_email");
  outward("impIssues", "ui.imp_issues", "ui.imp_issues_url");
  $("impResponsibleHead").textContent = t("ui.imp_responsible_head");
  $("impResponsible").textContent = t("ui.imp_responsible");
  $("impSymbolsHead").textContent = t("ui.imp_symbols_head");
  $("impSymbols").textContent = t("ui.imp_symbols");
  $("impLinksHead").textContent = t("ui.imp_links_head");
  $("impLinks").textContent = t("ui.imp_links");
  $("impDisputeHead").textContent = t("ui.imp_dispute_head");
  $("impDispute").textContent = t("ui.imp_dispute");

  $("dsgLead").textContent = t("ui.dsg_lead");
  $("dsgControllerHead").textContent = t("ui.dsg_controller_head");
  $("dsgController").textContent = t("ui.dsg_controller");
  mailward("dsgMail", "ui.legal_email");
  $("dsgHostingHead").textContent = t("ui.dsg_hosting_head");
  $("dsgHosting").textContent = t("ui.dsg_hosting");
  $("dsgArasaacHead").textContent = t("ui.dsg_arasaac_head");
  $("dsgArasaac").textContent = t("ui.dsg_arasaac");
  $("dsgCdnHead").textContent = t("ui.dsg_cdn_head");
  $("dsgCdn").textContent = t("ui.dsg_cdn");
  $("dsgVoicesHead").textContent = t("ui.dsg_voices_head");
  $("dsgVoices").textContent = t("ui.dsg_voices");
  $("dsgAzureHead").textContent = t("ui.dsg_azure_head");
  $("dsgAzure").textContent = t("ui.dsg_azure");
  $("dsgStorageHead").textContent = t("ui.dsg_storage_head");
  $("dsgStorage").textContent = t("ui.dsg_storage");
  $("dsgDeviceHead").textContent = t("ui.dsg_device_head");
  $("dsgDevice").textContent = t("ui.dsg_device");
  $("dsgNoneHead").textContent = t("ui.dsg_none_head");
  $("dsgNone").textContent = t("ui.dsg_none");
  $("dsgRightsHead").textContent = t("ui.dsg_rights_head");
  $("dsgRights").textContent = t("ui.dsg_rights");
  $("dsgStand").textContent = t("ui.dsg_stand");

  // Set here rather than in the markup: the language is one of the values the
  // server hands over in the bootstrap block, and that block is now the only
  // thing it injects. An attribute in ui.html would mean a second hole.
  document.documentElement.lang = LANG;
}
