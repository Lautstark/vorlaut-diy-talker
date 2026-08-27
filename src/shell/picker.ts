// Picking a symbol: searching the collection the open Sammlung is drawn in,
// resolving a hit to what a layout stores, uploading an image of your own, and
// saying which collection that was and what is owed for it.
//
// Which sources are available is bildquelle's answer, not a variable of ours.
// Which of them is offered is the Sammlung's - see offeredSource().
//
// ## There is no dialog here any more
//
// This module was a modal - a search field, a grid of results, a credit line -
// and every caller opened it on top of whatever they were doing. Both editors
// now carry the picture, its search and the upload in the left column of the
// sheet a press opens, so the modal had no way in and nothing to do. What is
// left is what the callers could not have written for themselves and must not
// each own a copy of: which source is offered, what an empty answer means, the
// fact that an ARASAAC pick is a download while a METACOM one is a reference,
// and the sentence the licence requires. See shell/sheet.ts's drawPick(),
// which is the only thing that draws any of it now.
//
// The name survives the dialog because the job did: this is still where a
// symbol is picked. What went is one way of asking.
import { readSettings, pickSymbol, uploadSymbol } from "../backend/index.js";
import { reason } from "../core/errors.js";
import * as symbols from "../data/symbols.js";
import { drawnFrom } from "../data/app_package.js";
import { state } from "../core/state.js";
import { t } from "../core/texts.js";
import {
  asksForHome, homeSymbolUrl, homeWord, takeHomeSymbol,
} from "./homekey.js";
import type { ProviderId } from "@lautstark/bildquelle";

/* --- The seam ------------------------------------------------------------
 *
 * Three operations, so that a caller can put the search where it is standing.
 * Both editors do: a second modal over a modal to choose a symbol is the
 * dialog this design set out to remove, and removing it is what left this file
 * as the seam alone. What a caller must not do is carry a second copy of the
 * reasoning below; only the markup is the caller's. */

/** One hit, as the two sources between them describe it. */
export type SymbolHit = Awaited<ReturnType<typeof symbols.searchIn>>[number];

/**
 * Which collection the picker offers - the open Sammlung's, and only failing
 * that the machine's.
 *
 * "One symbol source per package" is a rule of the format, not a preference:
 * exchange/SPEC.md §5.1, with a licence behind it, and app_package.ts's
 * symbolSource() refuses to build a mixed one. What used to be asked here was
 * symbols.activeSource(), which is a setting of this *browser* - so a second
 * child set up on ARASAAC, or a folder handle that lapsed over a restart,
 * silently changed what the next button added to a METACOM Sammlung came from.
 * The board went mixed and nothing said so until the export, hundreds of
 * syntheses later.
 *
 * So the Sammlung is asked first. It already knows: the answer is derived from
 * the buttons rather than stored beside them, which is why there is no
 * per-Sammlung setting for it and should not be. A source that could be
 * flipped would invite flipping it, and flipping it means replacing every
 * symbol on the board - a deliberate act, and nobody has asked for one.
 *
 * Two Sammlungen defer to the machine rather than to themselves, and they are
 * the same case: one with no symbols yet, and one holding nothing but
 * uploaded pictures. An upload counts towards no source - a photograph of a
 * grandmother is not a symbol collection - so both read as "none", which is
 * the value that says no attribution is owed and nothing has been decided.
 *
 * A Sammlung that is already mixed defers too. It cannot be exported until it
 * is put right, and refusing to search inside it would take away the one
 * place it could be put right from.
 */
export function offeredSource(): ProviderId {
  /* What the Sammlung says, before what it happens to hold.
   *
   * The two agree on every Sammlung that has pictures, so this changes nothing
   * for them; what it adds is the one the reading below cannot answer. A
   * Sammlung with no pictures yet used to follow whatever this machine was set
   * to, which meant switching the machine between two presses built a mixed
   * board out of them. An intention has a memory that a derivation does not. */
  const said = state.layout.symbolSource;
  if (said === "arasaac" || said === "metacom") return said;

  /* Nobody has said, which is every Sammlung written before the field existed.
   * Read it off the board, exactly as it was read before. */
  const drawn = drawnFrom(state.layout);
  if (drawn.metacom.length && !drawn.arasaac.length) return "metacom";
  if (drawn.arasaac.length && !drawn.metacom.length) return "arasaac";
  return symbols.activeSource();
}

