/* The tablet board. Structure only - editor.ts fills every one of these on
 * each render.
 *
 * Two areas, and the split between them is the one thing in this file worth
 * defending.
 *
 *   #appPath        where the editor is standing, as the way it got there
 *   #appPageMore    the way into that page's own card - name, start, delete
 *   #appPagesLost   how many pages nothing leads to, when any do
 *   #appPagePick    every page in the Sammlung, reachable or not
 *   #appPages       one row: the pages the page on screen opens
 *   #appGrid        the page on screen, as the grid it will be on the tablet
 *
 * There used to be a third. Everything about one button, and
 * everything about one page, is now a modal sheet opened by pressing the thing
 * itself - so nothing is left on the board that is not the board. The panel
 * could only ever hold what fits under the grid, which is what made the
 * eleven-column case a degradation of the three-column one; a sheet is the
 * same interaction at every size.
 *
 * **The bar holds the pages and nothing else.** The grid's size was in it, as
 * two number fields, and it did not belong: everything else up there is about
 * the *page*, and the size is one decision for every page in the Sammlung -
 * which is exactly what makes a button stay in the same place from one page to
 * the next. So it moved to where the Sammlung's own settings are, the menu
 * beside its name, and it is asked as pictures when the Sammlung is made. A
 * number field beside the tabs was also a place to mistype 1 for 11, and there
 * it costs buttons.
 *
 * **Depth is stated in the path and nowhere else.** The strip below it is one
 * flat list, and it stays one: a tree, a graph and a nested list were each
 * drawn and each rejected. A literal graph is dominated by the shared first
 * column, which is an edge from every page to the same two or three; and a
 * nested list reports MetaTalk's "Verben / Verben 2" overflow as a parent and
 * a child, when both are plain `goto` edges and neither is under the other.
 * The path carries how far in somebody is, and nothing else tries to.
 *
 * **Every page is reachable from this bar, including the ones nothing leads
 * to.** It is the editing-time way around, and it is not the graph: what leads
 * where is the buttons. A page nothing points at is exactly the page somebody
 * needs to reach in order to give it a way in, so hiding it would hide the
 * only thing that can be done about it. That promise is the picker's - it
 * lists every page and marks the ones nothing reaches - and it is a promise
 * rather than a convenience: it is the only control here that can open an
 * orphan at every width.
 *
 * The row shows them too, at its end, each wearing the same ⚠. Without that
 * the row was empty on every Sammlung nobody had linked yet, which is the
 * state a board is in for the whole of its first sitting - a control that is
 * blank exactly while somebody is doing the work it is for. The mark is the
 * only difference between those tiles and the rest, because the row already
 * has an orange count at the far end of the bar saying how many there are.
 *
 * **The count is on the picker, and the warning sits immediately before it.**
 * The picker is pinned to the right edge of the bar and the warning grows
 * leftward out of it, so a Sammlung that gains or loses an orphan does not
 * move the control somebody was about to press - the rule the page's own ...
 * was given when it stopped reflowing the strip it sat in.
 *
 * **The row replaces itself; it never grows a second one.** It shows the pages
 * the page on screen opens, and pressing one makes that page current, at which
 * point the row is what *that* page opens. Its height is two rows' worth and
 * reserved, so the board's top edge does not move as somebody walks the graph
 * - which is what the wrapping strip could not promise, since it grew downward
 * into the board by however many rows the page count needed.
 *
 * **Selecting a navigation button does not follow it.** In editor-diy a set
 * tab both selects and switches, because there is one axis and no ambiguity.
 * Here there are two: a `goto` button is a thing you edit *and* a way to
 * somewhere else. If pressing it navigated, it would be the one button on the
 * board nobody could ever change. So the press opens the button's sheet, and
 * the way to the page it leads to is the row, which holds exactly the pages
 * this page's buttons lead to.
 *
 * It mounts into #editor, which is the hole shell/templates/frame.ts leaves -
 * the shell lays out a page, an editor fills the middle of it.
 */
import { mount } from "../../shell/templates/mount.js";

export const markup = `
<div class="appbar">
  <div class="pagepath" id="appPath"></div>
  <button class="crumb__more" id="appPageMore" type="button"></button>
  <div class="appbar__right">
    <button class="pagelost" id="appPagesLost" type="button" hidden></button>
    <span class="menu-anchor" id="appPagePickAt">
      <button class="btn quiet sm dropdown" id="appPagePick" type="button"></button>
    </span>
    <button id="appPageNew" class="btn quiet sm" type="button"></button>
  </div>
</div>

<div class="pagerow" id="appPages"></div>

<div class="grid" id="appGrid"></div>
`;

/* The one action that applies to the whole Sammlung, in the work head's slot
 * beside its name - conventions.md §3.3.
 *
 * For the talker that slot holds the transfer, because getting it onto the
 * device is what finishing means there. A tablet has no cable, so finishing is
 * the package: it is the same act at the same point in the same sentence, and
 * it belongs in the same place. shell/collections.ts therefore leaves it out
 * of the ⋯ on an app Sammlung rather than offering both. */
export const action = `
<button class="btn primary" id="appExport" type="button"></button>
`;

export function render(where: HTMLElement, head: HTMLElement): void {
  mount(where, markup);
  mount(head, action);
}
