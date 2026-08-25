import { beforeAll, describe, expect, it } from "vitest";
import type { Layout } from "../../src/core/types.js";

/* The database somebody already had, and what version 3 does with it: nothing.
 *
 * This file replaces a test that asserted the opposite. Version 2 carried
 * version 1's single layout across, key by key, because a returning user's
 * evenings of work would otherwise have looked exactly like the browser having
 * thrown the storage away. Version 3 does not, and the reason it does not is a
 * decision rather than an omission - conventions.md's rule about its own rules:
 * one user, disposable data, no migrations, and the old shape deleted in the
 * change that adopts the new one. data/backup.ts is how anything worth keeping
 * crosses a change like this, and it is a better answer than a migration that
 * nobody reads a second time.
 *
 * So what is under test is that the drop is clean rather than that it happens:
 * an upgrade that threw would leave open() rejecting forever, on a page that
 * looks fine until the first save, and only a browser that had been here before
 * would ever see it. Every other test in this suite starts from no database at
 * all and cannot.
 */

const DB_NAME = "vorlaut";

const board: Layout = {
  sleep_timeout_seconds: 600,
  language: "de",
  sets: [{
    name: "Morning",
    symbol: "arasaac-2483.png",
    color: "#3B5BDB",
    slots: [
      { text: "I want to go outside", symbol: "arasaac-2483.png" },
      { text: "", symbol: "" },
      { text: "", symbol: "" },
      { text: "", symbol: "" },
    ],
  }],
};

/** Version 2, made the way version 2 made it: one `content` store holding the
 *  registry under `collections`, every layout under `layout:<id>`, the settings
 *  and the build stamp beside them; `symbols` and `data` as loose key-value
 *  stores. Written out here rather than imported, because the point is to
 *  reproduce what is already on somebody's disk - a helper that moved with the
 *  code would test the new shape against itself. */
function seedVersionTwo(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["content", "symbols", "data"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["content", "symbols"], "readwrite");
      const content = tx.objectStore("content");
      const id = "3f1c0a4e-0000-4000-8000-000000000001";
      content.put({ text: JSON.stringify(board, null, 2) + "\n", version: "0123456789abcdef" },
                  `layout:${id}`);
      content.put({ collections: [{ id, name: "Kitchen" }], current: id }, "collections");
      content.put("0123456789abcdef", "built");
      content.put({ activeProvider: "metacom" }, "settings");
      // A picture in a store whose shape did not change, so that "every store
      // is dropped" is a claim with something behind it.
      tx.objectStore("symbols").put(new Uint8Array([1, 2, 3]).buffer, "arasaac-2483.png");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/* Imported after the old database exists, not before: store.ts opens lazily,
 * but a top-level import that ever grew an eager open would make this file
 * quietly test nothing. Loading it here is what guarantees the order. */
let store: typeof import("../../src/data/store.js");

beforeAll(async () => {
  await seedVersionTwo();
  store = await import("../../src/data/store.js");
});

describe("opening a database left behind by version 2", () => {
  /* The upgrade deletes every store it finds and creates the schema. Both
   * halves can throw - deleteObjectStore outside a versionchange transaction,
   * createIndex on a name that is already there - and a throw in there rejects
   * the open, which every call in this file is waiting on. */
  it("upgrades without throwing, so the store answers at all", async () => {
    await expect(store.readCollections()).resolves.toBeTruthy();
  });

  it("hands back a first visit rather than the boards that were there", async () => {
    const list = await store.readCollections();
    expect(list.collections).toHaveLength(0);
    expect(list.current).toBeNull();
    expect((await store.readLayout()).layout).toBeNull();
  });

  /* symbols/ and data/ have the same shape in both versions and are dropped
   * anyway. Keeping them would leave a browser holding pictures for boards that
   * no longer exist - half-old, which is the state this change exists to not
   * leave behind. */
  it("drops the picture store too, rather than keeping it half-old", async () => {
    expect(await store.listFiles("symbols")).toHaveLength(0);
  });

  it("drops the settings, which were never carried by anything else", async () => {
    const held = await store.readSettings<{ activeProvider?: string }>({});
    expect(held.activeProvider).toBeUndefined();
  });

  /* And it is an ordinary database afterwards: the first write seeds a board
   * the way a first visit does, through the same path. */
  it("takes a write afterwards, the way a browser that had never been here does", async () => {
    const result = await store.writeLayout(board, null);
    expect(result.conflict).toBeFalsy();

    const list = await store.readCollections();
    expect(list.collections).toHaveLength(1);
    expect(list.current).toBe(list.collections[0]!.id);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Morning");
  });
});
