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

import type { CollectionList, CollectionRef, HeldLayout, Layout, SaveResult, Settings }
  from "../core/types.js";

/** The three object stores this database has. Named rather than left as a
 *  string, so that a typo is a compile error instead of a silent empty read. */
export type StoreName = "symbols" | "data" | "speech";

const DB_NAME = "vorlaut";
const DB_VERSION = 2;

// Named for the folders in content/, deliberately.
const CONTENT = "content";      // the Sammlungen and the settings, one record each
const SYMBOLS = "symbols";      // what /api/pick and /api/upload put in symbols/
const DATA = "data";            // what a build puts in data/, for the cable

/** Where the one layout lived while there was only one. Read by the migration
 *  in migrate() and by nothing else; see the note there. */
const ONE_LAYOUT = "layout";
const LIST = "collections";     // the list, and which of them is open
const SETTINGS = "settings";
const BUILT = "built";          // the layout version a build last ran against

/** One Sammlung's layout, by id. A prefix rather than a store of its own: the
 *  registry and the layouts have to move together when one is made or deleted,
 *  and one object store is one transaction. */
const layoutKey = (id: string): string => `layout:${id}`;

/** A Sammlung's identity, minted once and never derived from its contents.
 *
 * crypto.randomUUID() rather than a counter or a hash of the name: two of them
 * may share a name, a name may be renamed, and a duplicate must not be able to
 * collide with its original. See exchange/SPEC.md §8 for what this value is
 * eventually for. */
const mintId = (): string => crypto.randomUUID();

const NO_LIST: CollectionList = { collections: [], current: null };

// The same sentinel app.py answers with for a layout.json that is not there,
// so that "nothing saved yet" reads the same on both sides.
const EMPTY = "empty";

/* --- Change ------------------------------------------------------------------
 *
 * Every write that changes what a Sicherung would contain says so here, and
 * the standing backup listens.
 *
 * The alternative was calling schedule() from each place in the interface that
 * edits something, and it is the wrong shape: the next one would be added by
 * somebody who had never heard of the backup, nothing would fail, and a
 * child's talker would quietly stop being saved. That is this feature's whole
 * failure mode, so the notifier sits at the writes.
 *
 * Two writes deliberately stay quiet, and both are worth naming rather than
 * discovering. recordBuild() only stamps which layout a build ran against.
 * Anything in data/ is build output, which a build makes again out of the
 * layout and the symbols - so neither is in the backup, and announcing them
 * would rewrite the file to say nothing new. */
const watchers = new Set<() => void>();

export function onChanged(listener: () => void): () => void {
  watchers.add(listener);
  return () => watchers.delete(listener);
}

