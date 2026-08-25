# ADR 0001 — `ext_lautstark_*` and `ext_vorlaut_*` stay separate

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** SPEC.md 1.0.0

## Context

Two OBF extension namespaces now exist in the Lautstark projects.

`ext_vorlaut_*` came first. The board builder's `.obz` export writes two fields
today — `ext_vorlaut_sleep_timeout_seconds` and `ext_vorlaut_voice` — for the
DIY ESP32 talker. One of them is meaningless off that device:
`sleep_timeout_seconds` is a power setting for a battery-powered box with
physical keys.

It wrote four when this was decided. `ext_vorlaut_active` marked which of the
talker's sets went onto the device — the clearest example there was of a field
meaningless off that device — and went on 2026-08-25 with the active/inactive
distinction behind it. `ext_vorlaut_color` went on 2026-08-26 with the per-set
colour. Neither removal is an argument against this decision; they are the
first two pieces of evidence for it, and what they cost is recorded at the
end.

That export is pinned by a frozen reference file. The Python implementation it
was checked against has been deleted, so the frozen file is the only remaining
statement of what that mapping is; it cannot be regenerated, because there is no
longer an oracle to regenerate it from.

`ext_lautstark_*` is new, defined by SPEC.md, and carries what an Android viewer
needs: package identity, a modification timestamp, symbol source, redistribution,
speak-immediately.

The obvious tidy move is one namespace across both repositories.

## Decision

**The two namespaces stay separate, and app importers treat `ext_vorlaut_*` as
they treat any other vendor's extension: ignored.**

Specifically:

- SPEC.md defines `ext_lautstark_*` only.
- The builder's talker export keeps writing `ext_vorlaut_*`, unchanged. The
  frozen reference is not regenerated.
- App importers ignore `ext_vorlaut_*` silently, with no warning and no special
  case — including `ext_vorlaut_color`, which looks like a colour the viewer
  could use and must not be read as one.

## Why

**The two describe different things.** They are not the same vocabulary under
two names. `sleep_timeout_seconds` is about a device with four keys and a
battery; nothing in `ext_lautstark_*` is about anything of the sort. Unifying
them would produce one namespace holding fields meaningless to most of its
readers, which is worse than two honest ones.

This claim was stronger when it was made: half of `ext_vorlaut_*` read that way,
and one field of three does now that `active` has gone. It is left standing
rather than restated, because the two arguments below do not depend on the
proportion and this one never carried the decision on its own.

**The frozen reference cannot be regenerated.** Renaming the talker's fields
means rewriting the one surviving record of a mapping whose oracle is gone. The
rename would be checked only against itself — the exact failure the reference
was created to prevent.

**The talker is out of scope.** SPEC.md governs builder-to-app packages. A
specification that reached into the talker's export to rename its fields would
be changing something it does not describe, for tidiness.

**The cost is small and one-directional.** `ext_vorlaut_voice` overlaps with
app concerns, so a builder writing both a talker export and an app package
writes two fields where one might do. `ext_vorlaut_color` was the other one and
is gone, which makes the standing cost smaller still. That is one duplicated
value in a builder, against a rewritten frozen reference and a muddled
namespace.

## Consequences

- A talker `.obz` opened by the app viewer imports as a board with no colour
  and no voice hint. It is not an app package and is not expected to be one;
  nothing crashes and nothing warns.
- Fixture `unknown-ext` asserts this. It carries `ext_vorlaut_color` twice, on a
  button and on a board, and an importer that reads either fails. On the board
  it sits beside `ext_lautstark_board_color` holding a *different* colour, so
  reading the wrong namespace fails rather than agreeing by coincidence. The
  fixture stands although this builder no longer writes that field: it is about
  what a reader must do with a namespace it does not own, and some other tool's
  document may still carry one.
- A future builder that wants one export serving both must write both
  namespaces into one file. This is permitted: they do not collide.

## Not to be "fixed" later

This ADR exists because the duplication looks like an oversight and will invite
a cleanup. It is not an oversight. Anyone proposing to unify the namespaces
should first establish that the frozen reference can be regenerated against
something other than itself — and it cannot, which is the point.

**What removing one field actually cost, 2026-08-25.** `ext_vorlaut_active` was
deleted — not renamed, and for a reason the format had nothing to do with: the
distinction it expressed was replaced by Sammlungen. It is worth writing down
what that came to, because a rename would pay the same price and buy less.

`tests/reference/obf.lock.json` holds 151 answers about that field and its
`active` counterpart on a set. They could not be re-recorded and could not be
made green: the lock has 123 `true` against 23 `false`, so no constant would
satisfy it. `tests/reference/layout.lock.json` lost a case outright, because its
file lists were frozen per *active* set and the middle one has no names to be
written with. Neither lock was touched. Both tests were narrowed instead, each
naming what it gave up — `ACTIVE_IS_GONE`, `THE_CAP_MOVED`,
`THE_FILTER_IS_GONE` — and none of it is recoverable, because the only thing
left that could write either lock is the module it checks.

**And what removing a second one cost, 2026-08-26.** `ext_vorlaut_color` went
with the per-set colour — again for a product reason and not a format one, and
again paid for out of the same locks. `obf.lock.json` stopped answering for the
field, for `border_color` on every button beside it, for `color` on every set
of every layout in it, and for `cssColor()` outright, the function having gone:
ten recorded answers about malformed colours that nothing can be asked for
again. `layout.lock.json` had every one of its cases transformed rather than
compared as frozen. Neither lock was touched. Both tests were narrowed —
`THE_COLOUR_IS_GONE` in each — and the same sentence holds: nothing is
recoverable, because the only thing left that could write either lock is the
module it checks.

That is two fields, each deleted because the product stopped needing it, and
between them most of what these locks used to say about colour. A rename for
tidiness would put every remaining `ext_vorlaut_*` field through the same thing
and end with the same records unregenerable, in exchange for a namespace nobody
reads twice. See [`docs/frozen-references.md`](../docs/frozen-references.md),
"What two locks have stopped answering for".
