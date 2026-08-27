# ADR 0012 — This repository splits into three, and the editor is the half that leaves

**Status:** accepted · **Date:** 2026-08-27 · **Applies to:** this repository as
a whole, and the three names in
[`docs/repository-map.md`](../docs/repository-map.md#the-three-names)

## Context

[ADR 0006](0006-builder-and-hardware-one-repo.md) kept the builder and the
hardware in one repository and named four conditions for revisiting.
[`docs/device-interface.md`](../docs/device-interface.md#what-the-evidence-actually-says)
answered condition 1 on 2026-08-26 with a week of history and concluded *not
met, and not close*. [`docs/obz-as-device-input.md`](../docs/obz-as-device-input.md)
answered the question again on 2026-08-27, and its recommendation 4 said **"do
not package or split yet"** on two grounds: condition 2 of ADR 0006 had not been
met, and the format was still moving, with a breaking cable change landing that
day.

The names were settled ahead of the question, deliberately —
`vorlaut-diy-talker`, `vorlaut-editor`, `vorlaut` — because naming is cheap
before a move and expensive halfway through one. So is the direction: the
**editor** is the half that leaves, and the talker keeps the repository it is
named for. What was left open was **whether**.

[ADR 0011](0011-editor-exports-the-talker-repository-sends.md) then moved the
seam. The editor exports a file and stops; the talker's own repository gained
[`loader/`](../loader/README.md), the page that compiles that file and sends it.
Both implementations of every device format — the C++ reader in `firmware/` and
the TypeScript writer in `loader/src/layout_format.ts` — ended up on the same
side of the seam, with no package, no pin and no cross-repository code
dependency between the halves.

Both of recommendation 4's grounds have since dissolved, and they dissolved in
different ways. That is what this file records.

## Decision

**This repository splits into the three repositories `repository-map.md` names,
and the editor is the half that leaves.**

| | |
|---|---|
| `vorlaut-diy-talker` | **This repository**, keeping its name, its history, its published address and its `v*` tags. [`firmware/`](../firmware/), [`case/`](../case/), [`device/`](../device/README.md), [`loader/`](../loader/README.md), `tests/run.py` and the Python beside it. |
| `vorlaut-editor` | New. [`src/`](../src/), [`exchange/`](../exchange/README.md) and the three `.obz` doors. |
| `vorlaut` | New. The explainer site. It reads no format, writes no format, pins nothing and is pinned by nothing. |

Four things this settles that were open:

- **`device/fixtures/` stays in `vorlaut-diy-talker`, and no fourth name is
  needed.** The Why below has the argument.
- **`tests/unit/` divides file by file rather than as a directory**, along the
  line `tests/unit/layers.test.ts` already draws. Eight of its files reach into
  `loader/` and four of those import `src/` as well; the other twenty-one are
  the editor's outright. The four that straddle are what has to be answered for
  on the day, and they straddle for the same reason the bill below exists.
- **`tests/reference/` does not move as a unit either.** The locks follow the
  modules they protect —
  [`format-freeze.md` §6](../docs/format-freeze.md#6-testsreference-and-devicefixtures--the-boundary-is-real)
  and the cost list have the division, and `tiles.lock.json` is the awkward one
  because the module under it is.
- **`adr/` goes with the talker, whole, and the editor links across to it.** The
  sequence is never renumbered ([`adr/README.md`](README.md)), so the
  alternative is two divergent copies of one set of numbers. A cross-repository
  link is cheaper than that, and every link already published — the Android
  viewer's pin among them — resolves against the repository that keeps the name.

**This is a decision and not a schedule.** Nothing moves in the commit that
lands this file. What the move costs is worked out in
[`repository-map.md`](../docs/repository-map.md#what-the-move-costs), and that
list stops being hypothetical here: it is the checklist, and it is what a person
doing the move works through rather than discovers.

**The third name is not waiting for the other two.** `vorlaut` — the explainer
site — could have been stood up on any day since the names were settled, and
reading the three names as one event is what has been deferring the only piece
that was never blocked.

**ADR 0006 is not superseded, its status does not change, and this file does not
claim otherwise.** See the first paragraph of the Why, and the pointer added to
[0006's Examined section](0006-builder-and-hardware-one-repo.md#examined).

## Why

**ADR 0006's load-bearing argument is untouched, and it is what decided which
half leaves.** 0006 says only one repository can hold two implementations
against each other, and that `tests/run.py` — compiling `firmware/vorlaut/*.h`
and replaying the browser's actual bytes into the device's actual reader — is
what that buys. After ADR 0011 both implementations of the device format are on
the same side: the C++ reader in `firmware/`, the TypeScript writer in
`loader/`, and `tests/run.py` compiling both on one commit. The editor leaving
takes no implementation of any device format with it. So the argument is not
overruled here; it is **satisfied on one side of the seam**, which is a
different thing and a better one — the pairing now survives a split rather than
depending on there not being one. Anybody reading 0006 after this should read it
as still true and still binding on `vorlaut-diy-talker`.

**Recommendation 4's first ground was about a design nobody built.** It rested
on condition 2 of ADR 0006, which asks for a second consumer of `layout.bin`
before the firmware's format handling *"should leave the same way — as a pinned
package, not as a copy."* That condition gates **extracting a shared package**,
and ADR 0011 chose a design that has none: a file between the two halves, not an
import and not a dependency. The condition is therefore **not an outstanding
item that has been met** — it was never about this. Its premise is gone, which
0006's own Examined section recorded on 2026-08-27 in the same words: *retired
rather than met*. Writing it up as a met condition would leave the next reader
believing a second consumer of `layout.bin` appeared. None has.

**Recommendation 4's second ground has expired, and it expired on the record.**
It named a format still moving, with a breaking cable change landing that day.
[`format-freeze.md`](../docs/format-freeze.md#the-short-answer) is the survey
that was asked for, and it now records C1, C2 and L1 all landed on 2026-08-27 —
chunk acknowledgement with `CABLE_RX_BUFFER`'s bound taken out with it, a
runtime `CABLE_VERSION` comparison, and the sleep timeout decided in writing
with a clamp beside `parseLayout`. Its §8 sequencing puts the remainder at
**three items, none of them blocking**: L2, N1 and P1, each a change to a format
that has not been frozen but none of them a thing that has to happen before a
device freeze. The change that was in flight when recommendation 4 was written
is the change that landed. Waiting it out is what was asked for, and it is done.

**The seam is a directory now, so the move is a move rather than an
excavation.** *"Whatever compiles a package into what the talker reads"* used to
be `runBuild()` at the foot of `src/backend/local.ts` — inside the file that
answers the editor's questions. It is [`loader/`](../loader/README.md), a
top-level sibling of `firmware/`, `case/` and `device/`, published at
`<base>loader/` out of the same build. Extracting the device path from `src/`
was the expensive half of any separation and it has already been paid for, on
its own merits, in a commit that had nothing to do with a split. What is left is
`git mv` and a set of addresses.

**The bill is counted rather than discovered, and it is ten names.**
`tests/unit/layers.test.ts` holds the editor to exactly what it may take out of
`loader/`: seven facts about the format from `layout_format.ts` —
`SLOTS_PER_SET`, `HASH_BYTES`, `LANGUAGE_CODES`, `DEFAULT_LANGUAGE`,
`SLEEP_MIN`, `SLEEP_MAX`, `SLEEP_DEFAULT` — and `thumbnailSize()`,
`renderSymbol()` and `TILE_SIZE` from `tiles.ts`. That test is the one thing
here that cannot survive the split: a rule about imports has nothing to read
once the two directories are in two repositories. On the day it stops being a
check and becomes the list of ten things to answer for, which is exactly what it
was written to be.

**`device/fixtures/` was the one thing the naming made worse, and ADR 0011
dissolved that problem rather than solving it.** The concern
[ADR 0009](0009-device-interface-fixtures.md) recorded is an asymmetry, and the
asymmetry is specific: a format whose fixtures live with the *writer* while the
*reader* merely pins them puts the authority on the side with nothing at stake,
and here the reader is a talker on a shelf that nobody in this repository can
make move. That is why the fixtures belong to neither half. `repository-map.md`
then observed that the three names leave nowhere for them to go — the "third
repository" that sentence assumed had become the explainer site, and there is no
spare name.

There is nothing left to place. After ADR 0011 the writer
(`loader/src/layout_format.ts`) and the reader (`firmware/`) are **both** in
`vorlaut-diy-talker`, and the editor is not a party to the device format at all:
it takes ten read-only names out of `loader/`, calls `renderLayoutBin()` never,
and writes no `layout.bin`. So the fixtures sitting in `vorlaut-diy-talker` does
not put them with one of two halves. It puts them with both, beside the two
implementations they are held against — which is the arrangement they have
today, in this repository, and the one ADR 0009 asked for. The directory goes on
belonging to neither `loader/` nor `firmware/`, and that is an ownership
statement about a directory, not about a repository; the split does not touch
it, because the split does not separate the two halves. **No fourth name is
needed, and `format-freeze.md` §6's "becomes the third repository" is corrected
rather than reinterpreted.**

**What is not being claimed.** Conditions 3 and 4 of ADR 0006 are untouched: CI
is fast and there is one maintainer. Condition 1 is not met either — `layout.bin`
and the cable protocol are not frozen for good, and `device-v*` is still uncut.
This decision does not pretend otherwise, and it is not a claim that a condition
fired. Every one of 0006's conditions asks when the argument against splitting
stops applying **to this repository**; what ADR 0011 did was make it stop
applying **to the seam**. The two implementations that must agree stay together
on one side of the cut, so the split no longer runs through the thing 0006 was
protecting. That is not one of the four conditions because on 2026-08-24 nobody
had thought of it — and it answers the question the four conditions were asked
in service of.

## Consequences

- **The history goes with the talker, and the editor gets a rewritten copy
  rather than an empty one.** `git filter-repo` on the **copy**, so no id
  already cited moves — the Android viewer's pin included. The two costs are
  stated in [`repository-map.md`](../docs/repository-map.md#what-the-move-costs)
  and neither is avoidable: the same commit then exists twice under two ids, and
  a path-filtered commit keeps its whole message while keeping half its diff.
  The editor's history is for reading, not for auditing.
- **The editor's published address moves and the talker page's does not.** The
  base is written out literally in `package.json`'s `test:e2e` and
  `build:pages`, and in `playwright.config.ts`'s `BASE`; `pages.yml` follows a
  rename for free and those three do not. A project site that changes repository
  leaves no redirect behind it, so `https://lautstark.github.io/vorlaut-editor/`
  is a new bookmark for everybody who had the old one. The bookmark somebody
  opens with a cable in their hand is the one that never changes, because the
  page is served from the repository that keeps the name.
- **The Android viewer's pin freezes on the day and does not break.**
  `exchange/` goes with the editor, its rule still reads correctly — the
  fixtures live with the writer, the writer is `src/data/app_package.ts` — and
  the existing commit SHA goes on resolving, because this history is not
  rewritten. What it cannot do is move forward without re-pointing at
  `vorlaut-editor`, and against a filtered copy that is a fresh pin rather than a
  bump. The cheapest moment is when `exchange-v1.2.0` is cut, which is what ends
  SHA-pinning anyway.
- **`v*` keeps meaning a firmware release.** `release.yml`, the published tags
  and the notes stay in the repository that published them; nothing is
  re-prefixed and no tag out in the world changes meaning. The editor arrives at
  an empty tag namespace and may spend `v*` on itself.
- **ADR 0006's three-toolchain consequence unwinds for the editor and stands for
  the talker.** The editor keeps `test_links.py`, `test_language.py` and
  `test_exchange_fixtures.py` — a repository's own checks, plus the one that
  travels with `exchange/` — and needs no compiler. `vorlaut-diy-talker` keeps
  all three languages, because `loader/` is TypeScript and `firmware/` is C++
  and holding them against each other is the whole point.
- **`loader/src/tiles.ts` is the awkward module, and it stays whole.**
  `renderSymbol()` is the device's and `thumbnailSize()` is the tablet's, and
  they are one module because they are one rounding rule that follows Pillow
  step for step. Split it and that arithmetic exists twice with nothing holding
  the copies together, which is the failure
  [`frozen-references.md`](../docs/frozen-references.md) exists to record. So the
  editor goes on importing one function across a repository boundary, or the
  rule is written down where both can be held to it. The locks divide more
  neatly: `obf.lock.json` and `tts.lock.json` follow the converter and the
  recording chain to the editor, `layout.lock.json` and `tiles.lock.json` follow
  the modules they protect to the talker.
- **This repository stops serving two pages from one Pages deployment.** Since
  ADR 0011 it serves the editor and the talker's page out of one bundle; after
  the split the editor's build moves out and the talker's page stays where it
  already was. The split is not the moment a second site is stood up — that
  already happened.

## Not to be "fixed" later

**Somebody will read this file as overruling ADR 0006 and tidy 0006 away.** It
is the obvious cleanup: an ADR that says *"they stay in one repository"* sitting
next to an ADR that says *"the repository splits"*, one of them four days older.
Marking 0006 superseded, or deleting it, would be wrong in a way that is
expensive rather than untidy. 0006's argument is not what this decision
overcame — it is what this decision is built on, and it is what decided **which
half leaves**. Delete it and the only written reason the compiler and the
firmware reader are on the same side goes with it, and the next person to
propose moving `loader/` into `vorlaut-editor` — where the browser code
obviously belongs, where the TypeScript toolchain already is — has nothing in
front of them.

What somebody proposing 0006's retirement would have to establish is that
`tests/run.py` no longer holds two implementations against each other on a
single commit: that `layout.bin`, the cable protocol and the panel's text have
stopped existing twice, or that something other than one repository can hold
them together. Neither is true, and the four conditions in 0006 are still the
place that question is answered.

**Somebody will propose moving `device/fixtures/` into `vorlaut-editor` beside
`tests/reference/`, or standing up a fourth repository for it.** Both are the
same misreading: that ADR 0009's rule is *"the fixtures must not live with
either half"* in a geographic sense. It is not. The rule is that the **authority
over the format** must not sit with one implementation, and what enforces that
is a directory owned by neither, with `make_fixtures.mjs` importing nothing from
`src/`, `tools/` or `firmware/` and never reading its own output back. All of
that holds inside `vorlaut-diy-talker` exactly as it holds today. A fourth
repository would add a pin, a tag and a version boundary to buy a property the
directory already has. And moving the fixtures to the editor would be worse than
either — it would put authored assertions under
[`frozen-references.md`](../docs/frozen-references.md), which forbids the one
thing they are for, and hand the device format to a repository that no longer
implements it.
