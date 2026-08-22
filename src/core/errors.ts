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
