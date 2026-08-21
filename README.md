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

## What it is made of

An **ESP32-S3 Feather** drives five **Waveshare ScreenKeys** — 0.85 inch
displays with 128×128 pixels and a built-in button — over a shared SPI bus.
The sound goes through a **MAX98357A** to a 40 mm speaker, the power comes
from a LiPo charged over USB-C on the Feather. The firmware is an Arduino
sketch.

Editing happens on a computer: a web interface built from the Python standard
library, pictograms from [ARASAAC](https://arasaac.org), speech from piper
or Azure.
The build turns those into RGB565 images and 16 kHz WAVs and packs them into
a LittleFS image for the flash.

## Quick start

```bash
git clone https://github.com/SteffiPeTaffy/vorlaut.git
cd vorlaut
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

Whether everything needed is there is answered by:

```bash
python3 doctor.py
```

Then open [localhost:8771](http://localhost:8771). On the first start
`content/` fills itself from `example/`, so a set with four keys is there
right away.

`ffmpeg` is needed as well (`brew install ffmpeg` or `apt install ffmpeg`).

For the speech output there are two routes, and **neither is needed to start
editing**. Without a voice the interface works and the build works — only new
sentences stay silent and say so.

**Offline, free, no account** — two German and two English voices, all four
public domain:

```bash
pip install piper-tts
.venv/bin/python tools/voices.py
```

**Azure Speech** — more voices and better ones, at the price of a key of your
own. A free account is enough, the F0 tier includes 0.5 million characters a
month. Key and region go into `.env`, the template is `.env.example`.

Either way, `.venv/bin/python tts.py --voices` shows what this installation can
speak with. The voice is picked in the interface and stands as `"voice"` in
`layout.json`.

## Languages

The **product** comes in German and English — the interface, the build log and
the labels on the device. It is switched at the top right of the interface and
stored as `"language"` in `layout.json`.

It is deliberately **one** setting for everything. A talker whose menu says
`back` while the computer next to it says `zurück` would be one more thing to
keep in step.

The **content** is untouched by it: set names, the words on the keys and
everything spoken are whatever somebody typed. Switching the interface to
English leaves a German set German. The voice is chosen separately and can
speak a different language than the menu.

The texts live as one table per language in [`texts.py`](texts.py) for the
computer and the interface, and in
[`firmware/vorlaut/texts.h`](firmware/vorlaut/texts.h) for the device. English
is the default.

The built-in font is not Unicode but code page 437: `zurück` would have ended
up as `zur├╝ck` on the display. What can be drawn and what cannot is in
[docs/firmware.md](docs/firmware.md); a test checks every translation against
the width of a display.

**Code and documentation are English** — identifiers, comments, commit
messages, `docs/` and the command line.

The command line stays English even when the interface is set to German:
`build.py` passes messages on as keys, and whoever displays them decides the
language. The same error reads English in the terminal and German in the
browser.

So the split does not run by file but by who reads it: what somebody uses
comes in their language; what gets read while developing is English.

`python3 tests/test_language.py` checks that, and names the file and line for
anything that got left behind.

## Further

| | |
|---|---|
| [docs/hardware.md](docs/hardware.md) | Parts, pin assignment, case dimensions |
| [docs/software.md](docs/software.md) | Web interface, layout.json, build, speech |
| [docs/bring-up.md](docs/bring-up.md) | First assembly in stages, with small test sketches |
| [docs/firmware.md](docs/firmware.md) | Ready-made image or compile it yourself, partition scheme, flashing |
| [docs/operation.md](docs/operation.md) | Running in a container, editing from a phone, on a NAS |

## Licence

Code under [MIT](LICENSE).

The pictograms in `example/symbols/` are not covered by it: they come from
[ARASAAC](https://arasaac.org), author **Sergio Palao**, licence
**CC BY-NC-SA**. The same holds for every symbol loaded through the search in
the web interface. Details in
[`example/symbols/LIZENZ.md`](example/symbols/LIZENZ.md).
