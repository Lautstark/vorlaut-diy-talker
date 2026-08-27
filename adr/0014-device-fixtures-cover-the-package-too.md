# ADR 0014 — `device/fixtures/` covers the file between the two browsers as well as the bytes between the browser and the talker

**Status:** accepted · **Date:** 2026-08-27 · **Applies to:** `device/`,
`src/data/device_package.ts`, `loader/`, and the `device-v*` tag prefix

## Context

[ADR 0009](0009-device-interface-fixtures.md) built `device/fixtures/` for one
boundary and [`device/README.md`](../device/README.md) says which one in its
first sentence: *what passes between the builder in `src/` and the firmware in
`firmware/`* — `layout.bin`, the cable protocol, the tile and audio payloads,
the name rule and the language enumeration. Forty-five fixtures, twelve of them
refusals, two runners that never meet.

[ADR 0011](0011-editor-exports-the-talker-repository-sends.md) then put a
**file** between the two halves. The editor writes a device package and stops;
[`loader/`](../loader/README.md) — a page in this repository — reads it,
compiles it and sends it. That file has two implementations, in
`src/data/device_package.ts`: a writer the editor keeps and a reader that goes
with `loader/`. Nothing states its shape. Nothing in `device/fixtures/` says
what a `manifest.json` in a device package must hold.

What held the two implementations together was
`tests/unit/device_roundtrip.test.ts`, which ran `buildDevicePackage()` against
`compileDevice()` in one process.
[ADR 0012](0012-the-repository-splits-editor-leaves.md) decided the split, and
[`docs/split-crossings.md`](../docs/split-crossings.md) counted what it costs:
after the move **no repository has both halves of that round trip.** It is the
most valuable check on ADR 0011's boundary and it is the one the move deletes.

ADR 0012 settled **where** `device/fixtures/` lives — in
`vorlaut-diy-talker`, beside both device implementations, owned by neither —
and said nothing at all about **what may be added to it.** It said so
deliberately, and `split-crossings.md` records the gap in terms: widening the
directory by a `package` kind *"is a real change of meaning and it needs a line
in an ADR, not a commit message."* This is that line.

## Decision

**`device/fixtures/` holds fixtures for both formats that a Sammlung passes
through on its way to a talker, and the `package` kind is the second of them.**

The scope of the directory is no longer *the bytes between the browser and the
talker*. It is **every format in this toolchain with two implementations that
have to agree and cannot be released together** — which today is two boundaries
and one directory:

| | between | fixtures | held by |
|---|---|---|---|
| the device interface | a browser and the talker | `layout/`, `tile/`, `audio/`, `cable/`, `names`, `language`, `sleep` | `tests/unit/device_fixtures.test.ts`, `tests/test_device_host.py` |
| the device package | the editor and the loader page | `package/` | `tests/unit/device_package_writer.test.ts`, `tests/unit/device_package_reader.test.ts` |

Everything ADR 0009 decided about the first applies unchanged to the second:

- **`device/tools/make_fixtures.mjs` authors the packages from one literal**,
  imports nothing from `src/`, `loader/`, `tools/` or `firmware/`, and never
  reads its own output back. The manifest, the board documents and the archive
  framing are laid out from the field values. That is what makes the seventeen
  package fixtures possible at all: eleven of them are refusals, and no capture
  of a writer could contain one, because no writer here emits one.
- **Two runners, and they never meet.** The writer is given the Sammlung a
  fixture states and must produce the fixture's package; the reader is given
  the fixture's archive and must come back with the fixture's answers. Neither
  ever sees the other's output. Each runner ends with a check that it has not
  imported the other half — the one edit that would quietly turn this back into
  a round trip.
- **The refusals are the point**, and they aim at what is quiet on a device
  rather than at what throws: a ring that reaches two of three boards, a
  recording at 24 kHz, a recording under a name that is sixteen hex digits
  where thirty-two belong, a picture entry whose reference was dropped, a
  talker document with no pixels behind its references. Two further fixtures
  record divergences without blessing them, the way `audio/stereo-44k` does.
- **The mutation run is the acceptance test.** `tools/devicemutate.py` grows
  the two runners as ends of their own and eighteen faults in
  `src/data/device_package.ts`, and every fault is put to all four runners
  rather than to the two of its own boundary.

**`device_interface_version` goes to `1.1.0`**, and the reason is in the
Consequences.

**`device-v*` stays reserved and uncut**, and this changes nothing about what
it is waiting for.

