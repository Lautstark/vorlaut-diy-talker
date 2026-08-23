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
    /** Which of METACOM's parallel renderings the search should prefer, or
     *  null for none. Ordering only - nothing is ever filtered out by it. */
    rendering?: string | null;
  };
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
  /** Fetched before this voice first speaks. 0 for a cloud backend. */
  downloadBytes: number;
  /** True when it needs a key, and so a network call for every sentence. */
  needsKey: boolean;
}

export interface VoiceList {
  voices: OfferedVoice[];
  /** What would speak if somebody pressed play now. */
  active: string;
  /** What layout.json says. The settings sheet opens on this one; between
   *  opening it and pressing Save the two can differ. */
  chosen: string;
  backend: string;
}

/** A refused pairing code is an answer, not a failure - it says how many tries
 *  are left - so it comes back as a value the way a save conflict does. */
export interface PairAnswer {
  ok: boolean;
  error?: string;
  left?: number;
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
