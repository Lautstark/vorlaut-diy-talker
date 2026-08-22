# What checks the browser, now that the Python is gone

Four subsystems used to exist twice — tile rendering, the layout binary, the
speech chain and symbol search — because the app was being rewritten from a
Python web app into a browser-only static site. The Python halves were also,
for a while, the only reason anybody knew the JavaScript halves were correct.

They have now been deleted. This document is what was recorded first, and what
that recording does and does not still cover.

The precaution came from [`mitreden`](https://github.com/Lautstark/mitreden):
when that project deleted its Python half, it found that its browser audio
tests measured the output with the same function that had decided the gain. A
wrong loudness implementation would have satisfied every one of them. Real
`ffmpeg` was the only outside opinion available and it was minutes from being
deleted; it was used one last time to freeze three reference tones, and those
numbers are now the only external check left in that repository.

**A test that can only compare a thing against itself passes forever.** So the
outside opinions here were written down while there were still outside
opinions to write down — and then the Python went.

## The four lock files

| | frozen from | needs, to check it | what it protects |
|---|---|---|---|
| [`tests/reference/tts.lock.json`](../tests/reference/tts.lock.json) | real `ffmpeg` 9.0.1, and `tts.py` driving it | node | `static/vendor/stimmquelle/` |
| [`tests/reference/tiles.lock.json`](../tests/reference/tiles.lock.json) | Pillow, through `tiles.py` | node | `static/tiles.js` |
| [`tests/reference/layout.lock.json`](../tests/reference/layout.lock.json) | `layout_format.py`, confirmed by the firmware's C reader | node, a C++ compiler | `static/layout_format.js` |
| [`tests/reference/symbols.lock.json`](../tests/reference/symbols.lock.json) | `metacom._scan_files()` | node | `static/symbols.js` |

Each was written by a tool that could only run while the Python half was here
— `tools/ttsfreeze.py`, `tools/tilefreeze.py`, `tools/layoutfreeze.py`,
`tools/symbolfreeze.py`. They are gone with it; the lock files carry what
produced them, when, and what would invalidate them, in the shape
`tools/vendor.lock.json` uses next door, and git has the tools if one is ever
needed again.

**`git add -A` before running the suite, when you have just added fixtures.**
The reason is in `tests/run.py`'s docstring and in the Tests section of
[`software.md`](software.md), where it applies to any new file. Freezing is the
worst case of it: these arrived twenty-seven files at a time.

The direction only goes one way, and it is the whole point:

> Changes to `static/` never invalidate a lock file. That is the thing being
> checked. Refreezing to make a red test green would leave the browser
> compared against itself, which is what these files exist to stop.

## What a lock file can and cannot answer

It could not be said often enough while the deletion was pending, and it still
decides what these files are worth:

**A live oracle re-derives the answer for any input. A fixture only answers for
what was recorded.** What is frozen here keeps regression detection on the
recorded set. It cannot work out the right answer for a case nobody recorded —
bump `TILE_PIPELINE`, add a field to the layout, and these files cannot tell
you the new correct bytes. Nothing in the repository can, now.

That is the accepted cost of the deletion, not an oversight. It was taken
knowingly: the product has no users yet, the code is early, and carrying six
Python modules to answer questions nobody was asking was judged the worse
trade. If that changes — if the formats settle and somebody needs to know what
a *new* symbol or a *new* layout should produce — the answer is to restore the
oracle from git for as long as it takes to re-freeze, not to guess.

## What is now checked against something that is not itself

### The speech chain — the one that had nothing

`tests/test_browser_tts.py` was never a behavioural test. It parses constants
out of `static/tts/level.js` and compares them with `tts.py` — its own docstring
says "the exported numbers out of level.js, without running any JavaScript."
Correct constants over wrong arithmetic passed every check in it. The real
verification was `tools/ttscheck.py`, run by hand,
whose result exists as a table in [`browser-tts.md`](browser-tts.md) that
nothing regenerates.

[`tests/browser/level.test.mjs`](../tests/browser/level.test.mjs) now runs the
module, via [`tests/test_browser_js.py`](../tests/test_browser_js.py) so
that `python3 tests/run.py` picks it up. Four kinds of frozen reference:

- **The ruler.** Five tones measured by `ffmpeg`'s `ebur128`. `integratedLufs()`
  is what decides the gain, so measuring the output with it proves nothing —
  these break that circle. 1000 Hz at two amplitudes, 440 Hz, 60 Hz and
  10000 Hz, each somewhere the K weighting is doing something different: 440 Hz
  is deliberately not flat, 60 Hz is the only one down the high-pass skirt, and
  10000 Hz is the only one up on the head shelf. Agreement when frozen was
  0.04 LU or better on all five.
- **The peak meter.** `truePeakDb()` is the other half of the gain decision.
  Two tones sampled an eighth of a cycle off their own peaks, so every sample
  sits 3 dB below the real maximum. Three opinions frozen for each: `ffmpeg`'s
  reading, the waveform's actual peak — it is a sine, so that is arithmetic —
  and the loudest sample, which is what a meter that never interpolated would
  report.
- **Resampling.** 22050 Hz down to 16000 Hz, which is what every recording
  goes through. A tone below the new Nyquist rate must keep its level; one above
  it must disappear rather than fold back. The gap between those answers is
  about 50 dB.
- **The whole chain.** Four synthetic utterances, each put through
  `tts.postprocess()` — real `ffmpeg`, the real filter chain — and the finished
  file measured. `level.js` gets the same bytes and must arrive at the same
  place. This is the check that would have caught anything, and it is only not
  circular because the ruler above is checked first, then used.

The three 440/1000 Hz values reproduce `mitreden`'s frozen numbers exactly
(−23.0, −9.0, −17.7), which is why they were taken rather than reinvented — a
reference that differed by 0.05 LU between two repositories for no reason
anybody could name would be worse than no shared reference.

### Tile rendering — honest, but the reference evaporated

`tests/test_tile_render_js.py` really did render both ways and compare, which
is why it could say 0 of 13456 pixels differ. But it built its inputs with
`Image.new()` and took its expected bytes from `tiles.render_symbol()`, so both
sides were recomputed by Pillow on every run. Remove Pillow and the reference
did not fail loudly — it evaporated: the test skipped, said Pillow was missing,
and the suite stayed green with the renderer unchecked.

Fourteen tiles are now committed, with the pictures that made them. Frozen as
decoded pixels rather than PNGs, gzipped, so the check needs no PNG decoder and
no Pillow — node's own `zlib` is enough. The five symbols in `example/symbols/`
are in, because a fixture nobody looks at is a worse regression test than the
picture on the device; the other eight were drawn to reach a branch nothing
else reaches:

| fixture | why it is there |
|---|---|
| `wide-opaque` | METACOM's own 706×589, opaque to the edge, all four corners one colour — so the leftover strip takes that colour instead of white. Checkerboard in the middle, which is the hardest thing there is to resample |
| `tall-soft` | taller than wide, soft-edged all round, so premultiply, resample and unpremultiply all see partial alpha |
| `small-wider` | smaller than the tile in both directions: nothing is resampled and the whole answer is where it gets centred |
| `corners-differ` | fully opaque, one corner a different colour — the only fixture that reaches white by the corner test rather than the alpha test |
| `nearly-opaque` | one pixel at alpha 254, with the corners in agreement, so the two paths give *different* grounds and 39 rows of strip to show it in |
| `odd-leftover` | shrinks to 116×57, leaving 59 rows to halve — rounding instead of flooring moves every pixel |
| `quantisation` | already 116×116, so nothing is resampled and the RGB565 conversion is alone. Values sit either side of every bit it throws away |
| `fully-transparent` | every pixel transparent over a colour, which must be dropped rather than smeared into the edges |

The test now makes three comparisons and is explicit about which survives: node
against the frozen bytes (needs nothing else), `tiles.py` against the frozen
bytes (catches a Pillow upgrade, skipped without Pillow), and the constants.

### The layout binary — the instinct was wrong

`tests/test_layout_format.py` compiles the firmware's own C reader — the same
`firmware/vorlaut/layout_format.h` that `vorlaut.ino` includes at line 36,
calling the `parseLayout` the device calls at line 150. That reader owes Python
nothing, so the obvious conclusion is that this check survives on its own.

It does not, and the reason is worth keeping. The reader survives; what it was
compared against did not. `normalize_layout()` in `layout.py` built every input
and `static/layout_format.js` has no equivalent — only `activeSets` and
`normalizeColor`. `expected()` built the field lines the reader was held
against. And `render_layout_bin()` was the only opinion on whether the
JavaScript bytes were right. Delete Python and what is left is a reader that
parses whatever it is handed and a test with nothing to compare.

So seventeen cases are frozen: the normalized layouts, the bytes, and the fields
the reader made of them. [`tests/test_layout_frozen.py`](../tests/test_layout_frozen.py)
needs only the lock file, node and a compiler. Two independent things have to
agree for it to pass, which is what keeps it from being a mirror: the bytes are
a captured value, and on their own would only say the browser has not changed —
but the C reader is *compiled from the firmware's source at test time*, not
frozen, and its field-by-field output is what makes a frozen byte string mean
something.

`tests/test_layout_format.py` stays as it was and keeps doing the live
three-way comparison. One check was added to it: that the frozen layouts are
still what `normalize_layout()` produces. Nothing else would notice that going
stale — the frozen cases would keep agreeing with each other about a layout
Python no longer generates.

### Symbol search — a paraphrase, not an oracle

A symbol lives in `layout.json` as `metacom:essen`. `metacom.py` keys the
collection by the file's stem and `obf.py` reads it back that way; the browser
gets a path out of the vendored `bildquelle` package and `static/symbols.js`
turns it into the same reference. If those drift, every layout that exists
points at symbols nobody can find.

`tests/test_symbol_reference.py` checked this all along, against
`"metacom:" + Path(path).stem` written out by hand. Two things were wrong with
that once `metacom.py` is going: the paraphrase survives the deletion and then
passes for ever, both sides of it being in the browser's half — and a
paraphrase can already be wrong. This one was. `_scan_files()` globs `"*.png"`
and nothing else, so for the `.jpeg` and `.webp` cases in that test
`metacom.py` files nothing at all, while the restatement confidently supplied
an answer.

So `tools/symbolfreeze.py` asks the real indexer: it builds a folder, runs
`metacom._scan_files()` over it, and writes down what that filed each case
under. Where the glob does not reach a file the name is still frozen from
Python — `path.stem` *is* the expression in `_scan_files()`, and only the glob
kept the file out — but the lock records that nothing resolves for it, which is
a fact about the collection rather than a fault in the adapter.

Those unreachable cases turned out to be load-bearing, and not for the reason
they were added. Every PNG makes *strip the last suffix* and *drop four
characters* the same rule, so a `.jpeg` is the only thing in the set that can
tell those two apart. Without it a mutation doing the latter passed every
check — found by mutation testing, not by reading.

## How we know the checks bite

Every claim above was tested by breaking the implementation and confirming the
suite went red. Nine of ten mutations to `level.js` were caught, and the tenth
was too after the trim check was tightened; ten of ten to `tiles.js`; nine of
ten to `layout_format.js` and the firmware header, with the tenth an equivalent
mutant that produces identical bytes for every input the format allows.

Representative, with the check that fired:

| broken on purpose | caught by |
|---|---|
| the adapter dropping four characters instead of finding the dot | the one `.jpeg` case, and nothing else |
| the adapter cutting at the first dot | the fixture whose name carries a dot that is not the extension |
| K-weighting head shelf removed | 10000 Hz and 1000 Hz tones |
| K-weighting high pass removed | the 60 Hz tone, and only that |
| BS.1770's −0.691 offset dropped | all five tones |
| relative gate removed | the `burst` utterance against `tts.py` |
| true peak taken over the samples only | both peak tones, by 3 dB |
| resampling by linear interpolation | the 10 kHz tone folding back instead of going |
| the −1.5 dBTP ceiling ignored | `burst` landing 2 LU loud and over the ceiling |
| Lanczos support 3 → 2 | nine tiles |
| centring rounds instead of flooring | `odd-leftover`, and four others |
| RGB565 rounds instead of truncating | twelve tiles |
| alpha 254 read as opaque | `nearly-opaque`, and only that |
| `NAME_BYTES` changed under the fleet | the C reader's fields |
| a frozen case edited by hand, hash refreshed | the JavaScript writer disagreeing |

## What is still only checked against itself

An honest list is worth more than a claim of coverage. In rough order of how
much it would cost to be wrong:

1. **No real browser is in CI, and no longer any way to use one.** Everything
   above runs under node. The vendored chain and `tiles.js` are deliberately
   free of the DOM, so node is a fair stand-in for the arithmetic — but
   `tools/ttscheck.html` and `tools/tilecheck.html`, the pages that drove them
   in a real tab, were deleted with the Python harnesses that fed them. Until
   something replaces those, nothing exercises a browser at all.
2. **PNG decoding is not covered at all.** The tile fixtures are frozen
   *after* the decode, because that is the one step the browser does and this
   test does not. `tools/tilecheck.py` measured it lossless for these symbols
   — once, by hand, and it no longer exists. A browser that decoded a PNG differently would not be
   noticed here.
3. **No real speech is frozen.** `piper` is not installed on this machine and
   is not deterministic anyway — three renders of one sentence gave three
   different files. The utterances are synthetic. Agreement on real sentences
   is still only [`browser-tts.md`](browser-tts.md)'s hand-run table, and
   nothing regenerates it.
4. **`static/tts/speak.js` has no behavioural test.** The voice path —
   vits-web, Azure — is checked only for the shape of `voices.json` and the
   `onnxruntime-web` pin, in `tests/test_browser_tts.py`. Nothing runs it.
5. **Symbol search is frozen for the name only.** What the adapter makes of
   a path is now checked without `metacom.py` — but that is the whole of it.
   Whether the vendored `bildquelle` *finds* the right symbol is the package's
   own business and has its own tests upstream; nothing here exercises the
   search, the index it builds, or the METACOM `.asar` reader in
   `metacom.py`. Those are still checked only by `tests/test_metacom_index.py`
   against Python.
6. **`normalize_layout()` has no browser equivalent, and now has a copy.**
   The frozen layouts are its output. If the browser ever has to normalize a
   layout itself, nothing checks that against these.
7. **Tolerances.** The speech checks allow 0.15 LU on the ruler and 0.2 LU
   end-to-end, against agreement of 0.04 and 0.05 when frozen. The slack is
   room for a different `ffmpeg` build, not measured error — but a systematic
   mistake smaller than it would pass.
8. **`ffmpeg` 9.0.1 is taken on trust.** If it is wrong, everything here
   inherits that. Two things argue against it: `mitreden` froze the same three
   tones from an earlier build and got the same numbers, and
   `Lautstark/stimmquelle` ported this measurement independently and agreed
   within 0.03 dB.
9. **The lock files only answer for what was recorded**, which is the whole
   shape of the deal with golden files and is why "this does not make the
   Python removable" is at the top of this document rather than here. All
   four freeze tools import Python modules, deliberately: it is what stops a
   red test being "fixed" by refreezing, and it is what makes regenerating
   them impossible after a deletion rather than merely inadvisable.
