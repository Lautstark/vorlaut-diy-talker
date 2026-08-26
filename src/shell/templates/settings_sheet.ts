/* The settings sheet: this page's language, its colour scheme, where voices
 * come from, where symbols come from, and the Sammlung as a document.
 *
 * **One scope, and that is the whole rule now.** Everything in here is a fact
 * about this browser or about this installation. Two panels used to be facts
 * about whichever Sammlung happened to be open - the voice, and the language
 * the device shows its own menu in - and a sheet whose answer changed when
 * somebody clicked a different row in the list is not a settings sheet. They
 * are behind that Sammlung's own ⋯ now; see templates/collection_sheet.ts and
 * docs/sammlung-settings.md.
 *
 * The voice split rather than moved, and the seam is worth knowing about: the
 * Azure key and the offer to fetch the offline voices are still here, because
 * a downloaded voice is installed for every Sammlung there is. What went is
 * the choosing. So this sheet answers "which voices does this machine have"
 * and the Sammlung's answers "which one does this one speak in" - which is
 * also why the round trip the proposal worried about does not exist: the key
 * and the list it stocks never came apart.
 *
 * There was a Device panel too, and it is gone rather than moved. Its build
 * half went to the Sammlung's ⋯ with the exports; its connect half turned out
 * to duplicate a step the transfer dialog already takes - release.ts offers
 * the chooser at the moment it finds it has no port, with the words about what
 * is about to be written already read, which is a better place to be asked
 * than a settings panel somebody has to know to visit first. What the panel
 * did was grant ahead of time, for a flow that grants on demand.
 *
 * Every section is a folded panel whose heading carries its state, so the whole
 * of what this installation is set to reads at a glance and opening one is a
 * decision.
 *
 * **One open at a time.** Every panel carries `name="settings"`, which is the
 * platform's own accordion: a named group of <details> behaves like a radio
 * group, so opening one closes the rest and no script is involved. Without it
 * a sheet of nine panels becomes a scroll through everything somebody has ever
 * opened, and the state lines in the headings - the whole reason the panels are
 * folded - stop being readable at a glance. conventions.md §3.5. That is the shape bildhaft and mitreden both settled on, and the
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
    <button id="voiceClose" class="btn quiet icon" type="button">✕</button>
  </div>
  <div class="body">

  <!-- First, and deliberately: somebody who cannot read the page needs this
       one before anything else. The options name themselves - see voices.ts.
       Open on arrival for the same reason. -->
  <details class="panel" name="settings" id="languagePanel" open>
    <summary>
      <span class="section" id="languageSection"></span>
      <span class="state" id="languageState"></span>
    </summary>
    <div class="setting">
      <!-- The same segmented control as the scheme below it, and that pairing
           is the point: two facts about this page, offered the same way. It was
           a button and a menu, which put the choice behind a press - a menu is
           for a list of things to do, and this is a list of what it already is.
           Not a select either: the open list of one is drawn by the operating
           system and so cannot follow the tokens.
           The accessible name is bilingual and fixed. It is the one label on
           this page that must not be translated, because somebody who cannot
           read the page is who reaches for it. -->
      <div class="segmented" id="langPick" role="group"
        aria-label="Sprache / Language"></div>
      <p class="note" id="languageNote"></p>
    </div>
  </details>

  <!-- Beside the language, because both are what this page is rather than what
       is on the board. Three answers and not a switch: "follows the OS" is an
       answer too, and the default one - a two-state toggle has to open in light
       or dark and so has to guess, which is how a tablet that dims itself at
       dusk ends up pinned bright.
       It says "in this browser, not on the device" because on this page that
       distinction is real - the Sammlung's own language further down does
       travel there - and this pair is where a reader learns which is which. -->
  <details class="panel" name="settings" id="themePanel">
    <summary>
      <span class="section" id="themeSection"></span>
      <span class="state" id="themeState"></span>
    </summary>
    <div class="setting">
      <!-- role=group, not radiogroup: components.css marks the choice with
           aria-pressed, which is the vocabulary bildhaft's print dialog already
           uses, and a radiogroup whose children are not radios reads worse than
           a labelled group of buttons. -->
      <div class="segmented" id="themePick" role="group"></div>
      <p class="note" id="themeNote"></p>
    </div>
  </details>

  <!-- Which voices this machine has - not which one anything speaks in.
       In the place the chooser used to hold, and deliberately: somebody who
       opens Einstellungen looking for "the voice" lands here, and the note
       inside says where the choosing moved to. The state line is the count,
       because "how many can speak here" is what this heading is asked.
       The offer to fetch the offline ones is in the body rather than in a
       panel of its own. A download installs a voice for every Sammlung there
       is, which is exactly what this heading claims to be about. -->
  <details class="panel" name="settings" id="voicesHerePanel">
    <summary>
      <span class="section" id="voicesHereSection"></span>
      <span class="state" id="voicesHereState"></span>
    </summary>
    <div class="setting">
      <p class="lead" id="voicesHereNote"></p>
      <!-- Present only when something is actually missing: a button offering
           to fetch nothing is worse than no button. -->
      <div class="voiceOffer" id="voiceOffer"></div>
      <!-- How far a download has got, or how it ended. In the body rather than
           the summary: a summary carries what a section IS, and this is the
           running commentary on an errand somebody just started. -->
      <div class="hint" id="voiceOfferHint"></div>
    </div>
  </details>

  <!-- Where the other voices come from, under the ones that are already here. -->
  <details class="panel" name="settings" id="azurePanel">
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
  <details class="panel" name="settings" id="arasaacPanel">
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

  <details class="panel" name="settings" id="symbolsPanel">
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
        <!-- .lbl and not <label for>: the control is a button now, and a button
             is not a labelable element - the association has to be
             aria-labelledby rather than "for", which would silently do nothing. -->
        <span class="lbl" id="renderingLabel"></span>
        <span class="menu-anchor start"><button id="renderingPick" class="btn quiet sm dropdown"
          type="button" aria-haspopup="menu" aria-expanded="false"
          aria-labelledby="renderingLabel"></button></span>
        <p class="note" id="renderingNote"></p>
      </div>
    </div>
  </details>

  <details class="panel" name="settings" id="boardPanel">
    <summary>
      <!-- No state line: this panel is two actions, and a heading that says
           nothing is furniture rather than a summary. -->
      <span class="section" id="boardSection"></span>
    </summary>
    <div class="setting">
      <p class="lead" id="boardNote"></p>
      <!-- Only the way in. Exporting is in the work head's ⋯, beside the
           Sammlung it would export - it acts on one particular Sammlung and
           this panel does not. -->
      <div class="row">
        <button id="boardImport" class="btn" type="button"></button>
      </div>
      <!-- What the last export or import did. In the body rather than the
           summary: a summary carries what a section IS set to, and this is
           the outcome of an errand somebody just ran. -->
      <p class="note" id="boardState"></p>
    </div>
  </details>

  <!-- Daten, which bildhaft and mitreden both already have and vorlaut did
       not. The board panel above it is a different act and stays: an .obz is
       a board in a format other programs read, this is the whole of what is
       in this browser, in a shape only vorlaut reads. store.ts has said since
       it was written that this was owed. -->
  <details class="panel" name="settings" id="dataPanel">
    <summary>
      <span class="section" id="dataSection"></span>
    </summary>
    <div class="setting">
      <p class="lead" id="dataNote"></p>

      <!-- The folder first, because it is the one that keeps working after
           somebody stops thinking about it. Hidden outright where the browser
           has no picker - Safari, Firefox, anything on Android - and then the
           two buttons below are the whole offer, unchanged. -->
      <div id="folderBox" class="folderbox">
        <p class="lead" id="folderLead"></p>
        <p class="standing" id="folderState"></p>
        <div class="row" id="folderActions"></div>
      </div>

      <div class="row">
        <button id="dataExport" class="btn" type="button"></button>
        <button id="dataImport" class="btn" type="button"></button>
        <input type="file" id="dataFile" accept="application/json,.json" hidden>
      </div>
      <p class="note" id="dataState"></p>
    </div>
  </details>

  </div>
</dialog>
`;

export function render(): void {
  mount(document.body, markup);
}
