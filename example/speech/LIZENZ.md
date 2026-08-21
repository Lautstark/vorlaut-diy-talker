# Where the example voice comes from

The four WAV files here are the spoken sentences from `example/layout.json` —
"Ja!", "Nein!", "Stopp", "Hilf mir".

Made with **Azure Speech**, voice `de-DE-GiselaNeural`, rate `-5%`, then
through the same ffmpeg chain as every other recording (16 kHz mono 16 bit,
trimmed, normalised). So this is exactly what `build.py` would produce itself —
only already done.

**Why they are in the repository at all:** so that a freshly flashed device
speaks instead of showing "keine Inhalte" on all five displays, and so that CI
can build an image with sound without knowing an Azure key. Four files of
88 KiB together are the difference between a device that talks out of the box
and one that first needs an account.

**Worth settling before the files are handed on further:** Azure allows the
generated speech to be used, but the terms for passing finished recordings to
third parties are not the same as for a public-domain model. For your own use
and for releases out of this repository that is uncontroversial; whoever
redistributes the files should read the current Azure terms once.

Piper makes it cleaner: its voices were picked for being public domain (see
`tools/voices.py`), and `de_DE-thorsten-medium` speaks these same four
sentences without raising the question at all. Once the Piper path is on
`main`, re-recording these four files is a one-liner — the names change along
with them, see below.

## Why the file names look like that

The name is the fingerprint of the text **and** the voice configuration, the
same one `tts.fingerprint()` builds. So these files only fit the default
configuration — change `AZURE_SPEECH_VOICE`, `AZURE_SPEECH_RATE` or
`PIPELINE_VERSION` in `tts.py` and they point nowhere and are silently
ignored.

So that this cannot happen unnoticed, `tests/test_example_speech.py` checks
that every sentence in `example/layout.json` has a file with the matching name
here. Which name belongs to which sentence is in `index.json`.
