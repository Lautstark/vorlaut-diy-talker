# ADR 0011 — The editor exports a file, and the talker's repository is what sends it

**Status:** accepted · **Date:** 2026-08-27 · **Applies to:** the boundary
between the editor and the device

## Context

The editor owns the whole device path today. `runBuild()` at the foot of
[`src/backend/local.ts`](../src/backend/local.ts) synthesises the audio, renders
every tile, writes `layout.bin` and puts the result in IndexedDB;
[`loader/src/cable.ts`](../loader/src/cable.ts) opens a Web Serial port;
[`loader/tools/cable.js`](../loader/tools/cable.js) speaks the wire; the release dialog
reports the transfer. A person edits a Sammlung and presses one button, and a
talker on the other end of a USB-C cable has new contents.

[ADR 0010](0010-device-shaped-obz-export.md) put a file where that used to be a
function call. `exportDevicePackage()` writes a device-shaped `.obz` — the
sources unresampled, negation as a flag, the device's own 16 kHz WAVs — and
`compileDevice()` reads it back into exactly the files the `data` store holds,
which is what `tests/unit/device_roundtrip.test.ts` holds it to. For the first
time the boundary between *what the editor knows* and *what the device needs*
is expressible as bytes on a disk rather than as an import.

[`docs/obz-as-device-input.md`](../docs/obz-as-device-input.md) then proposed
what to do with that boundary: the editor keeps rendering tiles and speaking the
wire through a **compiler package**, published by the firmware's repository and
pinned the way `design`, `bildquelle`, `sicherung` and `stimmquelle` are pinned.
Its own §11 priced that honestly — a release plus a bump for every format
change, at four or five format changes a week — and its recommendation 4 said
not to do it yet.

There is a third answer, and it is not a slower version of the second one.

## Decision

**The editor exports a file and stops.** One action, *Sammlung exportieren*,
whatever kind of board it is. No Web Serial in the editor, no `layout.bin`, no
tile rendering, no build, no transfer sheet, no Device panel.

**The talker's repository gains a page**, served from GitHub Pages, that a
person opens when they have a talker in front of them: choose the exported file,
validate it, compile it into what the device reads, connect, send.

**There is no shared package and no cross-repo code dependency.** The boundary
is the file format, full stop. Nothing is published, nothing is pinned, nothing
is bumped.

Three things this settles by construction:

- **`compileDevice()`, `tiles.ts` and `loader/tools/cable.js` belong to the page**, and
  the page belongs to the repository the firmware is in. Writer and reader of
  every device format end up on the same side, permanently.
- **The editor's output is one artefact per Sammlung**, and both readers take
  it: `vorlaut-app` for a tablet board, this page for a talker board.
- **One action is a statement about the menu, not about the doors.** The three
  writer functions stay three functions sharing no code path —
  `exportBoard()` for a document other AAC software can open,
  `exportAppPackage()` for a tablet, `exportDevicePackage()` for a talker — and
  [`exchange/SPEC.md`](../exchange/SPEC.md) §5.2's structural separation is
  untouched. What collapses to one entry is what a person presses: *export this
  Sammlung*, which writes the package for whichever kind of board it is.

## Why

**Both consumers become symmetric, and that is the whole shape of it.** The
Android viewer takes a file and knows nothing about the editor
([ADR 0004](0004-android-app-is-a-viewer.md)). Under this decision the talker's
page takes a file and knows nothing about the editor either. One export, two
readers, neither aware of the other — instead of the arrangement this project
has had since the cable landed, which is one file boundary and one cable
boundary held together by different reasoning at each end.

**There is no release-and-bump cost, because there is nothing to release.** The
package route made every format change a tag, a lockfile line and a bump commit,
and [`docs/obz-as-device-input.md`](../docs/obz-as-device-input.md) §11 measured
what that would have cost against real history: `layout_format.ts` broke on
2026-08-25, `cable_format.h` broke on 2026-08-27, `firmware/` changed on five of
seven days. Each of those would have been a release plus a bump. Here each of
them stays what it is today — one commit that is either right or wrong as a
unit, with no interval in which two `main`s disagree.

