/* The sheet behind the ⋯ beside a Sammlung's name: what is true of *this*
 * Sammlung and travels with it.
 *
 * Both panels in here were in the settings sheet at the foot of the sidebar,
 * among the Azure key and the METACOM folder, and both were the wrong thing to
 * find there. Everything else on that sheet answers "what is this browser, or
 * this installation, set to"; these two answer "which Sammlung is open" - so
 * opening a different one and reopening Einstellungen showed a different
 * answer in the same place, which is not what a setting is. docs/sammlung-settings.md
 * is the argument in full.
 *
 * ## What is here, and what deliberately is not
 *
 * The voice, for both targets: which of the voices this machine has is the one
 * this Sammlung speaks in. **Which voices the machine has** is the other half
 * and it stayed behind - the Azure key, the offer to fetch the offline ones,
 * the download and its progress. A download installs a voice for every
 * Sammlung there is, so putting it in a per-child sheet would be the same
 * scope mismatch this sheet exists to undo, only reversed.
 *
 * The device's menu language, for the talker only. On a tablet package that
 * field is nearly vestigial: localeFor() in data/app_package.ts derives the
 * locale from the *voice* first, because somebody chose that voice for these
 * sentences, and only falls back to the layout's language when the voice name
 * carries no usable tag. So the tablet gets the voice and nothing else here -
 * its grid card is its own entry in the same menu.
 *
 * ## The shape
 *
 * §3.5's folded panels, one open at a time through `name="collection"` - the
 * platform's own accordion, the same as the settings sheet uses, and for the
 * same reason: a heading that states its state is only readable at a glance
 * while the sheet is not a scroll through everything ever opened.
 *
 * No Save and no Cancel, like the settings sheet and for a stronger reason: a
 * language and a voice destroy nothing. The one control on a Sammlung that
 * does - the tablet's grid, which throws buttons away when it shrinks - asks
 * before it acts and is not in here.
 */
import { mount } from "./mount.js";

export const markup = `
<dialog id="collectionSheet" class="sheet">
  <div class="head">
    <strong id="collectionSheetHeading"></strong>
    <button id="collectionSheetClose" class="btn quiet icon" type="button">✕</button>
  </div>
  <div class="body">

  <!-- The language the device shows its own menu in. First, and open on
       arrival, because it is the one a talker Sammlung is usually opened for -
       and hidden outright on a tablet Sammlung, where the voice decides the
       locale and this would be a field with nothing downstream of it. -->
  <details class="panel" name="collection" id="collectionLanguagePanel">
    <summary>
      <span class="section" id="collectionLanguageSection"></span>
      <span class="state" id="collectionLanguageState"></span>
    </summary>
    <div class="setting">
      <!-- The options name themselves - "Deutsch" stays "Deutsch" whatever the
           page is set to. That matters twice over here: this is the language
           of a device somebody else will hold. -->
      <span class="menu-anchor start"><button id="collectionLangPick" class="btn quiet sm dropdown"
        type="button" aria-haspopup="menu" aria-expanded="false"
        aria-labelledby="collectionLanguageSection"></button></span>
      <p class="note" id="collectionLanguageNote"></p>
    </div>
  </details>

  <details class="panel" name="collection" id="voicePanel">
    <summary>
      <span class="section" id="voiceSection"></span>
      <span class="state" id="voiceState"></span>
    </summary>
    <div class="setting">
      <!-- The search field is markup rather than rebuilt with the list:
           redrawing an input somebody is typing into takes the caret with it. -->
      <input type="search" id="voiceQuery" class="field" autocomplete="off">
      <div class="voicefilters" id="voiceFilters"></div>
      <div class="voiceList" id="voiceList"></div>
      <!-- What a different voice costs, and - when there is nothing here to
           choose between - where voices come from. The offer to fetch them
           used to sit under this line; it is in Einstellungen now, with the
           key that stocks the other half of the list. -->
      <div class="hint" id="voiceHint"></div>
    </div>
  </details>

  </div>
</dialog>
`;

export function render(): void {
  mount(document.body, markup);
}