## Why

**The line that matters was never "browser to talker".** It is
[ADR 0009](0009-device-interface-fixtures.md)'s own: *a specification the
writer owns and the reader merely pins puts the authority on the side with
nothing at stake.* The device interface was the first place in this repository
where that bit; the device package is the second, and it bites there for the
same reason and one step earlier. `split-crossings.md` says what the fault
does: **a reader that misunderstands a package does not fail on the page. It
compiles confidently and hands a talker bytes.** `device/fixtures/` catches a
malformed `layout.bin` and does not catch a well-formed one built from a
misread source, so the package sits *upstream of* the device interface and its
faults arrive at the party that cannot move.

**The authority still sits on the side that cannot be made to move, and the
direction is worth reading twice because it looks inverted.** For the device
interface, neither party could move: a talker on a shelf is fixed by a person
with a cable or not at all. For the device package both implementations are
browsers and both can be redeployed — so on ADR 0009's own test this format
could have lived with either half. It lives with neither, in the same directory,
because the *consequence* of getting it wrong is still a talker: the reader's
next act is to compile and send. The editor — the writer — is the half that
leaves and the half that pins, which is the reverse of `exchange/`'s
arrangement and the right way round for the same reason `exchange/`'s is the
wrong way round here.
[ADR 0012](0012-the-repository-splits-editor-leaves.md) already settled that
pinning is consumption and not ownership; a pinned writer acquires no authority
over what it pins, and the directory goes on belonging to no implementation.

**Duplication alone cannot carry the shapes.** `split-crossings.md` costs the
whole move name by name, and every other crossing is a number: `SLOTS_PER_SET`,
`HASH_BYTES`, `SLEEP_MAX`. Those are duplicated safely because a fixture
already states each of them. `DevicePackage`, `DeviceManifest`, `DeviceBoard`
and `DevicePlan` are **four types with a dozen fields each**, duplicated across
a repository boundary with nothing saying what a field means. That is the one
place on that page where *"if you extend this to anything else, extend the
fixtures too"* actually bites.

