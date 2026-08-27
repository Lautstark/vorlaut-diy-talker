# The `.obz` as the device build's input, and ~~the compiler as a package~~

**Status: the measurement stands, the package half is superseded, and the "not
yet" is spent. Written 2026-08-27 as a proposal; all of it was answered the same
day** — the package half by
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md), and
recommendation 4's *"do not split yet"* by
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md), which decided the
split. The reasoning is
kept where it still holds and struck through in words where it does not — a
document that goes on describing a design nobody built is worse than no
document.

**What stands, and is the foundation for everything built since:** an `.obz`
can carry everything the device build uses, in the four forms §2 works out.
§§1–5, §8 and §10 are the measurement and are unchanged.
[ADR 0010](../adr/0010-device-shaped-obz-export.md) is that export, built.

**What is superseded is the second half of the title.** This file proposed that
the editor keep a device-shaped dependency and pin a **compiler package**
published by the firmware's repository, with the boundary
[`adr/0006`](../adr/0006-builder-and-hardware-one-repo.md) draws around a folder
becoming a package with a specified input. That is not the plan.
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) decided
something simpler on 2026-08-27: **the editor exports a file and stops**, and
the talker's own repository gains a page that compiles that file and sends it —
no package, no pin, no bump, no cross-repo code dependency of any kind. What
changed is *who compiles it*, not whether an `.obz` can be compiled. So §§6, 7,
9 and 11 below are costings for a route nobody is taking; they are kept because
they are what the cheaper answer had to beat, and each is marked where it
starts.

~~The proposal weighed here: the editor's only output becomes an `.obz`, a
device-side compiler turns that into `layout.bin` and the tiles, the compiler
ships as an npm package pinned the way `design`, `bildquelle`, `sicherung` and
`stimmquelle` are pinned.~~ The editor's only output does become an `.obz`, and
a compiler does turn it into `layout.bin` and the tiles. The compiler is a page
in the talker's repository rather than a package the editor pins.

Everything rests on one question, so it is answered first.

---

## The answer

**Yes — an `.obz` can carry everything the device build uses. What
[`diyBoards()`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/app_package.ts) writes today does not, but every gap
is a matter of *form* rather than of *presence*, and each one has a determined
answer.**

The build needs pictures and it needs sound. The talker package already carries
both. It carries them in the shapes a tablet wants — a 512-pixel PNG with the
negation cross already drawn, and Ogg Opus at 24 kHz — and each of those is the
wrong shape for a device that blits RGB565 and plays 16 kHz PCM. That is a
specification to write, not a wall.

| What `runBuild` uses | What `diyBoards()` emits | What a device-shaped export must emit |
|---|---|---|
| The source picture, at its own size | PNG fitted to 512, canvas-resampled | **the source, unresampled** |
| `slot.negated` | the cross baked into those pixels | **a flag** (`ext_vorlaut_negated`) |
| 16 kHz mono 16-bit WAV | Ogg Opus at 24 kHz | **the WAV**, from the same master |
| `layout.language` | `locale`, derived from the *voice* | **the field itself** |
| `sleep_timeout_seconds` | absent | `ext_vorlaut_sleep_timeout_seconds` |
| Sets, order, names, slot text, the ring | ✓ | ✓ unchanged |

