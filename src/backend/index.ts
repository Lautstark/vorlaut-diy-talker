// Where the page ends and the outside begins.
//
// The app is a static site. Everything the page cannot work out for itself -
// the layout, the symbols, the speech - used to be a request to app.py and is
// the browser doing it now: a folder chosen with the File System Access API,
// bildquelle for the symbols, the vendored stimmquelle for the speech. Each of
// those halves was written and measured against the Python it replaced;
// backend/local.js is where they stopped being spare parts.
//
// So the requests that used to be written out in eight modules are named here
// instead, once. editor.js, picker.js, voices.js and settings.js ask for what
// they need and are not told who answers.
//
// **There is one implementation again, and that is what adr/0011 did to this
// file.** Getting a build onto a talker was the one entry that did not come
// from local.js: a cable, a folder, and a note at the foot about why a
// transfer could not be one more async function returning one more value. All
// of it has gone to loader/, which is a page of its own that takes the file
// this one exports. The note is worth not losing, so it is at the foot of
// loader/src/cable.ts where the code is.
//
// What is left is the shape this file always described - storage, and the
// world's answers to questions about pictures and voices - with nothing in it
// that knows a device exists.
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

  // The layout of whichever board is open, and the stamp that says whether it
  // moved underneath us.
  loadLayout,
  saveLayout,

  // Keeping a symbol, and putting one on screen. Finding one no longer comes
  // through here - see symbols.js - and neither does showing what it will look
  // like at the 15.21 mm a ScreenKey has: previewInto() was that, and that
  // picture is drawn on the loader page now, out of the tiles a compile has
  // already made (adr/0013).
  pickSymbol,
  uploadSymbol,
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

  // The same Sammlung as the package the Android viewer opens, pictures and
  // recordings baked in as files. A second door rather than an argument to the
  // first, because the first one's promise is that it never writes a licensed
  // symbol as pixels - exchange/SPEC.md §5.2.
  exportAppPackage,

  // And the same Sammlung as the talker's own .obz: the source pictures, a
  // negation flag rather than a baked cross, and the 16 kHz WAVs a talker
  // plays. A third door for the same §5.2 reason - adr/0010 - and since
  // adr/0011 the only thing here that reaches a device at all, by being a file
  // somebody carries to the page that does.
  exportDevicePackage,

} from "./local.js";

// One implementation, named directly. This was a bare specifier resolved by an
// import map in the page while there was no bundler; there is one now, so the
// indirection bought nothing that a second entry here would not buy more
// plainly. A second way for the page to reach the outside - a build that talks
// to a device over WebSerial, a hosted variant - is a change to this line and
// to nothing else, which is what the seam promised in the first place.

// One implementation, named directly. This was a bare specifier resolved by an
// import map in the page while there was no bundler; there is one now, so the
// indirection bought nothing that a second entry here would not buy more
// plainly. A second way for the page to reach the outside - a hosted variant -
// is a change to this line and to nothing else, which is what the seam
// promised in the first place.
//
// There *was* a second entry, for a long time, and it is worth saying where it
// went rather than leaving this paragraph reading like it was never tested.
// The cable was the second implementation: WebSerial, four names, its own
// module, because a transfer is a gesture and a stream and a megabyte with
// progress worth watching rather than one shot at a value. The seam held - it
// really was a change to a list of exports and nothing else - and then the
// whole of it left this page. What that proves about the arrangement is the
// same thing either way: a door named here can be swapped, and it can also be
// closed.
