# What checks the browser, now that the Python is gone

Five subsystems used to exist twice — tile rendering, the layout binary, the
speech chain, symbol search and the Open Board Format converter — because the
app was being rewritten from a Python web app into a browser-only static site.
The Python halves were also, for a while, the only reason anybody knew the
JavaScript halves were correct.

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
opinions to write down. That turned out to be the last chance: on 2026-08-22
the Python halves were deleted, and this is what is left behind them.

## The five lock files

| | frozen from | needs, to check it | what it protects |
|---|---|---|---|
| [`tests/reference/tts.lock.json`](../tests/reference/tts.lock.json) | real `ffmpeg` 9.0.1, and `tts.py` driving it | node | `node_modules/@lautstark/stimmquelle/` |
| [`tests/reference/tiles.lock.json`](../tests/reference/tiles.lock.json) | Pillow, through `tiles.py` | node | `src/data/tiles.ts` |
| [`tests/reference/layout.lock.json`](../tests/reference/layout.lock.json) | `layout_format.py`, confirmed by the firmware's C reader | node, a C++ compiler | `src/data/layout_format.ts` |
| [`tests/reference/symbols.lock.json`](../tests/reference/symbols.lock.json) | `metacom._scan_files()` | node | `src/data/symbols.ts` |
| [`tests/reference/obf.lock.json`](../tests/reference/obf.lock.json) | `obf.py` and `normalize_layout()` in `layout.py` | node | `src/data/obf.ts` |

Each was written by a tool that could only run while the Python half was here
— `tools/ttsfreeze.py`, `tools/tilefreeze.py`, `tools/layoutfreeze.py`,
`tools/symbolfreeze.py`, `tools/obffreeze.py`. They went with it; the lock
files carry what produced them, when, and what would invalidate them, in the
shape `tools/vendor.lock.json` uses next door, and git has the tools if one is
ever needed again.

**`git add -A` before running the suite, when you have just added fixtures.**
The reason is in `tests/run.py`'s docstring and in the Tests section of
[`software.md`](software.md), where it applies to any new file. Freezing is the
worst case of it: these arrived twenty-seven files at a time.

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
bump `TILE_PIPELINE`, add a field to the layout, and these files cannot say
what the new correct bytes are. Nothing in the repository can, now.

That makes them a **supplement to the oracles, not a replacement for them.**
They are insurance against a check evaporating quietly; they were never the
check itself.

The bar for removing the Python used to be **replaced and proven on the
bench** — not "replaced", and not "the hardware arrived". On 2026-08-22 that
bar was dropped by a decision rather than met: the halves went before the
cable path had ever touched hardware, on the grounds that the product has no
users, the formats are early, and carrying a second implementation to answer
questions nobody was asking was the worse trade. So this section is no longer
an argument against anything. It is the price, written down.

If that trade ever stops looking right — if the formats settle and somebody
needs to know what a *new* symbol or a *new* layout should produce — the
answer is to restore an oracle from git for as long as it takes to re-freeze,
not to guess.

One removal these do not bear on at all, because the two get conflated easily:
the firmware's Wi-Fi stack — `discover.h`, `networks.h`, `pairing.h`, `sync.h`
and the five-digit code — is not an oracle for anything. It is the old
transport, its bar is one real end-to-end cable transfer, and it is written up
in [`cable.md`](cable.md) under "Before the Wi-Fi path can go".

## What is now checked against something that is not itself

### The speech chain — the one that had nothing

`tests/test_browser_tts.py` was never a behavioural test. It parses constants
out of `static/tts/level.js` and compares them with `tts.py` — its own docstring
says "the exported numbers out of level.js, without running any JavaScript."
Correct constants over wrong arithmetic passed every check in it. The real
verification was `tools/ttscheck.py`, run by hand,
whose result exists as a table in [`browser-tts.md`](browser-tts.md) that
nothing regenerates.

[`tests/unit/level.test.ts`](../tests/unit/level.test.ts) now runs the
module, via [`npm test`](../npm test) so
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
and `src/data/layout_format.ts` has no equivalent — only `activeSets` and
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

### The board as a document — the only one with no second opinion

The other four have something outside Python to fall back on: Pillow is one
renderer among renderers, `layout.bin` has the firmware's own C reader
compiled at test time, the speech chain has `ffmpeg`, and symbol search is a
naming rule two implementations both state. A `.obf` is a mapping this project
invented — which set becomes which board, what a set key is, where the colour
lives — so `obf.py` was the entire outside opinion on whether
[`src/data/obf.ts`](../src/data/obf.ts) is right.

`tests/test_obf_js.py` compared the two live and imported `obf` at the top, so
it could not survive the deletion in a form that reported anything: it would
fail to start, be removed with the Python it named, and leave nothing with an
opinion about the converter at all. That is exactly what nearly happened —
this was the last of the five to be frozen, and it was frozen hours before the
deletion rather than days.

So `tools/obffreeze.py` writes down what the oracle says, in the shape the
node driver answers in, and `tests/test_obf_frozen.py` compares the two with
nothing but node:

