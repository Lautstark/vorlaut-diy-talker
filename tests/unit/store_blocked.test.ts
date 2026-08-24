import { beforeAll, describe, expect, it } from "vitest";

/* The failure that has no error in it.
 *
 * indexedDB.open() at a higher version than a connection somebody else is
 * still holding does not fail. It fires `blocked` and waits - no timeout, no
 * rejection, nothing in the console. A page whose store is opened lazily and
 * awaited everywhere then has one promise that never settles, and every read
 * and every write in the tab waits on it for as long as the tab lives.
 *
 * That is what shipped on 2026-08-24: DB_VERSION went to 3 while a tab from
 * before the change was still open on version 2. The page came up looking
 * like an ordinary first visit - an empty sidebar, no board, labels in
 * whatever language the browser had guessed because load() never reached the
 * one in the layout - and the buttons that would have made a board were
 * waiting on the same promise as everything else. The .catch() in app.ts
 * could not report it: a promise that never settles never rejects.
 *
 * So what is under test here is not that the database opens. It is that being
 * unable to open one is *sayable* - and that the tab doing the blocking gets
 * out of the way by itself when it is running this code rather than the build
 * from before it.
 *
 * The held connection below is a raw one with no onversionchange handler,
 * deliberately: that is the old build, and it is the case blocked() has to
 * survive without help from the other side.
 */

const DB_NAME = "vorlaut";

/** A version-2 database, held open the way a stale tab holds one. */
function holdVersionTwo(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["content", "symbols", "data"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onerror = () => reject(request.error);
    // Resolved without closing: holding it is the whole point.
    request.onsuccess = () => resolve(request.result);
  });
}

/** Lets the event loop turn until `done()` is true, or gives up. Whether a
 *  blocked event has landed is not knowable from the call that caused it -
 *  there is nothing to await, which is the property this file is about. */
async function until(done: () => boolean, turns = 50): Promise<boolean> {
  for (let i = 0; i < turns; i++) {
    if (done()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return done();
}

/* Imported after the older database is open, for the reason
 * store_schema.test.ts gives: store.ts opens lazily, and importing it first
 * would leave this file testing a database it had already opened cleanly. */
let store: typeof import("../../src/data/store.js");
let stale: IDBDatabase;

beforeAll(async () => {
  stale = await holdVersionTwo();
  store = await import("../../src/data/store.js");
});

describe("a database another connection is holding at an older version", () => {
  let told = 0;
  let waiting: Promise<unknown>;

  it("says so, instead of waiting where nobody can see it", async () => {
    store.onBlocked(() => { told++; });

    // Not awaited: awaiting it here is precisely the hang. The call is what
    // starts the open, and the assertion is about what happens without it
    // ever coming back.
    waiting = store.readCollections();

    expect(await until(() => told > 0)).toBe(true);
  });

  /* And it is a wait rather than a failure, so the page recovers on its own
   * the moment the other connection lets go - no reload, and the call that
   * was made before any of it comes back with the right answer. */
  it("goes through by itself once the other connection closes", async () => {
    stale.close();
    const list = await waiting;
    expect(list).toBeTruthy();
    expect((list as { collections: unknown[] }).collections).toHaveLength(0);
  });

  /* The other end. This connection is now the old one, and a newer version
   * asking for the database must not have to wait on it: blocking() closes it.
   *
   * Version 4 is a stand-in for whatever DB_VERSION becomes next. If it were
   * ever to be 4 for real this test would still be asking the right question,
   * because the version it opens is one the store does not hold. */
  it("lets go when a newer version needs the database", async () => {
    // Make sure this tab really is holding a connection to let go of.
    await store.readCollections();

    let blocked = false;
    const next = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 4);
      request.onblocked = () => { blocked = true; };
      request.onupgradeneeded = () => { /* the shape does not matter here */ };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    expect(blocked).toBe(false);
    expect(next.version).toBe(4);
    next.close();
  });
});
