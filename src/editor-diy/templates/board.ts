/* The five-key board. Structure only - editor.ts fills #tabs, #slots and
 * #device on every render.
 *
 * Three elements, and there used to be a fourth: a red button under the board
 * that deleted the set. It is in the set's own card now, at the foot where
 * every other destructive act in this product sits, which is what took the
 * last thing off this board that was not the board. What is left is the tabs,
 * a line saying how full the device is, and the grid.
 *
 * #device is the grid rather than a row of tiles now, and editor.ts's CELLS is
 * where the six places in it are written down.
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

/* --cols and --rows are written here rather than by render(): unlike the
 * tablet's, this grid is not a setting - it is the shape of the hardware, and
 * a board that could be a different size is not this device. */
export const markup = `
<div class="tabs" id="tabs"></div>
<div class="slots" id="slots"></div>
<div class="grid" id="device" style="--cols:3; --rows:2"></div>
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
