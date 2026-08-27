/** Reading a database this code did not write, so that an upgrade can keep it.
 *
 * ## Why this file is separate, and what it may not do
 *
 * adr/0015 decided that a `DB_VERSION` bump carries somebody's boards across
 * inside the `versionchange` transaction, or aborts it and changes nothing.
 * That transaction is the whole point: everything in it commits together, and
 * an abort leaves the database at its *old version with its old contents*.
 * There is no other place in IndexedDB that hands that guarantee over.
 *
 * The price is a rule with no exceptions, and it is the reason this module is
 * pure functions over records rather than anything that reaches for a browser:
 *
 * > **Nothing on the upgrade path may `await` anything that is not a request on
 * > that transaction.**
 *
 * A transaction stays open only while requests are outstanding on it, so one
 * `await` on a `crypto.subtle` digest, a `btoa`, a folder write or a question
 * put to a person commits it underneath code that believes it is still inside
 * one - and then the drop has landed and the write-back has not. The head of
 * store.ts documents that trap in general. Here it is load-bearing.
 *
 * Nothing here needs to break it, and that is a fact about the data rather
 * than luck: a stored layout carries its own `text` and its own `version`, so
 * nothing is re-hashed; a picture is an ArrayBuffer, so nothing is base64-ed;
 * `updatedAt` is a number. See asFile() at the foot of this file for the one
 * thing that does need `btoa`, and note where it is allowed to run.
 *
 * ## One reader per shape, not one step per version
 *
 * The classic migration is a chain - `if (old < 2) ... if (old < 3) ...` -
 * where each step turns the previous shape into the next. Every step is
 * written against a shape that no longer exists anywhere in the code, so
 * nothing type-checks it, it runs only for a browser exactly that far behind,
 * and it has to keep working forever.
 *
 * These readers do the other thing: recognise whatever is there, hand back one
 * value, and let store.ts write that through the schema the compiler can see.
 * They are also fewer, because a shape outlives a version - `content` covers
 * 1 and 2, `stores` covers 3 and 4, so two readers cover four versions, and
 * DB_VERSION going to 4 needed no new one at all.
 *
 * A reader **validates** what it reads. Matching on store names alone would
 * let a later version that keeps the names and changes the records carry
 * garbage across, silently, which is a worse failure than the one this file
 * exists to remove. A record that does not check out is an unrecognised shape,
 * and an unrecognised shape aborts the upgrade.
 */

/** Every store in a database, as it was found. Keys and values separately
 *  because half of these stores have no keyPath and the key is the name. */
export interface Dump {
  version: number;
  stores: Record<string, { keys: IDBValidKey[]; values: unknown[] }>;
}

/** One Sammlung on its way across.
 *
 * The layout travels as the bytes that were stored and the stamp that was
 * stored over them, rather than as a parsed Layout: they are a matched pair
 * already, re-hashing is not allowed here (see the head of this file), and
 * carrying the pair verbatim is both cheaper and more honest than re-deriving
 * one half of it. A reader that ever *reshapes* a layout breaks the pairing
 * and has to say so. */
export interface SalvagedBoard {
  id: string;
  name: string;
  updatedAt: number;
  text: string;
  version: string;
}

export interface SalvagedSymbol {
  name: string;
  bytes: ArrayBuffer;
}

/** A whole browser, in the shape the current schema can be written from. */
export interface Salvage {
  /** The version it was read out of, for the sentence the page says. */
  from: number;
  boards: SalvagedBoard[];
  current: string | null;
  /** The **whole** settings record, not the safe half of it.
   *
   *  data/backup.ts strips the Azure key and the METACOM folder path because
   *  what it makes is a file, and a file goes into a folder a sync client
   *  carries off the machine. This never leaves the browser it was read in -
   *  it goes from one object store to another, in one transaction - so
   *  stripping it here would cost somebody their key and their folder for no
   *  gain at all. asFile() below is the path that does leave, and it strips. */
  settings: unknown;
  symbols: SalvagedSymbol[];
}

/** Thrown when no reader recognises what is in the database. A code rather
 *  than a sentence: this module has no language, and the caller has the table.
 *
 *  What it means at the call site is *do not touch this database* - store.ts
 *  aborts the upgrade transaction, and the browser keeps the version and the
 *  records it had. */
