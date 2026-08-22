// Everything the page asks the outside for, answered the way it is answered
// today: one request each, to app.py.
//
// Nothing here is new. Every function below is the fetch that used to stand in
// the module that called it, moved without a change in what it sends or what
// comes back - see backend.js for why they were collected in one place.
//
// This file is the only one under static/ that knows a URL, and that is worth
// keeping true rather than merely noticing. A fetch written anywhere else is a
// call the browser implementation cannot answer, and nothing would say so
// until the static page reached that button and found nothing behind it.

// The errors first, because two callers need them and they are the reason
// api() existed at all: a failed request should say what the server said, not
// "500". The server puts its sentence in .error; a response that is not JSON
// at all falls back to the status line.
async function failure(response) {
  try {
    return (await response.json()).error || response.statusText;
  } catch (error) {
    return response.statusText;
  }
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(await failure(response));
  return response;
}

// The four POSTs that carry a JSON body all wrote out the same three lines.
function post(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- The layout --------------------------------------------------------------

// The two headers travel with the layout rather than beside it. They are how
// the page knows whether somebody else has written since it read - and whether
// a build is due - and a caller that forgot to ask for them would look exactly
// like one where nothing had changed.
export async function loadLayout() {
  const response = await api("/api/layout");
  return {
    layout: await response.json(),
    version: response.headers.get("X-Layout-Version"),
    buildCurrent: response.headers.get("X-Build-Current"),
  };
}

// A conflict is an answer, not a failure: the file moved under us and nothing
// was written. It comes back as a value for that reason, where a 500 throws -
// the caller has something to say about the first and nothing about the
// second. This is also why the request is a bare fetch: api() would throw on
// the 409 and lose the distinction.
export async function saveLayout(layout, version) {
  const response = await fetch("/api/layout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Layout-Version": version || "",
    },
    body: JSON.stringify(layout),
  });
  if (response.status === 409) return { conflict: true };
  if (!response.ok) throw new Error(await failure(response));
  return {
    conflict: false,
    saved: await response.json(),
    version: response.headers.get("X-Layout-Version"),
    buildCurrent: response.headers.get("X-Build-Current"),
  };
}

// --- Symbols -----------------------------------------------------------------
//
// What is left of them here. The page searches through symbols.js and reads a
// METACOM folder itself; /api/search and /api/sources still answer and nothing
// calls them. This one stays because an ARASAAC pick has to land in symbols/
// for build.py to resolve it.

export async function pickSymbol(choice) {
  return await (await post("/api/pick", choice)).json();
}

// The file goes up raw with its name in the query string, which is what saves
// a multipart form on both sides.
export async function uploadSymbol(file) {
  const url = "/api/upload?name=" + encodeURIComponent(file.name);
  return await (await api(url, { method: "POST", body: file })).json();
}

// Handed an element rather than handing back a URL, and that is not a detail.
// Here the address is known before anything is rendered, so it could have been
// a string; in the browser the tile has to be drawn first and only then is
// there a blob: URL to show. Taking the element means the caller reads the
// same either way, and the waiting - and the revoking, later - stays on this
// side of the seam where it belongs.
export function previewInto(image, symbol, colour) {
  image.src = "/api/preview?symbol=" + encodeURIComponent(symbol || "")
            + "&color=" + encodeURIComponent(colour || "#000000");
}

// --- Voices and speech -------------------------------------------------------

export async function listVoices() {
  return await (await api("/api/voices")).json();
}

export async function voiceFetchState() {
  return await (await api("/api/voices/fetch")).json();
}

export async function startVoiceFetch() {
  await post("/api/voices/fetch", {});
}

// A Blob rather than a playing sound: which button went "···" while it
// rendered, and what happens when it ends, is the page's business.
export async function synthesise(text, voice) {
  return await (await post("/api/speak", { text, voice: voice || "" })).blob();
}

// --- Settings ----------------------------------------------------------------

export async function readSettings() {
  return await (await api("/api/settings")).json();
}

export async function writeSettings(wanted) {
  return await (await post("/api/settings", wanted)).json();
}

// --- The build ---------------------------------------------------------------

export async function runBuild() {
  return await (await api("/api/build", { method: "POST" })).json();
}

// --- What the last build left -------------------------------------------------
//
// Not /api/device/manifest and /api/device/file, which look like exactly this
// and are not: those two are gated on the device token, and that token is the
// talker's credential rather than the page's. See the note beside them in
// app.py. Same bytes either way.

export async function buildManifest() {
  return await (await api("/api/build/manifest")).json();
}

// Bytes, not a Blob: whatever ends up pushing these down a cable wants to look
// at them, and a per-file buffer is the granularity progress is counted in
// anyway - nothing here is bigger than a WAV.
export async function buildFile(name) {
  const url = "/api/build/file?name=" + encodeURIComponent(name);
  return await (await api(url)).arrayBuffer();
}


// --- The board as a document -------------------------------------------------

/** The layout as an .obz, for keeping somewhere real or handing to somebody
 * using different software. Bytes rather than a download: whether this becomes
 * a file on disk is the page's business, not the transport's. */
export async function exportBoard({ images = false } = {}) {
  const url = `/api/board?images=${images ? "1" : "0"}`;
  return await (await api(url)).blob();
}

/** An .obf or .obz on the way in, as a layout. Deliberately does not save it:
 * replacing what somebody has is a decision, and this is the reading half. */
export async function importBoard(file) {
  return await (await api("/api/board", { method: "POST", body: file })).json();
}


// --- Pairing -----------------------------------------------------------------
//
// Both of these are on their way out: the five digits are how a talker over
// Wi-Fi proves it is the one in the room, and a cable does not need proving.
// They are here anyway, because a seam with one module still reaching past it
// is not a seam - and because whatever WebSerial puts in their place will want
// to be asked the same two questions.

export async function pairState() {
  return await (await api("/api/pair")).json();
}

// A refused code is an answer too - it says how many tries are left - so it
// comes back rather than throwing, for the same reason a save conflict does.
export async function confirmPairCode(code) {
  const response = await fetch("/api/pair/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const answer = await response.json();
  if (!response.ok) {
    return { ok: false, error: answer.error, left: answer.left };
  }
  return { ok: true };
}
