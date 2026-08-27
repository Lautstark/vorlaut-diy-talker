# What a schema change does to somebody's boards

`DB_VERSION` in [`src/data/store.ts`](../src/data/store.ts) went to 4 on
2026-08-27, and every board in every browser that had been here before went
with it. Nothing warned, nothing asked, nothing was written out first. It
happened on page load, before anybody had touched anything.

This document weighs what to do instead. The decision it reaches is
[ADR 0015](../adr/0015-a-schema-change-carries-the-boards-across.md); what is
here is the working, kept because the options that were *not* taken are the
ones somebody will propose again.

## What happens today, and why it is not a bug

`upgrade()` opens with one statement:

```js
for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
```

Every store — collections, layouts, settings, marks, symbols — dropped and
recreated empty. The comment block above `DB_VERSION` argues for it at length
and the argument is sound. It rests on one sentence in `conventions.md`, under
**One rule about the rules**:

> These products have one user, who is the person writing them, and whose own
> data is disposable. So there are no migrations, no deprecation paths, and no
> tolerating an old shape "during a transition".

That is a real rule and it earned its place. A developer who loses their own
test boards to a schema change has lost an evening; a migration written for
that person is code nobody reads twice, kept forever, tested by nothing.

The same paragraph then says what to do when it stops being true:

> That condition will not hold forever, and this paragraph is what to re-read
> when it stops.

It stops the moment this is advertised. **The premise has expired, not been
found wrong**, and the fix has to be recorded that way — otherwise the next
person to bump `DB_VERSION` reads the comment block, finds it convincing, and
reinstates the wipe.

## What is actually being protected

Not "data". A carer opens the editor and their child's communication board is
there. That board is between a few evenings and a few years of work, it is
often the only copy, and its loss is not recoverable by anybody — the pictures
were chosen one at a time against a child nobody else knows.

So the bar is not "we tried". It is: **a person who has done nothing but open
the page must not be worse off after it than before.**

The standing Sicherung is not that bar. `src/shell/backupFolder.ts` is
opt-in, Chromium-only, desktop-only, and hidden entirely where the picker does
not exist. A carer on an iPad has never been offered one. *"You should have
configured a backup"* is not a sentence anybody gets to say to that person.

## The property everything else is measured against

**Atomicity.** Whatever runs must either finish, or leave the database exactly
as it found it. There is no third acceptable outcome, because the third outcome
— half-done, old copy gone, new copy incomplete — is indistinguishable from the
wipe this document exists to remove, and it arrives at the worst possible
moment: a tab closed, a browser killed, a quota refused mid-write.

IndexedDB gives that property away for free, and only in one place: inside the
`versionchange` transaction that `upgradeneeded` hands over. Everything in
there commits together or not at all, and an abort leaves the database at its
**old version with its old contents**. Any design that steps outside that
transaction has to reconstruct the guarantee by hand, and none of them can.

## The options

### 1. Migrate inside the `versionchange` transaction — the platform's own way

Read the old stores through the upgrade transaction, drop and recreate the
schema, write the data back — all before that transaction commits.

**Carer's experience:** they open the page and their boards are there. A line
says the database changed and how many Sammlungen came across.

**Cost:** everything on that path must be an IndexedDB request. The transaction
stays open only while requests are outstanding on it, so a single `await` on
anything else — a `crypto.subtle` digest, a `btoa`, a folder write, a question
put to a person — commits it underneath code that believes it is still inside
one. That is the trap the head of `store.ts` already documents, and here it is
load-bearing rather than merely known.

It turns out nothing on this path needs to leave: a stored layout carries its
own `text` and `version`, so nothing has to be re-hashed; pictures move as
`ArrayBuffer`s, so nothing has to be base64-ed; `updatedAt` is a number.

**Chosen.**

### 1a. Chained steps, or one reader per shape?

Within option 1 there is a second choice, and it is the one that decides how
much a bump costs in two years.

**Chained** is the classic: `if (old < 2) {…} if (old < 3) {…}`, each step
turning the previous shape into the next. Its cost compounds — step 2 has to
keep working forever, it is written against a shape that no longer exists
anywhere in the code, so nothing type-checks it, and it only ever runs for a
browser that is exactly that far behind.

**One reader per shape** reads whatever it finds into one in-memory value and
writes that through the *current* schema. The write side is always the live
one, so the compiler checks it; the read side is a pure function over dumped
records, testable from a seeded database with no chain to replay.

It is also cheaper by count. Readers are per *shape*, not per version: versions
1 and 2 share the `content` store, versions 3 and 4 share the store-per-kind
schema, so **two readers cover four versions.** `DB_VERSION = 4` — which
removed a store and changed nothing about what the others hold — needed no new
reader at all.

**One reader per shape.**

### 2. Export before the upgrade, import after it

Read the old database out into `data/backup.ts`'s shape, let the wipe happen
exactly as today, write the backup back in afterwards.

**Carer's experience:** identical to option 1 — until it is not. The drop
commits in one transaction and the write-back happens in another, so there is a
window in which the old data is gone and the new data has not landed. Close the
tab there and the boards are gone, which is the outcome the whole exercise is
about.

