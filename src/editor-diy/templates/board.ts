/* The five-key board. Structure only - editor.ts fills #tabs, #slots and
 * #device on every render.
 *
 * The log of what was sent used to be a <pre> at the foot of this, growing
 * under the work head while a transfer ran. It is inside the transfer sheet
 * now, with the rest of that flow - see src/editor-diy/release.ts.
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
`;

/* The one action that applies to the whole Sammlung, in the work head's slot
 * beside its name. It was in the page header, where the object it acts on had
 * to be inferred - which is exactly the inference that goes wrong on a page
 * that can switch Sammlung. conventions.md §3.3. */
export const action = `
<!-- The device preview, beside the button that sends: both are about this
     device, both are reached from the same row, and the row is short enough to
     hold them. -->
<label class="toggle" id="previewLabel">
  <input type="checkbox" id="previewToggle">
  <span class="pill"></span>
  <span id="previewText"></span>
</label>
<!-- The whole of what follows the press is in the sheet this opens, the way
     to stop it included: a stop button sitting in the work head is greyed out
     for the whole of the time nothing is running, and reads as a thing that
     is broken. -->
<button class="btn primary" id="releaseBtn" type="button"></button>
`;

export function render(where: HTMLElement, head: HTMLElement): void {
  mount(where, markup);
  mount(head, action);
}
