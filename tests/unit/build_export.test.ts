import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../../src/data/store.js";
import { chooseBuildFolder, isBuildFile, writeBuildTo }
  from "../../src/backend/folder.js";
import { Trouble } from "../../src/core/errors.js";
import type { Layout } from "../../src/core/types.js";

/* The build, written into a folder somebody picked.
 *
 * Two things here are worth a test and the rest is plumbing.
 *
 * The first is the tidy-up. Exporting twice after changing a symbol leaves the
 * old tile behind, and a stale file in that folder is a file mklittlefs puts
 * into the image - so the export removes what this build did not produce. That
 * means deleting inside a directory a person chose, which is the one thing in
 * this app that could destroy something of theirs. The rule is the device's own
 * naming and nothing else, and "a file that is not ours is not touched" is
 * asserted here rather than trusted to a regex nobody reads.
 *
 * The second is the refusal. A folder holding yesterday's content looks exactly
 * like one holding today's, and everything downstream would carry the
 * difference to the device without a word.
 *
 * The directory is a Map. It is the file system, not the code under test - and
 * the File System Access API is small enough at this end that standing one in
 * is honest rather than a mock of our own logic.
 */

class FakeFile {
  constructor(public bytes: Uint8Array) {}
}

class FakeDirectory {
  kind = "directory" as const;
  files = new Map<string, FakeFile>();
  constructor(public name: string) {}

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new Error(`no ${name}`);
      this.files.set(name, new FakeFile(new Uint8Array()));
    }
    const files = this.files;
    return {
      kind: "file" as const,
      name,
      async createWritable() {
        const chunks: Uint8Array[] = [];
        return {
          async write(chunk: Uint8Array) { chunks.push(chunk.slice()); },
          async close() {
            const size = chunks.reduce((n, c) => n + c.length, 0);
            const all = new Uint8Array(size);
            let at = 0;
            for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
            files.set(name, new FakeFile(all));
          },
        };
      },
    };
  }

  async *values() {
    for (const name of [...this.files.keys()]) yield { kind: "file" as const, name };
  }

  async removeEntry(name: string) { this.files.delete(name); }
}

/** What the picker would have returned, and what it does instead of returning. */
let offered: FakeDirectory | null = null;
let dismissed = false;

(globalThis as Record<string, unknown>).window = {
  showDirectoryPicker: async () => {
    if (dismissed) throw new DOMException("aborted", "AbortError");
    return offered;
  },
};

const board = (name: string): Layout => ({
  sleep_timeout_seconds: 600,
  language: "de",
  sets: [{ name, symbol: "", color: "#3B5BDB",
           slots: [{ text: "", symbol: "" }] }],
} as unknown as Layout);

const hash = (fill: string) => fill.repeat(32).slice(0, 32);
const TILE = `t${hash("a")}.bin`;
const WAV = `a${hash("b")}.wav`;

/** A build in the store, and the mark that says it matches the layout. */
async function seedBuild(): Promise<void> {
  await store.empty("data");
  const saved = await store.writeLayout(board("Erste"), null);
  await store.putFile("data", "layout.bin", new Uint8Array([1, 2, 3]).buffer);
  await store.putFile("data", TILE, new Uint8Array([4, 4, 4, 4]).buffer);
  await store.putFile("data", WAV, new Uint8Array([5, 5]).buffer);
  await store.recordBuild(saved.version);
}

describe("which names belong to a build", () => {
  it("takes the three shapes the device reads", () => {
    expect(isBuildFile("layout.bin")).toBe(true);
    expect(isBuildFile(TILE)).toBe(true);
    expect(isBuildFile(WAV)).toBe(true);
  });

  it("takes nothing else, however close", () => {
    for (const name of ["notes.txt", "IMG_1234.jpg", "layout.bin.bak",
                        // The right shape, the wrong hash length: a change to
                        // HASH_BYTES must not quietly widen this.
                        `t${hash("a").slice(0, 30)}.bin`,
                        // The two prefixes do not share an extension.
                        `t${hash("a")}.wav`, `a${hash("b")}.bin`]) {
      expect(isBuildFile(name), name).toBe(false);
    }
  });
});

describe("writing the build into a folder", () => {
  beforeEach(async () => {
    dismissed = false;
    offered = new FakeDirectory("bench");
    await seedBuild();
  });

  it("writes every file, with the bytes the store holds", async () => {
    const done = await writeBuildTo(offered!);

    expect(done).not.toBeNull();
    expect(done!.folder).toBe("bench");
    expect(done!.written).toBe(3);
    expect(done!.removed).toBe(0);
    expect(done!.bytes).toBe(3 + 4 + 2);
    expect([...offered!.files.keys()].sort()).toEqual([WAV, TILE, "layout.bin"].sort());
    expect([...offered!.files.get(TILE)!.bytes]).toEqual([4, 4, 4, 4]);
  });

  it("clears out what an earlier export left and this build has not", async () => {
    const old = `t${hash("c")}.bin`;
    offered!.files.set(old, new FakeFile(new Uint8Array([9])));

    const done = await writeBuildTo(offered!);

    expect(done!.removed).toBe(1);
    expect(offered!.files.has(old)).toBe(false);
  });

  it("does not touch a file that is not a build's", async () => {
    // Somebody picks their Documents folder by mistake. They lose nothing.
    offered!.files.set("Steuer 2025.pdf", new FakeFile(new Uint8Array([7])));
    offered!.files.set("IMG_1234.jpg", new FakeFile(new Uint8Array([8])));

    const done = await writeBuildTo(offered!);

    expect(done!.removed).toBe(0);
    expect(offered!.files.has("Steuer 2025.pdf")).toBe(true);
    expect([...offered!.files.get("IMG_1234.jpg")!.bytes]).toEqual([8]);
  });

  it("reports progress per file", async () => {
    const seen: string[] = [];
    await writeBuildTo(offered!, { onFile: (name, at, total) => seen.push(`${name} ${at}/${total}`) });
    expect(seen).toHaveLength(3);
    expect(seen.every((line) => line.endsWith("/3"))).toBe(true);
  });

  it("refuses a build that no longer matches the board, and writes nothing", async () => {
    // An edit after the build: recordBuild() was against the older version.
    await store.writeLayout(board("Zweite"), null);

    await expect(writeBuildTo(offered!)).rejects.toThrow(Trouble);
    await expect(writeBuildTo(offered!)).rejects.toMatchObject({ word: "folder_stale" });
    expect(offered!.files.size).toBe(0);
  });

  it("refuses when there is no build at all", async () => {
    await store.empty("data");
    await expect(writeBuildTo(offered!)).rejects.toMatchObject({ word: "build_none" });
    expect(offered!.files.size).toBe(0);
  });

  it("answers null when the picker is dismissed, which is not a failure", async () => {
    dismissed = true;
    expect(await chooseBuildFolder()).toBeNull();
  });

  it("asks for the folder before anything slow, so the gesture is still there",
     async () => {
    // The order is the whole reason these are two functions: a build between
    // the click and the picker would spend the activation the picker needs.
    expect(await chooseBuildFolder()).toBe(offered);
  });
});
