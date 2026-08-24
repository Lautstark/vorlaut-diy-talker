// Where the content lives once there is no server under it.
//
// app.py keeps four things on disk: content/layout.json, content/symbols/,
// content/data/ and the build stamp in content/cache/. This is the same four
// in the browser, named after the folders they stand in for, so that reading
// one against the other stays possible while both exist.
//
// One of the four has grown a dimension since. There is a *list* of Sammlungen
// now - one per child, one per room - so where content/layout.json was one file,
// this holds a registry and a layout per Sammlung. The two folders underneath are
// not per Sammlung and are not meant to be: symbols/ is a picture store keyed by
// name, and two Sammlungen using the same ARASAAC symbol should hold one copy
// of it; data/ is one build, because one Sammlung at a time goes on the device.
//
// IndexedDB rather than the File System Access API, and that is a decision
// rather than a default. A folder the user picks is the nicer story - it is
// theirs, they can see it, a backup finds it - but it is Chromium only, and a
// builder that cannot be opened in Safari is a smaller thing than one that
// can. The cable needs Chromium regardless; making a Sammlung should not.
// The folder picker is still here for METACOM, where there is no alternative:
// that collection is licensed, lives outside, and is read where it lies.
//
// What this costs, and it should be said plainly rather than discovered: a
// browser may throw an IndexedDB away. Safari evicts script-written storage
// for sites that go unvisited, and no page is told before it happens. So this
// is where the content lives, not where it is safe, and an export somebody can
// put somewhere real is owed before anyone keeps a child's talker in here
// alone. That is data/backup.ts, and it carries every Sammlung rather than the
// one that happens to be open - a backup that saved one talker out of three
// would be worse than none, because it would look like one.
//
// --- Through `idb`, and in stores rather than in one record -------------------
//
// conventions.md §2.1, which vorlaut was the product diverging from: `idb@^8`,
// a typed schema, real object stores with indexes. Both halves earned their
// way in here rather than being adopted for tidiness.
//
// The stores. This file used to keep the whole registry as one record and every
// Sammlung's layout under a `layout:<id>` key beside it, in a single `content`
// store. Every read of the list was a read of the whole list and every write to
// it a rewrite of the whole list, and the two ways of naming a thing - a record
// per key, a prefix inside a key - had to be held in the head at once. A store
// per kind says the same thing in the database's own vocabulary: `collections`
// is one record per Sammlung, `layouts` is one record per layout, and the two
// line up by id. What that buys immediately is the ordering (§1.4, last edited
// first): it is an index on `updatedAt` now, so the sidebar's order is a range
// the database walks and the next stamp is one cursor to the end of it, rather
// than a sort and a Math.max over every Sammlung there is.
//
// The library. `idb` does not remove IndexedDB's one real trap - a transaction
// stays open only while requests are outstanding on it, so awaiting anything
// that is not a request on *that* transaction commits it underneath code that
// believes it is still inside one. What it does is make the safe shape the
// natural one to write: `await` on `tx.objectStore(...).get(...)` is a request
// on the transaction and keeps it alive, and everything that is not one - the
// hashing in writeLayout, the base64 in a restore - is visibly outside. The
// rule still has to be known. It is known in one place across three products
// rather than learned separately in each.
//
// There is no migration into this shape and there is not meant to be. See
// DB_VERSION below.

import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore, type StoreNames }
  from "idb";
import type { CollectionList, CollectionRef, HeldLayout, Layout, SaveResult, Settings }
  from "../core/types.js";
import { touched } from "./changed.js";

/** The two picture folders, as the callers name them. Was three: a `speech`
 *  member sat here with nothing behind it in the database, so every call naming
 *  it would have thrown at run time. The typed schema is what makes that a
 *  compile error, and removing the member is the first thing it caught. */
export type StoreName = "symbols" | "data";

const DB_NAME = "vorlaut";

