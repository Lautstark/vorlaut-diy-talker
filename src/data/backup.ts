/** Everything, as one file, for the case where the storage is gone.
 *
 * store.ts has said since it was written that this was owed:
 *
 *   > this is where the content lives, not where it is safe [...] an export
 *   > somebody can put somewhere real is owed before anyone keeps a child's
 *   > talker in here alone. That is not built yet.
 *
 * This is that. The .obz export beside it is a different act and stays: an
 * .obz is a *board*, in a format other programs read, and it carries the
 * layout alone. A Sicherung is this browser's whole state, in a shape only
 * vorlaut reads, and its job is to put the machine back the way it was.
 *
 * ## What is in it
 *
 * Every board - not the one that happens to be open - the pictures in
 * symbols/, and the handful of settings that are preferences. That is the
 * irreplaceable set. A file holding one board out of three would be worse than
 * no file at all, because it would look like a backup.
 *
 * ## What is deliberately not
 *
 * **data/.** Build output. A build makes it again out of the layout and the
 * symbols, which is the definition of not worth carrying.
 *
 * **The Azure key**, and anything that hints at it. A Sicherung is written
 * into a folder the user picked, and the point of picking one is that a sync
 * client carries it off the machine — so a key in this file is a paid
 * credential posted to somebody's cloud and then to every device sharing the
 * folder.
 *
 * **The METACOM folder path, and its file count.** This is the licence rule
 * rather than a privacy preference. METACOM is licensed per person and nothing
 * *derived* from somebody's licensed folder may leave the browser — not even
 * an index of it. A path is where their copy lives and a count is a fact about
 * what is in it; both are derived from the folder and neither goes.
 *
 * What does travel is the `metacom:` references the board itself uses, and
 * that is the same line bildhaft's export draws. A reference is a symbol the
 * user chose and put on their own board; an index is an enumeration of what
 * they licensed. The first is their work, the second is the collection. Note
 * what this means on restore, because it is a feature and not a shortfall: a
 * board full of METACOM keys comes back with its references intact and its
 * pictures blank until that person reconnects their own licensed folder. It
 * restores their board. It does not hand anybody METACOM.
 *
 * The pictures in symbols/ are safe to carry for a reason worth stating rather
 * than assuming: METACOM never enters that store. pickSymbol() downloads
 * ARASAAC into it and uploadSymbol() puts the user's own files there, while a
 * METACOM reference is resolved live out of the licensed folder and copied
 * nowhere — see picture() in backend/local.ts.
 */

import * as store from "./store.js";
import type { Layout, Settings } from "../core/types.js";

export const BACKUP_FORMAT = "vorlaut-backup";
/** 2 carries a list of boards; 1 carried the one board there was. Files of
 *  either version are read - see importBackup - because a Sicherung's whole
 *  job is to be readable later than it was written. */
export const BACKUP_VERSION = 2;

export interface StoredSymbol {
  name: string;
  /** base64, no data: prefix — the mime is not knowable and is not needed. */
  data: string;
}

/** The half of Settings that may leave the browser. An allow-list, on purpose. */
export interface SafeSettings {
  activeProvider?: "arasaac" | "metacom";
  metacomRendering?: string | null;
}

/** One board in the file: what it is called, what is on it, and the identity
 *  it keeps. The id travels so that a restore puts the same boards back rather
 *  than copies of them - see exchange/SPEC.md §8 for why that distinction has
 *  teeth. */
export interface BackedCollection {
  id: string;
  name: string;
  layout: Layout;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  /** Every board, not only the one that happened to be open. A file that
   *  carried the open board alone would be a backup that silently loses two
   *  children's talkers out of three. */
  boards: BackedCollection[];
  /** Which of them was open, so a restore opens it again. */
  current: string | null;
  /** Version 1 files have this instead of `boards`, and are still read. */
  layout?: Layout | null;
  symbols: StoredSymbol[];
  settings: SafeSettings;
  notice: string;
}

/** Thrown when the file is from a later vorlaut. A code rather than a
 *  sentence: this module has no language, and the caller has the table. */
export const TOO_NEW = "backup:too-new";

/** Copies across exactly the fields named, and nothing else.
 *
 * Written this way round rather than as a spread with deletions because the
 * two behave identically today and differently the moment a field is added:
 * a spread would ship it, this drops it. The cost of being too careful here is
 * a preference somebody re-picks; the cost of the other mistake is a licence
 * or a credential. */
