// The two things every module reaches for: an element and the status line.
//
// The menu that used to sit below them is @lautstark/design/menu now - it was
// the same file in mitreden, and bildhaft's was the same behaviour in a
// different shape. It is imported where it is used rather than re-exported
// from here, so there is one name for it and one place it comes from.
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

/**
 * The negation cross, as an element to lay over a picture.
 *
 * German AAC negates by crossing the symbol out rather than by using a
 * different picture - see Slot.negated in core/types.ts, which is the field
 * this draws. bildhaft draws the same mark from the same convention; the two
 * do not share code, and the shape is what they agree on.
 *
 * SVG with preserveAspectRatio="none", so one element serves a square preview,
 * a cell the width of a grid column and a tile: the stroke stretches to
 * whatever box it is put in and still reads as one line across the whole
 * symbol rather than through its middle. Sized and coloured by CSS - see
 * .negate in ui.css - because the page has two colour schemes and a hex
 * written here would be right in one of them.
 *
 * aria-hidden, and deliberately: what the cross means belongs on the thing it
 * is over, in words, not on the decoration. The cell's own accessible name
 * carries it.
 */
export function negationCross(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "negate");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M12 12 L88 88 M88 12 L12 88");
  svg.appendChild(path);
  return svg;
}

// Replaces the contents of a box with one line of prose. Used where a result
// list has something to say instead of results.
export function say(box: HTMLElement, text: string): void {
  box.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = text;
  box.appendChild(note);
}

