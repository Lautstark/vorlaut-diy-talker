# ADR 0009 — The device interface has fixtures of its own, owned by neither half

**Status:** accepted · **Date:** 2026-08-26 · **Applies to:** `device/`,
`src/data/`, `firmware/vorlaut/`, and the `device-v*` tag prefix

## Context

The Android app could leave this repository because its interface is a
**document**: [`exchange/SPEC.md`](../exchange/SPEC.md) is versioned, has
conformance fixtures, and forbids copying them. Two programs implement a
written specification and neither one is the specification.

The firmware's interface was a **compiler**.
[`tests/test_layout_frozen.py`](../tests/test_layout_frozen.py) builds a C
program against [`layout_format.h`](../firmware/vorlaut/layout_format.h) — the
header the sketch includes — and replays the browser's bytes into the same
`parseLayout` the device calls. There was no document. The header was the
specification, and it could only play that part while a test could `#include`
it.

Three things could not even be that.
[`docs/device-interface.md`](../docs/device-interface.md) measured the gaps on
2026-08-26 and found four:

- **The tile payload.** Two constants for one number — `TILE_SIZE` in
  `tiles.ts` and `TILE_W` in `vorlaut.ino` — and nothing comparing them,
  because a `#define` in a sketch is one no test can include. No length rule
  either: `drawTile()` zero-fills a short read line by line, so a truncated
  tile draws partly black and the device says nothing.
- **The audio payload.** What the device accepted was whatever
  `seekToWavData()` walked past, in the same uninclusible file, and nothing on
  the browser side was held to it.
- **The name rule.** Stated three times — `hashBytes()`, `hashPath()` and
  `cableNameOk()` — where the third has to be a superset of the first two or a
  file silently never arrives. Nothing said so.
- **The language enumeration.** `tests/test_texts.py` read `LANGUAGE_CODES` out
  of another module's source with a regular expression.

And the frozen references cannot close any of them.
`tests/reference/layout.lock.json` holds seventeen cases and **refuses none**,
because every one is something a correct-looking writer produced. A lock file
is a capture of an implementation's output; it can only ever contain what its
writer emits, so no amount of freezing reaches `parseLayout`'s five refusal
branches.

## Decision

**A top-level `device/` directory holds conformance fixtures for the device
interface, owned by neither `src/` nor `firmware/`, and both halves are held
against it.**

- `device/fixtures/index.json` is the authoritative list. Every fixture is an
  artefact plus an `.expected.json`, and `device/tools/make_fixtures.mjs`
  writes both **from one literal**, imports nothing from `src/`, `tools/` or
  `firmware/`, and never reads its own output back.
- Two runners, and they never meet.
  [`tests/unit/device_fixtures.test.ts`](../tests/unit/device_fixtures.test.ts)
  is the builder's half and needs node;
  [`tests/test_device_host.py`](../tests/test_device_host.py) compiles the
  firmware's own readers on the host and needs a compiler. Each meets the
  fixture and never the other end.
- The constants and readers a test could not reach move into headers of their
  own — `tile_format.h`, `wav_format.h`, `name_format.h` — with the same
  no-Arduino rule `layout_format.h` has. `seekToWavData()` and `tileReadRow()`
  are templates so the device can read from a `File` and a test from a buffer,
  with one body between them.
- **`device-v*` is a fourth tag prefix**, reserved and uncut. `device/` joins
  `exclude-paths` in `release-please-config.json` so a commit here does not
  mint a version of the builder.
- The specification's version is not `LAYOUT_VERSION` and not `CABLE_VERSION`.
  Those are a byte in a file and a number on a wire; this is
  `MAJOR.MINOR.PATCH` over the whole interface, and the three drift apart on
  purpose. **MAJOR** is when a device already flashed would *misread* a payload
  a conforming builder writes — not "would reject", because rejecting is safe
  and legible.
- **No prose specification yet.** The fixtures are the specification and win
  wherever they and a comment disagree. Prose follows once the format holds
  still.

## Why

**The expensive half of a repository split is also what was missing inside one
repository.** [ADR 0006](0006-builder-and-hardware-one-repo.md) is unchanged
and its condition 1 is not met — `layout_format.ts` had a breaking change the
day before this was written, and `cable_format.h` names a pending change to
both halves of the protocol. None of the four gaps above is about having two
repositories, and none can be closed by freezing. So the fixtures are worth
writing whether or not anything ever splits, and if it does, the expensive part
is already paid for.

**Authoring reaches what capturing cannot.** Every refusal code, a file one
byte short of its own header, a reserved byte written non-zero, a name filling
all 32 bytes with a character split at the boundary — a capture of a correct
writer contains none of these, and all of them were written in an afternoon.
That is the difference between a lock file and a conformance fixture, and it is
the whole reason this is not more freezing.

