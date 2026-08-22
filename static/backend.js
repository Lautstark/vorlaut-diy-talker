// Where the page ends and the outside begins.
//
// The app is being turned into a static site. Everything the page cannot work
// out for itself - the layout, the symbols, the speech, the build - is today a
// request to app.py and will tomorrow be the browser doing it: a folder chosen
// with the File System Access API, bildquelle for the symbols, speak.js for the
// speech, tiles.js and layout_format.js for the build. Those four browser
// halves already exist and are already measured against the Python they were
// ported from. What was missing was somewhere to put them.
//
// So the seventeen requests that used to be written out in eight modules are
// named here instead, once. editor.js, picker.js, voices.js and settings.js ask
// for what they need and are not told who answers; swapping the line below for
// a local implementation moves the whole page across without any of them being
// opened again. That is the only thing this file buys, and it is the reason the
// rest of the rewrite is a series of small commits rather than one large one.
//
// The names are re-exported one at a time rather than with `export *`, so that
// this list is the contract: adding a way for the page to reach the outside
// means writing it down here, where the next implementation will have to
// answer it too.
export {
  // The layout, and the two headers that say whether it moved underneath us
  // and whether a build is due.
  loadLayout,
  saveLayout,

  // Finding a symbol, keeping one, and showing what it will look like at the
  // 15.21 mm the ScreenKey actually has.
  searchSymbols,
  pickSymbol,
  symbolSources,
  uploadSymbol,
  previewInto,

  // Which voices can be spoken with here - a question the server answers
  // afresh on every open, because a key or a model may have arrived since.
  listVoices,
  voiceFetchState,
  startVoiceFetch,

  // A sentence as sound, for listening to before it is kept.
  synthesise,

  // The Azure key and the METACOM folder: this installation, not this content,
  // which is why they are not in layout.json.
  readSettings,
  writeSettings,

  // Turning all of it into tiles and WAVs for the device.
  runBuild,

  // The five digits. On the way out with the Wi-Fi sync that needs them - see
  // the note in backend/server.js.
  pairState,
  confirmPairCode,
} from "./backend/server.js";
