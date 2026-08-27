# The app package export

vorlaut writes two `.obz` files, and they are not the same file with a flag
between them. This page is about the second one: the **Lautstark Board
Package** the Android viewer opens, specified in
[`exchange/SPEC.md`](../exchange/SPEC.md).

| | Talker export | App package |
|---|---|---|
| Menu entry | *Export this collection* → *For another program* | *Export this collection* → *For the vorlaut app* |
| Symbols | references (`symbol.set` / `filename`) | PNG files in the archive |
| Audio | none | Ogg Opus files in the archive |
| METACOM | refused outright | permitted, `redistributable: false` |
| Extension namespace | `ext_vorlaut_*` | `ext_lautstark_*` |
| Code | [`src/data/obf.ts`](../src/data/obf.ts) | [`src/data/app_package.ts`](../src/data/app_package.ts) |
| Reader | vorlaut itself, and other AAC software | the Android viewer |

## Why two doors rather than one function

SPEC.md §5.2 requires it, and the reason is the licence. METACOM is licensed
per person, so the talker export refuses to write a METACOM symbol as pixels at
all — `checkLicensing()` runs at the top of `writeObz()` and there is no way
past it. The app package takes one narrow step past that: a licensee may bake
their own METACOM symbols into a package **for the person they support** and
sideload it onto that person's device.

A step that narrow has to be structural. If both behaviours lived in one
function behind an argument, the guarantee would be one call site away from
being untrue, and the call site would be written by somebody who was not here
for the decision. So the two share no code path: `obf.ts` writes references and
never pixels; `app_package.ts` writes pixels and never references.

The two extension namespaces are separated for the same kind of reason —
[`adr/0001`](../adr/0001-two-ext-namespaces.md).

## What a DIY Sammlung turns into

The device is five keys and up to five sets, which is a small corner of what
the format allows. The mapping keeps the device's own shape rather than
inventing a tablet layout:

- one set becomes one board, carrying the set's name; a set has no colour any
  more, so neither `ext_lautstark_board_color` nor a `border_color` per button
  is written — both fields stay in the format, and this builder simply writes
  neither;
- the four slots become four buttons **in the positions they sit in on the
  case**, with the top-left cell left empty because that is where the speaker
  is ([docs/hardware.md](hardware.md));
- the set key becomes a `load_board` button, cycling the same ring the device
  cycles;
- a slot with neither text nor picture becomes an empty cell rather than an
  empty button.

Keeping the positions is the point: somebody who uses the talker knows where a
sentence is with their hand, and a viewer that re-flowed five keys into a tidy
row would take that away.

The buttons carry `ext_lautstark_speak_immediately: true`. The device speaks on
press and has no message bar to compose in, and a key holds a whole sentence
rather than a word to build one out of.

## Pictures

Re-rendered from the symbol the key references, at up to 512×512, alpha kept —
**not** scaled up from the device's 128×128 tile. The tile is RGB565 on an
opaque ground because that is what an ESP32 blits; putting it on a tablet at
four times its size would show the device's pixels and the ground colour it had
to bake in.

A symbol smaller than 512 is written at its own size. Upscaling would add bytes
and blur to a picture the viewer scales to its button anyway.

`ext_lautstark_symbol_source` is read off what the keys actually reference:
`metacom:` references mean METACOM, `arasaac-<id>.png` files in the browser's
store mean ARASAAC, and a picture somebody uploaded themselves counts towards
neither — a photograph is not a symbol collection, and calling the package
ARASAAC's because it holds one would be a licence claim about a file ARASAAC
never saw. A Sammlung mixing ARASAAC and METACOM is refused, which is §5.1.

That refusal is asked twice, and the second time is not where it is enforced.
`buildAppPackage()` is pure and runs last, so a mixed Sammlung used to be
refused *after* every distinct sentence in it had been synthesised — hundreds
of inferences on a full tablet Sammlung, and then nothing to show. The same
function is called at the head of `exportAppPackage()`, where it costs one walk
over the layout, and the message names the odd keys out rather than leaving
somebody to compare references by eye: which collection a picture came from is
the one thing no editor shows.

