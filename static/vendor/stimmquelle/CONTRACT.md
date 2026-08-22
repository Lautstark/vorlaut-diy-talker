# The speech contract

Normative. An implementation in any language may be checked against this.

It exists because speech in this family has more than one implementation and
always will: mitreden keeps a Python container *and* a browser build, and both
have to make a child's talker and their tablet say a sentence at the same
volume. Shared code cannot bind two languages, so this document does — and,
where it can, `conformance/` does it by measurement rather than agreement.

Everything below was measured. Nothing is an estimate. Where a number comes
from somebody's run, the run is named.

---

## 1. Loudness

| | |
| --- | --- |
| Measurement | ITU-R BS.1770-4 integrated loudness, gated: absolute gate at −70 LUFS, relative gate at −10 LU below the ungated mean |
| Measured at | 48,000 Hz, mono. The filter coefficients are the 48 kHz ones — measuring at another rate is wrong, not approximate |
| Target | **−16 LUFS** |
| True-peak ceiling | **−1.5 dBTP**, measured on the **finished** signal at the output rate — after the resample, not before it. Resampling can lift a peak above anything in its input, so a ceiling checked beforehand is one the output can still exceed. Four-times oversampled, per BS.1770-4; the headroom is for inter-sample peaks, which is why it is not 0 dBFS |
| Gain | **One static gain over the whole file** |
| Clamp | If the gain would push the peak past the ceiling, reduce the gain. **Never clip** |
| `LRA` | ffmpeg's filter string carries `LRA=11`. It is inert — `loudnorm` consults it only in dynamic mode, which single short sentences do not enter. **Not a shared parameter**, and an implementation without a dynamic mode needs no answer for it |

### No compressor, and no limiter

**Deliberate, and the reasoning must survive.** A lookahead true-peak limiter was
written and measured in vorlaut. It tracks −16 LUFS *better* than ffmpeg does —
the worst deviation flips from −2.26 to +2.23 LU — and it was taken out again:

> The container is the oracle here, not the target … a browser that levels
> *better* than the container is still a device on which yesterday's sentence is
> quieter than today's. Being 2.3 LU quiet on one sentence in twenty is the
> smaller fault.

Consistency beats accuracy on a talker. An implementation that improves on this
without reading why has made the product worse.

That was written while a container existed to be the oracle. None does now, and
the decision survives the loss with its reasoning slightly changed: what has to
match is no longer a second implementation but **every recording this chain has
already made.** A sentence recorded last year and one recorded today go on the
same device, and a levelling that got better in between is a device where the
old ones are quiet. The frozen tones above are what stops "consistent" drifting
into "consistently wrong".

### Where ffmpeg and a static gain diverge, and why

ffmpeg's `loudnorm` applies one gain while it can and switches to **compressing**
when that gain would push the true peak through the ceiling. On a synthesised
voice reading one sentence there is usually no range to compress, so it lands
where a static gain lands. Where range is left it may compress and get up to
2.3 LU more level out of the sentence.

Measured over twenty sentences (vorlaut, `tools/ttscheck.py`): **seventeen of
twenty agree within 0.13 LU.** Every row that disagrees has `LRA > 0`; no row
without one ever does. That is the whole explanation, and it is expected
behaviour on both sides rather than a defect on either.

Two-pass `loudnorm` was checked in case the container's numbers were an artefact
of measuring and normalising in one go. They are not — two-pass agrees to the
second decimal on every row tried.

---

## 2. Trimming

| | |
| --- | --- |
| Detection | Peak, sample by sample |
| Threshold | **−50 dB** |
| Kept before the first sample above threshold | **50 ms** |
| Kept after the last sample above threshold | **50 ms** |
| All-silent input | Left alone. Do not return an empty file |
| Order | **Trim before measuring.** Leading silence otherwise drags the integrated loudness down and the sentence comes out too loud |

### Permitted device extras

Neither changes measured loudness, so neither is part of the contract. A
consumer applies them after levelling and records why:

- a short fade at each end, against clicks on a class-D amplifier — vorlaut uses
  12 ms
- a little quiet appended, so the amplifier does not switch off mid-syllable —
  vorlaut uses 60 ms for the MAX98357A

`tts.py` currently trims at −45 dB and keeps 60/100 ms. That is drift, not a
device extra, and moves to −50 dB and 50/50 ms.

---

## 3. The fingerprint

A recording's name is the hash of everything that decides what it sounds like.

1. **the text**, `strip()`ed of leading and trailing whitespace and nothing else
2. **the backend** — `piper`, `azure`, `elevenlabs`
3. **the model or voice id**, its *name* — never a path and never a URL
4. **the engine version**, for backends that render locally; omitted for cloud
   backends, which render on somebody else's machine
5. **the pipeline version**, an integer, bumped whenever §1 or §2 changes
6. **the output settings** — format, sample rate, channels, bitrate

