# Speaking in a tab

The app half is being rewritten as a static site: no server, one page. Speech is
the part of it that does not obviously survive the move, because today it is two
programs on the machine running `app.py` — `piper` renders the sentence and
`ffmpeg` levels it (`tts.py`). Neither exists in a browser.

This document is what was measured, not what is expected. The numbers come from
`tools/ttscheck.py`, which renders a batch with the real piper, levels each one
both ways, and hands both results to the real ffmpeg to be measured. Nothing
below is an estimate.

```bash
python3 tools/ttscheck.py
```

Most of the question was already answered next door, in mitreden's
`docs/spike/README.md` on branch `spike/piper-wasm`. That report established two
things this one takes as given: piper runs in a browser through
`@diffusionstudio/vits-web`, and **`ffmpeg.wasm` must not be used for the
levelling** — the newest `@ffmpeg/core` is built from ffmpeg 5.1.4, whose
`loudnorm` came out about 13.6 dB too quiet on six of twelve sentences, silently.
That finding is why the chain is written out by hand at all.

## What was built

| | |
|---|---|
| [`static/vendor/stimmquelle/`](../static/vendor/stimmquelle/VENDORED.md) | The chain and the catalogue, vendored from [Lautstark/stimmquelle](https://github.com/Lautstark/stimmquelle) and shared with mitreden |
| [`tests/browser/level.test.mjs`](../tests/browser/level.test.mjs) | Holds the vendored chain to what real `ffmpeg` said, frozen in `tests/reference/tts.lock.json` |

**This started as two files written here**, `static/tts/level.js` and
`speak.js`, and they are gone from this repository — extracted into the shared
package, which is where they should be: mitreden needs the same chain, and two
copies of a loudness pipeline is exactly the duplication this document spends
its length arguing against. Everything measured below was measured on that code;
the package is it, in TypeScript, with the tests it grew on the way.

What vorlaut asks the package for is one line, in `tools/ttscheck.mjs` and on
the page:

```js
postprocess(wav, { rate: 16000, fadeSec: 0.012, padSec: 0.06 })
```

The rate is the device's. The other two are CONTRACT.md's "permitted device
extras", off by default and switched on here because of the MAX98357A. No MP3
encoder is ever loaded: vorlaut writes WAV, and `encodeMp3` sits behind a
dynamic `import()` that nothing here calls.

## Adopting the contract

vorlaut trimmed at −45 dB keeping 60/100 ms. The contract says −50 dB keeping
50/50, and calls the difference drift rather than a device extra — which it was:
nothing had decided it, it was just what `tts.py` happened to say. `tts.py` now
follows the contract, `PIPELINE_VERSION` went to 3, and **every recording ever
made here was re-rendered once**, including the four shipped in
`example/speech/`.

The fade and the tail pad stayed. They are CONTRACT.md §2's "permitted device
extras", off by default and switched on here, because the MAX98357A clicks when
a waveform starts away from zero and cuts off mid-syllable when the signal
simply stops. Neither changes measured loudness, which is why they are allowed
to differ between the two products.

The whole justification for moving was that the two halves would then agree, so
that was measured rather than assumed — the table below is from after the move.

## The levelling

Twenty sentences — the four that stand in `example/layout.json` and sixteen
longer ones, German through `de_DE-thorsten-medium` and English through
`en_US-kristin-medium`. One recording per sentence, levelled twice, each result
measured by ffmpeg 9.0.1's own `loudnorm` in measurement mode. Target −16 LUFS.

*One* recording per sentence, and that is not just tidiness: **piper is not
deterministic.** Three renders of the same sentence in the same voice here gave
three different files — 155180, 154668 and 154156 bytes. It is a VITS model
with a stochastic duration predictor, so the same text comes out a slightly
different length and shape each time. Rendering separately for each path would
have measured that noise and called it a difference between the two.

It also means the table below moves a little between runs. The column that does
not move is the last one — whether the two paths agree on the same recording.

```
id      text                               tts.py     node       Δ  TP node   LRA
---------------------------------------------------------------------------------
de-00   Ja!                                -16.15   -16.10   +0.05    -1.49  0.00
de-01   Nein!                              -16.00   -16.04   -0.04    -3.81  0.00
de-02   Stopp                              -19.45   -19.38   +0.07    -1.50  0.00
de-03   Hilf mir                           -16.64   -16.64   +0.00    -1.50  0.00
de-04   Ich möchte noch nicht ins B...     -17.09   -17.08   +0.01    -1.50  0.00
de-05   Können wir bitte nach drauß...     -16.01   -16.05   -0.04    -1.79  0.00
de-06   Das Essen schmeckt mir heut...     -18.46   -18.46   +0.00    -1.50  0.00
de-07   Mir ist langweilig, ich hät...     -17.94   -17.95   -0.01    -1.50  0.00
de-08   Wo ist Mama?                       -16.06   -16.11   -0.05    -1.91  0.00
de-09   Mir tut der Bauch weh, und ...     -16.44   -17.06   -0.62    -1.50  0.50
de-10   Guten Morgen!                      -15.99   -16.05   -0.06    -5.33  0.00
de-11   Ich habe Durst und möchte e...     -17.50   -19.76   -2.26    -1.50  1.20
en-00   Yes!                               -17.44   -17.31   +0.13    -1.49  0.00
en-01   No!                                -16.01   -16.01   +0.00    -1.89  0.00
en-02   Stop                               -17.18   -17.12   +0.06    -1.50  0.00
en-03   Help me                            -18.18   -18.12   +0.06    -1.49  0.00
en-04   I would like to go outside ...     -16.07   -16.08   -0.01    -1.99  0.00
en-05   Could you please read that ...     -16.30   -16.28   +0.02    -2.29  0.00
en-06   I am not hungry, and I do n...     -16.87   -17.29   -0.42    -1.49  0.50
en-07   Where is my bag?                   -16.02   -16.05   -0.03    -2.84  0.00
```

**Seventeen of twenty agree to within 0.13 LU.** No result is above the
−1.5 dBTP ceiling. Every row that does *not* agree has a loudness range above
zero — not every row with one disagrees, but no row without one ever does. That
is the whole explanation:

ffmpeg's `loudnorm` normalises with one gain while it can, and switches to
compressing when that gain would push the true peak through the ceiling. On a
synthesised voice reading one sentence there is almost nothing to compress — so
on seventeen of these it also just applies a gain and stops at the ceiling,
which is what `level.js` does, and the two land on the same number. Where there is some range left, ffmpeg may compress instead, and then gets up to
2.3 LU more level out of the sentence. `level.js` never compresses, so it comes
out that much quieter. Across several runs it is one or two sentences in twenty,
and always long ones.

This was worth being wrong about in both directions before settling it. A
lookahead true-peak limiter was written and measured: it tracks −16 LUFS
*better* than ffmpeg does, and the worst deviation flips from −2.26 to +2.23 LU.
It was taken out again. `tts.py` is the oracle here, not the target: both
halves of this project speak the same sentences into the same cache under the
same fingerprint, and a browser that levels *better* than `tts.py` is still
a device on which yesterday's sentence is quieter than today's. Being 2.3 LU
quiet on one sentence in twenty is the smaller fault.

Two-pass `loudnorm` was checked as well, in case `tts.py`'s own numbers
were an artefact of measuring and normalising in one go. They are not: two-pass
gives the same answer to the second decimal on every row tried.

### After the move, all three still agree

Re-run against the vendored package, with `tts.py` on the contract's numbers:
**17 of 20 within 0.10 LU**, nothing above the ceiling, and the three that
diverge are still exactly the three with a non-zero loudness range. Same shape
as before the move, which is the result that mattered — adopting a shared
contract was supposed to keep the two halves together, not merely make them
share a file.

The tab was checked too, and the twenty WAVs it produced through the vendored
bundle are **byte-identical** to the twenty node produced through the same
bundle.

One behavioural difference worth knowing: the page now offers five voices where
it used to offer six. `shippable("browser")` withholds `de_DE-mls-medium`
because it is CC-BY and the page renders no attribution — a conditional
permission is not a permission until the condition is met. Passing
`{ rendersAttribution: true }` brings it back, once something actually shows the
notice.

### Somebody else's ffmpeg agrees too

The loudness measurement was checked a second time, from outside this
repository. `Lautstark/stimmquelle` ported `level.js` to TypeScript and ran its
BS.1770 against three `ebur128` numbers frozen out of ffmpeg while mitreden
still had an ffmpeg to freeze them from: 1000 Hz at two amplitudes, and 440 Hz,
where the K-weighting is deliberately not flat. **It agrees within 0.03 dB on
all three** — including after the kernel-cache rewrite below, which was the
thing most likely to have quietly cost accuracy.

Two implementations written independently, landing on ffmpeg's answer, is a
better result than either landing on it alone. The table above says this one
matches ffmpeg on real speech; those three say it matches on signals whose
right answer is known in advance.

### The tab does the same thing as the shell

`level.js` never touches Web Audio, so the same file runs under node. It would
be a poor trade if the two then disagreed, so that is checked rather than
assumed: `--serve` hands the batch to `ttscheck.html`, the page levels each
recording and hands it back, and the results are compared byte for byte.

**All twenty are byte-identical to what node produced.** Not "within a LU" —
the same file.

### Speaking in the tab as well

Running the whole path in the browser, piper-wasm included, the agreement is
looser: −1.52 to +0.99 LU against `tts.py`. That is not the levelling —
that is checked above and exact, byte for byte. The two sides are levelling
different recordings, and they always will be: partly because onnxruntime-web
and native onnxruntime need not produce the same waveform from one model, but
mostly because piper does not produce the same waveform twice in a row anyway.
The spread here is the same order as the spread between two native renders.

Worth knowing before anybody debugs it as a levelling bug — and worth knowing
before anybody expects a browser and `app.py` to agree byte for byte on a
sentence. They cannot. What they can agree on is the level, and that is what
the fingerprint in `tts.py` is really promising.

## Voices, and a catalogue that does not survive the move

`VOICE_CATALOGUE` in `tts.py` ships four voices. **Two of them cannot be spoken
in a browser, and they fail for two different reasons.**

`de_DE-kerstin-low` fails because it is a `low` model, and every `low` and
`x_low` voice dies the same way: `idx=140 must be within the inclusive range
[-130,129]`. Measured in the spike; not re-derived here.

The *reason* is narrower than this document first said, and the correction is
worth having because it changes what is possible. It is not that the older
models lack phonemes. The German ich-Laut has two Unicode spellings —
precomposed `ç` (U+00E7), or `c` followed by the combining cedilla (U+0327) —
and the phonemizer emits the second. Thorsten's map holds both, the combining
mark at 140. Kerstin's map has 130 entries, ids 0 to 129, which is exactly the
range in the error, and holds only the precomposed form, at 40.

Checked here against both `.onnx.json` files rather than taken on trust:

```
thorsten map size 152     combining U+0327 -> [140]    precomposed ç -> [40]
kerstin  map size 130     combining U+0327 -> None     precomposed ç -> [40]
Kerstin's map is a strict subset of Thorsten's: True
```

So it is one sound written two ways, not a sound her model cannot make, and
composing it where the model does not know the emitted form is a few lines
rather than a fork of the phonemizer. `Lautstark/stimmquelle` has it as
`remapPhonemeIds`: Thorsten's ids come out byte-identical on eight sentences
and every one of Kerstin's lands in range with nothing dropped. What has not
happened is audio — rendering through it means owning the onnxruntime call
instead of vits-web's `predict()`, which phonemizes and infers in one go.

`en_US-john-medium` fails for a different reason, and the spike's account of it
— "files missing from the mirror" — is not right. The files are there: 63531379
bytes, on rhasspy's repository and on the mirror vits-web uses, both. What is
missing is the entry in vits-web's own hardcoded `PATH_MAP`. Its `predict()`
looks the id up there, finds nothing, and asks the mirror for
`undefined.json`. Five of the 124 voices its `voices()` call advertises are
absent from the 119-entry map, and John is one of them. `speak.js` checks the
map and says so, rather than letting a 404 about a file nobody asked for come
back from the network.

**There is no German female voice today.** piper publishes three — Kerstin,
Eva K and Ramona — and all three are `low` or `x_low`, so all three fail. The
only German voices that run are Thorsten, in three flavours, and
`de_DE-mls-medium`, which is a multi-speaker corpus rather than a person and has
no name to show in a picker.

But "today" is doing real work in that sentence, and it did not use to. On the
evidence above this is a property of the glue, not of piper's catalogue:
Kerstin's model can make the sound, it is spelled differently, and the remap is
written. Getting from there to a German female voice on the device needs the
onnxruntime call owned rather than delegated — which is the same change that
retires the `PATH_MAP` problem below and brings `en_US-john-medium` back with
it. One piece of work, three results. It is the highest-value thing left in this
whole area.

One more thing turned up while checking: `en_US-hfc_female-medium`, which the
spike used and which works, is **CC BY-NC-SA 4.0**. `tts.py` says the reason its
four voices are public domain is that this is what lets them be handed on, and
warns to read the MODEL_CARD rather than the file name. So a voice that works is
still not a voice that can ship, and `voices.json` keeps that distinction.

The package's `voices.json` is the list, and it says of every entry how it was
established: measured in the spike, measured here, or inferred from the rule and
never actually spoken. `tests/test_browser_tts.py` fails if a voice is added to
`VOICE_CATALOGUE` without an answer in it.

`VOICE_CATALOGUE` itself is deliberately unchanged. Both voices work perfectly
well where `tts.py` runs, which is what it is for; the static site reads
`voices.json`, and it is the rewrite's job to decide what a picker with two
Thorstens in it should look like.

## Azure, straight from the tab

Untried in the spike, and it works. Both endpoints answer a preflight with
`access-control-allow-origin: *` and echo back the headers the API needs:

```
$ curl -i -X OPTIONS https://<region>.tts.speech.microsoft.com/cognitiveservices/v1 \
    -H 'Origin: http://localhost:8782' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: ocp-apim-subscription-key,content-type,x-microsoft-outputformat'
HTTP/2 204
access-control-allow-headers: ocp-apim-subscription-key,content-type,x-microsoft-outputformat
access-control-allow-methods: POST
access-control-allow-origin: *
```

The synthesis itself answers the same way — a real request with an `Origin`
header came back `200`, `access-control-allow-origin: *`, `audio/x-wav`. The
voice list endpoint behaves identically. So `speak.js` can call Azure with
`fetch` and no proxy, which is genuinely simpler than the server version: no
key handling on the way through, no region routing, no week-long cache of the
voice list because a page that keeps state can just remember it.

Levelled through `level.js`, an Azure recording lands at −16.03 LUFS against
`tts.py`'s −15.98. Azure already delivers `riff-16khz-16bit-mono-pcm`, so
nothing is resampled and only the trim and the gain are left to do.

The catch is the obvious one and it is worth writing down rather than
discovering later: **the key is in the browser.** For a page somebody runs on
their own machine that is the same exposure as the `.env` file it replaces. For
a page served to anyone else it is not, and nothing in the page can tell the
two apart. A static site that speaks with Azure has given its key to everyone
who opens it.

## Speed

The levelling costs about 60 ms for a four-second sentence under node — after
one fix. It was 866 ms: every output sample was computing its own sines and
cosines for the resampling filter. With whole-number rates there are only ever
so many places an output sample can fall between two input samples — 320 of
them for 22050 to 16000, and then it repeats — so the kernels are worked out
once per pair of rates and looked up after that. The output is bit-identical
before and after, checked on all twenty.

The synthesiser is the expensive half either way: the spike measured 4–7 s per
sentence in a visible tab on an M-series Mac, most of it session setup, plus a
one-time 63 MB model download into OPFS.

Timings taken in a tab **here** are not comparable and are not quoted as
though they were: the browser pane this was driven through runs hidden —
`document.hidden` is true and `requestAnimationFrame` never fires — and a
throttled renderer took 20× longer on the same code than node did on the same
data. The correctness results above are unaffected by that; the timings would
be.

## What checks this now

The table above is still produced by hand, and still needs a `piper` and an
`ffmpeg` to produce. What does not is
[`tests/browser/level.test.mjs`](../tests/browser/level.test.mjs): the loudness
measurement, the peak meter, the resampling and the whole chain are checked
against numbers real `ffmpeg` gave for the same inputs, frozen in
[`tests/reference/tts.lock.json`](../tests/reference/tts.lock.json) while there
was still an `ffmpeg` half to freeze them from. It runs under plain node, from
`python3 tests/run.py`, with no synthesiser and no browser.

That covers the arithmetic, not the sentences: the frozen utterances are
synthetic, because `piper` renders the same text differently every time. The
rest of what is and is not covered is in
[frozen-references.md](frozen-references.md).

## What was not tested

- **iPads**, which is where this would actually be used, and the one measurement
  that would change the answer. A 63 MB model in onnxruntime-web on a tablet is
  still the open question the spike left open.
- **A visible tab.** See above. Everything here that is a number of seconds
  comes from the spike, not from this repository.
- **Storage.** Nothing here writes a cache, computes a fingerprint or decides
  when a sentence needs re-recording. `tts.py` has all of that and none of it
  moved.
- **Anything but the two backends.** ElevenLabs and the rest allow browser
  requests too and were not tried.
