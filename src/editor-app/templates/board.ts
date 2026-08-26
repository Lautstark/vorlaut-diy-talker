/* The tablet board. Structure only - editor.ts fills every one of these on
 * each render.
 *
 *   #appPageHome    a house, and only on the page that is the start page
 *   #appPageName    the page's name, as the field that renames it
 *   #appPageWarn    the ⚠, where nothing leads to this page
 *   #appPageStart   "zur Startseite machen", and only where it would do something
 *   #appPageDelete  the one act left that needs a word
 *   #appFacts       one line: what leads here, where it leads, what it costs
 *   #appFactLinks   what the open number says, under the line
 *   #appGrid        the page on screen, as the grid it will be on the tablet
 *
 * ## What used to be here, and why none of it is
 *
 * A path, a row of page tiles, a picker and a count. Between them they tried to
 * answer four questions in the strip over the board, and the strip is the wrong
 * place for three of them.
 *
 * **Which pages exist, and getting to one, is the sidebar's.** A list down the
 * side may scroll; a strip across the top may not, which is why every drawing
 * of it had to hide something - fold it, pick a level, choose one parent. Forty
 * pages are nothing to a column and impossible for a bar. The list hangs under
 * the open Sammlung and is drawn by shell/collections.ts, from what
 * editor-app/editor.ts hands it.
 *
 * **Where a page leads is the board's.** A `goto` button already says so - it
 * is a button with the page's name on it, two centimetres below where the row
 * of tiles used to repeat it. It carries a corner that follows the link, so
 * pressing the button still opens the button.
 *
 * **The path went because it could not be truthful.** `route()` takes the
 * shortest chain, so on a graph where two pages lead to a third it showed one
 * of them as though it were the way there. What a breadcrumb is really for is
 * "how do I get back", and that has an exact answer - every page that leads
 * here - which is now the first number on the facts line.
 *
 * What is left over the board is the page itself and one line about it.
 *
 * **The whole-Sammlung act moved into the ⋯ beside the name.** It sat here, as
 * a filled accent button, because the talker's cable transfer sits in that slot
 * and the tablet's package is the same act at the same point in the same
 * sentence. That symmetry is given up deliberately: the button was the loudest
 * thing on the page for something pressed once a sitting. shell/collections.ts
 * carries the entry now, and the comment there says the same.
 *
 * **Selecting a navigation button does not follow it.** In editor-diy a set tab
 * both selects and switches, because there is one axis and no ambiguity. Here
 * there are two: a `goto` button is a thing you edit *and* a way somewhere. If
 * pressing it navigated, it would be the one button on the board nobody could
 * ever change - so the press opens the button's sheet and the corner follows.
 *
 * It mounts into #editor, which is the hole shell/templates/frame.ts leaves -
 * the shell lays out a page, an editor fills the middle of it.
 */
import { mount } from "../../shell/templates/mount.js";

export const markup = `
<div class="pagehead">
  <span class="pagehead__home" id="appPageHome" hidden></span>
  <input type="text" id="appPageName" class="pagehead__name" autocomplete="off">
  <span class="pagehead__warn" id="appPageWarn" hidden></span>
  <button class="pagehead__act" id="appPageStart" type="button" hidden></button>
  <button class="pagehead__del" id="appPageDelete" type="button"></button>
</div>

<div class="facts" id="appFacts"></div>
<div class="factlinks" id="appFactLinks" hidden></div>

<div class="grid" id="appGrid"></div>
`;
/* Nothing. The work head's action slot is the talker's transfer button, and
 * the tablet's package used to sit in it for the symmetry - the same act at the
 * same point in the same sentence, conventions.md §3.3.
 *
 * That is given up on purpose. A filled accent button is the loudest thing on
 * the page, and the package is pressed once a sitting; it is an entry in the ⋯
 * beside the Sammlung's name now, where the talker's two exports already are.
 * The symmetry §3.3 describes is therefore broken on the tablet half only, and
 * shell/collections.ts carries the other half of this note.
 *
 * An empty string rather than removing the slot: the shell mounts something
 * into the head for whichever editor is installed, and a talker Sammlung
 * opened after a tablet one has to be able to put its button back. */
export const action = "";
export function render(where: HTMLElement, head: HTMLElement): void {
  mount(where, markup);
  mount(head, action);
}
