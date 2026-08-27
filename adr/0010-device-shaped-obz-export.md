# ADR 0010 — The device build has an export of its own, and it is a third door

**Status:** accepted, amended by [ADR 0011](0011-editor-exports-loader-sends.md)
· **Date:** 2026-08-27 · **Applies to:** `src/data/device_package.ts`

## Context

A device build lives in one browser's IndexedDB, on one machine. `runBuild()`
writes `layout.bin`, a `t<hash>.bin` per picture and an `a<hash>.wav` per
sentence into the `data` store; `loader/tools/cable.js` sends them to a talker. There
is no artefact anywhere that says *"this is what is on that talker"* in a form
anybody can diff, archive, or hand to somebody debugging at a bench. The folder
export writes the loose files and cannot be read back into a build.

`docs/obz-as-device-input.md` asked whether an `.obz` could carry all of it and
found that it could. Every gap between what `runBuild()` consumes and what the
two existing exports emit turned out to be a matter of **form** rather than of
presence:

| What `runBuild` uses | What the app package emits | What a device-shaped export must emit |
|---|---|---|
| the source picture, at its own size | PNG fitted to 512, canvas-resampled | **the source, unresampled** |
| `slot.negated` | the cross baked into those pixels | **a flag** (`ext_vorlaut_negated`) |
| 16 kHz mono 16-bit WAV | Ogg Opus at 24 kHz | **the WAV**, from the same master |
| `layout.language` | `locale`, derived from the *voice* | **the field itself** |
| `sleep_timeout_seconds` | absent | `ext_vorlaut_sleep_timeout_seconds` |

Two exports already write `.obz` here. `exportBoard()` writes the talker as a
document other AAC software can open: symbols as references, METACOM refused.
`exportAppPackage()` writes a Lautstark Board Package for the Android viewer:
pixels and Opus, baked. Neither fits, and asking which of two ill-fitting
exports to reuse is the wrong question — the device build is a third thing.

## Decision

**A third export door, `exportDevicePackage()`, writing an `.obz` in the
talker's own profile: the source pictures, a negation flag, the device's 16 kHz
WAVs and `layout.language` itself. It is a separate entry point, not an
argument to either of the other two.**

Four form rules, and `src/data/device_package.ts` is where each is written out
at length:

1. **`images/` holds the sources**, at their own size, in whatever format they
   were stored in, un-resampled and un-crossed — what `renderSymbol()` needs
   rather than what a button needs.
2. **Negation is `ext_vorlaut_negated`**, and the source travels un-crossed.
3. **`sounds/` holds `a<hash>.wav`**, the bytes the cable would have sent.
4. **`locale` is `layout.language`**, and `ext_vorlaut_sleep_timeout_seconds`
   and `ext_vorlaut_voice` sit on the root board, where `obf.ts` already puts
   them.

Three further things this decides:

- **The package is non-redistributable in the same posture the app package
  carries.** It is a vocabulary made for one person, and it may bake METACOM
  pixels only under the narrow permission `exchange/SPEC.md` §5.2 grants by
  name: a licensee preparing material for the person they support, sideloaded
  onto that person's own device. That is what the device build has always been.
- **It exports a build rather than synthesising one.** The WAVs come out of the
  `data` store under the names `audioName()` gave them, so the file cannot
  claim to be a talker's contents while holding audio that talker has never
  had. It asks for a current build first and says so. — **Amended the same day
  by [ADR 0011](0011-editor-exports-loader-sends.md), which is the one part of
  this decision that did not survive.** There is no build in the editor for the
  file to be a record of, and the relationship has inverted: the file is what a
  talker is *given*. So it synthesises, and it needs no current build. The
  paragraph is kept rather than rewritten because the reasoning in it is still
  the reasoning — it is what stops anybody deriving these WAVs from the app
  package's Opus, which [ADR 0008](0008-audio-masters-derived-artefacts.md)
  forbids and this file's form rule 3 is about.
- **`compileDevice()` is the inverse**, and it takes decoding and hashing from
  its host. Fed the export it reproduces exactly the files in the `data` store,
  which is what `tests/unit/device_roundtrip.test.ts` holds it to. — Since
  [ADR 0011](0011-editor-exports-loader-sends.md) it lives in
  `loader/src/compile.ts` and there is no `data` store to reproduce: it *is* the
  build, on the page that sends one. The round trip is unchanged and is now the
  only thing standing between an editor and a talker that have stopped
  agreeing, which is why that test walks the whole way through the actual bytes
  of the archive.

**No new `ext_vorlaut_*` field, and no change to `exchange/SPEC.md`.** Every
field this profile needs `obf.ts` was already writing. §1 of SPEC.md puts the
talker's `.obz` outside its scope, so none of §5.3's PNG-and-1024 rules reach
here — which is the whole reason form rule 1 is expressible at all.

## Why

**A third door is what §5.2 asks for, in the words it asks for it in.** The
rule is that an export baking pixels MUST be a separate entry point from the
talker's, *"a different function, not the same one behind a flag"* — because
the talker's guarantee is that it never writes a symbol as pixels, and a
guarantee enforced by an argument is one flag away from being untrue. That
argument does not weaken with a third writer; it is the reason there is one.

