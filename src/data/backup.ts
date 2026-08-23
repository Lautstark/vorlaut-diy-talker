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
 * The layout, the pictures in symbols/, and the handful of settings that are
 * preferences. That is the irreplaceable set.
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
export const BACKUP_VERSION = 1;

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

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  layout: Layout | null;
  symbols: StoredSymbol[];
  settings: SafeSettings;
  notice: string;
}

const NOTICE =
  "Diese Datei enthält das Board, die eigenen und die ARASAAC-Bilder sowie "
  + "einige Einstellungen. Nicht enthalten sind METACOM-Bilder und der Pfad zum "
  + "METACOM-Ordner — METACOM ist personengebunden lizenziert. Ein "
  + "Azure-Schlüssel ist ebenfalls nicht enthalten. Beides muss nach dem "
  + "Wiederherstellen neu verbunden werden.";

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

export async function exportEverything(): Promise<Backup> {
  const held = await store.readLayout();
  const listed = await store.listFiles("symbols");

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
    layout: held.layout,
    symbols,
    settings: stripSecrets(await store.readSettings<Partial<Settings>>({})),
    notice: NOTICE,
  };
}

export const isBackup = (data: unknown): data is Backup =>
  typeof data === "object" && data !== null
  && (data as { format?: unknown }).format === BACKUP_FORMAT;

export interface Restored {
  /** The board that landed, so the caller can put it on screen without going
   *  back to the store to ask what it just wrote. */
  layout: Layout | null;
  symbols: number;
}

/** Puts the browser back the way the file found it.
 *
 * Unlike bildhaft's and mitreden's imports, this one **replaces**. It is the
 * honest shape for what vorlaut holds: there is one board, not a library of
 * them, and merging two layouts is not a thing anybody could describe. The
 * caller is expected to have asked first — wireBoard's import already does
 * exactly that for an .obz, and this follows it. */
export async function importBackup(backup: Backup): Promise<Restored> {
  if (typeof backup.version !== "number" || backup.version > BACKUP_VERSION) {
    throw new Error("Diese Datei stammt aus einer neueren Version von vorlaut.");
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

  if (backup.layout) {
    // null, not a version: this write is meant to land on whatever is there.
    await store.writeLayout(backup.layout, null);
  }

  const held = await store.readSettings<Partial<Settings>>({});
  // Merged onto what is here, not written over it: the settings this file
  // carries are a strict subset, and the ones it deliberately leaves out —
  // the key, the METACOM folder — must survive a restore rather than be
  // cleared by it.
  await store.writeSettings({ ...held, ...stripSecrets(backup.settings ?? {}) } as Settings);

  return { layout: backup.layout ?? null, symbols: restored };
}
