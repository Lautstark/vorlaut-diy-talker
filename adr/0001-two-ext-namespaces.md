# ADR 0001 — `ext_lautstark_*` and `ext_vorlaut_*` stay separate

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** SPEC.md 1.0.0

## Context

Two OBF extension namespaces now exist in the Lautstark projects.

`ext_vorlaut_*` came first. The board builder's `.obz` export writes four
fields — `ext_vorlaut_color`, `ext_vorlaut_active`,
`ext_vorlaut_sleep_timeout_seconds`, `ext_vorlaut_voice` — for the DIY ESP32
talker. Two of them are meaningless off that device: `active` marks which of the
talker's sets is live, and `sleep_timeout_seconds` is a power setting for a
battery-powered box with physical keys.

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
two names. Half of `ext_vorlaut_*` is about a device with four keys and a
battery; none of `ext_lautstark_*` is. Unifying them would produce one namespace
in which most fields are meaningless to most readers, which is worse than two
honest ones.

**The frozen reference cannot be regenerated.** Renaming the talker's fields
means rewriting the one surviving record of a mapping whose oracle is gone. The
rename would be checked only against itself — the exact failure the reference
was created to prevent.

**The talker is out of scope.** SPEC.md governs builder-to-app packages. A
specification that reached into the talker's export to rename its fields would
be changing something it does not describe, for tidiness.

**The cost is small and one-directional.** `ext_vorlaut_color` and
`ext_vorlaut_voice` overlap with app concerns, so a builder writing both a
talker export and an app package writes two fields where one might do. That is
one duplicated value in a builder, against a rewritten frozen reference and a
muddled namespace.

## Consequences

- A talker `.obz` opened by the app viewer imports as a board with default
  colours and no voice hint. It is not an app package and is not expected to be
  one; nothing crashes and nothing warns.
- Fixture `unknown-ext` asserts this. It carries `ext_vorlaut_color` on a button
  and `ext_vorlaut_active` on a board, and an importer that reads either fails.
- A future builder that wants one export serving both must write both
  namespaces into one file. This is permitted: they do not collide.

## Not to be "fixed" later

This ADR exists because the duplication looks like an oversight and will invite
a cleanup. It is not an oversight. Anyone proposing to unify the namespaces
should first establish that the frozen reference can be regenerated against
something other than itself — and it cannot, which is the point.