Every row on the right already exists somewhere in this repository. The four
`ext_vorlaut_*` rows are what [`obf.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/obf.ts) writes today. The
media rows are what the build itself resolves. Nothing has to be invented; it
has to be assembled into one export that does not exist yet.

### The correction this document is making

An earlier version of this file answered **no**, on the grounds that a METACOM
picture may never enter a file. That is false, and it is worth saying where it
went wrong because the error is instructive.

`exchange/SPEC.md` §5.2 does not forbid baking METACOM pixels. It forbids baking
them **into a file that then travels**, and it blesses one narrow case by name:

> A METACOM licensee may bake their own METACOM symbols into a package **for the
> person they support**, and put it on that person's device by sideload.

The device build is *already* that case. `picture()` resolves a `metacom:`
reference out of the licensed folder, `renderSymbol()` renders it into a
`t<hash>.bin`, and the cable pushes it onto that person's talker. There is no
gate anywhere on that path and there should not be. METACOM pixels have reached
the device since the day the device worked.

What the earlier version did was test the two *existing* exports as candidates
and report that neither fits. Of course neither fits: one is a document meant to
be handed to other AAC software, so it carries references and no pixels; the
other is a delivery for an Android tablet, so it carries pixels in Android's
shapes. **The device build is a third thing — a delivery, to a different
device** — and asking which of two ill-fitting exports to reuse is the wrong
question. The question is what a device-shaped export has to hold.

---

## 1. What `runBuild` actually consumes

[`runBuild()`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/backend/local.ts) reads `store.readLayout()` and takes
thirteen things. Nine come out of the `Layout`:

1. `layout.sets`, in order, with the count going into the header byte
2. `set.name` — encoded, then cut at 32 **bytes**, not 32 characters
3. `set.symbol` — the set key's tile
4. `set.slots`, the first four and no more (`SLOTS_PER_SET`)
5. `slot.symbol`
6. `slot.negated`
7. `slot.text`
8. `layout.language` — the index into `LANGUAGE_CODES`, header byte 7
9. `layout.sleep_timeout_seconds` — a `uint32`, little-endian

The tenth is `chosenVoice(layout)`, which is `layout.voice` or else
`startsOn(layout.language)` — a fallback derived from the shipped voice
catalogue, deliberately not from the network, because the answer goes into the
name of every WAV.

The last three are the ones that decide the shape of the export:

11. **The pixels each reference resolves to** — an ARASAAC or uploaded picture
    out of the `symbols` store, or a METACOM picture read live out of a folder
    somebody licensed and connected in this browser.
12. **A synthesiser**, with the Azure key from settings where there is one.
13. Nothing else. The build is otherwise pure, which is why the file names are
    content hashes and an unchanged Sammlung rebuilds to unchanged bytes.

Items 11 and 12 look at first like the reason the export cannot be the input.
They are the opposite: they are the reason it *should* be. §4 works that out.

---

## 2. The four form rules, and why each one is what it is

### 2.1 The pictures must be the sources, not the tablet's PNGs

`renderSymbol()` takes the source at its own size, computes `fillColour()` from
its edge pixels, and Lanczos-resamples straight to 128
([`tiles.ts`](../loader/src/tiles.ts)). `bakeImage()` fits the same source into 512
through a canvas and encodes a PNG ([`app_assets.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/app_assets.ts))
— and says so in its own first line: **"Not the device's tile."**

Compiling a tile out of that PNG resamples twice. For any pictogram larger than
512 the result is provably not the pixels `tiles.ts` produces today,
`fillColour()` reads a different edge, and the alpha has been through a canvas
premultiply that `tiles.ts` has hand-written helpers specifically to avoid.
Every tile hash would move, `tests/reference/tiles.lock.json` would be
invalidated, and the first rebuild after the change would re-send every tile
over a 115200-baud cable.

Carrying the source instead makes all of that go away: the compiler receives
exactly what `renderSymbol()` receives today, and the frozen tiles stay frozen.

`images/` in a device-shaped export therefore holds **what the renderer needs**,
not what a button needs. That is the single most important sentence in this
document, and it is the one that the shape of the app package hides.

### 2.2 Negation must be a flag

`negateInto()` fills a hard-edged 9-pixel cross into the composed tile, without
antialiasing, *because a tile is compared byte for byte against a frozen
reference*. `crossOut()` strokes an antialiased cross, stretched to the box
rather than square, onto the 512 PNG. They are two different drawings on
purpose, and each comment says why.

