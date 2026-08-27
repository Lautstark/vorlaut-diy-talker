/* The half of adr/0015 that has to work when the other half does not.
 *
 * A reader in data/rescue.ts recognises the shape a database is in, and there
 * is exactly one thing to do when none of them does: nothing. Abort the
 * upgrade, leave the browser at the version and the records it had, and say so
 * - because the alternative is carrying records across that nobody has
 * understood, which is a silent corruption rather than a loud stop.
 *
 * This is the failure the arrangement is *designed* to have. Somebody bumps
 * DB_VERSION, changes what a store holds, and does not write a reader; what
 * they get is a page that will not start, in the minute after they do it,
 * instead of a wipe that nobody sees until a carer writes in. So it is worth
 * more than the happy path, and it is tested the same way: a database on disk
 * in a shape this code has never seen, and then ordinary questions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { asFile, isUnreadable, RESCUE_FORMAT } from "../../src/data/rescue.js";

const DB_NAME = "vorlaut";

type Store = typeof import("../../src/data/store.js");

const wipe = (): Promise<void> => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve();
  request.onblocked = () => reject(new Error("blocked"));
});

/** A database at a version below the current one, in whatever shape the caller
 *  describes. `seed` runs inside the upgrade, so it may create stores. */
function seed(version: number,
              build: (db: IDBDatabase) => void,
              fill: (db: IDBDatabase) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => build(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      fill(db);
      // fill() opens its own transaction; closing after a turn of the loop is
      // enough here because every put in it is already queued.
      setTimeout(() => { db.close(); resolve(); }, 0);
    };
  });
}

const inspect = (): Promise<{ version: number; stores: string[] }> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const seen = { version: db.version, stores: [...db.objectStoreNames].sort() };
      db.close();
      resolve(seen);
    };
  });

let store: Store;

/** A fresh module and a fresh database for each case. store.ts memoises its
 *  connection and remembers whether somebody has agreed to a discard, and both
 *  of those are exactly what one case must not hand the next. */
async function restart(version: number,
                       build: (db: IDBDatabase) => void,
                       fill: (db: IDBDatabase) => void): Promise<void> {
  await wipe();
  await seed(version, build, fill);
  vi.resetModules();
  store = await import("../../src/data/store.js");
}

describe("a database in a shape no reader recognises", () => {
  beforeEach(async () => {
    await restart(3,
      (db) => { db.createObjectStore("boards", { keyPath: "id" }); },
      (db) => {
        const tx = db.transaction("boards", "readwrite");
        tx.objectStore("boards").put({ id: "one", whatever: "a shape from the future" });
      });
  });

  it("refuses to open, saying which failure it is", async () => {
    await expect(store.readCollections()).rejects.toSatisfy(isUnreadable);
  });

  it("changes nothing - the version and the records are still there", async () => {
    await expect(store.readCollections()).rejects.toThrow();
    const seen = await inspect();
    expect(seen.version).toBe(3);
    expect(seen.stores).toEqual(["boards"]);
  });

  it("hands the records over, so somebody has them before they agree to anything",
     async () => {
       await expect(store.readCollections()).rejects.toThrow();
       const dump = await store.dumpEverything();
       expect(dump.version).toBe(3);
       expect(dump.stores["boards"]?.values)
         .toEqual([{ id: "one", whatever: "a shape from the future" }]);

       const file = asFile(dump, "a notice") as { format: string };
       expect(file.format).toBe(RESCUE_FORMAT);
       // It has to survive the one thing it is for.
       expect(JSON.parse(JSON.stringify(file))).toMatchObject({ version: 3 });
     });

  it("upgrades once somebody has said to discard, and not before", async () => {
    await expect(store.readCollections()).rejects.toThrow();
    store.discardEverything();

    const list = await store.readCollections();
    expect(list.collections).toHaveLength(0);
    const seen = await inspect();
    expect(seen.version).toBe(4);
    expect(seen.stores).toEqual(["collections", "layouts", "marks", "settings", "symbols"]);
  });
});

describe("a database whose store names are familiar and whose records are not", () => {
  /* The case store names alone cannot catch, and the reason a reader
   * validates. A later version that keeps `collections` and `layouts` and
   * changes what goes in them would sail past a match on names and carry
   * something nobody has understood into the live schema. */
  beforeEach(async () => {
    await restart(3,
      (db) => {
        db.createObjectStore("collections", { keyPath: "id" })
          .createIndex("updatedAt", "updatedAt");
        db.createObjectStore("layouts", { keyPath: "id" });
        db.createObjectStore("marks");
      },
      (db) => {
        const tx = db.transaction(["collections", "layouts"], "readwrite");
        tx.objectStore("collections").put({ id: "one", name: "Kitchen", updatedAt: 1 });
        // No `text`, no `version`: a layout as some later version might hold
        // one, and not as this one can read it.
        tx.objectStore("layouts").put({ id: "one", grid: [[1, 2], [3, 4]] });
      });
  });

  it("refuses rather than carrying records it has not understood", async () => {
    await expect(store.readCollections()).rejects.toSatisfy(isUnreadable);
    expect((await inspect()).version).toBe(3);
  });
});
