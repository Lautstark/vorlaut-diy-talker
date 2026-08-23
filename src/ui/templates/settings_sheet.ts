/* The settings sheet: language, voice, where voices come from, where symbols
 * come from, and the board as a document.
 *
 * Every section is a folded panel whose heading carries its state, so the whole
 * of what this installation is set to reads at a glance and opening one is a
 * decision. That is the shape bildhaft and mitreden both settled on, and the
 * panel itself is the component vorlaut contributed to the shared layer.
 *
 * There is no Save and no Cancel on the dialog. Everything here applies when
 * it is touched, the way every other edit on this page already does - a board
 * has been saving itself on a debounce for as long as it has existed, and a
 * sheet that made you press Save was the one surface that did not. The one
 * field that cannot work that way keeps a Save of its own, inside its panel:
 * an Azure key must not be written on every keystroke, and an empty field has
 * to keep meaning "leave the key alone" rather than "drop it".
 *
 * This is the half of the old ui.html that most wanted splitting off - it is
 * longer than everything else on the page put together, three modules wire
 * parts of it (voices.ts, settings.ts and main.ts), and it is the thing people
 * add a field to. The comments inside it are about why the sections are in
 * this order, and they are worth keeping next to the markup they explain. */
import { mount } from "./mount.js";

export const markup = `
<dialog id="voices" class="sheet">
  <div class="head">
    <strong id="settingsHeading"></strong>
    <button id="voiceClose" class="btn quiet icon closeX" type="button">×</button>
  </div>
  <div class="body">

  <!-- First, and deliberately: somebody who cannot read the page needs this
       one before anything else. The options name themselves - see voices.ts.
       Open on arrival for the same reason. -->
  <details class="panel" id="languagePanel" open>
    <summary>
      <span class="section" id="languageSection"></span>
      <span class="state" id="languageState"></span>
    </summary>
    <div class="setting">
      <span class="selectwrap"><select id="langPick"></select></span>
      <p class="note" id="languageNote"></p>
    </div>
  </details>

  <details class="panel" id="voicePanel">
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
      <div class="hint" id="voiceHint"></div>
      <!-- The offer to fetch the offline voices. Below the note about the
           chosen one rather than above it: that note belongs to the list, and
           this is a separate errand. -->
      <div class="voiceOffer" id="voiceOffer"></div>
    </div>
  </details>

  <!-- Where voices come from, under the voices themselves. -->
  <details class="panel" id="azurePanel">
    <summary>
      <span class="section" id="azureSection"></span>
      <span class="state" id="azureState"></span>
    </summary>
    <div class="setting">
      <p class="lead" id="azureIntro"></p>
      <p class="lead"><a id="azureLink" target="_blank" rel="noopener noreferrer"></a></p>
      <label id="azureKeyLabel" for="azureKey"></label>
      <input type="password" id="azureKey" class="field" autocomplete="off">
      <label id="azureRegionLabel" for="azureRegion"></label>
      <input type="text" id="azureRegion" class="field" autocomplete="off">
      <p class="note" id="azureKeyState"></p>
      <div class="row">
        <!-- The one Save left on this sheet, and it is here rather than on the
             dialog because a key is the one thing that must not be written as
             it is typed. -->
        <button id="azureSave" class="btn primary" type="button"></button>
        <!-- Removing the key is its own button: the empty field already means
             "leave the key alone", so it cannot also mean "drop it". -->
        <button id="azureForget" class="btn" type="button"></button>
      </div>
    </div>
  </details>

  <!-- The two symbol sources, each stating what it is. They are not exclusive:
       a vorlaut key stores where its own picture came from, and a board may
       hold both - which is why the picker searches both and the .obz declares
       both licences. -->
  <details class="panel" id="arasaacPanel">
    <summary>
      <span class="section" id="arasaacSection"></span>
      <span class="state" id="arasaacState"></span>
    </summary>
    <div class="setting">
      <p class="lead" id="arasaacIntro"></p>
      <!-- Not written here and not in the text table: the wording is a
           condition of the licence, so it comes from bildquelle. -->
      <p class="note" id="arasaacCredit"></p>
      <div class="row"><button id="arasaacUse" class="btn" type="button"></button></div>
    </div>
  </details>

  <details class="panel" id="symbolsPanel">
    <summary>
      <span class="section" id="symbolsSection"></span>
      <span class="state" id="symbolsState"></span>
    </summary>
    <div class="setting">
      <p class="lead" id="metacomIntro"></p>
      <p class="lead"><a id="metacomLink" target="_blank" rel="noopener noreferrer"></a></p>
      <label id="metacomHereLabel"></label>
      <div class="row">
        <button id="metacomChoose" class="btn" type="button"></button>
        <input type="file" id="metacomFiles" webkitdirectory directory multiple hidden>
        <button id="metacomForget" class="btn" type="button"></button>
      </div>
      <p class="note" id="metacomHereState"></p>

      <label id="metacomLabel" for="metacomPath"></label>
      <input type="text" id="metacomPath" class="field" autocomplete="off">
      <p class="note" id="metacomState"></p>
      <p class="note" id="metacomBuildNote"></p>
      <div class="row"><button id="metacomUse" class="btn" type="button"></button></div>

      <!-- METACOM ships the same symbols several times over - with and without
           a frame, with and without the word printed on. Only shown when the
           folder actually holds more than one; a copy pointed straight at one
           rendering has nothing to choose between. -->
      <div id="renderingBox" hidden>
        <label id="renderingLabel" for="renderingPick"></label>
        <span class="selectwrap"><select id="renderingPick"></select></span>
        <p class="note" id="renderingNote"></p>
      </div>
    </div>
  </details>

  <details class="panel" id="boardPanel">
    <summary>
      <!-- No state line: this panel is two actions, and a heading that says
           nothing is furniture rather than a summary. -->
      <span class="section" id="boardSection"></span>
    </summary>
    <div class="setting">
      <p class="lead" id="boardNote"></p>
      <div class="row">
        <button id="boardExport" class="btn" type="button"></button>
        <button id="boardImport" class="btn" type="button"></button>
      </div>
      <!-- What the last export or import did. In the body rather than the
           summary: a summary carries what a section IS set to, and this is
           the outcome of an errand somebody just ran. -->
      <p class="note" id="boardState"></p>
    </div>
  </details>

  </div>
</dialog>
`;

export function render(): void {
  mount(document.body, markup);
}
