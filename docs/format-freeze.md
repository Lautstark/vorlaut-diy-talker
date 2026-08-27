# What is still moving in the three formats

**Status: survey. 2026-08-27.** No format was touched and no tag was cut, and
that is still true. Two things have moved since it was written, both recorded
in place rather than folded away: [C1](#c1-chunk-acknowledgement--in-flight)
landed, and the six drifted citations in §9 were repaired. The list is the
deliverable.

[`adr/0006`](../adr/0006-builder-and-hardware-one-repo.md) gained a dated line
on 2026-08-26 — *condition 1, not met* — on the strength of two facts: a
breaking change to [`layout_format.ts`](../src/data/layout_format.ts) the day
before, and one pending change named in
[`cable_format.h`](../firmware/vorlaut/cable_format.h)'s own comment. One
pending change is not a list. This is the list.

It covers the three formats that cross a boundary:

| | Browser side | Other side |
|---|---|---|
| `layout.bin` | [`src/data/layout_format.ts`](../src/data/layout_format.ts) | [`layout_format.h`](../firmware/vorlaut/layout_format.h) |
| The cable | [`src/backend/cable.ts`](../src/backend/cable.ts), [`tools/cable.js`](../tools/cable.js) | [`cable.h`](../firmware/vorlaut/cable.h), [`cable_format.h`](../firmware/vorlaut/cable_format.h) |
| The package | [`src/data/app_package.ts`](../src/data/app_package.ts) | [`exchange/SPEC.md`](../exchange/SPEC.md) and the Android viewer |

The tile payload, the audio payload and the name rule are part of the device
interface too — [`device/README.md`](../device/README.md) is the list of what
it holds — and they are surveyed here under `layout.bin` and the cable, which
is where a change to them would land.

---

## The short answer

**Six pending items, of which one has since landed.** Two of the six had to
land before a device freeze; four can wait behind a version. Three whole
categories the brief asked about came back empty, and saying so is the point
of §7.

[C1](#c1-chunk-acknowledgement--in-flight), the one that was in flight when
this was written, landed on 2026-08-27 and took `CABLE_RX_BUFFER` with it. The
entry is kept rather than deleted: what a survey said would happen, against
what did, is the part that is worth reading a second time.

Nothing on this list invalidates a lock as it stands. **Two of them would if
they were resolved the other way**, and that is stated per item, because
[`layout.lock.json`](../tests/reference/layout.lock.json) cannot be rewritten —
the oracle that wrote it went on 2026-08-22 and
[`frozen-references.md`](frozen-references.md) is explicit that refreezing from
the module under test is never the answer.

| | Format | Before a freeze? | Lock |
|---|---|---|---|
| [L1](#l1-the-sleep-timeout-has-two-values-the-format-allows-and-the-reader-cannot-use) | `layout.bin` | **landed 2026-08-27** | held |
| [L2](#l2-the-set-count-cap-is-a-device-rule-the-writer-does-not-hold-itself-to) | `layout.bin` | No | no |
| [C1](#c1-chunk-acknowledgement--in-flight) | cable | **landed 2026-08-27** | no |
| [C2](#c2-cable-version-is-compared-by-a-test-and-by-nothing-that-runs) | cable | **Yes** | no |
| [N1](#n1-the-builder-emits-names-the-name-rule-forbids) | name rule | No | at risk |
| [P1](#p1-ext-lautstark-negated-is-recommended-and-unwritten) | package | No | no |

[P2](#p2-a-normative-rule-landed-after-the-viewers-pin-with-no-version-to-show-for-it)
is not a pending change but a pending **fact** about the package boundary, and
it is in §5 with the rest of the Android answer.

---

## 1. `layout.bin`

### L1. The sleep timeout has two values the format allows and the reader cannot use

**What would change.** Either the reader gains a clamp, or the specification
gains a range narrower than the field.

Two ends of one field, and neither is written down anywhere:

- **Zero.** [`vorlaut.ino`](../firmware/vorlaut/vorlaut.ino)'s idle check reads
  `layout.sleepSeconds ? layout.sleepSeconds : 600`. A timeout of zero is ten
  minutes on the device, not "never sleep" and not "sleep at once". That `600`
  is a magic number in the one file no test can include, and it is the same
  number `DEFAULT_SLEEP_TIMEOUT` carries in
  [`obf.ts`](../src/data/obf.ts) — arrived at twice, agreeing by coincidence.
- **The top.** The field is a uint32 and the fixture
  `layout/sleep-timeout-max` pins that `0xffffffff` parses. The reader then
  computes `idle * 1000UL`, and on a target where `unsigned long` is 32 bits
  that wraps: the largest timeout the format can express is not the largest one
  the device can wait for. Anything above roughly 4,294,967 seconds is a
  different length of time from the one written.

The fixture's note says `0xffffffff` read as sixteen bits or as signed "is not
a length of time". Correct, and it stops one step early — the value is not a
length of time when read *correctly*, either.

**Which side breaks.** Neither, today. `normalizeLayout()` clamps to
`[10, 86400]`, so no builder in this repository emits either value. The break
is a second builder, or a hand-written `layout.bin`, or anything that reaches
`renderLayoutBin()` without going through `normalizeLayout()` — which
[`no-sets`](../device/fixtures/layout/no-sets.expected.json) already does, and
its `write` half requires the writer to emit zero for an input of zero.

**Lock.** At risk, and only on one of the two routes. Narrowing the *stated
range* is prose and touches no bytes. Adding a clamp to `parseLayout` or to
`renderLayoutBin` is a change to the structure's meaning, which is
`layout.lock.json`'s first `invalidated_by` line — the one that has fired once
already and was answered by narrowing rather than refreezing.

**Before or behind a version.** Before, if the answer is a reader change: a
flashed device cannot be given one afterwards, which is the whole asymmetry
`device/README.md` is built on. Behind a version, if the answer is a writer
rule — a sentence saying a builder MUST write between 10 and 86400 costs
nothing and can be added at any MINOR.

**Recommendation:** the writer rule, and no reader change. The reader's
forgiveness is not wrong, it is undocumented, and the same argument the tile's
`short` fixture makes applies here — *stated rather than changed*.

**Status: landed**, on 2026-08-27, and the recommendation above was half right.
Kept rather than rewritten, because which half is the part worth reading twice.

*Right about the parse.* `parseLayout` is untouched and hands the four bytes
back exactly as it always did. `renderLayoutBin()` is untouched too and still
writes whatever it is handed, including `0xffffffff` — which the survey did not
ask about and which turns out to be forced by the same lock, since `sleep at
both ends of the uint32` froze that writer's bytes for exactly that input. Both
ends of the "resolve it in the reader" route were closed, not one.

*Wrong that a writer rule was enough.* A sentence saying a builder MUST write
between 10 and 86400 does nothing about a **flashed device** handed a file by
somebody else's builder, and `idle * 1000UL` wraps there regardless of what
this repository's prose says. So the range was written down **and** a clamp
landed — just not where the survey assumed a clamp would have to go.
`layoutIdleSeconds()` sits beside `parseLayout` in `layout_format.h`, is called
from `vorlaut.ino` in place of the `? :` with the bare 600 in it, and turns the
field into a length of time. The parse says what the bytes hold; that function
says what they mean. It is the same division byte 7 already had, and it was
available the whole time.

*Wrong about the lock, in the direction that matters.* This entry said "at
risk", meaning a reader change would be caught. It would not have been.
`layout.lock.json` records what its reader makes of a timeout of zero and one
of `0xffffffff`, and **compares neither** — both are kind `bytes`, and only the
nine kind `fields` cases are compared line by line, every one of them carrying
a timeout already inside the range. Verified by making the change and running
the suite: `test_layout_frozen.py` stays green with a clamp inside
`parseLayout`. The lock was never a guard here. It was a witness that would
have gone on describing a reader that no longer existed, with the oracle gone
since 2026-08-22 — which is a worse outcome than a red test and the reason the
answer would have been the same even if nothing had been at risk at all.

What guards it now is `device/fixtures/`: every accepted layout fixture carries
`sleep_seconds` and `idle_seconds` as separate fields, `sleep.expected.json`
states the range and the emitted-inside-honoured rule the way
`names.expected.json` states its own, and the same mutation goes red in
`test_device_host.py` immediately. The 600 that `DEFAULT_SLEEP_TIMEOUT` and
`vorlaut.ino` had each arrived at separately is now one constant that both
sides are held to.

### L2. The set-count cap is a device rule the writer does not hold itself to

**What would change.** `renderLayoutBin()` gains the cap it already relies on,
or the fixture set states the number the way it states the language table.

`MAX_SETS` is 5 in [`layout_format.h`](../firmware/vorlaut/layout_format.h).
`LIMITS.maxSets` is 5 in [`boot_data.ts`](../src/core/boot_data.ts).
`renderLayoutBin()` refuses only above 255 — one byte's worth — and the editor
and `normalizeLayout()` are what actually keep the number at five.

The name rule has this relation written down: `names.expected.json` states that
every name a builder emits must be a name the device will store, and
`test_device_host.py` checks it. The set count has the same shape — the
builder's cap must be at or below the device's — and nothing states it. The one
place the two numbers are compared is
[`test_obf_frozen.py`](../tests/test_obf_frozen.py), by a regular expression
over `boot_data.ts`. That is a paraphrase standing in for an oracle,
which is exactly what the language table was created to stop being.

**Which side breaks.** The device, visibly and safely: a six-set file is
refused with `LAYOUT_BAD_LENGTH` and the displays say there is no content.
Fixture `layout/sets-past-max` pins it. This is the good failure, not the
dangerous one.

**Lock.** No. Nothing about the frozen bytes changes.

**Before or behind a version.** Behind. The device already refuses correctly;
what is missing is a statement and a check, not a byte.

---

## 2. The cable

### C1. Chunk acknowledgement — in flight

**What would change.** Both halves. `cable_format.h`'s own comment on
`CABLE_RX_BUFFER` names it:

> The fix that would not need a number here at all is the device acknowledging
> each chunk so the browser waits while the flash is busy — a change to both
> halves of the protocol, and worth doing before this device is out of reach of
> a cable.

**Status: landed**, on 2026-08-27, from the branch this survey named while it
was still empty. `CABLE_VERSION` is 2. The device sends a window with its `go`,
acknowledges each one with a running total before the browser sends the next,
and `CABLE_RX_BUFFER` has gone — the receive buffer is now sized *from* the
window rather than against a guess at the worst burst. See
[cable.md](cable.md#the-window-is-the-flow-control).

**Which side breaks.** Both, and the break was taken deliberately while every
device was on a desk. What was expected here was that a new browser waiting on
an old device would hang; in the event it does not, because the window rides on
the `go` line rather than on a line of its own. An old device says `< go` with
nothing after it, the browser reads a window of zero and refuses out loud. The
other direction is loud too: an old browser pushes a whole file at a device
whose buffer is now 4 KB, and it fails on the checksum or the timeout.

That is luck rather than design, and it does not retire
[C2](#c2-cable-version-is-compared-by-a-test-and-by-nothing-that-runs) — it
means the first bump happened to land somewhere that fails noisily. The next
one may not.

**Lock.** No. The cable has no frozen artefact at all — both halves are
generated live on every run, which
[`device-interface.md`](device-interface.md) §3 names as the strongest check
here and the one that survives a split least well.

**Before or behind a version.** Before, and the comment says why in the only
terms that matter: *before this device is out of reach of a cable*.

`CABLE_RX_BUFFER 65536` was the workaround-with-a-number this replaced, and it
was the best-documented constant in the repository — 490 KB/s measured, a 46 ms
worst flash write, 22 KB arriving with nowhere to go, 16 KB tried first and
short by 214 bytes of 26912. It was a bound and not a guarantee, and it said so.
Its successor needs no such note: the device cannot fall further behind than it
asked to.

### C2. `CABLE_VERSION` is compared by a test, and by nothing that runs

**What would change.** The client compares the version the device reports, and
a fixture covers a mismatch. Neither exists.

`CABLE_VERSION` is 2 in `cable_format.h` and 2 in `tools/cable.js`, and **the
bump has now happened** — [C1](#c1-chunk-acknowledgement--in-flight) landed on
2026-08-27. It went into a field nothing reads, exactly as this entry predicted,
so the entry stands and is one degree more urgent rather than less: there is now
a real version 1 to be told apart from a real version 2.

Its stated job is to be *"bumped when a device that speaks the old protocol
could no longer be driven correctly by a browser that speaks the new one."* The
only thing that reads it is
[`test_cable_format.py`](../tests/test_cable_format.py), whose hello check greps
`tools/cable.js` for the number the compiled firmware reported.

At runtime, `findTalker()` in [`cable.ts`](../src/backend/cable.ts) has
`if (hello.version) return { port, cable, hello };` — a truthiness test. Any
non-zero version is accepted and driven as whatever the browser speaks. All
eight cable fixtures say `< vorlaut 2`; none exercises a mismatch, in either
direction.

So the version field of the three formats behaves differently in each: byte 4
of `layout.bin` is enforced and has a refusal code and two fixtures for it;
`ext_lautstark_spec_version` is enforced by SPEC.md §12 with
`spec_version_unsupported`; `CABLE_VERSION` is enforced by a test that greps a
source file, which is exactly the check that cannot cross a repository
boundary.

**Which side breaks.** The browser, silently. A device flashed with a newer
firmware is driven by an old page as though nothing had changed, which is the
failure the number was introduced to prevent.

**Lock.** No.

**Before or behind a version.** It was called a prerequisite of
[C1](#c1-chunk-acknowledgement--in-flight) and it was not one — C1 landed
without it, and the mismatch it leaves fails noisily in both directions for a
reason that has nothing to do with this field. So: behind, now, and still
wanted. What C1 changed is that the number finally distinguishes two protocols
that really existed, and the next change to bump it may not be as lucky about
where it fails.

### N1. The builder emits names the name rule forbids

**What would change.** `hashBytes()` refuses two spellings it currently
accepts, or the rule is loosened to match it.

The rule is stated in `names.expected.json`: a slash, then `t` or `a`, then
exactly 32 **lower-case** hex digits, then the suffix. `hashBytes()` in
`layout_format.ts` accepts upper case, and accepts fewer than 32 digits by
leaving the rest of the sixteen bytes zero. `cableNameOk()` stores both
happily. The fixture records all three malformed spellings with
`emitted: false` and its own note is blunt about where that leaves things:

> The rule is stated here; whether either end should enforce it is a change to
> the code and not to this file.

`device/README.md` item 7 says the same. The symptom of either getting out is
one black key and no error anywhere.

**Which side breaks.** Neither refuses; the device stores the file under the
name it was given and then looks for a different one. This is the
`device-interface.md` §6 category — a device that works and is wrong — reached
by a spelling rather than by a stride.

**Lock.** At risk on one route only. Making `hashBytes()` throw on upper case
changes a function `layout.lock.json` was frozen against; whether any frozen
case exercises it would have to be checked before, not after. Making the check
a separate validator beside it touches nothing.

**Before or behind a version.** Behind. Neither end's *acceptance* changes,
only what the builder is willing to produce, and the builder is the half that
can be redeployed.

---

## 3. The package format

### P1. `ext_lautstark_negated` is recommended and unwritten

**What would change.** SPEC.md §4.3 gains a twelfth field, a fixture comes with
it, and the Android viewer's pin moves.

[`negation.md`](negation.md) §2 recommends it, and gives the wording it would
need — a statement about pixels that are already there, never an instruction to
draw, so that a viewer which learns the field cannot double-cross a package a
conforming builder wrote.

**Everything else in that proposal has landed.** `bakeImage({ negated })` draws
the cross into the package PNG, `tiles.ts` draws it into the device tile, and
`obf.ts` writes `ext_vorlaut_negated` on the talker's own export — which needs
no specification change, because ADR 0001 keeps that namespace out of SPEC.md
on purpose. The one part not built is the `ext_lautstark_*` field.

Two stale things travel with it, and both would mislead whoever picks this up:
negation.md still opens **"Status: proposal, nothing built"**, and it still
names **1.2.0** as the minor bump this would be. 1.2.0 was spent on
`ext_lautstark_append_on_navigate` on 2026-08-26; the negation field would be
1.3.0.

**Which side breaks.** Nothing breaks. §10.3 has an importer ignoring unknown
fields, and the shipped viewer renders the crossed PNG correctly today knowing
nothing about it.

**Lock.** No. `obf.lock.json` covers the talker's export, and
`ext_vorlaut_negated` is already written there.

**Before or behind a version.** Behind — it is the textbook MINOR, and it is
also entirely on the package side of the boundary, so it does not touch a
device freeze at all.

---

## 4. Reserved space, and where the two formats can still grow

The brief asks after reserved and unused fields, on the strength of byte 7.
There are **exactly two** pieces of reserved space in `layout.bin`, and both
are now stated rules rather than comments:

| | State | Stated by |
|---|---|---|
| Header byte 7 | **spent.** Reserved, written zero, zero later made to mean English | `language.expected.json`, `layout/language-past-the-table` |
| The byte after each slot's has-audio flag | **unspent.** A writer writes zero, a reader ignores it | `layout/slot-reserved-byte-set` |

Neither is a pending change. The second is the only room `layout.bin` has left,
and the fixture's note is explicit that it works the same way byte 7 did — *a
later MINOR version may give a meaning to a value whose zero is the old
behaviour*. **That is the format's entire forward compatibility**, and the two
fixtures that could be mistaken for more of it say so themselves:
`layout/trailing-bytes` — *"That is NOT a way to extend the format"* — and
`tile/over-long`, for the same reason.

The cable's extension space is stated too, and in the opposite direction:
unknown keywords skipped both ways, a fourth word on `put` ignored, and
argument-free verbs ignoring whatever follows them. `CABLE_NAME_MAX 63` against
a 34-character name and `CABLE_LINE_MAX 128` against a 56-character line are
headroom that was chosen on purpose and documented at the point of choosing.

The package format's is closed by rule: §4.3 ends *"That is the whole list.
Eleven fields… Anything else beginning `ext_lautstark_` is not part of v1 and
MUST be ignored."*

---

## 5. The Android viewer's pin, and which half a device freeze solves

**It is pinned to a commit SHA, and that is exactly enough — but not because
the version number is doing the work.**

`exchange-pin.md` lives in the viewer's own repository,
[`Lautstark/vorlaut-app`](https://github.com/Lautstark/vorlaut-app), and not
here. It sets `exchange.sha` in
`gradle.properties` to `4055c1f`, which carries SPEC.md 1.2.0 and fifteen
fixtures. No `exchange-v*` tag is cut and none will be until a real board
round-trips to a tablet. The document is clear-eyed about what a pin is for:
moving it is a deliberate act with a test run attached, an emptied pin fails
loudly rather than skipping, and copying the fixtures is forbidden.

### P2. A normative rule landed after the viewer's pin, with no version to show for it

`exchange/` has moved once since `4055c1f`: commit `1057ea5`, which added ten
lines to SPEC.md §2 — *an importer **MUST NOT** require a particular extension*,
and a builder MAY hand the same bytes over as `.zip` where a platform refuses
`.obz`. The version stayed **1.2.0** and §14's changelog gained no entry.

By §12 that is arguably PATCH ("wording only"), since no importer ever did
require an extension. But it introduces a MUST NOT that a conformance claim can
be measured against, and **the version cannot tell the two commits apart.** An
importer that says "conformant at 1.2.0" is making a statement that is now
ambiguous by one rule.

This is a fact about the boundary rather than a change anybody has to make, and
it has a comfortable answer: the SHA-pin distinguishes them where the version
does not, which is the argument for the SHA-pin restated from the other side.
What it is not is evidence the package format has stopped moving. It moved
three days ago, invisibly to its own version.

### Which half a device freeze solves

If `device-v1` is cut and `exchange-v1` is not, **the ADR should say plainly
that the split solves the device half and not the package half**, in these
terms:

- **They are separate boundaries with separate consumers.** The device format's
  reader is a flashed talker that cannot be updated. The package format's
  reader is an Android app that gets an update. `device/README.md` already
  builds its whole ownership argument on exactly this difference; the revisit
  should carry it into 0006's condition 2.
- **Condition 2 stays untouched either way.** The Android viewer consumes the
  package format, not the device format, and nothing else reads `layout.bin`.
  Freezing one does not give the other a second consumer.
- **The firmware leaving does not move `exchange/`.** `exchange/` is the
  builder's, pinned by a consumer that is already a separate repository. The
  split moves `firmware/` and leaves `device/` as the third thing both halves
  pin. Nothing about `exchange/` is on the critical path for either.

---

## 6. `tests/reference/` and `device/fixtures/` — the boundary is real

ADR 0009 predicts somebody will propose folding one into the other. Checked,
and **they do not overlap.** Only two pairs could plausibly:

| | `tests/reference/` | `device/fixtures/` |
|---|---|---|
| layout | 17 cases, **none refused**, captured from `layout_format.py` | 18 cases, **7 refused**, authored from the rule |
| tiles | 14 tiles of decoded pixels from Pillow, checking Lanczos, centring and RGB565 truncation | 4 files of addresses and flat colours, checking byte order, stride and length |

The layout pair share a file format and nothing else. Every case in the lock is
a valid layout because every case is something a correct writer produced; the
seven refusals in the fixtures are files no implementation here will ever emit.
The two sets are not even the same *kind* of statement — one records what a
deleted program answered, the other asserts what a reader must do.

The tile pair do not even share a subject. `tiles.lock.json` protects
`src/data/tiles.ts` against a renderer that is gone, and it never crossed the
device boundary. `device/fixtures/tile/` says which way round a file is and what
a reader does with the wrong length, and its own note says *"Nothing here is a
picture."*

Three further reasons the merge would be wrong, and they matter for a split
specifically:

1. **`frozen-references.md` forbids the one thing the fixtures are for.** The
   locks may never be regenerated from the module under test; the fixtures are
   regenerated by `make_fixtures.mjs` on every change, deliberately and
   reproducibly. One document cannot govern both.
2. **They move in opposite directions.** `tests/reference/` protects `src/` and
   goes with the builder. `device/fixtures/` belongs to neither half and becomes
   the third repository. A merged directory would have to go somewhere, and
   wherever it went would hand the format back to that half.
3. **They fail differently.** A red lock means either a real regression or an
   unanswerable question, because there is nothing left to re-derive from. A red
   fixture means one of the two implementations disagrees with the rule, and the
   rule can always be read again.

One thing does need saying about the layout lock before anything is frozen,
because it is a cost attached to nearly every item above:
`layout.lock.json`'s `invalidated_by` names three changes, and **two of them
name programs that no longer exist** — `render_layout_bin()` in
`layout_format.py`, and `normalize_layout()` in `layout.py`, both deleted on
2026-08-22. The third — a change to the structure in `layout_format.h` — has
already fired once, and was answered by `THE_COLOUR_IS_GONE` narrowing the
comparison rather than by a refreeze. **Anticipated is not answerable.** Any
further structural change to `layout.bin` has the same three answers and no
fourth: narrow the comparison, set a case aside, or restore an oracle from git
long enough to re-freeze — and the tile lock has already spent that last one
once, in 2026-08-26's `TILE_PIPELINE` bump.

---

## 7. Where the answer is "nothing else"

These are findings, and the useful kind: each one turns a hope into a decision.

**The four gaps `device-interface.md` §1 counted are closed, not merely
described.** All four, checked one at a time:

| Gap | Closed by |
|---|---|
| The tile payload — two constants, no check | `TILE_W` in [`tile_format.h`](../firmware/vorlaut/tile_format.h), `TILE_SIZE` held to the fixture's geometry in `device_fixtures.test.ts`, `tileReadRow()` held from the host side. The zero-fill is stated in `tile/short`. |
| The audio payload — whatever `seekToWavData()` walked past | [`wav_format.h`](../firmware/vorlaut/wav_format.h) and [`audio_format.ts`](../src/data/audio_format.ts), six fixtures, four of them refusals. |
| The name rule — stated three times, related nowhere | `names.expected.json`, and `test_device_host.py` checks emitted ⊆ stored. What is left is [N1](#n1-the-builder-emits-names-the-name-rule-forbids), which is enforcement rather than statement. |
| The language enumeration — read by a regex | `language.expected.json`. `test_texts.py` reads the fixture now, and the regex over `layout_format.ts` is gone. |

**`CABLE_QUIET_MS` is no longer a guess.** [`cable.md`](cable.md) asked for a
measurement and got one on 2026-08-23: a longest gap of 0 ms and a longest
flash write of 53 ms over a full payload of ten files and 199 KiB. The margin is
the timeout itself. Nothing pending.

**No field is written and never read**, and none is read and never written.
Every one of `layout.bin`'s header fields and every set and slot field is used
in `vorlaut.ino` — the label hash by `hashPath()`, the set count by the ring,
the language by `setLanguage()`, the timeout by the idle check. The single
exception is the reserved slot byte in §4, which is unread by design.

**No third format is hiding.** The pairing codes went with the radio on
2026-08-23 and have no second implementation because they have no first one.
The panel texts cross no boundary but byte 7, which is now a fixture. The
talker's `.obz` export is read by no device. `pins.h` has one implementation.

**`stereo-44k` is the only divergence of its shape**, and it was found by
looking for more. The device accepts a 44.1 kHz stereo file because it never
reads the fmt chunk, then plays it at 16 kHz mono. Two neighbours were checked
and are narrower than they look: `data-longer-than-file` is a short word rather
than a wrong one, and `tile/short` draws partly black. All three are recorded
without being blessed, all three are writer rules the reader does not check, and
**none needs a firmware change to be specified** — only to be enforced, which is
a different decision and not one this survey makes.

---

## 8. Sequencing: what has to be true before `device-v1`

ADR 0009 reserved the prefix and did not use it. What it is waiting for is
stated there in two clauses — *"no tag until the fixtures have run against both
implementations **and** a mutation run says they bite"* — and both are things
somebody can check rather than judge. Adding what this survey found, in order:

1. **`python3 tools/devicemutate.py` exits zero.** No missed mutation, no
   control wrongly caught, no mutation caught by the wrong end, and nothing in
   the list whose text has moved. This is the acceptance test for the whole
   directory and the tool prints each failure mode by name. *Checkable: an exit
   code.*

2. **[C1](#c1-chunk-acknowledgement--in-flight) has landed, or has been
   deferred on the record.** It is the one change already named as belonging
   *before* the device is out of reach of a cable, and freezing the protocol
   without it means either shipping `CABLE_RX_BUFFER`'s bound permanently or
   spending a MAJOR on it later. *Checkable: `CABLE_RX_BUFFER` is gone from
   `cable_format.h`, or an ADR says why it stayed.*

3. **[C2](#c2-cable-version-is-compared-by-a-test-and-by-nothing-that-runs) is
   closed.** `CABLE_VERSION` gains a runtime comparison and a fixture in which
   the device answers a version the client does not know. Without this, C1 bumps
   a number nothing reads, and the bump is the only protection an already-shipped
   browser has. *Checkable: a fixture whose transcript carries `< vorlaut 2`,
   and the client's stated behaviour on it.*

4. **[L1](#l1-the-sleep-timeout-has-two-values-the-format-allows-and-the-reader-cannot-use)
   is decided in writing**, either way. If the answer is a reader clamp it must
   land first, because a flashed device cannot be given one. If the answer is a
   writer rule — the recommendation — it is a sentence and can follow.
   *Checkable: the fixture set states a range for byte 8–11, or `parseLayout`
   clamps.*

5. **A first run on real hardware.** `cable.md`'s six-row table is still
   unticked, and it is the same bar `exchange-v*` is held to for the same
   reason: a fixture set that no implementation in its intended environment has
   ever met is a claim. Row five in particular settles an interface question
   rather than measuring a nicety — whether a granted port survives the device
   re-enumerating decides whether the editor's one-press promise holds.
   *Checkable: six ticks, in that document.*

6. **`device-v*` is registered where somebody would look for it.**
   [`releases.md`](releases.md)'s table lists three prefixes; the fourth is in
   ADR 0009 and in `device/README.md` and not there. `device/` is already in
   `exclude-paths`, so the mechanical half is done. *Checkable: a fourth row.*

**Not on the list, deliberately:** the prose specification. ADR 0009 and
`device-interface.md` recommendation 3 both say fixtures first and prose once
the format holds still, and this survey is the measurement of whether it does.
Six pending items, two of them blocking, is not "holds still" — but it is a
much shorter list than the week of history behind ADR 0006's dated line, and it
is finite and written down, which is the state a freeze can be decided from.

**Also not on the list:** anything about `exchange/`. §5 has the argument. The
two boundaries are independent and cutting `device-v1` neither needs nor
produces an `exchange-v1`.

---

## 9. Prose that has drifted from the code

Not pending format changes, and listed separately for that reason. Each of
these travels with a format across a repository boundary, which is when a
wrong sentence stops being harmless.

**All six were repaired on 2026-08-27**, and the entries are kept rather than
deleted, for the reason [C1](#c1-chunk-acknowledgement--in-flight)'s is: what a
survey found, against what fixing it turned up, is the part worth reading a
second time. Fixing them turned up **eighteen more of exactly the same kind** —
in six of the seven files named below, and in three that are not named below at
all: [`cable.md`](cable.md), `vorlaut.ino` and `test5_sound.ino`. That is the
finding. This section was written by reading, and reading caught the citation
at the top of a file and missed the one two hundred lines down. The method that
caught the rest was `git log --diff-filter=D --name-only` for what has actually
been deleted, then grepping every tracked file for those names. **No gate
covers this.** `tests/test_links.py` checks paths written out in prose, but its
pattern is `docs/*.md` and nothing else, so a comment naming `build.py` or
`sync.h` has never been anybody's to catch but a reader's.

- **[`frozen-references.md`](frozen-references.md) names five test files that
  no longer exist**, two of them in the present tense — *"`test_layout_format.py`
  stays as it was and keeps doing the live three-way comparison"*. That
  comparison does still happen, in `test_layout_frozen.py`, which feeds the
  bytes node just wrote into the compiled C reader. The claim is right and the
  file name is wrong. *Repaired, and the third party named for what it now is:
  a captured value where `layout_format.py` was a live opinion.* **Three more
  present-tense claims, not two** — the last three rows of "What is still only
  checked against itself" each say a thing is checked by a test that went on
  2026-08-22, which is the one section where a wrong name reads as coverage
  that exists. `static/tts/level.js`, `tiles.js` and one comparison of the tile
  test's three had drifted the same way.
- **`layout_format.h` and `layout_format.ts` both open by citing deleted
  files** — `build.py`, `layout_format.py`, `static/layout_format.js`,
  `tests/test_layout_format.py`. `layout_format.h` is the file another
  repository would pin. *Repaired.* **Three more, all further down.**
  `layout_format.h`'s stride block says the numbers *"have to agree with
  layout_format.py"*, which is the one sentence in that header a second
  implementer would act on. `layout_format.ts` cites `LANGUAGE_CODES in
  layout.py`, which is `device/fixtures/language.expected.json`'s statement
  now, and `renderLayoutBin()`'s own docstring promised "as build.py would
  write them".
- **`cable_format.h` carries a comment with no `#define` under it**, describing
  the bookkeeping file the Wi-Fi sync kept. The constant went with the radio;
  the paragraph stayed. *Repaired as the record of why the constant is absent.*
  **Three more citations in the same file** — `pair_format.h` as a live
  sibling, and `sync.h` twice, once for the manifest's line format and once for
  the name `/.part` was said to share with a sweep that no longer runs.
- **`cable.h` still says "This does NOT replace sync.h. Both are compiled in
  and both work."** `sync.h` was deleted on 2026-08-23. *Repaired, including
  what the sentence promised and did not get: the deletion happened with the
  real-hardware bar unmet, because the far end of the Wi-Fi path had gone
  first.* **A second `sync.h` in the same file**, on the `/.part` rename — and
  `cable.md` carries that one too, in a paragraph that contradicts itself four
  lines later.
- **`device-interface.md`'s evidence table records SPEC.md as 1.1.0 draft.**
  It is 1.2.0, and has been since the day after that table was written.
  *Repaired; the row now carries the move, which is itself evidence for the
  argument the table is making.*
- **`negation.md` still says "nothing built"** and names a version that has
  been spent. See [P1](#p1-ext-lautstark-negated-is-recommended-and-unwritten).
  *Repaired.* **The spent version is named four times, not once** — twice as
  the bump to make, and twice as the importer version that ignores the field
  harmlessly, which moves with it.

- **Not in this section at all: the sketch.** `vorlaut.ino` opens by saying
  *"layout.h and the contents of data/ are produced by build.py"* — three names
  in one sentence, none of which exists — and names
  `tests/test_layout_format.py` as what compiles `layout_format.h` on the
  computer. It is the file a second implementer reads first, for the same
  reason `layout_format.h` is the file they would pin. `test5_sound.ino` calls
  16000 *"the rate build.py writes the WAVs at"*. *All repaired.*

**One thing this pass did not find:** a place where the prose is right and the
code is wrong. Every item above is a pointer that moved. The nearest thing to a
finding of the other kind is a gap rather than a contradiction, and it is
recorded in `frozen-references.md` where the rest of that list lives: the
`onnxruntime-web` version is written in three files that have to agree,
`renovate.json5` explains at length why, and nothing checks that they do.
