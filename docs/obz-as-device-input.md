# The `.obz` as the device build's input, and the compiler as a package

**Status: proposal, nothing built. 2026-08-27.** Written to be argued with.

The proposal weighed here: the editor's only output becomes the `.obz` it
already writes, a device-side compiler turns that into `layout.bin` and the
tiles, the compiler ships as an npm package pinned the way `design`,
`bildquelle`, `sicherung` and `stimmquelle` are pinned, and the boundary that
[`adr/0006`](../adr/0006-builder-and-hardware-one-repo.md) draws around a folder
becomes a package with a specified input.

Everything rests on one question, so it is answered first.

---

## The answer

**No. Neither `.obz` this editor writes carries what the device build uses — and
there are two of them, with almost exactly complementary gaps.**

Neither is a candidate on its own, and combining them does not produce one
either, because three of the gaps are not oversights. They are decisions with
their reasoning already written down, and each of them forbids the very thing
the `.obz`-as-input premise needs.

| | Talker `.obz` — `obf.ts` | App package `.obz` — `app_package.ts` |
|---|---|---|
| Symbol **pixels** | **none, ever** — `document = { root, boards, files: {} }` ([`obf.ts:391`](../src/data/obf.ts)), and `checkLicensing()` refuses them for METACOM outright | present, but resampled to 512 and with the cross already drawn |
| **Audio** | **none** — `sounds: []` on every board | Ogg Opus at 24 kHz, which the device may not be given |
| `sleep_timeout_seconds` | ✓ `ext_vorlaut_sleep_timeout_seconds` | **absent, by decision** — [ADR 0001](../adr/0001-two-ext-namespaces.md) |
| `layout.language` | ✓ `board.locale` is the field itself | **absent** — `locale` comes off the *voice* ([`localeFor()`](../src/data/app_package.ts)) |
| Voice id | ✓ `ext_vorlaut_voice`, whole | prefix stripped: `piper:`/`azure:` gone ([`app_package.ts:633`](../src/data/app_package.ts)) |
| `negated` | ✓ `ext_vorlaut_negated`, a flag | **absent** — the cross is baked into the PNG |
| Sets, order, names, slot text | ✓ | ✓ |

Read the two columns together and the shape is plain. The talker export carries
every *fact* the build needs and none of the *bytes*. The app package carries
bytes and drops the facts. That is not a coincidence and not a pair of bugs: one
is a document about a board, the other is a delivery for a tablet, and the
device build is neither.

### The one thing that is a genuine hole

The two paths disagree about a slot holding nothing at all. `runBuild` calls
`storeTile("")`, which renders `renderSymbol(null)` — the grey placeholder cross
— and puts a real tile on the device for a key that has no word and no picture
([`local.ts:917`](../src/backend/local.ts),
[`tiles.ts:434`](../src/data/tiles.ts)). `diyBoards()` writes no button at
all and leaves the grid cell null
([`app_package.ts:706`](../src/data/app_package.ts)). So the same empty slot
is *"a picture is missing"* on the device and *"nothing is here"* on the tablet,
and `placeholder()`'s own comment says it means the first.

Nothing catches this, for exactly the reason the brief predicts: the two paths
never meet, so no test compares them. It is small, it is worth fixing, and it is
worth fixing whether or not anything is ever split. It is also the only one —
every other divergence in the table above is somebody's recorded decision rather
than a slip.

---

## 1. What `runBuild` actually consumes

[`runBuild()`](../src/backend/local.ts) reads
`store.readLayout()` and takes thirteen things. Nine come out of the `Layout`:

1. `layout.sets`, in order, with the count going into the header byte
2. `set.name` — encoded, then cut at 32 **bytes**, not 32 characters
3. `set.symbol` — the set key's tile
4. `set.slots`, the first four and no more (`SLOTS_PER_SET`)
5. `slot.symbol`
6. `slot.negated`
7. `slot.text`
8. `layout.language` — the index into `LANGUAGE_CODES`, header byte 7
9. `layout.sleep_timeout_seconds` — a `uint32`, little-endian