**Every other home is worse, and two of them are forbidden.**
[`exchange/SPEC.md`](https://github.com/Lautstark/vorlaut-editor/blob/main/exchange/SPEC.md) §1 rules the talker out **by name**,
on [ADR 0001](0001-two-ext-namespaces.md)'s grounds: the device package is a
different profile with a different extension namespace and *"this specification
does not govern it"*. `tests/reference/` is governed by
[`docs/frozen-references.md`](../docs/frozen-references.md), which forbids the
one thing these fixtures are for — they are assertions authored from the rule,
before the run that would produce them, and refusals no implementation will
ever emit. And a directory or repository of its own would add a pin, a tag and
a version boundary to buy a property this directory already has, which is
ADR 0012's answer to the same proposal about the same files.

**The widening costs no mechanism.** No fifth top-level directory, no fifth tag
prefix, no second `exclude-paths` entry, no second pin: the editor already has
to pin `device/fixtures/` for the seven layout constants, so the package
fixtures arrive on a pin that had to exist anyway.

**What this does not widen to, said before somebody tries it.** The rule above
is a *conjunction*: two implementations, that have to agree, that cannot be
released together. `exchange/`'s app package has two implementations and its own
fixtures already. `tests/reference/` holds captures of things with one
implementation. A format with one implementation belongs in neither; a format
whose two implementations ship in one release does not need a directory owned by
nobody. This is the second boundary in this toolchain that meets all three
clauses, and there is no third one waiting.

## Consequences

- **The interface version is `1.1.0`, and MINOR is the honest increment.**
  ADR 0009 makes MAJOR *"when a device already flashed would misread a payload
  a conforming builder writes"*, and nothing the talker reads moved here — not
  a stride, not a byte, not a keyword. Nor is it a PATCH: the directory now
  says something it did not say before, and a consumer pinning `1.0.0` is
  pinning a set that is silent about the package. The string is also the reason
  the ordering mattered:
  [`format-freeze.md` §8](../docs/format-freeze.md#8-sequencing-what-has-to-be-true-before-device-v1)
  item 7 dropped the `-draft` on 2026-08-27 and landed the assertion that keeps
  the two places holding it from drifting; this widened the interface that
  number describes, on the same day, afterwards. A `device-v1` cut over a
  version that no longer described the directory would be the same failure item
  7 exists to prevent, one turn later.
- **`tests/unit/device_roundtrip.test.ts` is gone, and three files stand where
  it stood.** `device_package_writer.test.ts` and
  `device_package_reader.test.ts` are the two halves against the fixtures;
  `device_compile.test.ts` is the step between the two fixture families —
  a committed package compiled the whole way into what a talker reads — and it
  imports no writer, so it travels to `vorlaut-diy-talker` whole. The name went
  with the file: nothing left in the repository runs a round trip, on purpose,
  and a file called `device_roundtrip` would have been the first place somebody
  put one back.
- **`wavFormat()` gained the only fixtures it has ever had.** It used to be
  held by a handful of WAVs written inside the round-trip test — a reader
  checked against bytes the same file wrote. It is now put to the eight
  `audio/` fixtures, four of which no writer would emit, and the two readers
  agreeing about which of the eight are RIFF/WAVE at all is a statement neither
  end could make alone.
- **The mutation run has four ends and costs about twice what it did.** Every
  fault goes to all four runners, which is deliberate rather than thorough:
  `src/data/device_package.ts` takes `SLOTS_PER_SET` and `HASH_BYTES` out of
  `loader/src/layout_format.ts`, so the two boundaries are not disjoint and a
  run that only asked the near pair would never see it.
- **`device/fixtures/package/` holds `.obz` archives, and they are stored
  rather than deflated.** That is a property of the fixtures and not of the
  format: `tests/test_device_fixtures.py` regenerates the directory byte for
  byte, and deflate output is a property of whichever zlib is installed. So
  what these fixtures state about the container is its framing and its member
  order, never its bytes — and a conforming writer may deflate, which
  `src/data/zip.ts` does.
- **The pictures in them are BMPs**, for the same reason: writing a PNG needs a
  compressor. It is not a loss — `sniffImageType()` has never heard of `BM`, so
  they arrive as `application/octet-stream`, which is the branch an unusual
  upload takes and deliberately not a refusal — and it is what lets
  `device_compile.test.ts` decode one for real.
- **What the fixtures still do not cover** grew as well as shrank, and
  `device/README.md` says so: nothing here compiles a package into tiles except
  one test with a host of its own, no fixture states what a picture should look
  like, and the archive's compression is out of scope by construction.
- **Two fixtures record a divergence without blessing it.** A `locale` outside
  `LANGUAGE_CODES` is taken by both halves and falls back to English on the
  device's own menu; the sleep timeout and the voice on a board that is not the
  root are dropped without a word. Both are `stereo-44k`'s shape: the fixture
  states that a writer must not emit one and that the reader as it stands does
  not check, and whether it should is a change this ADR does not make.

## Not to be "fixed" later

**Somebody will propose folding the `package` kind into `exchange/`**, because
a device package is an `.obz` and `exchange/` is where the `.obz` fixtures are.
It is the tidiest-looking cleanup on this page and it is forbidden by the
document it would be folded into: `exchange/SPEC.md` §1 rules the talker out by
name, and ADR 0001 is why the two extension namespaces are separate in the
first place. What somebody proposing it would have to establish is that
`ext_vorlaut_*` and `ext_lautstark_*` have become one namespace, which is
ADR 0001's question and not this one.

**Somebody will restore the round trip**, and it will look like an
improvement. The two runners each read fixtures and neither reads the other, so
comparing them directly — importing `readDevicePackage()` into the writer's
runner, or vendoring a copy of `buildDevicePackage()` into the reader's — is
one import away, and it would be green. What it would prove is that two
functions in one file agree with each other. What it would cost is the property
this whole ADR is for: after the split there is no file with both, and a check
that needs both is a check that has to be deleted on the day of the move by
somebody who does not know what it was for. `docs/split-crossings.md` names the
talker-side half of this as *the* edit that would undo hard case one's answer.
Both runners end with a check against it, and those checks are the point rather
than a formality.

**Somebody will delete `device_compile.test.ts` as redundant**, because the two
fixture families appear to meet at it and a fixture-driven check on either side
looks like it covers the ground. They do not meet. `package/` stops at what a
reader makes of an archive and `layout/` starts at bytes that already exist, and
the compile between them — which picture is drawn for which key, which keys
share a tile, whether a key holding nothing gets a blank or the grey cross — is
watched by nothing else in the repository. That gap is where the divergence of
[`docs/obz-as-device-input.md`](../docs/obz-as-device-input.md) §5 lived for as
long as it did.