The app package has no negation flag and will not get one: SPEC §4.3 closes the
button extensions at v1, and `app_assets.ts` gives the reason — a flag *"would
need the spec, the fixtures and the Android viewer to move together before one
child saw one cross."* That reasoning is about `ext_lautstark_*` and does not
reach `ext_vorlaut_*`, where [`obf.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/obf.ts) has written
`ext_vorlaut_negated` all along. [ADR 0001](../adr/0001-two-ext-namespaces.md)
is precisely the decision that keeps that possible.

So: the flag travels, the source travels un-crossed, and
`renderSymbol(source, { negated })` runs exactly as it runs today.

### 2.3 The sound must be the device's WAV

[ADR 0008](../adr/0008-audio-masters-derived-artefacts.md) settles the audio in
one line: *"Both delivered artefacts are derived from that master, and never
from each other."* The master is at the voice's native rate; the device gets a
16 kHz downsample, the tablet gets a 24 kHz Opus encode.

That rule is often misread as an obstacle here, and it is not. It forbids
deriving the device's WAV **from the package's Opus**. It says nothing against
an export carrying the device's WAV, which is the master's own child and is
already sitting in the `data` store with its fingerprint in its name.

So `sounds/` in a device-shaped export holds `a<hash>.wav` — the same bytes the
cable would have sent — and ADR 0008 is satisfied by construction rather than by
care.

### 2.4 The language and the sleep timeout are `ext_vorlaut_*`

`localeFor()`'s docstring is explicit that `locale` is derived from the voice
because *on Android the voice hint is nearly always unavailable*, and that
`layout.language` is *"the language the device shows its own menu in"* — a
weaker answer for a tablet and the only right answer for the device. The two
fields are not interchangeable and the app package correctly carries only the
first.

`ext_vorlaut_sleep_timeout_seconds` is ADR 0001's own worked example of a field
meaningless off this device. Both already exist in the talker export.

---

## 3. What falls out, and it is the best thing in the proposal

Once the export carries the sources and the WAVs, **the compiler needs no voice,
no Azure key and no synthesiser.** Items 10 and 12 of §1 stay in the editor and
stop being part of the interface at all.

What is left for the package to do is small, sharply bounded and entirely
testable:

- render each source to a 128-square RGB565 tile, applying the cross where the
  flag says so
- hash the inputs into `t<hash>.bin` and `a<hash>.wav` names
- write `layout.bin`
- decide what to keep and what to send, and speak the wire (`loader/tools/cable.js`)

Everything about *people* — the progress list, the missing-symbol hints, the
build log's language, the reuse-by-name across rebuilds, the folder picker, Web
Serial — stays on the editor's side, where it belongs.

That is a genuinely clean interface, and it is cleaner than what exists today,
where `runBuild()` interleaves orchestration, synthesis, rendering and format
knowledge in one 210-line function.

### And the export is worth having on its own

A device build today lives in IndexedDB, in one browser, on one machine. There
is no artefact anywhere that says *"this is what is on that talker"* in a form
anybody can diff, archive, or hand to somebody debugging at a bench. The folder
export writes the loose files; it cannot be read back into a build.

A device-shaped `.obz` is that artefact. It is the first format in this project
that can reconstruct a device build without the editor's store — which makes it
useful whether or not any compiler is ever packaged, and which is the same
argument [ADR 0009](../adr/0009-device-interface-fixtures.md) made about the
fixtures: the expensive half of a split turned out to be worth paying for on its
own.

---

## 4. The licence, at its correct size

§5.2's constraint on this is real, and it is structural rather than
prohibitive. The rule that applies is the one already quoted in
[`local.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/backend/local.ts)'s own comment on the second export door:

> **On the builder side**, an app-package export that bakes pixels MUST be a
> separate entry point from the talker export — a different function, not the
> same one behind a flag. The talker's guarantee is that it never writes a
> symbol as pixels, and a guarantee enforced by an argument is one flag away
> from being untrue. Keep it structural.

So the device-shaped export is a **third door**, beside `exportBoard()` and
`exportAppPackage()`, and not a parameter on either. Three things follow:

- It must not be reachable from the talker export's code path, so that
  `checkLicensing()` keeps meaning what it means.
- It carries the same non-redistributable posture the app package carries. The
  file is for one person's talker, not for passing on.