The tenth is `chosenVoice(layout)` ([`local.ts:856`](../src/backend/local.ts)),
which is `layout.voice` or else `startsOn(layout.language)` — a fallback derived
from the *shipped voice catalogue*, deliberately not from the network, because
the answer goes into the name of every WAV.

The remaining three are not in any document and cannot be:

11. **The pixels each reference resolves to.**
    [`picture()`](../src/backend/local.ts) hands back an ARASAAC or uploaded
    picture out of the `symbols` store, or a METACOM picture read live out of a
    folder somebody licensed and connected in this browser.
12. **A synthesiser**, with the Azure key from settings where there is one — and
    correctly not in any exported file.
13. **A clock's worth of nothing**: the build is otherwise pure, which is why
    the file names are content hashes and a rebuild reuses everything unchanged.

Items 11 and 12 are the whole argument, and §3 is about them.

---

## 2. Both `.obz` writers, and which one the brief names

The brief points at `diyBoards()`, which is right about where a talker package
is written for a *tablet* and wrong about which document is the natural
candidate. There are two writers:

- [`obf.ts`](../src/data/obf.ts) — `exportObz(layout)` at line 1044, through
  `layoutToDocument()` at line 302. The `ext_vorlaut_*` namespace. It
  **round-trips**: `documentToLayout(layoutToDocument(x)) == x` is a test
  ([`tests/unit/obf_roundtrip.test.ts`](../tests/unit/obf_roundtrip.test.ts)),
  which makes it the closest thing this project has to "the Layout, as a file".
- [`app_package.ts`](../src/data/app_package.ts) — `buildAppPackage()` at line
  582, `diyBoards()` at 684. The `ext_lautstark_*` namespace,
  [`exchange/SPEC.md`](../exchange/SPEC.md), one-way by design.

[ADR 0001](../adr/0001-two-ext-namespaces.md) already decided that these two
namespaces stay apart, and its reason is the reason the compiler cannot simply
read the app package: *"`sleep_timeout_seconds` is about a device with four keys
and a battery; nothing in `ext_lautstark_*` is about anything of the sort."*

So if any `.obz` were to be the compiler's input, it would have to be the talker
export, which has the namespace for device knowledge already. What that one
lacks is not facts. It is every single byte of picture and sound.

---

## 3. Three walls, and none of them is a version bump

### 3.1 A METACOM picture may never enter a file

This is the hard one, and it is not negotiable by anybody in this repository.

`picture()` resolves a `metacom:` reference live, out of a directory handle,
and copies it nowhere. [`checkLicensing()`](../src/data/obf.ts) sits at the
top of `writeObz()` so that a talker `.obz` carrying METACOM pixels *cannot come
into existence* — the comment says exactly why it is a door rather than a
warning. Even the Sicherung, which exists to carry everything, carries none:
*"METACOM never enters that store"* ([`backup.ts:47`](../src/data/backup.ts)).

`exchange/SPEC.md` §5.2 is the only place a licensee may bake them, the step is
narrow and named, and it ends with a sentence written for this exact proposal:

> **On the builder side**, an app-package export that bakes pixels MUST be a
> separate entry point from the talker export — a different function, not the
> same one behind a flag. The talker's guarantee is that it never writes a
> symbol as pixels, and a guarantee enforced by an argument is one flag away
> from being untrue. Keep it structural.

METACOM is one of the two symbol sources this editor has. So "the `.obz` is the
compiler's input" is false for roughly half the boards this project exists to
build, and no version of any document format can make it true.

There is one honest way past this, and it is worth stating because it changes
the shape of the whole proposal rather than defeating it: **if the compiler runs
in the same browser, the input is a value and not a file.** A `PackageInput` in
memory is not a copy of the collection; a `.obz` written to disk is. That
distinction is the difference between a legal design and an illegal one, and any
version of this proposal has to say which it means.

### 3.2 The device's WAV may not come from the package's Opus

