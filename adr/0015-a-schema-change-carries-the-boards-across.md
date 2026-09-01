# ADR 0015 — A schema change migrates the database one step per version, inside the upgrade transaction, or aborts and changes nothing

**Status:** accepted · **Date:** 2026-08-27 · **Applies to:** `src/data/store.ts`,
`src/data/migrations.ts`, `src/data/rescue.ts`, `src/shell/rescue.ts`, and every
future change to `DB_VERSION`

> **Revised the same day it was accepted.** The decision below — never destroy,
> migrate inside the one transaction, abort rather than proceed blind — is
> unchanged. The *mechanism* is not. What landed first dumped every store,
> recognised the **shape** of what came out, and rewrote the whole database
> through the current schema. That was wrong twice: it dispatched on a guess
> when `upgradeneeded` had already handed over `oldVersion`, and it did
> O(the whole database) of work for changes that are O(one store). The section
> **What was tried first** records it, because the argument is worth keeping
> even though the code is not.

## Context

`upgrade()` in `src/data/store.ts` dropped every object store it found and
recreated the schema empty. Collections, layouts, settings, marks, symbols —
all of it, on page load, with nothing said to anybody. `DB_VERSION` went to 4
on 2026-08-27 under [ADR 0011](0011-editor-exports-the-talker-repository-sends.md),
so that the `data` store would actually leave rather than merely stop being
named, and every board in every browser that had been here before went with it.

**This was decided rather than overlooked.** The comment block above
`DB_VERSION` argued it out, and its argument rested on one sentence of
`conventions.md`, under the heading **One rule about the rules**:

> These products have one user, who is the person writing them, and whose own
> data is disposable. So there are no migrations, no deprecation paths, and no
> tolerating an old shape "during a transition".

The same paragraph says when to come back to it:

> That condition will not hold forever, and this paragraph is what to re-read
> when it stops.

It stops when this is advertised. A developer losing their own test boards is a
shrug; a carer opening the editor and finding their child's communication board
gone — silently, because somebody bumped a schema number — is the worst thing
this product can do. [`docs/schema-upgrades.md`](../docs/schema-upgrades.md)
weighs the ways out.

The premise's own escape hatch, the standing Sicherung in
`src/shell/backupFolder.ts`, does not cover this. It is opt-in, Chromium-only,
desktop-only, and hidden entirely where the picker does not exist — so a carer
on a tablet has never been offered one. *"You should have configured a backup"*
is not a sentence that can be said to that person.

## Decision

**`src/data/migrations.ts` holds one step per version, in order. An upgrade runs
the steps between where a database is and where it has to be, inside the
`versionchange` transaction — or it aborts that transaction and leaves the
database exactly as it found it.**

This is the ordinary arrangement and it is deliberately unremarkable: it is what
`idb`'s own README describes, what MDN's guidance describes, and the same shape
as every schema tool with migrations in it. The parts worth writing down are the
three that are particular to here.

**A step does only what changed.** 3 → 4 is `deleteObjectStore("data")` and
nothing else — it does not read a layout, so it cannot lose one. 2 → 3 is the
only step that moves records in bulk, because that is the version that split one
keyed store into a store per kind.

| step | what it does |
|---|---|
| 1 → 2 | the one layout under `layout` becomes `layout:<id>` with a registry beside it |
| 2 → 3 | out of `content` into `collections` / `layouts` / `marks` / `settings` |
| 3 → 4 | `data` leaves; nothing else is touched |

**No step for a version means stop, not skip.** `plan()` refuses a version it
has no step for. `store.ts` aborts the upgrade, the browser keeps its version
and its records, and the page says so and hands over the raw contents as a file
before it will discard anything.

**Steps assert what they expect to find.** Each names the stores it needs. That
is a precondition, not a second dispatch — `oldVersion` still decides which
steps run — and it exists because a step asked to reorganise stores that are not
there would write into something nobody has described.

`createSchema()` — the only place the live schema is written out — is reached in
exactly two situations: a database that has never existed, and a person who has
been shown one this build cannot migrate and has said to discard it. The
destructive path is the exception with a hand on it rather than the default with
an argument in front of it.

## Why

**Atomicity is the whole property, and only one place gives it away for free.**
Inside the `versionchange` transaction every step commits together or none does,
and an abort leaves the database at its *old version with its old contents*. Any
design that steps outside it — read the database out, let a wipe commit, write
it back — has a window in which the old copy is gone and the new one has not
landed. A tab closed in that window is the exact outcome this ADR exists to
prevent.

**The version number is a fact; the shape is a guess.** `upgradeneeded` hands
over `oldVersion`. Sniffing the contents to work out what a database is, when
the database has just told you, is reinventing something you were given — and it
gets the answer wrong precisely where it matters, on a version whose store names
did not change but whose records did.

