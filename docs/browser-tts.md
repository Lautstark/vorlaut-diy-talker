# Speaking in a tab

The app half is being rewritten as a static site: no server, no container, one
page. Speech is the part of it that does not obviously survive the move, because
today it is two programs on a machine somebody else runs — `piper` renders the
sentence and `ffmpeg` levels it (`tts.py`). Neither exists in a browser.

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
That finding is why `static/tts/level.js` exists at all.

## What was built

| | |
|---|---|
| [`static/tts/level.js`](../static/tts/level.js) | The `ffmpeg` half: trim, fade, pad, measure, level, write a 16 kHz mono 16 bit WAV. No browser needed — no `AudioContext`, no DOM — so it can be run and measured outside one |
| [`static/tts/speak.js`](../static/tts/speak.js) | The voice: piper through vits-web, or Azure straight from the tab. Same `piper:`/`azure:` ids as `layout.json` |
| [`static/tts/voices.json`](../static/tts/voices.json) | Which voices actually work in a browser. Meant to be vendored by vorlaut and mitreden rather than kept twice |
| [`tools/ttscheck.html`](../tools/ttscheck.html) | The page that drives both in a real tab |
| [`tools/ttscheck.py`](../tools/ttscheck.py) | The harness. Also `--serve`, which hands the batch to that page |
| [`tests/test_browser_tts.py`](../tests/test_browser_tts.py) | Stops the two implementations drifting apart in silence |

vorlaut needs WAV, so there is no MP3 encoder here — the spike's `lamejs` is
gone and the WAV header is nine lines. The whole levelling path is one file with
no dependencies.

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
id      text                            container     node       Δ  TP node   LRA
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
It was taken out again. The container is the oracle here, not the target: both
halves of this project speak the same sentences into the same cache under the
same fingerprint, and a browser that levels *better* than the container is still
a device on which yesterday's sentence is quieter than today's. Being 2.3 LU
quiet on one sentence in twenty is the smaller fault.

Two-pass `loudnorm` was checked as well, in case the container's own numbers
were an artefact of measuring and normalising in one go. They are not: two-pass
gives the same answer to the second decimal on every row tried.

### The tab does the same thing as the shell

`level.js` never touches Web Audio, so the same file runs under node. It would
be a poor trade if the two then disagreed, so that is checked rather than
assumed: `--serve` hands the batch to `ttscheck.html`, the page levels each
recording and hands it back, and the results are compared byte for byte.

**All twenty are byte-identical to what node produced.** Not "within a LU" —
the same file.

### Speaking in the tab as well

Running the whole path in the browser, piper-wasm included, the agreement is
looser: −1.52 to +0.99 LU against the container. That is not the levelling —
that is checked above and exact, byte for byte. The two sides are levelling
different recordings, and they always will be: partly because onnxruntime-web
and native onnxruntime need not produce the same waveform from one model, but
mostly because piper does not produce the same waveform twice in a row anyway.
The spread here is the same order as the spread between two native renders.

Worth knowing before anybody debugs it as a levelling bug — and worth knowing
before anybody expects a browser and a container to agree byte for byte on a
sentence. They cannot. What they can agree on is the level, and that is what
the fingerprint in `tts.py` is really promising.

## Voices, and a catalogue that does not survive the move

`VOICE_CATALOGUE` in `tts.py` ships four voices. **Two of them cannot be spoken
in a browser, and they fail for two different reasons.**

`de_DE-kerstin-low` fails because it is a `low` model. vits-web phonemizes
against one fixed symbol table instead of the `phoneme_id_map` in each model's
own `.onnx.json`, and every `low` and `x_low` voice dies with
`idx=... must be within the inclusive range [-130,129]`. Measured in the spike;
not re-derived here.

`en_US-john-medium` fails for a different reason, and the spike's account of it
— "files missing from the mirror" — is not right. The files are there: 63531379
bytes, on rhasspy's repository and on the mirror vits-web uses, both. What is
missing is the entry in vits-web's own hardcoded `PATH_MAP`. Its `predict()`
looks the id up there, finds nothing, and asks the mirror for
`undefined.json`. Five of the 124 voices its `voices()` call advertises are
absent from the 119-entry map, and John is one of them. `speak.js` checks the
map and says so, rather than letting a 404 about a file nobody asked for come
back from the network.

**There is no German female voice.** Not "not in the catalogue" — there is none
to be had. piper publishes three German female voices, Kerstin, Eva K and
Ramona, and all three are `low` or `x_low`. The only German voices that run at
all are Thorsten, in three flavours, and `de_DE-mls-medium`, which is a
multi-speaker corpus rather than a person and has no name to show in a picker.
Reading each model's own `phoneme_id_map` would unlock the `low` voices and with
them Kerstin — and would mean owning the phonemizer glue instead of calling a
library. That is the piece of work that decides whether this project has a
German female voice.

One more thing turned up while checking: `en_US-hfc_female-medium`, which the
spike used and which works, is **CC BY-NC-SA 4.0**. `tts.py` says the reason its
four voices are public domain is that this is what lets them be handed on, and
warns to read the MODEL_CARD rather than the file name. So a voice that works is
still not a voice that can ship, and `voices.json` keeps that distinction.

`static/tts/voices.json` is the list, and it says of every entry how it was
established: measured in the spike, measured here, or inferred from the rule and
never actually spoken. `tests/test_browser_tts.py` fails if a voice is added to
`VOICE_CATALOGUE` without an answer in it.

`VOICE_CATALOGUE` itself is deliberately unchanged. Both voices work perfectly
well in the container, which is what it is for; the static site reads
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
the container's −15.98. Azure already delivers `riff-16khz-16bit-mono-pcm`, so
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
