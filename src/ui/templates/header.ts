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
  <button id="gear" class="btn quiet icon gear" type="button">⚙</button>
  <span class="status" id="status"></span>
  <label class="toggle" id="previewLabel">
    <input type="checkbox" id="previewToggle">
    <span class="pill"></span>
    <span id="previewText"></span>
  </label>
  <button class="btn primary" id="releaseBtn" type="button"></button>
</header>
`;

export function render(): void {
  mount(document.body, markup);
}
