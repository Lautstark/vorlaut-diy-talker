// The three things every module reaches for: an element, the status line, and
// a request that throws with the server's own message rather than "500".
export const $ = (id) => document.getElementById(id);

export const status = (text) => { $("status").textContent = text; };

export async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = response.statusText;
    try { message = (await response.json()).error || message; } catch (e) {}
    throw new Error(message);
  }
  return response;
}

// Replaces the contents of a box with one line of prose. Used where a result
// list has something to say instead of results.
export function say(box, text) {
  box.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = text;
  box.appendChild(note);
}
