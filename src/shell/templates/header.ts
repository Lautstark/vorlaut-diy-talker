/* The bar across the top: the logo, the wordmark, the status line, whatever
 * the editor puts in it, and the gear.
 *
 * What is deliberately not here is anything that acts on the Sammlung being
 * edited - its name, its count, its ⋯ and the button that sends it to the
 * device are all in the work head, beside the thing they act on. A page that
 * can switch Sammlung cannot afford an action in the bar whose object has to
 * be inferred. It belongs to no one feature - app.ts is what wires it - which is
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
  <!-- role="status" is aria-live="polite". It belongs on the element rather
       than being set when there is something to say: a live region has to be
       in the accessibility tree already when the text lands, or the reader has
       nothing to notice a change in. This one is never hidden and never
       replaced, so it qualifies as it stands - what was missing was the role,
       and without it every "saved", "released" and failure here was silent. -->
  <span class="status" id="status" role="status"></span>
  <!-- Whatever the editor in force puts here. For the five-key talker that is
       the device preview, and only that: the action that puts a Sammlung on
       the talker is in the work head beside the Sammlung it acts on. -->
  <span class="tools" id="editorTools"></span>
  <!-- Last, past everything. The gear is the way out of this page rather than
       a thing to do on it, and it sat second - between the name and the
       status - where it read as the first of the actions. -->
  <button id="gear" class="btn quiet icon gear" type="button">⚙</button>
</header>
`;

export function render(): void {
  mount(document.body, markup);
}
