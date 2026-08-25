import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../../src/core/state.js";
import * as symbols from "../../src/data/symbols.js";
import { creditLine, findSymbols, offeredSource, searchPlaceholder }
  from "../../src/shell/picker.js";
import { t } from "../../src/core/texts.js";
import type { AppLayout, Layout } from "../../src/core/types.js";

/* Which collection the picker offers, and who decides it.
 *
 * The rule design landed for settings: a setting whose answer changes with the
 * selection is not the app's. "One symbol source per package" is exactly that
 * - exchange/SPEC.md §5.1, with a licence behind it - and it was being read
 * off symbols.activeSource(), which is a fact about this *browser*. So a
 * METACOM Sammlung opened on a machine set to ARASAAC took ARASAAC pictures,
 * went mixed, and said nothing until buildAppPackage() refused it at the very
 * end of an export that had already synthesised every sentence in it.
 *
 * What is asserted here is that the Sammlung decides, that "nothing to say"
 * is a real answer rather than a source, and that a collection the browser
 * cannot reach is said out loud instead of quietly swapped for the other one.
 */

/* The sentences come out of the table the page itself reads, rather than out
 * of one language's column: which language a test runner opens in is the
 * host's locale, and asserting against English would make this fail on a
 * German machine and pass on the CI runner. */

const talker = (...refs: string[]): Layout => ({
  sleep_timeout_seconds: 600,
  sets: [{
    name: "Set", symbol: "", color: "#3B5BDB",
    slots: refs.map((symbol) => ({ text: "x", symbol })),
  }],
});

const tablet = (...refs: string[]): AppLayout => ({
  target: "app",
  grid: { rows: 2, columns: 3 },
  home: "p-start",
  pages: [{
    id: "p-start", name: "Start",
    buttons: refs.map((symbol, at) => ({
      id: `k${at}`, row: 0, col: at, label: "x", vocalization: "",
      symbol, wordClass: "", act: { kind: "append" } as const,
    })),
  }],
});

beforeEach(() => {
  // What a browser that has never been told anything runs on, and what
  // readSettings() answers while no folder is connected.
  symbols.setActiveSource("arasaac");
  state.layout = talker();
});

describe("the collection the picker offers", () => {
  it("falls back to the machine while the Sammlung has nothing to say", () => {
    expect(offeredSource()).toBe("arasaac");
    symbols.setActiveSource("metacom");
    expect(offeredSource()).toBe("metacom");
  });

  it("counts a Sammlung of nothing but uploads as nothing to say", () => {
    // A photograph of a grandmother is not a symbol collection, and a
    // Sammlung of them owes no attribution and has decided nothing. Locking
    // the picker to a source on the strength of one would be inventing an
    // answer nobody gave.
    state.layout = talker("oma.png", "hund.jpg");
    expect(offeredSource()).toBe("arasaac");
    symbols.setActiveSource("metacom");
    expect(offeredSource()).toBe("metacom");
  });

  it("follows the Sammlung over the machine, which is the whole fix", () => {
    // The bug, in both directions. Neither of these depended on the setting
    // before, and both of them produced a board the export would refuse.
    state.layout = talker("metacom:ja", "metacom:nein");
    expect(offeredSource()).toBe("metacom");

    state.layout = talker("arasaac-2462.png");
    symbols.setActiveSource("metacom");
    expect(offeredSource()).toBe("arasaac");
  });

  it("reads a tablet Sammlung the same way", () => {
    // Both editors open the same picture column, through drawPick(). One fix.
    state.layout = tablet("metacom:ja");
    expect(offeredSource()).toBe("metacom");
    state.layout = tablet("arasaac-1.png");
    symbols.setActiveSource("metacom");
    expect(offeredSource()).toBe("arasaac");
  });

  it("defers rather than refusing when the Sammlung is already mixed", () => {
    // One can be, because one could be built before the picker followed
    // anything. It is the Sammlung that most needs a picture column open in
    // it, so this is deliberately not a refusal.
    state.layout = talker("metacom:ja", "arasaac-2462.png");
    expect(offeredSource()).toBe("arasaac");
    symbols.setActiveSource("metacom");
    expect(offeredSource()).toBe("metacom");
  });
});

describe("a collection this browser cannot reach", () => {
  /* No METACOM folder is connected in a test runner, which is the same state
   * as a browser that has forgotten one over a restart - the ordinary case on
   * Chromium, where the grant is scoped to the site rather than to the app. */
  beforeEach(() => { state.layout = talker("metacom:ja"); });

  it("is not quietly swapped for the other one", async () => {
    expect(symbols.metacomReady()).toBe(false);
    const answer = await findSymbols("trinken");
    // No hits at all, and in particular none from ARASAAC: a picture taken
    // from there is a key this Sammlung can no longer export.
    expect(answer.hits).toEqual([]);
    expect(answer.empty).toContain(t("ui.metacom_needed"));
  });

  it("says so under the pictures as well as in the results", () => {
    expect(creditLine()).toContain(t("ui.metacom_needed"));
    // And not ARASAAC's notice, which is owed for pictures that are not here
    // and are not going to be taken.
    expect(creditLine()).not.toContain(t("ui.metacom_offer"));
  });

  it("still names the collection it is going to search", () => {
    expect(searchPlaceholder()).toBe(t("ui.search_metacom"));
  });
});
