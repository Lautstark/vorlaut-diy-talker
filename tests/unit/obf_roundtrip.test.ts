/* A board that goes out as a document and comes back has to be the same board.
 *
 *     node tests/browser/obf_roundtrip.test.mjs
 *
 * Run by tests/test_browser_js.py, so `python3 tests/run.py` includes it.
 *
 * Why this exists next to tests/reference/obf.lock.json, which already holds
 * what obf.py said about this converter. A lock file answers for the cases
 * recorded in it and for nothing else, and obf.py is gone, so no new case can
 * ever be added to it. This asks a question that needs no oracle at all:
 *
 *     documentToLayout(layoutToDocument(x)) == x
 *
 * That is true of any correct mapping, for any input, whether or not anybody
 * wrote the input down first. So it covers exactly what the lock structurally
 * cannot - boards nobody thought to record - and it goes on working with no
 * Python anywhere.
 *
 * WHAT IT CANNOT CATCH, and this matters when you read a green run: it checks
 * structure, not schema. If a field is written under the wrong *name*, both
 * directions agree on the wrong name and the round trip closes perfectly. A
 * `.obf` that no other program can read would pass every check in this file.
 *
 * That is not hypothetical. Breaking `label` on the way out - writing a fixed
 * string, or nothing - passes everything here, because `label` is what another
 * editor shows on the key while this converter reads a slot's text back out of
 * `vocalization` and only falls back to the label. Every field that exists for
 * somebody else's software is invisible to a round trip, and those are exactly
 * the fields that make the format worth having.
 *
 * The example used to be `border_color`, which was the same shape - written
 * for a foreign renderer, read back out of `ext_vorlaut_color`. Both went with
 * the set colour.
 *
 * Only tests/reference/obf.lock.json has an opinion about the names, and only
 * for the boards recorded in it. The two are complements; neither is the
 * check, and after obf.py went there is no third thing.
 *
 * What it does catch is most of what actually breaks in a mapping: a field
 * dropped on the way out or on the way back, a list reordered, a nesting
 * flattened, a value coerced to the wrong type, a locale lost.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const obf = await import("../../src/data/obf.js");
const { layoutToDocument, documentToLayout, normalizeLayout } = obf;

import { check } from "./harness.js";

/* --- saying what differs, not that something does ----------------------- */

/** The first real difference between two values, as a path a human can follow.
 *
 * `sets[1].slots[2].text: "Stopp" became undefined` rather than two objects
 * printed side by side. A mapping bug is read at the wrong end of a long day
 * and the useful sentence is which field went missing, not both documents. */