**The compile-both check gets stronger rather than surviving.** `tests/run.py`
compiles `firmware/vorlaut/*.h` and replays the browser's actual bytes into the
device's actual reader, and [ADR 0006](0006-builder-and-hardware-one-repo.md)'s
load-bearing argument is that only one repository can hold two implementations
against each other. After this the compiler and the firmware reader are in that
one repository whatever else happens — including a split, because the editor is
the half that leaves. `device/fixtures/` was invented to substitute for that
check once the two halves were separated
([ADR 0009](0009-device-interface-fixtures.md)); they will not be separated, and
the fixtures go on being the third check they already are.

**`CABLE_VERSION` stops being a cross-repo contract before it ever becomes
one.** Both halves of the protocol live on one side: `cable_format.h` and
`loader/tools/cable.js`, in one commit, the way the chunk-acknowledgement change landed
on 2026-08-27. `docs/format-freeze.md` §C2 already records that the two numbers
are held together by a test that greps a file — a check that works exactly as
long as both files are in the tree that test runs in.

**The editor stops being Chrome-only.** Web Serial is Chrome's, and today one
step of the flow constrains the whole editor: a carer on Firefox or Safari
cannot use the board designer at all, for the sake of a button they press at the
end. Afterwards the editor is a page anybody can open, and only the page that
actually needs a serial port asks for one.

**The cost is a step, and it is stated plainly rather than argued away.** Today
the flow is *edit, press Send*. Afterwards it is *edit, export, open the page,
send*. That is worse for the person doing it, every time they do it. It was
weighed and accepted: the Android viewer's carers already work this way and have
since the app existed, the file is one somebody may want to keep anyway
(ADR 0010), and there are no users yet — the moment to pay this is now, before
anybody has a habit built on the shorter flow.

## Consequences

