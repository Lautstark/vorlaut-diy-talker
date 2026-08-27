/* The databases somebody already had, and what version 4 does with them.
 *
 * This file has now said three different things, and the sequence is the
 * point. It first asserted that version 2 carried version 1's single layout
 * across, key by key. It was then rewritten to assert the opposite - that
 * version 3 dropped everything - on conventions.md's rule about its own rules:
 * one user, disposable data, no migrations. That rule names the condition it
 * depends on and says to come back when it fails, and on 2026-08-27 it failed
 * in the most direct way available, by costing the person who wrote it every
 * board she had. adr/0015 is the answer and this is what it looks like from
 * outside store.ts.
 *
 * Versions 1 and 2 are one shape and one reader: everything in a `content`
 * store, keyed by prefix. 2 held a registry and a layout per `layout:<id>`;
 * 1 held the one layout there was under `layout`, with no registry and no name
 * for it. The difference between them is which keys are present rather than
 * what a record looks like, which is why there is one reader and not two.
 *
 * tests/unit/store_upgrade.test.ts covers the other shape, version 3 to 4, and
 * tests/unit/store_refuses.test.ts covers what happens when neither reader
 * recognises anything.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Layout } from "../../src/core/types.js";
import type { Carried } from "../../src/data/store.js";

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

const STAMP = "0123456789abcdef";
const KITCHEN = "3f1c0a4e-0000-4000-8000-000000000001";
const stored = { text: JSON.stringify(board, null, 2) + "\n", version: STAMP };

/** Version 2, made the way version 2 made it: one `content` store holding the
 *  registry under `collections`, every layout under `layout:<id>`, the settings
 *  and the build stamp beside them; `symbols` and `data` as loose key-value
 *  stores. Written out here rather than imported, because the point is to
 *  reproduce what is already on somebody's disk - a helper that moved with the
 *  code would test the new shape against itself. */
function seedVersionTwo(): Promise<void> {
  return fill(2, (content, symbols) => {
    content.put(stored, `layout:${KITCHEN}`);
    content.put({ collections: [{ id: KITCHEN, name: "Kitchen" }], current: KITCHEN },
                "collections");
    content.put(STAMP, "built");
    content.put({ activeProvider: "metacom" }, "settings");
    // A picture in a store whose shape did not change, so that "the contents
    // cross and the stores do not" is a claim with something behind it.
    symbols.put(new Uint8Array([1, 2, 3]).buffer, "arasaac-2483.png");
  });
}

/** Version 1: one layout, under one key, with no registry anywhere. */
function seedVersionOne(): Promise<void> {
  return fill(1, (content, symbols) => {
    content.put(stored, "layout");
    content.put({ activeProvider: "arasaac" }, "settings");
    symbols.put(new Uint8Array([1, 2, 3]).buffer, "arasaac-2483.png");
  });
}

function fill(version: number,
              write: (content: IDBObjectStore, symbols: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
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
      write(tx.objectStore("content"), tx.objectStore("symbols"));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

const wipe = (): Promise<void> => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve();
});

/* Imported after the old database exists, not before: store.ts opens lazily,
 * but a top-level import that ever grew an eager open would make this file
 * quietly test nothing. Loading it here is what guarantees the order. */
let store: typeof import("../../src/data/store.js");
const announced: Carried[] = [];

beforeAll(async () => {
  await seedVersionTwo();
  store = await import("../../src/data/store.js");
  store.onCarried((carried) => { announced.push(carried); });
});

describe("opening a database left behind by version 2", () => {
  /* The upgrade reads, deletes every store it finds, creates the schema and
   * writes back. All four halves can throw - deleteObjectStore outside a
   * versionchange transaction, createIndex on a name that is already there, a
   * record that will not read - and anything thrown in there rejects the open,
   * which every call in this file is waiting on. */
  it("upgrades without throwing, so the store answers at all", async () => {
    await expect(store.readCollections()).resolves.toBeTruthy();
  });

  it("hands back the Sammlung that was there, rather than a first visit", async () => {
    const list = await store.readCollections();
    expect(list.collections.map((one) => one.name)).toEqual(["Kitchen"]);
    expect(list.current).toBe(KITCHEN);

    const open = await store.readLayout();
    expect(open.layout?.sets[0]?.slots[0]?.text).toBe("I want to go outside");
    expect(open.version).toBe(STAMP);
  });

  it("keeps the pictures, and the settings that were never carried by anything else",
     async () => {
       expect(await store.listFiles("symbols")).toHaveLength(1);
       const held = await store.readSettings<{ activeProvider?: string }>({});
       expect(held.activeProvider).toBe("metacom");
     });

  it("says so", async () => {
    await store.readCollections();
    expect(announced).toEqual([{ from: 2, to: 4, boards: 1, symbols: 1 }]);
  });

  /* And it is an ordinary database afterwards: a second Sammlung is made the
   * way a first visit makes one, through the same path. */
  it("takes a write afterwards, the way a browser that had never been here does",
     async () => {
       const made = await store.createCollection("Bedroom", board);
       const list = await store.readCollections();
       expect(list.collections).toHaveLength(2);
       // Last written first, and the carried one still has its own stamp.
       expect(list.collections[0]!.id).toBe(made);
     });
});

describe("opening a database left behind by version 1", () => {
  beforeAll(async () => {
    await store.close();
    await wipe();
    await seedVersionOne();
    vi.resetModules();
    store = await import("../../src/data/store.js");
  });

  /* One layout, and nothing that ever named it. It comes across as one
   * Sammlung with a freshly minted id, which is the honest reading - the
   * database never held an identity, so there is none to keep. The name is
   * empty for the same reason, and app.ts's nameIfUnnamed() is what answers
   * that, as it always has for a Sammlung arriving without one. */
  it("carries the one layout across, unnamed, with an id of its own", async () => {
    const list = await store.readCollections();
    expect(list.collections).toHaveLength(1);
    expect(list.collections[0]!.name).toBe("");
    expect(list.collections[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(list.current).toBe(list.collections[0]!.id);

    const open = await store.readLayout();
    expect(open.layout?.sets[0]?.slots[0]?.text).toBe("I want to go outside");
  });
});
