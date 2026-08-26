# The device interface — conformance fixtures

What passes between the builder in [`src/`](../src/) and the firmware in
[`firmware/`](../firmware/): `layout.bin`, the cable protocol, the tile and
audio payloads, the name rule and the language enumeration.

| | |
|---|---|
| [`fixtures/index.json`](fixtures/index.json) | The authoritative list. Everything else is reached from it. |
| [`fixtures/`](fixtures/) | The artefacts, each with an `.expected.json`. |
| [`fixtures/source/`](fixtures/source/) | German fixture content, kept out of the generator. |
| [`tools/make_fixtures.mjs`](tools/make_fixtures.mjs) | Regenerates `fixtures/`. Pure node. |
| [`../docs/device-interface.md`](../docs/device-interface.md) | Why this exists, and why nothing was split to build it. |

**There is no specification document here, and that is on purpose.** The format
changed twice in the week this was written — the set colour went and the
version byte moved with it — and prose written against a moving format is wrong
within the week while fixtures are not. Prose follows once there is something
stable to describe. Until then the fixtures are the specification, and where
one of them and a comment in a header disagree, **the fixture wins**.

---

## Who owns this

Not `src/`, and not `firmware/`. `device/` sits beside both and belongs to
neither, which is the one thing this directory does differently from
[`exchange/`](../exchange/).

The mechanism there carries over unchanged and is the right shape: a tag prefix
of its own, consumers pinning the tag rather than a branch, **no test runner
beside the fixtures** because a runner living here would only ever be exercised
by a mock, and the fixture normative where it and the prose disagree.

The ownership does not carry over. `exchange/`'s answer is that the fixtures
live with the **writer** and the reader pins them, and that works there because
one party can always be made to move: the Android viewer gets an update. Here
neither party can. A talker on a shelf in a house nobody in this repository
knows about is not going to be updated, and a specification the writer owns and
the reader merely pins puts the authority on the side with nothing at stake.

