// Where the content lives once there is no server under it.
//
// app.py keeps four things on disk: content/layout.json, content/symbols/,
// content/data/ and the build stamp in content/cache/. This is the same four
// in the browser, named after the folders they stand in for, so that reading
// one against the other stays possible while both exist.
//
// IndexedDB rather than the File System Access API, and that is a decision
// rather than a default. A folder the user picks is the nicer story - it is
// theirs, they can see it, a backup finds it - but it is Chromium only, and a
// board designer that cannot be opened in Safari is a smaller thing than one
// that can. The cable needs Chromium regardless; designing a board should not.
// The folder picker is still here for METACOM, where there is no alternative:
// that collection is licensed, lives outside, and is read where it lies.
//
// What this costs, and it should be said plainly rather than discovered: a
// browser may throw an IndexedDB away. Safari evicts script-written storage
// for sites that go unvisited, and no page is told before it happens. So this
// is where the content lives, not where it is safe, and an export somebody can
// put somewhere real is owed before anyone keeps a child's talker in here
// alone. That is not built yet and is the next thing after this.

import type { HeldLayout, Layout, SaveResult, Settings } from "../core/types.js";

/** The three object stores this database has. Named rather than left as a
 *  string, so that a typo is a compile error instead of a silent empty read. */
export type StoreName = "symbols" | "data" | "speech";

const DB_NAME = "vorlaut";
const DB_VERSION = 1;

// Named for the folders in content/, deliberately.
const CONTENT = "content";      // layout.json and the settings, one record each
const SYMBOLS = "symbols";      // what /api/pick and /api/upload put in symbols/
const DATA = "data";            // what a build puts in data/, for the cable

const LAYOUT = "layout";
const SETTINGS = "settings";
const BUILT = "built";          // the layout version a build last ran against

// The same sentinel app.py answers with for a layout.json that is not there,
// so that "nothing saved yet" reads the same on both sides.
const EMPTY = "empty";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  // One connection, reused. Opening per call works and costs a round trip
  // through the database on every keystroke's worth of saving.
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [CONTENT, SYMBOLS, DATA]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
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

export async function readLayout(): Promise<HeldLayout> {
  const db = await open();
  const box = await run(db, [CONTENT], "readonly", (tx, out) => {
    const store = tx.objectStore(CONTENT);
    const held = store.get(LAYOUT);
    held.onsuccess = () => { out.record = held.result || null; };
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
    const held = store.get(LAYOUT);
    held.onsuccess = () => {
      const current = held.result ? held.result.version : EMPTY;
      if (expected && expected !== current) {
        out.conflict = true;
        tx.abort();
        return;
      }
      store.put({ text, version }, LAYOUT);
      const built = store.get(BUILT);
      built.onsuccess = () => {
        out.conflict = false;
        out.saved = JSON.parse(text);
        out.version = version;
        out.buildCurrent = built.result === version ? "1" : "0";
      };
    };
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
}

/** Everything, gone. What a build does to data/ before it fills it again. */
export async function empty(which: StoreName): Promise<void> {
  const db = await open();
  await run(db, [folder(which)], "readwrite", (tx) => {
    tx.objectStore(folder(which)).clear();
  });
}
