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
type AddItem = (label: string, current: boolean, run: () => void) => void;

export function closeMenus(): void {
  for (const menu of document.querySelectorAll(".menu")) menu.remove();
  for (const button of document.querySelectorAll('[aria-expanded="true"]'))
    button.setAttribute("aria-expanded", "false");
}

/** Opens a menu under `button`, or closes the one already there. */
export function menuOn(button: HTMLElement, build: (add: AddItem) => void): void {
  const open = button.getAttribute("aria-expanded") === "true";
  closeMenus();
  if (open) return;                       // a second press is a dismissal
  button.setAttribute("aria-expanded", "true");
  const menu = document.createElement("div");
  menu.className = "menu";
  // A menu of alternatives, one of which is in force. aria-checked on
  // menuitemradio is what says which; a plain list would read as five equal
  // commands and leave the current one to be inferred from the drawing.
  menu.setAttribute("role", "menu");
  build((label, current, run) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", String(current));
    item.onclick = (event) => { event.stopPropagation(); run(); };
    menu.appendChild(item);
  });
  button.parentNode?.appendChild(menu);
  menu.querySelector<HTMLElement>("button")?.focus();
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

