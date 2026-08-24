/* The page under the header: the list of boards down the side, and the space
 * an editor draws into.
 *
 * This is what src/ui/templates/board.ts used to be, minus the board. What is
 * left here belongs to no device: the save conflict, which is about two tabs
 * writing to one store; the two hidden file inputs, which are how picker.ts
 * and settings.ts open a file dialog without a visible control; and #editor,
 * which is a hole. src/editor-diy/templates/board.ts mounts the tabs, the
 * tiles and the build log into it.
 *
 * The sidebar is bildhaft's frame, which is what vorlaut agreed to follow: a
 * list of the things you have made down the left, the one you are working on
 * in the middle. Its rows carry the name and nothing else - no set count -
 * because a number there is a fact about the board's insides at a moment when
 * the question is only which board this is.
 *
 * The two buttons at the foot of it are the pair bildhaft puts there:
 * settings, and the way something gets in from outside. Everything that acts
 * on *the open board* is in the header instead, next to its name, because in
 * a list of five boards a button can never say which one it means.
 */
import { mount } from "./mount.js";

export const markup = `
<div class="frame">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar__head">
      <h2 class="sidebar__title" id="boardsHeading"></h2>
      <button id="boardNew" class="btn quiet sm" type="button"></button>
    </div>
    <!-- Filled by shell/boards.ts on every change to the list. A <nav> with a
         list inside it, so that a screen reader can be told how many boards
         there are and skip them; the rows are buttons, because switching board
         is an action on this page rather than a link to another document. -->
    <nav class="sidebar__list" id="boardList"></nav>
    <div class="sidebar__foot">
      <button id="settingsLink" class="btn quiet sm" type="button"></button>
      <button id="importLink" class="btn quiet sm" type="button"></button>
    </div>
  </aside>

  <main>
    <div class="conflict" id="conflict">
      <span id="conflictText"></span>
      <button id="overwriteBtn" class="btn" type="button"></button>
      <button id="reloadBtn" class="btn" type="button"></button>
    </div>

    <div id="editor"></div>

    <input type="file" id="fileInput" accept="image/*" hidden>
    <input type="file" id="boardFile" accept=".obf,.obz,application/zip" hidden>
  </main>
</div>
`;

export function render(): void {
  mount(document.body, markup);
}