[ADR 0008](../adr/0008-audio-masters-derived-artefacts.md) settles this in one
line: *"Both delivered artefacts are derived from that master, and never from
each other."* The master is at the voice's native rate, 22.05 or 24 kHz. The
device gets a 16 kHz downsample; the package gets a 24 kHz Opus encode.
`bakeSound()`'s comment names the shortcut and refuses it
([`app_assets.ts:99`](../src/data/app_assets.ts)).

A compiler handed the package's `.opus` would have exactly the choice ADR 0008
forbids: decode a lossy 24 kHz stream and downsample it to 16 kHz. Handed the
talker `.obz` it has nothing at all, because `sounds` is always empty there.

Which leaves re-synthesis — and re-synthesis needs the voice id, which the app
package strips the backend off, and the Azure key, which no export carries and
none should. The compiler would have to be handed a synthesiser. That is
item 12, and it stays in the editor.

### 3.3 A tile is rendered from the source, not from a delivered picture

`renderSymbol()` takes the source at its own size, computes `fillColour()` from
its edge pixels, and Lanczos-resamples straight to 128
([`tiles.ts:511`](../src/data/tiles.ts)). `bakeImage()` fits the same source
into 512 through a canvas and encodes a PNG
([`app_assets.ts:38`](../src/data/app_assets.ts)) — and says so in its first
line: **"Not the device's tile."**

Compiling a tile out of that PNG resamples twice. For an ARASAAC pictogram
larger than 512 the pixels are provably not the pixels `tiles.ts` produces
today, `fillColour()` reads a different edge, and the alpha has been through a
canvas premultiply that `tiles.ts` has hand-written helpers to avoid. Every tile
hash changes, which means `tests/reference/tiles.lock.json` is invalidated, the
`device/fixtures/tile` cases are re-authored, and the first rebuild after the
move re-sends every tile over a 115200-baud cable.

That is not fatal on its own — it is a one-time cost with a `TILE_PIPELINE` bump
to make it legible, which is what that constant is for. It is fatal to the claim
that the change is *bookkeeping*.

### 3.4 The negation cross is two different drawings

`negateInto()` fills a hard-edged 9-pixel cross into the composed tile, without
antialiasing, *because a tile is compared byte for byte against a frozen
reference* ([`tiles.ts:449`](../src/data/tiles.ts)). `crossOut()` strokes an
antialiased cross, stretched to the box rather than square, onto the 512 PNG
([`app_assets.ts:84`](../src/data/app_assets.ts)).

The app package has no negation flag and will not get one: SPEC §4.3 closes the
button extensions at v1, and `app_assets.ts` gives the reason — a flag *"would
need the spec, the fixtures and the Android viewer to move together before one
child saw one cross."* So a compiler reading the app package receives a picture
that has already been crossed out with the wrong cross, cannot tell that it has,
and has no un-crossed source to fall back to.

The talker `.obz` gets this right — `ext_vorlaut_negated` is a flag — and has no
picture to apply it to.

---

## 4. The shape that does work, and the repository already built it once

Strip the three walls back and what is left is a real and useful boundary. The
device build is a **pure function over a layout plus resolved media**, wrapped
in two impure services — a picture resolver and a synthesiser — that must stay
on the editor's side because of a licence and an ADR.

That is not a new design. It is `buildAppPackage()`'s design, stated in
`PackageInput`'s own docstring:

> Resolution is somebody else's job — it needs a canvas, a folder somebody
> licensed and a synthesiser — which is what keeps this half a pure function
> over data and therefore checkable without a browser.

So the package's input is not a `.obz`. It is a `DeviceBuildInput`: the layout,
a `Map` of tile-ready sources keyed by `pictureKey()`, a `Map` of 16 kHz WAVs
keyed by the same fingerprint `storeAudio()` computes, and the language and
sleep settings. `runBuild()`'s orchestration — the log, the reuse-by-name, the
sweep of leftovers, the missing-symbol hints — stays in the editor, because
every line of it is about a person watching a progress list.

