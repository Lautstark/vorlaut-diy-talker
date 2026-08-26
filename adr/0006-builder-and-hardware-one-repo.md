# ADR 0006 — The builder and the hardware stay in one repository

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** the vorlaut
repository

## Context

`vorlaut` holds four things that do not obviously belong together:

| | |
|---|---|
| `src/` | the board builder — TypeScript, Vite, runs in a browser |
| `firmware/` | the talker — C++, Arduino, ESP32-S3 |
| `case/` | the enclosure — OpenSCAD, plus an STL checker |
| `docs/`, `exchange/` | the prose, and the app exchange format |

Three toolchains, three languages, and a CI job that installs Node, Python and
a C++ compiler to check one commit. Split cleanly, this is three repositories
with three small CI configurations and three sets of release tags — and every
instinct about repository hygiene says to do exactly that.

## Decision

**They stay in one repository.**

This is not "not yet". It is a decision with a stated condition for revisiting,
below.

## Why

**The formats have two implementations that must agree, and only one repository
can hold them against each other.** `layout.bin`, the cable protocol, the
pairing codes and the panel's text each exist twice: once in TypeScript, where
the browser writes them, and once in C++, where the device reads them.
`tests/run.py` is what is left of the suite that no JavaScript runner can do —
it compiles `firmware/vorlaut/*.h` through `tests/layout_dump.cpp`,
`tests/cable_dump.cpp` and `tests/texts_dump.cpp`, and replays the browser's
actual bytes into the firmware's actual reader.

Split the repositories and that check has to cross a version boundary. It
becomes: pin a firmware commit in the builder's CI, or publish the headers as an
artefact, or copy them and let the copy drift. Every one of those answers is
worse than the current one, which is "the compiler reads the file that is
sitting right there."

**The failure it prevents is expensive in a way test failures usually are not.**
A format mismatch does not show up as a red build; it shows up as a device that
stays silent, in a house, with a child in front of it, after somebody sat down
with a soldering iron. `ci-firmware.yml` compiles the five bring-up test
sketches for the same reason — they share `pins.h` with the real firmware, and
whoever does not compile them notices a broken `pins.h` only at the bench.

**One commit is one change.** A protocol change today touches the writer, the
reader, the frozen reference and the document that describes it, and lands as a
single reviewable commit that is either right or wrong as a unit. Across three
repositories it is three commits, an ordering problem, and a window in which
`main` of one repository does not work with `main` of another.

**Nobody is coordinating across these boundaries.** The argument for splitting is
mostly about independent teams shipping on independent cadences. There is one
maintainer. The costs a monorepo is meant to solve — merge contention, CI queue
times, unclear ownership — are all zero here, while the costs of splitting are
paid immediately.

**CI already pays only for what changed.** `ci-firmware.yml` runs on
`firmware/**` alone, because installing the ESP32 core takes close to a minute
and a documentation change should not pay for it. `ci-tests.yml` has its own
path list. The "one repository means everything runs for everything" objection
was answered with `paths:` filters rather than with a split.

**The shared code that *is* genuinely shared already left.** Four packages —
`design`, `bildquelle`, `sicherung`, `stimmquelle` — are separate repositories
pinned by release tag, because they are used by more than one product. That is
the actual criterion, and firmware and builder do not meet it: they are used by
each other and by nothing else.

## Consequences

- CI installs three toolchains for one repository, and a contributor needs Node,
  Python and `g++` to run the full suite locally. `tests/run.py` skips rather
  than fails where `g++` is missing, and both workflows then run
  `g++ --version` separately so that a runner image which quietly dropped it
  cannot leave the job green with nothing compiled.
- Tags are shared. `v*` currently means a firmware release
  (`.github/workflows/release.yml` builds the image and writes the notes), which
  is a real constraint on any other release scheme this repository might want:
  a second releasable thing here needs its own tag prefix rather than its own
  meaning for `v*`.
- The repository is larger than any one of its parts, and a newcomer reading it
  meets three languages. `README.md` and `docs/` carry more of the orientation
  load than they would in three smaller repositories.
- `git log` mixes hardware and software history. This is mostly a feature — the
  commit that changed the format is next to the commit that changed the reader —
  and occasionally an annoyance when looking for one of them alone.

## When to revisit — and what counts as evidence

This should be revisited when there is **evidence**, and evidence means a
measurement or an event, not an intuition about tidiness. Any one of these
would do it:

1. **The cross-implementation tests stop being the reason.** If `layout.bin` and
   the cable protocol are ever frozen for good, or the firmware stops being the
   only other implementation, the load-bearing argument above is gone and the
   split becomes cheap.
2. **A second consumer appears for one half.** If another device reads
   `layout.bin`, or another builder writes it, the firmware's format handling
   has met the same criterion the four shared packages met and should leave the
   same way — as a pinned package, not as a copy.
3. **CI time becomes a real cost**, measured: a median wall-clock that actually
   slows the work down, on jobs the `paths:` filters could not already have
   avoided.
4. **A second maintainer arrives** and the shared history genuinely gets in the
   way — merge contention or review scope, observed, not predicted.

Absent one of those, "this repository has three languages in it" is not a reason
to split it. It is a description of the problem.

## Examined

**2026-08-26 — condition 1, not met.** `layout.bin` and the cable protocol are
not frozen for good: `src/data/layout_format.ts` had a breaking change the day
before, which permanently invalidated one of the seventeen frozen cases, and
`cable_format.h`'s own comment names a pending change to *both halves* of the
protocol. Condition 2 is untouched — the Android viewer consumes the package
format, not the device format, and nothing else reads `layout.bin`. The
measurement is in [`docs/device-interface.md`](../docs/device-interface.md).
This decision stands unchanged.

Two corrections to the Context paragraph above, from that examination. **The
pairing codes no longer exist**: `pair_format.h` and everything around it went
with the radio on 2026-08-23, so one of the four formats named as "existing
twice" has no second implementation because it has no first one. And the list
was short in the other direction — the tile payload, the audio payload and the
name rule exist twice as well, and nothing held any of them together.

That last part was acted on rather than only noted.
[ADR 0009](0009-device-interface-fixtures.md) records the fixture set that
closes it, in a directory belonging to neither half. It is not a split and not
preparation for one; it is the expensive part of a split, which turned out to be
worth paying for on its own.