- **The helpers**, on the arguments where two implementations of one rule
  drift — a symbol reference split and rejoined, `image_id`'s SHA-256 over
  names of one, two, three and four byte characters, `rgb()` out of a colour
  that still needs normalizing, a locale nobody has heard of.
- **Every layout on the way out**, as the document it becomes, field by field.
- **Every document on the way in**, as the layout it becomes — the exporter's
  own, and the foreign ones, which is the half that matters. A third row of
  keys, links by path and by name, an orphan, a picture carried as pixels, a
  label and a vocalization that disagree.
- **`normalize_layout()`**, which is in `layout.py` and decides what a
  complete layout is. The browser has a copy of it now; without this the copy
  is checked against nothing.
- **The licence rule**: nine documents, seven of which have to be refused, and
  the sentence each is refused with.
- **The container.** Thirteen files under
  [`tests/reference/obf/`](../tests/reference/obf/) — nothing compressed, no
  manifest, a manifest naming a root nobody packed, board ids that are not the
  file names, a board that is a list, three that have to be refused rather
  than answered with an empty layout — and, for every export case, the members
  `write_obz()` packed with their fixed timestamp and mode.

Byte-identical `.obz` files are not the bar and cannot be: `zlib` and the
browser's `CompressionStream` are two compressors that agree about the format
and not about the output. What is frozen is what comes out of the members, and
Python's own `zipfile` — which is not going anywhere — is what opens the
browser's file to get at it.

`tests/test_obf_js.py` kept the live comparison while `obf.py` was here, and
gained one check before it went: that the frozen answers were still the ones
the oracle gave, by running `tools/obffreeze.py --check`. Nothing else would
have noticed that going stale — the browser and a lock file would have gone on
agreeing about a mapping `obf.py` no longer had.

### Symbol search — a paraphrase, not an oracle

A symbol lives in `layout.json` as `metacom:essen`. `metacom.py` keys the
collection by the file's stem and `obf.py` reads it back that way; the browser
gets a path out of the vendored `bildquelle` package and `src/data/symbols.ts`
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

### And one check that needs no oracle at all

Every lock file answers only for the cases in it, and for the OBF converter
that limit bites hardest: `obf.py` is gone, so no case can ever be added.

[`tests/unit/obf_roundtrip.test.ts`](../tests/unit/obf_roundtrip.test.ts)
asks something a lock file structurally cannot:
`documentToLayout(layoutToDocument(x)) == x`. That holds for any correct
mapping on any input, recorded or not, and needs nothing outside the converter
— which is why it survives having no Python. The idea is the seam session's.

It caught something on its first run. A layout with **no sets** cannot round
trip: Open Board Format carries the locale *on a board*, and a layout with no
sets becomes a document with no boards, so the language has nowhere to travel
and comes back as the default. No change to the converter could fix that
without inventing a field nobody else would read. The case is kept, with
`language` exempted by name and the reason beside it — the only exemption in
the file.

What it cannot see is the half of the format that exists for other programs.
Breaking `border_color` on the way out passes every check in it, because the
converter reads the colour back out of `ext_vorlaut_color`. A round trip is
blind to every field written for somebody else's software, and those are the
fields that make an interchange format worth having. The lock is the only
opinion on those, for the boards in it, and there is no third thing.

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
| the OBF sleep timeout or a set colour dropped, either direction | the round trip, naming the field that went |
| the OBF set order reversed on import | the round trip, naming the first set that moved |
| OBF `border_color` written from the wrong field | **nothing here** — written for other programs, read back from elsewhere. Only another program opening the file would catch it; see the gaps list |
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
| a symbol reference losing its collection | `symbolOf`, and every board with a METACOM key in it |
| the manifest's root ignored on read | the one fixture whose root is not its first board |
| `sort_keys` dropped from the board JSON | the members of every written `.obz` |
| the zip's fixed timestamp moved to today | the stamps on all eight written zips |

## What no longer works at all

The sections above are about checks. This one is not, and the distinction
matters: a check that is missing lets a mistake through, and a capability that
is missing stops the work. The deletion on 2026-08-22 took both, and only the
first was noticed at the time. The WebSerial session read the commit rather
than its summary and found the rest.

**Nothing can build content.** `build.py`, `builder.py`, `manifest.py`,
`tiles.py`, `tts.py`, `layout.py` and `layout_format.py` are gone, and the
browser cannot stand in yet — `runBuild()` in
[`src/backend/local.ts`](../src/backend/local.ts) throws by its own
admission: *"Building in the browser is not written yet — tiles.js and
layout_format.js are here, builder.py's orchestration is not."* So both sides
refuse. Change a symbol or a sentence and there is currently no way to render
it.

**Both routes onto a device went, not one.** `flashing.py` made the LittleFS
image and drove `esptool`, so the cable is not merely the only *new* path — it
is the only path, and it had never touched hardware when the Python was
deleted.

**Content is not backed up, and that is deliberate.** `firmware/vorlaut/data/`
and `content/` are both gitignored, so they survived the deletion by never
having been in git — the last built payload, the board being worked on, its
symbols and twenty recorded sentences. None of it can be rebuilt while
`runBuild()` throws, and the recordings could not be rebuilt anyway because
piper renders the same sentence differently every time.

