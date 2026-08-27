/* A database at version 3, opened by code at version 4.
 *
 * This is the test adr/0015 exists to make possible, and it is written the one
 * way that proves anything: a database is built here the way version 3 built
 * it, on disk, and then store.ts is imported and asked ordinary questions. No
 * helper shared with the code under test, because a helper that moved with the
 * schema would seed the new shape and test it against itself; no assertion
 * about upgrade() in isolation, because a migration that never migrates is the
 * failure this repository keeps finding.
 *
 * What is under test is the promise in `docs/schema-upgrades.md`: a person who
 * has done nothing but open the page is not worse off after it than before.
 * Every Sammlung, the order they were in, which one was open, the pictures,
 * and the settings - including the two secrets a Sicherung deliberately drops,
 * which have no reason to be lost inside one browser.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Layout } from "../../src/core/types.js";
import type { Carried } from "../../src/data/store.js";

const DB_NAME = "vorlaut";

const board = (name: string, says: string): Layout => ({
  sleep_timeout_seconds: 600,
  language: "de",
  sets: [{
    name,
    symbol: "arasaac-2483.png",
    color: "#3B5BDB",
    slots: [
      { text: says, symbol: "arasaac-2483.png" },
      { text: "", symbol: "" },
      { text: "", symbol: "" },
      { text: "", symbol: "" },
    ],
  }],
});

const KITCHEN = "3f1c0a4e-0000-4000-8000-000000000001";
const BEDROOM = "3f1c0a4e-0000-4000-8000-000000000002";

const bytes = (of: number[]): ArrayBuffer => new Uint8Array(of).buffer;

/** The bytes and the stamp as version 3 stored them. The stamp is a plain
 *  string here rather than a real digest: what the test is about is that the
 *  pair crosses unchanged, and a fixed value says so where a recomputed one
 *  would only say that both sides run the same hash. */
const held = (layout: Layout, version: string) =>
  ({ text: JSON.stringify(layout, null, 2) + "\n", version });

const KITCHEN_STAMP = "aaaaaaaaaaaaaaaa";
const BEDROOM_STAMP = "bbbbbbbbbbbbbbbb";

/** A version 3 database, made the way version 3 made one: a store per kind,
 *  the `updatedAt` index the sidebar reads, and the `data` store beside them
 *  holding what a build made for the cable. Written out rather than imported,
 *  because the point is to reproduce what is already on somebody's disk. */
function seedVersionThree(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("collections", { keyPath: "id" })
        .createIndex("updatedAt", "updatedAt");
      db.createObjectStore("layouts", { keyPath: "id" });
      db.createObjectStore("settings");
      db.createObjectStore("marks");
      db.createObjectStore("symbols");
      db.createObjectStore("data");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(
        ["collections", "layouts", "settings", "marks", "symbols", "data"], "readwrite");
      const collections = tx.objectStore("collections");
      // Bedroom last written, so "last edited first" has something to get
      // wrong: the sidebar must show it above Kitchen afterwards.
      collections.put({ id: KITCHEN, name: "Kitchen", updatedAt: 1_000 });
      collections.put({ id: BEDROOM, name: "Bedroom", updatedAt: 2_000 });
      const layouts = tx.objectStore("layouts");
      layouts.put({ id: KITCHEN, ...held(board("Morning", "I want to go outside"), KITCHEN_STAMP) });
      layouts.put({ id: BEDROOM, ...held(board("Night", "story please"), BEDROOM_STAMP) });
      tx.objectStore("marks").put(KITCHEN, "current");
      tx.objectStore("marks").put(KITCHEN_STAMP, "built");
      tx.objectStore("settings").put({
        activeProvider: "metacom",
        metacomRendering: "sw",
        // The two a Sicherung drops on the way out to a synced folder. Nothing
        // leaves the browser here, so losing them would be a carer re-entering
        // a paid key and re-picking a licensed folder for no reason at all.
        azureKey: "not-a-real-key",
        metacomFolder: "/Users/somebody/METACOM",
      }, "settings");
      tx.objectStore("symbols").put(bytes([1, 2, 3]), "arasaac-2483.png");
      tx.objectStore("symbols").put(bytes([4, 5]), "mine.png");
      tx.objectStore("data").put(bytes([9, 9, 9]), "tiles.bin");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/** What the database looks like from outside store.ts afterwards. */
function inspect(): Promise<{ version: number; stores: string[] }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const seen = { version: db.version, stores: [...db.objectStoreNames].sort() };
      db.close();
      resolve(seen);
    };
  });
}

