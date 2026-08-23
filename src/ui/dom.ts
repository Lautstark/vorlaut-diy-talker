// The two things every module reaches for: an element and the status line.
//
// api() used to be the third. It was a request to app.py, and it went with
// app.py: keeping a fetch helper here would have left one door into the
// network standing open beside the one the seam provides, which is the
// arrangement the seam exists to end. Nothing under static/ has a URL to give
// it any more except the ARASAAC download in backend/local.js.
/** An element that has to be there, by id.
 *
 * Throws rather than answering null, and that is the whole of the change from
 * the JavaScript this was: every caller here is asking for something the page's
 * own templates put in the document, so a null is not a case to handle - it is
 * a template and a module that have drifted apart. Returning null made each of
 * roughly two hundred call sites carry a branch for a state that means the page
 * is already broken; throwing puts the complaint at the one place that can name
 * which id is missing.
 *
 * The type parameter is how a caller says which element it expects. It is an
 * assertion rather than a check - nothing verifies at runtime that #q really is
 * an input - so it is exactly as true as the template beside it, which is what
 * `document.getElementById` offered anyway.
 */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the page has no #${id}`);
  return found as T;
};

/* The line in the header, and the one place this page reports anything. The
   element carries role="status" - see templates/header.ts - so writing to it
   is also announcing it, which it was not before. */
export const status = (text: string): void => { $("status").textContent = text; };

/* ------------------------------------------------------------------ menus ---
 *
 * A button that opens a list, replacing the native <select> this page used for
 * the language and for METACOM's renderings.
 *
 * Why they went: a select's open list is drawn by the operating system, so it
 * is the one control on the page that cannot follow the tokens. That was
 * survivable while vorlaut committed to a dark ground; it stopped being when
 * the scheme became a choice, because the tokens now set color-scheme per
 * theme and the OS list follows the OS instead. mitreden retired its last
 * select for exactly this reason and said so in the margin.
 *
 * The shape is mitreden's, and .menu, .menu-anchor and .dropdown are all
 * components.css's - the trigger moved into the shared layer at v1.7.0 on this
 * page's account. Nothing here draws anything.
 */
/**
 * What an item is besides its label. All three optional, because the common
 * item is a plain command and should read as one at the callsite.
 *
 * `checked` is deliberately a tri-state: left off, the item is a command and
 * gets role="menuitem"; set either way, the menu is a set of alternatives and
 * the item gets role="menuitemradio". Both of vorlaut's menus are the second
 * kind and every item here passes it, which is why this file could get away
 * with a positional boolean for so long - but the same third argument meant
 * "this is destructive" in mitreden, and one function announcing opposite
 * things in two products is what naming the field is for.
 */
export type ItemOpts = { danger?: boolean; checked?: boolean; disabled?: boolean };

export type AddItem = (label: string, run: () => void, opts?: ItemOpts) => void;

/** The trigger the open menu belongs to, so focus has somewhere to go back to. */
let opener: HTMLElement | null = null;

/** The items worth landing on. A disabled one is skipped, not stepped through. */
const rows = (menu: Element): HTMLElement[] =>
  [...menu.querySelectorAll<HTMLElement>("button:not(:disabled)")];

export function closeMenus(): void {
  for (const menu of document.querySelectorAll(".menu")) {
    // Focus returns to the trigger only when it was inside the menu to begin
    // with. Escape and an activated item both arrive here with focus in the
    // list, and both want it back on the button that opened it; a click
    // somewhere else on the page arrives here too, and pulling focus back
    // would yank it out of whatever that click just gave it to.
    if (menu.contains(document.activeElement)) opener?.focus();
    menu.remove();
  }
  opener = null;
  for (const button of document.querySelectorAll('[aria-expanded="true"]'))
    button.setAttribute("aria-expanded", "false");
}

/** Home/End and the arrows, so the open list is reachable without a mouse. */
function stepMenu(event: KeyboardEvent): void {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const menu = event.currentTarget as HTMLElement;
  const list = rows(menu);
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || !list.length) return;
  event.preventDefault();
  const to = event.key === "Home" ? 0
    : event.key === "End" ? list.length - 1
      : event.key === "ArrowDown"
        ? (at + 1) % list.length
        : (at - 1 + list.length) % list.length;
  list[to]!.focus();
}

/** Opens a menu under `button`, or closes the one already there. */
export function menuOn(button: HTMLElement, build: (add: AddItem) => void): void {
  const open = button.getAttribute("aria-expanded") === "true";
  closeMenus();
  if (open) return;                       // a second press is a dismissal
  button.setAttribute("aria-expanded", "true");
  // "menu" rather than "true": both open a menu as far as the ARIA spec goes,
  // but the first says which kind.
  button.setAttribute("aria-haspopup", "menu");
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  build((label, run, opts = {}) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    // A menu of alternatives, one of which is in force. aria-checked on
    // menuitemradio is what says which; a plain list would read as five equal
    // commands and leave the current one to be inferred from the drawing.
    item.setAttribute("role", opts.checked === undefined ? "menuitem" : "menuitemradio");
    if (opts.checked !== undefined) item.setAttribute("aria-checked", String(opts.checked));
    if (opts.danger) item.className = "danger";
    if (opts.disabled) item.disabled = true;
    item.onclick = (event) => { event.stopPropagation(); run(); };
    menu.appendChild(item);
  });
  menu.addEventListener("keydown", stepMenu);
  button.parentNode?.appendChild(menu);
  opener = button;
  rows(menu)[0]?.focus();
}

/* Dismissal, both ways round. The click listener asks whether the press landed
 * inside an anchor rather than inside the menu: the trigger is in the anchor
 * too, and its own handler has to be the thing that decides a second press. */
addEventListener("click", (event) => {
  if (!(event.target as HTMLElement).closest(".menu-anchor")) closeMenus();
});
/* Escape dismisses the menu and stops there. Both of these pickers live inside
   a <dialog> opened with showModal(), and the browser closes that on Escape
   too - so without preventDefault the first press took the whole settings
   sheet with it, which is not what somebody dismissing a drop-down asked for.
   Capture phase, so this runs before the dialog's own handling, and only when
   a menu is actually open: with none open, Escape has to keep closing the
   sheet, because that is the way out of it. */
addEventListener("keydown", (event) => {
  if ((event as KeyboardEvent).key !== "Escape") return;
  if (!document.querySelector(".menu")) return;
  event.preventDefault();
  event.stopPropagation();
  closeMenus();
}, true);

// Replaces the contents of a box with one line of prose. Used where a result
// list has something to say instead of results.
export function say(box: HTMLElement, text: string): void {
  box.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = text;
  box.appendChild(note);
}