Reaching that refusal at all is now the exception. The picture column offers
the collection the **open Sammlung** is drawn in — `offeredSource()` in
[`src/shell/picker.ts`](../src/shell/picker.ts) — falling back to the machine's
setting only for a Sammlung that has said nothing yet. A mixed one can still
arrive from elsewhere; it can no longer be built here.

## Audio

Ogg Opus, mono, 24 kHz into the encoder, from the synthesiser's master — not
from the device's 16 kHz WAVs, which are a downsample of the same master.
Encoding those would stack a downsample and a lossy codec for nothing (§6.1).

There is no Opus dependency. [`src/data/opus.ts`](../src/data/opus.ts) uses
WebCodecs' `AudioEncoder`, which is Chromium's own libopus, and writes the Ogg
container itself — some 150 lines of pages, segment tables and granule
positions. Two things in there are worth knowing before touching it:

- **The OpusHead is copied from the encoder**, not written by hand. It arrives
  as `decoderConfig.description` with the pre-skip already in it. Pre-skip
  depends on the encoder's internal delay, a wrong value clips the start of
  every recording, and nothing about the file looks broken when it happens.
- **Granule positions are in 48 kHz samples** whatever the input rate, because
  Opus always decodes at 48 kHz. `ffprobe` reporting 48000 for a 24 kHz-in file
  is correct and is not a bug to chase.

A package with no recordings at all is a normal package, not a broken one: the
viewer speaks the labels with its own voice, and §9.2 is explicit that such a
button is not degraded.

## Validation

`packageBytes()` runs `checkPackage()` first and refuses to write anything that
does not pass — the same arrangement `writeObz()` has with `checkLicensing()`.
The rules are the coherence rules `exchange/tools/make_fixtures.mjs` enforces
over every fixture before it is allowed to write one, plus the ones a
hand-written fixture cannot violate: image size, clip length, and the licence
pair.

A builder validates because nothing else will. The viewer that finds a fault is
on a tablet in somebody's kitchen, and all it can do is show a warning to a
person who cannot fix it.

Three checks, at three distances:

| | |
|---|---|
| `tests/unit/app_package.test.ts` | The mapping, and every refusal, by breaking a package on purpose. Also runs `checkPackage()` over the conformance fixtures that import with no warnings — the ones a builder could have produced — so the rules are calibrated against packages written by somebody else's program. |
| `tests/unit/opus_ogg.test.ts` | The Ogg container, with the codec stubbed and the lacing cases chosen on purpose. Its page checksum is calibrated against `exchange/assets/clip-a.opus`, which ffmpeg wrote. |
| `e2e/app_package.spec.ts` | The real browser: canvas, WebCodecs, a zip on disk, read back and put through the same checker. Azure is played by a route, for the reason `happy.spec.ts` gives about not fetching a piper model. |

To check an export against something outside this repository, dump one and ask
ffmpeg:

```bash
DUMP_TO=/tmp/exported.obz E2E_PORT=8842 npx playwright test e2e/app_package.spec.ts --grep "passes the spec"
```

then `unzip` it and run `ffprobe` over `sounds/*.opus`. That is the check no
test here can make, and it is the same argument
[docs/frozen-references.md](frozen-references.md) makes about `.obz` files
generally: until another program opens one, "it can be read" is a claim.

## Known duplication

`src/data/zip.ts` and the writer inside `obf.ts` both frame local headers, a
central directory and a CRC-32 — about sixty lines, twice. They are apart
because the talker's `.obz` is frozen byte for byte by
`tests/reference/obf.lock.json` and the app package needs two things the frozen
bytes do not have: general purpose flag bit 11 (UTF-8 names, §2) and NFC
normalisation of every member name. Extracting the framing into one module is a
mechanical change, and `tests/test_obf_frozen.py` would keep it honest.
