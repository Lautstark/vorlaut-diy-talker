# The same tile, twice

> **`tiles.py`, `tools/tilecheck.py` and `tools/tilefreeze.py` no longer
> exist.** The Python half was deleted once the browser took over; what it
> rendered survives as the frozen tiles in `tests/reference/tiles/`, and
> [frozen-references.md](frozen-references.md) says what that does and does
> not still check. This document is kept because the reasoning below is why
> `loader/src/tiles.ts` is written the way it is - the Lanczos arithmetic, the
> premultiply, the rounding - and none of that changed with the deletion.

The app is being rewritten as a static site with no server behind it, so
`render_symbol()` in `tiles.py` had to be written a second time
in the browser, as [`loader/src/tiles.ts`](../loader/src/tiles.ts). This is what that
port has to get right, how far off it actually is, and why the answer decided
what the JavaScript does.

The short version: the two agree byte for byte, so `TILE_PIPELINE` stays at 2
and no device re-syncs. That was not the expected outcome and it is not free —
it cost a Lanczos filter written out by hand — so the reasoning is written down
here rather than left in a commit message.

## Why byte for byte is the bar

A tile is named after a hash of its input: the source image and
`TILE_PIPELINE`, nothing else. That is what lets the same picture in a blue and
a green set be one file on the device, and it is what lets the sync fetch only
what it does not already have — see
[software.md](software.md#building).

The hash covers the input, not the output. So two renderers that disagree
produce **different bytes under the same name**, and nothing anywhere notices:
a device that synced before the rewrite keeps its old tiles, a device that
syncs after gets new ones, and both believe they are up to date. The intended
way out is to bump `TILE_PIPELINE`, which renames every tile and costs exactly
one full re-sync per device. Harmless, but it should be a decision somebody
made, not a surprise.

Hence the bar. Anything short of identical means bumping the number.

## What had to be reproduced

Pillow is not doing anything exotic here, but four details are not the obvious
choice and all four move pixels:

- **`Image.thumbnail()` never enlarges.** A picture smaller than 128x128 keeps
  its size and is only centred.
- **The rounded side is picked, not floored.** Of floor and ceil, `thumbnail()`
  takes whichever leaves the aspect ratio closer to the original, ties to
  floor. One pixel of disagreement here shifts everything after it.
- **RGBA is resampled premultiplied.** `Image.resize()` converts an RGBA image
  to `RGBa`, resizes, and converts back. This is easy to miss and it is the
  single reason the port is possible at all: a canvas stores colour
  premultiplied too, so both sides drop the colour hiding under fully
  transparent pixels instead of dragging it into the edges.
- **That same conversion drops `reducing_gap`.** Pillow normally box-averages
  by an integer factor before filtering. The recursion for RGBA does not pass
  the argument on, so for our images — everything goes through
  `convert("RGBA")` — the pre-shrink never happens. Implementing it would have
  been wrong.

The placeholder cross is reproduced too, down to the rasterisation: Pillow
draws a thick line as a quadrilateral with hard edges, a canvas would
antialias it, and every pixel along both diagonals would have differed for a
reason that has nothing to do with resampling.

## The measurement

`tools/tilecheck.py` served
`tools/tilecheck.html`, the page rendered every
fixture with every renderer and `PUT`s the raw RGB565 back, and Python compares
it against `tiles.render_symbol()`. Deltas are counted in RGB565's own units —
0..31 for red and blue, 0..63 for green — because that is what the panel is
handed, and three of the eight bits per channel are gone by then.

```bash
python3 tools/tilecheck.py
```

Ten fixtures: the five in `example/symbols/`, plus a wide opaque one for the
strip that takes the symbol's colour, one whose corners disagree, one smaller
than a tile, one soft-edged throughout, and one that does not resolve. Anything
in `content/symbols/` is picked up as well.

Measured 2026-08-22 on macOS 26.5, in Chromium 148 and Safari 26.5, when a
tile was the 116×116 square inside a border. It is the whole 128×128 display
now; these numbers were not taken again, and the count below is the pixel count
of the tile they were taken on:

| renderer | pixels differing | worst | max delta r/g/b |
|---|---|---|---|
| `lanczos`, both engines | **0 of 13456, every fixture** | — | 0 / 0 / 0 |
| `canvas`, Chromium | 0–29.5% | `wide-opaque` | 8 / 16 / 8 |
| `canvas`, Safari | 0–45.6% | `tall-soft` | 13 / 26 / 13 |

## What that settles

**`drawImage` is not an option, and not mainly because it drifts from Pillow.**
A worst-case red delta of 13 is 13 of 32 steps — at the edge of a symbol, half
the range. That alone would only have cost a `TILE_PIPELINE` bump. The
disqualifying part is the third row against the second: the two browsers do not
agree with each other either. `hilfe.png` is off by 6 red steps in Chromium and
by 12 in Safari, so the bytes would depend on which browser happened to do the
sync — while the file name, which is a hash of the input, would not. A
content-addressed cache whose content is not a function of its address is
broken, and no version bump repairs that.

**The hand-written Lanczos costs 50–200 ms per tile** against 1–20 ms for
`drawImage`, on the fixtures above. For a page that renders a handful of tiles
per set that is not worth a second thought, and it buys an output defined by
[`loader/src/tiles.ts`](../loader/src/tiles.ts) alone.

**So `TILE_PIPELINE` stays at 2.** The browser produces the tiles the devices
already have. Nothing renames, nothing re-syncs, and the two implementations
can sit side by side for as long as the rewrite takes.

## Keeping it that way

Everything in `loader/src/tiles.ts` except decoding the PNG is arithmetic on plain
arrays, so [`tests/test_tile_render_js.py`](../tests/test_tile_render_js.py)
runs it under node against tiles frozen from Pillow on every CI run — no
browser and, since `tools/tilefreeze.py` wrote those
down, no Pillow either; see [frozen-references.md](frozen-references.md). It also
checks that `TILE_PIPELINE` in the JavaScript still matches the one in
`tiles.py`, which is the failure that would otherwise be silent.

What that test cannot cover is the decode itself, and the composite onto the
ground when the `canvas` renderer is used. `tools/tilecheck.py` is the version
that covers those, and is worth running by hand after anything touches the
rendering — in more than one browser, which is the whole point.
