import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT, exportEverything, importBackup, isBackup, stripSecrets,
} from "../../src/data/backup.js";
import * as store from "../../src/data/store.js";
import type { Layout, Settings } from "../../src/core/types.js";

/* What may reach a folder that is very likely inside Dropbox.
 *
 * Choosing a folder is choosing to have a sync client carry the file off the
 * machine - to somebody's cloud, then to every device sharing the folder. Two
 * things must never make that trip, and they fail differently:
 *
 *   the Azure key           a paid credential, handed to whoever has the folder
 *   the METACOM folder path derived from a collection licensed per person
 *
 * A failure in this file is a leak or a licence, not a bug to triage. */

const board = (): Layout => ({
  sets: [{
    name: "Küche",
    keys: [
      // A METACOM reference: a symbol the user chose and put on their own
      // board. It travels; see the note in data/backup.ts about why a
      // reference is not an index.
      { label: "Ja", symbol: "metacom:PNG_ohne_Rahmen/ja", text: "Ja" },
      // An ARASAAC download, living in symbols/ as bytes.
      { label: "Wasser", symbol: "arasaac-2483.png", text: "Ich möchte Wasser" },
    ],
  }],
  voice: "de_DE-thorsten",
} as unknown as Layout);

const LICENSED = "/Users/stefanie/Documents/METACOM 9/PNG_ohne_Rahmen";

async function seed(): Promise<void> {
  await store.writeLayout(board(), null);
  await store.putFile("symbols", "arasaac-2483.png", new Uint8Array([137, 80, 78, 71]).buffer);
  await store.writeSettings({
    azureKey: { set: true, hint: "…f8a2" },
    azureRegion: "westeurope",
    azureSecret: "sk-geheim-123",
    metacom: { path: LICENSED, ok: true, count: 1284, keywords: false, fixed: false },
    activeProvider: "metacom",
    metacomRendering: "PNG_ohne_Rahmen",
    local: true,
  } as unknown as Settings);
}

beforeEach(async () => {
  await store.empty("symbols");
  await store.empty("data");
  await store.writeSettings({} as Settings);
});

describe("what the standing backup is handed", () => {
  /* The wiring, asserted against the source.
   *
   * A behavioural test cannot catch the failure that matters. If somebody
   * hands Sicherung the raw settings - or a dump of the store - every other
   * test in this repo still passes and the backup keeps working. It would
   * simply also be uploading a credential and a path into a licensed folder.
   * So the constructor call itself is the thing under test. */
  it("is constructed with exportEverything and nothing else", () => {
    const source = readFileSync(new URL("../../src/app.ts", import.meta.url), "utf8");
    const calls = [...source.matchAll(/new Sicherung\(([^)]*)\)/g)].map((m) => m[1]);

    expect(calls, "expected exactly one standing backup in this app").toHaveLength(1);
    expect(calls[0].replace(/\s+/g, " ").trim())
      .toBe('{ app: "vorlaut", produce: exportEverything }');
  });

  it("carries no Azure key, and nothing that hints at one", async () => {
    await seed();
    const json = JSON.stringify(await exportEverything());

    expect(json).not.toContain("sk-geheim-123");
    expect(json).not.toContain("westeurope");
    expect(json).not.toContain("f8a2");
    expect(json).not.toContain("azure");
  });

  it("carries no path into anybody's licensed METACOM folder", async () => {
    await seed();
    const json = JSON.stringify(await exportEverything());

    expect(json).not.toContain(LICENSED);
    expect(json).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//);
    // The count is a fact about what is in that folder, which is an index by
    // another name.
    expect(json).not.toContain("1284");
  });

  /* stripSecrets is an allow-list, and this says why: a field added to
   * Settings later must be excluded until somebody argues for it, rather than
   * shipped because a spread carried it. */
  it("drops a field nobody has classified yet rather than carrying it", () => {
    const future = {
      activeProvider: "arasaac",
      azureSecret: "sk-1",
      metacom: { path: LICENSED, ok: true, count: 3, keywords: false, fixed: false },
      elevenLabsToken: "tok-999",
    };
    expect(stripSecrets(future as never)).toEqual({ activeProvider: "arasaac" });
  });

  it("does carry the references the board itself uses", async () => {
    await seed();
    const json = JSON.stringify(await exportEverything());

    // A reference is a symbol the user chose and put on their own board -
    // their work. An index is an enumeration of what they licensed. bildhaft's
    // export draws the same line.
    expect(json).toContain("metacom:PNG_ohne_Rahmen/ja");
  });

  it("carries the pictures in symbols/, which are ARASAAC and the user's own", async () => {
    await seed();
    const backup = await exportEverything();

    // METACOM never enters that store: pickSymbol() downloads ARASAAC into it
    // and uploadSymbol() puts the user's own files there, while a metacom:
    // reference is resolved live and copied nowhere.
    expect(backup.symbols.map((one) => one.name)).toEqual(["arasaac-2483.png"]);
  });

  it("leaves build output behind, because a build makes it again", async () => {
    await seed();
    await store.putFile("data", "sets.bin", new Uint8Array([1, 2, 3]).buffer);

    const json = JSON.stringify(await exportEverything());
    expect(json).not.toContain("sets.bin");
  });

  it("says in the file itself what it does and does not contain", async () => {
    await seed();
    const backup = await exportEverything();

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.notice).toContain("METACOM");
    expect(backup.notice).toContain("Azure");
  });
});

describe("the round trip", () => {
  it("puts the board and its pictures back", async () => {
    await seed();
    const backup = await exportEverything();

    await store.empty("symbols");
    await store.writeLayout({ sets: [] } as unknown as Layout, null);

    const done = await importBackup(backup);

    expect(done.symbols).toBe(1);
    expect(done.layout?.sets[0].name).toBe("Küche");
    expect((await store.listFiles("symbols")).map((f) => f.name)).toEqual(["arasaac-2483.png"]);
  });

  it("brings a METACOM board back by reference, with no pictures attached", async () => {
    await seed();
    const backup = await exportEverything();
    await importBackup(backup);

    const held = await store.readLayout();
    // The board is restored. The pictures stay blank until that person
    // reconnects their own licensed folder, and that is the feature.
    expect(held.layout?.sets[0].keys[0].symbol).toBe("metacom:PNG_ohne_Rahmen/ja");
    expect(backup.symbols.some((one) => one.name.includes("metacom"))).toBe(false);
  });

  /* The restore must not clear what it deliberately declined to carry. */
  it("leaves the Azure key and the METACOM folder alone on the way back in", async () => {
    await seed();
    const backup = await exportEverything();
    await importBackup(backup);

    const held = await store.readSettings<Partial<Settings>>({});
    expect(held.azureSecret).toBe("sk-geheim-123");
    expect(held.metacom?.path).toBe(LICENSED);
  });

  it("refuses a file from a newer vorlaut rather than reading it wrong", async () => {
    await seed();
    await expect(importBackup({ ...(await exportEverything()), version: 99 }))
      .rejects.toThrow(/neueren Version/);
  });

  it("recognises its own files and not other shapes", async () => {
    await seed();
    expect(isBackup(await exportEverything())).toBe(true);
    expect(isBackup({ format: "mitreden-backup" })).toBe(false);
    expect(isBackup(null)).toBe(false);
  });
});