It is test data and its loss was accepted deliberately when this was raised.
Recorded here only so that nobody later mistakes the gitignore for an
oversight, or spends an afternoon trying to recover something nobody wanted
kept. **The thing that actually needs fixing is `runBuild()`,** not the data
it would have produced.

Two instructions in [`cable.md`](cable.md) still say to run `app.py` to serve
the bench. The WebSerial session is fixing those. The seam half is done:
`backend/server.js` was deleted with the routes it fetched, and
`src/backend/index.ts` resolves `vorlaut:backend` through index.html's import map to
`backend/local.js`, which answers `buildManifest`/`buildFile` out of the store.
The bench itself is not blocked: its *Pick a `data/` folder* button reads the
payload straight off disk, so `python3 -m http.server` is enough.

## What is still only checked against itself

An honest list is worth more than a claim of coverage. In rough order of how
much it would cost to be wrong:

1. **A real browser is in CI, but only far enough to open the page.**
   `e2e/page.spec.ts` drives headless Chrome over the DevTools
   protocol from plain node, and asserts that the page loads with no exception,
   no console error and no 404, that a board renders, and that nothing asks a
   server for anything. It runs against the clone in the suite and again
   against `dist/` before the deploy — which is the check whose absence let a
   page that rendered nothing at all ship green.

   It is shallow on purpose, and everything below it is still unexercised in a
   tab. The vendored chain and `tiles.js` are checked under node, where they
   are deliberately free of the DOM, so node is a fair stand-in for the
   arithmetic — but `tools/ttscheck.html` and `tools/tilecheck.html`, the pages
   that drove them in a real tab, were deleted with the Python harnesses that
   fed them, and nothing has replaced those.
2. **No other program has ever opened a `.obz` this wrote**, and that is the
   only real test of an interchange format. Not a unit test, not a freeze, not
   the round trip: export a container and load it in something else that reads
   Open Board Format. That is the one thing which checks the fields nothing
   here can — `border_color`, the grid, `load_board`, each image's
   `symbol.set` — because they exist for somebody else's software and this
   project never reads them back. It needs no code and no oracle and can be
   done by hand in an afternoon, and until somebody does, "other AAC software
   can read this" is a claim rather than a result. The seam session's point,
   and the honest answer to the row in the table above where the answer is
   otherwise "nothing".

3. **PNG decoding is not covered at all.** The tile fixtures are frozen
   *after* the decode, because that is the one step the browser does and this
   test does not. `tools/tilecheck.py` measured it lossless for these symbols
   — once, by hand, and it no longer exists. A browser that decoded a PNG differently would not be
   noticed here.
4. **No real speech is frozen.** `piper` is not installed on this machine and
   is not deterministic anyway — three renders of one sentence gave three
   different files. The utterances are synthetic. Agreement on real sentences
   is still only [`browser-tts.md`](browser-tts.md)'s hand-run table, and
   nothing regenerates it.
5. **`static/tts/speak.js` has no behavioural test.** The voice path —
   vits-web, Azure — is checked only for the shape of `voices.json` and the
   `onnxruntime-web` pin, in `tests/test_browser_tts.py`. Nothing runs it.
6. **Symbol search is frozen for the name only.** What the adapter makes of
   a path is now checked without `metacom.py` — but that is the whole of it.
   Whether the vendored `bildquelle` *finds* the right symbol is the package's
   own business and has its own tests upstream; nothing here exercises the
   search, the index it builds, or the METACOM `.asar` reader in
   `metacom.py`. Those are still checked only by `tests/test_metacom_index.py`
   against Python.
7. **`normalize_layout()` now exists in the browser too**, in
   `src/data/obf.ts`, because an imported board has to be given a colour and its
   four slots. It is checked against `layout.py` in `tests/test_obf_js.py` and
   frozen in `obf.lock.json` — but only on the inputs recorded there, and
   `tests/reference/layout.lock.json`'s layouts are still `layout.py`'s output
   rather than something the browser reproduces.
8. **Tolerances.** The speech checks allow 0.15 LU on the ruler and 0.2 LU
   end-to-end, against agreement of 0.04 and 0.05 when frozen. The slack is
   room for a different `ffmpeg` build, not measured error — but a systematic
   mistake smaller than it would pass.
9. **`ffmpeg` 9.0.1 is taken on trust.** If it is wrong, everything here
   inherits that. Two things argue against it: `mitreden` froze the same three
   tones from an earlier build and got the same numbers, and
   `Lautstark/stimmquelle` ported this measurement independently and agreed
   within 0.03 dB.
10. **The lock files only answer for what was recorded**, which is the whole
   shape of the deal with golden files and is why "this does not make the
   Python removable" is at the top of this document rather than here. All
   four freeze tools import Python modules, deliberately: it is what stops a
   red test being "fixed" by refreezing, and it is what makes regenerating
   them impossible after a deletion rather than merely inadvisable.
