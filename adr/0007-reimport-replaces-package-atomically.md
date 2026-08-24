# ADR 0007 — Re-import replaces a whole package, atomically

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** SPEC.md 1.0.0

## Context

The vocabulary changes constantly. A new word this week, a picture swapped
because the child did not recognise the old one, a page reordered because the
first three buttons are the ones they actually reach for. Each of those means
building a package again in the builder and importing it again on the tablet —
several times a week, for years.

So "what happens on the second import" is not an edge case. It is the main
loop, and it is the operation that can destroy a vocabulary somebody depends
on.

OBF does not help here. It identifies *boards*, and it has no modification time
anywhere. Given two `.obz` files, OBF offers no way to say whether the second is
an update of the first, a different thing that happens to share board ids, or an
older copy someone found in a downloads folder.

Two obvious designs present themselves, and both are worse than they look:

- **Merge at board level.** Update the boards that changed, keep the ones that
  did not. Feels conservative and safe.
- **Merge at button level.** Finer still: update buttons by id, keep the rest.

## Decision

**The unit of storage and of replacement is the package. A re-import replaces
the stored package wholesale and atomically. There is no merge at any level.**

- Identity is `ext_lautstark_package_id` — an opaque, stable string, minted once
  by the builder and never changed on rename, edit or re-export. A duplicated
  package MUST mint a fresh id.
- Recency is `ext_lautstark_modified`, an RFC 3339 UTC timestamp. Both fields
  are required; both exist because OBF cannot express them.
- On importing package *P* with timestamp *T*:

  | Stored state | Behaviour |
  |---|---|
  | no package *P* | install as new — two packages may share a name |
  | *P* stored, timestamp < *T* | **replace it** |
  | *P* stored, timestamp ≥ *T* | MUST NOT silently replace. Skip, or ask. |

- **Replacement is wholesale.** Content the new package does not contain is gone
  afterwards.
- **Replacement is atomic.** A failure partway MUST leave the previously stored
  package intact. There is no state in which the device has half a vocabulary.

## Why

**A deleted button was deleted for a reason.** This is the whole argument
against merging. An adult removed that button — because the word was wrong, the
picture upset the child, or the button was pressed by accident forty times a
day. A merge cannot distinguish "removed on purpose" from "absent from this
export", so it keeps it, and the thing the adult deliberately took away comes
back. Every time. Silently. That is worse than any storage cost a full replace
pays.

**Board-level merge is package-level state that nobody authored.** After a few
merges the tablet holds a combination of boards that never existed as a package
anywhere — not in the builder, not in any file. Nobody has ever seen it, nobody
can reproduce it, and when it is wrong there is nothing to compare it against.
Replacement keeps the invariant that the device holds a copy of a file that
exists.

**It is only affordable because the viewer cannot edit.** There is no on-device
state worth preserving, so throwing it away costs nothing; the package is a
copy and the source of truth is elsewhere. This is the direct consequence of
[ADR 0004](0004-android-app-is-a-viewer.md), and if that decision is ever
reversed this one falls with it.

**A timestamp is the minimum defence against a stale file.** The failure that
actually happens is an adult importing last month's copy out of a downloads
folder. Without a modification time that is indistinguishable from an update,
and it silently destroys a month of work. With one, the viewer can refuse or
ask. The rule is deliberately conservative in both directions: an equal
timestamp is also not an update, because a same-second re-export is far more
likely to be a mistake than an intended change.

**Atomicity is about a child in a room, not about database purity.** Imports
happen on a phone: it runs out of storage, the archive is truncated, the app is
killed mid-write. If any of those can leave a partially written vocabulary,
then a routine Tuesday-afternoon update can end with a non-speaking child and
an adult with no idea what happened. Commit at the end or not at all.

**Ids must be opaque.** The importer never parses, compares or derives meaning
from a package id; it only tests equality. That is what keeps the builder free
to change how ids are minted without every viewer in the field having an
opinion about it.

## Consequences

- The importer stages the whole package — validation, extraction, media, board
  parsing — and commits once at the end, with the warning list persisted
  alongside it. SPEC.md §11 gives the order.
- Peak storage during an import is roughly two copies of a package. Given the
  size caps in §5.3 and §6 this is affordable on a phone, and it is the price of
  atomicity.
- **The builder's `package_id` handling is the sharp edge**, and it is
  load-bearing: an id copied along with a duplicated package will silently
  overwrite the original. SPEC.md §8 states the rule in bold for that reason.
  The viewer cannot detect this — two packages with the same id are, by
  definition, the same package.
- A clock that is wrong on the builder's machine produces a package that cannot
  be imported over its predecessor until the timestamp catches up. Skipping with
  an explanation is the correct behaviour; silently accepting it is not.
- Fixtures `identity-a`, `identity-b` and `identity-a-v2` cover all three rows
  of the table, and are the oracle for an implementation.

## Not to be "fixed" later

Merging will be proposed as data-loss prevention, which is the exact inversion
of what it is. It sounds careful — *why throw away boards the new package did
not mention?* — and the answer is that the new package not mentioning them **is
the instruction to remove them**. There is no channel in the format for
"deliberately absent" because absence already means that, and a merge is a
reader deciding it knows better than the person who built the board.

If partial updates are ever genuinely needed, they need an explicit deletion
channel in the format — a tombstone list, or a patch package with its own type —
designed as such and specified. Not a reader quietly preferring what it already
has.