This is a smaller move than the proposal describes and a more honest one. It is
also the move that leaves ADR 0009's fixtures pointing at something real: the
fixtures assert what `renderLayoutBin` and `renderSymbol` must produce, and both
are inside the package under this shape.

---

## 5. What is in the package, checked against `device-interface.md` §1

§1 enumerates the interface. Held against what moving would actually take:

| §1 row | Moves | What stays behind, and why |
|---|---|---|
| `layout.bin` | `renderLayoutBin`, `hashBytes`, the strides, `LAYOUT_VERSION`, `LAYOUT_MAGIC`, `LAYOUT_BIN` | — |
| `t<hash>.bin` | all 535 lines of `tiles.ts` | — |
| `a<hash>.wav` | `audio_format.ts`'s three constants | the synthesis chain, which is `stimmquelle` and Azure |
| The name rule | `hashBytes()`, the `t`/`a` + 32 hex shape | — |
| The language byte | `LANGUAGE_CODES` | **also needed by the editor** — see below |
| The cable | `tools/cable.js` | `src/backend/cable.ts`, see §7 |

Three of `layout_format.ts`'s thirteen exports are read by editor code that has
nothing to do with the device build, and that is the detail §1 could not have
seen because it was enumerating the *interface* rather than the *file*:

- `SLOTS_PER_SET` — [`obf.ts:665`](../src/data/obf.ts), where
  `normalizeLayout()` refuses a set of five slots and pads a short one to four.
  That is the editor's own shape rule and simultaneously a device constant.
- `LANGUAGE_CODES` and `DEFAULT_LANGUAGE` —
  [`obf.ts:44`](../src/data/obf.ts), [`app_package.ts:81`](../src/data/app_package.ts),
  [`shell/voices.ts`](../src/shell/voices.ts). The *tablet* export falls back
  to this table, and the settings sheet paints from it.
- `HASH_BYTES` and `LAYOUT_BIN` — [`folder.ts:32`](../src/backend/folder.ts),
  [`built.ts`](../src/data/built.ts). Both of those are device-side and travel.

None of that blocks anything. The editor pins the package and imports the table
from it, which is what pinning is for. But it means the package is not a leaf:
`obf.ts`, `app_package.ts` and the settings sheet would all import from it, so a
device-format release becomes a bump the tablet export and the settings sheet
also take. Worth knowing before, rather than discovering at the first release.

---

## 6. Where the tile rendering runs

**Browser-only, and say so in the README rather than discovering it.**

`tiles.ts` uses `OffscreenCanvas` or a DOM canvas in `scratch()`, and takes
anything `drawImage` accepts. `bildquelle` and `stimmquelle` are browser-only
too, so this is a shape this project already runs four times over and pays for
in a known way — an `/browser` entry point, and a node-side test surface that
covers only the parts that need no canvas.

That split is not hypothetical here: `renderLayoutBin` needs no canvas at all,
`toRgb565Be` and `rgbTo565` need none, and
[`tests/unit/device_fixtures.test.ts`](../tests/unit/device_fixtures.test.ts)
already imports exactly those three from `tiles.ts` and runs under node. So the
package would have a node-safe core and a browser-only renderer on top, and the
existing fixture runner tells you where the line is because it is already
standing on it.

One real cost: `tests/test_tile_render_js.py` executes `src/data/tiles.ts` as
text against pixels frozen from Pillow. After a move that test either follows
the package or reads a pinned copy, and the second one is a paraphrase of the
kind [`frozen-references.md`](frozen-references.md) already has an account of.

---

## 7. The cable client, and where the seam already is

**The seam is drawn and does not need moving.** It is the first paragraph of
[`src/backend/cable.ts`](../src/backend/cable.ts):

> The protocol is not here. `tools/cable.js` is the browser's half of the wire
> and stays where it is, because it is the half `tests/test_cable_format.py`
> drives against the C reader compiled out of the sketch — byte for byte, in
> both directions. A copy of it inside `src/` would be a second implementation,
> and the tested one would not be the shipped one. So this file is the part
> that has a browser in it, and that file remains the part that does not.