export function stripSecrets(settings: Partial<Settings>): SafeSettings {
  const safe: SafeSettings = {};
  if (settings.activeProvider) safe.activeProvider = settings.activeProvider;
  if (settings.metacomRendering !== undefined) {
    safe.metacomRendering = settings.metacomRendering;
  }
  return safe;
}

const toBase64 = (bytes: ArrayBuffer): string => {
  // In chunks: String.fromCharCode(...) on a large picture overflows the
  // argument list, and does it at whatever size the browser decides.
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let at = 0; at < view.length; at += 0x8000) {
    binary += String.fromCharCode(...view.subarray(at, at + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (data: string): ArrayBuffer => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes.buffer;
};

/** The notice is passed in rather than written here, and that is the layering
 *  rather than a preference. This module has no language: `t()` reaches the
 *  table through core/boot.js, which reads navigator.languages at import time
 *  and so cannot be loaded by anything that must also run under node - which
 *  the licensing tests do. The caller has both the table and the page's
 *  language, so the caller supplies the sentence. tests/test_language.py
 *  enforces the general form of this: German lives in boot_data.ts alone. */
export async function exportEverything(notice: string): Promise<Backup> {
  const listed = await store.listFiles("symbols");
  const held = await store.readCollections();

  const boards: BackedCollection[] = [];
  for (const board of held.collections) {
    const layout = await store.readLayoutOf(board.id);
    // A row in the list with nothing behind it cannot happen through any write
    // in store.ts - both land in one transaction - but backing up a board of
    // nulls would be worse than backing up one board fewer.
    if (layout) boards.push({ id: board.id, name: board.name, layout });
  }

  const symbols: StoredSymbol[] = [];
  for (const { name } of listed) {
    const bytes = await store.getFile("symbols", name);
    // A name in the listing with nothing behind it is not worth failing a
    // whole backup over; the board draws its grey cross for it either way.
    if (bytes) symbols.push({ name, data: toBase64(bytes) });
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    boards,
    current: held.current,
    symbols,
    settings: stripSecrets(await store.readSettings<Partial<Settings>>({})),
    notice,
  };
}

export const isBackup = (data: unknown): data is Backup =>
  typeof data === "object" && data !== null
  && (data as { format?: unknown }).format === BACKUP_FORMAT;

export interface Restored {
  /** The board that is open now, so the caller can put it on screen without
   *  going back to the store to ask what it just wrote. */
  layout: Layout | null;
  /** How many boards landed, for the sentence the panel says. */
  boards: number;
  symbols: number;
}

/** Puts the browser back the way the file found it.
 *
 * Unlike bildhaft's and mitreden's imports, this one **replaces**. That was
 * argued from there being exactly one board and merging two layouts being a
 * thing nobody could describe; there is a list of them now and the answer has
 * not changed, for a better reason. A merge would have to decide what an
 * arriving board and a stored board with the same id are - the same board
 * twice, or two boards - and every answer to that is a rule the person holding
 * the file cannot see. Replacing is a sentence somebody can be asked to agree
 * to, and the caller is expected to ask first: wireData's import does.
 *
 * A version 1 file carried one board and no id. It arrives as one board with a
 * freshly minted one, which is the honest reading - the file never named an
 * identity, so there is none to keep. */
export async function importBackup(backup: Backup): Promise<Restored> {
  if (typeof backup.version !== "number" || backup.version > BACKUP_VERSION) {
    throw new Error(TOO_NEW);
  }

  // Symbols first. A layout landing before its pictures would draw a board of
  // grey crosses for as long as the restore took, which reads as a failure.
  let restored = 0;
  for (const symbol of backup.symbols ?? []) {
    if (!symbol?.name || typeof symbol.data !== "string") continue;
    try {
      await store.putFile("symbols", symbol.name, fromBase64(symbol.data));
      restored++;
    } catch {
      // One picture that will not decode is not a reason to abandon a board.
    }
  }

  const incoming: store.IncomingCollection[] = backup.boards?.length
    ? backup.boards.map(({ id, name, layout }) => ({ id, name, layout }))
    // Version 1. The board it held, unnamed, with an id minted by the store.
    : backup.layout ? [{ name: "", layout: backup.layout }]
      : [];

  let open: Layout | null = null;
  if (incoming.length) {
    const list = await store.replaceCollections(incoming, backup.current ?? null);
    open = list.current ? await store.readLayoutOf(list.current) : null;
  }

  const held = await store.readSettings<Partial<Settings>>({});
  // Merged onto what is here, not written over it: the settings this file
  // carries are a strict subset, and the ones it deliberately leaves out —
  // the key, the METACOM folder — must survive a restore rather than be
  // cleared by it.
  await store.writeSettings({ ...held, ...stripSecrets(backup.settings ?? {}) } as Settings);

  return { layout: open, boards: incoming.length, symbols: restored };
}

/* --------------------------------------------- one Sammlung out of a file ---
 *
 * The other way in, and it is the opposite act to importBackup above: that one
 * puts a machine back and replaces everything to do it, this one takes a single
 * Sammlung out of a file and stands it beside what is already here.
 *
 * Why the two cannot be one function with a flag. A restore keeps identity -
 * the same boards come back, under the ids they had - and that is what makes it
 * a restore rather than a copy. An import must *not*: the file may well be a
 * Sicherung this same browser wrote an hour ago, and keeping the id would make
 * the arriving Sammlung the stored one, which is a replace by another name.
 * readOneCollection() therefore drops the id and lets store.ts mint a new one,
 * and that difference is the whole of why there are two doors.
 *
 * A Sicherung of several Sammlungen is refused here rather than half-read. It
 * is a whole-library file and the Daten panel is what reads those; picking one
 * board out of nine would be this module guessing which, and there is no answer
 * to that a person holding the file could have predicted.
 */

/** Thrown when the file holds anything other than exactly one Sammlung. A code
 *  rather than a sentence, for the reason TOO_NEW is one: no language here. */
export const NOT_ONE = "backup:not-one";

/** What a Sicherung yields to an import that adds: a Sammlung, without the
 *  identity it had, and the pictures it refers to. */
export interface OneCollection {
  /** What the file called it. The caller falls back to the file's own name
   *  when this is empty, which is what a version 1 file leaves behind. */
  name: string;
  layout: Layout;
  /** Not written here. This function reads; addSymbols() below writes, and the
   *  caller runs it once the Sammlung itself has landed. */
  symbols: StoredSymbol[];
}

/** The one Sammlung in a Sicherung, or a refusal naming what is wrong.
 *
 * `count` on the NOT_ONE error is what the panel needs to say - a file of nine
 * and a file of none are the same code and a different sentence.
 */
export function readOneCollection(backup: Backup): OneCollection {
  if (typeof backup.version !== "number" || backup.version > BACKUP_VERSION) {
    throw new Error(TOO_NEW);
  }

  const boards = backup.boards ?? [];
  // Version 1 held one board and no name for it. It is exactly the case this
  // door is for, so it comes in - unnamed, which the caller answers with the
  // file name.
  if (!boards.length && backup.layout) {
    return { name: "", layout: backup.layout, symbols: backup.symbols ?? [] };
  }
  if (boards.length !== 1) {
    const refusal = new Error(NOT_ONE) as Error & { count: number };
    refusal.count = boards.length;
    throw refusal;
  }

  const only = boards[0]!;
  // The id stays behind. See the note above: an import is a copy.
  return { name: only.name ?? "", layout: only.layout,
           symbols: backup.symbols ?? [] };
}

/** How many of a Sicherung's symbols this browser was missing.
 *
 * Adds only. A name already in the store keeps the bytes it has, and that is
 * not an optimisation: the store is keyed by name, an ARASAAC download and
 * somebody's upload can share one, and overwriting would change a picture on a
 * Sammlung that has nothing to do with this import. Arriving at a board with
 * one grey cross on it is recoverable; a picture silently swapped on another
 * board is not, because nobody is looking at that board today.
 */
export async function addSymbols(symbols: StoredSymbol[]): Promise<number> {
  let added = 0;
  for (const symbol of symbols) {
    if (!symbol?.name || typeof symbol.data !== "string") continue;
    if (await store.getFile("symbols", symbol.name)) continue;
    try {
      await store.putFile("symbols", symbol.name, fromBase64(symbol.data));
      added++;
    } catch {
      // One picture that will not decode is not a reason to lose the board it
      // came with - importBackup takes the same line.
    }
  }
  return added;
}
