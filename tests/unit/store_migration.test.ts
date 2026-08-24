import { beforeAll, describe, expect, it } from "vitest";
import type { CollectionList, Layout } from "../../src/core/types.js";

/* The board somebody already had, after the page learned to hold several.
 *
 * Version 1 of the database kept one layout under one key. Version 2 keeps a
 * list, and every board's layout under a key of its own. In between sits a
 * browser holding a talker's worth of work - evenings of sentences, symbols
 * chosen one at a time - and if the upgrade started from an empty list that
 * work would be gone with no error anywhere. It would look exactly like the
 * thing store.ts warns can genuinely happen: a browser throwing script-written
 * storage away. Nobody would question it, and nobody could get it back.
 *
 * So this opens a *real* version 1 database, by hand, writes the record the
 * old code wrote, and then asks for the board back through the ordinary reads.
 * Not a unit test of migrate(): the thing under test is the upgrade path a
 * returning user takes, and the only honest way to take it is to be one.
 */

const DB_NAME = "vorlaut";

const board: Layout = {
  sleep_timeout_seconds: 600,
  language: "de",
  sets: [{
    name: "Morning",
    symbol: "arasaac-2483.png",
    color: "#3B5BDB",
    active: true,
    slots: [
      { text: "I want to go outside", symbol: "arasaac-2483.png" },
      { text: "", symbol: "" },
      { text: "", symbol: "" },
      { text: "", symbol: "" },
    ],
  }],
};

/** Exactly what store.ts version 1 put in the database: the serialised layout
 *  and the stamp over those bytes, under the key "layout". Written out here
 *  rather than imported, because the point is to reproduce what is already on
 *  somebody's disk - a helper that moved with the code would migrate itself. */
const OLD_TEXT = JSON.stringify(board, null, 2) + "\n";
const OLD_VERSION = "0123456789abcdef";

/** The version 1 database, made the way version 1 made it. */
function seedVersionOne(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["content", "symbols", "data"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["content"], "readwrite");
      const content = tx.objectStore("content");
      content.put({ text: OLD_TEXT, version: OLD_VERSION }, "layout");
      // The build stamp, matching that version: a build had run against this
      // board and the page said so. It has to still say so afterwards.
      content.put(OLD_VERSION, "built");
      content.put({ activeProvider: "metacom" }, "settings");
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
  await seedVersionOne();
  store = await import("../../src/data/store.js");
});

describe("the upgrade from one board to a list of them", () => {
  it("still has the board that was there, under the list", async () => {
    const held = await store.readLayout();
    expect(held.layout?.sets[0]?.name).toBe("Morning");
    expect(held.layout?.sets[0]?.slots[0]?.text).toBe("I want to go outside");
  });

  it("makes it board number one, and opens it", async () => {
    const list: CollectionList = await store.readCollections();
    expect(list.collections).toHaveLength(1);
    expect(list.current).toBe(list.collections[0]!.id);
    expect(list.collections[0]!.id).toBeTruthy();
  });

  /* Unnamed rather than named down here. A name invented by the storage layer
   * would be in whichever language this file does not have, and the sidebar
   * already draws "Board 1" for a board nobody has named. */
  it("leaves it unnamed, for the list to draw a name for", async () => {
    const list = await store.readCollections();
    expect(list.collections[0]!.name).toBe("");
  });

  /* The stamp is a hash of the stored bytes and the build was recorded against
   * it. Rewriting the record on the way across - even to identical bytes -
   * would be a new stamp, and the page would have told somebody a build was
   * due when it was not. */
  it("carries the version across, so a build that was current still is", async () => {
    const held = await store.readLayout();
    expect(held.version).toBe(OLD_VERSION);
    expect(held.buildCurrent).toBe("1");
  });

  it("leaves nothing behind under the old key", async () => {
    // Read around store.ts on purpose: it has no way to name that key any
    // more, and "the old record is gone" is the claim being made.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const left = await new Promise((resolve, reject) => {
      const held = db.transaction(["content"], "readonly")
        .objectStore("content").get("layout");
      held.onsuccess = () => resolve(held.result);
      held.onerror = () => reject(held.error);
    });
    db.close();
    expect(left).toBeUndefined();
  });

  it("leaves the settings alone - they were never per board", async () => {
    const held = await store.readSettings<{ activeProvider?: string }>({});
    expect(held.activeProvider).toBe("metacom");
  });

  /* The board that came across is a board like any other: it can be written
   * to, and the write lands on it rather than minting a second one. */
  it("hands the migrated board to the ordinary write path", async () => {
    const held = await store.readLayout();
    const edited = { ...held.layout!, sets: [{ ...held.layout!.sets[0]!, name: "Evening" }] };
    const result = await store.writeLayout(edited, held.version);

    expect(result.conflict).toBeFalsy();
    const list = await store.readCollections();
    expect(list.collections).toHaveLength(1);
    expect((await store.readLayout()).layout?.sets[0]?.name).toBe("Evening");
  });
});
