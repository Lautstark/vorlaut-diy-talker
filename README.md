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

## Running it

There is one way in today, and it is a clone. The container is gone: vorlaut is
becoming a page that runs in the browser with nothing behind it, and keeping an
image published in the meantime meant maintaining a way in that is on its way
out.

```bash
git clone https://github.com/Lautstark/vorlaut && cd vorlaut
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Then open [localhost:8771](http://localhost:8771). Python 3.9 or newer, and
`ffmpeg` for the speech (`brew install ffmpeg` or `apt install ffmpeg`).

```bash
python3 doctor.py
```

says what is missing and how to install it, including piper. It needs nothing
itself, so it works before anything else does.

No key and no `.env` to write: every setting has a default, and content/ fills
itself from the examples on the first start, so a set with four keys is ready
right away. The four example sentences come with finished recordings, so the
example can be built and flashed before any voice exists.

No voice is installed for you. Nothing is needed to start editing — the
interface and the build work without one, and new sentences simply stay silent
and say so. The four piper voices are one press away in the voice picker in the
header, and Azure Speech is the other route, against a key of your own. Both
are in [docs/editing.md](docs/editing.md#for-the-speech-output).

> **Where this is going.** The app half is being rewritten as a static site
> with no server at all — see [docs/browser-tts.md](docs/browser-tts.md) and
> [docs/tile-rendering.md](docs/tile-rendering.md) for the pieces of it that
> already exist and are proven against the Python. That page is not ready, and
> until it is, the clone above is how vorlaut runs.

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
| [docs/languages.md](docs/languages.md) | German and English in the product, English in the code |
| [docs/obf.md](docs/obf.md) | layout.json as an Open Board Format document, field by field |
| [docs/browser-tts.md](docs/browser-tts.md) | Speaking without a server: what was measured, and which voices survive it |

## Licence

Code under [MIT](LICENSE). Three things in here are not:

| | |
|---|---|
| [`example/symbols/LIZENZ.md`](example/symbols/LIZENZ.md) | The ARASAAC pictograms, author Sergio Palao, **CC BY-NC-SA** — same for every symbol the search loads |
| [`example/speech/LIZENZ.md`](example/speech/LIZENZ.md) | The example recordings, made with Azure Speech |
| [`voices/LIZENZ.md`](voices/LIZENZ.md) | The four piper voices, public domain, fetched rather than stored here |

### METACOM on the device

METACOM is a **commercial symbol set with a per-person licence.** A talker built
here can show METACOM symbols on its keys, because that is what the licence is
for: making communication material for the person you support. A 116×116 tile on
a display is the same object as a laminated card, and nobody thinks laminating
one is a licensing question.

Four boundaries keep it that way, and they are the same rule vorlaut already
follows for files:

- **Nothing this repository ships ever contains METACOM-derived pixels.** No
  example content, no container image, no CI artefact, no `.bin` in a release.
  That is the line that would actually be redistribution.
- **The symbols are read from your own licensed folder, and stay there.** They
  are neither downloaded nor copied — the layout holds a `metacom:` reference
  and the picture is fetched at build time.
- **The build runs on your machine and goes to your device.** Not through
  anybody's server.
- **A board you share stays a reference.** `.obf` and `.obz` are not picture
  containers — see [docs/obf.md](docs/obf.md) — so a board sent to someone else
  carries the names of the symbols, and renders for them only if they hold a
  licence too.

Building a talker **for somebody else** is a different question, and a per-person
licence is unlikely to cover it. That is not about the device: it would be the
same answer for printed cards. If you get there, ask
[the publisher](https://www.metacom-symbole.de) first.

Without your own METACOM licence none of this applies — the feature simply does
not work, and ARASAAC covers the whole device on its own.
