/* What a board is, as the rest of the app passes it around.
 *
 * These shapes were only ever written down in three places that could not
 * check each other: layout_format.ts, which turns one into the bytes the
 * firmware reads; obf.ts, which turns one into a document other AAC software
 * opens; and the seed in backend/local.ts that a first visit gets. Every
 * module in between took an object and hoped.
 *
 * The names are the ones already on disk and in every saved layout - snake
 * case where the firmware and the Open Board Format use it - because these are
 * a description of stored data rather than a chance to rename it.
 */

/** One key: what it says, and the picture on it. */
export interface Slot {
  text: string;
  /** A file name kept in the browser's store, or "metacom:<name>" for a
   *  reference into somebody's own licensed collection. Empty means none. */
  symbol: string;
}

/** One set of four keys, and the set key that switches to it. */
export interface BoardSet {
  name: string;
  symbol: string;
  /** Hex, "#RRGGBB". Drawn as a border around all five displays. */
  color: string;
  /** Absent counts as active - the flag arrived after boards already existed,
   *  and a board written before it must not become an empty device. */
  active?: boolean;
  slots: Slot[];
}

/** One Sammlung in the list, as the sidebar shows it.
 *
 * `Collection` in the code and *Sammlung* on screen, which is the family's
 * convention rather than an oversight - design.md §3.6 settles both halves. It
 * also frees the word *board*, which the exchange format uses for a single OBF
 * page and which this repository spent a while meaning two things at once.
 *
 * The id is minted once and never changes - not on rename, not on edit, not on
 * export. Duplicating mints a fresh one, because a copy that kept the original's
 * would overwrite it wherever the two meet again. That is exchange/SPEC.md §8's
 * rule for `ext_lautstark_package_id`, and this is the value that will become
 * it; writing the id down now rather than deriving one at export time is what
 * makes "stable for the life of the package" true rather than hoped for. */
export interface CollectionRef {
  id: string;
  /** Whatever somebody typed in the work head. A new one is named for the day
   *  rather than left blank, so the list reads even when nobody names anything. */
  name: string;
  /** When it was last written, for the order the sidebar shows them in: the one
   *  being worked on rises.
   *
   *  Required rather than optional, and that is the storage layer's index
   *  asking for it: `collections` is indexed on this field, and a record
   *  missing an index's key is not in the index at all - so a Sammlung without
   *  a stamp would not be missing from the *order*, it would be missing from
   *  the sidebar. It was optional while a Sammlung could arrive from the
   *  single-layout database without one; nothing arrives from there any more. */
  updatedAt: number;
}

/** The whole list, and which of them is open. */
export interface CollectionList {
  collections: CollectionRef[];
  /** null only before the first one exists. */
  current: string | null;
}

/** Which editor a Sammlung is for, and therefore what is inside it.
 *
 * Declared once, when the Sammlung is made, and never converted: a five-key
 * device and a tablet board are not two renderings of one thing. Four keys in
 * a fixed ring have no answer to "which cell of a 6x11 grid", and a page of
 * sixty-six buttons composing a sentence has no answer to "which of the five
 * displays". A convert would therefore have to invent most of its output,
 * which is a worse offer than exporting and starting again.
 *
 * The shell names this type and neither editor: it is what core/editor.ts's
 * registry is keyed by, and it is the whole of what src/shell/ knows about
 * there being more than one of them.
 */
export type Target = "diy" | "app";

/** A whole Sammlung, in whichever shape its target asks for.
 *
 * A union rather than one interface with optional halves, and the difference
 * shows at every reader: `layout.sets` on an app Sammlung would type-check and
 * answer undefined, which is how the sidebar came to count every Sammlung with
 * whichever editor happened to be installed. With a union that line does not
 * compile until it has asked which shape it is holding.
 */
export type Layout = DiyLayout | AppLayout;

/** The five-key talker: sets of four keys, and the ring that cycles them. */
export interface DiyLayout {
  /** Absent counts as "diy". Every layout written before there was a second
   *  editor is one of these, and there is no migration - the flag arrived
   *  after boards already existed, exactly as BoardSet.active did. */
  target?: "diy";
  sets: BoardSet[];
  /** Which language the device's own menu speaks. */
  language?: string;
  /** The voice chosen for this board, "" or absent when none is. */
  voice?: string;
  sleep_timeout_seconds?: number;
}

/** How a button wears the colour of its word class.
 *
 * A preference rather than a rule - which is the point. The Fitzgerald key
 * says a lot on a board of few big cells and rather less on one of sixty-six,
 * where a photograph under a fill is a photograph with a wash over it. The
 * border says the same thing and leaves the picture alone. */
export type WordColor = "fill" | "border" | "off";

