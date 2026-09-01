# ADR 0022 — A recording may travel compressed, and the device says whether it can play one

**Status:** accepted · **Date:** 2026-09-01 · **Applies to:**
[`firmware/vorlaut/adpcm_format.h`](../firmware/vorlaut/adpcm_format.h),
[`firmware/vorlaut/wav_format.h`](../firmware/vorlaut/wav_format.h),
[`loader/src/audio_encode.ts`](../loader/src/audio_encode.ts),
[`firmware/vorlaut/cable_format.h`](../firmware/vorlaut/cable_format.h),
[`device/fixtures/audio/`](../device/fixtures/audio/)

## Context

[ADR 0021](0021-the-device-holds-several-collections.md) put four collections
on one device and left the arithmetic tight. Measured on the finished packages:

| | tiles | sound |
|---|---|---|
| Bente (speech) | 25 | 437 KiB |
| *Spiegel und Ei* | 24 | 2914 KiB |
| *Plauderbuch* | 26 | 1228 KiB |
| *Schattenspiel* | 24 | 1452 KiB |
| **together, deduplicated** | **99** | **6031 KiB** |

Raw tiles plus sound would be 9199 KiB against the 7040 the file area has held
since [ADR 0018](0018-the-file-area-takes-the-ota-slot.md). With the tile
compression of [ADR 0019](0019-tiles-travel-compressed.md) it fits at about
6500 KiB — some 500 free, and that margin rests on a ratio measured on other
tiles.

**Sound is 93 per cent of what is occupied.** And the argument that carried the
tile compression carries further here, because it was explicitly the better
half of that case: the cable moves 60 KB a second, so **6031 KiB is a hundred
seconds of somebody holding a talker still**, every time a collection changes.

The format was measured before it was chosen, on the four words in
[`example/speech/`](../example/speech/) and then on all 36 recordings of
*Spiegel und Ei* read back off a real device:

| | four example words | the 36 game recordings |
|---|---|---|
| ratio | 3.68 – 3.90 | **4.11** |
| signal to noise, worst | 15.0 dB | **18.0 dB** |
| signal to noise, best | 28.3 dB | 31.7 dB |

The low numbers are not a fault in the encoder. `ffmpeg`'s own
`adpcm_ima_wav`, asked the same question with the same block size on the same
day, answers 14.9, 18.1, 18.7 and 28.2 against our 15.0, 17.7, 18.2 and 28.3.
**The three worst are short, loud, transient words** — "Ja!" moves 17167
between two neighbouring samples, and four bits a sample cannot follow that
without the step size climbing behind it.

## Decision

**A recording is one of two forms, and it is still a WAV in both.** IMA ADPCM
is WAVE format tag `0x11`: the container does not change, `seekToWavData()`
still walks the chunks to `data`, and the reader branches on the tag in `fmt`
rather than on a new file extension. A codec change, not a container change.

`seekToWavData()` gains one optional out parameter for that tag and the block
length. **Rate, channel count and sample width are still never read**, so
[`stereo-44k`](../device/fixtures/audio/stereo-44k.expected.json) stays exactly
as true as it was: a 44.1 kHz stereo file is accepted and played at 16 kHz
mono.

**The form is chosen per file, and two answers both have to be yes.**

1. **The device named the form.** `< audio va1` in the hello, matched whole,
   beside the `< tiles vt1` [ADR 0019](0019-tiles-travel-compressed.md) added.
   Two words rather than one, because they are two capabilities: every talker
   flashed between 2026-08-31 and 2026-09-01 draws a compressed tile and plays
   no compressed recording, and
   [`audio-named-in-the-hello`](../device/fixtures/cable/audio-named-in-the-hello.expected.json)
   is that device. `CABLE_VERSION` does not move.
2. **A person said this collection is one where it is bearable.** A checkbox on
   the loader page, above the two buttons that act on it, off unless somebody
   turns it on.

**The compression happens at the cable and nowhere earlier**, in the same
function that chooses the tile form, for the same reason: that is the first
place that knows who is listening. A device package carries the plain form —
form rule 3 and [ADR 0008](0008-audio-masters-derived-artefacts.md) — and
`isDeviceWav()` refuses the compressed one on purpose.

**The recording's name does not change.** It is a hash of the recording the
editor synthesised, not of the file, so one word is one name in either form.

## Why

**Why the person and not the package.** This is the only decision here that had
a real alternative, and the alternative was better on paper: a field on the
root board, written by the editor, travelling with the collection that knows
what it is. Two things sank it.

- **The editor cannot be changed from here.** It left on 2026-08-27
  ([ADR 0012](0012-the-repository-splits-editor-leaves.md)) and
  [`split-crossings.md`](../docs/split-crossings.md) names vendoring a copy as
  the edit that must not happen. A field only this side ever writes would be a
  format invention with no round trip and no second reader — and the four
  collections that need this exist *today*.
- **Nothing in a package distinguishes a game from speech**, and it is not
  obvious that anything should. Both hold recordings, both are boards, and
  which one somebody is understood through is a fact about how a collection is
  used rather than about what it contains.

So the question is asked of the person holding the talker, in the room they are
in — the same argument `AUDIO_VOLUME_PERCENT` makes in
[`vorlaut.ino`](../firmware/vorlaut/vorlaut.ino) for why the volume is in the
menu and not in `layout.bin`. **The default is the form that loses nothing**: a
transfer nobody thought about sends PCM.

