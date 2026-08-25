import { beforeEach, describe, expect, it } from "vitest";
import { shippable } from "@lautstark/stimmquelle";
import * as store from "../../src/data/store.js";
import { defaultVoice, listVoices } from "../../src/backend/local.js";
import type { Layout } from "../../src/core/types.js";

/* Which voice a Sammlung speaks in when nobody has said, and what happens to
 * one that was said and is no longer on offer.
 *
 * The seam under test is the pair of names listVoices() answers with. `chosen`
 * is what stands in layout.json; `active` is what would speak if somebody
 * pressed play now. They used to be the same value, so a fresh Sammlung opened
 * the sheet with nothing ticked and the build quietly picked a voice of its
 * own a layer down - two answers to one question, and only one of them on
 * screen.
 *
 * **The pick is asserted twice, and neither time as an id.** In today's
 * catalogue the recommended voice for both languages also happens to come
 * first in array order, so `expect(active).toBe("piper:en_US-kristin-medium")`
 * would pass whether or not `recommended` is read at all - it would be
 * measuring the catalogue's ordering and calling it the rule. Through
 * listVoices() what is asserted is the property instead: the voice speaks the
 * Sammlung's language and carries the flag. And the rule itself is put to a
 * list built so that the two answers differ, which is the only way to hold the
 * flag shut - it is what stops array order handing somebody the 114 MB
 * Thorsten the day stimmquelle reorders.
 */

const OFFERED = shippable({ ownsInference: true });

/** The same id shape listVoices() answers with, for looking a pick back up. */
const catalogued = (id: string) =>
  OFFERED.find((voice) => `piper:${voice.id}` === id);

const board = (extra: Partial<Layout> = {}): Layout => ({
  sleep_timeout_seconds: 600,
  sets: [{
    name: "Set", symbol: "", color: "#3B5BDB",
    slots: [0, 1, 2, 3].map(() => ({ text: "", symbol: "" })),
  }],
  ...extra,
});

/** Back to a browser that has never opened this page. */
async function only(layout: Layout): Promise<void> {
  for (const one of (await store.readCollections()).collections) {
    await store.deleteCollection(one.id);
  }
  await store.writeLayout(layout, null);
}

beforeEach(async () => { await only(board()); });

describe("the voice a Sammlung starts on", () => {
  it("speaks the Sammlung's language, and is the catalogue's pick for it", async () => {
    for (const language of ["de", "en"]) {
      await only(board({ language }));
      const { active, chosen } = await listVoices();

      // Nobody has chosen: the layout still holds nothing, which is what puts
      // the auto note on the row rather than a tick nobody made.
      expect(chosen).toBe("");

      const voice = catalogued(active);
      expect(voice, `${language} has no offered voice`).toBeTruthy();
      expect(voice!.lang).toBe(language);
      expect(voice!.recommended).toBe(true);
    }
  });

  it("reads the Sammlung's language, not the one this page is written in", async () => {
    // The whole point of the split the layer below just made. A German carer
    // building an English board must not be handed a German voice, and the
    // page's own language is not in layout.json to be read by accident.
    await only(board({ language: "en" }));
    expect(catalogued((await listVoices()).active)!.lang).toBe("en");

    await only(board({ language: "de" }));
    expect(catalogued((await listVoices()).active)!.lang).toBe("de");
  });

  it("falls back to the page's default when the Sammlung names no language", async () => {
    // Every Sammlung written before the field existed is this one.
    const { active } = await listVoices();
    expect(catalogued(active)).toBeTruthy();
  });
});

describe("a voice somebody chose", () => {
  it("wins, and is what speaks", async () => {
    const wanted = `piper:${OFFERED[OFFERED.length - 1]!.id}`;
    await only(board({ language: "de", voice: wanted }));

    const { active, chosen } = await listVoices();
    expect(chosen).toBe(wanted);
    expect(active).toBe(wanted);
  });

  it("does not move when the Sammlung's language changes under it", async () => {
    // A German voice on an English board is somebody's arrangement, not a
    // mistake to correct. Only a guess may be revisited.
    const german = OFFERED.find((voice) => voice.lang === "de")!;
    const wanted = `piper:${german.id}`;
    await only(board({ language: "en", voice: wanted }));

    const { active, chosen } = await listVoices();
    expect(chosen).toBe(wanted);
    expect(active).toBe(wanted);
  });

  it("stays stored when it is not offered here, but stops being what speaks", async () => {
    // An Azure voice with the key withdrawn. It stays in the layout on
    // purpose, so the choice outlives the key going away and coming back - the
    // sheet draws it as a row of its own and says it is not available. But it
    // must not be the answer to "what speaks now", or the next recording fails
    // where it could have fallen back.
    const wanted = "azure:de-DE-KatjaNeural";
    await only(board({ language: "en", voice: wanted }));

    const { voices, active, chosen } = await listVoices();
    expect(voices.some((voice) => voice.id === wanted)).toBe(false);
    expect(chosen).toBe(wanted);
    expect(active).not.toBe(wanted);

    const fell = catalogued(active);
    expect(fell).toBeTruthy();
    expect(fell!.lang).toBe("en");
    expect(fell!.recommended).toBe(true);
  });
});

describe("the rule itself, on a list where order and the flag disagree", () => {
  /* stimmquelle's own shape, cut to the three fields the rule reads. Built
   * here rather than filtered out of the catalogue precisely so that the
   * recommended voice is NOT the first one for its language - which is the
   * arrangement the shipped catalogue does not currently have and the whole
   * reason the flag is read. */
  const list = [
    { id: "de_DE-thorsten-high", lang: "de", recommended: false },
    { id: "de_DE-thorsten-medium", lang: "de", recommended: true },
    { id: "en_US-ljspeech-medium", lang: "en", recommended: false },
    { id: "en_US-kristin-medium", lang: "en", recommended: true },
  ] as unknown as Parameters<typeof defaultVoice>[0];

  it("takes the flagged voice over the first one for the language", () => {
    expect(defaultVoice(list, "de")).toBe("piper:de_DE-thorsten-medium");
    expect(defaultVoice(list, "en")).toBe("piper:en_US-kristin-medium");
  });

  it("takes the first of the language when none is flagged", () => {
    const unflagged = list.map((voice) => ({ ...voice, recommended: false }));
    expect(defaultVoice(unflagged, "en")).toBe("piper:en_US-ljspeech-medium");
  });

  it("takes the first of all when the language speaks none", () => {
    // A language nothing in the catalogue speaks is better answered with a
    // voice than with silence: silence is a build that cannot speak at all.
    expect(defaultVoice(list, "fr")).toBe("piper:de_DE-thorsten-high");
  });

  it("answers with nothing when there is nothing to answer with", () => {
    expect(defaultVoice([], "de")).toBe("");
  });
});