So `tools/cable.js` — `Cable`, `plan()`, `push()`, the CRC, the framing —
travels, and `src/backend/cable.ts`'s 199 lines stay: Web Serial, the port
picker, `GREETINGS`, the progress callbacks, the `Trouble` codes the sheet
renders.

The interface between them is already clean. `plan()` takes a
`Map<name, {bytes}>`, `have` as the device reported it, and the free space
([`cable.js:401`](../tools/cable.js)) — no `Layout`, no store, no browser.
`builtFiles()` produces that map out of the `data` store and is the only thing
in between. If the package exports `plan`/`push`/`Cable` and the editor keeps
`builtFiles()` and the Web Serial half, nothing has to be rewritten to make the
seam; it is where somebody already put it.

---

## 8. What the editor loses

**Less than the question assumes, and it is worth being precise about why.**

The editor does not preview the device. `tiles.ts` is imported by exactly one
module in `src/` — `backend/local.ts`, for the build. What the editor draws is
CSS: `.pick__preview` is `aspect-ratio: 1` with a comment saying *"a tile is
116px inside a 128px display — data/tiles.ts"*
([`ui.css:1602`](../src/styles/ui.css)), and the negation cross in the
editor is a CSS overlay in `--danger`, not `negateInto()`.

So the geometry and the red are already written out three times — `tiles.ts`,
`app_assets.ts`, `ui.css` — and each place says so and gives its reason. The
package takes one of the three. The editor keeps knowing a tile is square
because a stylesheet says so, which is exactly as true after the move as before.

What the editor genuinely loses is the ability to change the tile pipeline and
see the result in one commit. Today `TILE_PIPELINE` is bumped, every hash moves,
`tiles.lock.json` and the fixtures move with it, and the whole thing is one
reviewable change. Afterwards it is a package release, a bump, and a window in
which `main` here does not build the tiles `main` there renders. That is ADR
0006's third argument, and this proposal does not answer it — it relocates it.

---

## 9. `device/fixtures/` and ADR 0009

**They keep earning their place, and the argument that they might not is
backwards.**

The proposal's claim is that under an npm-package boundary the writer and reader
are never separated, so the live compile-both check survives and the fixtures
become redundant. The first half is true. The second does not follow, and
[ADR 0009](../adr/0009-device-interface-fixtures.md) already contains the
refutation:

> None of the four gaps above is about having two repositories, and none can be
> closed by freezing.

The fixtures exist because `layout.lock.json` holds seventeen cases and **refuses
none** — a capture can only contain what its writer emits, so no amount of
freezing reaches `parseLayout`'s five refusal branches. That is a fact about
lock files, not about repository boundaries. The index today holds 39 fixtures
across six kinds — 18 layout, 8 audio, 7 cable, 4 tile, 1 names, 1 language, at
`device_interface_version` `0.1.0-draft` — and the refusal cases in it are ones
no implementation here will ever produce. A package boundary does not write a
single one of them.

Two things about them *would* change, and both are improvements:

- **They become the package's published conformance set**, which is the shape
  `exchange/` already has and which §4 of `device-interface.md` argued for. That
  is a promotion, not a demotion.
- **Their ownership question sharpens.** §4 of that document says `device/`
  belongs to neither half *because neither party can be forced to move* — a
  talker on a shelf is fixed by a person with a cable or not at all. If the
  compiler becomes a package the firmware repository publishes, and the editor
  pins it, then the fixtures must **not** go with the compiler. They would then
  live with the writer and be pinned by the reader, which is exactly the
  arrangement §4 rejected. `device/` becomes the third repository, or the
  proposal has handed the format back to one implementation.

There is one honest simplification. `test_layout_frozen.py` and
`test_cable_format.py` hold the two implementations against each other on the
same run, and under this proposal they still can, because the compiler's source
would sit beside the firmware. So the fixtures stay a third check rather than
becoming the only one — which is what ADR 0009's Consequences already say they
are. Nothing is deleted. The `stereo-44k` divergence, the four holes the first
mutation run found, the timing class that no fixture reaches: all unchanged.

