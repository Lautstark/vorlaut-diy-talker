# ADR 0013 — The device preview moves to the loader page, and stops being a prediction

**Status:** accepted · **Date:** 2026-08-27 · **Applies to:** the two names
`renderSymbol()` and `TILE_SIZE` on
[`tests/unit/layers.test.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/tests/unit/layers.test.ts)'s crossing list, and
the control they were reached from

## Context

[ADR 0011](0011-editor-exports-the-talker-repository-sends.md)'s Built section
counted what the two directories take out of each other and put the editor's
side at ten names. Three of them come out of `loader/src/tiles.ts`, and two of
those three — `renderSymbol()` and `TILE_SIZE` — were there for one control:
`previewInto()` in `src/backend/local.ts`, drawing a symbol the way a ScreenKey
draws it so that a pictogram could be judged at the 15.21 mm a key really is.
It was **the only place the editor ran the device's own code**.

[ADR 0012](0012-the-repository-splits-editor-leaves.md) decided that the editor
leaves, which turns that import into a repository boundary.
[`docs/split-crossings.md`](../docs/split-crossings.md#hard-case-two--tilests-does-not-divide-and-does-not-have-to)
priced every name on the list one at a time, and its section *"The preview: not
dropped, relocated"* is the argument this file decides. **It is not restated
here.** The short of it is that there are three options, two of them are ruled
out by measurements already in this repository, and the third costs nothing
where it lands.

## Decision

**`previewInto()` is deleted, and the loader page draws the picture instead.**
Under step 3, after the compile, every set of the file is shown the way the
hardware lays a set out — the speaker's hole, the set key and the four speech
keys — with every tile at 15.21 mm.

**It renders nothing of its own.** [`loader/src/compile.ts`](../loader/src/compile.ts)
already draws every tile once and now says where each of them lands;
[`loader/src/preview.ts`](../loader/src/preview.ts) is the inverse of
`toRgb565Be()` and a grid, and there is no second opinion about a pixel
anywhere in it.

**`renderSymbol()` and `TILE_SIZE` come off the crossing list**, which goes
from ten names to eight. They are struck rather than kept against a possible
return, because that file's own rule is that a name left on it without a live
argument is the boundary quietly closing again.

**The editor's preview toggle goes with the function it drove**, and the work
head's action slot is empty on both editors.

## Why

**The two ways of keeping it in the editor are both priced, and both are
worse.** Duplicating is not `renderSymbol()`'s twenty lines — it is
`resampleLanczos`, `premultiply`, `compose`, `negateInto`, `toRgb565Be` and the
rest, effectively all of `tiles.ts`, as a second Lanczos implementation across a
repository boundary with `TILE_PIPELINE` a live number and no release mechanism,
because ADR 0011 deleted the one that existed. Drawing it with the browser's own
scaler is what `renderSymbol`'s `"canvas"` path does, and
[`docs/tile-rendering.md`](../docs/tile-rendering.md#the-measurement) measured
it: up to 29.5% of pixels differ in Chromium and 45.6% in Safari, and the two
engines do not agree with each other either. A preview that is wrong by a
browser-dependent amount is not the thing that control is for.

**On the loader page it costs nothing, because the page has already done the
work.** Step 3 decodes every source and renders every tile — that is what it is
for — and the only thing missing was a statement of which tile lands on which
panel. `compileDevice()` computed that already, to hand to `renderLayoutBin()`,
and threw it away.

**And it stops being a prediction.** In the editor this said what a ScreenKey
*would* draw from a symbol in the store. Here it is the bytes about to go down
the cable: the same tiles, under the same names, that
[`loader/src/cable.ts`](../loader/src/cable.ts) sends a press later. That is a
stronger claim than the one it replaced, and it is why the picture is on the
compile step rather than in a step of its own — it is not something to do, it
is what this step made.

**The cost is a longer loop, and it is stated plainly rather than argued away.**
Today a carer picking a pictogram sees it at 15.21 mm as they pick, one symbol
at a time. Afterwards they see the whole board that way, after an export, on
another page. **That is worse for the person doing it, every time.** It is
accepted on the two grounds ADR 0011 accepted the same cost in the same place
for the build itself: [`loader/README.md`](../loader/README.md) already
describes the loop as *change it there, export again, choose the new file*, and
there are no users yet — so the moment to pay this is before anybody has a habit
built on the shorter one.

**What the move buys back is not nothing, and it is the honest comparison.**
The editor's preview was one symbol at a time on the set being edited; this is
every set at once, which is what the device shows and what somebody is really
asking about. `editor-diy`'s own note said as much about the toggle it had —
*"the whole board at once rather than a strip under each key, which is also the
honest comparison, since the device shows five of these side by side"* — and the
loader page can show five boards where the editor could show one.

## Consequences

- **ADR 0011's Built section is amended, not upheld.** *"`src/` takes seven
  format constants out of `loader/`, plus `renderSymbol()`, `TILE_SIZE` and
  `thumbnailSize()` — ten names"* is now seven constants and `thumbnailSize()`,
  which is eight. The list is still the bill for the split and still lives in
  `layers.test.ts`; it is one item shorter, and the item removed was the largest
  single entry on it. See the Examined note in
  [0011](0011-editor-exports-the-talker-repository-sends.md#examined).
- **ADR 0012's count is amended the same way**, in its Why and in its
  `tiles.ts` consequence. That consequence said the editor *"goes on importing
  one function across a repository boundary"* about `thumbnailSize()`, and that
  half is unchanged and is the one name that genuinely has two consumers in two
  products; what changed is that it is now the only one.
- **`renderSymbol()` has no production consumer anywhere.** It had none in
  `loader/` before this — `compile.ts` uses `renderPixels()` — and
  `previewInto()` was the last one in `src/`. It stays in `tiles.ts` because
  `tools/tilecheck.py` is what keeps `docs/tile-rendering.md`'s measurement
  repeatable and `tests/unit/negation.test.ts` reads the pipeline through it.
  Deleting it would delete the ability to re-measure the thing this decision
  rests on.
- **`compileDevice()` answers with an object rather than a `Map`.** `{ files,
  screens }`, where `files` is exactly what it always returned — the claim
  `tests/unit/device_roundtrip.test.ts` holds it to is untouched — and `screens`
  is the table it hands `renderLayoutBin()`. Nothing else about the compile
  moved, and no pixel is rendered twice.
- **The five-key editor owns no fixed labels at all.** `Editor.labels()` for
  `diy` is empty and its `wire` step does nothing: the delete button went into
  the set's card, the transfer button went to this page (ADR 0011), and the
  preview toggle went with the picture it drew. Everything it puts on screen is
  built by `render()` or by a sheet, with its words read as it is made.
- **The loader page still makes no network call.** The picture is a canvas over
  bytes that were already in memory. `exchange/SPEC.md` §5.2's sideload case is
  untouched, and there is no `fetch` on this page.

## Not to be "fixed" later

**Somebody will ask for the picking-time preview back**, and the request will be
right about the thing it complains about: choosing a pictogram and finding out
two steps later that it does not survive at 15.21 mm is a worse loop than seeing
it as you choose. This file exists in front of that request because the obvious
way to grant it — *"just draw the tile in the editor as well"* — is the option
priced above, and it does not get cheaper by being asked for a second time.

What somebody proposing it would have to bring is a measurement from users who
by then exist, and then choose between the same three options: duplicate
`tiles.ts` across a repository boundary with nothing holding the copies together
(the failure [`frozen-references.md`](../docs/frozen-references.md) records),
draw it with `drawImage` and accept a preview that differs from the device by up
to 45.6% of pixels and from itself between browsers, or publish the compiler as
a package — which is the route ADR 0011 replaced, at a release and a bump per
format change. There is no fourth, and *"only for the preview, it does not have
to be exact"* is the second option wearing a smaller word: a preview whose whole
job is to be what the device shows cannot be the thing that is allowed to be
wrong.

The lesser version — a rough preview in the editor **and** the exact one here —
is worse than either end-state for the reason ADR 0011 gives about two paths to
a device: two pictures of one tile, one of them right, and the wrong one is the
one somebody looks at while deciding.
