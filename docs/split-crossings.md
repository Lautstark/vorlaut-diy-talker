# The bill for the split: what crosses `src/` ↔ `loader/`, name by name

**Status: a proposal. Nothing is moved and no migration is written here.**
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) landed the same
day this page did and decided the split; the anchors and the two sentences that
assumed it undecided are corrected below, and the measurement is untouched.
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md) put a file
between the editor and the talker and left two directories importing each other.
[`tests/unit/layers.test.ts`](../tests/unit/layers.test.ts) calls that list *the
bill for the eventual split* and asks that every name on it be answered for
before anybody moves a directory. This is the answer, in the form
[`obz-as-device-input.md`](obz-as-device-input.md) is in — a measurement and a
costing — because the decision it feeds is
[`repository-map.md`](repository-map.md#the-split-and-the-route-it-replaced)'s
split — ~~which is still waiting on evidence and~~ which was decided on
2026-08-27 by
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) and is not made
here.

Like every page in `docs/`, this links to the arguments rather than restating
them.

## The recommendation, in one paragraph

**Nothing is extracted into a package, and the two hard cases go opposite ways.**
The seven layout constants are already authoritative in
[`device/fixtures/`](../device/README.md) and are safe to duplicate the day the
editor leaves, with no new fixtures needed — the editor pins the fixtures the way
`vorlaut-app` pins `exchange/`. `src/data/device_package.ts` is **specified and
fixtured, implemented twice**: it divides cleanly into a writer that goes with
the editor, a reader that goes with `loader/`, and a set of shapes both hold a
copy of, held together by a new `package` kind under `device/fixtures/` — which
is also what `tests/unit/device_roundtrip.test.ts` has to become, because after
the split no repository has both halves of that round trip. `loader/src/tiles.ts`
does **not** divide, and it does not have to: `renderSymbol()` and `TILE_SIZE`
stop crossing entirely, because the editor's device preview is **relocated to the
loader page** rather than dropped or duplicated — the page already compiles every
tile, so the preview stops being a prediction of the device's pixels and becomes
the actual pixels about to be sent. `thumbnailSize()` is the one name that
genuinely passes the repository's extraction test, and is still not extracted:
its copy is frozen on the day of the move, because what a drifted copy costs is
one pixel of proportion on a tablet and nothing refuses. `t()` and `LANG` are
copied and the `load.*` prefix moves with them, exactly as
[`loader/README.md`](../loader/README.md) already planned; `Trouble` turns out
not to be shared at all and moves whole. `layers.test.ts` divides into a half
that travels unchanged and a half that would pass vacuously and has to be
replaced on both sides.

---

## First, the count — because four documents disagree

The list is **ten names in one direction and thirteen in the other**, and every
prose statement about it is out of date. That is not a nitpick; it is the first
piece of evidence, and it is the thing this document exists to stop.

| says | claims | actual |
|---|---|---|
| [`layers.test.ts`](../tests/unit/layers.test.ts)'s closing comment | *"these five names"* | ten |
| [`loader/README.md`](../loader/README.md) | *"Six names in one direction"* | ten |
| [ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md)'s Built section | *"seven format constants and `renderSymbol()`"* | seven constants and **three** names out of `tiles.ts` |
| `layers.test.ts`'s `ALLOWED_FROM_SRC` | — | **ten**, and it is the only one that is checked |

The history is the point. `ad4614a`, the commit that created `loader/`, pinned
the list to **five** names, and the closing comment was true when it was
written. `ef65b20` the same day took it to **ten** — `SLEEP_MIN`, `SLEEP_MAX`,
`SLEEP_DEFAULT`, `renderSymbol` and `TILE_SIZE`. Every one of those five
additions came with the argument the comment asks for, written into the comment
beside it. What did not follow was any of the counts, in any of the three files.

