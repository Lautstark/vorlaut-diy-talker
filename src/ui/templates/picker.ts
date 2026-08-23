/* The symbol picker. Markup beside picker.ts, which is the only module that
 * touches any of it. */
import { mount } from "./mount.js";

export const markup = `
<dialog id="picker">
  <div class="dlgHead">
    <input type="text" id="q" class="field">
    <button id="searchBtn" class="btn" type="button"></button>
    <button id="uploadBtn" class="btn" type="button"></button>
    <button id="closeBtn" class="btn" type="button"></button>
  </div>
  <div class="results" id="results"></div>
  <div class="hint" id="credits"></div>
</dialog>
`;

export function render(): void {
  mount(document.body, markup);
}