- `exportBoard()` already refuses an `images` argument with *"Embedding the
  symbols in the export is not written here"*. That refusal stays; the third
  door is where it is written instead.

None of that is friction. It is the shape §5.2 asks for, and the app package has
been living in it since 2026-08-24.

---

## 5. The one genuine hole

The two paths disagree about a slot holding nothing at all. `runBuild()` calls
`storeTile("")`, which renders `renderSymbol(null)` — the grey placeholder cross
— and puts a real tile on the device for a key with no word and no picture.
`diyBoards()` writes no button and leaves the grid cell null.

So the same empty slot is *"a picture is missing"* on the device and *"nothing
is here"* on the tablet, and `placeholder()`'s own comment says it means the
first.

Nothing catches this, for exactly the reason the question predicted: the two
paths never meet, so no test compares them. It is small, real, and worth fixing
whether or not anything is ever packaged or split.

---

## 6. What is in the package, checked against `device-interface.md` §1

**Superseded in its framing, 2026-08-27.** There is no package, so nothing
"moves" across a repository boundary; under
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) the same
code moves out of `src/` into a page in this same repository, and no version
number stands between the two halves. The table's finding survives the change
of framing and is the reason it is kept: `SLOTS_PER_SET`, `LANGUAGE_CODES` and
`DEFAULT_LANGUAGE` are read by editor code that has nothing to do with the
device build, so the device path is not a clean leaf however it is separated.
Under a page that is a shared import; under a split it becomes a duplicated
table, and it is the thing to decide before the editor leaves rather than
during.

[§1 of that document](device-interface.md) enumerates the interface. Held
against what moving would actually take:

| §1 row | Moves | What stays behind, and why |
|---|---|---|
| `layout.bin` | `renderLayoutBin`, `hashBytes`, the strides, `LAYOUT_VERSION`, `LAYOUT_MAGIC` | — |
| `t<hash>.bin` | all 535 lines of `tiles.ts` | — |
| `a<hash>.wav` | `audio_format.ts`'s three constants | the synthesis chain — see §3 |
| The name rule | `hashBytes()`, the `t`/`a` + 32 hex shape | — |
| The language byte | `LANGUAGE_CODES` | **also needed by the editor** — below |
| The cable | `loader/tools/cable.js` | `loader/src/cable.ts` — see §8 |

Three of `layout_format.ts`'s thirteen exports are read by editor code with
nothing to do with the device build, and that is the detail §1 could not have
seen, because it was enumerating the *interface* rather than the *file*:

- `SLOTS_PER_SET` — [`obf.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/obf.ts), where `normalizeLayout()`
  refuses a set of five slots and pads a short one to four. That is the editor's
  own shape rule and a device constant at the same time.
- `LANGUAGE_CODES` and `DEFAULT_LANGUAGE` —
  [`obf.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/obf.ts), [`app_package.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/app_package.ts),
  [`shell/voices.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/shell/voices.ts). The *tablet* export falls back to
  this table and the settings sheet paints from it.
- `HASH_BYTES` and `LAYOUT_BIN` — [`folder.ts`](../loader/src/folder.ts) and
  `built.ts`, both device-side, both travelling. (`built.ts` has since gone
  altogether: with no build in the editor there is no store of build output
  for anything to read back.)

None of that blocks anything: the editor pins the package and imports the table
from it, which is what pinning is for. But it means the package is not a leaf.
`obf.ts`, `app_package.ts` and the settings sheet would all import from it, so a
device-format release becomes a bump the tablet export and the settings sheet
also take. Worth knowing beforehand rather than at the first release.

---

## 7. Where the tile rendering runs

**Partly superseded, 2026-08-27.** Browser-only is still the answer and is
now free: the compiler runs in a page, which is a browser by definition. What
falls away is the cost in the last paragraph — `tests/test_tile_render_js.py`
executes `loader/src/tiles.ts` as text, and under
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) that file
changes directory without changing repository, so the test follows a path and
never reads a pinned copy.

**Browser-only, and worth saying rather than discovering.**