/** Whether the picker is offering a collection it cannot currently reach.
 *
 * Only ever the Sammlung's doing: readSettings() refuses "metacom" when no
 * folder is connected, so the machine setting can never land here. A METACOM
 * Sammlung opened in a browser that has not been given the folder back can,
 * and that is the moment the mixed board used to be built - the search quietly
 * answered from ARASAAC and every picture taken from it was the odd one out. */
const outOfReach = (source: ProviderId): boolean =>
  source === "metacom" && !symbols.metacomReady();

/** What to say about it, and what to do: the folder is remembered and wants a
 *  click, or there is none here at all. Both sentences send somebody to the
 *  gear, and the first names the browser prompt that stops it being asked
 *  again. `ui.metacom_needed` is in front of whichever it is, because neither
 *  of them says the thing that matters here - that this Sammlung's symbols
 *  come from METACOM and a picture from anywhere else would mix it. */
function folderWanted(): string {
  const status = symbols.metacomStatus();
  const waiting = status.kind === "needs-setup" && status.code === "permission-needed";
  return `${t("ui.metacom_needed")} ${waiting ? t("ui.metacom_waiting") : ""}`.trim();
}

/** A finished search: the hits, and the sentence that says what kind of answer
 *  they are - which of the two silences an empty one was, or that a full grid
 *  is a grid of near misses.
 *
 *  Packaged together rather than left to the caller, because the difference is
 *  the part that is easy to get wrong: a provider's search() must not throw,
 *  so ARASAAC answers [] for a failed fetch as well as for a word it does not
 *  have, and "nothing found" is the wrong sentence for a browser with no
 *  network. */
export interface SymbolAnswer {
  hits: SymbolHit[];
  /** "" when there are hits. */
  empty: string;
  /** The line above hits that answer something other than what was typed.
   *  "" when one of them really is the word. Never set together with `empty`:
   *  it is about hits, and there are none to be about. */
  near: string;
  /** The picture a start key is prescribed, when the word typed is a word for
   *  one - see shell/homekey.ts. null otherwise, which is nearly always.
   *
   *  Beside the hits and not among them, because it is not one: it is the one
   *  picture in the collection this product has an opinion about, and it is
   *  the same picture whatever the search found. That is also why it survives
   *  an `empty` answer - a collection with no word for "home" still has the
   *  house that was chosen out of it, and that is exactly the search where
   *  somebody most needs to be shown it. */
  home: HomeSuggestion | null;
}

/** The prescribed start-key picture, ready to draw and ready to take.
 *
 * A shape of its own rather than a SymbolHit, and the difference is worth the
 * type. A hit is something a collection answered with and carries whichever
 * identifier its source needs resolving by; this was decided once, for both
 * collections, and already knows what a press stores. Squeezing it into a hit
 * would put a "and also this one is special" flag through takeSymbol(), which
 * is the seam that must stay the plain reading of what each source hands back.
 */
export interface HomeSuggestion {
  /** A URL for `<img src>`. */
  url: string;
  /** What the tile is called, on the tile and to a reader. */
  caption: string;
}

/* --- Whether the grid means the word --------------------------------------
 *
 * A search that finds nothing says so. A search that finds the wrong thing
 * used to look exactly like one that found the right thing: twelve tiles, all
 * confident. Searching "nicht" in METACOM is the case that showed it - every
 * hit a rendering of "nichtbinaer", and the picture somebody wanted nowhere on
 * the screen. Nothing said so, and only somebody who already knew the
 * collection could tell.
 *
 * "METACOM has no 'nicht' symbol at all and never will" is what this said, on
 * the reasoning that German AAC negates by crossing a symbol out rather than
 * with a picture of its own. The crossing out is true and is why a key can be
 * crossed here at all; the conclusion drawn from it was not. METACOM files the
 * negation pair under Kleine_Worte as "nichtkein": two words that mean the
 * same thing in that position, run together because a filename cannot hold
 * the slash between them. Since bildquelle 1.6.4 reads that spelling as the
 * pair it is, it scores 70 and comes first. So this line
 * now goes quiet for that search because the collection really does answer it.
 *
 * bildquelle grades every candidate on one ladder, the same for both sources:
 * the label is the word (100), begins with it as a phrase (70), holds it as
 * one of its words (60), begins with it (55), has a word beginning with it
 * (40), or merely contains it (25). See scoreLabel() in bildquelle's text.ts.
 */

