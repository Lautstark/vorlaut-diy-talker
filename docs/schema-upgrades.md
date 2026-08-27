# What a schema change does to somebody's boards

`DB_VERSION` in [`src/data/store.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/store.ts) went to 4 on
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

**Chosen**, in the steps-per-version form. See §1a.

### 1a. Steps per version, or readers per shape?

Within option 1 there is a second choice, and getting it wrong is the mistake
this document has already made once.

**Steps per version** is the ordinary arrangement: an ordered list keyed on the
version each one produces, run from wherever a database happens to be. It is
what `idb`'s README describes, what MDN describes, and the same shape as Rails,
Django, Flyway and Alembic. Its cost is that the list only grows, that each step
is written against a shape no longer in the code so nothing type-checks it, and
that a given step only ever runs for a browser exactly that far behind.

**Readers per shape** was tried first: dump every store, recognise the shape of
what came out, write the whole thing back through the current schema. It looked
cheaper by count — versions 1 and 2 share the `content` store, 3 and 4 share the
store-per-kind schema, so two readers covered four versions.

**Steps per version, and the reasons are not aesthetic.**

`upgradeneeded` hands over `oldVersion`. Sniffing the contents to work out what
a database is, when it has just been stated, is reinventing a fact you were
given — and the readers needed a whole validation mechanism whose only job was
to notice the guess had been wrong.

The heavier reason is how much work each does. `DB_VERSION = 4` removed one
store. As a step that is:

```js
db.deleteObjectStore("data")
```

one statement, reading no layout, incapable of losing a board. As a reader pass
it was: dump six stores into memory, drop six, create five, write every record
back — the largest possible operation for the smallest possible change. The
number of ways a migration can lose something is roughly the number of records
it writes, and this is the change that had just cost somebody everything.

The type-checking argument for readers turns out to be worth less than it looks,
too. Mature migration systems face the same problem and answer it the same way:
Rails tells you not to use your live models in a migration, precisely because
they drift. Historical knowledge belongs in code written against raw records,
which is what a step is.

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

**1, in 1a's steps-per-version form, with 4 as the fallback.**

1. `src/data/migrations.ts` holds one step per version, in order. `plan()`
   returns the ones between where this database is and `DB_VERSION`.
2. Each step asserts the stores it expects to find, then does only what that
   version changed — through the upgrade transaction, with no `await` in it on
   anything that is not a request on that transaction.
3. All of them commit together or none does.
4. The page says what happened and counts the Sammlungen, which is the one
   number a person can check the claim against.
5. **If there is no step for a version, or a database is not the shape its
   version claims, the transaction is aborted.** The database stays at its old
   version with everything in it. The page says so, offers the raw contents as
   a file, and will not go further until somebody has taken that file and then
   explicitly said to discard.

Nothing is dropped anywhere except in `createSchema()`, which is reached for a
database that has never existed and for a person who has chosen the discard in
point 5. Every other path only ever adds, moves, or removes what a specific
version removed.

Point 5 is the one that matters in two years. The failure mode of forgetting is
a page that will not start — noticed in the minute after the mistake is made —
rather than a wipe, which nobody notices until a carer writes in.

## What this costs

- **`DB_VERSION` is no longer free to bump.** It costs a step in
  `src/data/migrations.ts` whose `to` is the new number.
- **Nothing in a step may `await` a non-request.** No hashing, no base64, no
  folder write, no question put to a person. It is written into
  `migrations.ts` where the next person will be standing.
- **A step may move a layout and may not rewrite one.** The stored `text` and
  the `version` hash over it are a matched pair, and re-deriving the hash is a
  `crypto.subtle` call, which is exactly what the rule above forbids. **So a
  change to what is inside a layout cannot be done as a step at all.** That is
  an open gap rather than a solved problem, and it is more likely to come up
  than a store change is.
- **A downgrade is safe and says the wrong thing.** An older build meeting a
  newer database gets `VersionError`; the database is untouched, and the page
  reports it as an ordinary load failure rather than "this browser has a newer
  vorlaut". Verified rather than assumed.
- **The steps are typeless**, because they work on shapes no longer in the
  schema. The compiler cannot check them, which is why each is covered by a
  test that seeds the version it starts from.

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