---

## 10. The cost, against the flow this project already runs

The proposal's own framing is right: cost a format change against four existing
pinned packages rather than against nothing. Held to that:

**What is the same.** Tag, `npm install`, a lockfile line, a bump commit. This
project does that routinely and has tooling for the failure mode —
`tools/installcheck.mjs` runs before all three suites precisely because a stale
`node_modules` used to run green.

**What is not the same, and it is the whole cost.** The four pinned packages are
consumed by software that can be redeployed. Pages goes out on every push to
`main`. A talker is fixed by a person with a cable, in a house nobody in this
repository knows about. A wrong bump in `bildquelle` is a bad render somebody
sees and reports; a wrong bump in a device compiler is a device that parses and
is wrong, which `device-interface.md` §6 spends a section on: *a key that says
the wrong sentence is worse than one that says nothing, because it is said to
somebody who believes it.*

**And the window.** ADR 0006's "one commit is one change" is not an aesthetic
claim. It is that a format change lands as a unit that is either right or wrong
as a unit, with no interval in which two `main`s disagree. A package boundary
buys that interval back in exchange for a version number — which is a real trade
and a defensible one for a library, and a worse one for a format whose reader is
a soldered board.

**The measurable part.** Four bumps a week is comfortable. `firmware/` changed
on five of the last seven days, `layout_format.ts` had a breaking change on
2026-08-25, and `cable_format.h` is having one **today** (§11). Under this
proposal each of those is a release plus a bump instead of a commit.

---

## 11. The argument with ADR 0006, and whether the counter holds

ADR 0006:

> The shared code that *is* genuinely shared already left … because they are
> used by more than one product. That is the actual criterion, and firmware and
> builder do not meet it: they are used by each other and by nothing else.

The counter offered: a **format** with two implementations is exactly a shared
thing, and the criterion was about products rather than formats.

**The counter is half right, and the half that fails is the load-bearing half.**

Where it is right: 0006's sentence really does conflate two questions. "Is this
used by more than one product" is a question about *deployment*, and "does this
have more than one implementation that must agree" is a question about
*specification*. They come apart, and 0006 does not notice that they do. The
proof is in this repository already — `exchange/SPEC.md` is a format with two
implementations, and it got a specification, fixtures, a tag prefix and a pinned
consumer, all without anybody arguing it was "used by more than one product"
first. The criterion 0006 states is not the criterion this project actually
applied.

Where it fails: **recognising that a format is a shared thing is an argument for
giving it a specification, not for moving the code.** That is precisely what ADR
0009 did on 2026-08-26 — `device/`, owned by neither half, 39 authored fixtures,
`device-v*` reserved. The format has already been treated as the shared thing it
is. What has *not* happened, and what this proposal actually asks for, is moving
one implementation of it into a package — and that is a claim about deployment
after all, which is the question 0006 was answering and got right.

There is also a plain factual point. `bildquelle` and `stimmquelle` left because
`mitreden` needed them: a second product, existing, running. Nothing consumes
`layout.bin` but this firmware, and nothing writes it but this builder. 0006's
condition 2 asks for a second consumer to *appear*, as an event. It has not.

**So 0006 needs one amendment and does not need overturning.** The Why section's
last paragraph should say that the criterion for *extraction* is a second
consumer, and that the criterion for *specification and fixtures* is a second
implementation — which the device format met, which is what ADR 0009 answered,
and which is not the same question. That is a correction to the reasoning, made
in 0006's own Examined section where the 2026-08-26 line already sits. The
decision is unchanged.

---

## 12. The two sessions running beside this one

**The cable acknowledgement change is the strongest evidence against this
proposal, and it landed while this was being written.**

