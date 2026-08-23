/* The board itself, and the two panels that appear over it: the save conflict
 * and the pairing prompt. Structure only - editor.ts fills #tabs, #slots and
 * #device on every render, and the two file inputs are how picker.ts and
 * settings.ts open a file dialog without a visible control. */
import { mount } from "./mount.js";

export const markup = `
<main>
  <div class="conflict" id="conflict">
    <span id="conflictText"></span>
    <button id="overwriteBtn" class="btn" type="button"></button>
    <button id="reloadBtn" class="btn" type="button"></button>
  </div>
  <div class="pairing" id="pairing">
    <div class="pairHead">
      <strong id="pairTitle"></strong>
      <span class="note" id="pairNote"></span>
    </div>
    <div class="pairKeys" id="pairKeys"></div>
    <div class="pairFoot">
      <button class="btn primary" id="pairConfirm" type="button"></button>
      <span class="note" id="pairError"></span>
    </div>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="slots" id="slots"></div>
  <div class="device" id="device"></div>

  <button id="removeSet" class="btn destructive" type="button"></button>
  <pre class="log" id="log"></pre>
<input type="file" id="fileInput" accept="image/*" hidden>
<input type="file" id="boardFile" accept=".obf,.obz,application/zip" hidden>
</main>
`;

export function render(): void {
  mount(document.body, markup);
}
