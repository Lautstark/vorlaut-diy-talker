# Conformance fixtures for the two formats between a Sammlung and a talker

**The device interface**: what passes between the builder in
[`src/`](https://github.com/Lautstark/vorlaut-editor/tree/main/src/) and the firmware in [`firmware/`](../firmware/) —
`layout.bin`, the cable protocol, the tile and audio payloads, the name rule
and the language enumeration.

**The device package**: the `.obz` the editor writes and
[`loader/`](../loader/README.md) reads, one step upstream, where neither end is
the device and both are browsers. Added on 2026-08-27 by
[`adr/0014`](../adr/0014-device-fixtures-cover-the-package-too.md), which is
where the widening is argued — the short version is that a reader which
misunderstands a package does not fail on the page, it compiles confidently and
hands a talker bytes.

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
[`exchange/`](https://github.com/Lautstark/vorlaut-editor/tree/main/exchange/).

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

So both halves are held against a third thing that is neither of them.

**The firmware is not going anywhere, and this directory is not either.**
[`adr/0012`](../adr/0012-the-repository-splits-editor-leaves.md) decided the
split of this repository on 2026-08-27, and the half that leaves is the
**editor**. Both implementations of every device format stay here — the C++
reader in [`../firmware/`](../firmware/) and the TypeScript writer in
[`../loader/`](../loader/README.md) — so `device/` stays beside both of them,
owned by neither and pinned by nobody, exactly as it is today. Belonging to
neither half is a statement about a directory, not about a repository.

### The tag

`device-v*` is **reserved and not cut.** The same bar `exchange-v*` is being
held to: no tag until the fixtures have run against both implementations *and*
a mutation run says they bite. Pin a commit SHA in the meantime.

A commit here mints no version of anything. It used to need arranging —
`device/` sat in `exclude-paths` in `release-please-config.json`, so that a
change to the specification did not release the builder — and that file went
with the release train
([ADR 0016](../adr/0016-the-browser-half-stops-being-released.md)). `device-v*`
is cut by hand, when the bar above is met.

The version in `index.json` is not `LAYOUT_VERSION` and not `CABLE_VERSION`.
Those are a byte in a file and a number on a wire, currently 3 and 2; this is
`MAJOR.MINOR.PATCH` over the whole interface, and the three of them drift apart
on purpose.

It reads **`2.1.0`**, and it carries no word about status. It said
`0.1.0-draft` until 2026-08-27, which put a claim about the interface inside a
number nothing asserted — both runners printed the string and neither checked
it, so a `device-v1` cut over it would have contradicted the thing it tagged.
**Whether this interface is ratified is what the tag says, not what the string
says**, and the tag is the line above: reserved and not cut. `exchange/` splits
it the same way, with a plain `1.2.0` in its index and "draft, not ratified" in
a sentence of `SPEC.md`; the reason the word ended up in the number here is
that this directory has no prose to put it in, deliberately.
[`tests/test_device_fixtures.py`](../tests/test_device_fixtures.py) refuses a
pre-release suffix, and refuses `index.json` and `make_fixtures.mjs`
disagreeing — the second by regenerating rather than by reading the number out
of the generator's source, which is the shape ADR 0009 removed from
`test_texts.py`.

The MINOR went up the same day the `-draft` came off, and in that order. `1.0.0`
described a directory that was silent about the device package; `1.1.0`
describes one that is not. It is not a MAJOR because MAJOR is *a flashed device
misreading a payload a conforming builder writes*, and nothing the talker reads
moved — not a stride, not a byte, not a keyword.

`1.2.0` is 2026-08-28, and it is the first MINOR that adds something to the
wire rather than to this directory: the greeting gained a `firmware` keyword,
which names the build a device is carrying as opposed to the protocol it
speaks. MINOR by the same rule read the other way round — a device already
flashed neither misreads the addition nor ever sees it, because both ends skip
what they do not know, and a device that says nothing there is a conformant
older one rather than a broken one.

`1.3.0` is 2026-08-30: a tile may travel compressed, and a browser sends the
compressed form only to a device that named it in its greeting
([ADR 0019](../adr/0019-tiles-travel-compressed.md)). MINOR for the same reason
again — silence means raw, so a device flashed before it neither misreads a
tile nor is sent one it cannot read.

`2.0.0` is 2026-08-31, and it is the first MAJOR
([ADR 0020](../adr/0020-every-key-says-what-it-does.md)). `layout.bin` went to
version 3: every key of a set says what it does and where it goes, the set key
became a key like the other four, and the reader has room for 64 sets rather
than 5.

**Read the MAJOR rule carefully here, because this change does not literally
meet it and is still a MAJOR.** The rule is *a flashed device misreading a
payload a conforming builder writes* — and no device misreads anything: the
version byte moved with the strides, so a talker flashed before today refuses a
version-3 file and a talker flashed after refuses a version-2 one, both with
`LAYOUT_BAD_VERSION` and both silently. The rule is written about misreading
because misreading is the outcome worth spending a MAJOR to avoid; it is not a
licence to call a mutual refusal a MINOR. Two builders neither of which can
write a file the other's device reads is what a MAJOR means, and what the
version byte bought is that the break is legible rather than a set of names and
hashes read at the wrong pitch.

`2.1.0` is later the same day, and it is what `2.0.0` left out. The bytes of
version 3 arrived with nothing anywhere saying what a device *does* with them:
`layout/` stated `does` and `target` key by key, `layoutKeyGoesTo()` said what
they mean, and no fixture walked a talker from one set to the next. There is a
kind for that now — `press`, which is the hold times, the second between a word
and the next board, the stretch of deafness after it, and the order those
happen in — and the layout fixtures carry walks: a list of presses and the
board each one leaves the device on.
[`layout/four-rounds`](fixtures/layout/four-rounds.expected.json) is a whole
small game, four rounds that lead into one another and back to the first.

MINOR by the plainest reading of the rule: nothing the talker reads moved — not
a stride, not a byte, not a keyword. This directory described an interface it
was silent about half of, and now it is not, which is the same shape as
`1.1.0`. `press` is also the first kind with **no browser half at all**, and
`tests/unit/device_fixtures.test.ts` says so out loud rather than leaving it
unlisted: no byte of a hold time crosses, so there is nothing on that side to
hold to it.

---

## Running them

Four ends in two pairs, and no runner meets another:

```bash
npx vitest run tests/unit/device_fixtures.test.ts
```

```bash
python3 tests/test_device_host.py
```

```bash
npx vitest run tests/unit/device_package_writer.test.ts
```

```bash
npx vitest run tests/unit/device_package_reader.test.ts
```

`cable` mode takes the window from the fixture rather than from `CABLE_WINDOW`,
which is why a transcript may announce 256 where the firmware announces 4096
and both are conformant. A harness that read the header would have followed it
wherever it went, and could never have held a browser to reading a number
instead of assuming one.

The first is the builder's half: `renderLayoutBin()` must write these bytes,
`TILE_SIZE` must be this number, `hashBytes()` must read this hash out of this
name, and the cable client must write these host lines when it is given these
device lines. It needs node and nothing else.

The second is the firmware's half: `parseLayout()`, `seekToWavData()`,
`tileReadRow()`, `hashPath()`, `cableNameOk()` and `setLanguage()`, compiled
from the headers the sketch includes and run against the same index from the
other side. It needs a C++ compiler and nothing else.

The third and fourth are the device package's two halves, and they are both
node because both ends of that format are browsers. The writer is given the
Sammlung a fixture states, with the pictures and the recordings taken out of
the fixture's own archive, and must produce the manifest and the board
documents the fixture holds. The reader is given the archive and must come back
with the fixture's answers, or refuse it at the step the fixture names.

None of the four reads another. That is the whole point — they could be in two
repositories, or in four hands, and still be held to one thing. Each of the two
package runners ends with a check that it has not imported the other half,
because that is the one edit that would quietly turn the pair back into a round
trip that agrees with itself.

Between the two families there is one step neither of them watches, and
[`tests/unit/device_compile.test.ts`](../tests/unit/device_compile.test.ts) is
it: a committed package out of `fixtures/package/`, compiled the whole way into
what a talker reads. It imports no writer.

The mutation run is the acceptance test for all of it:

```bash
python3 tools/devicemutate.py
```

Four ends now, and every fault goes to all four rather than to the two of its
own boundary. That is deliberate: `src/data/device_package.ts` takes
`SLOTS_PER_SET` and `HASH_BYTES` out of `loader/src/layout_format.ts`, so the
two boundaries are not disjoint and a run that only asked the near pair would
never see it.

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
drawer falling over — `fixtures/cable/skip-unknown-keyword`, and, since
2026-08-28, a keyword that was really added rather than imagined:
`fixtures/cable/firmware-named-in-the-hello` is the device end doing it, with
the eight transcripts beside it standing for every talker flashed before the
word existed. An unknown *verb*
is the exception and is answered with an error rather than ignored, because a
browser waiting for a reply that never comes looks exactly like a broken cable
— `fixtures/cable/unknown-verb`.

---

## What the fixtures cover

| | |
|---|---|
| `layout/` | Every field, every stride, and **every one of the five refusal codes**. |
| `tile/` | 128 by 128 RGB565 big-endian, both forms a tile may be in, and what a reader does with a file of the wrong length. |
| `audio/` | 16 kHz mono 16-bit, chunk walking with its pad byte, and four refusals. |
| `cable/` | Whole transcripts, both extension rules, every error word, the window a file crosses in, a protocol-version mismatch in each direction, and a device that names its build beside eight that do not. |
| `names.expected.json` | Which names a builder emits, which the device stores, and that the first is inside the second. |
| `language.expected.json` | Byte 7's table, its default, and what an index past it means. |
| `sleep.expected.json` | The timeout range a builder may write, what the device waits for everything else, and that the first is inside the second. |
| `package/` | The other boundary: whole `.obz` archives, what a reader must make of each, and **eleven refusals**, aimed at the packages that parse. |

`package/` carries two more of its own: a `locale` outside the table, which
both halves take and which reaches the device as English, and the sleep timeout
on a board that is not the root, which is dropped without a word. Both are
`audio/stereo-44k`'s shape — the fixture states that a writer must not emit one
and that the reader as it stands does not check.

The refusals are the point. `tests/reference/layout.lock.json` has seventeen
frozen cases and **not one of them is refused**, because every one of them is
something a correct-looking writer produced — a capture can only contain what
its writer emits. All five refusal branches were authored here in an afternoon.

There is a second thing a capture cannot do, and the sleep timeout is where it
showed. That lock *records* what the firmware's reader makes of a timeout of
zero and one of `0xffffffff` — and compares neither, because both cases are
kind `bytes` and only the nine kind `fields` cases are checked line by line. So
a reader that quietly started clamping in `parseLayout` would leave the lock
describing an answer it no longer gives, with nothing red anywhere and no
oracle left to re-derive the truth. `layout/*.expected.json` carries
`sleep_seconds` and `idle_seconds` as two separate fields for exactly that
reason: the field as it stands, and the length of time it means.

## What they do not cover

Said plainly, in the spirit of
[`../docs/frozen-references.md`](../docs/frozen-references.md), because a
fixture set that overstates itself is worse than a small one.

1. **No device has run these.** The firmware side is the headers compiled on a
   computer, not a board. Everything in `cable.h` — the `.part` file, the
   timeouts, the drain back into line mode — is out of reach here, and so is
   `drawTile()`'s other half, which needs a display.
2. **Nothing here reaches a clock**, and timing is the class of fault this
   project has actually had: a 256-byte serial receive buffer losing bytes
   while the loop sat in a flash write ([`bring-up.md`](../docs/bring-up.md),
   stage 6). No fixture set touches that, and one that implied otherwise would
   be doing harm.

   What has changed is that the fault class is no longer *only* a matter of
   timing. The device announces a window and acknowledges each one before the
   browser sends the next, and that is an **order**, which a transcript can
   state exactly — `cable/several-windows` does, with a window of its own so
   that a browser using a size it chose for itself fails there and passes
   everywhere else. The runner refuses a client that has written more than it
   was asked for at the moment the device speaks, which is the only way the
   waiting is visible: the bytes of a file are the same bytes whether they went
   a window at a time or all at once.

   So the shape of the flow control is covered here and the clock still is not.
   Whether a real flash write is what the browser waits out between two windows
   is a bench number, and it lives in
   [`cable.md`](../docs/cable.md#the-four-seconds-and-what-they-are-now-for).
3. **The tile fixtures are not pictures.** They are addresses and flat
   colours, which say which way round a file is and nothing about whether a
   symbol renders. That is `tests/reference/tiles.lock.json`'s business, and
   that lock never crossed this boundary.

   The compressed ones are hand-laid opcodes for the same reason and it counts
   for more there: an encoder's output is a statement about that encoder, and
   what a conformance fixture has to state is the format. Whether a real
   picture survives being compressed is a different question with a different
   oracle — `tests/test_tile_compression.py` puts the browser's encoder and the
   firmware's decoder on either side of the fourteen frozen tiles, and neither
   of them is compared against itself.
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
7. **Nothing at the device interface checks that a builder emits only
   conforming names.** The name rule says 32 lower-case hex digits;
   `hashBytes()` accepts upper case and accepts fewer than 32, filling the rest
   with zeroes. Both are recorded in `names.expected.json` as cases a builder
   must not emit, and neither end of *that* boundary enforces it. The boundary
   above it does — `package/sound-named-for-nothing` is a recording under
   sixteen hex digits, refused by both halves — so the rule is kept one step
   before the device rather than nowhere.
8. **The package fixtures say nothing about the archive's compression.** They
   are stored, because a directory that regenerates byte for byte cannot depend
   on a deflate implementation, and a conforming writer may deflate; what they
   state about the container is its framing and its member order. Anything
   about zip beyond that is `exchange/SPEC.md` §2's.
9. **They do not compile a package into tiles either.** `package/` stops at
   what a reader makes of an archive, `layout/` and `tile/` start at bytes that
   already exist, and the step between the two is watched by
   `tests/unit/device_compile.test.ts` and by nothing here. Their pictures are
   BMPs — the one picture format this directory can hold, for the same
   compressor reason — and they say which way round a file is and nothing about
   whether a symbol renders.

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

The generator **imports nothing from `src/`, `loader/`, `tools/` or
`firmware/`, and never reads its own output back**. The bytes are laid out by
hand from the field values, not by calling `renderLayoutBin()` with different
arguments — and the manifests and board documents under `package/` are laid out
the same way, not by calling `buildDevicePackage()`. A fixture
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
