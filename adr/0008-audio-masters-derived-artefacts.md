# ADR 0008 — One master per utterance, at the voice's native rate; everything else is derived

**Status:** accepted · **Date:** 2026-08-24 · **Applies to:** the recording
chain in vorlaut, SPEC.md 1.0.0 §6

## Context

Two consumers want the same spoken sentence in two different shapes.

**The DIY talker** wants 16 kHz mono 16-bit PCM WAV. That is not a preference:
it is what the ESP32 firmware plays through the MAX98357A, and the recording
chain is called with `rate: 16000` for it.

**An app package** wants Ogg Opus — royalty-free, decoded natively by Android
since API 21, and about a tenth the size, which decides whether a vocabulary of
several hundred utterances is a file you can send in a message.

piper synthesises at neither. Its voices are native at 22.05 kHz or 24 kHz
depending on the voice, with exactly one exception in the catalogue:
`de_DE-kerstin-low` is native at 16 kHz, which is why she alone reaches the
device without a resample.

So both artefacts involve a rate conversion, and there is an obvious shortcut in
front of anyone implementing the second one. The WAVs already exist — the talker
path has been rendering them all along. Encoding Opus from those WAVs is one
ffmpeg invocation and needs no new synthesis at all.

SPEC.md §6.1 already says not to do that. It states the rule in four sentences
and calls itself "background for builder authors". It does not explain why, and
the why is the part that stops someone undoing it.

## Decision

**Synthesis produces one master per `text + voice`, at the voice's own native
rate. Both delivered artefacts are derived from that master, and never from each
other.**

```
                    piper, voice's native rate (22.05 or 24 kHz)
                                    │
                              master (kept)
                                ╱       ╲
                  downsample 16 kHz     encode Opus, 24 kHz in
                          │                       │
                   talker .wav              package .opus
```

- The master is the output of the synthesis chain at the voice's native rate,
  after the contract's trimming and measurement, before any consumer's
  resampling.
- The talker's 16 kHz mono WAV is downsampled from the master.
- The app package's Ogg Opus is encoded from the master, at a 24 kHz encoder
  input rate, 24–32 kbit/s VBR, mono.
- **Transcoding one delivered artefact into the other is forbidden.**

## Why

**Two lossy stages instead of one, for no gain.** Encoding Opus from the 16 kHz
WAV means the signal has already been through a lowpass at 8 kHz and then gets
Opus's own quantisation on top. Opus at 24 kbit/s is transparent for speech
*from a clean source*; it is not a repair tool. The output is audibly worse than
encoding the master directly, and the cost of doing it right is a file we
already have.

**The 16 kHz WAV is the smallest artefact in the chain**, so deriving anything
from it means deriving the better artefact from the worse one. 16 kHz keeps
nothing above 8 kHz. Speech from a single voice has little above ~10 kHz worth
keeping — which is the argument for 24 kHz being *enough*, not for 8 kHz being
enough. Fricatives are exactly where the difference lands, and a talker's
vocabulary is full of them.

**24 kHz is chosen against 22.05 kHz for a specific reason** and it only works
from a master: it is the Opus encoder input rate that covers the speech band
without forcing the resampling 22.05 kHz would. Going 22.05 → 16 → 24 does two
conversions to arrive somewhere one would have reached directly.

**Neither consumer is the source of truth, so neither can be the source.** The
talker's rate is a property of a specific amplifier; the package's is a property
of the Opus encoder. If either device changes — a different DAC, a different
codec — a chain rooted in the master re-derives correctly, while a chain rooted
in the WAV has permanently thrown away what the new consumer needs.

**It keeps the measurement meaningful.** `stimmquelle`'s contract §2 specifies
that the fade and the padding are applied to the trimmed signal *before* the
loudness measurement. That measurement describes the master. Two artefacts
derived from one measured master are loudness-consistent with each other by
construction; a transcode chain measures once and then guesses.

**Deduplication only works at one level.** Keying by `text + voice` means the
same sentence on three boards is synthesised once. Synthesis is by far the
expensive step — it is a neural model running in a browser tab — and the derived
encodes are cheap in comparison. Caching the derived artefacts instead would key
on the consumer as well and multiply the work.

## Consequences

- **The master is a third artefact and has to be kept**, at least for the
  lifetime of a build. It is the largest of the three, and that is the storage
  cost of the decision.
- The builder needs a resampler *and* an Opus encoder, both fed from the same
  buffer. Neither may be implemented as "run the other one's output through
  ffmpeg".
- `de_DE-kerstin-low` is a special case in fact but not in code: her master is
  already at 16 kHz, so her downsample is the identity. She still goes through
  the same path, and her Opus is still encoded from the master.
- **A change to §1 or §2 of `stimmquelle`'s contract re-renders every master,
  and therefore every artefact on every device.** `PIPELINE_VERSION` says
  whether it did. That makes a package refresh a decision rather than an update,
  as `docs/packages.md` already warns.
- SPEC.md §6 permits an importer to *accept* 16 kHz WAV, and that is not in
  tension with this: it is tolerance for hand-made and phone-recorded packages
  arriving from outside. Our builder still writes Opus, from the master.
- The Opus file reports 48 kHz when probed, always. `OpusHead` records 24 kHz as
  an informational input-rate field and every decoder outputs 48 kHz. A
  conformance check asserting a 24 kHz decoded stream fails on correct files —
  fixture `minimal` is the one to try it against.

## Not to be "fixed" later

The shortcut is genuinely tempting, because at the moment somebody reaches for
it the WAVs are sitting right there, already rendered, already deduplicated,
and `ffmpeg -i in.wav -c:a libopus out.opus` is a complete answer that produces
a file which plays. Nothing fails. The board works. The regression is that every
utterance in every package is quietly a generation worse than it needed to be,
and it is invisible in every test that checks whether audio exists rather than
what it sounds like.

SPEC.md §6.1 states the rule; this ADR is the reason, written down so the rule
survives contact with someone in a hurry.