**Doing less is what makes a migration safe.** The change that cost somebody
every board she had was the removal of one store. Under the arrangement being
replaced, that read six stores into memory, dropped six, created five and wrote
every record back; here it is one statement that touches no layout at all. The
number of ways a migration can lose something is roughly the number of records
it writes.

**Forgetting has to be safe.** The next person to bump `DB_VERSION` will be
holding a diff, not this file. If they add no step, the page refuses to start
and says why — a bug found in the minute after it is made. This is the one
property kept from the arrangement being replaced, and it is why `plan()`
refuses rather than treating a gap as "nothing to do".

**Silence was the worst part of it, and it goes even when nothing is lost.** An
upgrade that reorganised somebody's storage without telling them is
indistinguishable, from where they are standing, from one that lost something.
§3.8 — what the page reports, it reports out loud. The sentence carries the
count of Sammlungen, which is the one number a person can check the claim
against.

## Consequences

- **`DB_VERSION` is no longer free to bump.** It costs a step in
  `migrations.ts` whose `to` is the new number. This is the deprecation cost
  `conventions.md` refuses to pay in general, and it is paid here on purpose.
- **Nothing in a step may `await` a non-request** — no hashing, no base64, no
  folder write, no question put to a person. Concretely: a step may **move** a
  layout and may not **rewrite** one, because the stored `text` and the
  `version` hash over it are a matched pair and re-deriving the hash is a
  `crypto.subtle` call. **A change to what is inside a layout cannot be done as
  a step**, and has to come back to this ADR rather than around it. That is a
  known gap, not an oversight.

  **It came back, on 2026-09-01, and the second half of that is wrong.** The
  rule against awaiting a non-request stands unchanged; what does not follow is
  the conclusion drawn from it. The stamp is never held against freshly
  computed bytes — `writeLayout()` compares it against a value that came out of
  the same record — so a step may rewrite a layout and leave the stamp
  standing, and the next ordinary save re-stamps it. `adr/0023` in
  `Lautstark/vorlaut-editor` reads out every place the stamp is used, and
  `docs/schema-upgrades.md` carries the same correction where it stated the
  gap.
- **The steps are typeless.** They work on shapes that are no longer in the
  schema `store.ts` declares, so the compiler cannot check them — which is the
  same trade every migration system makes, and the reason each step is covered
  by a test that seeds the version it starts from.
- **A downgrade is safe but says the wrong thing.** An older build meeting a
  newer database gets `VersionError` from `openDB`; the database is untouched,
  and the page reports it as an ordinary load failure rather than as "this
  browser has a newer vorlaut". Verified, not assumed. Worth its own fix.
- **This qualifies a rule that is not this repository's.**
  `conventions.md`'s **One rule about the rules** already carves out the `.obz`
  exchange format, *"once a package reaches somebody's tablet it is a file on a
  device nobody here controls"*. A person's IndexedDB, once the product is
  advertised, is the same thing by the same reasoning, and belongs on that list
  as the second entry rather than as a contradiction. **That edit has not been
  made here.** `conventions.md` lives in `Lautstark/design`, is cited by
  paragraph by three products, and a shared-convention change belongs to its own
  session — `mitreden` and `bildhaft` store Sammlungen the same way and have the
  same premise expiring.

## What was tried first

The first version of this decision kept the drop and built preservation around
it: dump every store, run the dump past a table of readers that recognised the
**shape** it was in, drop and recreate as before, write everything back. One
reader per shape rather than one step per version, so two readers covered four
versions.

It worked, it was atomic, and it was still the wrong shape. Two reasons, and the
second is the one that matters:

1. **It dispatched on a guess.** `oldVersion` was sitting in the callback
   signature the whole time. The readers had to *validate* what they read to
   make up for it — a whole mechanism whose only job was to detect that the
   guess had been wrong.
2. **It did the most work on the smallest changes.** Every bump, whatever it
   changed, cost a full read and a full rewrite of the database. The bump that
   caused all this should have been one statement.

What survives from it: the abort-and-say-so path, `rescue.ts`'s raw dump for
the file a person is owed before discarding, and the rule that forgetting must
be safe.

## Not to be "fixed" later

**"The steps could run outside the upgrade, it would be easier to test."** They
could not. Outside that transaction there is no atomicity, and a half-applied
migration is the failure this exists to prevent. Whoever proposes it has to say
what happens to a tab closed halfway.

**"Nobody is on version 1 or 2 any more, delete those steps."** They may not be,
and that is not knowable from here: a browser is on whatever version it was on
when it was last closed, and this product's whole point is that there is no
server to ask. Deleting a step converts those browsers from *migrated* to
*refuses to start*. That is a safe failure, so the steps may go — but the person
deleting them is choosing that outcome for somebody, and should say so in the
commit rather than discover it.

**"`plan()` should skip a version it has no step for — there's nothing to do."**
There is no way to tell "nothing changed" from "somebody forgot" at that point,
and the two want opposite answers. The refusal is the whole of why forgetting is
safe.
