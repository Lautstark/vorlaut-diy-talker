# ADR 0015 — A schema change carries somebody's boards across inside the upgrade transaction, or it aborts and changes nothing

**Status:** accepted · **Date:** 2026-08-27 · **Applies to:** `src/data/store.ts`,
`src/data/rescue.ts`, `src/shell/rescue.ts`, and every future change to
`DB_VERSION`

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
weighs the five ways out.

The premise's own escape hatch, the standing Sicherung in
`src/shell/backupFolder.ts`, does not cover this. It is opt-in, Chromium-only,
desktop-only, and hidden entirely where the picker does not exist — so a carer
on a tablet has never been offered one. *"You should have configured a backup"*
is not a sentence that can be said to that person.

## Decision

**An upgrade carries the whole database across inside the `versionchange`
transaction, or it aborts that transaction and leaves the database exactly as
it found it.**

`upgrade(db, oldVersion, newVersion, tx)`, in order, with no `await` in it that
is not a request on `tx`:

1. **Read everything first.** Every store the database has, keys and values,
   through `tx` — before anything is deleted.
2. **Recognise the shape.** `src/data/rescue.ts` holds one reader per shape
   this database has ever had. A reader turns the dump into one in-memory
   `Salvage`: every Sammlung with its name, its stored bytes, its version stamp
   and its `updatedAt`, which one was open, the whole settings record, and the
   pictures in `symbols/`.
3. **Drop and recreate**, exactly as before. Half-old is still the state this
   repository will not have.
4. **Write the salvage back** through the new schema.
5. **Say so.** `onCarried` fires with the count, and the page reports it.
6. **Or abort.** If no reader recognises what was found, `tx.abort()`. The
   database keeps its old version and every record in it; `open()` rejects with
   `UNREADABLE`; and the page refuses to go further until somebody has
   downloaded the raw contents and then explicitly said to discard them.

Steps 1 to 4 commit together or not at all. That is the whole reason they are
in there.

**One reader per shape, not one step per version.** There are two, and they
cover four versions:

| shape | versions | what it is |
|---|---|---|
| `content` | 1, 2 | one `content` store: `layout` or `layout:<id>`, `collections`, `settings`, `built` |
| `stores` | 3, 4 | `collections` / `layouts` / `settings` / `marks` / `symbols` |

A reader also **validates** what it reads. Matching on store names alone would
let a future version that keeps the names and changes the records carry garbage
across; a record that does not check out is an unrecognised shape, which is
step 6.

## Why

**Atomicity is the whole property, and only one place gives it away for free.**
Inside the `versionchange` transaction everything commits together or not at
all, and an abort leaves the database at its *old version with its old
contents*. Every design that steps outside it — read the database out, let the
wipe commit, write it back — has a window in which the old copy is gone and the
new one has not landed. A tab closed in that window is the exact outcome this
ADR exists to prevent, arriving at the worst moment. `docs/schema-upgrades.md`
records that this was first proposed the outside-the-transaction way and why
that was wrong.

**Nothing on this path needs to leave the transaction, and that is a fact about
the data rather than luck.** A stored layout carries its own `text` and
`version`, so nothing is re-hashed; pictures move as `ArrayBuffer`s, so nothing
is base64-ed; `updatedAt` is a number. The trap the head of `store.ts`
documents — that awaiting anything which is not a request on the transaction
commits it underneath you — is load-bearing here rather than merely known, and
`rescue.ts` says so where the next person will be standing.

**The write side is always the live schema.** Chained steps (`if (old < 2) …
if (old < 3) …`) are written against shapes that no longer exist in the code,
so nothing type-checks them and only a browser exactly that far behind ever
runs them. A reader per shape puts all the historical knowledge in pure
functions over dumped records — testable from a seeded database, with no chain
to replay — and leaves the writing to the one schema the compiler can see.

**Forgetting has to be safe.** The next person to bump `DB_VERSION` will be
holding a diff, not this file. If they change what a store holds and add no
reader, the page refuses to start and says why — a bug found in the minute
after it is made. The alternative, and the state of things before this ADR, is
a wipe that nobody sees until somebody writes in.

**Silence was the worst part of it, and it goes even when nothing is lost.** An
upgrade that moved somebody's data without telling them is indistinguishable
from the outside from one that lost it. §3.8 — what the page reports, it
reports out loud.

**A modal that blocks the page is right exactly once**: when the alternative is
destroying something. That is step 6 and nowhere else.

## Consequences

- **`DB_VERSION` is no longer free to bump.** It costs a look at `rescue.ts`:
  does a reader still recognise the shape you are leaving? If not, write one in
  the same change. This is the deprecation cost `conventions.md` refuses to pay
  in general, and it is paid here on purpose.
- **Nothing on the upgrade path may `await` a non-request** — no hashing, no
  base64, no folder write, no question put to a person. A future migration that
  needs one of those cannot be written this way and has to come back to this
  ADR rather than around it.
- **Peak memory is the whole database as objects**, briefly, inside a
  transaction. The same peak `exportEverything()` already reaches whenever the
  standing backup fires.
- **`built` does not come across.** It is a derived mark and ADR 0011 removed
  what wrote it.
- **A layout's `version` travels verbatim**, because it is the hash of bytes
  that did not change. A future reader that *reshapes* a layout breaks that
  pairing and cannot re-hash where it stands.
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

## Not to be "fixed" later

The cleanup this will attract is **"the salvage would be simpler outside the
upgrade — read the database, let it wipe, write it back."** It would be
simpler, and it is what this ADR rejected: two transactions with a window
between them where a person's boards exist in neither. Whoever proposes it has
to say what happens to a tab closed in that window.

The second is **"nobody is on version 1 or 2 any more, delete the `content`
reader."** They may not be, and that is not knowable from here: a browser is on
whatever version it was on when it was last closed, and this product's whole
point is that there is no server to ask. Deleting a reader converts those
browsers from *carried across* to *refuses to start*. That is a safe failure,
so the reader may go — but the person deleting it is choosing that outcome for
somebody, and should say so in the commit rather than discover it.

The third is **"the readers duplicate `data/backup.ts` — make the salvage a
`Backup`."** It cannot be one. Reaching that format needs `crypto.subtle` and
`btoa`, and both of those commit the upgrade transaction underneath the code
using them. The overlap is real and it is the price of the guarantee.
