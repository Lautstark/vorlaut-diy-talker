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

vorlaut is a page. There is no server, no container and nothing to install:
the app is `ui.html` and `static/`, and it runs in a browser with nothing
behind it. The boards, the symbols and the speech all happen in the tab.

The published copy is that page, deployed straight from `main`:
**<https://lautstark.github.io/vorlaut/>**. Nothing is behind it, so it is the
same app as a clone — it just saves the clone.

To run it from a checkout:

```bash
git clone https://github.com/Lautstark/vorlaut && cd vorlaut && python3 -m http.server 8801
```

Then open <http://localhost:8801/ui.html>.

**Double-clicking `ui.html` will not work, and cannot be made to.** A browser
gives a `file://` page the origin `null`, and refuses to load ES modules across
it — `static/main.js` is blocked before a line of it runs. IndexedDB has no
origin there either, so there would be nowhere to keep a board. Any static
server will do; the line above is the one that needs nothing installed. The
alternative would be bundling the front end into a single file, which is the
build step this project does not have on purpose.

It needs a browser recent enough for ES modules and import maps and, to put
content on a device, one that speaks WebSerial — Chrome or Edge. Firefox and
Safari will edit boards but cannot talk to the cable.

No key and no `.env` to write: every setting has a default, and the first visit
seeds an empty set with four keys, so there is something to type into
immediately. The boards, the symbols and the settings live in the browser's own
storage — in that browser, on that machine, and nowhere else.

Getting it onto the talker is [docs/cable.md](docs/cable.md): flash the
firmware once, then push content down the USB-C cable from the same page.

No voice is installed for you. Nothing is needed to start editing — the
interface and the build work without one, and new sentences simply stay silent
and say so. The four piper voices are one press away in the voice picker in the
header, and Azure Speech is the other route, against a key of your own. Both
are in [docs/browser-tts.md](docs/browser-tts.md).

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

> **The one thing that is not here yet.** *Release* — turning a board into the
> tiles and WAVs the device reads — still reports that it is unwritten. The
> pieces exist and are proven against the Python they were ported from, in
> [docs/browser-tts.md](docs/browser-tts.md) and
> [docs/tile-rendering.md](docs/tile-rendering.md); what is missing is the
> orchestration that was `builder.py`. Everything else on the page works.

## What it is made of

An **ESP32-S3 Feather** drives five **Waveshare ScreenKeys** — 0.85 inch
displays with a built-in button — over a shared SPI bus, with a **MAX98357A**
and a 40 mm speaker for the sound and a LiPo for the power. The firmware is an
Arduino sketch.

Editing happens in a browser: one page of native ES modules with no build step
and nothing behind it, pictograms from [ARASAAC](https://arasaac.org), speech
from piper or Azure. The build turns those into RGB565 images and 16 kHz WAVs
and packs them into a LittleFS image for the flash.

### The one npm dependency

`static/tokens.css` is not written here. The colours, radii and shadows are
shared with the sister projects and come from
[Lautstark/design](https://github.com/Lautstark/design), which derives them from
one input — vorlaut's accent `#9B7BFF` — and checks every contrast pairing
before publishing. There is a [gallery](https://lautstark.github.io/design/):
pick the purple swatch to see this product's exact set.

That is the whole reason this repository has a `package.json`. There is still no
build step and the page still loads plain ES modules; npm is here to pin a
version and nothing else:

```bash
npm install                 # once
npm update @lautstark/design && npm run tokens
```

`npm run tokens` copies the file into `static/`, where it is committed — so the
page runs for anyone who never touches npm at all. Do not edit it; it says so at
the top, and the next update overwrites it. To change a value, change the rule
that produces it.

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
| [docs/software.md](docs/software.md) | How it works: discovery, pairing, sync, build, speech |
| [docs/tile-rendering.md](docs/tile-rendering.md) | The symbol renderer in Python and in the browser, and how far apart they are |
| [docs/bring-up.md](docs/bring-up.md) | First assembly in stages, with small test sketches |
| [docs/firmware.md](docs/firmware.md) | Ready-made image or compile it yourself, partition scheme, flashing |
| [docs/languages.md](docs/languages.md) | German and English in the product, English in the code |
| [docs/browser-tts.md](docs/browser-tts.md) | Speaking without a server: what was measured, and which voices survive it |
| [docs/cable.md](docs/cable.md) | Pushing content down the USB-C cable, for when there is no server to fetch from |
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
