/* The whole page: the Sammlungen down the side, and the one being worked on in
 * the middle.
 *
 * **There is no header on a desktop.** That is not an omission - it is what
 * both siblings do, and this page had invented a third answer. bildhaft's
 * `.topbar` is `display: none` until the mobile breakpoint and mitreden's the
 * same; on a desktop the mark lives at the top of the sidebar, beside the
 * control that puts the sidebar away, and there is nothing spanning the window.
 * A bar that carries a mark, a toggle and a gear is a bar that costs vertical
 * room on every screen to hold three things that already have homes.
 *
 * Below 820px there *is* a bar, and it is the same bar the other two have,
 * because down there the sidebar is a layer over the work rather than a column
 * beside it and something has to open it. conventions.md §3.1.
 *
 * So: the mark and the collapse are the sidebar's brand row, Einstellungen is
 * the sidebar's foot - one entrance, design.md §3.4 - and everything that acts
 * on the open Sammlung is the work head above the editor.
 *
 * The work head is `name · status · what the editor puts there · ⋯`, and it
 * spans the content column rather than sitting inside the capped one: with no
 * bar above it, it is the top of the page and reads better as a full-width
 * band than as a short row floating over the middle. The count is not in it -
 * the sidebar row already carries one per Sammlung, and a second copy of the
 * same number beside the name it belongs to is a number to keep in step for no
 * reading anybody does. `#collectionAction` is the editor's slot: for the
 * five-key talker, the device preview and the cable.
 *
 * What is left over belongs to no device: the save conflict, which is about two
 * tabs writing to one store, and the two hidden file inputs that let picker.ts
 * and settings.ts open a file dialog without a visible control.
 * src/editor-diy/templates/board.ts mounts into #editor.
 */
import { mount } from "./mount.js";

/* The logo lives in public/, so Vite copies it verbatim and does not rewrite
 * references to it that sit inside a template string the way it would inside
 * index.html. BASE_URL is what the build's `base` resolves to - "/" while
 * developing and "/vorlaut-diy-talker/" once published - so this is the same
 * rewriting done by hand, in the one place the bundler cannot reach. */
const logo = `${import.meta.env.BASE_URL}icon.svg`;

export const markup = `
<!-- Narrow screens get a bar instead of a column: the sidebar slides over the
     work rather than sitting above it, and the scrim closes it. Both siblings
     have exactly this, at exactly this width. -->
<div class="topbar">
  <button id="sidebarOpenBtn" class="btn quiet icon" type="button">&#9776;</button>
  <h1><img src="${logo}" alt="" class="logo">vorlaut</h1>
</div>
<div class="scrim" id="scrim" hidden></div>

<div class="frame">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar__brand">
      <h1><img src="${logo}" alt="" class="logo">vorlaut</h1>
      <!-- Two controls, because they answer two different questions: on a phone
           the sidebar is a layer over the work and ✕ dismisses it; on a desktop
           it is a column of the page and ‹ puts the column away for good. Each
           is hidden at the width where its question is not being asked. -->
      <button id="sidebarHide" class="btn quiet icon" type="button">&lsaquo;</button>
      <button id="sidebarClose" class="btn quiet icon" type="button">&#10005;</button>
    </div>

    <div class="sidebar__part sidebar__grow">
      <h2 id="collectionsHeading"></h2>
      <!-- Filled by shell/collections.ts on every change to the list. -->
      <nav class="collections sidebar__list" id="collectionList"></nav>
      <button id="collectionNew" class="btn quiet sm" type="button"></button>
    </div>

    <!-- One entrance, and only it. Importing lives inside the sheet, beside the
         prose that says what the format is: the sidebar holds the list, the way
         to make one, and the way out of the page. -->
    <div class="sidebar__foot">
      <button id="settingsLink" class="btn quiet sm" type="button"></button>
    </div>
  </aside>

  <!-- What brings the column back once it is put away. It floats where the
       sidebar was, carrying the mark, which is where both siblings put it and
       where the eye is already looking. -->
  <div class="reveal" id="sidebarShow" hidden>
    <button id="sidebarShowBtn" class="btn quiet icon" type="button">&rsaquo;</button>
    <img src="${logo}" alt="" class="logo logo--small">
  </div>

  <div class="content">
    <!-- Across the whole content column rather than inside the capped one, so
         it reads as the top of the page - which, with no bar above it, is what
         it is. The board below stays capped and centred; this is furniture and
         wants the width. -->
    <div class="workhead">
      <!-- The name IS the field that renames it - bildhaft's title input. No
           dialog and no menu entry: renaming a thing you are looking at should
           be typing over its name. -->
      <input type="text" id="collectionName" class="title-input" autocomplete="off">
      <!-- role="status" is aria-live="polite", and it belongs on the element
           rather than being set when there is something to say: a live region
           has to be in the accessibility tree already when the text lands, or
           the reader has nothing to notice a change in. -->
      <span class="status" id="status" role="status"></span>
      <span class="tools" id="collectionAction"></span>
      <span class="menu-anchor"><button id="collectionMenu" class="btn quiet icon"
        type="button" aria-haspopup="menu" aria-expanded="false">⋯</button></span>
    </div>

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
</div>
`;

export function render(): void {
  mount(document.body, markup);
}
