/* The sheet behind the ⋯ beside a Sammlung's name: what is true of *this*
 * Sammlung and travels with it.
 *
 * Two of the panels in here were in the settings sheet at the foot of the
 * sidebar, among the Azure key and the METACOM folder, and both were the wrong
 * thing to find there. Everything else on that sheet answers "what is this
 * browser, or this installation, set to"; those two answer "which Sammlung is
 * open" - so opening a different one and reopening Einstellungen showed a
 * different answer in the same place, which is not what a setting is.
 * docs/sammlung-settings.md is the argument in full. The third came the other
 * way, from an entry of its own in the same ⋯: two doors to "what is this
 * Sammlung set to" was one too many.
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
 * carries no usable tag. So the talker gets it and the tablet does not.
 *
 * The editor's own panel, in the place that language holds on a talker: for
 * the tablet that is the grid - how big a page is, how a word class is worn,
 * what the first column is - and it is the tablet's alone in the same way. The
 * body is empty here and filled by whichever editor is on screen, because
 * counting what would fall outside a smaller grid is editor-app/pages.ts's
 * work and the shell may not import it (tests/unit/layers.test.ts). voices.ts
 * has the hook and the argument; the talker registers nothing today, and a
 * panel nobody filled is hidden rather than drawn empty.
 *
 * ## The shape
 *
 * §3.5's folded panels, one open at a time through `name="collection"` - the
 * platform's own accordion, the same as the settings sheet uses, and for the
 * same reason: a heading that states its state is only readable at a glance
 * while the sheet is not a scroll through everything ever opened.
 *
 * No Save and no Cancel *on the sheet*, like the settings sheet: a language
 * and a voice apply when they are touched, because neither destroys anything.
 *
 * The grid does destroy something - it throws buttons away when it shrinks -
 * so it keeps a button of its own, inside its panel, that names what the press
 * costs while the choice is still being made. That is the same exception the
 * settings sheet already carries one panel further along: an Azure key must
 * not be written on every keystroke, so its Save is in the panel too. A sheet
 * of panels with two rules in it is what those two facts add up to; the wrong
 * repair would be a Save on the dialog, which would make the two live panels
 * lie about when they take effect.
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

  <!-- What the editor on screen has to say about the Sammlung as a whole: on
       a tablet the grid, which is that target's in the way the language above
       is the talker's. Empty and hidden until an editor fills it - see
       collectionSheetPanel() in shell/voices.ts. Before the voice, so that
       both targets read the same way: the one panel that is this target's,
       then the one both of them have. -->
  <details class="panel" name="collection" id="collectionEditorPanel" hidden>
    <summary>
      <span class="section" id="collectionEditorSection"></span>
      <span class="state" id="collectionEditorState"></span>
    </summary>
    <!-- .setting for the padding every other panel body has; what goes in it
         is the editor's, down to the button that applies it. -->
    <div class="setting" id="collectionEditorBody"></div>
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
