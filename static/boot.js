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
const island = document.getElementById("bootstrap");
if (!island) {
  throw new Error("the bootstrap block is missing from the page");
}
const boot = JSON.parse(island.textContent);

export const LANG = boot.lang;
export const LANGUAGES = boot.languages;
export const TEXTS = boot.texts;
export const palette = boot.palette;
export const limits = boot.limits;
