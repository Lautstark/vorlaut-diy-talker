/* The symbol picker. Markup beside picker.ts, which is the only module that
 * touches any of it. */
import { mount } from "./mount.js";

export const markup = `
<dialog id="picker">
  <div class="dlgHead">
    <input type="text" id="q">
    <button id="searchBtn"></button>
    <button id="uploadBtn"></button>
    <button id="closeBtn"></button>
  </div>
  <div class="results" id="results"></div>
  <div class="hint" id="credits"></div>
</dialog>
`;

export function render(): void {
  mount(document.body, markup);
}