/** A tablet Sammlung: pages of buttons that compose a sentence in a bar.
 *
 * The MetaTalk shape, and what the Android viewer already renders - see
 * exchange/SPEC.md §7. Nothing here is an extension of that format: a page is
 * an OBF board, a button is an OBF button, and the sentence bar is §7.3.
 */
export interface AppLayout {
  target: "app";
  language?: string;
  voice?: string;
  /** One size for every page in the Sammlung, not one per page.
   *
   *  OBF would allow a grid per board and this deliberately does not use it.
   *  What a person learns on a board of this kind is where a word *is* - the
   *  hand goes to the top right for "ich" before the eye has read anything -
   *  and that only survives across pages while the pages are the same shape.
   *  A per-page size would make the top right cell a different distance from
   *  the thumb on every page, which is the one thing the layout is for. */
  grid: GridSize;
  /** Every page, in the order the editor's page strip shows them. Presentation
   *  only: what leads where is the buttons, not this order. */
  pages: AppPage[];
  /** Whether the leftmost column is drawn set apart from the rest.
   *
   *  Written out as exchange/SPEC.md §4.1's ext_lautstark_first_column_gap,
   *  and it is a hint about drawing rather than about behaviour: the buttons
   *  in that column are ordinary buttons, and what makes them always reachable
   *  is a builder putting them on every page. The gap is what tells somebody
   *  looking at the board that those are the ones that stay - MetaTalk sets
   *  its leftmost column apart for exactly that reason.
   *
   *  Absent counts as false, and a viewer that has never heard of the field
   *  draws the board without the gap, which is a board with the wrong emphasis
   *  rather than a wrong board. */
  firstColumnGap?: boolean;
  /** Whether a word class is drawn as a fill, as a border, or not at all.
   *
   *  One choice for the whole Sammlung, beside the grid size and for the same
   *  reason: it is decided once and holds for every page.
   *
   *  Absent counts as "fill", which is what every layout stored before this
   *  field existed was drawn as - so an old Sammlung opens looking exactly as
   *  it did, and nothing has to be migrated.
   *
   *  "off" is not colourless. A page keeps whatever colour it has, because
   *  that says *where* somebody is; what goes away is the colour that means
   *  *what a word is*. The family this follows treats it the same way:
   *  AsTeRICS Grid carries `colorSchemesActivated` beside a `colorMode` of
   *  background, border or both. */
  wordColor?: WordColor;
  /** The page the tablet opens on, and what a `:home` button goes to. It
   *  becomes `manifest.root`.
   *
   *  An id rather than pages[0], so that reordering the strip cannot silently
   *  change what a child's tablet opens on - which is a thing nobody would
   *  look for, because dragging a row is not an act that sounds like it could
   *  do that. */
  home: string;
}

export interface GridSize {
  rows: number;
  columns: number;
}

/** Which shape a layout is, for the readers that can only handle one.
 *
 * Type guards rather than a bare `layout.target === "app"` at each call site,
 * because the interesting half is the *other* one: "diy" is written down on
 * nothing that existed before there were two editors, so the test for it is
 * `!== "app"` and not `=== "diy"`. Getting that backwards would read every
 * board this product has ever saved as an app Sammlung with no pages in it,
 * which is an empty screen rather than an error.
 */
export const isApp = (layout: Layout): layout is AppLayout =>
  layout.target === "app";
export const isDiy = (layout: Layout): layout is DiyLayout =>
  layout.target !== "app";

/** One page: an OBF board, with the buttons that sit on it. */
export interface AppPage {
  /** Minted with the page, never derived from the name or the position - the
   *  same rule and the same reason as CollectionRef.id. Buttons point at this
   *  value, so deriving it from anything editable would break every edge the
   *  moment somebody renamed a page. */
  id: string;
  name: string;
  /* A page carried a colour here, written out as exchange/SPEC.md §4.2's
   * ext_lautstark_board_color. It is gone from this half while the whole idea
   * of colouring a *page* is reconsidered - a button's colour is untouched,
   * because that one marks a word class and is the Fitzgerald key.
   *
   * The field in the format is optional and stays defined; this builder simply
   * writes no value for it, which the viewer already handles (Board.color is
   * nullable there). The talker still has one, on a set rather than a page,
   * and that half goes with the firmware in its own change. */
  /** Sparse, and each one carries where it sits. There is deliberately no
   *  dense array of cells: growing the grid from 3x5 to 6x11 would re-index
   *  every entry of one, and that re-indexing is the rewrite this shape exists
   *  to avoid. A cell nothing sits in is a cell no button names. */
  buttons: AppButton[];
}