So both halves are held against a third thing that is neither of them. If the
firmware ever does leave — [`adr/0006`](../adr/0006-builder-and-hardware-one-repo.md)
says not yet, and
[`docs/device-interface.md`](../docs/device-interface.md#what-the-evidence-actually-says)
measures why — `device/` is what becomes the third repository, and both halves
pin it. It does not go with either.

### The tag

`device-v*` is **reserved and not cut.** The same bar `exchange-v*` is being
held to: no tag until the fixtures have run against both implementations *and*
a mutation run says they bite. Pin a commit SHA in the meantime.

`device/` is in `exclude-paths` in
[`release-please-config.json`](../release-please-config.json) beside `firmware`,
`case` and `exchange`, so a commit here does not mint a version of the builder.
Paths decide that, not scopes.

The version in `index.json` is not `LAYOUT_VERSION` and not `CABLE_VERSION`.
Those are a byte in a file and a number on a wire, both currently 1 and 2
respectively; this is `MAJOR.MINOR.PATCH` over the whole interface, and the
three of them will drift apart on purpose.

---

## Running them

Both ends, and they never meet:

```bash
npx vitest run tests/unit/device_fixtures.test.ts
```

```bash
python3 tests/test_device_host.py
```

The first is the builder's half: `renderLayoutBin()` must write these bytes,
`TILE_SIZE` must be this number, `hashBytes()` must read this hash out of this
name, and the cable client must write these host lines when it is given these
device lines. It needs node and nothing else.

The second is the firmware's half: `parseLayout()`, `seekToWavData()`,
`tileReadRow()`, `hashPath()`, `cableNameOk()` and `setLanguage()`, compiled
from the headers the sketch includes and run against the same index from the
other side. It needs a C++ compiler and nothing else.

Neither reads the other. That is the whole point — the two could be in two
repositories, or in two hands, and still be held to one thing.

The mutation run is the acceptance test for all of it:

```bash
python3 tools/devicemutate.py
```

### What this does not replace

[`tests/test_layout_frozen.py`](../tests/test_layout_frozen.py) and
[`tests/test_cable_format.py`](../tests/test_cable_format.py) hold the two
implementations against **each other**, live, on the same run — the browser's
bytes go straight into the compiled C reader. That is a stronger statement than
either end can make against a fixture, and it is still here. These fixtures are
a third check beside those two, not a replacement for either. They would become
the replacement only if the two halves ever stopped sharing a repository, and
[`docs/device-interface.md`](../docs/device-interface.md#recommendation) says
not to do that.

---

## The two extension rules, which are opposites

One artefact, two subformats, and they extend in opposite directions. Saying so
plainly is worth more than one rule that fits neither.

**`layout.bin` cannot ignore what it does not understand.** `parseLayout` reads
fixed strides; there is no room for an unknown field and no way to skip one.
The only forward compatibility this format has ever had is byte 7 of the
header: it was reserved, written as zero, and zero was later made to mean
English, so a file from before the language existed stays readable. That is a
stated rule here (`fixtures/language.expected.json`, and
`fixtures/layout/language-past-the-table`), not an accident recorded in a
comment. A version byte the reader does not know is refused outright —
`fixtures/layout/version-three`.

**The cable does the reverse.** Unknown keywords are skipped in both
directions, on purpose, so a browser can gain a field without a device in a
drawer falling over — `fixtures/cable/skip-unknown-keyword`. An unknown *verb*
is the exception and is answered with an error rather than ignored, because a
browser waiting for a reply that never comes looks exactly like a broken cable
— `fixtures/cable/unknown-verb`.

---

## What the fixtures cover

| | |
|---|---|
| `layout/` | Every field, every stride, and **every one of the five refusal codes**. |
| `tile/` | 128 by 128 RGB565 big-endian, and what a reader does with a file of the wrong length. |
| `audio/` | 16 kHz mono 16-bit, chunk walking with its pad byte, and four refusals. |
| `cable/` | Whole transcripts, both extension rules, and every error word. |
| `names.expected.json` | Which names a builder emits, which the device stores, and that the first is inside the second. |
| `language.expected.json` | Byte 7's table, its default, and what an index past it means. |

The refusals are the point. `tests/reference/layout.lock.json` has seventeen
frozen cases and **not one of them is refused**, because every one of them is
something a correct-looking writer produced — a capture can only contain what
its writer emits. All five refusal branches were authored here in an afternoon.

## What they do not cover

Said plainly, in the spirit of
[`../docs/frozen-references.md`](../docs/frozen-references.md), because a
fixture set that overstates itself is worse than a small one.

1. **No device has run these.** The firmware side is the headers compiled on a
   computer, not a board. Everything in `cable.h` — the `.part` file, the
   timeouts, the drain back into line mode — is out of reach here, and so is
   `drawTile()`'s other half, which needs a display.
2. **Nothing here reaches timing**, and timing is the class of fault this
   project has actually had: a 256-byte serial receive buffer losing bytes
   while the loop sat in a flash write ([`bring-up.md`](../docs/bring-up.md),
   stage 6). No fixture set touches that, and one that implied otherwise would
   be doing harm.
3. **The tile fixtures are not pictures.** They are addresses and flat
   colours, which say which way round a file is and nothing about whether a
   symbol renders. That is `tests/reference/tiles.lock.json`'s business, and
   that lock never crossed this boundary.
4. **The audio fixtures are not speech.** Ramps. They exercise the container
   and the chunk walk; whether a voice sounds right is not a question a fixture
   can answer.
5. **The browser's WAV writer is not held to these bytes**, only to the three
   numbers it asks the recording chain for. Nothing in `src/` writes a RIFF
   header — the vendored `stimmquelle` does — so a fixture cannot ask this
   repository to produce one.
6. **`stereo-44k` records a divergence rather than blessing it.** The device
   accepts a 44.1 kHz stereo file because it never reads the fmt chunk, and
   then plays it at 16 kHz mono. The fixture states that a writer must not
   emit one and that the reader as it stands does not check. Whether it should
   is a change to the firmware and a decision this directory does not make.
7. **Nothing here checks that a builder emits only conforming names.** The
   name rule says 32 lower-case hex digits; `hashBytes()` accepts upper case
   and accepts fewer than 32, filling the rest with zeroes. Both are recorded
   in `names.expected.json` as cases a builder must not emit, and neither end
   enforces it today.

---

## Regenerating

```bash
node device/tools/make_fixtures.mjs
```

Needs nothing but node — no npm install. It is byte-reproducible: running it on
any machine produces exactly the files that are committed.

Two properties worth preserving, and both are the reason these are fixtures
rather than a lock file:

The generator writes each artefact and its `.expected.json` **from one
literal**. Splitting them would let an expectation drift from the thing it
describes, and a drifted expectation passes whatever an implementation does.

The generator **imports nothing from `src/`, `tools/` or `firmware/`, and never
reads its own output back**. The bytes are laid out by hand from the field
values, not by calling `renderLayoutBin()` with different arguments. A fixture
derived from a writer is a capture of that writer; a generator that parsed its
own output would be comparing a thing against itself. Both are the failure
[`../docs/frozen-references.md`](../docs/frozen-references.md) exists to record.

### German fixture content

Set names are German, because real ones are and because a rule about cutting
UTF-8 after the 32nd *byte* has to be exercised on text that actually ships
rather than on an ASCII stand-in.

The strings live in [`fixtures/source/names.de.json`](fixtures/source/names.de.json)
and the generator refers to them by key, so `make_fixtures.mjs` itself stays
English like the rest of the code — the same arrangement `exchange/` has, for
the same reason.
