/* The bar across the top: the logo, the gear, the status line, the preview
 * toggle and Release. It belongs to no one feature - main.ts is what wires it -
 * which is exactly why it is worth having its own file rather than being the
 * part of index.html nobody could name an owner for. */
import { mount } from "./mount.js";

/* The logo lives in public/, so Vite copies it verbatim and does not rewrite
 * references to it that sit inside a template string the way it would inside
 * index.html. BASE_URL is what the build's `base` resolves to - "/" while
 * developing and "/vorlaut/" once published - so this is the same rewriting
 * done by hand, in the one place the bundler cannot reach. */
const logo = `${import.meta.env.BASE_URL}icon.svg`;

export const markup = `
<header>
  <img src="${logo}" alt="" class="logo">
  <h1>vorlaut</h1>
  <!-- role="status" is aria-live="polite". It belongs on the element rather
       than being set when there is something to say: a live region has to be
       in the accessibility tree already when the text lands, or the reader has
       nothing to notice a change in. This one is never hidden and never
       replaced, so it qualifies as it stands - what was missing was the role,
       and without it every "saved", "released" and failure here was silent. -->
  <span class="status" id="status" role="status"></span>
  <label class="toggle" id="previewLabel">
    <input type="checkbox" id="previewToggle">
    <span class="pill"></span>
    <span id="previewText"></span>
  </label>
  <button class="btn primary" id="releaseBtn" type="button"></button>
  <!-- Only while something is going down the cable. Hidden rather than
       disabled: a stop that is there but greyed out most of the time reads as
       a thing that is broken, and there is genuinely nothing to stop until a
       transfer is running. -->
  <button class="btn quiet" id="releaseStop" type="button" hidden></button>
  <!-- Last, past Release. The gear is the way out of this page rather than a
       thing to do on it, and it sat second - between the name and the status -
       where it read as the first of the actions. -->
  <button id="gear" class="btn quiet icon gear" type="button">⚙</button>
</header>
`;

export function render(): void {
  mount(document.body, markup);
}