SHA-256 over a canonical JSON encoding, truncated to hex. **The truncation length
is a per-product choice** and need not agree — mitreden uses 12 characters,
vorlaut 32 — because the two never share a cache directory.

### What it promises

**The same inputs, and through them the same level. Not the same audio.**

piper cannot deliver the same audio twice. It is a VITS model with a stochastic
duration predictor: three renders of one sentence in one voice gave 155,180,
154,668 and 154,156 bytes. Any contract promising identical output would be
unmeetable by a single implementation against itself.

### No paths

Where a model lives says nothing about how it sounds. mitreden learned this the
expensive way: the container keeps models at `/voices` and a laptop keeps them
beside the phrases, so carrying a `phrases.json` between the two re-recorded
every piper phrase for nothing.

### The engine version must be pinned, and the pin tied to the constant by a test

They live in files that cannot read each other, and drift is silent in both
directions: **pin bumped, constant left behind** means new audio under old names;
**constant bumped, pin left behind** means everything re-rendered by the engine
that already made it.

The constant is *written down*, never read from the installed package. A
recording's name must be derivable from the voice id alone — no disk, no
network — so that a machine which cannot render a WAV still knows what the file
would have been called.

### Two engines do not share a cache

The container names its engine `piper 1.7.0`; a browser names its own
`vits-web@1.0.3`. Both run the same weights through different runtimes, so their
fingerprints can never be equal. **That is intended.** The alternative — dropping
the engine term — lets a retrained voice arrive silently in the middle of a
collection, which is the one failure this family exists to prevent. One visible
re-render is the smaller cost.

Consequence a product must state plainly rather than imply: **sentences travel
between a container and a page; recordings are made again on the other side.**

---

## 3a. Phoneme ids come from the model, not from the phonemizer

A model's `.onnx.json` carries the symbol table it was trained against, as
`phoneme_id_map`. The phonemizer has its own, newer and larger. Feeding the
phonemizer's ids to an older model is what breaks every `low` and `x_low` voice,
and with them the only German female voices piper publishes.

The difference is **one spelling, not missing sounds**, and the evidence is that
the older map is a strict subset of the newer:

```
thorsten  152 entries   U+0327 -> [140]   ç -> [40]
kerstin   130 entries   U+0327 -> absent  ç -> [40]
kerstin's map is a strict subset of thorsten's: true
```

The phonemizer writes the ich-Laut decomposed — `c` then U+0327 COMBINING
CEDILLA, as two phonemes. Newer maps carry that combining mark as a symbol in
its own right at id 140, outside Kerstin's `num_symbols` of 130. Her map has the
precomposed `ç` at 40. Both know the sound. Her ids run 0 to 129, which is
literally the range the failure reports.

So: **look each phoneme up as emitted, and compose it onto the one before only
where the model has never heard of that form.** A model whose map holds the
combining mark is untouched — required, because those voices already speak and
their recordings are named by fingerprints that must not move.

**Keep the phonemizer's own ids for their structure.** They carry sentence
splitting that the flat `phonemes` array does not, and rebuilding from phonemes
alone merges sentences and changes prosody, silently. When two slots become one,
the pad between them goes with it: piper puts exactly one between phonemes, and
two is a token no model saw in training — it arrives as a pause, not an error.

## 9. Sample rates

A rate is a **positive finite number**, and a caller that has one as a string
parses it first. Not pedantry: `postprocess(wav, { rate: '-5%' })` used to
return a 44-byte WAV — a valid header with no audio under it, which plays as
silence and reports nothing. A numeric string like `'44100'` worked by coercion,
so whether a caller got a file, a crash or silence depended on which string.

Omitting the rate and passing nothing are different things. Omitted takes the
default; `null` is refused, because a config field that came out of JSON as null
is a caller who meant to say something and did not.


## 4. Voice ids

`<backend>:<model>`

- `backend` — `piper`, `azure`, `elevenlabs`
- for piper, `model` is the file stem `<lang>_<REGION>-<name>-<quality>`
- `quality` is one of `x_low`, `low`, `medium`, `high` and is **part of the id**,
  not a decoration. `de_DE-thorsten-medium` and `de_DE-thorsten-high` are two
  voices, and a picker showing both has to say more than the name
- **in a browser only `medium` and `high` are valid** — see `voices.json`
- ids are **identical across container and page**, so a set of sentences moves
  between them without being renamed
- the display name is derived from the id alone, with no disk and no network

---

## 5. Licensing

**The licence lives in the `MODEL_CARD` next to the model, never in its file
name.** This is the rule the repository exists for.

- **Only models free to hand on may be shipped**, mirrored, baked into a
  container image, or offered from a page. CC0 and public domain qualify
  unconditionally. **CC-BY qualifies only where the attribution is rendered.**
  **CC BY-NC-SA does not qualify at all.** A `MODEL_CARD` that names no licence
  and points at a dataset instead is *unclear*, and unclear is not a yes.