function touched(): void {
  for (const listener of watchers) listener();
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  // One connection, reused. Opening per call works and costs a round trip
  // through the database on every keystroke's worth of saving.
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (const name of [CONTENT, SYMBOLS, DATA]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      // The versionchange transaction, which is the only one that exists here
      // and is the one everything below has to run inside.
      migrate(request.transaction!, event.oldVersion);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

/* The work somebody already has, kept.
 *
 * Version 1 of this database held one layout, under one key. Version 2 holds a
 * list, and every Sammlung's layout under a key of its own. Somebody who opened
 * this page yesterday has a talker's worth of work under the old key, and an
 * upgrade that quietly started from an empty list would look exactly like the
 * browser having thrown the storage away - which store.ts warns can genuinely
 * happen, and which is the one failure nobody would question.
 *
 * So the record moves across whole, stamp and all: the version in it is a hash
 * of the bytes, the build stamp is compared against that hash, and rewriting
 * the record here - even to identical bytes - would be a new stamp and a build
 * that suddenly claimed to be stale. What arrives is the first Sammlung, open,
 * and unnamed - the name it is given comes from the shell, because a name
 * invented down here would be in whichever language this file does not have.
 *
 * In the upgrade transaction rather than lazily on first read, so it happens
 * once, before anything can read half of it, and cannot be interleaved with a
 * write. It is guarded on the registry rather than on the version number as
 * well, which costs one get and means a half-finished upgrade re-runs cleanly.
 *
 * tests/unit/store_migration.test.ts opens a real version 1 database, puts a
 * layout in it, and asks for it back through the ordinary reads.
 */
function migrate(tx: IDBTransaction, from: number): void {
  // 0 is a database that did not exist. There is nothing to carry, and
  // loadLayout() seeds the first one through the ordinary path.
  if (from < 1) return;
  const content = tx.objectStore(CONTENT);
  const listed = content.get(LIST);
  listed.onsuccess = () => {
    if (listed.result) return;                 // already a list
    const held = content.get(ONE_LAYOUT);
    held.onsuccess = () => {
      if (!held.result) return;                // nothing was ever saved
      const id = mintId();
      content.put(held.result, layoutKey(id));
      content.put({ collections: [{ id, name: "" }], current: id } as CollectionList, LIST);
      // Deleted rather than left as a second copy: two records claiming to be
      // it is how a later reader picks the wrong one.
      content.delete(ONE_LAYOUT);
    };
  };
}

// Everything here goes through one of these, and the shape is not decoration.
//
// An IndexedDB transaction stays open only while requests are outstanding on
// it: let the microtask queue drain with nothing pending and it commits by
// itself. So `await` on anything that is not an IndexedDB request - a digest,
// a fetch, a timer - ends the transaction underneath the code that thinks it
// is still inside one. That is why work() below is callback-shaped in a file
// where everything else is async, and why the hashing in writeLayout happens
// before the transaction rather than inside it.
/** What one transaction collects. The keys are whatever the callback puts
 *  there, which is why this is an index signature rather than a shape: each
 *  caller reads back exactly the fields it wrote. `conflict` is named because
 *  the abort handler above reads it and a typo there would look like a real
 *  failure. */
interface Collected {
  conflict?: boolean;
  [key: string]: any;
}

function run(db: IDBDatabase, names: string[], mode: IDBTransactionMode,
             work: (tx: IDBTransaction, out: Collected) => void): Promise<Collected> {
  return new Promise<Collected>((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const box: Collected = {};
    tx.oncomplete = () => resolve(box);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => {
      // A conflict aborts on purpose - see writeLayout - and is an answer
      // rather than a failure. Anything else that aborts is a failure.
      if (box.conflict) resolve(box);
      else reject(tx.error || new Error("storage transaction aborted"));
    };
    work(tx, box);
  });
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
 * definition and a version means the same kind of thing wherever it is read. */
export async function versionOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

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

/** Newest first, where "new" means last written.
 *
 * The order the sidebar shows, decided here rather than there so that every
 * reader gets the same one. Creation order answers a question nobody asks: what
 * a list of Sammlungen is for is getting back to the one you were in, and after
 * a handful that is reliably the one at the bottom.
 *
 * A Sammlung carried across from the single-layout database has no stamp and
 * sorts last, which is right - it has not been touched since. */
const byNewest = (a: CollectionRef, b: CollectionRef): number =>
  (b.updatedAt ?? 0) - (a.updatedAt ?? 0);

/** The next stamp: now, or one past the highest there is, whichever is later.
 *
 * Date.now() alone is a millisecond clock, and "last written first" is supposed
 * to be a total order. Two writes inside one millisecond get the same number,
 * the sort is left stable, and the list quietly answers with insertion order -
 * which is the order this is meant to replace. A person cannot type that fast;
 * a loop can, and so can a test, and a rule that holds for people and not for
 * machines is one nobody can check. */
const nextStamp = (list: CollectionList): number =>
  Math.max(Date.now(), Math.max(0, ...list.collections.map((one) => one.updatedAt ?? 0)) + 1);

export async function readCollections(): Promise<CollectionList> {
  const db = await open();
  const box = await run(db, [CONTENT], "readonly", (tx, out) => {
    const held = tx.objectStore(CONTENT).get(LIST);
    held.onsuccess = () => { out.list = held.result || null; };
  });
  const list = (box.list as CollectionList) || NO_LIST;
  return { ...list, collections: [...list.collections].sort(byNewest) };
}

/** A new Sammlung, holding the layout it was handed, open straight away.
 *
 * The layout comes from the caller because what an empty one is depends on
 * the device - see core/editor.ts. This file knows how to keep one and nothing
 * about what is in it. */
export async function createCollection(name: string, layout: Layout): Promise<string> {
  const text = serialise(layout);
  const version = await versionOf(text);
  const id = mintId();

  const db = await open();
  await run(db, [CONTENT], "readwrite", (tx) => {
    const store = tx.objectStore(CONTENT);
    const listed = store.get(LIST);
    listed.onsuccess = () => {
      const list = (listed.result as CollectionList) || NO_LIST;
      store.put({ text, version }, layoutKey(id));
      store.put({ collections: [...list.collections, { id, name, updatedAt: nextStamp(list) }],
                  current: id }, LIST);
    };
  });
  touched();
  return id;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const db = await open();
  await run(db, [CONTENT], "readwrite", (tx) => {
    const store = tx.objectStore(CONTENT);
    const listed = store.get(LIST);
    listed.onsuccess = () => {
      const list = (listed.result as CollectionList) || NO_LIST;
      if (!list.collections.some((one) => one.id === id)) return;
      store.put({
        ...list,
        collections: list.collections.map(
          (one) => one.id === id ? { ...one, name, updatedAt: nextStamp(list) } : one),
      }, LIST);
    };
  });
  touched();
}

/** Gone, with its layout.
 *
 * What is open afterwards is the one that took its place in the list, or the
 * last one if it was the last - never nothing while there is still one to
 * show. Deleting the last one leaves the list empty on purpose: loadLayout()
 * seeds a fresh one, which is what a first visit gets, and is a better answer
 * than a page with nothing on it.
 */
export async function deleteCollection(id: string): Promise<void> {
  const db = await open();
  await run(db, [CONTENT], "readwrite", (tx) => {
    const store = tx.objectStore(CONTENT);
    const listed = store.get(LIST);
    listed.onsuccess = () => {
      const list = (listed.result as CollectionList) || NO_LIST;
      const at = list.collections.findIndex((one) => one.id === id);
      if (at < 0) return;
      const left = list.collections.filter((one) => one.id !== id);
      const current = list.current !== id ? list.current
        : left.length ? left[Math.min(at, left.length - 1)]!.id
          : null;
      store.delete(layoutKey(id));
      store.put({ collections: left, current }, LIST);
    };
  });
  touched();
}

/** Which Sammlung the page is editing. */
export async function useCollection(id: string): Promise<void> {
  const db = await open();
  await run(db, [CONTENT], "readwrite", (tx) => {
    const store = tx.objectStore(CONTENT);
    const listed = store.get(LIST);
    listed.onsuccess = () => {
      const list = (listed.result as CollectionList) || NO_LIST;
      if (!list.collections.some((one) => one.id === id)) return;
      store.put({ ...list, current: id }, LIST);
    };
  });
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
  // Hashed before the transaction, like every other write here - see run().
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
  await run(db, [CONTENT], "readwrite", (tx) => {
    const store = tx.objectStore(CONTENT);
    const listed = store.get(LIST);
    listed.onsuccess = () => {
      for (const one of ((listed.result as CollectionList) || NO_LIST).collections) {
        store.delete(layoutKey(one.id));
      }
      for (const one of written) {
        store.put({ text: one.text, version: one.version }, layoutKey(one.id));
      }
      store.put(list, LIST);
    };
  });
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
  const box = await run(db, [CONTENT], "readonly", (tx, out) => {
    const held = tx.objectStore(CONTENT).get(layoutKey(id));
    held.onsuccess = () => { out.record = held.result || null; };
  });
  return box.record ? JSON.parse(box.record.text) : null;
}

export async function readLayout(): Promise<HeldLayout> {
  const db = await open();
  const box = await run(db, [CONTENT], "readonly", (tx, out) => {
    const store = tx.objectStore(CONTENT);
    out.record = null;
    const listed = store.get(LIST);
    listed.onsuccess = () => {
      const current = ((listed.result as CollectionList) || NO_LIST).current;
      if (!current) return;
      const held = store.get(layoutKey(current));
      held.onsuccess = () => { out.record = held.result || null; };
    };
    const built = store.get(BUILT);
    built.onsuccess = () => { out.built = built.result || null; };
  });
  if (!box.record) return { layout: null, version: EMPTY, buildCurrent: "0" };
  return {
    layout: JSON.parse(box.record.text),
    version: box.record.version,
    buildCurrent: box.built === box.record.version ? "1" : "0",
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
 * something this function has to be careful about. */
export async function writeLayout(layout: Layout, expected: string | null): Promise<SaveResult> {
  // Outside the transaction, deliberately - see run().
  const text = serialise(layout);
  const version = await versionOf(text);

  const db = await open();
  return run(db, [CONTENT], "readwrite", (tx, out) => {
    const store = tx.objectStore(CONTENT);
    const listed = store.get(LIST);
    listed.onsuccess = () => {
      const list = (listed.result as CollectionList) || NO_LIST;
      // A write with no board to write to makes one. That is the first visit -
      // loadLayout() seeds a board by writing it - and it happens here rather
      // than in the seam so that the registry and the layout land in the one
      // transaction: a board in the list with no layout behind it is a row
      // that opens onto nothing.
      let id = list.current;
      if (!id) {
        id = mintId();
        store.put({ collections: [...list.collections, { id, name: "", updatedAt: nextStamp(list) }],
                    current: id }, LIST);
      } else {
        // Every write is a touch, which is what the sidebar orders by. Written
        // into the same transaction as the layout, so the two cannot disagree
        // about whether an edit happened.
        const at = nextStamp(list);
        store.put({
          ...list,
          collections: list.collections.map((one) => one.id === id ? { ...one, updatedAt: at } : one),
        }, LIST);
      }
      const held = store.get(layoutKey(id));
      held.onsuccess = () => {
        const current = held.result ? held.result.version : EMPTY;
        if (expected && expected !== current) {
          out.conflict = true;
          tx.abort();
          return;
        }
        store.put({ text, version }, layoutKey(id!));
        const built = store.get(BUILT);
        built.onsuccess = () => {
          out.conflict = false;
          out.saved = JSON.parse(text);
          out.version = version;
          out.buildCurrent = built.result === version ? "1" : "0";
        };
      };
    };
  }).then((result) => {
    // Only a write that actually landed. A conflict wrote nothing, and
    // announcing one would back up the layout this tab lost.
    if (!result.conflict) touched();
    return result;
  });
}

export async function readSettings<T extends object>(fallback: T = {} as T): Promise<T> {
  const db = await open();
  const box = await run(db, [CONTENT], "readonly", (tx, out) => {
    const held = tx.objectStore(CONTENT).get(SETTINGS);
    held.onsuccess = () => { out.value = held.result; };
  });
  return box.value === undefined ? fallback : box.value;
}

export async function writeSettings(settings: Settings): Promise<Settings> {
  const db = await open();
  await run(db, [CONTENT], "readwrite", (tx) => {
    tx.objectStore(CONTENT).put(settings, SETTINGS);
  });
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
 * its own once the build moves in here and can compute the real fingerprint. */
export async function recordBuild(version: string | null): Promise<void> {
  const db = await open();
  await run(db, [CONTENT], "readwrite", (tx) => {
    tx.objectStore(CONTENT).put(version, BUILT);
  });
}

// --- The two folders of files ------------------------------------------------
//
// symbols/ is pictures somebody chose; data/ is what a build made out of them.
// Kept apart for the reason they are two folders on disk: a build empties the
// second and must never be able to reach the first.

const FOLDERS = { symbols: SYMBOLS, data: DATA };

function folder(which) {
  const name = FOLDERS[which];
  if (!name) throw new Error(`no such folder: ${which}`);
  return name;
}

export async function putFile(which: StoreName, name: string, bytes: ArrayBuffer): Promise<void> {
  const db = await open();
  await run(db, [folder(which)], "readwrite", (tx) => {
    tx.objectStore(folder(which)).put(bytes, name);
  });
  // symbols/ is pictures somebody chose and is in the backup; data/ is what a
  // build made out of them and is not.
  if (which === "symbols") touched();
}

export async function getFile(which: StoreName, name: string): Promise<ArrayBuffer | null> {
  const db = await open();
  const box = await run(db, [folder(which)], "readonly", (tx, out) => {
    const held = tx.objectStore(folder(which)).get(name);
    held.onsuccess = () => { out.value = held.result; };
  });
  return box.value === undefined ? null : box.value;
}

/** Names and sizes, in the shape the manifest wants. */
export async function listFiles(which: StoreName): Promise<{ name: string; size: number }[]> {
  const db = await open();
  const box = await run(db, [folder(which)], "readonly", (tx, out) => {
    out.files = [];
    const store = tx.objectStore(folder(which));
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      const all = store.getAll();
      all.onsuccess = () => {
        out.files = keys.result.map((name, i) => ({
          name,
          size: all.result[i] ? all.result[i].byteLength : 0,
        }));
      };
    };
  });
  return box.files.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export async function dropFile(which: StoreName, name: string): Promise<void> {
  const db = await open();
  await run(db, [folder(which)], "readwrite", (tx) => {
    tx.objectStore(folder(which)).delete(name);
  });
  if (which === "symbols") touched();
}

/** Everything, gone. What a build does to data/ before it fills it again. */
export async function empty(which: StoreName): Promise<void> {
  const db = await open();
  await run(db, [folder(which)], "readwrite", (tx) => {
    tx.objectStore(folder(which)).clear();
  });
  // A build empties data/ before it fills it again, which is the common case
  // here and is not news. Emptying symbols/ is.
  if (which === "symbols") touched();
}