/* Imported after the old database exists, not before: store.ts opens lazily,
 * but a top-level import that ever grew an eager open would make this file
 * quietly test nothing. Loading it here is what guarantees the order. */
let store: typeof import("../../src/data/store.js");
const announced: Carried[] = [];

beforeAll(async () => {
  await seedVersionThree();
  store = await import("../../src/data/store.js");
  // Before the first read, which is what opens the database. A listener
  // registered afterwards would be testing nothing.
  store.onCarried((carried) => { announced.push(carried); });
});

describe("a version 3 database opened by version 4", () => {
  it("keeps every Sammlung, in the order the sidebar draws", async () => {
    const list = await store.readCollections();
    expect(list.collections.map((one) => one.name)).toEqual(["Bedroom", "Kitchen"]);
    expect(list.current).toBe(KITCHEN);
  });

  it("keeps what is on them, and the stamp over it", async () => {
    const open = await store.readLayout();
    expect(open.layout?.sets[0]?.name).toBe("Morning");
    expect(open.layout?.sets[0]?.slots[0]?.text).toBe("I want to go outside");
    // Verbatim, not recomputed: the bytes did not change, so neither may the
    // stamp over them - adr/0015 says why nothing on this path may re-hash.
    expect(open.version).toBe(KITCHEN_STAMP);

    const other = await store.readLayoutOf(BEDROOM);
    expect(other?.sets[0]?.slots[0]?.text).toBe("story please");
  });

  it("leaves the stamp and the bytes still a matched pair, so a save is not a conflict",
     async () => {
       const open = await store.readLayout();
       // The carried board rather than whatever a first visit would have
       // seeded, or this says nothing about a stamp that crossed.
       expect(open.layout?.sets[0]?.name).toBe("Morning");
       const changed = { ...open.layout!, sleep_timeout_seconds: 900 };
       const saved = await store.writeLayout(changed, open.version);
       expect(saved.conflict).toBeFalsy();
       expect((await store.readLayout()).layout?.sleep_timeout_seconds).toBe(900);
     });

  it("keeps the pictures", async () => {
    expect((await store.listFiles("symbols")).map((one) => one.name).sort())
      .toEqual(["arasaac-2483.png", "mine.png"]);
    expect(new Uint8Array((await store.getFile("symbols", "mine.png"))!))
      .toEqual(new Uint8Array([4, 5]));
  });

  it("keeps the whole settings record, including what a Sicherung would drop",
     async () => {
       const settings = await store.readSettings<Record<string, unknown>>({});
       expect(settings["activeProvider"]).toBe("metacom");
       expect(settings["azureKey"]).toBe("not-a-real-key");
       expect(settings["metacomFolder"]).toBe("/Users/somebody/METACOM");
     });

  it("still drops the stores themselves, rather than leaving a browser half-old",
     async () => {
       await store.readCollections();
       const seen = await inspect();
       expect(seen.version).toBe(4);
       // `data` is gone with the build that wrote it (adr/0011), and nothing
       // from version 3's shape survives except its contents.
       expect(seen.stores).toEqual(["collections", "layouts", "marks", "settings", "symbols"]);
     });

  it("says so, rather than moving somebody's boards in silence", async () => {
    await store.readCollections();
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({ from: 3, to: 4, boards: 2, symbols: 2 });
  });
});
