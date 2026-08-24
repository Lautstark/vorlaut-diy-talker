/* The page under the header: the Sammlungen down the side, and the one being
 * worked on in the middle.
 *
 * The sidebar is bildhaft's frame, which the family agreed to follow: what you
 * have made on the left, what you are making in the centre. Its rows carry the
 * name and how much is in it, and nothing else. The two quiet buttons at the
 * foot are the pair bildhaft puts there - settings, and the way something gets
 * in from outside.
 *
 * The work head is the row above the editor: the name, the count, the one
 * action that applies to the whole Sammlung, and the ⋯. Everything in it acts
 * on exactly the Sammlung that is open, which is why it is here and not in the
 * page header - in a list of five, a button in the bar can never say which one
 * it means. `#collectionAction` is a slot the editor fills; for the five-key
 * talker that is the button which builds and sends down the cable.
 *
 * What is left over is the shell's and belongs to no device: the save conflict,
 * which is about two tabs writing to one store, and the two hidden file inputs
 * that let picker.ts and settings.ts open a file dialog without a visible
 * control. src/editor-diy/templates/board.ts mounts into #editor.
 */
import { mount } from "./mount.js";

export const markup = `
<div class="frame">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar__head">
      <h2 class="sidebar__title" id="collectionsHeading"></h2>
      <button id="sidebarHide" class="btn quiet icon" type="button">&lsaquo;</button>
    </div>
    <!-- Filled by shell/collections.ts on every change to the list. -->
    <nav class="sidebar__list" id="collectionList"></nav>
    <button id="collectionNew" class="btn quiet sm" type="button"></button>
    <div class="sidebar__foot">
      <button id="settingsLink" class="btn quiet sm" type="button"></button>
      <button id="importLink" class="btn quiet sm" type="button"></button>
    </div>
  </aside>

  <!-- What brings the column back once it is put away. It floats where the
       sidebar was, which is where bildhaft and mitreden both put it. -->
  <button id="sidebarShow" class="btn quiet icon reveal" type="button" hidden>&rsaquo;</button>

  <main>
    <div class="conflict" id="conflict">
      <span id="conflictText"></span>
      <button id="overwriteBtn" class="btn" type="button"></button>
      <button id="reloadBtn" class="btn" type="button"></button>
    </div>

    <div class="workhead">
      <!-- The name IS the field that renames it - bildhaft's title input. No
           dialog and no menu entry: renaming a thing you are looking at should
           be typing over its name. -->
      <input type="text" id="collectionName" class="title-input" autocomplete="off">
      <span class="count" id="collectionCount"></span>
      <span class="tools" id="collectionAction"></span>
      <span class="menu-anchor"><button id="collectionMenu" class="btn quiet icon"
        type="button" aria-haspopup="menu" aria-expanded="false">⋯</button></span>
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
