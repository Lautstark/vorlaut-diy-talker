# ADR 0004 — The Android app is a viewer, and does not edit

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** the Lautstark
Android app, SPEC.md 1.0.0

## Context

The Android app is new — a Kotlin repository, the first non-TypeScript one in
the organisation. Its job is to be the thing the child actually holds: it opens
a package, shows the boards, and speaks when a button is pressed.

Every AAC app on the market also edits. Adding a button, renaming one, swapping
a picture, moving a tile — on the device, in the moment, which is exactly when
the need shows up. The expectation that a talker can be edited where it is used
is so uniform that its absence reads as an unfinished app rather than a
decision.

Against that: the board builder already exists, runs in a browser on a real
keyboard and a real screen, and has the symbol search, the voice picker and the
audition loop in it.

## Decision

**The Android app imports and renders. It does not edit, and it does not
export.**

- No board editor, no button editor, no drag-to-rearrange.
- No symbol search. The app ships no symbol library and makes no network
  requests.
- No text-to-speech synthesis in the app. It plays the audio in the package.
- No `.obz` writing, of any kind. The app has no export path.
- Content changes by building a new package in the builder and importing it —
  which replaces the old one wholesale, atomically, at package level. See
  [ADR 0007](0007-reimport-replaces-package-atomically.md).

## Why

**A viewer that cannot write cannot corrupt.** This is the load-bearing reason.
The state on the device is a copy; the source of truth is the package, which
lives wherever the adult keeps it. Nothing on the tablet can be lost that was
not already reproducible in ten seconds. That makes the import path a replace
rather than a merge, makes the storage layer trivial, and removes an entire
class of bug in which a child's vocabulary quietly degrades because something
half-saved.

**Editing on a device a child is holding is a hazard, not a feature.** The tablet
is in the hands of someone who presses everything, deliberately, all day. Every
editing affordance is also an accidental-destruction affordance, and the answer
the industry gives — hide it behind a long-press, a PIN, a "caregiver mode" — is
a lock guarding a door that does not need to exist here.

**Editing would drag the whole builder onto the phone.** A useful editor needs
symbol search, which needs a network and a symbol library; and voice, which
needs a synthesis runtime and a voice catalogue and a licence filter. All of
that exists, once, in the browser. Building it a second time in Kotlin means two
implementations of the licence rules — and licence rules that exist twice get
broken once, which is the same reasoning that produced `@lautstark/bildquelle`
in the first place.

**It keeps [ADR 0002](0002-no-server-no-accounts.md) cheap.** An app that only
reads needs no network permission at all. That is a claim that can be made to a
parent in one sentence and verified from the manifest.

**One direction means one format, not two.** Because the viewer never writes,
the exchange format needs no round-trip property: an importer may discard
everything it does not understand, and SPEC.md says so. A format that had to
survive edit-and-re-export would need preservation rules for every unknown
field, and every one of those rules is a place for two implementations to
disagree.

## Consequences

- **The tablet is not sufficient.** Changing one word means going to a computer,
  editing, exporting, and moving a file. That is a genuine cost, paid several
  times a week by whoever maintains the vocabulary, and it is the price of
  everything above.
- Round-trip fidelity is not a requirement anywhere, and importers need not
  preserve what they ignore.
- Non-redistributable packages are structurally safe: with no export path there
  is nothing to disable. SPEC.md §5.2's rule that such a package must never be
  offered for export exists so that *adding* a path later is a decision rather
  than an accident.
- Storage is "packages, keyed by `ext_lautstark_package_id`", not a document
  database.
- **Spelling and free text are out of scope in v1** (OBF `+text` actions,
  SPEC.md §7.4) — not because they conflict with this decision, but because they
  are the one feature that would need composition state the viewer does not
  otherwise have.

## Not to be "fixed" later

The request will arrive as "just let me fix a typo without going to the laptop",
and it is a completely fair request. It is also the thin end: a typo fix needs a
text editor and a save path, the save path needs conflict handling against the
next import, and conflict handling needs a merge — at which point the tablet
holds state that exists nowhere else, and [ADR
0007](0007-reimport-replaces-package-atomically.md) is dead.

If on-device editing is ever built, it has to be designed as *that* — a second
source of truth, with an answer to what re-import does to it — and this ADR
superseded in the open, not worked around one field at a time.
