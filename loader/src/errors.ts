/** What went wrong, as a sentence somebody can be shown.
 *
 * A caught value is `unknown` and usually but not always an Error - a rejected
 * fetch, a DOMException, or anything a library chose to throw. Reading .message
 * off it directly was fine until it was not, and the failure mode is
 * "undefined" appearing in the interface where an explanation belonged.
 *
 * In core/ rather than ui/dom.ts, where it started: the format modules under
 * data/ need it too, and a converter reaching into the module that owns the
 * document is the wrong direction for a dependency to run.
 */
export const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A failure the page has a sentence prepared for.
 *
 * Everything that reaches the outside can fail in a handful of ways that are
 * worth different words - a device that did not answer, a build that moved
 * while it was being read, a folder holding yesterday's content. Those are not
 * messages to show raw: they are cases, and the sentence for each of them
 * belongs in boot_data.ts with the rest of the language.
 *
 * So this carries a `word` rather than prose, and the two callers that show it
 * do the same thing with it - `t("err." + word, facts)`. The word says which
 * area it came from as well as what happened (`cable_no_device`,
 * `build_moved`), because one vocabulary shared by the cable and the folder
 * export is easier to keep whole than two that overlap by half.
 *
 * `facts` is for the numbers a sentence needs - how much would not fit, how
 * much room there was. Empty for most of them.
 */
export class Trouble extends Error {
  word: string;
  facts: Record<string, number>;
  constructor(word: string, facts: Record<string, number> = {}) {
    super(word);
    this.name = "Trouble";
    this.word = word;
    this.facts = facts;
  }
}
