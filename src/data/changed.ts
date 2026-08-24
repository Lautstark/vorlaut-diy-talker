/** One notifier, next to the writes.
 *
 * Every write that changes what a Sicherung would contain says so through
 * touched(), and the standing backup listens through onChanged(). That is
 * conventions.md §2.2, and the rule is about *where* the call goes rather than
 * about what it does: the alternative was calling schedule() from each place in
 * the interface that edits something, and it fails silently and identically in
 * all three products - somebody adds the thirteenth mutator next year, having
 * never heard of the backup, nothing goes red, and a child's talker quietly
 * stops being saved. Putting the notifier at the writes makes the rule local to
 * the thing it is about: a new mutator is in the same file as the line that
 * says what a mutator does.
 *
 * Its own file rather than a paragraph inside data/store.ts, because that is
 * what it is: ten lines that all three products want and none of them can
 * usefully vary. conventions.md §5 #3 says it rides along with the storage work
 * and does not earn a package of its own; a file is what makes the day it does
 * earn one a move rather than an excavation.
 *
 * The other half of §5 #3 - `slug`/`safeName` - is not here. mitreden's and
 * bildhaft's are download-filename sanitisers; vorlaut's one true equivalent
 * lives beside the store keys it makes, which is data/store.ts. See safeName()
 * there.
 */

const watchers = new Set<() => void>();

/** Listen. The returned function stops listening. */
export function onChanged(listener: () => void): () => void {
  watchers.add(listener);
  return () => watchers.delete(listener);
}

/** Something a Sicherung carries has changed. Called by writes, never by the
 *  page: a call site in the interface is the failure this file exists against. */
export function touched(): void {
  for (const listener of watchers) listener();
}