`tiles.ts` uses `OffscreenCanvas` or a DOM canvas in `scratch()`, and takes
anything `drawImage` accepts. `bildquelle` and `stimmquelle` are browser-only
too, so this is a shape this project already runs four times over and pays for
in a known way.

The split inside the package is not hypothetical. `renderLayoutBin` needs no
canvas, `toRgb565Be` and `rgbTo565` need none, and
[`tests/unit/device_fixtures.test.ts`](../tests/unit/device_fixtures.test.ts)
already imports exactly those three and runs under node. So the package has a
node-safe core and a browser-only renderer on top, and the existing fixture
runner shows where the line falls because it is already standing on it.

One real cost: `tests/test_tile_render_js.py` executes `loader/src/tiles.ts` as
text against pixels frozen from Pillow. After a move that test either follows
the package or reads a pinned copy, and the second is a paraphrase of the kind
[`frozen-references.md`](frozen-references.md) has an account of.

---

## 8. The cable client, and where the seam already is

**The seam is drawn and does not need moving.** It is the first paragraph of
[`loader/src/cable.ts`](../loader/src/cable.ts):

> The protocol is not here. `loader/tools/cable.js` is the browser's half of the wire
> and stays where it is, because it is the half `tests/test_cable_format.py`
> drives against the C reader compiled out of the sketch — byte for byte, in
> both directions. A copy of it inside `src/` would be a second implementation,
> and the tested one would not be the shipped one.

So `loader/tools/cable.js` travels — `Cable`, `plan()`, `push()`, the CRC, the framing
— and `loader/src/cable.ts`'s 199 lines stay: Web Serial, the port picker,
`GREETINGS`, the progress callbacks, the `Trouble` codes the sheet renders.

The interface between them is already clean. `plan()` takes a
`Map<name, {bytes}>`, `have` as the device reported it, and the free space — no
`Layout`, no store, no browser. `builtFiles()` produces that map and is the only
thing in between. Nothing has to be rewritten to make this seam; it is where
somebody already put it.

---

## 9. What the editor loses

**Superseded, 2026-08-27.** This section measured what the editor loses when
the *rendering* is packaged, and concluded: less than the question assumes.
Under [ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) the
editor loses the whole device path — the build, the tiles, the wire and the
transfer sheet — and gains an export in their place. The measurement below is
still the reason that costs little: the editor never previewed the device, and
what it draws is CSS. The last paragraph's conclusion inverts, though. Changing
the tile pipeline and seeing the result in one commit is *kept*, not relocated,
because the pipeline and the reader stay in one repository.

**Less than the question assumes, and it is worth being precise about why.**

The editor does not preview the device. `tiles.ts` is imported by exactly one
module in `src/` — `backend/local.ts`, for the build. What the editor draws is
CSS: `.pick__preview` is `aspect-ratio: 1` with a comment reading *"a tile is
116px inside a 128px display — data/tiles.ts"*, and the negation cross in the
editor is a CSS overlay in `--danger`, not `negateInto()`.

The geometry and the red are already written out three times — `tiles.ts`,
`app_assets.ts`, `ui.css` — each saying so and giving its reason. The package
takes one of the three. The editor keeps knowing a tile is square because a
stylesheet says so, which is exactly as true afterwards as before.

What the editor genuinely loses is changing the tile pipeline and seeing the
result in one commit. Today `TILE_PIPELINE` is bumped, every hash moves, the
lock and the fixtures move with it, and the whole thing is one reviewable
change. Afterwards it is a package release, a bump, and a window in which `main`
here does not build the tiles `main` there renders. That is ADR 0006's third
argument, and this proposal relocates it rather than answering it.

---

## 10. `device/fixtures/` and ADR 0009

**They keep earning their place, and the argument that they might not is
backwards.**

The proposal's claim is that under a package boundary the writer and reader are
never separated, so the live compile-both check survives and the fixtures become
redundant. The first half is true. The second does not follow, and
[ADR 0009](../adr/0009-device-interface-fixtures.md) already contains the
refutation:

