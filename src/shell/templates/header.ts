/* The bar across the top: the logo, the name of the board being edited, the
 * status line, whatever controls the editor puts in it, the board menu and the
 * gear. It belongs to no one feature - app.ts is what wires it - which is
 * exactly why it is worth having its own file rather than being the part of
 * index.html nobody could name an owner for. */
import { mount } from "./mount.js";

/* The logo lives in public/, so Vite copies it verbatim and does not rewrite
 * references to it that sit inside a template string the way it would inside
 * index.html. BASE_URL is what the build's `base` resolves to - "/" while
 * developing and "/vorlaut-diy-talker/" once published - so this is the same rewriting
 * done by hand, in the one place the bundler cannot reach. */
const logo = `${import.meta.env.BASE_URL}icon.svg`;

export const markup = `
<header>
  <img src="${logo}" alt="" class="logo">
  <h1>vorlaut</h1>
  <!-- The board's name IS the field that renames it - bildhaft's title input.
       No dialog and no menu entry: renaming a thing you are looking at should
       be typing over its name. Debounced while typing and written again when
       the field is left, the same way every other edit on this page saves. -->
  <input type="text" id="boardName" class="title-input" autocomplete="off">
  <!-- role="status" is aria-live="polite". It belongs on the element rather
       than being set when there is something to say: a live region has to be
       in the accessibility tree already when the text lands, or the reader has
       nothing to notice a change in. This one is never hidden and never
       replaced, so it qualifies as it stands - what was missing was the role,
       and without it every "saved", "released" and failure here was silent. -->
  <span class="status" id="status" role="status"></span>
  <!-- Whatever the editor in force puts here. For the five-key talker that is
       the device preview and Release; see editor-diy/templates/board.ts. The
       span is named and empty, so the header can be read without knowing which
       editor is mounted. -->
  <span class="tools" id="editorTools"></span>
  <!-- What can be done to the board that is open, and only that board. It is
       here rather than in the sidebar because a button in a list of five
       boards can never say which one it means. -->
  <span class="menu-anchor"><button id="boardMenu" class="btn quiet icon" type="button"
    aria-haspopup="menu" aria-expanded="false">⋯</button></span>
  <!-- Last, past everything. The gear is the way out of this page rather than
       a thing to do on it, and it sat second - between the name and the
       status - where it read as the first of the actions. -->
  <button id="gear" class="btn quiet icon gear" type="button">⚙</button>
</header>
`;

export function render(): void {
  mount(document.body, markup);
}
