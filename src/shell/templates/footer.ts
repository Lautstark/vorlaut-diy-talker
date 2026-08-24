/* The three links every page of a German site has to carry, and the two that
 * say where this one comes from.
 *
 * It is a template of its own rather than a line at the foot of board.ts for
 * the reason the header is: it belongs to no feature. The board is the thing
 * being edited; this is the page saying who publishes it, which is a different
 * kind of statement and outlives any particular board.
 *
 * Buttons rather than anchors for the first three: what they open is a dialog
 * in this page, not another document, and a link that goes nowhere is a link
 * that offers a new tab and a copied address that lead somewhere else. The
 * labels arrive from the text table like every other label - see legal.ts for
 * why two of them are the same word in both languages.
 */
import { mount } from "./mount.js";

export const markup = `
<footer class="footer">
  <button class="linklike" id="aboutLink" type="button"></button>
  <!-- Both of these are required to be reachable from every screen AND to be
       called exactly this. "Kontakt", or a paragraph inside the about dialog,
       would not count as either. -->
  <button class="linklike" id="impressumLink" type="button"></button>
  <button class="linklike" id="privacyLink" type="button"></button>
  <a id="sourceLink" target="_blank" rel="noreferrer noopener"></a>
</footer>
`;

/** Into the middle column, under the work, which is where both siblings put
 *  theirs. It was a sibling of the frame - a band across the whole window,
 *  under the sidebar as well as under the board - which is a shape neither of
 *  them has. */
export function render(where: HTMLElement): void {
  mount(where, markup);
}
