// The language this page is read in, and the labels that follow from it.
//
// A copy of what src/core/boot.ts did for two pages, cut down to what one page
// needs. docs/split-crossings.md's direction two costed it that way - t() and
// LANG **copied**, Trouble moved whole - and the reason it is a copy rather
// than a package is repository-map.md's rule: a second consumer justifies an
// extraction, and after the split there is one consumer on each side of the
// seam rather than two on one.
//
// What was left behind, because this page has no use for it: setLanguage() and
// rememberLanguage(), the LANGUAGE_NAMES table, the limits, the grid and the
// word classes. This page has no settings sheet and no language control - it
// is opened with a talker in front of you, does one thing and closes - so the
// choice is read once and never changed here.
//
// The choice is shared with the editor, and that is worth knowing rather than
// discovering. Both pages read `vorlaut.language` out of localStorage, and two
// GitHub Pages project sites under lautstark.github.io share an origin, so a
// carer who set German in the editor still gets German here for free. It stops
// the moment either side takes a custom domain, silently, with this page simply
// opening in the browser's preference instead. Nothing breaks; a label changes
// language. docs/split-crossings.md's direction three is where that is written
// down.
import { DEFAULT_LANGUAGE, LANGUAGES, TEXTS as ALL } from "./boot_data.js";

const CHOICE = "vorlaut.language";

/** What the reader's browser asks for, if this page has it.
 *
 * navigator.languages is in the order they chose and carries regions - "de-AT"
 * has to find "de" - so it is the prefix that is compared. */
function preferred(): string {
  for (const tag of navigator.languages || [navigator.language || ""]) {
    const base = String(tag).toLowerCase().split("-")[0]!;
    if (LANGUAGES.includes(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

function remembered(): string {
  try {
    return localStorage.getItem(CHOICE) || "";
  } catch {
    // Safari in private browsing throws on access rather than answering.
    return "";
  }
}

export const LANG = LANGUAGES.includes(remembered()) ? remembered() : preferred();

const TEXTS = ALL[LANG] ?? ALL[DEFAULT_LANGUAGE]!;

/**
 * A label out of the table, with its blanks filled in.
 *
 * The key itself when there is no entry, deliberately. A blank would hide a
 * missing label in whichever language nobody is reading, and a key on the
 * screen names the line to add.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let out = TEXTS[key] || key;
  if (params) {
    for (const name in params) {
      out = out.split("{" + name + "}").join(String(params[name]));
    }
  }
  return out;
}
