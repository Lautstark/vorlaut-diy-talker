/* The half of adr/0015 that has to work when the other half does not.
 *
 * data/migrations.ts has one step per version. There are exactly two ways for
 * that list to fail a database, and both have the same answer: do nothing.
 * Abort the upgrade, leave the browser at the version and the records it had,
 * and say so.
 *
 *   * **No step for a version** it has to cross. Somebody bumped DB_VERSION
 *     and did not write the migration. This is the one that will actually
 *     happen, and it is why plan() refuses rather than skipping: skipping
 *     would leave records in a shape the new code does not expect, silently,
 *     which is worse than a stop.
 *   * **A database that is not the shape its version claims.** The step's
 *     precondition. Not a second dispatch - the version still decides which
 *     steps run - but a step asked to reorganise stores that are not there
 *     would write into something nobody has described.
 *
 * This is a failure the arrangement is *designed* to have, which is why it is
 * tested harder than the happy path: what somebody gets for forgetting is a
 * page that will not start, in the minute after they do it, instead of a wipe
 * nobody sees until a carer writes in.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRefusal, MISSING_STEP, plan, STEPS } from "../../src/data/migrations.js";
import { asFile, RESCUE_FORMAT } from "../../src/data/rescue.js";

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

describe("a database that is not the shape its version claims", () => {
  beforeEach(async () => {
    await restart(3,
      (db) => { db.createObjectStore("boards", { keyPath: "id" }); },
      (db) => {
        const tx = db.transaction("boards", "readwrite");
        tx.objectStore("boards").put({ id: "one", whatever: "a shape from the future" });
      });
  });

  it("refuses to open, saying which failure it is", async () => {
    // Version 3 means the step to 4 runs, and that step expects the stores
    // version 3 defines. They are not there.
    await expect(store.readCollections()).rejects.toSatisfy(isRefusal);
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

describe("a version with no step for it", () => {
  /* The case that will actually happen: DB_VERSION goes up and the migration
   * does not get written. It cannot be seeded today - versions 1 to 4 all have
   * their steps - so plan() takes the list as a parameter and this hands it one
   * with a hole in it. Testing the guard against a gap this repository happens
   * not to have would be testing nothing.
   *
   * A test that only asserted `plan(3, 4)` works would pass with the refusal
   * deleted. */
  it("refuses rather than skipping it", () => {
    const holed = STEPS.filter((step) => step.to !== 3);
    expect(() => plan(1, 4, holed)).toThrow(MISSING_STEP);
    expect(plan(1, 4).map((step) => step.to)).toEqual([2, 3, 4]);
  });

  it("asks for nothing when a database is already here", () => {
    expect(plan(4, 4)).toEqual([]);
  });
});
