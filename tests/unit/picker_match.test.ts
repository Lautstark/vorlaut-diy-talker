import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../src/core/state.js";
import * as symbols from "../../src/data/symbols.js";
import { findSymbols } from "../../src/shell/picker.js";
import { t } from "../../src/core/texts.js";
import type { Layout } from "../../src/core/types.js";

/* Telling a hit from a near miss.
 *
 * A search that finds nothing has said so for a long time. A search that finds
 * the wrong thing looked exactly like one that found the right thing: twelve
 * tiles, every one of them confident. "nicht" in METACOM is the case that
 * showed it - every hit a rendering of "nichtbinaer", and nothing on the
 * screen said so.
 *
 * The example moved with bildquelle 1.6.3, which reads a run-together label as
 * the pair METACOM wrote without its slash. "nichtbinaer" is a whole-word
 * match now, and so is "nichtkein" - the negation pair, which is the picture
 * that search was always looking for and which now comes back first. So the
 * near miss is spelled with a word that really is only a word starting the
 * same way: "nichte" is a niece.
 *
 * What is under test is the line, not the ranking: bildquelle grades the hits
 * and vorlaut reads the grade. So the collections here are real providers
 * answering real searches - a fabricated score would pass whatever the reading
 * was, including a reading of a number bildquelle no longer produces.
 *
 * Both sources, and that is the point of the file. ARASAAC does not hand back
 * the ladder score: it hands back the ladder plus a preference for pictograms
 * drawn for AAC use, and a word-prefix on a flagged pictogram arrives at the
 * same number a whole-word match does. Reading it raw would have caught the
 * METACOM case and missed the identical ARASAAC one.
 *
 * The sentences come out of the table the page reads rather than out of one
 * language's column, because which language a test runner opens in is the
 * host's locale.
 */

const NEAR = (word: string) => t("ui.search_near", { word });

/** A Sammlung with nothing to say about its source, so the machine decides. */
const blank = (): Layout => ({ sleep_timeout_seconds: 600, sets: [] });

/** A METACOM collection of exactly these files, indexed for real.
 *
 * useFileList is the path a browser without the folder picker takes, and it is
 * the only one a test can walk: a directory handle cannot be fabricated. What
 * it produces is the same index a picked folder produces, which is what the
 * search reads. */
async function collection(...names: string[]): Promise<void> {
  await symbols.readMetacomFiles(names.map(
    (name) => new File([new Uint8Array([0x89, 0x50])], name, { type: "image/png" })));
  symbols.setActiveSource("metacom");
}

/** ARASAAC, answering with these pictograms and nothing else.
 *
 * The flags are on: `aac` and `aacColor` are what ARASAAC's ranking adds its
 * preference for, and they are the state in which a near miss scores highest.
 * A test of the reading has to use the case that is hardest to read. */
function arasaacHolds(words: Record<string, string[]>): void {
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    if (!url.includes("/search/")) return new Response(new Uint8Array([0x89, 0x50]));
    const asked = decodeURIComponent(url.split("/").pop() || "").toLowerCase();
    const keywords = words[asked] || [];
    return new Response(JSON.stringify(keywords.map((keyword, at) => ({
      _id: 100 + at, aac: true, aacColor: true, keywords: [{ keyword }],
    }))), { status: 200, headers: { "content-type": "application/json" } });
  });
  symbols.setActiveSource("arasaac");
}

beforeEach(() => {
  state.layout = blank();
  symbols.setActiveSource("arasaac");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await symbols.forgetMetacom();
});

describe("a collection that does not hold the word", () => {
  it("says so over the near misses instead of showing them plain", async () => {
    // The reported case, with the collection cut down to what it turns on.
    // Renderings of a niece: every one of them starts "nicht" and none of them
    // is it, which is the shape the line exists to name.
    await collection("nichte.png", "nichte-02.png", "nichte-03.png");
    const answer = await findSymbols("nicht");

    expect(answer.near).toBe(NEAR("nicht"));
    // And the hits are still there. They are the nearest thing the collection
    // holds, sometimes they are wanted, and throwing them away would be
    // answering a different question than the one that was asked.
    expect(answer.hits.length).toBe(3);
    expect(answer.empty).toBe("");
  });

  it("is not the sentence for a word that really is missing", async () => {
    // The line between the two: "nothing at all" and "nothing that is this
    // word" are different things to be told, and only one of them leaves
    // something on the screen to look at.
    await collection("nichtbinaer.png");
    const answer = await findSymbols("Kaugummiautomat");

    expect(answer.hits).toEqual([]);
    expect(answer.near).toBe("");
    expect(answer.empty).toBe(t("ui.nothing_found", { word: "Kaugummiautomat" }));
  });
});

describe("a collection that does hold it", () => {
  it("says nothing when the word is the label", async () => {
    await collection("trinken.png", "nichtbinaer.png");
    expect((await findSymbols("trinken")).near).toBe("");
  });

  it("counts the word inside a label, which is where 100 would be wrong", async () => {
    // "wasser trinken" is a picture for "trinken". Drawing the line at an
    // exact label would send somebody looking for a second one that the
    // collection does not have and does not need.
    await collection("wasser_trinken.png");
    const answer = await findSymbols("trinken");

    expect(answer.hits.length).toBe(1);
    expect(answer.near).toBe("");
  });

  it("does not count a word that merely starts the same", async () => {
    // The rung below, and the whole of the case this exists for: 55 rather
    // than 60, one step apart, and a different word. A niece is not a
    // negation.
    await collection("nichte.png");
    const answer = await findSymbols("nicht");

    expect(answer.near).toBe(NEAR("nicht"));
  });

  it("counts the pair METACOM wrote without its slash", async () => {
    // The other half of the same rule, and what bildquelle 1.6.3 changed.
    // "nichtkein" is the negation pair with the slash dropped, because a
    // filename cannot hold one - METACOM's picture for it, not a word that
    // merely starts the same way, and the line has nothing to say over it.
    await collection("nichtkein.png");
    const answer = await findSymbols("nicht");

    expect(answer.hits.length).toBe(1);
    expect(answer.near).toBe("");
  });
});

describe("ARASAAC, which misses the same way", () => {
  it("is read through its own ranking rather than raw", async () => {
    // 55 on the ladder, plus 20 for a pictogram drawn for AAC use, is 75 - and
    // 75 read as a ladder score is a whole-word match that never happened.
    // This is the METACOM case with the other collection's name on it, and it
    // is the reason the preference comes back off before the score is read.
    arasaacHolds({ nicht: ["nichtbinaer"] });
    const answer = await findSymbols("nicht");

    expect(answer.hits.length).toBe(1);
    expect(answer.near).toBe(NEAR("nicht"));
  });

  it("still keeps quiet when ARASAAC has the word itself", async () => {
    // The other side of it. Taking the preference off must not cost a real
    // hit its silence, or the line would stand over every answer and mean
    // nothing.
    arasaacHolds({ trinken: ["trinken"] });
    const answer = await findSymbols("trinken");

    expect(answer.hits.length).toBe(1);
    expect(answer.near).toBe("");
  });
});