export const UNREADABLE = "store:unreadable";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const str = (value: unknown): value is string => typeof value === "string";

/** The pictures, from the store whose shape has never changed. */
function symbolsIn(dump: Dump): SalvagedSymbol[] {
  const held = dump.stores["symbols"];
  if (!held) return [];
  const out: SalvagedSymbol[] = [];
  held.keys.forEach((key, at) => {
    const bytes = held.values[at];
    // A key that is not a name, or bytes that are not bytes, is one picture
    // rather than a reason to refuse a whole database: the board draws its
    // grey cross for it, which data/backup.ts takes the same line on.
    if (str(key) && bytes instanceof ArrayBuffer) out.push({ name: key, bytes });
  });
  return out;
}

/** The value under an out-of-line key, in a store that has no keyPath. */
function at(dump: Dump, store: string, key: string): unknown {
  const held = dump.stores[store];
  if (!held) return undefined;
  const which = held.keys.indexOf(key);
  return which < 0 ? undefined : held.values[which];
}

/** Versions 3 and 4: a store per kind.
 *
 * `collections` is one CollectionRef per Sammlung, `layouts` is one record per
 * layout, and the two line up by id. `marks` holds which one is open;
 * `settings` holds the one record the app writes. */
function fromStores(dump: Dump): Salvage {
  const layouts = new Map<string, { text: string; version: string }>();
  for (const value of dump.stores["layouts"]?.values ?? []) {
    if (!isRecord(value) || !str(value["id"]) || !str(value["text"]) || !str(value["version"])) {
      throw new Error(UNREADABLE);
    }
    layouts.set(value["id"], { text: value["text"], version: value["version"] });
  }

  const boards: SalvagedBoard[] = [];
  for (const value of dump.stores["collections"]?.values ?? []) {
    if (!isRecord(value) || !str(value["id"]) || !str(value["name"])) throw new Error(UNREADABLE);
    const layout = layouts.get(value["id"]);
    // A row with nothing behind it cannot happen through any write in
    // store.ts - both land in one transaction - but carrying a Sammlung of
    // nulls across would be worse than carrying one Sammlung fewer.
    if (!layout) continue;
    boards.push({
      id: value["id"],
      name: value["name"],
      updatedAt: typeof value["updatedAt"] === "number" ? value["updatedAt"] : Date.now(),
      ...layout,
    });
  }

  const current = at(dump, "marks", "current");
  return {
    from: dump.version,
    boards,
    current: str(current) ? current : null,
    settings: at(dump, "settings", "settings"),
    symbols: symbolsIn(dump),
  };
}

/** Versions 1 and 2: everything in one `content` store, keyed by prefix.
 *
 * 2 held the registry under `collections` and every layout under
 * `layout:<id>`; 1 held the one layout there was under `layout`, with no
 * registry and no name for it. Both arrive here, because the difference
 * between them is which keys are present rather than what a record looks
 * like. */