- **A page offering a voice is handing it on**, exactly as a container image is.
  It is not the smaller act — it reaches more people.
- A user may point a product at a model of their own. That is their licence and
  their decision, and a different act from a product shipping one.
- **The catalogue is a closed list.** An id outside it is refused rather than
  attempted: an id that reaches Hugging Face unchecked is a licensing decision
  made by whoever typed it.
- **A test asserts the licence of every entry**, and a second asserts that every
  voice a product offers is in the catalogue and marked shippable.
- **Attribution owed must be rendered.** `de_DE-mls-medium` is the first entry
  that owes any, and nothing in the family renders one yet — so adding that voice
  means building that first.

### Running is not shipping

The two questions are independent, and the licence one is the easier to lose
because **nothing fails when it is answered wrong.** The voice speaks, the file
plays, and the mistake is invisible. `en_US-hfc_female-medium` sat in mitreden's
browser build on the strength of running perfectly; it is CC BY-NC-SA 4.0.

---

## 6. Do not use ffmpeg.wasm for the levelling

The newest `@ffmpeg/core` (0.12.10) is built from **ffmpeg 5.1.4**, whose
`loudnorm` computes a `target_offset` current ffmpeg does not — same input, same
measured loudness, same `normalization_type: linear`:

```
short.wav   ffmpeg 9.0.1   i=-23.60 lra=0.00 tp=-7.89 linear  offset= 1.21
short.wav   ffmpeg 5.1.4   i=-23.60 lra=0.00 tp=-7.89 linear  offset=14.75
```

**Six of twelve short German sentences came out about 13.6 dB too quiet,
silently.** Measured in mitreden's `docs/spike/README.md`.

The argument for it — one implementation, no drift — is the reverse of the truth.
It is a *second* implementation, three years stale, drifting by 13 dB. A
hand-written path tracks the container far better and costs about 250 KB against
roughly 10 MB.

---

## 7. Conformance

Three comparisons, three different assertions. Conflating them produces a
tolerance that is wrong for all three.

| Comparison | Assertion | Basis |
| --- | --- | --- |
| One leveller, two runtimes (node and a tab) | **byte-identical** | measured, all twenty |
| Two levellers, one recording | integrated loudness within **0.15 LU**; rows with `LRA > 0` may differ up to **2.5 LU** in the container's favour; true peak at or under the ceiling always | 17 of 20 within 0.13 LU |
| Two synthesisers | **no loudness assertion** — only that both land within the ceiling | −1.52 to +0.99 LU, irreducible |

**Level the same recording twice. Never render twice.** A suite that synthesises
once per path measures piper's sampling noise and reports it as a difference
between implementations. This is the single rule that makes the rest checkable.

**Expected values are checked in as data**, not computed from a live reference
implementation — and that is no longer a precaution, it is the only option.

**No consumer has a reference implementation any more.** vorlaut's container is
gone and mitreden's Python was deleted with `mitreden.py` and eight test files.
Neither repository can render a file with real ffmpeg and compare. So these
tests are not a nice-to-have inside this package; they are the entire
verification story for every product that speaks, and this is the only place
they can live.

### The ruler itself

Everything above measures output with the same function that decided the gain,
which is circular: a wrong BS.1770 satisfies all of it. It satisfied mitreden's
whole audio suite until somebody looked.

`conformance/calibration.json` breaks the circle. Three tones, measured by
ffmpeg's `ebur128` reading WAV files this package wrote, frozen on the last day
anything in this family shipped ffmpeg. **440 Hz is in the list on purpose:**
K-weighting is deliberately not flat there, so a tone off 1 kHz catches a filter
that is merely plausible.

`conformance/calibrate.sh` regenerates them from ffmpeg on any machine that has
one, so the origin of the numbers is a procedure rather than a sentence in a
comment. Confirmed reproducing all three exactly.

A failure there is not a test to adjust. If it drifts, nothing else anywhere is
in a position to notice.

---

## 8. Cloud backends

Azure answers a browser directly. Both the synthesis and the voice-list endpoints
return `access-control-allow-origin: *` on preflight and on the request itself,
so a page calls them with `fetch` and no proxy. Levelled through the same chain
an Azure recording lands at −16.03 LUFS against the container's −15.98, and since
Azure already delivers `riff-16khz-16bit-mono-pcm` nothing is resampled.

**The key is in the browser.** For a page somebody runs on their own machine that
is the same exposure as the `.env` file it replaces. For a page served to anyone
else it is not, and **nothing in the page can tell the two apart.** A static site
that speaks with Azure has given its key to everyone who opens it.

Key storage is a product's decision. This contract only requires that the
warning is not lost.
