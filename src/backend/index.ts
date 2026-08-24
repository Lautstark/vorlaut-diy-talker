// Where the page ends and the outside begins.
//
// The app is a static site. Everything the page cannot work out for itself -
// the layout, the symbols, the speech, the build - used to be a request to
// app.py and is the browser doing it now: a folder chosen with the File System
// Access API, bildquelle for the symbols, the vendored stimmquelle for the
// speech, tiles.js and layout_format.js for the build. Each of those halves
// was written and measured against the Python it replaced; backend/local.js is
// where they stopped being spare parts.
//
// So the requests that used to be written out in eight modules are named here
// instead, once. editor.js, picker.js, voices.js and settings.js ask for what
// they need and are not told who answers.
// Getting the result onto the talker is here too now, and it is the one entry
// that does not come from local.js. The note at the foot of this file says why
// it has a shape of its own.
//
// The list shrinks as the rewrite lands. Searching and asking which sources
// exist were here until the browser took both; what is left of symbols is the
// ARASAAC download, which needs somewhere to put the file.
//
// The names are re-exported one at a time rather than with `export *`, so that
// this list is the contract: adding a way for the page to reach the outside
// means writing it down here, where the next implementation will have to
// answer it too.
export {
  // The boards: what there are, which one is open, and the four things
  // somebody can do to the list. A board is a whole layout - one per child, or
  // one per room - and the sets inside it are the talker's five keys, which is
  // a different level entirely. See src/shell/boards.ts.
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  useCollection,
  layoutOf,

  // The layout of whichever board is open, and the two headers that say
  // whether it moved underneath us and whether a build is due.
  loadLayout,
  saveLayout,

  // Keeping a symbol, and showing what it will look like at the 15.21 mm the
  // ScreenKey actually has. Finding one no longer comes through here - see
  // symbols.js.
  pickSymbol,
  uploadSymbol,
  previewInto,
  symbolInto,

  // Which voices can be spoken with here - a question the server answers
  // afresh on every open, because a key or a model may have arrived since.
  listVoices,
  voiceFetchState,
  startVoiceFetch,

  // Whether the stored Azure key actually works, as a code the page can put
  // words to. In the contract because its absence was a hole the sheet fell
  // through: a wrong region cost the Azure rows silently, and "stored" was
  // the only thing on screen - true about the database, useless about the key.
  azureState,

  // A sentence as sound, for listening to before it is kept.
  synthesise,

  // The Azure key and the METACOM folder: this installation, not this content,
  // which is why they are not in layout.json.
  readSettings,
  writeSettings,

  // The board as a document somebody else's software can open, and back.
  // The short of it: a format only one program reads is a format that dies
  // with the program.
  exportBoard,
  importBoard,

  // Turning all of it into tiles and WAVs for the device, and reading back
  // what that left - which is how the files reach whatever sends them.
  runBuild,
  buildManifest,
  buildFile,

} from "./local.js";

// One implementation, named directly. This was a bare specifier resolved by an
// import map in the page while there was no bundler; there is one now, so the
// indirection bought nothing that a second entry here would not buy more
// plainly. A second way for the page to reach the outside - a build that talks
// to a device over WebSerial, a hosted variant - is a change to this line and
// to nothing else, which is what the seam promised in the first place.


// --- Getting it onto the device ---------------------------------------------
//
// This was a reserved place for a long time, and the note that held it open
// said what the shape would have to be. It turned out to be right, so what
// follows is that note in the past tense.
//
// Everything above is one shot - ask, get a value, done. A sync over WebSerial
// is not: a gesture, a port the user grants, an open stream, about a megabyte
// with progress worth watching, a cancel that has to be able to arrive
// mid-flight, and a close. Written as one more async function returning one
// more value it would have had to keep its progress and its cancellation
// somewhere else, which is the shape that is expensive to undo once other code
// has grown around it. So it is four names rather than one, and it sits in a
// module of its own rather than in local.js: the two ways the page reaches the
// outside are storage and a cable, and they have nothing in common but this
// file.
export {
  // Whether this browser can talk to a cable at all - Chrome and Edge can,
  // Firefox and Safari edit boards and cannot send them. Asked before the
  // page promises anything it would then have to take back.
  cableSupported,

  // The ports already granted, and the dialog that grants one. Two names
  // rather than one because only one of them needs a click, and which of the
  // two the press calls is the whole difference between one press and a
  // dialog every time. See the head of ui/release.ts.
  grantedDevices,
  askForDevice,
  watchDevices,

  // The transfer. Takes the ports, not the files.
  sendToDevice,
} from "./cable.js";
export type { Plan, Sending, Sent } from "./cable.js";

// --- Getting it into a folder ------------------------------------------------
//
// The same files, written where mklittlefs and the bench can reach them. It is
// here rather than in the Daten panel's export because it is not this
// browser's state and not a board: it is the shape the device's file system
// should have, and it is the only thing standing between a cable that turns
// out to be wrong on hardware and no way in at all. See the head of folder.ts.
export { folderExportSupported, chooseBuildFolder, writeBuildTo, isBuildFile }
  from "./folder.js";
export type { Exported, Exporting } from "./folder.js";

// What it does not take is the files, and that was written here before the
// cable was: the transport does have to be handed them, it just is not handed
// them by runBuild(). The build leaves its files where something else comes
// and reads them - builder.py wrote data/ and the device fetched out of it -
// and the browser keeps exactly that arrangement rather than inventing one.
// runBuild() still writes through storage and still answers with nothing but
// its log; buildManifest() and buildFile() read the result back afterwards, by
// name, the same way the device has always read it. So the artefacts never
// travel in a return value, which is the reason runBuild() did not change
// meaning when it moved, and the reason a megabyte does not pass through it.
//
// The list above is at its longest today. Most of it is here because the
// server can do something the browser cannot do yet, and each of those leaves
// the way searching left. What is still here when the rewrite is done is
// storage and this: the two things a page genuinely cannot do by itself.
