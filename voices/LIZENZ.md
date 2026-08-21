# Where the baked-in voices come from

The image built from the `Dockerfile` carries all four piper voices of
`tts.VOICE_CATALOGUE` at `/voices`. They are not in this repository — they are
downloaded during the build, by the project's own `tools/voices.py`, from
`https://huggingface.co/rhasspy/piper-voices`. This file records what they are
and under which licence, because putting a model into a published image is
redistribution, and that is a different act from downloading one at runtime.

## The four

Checked on 2026-08-21 by reading the `MODEL_CARD` next to each model, not the
file name — that is the rule `tts.py` sets for adding a voice, and it applies
to keeping one too.

| Voice | Dataset | Licence as stated in `MODEL_CARD` |
| --- | --- | --- |
| `de_DE-thorsten-medium` | [Thorsten-Voice](https://github.com/thorstenMueller/Thorsten-Voice) | **CC0** |
| `de_DE-kerstin-low` | [dataset-voice-kerstin](https://github.com/rhasspy/dataset-voice-kerstin) | **CC0** |
| `en_US-kristin-medium` | [LibriVox](https://librivox.org) | **public domain** |
| `en_US-john-medium` | [LibriVox](https://librivox.org) | **public domain** |

CC0 and public domain both allow the files to be handed on, which is the whole
reason these four were picked. Most of piper's better known English voices are
not free in that way; `ljspeech` would have been, and lost the English slot to
Kristin for reading like an error in a list of first names, not for its licence.

## Two of them are finetunes, and that is on the record here

Three of the four were finetuned from another piper voice, and for the two
German ones the base is not free:

| Voice | Finetuned from | Licence of that base's corpus |
| --- | --- | --- |
| `de_DE-thorsten-medium` | `en_US-lessac-medium` | [Blizzard 2013 Lessac](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/) — a research licence, granted by name and by hand |
| `de_DE-kerstin-low` | `en_US-ryan-low` | [RyanSpeech](https://www.kaggle.com/datasets/roholazandie/ryanspeech) — CC BY-NC-SA 4.0, non-commercial |
| `en_US-john-medium` | `en_US-kristin-medium` | LibriVox — public domain |

So the English pair is public domain the whole way down, and the German pair's
CC0 is a statement sitting on top of corpora that are not. Whether the weights
of a finetune carry the terms of the corpus its base was trained on is not a
settled question, and this file does not pretend to answer it: piper publishes
all four as free to pass on, that is what `tts.py` has always relied on, and
baking them into the image relies on exactly the same statement and nothing
more.

It is written down here so that whoever asks the question next finds it already
asked, rather than concluding that nobody looked.

## Sizes

63 MB each, about 250 MB together — the `.onnx` plus the `.onnx.json` beside
it, which is piper's own description of the voice and without which the model
is just a blob. The `low` one is no smaller than the others; the quality tier
says nothing about the file size here.

That 250 MB is what the image grew by, on top of the roughly 200 MB that
`onnxruntime` already costs. The trade it buys: a container that speaks the
moment it starts, instead of one that says "Nothing here can speak yet" until
somebody presses Fetch voices.

## Not the same as the example recordings

`example/speech/` holds four WAV files made with Azure Speech, and those sit
under different terms — see [`../example/speech/LIZENZ.md`](../example/speech/LIZENZ.md).
The note there about re-recording them with `de_DE-thorsten-medium` to drop the
question entirely still stands, and is now a little easier: that voice is in
the image.