/* Version 3, and it starts from nothing.
 *
 * 1 held one layout under one key; 2 held a registry and `layout:<id>` beside
 * it; 3 is the schema below. There is no carrying-across between 2 and 3, and
 * that is the decision rather than an omission - conventions.md's rule about
 * its own rules: these products have one user, who is the person writing them,
 * and where a design is right it is adopted and the old one deleted in the same
 * change. A browser that has been here before opens this version, loses what it
 * had, and gets a first visit. Somebody who wanted to keep a board across the
 * change had data/backup.ts to write it out with, which is what that file is
 * for and is a better answer than a migration nobody will read again.
 *
 * So the upgrade drops *every* store it finds, including symbols/ and data/,
 * whose shape has not changed. Keeping them would leave a browser holding
 * pictures for boards that no longer exist and a build of a layout that is
 * gone - half-old, which is the state this repository has decided not to have.
 * One statement, and afterwards a database that reads exactly like a fresh one.
 */
const DB_VERSION = 3;

/** One Sammlung's layout, as it is stored: the bytes and the stamp over them.
 *  The id is in the record rather than only in the key, because the store has
 *  a keyPath - see VorlautDB - and an id that only exists as a key cannot be read
 *  back off a value somebody is holding. */
interface StoredLayout {
  id: string;
  text: string;
  version: string;
}

/** The two things this database remembers that are neither content nor
 *  preference: which Sammlung is open, and which layout the build in data/ was
 *  made from. Both are a name written down so a later read can compare against
 *  it, which is why they are one store and not two.
 *
 *  `current` here rather than inside the settings record is where vorlaut reads
 *  conventions.md §1.2 to its intent rather than its letter. The rule is that
 *  it is persisted in the database with the preferences, against localStorage
 *  and against module state; it is, and it is one transaction away from the
 *  registry it points into, which is what matters when a Sammlung is deleted.
 *  Putting it in the Settings object would make every settings save a save that
 *  can move which board is open - and writeSettings() replaces the record. */
type MarkName = "current" | "built";

interface VorlautDB extends DBSchema {
  /** One record per Sammlung: what it is called and when it was last written.
   *  Not what is on it - that is `layouts`, and the split is what makes drawing
   *  the sidebar a read of names rather than a read of every board. */
  collections: {
    key: string;
    value: CollectionRef;
    /** The order the sidebar shows (§1.4) and the source of the next stamp.
     *  This is the index the store-per-kind was worth having: both readers walk
     *  it from one end, and neither loads a layout to do it. */
    indexes: { updatedAt: number };
  };
  layouts: { key: string; value: StoredLayout };
  /** One record, and it is the whole of Settings. A store of its own rather
   *  than a key among the marks because it is the one thing here with a shape
   *  the rest of the app writes down - see core/types.ts. */
  settings: { key: typeof SETTINGS; value: Settings };
  marks: { key: MarkName; value: string | null };
  /** What /api/pick and /api/upload put in symbols/, by name. */
  symbols: { key: string; value: ArrayBuffer };
  /** What a build puts in data/, for the cable. */
  data: { key: string; value: ArrayBuffer };
}

const COLLECTIONS = "collections";
const LAYOUTS = "layouts";
const MARKS = "marks";
const SETTINGS = "settings";
const BY_UPDATED = "updatedAt";

const CURRENT: MarkName = "current";
const BUILT: MarkName = "built";

/** The stores a write to a board touches. One tuple, so the three operations
 *  that have to move the registry and a layout together cannot be written with
 *  one of them left out - which is a row in the sidebar that opens onto
 *  nothing, or a layout no row names. */
const BOARDS = [COLLECTIONS, LAYOUTS, MARKS] as const;

/** A Sammlung's identity, minted once and never derived from its contents.
 *
 * crypto.randomUUID() rather than a counter or a hash of the name: two of them
 * may share a name, a name may be renamed, and a duplicate must not be able to
 * collide with its original. conventions.md §1.1 settles this for all three
 * products; see exchange/SPEC.md §8 for what this value is eventually for. */
const mintId = (): string => crypto.randomUUID();

// The same sentinel app.py answers with for a layout.json that is not there,
// so that "nothing saved yet" reads the same on both sides.
const EMPTY = "empty";

let opening: Promise<IDBPDatabase<VorlautDB>> | null = null;

/** Somebody to tell when the database cannot be opened at all.
 *
 * A notifier rather than a message, for the reason data/changed.ts gives about
 * its own: this file may not reach into the page, and the sentence a person
 * reads is in the text table with every other sentence. app.ts is what joins
 * the two ends. */
const stuck = new Set<() => void>();