**The export is worth having whether or not anything is ever packaged or
split.** It is the first artefact here that can reconstruct a device build
without the editor's store. (Within the day it became the *only* one: see
[ADR 0011](0011-editor-exports-loader-sends.md). The argument below was made
without that in view and stands better for it.) That is the same argument ADR 0009 made about the
fixtures — the expensive half of a split turned out to be worth paying for on
its own — and `docs/obz-as-device-input.md` recommendation 4 is explicit that
nothing is being packaged or split. This ADR makes no claim about ADR 0006.

**Carrying the source rather than a fitted PNG is what keeps the frozen tiles
frozen.** `bakeImage()` fits a source into 512 through a canvas and says so in
its own first line: *"Not the device's tile."* Compiling a tile out of that PNG
resamples twice. For any pictogram larger than 512 the result is provably not
the pixels `tiles.ts` produces, `fillColour()` reads a different edge, and the
alpha has been through a premultiply `tiles.ts` has hand-written helpers
specifically to avoid. Every tile hash would move,
`tests/reference/tiles.lock.json` would be invalidated, and the first rebuild
after the change would re-send every tile over a 115200-baud cable.

**A flag rather than a baked cross, because the two crosses are different
drawings on purpose.** `negateInto()` fills a hard-edged nine-pixel cross
without antialiasing, because a tile is compared byte for byte against a frozen
reference; `crossOut()` strokes an antialiased one onto the tablet's PNG. Each
comment says why. Baking either would put the wrong one on the device — and
would make one reference two members of the archive for no gain.

**The WAV satisfies ADR 0008 by construction rather than by care.** That ADR
forbids deriving the device's WAV from the package's Opus. It says nothing
against carrying the device's WAV, which is the master's own child. Since the
bytes are the build's own, nothing on this path derives one delivered artefact
from the other, and no future edit can make it.

**The round trip is the test, because it is the comparison nothing else makes.**
`runBuild()` walks a `Layout` and writes tiles; `diyBoards()` walks the same
`Layout` and writes an `.obz`; neither has ever read the other's output, so
anything the two disagreed about had no test to fail. That is exactly how the
empty-slot divergence survived until 2026-08-27. The export is where the two
paths meet, so the export is where they can finally be held against each other.
It has already earned it: the round trip caught this file dropping a reference
that resolved to nothing, which would have re-opened that same divergence
through the door built to close it.

## Consequences

- **Three functions now write `.obz` in this repository**, with three copies of
  a five-key `grid()` between them. That duplication is the price and it is
  paid deliberately; see the next section.
- **The export needs a current build.** A Sammlung nobody has released cannot
  be written down, because there would be no audio to write. This is a
  constraint on when the door is usable, not a defect, and the error says so.
- **A METACOM source can now sit in a file on somebody's disk.** It could
  already sit in an app package, and it has reached the device since the day
  the device worked. What is new is that it is at rest in a third place, and
  the non-redistributable posture is what governs all three.
- **`tiles.renderPixels()` exists**, split out of `renderSymbol()` so the
  arithmetic is reachable without a canvas. Identical bytes, no `TILE_PIPELINE`
  bump; the browser-only half is now exactly `sourcePixels()`.
- **`readDevicePackage()` refuses more than it accepts.** A talker document, a
  package whose ring does not reach every board, a sound that is not the
  device's WAV, a name `layout.bin` cannot carry. `docs/device-interface.md` §6
  is the reason it refuses rather than guesses: a key that says the wrong
  sentence is worse than one that says nothing, because it is said to somebody
  who believes it.
- **`audioName()` moved to module scope in `backend/local.ts`.** The export and
  the build now ask one function what a sentence's WAV is called. Two copies of
  that rule would name the same sentence two different things, and the export
  would carry audio no talker holds.

## Not to be "fixed" later

**Somebody will look at three export functions that all write `.obz` and
propose merging them behind a flag** — `export(layout, { pixels, target })`, or
one door with three shapes. It is the obvious tidy-up and it is forbidden, by
`exchange/SPEC.md` §5.2, in words that will not be in front of whoever proposes
it:

> **On the builder side**, an app-package export that bakes pixels MUST be a
> separate entry point from the talker export — a different function, not the
> same one behind a flag. The talker's guarantee is that it never writes a
> symbol as pixels, and a guarantee enforced by an argument is one flag away
> from being untrue. Keep it structural.

The talker export refuses METACOM pixels in `checkLicensing()`. That refusal is
worth what the door enforcing it is worth. Behind a flag, the refusal becomes a
branch, and the licensing guarantee becomes a code path somebody can be one
argument away from taking by accident. Anybody proposing the merge would have
to get the sentence above changed first, and §5.2 says who owns it: it is a
licensing decision rather than a technical one, and the block quote in it is
not to be widened without asking the person who owns the licence.

The lesser version of the same proposal is to share the helpers — one `grid()`,
one `digest()`, one image-entry writer, imported by all three. That is where a
flag grows. `app_package.ts` already declined it once for this reason and this
file declines it again; twenty duplicated lines is the price of three doors
that cannot be talked into being one.

**The second proposal will be to give the export a `symbol_source` check like
the app package's.** `exchange/SPEC.md` §5.1's one-source rule is a rule about
Lautstark Board Packages, and §1 puts this profile outside that document
entirely. More to the point, the device build has never enforced it: a mixed
Sammlung builds and reaches a talker today. An export that refused what the
build accepts would be a door that cannot write down the device in front of it,
which is the one thing it exists to do.
