// The blanks in a label, filled in - including the ones whose word depends on
// a number.
//
// ## Why this is a module of its own
//
// It was four lines inside t(), and it has two readers now. The second is
// e2e/loader.spec.ts, which asserts a count against the sentence somebody
// reads rather than against a fragment of one, and so has to do exactly what
// t() does. It cannot import boot.ts to get it: that module reads
// navigator.languages and localStorage while it is being loaded, and a
// Playwright runner's own process is node with no browser under it. So the
// substitution lives here, where it touches nothing, and both sides call it.
//
// ## Why there is a plural form at all
//
// The table said "{sets} Seite(n)" and "{files} file(s)" in six places, and it
// was the one line on the page that sounded like a program rather than like
// somebody explaining a device. It is a carer's page; "2 Seite(n)" is the kind
// of thing that makes a person doubt they are in the right place.
//
// `{sets|Seite|Seiten}` is the whole grammar: the count, then the word for one
// and the word for the rest. Which side is chosen is Intl.PluralRules' answer
// and not `n === 1`, because those are not the same question even in the two
// languages this page has - and a table that already says which word goes with
// which count is the right place for a third form to arrive, rather than here.

/** One per language, because constructing one is not free and this runs once
 *  per blank on a page that redraws every step whole. */
const RULES = new Map<string, Intl.PluralRules>();

function rules(lang: string): Intl.PluralRules {
  let one = RULES.get(lang);
  if (!one) {
    // A tag the runtime does not know throws rather than falling back, and a
    // label is not worth a blank page: English splits one from other the same
    // way German does, which is the whole of what is asked here.
    try {
      one = new Intl.PluralRules(lang);
    } catch {
      one = new Intl.PluralRules("en");
    }
    RULES.set(lang, one);
  }
  return one;
}

/* A blank: a name, and optionally the two words that go with it. The name is
 * lower case with underscores because every key in the table is. */
const BLANK = /\{([a-z_]+)(?:\|([^{}|]*)\|([^{}|]*))?\}/g;

/**
 * `text` with its blanks replaced from `params`.
 *
 * A blank whose name is not in `params` is left standing, which is deliberate
 * and is how a missing value shows up as `{size}` on the screen rather than as
 * a sentence with a hole in it that reads like a finished sentence.
 *
 * One pass, so a value that happens to contain braces is text and not another
 * blank. The loop this replaced substituted name by name and would have gone
 * looking inside what it had just written.
 */
export function fill(
  text: string,
  params: Record<string, string | number> = {},
  lang = "en",
): string {
  return text.replace(BLANK, (whole, name: string, one?: string, other?: string) => {
    if (!Object.hasOwn(params, name)) return whole;
    const value = params[name]!;
    if (one === undefined || other === undefined) return String(value);
    return rules(lang).select(Number(value)) === "one" ? one : other;
  });
}