**Rejected on atomicity.** It was the shape this document first proposed, and
it was wrong: it rebuilds by hand, worse, a guarantee the platform hands over
for nothing. Its one attraction — that the intermediate is the documented
`Backup` format, shared with the restore path — does not survive the trade,
and it does not even hold up on its own terms, because reaching that format
needs `crypto.subtle` and `btoa`, which is exactly what forces it outside the
transaction in the first place.

### 3. Make the standing backup non-optional

Force the folder picker at first run; refuse to work until there is one.

**Carer's experience:** a browser permission prompt before they have seen a
board, and on Safari or on a tablet, a prompt that cannot be satisfied at all,
because `showDirectoryPicker` is not there. The product would be unusable on
the device most likely to be a talker.

**Rejected.** It also solves nothing here: a standing backup is a copy of the
*old* state, so restoring from it after a wipe is still a person doing homework
to get back to where they already were.

### 4. Refuse to upgrade, explain, offer an export

The page does nothing destructive. It says what is about to happen and hands
over a file first.

**Carer's experience:** the editor will not start. A dialog explains why. They
click *download*, then *continue*, and land on an empty editor holding a file
they cannot read without knowing what a Sicherung is.

**Rejected as the normal path** — it turns a schema change into homework whose
reward is still an empty editor. **Kept as the fallback**, where it is exactly
right: if the old shape cannot be read, the honest thing is to touch nothing
and say so. Under option 1 this fallback costs almost nothing to build, because
aborting the upgrade transaction *is* "touch nothing", and the old database is
still sitting there to be read out for the file.

### 5. Rescue store — dump the old records into a store the upgrade never drops

Inside the `versionchange` transaction, copy every record verbatim into a
`rescue` store, then drop the rest as today.

**Carer's experience:** the page starts, the boards are gone, and a notice
says the old data is available as a file.

**Rejected.** It preserves bytes rather than boards, and it needs the drop loop
to grow a permanent exception that the next person must not delete. It is
option 1 with the last step left out — if the records are already in hand
inside that transaction, writing them into the new schema is the same work as
writing them into a rescue store, and it ends with a working editor.

## What is chosen

**1, with 1a's reader table, and 4 as the fallback.**

1. `upgrade()` reads every store it finds — keys and values — through the
   upgrade transaction, before it deletes anything.
2. A reader chosen by the shape of what was found turns that into one
   in-memory value: every Sammlung with its name, its stored bytes, its
   version stamp and its `updatedAt`, which one was open, the whole settings
   record, and the pictures in `symbols/`.
3. The schema is dropped and recreated exactly as it is today. Half-old is
   still the state this repository will not have.
4. What was read is written back through the new schema — in the same
   transaction, so steps 1 to 4 are one atomic act.
5. The page says how many Sammlungen came across, because an upgrade that
   moved somebody's data silently is indistinguishable from outside from one
   that lost it.
6. **If no reader recognises what was found, the transaction is aborted.** The
   database stays at its old version with everything in it. The page says so,
   offers the raw contents as a file, and will not go any further until
   somebody has taken that file and then explicitly said to discard.

Point 6 is the one that matters in two years. The failure mode of forgetting is
a page that will not start — noticed in the minute after the mistake is made —
rather than a wipe, which nobody notices until a carer writes in.

## What this costs

- **`DB_VERSION` is no longer free to bump.** It costs a look at
  `src/data/rescue.ts`: does a reader still recognise the shape you are
  leaving? If not, write one in the same change.
- **Peak memory is the whole database as objects**, briefly, inside a
  transaction — every board and every picture. That is the same peak
  `exportEverything()` already reaches whenever the standing backup fires.
- **Nothing on the upgrade path may `await` a non-request.** No hashing, no
  base64, no folder write, no question put to a person. This is a real
  constraint on what a future migration may do, and it is written into
  `rescue.ts` where the next person will be standing.
- **`built` does not come across.** It is a derived mark and ADR 0011 removed
  what wrote it.
- **A layout's `version` travels verbatim** rather than being recomputed,
  because it is the hash of bytes that did not change. A future reader that
  *reshapes* a layout would break that pairing and cannot re-hash where it
  stands; it would have to leave the stamp for the page to settle on the first
  save.

## The rule this qualifies

`conventions.md`'s **One rule about the rules** already names one exception —
the `.obz` exchange format, because once a package is on somebody's tablet it
is a file on a device nobody here controls. The reasoning transfers exactly:

> a person's IndexedDB, once the product has been advertised, is on a device
> nobody here controls.

So this is the second entry on that list rather than a contradiction of the
rule. The rest of the paragraph stands: no deprecation paths, no tolerating an
old shape during a transition, and everything else internal is still fair game.

`mitreden` and `bildhaft` store Sammlungen the same way and have the same
premise expiring. Nothing here changes their code; what it changes is that the
paragraph they all cite now needs a second exception written into it, in the
`Lautstark/design` repository, in its own session.