> None of the four gaps above is about having two repositories, and none can be
> closed by freezing.

The fixtures exist because `layout.lock.json` holds seventeen cases and **refuses
none** — a capture can only contain what its writer emits, so no amount of
freezing reaches `parseLayout`'s five refusal branches. That is a fact about lock
files, not about repository boundaries. The index today holds 45 fixtures across
seven kinds — 20 layout, 10 cable, 8 audio, 4 tile, 1 names, 1 language, 1
sleep, at `device_interface_version` `1.0.0` — and the refusal cases in it are
ones no implementation here will ever emit. A package boundary writes none of them.

Two things about them *would* change, and one is a trap:

- **They become the package's published conformance set**, which is the shape
  `exchange/` already has and which §4 of `device-interface.md` argued for.
- **Their ownership question sharpens.** §4 of that document puts `device/` with
  neither half *because neither party can be forced to move* — a talker on a
  shelf is fixed by a person with a cable or not at all. If the compiler becomes
  a package the firmware side publishes and the editor pins, the fixtures must
  **not** travel with the compiler. They would then live with the writer and be
  pinned by the reader, which is the arrangement §4 rejected by name. `device/`
  becomes the third repository, or the format has been handed back to one
  implementation.

  *Neither happened, 2026-08-27.* This bullet is conditional on the package,
  and there is no package. Under
  [ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) the
  writer and the reader are both in the talker's repository, so under
  [ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md)'s split the
  fixtures stay there beside both of them and no third repository is needed for
  them. The sharpening this bullet predicted is the one that did not arrive.

Nothing is deleted. `test_layout_frozen.py` and `test_cable_format.py` hold the
two implementations against each other on the same run, and under this proposal
they still can, because the compiler's source would sit beside the firmware. The
fixtures stay a third check, which is what ADR 0009's Consequences already call
them.

---

## 11. The cost, against the flow this project already runs

**Superseded, 2026-08-27.** This is the section that decided it. Every cost
priced here is the cost of a release and a bump per format change, and
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) has none:
no package is published, so there is no version number, no window in which two
`main`s disagree, and no wrong bump to reach a talker with. The measurement
below is kept because it is what the cheaper answer had to beat, and because
the paragraph about a device that parses and is wrong is still true of anything
that reaches a talker.

**What is the same.** Tag, `npm install`, a lockfile line, a bump commit. This
project does that routinely and has tooling for the failure mode —
`tools/installcheck.mjs` runs before all three suites precisely because a stale
`node_modules` used to run green.

**What is not the same, and it is the whole cost.** The four pinned packages are
consumed by software that can be redeployed; Pages goes out on every push to
`main`. A talker is fixed by a person with a cable, in a house nobody in this
repository knows about. A wrong bump in `bildquelle` is a bad render somebody
sees and reports. A wrong bump in a device compiler is a device that parses and
is wrong, which `device-interface.md` §6 spends a section on: *a key that says
the wrong sentence is worse than one that says nothing, because it is said to
somebody who believes it.*

**And the window.** ADR 0006's "one commit is one change" is not an aesthetic
claim. It is that a format change lands as a unit that is either right or wrong
as a unit, with no interval in which two `main`s disagree. A package boundary
buys that interval back in exchange for a version number — a defensible trade
for a library, a worse one for a format whose reader is a soldered board.

**The measurable part.** Four bumps a week is comfortable. `firmware/` changed
on five of the last seven days, `layout_format.ts` had a breaking change on
2026-08-25, and `cable_format.h` is having one **today** (§13). Under this
proposal each of those is a release plus a bump instead of a commit.

---

## 12. The argument with ADR 0006, and whether the counter holds

ADR 0006:

> The shared code that *is* genuinely shared already left … because they are
> used by more than one product. That is the actual criterion, and firmware and
> builder do not meet it: they are used by each other and by nothing else.

The counter offered: a **format** with two implementations is exactly a shared
thing, and the criterion was about products rather than formats.

**The counter is half right, and the half that fails is the load-bearing half.**