function difference(want, got, path = "") {
  const where = path || "(the whole layout)";
  if (want === got) return null;
  if (want === null || got === null || typeof want !== typeof got) {
    return `${where}: ${JSON.stringify(want)} became ${JSON.stringify(got)}`;
  }
  if (typeof want !== "object") {
    return `${where}: ${JSON.stringify(want)} became ${JSON.stringify(got)}`;
  }
  if (Array.isArray(want) !== Array.isArray(got)) {
    return `${where}: ${Array.isArray(want) ? "a list" : "an object"} became `
         + `${Array.isArray(got) ? "a list" : "an object"}`;
  }
  if (Array.isArray(want)) {
    if (want.length !== got.length) {
      return `${where}: ${want.length} item(s) became ${got.length}`;
    }
    for (let i = 0; i < want.length; i++) {
      const found = difference(want[i], got[i], `${where === "(the whole layout)" ? "" : where}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  const missing = Object.keys(want).filter((k) => !(k in got));
  if (missing.length) return `${where}: lost ${missing.join(", ")}`;
  const added = Object.keys(got).filter((k) => !(k in want));
  if (added.length) return `${where}: gained ${added.join(", ")}`;
  for (const key of Object.keys(want)) {
    const next = where === "(the whole layout)" ? key : `${where}.${key}`;
    const found = difference(want[key], got[key], next);
    if (found) return found;
  }
  return null;
}

/* --- boards to try ------------------------------------------------------ */

/* Deterministic rather than random: a property test that fails once a
 * fortnight on a seed nobody kept is worse than one that fails every time.
 * These are chosen to have somewhere for a field to hide - empty and full
 * sets, slots with and without text, both languages, and the boundaries of the
 * sleep timeout. */
const board = (over = {}) => normalizeLayout({
  sleep_timeout_seconds: 600,
  language: "de",
  sets: [{
    name: "Grundset", symbol: "a.png",
    slots: [{ text: "Ja", symbol: "ja.png" },
            { text: "", symbol: "" },
            { text: "Stopp", symbol: "metacom:stopp" },
            { text: "Hilf mir", symbol: "hilfe.png" }],
  }],
  ...over,
});

/* A layout with no sets is the one case where the property genuinely cannot
 * hold, and it is kept rather than dropped because the reason is worth having
 * written down. Open Board Format carries the locale *on a board*; a layout
 * with no sets becomes a document with no boards at all - root "", boards {} -
 * so there is nowhere for the language to travel and it comes back as the
 * default. No change to this converter could fix that without inventing a
 * place to stash it that no other program would read.
 *
 * So the case still runs and everything else about it still has to survive.
 * Only `language` is exempt, by name, and this is the only exemption in the
 * file - see EXEMPT below. A green run here means "we know this one is lost",
 * not "nothing is lost". */
const EXEMPT = { "no sets at all": ["language"] };

const CASES = [
  ["one full set", board()],
  ["no sets at all", board({ sets: [] })],
  ["a slot with text and no symbol",
   board({ sets: [{ name: "S",
                    slots: [{ text: "Nur Text", symbol: "" }] }] })],
  ["a slot with a symbol and no text",
   board({ sets: [{ name: "S",
                    slots: [{ text: "", symbol: "nur.png" }] }] })],
  ["five sets, so the order has somewhere to go wrong",
   board({ sets: Array.from({ length: 5 }, (_, i) => ({
     name: `Set ${i}`,
     slots: Array.from({ length: 4 }, (_, j) => ({
       text: `Satz ${i}${j}`, symbol: `b${i}${j}.png` })),
   })) })],
  ["three sets with nothing on them at all",
   board({ sets: [{ name: "Erstes", slots: [] },
                  { name: "Zweites", slots: [] },
                  { name: "Drittes", slots: [] }] })],
  ["English", board({ language: "en" })],
  ["a METACOM symbol, which travels as a reference and not as pixels",
   board({ sets: [{ name: "M",
                    slots: [{ text: "Essen", symbol: "metacom:essen" }] }] })],
  // Sixteen two-byte characters: exactly the 32 bytes a set name has room
  // for. "é" rather than an umlaut only because tests/german.py reads an
  // umlaut in a source file as German prose that should have been English,
  // and this is a length, not a word. The same character the old
  // test_layout_format.py used, for the same reason.
  ["a name of exactly 32 bytes in two-byte characters",
   board({ sets: [{ name: "\u00e9".repeat(16), slots: [] }] })],
  ["the shortest sleep", board({ sleep_timeout_seconds: 0 })],
  ["the longest sleep", board({ sleep_timeout_seconds: 86400 })],
];

/* --- the property ------------------------------------------------------- */

for (const [name, layout] of CASES) {
  let there;
  try {
    there = await layoutToDocument(layout);
  } catch (error) {
    check(`${name}: goes out as a document`, false, String(error.message || error));
    continue;
  }
  let back;
  try {
    back = documentToLayout({ root: there.root, boards: there.boards });
  } catch (error) {
    check(`${name}: and comes back`, false, String(error.message || error));
    continue;
  }
  const exempt = EXEMPT[name] || [];
  const want = { ...layout }, got = { ...back };
  for (const field of exempt) { delete want[field]; delete got[field]; }
  const found = difference(want, got);
  check(`${name}: comes back the same board`
        + (exempt.length ? ` (except ${exempt.join(", ")}, which cannot travel)` : ""),
        found === null, found || "");
}

/* Twice round, because a mapping can be wrong in a way that is stable: a
 * field dropped on the first trip is already absent on the second, so a
 * single round trip that lost it would still agree with itself. */
const [firstName, firstLayout] = CASES[0];
const once = documentToLayout(await layoutToDocument(firstLayout));
const twice = documentToLayout(await layoutToDocument(once));
check(`${firstName}: and again, so a stable loss cannot hide`,
      difference(once, twice) === null, difference(once, twice) || "");