Branch `claude/amazing-chaplygin-9fe616` carries two commits: `1bdfdda`
*"acknowledge every window of a cable transfer"* in `firmware/`, and `e42934a`
*"the browser waits for each window to be acknowledged"* in `tools/cable.js`,
`src/backend/cable.ts` and `tools/cable_mock.js`. The second one's footer reads:

> BREAKING CHANGE: `CABLE_VERSION` is 2 here too. The two halves move together.

That is one change to one format, in one branch, reviewable as a unit, with the
mock gaining a deliberate stall so that a client which never waited cannot pass
against a `Map` that answers instantly. Under this proposal it is a release of
the compiler package, a bump here, and an interval during which the two `main`s
speak different protocol versions — for a change whose entire purpose is fixing
a device that went silent at the bench.

**It does not change the answer to the central question.** The `.obz` gap table
is about `layout.bin`, tiles and audio; the cable is a different subformat and
its client already sits on the clean side of the seam (§7). If it merges before
this proposal is acted on, §7 is unaffected — `plan()` and `push()` still take a
file map — and §10's "four bumps a week" becomes five.

The **format-freeze survey** on `claude/inspiring-stonebraker-c80b26` has
produced no commits yet. It is the more consequential input of the two, because
ADR 0006's condition 1 is *"if `layout.bin` and the cable protocol are ever
frozen for good"*. If that survey finds the pending changes are few and
enumerable, condition 1 moves closer and §10's cost drops — the interval matters
less when the format stops moving. If it finds more pending changes, this
proposal gets worse, and it is already not being recommended. **This document
should be re-read against that survey when it lands, and §10 is the section it
would change.**

---

## Recommendation

1. **The `.obz` cannot be the device build's input.** Not the talker export,
   which carries no pixels and no sound and may never carry METACOM pixels; not
   the app package, which drops the language, the sleep timeout, the voice's
   backend and negation, and whose media may not be re-derived into the
   device's. This is the answer to the question everything rested on, and it
   holds whether or not anything is ever split.

2. **Fix the empty-slot divergence** (§0). A slot with no word and no picture
   gets a "picture is missing" cross on the device and an empty cell on the
   tablet. Small, real, uncaught, and unrelated to any of this.

3. **If a boundary is wanted, it is `DeviceBuildInput`, not `.obz`** (§4) — the
   layout plus resolved sources and resolved WAVs, with the resolver and the
   synthesiser staying in the editor because a licence and ADR 0008 require it.
   Drawing that interface *inside* this repository costs one refactor, is worth
   having on its own, and is the thing that would make a later split cheap — the
   same argument ADR 0009 made about the fixtures, applied one level up.

4. **Do not move anything yet.** Condition 2 of ADR 0006 has not been met and
   `layout.bin` has not stopped moving. Recommendation 3 does not need it to be.

5. **Amend ADR 0006's Why** (§11) with the distinction its own sentence misses:
   a second *consumer* is the test for extraction; a second *implementation* is
   the test for a specification. The decision stands; the reason given for it is
   one sentence short.

## Should this be an ADR?

**No, and for a different reason than `device-interface.md` gave.**

That document stayed in `docs/` because re-affirming a decision is not a new
decision. This one is not re-affirming anything — it is answering a question
(*"is the `.obz` sufficient?"*) with a measurement, and a measurement belongs
in `docs/` beside the other one.

Two things in it would earn ADR status, and neither is this document:

- **Recommendation 3, if adopted.** `DeviceBuildInput` is a decision with a
  consequence somebody will later want to tidy away — a seam inside one
  repository, with no repository boundary to justify it, which looks exactly
  like indirection for its own sake from outside. That is `adr/README.md`'s
  shape.
- **Recommendation 5**, which is an edit to ADR 0006 rather than a new record.
  0006's Examined section is where dated corrections go; this is a third one
  beside the pairing codes and the format list.

If this proposal is ever revived and accepted, *then* it needs an ADR, and that
ADR supersedes ADR 0006 rather than amending it — because moving one
implementation of the device format into a package is the decision 0006 refused,
and reversing a decision is exactly what supersession is for. Nothing here
reaches that bar today.