/** Listen for a database that is being held open elsewhere. The returned
 *  function stops listening. */
export function onBlocked(listener: () => void): () => void {
  stuck.add(listener);
  return () => stuck.delete(listener);
}

function open(): Promise<IDBPDatabase<VorlautDB>> {
  // One connection, reused. Opening per call works and costs a round trip
  // through the database on every keystroke's worth of saving.
  if (opening) return opening;
  const pending = openDB<VorlautDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Snapshotted before the loop: objectStoreNames is live, and deleting
      // through it skips every other name.
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);

      // keyPath rather than an out-of-line key for the two stores whose values
      // carry their own id. It is one fewer place for the key and the record to
      // disagree, and it is what lets a read hand back a CollectionRef that is
      // complete on its own.
      db.createObjectStore(COLLECTIONS, { keyPath: "id" })
        .createIndex(BY_UPDATED, BY_UPDATED);
      db.createObjectStore(LAYOUTS, { keyPath: "id" });
      // Out-of-line: a Settings object has no id, an ArrayBuffer cannot have
      // one, and a mark is a bare string.
      db.createObjectStore(SETTINGS);
      db.createObjectStore(MARKS);
      db.createObjectStore("symbols");
      db.createObjectStore("data");
    },

    /* The three that were not here, and the first one is why a browser that
     * had been here before could open this page onto nothing.
     *
     * indexedDB.open() at a higher version does not fail when an older
     * connection is still held somewhere - it fires `blocked` and waits, with
     * no timeout and no error. Without this callback that wait is a promise
     * which never settles, so every await in this file hangs for as long as
     * the tab lives: no boards in the sidebar, no seed board made, the labels
     * left in whatever language the browser guessed because load() never got
     * far enough to adopt the one in the layout, and the buttons that would
     * fix it all waiting on the same promise. The .catch() in app.ts cannot
     * report it either - a promise that never settles never rejects. Shipped
     * exactly that way on 2026-08-24, when DB_VERSION went to 3 while a tab
     * from before the change was still open on version 2.
     *
     * The close() docstring below has described this hazard for
     * deleteDatabase() all along. It is the same hazard on the open. */
    blocked() {
      for (const listener of stuck) listener();
    },

    /* The other end of it, and the half that actually cures it: this tab is
     * now the stale one, holding the version a newer tab is waiting on. Let
     * go, and it stops waiting - no reload, and nothing for anybody to read.
     * close() lets transactions already in flight finish first.
     *
     * `opening` is dropped with it so the next call here opens again rather
     * than handing out a connection that is on its way shut. That reopen is
     * lazy: a tab nobody is touching stays out of the way.
     *
     * This is what would have kept 2026-08-24 from happening at all - except
     * that the tab doing the blocking was running the build from before this
     * code existed, which is exactly why `blocked` above has to stand on its
     * own rather than trust the other side to yield. */
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
      opening = null;
    },

    /* The connection died under us - the browser reclaiming storage, or the
     * user clearing site data from another tab. Forgetting it is the whole
     * repair: the next call opens a new one. */
    terminated() {
      opening = null;
    },
  });
  // A rejected open must not be the answer for the rest of the tab's life.
  // opening is memoised, so without this one failure - a browser refusing
  // storage in a private window, an upgrade that threw - would be handed to
  // every later call forever, and nothing could retry. Guarded on identity so
  // a slow failure cannot clear a newer attempt that has already replaced it.
  pending.catch(() => { if (opening === pending) opening = null; });
  opening = pending;
  return pending;
}

/** Let go of the connection.
 *
 * The page never needs this - one connection for as long as the tab lives is
 * the right arrangement, which is why open() caches it. A bench does need it:
 * indexedDB.deleteDatabase() waits for every open connection to close and
 * fires onblocked rather than failing, so a tab still holding one turns "start
 * again from nothing" into a hang with no error anywhere. Found exactly that
 * way. */
export async function close(): Promise<void> {
  if (!opening) return;
  const db = await opening;
  opening = null;
  db.close();
}

/** The layout as the bytes that get hashed and stored.
 *
 * Indented and newline-terminated because this is the thing an export will
 * hand somebody, and a diff of it should be readable. */
export function serialise(layout: Layout): string {
  return JSON.stringify(layout, null, 2) + "\n";
}

