/* The one question this page asks before it destroys something.
 *
 * A <dialog> rather than window.confirm(), and the difference is not cosmetic.
 * A native confirm cannot say how much is about to go, cannot name its buttons
 * after what they do, and draws itself in the operating system's colours -
 * which is the same argument that took the <select>s off this page. bildhaft
 * asks this way and vorlaut agreed to follow it.
 *
 * Two rules the wiring in confirm.ts keeps, both of them learned the hard way
 * on this repository: the button says what will happen ("Delete 3 sets"), not
 * "OK"; and closing the dialog without answering does nothing at all.
 */
import { mount } from "./mount.js";

export const markup = `
<dialog id="confirm" class="sheet">
  <div class="head">
    <strong id="confirmTitle"></strong>
  </div>
  <div class="body">
    <p id="confirmText"></p>
  </div>
  <div class="foot">
    <button id="confirmNo" class="btn quiet" type="button"></button>
    <button id="confirmYes" class="btn destructive" type="button"></button>
  </div>
</dialog>
`;

export function render(): void {
  mount(document.body, markup);
}
