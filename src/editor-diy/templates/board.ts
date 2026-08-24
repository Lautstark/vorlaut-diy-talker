/* The five-key board, and the log of what was sent to it. Structure only -
 * editor.ts fills #tabs, #slots and #device on every render.
 *
 * It mounts into #editor rather than into the document, which is the seam in
 * markup: the shell lays out a page with a hole in it, an editor fills the
 * hole. Everything that used to sit beside these in one <main> and is not
 * about this device - the save conflict, the two file inputs - stayed behind
 * in shell/templates/frame.ts.
 */
import { mount } from "../../shell/templates/mount.js";

export const markup = `
<div class="tabs" id="tabs"></div>
<div class="slots" id="slots"></div>
<div class="device" id="device"></div>

<button id="removeSet" class="btn destructive" type="button"></button>
<pre class="log" id="log"></pre>
`;

/* The header's slot for the two controls that are this device's rather than
 * the page's: the preview switch, which shows a tile at the 15.21 mm the
 * ScreenKeys actually have, and Release with the stop beside it.
 *
 * They were written into shell/templates/header.ts, which meant the shared bar
 * across the top carried a button about a cable. The header keeps a named
 * empty span and the editor fills it, so a page with a different editor on it
 * gets that editor's controls there and no leftovers.
 */
export const tools = `
<label class="toggle" id="previewLabel">
  <input type="checkbox" id="previewToggle">
  <span class="pill"></span>
  <span id="previewText"></span>
</label>
<button class="btn primary" id="releaseBtn" type="button"></button>
<!-- Only while something is going down the cable. Hidden rather than
     disabled: a stop that is there but greyed out most of the time reads as
     a thing that is broken, and there is genuinely nothing to stop until a
     transfer is running. -->
<button class="btn quiet" id="releaseStop" type="button" hidden></button>
`;

export function render(where: HTMLElement, toolbar: HTMLElement): void {
  mount(where, markup);
  mount(toolbar, tools);
}