/**
 * Where a hit stops being a hit: the whole word.
 *
 * Not 100. "Nothing matches exactly" is a claim about spelling and this is a
 * claim about pictures - a collection that files the picture as "trinken
 * wasser" has a picture for "trinken", and a reader told otherwise would go
 * looking for a second one that does not exist. 60 is the rung where the word
 * typed is still a word the label is made of, and 70 above it is the same
 * thing with the word at the front.
 *
 * The rung below is where it stops. 55 is "nichtbinaer" for "nicht": a
 * different word that happens to start the same way, and the whole of the
 * case this exists for. 40 and 25 are less again.
 */
const WHOLE_WORD = 60;

/**
 * What ARASAAC adds on top of the ladder for a symbol drawn for AAC use.
 *
 * ARASAAC's rank() does not hand back the ladder score. It hands back the
 * ladder plus a preference for pictograms flagged aacColor (12) and aac (8),
 * minus penalties for schematic, explicit and whole-phrase artwork, minus half
 * a point per place in ARASAAC's own ordering. Read as a match grade that is
 * one number too many: a word-prefix at 40 on a flagged pictogram arrives as
 * 60 and would pass a ladder threshold, which is the "nichtbinaer" answer
 * again with the other collection's name on it.
 *
 * So the preference comes back off before the score is read as a grade, and at
 * its maximum. A bonus is a reason to show one picture before another; it is
 * not evidence that the word matched. Everything else in that sum only
 * subtracts, so what is left can understate the ladder but never overstate it
 * - the direction that matters, because understating shows a line above
 * results that stay, and overstating is the silence this is here to end.
 *
 * bildquelle's, not ours, and not exported by it. If it moves, this
 * over-warns rather than going quiet, and tests/unit/picker_match.test.ts
 * searches a live provider rather than a made-up score, so it moves too.
 */
const AAC_PREFERENCE = 20;

/** The ladder grade a hit carries, once its source's own ranking is off it. */
const gradeOf = (hit: SymbolHit): number =>
  hit.source === "arasaac" ? hit.score - AAC_PREFERENCE : hit.score;

/** Whether any of these pictures is a picture of the word that was typed.
 *
 * Any, not the first: the sources sort by their own score, and ARASAAC's is
 * not the grade this reads. Both collections, and deliberately not METACOM
 * alone - a search is a search, and ARASAAC misses the same way.
 *
 * The word itself is not compared here. What the grade answers to is the word
 * bildquelle actually looked the collection up with, which after lemmatising
 * "Hunde" or splitting "Handtuch" is not always the word typed - and a
 * collection that holds the lemma does hold the picture. */
const matchesWord = (hits: SymbolHit[]): boolean =>
  hits.some((hit) => gradeOf(hit) >= WHOLE_WORD);

/** Searches the collection this Sammlung is drawn in. Never throws: a failure
 *  is a sentence in `empty`, because every caller has a place to put one and
 *  none of them has anything else to do about it. */
