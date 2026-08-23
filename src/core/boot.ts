// What the page needs before it can say anything: the language, its text
// table, the palette and the set limits.
//
// This used to arrive from app.py. First as five placeholders it substituted
// into live script - __LANG__, __TEXTS__, __LANGUAGES__, __PALETTE__,
// __LIMITS__ - and json.dumps does not escape </script>, so a value holding
// that string would have ended the script element early and the rest of the
// page would have been parsed as markup. Nothing said so; it was safe only
// because everything going through those holes happened to be trusted. Then as
// one JSON island, which was the same hole made narrow rather than closed.
//
// There is no server now, so there is no island and no branch to read one.
// boot_data.js is the table itself rather than a copy of texts.py - see
// tests/browser/boot_data.test.mjs, which is what keeps the languages level -
// and a value in it reaches the page as a module export, which the HTML parser
// never looks at.
//
// The branch went with the island deliberately. Keeping `island ? ... : ...`
// for a block that can no longer be in the page is a live-looking path nobody
// can reach, and the way it failed is the argument: the block outlived the
// half that filled it in, JSON.parse read the literal "__BOOTSTRAP__", and the
// whole module tree died before rendering. A fallback that only fires when the
// block is absent does not help when the block is present and empty of meaning.
import { LANGUAGES as BUILT_IN_LANGUAGES, DEFAULT_LANGUAGE, TEXTS as BUILT_IN_TEXTS,
         PALETTE, LIMITS } from "./boot_data.js";

/** Which language a page nobody configured should open in.
 *
 * The reader's own preference, if the product has it, and English if not.
 * navigator.languages is in the order they chose, and carries regions - "de-AT"
 * has to find "de" - so it is the prefix that is compared.
 *
 * Only until a layout is loaded: the language somebody picked lives in the
 * layout beside the voice, and that one wins once it has been read. This is
 * what to show in the meantime, which on a first visit is what to show at all.
 */
function preferred() {
  for (const tag of navigator.languages || [navigator.language || ""]) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (BUILT_IN_LANGUAGES.includes(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

/* `let`, not `const`, and that is the whole of what makes a language switch a
 * re-render rather than a reload.
 *
 * An ES import is a live binding: a module that does `import { LANG }` reads
 * this variable, not a copy taken when it loaded. So reassigning it here is
 * seen everywhere at once, and t() starts answering out of the other table on
 * the very next call. Nothing may capture either value into a local - that is
 * the one rule this arrangement asks for.
 *
 * The settings sheet used to reload the page for this, because the labels were
 * baked in by the server and a second copy of every string in the browser was
 * the alternative. Both halves of that are gone: boot_data.ts carries both
 * languages already, and the reload was the reason the sheet needed a Save
 * button - it would have thrown away a half-typed Azure key. */
export let LANG = preferred();
export const LANGUAGES = BUILT_IN_LANGUAGES;
export let TEXTS = BUILT_IN_TEXTS[LANG];

/** Switch language in place. Callers re-apply the labels; this only moves the
 *  two values every label is read through. */
export function setLanguage(code: string): void {
  if (!BUILT_IN_LANGUAGES.includes(code) || code === LANG) return;
  LANG = code;
  TEXTS = BUILT_IN_TEXTS[code];
}
export const palette = PALETTE;
export const limits = LIMITS;
