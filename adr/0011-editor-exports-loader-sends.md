# ADR 0011 — The editor exports a file; a second page puts it on the talker

**Status:** accepted · **Date:** 2026-08-27 · **Applies to:** `src/`, `loader/`
· **Amends:** [ADR 0010](0010-device-shaped-obz-export.md)

## Context

The editor did everything. It held the Sammlung, resolved the pictures, spoke
the sentences, rendered a tile per key, wrote `layout.bin`, kept all of it in an
IndexedDB store called `data`, opened a serial port, diffed against what the
talker already held, and pushed the difference down a 115200-baud cable — with
a progress line and a way to stop. That is four unrelated jobs in one page, and
they were tangled rather than merely adjacent:

- `runBuild()` sat at the foot of `src/backend/local.ts`, a 1272-line file that
  also answered the editor's questions about collections, layouts, symbols and
  voices. The file's own opening comment says it is "where they stopped being
  spare parts", which was true and had stopped being a compliment.
- The `data` store existed only so that a build could hand a megabyte to a
  transport without it travelling through a return value.
- `exportDevicePackage()` — [ADR 0010](0010-device-shaped-obz-export.md)'s third
  door — refused to run unless there was a *current build* to copy WAVs out of.
- A `buildCurrent` mark travelled out of storage, through the save loop, into a
  publish/subscribe relay, and lit a button in the work head.

Meanwhile a second consumer had already appeared and been solved differently.
`vorlaut-app` reads a **file** the editor writes ([ADR 0004](0004-android-app-is-a-viewer.md),
[`exchange/SPEC.md`](../exchange/SPEC.md)), and nothing about the tablet is in
the editor at all. The talker was the one consumer the editor still reached for
directly, and the only reason was history: it was here first.

## Decision

**The editor exports a file and that is all it does. A second page, served from
this same repository, takes that file and puts it on a talker.**

Concretely:

1. **`loader/`** is a directory beside `firmware/`, `case/` and `device/`,
   holding the second page and every module that is the talker's: the compiler,
   `tiles.ts`, `layout_format.ts`, the cable, the folder export and
   `tools/cable.js`. Vite builds two entry points and Pages serves both from one
   deploy; the published address is `<base>loader/`.
2. **`runBuild()`, the `data` store and everything around them are deleted.**
   `compileDevice()` does the same work on the other page, from the file.
3. **`exportDevicePackage()` synthesises rather than copying a build**, with the
   progress-and-stop sheet the app package already had. This amends ADR 0010 —
   see below.
4. **Validation becomes a job.** The talker's constraints were implicit in the
   only program that could write the file. They are now checks, in
   `loader/src/validate.ts`, said in words a carer can act on.

## Why

**Both consumers now have the same relationship with the editor, and it is a
file.** The Android viewer takes one; the talker takes one. Neither knows the
other exists, neither is reachable from the editor, and the editor's list of
ways it touches the outside world (`src/backend/index.ts`) is storage and the
answers to questions about pictures and voices — nothing that knows a device.
That symmetry is not tidiness: it is what makes the two devices independently
replaceable, and it is the arrangement ADR 0004 already argued for once.

**The file is the seam the repository map predicted, made real.**
[`docs/repository-map.md`](../docs/repository-map.md) says of the eventual
split: *"The move is cheap exactly when that boundary is a file format rather
than a function call, and the device-shaped `.obz` is what would make it one:
the editor writes a package, the device repository compiles it, and the two are
held apart by fixtures instead of by an import."* That sentence described a
proposal. This is it, minus the split: one repository, two directories, a file
between them.

**Nothing in the editor was doing the build any good.** A build needed a canvas,
a synthesiser, an Azure key, a voice catalogue, a METACOM folder and a store; a
compile needs a decoder and a hash. `compileDevice()`'s own note listed
everything it does *not* need, and every item on that list was something the
editor was dragging along for it.

**The dialog that made the transfer expensive is gone with the build.**
`src/editor-diy/release.ts` carried a long note about an ordering it could not
escape: `requestPort()` needs transient activation that Chrome expires in about
five seconds, so the port had to be chosen before the build, and a port that
turned out to be wrong therefore cost a full build — minutes of synthesis —
before anything could say so. Probing first was ruled out twice, on the record,
because `hello` takes a talker's keys away for about five and a half seconds on
every attempt. On the loader page the compile is seconds and touches no network,
so the same ordering costs a second press. The rule survived the move; its price
did not.

**Checking is worth more than it looks, and it could not exist before.** While
one program wrote the file and read it back, every constraint could be an
assumption. `LIMITS.maxSets` meant no Sammlung had six sets, so the build never
asked; `SLOTS_PER_SET` meant no set had five keys; the synthesis chain meant
every WAV was 16 kHz. A file that arrives from elsewhere — a later editor, a
script, a hand edit at a bench — carries none of that, and the failures are
quiet in exactly the way [`docs/device-interface.md` §6](../docs/device-interface.md)
is a whole section about. A talker handed a `layout.bin` naming six sets answers
`LAYOUT_BAD_LENGTH` and shows nothing at all, in a house, with a child in front
of it.