export async function findSymbols(word: string): Promise<SymbolAnswer> {
  const term = word.trim();
  if (!term) return { hits: [], empty: "", near: "", home: null };
  const source = offeredSource();
  // Asked before the collection is searched and answered whatever the search
  // then does, because it is not an answer *from* the collection: it is the one
  // picture in it this product picked. A word the collection cannot answer at
  // all is the search where showing it matters most.
  const home = await homeFor(source, term);
  // Answering from the other collection is what has to not happen: a hit taken
  // from ARASAAC here is a key this Sammlung can no longer export. So there
  // are no hits, and the sentence is the one click that fixes it.
  if (outOfReach(source)) {
    return { hits: [], empty: folderWanted(), near: "", home };
  }
  try {
    const hits = await symbols.searchIn(source, term);
    // Kept whatever they turn out to be. Somebody searching "nicht" may well
    // want nichtbinaer, and the nearest thing the collection holds is the best
    // answer there is to give - it is being taken for something else that was
    // the fault. So the near misses stay and a line above them says what they
    // are.
    if (hits.length) {
      return { hits, empty: "", home,
               near: matchesWord(hits) ? "" : t("ui.search_near", { word: term }) };
    }
    const how = symbols.statusOf(source);
    return { hits, near: "", home, empty: how.kind === "ready"
      ? t("ui.nothing_found", { word: term })
      : t("ui.search_no_answer", { word: term }) };
  } catch (error) {
    return { hits: [], near: "", home,
             empty: t("ui.search_failed", { error: reason(error) }) };
  }
}

/** The prescribed house for this collection, when the word asks for it and the
 *  collection can be reached.
 *
 * Silent about everything that goes wrong. There is no sentence to write: the
 * search itself already says whatever there is to say about an unreachable
 * METACOM folder or a browser with no network, and a second line about a tile
 * nobody asked for would be the picker explaining a feature instead of
 * answering a search. So an unresolvable picture simply is not offered. */
async function homeFor(source: ProviderId, term: string): Promise<HomeSuggestion | null> {
  if (!asksForHome(term)) return null;
  try {
    const url = await homeSymbolUrl(source);
    return url ? { url, caption: homeWord() } : null;
  } catch {
    return null;
  }
}

/** The prescribed house, taken - the same act the tiles beside it perform, in
 *  the one shape both collections already answer to. Throws what the download
 *  throws, exactly as takeSymbol() above does, and for the same reason: a
 *  caller that asked for this one picture has somewhere to say so. */
export const takeHome = (): Promise<{ symbol: string; label: string }> =>
  takeHomeSymbol(offeredSource());

/** A hit, resolved to what a layout stores: a reference and the collection's
 *  own word for it. Throws, because a caller that asked for this one symbol
 *  has somewhere to say so. */
export async function takeSymbol(item: SymbolHit): Promise<{ symbol: string; label: string }> {
  if (item.source === "metacom") {
    // Nothing to fetch and nothing to copy: the layout holds the reference
    // and the picture stays in the licensed folder, which is the whole of
    // the METACOM rule. The browser resolved it, so the server is not asked.
    return { symbol: item.ref, label: (item.label || "").trim() };
  }
  // ARASAAC still goes through the server, and this is the one place the page
  // has not left it. The reference an ARASAAC pick *should* become is its id -
  // that is the decision in docs/symbol-search.md - but build.py resolves a
  // symbol by looking in symbols/, so writing an id today would produce
  // layouts the build cannot build. The download stays until the build itself
  // moves into the browser, and then this branch goes - and with it the last
  // symbol call behind the seam.
  const result = await pickSymbol({
    source: item.source,
    id: item.id,
    label: item.label || "",
  });
  return { symbol: result.symbol, label: (result.label || "").trim() };
}

/** Somebody's own picture, stored and handed back as a reference.
 *
 * A Blob and a name rather than the File the two of them used to arrive in,
 * because what is kept is no longer always what was chosen: a picture that
 * went through the square is a PNG the page has just drawn and has no name of
 * its own. The name still comes from the file either way, so the key in the
 * store is still recognisably somebody's photograph - safeName() in
 * data/store.ts owns what becomes of it from there.
 */
export async function uploadOwn(picture: Blob, name: string): Promise<string> {
  const result = await uploadSymbol(picture, name);
  return result.symbol;
}

