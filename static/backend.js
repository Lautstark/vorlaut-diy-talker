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
// So the requests that used to be written out in eight modules are named here
// instead, once. editor.js, picker.js, voices.js and settings.js ask for what
// they need and are not told who answers; swapping the line below for a local
// implementation moves all of them across without any being opened again.
// Not the whole page, though - getting the result onto the talker is not among
// them and cannot come across this way. The note at the foot of this file says
// why, and is there so that the gap is a reserved place rather than a
// discovery.
//
// The list shrinks as the rewrite lands. Searching and asking which sources
// exist were here until the browser took both; what is left of symbols is the
// ARASAAC download, which needs somewhere on disk to put the file.
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

  // Keeping a symbol, and showing what it will look like at the 15.21 mm the
  // ScreenKey actually has. Finding one no longer comes through here - see
  // symbols.js.
  pickSymbol,
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


// --- Reserved: getting it onto the device ------------------------------------
//
// Nothing above sends anything to the talker, and today that is correct: the
// device pulls over Wi-Fi on its own schedule and the page is not in the
// conversation at all. Over a cable it will be, and that operation is the one
// thing in the eventual contract that does not fit the shape of the rest.
//
// Everything named above is one shot - ask, get a value, done. A sync over
// WebSerial is not: a gesture, a port the user grants, an open stream, about
// 1.5 MB with progress worth watching, a cancel that has to be able to arrive
// mid-flight, and a close. Written as one more async function returning one
// more value, it would have to keep its progress and its cancellation
// somewhere else, and that is the shape that is expensive to undo once other
// code has grown around it. So it is left unwritten rather than written small.
// Whoever brings WebSerial is expected to add a slot of its own here, against
// the grain of the list above, and that is not a mistake.
//
// What it will not need is a way to be handed the files. The build already
// leaves them where the sync finds them - builder.py writes data/ and the
// device fetches out of it - and the browser keeps that arrangement rather
// than inventing one: runBuild() writes through the same storage the layout
// goes through and answers with its log, as it does now. The artefacts never
// travel in a return value, which is the reason runBuild does not change
// meaning when it moves.
//
// The list above is at its longest today. Most of it is here because the
// server can do something the browser cannot do yet, and each of those leaves
// the way searching left. What is still here when the rewrite is done is
// storage and this: the two things a page genuinely cannot do by itself.