- **ADR 0006's revisit condition 2 is moot**, and 0006 is amended to say why.
  The condition gated extracting the device's format handling *as a pinned
  package*; under this decision there is no shared format handling to extract,
  so the condition has nothing left to gate. This is a premise removed rather
  than a rule overridden — see the Examined entry in
  [0006](0006-builder-and-hardware-one-repo.md#examined).
- **This repository serves two pages from one Pages deployment**, until the
  editor leaves. `pages.yml` builds one bundle at
  `BASE_PATH: /${{ github.event.repository.name }}/`, and the page is part of
  it; the address a carer bookmarks for the editor and the address they bookmark
  for the talker are the same site today and two sites afterwards.
- **The editor's three-toolchain consequence unwinds sooner.** ADR 0006 records
  that a contributor needs Node, Python and `g++` for the full suite. The
  editor's half of that shrinks to `test_links.py`, `test_language.py` and
  `test_exchange_fixtures.py` the moment the device path is out of `src/`, which
  is before any repository moves anywhere.
- **A build now needs a person twice**: somebody exports, and somebody opens the
  page with a cable in hand. Nothing happens to a talker that a person did not
  do in front of it, which is what was already true and is now structural. —
  This was first written as *"the export needs a current build, so a Sammlung
  nobody has released still cannot be written down (ADR 0010)"*, and building it
  showed that half could not survive the decision above. There is no build in
  the editor for the export to need. See the Built section below.
- **`docs/obz-as-device-input.md` and `docs/repository-map.md` describe a design
  nobody will build**, in their recommendations and their proposed section
  respectively. Both are marked rather than deleted: the measurement in
  `obz-as-device-input.md` — that an `.obz` can carry everything the device
  build uses — is the foundation this decision rests on, and only the question
  of *who compiles it* changed.

## Not to be "fixed" later

**Somebody will ask why the editor cannot just send to the device, because it
used to.** It is a one-line-sounding request — the code is in the history, the
button was there, the flow was shorter — and it is the cleanup this file exists
to be in front of.

What it would cost is the whole of the Why above, and three parts of it are not
recoverable by being careful. The editor would need `tiles.ts`, `layout.bin` and
the wire back, which means either a copy of them (two implementations of the
device format with nothing holding them together, which is the failure
[`frozen-references.md`](../docs/frozen-references.md) records) or the package
route this decision replaced, with its release per format change. It would put
Web Serial back in the editor's critical path, so the board designer would again
run in one browser for the sake of its last step. And it would put the writer of
`layout.bin` back on the other side of whatever boundary the editor sits behind,
which is the one thing ADR 0006 has been protecting since it was written.

The lesser version is to keep the page and add a Send button to the editor "as
well", for the people who want the short flow. That is worse than either
end-state: two paths to a device, one of them the tested one and the other the
convenient one, and `docs/device-interface.md` §6 is a section about what a
device that parses the wrong bytes does to somebody who believes it. Anybody
proposing the short flow back would have to argue the step is costing a real
person something real — which is a measurement, from users who by then exist,
and not the intuition that four actions look worse than two.

## Built — 2026-08-27

This ADR was written the same day as the code and landed a few minutes ahead of
it, so it is worth saying plainly what exists and where the two differ. Nothing
below reopens the decision; it records the shape it took.

**The page is [`loader/`](../loader/README.md)**, a top-level directory beside
`firmware/`, `case/` and `device/`, published at `<base>loader/` out of a second
Vite entry point in the same build. That README says why it is a sibling of the
firmware rather than a directory under `src/`: it is what stays behind when the
editor leaves, so the eventual split is a move rather than an excavation.

**The export synthesises, and ADR 0010 is amended rather than upheld on this
point.** That ADR decided the device export copies WAVs out of the build's own
store and refuses to run without a current build, because a file claiming to be
a talker's contents while holding audio that talker had never had was the one
thing it must not do. The decision above deletes the build, which inverts the
relationship: the file is not a record of a device, it is what a device is
given. So it speaks for itself, with the progress-and-stop sheet the app package
already had, and the consequence above is corrected to match.

**The menu was still three entries, and that was the one part of the Decision
above not yet done.** *"One action, Sammlung exportieren, whatever kind of board
it is"* is a statement about what a person presses, and this ADR already says so
— it is separable from everything else here, and it was deliberately left for a
change of its own rather than folded into one large enough to hide it. The three
writer functions are untouched and stay untouched: `exchange/SPEC.md` §5.2
requires that, and it is a licensing decision rather than a technical one.

That change landed later the same day. The ⋯ carries one entry, *Sammlung
exportieren*, and `chooseExport()` in
[`src/shell/collections.ts`](../src/shell/collections.ts) asks what the file is
for — a talker, a tablet, another program — in the card shape `askTarget()`
beside it already uses, each card saying what it is *for* rather than what is
in it. The three writers are three: each card names `exportBoard()`,
`exportAppPackage()` or `exportDevicePackage()` literally, the choice is spent
at the press, and nothing carrying a kind is passed to a writer for it to
branch on — which is what keeps §5.2 true at every call site rather than
nearly. A dismissed sheet writes nothing and saves nothing.

**Two directories import each other, and the list is short on purpose.** `src/`
takes seven format constants and `renderSymbol()` out of `loader/`; `loader/`
takes the label table and `src/data/device_package.ts` out of `src/`.
`tests/unit/layers.test.ts` holds the first list to exactly those names and is
where an eighth has to be argued for. That list is the bill for the split, in
one place, rather than something to be discovered on the day.

**`device/fixtures/` gained a reader rather than losing one.** `MAX_SETS` is now
a number the browser acts on — `loader/src/validate.ts` refuses a sixth set
before anything is sent, because a talker handed one answers `LAYOUT_BAD_LENGTH`
and shows nothing at all — so `tests/unit/device_fixtures.test.ts` derives it
from the fixtures and `tools/devicemutate.py` has a mutant for it. ADR 0009's
bar is that a change leaving the mutation run quiet has removed a check rather
than passed one; this one made it louder.
