import { beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT, NOT_ONE, TOO_NEW, addSymbols, readOneCollection,
  type Backup, type StoredSymbol,
} from "../../src/data/backup.js";
import * as store from "../../src/data/store.js";
import type { AppLayout, Layout } from "../../src/core/types.js";

/* The door that adds, next to the door that replaces.
 *
 * data/backup.ts holds both, and the thing worth pinning is not that a file is
 * read - the round trip in backup_payload.test.ts already reads one - but that
 * these two acts stay different. A restore keeps identity and replaces; an
 * import drops identity and adds. Every test below is one half of that
 * sentence, because a change that quietly makes the import keep an id turns it
 * into a replace under a button that promises not to.
 */

const page = (id: string, label: string) => ({
  id, name: id,
  buttons: [{
    id: `b-${id}`, row: 0, col: 1, label, vocalization: "", symbol: "",
    wordClass: "misc", act: { kind: "append" as const },
  }],
});

const app = (label: string): AppLayout => ({
  target: "app",
  grid: { rows: 3, columns: 5 },
  pages: [page("start", label)],
  home: "start",
});

const PICTURE = "iVBORw0KGgo=";

const sicherung = (boards: { id: string; name: string; layout: Layout }[],
                   symbols: StoredSymbol[] = []): Backup => ({
  format: BACKUP_FORMAT,
  version: 2,
  exportedAt: "2026-08-26T00:00:00.000Z",
  boards,
  current: boards[0]?.id ?? null,
  symbols,
  settings: {},
  notice: "what this file does and does not contain",
});

const one = () => sicherung([
  { id: "kept-id", name: "Kitchen", layout: app("Water") },
]);

beforeEach(async () => {
  await store.empty("symbols");
});

describe("one Sammlung out of a Sicherung", () => {
  it("comes back whole, under the name the file gave it", () => {
    const read = readOneCollection(one());
    expect(read.name).toBe("Kitchen");
    expect(read.layout).toEqual(app("Water"));
  });

  it("does not keep the id, because an import is a copy", () => {
    // The file may well be a Sicherung this same browser wrote an hour ago.
    // Carrying "kept-id" through would make the arriving Sammlung the stored
    // one, and the button would replace what it promised to stand beside.
    expect(JSON.stringify(readOneCollection(one()))).not.toContain("kept-id");
  });

  it("reads a version 1 file, which named nothing", () => {
    const old = { ...sicherung([]), version: 1, boards: [], layout: app("Water") };
    const read = readOneCollection(old as Backup);
    expect(read.layout).toEqual(app("Water"));
    // No name in the file, so none invented here: the caller falls back to
    // what the file itself is called.
    expect(read.name).toBe("");
  });

  it("refuses a whole library rather than picking one out of it", () => {
    const many = sicherung([
      { id: "a", name: "Kitchen", layout: app("Water") },
      { id: "b", name: "Nursery", layout: app("More") },
    ]);
    try {
      readOneCollection(many);
      expect.unreachable("a Sicherung of two must not be read here");
    } catch (error) {
      expect((error as Error).message).toBe(NOT_ONE);
      // The count is what the panel says back. A file of nine and a file of
      // none are the same code and a different sentence.
      expect((error as { count?: number }).count).toBe(2);
    }
  });

  it("says how many when there are none either", () => {
    try {
      readOneCollection(sicherung([]));
      expect.unreachable("an empty Sicherung holds no Sammlung");
    } catch (error) {
      expect((error as Error).message).toBe(NOT_ONE);
      expect((error as { count?: number }).count).toBe(0);
    }
  });

  it("refuses a file from a newer vorlaut before reading anything of it", () => {
    const later = { ...one(), version: 99 };
    expect(() => readOneCollection(later)).toThrowError(TOO_NEW);
  });
});

describe("the pictures that come with it", () => {
  it("adds the ones this browser is missing", async () => {
    const added = await addSymbols([{ name: "arasaac-2483.png", data: PICTURE }]);
    expect(added).toBe(1);
    expect(await store.getFile("symbols", "arasaac-2483.png")).not.toBeNull();
  });

  it("leaves a name that is already here exactly as it is", async () => {
    // The store is keyed by name and an upload can share one with a download.
    // Overwriting would change a picture on some other Sammlung that has
    // nothing to do with this import - and nobody is looking at that one today.
    const mine = new Uint8Array([1, 2, 3, 4]);
    await store.putFile("symbols", "cat.png", mine.buffer);

    const added = await addSymbols([{ name: "cat.png", data: PICTURE }]);
    expect(added).toBe(0);
    const held = await store.getFile("symbols", "cat.png");
    expect(new Uint8Array(held!)).toEqual(mine);
  });

  it("keeps the board when one picture will not decode", async () => {
    const added = await addSymbols([
      { name: "broken.png", data: "not base64 at all !!" },
      { name: "fine.png", data: PICTURE },
    ]);
    expect(added).toBe(1);
    expect(await store.getFile("symbols", "fine.png")).not.toBeNull();
  });
});