/** The same stamp app.py's layout_version() computes: sha256 of the stored
 * bytes, first sixteen hex characters.
 *
 * The same algorithm rather than the same number - the two stores hold their
 * own bytes and are not expected to agree - so that the one concept has one
 * definition and a version means the same kind of thing wherever it is read.
 *
 * Every caller awaits this *outside* a transaction, and that is not a style
 * choice: crypto.subtle.digest is not an IndexedDB request, so awaiting it
 * inside one lets the transaction commit underneath. See the head of this file. */
export async function versionOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** A name safe to write down: as a key in the symbols store, or as the file
 *  name a download arrives under.
 *
 * Here rather than in the two places that used to hold the same expression,
 * because this is where the first of them is: a picture somebody uploads
 * becomes a key in an object store, and what a key may contain is the store's
 * question. A slash in one reads like a folder that is not there.
 *
 * conventions.md §5 #3 pairs this with `touched()`; mitreden's and bildhaft's
 * are download-filename sanitisers and this is both, which is the shape the
 * eventual shared one has to have. Deliberately not the same as their
 * transliterating `slug` - a symbol's key has to survive a round trip through
 * a Sicherung and an .obz unchanged, so it maps what it cannot keep to `_`
 * rather than trying to spell it. */
export const safeName = (name: string): string => name.replace(/[^\w.-]+/g, "_");

/* --- The list ------------------------------------------------------
 *
 * One page edits one Sammlung at a time, and which one is a fact about this
 * browser rather than about any of them - so it is stored beside the list
 * rather than passed into every read. readLayout() and writeLayout() therefore
 * keep the signatures they had while there was only ever one: they mean "the
 * one in force", and everything that used them still means what it said.
 *
 * The alternative was an id argument on both, threaded through the seam, the
 * save loop and the build. That reads as though a caller could sensibly write
 * to a Sammlung other than the one on screen, and none of them can: the input
 * fields hang off state.layout, and a write elsewhere would be a save nobody
 * could see land.
 */

/** The collections store, whichever transaction it came out of. Written as a
 *  generic rather than a fixed transaction type so that the operations reading
 *  one store and the operations reading three can both hand theirs over. */
type CollectionStore<Names extends ArrayLike<StoreNames<VorlautDB>>,
                     Mode extends IDBTransactionMode> =
  IDBPObjectStore<VorlautDB, Names, typeof COLLECTIONS, Mode>;

/** Newest first, where "new" means last written.
 *
 * The order the sidebar shows, decided here rather than there so that every
 * reader gets the same one. Creation order answers a question nobody asks: what
 * a list of Sammlungen is for is getting back to the one you were in, and after
 * a handful that is reliably the one at the bottom. conventions.md §1.4.
 *
 * Read off the index rather than sorted after the fact. getAll() on an index
 * walks it in ascending key order, so this is one reverse() rather than a
 * comparator over a list that has already been loaded whole. */
async function listOf<Names extends ArrayLike<StoreNames<VorlautDB>>,
                      Mode extends IDBTransactionMode>(
  collections: CollectionStore<Names, Mode>,
): Promise<CollectionRef[]> {
  return (await collections.index(BY_UPDATED).getAll()).reverse();
}

/** The next stamp: now, or one past the highest there is, whichever is later.
 *
 * Date.now() alone is a millisecond clock, and "last written first" is supposed
 * to be a total order. Two writes inside one millisecond get the same number,
 * the sort is left stable, and the list quietly answers with insertion order -
 * which is the order this is meant to replace. A person cannot type that fast;
 * a loop can, and so can a test, and a rule that holds for people and not for
 * machines is one nobody can check.
 *
 * The highest there is comes off the end of the index, which is one cursor step
 * rather than a Math.max over every Sammlung. */
async function nextStamp<Names extends ArrayLike<StoreNames<VorlautDB>>>(
  collections: CollectionStore<Names, "readwrite">,
): Promise<number> {
  const newest = await collections.index(BY_UPDATED).openKeyCursor(null, "prev");
  return Math.max(Date.now(), (newest ? newest.key : 0) + 1);
}