**The ownership cannot be `exchange/`'s, although the mechanism is.** A tag
prefix, a pinned consumer, no test runner beside the fixtures, the fixture
normative — all of that carries over. But `exchange/`'s answer is that the
fixtures live with the *writer* and the reader pins them, and that works there
because one party can always be made to move: the Android viewer gets an
update. **Here neither party can.** A talker on a shelf, in a house nobody in
this repository knows about, is fixed by a person with a cable or not at all.
A specification the writer owns and the reader merely pins puts the authority
on the side with nothing at stake.

**The two subformats extend in opposite directions, and saying so plainly is
worth more than one rule that fits neither.** `layout.bin` cannot skip what it
does not understand — `parseLayout` reads fixed strides — so byte 7 of the
header is its only forward compatibility, and that is now a stated rule rather
than a happy accident in a comment. The cable does the reverse: unknown
keywords are skipped in both directions on purpose, and only an unknown *verb*
is refused, because a browser waiting for a reply that never comes looks
exactly like a broken cable.

**The mutation run is the acceptance test, not a nicety.** A fixture set that
catches nothing looks exactly like one that catches everything. `device-v*`
stays uncut until `tools/devicemutate.py` says the fixtures bite, the same bar
`exchange-v*` is being held to. Its first run found four holes and one fault no
fixture at this boundary can reach — including a runner whose import escaped
the repository root, so every cable check on the browser side had been passing
against a stale copy of the client.

**What it costs to get this wrong is not a red build.** It is a device that
stays silent in a house with a child in front of it, after somebody sat down
with a soldering iron — and silence is the *good* outcome. The dangerous
mistakes are the ones that parse: a hash read at the wrong offset speaks a
different sentence, and a key that says the wrong thing is worse than one that
says nothing, because it is said to somebody who believes it.

## Consequences

- **A fourth top-level directory, and a fourth tag prefix.** `device/` belongs
  to neither half of the repository, which is exactly what makes it look like
  something to tidy into `src/` or `firmware/`. Doing that would give the
  format back to one of the two implementations.
- **`ci-firmware.yml` grows a host job it did not have.** That workflow had only
  ever compiled *for* the target; it now compiles for the host as well. A new
  capability rather than a detail, and the honest cost of the move.
- **A change under `device/` now pays for the ESP32 core**, because that
  workflow's path filter grew. Deliberate: a change to what the device is
  required to accept should compile the thing that has to accept it.
- **`g++` did not leave `ci-tests.yml`**, although
  `docs/device-interface.md` §5 expects it to. That section describes CI after a
  split, where the firmware side is a different repository with a path filter of
  its own. Inside one repository the same move would stop the format checks
  running on a change to `loader/src/layout_format.ts` — which is the change that
  broke a format most recently — or make every `src/` change pay for the ESP32
  toolchain. The reason is in a comment in that workflow.
- **The live checks stay.** `test_layout_frozen.py` and `test_cable_format.py`
  hold the two implementations against *each other* on the same run, which is a
  stronger statement than either end can make against a fixture. These fixtures
  are a third check beside them. They become the replacement only if the halves
  ever stop sharing a repository, and 0006 says not yet.
- **Four firmware functions moved out of `vorlaut.ino`** to become includable.
  The bodies are unchanged, because a rewritten reader would be a second
  implementation of the rule rather than the rule itself. One behaviour-neutral
  edit: `hashPath()` bounds its `sprintf`, which a host toolchain refuses
  outright.
- **The fixtures cannot reach timing**, and timing is the class of fault this
  project has actually had — a 256-byte serial receive buffer losing bytes while
  the loop sat in a flash write. No fixture set touches that, and
  `device/README.md` says so rather than implying otherwise.
- **`stereo-44k` records a divergence without blessing it.** The device accepts
  a 44.1 kHz stereo file because it never reads the fmt chunk, and then plays it
  at 16 kHz mono. The fixture says a writer must not emit one and that the
  reader does not check. Whether it should is a firmware change this ADR does
  not make.

## What the cleanup will look like

Somebody will propose folding `device/fixtures/` into `tests/reference/`,
because both hold committed bytes that tests read, and one directory is tidier
than two. They are not the same thing. `tests/reference/` holds **captures** —
an implementation's output, frozen, invalidated by the change it was capturing;
`docs/frozen-references.md` governs them and says why they must not be
regenerated to make a test pass. `device/fixtures/` holds **assertions authored
from the rule**, before the run that would produce them, and the refusals in it
are cases no implementation here will ever emit. Merging them would put the
fixtures under a document that forbids the one thing they are for, and would
quietly hand the format back to whichever half the directory sat closest to.

The second proposal will be to write the specification document now that the
fixtures exist. That is right eventually and premature until the format holds
still for longer than a week; `docs/device-interface.md` recommendation 3 has
the argument, and §8 of that same document is a section that had to be rewritten
while it was being written.
