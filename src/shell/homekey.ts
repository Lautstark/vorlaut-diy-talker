// The picture on a start key, and the one thing about it that is not a choice.
//
// A tablet Sammlung is made with a key in the corner that goes back to the
// start page - see app.blank() in editor-app/editor.ts - and that key opens
// with a picture already on it. Which picture is prescribed rather than picked:
// there is one per collection, chosen once with the user after comparing the
// candidates in both, and everything below follows from that decision being a
// fact about the product rather than about any one Sammlung.
//
// Everything here is a *starting* value. The key is an ordinary button from the
// moment it exists - a different picture, a different word, a different act are
// all one press away - and nothing in this file is consulted again once a
// Sammlung has been made.
//
// ## Why the collection decides, and why it has to
//
// exchange/SPEC.md §5.1 allows one symbol source per package, and
// data/app_package.ts refuses to build a mixed one. A prescribed picture that
// came from a fixed collection would therefore break every Sammlung drawn in
// the other, on the first export, for a key nobody chose. Picking it per source
// satisfies §5.1 by construction: whichever collection the Sammlung is in, the
// house comes out of that one.
//
// ## Why both are the black-and-white variant
//
// The key is drawn light-on-dark - a dark plate, with the picture's luminance
// mapped onto two tones (HOME_TONES below, and the Android viewer's own
// ColorFilter). That mapping only holds on a greyscale source; a coloured
// pictogram put through it comes out tinted. So both prescribed symbols are the
// monochrome variant, and each collection offers one its own way: METACOM ships
// a black-and-white file beside nearly every symbol - hence the `SW` suffix -
// and ARASAAC renders one on demand, which is the half data/symbols.ts's
// arasaacMonochromeUrl() exists for.
import { pickSymbol } from "../backend/index.js";
import { activeSource, arasaacFile, arasaacMonochromeUrl, metacomImageByName }
  from "../data/symbols.js";
import { t } from "../core/texts.js";
import type { ProviderId } from "@lautstark/bildquelle";

/**
 * The house, per collection. Decided with the user after comparing candidates
 * from both.
 *
 * ARASAAC's is an id - "Haus, Haushalt, Zuhause" - and METACOM's is a path
 * under the collection root with the extension dropped, which is the shape
 * data/symbols.ts's pickReference() stores. The `SW` is load-bearing and is not
 * a spelling of the name: `haus4` and `haus4SW` are two files, and only the
 * second one survives the two-tone mapping.
 */
const HOUSE = { arasaac: "6964", metacom: "Haus/haus4SW" } as const;

/**
 * How the key is drawn: a plain linear map from the picture's luminance onto
 * two tones, `out = light - (light - plate) * in`.
 *
 * Written out as the five columns of an feColorMatrix, because that is what
 * both readers take - templates/frame.ts mounts the filter these numbers are,
 * and the Android viewer hands the same numbers to ColorFilter.colorMatrix. A
 * shared shape rather than two derivations of one formula, so the editor and
 * the tablet cannot drift by a rounding.
 *
 * **`invert(1)` is not this and looks wrong.** Inverting takes the white
 * interior of the house to pure black, which on a dark plate reads as a hole
 * cut through the key rather than as a drawing on it. The map above takes the
 * same white to the plate's own colour, so the interior simply is the plate.
 */
export const HOME_TONES = {
  /** What black in the picture becomes: the strokes. */
  light: "#EBEBF0",
  /** What white in the picture becomes: the key itself. */
  plate: "#24242A",
  /** The two of them as the matrix, row-major, alpha untouched. */
  matrix: [
    -0.7804, 0, 0, 0, 0.9216,
    0, -0.7804, 0, 0, 0.9216,
    0, 0, -0.7765, 0, 0.9412,
    0, 0, 0, 1, 0,
  ],
} as const;

/**
 * Which collection a Sammlung made right now would be drawn in.
 *
 * The machine's, not any Sammlung's, and that is the whole of the difference
 * from picker.ts's offeredSource(): a Sammlung being *made* has no symbols to
 * derive an answer from, so there is nothing to defer to but the setting - and
 * offeredSource() would be reading the Sammlung that happens to still be open,
 * which is the one on screen a moment ago rather than the one being made.
 */
export const homeSymbolSource = (): ProviderId => activeSource();

/** The reference a start key holds, in the collection given. */
export const homeSymbol = (source: ProviderId): string =>
  source === "metacom" ? `metacom:${HOUSE.metacom}`
                       : arasaacFile(HOUSE.arasaac, true);

/** The word this picture is a picture of, in the language the page is in. The
 *  label a start key is made with, and the caption the picker's tile carries
 *  through to a key that has none. */
export const homeWord = (): string => t("ui.app_home_key");

/**
 * The picture behind that reference, kept where whoever draws it can reach it,
 * and the reference itself.
 *
 * The two collections need opposite things and it is the licence that makes
 * them opposite. A METACOM symbol is never copied anywhere - it stays a
 * reference into somebody's own licensed folder - so there is nothing to fetch
 * and this returns immediately. An ARASAAC pick is a download into this
 * browser's store, exactly as an ordinary pick is, and it goes through the same
 * seam so that there is one place that writes a symbol file.
 *
 * Throws what the download throws. Both callers have somewhere to put it: the
 * picker says so in the status line, and a Sammlung being made keeps its key
 * and shows the "no picture" sentence until the network comes back.
 */
export async function takeHomeSymbol(source: ProviderId)
  : Promise<{ symbol: string; label: string }> {
  const label = homeWord();
  if (source === "metacom") return { symbol: homeSymbol(source), label };
  const kept = await pickSymbol({
    source: "arasaac", id: HOUSE.arasaac, label, monochrome: true,
  });
  return { symbol: kept.symbol, label };
}

/** A URL for showing the prescribed house, or null where the collection cannot
 *  be reached - a METACOM folder that is not connected in this browser. */
export const homeSymbolUrl = (source: ProviderId): Promise<string | null> =>
  source === "metacom" ? metacomImageByName(HOUSE.metacom)
                       : arasaacMonochromeUrl(HOUSE.arasaac);

/* Which searches are asking for it.
 *
 * Both languages whichever the page is in, because a word is not a claim about
 * who typed it: a carer working in German may be building an English Sammlung,
 * and "home" typed there means the same key either way. Short and closed rather
 * than a stem match - "haust" and "started" are not this - and the list is the
 * words for the key rather than the words for a building, which is why the
 * German for "start page" is in it and the German for "shed" is not.
 */
const ASKS = new Set([
  "home", "house", "start", "start key", "start page",
  "haus", "startseite", "starttaste", "zuhause",
]);

/** Whether what somebody typed is asking for the start key's picture. */
export const asksForHome = (word: string): boolean =>
  ASKS.has(word.trim().toLowerCase());

/* Kept out of this file deliberately: anything that draws. The tile is
 * shell/sheet.ts's, the filter is templates/frame.ts's, and the dark plate is
 * a rule in ui.css. What is here is which picture, where it comes from, and
 * what a press to take it costs - the three answers a caller cannot work out
 * and must not each hold a copy of. */
