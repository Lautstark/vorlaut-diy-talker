import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../../src/core/state.js";
import * as symbols from "../../src/data/symbols.js";
import { findSymbols } from "../../src/shell/picker.js";
import { homeWord } from "../../src/shell/homekey.js";
import type { AppLayout } from "../../src/core/types.js";

/* The one tile in the picker the collection did not answer with.
 *
 * A start key has a prescribed picture - shell/homekey.ts - and somebody
 * looking for it types a word for it. What must not happen is that the search
 * answers with the coloured house, or with nothing, and leaves the person who
 * wanted the start key's picture to find out later that theirs is the wrong
 * one: the two are indistinguishable on a white thumbnail and differ entirely
 * on a dark key.
 *
 * So the suggestion is asserted here as part of the *answer*, before anything
 * draws it. What it looks like is shell/sheet.ts's and ui.css's; what it is -
 * offered for these words, offered even when the collection has nothing, and
 * never offered for a word that merely starts the same way - is this file's.
 */

/** A Sammlung with nothing in it, so offeredSource() falls to the machine. */
const empty = (): AppLayout => ({
  target: "app",
  grid: { rows: 3, columns: 5 },
  home: "p-start",
  pages: [{ id: "p-start", name: "Start", buttons: [] }],
});

/* One PNG and one empty search result, told apart by which host is being
 * asked. The point of the stub is that nothing here reaches the network; the
 * bytes stand in for a picture and the empty array for a collection that has
 * no word for what was typed - which is the answer that matters most, because
 * that is the search the tile has to survive. */
const stubNetwork = () => vi.stubGlobal("fetch", vi.fn((url: string) =>
  Promise.resolve(String(url).includes("/pictograms/")
      && !String(url).includes("/v1/pictograms/")
    ? { ok: true, status: 200, blob: () => Promise.resolve(new Blob(["png"])) }
    : { ok: true, status: 200, json: () => Promise.resolve([]) } as unknown,
  ) as Promise<Response>));

beforeEach(() => {
  symbols.setActiveSource("arasaac");
  state.layout = empty();
  stubNetwork();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the prescribed start-key picture, in a search", () => {
  it("is offered for the words that mean the key", async () => {
    const answer = await findSymbols("home");
    expect(answer.home).not.toBeNull();
    expect(answer.home!.url).toBeTruthy();
    // The word this picture is a picture of, which is also what a key with no
    // label of its own gets when somebody presses the tile.
    expect(answer.home!.caption).toBe(homeWord());
  });

  it("survives a collection that has no word for it", async () => {
    // The stub answers every search with nothing, which is the shape of a
    // collection that does not hold the word - and the exact search where
    // being shown the house that *was* chosen out of it is worth the most.
    const answer = await findSymbols("haus");
    expect(answer.hits).toEqual([]);
    expect(answer.empty).toBeTruthy();
    expect(answer.home).not.toBeNull();
  });

  it("is not offered for an ordinary search", async () => {
    // Nearly every search. A tile that turned up beside "trinken" would be the
    // picker having an opinion about a key nobody is editing.
    expect((await findSymbols("trinken")).home).toBeNull();
    expect((await findSymbols("started")).home).toBeNull();
  });

  it("is not offered out of a collection this browser cannot reach", async () => {
    // No METACOM folder is connected in a test runner. There is no sentence
    // to write about it: the search already says the folder is wanted, and a
    // second line about a tile nobody asked for would be the picker
    // explaining a feature instead of answering a search.
    symbols.setActiveSource("metacom");
    const answer = await findSymbols("haus");
    expect(symbols.metacomReady()).toBe(false);
    expect(answer.home).toBeNull();
  });
});