/** One button on one page. */
export interface AppButton {
  id: string;
  /** Zero-based, row-major, inside the Sammlung's grid. Two buttons may not
   *  hold the same cell; the editor is what keeps that true. */
  row: number;
  col: number;
  /** What the button shows. */
  label: string;
  /** What it says, when that is not what it shows: "einen Apfel" under an
   *  "Apfel". Empty means the label is spoken, which is what OBF means by
   *  leaving `vocalization` out - see exchange/SPEC.md §7.2. */
  vocalization: string;
  /** A file name in the browser's store, or "metacom:<name>". Same vocabulary
   *  as Slot.symbol, because it is the same picker behind it. */
  symbol: string;
  /** Which Fitzgerald class this word belongs to, as a key into
   *  boot_data.ts's WORD_CLASSES - or "" for a button that carries no class.
   *
   *  The class rather than the colour it resolves to, and that is what makes
   *  this a convention rather than a palette: the author chose "this is a
   *  verb", and green is a rendering of that. Storing the hex would make
   *  re-tinting a whole Sammlung a sweep over every button, and would lose the
   *  only thing anybody meant. */
  wordClass: string;
  /** What one press does. Exactly one thing.
   *
   *  See Act: the reason this is not a boolean beside an optional page id is
   *  that the format cannot represent the states such a pair could express. */
  act: Act;
}

/** What pressing a button does - exchange/SPEC.md §7.3's activation table, as
 *  a type.
 *
 * That table is exclusive on the wire: `load_board` beats `action`, which
 * beats `ext_lautstark_speak_immediately`, which beats appending. A model that
 * carried `speakImmediately: boolean` beside `target?: string` could hold
 * both, and the exporter would then have to pick a winner - which is the
 * exporter guessing at what somebody meant, in a file that ends up on a child's
 * tablet. A union can only say one thing, so there is nothing to guess.
 */
export type Act =
  /** Append one entry to the sentence bar. The default and the common case. */
  | { kind: "append" }
  /** Speak this button at once and leave the bar alone. For an interjection -
   *  "Aua", a greeting - which composing into a sentence first would ruin. */
  | { kind: "speak" }
  /** Go to another page. `page` is an AppPage.id in this same Sammlung. */
  | { kind: "goto"; page: string }
  /** The four sentence-bar controls, exchange/SPEC.md §7.4. `sayBar` is the
   *  spec's `:speak`, renamed here only because "speak" above is the other
   *  thing and two of them in one union would be read wrongly every time. */
  | { kind: "clear" }
  | { kind: "backspace" }
  | { kind: "sayBar" }
  | { kind: "home" };

/** A layout as it comes out of storage, with the two stamps that say whether
 *  somebody else has written since we read and whether a build is due. */
export interface HeldLayout {
  layout: Layout | null;
  version: string | null;
  buildCurrent: string | null;
}

/** What a write answers with: the conflict case is a value rather than a
 *  throw, because the caller has something to say about it. */
export interface SaveResult {
  conflict?: boolean;
  saved?: Layout;
  version?: string | null;
  buildCurrent?: string | null;
}

/** This installation rather than this content, which is why none of it is in
 *  the layout: an Azure key and where somebody's METACOM folder is. */
export interface Settings {
  azureKey: { set: boolean; hint: string };
  azureRegion: string;
  azureSecret?: string;
  metacom: {
    path: string;
    ok: boolean;
    count: number;
    keywords: boolean;
    fixed: boolean;
  };
  /** Which collection the picker offers. One at a time, deliberately: a board
   *  read by a child is easier to read when its five keys are drawn in one
   *  hand, and two illustration styles side by side is a cost paid by the
   *  person least able to say so. bildhaft settled on the same rule.
   *
   *  Only the picker is bound by it. A key already holding a picture keeps
   *  exactly the picture it holds - switching source is a decision about what
   *  to choose from next, never a reason to take symbols off a board. */
  activeProvider?: "arasaac" | "metacom";
  /** Which of METACOM's parallel renderings the search should prefer, or null
   *  for none. Ordering only - nothing is ever filtered out by it.
   *
   *  Beside the metacom block rather than inside it, and that is the whole of
   *  why it did not survive a reload: everything in there is re-derived from
   *  the provider on every read, because a folder chosen in this browser can
   *  be gone by the next visit and a stored "ok: true" would be a claim nobody
   *  checked. A preference is not such a claim - it is a choice, and it has to
   *  outlive the folder it was made about. */
  metacomRendering?: string | null;
  /** Whether the sidebar is a column of this page. A choice about the shape of
   *  the window, remembered rather than re-made every visit - and kept here
   *  with every other preference rather than in localStorage, because a
   *  preference living in two stores gets restored by one and overwritten by
   *  the other. conventions.md §1.3. Absent counts as open. */
  sidebarOpen?: boolean;
  local?: boolean;
}

