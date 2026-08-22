/* What src/core/boot_data.ts has to be true of, now that nothing generates it.
 *
 *     node tests/browser/boot_data.test.mjs
 *
 * This file used to be written by tools/bootdata.py out of texts.py, and
 * tests/test_boot_data.py checked it had not drifted from that source. Both
 * are gone: the page carries its own labels now, in every language, and this
 * file is the source rather than a copy of one.
 *
 * That removes the drift this repository used to worry about and leaves the
 * one it always had underneath it. texts.py held both languages in one dict,
 * so a missing translation was hard to write; two objects side by side make it
 * easy. A key present in one language and not the other is invisible until
 * somebody opens the page in the language they do not speak and reads a raw
 * key, or worse, nothing.
 *
 * tests/test_ui_texts.py used to say "204 keys in 2 languages, in step" on
 * every run. It went with app.py. This is what is left of that sentence, and
 * it is the whole reason this file exists.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const boot = await import("../../src/core/boot_data.js");

import { check } from "./harness.js";

const { LANGUAGES, DEFAULT_LANGUAGE, TEXTS, PALETTE, LIMITS } = boot;

check("it names the languages it carries",
      Array.isArray(LANGUAGES) && LANGUAGES.length > 0,
      JSON.stringify(LANGUAGES));

check("the default is one of them",
      LANGUAGES.includes(DEFAULT_LANGUAGE), DEFAULT_LANGUAGE);

check("every named language has a table, and nothing else does",
      LANGUAGES.every((l) => TEXTS[l])
      && Object.keys(TEXTS).length === LANGUAGES.length,
      `TEXTS has ${Object.keys(TEXTS).sort().join(", ")}`);

/* The check this file was written for. */
const keysOf = (l) => Object.keys(TEXTS[l] || {}).sort();
const first = LANGUAGES[0];
for (const language of LANGUAGES.slice(1)) {
  const a = new Set(keysOf(first));
  const b = new Set(keysOf(language));
  const missing = [...a].filter((k) => !b.has(k));
  const extra = [...b].filter((k) => !a.has(k));
  check(`${language} says everything ${first} says, and nothing more`,
        !missing.length && !extra.length,
        [missing.length ? `missing from ${language}: ${missing.join(", ")}` : "",
         extra.length ? `only in ${language}: ${extra.join(", ")}` : ""]
          .filter(Boolean).join("   ")
        || `${a.size} keys in step`);
}

/* An empty string is worse than a missing key: the page renders a blank
 * button rather than falling back or failing. */
for (const language of LANGUAGES) {
  const blank = Object.entries(TEXTS[language])
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);
  check(`no label in ${language} is blank`, !blank.length, blank.join(", "));
}

/* An untranslated label is a real one copied across, which is legitimate -
 * "OBF" is "OBF" in both - so this counts rather than forbids. It is here to
 * make a wholesale copy-paste of one language over the other visible, which
 * is the shape a hurried translation takes. */
if (LANGUAGES.length === 2) {
  const [a, b] = LANGUAGES;
  const same = keysOf(a).filter((k) => TEXTS[a][k] === TEXTS[b][k]);
  const share = same.length / keysOf(a).length;
  check(`${a} and ${b} are not the same table`, share < 0.5,
        `${same.length} of ${keysOf(a).length} labels identical`);
}

check("the palette is there for the set colours",
      Array.isArray(PALETTE) && PALETTE.length > 0
      && PALETTE.every((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
      JSON.stringify(PALETTE));

check("the limits are there and are whole numbers",
      LIMITS && Number.isInteger(LIMITS.maxSets)
      && Number.isInteger(LIMITS.maxActive)
      && LIMITS.maxActive <= LIMITS.maxSets,
      JSON.stringify(LIMITS));