Where it is right: 0006's sentence conflates two questions. *"Is this used by
more than one product"* is about **deployment**; *"does this have more than one
implementation that must agree"* is about **specification**. They come apart, and
0006 does not notice that they do. The proof is in this repository already —
`exchange/SPEC.md` is a format with two implementations, and it got a
specification, fixtures, a tag prefix and a pinned consumer without anybody
arguing it was used by more than one product first. The criterion 0006 states is
not the criterion this project actually applied.

Where it fails: **recognising a format as a shared thing is an argument for
giving it a specification, not for moving the code.** That is exactly what ADR
0009 did on 2026-08-26 — `device/`, owned by neither half, 39 authored fixtures,
`device-v*` reserved. The format has already been treated as the shared thing it
is. What has not happened, and what this proposal actually asks for, is moving
one implementation into a package, which is a claim about deployment after all.

There is also a plain factual point. `bildquelle` and `stimmquelle` left because
`mitreden` needed them: a second product, existing, running. Nothing consumes
`layout.bin` but this firmware and nothing writes it but this builder. Condition
2 asks for a second consumer to *appear*, as an event. It has not.

**So 0006 needs one amendment and does not need overturning** — but it now
stands on narrower ground than it did. With the `.obz` premise sound, the
remaining objections are cost and condition 2, and both of those are arguments
about *when*, not about *whether*. The Why section's last paragraph should say
that the criterion for **extraction** is a second consumer while the criterion
for **specification** is a second implementation — which the device format met,
which ADR 0009 answered, and which is not the same question. That is a
correction to the reasoning, in 0006's own Examined section beside the
2026-08-26 line. The decision is unchanged.

---

## 13. The two sessions running beside this one

**The cable acknowledgement change is the strongest evidence about the cost, and
it landed while this was being written.**

Branch `claude/amazing-chaplygin-9fe616` carries two commits: `1bdfdda`
*"acknowledge every window of a cable transfer"* in `firmware/`, and `e42934a`
*"the browser waits for each window to be acknowledged"* in `loader/tools/cable.js`,
`loader/src/cable.ts` and `loader/tools/cable_mock.js`. The second one's footer:

> BREAKING CHANGE: `CABLE_VERSION` is 2 here too. The two halves move together.

One change to one format, in one branch, reviewable as a unit, with the mock
gaining a deliberate stall so a client that never waited cannot pass against a
`Map` that answers instantly. Under this proposal it is a compiler release, a
bump here, and an interval in which the two `main`s speak different protocol
versions — for a change whose whole purpose is fixing a device that went silent
at the bench.

It does not change §§1–5. The `.obz` question is about `layout.bin`, tiles and
audio; the cable is a different subformat and its client already sits on the
clean side of the seam (§8). `plan()` and `push()` still take a file map. What it
changes is §11: four bumps a week becomes five.

The **format-freeze survey** on `claude/inspiring-stonebraker-c80b26` has
produced no commits yet, and it is the more consequential of the two. ADR 0006's
condition 1 is *"if `layout.bin` and the cable protocol are ever frozen for
good"*. If that survey finds the pending changes few and enumerable, condition 1
moves closer and §11's cost drops — the release window matters less when the
format stops moving, and this proposal gets materially better. If it finds more,
§11 gets worse. **This document should be re-read against that survey when it
lands, and §11 is the section it would change.**

---

## Recommendation

**All five were answered on the day they were written, and the last two did not
survive contact.** What each one turned into is marked below rather than
rewritten, because the shape of the change is the useful part: the premise held
and the route did not.

1. **The premise holds.** An `.obz` can be the device build's input. What is
   missing is not a possibility but an export: a third door writing sources
   rather than fitted PNGs, a negation flag rather than a baked cross, 16 kHz
   WAVs rather than Opus, and the two `ext_vorlaut_*` fields the talker document
   already carries.

   *Built, 2026-08-27:* `exportDevicePackage()` and
   [ADR 0010](../adr/0010-device-shaped-obz-export.md), with the four form rules
   as written.

