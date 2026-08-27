import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT, exportEverything, importBackup, isBackup, stripSecrets, TOO_NEW,
} from "../../src/data/backup.js";
import * as store from "../../src/data/store.js";
import { LANGUAGES, TEXTS } from "../../src/core/boot_data.js";
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

/** Stands in for whatever sentence the page would pass. The real one lives in
 *  boot_data.ts, which this file deliberately does not quote - German belongs
 *  in that table alone (tests/test_language.py). */
const NOTICE = "what this file does and does not contain";

const board = (): Layout => ({
  sets: [{
    name: "Kitchen",
    keys: [
      // A METACOM reference: a symbol the user chose and put on their own
      // board. It travels; see the note in data/backup.ts about why a
      // reference is not an index.
      { label: "Yes", symbol: "metacom:PNG_ohne_Rahmen/yes", text: "Yes" },
      // An ARASAAC download, living in symbols/ as bytes.
      { label: "Water", symbol: "arasaac-2483.png", text: "I would like water" },
    ],
  }],
  voice: "de_DE-thorsten",
} as unknown as Layout);

const LICENSED = "/Users/someone/Documents/METACOM 9/PNG_ohne_Rahmen";

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

    // One backup, so there is one inlet to reason about.
    expect(source.match(/new Sicherung\(/g) ?? [],
      "expected exactly one standing backup in this app").toHaveLength(1);
    expect(source).toContain('app: "vorlaut"');

    // The whole of what produce is: the audited export, handed the notice from
    // the text table. Matched exactly rather than loosely, so swapping in a
    // store read - or adding a second argument - fails here instead of quietly
    // uploading something new.
    const produce = source.match(/^\s*produce: (.+)$/m)?.[1];
    expect(produce).toBe('() => exportEverything(t("ui.data_notice")),');
  });

  it("carries no Azure key, and nothing that hints at one", async () => {
    await seed();
    const json = JSON.stringify(await exportEverything(NOTICE));

    expect(json).not.toContain("sk-geheim-123");
    expect(json).not.toContain("westeurope");
    expect(json).not.toContain("f8a2");
    expect(json).not.toContain("azure");
  });

  it("carries no path into anybody's licensed METACOM folder", async () => {
    await seed();
    const json = JSON.stringify(await exportEverything(NOTICE));

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
    const json = JSON.stringify(await exportEverything(NOTICE));

    // A reference is a symbol the user chose and put on their own board -
    // their work. An index is an enumeration of what they licensed. bildhaft's
    // export draws the same line.
    expect(json).toContain("metacom:PNG_ohne_Rahmen/yes");
  });

  it("carries the pictures in symbols/, which are ARASAAC and the user's own", async () => {
    await seed();
    const backup = await exportEverything(NOTICE);

    // METACOM never enters that store: pickSymbol() downloads ARASAAC into it
    // and uploadSymbol() puts the user's own files there, while a metacom:
    // reference is resolved live and copied nowhere.
    expect(backup.symbols.map((one) => one.name)).toEqual(["arasaac-2483.png"]);
  });

  /* There was a test here saying the backup leaves build output behind,
   * because a build makes it again out of the layout and the symbols. It was
   * about the `data` store, which went with the build - adr/0011 - so there is
   * no longer a second folder for a backup to be right about. What the rule
   * protected is now structural: there is one folder of files, it is content,
   * and it is the one that travels. */

  it("carries the notice it was handed, verbatim", async () => {
    await seed();
    const backup = await exportEverything(NOTICE);

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.notice).toBe(NOTICE);
  });

  /* And the sentence the page actually hands it. Checked against the table
   * rather than against a copy here, in both languages: somebody who receives
   * one of these files has to be able to tell whether they may open it without
   * asking us, and that promise is only as good as the words in it. */
  it("names METACOM and the Azure key in every language the product has", () => {
    for (const language of LANGUAGES) {
      const notice = (TEXTS as Record<string, Record<string, string>>)[language]["ui.data_notice"];
      expect(notice, `${language} has no notice`).toBeTruthy();
      expect(notice, `${language} notice omits METACOM`).toContain("METACOM");
      expect(notice, `${language} notice omits Azure`).toContain("Azure");
    }
  });
});

describe("the round trip", () => {
  it("puts the board and its pictures back", async () => {
    await seed();
    const backup = await exportEverything(NOTICE);

    await store.empty("symbols");
    await store.writeLayout({ sets: [] } as unknown as Layout, null);

    const done = await importBackup(backup);

    expect(done.symbols).toBe(1);
    expect(done.layout?.sets[0].name).toBe("Kitchen");
    expect((await store.listFiles("symbols")).map((f) => f.name)).toEqual(["arasaac-2483.png"]);
  });

  it("brings a METACOM board back by reference, with no pictures attached", async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    await importBackup(backup);

    const held = await store.readLayout();
    // The board is restored. The pictures stay blank until that person
    // reconnects their own licensed folder, and that is the feature.
    expect(held.layout?.sets[0].keys[0].symbol).toBe("metacom:PNG_ohne_Rahmen/yes");
    expect(backup.symbols.some((one) => one.name.includes("metacom"))).toBe(false);
  });

  /* The restore must not clear what it deliberately declined to carry. */
  it("leaves the Azure key and the METACOM folder alone on the way back in", async () => {
    await seed();
    const backup = await exportEverything(NOTICE);
    await importBackup(backup);

    const held = await store.readSettings<Partial<Settings>>({});
    expect(held.azureSecret).toBe("sk-geheim-123");
    expect(held.metacom?.path).toBe(LICENSED);
  });

  it("refuses a file from a newer vorlaut rather than reading it wrong", async () => {
    await seed();
    // The code, not a sentence: this module has no language. ui/settings.ts is
    // where it becomes one.
    await expect(importBackup({ ...(await exportEverything(NOTICE)), version: 99 }))
      .rejects.toThrow(TOO_NEW);
  });

  it("recognises its own files and not other shapes", async () => {
    await seed();
    expect(isBackup(await exportEverything(NOTICE))).toBe(true);
    expect(isBackup({ format: "mitreden-backup" })).toBe(false);
    expect(isBackup(null)).toBe(false);
  });
});
