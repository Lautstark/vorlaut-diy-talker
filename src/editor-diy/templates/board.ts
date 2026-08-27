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

/* Nothing in the work head's action slot, and this is the second half of a
 * note editor-app's board.ts already carries.
 *
 * It held two things and then one. The button that sent to the talker went
 * with the device path (adr/0011); the preview toggle - draw the keys the way
 * the hardware will show them - went to the loader page with the picture it
 * drew (adr/0013), where it is not a toggle at all but the compiled tiles,
 * shown after a compile. What is left is a slot with nothing in it on either
 * editor, which is worth saying out loud rather than leaving as an absence:
 * conventions.md §3.3 is about where an act on the open Sammlung belongs, and
 * both editors' whole-Sammlung acts are in the ⋯ beside the name now.
 *
 * An empty string rather than removing the slot, for editor-app's reason: the
 * shell mounts something into the head for whichever editor is installed, and
 * the next control this device grows has a place to go. */
export const action = "";

export function render(where: HTMLElement, head: HTMLElement): void {
  mount(where, markup);
  mount(head, action);
}
