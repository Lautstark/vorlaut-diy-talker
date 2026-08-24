import { afterEach, describe, expect, it } from "vitest";
import { LANGUAGES, setLanguage } from "../../src/core/boot.js";
import { ago, sentence } from "../../src/shell/backupFolder.js";

/*
 * A backup that has stopped says how long it has been stopped.
 *
 * This is the last thing about the standing-backup panel that is written out
 * in all three products with nothing checking they agree.
 * @lautstark/sicherung/ui owns which buttons a state offers, which states are
 * somebody's to act on, and the arithmetic behind "vor 3 Minuten" - and it
 * deliberately owns no words, because bildhaft has no t() to route them
 * through. So the sentences stayed here, and this rule with them.
 *
 * The rule is not decoration. `needs-permission` and `failed` both mean *no
 * backup is being written and it will not resume by itself*, and both are
 * states somebody can put off: "es funktioniert nicht" is a complaint, while
 * "seit elf Tagen nichts gesichert" is a deadline. The age is what turns one
 * into the other, and it is exactly what a later edit tightening a sentence
 * would drop without noticing - every other check here would stay green,
 * because a sentence without an age is still a sentence.
 *
 * Asserted against what ago() returns rather than against a literal, so this
 * says nothing about which language the page is in and keeps saying it when
 * somebody rewrites the wording.
 *
 * Every language, not the one the runner happens to be in. The sentences are
 * two entries per state in boot_data.ts, and a tightened German string with the
 * age taken out of it is invisible to a test running in English - which is what
 * this file did until the mutation that was supposed to make it go red did not.
 */

const MINUTES = 60_000;
const at = Date.now() - 11 * MINUTES;

/** Runs the body once per language the page ships, in that language. */
const inEveryLanguage = (body: (code: string) => void) =>
  LANGUAGES.forEach((code: string) => { setLanguage(code); body(code); });

afterEach(() => setLanguage(LANGUAGES[0]!));

describe("what the backup panel says", () => {
  it("carries the age in both states that mean nothing is being written", () => {
    inEveryLanguage((code) => {
      const age = ago(at);
      expect(sentence({ kind: "needs-permission", folder: "Sicherungen", lastWrite: at }), code)
        .toContain(age);
      expect(sentence({ kind: "failed", folder: "Sicherungen", lastWrite: at, reason: "disk full" }), code)
        .toContain(age);
    });
  });

  it("says so where a folder was chosen and never written to", () => {
    // The other half of the same rule: no age to give is not a reason to say
    // nothing, because "never" is the most alarming answer of the three.
    inEveryLanguage(() => {
      for (const status of [
        { kind: "needs-permission" as const, folder: "Sicherungen", lastWrite: null },
        { kind: "failed" as const, folder: "Sicherungen", lastWrite: null, reason: "disk full" },
        { kind: "idle" as const, folder: "Sicherungen", lastWrite: null },
      ]) {
        expect(sentence(status).length).toBeGreaterThan(0);
        // Not the age of the epoch, which is what a missing branch produces.
        expect(sentence(status)).not.toContain(ago(0));
      }
    });
  });

  it("names the folder wherever there is one, and the reason when it failed", () => {
    for (const status of [
      { kind: "idle" as const, folder: "Sicherungen", lastWrite: at },
      { kind: "needs-permission" as const, folder: "Sicherungen", lastWrite: at },
    ]) {
      expect(sentence(status)).toContain("Sicherungen");
    }
    expect(sentence({ kind: "failed", folder: "Sicherungen", lastWrite: at, reason: "disk full" }))
      .toContain("disk full");
  });

  it("says nothing at all where the browser has no picker", () => {
    // The panel is hidden there, and a sentence would be a paragraph telling
    // somebody their browser is wrong.
    expect(sentence({ kind: "unsupported" })).toBe("");
  });
});