So the enforcement held and the prose did not, which is
[`format-freeze.md` §9](format-freeze.md#9-prose-that-has-drifted-from-the-code)
happening again inside the week that section was written, and it says something
about what the successor to `ALLOWED_FROM_SRC` has to be: a list a test reads,
not a number a sentence carries. Repairing the three sentences is a small edit
and it belongs with whoever lands a decision from this page, not here.

---

## Direction one — `src/` → `loader/`

Ten names, two modules, held by
[`layers.test.ts`](../tests/unit/layers.test.ts)'s `ALLOWED_FROM_SRC`.

### The seven constants: duplicated, and already held against `device/fixtures/`

| name | who takes it | fixture that is the authority |
|---|---|---|
| `SLOTS_PER_SET` | `src/data/obf.ts`, `src/data/device_package.ts` | `device/fixtures/layout/*` — the stride every layout fixture was laid out from |
| `HASH_BYTES` | `src/backend/local.ts`, `src/data/device_package.ts` | `device/fixtures/names.expected.json` — `hash_bytes` |
| `LANGUAGE_CODES` | `src/data/obf.ts`, `src/data/app_package.ts` | `device/fixtures/language.expected.json` — the table |
| `DEFAULT_LANGUAGE` | `src/backend/local.ts`, `src/data/obf.ts`, `src/data/app_package.ts` | the same file — `default_code`, `default_index` |
| `SLEEP_MIN` | `src/data/obf.ts` | `device/fixtures/sleep.expected.json` — `min` |
| `SLEEP_MAX` | `src/data/obf.ts` | the same file — `max` |
| `SLEEP_DEFAULT` | `src/data/obf.ts` | the same file — `default` |

**All seven, duplicated. No new fixtures, and no argument left to make.**
[`tests/unit/device_fixtures.test.ts`](../tests/unit/device_fixtures.test.ts)
already derives every one of them from the fixture rather than from the module:
the strides at its stride check, `HASH_BYTES` against `names.expected.json`, the
language table and its default against `language.expected.json`, and the sleep
range against `sleep.expected.json`. `layers.test.ts`'s claim — that
`device/fixtures/` *"is the authority on all four and belongs to neither half"* —
is true of all seven and is not a promise about what somebody would write on the
day. It is a test that runs now.

**Two things make this stronger than a duplicate usually is, and they are worth
having in front of the move task.**

The pin already has to exist. Whatever else the editor takes, it takes these,
so `vorlaut-editor` pins `device/fixtures/` on day one — by submodule or by
archive, the two ways
[`exchange/README.md`](../exchange/README.md) already documents for
`vorlaut-app`. Every later question about where a device fact is held has that
pin available for free.

And the direction of ownership comes out right rather than merely acceptable.
[ADR 0009](../adr/0009-device-interface-fixtures.md)'s objection to `exchange/`'s
arrangement is that a format *the writer owns and the reader merely pins* puts
the authority on the side with nothing at stake. Here the fixtures stay in
`vorlaut-diy-talker` with both device implementations
([`repository-map.md`](repository-map.md#the-three-names), and
ADR 0011 is why no fourth name is needed), and it is the **writer** — the editor
— that pins. That is ADR 0009's arrangement with the authority on the side that
cannot be made to move, which is the side it wanted it on.

**One nuance the move task should not lose.** `DEFAULT_LANGUAGE` and
`LANGUAGE_CODES` are also read by `src/data/app_package.ts`, which writes a
package the talker never sees. The editor's copy is therefore not purely a
duplicate of a device fact — it is also the editor's own default, shared between
the device profile and the app profile. It is still held to the fixture, because
the device profile is the stricter of the two.

**And one that makes the duplicate safer than it looks.** ADR 0011 put a
validator between the editor's copy and the device.
[`loader/src/validate.ts`](../loader/src/validate.ts) re-derives the same rules
from its own `layout_format.ts` and refuses or warns — `load.too_many_keys`,
`load.too_many_sets`, `load.sleep_clamped`, `load.bad_sleep`,
`load.unknown_language`. A drifted copy in the editor therefore surfaces on a
page somebody is looking at with a talker in front of them, in a sentence, before
any byte reaches the device. That is not an argument for being careless about the
duplicate; it is why this particular duplicate is not the class of fault
[ADR 0009](../adr/0009-device-interface-fixtures.md) is frightened of.

### The three names out of `tiles.ts`

| name | who takes it | disposition |
|---|---|---|
| `renderSymbol` | `src/backend/local.ts` (`previewInto()`) | **stops crossing** — the preview moves to the loader page |
| `TILE_SIZE` | `src/backend/local.ts` (`previewInto()`) | **stops crossing** — same |
| `thumbnailSize` | `src/data/app_assets.ts` | **duplicated**, held against a freeze taken on the day |

The argument is [hard case two](#hard-case-two--tilests-does-not-divide-and-does-not-have-to) below.

---

## Direction two — `loader/` → `src/`

Thirteen names, three modules, **and nothing watches it.** Verified by grep on
2026-08-27 against `6adb32f`.

### `src/data/device_package.ts` — nine names

| name | kind | who takes it | disposition |
|---|---|---|---|
| `readDevicePackage` | function | `main.ts` | reader — **moves to `loader/`** |
| `planLayout` | function | `compile.ts` | reader — **moves** |
| `wavFormat` | function | `validate.ts` | reader — **moves** |
| `wavSeconds` | function | `validate.ts` | reader — **moves** |
| `ReadDevicePackage` | type | `compile.ts`, `browser_host.ts`, `validate.ts`, `main.ts` | the reader's own output shape — **moves** |
| `DevicePlan` | type | `validate.ts` | shape — **duplicated**, fixtured |
| `DevicePackage` | type | `read.ts` | shape — **duplicated**, fixtured |
| `DeviceManifest` | type | `read.ts` | shape — **duplicated**, fixtured |
| `DeviceBoard` | type | `read.ts` | shape — **duplicated**, fixtured |

The argument is [hard case one](#hard-case-one--the-device-package-is-the-boundary-and-it-divides-by-role).

### `src/core/boot.ts` — two names

| name | who takes it | disposition |
|---|---|---|
| `t` | `validate.ts`, `main.ts` | **copied**; the `load.*`, `cable.*` and `err.cable_*` keys move with it |
| `LANG` | `main.ts` | **copied** |

### `src/core/errors.ts` — two names

| name | who takes it | disposition |
|---|---|---|
| `Trouble` | `cable.ts`, `main.ts` | **moves whole to `loader/`.** It has no user left in `src/` |
| `reason` | `main.ts` | **copied.** Eleven modules under `src/` use it |

The argument is [hard case three](#hard-case-three--t-is-shared-trouble-is-not).

---

## Direction three — the crossings that are not imports

Named because a test that reads import statements cannot see any of them, which
is the limit `layers.test.ts` already states about itself in its own *What this
test does not prove* section.

**The handoff link.** [`src/shell/packageExport.ts`](../src/shell/packageExport.ts)
builds `new URL("loader/", BASE_URL)` and offers it after a device export. It is
a relative link within one Pages deployment today and an absolute cross-site link
afterwards. **The address to write out is
`https://lautstark.github.io/vorlaut-diy-talker/`, not the `loader/` under it**:
the loader takes the root when the editor leaves
([`repository-map.md`](repository-map.md#what-the-move-costs)), and the
repository name in front of it is what does not move, which is what makes
hard-coding it safe. This is
the only crossing on this page whose breakage a carer sees rather than a test,
and the only one that is a runtime dependency rather than a build one. It needs
the same treatment as the three literal base paths that page lists, and there is
no gate for any of them.

**The shared language choice, which survives by accident.** Both pages read
`vorlaut.language` out of `localStorage` ([`src/core/boot.ts`](../src/core/boot.ts)
says why it is there rather than in a Sammlung). Two GitHub Pages project sites
share an origin, so a carer's choice still carries across the split for free —
and it stops the moment either side takes a custom domain, silently, with the
loader page simply opening in the browser's preference instead. Worth a sentence
in whatever lands the move rather than a discovery afterwards.

**Four unit tests import both sides**, and so do two e2e specs:
`device_fixtures.test.ts`, `device_roundtrip.test.ts`, `empty_slot.test.ts`,
`negation.test.ts`, `e2e/loader.spec.ts` and `e2e/device_export.spec.ts`.
[`tests/unit/reachable.test.ts`](../tests/unit/reachable.test.ts) walks both
trees deliberately, and `vite.config.ts` builds both entry points. These are
[the last section](#what-happens-to-layerstestts-and-to-the-suite-around-it).

---

## Hard case one — the device package is the boundary, and it divides by role

It is the module that writes the exported file and reads it back, 919 lines, and
[`loader/src/compile.ts`](../loader/src/compile.ts) says pre-cutting it inside
one repository would only mean the cut happened twice. That is right, and it also
means the cut has to be described before the day rather than improvised on it.
Here is where it falls.

**The nine names `loader/` takes are, near enough, the reader.** The module
already carries its own section banners — *reading*, *shapes*, *naming*, *WAVs*,
*building*, *writing*, *reading* — and the import list follows them:

- **The writer stays with the editor**: `devicePlan`, `buildDevicePackage`,
  `devicePackageBytes`, `jsonBytes`, `digest`, `sniffImageType`, `isDeviceWav`,
  `boardPath`. `src/backend/local.ts` is its only consumer under `src/`.
- **The reader goes to `loader/`**: `readDevicePackage`, `planLayout`,
  `wavFormat`, `wavSeconds`, and the `ReadDevicePackage` shape they answer with.
  Note that `loader/` does not take `digest` — [`compile.ts`](../loader/src/compile.ts)
  asks its host to hash, which is the same seam that lets the round trip run under
  node.
- **The shapes are duplicated**: `DevicePackage`, `DeviceManifest`,
  `DeviceBoard`, `DevicePlan` and the `Device*` interfaces around them. They are
  the format's own vocabulary and both halves need every field.

### Why not a package

The repository's rule is
[`repository-map.md`](repository-map.md#the-rule-that-explains-all-of-it)'s: *a
second **consumer** justifies extraction, a second **implementation** justifies a
specification.* `device_package.ts` has one product and two halves of one format.
It fails the extraction test and passes the specification test exactly.

There is a second and shorter reason, and it is the one that settles it.
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md)'s Decision
says *"There is no shared package and no cross-repo code dependency. The boundary
is the file format, full stop."* Anybody proposing a package here is not
revisiting [ADR 0006](../adr/0006-builder-and-hardware-one-repo.md) — whose
condition 2 lost its premise and is settled elsewhere — they are **superseding
ADR 0011**, five days after it was accepted, and paying back the release-and-bump
cost [`obz-as-device-input.md`](obz-as-device-input.md) §11 measured against real
history. This page does not propose one.

### Why the `exchange/` arrangement does not answer it either

[`repository-map.md`](repository-map.md#the-three-names) says the
rule does not stretch: *"should the device build ever read an `.obz`, the device
becomes a reader of a format whose fixtures live with the writer, and the device
is exactly the party ADR 0009 says cannot be made to move."* That day has
arrived, and the sentence needs reading twice, because half of it stopped being
true and half of it did not.

**What stopped being true is the immobility.** Under ADR 0011 the `.obz` reader
is not the device. It is a page, served from GitHub Pages out of
`vorlaut-diy-talker`, updated by a deploy. It can always be made to move — which
is the exact test [ADR 0009](../adr/0009-device-interface-fixtures.md) applies,
and it passes. The talker on the shelf never sees an `.obz`; it sees
`layout.bin`, the tiles and the WAVs, which is `device/fixtures/`'s existing
territory.

**What did not stop being true is what the fault does.** A reader that
misunderstands a package does not fail on the page; it compiles confidently and
hands a talker bytes. `device/fixtures/` catches a malformed `layout.bin` and
does not catch a well-formed one built from a misread source — which is precisely
ADR 0009's *"the dangerous mistakes are the ones that parse."* So the device
package sits **upstream of** the device interface, and its faults arrive at the
party that cannot move even though its two implementations both can.

There is a third reason `exchange/` cannot host this even if one wanted it to:
[`exchange/SPEC.md`](../exchange/SPEC.md) §1 rules the talker out by name, on
[ADR 0001](../adr/0001-two-ext-namespaces.md)'s grounds. The device package is a
different profile with a different extension namespace, and *"this specification
does not govern it."*

### The answer: a `package` kind under `device/fixtures/`

**Specified and fixtured, implemented twice** — ADR 0009's shape, in the
directory ADR 0009 built, extended by one kind. Authored from the rule by
[`device/tools/make_fixtures.mjs`](../device/tools/make_fixtures.mjs) from one literal,
importing nothing from `src/` or `loader/`, with refusal cases the way the
existing 45 fixtures have twelve of them. The editor pins it — the same pin
Direction one already requires, so this costs no second mechanism, no fifth
top-level directory and no fifth tag prefix: `device-v*` is reserved and uncut.

Three arguments for it, in order of weight.

**It is what `device_roundtrip.test.ts` has to become.** That test holds
`buildDevicePackage()` against `compileDevice()` in one process, and after the
split neither repository has both. It is the most valuable check on this page and
it is the one the move deletes. A fixture family is the only thing that
reconstitutes it: the writer is held to producing a package the fixtures accept,
the reader to reading the fixtures' packages into the fixtures' answers, and
neither ever sees the other. That is
[ADR 0009](../adr/0009-device-interface-fixtures.md)'s *"the expensive half of a
repository split is also what was missing inside one repository"*, and here the
missing half is only visible because the split forces the question.

**Duplication alone would not carry the shapes.** Four types with a dozen fields
each are not four numbers. Nothing in `device/fixtures/` today says what a
`manifest.json` in a device package must hold, so the shapes are the one part of
this page where *"if you extend this to anything else, extend the fixtures too"*
actually bites.

**And it puts ownership where nothing has to move.** `device/fixtures/` belongs
to neither half by construction, which is the property `exchange/`'s arrangement
would give up and the reason ADR 0009 refused to copy it.

**The scope question, stated rather than assumed.** `device/README.md` scopes the
directory to the device interface — the bytes between the browser and the talker
— and a `package` kind widens it to a format between two browsers. That is a real
change of meaning and it needs a line in an ADR, not a commit message. It is also
directly adjacent to what **ADR 0012** is being written to answer. See
[what is left open](#what-this-does-not-decide) below.

---

## Hard case two — `tiles.ts` does not divide, and does not have to

[`repository-map.md`](repository-map.md#the-three-names) and
[`layers.test.ts`](../tests/unit/layers.test.ts) both argue that splitting the
module puts one rounding rule in two places with nothing holding the copies
together, which is the failure
[`frozen-references.md`](frozen-references.md) exists to record. Reading the code
makes that argument stronger than its own statement of itself, and then dissolves
the problem from the other end.

**Stronger, because the sharing is at the call site and not by analogy.**
`renderPixels()` — which is what
[`loader/src/compile.ts`](../loader/src/compile.ts) actually uses to build every
device tile — calls `thumbnailSize()` directly. `thumbnailSize()` is not a
neighbour of the device pipeline. It is inside it.

**And `renderSymbol()` has no production consumer in `loader/` at all.**
`compile.ts` uses `blank`, `renderPixels` and `toRgb565Be`; `browser_host.ts`
uses `sourcePixels`. The only place `renderSymbol()` is called in shipped code is
`previewInto()` at [`src/backend/local.ts:249`](../src/backend/local.ts) — the
editor's device preview. So the module is not being pulled in two directions by
two products. One product wants the whole pipeline, and the other wants a picture
of what the pipeline will do.

### The preview: not dropped, relocated

The brief for this page named the preview as the drop candidate. It should not be
dropped, and it should not be duplicated either. It should **move to the loader
page**, and the move improves it.

What duplication would cost is not `renderSymbol()`'s twenty lines. It is
`sourcePixels`, `fillColour`, `thumbnailSize`, `premultiply`, `resampleLanczos`,
`thumbnail`, `compose`, `negateInto` and `toRgb565Be` — effectively all of
`tiles.ts` — as a second implementation of Lanczos across a repository boundary,
with `tests/reference/tiles.lock.json` as the only thing between the copies and
`frozen-references.md` saying in terms that a lock *"cannot work out the right
answer for a case nobody recorded"*. `TILE_PIPELINE` is a live number; it was
bumped on 2026-08-26. Two copies would have to move together at that rate with no
release mechanism, because ADR 0011 deleted the one that existed.

**The cheap middle is ruled out by a measurement already in the repository.**
Drawing the preview with the browser's own scaler instead is what `renderSymbol`'s
`"canvas"` path does, and [`tile-rendering.md`](tile-rendering.md#the-measurement)
priced it: up to 29.5% of pixels differ in Chromium and 45.6% in Safari, and the
two browsers do not agree with each other. A preview built that way is not the
preview in a browser-dependent amount, which is the whole of what that control is
for.

**On the loader page the preview costs nothing.** The page decodes every source
and renders every tile already — that is what step 3 is — and
[`validate.ts`](../loader/src/validate.ts) is already the step whose job is
saying what will be different once this is on the device. Drawing the compiled
tiles there is `renderPixels()` output the page has in hand, put on a canvas.
And it stops being a prediction: today `previewInto()` shows what a ScreenKey
*would* draw, and on the page it shows the bytes that are about to be sent.

**The cost, stated plainly rather than argued away**, because ADR 0011 set the
standard for this. The feedback loop lengthens. Today a carer picking a pictogram
sees it at 15.21 mm as they pick, one symbol at a time; afterwards they see the
whole board that way after an export. That is worse for the person doing it,
every time — and it is the same cost, in the same place, that ADR 0011 already
weighed and accepted for the build itself, with the same answer:
[`loader/README.md`](../loader/README.md) already describes the loop as *change
it there, export again, choose the new file*, and there are no users yet.

If somebody later wants the picking-time preview back, that is a measurement from
users who by then exist, and the honest options are the two above and not a third
one.

### `thumbnailSize`: the one name that passes the extraction test

It has two consumers in two products after the move — the device tile pipeline in
`vorlaut-diy-talker`, and `src/data/app_assets.ts` writing the app package's PNGs
in `vorlaut-editor`. That is
[`repository-map.md`](repository-map.md#the-rule-that-explains-all-of-it)'s
extraction test, met literally, and it is the only name on either list that meets
it. So the answer has to be a cost judgement rather than a rule application, and
it is stated as one.

**Not extracted.** Three reasons.

The requirement is aesthetic, not normative. `app_assets.ts` says why it borrows
rather than re-derives — *so that a symbol lands in the same proportions on the
tablet as on the device* — and [`exchange/SPEC.md`](../exchange/SPEC.md) §5.3
fixes the size cap and the encoding but says nothing about the rounding. Nothing
refuses a package whose symbol is one pixel differently proportioned; no importer
notices; no child sees a wrong word. Compare what a wrong `HASH_BYTES` does.

The input cannot move. `thumbnailSize()` implements Pillow's `round_aspect()`,
and Pillow's rule is not going to change under either repository. A package's
whole value is a channel for change, and there is no change to carry.

And the price is a fifth repository, a `prepare` build, an `installcheck` row, a
`pins.js` row and a bump per touch — [`packages.md`](packages.md) is what all of
that costs — paid to prevent something nothing refuses.

**Duplicated, and frozen on the day.** The move task takes the copy and, while
both halves are still in one tree and `tiles.lock.json` still holds the shared
implementation to Pillow, writes a small table of `(width, height, max)` →
`(x, y)` beside the editor's copy. That is `frozen-references.md`'s own pattern —
freeze the outside opinion while there is still an outside opinion to freeze —
and here, unusually, the freeze is being taken *before* the oracle goes rather
than in the week it is deleted.

If that judgement ever flips, the extraction to reach for is not a fifth
repository. It is `bildquelle`, which both products already pin and which already
owns the question of what a symbol is.

---

## Hard case three — `t()` is shared, `Trouble` is not

### `t` and `LANG`: copied, and `loader/README.md` already decided this

[`loader/README.md`](../loader/README.md)'s *The words on it* made this call when
the directory was created: one table, divided by a **prefix** rather than by a
file, *"because a prefix rather than a file is what keeps the eventual split
cheap. The table divides along a line that is already drawn, and nobody has to
decide, three months from now, which of two tables a sentence was supposed to be
in."*

The line is drawn and it holds. `load.*` is 47 keys in two languages, plus
`cable.*` and the four `err.cable_*` entries that came across with the transfer.
Those move; everything else stays. `t()` itself is ten lines and the language
choice around it is sixty, and none of it has an agreement requirement — nobody
reads the other page's labels, ever. So it is copied, and the argument ADR 0011
made against a second table (*"a second table would have been a second
translation system within a week"*) is not violated: that argument is about two
pages in one repository, and after the split there is no first table on the
talker's side for the second one to drift from.

**What has to be copied with it, and is easy to miss**, is
[`tests/unit/boot_data.test.ts`](../tests/unit/boot_data.test.ts). Its whole
reason for existing is that two language objects side by side make a missing
translation invisible, and after the split each half needs its own copy watching
its own keys. A `load.*` key present in German and missing in English would
otherwise be caught by nobody at all.

### `Trouble`: not shared — stranded

Grep says so plainly, and it is the one place this page contradicts its own brief.
**`Trouble` has no user under `src/`.** Its two callers are
[`loader/src/cable.ts`](../loader/src/cable.ts) and
[`loader/src/main.ts`](../loader/src/main.ts), and the entire `err.*` vocabulary
in `boot_data.ts` is four `err.cable_*` keys. `errors.ts`'s own docstring names
the two callers and describes *"one vocabulary shared by the cable and the folder
export"* — and `folder.ts` is in `loader/` too.

So `Trouble` is not shared infrastructure. It is a class that stayed in
`src/core/` because that is where it was standing when the cable walked out from
under it, and its position is a fact about ADR 0011's history rather than about
the boundary. **It moves whole to `vorlaut-diy-talker` with its four words.**

`reason()` is the opposite and is genuinely shared: eleven modules under `src/`
use it, and `main.ts` in `loader/` uses it. It is one line. **Copied.**

That the two names in one 41-line file get opposite answers is worth noticing.
The file's own comment explains why it sits in `core/` rather than `ui/`, and
that reasoning is still right for `reason()` and no longer describes `Trouble`
at all.

---

## What happens to `layers.test.ts`, and to the suite around it

It is the enforcement, it lives under `tests/unit/`, and after the split it can
see one side. It divides into two halves with different fates, and the second
half is the dangerous one.

**The first half travels unchanged.** Everything down to *"no editor reaches into
another editor"* — `EDITORS`, `ROOT`, `inEditor()`, the crossings and the strays
— is about `src/` alone and is exactly as strong in `vorlaut-editor` as it is
here. The shell-and-two-editors rule is the reason that file exists and the split
does not touch it.

**The second half would pass vacuously, which is worse than deleting it.**
`ALLOWED_FROM_SRC` and the `intoLoader` walk test `spec.includes("loader/")`. In
a repository with no `loader/` that matches nothing, the check reports *ten names
from two modules* and is green forever. That is the failure mode this repository
has already been bitten by twice — a test that is green for the wrong reason — and
a file whose own comment is about invisible dependencies should not end up as one.
It has to be **replaced on both sides, not moved.**

**On the editor's side, three successors.**

1. *The duplicate list, enumerated.* `ALLOWED_FROM_SRC`'s real value is not that
   it forbids imports; it is that adding a name costs an edit and an argument.
   The successor is a list of every device fact the editor holds a **copy** of,
   each held against the pinned `device/fixtures/` — which is
   `device_fixtures.test.ts`'s constants half, re-pointed at the pin. Without an
   enumeration, *"the boundary quietly closing again"* becomes *"the duplicate
   quietly growing"*, and the drift measured [at the top of this page](#first-the-count--because-four-documents-disagree)
   is what that looks like from the inside.
2. *An absolute rule where there is currently an exception.* Today nothing can
   say "`src/` imports nothing outside `src/` but its pinned packages", because
   `loader/` is a legitimate exception ten names wide. Afterwards it can, and
   that is a **stronger** statement than the one being retired.
3. *`reachable.test.ts` loses a tree.* Its `TREES` and `vite.config.ts`'s
   `rollupOptions.input` are the same pair of facts and both go back to one entry
   point each. Its own comment already names the risk of the two lists
   disagreeing.

**On the talker's side, the mirror, plus one thing the mirror does not cover.**
`loader/` importing nothing outside `loader/` is true by construction the moment
the move lands, and stays true only if something says so. The specific way it
would stop being true is a **vendored copy of the editor's writer**, added to
make a round-trip test work locally — which is the one edit that would quietly
undo hard case one's whole answer. The rule should name it.

**The four straddling unit tests, and where each lands.**

| test | today | after |
|---|---|---|
| `device_roundtrip.test.ts` | writer against reader in one process | **cannot survive as-is.** Becomes the `package` fixture family — the argument in [hard case one](#the-answer-a-package-kind-under-devicefixtures) |
| `device_fixtures.test.ts` | both halves against the fixtures | **divides in two.** Each side keeps the checks for the code it holds; the editor's half runs against the pin |
| `empty_slot.test.ts` | an empty key on both sides of the seam | divides the same way, and the seam it names is now a file |
| `negation.test.ts` | the cross, in the tile and in the package | the tile half goes to the talker, the package half to the editor |

`e2e/loader.spec.ts` and `e2e/device_export.spec.ts` divide by page, which is
what they already are. `e2e/package.ts` — a package built through the editor's
own writer, *"no fixture binary, and nothing synthesised"* — is the loader
suite's one import from `src/`, and it is the same question as
`device_roundtrip.test.ts` with the same answer: after the split the talker's
e2e suite builds its input from a committed fixture instead.

---

## What this does not decide

~~**Whether to split at all.** [ADR 0006](../adr/0006-builder-and-hardware-one-repo.md)
asks for evidence and nothing here is evidence. This page makes the move
cheaper to schedule and no more due, exactly as ADR 0011 did.~~

**Decided elsewhere, the same day.**
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) records the split
as decided. The first half of the sentence above stands and 0012 says the same
thing in its own words: nothing here is evidence, no condition of ADR 0006
fired, and 0012 claims none. What it argues instead is that ADR 0011 took the
seam off the thing those conditions protect. The move is still not scheduled,
which is the part of this paragraph that was never about evidence.

**Where `device/fixtures/` lives, and what may be added to it.**
[`repository-map.md`](repository-map.md#the-three-names) records
ADR 0011's answer — both device implementations end up in `vorlaut-diy-talker`,
so the fixtures sit beside both halves and no fourth name is needed — and
**ADR 0012 has since recorded the split as decided and answered this directly**:
the fixtures stay in `vorlaut-diy-talker`, beside both implementations, and no
fourth name is needed. Two things here were inputs to it rather than answers
over it, and it answered one of them and declined the other:

- Direction one assumes the editor can **pin** `device/fixtures/` from another
  repository. Nothing about that is new — it is `exchange/`'s mechanism pointed
  the other way — but it makes the editor a third party to a directory ADR 0009
  says belongs to neither half, and that is worth a sentence somewhere.
  *Answered:* ADR 0012's Why has it. Pinning is consumption and not ownership;
  ADR 0009's rule is about who may **change** a format, and a third pinned
  consumer does not acquire that. The directory goes on belonging to neither
  implementation.
- Hard case one proposes **widening** the directory by one kind, from the bytes
  the talker reads to the file the page reads. If ADR 0012 draws that scope line
  differently, its answer wins and the fixtures need a home of their own — the
  mechanism in this page's recommendation survives the move to a different
  directory; only the address changes.
  *Not drawn:* ADR 0012 decides where the directory lives and says nothing about
  what may be added to it, deliberately. Widening it by a `package` kind is this
  page's proposal to argue on its own merits, and nothing in 0012 blocks or
  blesses it — the address is settled either way.

**The three stale counts.** Recorded [above](#first-the-count--because-four-documents-disagree),
not repaired here.

**Everything about `tests/reference/`.** Untouched, and
[`format-freeze.md` §6](format-freeze.md#6-testsreference-and-devicefixtures--the-boundary-is-real)
already divides the locks: `obf.lock.json` and `tts.lock.json` with the editor,
`layout.lock.json` with the writer it protects, and `tiles.lock.json` with
`tiles.ts` — which, given the preview relocates and `thumbnailSize` gets a freeze
of its own, is no longer the awkward one that section calls it.
