# The device interface, and whether the firmware can leave

**Status: proposal, nothing built. 2026-08-26.** Written to be argued with.

[`adr/0006`](../adr/0006-builder-and-hardware-one-repo.md) keeps the builder and
the hardware in one repository and names four conditions for revisiting. This
answers condition 1 — *"if `layout.bin` and the cable protocol are ever frozen
for good … the split becomes cheap"* — and the answer has two halves that point
in different directions:

- **Do not split.** Condition 1 is not met, and the measurement is in
  [What the evidence actually says](#what-the-evidence-actually-says).
- **Write the fixtures anyway**, because the expensive half of the split is also
  the thing this repository is missing *today*, inside one repository, with both
  implementations sitting next to each other.

The second half is the substance of this document. The first half is the last
two sections.

---

## The asymmetry the question comes from

The Android app could leave because its interface is a **document**.
[`exchange/SPEC.md`](../exchange/SPEC.md) is versioned, has conformance
fixtures, and [`exchange/README.md`](../exchange/README.md) forbids copying
them. Two programs implement a written specification and neither one is the
specification.

The firmware's interface is a **compiler**.
[`tests/test_layout_frozen.py`](../tests/test_layout_frozen.py) builds
[`tests/layout_dump.cpp`](../tests/layout_dump.cpp) against
[`firmware/vorlaut/layout_format.h`](../firmware/vorlaut/layout_format.h) — the
same header [`vorlaut.ino`](../firmware/vorlaut/vorlaut.ino) includes at line 37
— and replays the browser's bytes into the same `parseLayout` the device calls
at line 194. (`frozen-references.md` says 36 and 150; the file has moved under
it, which is its own small argument for a specification that does not depend on
line numbers.) There is no document. The header is the specification, and it can
only play that part while a test can `#include` it.

So the proposal is to give the device interface the treatment the package
interface already has: a third artefact, owned by neither implementation, that
both are held against.

---

## 1. What the interface actually is

ADR 0006 names four things that "exist twice": `layout.bin`, the cable protocol,
the pairing codes and the panel's text. That list is wrong in both directions
now, and getting it right is most of the work.

| | Browser side | Device side | Held together by |
|---|---|---|---|
| `layout.bin` | [`src/data/layout_format.ts`](../src/data/layout_format.ts) | [`layout_format.h`](../firmware/vorlaut/layout_format.h) | `test_layout_frozen.py` — frozen bytes, live C reader |
| The cable | [`tools/cable.js`](../tools/cable.js), [`src/editor-diy/release.ts`](../src/editor-diy/release.ts) | [`cable_format.h`](../firmware/vorlaut/cable_format.h), [`cable.h`](../firmware/vorlaut/cable.h) | `test_cable_format.py` — live both ends |
| `t<hash>.bin` | [`src/data/tiles.ts`](../src/data/tiles.ts) | `drawTile()` in `vorlaut.ino` | **nothing** |
| `a<hash>.wav` | the build | `seekToWavData()` in `vorlaut.ino` | **nothing** |
| The name rule | `hashBytes()` in `layout_format.ts` | `hashPath()` in `vorlaut.ino`, `cableNameOk()` in `cable_format.h` | **nothing** |
| The language byte | `LANGUAGE_CODES` in `layout_format.ts` | `LANGUAGES` in `texts.h` | `test_texts.py`, by regex over the TypeScript |
| Pairing codes | — | — | the format no longer exists |

### The three nobody has counted

**The tile payload.** A `t<hash>.bin` is 116 by 116 pixels of RGB565,
big-endian, with no header — the size is not in the file, so both ends have to
agree on it out of band. The browser's number is `TILE_SIZE` in `tiles.ts`. The
device's is `TILE_W`, and it is defined in `vorlaut.ino`, not in a header, which
means no test can include it and none does. `tiles.lock.json` checks the browser
against pixels frozen from Pillow; it says nothing about what the firmware
expects. Two constants, no check.

Worse, the file has no length rule either. `drawTile()` zero-fills a short read
line by line, so a truncated tile draws partly black and the device says
nothing. That is format behaviour — a reader's response to a malformed payload —
and it is written down nowhere.

**The audio payload.** 16 kHz mono 16-bit WAV. What the device will actually
accept is whatever `seekToWavData()` walks past, and nothing on the browser side
is held to it.

**The name rule.** `/` + `t` or `a` + 32 lower-case hex + suffix, where the
16 bytes in `layout.bin` are the head of a hash *of the input* rather than of
the bytes. That rule is stated three times — in `hashBytes()`, in `hashPath()`,
and again in `cableNameOk()`, which independently decides which names the device
is willing to store. `cableNameOk()` has to be a superset of what the builder
emits or a file silently never arrives, and nothing says so anywhere.

### The one that is smaller than it looks

**The panel texts are almost not an interface.** [`tests/texts_dump.cpp`](../tests/texts_dump.cpp)
is the clue the brief points at, and what it reveals is that the strings live
only in `texts.h`. Of everything [`tests/test_texts.py`](../tests/test_texts.py)
checks — ten characters per display, code page 437 drawability, struct order
against initialiser order — not one item needs the browser. Exactly one thing
crosses: byte 7 of the layout header, the index into `LANGUAGES`, and the
requirement that every index a builder can write has a table behind it.

So the panel texts do not go into the specification. **The language enumeration
does**, as a field of the layout header. And the regex that reads
`LANGUAGE_CODES` out of another module's source should be replaced by that table
whether or not anything splits: a regex over somebody else's file is a
paraphrase, and [`frozen-references.md`](frozen-references.md) has the account of
what happened the last time a paraphrase stood in for an oracle.

### The pairing codes: no

They are gone. `discover.h`, `networks.h`, `pairing.h`, `pair_format.h`, `sync.h`
and `tests/test_pair_format.py` were deleted with the radio on 2026-08-23 —
[`cable.md`](cable.md#the-wi-fi-path-is-gone) has the reasoning, and the cable
needs no proof of presence because whoever holds the plug is already standing
there. There is no five-digit code on either side to specify. ADR 0006's Context
paragraph is stale on this point and the revisit should say so.

### What is not in scope

The talker's `.obz` export (`ext_vorlaut_*`) — no device reads it. App packages —
that is ADR 0004 and SPEC.md. `pins.h` — one implementation, no second party.

---

## 2. Why "freeze the bytes and split" is wrong, one level deeper

`layout.bin` is already frozen: [`tests/reference/layout.lock.json`](../tests/reference/layout.lock.json),
seventeen cases. [`frozen-references.md`](frozen-references.md) says why that is
not enough — freeze the reader too and the check becomes the browser compared
against itself.

The reason underneath that is about **where a fixture came from**, and it is the
thing worth carrying into the design:

> A lock file is a **capture of an implementation's output**. A conformance
> fixture is an **assertion authored from prose**, before either implementation
> existed.

`exchange/README.md` says it outright about its own fixtures: *"Every
expectation is an assertion about what an importer should do, written before any
importer existed. They are a specification in executable form, not a result."*

That difference is measurable here, and the measurement is stark. `layout.bin`'s
reader has five refusal codes — `LAYOUT_TOO_SHORT`, `LAYOUT_BAD_MAGIC`,
`LAYOUT_BAD_VERSION`, `LAYOUT_BAD_SLOT_COUNT`, `LAYOUT_BAD_LENGTH`. The lock has
seventeen cases and **not one of them is refused**. Every case is a valid layout,
because every case is something a correct-looking writer produced. A capture can
only ever contain what its writer emits, so no amount of freezing will ever reach
those five branches. Authoring reaches them on the first afternoon.

This is why the fixture work is worth doing regardless of the split, and why it
is not the same job as freezing.

---

## 3. What a spec-owned fixture set looks like here

Three shapes, because the interface has three kinds of thing in it. All three
follow the two rules that make `exchange/tools/make_fixtures.mjs` trustworthy:
**one literal produces both the artefact and its expectation**, and **the
generator never reads its own output back**.

### A binary, written by one side and read by the other

The same shape as an `.obz` with an `.expected.json`, and it transplants almost
unchanged. A fixture is a `.bin` plus a document holding the field values a
conforming reader must produce — which is exactly the `fields` list
`layout_dump.cpp` already prints. The builder must write these bytes for the
stated input; the firmware must read these fields out of these bytes.

The cases that do not exist today and are the point of the exercise: every
refusal code; a file one byte short of its own header; `sets` above `MAX_SETS`;
a `SLOT_COUNT` that is not 4; a version byte of 2; reserved bytes written
non-zero; a name filling all 32 bytes with a multi-byte character split at the
boundary. None of those can be captured. All of them can be authored.

### A conversation

The cable is not a document, and this is the harder half. A fixture is a
**transcript**: an ordered list of `(direction, line-or-raw-bytes)` together with
the device state it must leave behind. Both sides run the same file from
opposite ends —

- the browser client, given this device state, must write these host lines;
- the device reader, given these host lines, must reach this state and emit
  these device lines.

[`tests/test_cable_format.py`](../tests/test_cable_format.py) already builds
exactly this artefact; it simply throws it away. Twelve scenarios in
`tests/cable_node.mjs` are driven against the mock, every byte is recorded, and
those bytes are replayed into the compiled C. Freezing the transcript is a small
mechanical change — and it is the change that converts the strongest check in
the repository into something that survives leaving.

Note what that costs, because the cable check is the one with **no frozen
artefact at all** today. Both halves are generated live, on every run. It is the
best check here and the one that dies most completely on a split: there is
nothing left over.

### A payload with a geometry

Tiles and audio. A fixture is a byte file plus its decoded expectation — a
stride, an ordering, a pixel — plus, and this is the part nothing covers today, a
**short** file and an **over-long** one with the reader's required response to
each. `tiles.lock.json` is close in shape and wrong in provenance: it is a
capture from a deleted oracle, protecting one implementation, and it never
crossed the boundary.

### Two rules the package format does not need

**The device cannot ignore what it does not understand.** `parseLayout` reads
fixed strides; there is no room for an unknown field and no way to skip one. The
only forward compatibility this format has ever had is the trick already in it:
byte 7 was reserved, written as zero, and zero was later made to mean English, so
an old file stays readable. That has to be a stated rule of the specification, not
a happy accident recorded in a comment.

**The cable is the opposite.** Unknown keywords are skipped in both directions,
on purpose, so a browser can gain a field without a device in a drawer falling
over. One document, two subformats, two different extension rules — and saying
so plainly is worth more than a single rule that fits neither.

---

## 4. Who owns the fixtures, and where they live

`exchange/README.md`'s answer for the package format is: the fixtures live with
the **writer**, released as tags, and the reader pins the tag rather than a
branch, never a copy. **The mechanism generalises. The ownership does not.**

The mechanism — a tag prefix, a pinned consumer, no test runner beside the
fixtures because a runner living there is only ever exercised by a mock, and the
fixture normative where it and the prose disagree — all of that carries over
unchanged and is the right shape here.

The ownership does not carry over, for one reason: **the Android viewer can
always be updated, and a talker on a shelf cannot.** With `exchange/`, one party
can be forced to move, so the format may live with the other. With the device
format neither party can be forced. `layout.lock.json`'s own `invalidated_by`
says as much — a change to the structure in the header is *"the one change that
is supposed to be impossible, because the devices in the field are already
reading this."* A specification the writer owns and the reader merely pins puts
the authority on the side that has nothing at stake.

So: a top-level `device/` directory, owned by neither `src/` nor `firmware/`,
shaped like a repository without being one — which is precisely what `exchange/`
already is. If the split ever happens, `device/` is the thing that becomes the
third repository, and both halves pin it. It does not go with either.

---

## 5. What CI looks like afterwards

### Today

| | |
|---|---|
| `ci-tests.yml` | installs Node, Python and `g++`; runs `tests/run.py`, then `g++ --version` so a runner image that dropped the compiler cannot leave the job green |
| `ci-firmware.yml` | installs the ESP32 core and compiles six sketches for the target. **It never compiles anything for the host.** |

### After

**Builder side.** `g++` leaves `ci-tests.yml` entirely. `tests/run.py` loses its
stated reason for existing — compiling the firmware's readers — and what is left
in it is `test_links.py` and `test_language.py`, which need neither a compiler
nor Node. A Node runner over `device/fixtures/index.json` replaces the C: for
each layout fixture, `renderLayoutBin()` must produce these bytes; for each
transcript, the client must write these lines.

**Firmware side.** `ci-firmware.yml` grows a host job it does not have today —
`g++` over `layout_format.h` and `cable_format.h`, running the same fixture
index from the other end. This is a new capability for that workflow, and it is
the honest cost of the move rather than a detail.

### What replaces the three dumps

| | Becomes |
|---|---|
| `layout_dump.cpp` | the same program, in the firmware repository, taking its input from a fixture instead of from Node. It already prints the field lines the expectation would hold. |
| `cable_dump.cpp` | a transcript replayer. It already starts from an empty state reachable only through the wire, which is the property that matters. |
| `texts_dump.cpp` | **nothing. It does not move and is not replaced.** It stays firmware-side and unchanged, except that its language-count check reads the specification's table instead of a regex over `src/data/layout_format.ts`. |

### What is lost, and what has to replace it

Today the C reader parses the bytes Node wrote *on the same run*. Afterwards
neither side ever meets the other; each meets only the fixture. The compensation
is fixture completeness — and completeness is a claim, not a result, until
somebody breaks each implementation on purpose and watches the suite go red.

This repository already has the practice and the tool: `tools/cablemutate.py`,
23 of 23 caught with two controls surviving — and what it missed on its first
run was real holes rather than missing assertions, two of which were fixed in the
code rather than in the test. **The mutation run is the
acceptance test for the fixture set**, on both sides, and without it the move
trades a live check for an assertion.

One more discipline, because the authored fixture has a failure mode the captured
one does not: the fixtures MUST be validated against both existing
implementations before anything is tagged, and where an implementation disagrees
with a fixture the disagreement is settled by *reading both implementations* —
never by editing the fixture to match whichever one is in front of you. Edit the
fixture to match a writer and you have quietly turned it back into a capture.

---

## 6. What it costs to get wrong

ADR 0006 is blunt: a format mismatch is not a red build, it is a device that
stays silent in a house with a child in front of it, after somebody sat down with
a soldering iron. Two things should be added to that, and both make it worse.

**Silence is the good outcome.** A structural mistake is caught: `parseLayout`
refuses on the magic, the version or the stride, and five displays say there is
no content, which is a true sentence. The dangerous mistakes are the ones that
*parse*. A hash read at the wrong offset gives a key that speaks a different
sentence. A truncated tile draws black because `drawTile()` zero-fills. A
`sleep_timeout_seconds` read big-endian is a device that sleeps in eight
minutes or in eighty years. Each of those is a device that works and is
wrong — and a key that says the wrong sentence is worse than a key that says
nothing, because it is said to somebody who believes it.

**There is no update channel.** A wrong builder is fixed by a deploy; Pages goes
out on every push to `main`. A wrong device is fixed by a person with a cable, in
a house nobody in this repository knows about. That asymmetry is why the
specification's MAJOR rule has to be written about *a flashed device misreading a
new payload* rather than about the builder, and why the versioning below is not a
copy of SPEC.md §12.

**And a specification would not have caught the only real fault so far.** The
bug that actually silenced a device was a 256-byte serial receive buffer losing
bytes while the loop sat in a flash write for tens of milliseconds
([`bring-up.md`](bring-up.md), stage 6, 2026-08-23).
`test_cable_format.py` passes either way, because a Node stream has no buffer to
overflow — its own closing note had already said the case was not coverable
without hardware. No fixture set reaches timing. Whatever this proposal is worth,
it is not worth anything against the class of fault this project has actually
had, and a document that implied otherwise would be doing harm.

---

## 7. Versioning, and the tag

[`releases.md`](releases.md) already carries the answer's shape: three prefixes
for three things released on three schedules.

| Prefix | Releases |
|---|---|
| `v*` | the firmware image, and nothing else |
| `builder-v*` | the page in `src/` |
| `exchange-v*` | `SPEC.md` and its fixtures |
| `device-v*` | **proposed** — the device interface specification and its fixtures |

`v*` is taken and stays taken. `device-v*` is free, matches the established
convention, and sorts nowhere near the others.

Two things follow that are easy to miss:

- **`device/` has to join `exclude-paths` in
  [`release-please-config.json`](../release-please-config.json)**, beside
  `firmware`, `case` and `exchange`. Otherwise every commit to the specification
  mints a version of the builder. Paths decide this, not scopes.
- **The specification's version is not `LAYOUT_VERSION` and not
  `CABLE_VERSION`.** Those are a byte in a file and a number on a wire, both
  currently 1. The document version is `MAJOR.MINOR.PATCH` over the whole device
  interface, and the three of them will drift apart on purpose.

The rule, adjusted for a reader that cannot be updated:

- **MAJOR** when a device already flashed would *misread* a payload a conforming
  builder writes. Not "would reject" — reject is safe and legible. Misread is the
  one that costs.
- **MINOR** only for a field taken out of reserved space whose zero value is the
  old behaviour — the byte-7 trick, and nothing else, because `parseLayout` has
  no way to skip what it does not know. On the cable, MINOR is the ordinary
  thing, since both ends skip unknown keywords by design.
- **PATCH** is wording.

---

## 8. The page colour, which has since gone

This section asked that a specification describe the colour as shipped and
carry its removal as an open question. The removal happened first, on
2026-08-26, and the section is kept rather than deleted because what it got
right and what it got wrong are both useful to whoever writes the fixtures.

**What went.** The Set sheet's swatches; the two bytes at the front of a
`SetEntry`, which is 184 bytes now and sits behind `LAYOUT_VERSION 2`;
`drawTile()`'s frame argument, those six pixels being blacked out with nothing
in their place; and both fields it reached in an app package —
`ext_lautstark_board_color` on the board *and* `border_color` on every button,
which was the easier one to miss. `exchange/SPEC.md` is untouched: §4.2's field
is optional, so ceasing to write it needs no version, and taking it out of the
document is a separate act §12 has no category for while `~/Code/vorlaut-app`
still reads `Board.color`.

**Where this section was right.** The lock really was invalidated, and the
oracle really is gone. That is the whole difficulty, and it named it.

**Where it was wrong, and it matters for the fixtures.** It read "restore the
oracle from git" as the only acceptable route. It was not the route taken.
`layout.lock.json` is untouched: `test_layout_frozen.py` narrows what it
compares, the way `THE_FILTER_IS_GONE` already did, and strikes the two bytes
out of each frozen entry by hand at a stated offset — so every remaining byte is
still Python's answer and the C reader still has to agree field for field.
Restoring `layout_format.py` to re-freeze would have meant editing the oracle
and the subject in one session, which is less independence than the frozen
bytes already carry, not more. See `THE_COLOUR_IS_GONE` for the argument in
full.

The version bump is the other correction. A shorter set entry does not make an
old file too short — 186 per set is *more* than 184 — so its length still adds
up and `parseLayout` would have read every name and hash two bytes late. That is
exactly this document's §6: the dangerous mistakes are the ones that parse.
`LAYOUT_VERSION 2` turns it into a refusal, which is the silence §6 calls the
good outcome.

*Separately and not in the format's names:* the rename of the talker's *Set* to
*Seite* on screen has since landed, and it is screen vocabulary. The wire still
has `SetEntry`, `name` and `setCount`, which is the point — a change to what a
person reads on a display must not rename a field.

---

## What the evidence actually says

ADR 0006's standard is that evidence means a measurement or an event, not an
intuition about tidiness. Held to it:

| | |
|---|---|
| Repository age | first commit 2026-08-19; 641 commits in seven days |
| `firmware/` changed | on five of the last seven days |
| The transport | replaced entirely 2026-08-22/23. Wi-Fi out, cable in — which **deleted one of the four formats ADR 0006 names** |
| `cable_format.h` | three commits, newest 2026-08-23, and its own comment names a pending change *to both halves of the protocol*: the device acknowledging each chunk, *"worth doing before this device is out of reach of a cable"* |
| `src/data/layout_format.ts` | changed 2026-08-25 — yesterday — in a breaking commit that permanently invalidated one of the seventeen frozen cases |
| The model itself | `exchange/SPEC.md` is 1.1.0 **draft**; no `exchange-v*` tag is cut and none will be until a real board reaches a tablet |

Condition 1 asks whether `layout.bin` and the cable protocol are "frozen for
good". One had a semantic change yesterday; the other has a named pending change
to both halves. Condition 2 asks for a second consumer: the Android viewer
consumes the *package* format, not the device format, and nothing else reads
`layout.bin`. Conditions 3 and 4 are untouched — CI is fast and there is one
maintainer.

**So: not met, by the ADR's own words, and not close.**

## Recommendation

1. **Do not split.** Every load-bearing sentence in ADR 0006 still holds, and the
   week of history above is the measurement it asked for.
2. **Write the fixtures anyway, and write them first.** Not as preparation for a
   split — as the check this repository is missing today. Five refusal codes with
   no fixture, a tile geometry that agrees by coincidence, a WAV acceptor nobody
   compares, and a name rule stated three times. None of those gaps is about
   having two repositories, and none of them can be closed by freezing.
3. **Fixtures before prose.** The house rule is that the fixture wins where the
   two disagree; a specification document written while the format changes daily
   will be wrong within the week, and the fixtures will not. Prose follows once
   there is something stable to describe.
4. **Cut no tag.** `device-v*` is reserved and unused until the fixtures have run
   against both implementations and a mutation run says they bite. The same bar
   `exchange-v*` is being held to, for the same reason.

If that is done, the split is what ADR 0006 predicted it would be when its
condition is met: cheap, because the expensive part is already paid for.

## Should this be an ADR?

**Not as it stands. Yes if recommendation 2 is adopted.**

This document is an answer to 0006's revisit clause that concludes 0006 was
right, and re-affirming a decision is not a new decision. Making it ADR 0009
would put a file in `adr/` whose content is "0006 still applies", which is what
0006's own last section is for.

What *would* earn an ADR is the fixture set, because that is a decision with
consequences somebody will later want to tidy away: a third artefact that both
implementations are held against, owned by neither, in a directory that belongs
to neither half of the repository, with a fourth tag prefix. That has exactly the
shape the [`adr/README.md`](../adr/README.md) describes — a thing that looks like
an oversight from outside, and whose cleanup would undo something decided on
purpose.

So: this stays in `docs/` as a proposal. If the fixtures are built, ADR 0009
records *them*, and 0006 gains one dated line noting that its condition 1 was
examined on 2026-08-26 and not met, and that the pairing codes in its Context
paragraph no longer exist. 0006 is not superseded and its status does not change.