export async function readCollections(): Promise<CollectionList> {
  const db = await open();
  const tx = db.transaction([COLLECTIONS, MARKS], "readonly");
  const collections = await listOf(tx.objectStore(COLLECTIONS));
  const current = await tx.objectStore(MARKS).get(CURRENT);
  await tx.done;
  // A mark that was never written and one deliberately set to null both mean
  // the same thing, and it is the thing CollectionList.current documents.
  return { collections, current: current ?? null };
}

/** A new Sammlung, holding the layout it was handed, open straight away.
 *
 * The layout comes from the caller because what an empty one is depends on
 * the device - see core/editor.ts. This file knows how to keep one and nothing
 * about what is in it. */
export async function createCollection(name: string, layout: Layout): Promise<string> {
  // Hashed before the transaction, deliberately - see versionOf().
  const text = serialise(layout);
  const version = await versionOf(text);
  const id = mintId();

  const db = await open();
  const tx = db.transaction(BOARDS, "readwrite");
  const collections = tx.objectStore(COLLECTIONS);
  // The registry row, the layout and "this is the open one" in one transaction:
  // a row with nothing behind it is a sidebar entry that opens onto nothing.
  await collections.put({ id, name, updatedAt: await nextStamp(collections) });
  await tx.objectStore(LAYOUTS).put({ id, text, version });
  await tx.objectStore(MARKS).put(id, CURRENT);
  await tx.done;

  touched();
  return id;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([COLLECTIONS], "readwrite");
  const collections = tx.objectStore(COLLECTIONS);
  const held = await collections.get(id);
  if (held) await collections.put({ ...held, name, updatedAt: await nextStamp(collections) });
  await tx.done;
  touched();
}

/** Gone, with its layout.
 *
 * What is open afterwards is the one that took its place in the list, or the
 * last one if it was the last - never nothing while there is still one to
 * show. Deleting the last one leaves the list empty on purpose: loadLayout()
 * seeds a fresh one, which is what a first visit gets, and is a better answer
 * than a page with nothing on it.
 *
 * "Took its place" is measured in the order the sidebar draws - last edited
 * first - which is the order the person doing the deleting is looking at. It
 * used to be the order the records happened to sit in the registry array, and
 * that was never anything anybody could see; with a record per Sammlung there
 * is no such order left to accidentally mean.
 */
export async function deleteCollection(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(BOARDS, "readwrite");
  const collections = tx.objectStore(COLLECTIONS);
  const marks = tx.objectStore(MARKS);

  const shown = await listOf(collections);
  const at = shown.findIndex((one) => one.id === id);
  if (at >= 0) {
    const left = shown.filter((one) => one.id !== id);
    await collections.delete(id);
    await tx.objectStore(LAYOUTS).delete(id);
    if (await marks.get(CURRENT) === id) {
      await marks.put(left.length ? left[Math.min(at, left.length - 1)]!.id : null, CURRENT);
    }
  }
  await tx.done;
  touched();
}

/** Which Sammlung the page is editing. */
export async function useCollection(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([COLLECTIONS, MARKS], "readwrite");
  // Checked against the registry in the same transaction, so that "open this
  // one" cannot land on a Sammlung that was deleted while the click travelled.
  if (await tx.objectStore(COLLECTIONS).get(id)) {
    await tx.objectStore(MARKS).put(id, CURRENT);
  }
  await tx.done;
  // Which one is open is part of what a Sicherung puts back, so it counts as
  // a change to it. Debounced inside Sicherung, so clicking down a list of
  // them is one file rather than one per click.
  touched();
}

/** What a restore hands over: a Sammlung, and its id if the file carried one.
 *
 * A backup written by this version carries ids and they are kept - a restore
 * puts the same Sammlungen back, not copies of them, and the id is what says so.
 * A backup from the single-layout version has none, so one is minted here
 * rather than in the importer: this file is where ids come from. */
export interface IncomingCollection {
  id?: string;
  name: string;
  /** When the file says it was last written. Absent on a file that predates
   *  the field, and then it arrives as touched now - which is honest: this
   *  browser has just seen it for the first time. */
  updatedAt?: number;
  layout: Layout;
}

/** Every Sammlung, replaced by these.
 *
 * Wholesale rather than merged, which is data/backup.ts's decision and its
 * note says why. What this file adds is that it happens in one transaction:
 * a restore that failed halfway between deleting and writing would leave a
 * browser with no board at all, and the whole point of the file is to be the
 * way back from that.
 */
