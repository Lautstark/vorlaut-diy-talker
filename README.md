# vorlaut

A small talker to build yourself. Five keys that are displays at the same
time: four speak a stored sentence, the fifth switches between sets.

I am building it for my three-and-a-half-year-old daughter, who does not
speak yet.

> **Work in progress.** Has not run on real hardware yet.

## What it does

- Four speech keys per set, up to five sets on the device
- Every set has a colour, drawn as a border around all five displays
- Editing happens in the browser: find a symbol, type a sentence, listen to it
- One command turns that into pictures and speech files for the device
- Falls asleep by itself, wakes on any key press

## Quick start

With Docker, and nothing else — no clone, nothing to download, nothing to
create first:

```bash
docker run -d --name vorlaut -p 8771:8771 -p 8771:8771/udp \
  -v vorlaut-data:/data ghcr.io/steffipetaffy/vorlaut:latest
```

Then open [localhost:8771](http://localhost:8771). No Python, no ffmpeg, no
key and no `.env` — every setting has a default, and the image carries four
piper voices, so it speaks from the first minute.

There is content there too: on the first start the volume fills itself from the
examples in the image, so a set with four keys is ready right away. The four
example sentences come along as finished recordings, so the example can be
built and flashed before any voice exists.

That volume is everything that is yours; the code stays in the image, so
`docker pull` is the whole of updating.

**To keep it**, use the Compose file instead — one download, and it puts the
content in a `data/` folder you can see, which is what a NAS backup picks up.
That, another port, and building the image yourself:
[docs/operation.md](docs/operation.md).

## From source

The developer route — needed to work on the Python, not to run it.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Python 3.9 or newer and `ffmpeg` (`brew install ffmpeg` or
`apt install ffmpeg`); `python3 doctor.py` says what is missing.

No voice comes with this route, and none is needed to start editing: the
interface and the build work without one, only new sentences stay silent and
say so. The same four piper voices are one press away in the voice picker in
the header, and Azure Speech is the other route — more voices and better ones,
against a key of your own, for which a free account is enough. Both are in
[docs/editing.md](docs/editing.md#for-the-speech-output).

## What it is made of

An **ESP32-S3 Feather** drives five **Waveshare ScreenKeys** — 0.85 inch
displays with a built-in button — over a shared SPI bus, with a **MAX98357A**
and a 40 mm speaker for the sound and a LiPo for the power. The firmware is an
Arduino sketch.

Editing happens on a computer: a web interface built from the Python standard
library, pictograms from [ARASAAC](https://arasaac.org), speech from piper or
Azure. The build turns those into RGB565 images and 16 kHz WAVs and packs them
into a LittleFS image for the flash.

## Languages

The **product** comes in German and English — interface, build log and the
labels on the device, all switched together at the top right of the interface.
The **content** is untouched by it: what somebody typed stays as they typed it.
Code, comments, commit messages and `docs/` are English throughout. The whole
of it, including what the display's font can and cannot draw, is in
[docs/languages.md](docs/languages.md).

## Further

| | |
|---|---|
| [docs/hardware.md](docs/hardware.md) | Parts, pin assignment, case dimensions |
| [docs/editing.md](docs/editing.md) | Web interface, layout.json, symbols, voices, settings |
| [docs/software.md](docs/software.md) | How it works: discovery, pairing, sync, build, speech |
| [docs/tile-rendering.md](docs/tile-rendering.md) | The symbol renderer in Python and in the browser, and how far apart they are |
| [docs/bring-up.md](docs/bring-up.md) | First assembly in stages, with small test sketches |
| [docs/firmware.md](docs/firmware.md) | Ready-made image or compile it yourself, partition scheme, flashing |
| [docs/operation.md](docs/operation.md) | Running in a container, editing from a phone, on a NAS |
| [docs/languages.md](docs/languages.md) | German and English in the product, English in the code |

## Licence

Code under [MIT](LICENSE). Three things in here are not:

| | |
|---|---|
| [`example/symbols/LIZENZ.md`](example/symbols/LIZENZ.md) | The ARASAAC pictograms, author Sergio Palao, **CC BY-NC-SA** — same for every symbol the search loads |
| [`example/speech/LIZENZ.md`](example/speech/LIZENZ.md) | The example recordings, made with Azure Speech |
| [`voices/LIZENZ.md`](voices/LIZENZ.md) | The four piper voices, public domain, fetched rather than stored here |