/** What the settings sheet asks to be written. A subset of Settings, because
 *  the sheet holds the fields somebody can type and not the ones the provider
 *  answers for - and azureKey is absent unless it was typed, since an untouched
 *  field must not wipe the stored key. Removing the key is therefore its own
 *  explicit ask - null - and never a reading of an empty field. */
export interface WantedSettings {
  /** Absent leaves the stored one alone, like every field below it. It was
   *  required, which meant a save about anything else had to carry it or wipe
   *  it - and the sidebar preference is a save about something else. */
  azureRegion?: string;
  metacom?: string;
  azureKey?: string | null;
  /** Absent leaves the stored preference alone; null clears it. Same shape as
   *  azureKey above, and for the same reason: a save that is about something
   *  else must not wipe a choice it never asked about. */
  metacomRendering?: string | null;
  activeProvider?: "arasaac" | "metacom";
  sidebarOpen?: boolean;
}

/** A voice as the picker shows it.
 *
 * Four facts beyond the name, and they are the four that decide between two
 * voices: who renders it, what it speaks, whose voice it is, and what it costs
 * to have. The catalogue carried all of them all along and this seam used to
 * drop them on the floor - a picker of bare names made "Thorsten" and "Katja"
 * look like the same kind of thing, when one is on this machine and the other
 * is a request to Microsoft per sentence.
 *
 * stimmquelle's `recommended` is deliberately NOT here. It is editorial, and
 * its own documentation says it is always false for a cloud backend "which
 * publishes hundreds and about which this package has no opinion" - so with an
 * Azure key a handful of rows would carry a badge and several hundred would
 * not, and "no opinion" is indistinguishable from "not as good" to anyone
 * reading the list. mitreden took the same badge out for the same reason. The
 * flag stays out of the type rather than being carried unused, because an
 * unused field is where a use gets invented later. */
export interface OfferedVoice {
  id: string;
  label: string;
  language: string;
  ready: boolean;
  /** What actually renders it. Decides what the other fields can promise. */
  source: "piper" | "azure" | "system";
  /** `female`, `male`, or `mixed` for a multi-speaker corpus. Empty if unknown. */
  gender: string;
  /** The model's quality tier - `medium`, `high`, and the `low` that only a
   *  page driving piper itself can speak. Empty where the backend has no such
   *  thing to say, which is every cloud voice.
   *
   *  Here because the name alone cannot carry it: stimmquelle's displayName()
   *  answers with the catalogue's name and nothing else, on purpose, so both
   *  Thorstens are "Thorsten" and the two rows differed only in a download
   *  size that said nothing about why. What the picker does with it is a
   *  narrower question than "show the tier" - see voiceRow(). */
  quality: string;
  /** Fetched before this voice first speaks. 0 for a cloud backend. */
  downloadBytes: number;
  /** True when it needs a key, and so a network call for every sentence. */
  needsKey: boolean;
  /** True when it crams a word carrying no terminal punctuation into a
   *  near-fixed span, so single words arrive as mush while whole sentences are
   *  fine. Absent rather than false everywhere else, exactly as the catalogue
   *  states it.
   *
   *  It is carried rather than worked out here for the reason no field on this
   *  interface is worked out here: which model does this is the catalogue's
   *  answer, and the moment vorlaut decided it, a voice id would be written
   *  down in this repository and a second voice found to do the same would
   *  cost an edit in two places instead of none.
   *
   *  Wordless, like `quality` and AzureState's `code`. Whether to say anything
   *  about it, and in what words, is voiceRow()'s question. */
  rushesFragments?: boolean;
}

export interface VoiceList {
  voices: OfferedVoice[];
  /** What would speak if somebody pressed play now. */
  active: string;
  /** What layout.json says. The settings sheet opens on this one; between
   *  opening it and pressing Save the two can differ. */
  chosen: string;
  /** What to call `chosen`, worked out from the id alone.
   *
   *  For the row that shows a voice the layout still holds but this machine
   *  cannot offer - a key withdrawn, a model deleted, a layout carried over
   *  from another machine. That row used to print the raw id, and for an Azure
   *  voice the id is the one thing nobody chose it by: `azure:de-DE-Katja-
   *  Neural` where the sheet had said "Katja". The name has to come from here
   *  because the backend is where the naming rules are; the page has no way to
   *  turn an id into a name and should not learn one. */
  chosenLabel: string;
  backend: string;
}

/** Whether Azure answers for the stored key and region. `code` is for the
 *  text table to branch on - "unreachable" is a region that is not one (the
 *  hostname never resolves), "refused" is a live region rejecting the key,
 *  "failed" is anything else. The seam stays wordless; the page owns words. */
export interface AzureState {
  configured: boolean;
  ok: boolean;
  count: number;
  code: "" | "unreachable" | "refused" | "failed";
}