function fromContent(dump: Dump, mint: () => string): Salvage {
  const held = dump.stores["content"];
  const layouts = new Map<string, { text: string; version: string }>();
  let loose: SalvagedBoard | null = null;

  held?.keys.forEach((key, index) => {
    if (!str(key) || (key !== "layout" && !key.startsWith("layout:"))) return;
    const value = held.values[index];
    if (!isRecord(value) || !str(value["text"]) || !str(value["version"])) {
      throw new Error(UNREADABLE);
    }
    const one = { text: value["text"], version: value["version"] };
    if (key !== "layout") layouts.set(key.slice("layout:".length), one);
    // Version 1's single layout. It never had an identity, so it is given one
    // here rather than pretending to keep one - and it is minted through
    // store.ts's minter, because that file is where ids come from.
    else loose = { id: mint(), name: "", updatedAt: Date.now(), ...one };
  });

  const registry = at(dump, "content", "collections");
  const listed = isRecord(registry) && Array.isArray(registry["collections"])
    ? registry["collections"] : [];

  const boards: SalvagedBoard[] = [];
  /* The stamps this shape never had.
   *
   * Version 2's registry was an array in insertion order and carried no
   * `updatedAt` at all - the index on it is what version 3 added. The sidebar
   * draws last-written first, so counting *down* from now keeps the order the
   * person was looking at rather than turning it upside down. */
  const now = Date.now();
  listed.forEach((row, index) => {
    if (!isRecord(row) || !str(row["id"])) throw new Error(UNREADABLE);
    const layout = layouts.get(row["id"]);
    if (!layout) return;
    boards.push({
      id: row["id"],
      name: str(row["name"]) ? row["name"] : "",
      updatedAt: now - index,
      ...layout,
    });
  });

  // A version 1 database has no registry at all, so its one layout is the
  // whole of what there is to carry.
  if (loose && !boards.length) boards.push(loose);

  const current = isRecord(registry) && str(registry["current"]) ? registry["current"] : null;
  return {
    from: dump.version,
    boards,
    current,
    settings: at(dump, "content", "settings"),
    // `built` is deliberately not carried: it is the layout version a build
    // last ran against, and adr/0011 removed the thing that wrote it.
    symbols: symbolsIn(dump),
  };
}

/** What this database holds, in the shape the live schema can be written from.
 *
 * `null` where there is nothing to carry - a database that has just been
 * created, or one whose stores are all empty. That is not the same as an
 * unrecognised shape, and the difference is the difference between a first
 * visit and a refusal: throwing UNREADABLE here stops an upgrade dead, so it
 * must mean *there is something here and I do not know what it is*.
 */
export function readShape(dump: Dump, mint: () => string): Salvage | null {
  const held = Object.values(dump.stores);
  if (!held.some((store) => store.values.length > 0)) return null;

  if (dump.stores["collections"] && dump.stores["layouts"]) return fromStores(dump);
  if (dump.stores["content"]) return fromContent(dump, mint);
  throw new Error(UNREADABLE);
}

/** Whether an error is the refusal above, wherever it surfaced. */
export const isUnreadable = (error: unknown): boolean =>
  error instanceof Error && error.message === UNREADABLE;

/* --- and the one thing that is allowed to leave ------------------------------
 *
 * When no reader recognises the database, the upgrade aborts and nothing is
 * destroyed - but the person is then looking at a page that will not start,
 * and what they are owed before they agree to discard anything is the contents
 * in a file. This is that file.
 *
 * It is *not* a Sicherung. A Sicherung is a documented format with a reader;
 * this is a raw dump of records nothing in this repository knows the shape of,
 * which is exactly why it exists. Anybody restoring from it is reading it by
 * hand, and the file says so in its own `notice`.
 *
 * The base64 here is the reason this function may only ever be called from
 * outside the upgrade transaction. See the head of this file.
 */
export const RESCUE_FORMAT = "vorlaut-rescue";

const toBase64 = (bytes: ArrayBuffer): string => {
  // In chunks, for the reason data/backup.ts gives: fromCharCode(...) on a
  // large picture overflows the argument list at whatever size the browser
  // decides.
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let from = 0; from < view.length; from += 0x8000) {
    binary += String.fromCharCode(...view.subarray(from, from + 0x8000));
  }
  return btoa(binary);
};

/** Every record, with the bytes spelled out, ready for JSON.stringify.
 *
 * The settings record travels **stripped of nothing**, because unlike a
 * Sicherung this file is not written into a synced folder by this code - a
 * person asks for it, once, on a page that is refusing to start. The notice is
 * passed in for the reason data/backup.ts's is: this module has no language. */
export function asFile(dump: Dump, notice: string): unknown {
  const stores: Record<string, { key: unknown; value: unknown }[]> = {};
  for (const [name, held] of Object.entries(dump.stores)) {
    stores[name] = held.keys.map((key, at) => {
      const value = held.values[at];
      return {
        key: typeof key === "string" || typeof key === "number" ? key : String(key),
        value: value instanceof ArrayBuffer ? { base64: toBase64(value) } : value,
      };
    });
  }
  return { format: RESCUE_FORMAT, version: dump.version,
           exportedAt: new Date().toISOString(), notice, stores };
}
