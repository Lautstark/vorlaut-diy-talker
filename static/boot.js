// What the server knows and the page needs: the language, its text table, the
// palette and the set limits.
//
// This used to be five placeholders that app.py replaced in the page as it
// served it - __LANG__, __TEXTS__, __LANGUAGES__, __PALETTE__, __LIMITS__.
// json.dumps does not escape </script>, so a value holding that string would
// have ended the script element early and the rest of the page would have
// been parsed as markup. Nothing said so; it was safe only because everything
// going through those holes happened to be trusted.
//
// Now there is one hole instead of five, it is a JSON island rather than live
// script, and app.py escapes < on the way in. A value can no longer say
// anything the parser listens to.
// And when there is no server, there is no block. Then the same values come
// out of boot_data.js, which tools/bootdata.py writes from texts.py - so the
// two pages are reading one table rather than two that have to be kept level.
// The island wins where it exists: while app.py is still here, what it says
// about the language is the answer, because it is the half that knows what the
// request asked for.
import { LANGUAGES as BUILT_IN_LANGUAGES, DEFAULT_LANGUAGE, TEXTS as BUILT_IN_TEXTS,
         PALETTE, LIMITS } from "./boot_data.js";

const island = document.getElementById("bootstrap");
const boot = island ? JSON.parse(island.textContent) : null;

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

export const LANG = boot ? boot.lang : preferred();
export const LANGUAGES = boot ? boot.languages : BUILT_IN_LANGUAGES;
export const TEXTS = boot ? boot.texts : BUILT_IN_TEXTS[LANG];
export const palette = boot ? boot.palette : PALETTE;
export const limits = boot ? boot.limits : LIMITS;