**Nothing leaves the machine, and that is structural rather than promised.** The
page reads the file with the File API and compiles it in the browser. There is
no fetch on it. `exchange/SPEC.md` §5.2 permits a METACOM licensee to bake their
own symbols into a package *for the person they support* and sideload it, which
is exactly what a device package is; a page that uploaded one anywhere would
turn that blessed case into the travelling file the rule exists to prevent.
[ADR 0002](0002-no-server-no-accounts.md) says the same of the product.

## What this amends in ADR 0010

ADR 0010 decided the third export door, its four form rules and its round trip.
**All of that stands.** One of its three "further things" does not:

> **It exports a build rather than synthesising one.** The WAVs come out of the
> `data` store under the names `audioName()` gave them, so the file cannot claim
> to be a talker's contents while holding audio that talker has never had. It
> asks for a current build first and says so.

That was right about an artefact whose job was to *record* a device. The
relationship has inverted: there is no build in the editor for the file to be a
record of, and the file is what a talker is given rather than a description of
one. So the export synthesises, and "audio that talker has never had" is no
longer a thing that can be said — the talker has whatever this file says,
because this file is where it comes from.

Two consequences ADR 0010 listed go with it. *"The export needs a current
build"* is not a constraint any more; a Sammlung can be written out the moment
it is finished, by somebody who has never seen a cable. And the export is no
longer instant, which is why it has the app package's progress and stop.

What is **not** amended, and is if anything strengthened: `audioName()` is still
the one opinion about what a sentence's WAV is called. It used to matter because
a rebuild looked in the store for a file under that name; it matters now because
the name is the only shape `layout.bin` can carry, and the compiler on the other
side reads it out of the package rather than deriving it.

## Consequences

- **`tests/run.py` is unchanged in what it does and better placed.** It compiles
  `firmware/vorlaut/*.h` and replays the browser's bytes into the device's own
  reader, and both halves of that are now on the same side of the boundary:
  `loader/src/layout_format.ts` and `loader/tools/cable.js` sit beside
  `firmware/`. `test_tile_render_js.py`, `test_layout_frozen.py` and
  `test_cable_format.py` point at `loader/` and are otherwise untouched.
  [ADR 0006](0006-builder-and-hardware-one-repo.md)'s load-bearing argument is
  not weakened — if anything it now applies to a directory rather than to a
  scattering.
- **`device/fixtures/` gained a reader.** `MAX_SETS` is now a number the browser
  acts on rather than one only the firmware holds, so
  `tests/unit/device_fixtures.test.ts` derives it from the fixtures and
  `tools/devicemutate.py` has a mutant for it. A check the mutation run cannot
  see is a check that is not there — that is ADR 0009's bar, and this change
  raises the fixture set rather than leaving it flat.
- **Two directories import each other, and the list is short on purpose.** `src/`
  takes four format constants and `renderSymbol()` out of `loader/`; `loader/`
  takes the label table and `data/device_package.ts` out of `src/`.
  `tests/unit/layers.test.ts` holds the first list to exactly those names, and
  it is the bill for the eventual split rather than an accident.
- **The device preview stayed in the editor**, and it is the one place the editor
  still runs the device's own code. `previewInto()` draws a symbol the way a
  ScreenKey draws it — 128×128, rounded to RGB565 — so that a pictogram can be
  judged at 15.21 mm before a child has to recognise it there. It writes no file
  and reaches no device. What left is the build and the cable, not the ability
  to draw a picture of one.
- **The database is at version 4** and drops the `data` store. Dropping it out of
  the upgrade alone would have left every browser that has been here holding a
  megabyte of tiles for a device this page can no longer reach — invisible to
  everything, and freed by nothing.
- **Two pages share one label table.** `src/core/boot_data.ts` gained a `load.*`
  group and lost the build log's; `t()` moved to `core/boot.ts` beside the table
  it reads, so both pages call the same function. A second table would have been
  a second translation system within a week.
- **A second entry point is a second thing a base path can break.** The link from
  the editor's export sheet to the loader page is built from
  `import.meta.env.BASE_URL`; `docs/repository-map.md` lists three tracked places
  where the base is written out literally, and each is a place a rename breaks in
  silence. This is not a fourth.

## Not to be "fixed" later

**Somebody will propose that the loader page just read the editor's IndexedDB.**
Same origin, same deploy, one less file to carry — and it would undo the whole
of this. The point is not that the two are separate programs; it is that what
passes between them is an artefact somebody can hold, diff, archive, email to
whoever is at the bench, and hand to a talker six months later from a laptop
that has never run the editor. A shared database is a function call wearing a
file's clothes, and it would put the split back exactly where ADR 0006 says the
expensive part of one lives.

**And somebody will propose collapsing the three export doors into one button.**
That is a separate and smaller change, it is not forbidden, and ADR 0010's own
"Not to be fixed later" is about the three *functions* rather than the three
menu entries. The functions stay three: `exchange/SPEC.md` §5.2 requires it in
words, and it is a licensing decision rather than a technical one.