**Why audibly worse is acceptable at all.** It is not, for speech, and the
decision does not claim it is. A talker exists to be understood; 15 dB on a
word somebody says to another person is not a trade worth making. It is a
different trade for a collection whose recordings are words to be matched in a
game, where the failure is a round somebody replays rather than a sentence
nobody heard. **The per-file tag is what keeps those two apart on one device**,
and it is why this is a per-file decision rather than a firmware setting.

**Why not Opus or MP3**, at a far better ratio. The three reasons
[ADR 0019](0019-tiles-travel-compressed.md) gave for refusing deflate, and the
first is again the strongest.

- `device/fixtures/` must regenerate byte for byte, and
  [`device/README.md`](../device/README.md) already refuses a dependency for
  that reason. IMA ADPCM is a fixed quantiser with two constant tables and no
  entropy coding, so its output is a property of the algorithm rather than of
  whichever library is installed.
- The board has **no PSRAM** ([`hardware.md`](../docs/hardware.md)). An Opus
  decoder is a library, a heap and a frame buffer; this one is a 89-entry table
  and about forty lines.
- Every reader here is hand-written and compiled by a test.
  [`tests/test_adpcm.py`](../tests/test_adpcm.py) runs the browser's encoder
  against the firmware's own decoder and requires the samples to agree **byte
  for byte**, not closely — the predictor carries from one sample to the next,
  so two tables that differ in one entry drift into noise over the length of a
  word rather than failing at the first byte. Checked by mutation: one wrong
  step entry is caught there and passes the quality bound.

**Why the plain form keeps the right of way.** A talker flashed before today
never opens `fmt` at all and plays whatever is in `data` as PCM. Sent a
compressed recording it would play the nibbles as samples — **a full-volume
hiss where a word should be**, at the moment somebody pressed a key expecting
one, in a house nobody here knows about with no update channel. That is a
louder failure than the panel of noise ADR 0019 was guarding against, and it is
why the word in the hello is matched whole and never compared.

**Why 256-byte blocks.** It is what every other writer of this format uses, and
that matters more than it looks: these files get opened in something else when
a word sounds wrong, and a block size nobody else emits would make that check a
test of the reader. It also decodes to 505 samples — 1010 bytes, about 32 ms —
which is the same order as the `AUDIO_CHUNK` `playWav()` already writes, so the
decoder changes the size of a write and not the shape of the loop.

## Consequences

- **Heard on the device on 2026-09-01, and that is what decided it.** All 36
  recordings of *Spiegel und Ei* were read back off a talker, compressed, put
  back, and played through the speaker: *almost identical, with a faint click.*
  Kept on that judgement. **Whether that click is a new one was not
  established**, and it is worth knowing that there is an old one to confuse it
  with — [`bring-up.md`](../docs/bring-up.md) stage 5 ends "a faint click
  survived all four bench experiments and was never accounted for". Telling
  them apart is one transfer and one key press, on a device that has both forms
  of the same word.
- **The decoder is not starving the bus, whatever the click is.** The device's
  own log over five words: `played` came out 3 to 4 per cent *below* the
  expected length every time, and a starved I2S stream overshoots rather than
  undershoots — the constant shortfall is the last buffer still in the DMA when
  `i2s.write()` returns. Reads were 1 to 5 ms against an `AMP_WAKE_MS` of 50,
  so the whole word still arrives inside the wait the amplifier needs anyway.
- **Long words stopped being streamed**, which was not the point and is the
  larger gain. `AUDIO_PRELOAD` is 48 KiB, so a word over about 1.5 seconds used
  to be read a chunk at a time while it played — the arrangement `bring-up.md`
  calls a lottery on a full file system. A 3.6-second word is 117 KiB of PCM
  and 29 KiB compressed, so it now plays out of RAM. None of the five words
  logged reported `streamed`.
- **The first sync after this re-sends every recording.** `plan()` keeps a file
  by name and size, and the compressed file has a different size, so each word
  goes across once more. That is one transfer, and it is what buys every
  transfer after it — the same line ADR 0019 carries for tiles.
- **About 1.2 KB of RAM**, static: 1010 bytes for one block of decoded samples
  and 190 for the two tables. Measured on the sketch: 135784 → 137784 bytes of
  globals, 42 per cent of 327680.
- **The device interface is 2.3.0**: a capability added, nothing existing
  changed, no reader made to misread anything it already accepts.
- **The folder export stays plain.** It has no talker to ask, and an image
  written for `mklittlefs` may be flashed onto any firmware, including one from
  before today.
- **A recording can now be silently wrong in a new way**: a file whose tag says
  ADPCM and whose blocks are not. It decodes to noise rather than being
  refused, because there is nothing in a block to check it against. The
  protection is entirely in who is offered the form.
- **Two encodings of one recording share a name**, and they do not decode to
  identical samples — unlike the two tile forms, which do. Nothing compares a
  recording's bytes against its name, so this costs nothing today; a checksum
  over content, added later for some other reason, would find it.

## Not to be "fixed" later

**The plain form is not deprecated and must not be removed.** It is what every
talker in the field plays, it is what a device package carries, it is what the
folder export writes, and it is the right answer for every collection somebody
is understood through. A change that made the compressed form the only one
would put a hiss on every talker flashed before today, and would quietly make
speech worse on the ones flashed after.

**The word in the hello is matched whole and must not become a comparison.**
There is no ordering on these forms. A browser that read an unknown word as
"newer, so probably fine" would be sending a file it cannot know the device can
play, and what comes out of the speaker is the loudest wrong answer this device
can give.

**The checkbox must not gain a remembered default.** It is deliberately asked
every time. A remembered "yes" is how a speech collection gets sent compressed
by a person who ticked it for a game three weeks earlier — and nothing about
the result would say so, because the transfer succeeds and the device works.