export async function replaceCollections(incoming: IncomingCollection[],
                                    current: string | null): Promise<CollectionList> {
  // Hashed before the transaction, like every other write here - see versionOf().
  const written = [];
  for (const one of incoming) {
    const text = serialise(one.layout);
    written.push({ id: one.id || mintId(), name: one.name, text,
                   updatedAt: one.updatedAt ?? Date.now(),
                   version: await versionOf(text) });
  }
  const list: CollectionList = {
    collections: written.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })),
    // A named board that is not in the file is not the one to open.
    current: written.some((one) => one.id === current) ? current
      : written.length ? written[0]!.id : null,
  };

  const db = await open();
  const tx = db.transaction(BOARDS, "readwrite");
  const collections = tx.objectStore(COLLECTIONS);
  const layouts = tx.objectStore(LAYOUTS);
  // Emptied rather than walked and deleted one id at a time: what "replace"
  // means is that nothing which was here survives, and clear() is the database
  // saying so rather than this function being thorough.
  await collections.clear();
  await layouts.clear();
  for (const one of written) {
    await collections.put({ id: one.id, name: one.name, updatedAt: one.updatedAt });
    await layouts.put({ id: one.id, text: one.text, version: one.version });
  }
  await tx.objectStore(MARKS).put(list.current, CURRENT);
  await tx.done;

  touched();
  return list;
}

/** One board's layout by id, without making it the one in force.
 *
 * The backup is the caller: it carries every board, and reading them one at a
 * time through "the one in force" would mean switching to back them
 * up, which is a side effect on the page nobody asked for. */
export async function readLayoutOf(id: string): Promise<Layout | null> {
  const db = await open();
  const held = await db.get(LAYOUTS, id);
  return held ? JSON.parse(held.text) : null;
}

export async function readLayout(): Promise<HeldLayout> {
  const db = await open();
  const tx = db.transaction([LAYOUTS, MARKS], "readonly");
  const marks = tx.objectStore(MARKS);
  const current = await marks.get(CURRENT);
  const held = current ? await tx.objectStore(LAYOUTS).get(current) : undefined;
  const built = await marks.get(BUILT);
  await tx.done;

  if (!held) return { layout: null, version: EMPTY, buildCurrent: "0" };
  return {
    layout: JSON.parse(held.text),
    version: held.version,
    buildCurrent: built === held.version ? "1" : "0",
  };
}

/** Write, unless somebody else wrote first.
 *
 * `expected` is the version the caller last saw. If the stored one has moved
 * since, nothing is written and {conflict: true} comes back - the same answer
 * app.py gives with a 409, and for the same reason: two tabs of this page are
 * two writers, exactly as two threads were on the server.
 *
 * app.py needed a lock around read-compare-write. Here the transaction is the
 * lock, and a conflict calls abort() rather than merely declining to put(), so
 * that "nothing was written" is something the database guarantees instead of
 * something this function has to be careful about. That is not belt and braces:
 * a first write mints a Sammlung *before* there is a stored version to compare
 * against, so by the time the comparison happens there is already a registry row
 * and an open board to take back. */
export async function writeLayout(layout: Layout, expected: string | null): Promise<SaveResult> {
  // Outside the transaction, deliberately - see versionOf().
  const text = serialise(layout);
  const version = await versionOf(text);

  const db = await open();
  const tx = db.transaction(BOARDS, "readwrite");
  const collections = tx.objectStore(COLLECTIONS);
  const layouts = tx.objectStore(LAYOUTS);
  const marks = tx.objectStore(MARKS);

  let id = await marks.get(CURRENT);
  if (!id) {
    // A write with no board to write to makes one. That is the first visit -
    // loadLayout() seeds a board by writing it - and it happens here rather
    // than in the seam so that the registry and the layout land in the one
    // transaction: a board in the list with no layout behind it is a row
    // that opens onto nothing.
    id = mintId();
    await collections.put({ id, name: "", updatedAt: await nextStamp(collections) });
    await marks.put(id, CURRENT);
  } else {
    // Every write is a touch, which is what the sidebar orders by. Written
    // into the same transaction as the layout, so the two cannot disagree
    // about whether an edit happened.
    const held = await collections.get(id);
    if (held) await collections.put({ ...held, updatedAt: await nextStamp(collections) });
  }

  const held = await layouts.get(id);
  if (expected && expected !== (held ? held.version : EMPTY)) {
    tx.abort();
    // The abort is this function's own doing, so its rejection is the answer
    // rather than a failure. Anything else that aborts a transaction here still
    // rejects out of the awaits above, which is what a real failure should do.
    await tx.done.catch(() => {});
    return { conflict: true };
  }

  await layouts.put({ id, text, version });
  const built = await marks.get(BUILT);
  await tx.done;

  // Only a write that actually landed. A conflict wrote nothing, and
  // announcing one would back up the layout this tab lost.
  touched();
  return {
    conflict: false,
    saved: JSON.parse(text),
    version,
    buildCurrent: built === version ? "1" : "0",
  };
}