2. **Build that export first, and on its own merits** (§3). It is the first
   artefact in this project that can reconstruct a device build without the
   editor's IndexedDB — archivable, diffable, and something to hand to whoever is
   debugging at a bench. It is also ~~the expensive half of the packaging move~~
   the expensive half of *any* separation, and
   it is worth paying for whether or not the move ever happens. Same argument ADR
   0009 made about the fixtures.

   *Built, and it earned the sentence twice over:* the export is what made the
   cheaper answer in recommendation 4 possible at all, and the round trip found
   a bug on the way in.

3. **Fix the empty-slot divergence** (§5). Small, real, uncaught, unrelated.

   *Fixed:* `slotIsEmpty()` is one predicate, asked once and carried, and
   `device_package.ts` says at length why a gap has to travel as a gap.

4. ~~**Do not package or split yet.** Not because the interface is unworkable — it
   is workable, and §§1–5 say how — but because condition 2 of ADR 0006 has not
   been met and the format is still moving, with a breaking cable change landing
   today. Recommendations 1–3 need none of that resolved and make the eventual
   move cheap, which is what 0006 predicted a met condition would look like.~~

   **Superseded on 2026-08-27 by
   [ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) and
   then by [ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md).** Not
   reversed — overtaken, in two steps, both on the day this was written.

   *The packaging half:* "not yet" was the right answer to *should the compiler
   be a package*, and that question stopped being asked. The editor exports a
   file and stops; the talker's repository gains a page that compiles the file
   and sends it. There is no package to release, so the cost this recommendation
   was waiting out never arrives.

   *The split half, later the same day:* **ADR 0012 decided it.** Both of the
   two reasons given above for waiting had dissolved by then, and it is worth
   being exact about how, because they dissolved differently. Condition 2 of ADR
   0006 was never met — it gates extracting a *pinned package*, and ADR 0011
   chose a design with no shared package at all, so the condition lost its
   premise rather than being satisfied. The moving format did stop moving in the
   way this sentence meant: the breaking cable change that was landing *"today"*
   is C1, and [`format-freeze.md`](format-freeze.md#the-short-answer) records it
   landed along with C2 and L1, leaving three items none of which is blocking.
   What is left of the sentence above is the observation that the seam is now a
   file format rather than a function call — which is what made the move cheap
   enough to decide.

5. **Amend ADR 0006's Why** (§12) with the distinction its own sentence misses:
   a second *consumer* is the test for extraction; a second *implementation* is
   the test for a specification. The decision stands; the reason given for it is
   one sentence short.

   *Done, and then amended again.* The distinction is in 0006's Why, and its
   Examined section now carries a second 2026-08-27 entry recording that
   condition 2 has no premise left. The distinction itself stands; it is simply
   no longer a question this repository is waiting on the answer to.

## Should this be an ADR?

**Not this document. Yes for recommendation 2, once it is built.**

This is a measurement — *"can an `.obz` carry the device build, and in what
form"* — and measurements belong in `docs/` beside the other one.

The **third export door** is the ADR. It has the shape
[`adr/README.md`](../adr/README.md) describes: somebody will look at three
export functions that all write `.obz` and propose merging them behind a flag,
and SPEC.md §5.2 forbids exactly that in words that will not be in front of
them. An ADR is what puts the reason where the tidying happens. It records the
export, its four form rules and its non-redistributable posture — not a split,
and not a package.

~~If the compiler is ever actually packaged, that needs its own ADR, and that one
**supersedes** ADR 0006 rather than amending it: moving one implementation of the
device format into a package is the decision 0006 refused, and reversing a
decision is what supersession is for. Nothing here reaches that bar today.~~

**That paragraph was right and does not apply, 2026-08-27.** A packaged
compiler would still supersede ADR 0006, and nothing has packaged one. What
happened instead is
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md), which
puts both implementations of the device format on the same side and so amends
0006 rather than reversing it. It earns an ADR of its own for the reason
`adr/README.md` gives: somebody will ask why the editor cannot just send to the
device, because it used to, and the answer has to be somewhere they will find
it.
