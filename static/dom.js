// The two things every module reaches for: an element and the status line.
//
// api() used to be the third. It was a request to app.py, and it went with
// app.py: keeping a fetch helper here would have left one door into the
// network standing open beside the one the seam provides, which is the
// arrangement the seam exists to end. Nothing under static/ has a URL to give
// it any more except the ARASAAC download in backend/local.js.
export const $ = (id) => document.getElementById(id);

export const status = (text) => { $("status").textContent = text; };

// Replaces the contents of a box with one line of prose. Used where a result
// list has something to say instead of results.
export function say(box, text) {
  box.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = text;
  box.appendChild(note);
}