export async function readSettings<T extends object>(fallback: T = {} as T): Promise<T> {
  const db = await open();
  const held = await db.get(SETTINGS, SETTINGS);
  // Cast because the callers know narrower shapes than the record does - a
  // Partial<Settings> for the backup, a single field for a test. The store's
  // own type is the whole of Settings, which is what a write has to be.
  return held === undefined ? fallback : (held as unknown as T);
}

export async function writeSettings(settings: Settings): Promise<Settings> {
  const db = await open();
  await db.put(SETTINGS, settings, SETTINGS);
  touched();
  return settings;
}

/** What a finished build records, so the page can say whether one is due.
 *
 * The server compares a fingerprint over the active sets alone, so that
 * editing a switched-off set does not claim the device is stale. This compares
 * the whole layout, which is stricter: it will sometimes say a build is due
 * where app.py would say it is current. That is the safe direction - and the
 * same one build_current_flag() takes when it cannot tell - and it tightens on
 * its own once the build moves in here and can compute the real fingerprint.
 *
 * Quiet, deliberately. It stamps which layout a build ran against and changes
 * nothing a Sicherung carries; announcing it would rewrite the backup file to
 * say nothing new. */
export async function recordBuild(version: string | null): Promise<void> {
  const db = await open();
  await db.put(MARKS, version, BUILT);
}

// --- The two folders of files ------------------------------------------------
//
// symbols/ is pictures somebody chose; data/ is what a build made out of them.
// Kept apart for the reason they are two folders on disk: a build empties the
// second and must never be able to reach the first. Two stores rather than one
// store with prefixed keys, and that is the same argument the registry makes
// above: a boundary the database enforces is one nothing has to remember.
//
// Which of the two announces is the other half of it. symbols/ is content and
// is in the backup; data/ is build output, which a build makes again out of the
// layout and the symbols, and announcing it would rewrite the file once per
// artefact to say nothing new.

const announces = (which: StoreName): boolean => which === "symbols";

export async function putFile(which: StoreName, name: string, bytes: ArrayBuffer): Promise<void> {
  const db = await open();
  await db.put(which, bytes, name);
  if (announces(which)) touched();
}

export async function getFile(which: StoreName, name: string): Promise<ArrayBuffer | null> {
  const db = await open();
  const held = await db.get(which, name);
  return held === undefined ? null : held;
}

/** Names and sizes, in the shape the manifest wants.
 *
 * Already in name order: getAllKeys() walks the store's own keys, which
 * IndexedDB orders exactly as JavaScript compares two strings. The sort this
 * used to end with was re-deciding an order it had just been handed. */
export async function listFiles(which: StoreName): Promise<{ name: string; size: number }[]> {
  const db = await open();
  const tx = db.transaction(which, "readonly");
  const names = await tx.store.getAllKeys();
  const held = await tx.store.getAll();
  await tx.done;
  return names.map((name, i) => ({ name, size: held[i] ? held[i]!.byteLength : 0 }));
}

export async function dropFile(which: StoreName, name: string): Promise<void> {
  const db = await open();
  await db.delete(which, name);
  if (announces(which)) touched();
}

/** Everything, gone. What a build does to data/ before it fills it again. */
export async function empty(which: StoreName): Promise<void> {
  const db = await open();
  await db.clear(which);
  // A build empties data/ before it fills it again, which is the common case
  // here and is not news. Emptying symbols/ is.
  if (announces(which)) touched();
}
