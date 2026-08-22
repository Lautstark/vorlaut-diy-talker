/* The settings sheet: language, voice, the Azure key, the METACOM folder and
 * the board as a document.
 *
 * This is the half of the old ui.html that most wanted splitting off - it is
 * longer than everything else on the page put together, three modules wire
 * parts of it (voices.ts, settings.ts and main.ts), and it is the thing people
 * add a field to. The comments inside it are about why the sections are in
 * this order, and they are worth keeping next to the markup they explain. */
import { mount } from "./mount.js";

export const markup = `
<dialog id="voices" class="sheet">
  <div class="dlgHead">
    <strong id="settingsHeading"></strong>
    <button id="voiceClose" class="closeX">×</button>
  </div>
  <div class="sheetBody">
  <!-- First, and deliberately: somebody who cannot read the page needs this
       one before anything else. The options name themselves - see voices.js. -->
  <div class="section" id="languageSection"></div>
  <div class="field">
    <select id="langPick"></select>
    <p class="note" id="languageNote"></p>
  </div>

  <div class="section" id="voiceSection"></div>
  <div class="voiceList" id="voiceList"></div>
  <div class="hint" id="voiceHint"></div>
  <!-- The offer to fetch the offline voices. Below the note about the
       chosen one rather than above it: that note belongs to the list, and
       this is a separate errand. -->
  <div class="voiceOffer" id="voiceOffer"></div>

  <!-- Folded up, both of them: neither is set on most installations, and
       what they are for takes a paragraph to say. The heading carries the
       state, so a look is enough and opening is a decision. -->
  <details class="panel" id="azurePanel">
    <summary>
      <span class="section" id="azureSection"></span>
      <span class="state" id="azureState"></span>
    </summary>
    <div class="field">
      <p class="lead" id="azureIntro"></p>
      <p class="lead"><a id="azureLink" target="_blank" rel="noopener noreferrer"></a></p>
      <label id="azureKeyLabel" for="azureKey"></label>
      <input type="password" id="azureKey" autocomplete="off">
      <p class="note" id="azureKeyState"></p>
      <label id="azureRegionLabel" for="azureRegion"></label>
      <input type="text" id="azureRegion" autocomplete="off">
    </div>
  </details>

  <details class="panel" id="symbolsPanel">
    <summary>
      <span class="section" id="symbolsSection"></span>
      <span class="state" id="symbolsState"></span>
    </summary>
    <div class="field">
      <p class="lead" id="metacomIntro"></p>
      <p class="lead"><a id="metacomLink" target="_blank" rel="noopener noreferrer"></a></p>
      <label id="metacomHereLabel"></label>
      <div class="row">
        <button id="metacomChoose" type="button"></button>
        <input type="file" id="metacomFiles" webkitdirectory directory multiple hidden>
        <button id="metacomForget" type="button"></button>
      </div>
      <p class="note" id="metacomHereState"></p>

      <label id="metacomLabel" for="metacomPath"></label>
      <input type="text" id="metacomPath" autocomplete="off">
      <p class="note" id="metacomState"></p>
      <p class="note" id="metacomBuildNote"></p>
    </div>
  </details>

  <details class="panel" id="boardPanel">
    <summary>
      <span class="section" id="boardSection"></span>
    </summary>
    <div class="field">
      <p class="lead" id="boardNote"></p>
      <button id="boardExport"></button>
      <button id="boardImport"></button>
      <p class="note" id="boardState"></p>
    </div>
  </details>

  </div>

  <div class="sheetFoot">
    <button class="primary" id="voiceSave"></button>
    <button id="voiceCancel"></button>
  </div>
</dialog>
`;

export function render(): void {
  mount(document.body, markup);
}