// Which sources exist is no longer fixed at start: METACOM arrives when a
// folder is chosen and leaves when it is forgotten, both without a reload. So
// this runs again whenever the provider says something changed.
/* Which of them the picker offers is a setting, and this is what reads it.
 *
 * Nothing did: the only caller of loadSettings() is the settings sheet
 * opening, so until somebody pressed the gear the page ran on the "arasaac"
 * that symbols.ts starts life with. A METACOM chosen last visit was searched
 * as ARASAAC, the field said ARASAAC, and both quietly changed their mind the
 * first time the sheet was opened.
 *
 * Read rather than remembered, and read again whenever the folder's state
 * changes, because the answer is derived from it: readSettings() only hands
 * back "metacom" once the collection actually answers. That is not a
 * technicality on Chromium - a stored folder handle usually comes back
 * needing its permission re-confirmed, so at load there is honestly no
 * collection and METACOM only exists a click later. Reading once at boot
 * would have been right about that moment and wrong from then on. */
async function adoptSource() {
  try {
    const settings = await readSettings();
    symbols.setActiveSource(settings.activeProvider || "arasaac");
  } catch {
    // A search still works, on the source that needs no folder. This runs
    // unawaited from start(), so a throw here would be nobody's to catch.
  }
}

export async function loadSources() {
  // Before the subscription and not through it: a folder that is not there
  // sends no notification, and that case still has a setting to honour.
  await symbols.restoreMetacom();
  await adoptSource();
  symbols.subscribeMetacom(() => void adoptSource());
}

/** Which collection is being searched, as the words a search field wears.
 *
 * Read by the pick column as it is built, which is why nothing has to repaint
 * it: a sheet that is not open has no stale field in it, and a sheet that is
 * opening asks this afresh. Five calls to a showSources() existed to keep the
 * dialog's copy of this honest, and all five went with the dialog. */
export const searchPlaceholder = (): string =>
  t(offeredSource() === "metacom" ? "ui.search_metacom" : "ui.search_arasaac");

/** What is owed for the collection being searched, as one line.
 *
 * Read the same way, with more riding on it: ARASAAC is CC BY-NC-SA and the
 * wording is a condition of the licence, so wherever its pictures are shown
 * this sentence has to be shown too. The place that is now is the pick column
 * of whichever sheet is open - and, standing rather than per-screen, the
 * ARASAAC panel in Einstellungen, which draws the same notice from the same
 * package.
 *
 * The notice itself is not written here and is not in the text table: it comes
 * from the package that owns the provider - a translated paraphrase beside it
 * is how the two drifted apart, and the copy that was here had lost both
 * arasaac.org and the Regierung von Aragón. METACOM returns nothing, on
 * purpose: it is the user's own licensed copy and owes no notice.
 *
 * Ours to say, and only where it applies: that METACOM is referenced rather
 * than copied, or - when it is not the source - that a licence somebody owns
 * could be one. Nobody opens settings to find that out, so it is said where
 * they are standing.
 *
 * Three cases and not two, because "no collection" was covering a state it has
 * no business covering. A folder chosen last visit comes back needing its
 * permission re-confirmed - routine on Chromium, where the grant is scoped to
 * the site rather than to the app - and the line asked somebody who had
 * already set METACOM up whether they happened to own a licence. The remedy is
 * a click, so the sentence names it, and names the answer in the browser's own
 * prompt that stops it being asked again.
 */
export function creditLine(): string {
  // The one source the picker is offering, which is the Sammlung's before it
  // is the machine's. A key already on the board may have come from the other
  // one - a Sammlung mixed before the picker followed it still opens - but
  // what is owed here is owed for what is on this screen.
  const source = offeredSource();
  const owed = symbols.attributionFor([source]).join(" ");
  const status = symbols.metacomStatus();
  const waiting = status.kind === "needs-setup" && status.code === "permission-needed";
  const ours = source === "metacom"
    // Owed nothing, so the whole line is ours: either the note that these
    // pictures are referenced rather than copied, or - the fourth case, and
    // the one the mixed board was built through - that the collection this
    // Sammlung is drawn in is not reachable from this browser yet.
    ? (outOfReach(source) ? folderWanted() : t("ui.credits_metacom"))
    : waiting ? t("ui.metacom_waiting")
    : symbols.metacomReady() ? "" : t("ui.metacom_offer");
  return `${ours} ${owed}`.trim();
}
