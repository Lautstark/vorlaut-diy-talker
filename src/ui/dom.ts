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

export const status = (text: string): void => { $("status").textContent = text; };

// Replaces the contents of a box with one line of prose. Used where a result
// list has something to say instead of results.
export function say(box: HTMLElement, text: string): void {
  box.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = text;
  box.appendChild(note);
}

