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

export interface Layout {
  sets: BoardSet[];
  /** Which language the device's own menu speaks. */
  language?: string;
  /** The voice chosen for this board, "" or absent when none is. */
  voice?: string;
  sleep_timeout_seconds?: number;
}

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
  local?: boolean;
}

/** What the settings sheet asks to be written. A subset of Settings, because
 *  the sheet holds the fields somebody can type and not the ones the provider
 *  answers for - and azureKey is absent unless it was typed, since an untouched
 *  field must not wipe the stored key. Removing the key is therefore its own
 *  explicit ask - null - and never a reading of an empty field. */
export interface WantedSettings {
  azureRegion: string;
  metacom: string;
  azureKey?: string | null;
  /** Absent leaves the stored preference alone; null clears it. Same shape as
   *  azureKey above, and for the same reason: a save that is about something
   *  else must not wipe a choice it never asked about. */
  metacomRendering?: string | null;
  activeProvider?: "arasaac" | "metacom";
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
