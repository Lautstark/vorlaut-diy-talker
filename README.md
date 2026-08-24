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
- One press turns that into pictures and speech files, and sends them down
  the cable to the device
- Falls asleep by itself, wakes on any key press
- No radio at all: the device has no Wi-Fi, and the cable is the only way in
- The build can also be written into a folder, for the bench and for `mklittlefs`

## Running it

vorlaut is a page, and there is nothing behind it: the boards, the symbols and
the speech all happen in the tab. The published copy is deployed straight from
`main`: **<https://lautstark.github.io/vorlaut-diy-talker/>**. It is the same
app as a clone — it just saves you the clone.

To run it from a checkout:

```bash
git clone https://github.com/Lautstark/vorlaut-diy-talker && cd vorlaut-diy-talker && npm install && npm run dev
```

Then open <http://localhost:8801>.

It needs a browser recent enough for ES2022 and, to put content on a device,
one that speaks WebSerial — Chrome or Edge. Firefox and Safari will edit boards
but cannot talk to the cable.

No key and no `.env` to write: every setting has a default, and the first visit
seeds an empty set with four keys, so there is something to type into
immediately. The boards, the symbols and the settings live in the browser's own
storage — in that browser, on that machine, and nowhere else.

Getting it onto the talker is [docs/cable.md](docs/cable.md): flash the
firmware once, then push content down the USB-C cable from the same page.

No voice is installed for you. Nothing is needed to start editing — the
interface works without one, and new sentences simply stay silent and say so.
The piper voices are one press away in the voice picker in the header, and
Azure Speech is the other route, against a key of your own. Both are in
[docs/browser-tts.md](docs/browser-tts.md).

> **The one thing that is not here yet.** No board has run any of this. *Send
> to the device* builds a board into tiles and WAVs and pushes them down the
> cable, and every part of that is checked — against the Python it was ported
> from in [docs/browser-tts.md](docs/browser-tts.md) and
> [docs/tile-rendering.md](docs/tile-rendering.md), and against the firmware's
> own reader, compiled, in `tests/test_cable_format.py`. What none of it has
> met is a talker. What a first run has to show is the table at the end of
> [docs/cable.md](docs/cable.md).

## Working on it

TypeScript, bundled by Vite, with no framework: the interface is plain DOM, and
`src/ui/templates/` holds the markup beside the module that wires it.

| | |
|---|---|
| `npm run dev` | the page, with reloading |
| `npm run typecheck` | `tsc -b` over three projects — the browser, the config files, and the browser tests, which span both |
| `npm test` | vitest: the frozen references for the tile renderer, the OBF converter and the recording chain, the text table, and the walk that says every module under `src/` is one the page reaches |
| `npm run test:e2e` | Playwright: the page, built and opened in a real browser, under the base a project site is served from |
| `python3 tests/run.py` | the checks that need a C++ compiler — the firmware's own readers, compiled and fed the browser's bytes |

That last one is the only Python left, and it is not going anywhere:
`layout.bin`, the cable protocol and the panel's text each have two
implementations that have to agree, one of them C++.

The four shared packages are git dependencies pinned by release tag — see
[docs/packages.md](docs/packages.md).

### If you have a METACOM licence

Two places want to know where your collection is, for now, and they are not the
same place.

**Searching** happens in the browser. Open the gear, and under *Symbols* choose
the folder — Chrome and Edge remember it, Firefox and Safari read it for the
session. Nothing is uploaded, nothing is copied, and nothing derived from those
files leaves the browser; see [METACOM on the device](#metacom-on-the-device).

The build runs in the browser too, so there is nothing to configure and no
path to set — the folder picker is the whole of it. A `metacom:` reference is
a file name, so a board keeps working against any copy of the collection.

## What it is made of

An **ESP32-S3 Feather** drives five **Waveshare ScreenKeys** — 0.85 inch
displays with a built-in button — over a shared SPI bus, with a **MAX98357A**
and a 40 mm speaker for the sound and a LiPo for the power. The firmware is an
Arduino sketch.

Editing happens in a browser: one page, TypeScript bundled by Vite, with
nothing behind it — pictograms from [ARASAAC](https://arasaac.org), speech from
piper or Azure. The build turns those into RGB565 images and 16 kHz WAVs and
packs them into a LittleFS image for the flash.

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
| [docs/software.md](docs/software.md) | How it works: the build, the file formats, speech |
| [docs/tile-rendering.md](docs/tile-rendering.md) | The symbol renderer in Python and in the browser, and how far apart they are |
| [docs/bring-up.md](docs/bring-up.md) | First assembly in stages, with small test sketches |
| [docs/firmware.md](docs/firmware.md) | Ready-made image or compile it yourself, partition scheme, flashing |
| [docs/languages.md](docs/languages.md) | German and English in the product, English in the code |
| [docs/browser-tts.md](docs/browser-tts.md) | Speaking without a server: what was measured, and which voices survive it |
| [docs/cable.md](docs/cable.md) | Pushing content down the USB-C cable, for when there is no server to fetch from |
| [docs/packages.md](docs/packages.md) | The four shared packages, how they are pinned, and what vorlaut asks of them |
| [docs/releases.md](docs/releases.md) | Which tag prefix releases what, and the commit convention release-please reads |
| [docs/frozen-references.md](docs/frozen-references.md) | What still checks the browser halves once the Python ones are deleted, and what does not |

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
  containers, so a board sent to someone else
  carries the names of the symbols, and renders for them only if they hold a
  licence too.

Building a talker **for somebody else** is a different question, and a per-person
licence is unlikely to cover it. That is not about the device: it would be the
same answer for printed cards. If you get there, ask
[the publisher](https://www.metacom-symbole.de) first.

Without your own METACOM licence none of this applies — the feature simply does
not work, and ARASAAC covers the whole device on its own.
