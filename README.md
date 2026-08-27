# vorlaut

A small talker to build yourself. Five keys that are displays at the same
time: four speak a stored sentence, the fifth switches between sets.

I am building it for my three-and-a-half-year-old daughter, who does not
speak yet.

> **Work in progress.** Has not run on real hardware yet.

## What it does

- Four speech keys per set, up to five sets on the device
- Boards are built in [vorlaut-editor](https://github.com/Lautstark/vorlaut-editor)
  and exported as a file; this repository is what turns that file into what the
  talker holds
- One press checks the file, compiles it into pictures and speech, and sends it
  down the cable to the device
- Falls asleep by itself, wakes on any key press
- No radio at all: the device has no Wi-Fi, and the cable is the only way in
- The build can also be written into a folder, for the bench and for `mklittlefs`

## The two halves, and which one this is

This repository is **the device**: the firmware, the enclosure, the fixtures
both ends are held against, and the page that loads a board onto a talker. The
editor — the boards, the symbol search, the voices — is
[`Lautstark/vorlaut-editor`](https://github.com/Lautstark/vorlaut-editor), and
it left on 2026-08-27. [ADR 0012](adr/0012-the-repository-splits-editor-leaves.md)
is the decision and [docs/repository-map.md](docs/repository-map.md) is the
shape.

The boundary between them is a **file**, not a dependency: the editor exports an
`.obz` and stops, and this repository's page compiles it and sends it
([ADR 0011](adr/0011-editor-exports-the-talker-repository-sends.md)). Neither
half imports the other.

## Running it

The loader is a page, and there is nothing behind it. The published copy is
deployed straight from `main`:
**<https://lautstark.github.io/vorlaut-diy-talker/>**.

That address did not change when the editor left, and that is the half of the
split worth knowing about: the page somebody opens with a talker in front of
them is served from the repository that kept its name. What moved is the
editor's address, which is now
<https://lautstark.github.io/vorlaut-editor/>.

To run it from a checkout:

```bash
git clone https://github.com/Lautstark/vorlaut-diy-talker && cd vorlaut-diy-talker && npm install && npm run dev
```

Then open <http://localhost:8801>.

It needs a browser recent enough for ES2022 and, to put content on a device,
one that speaks WebSerial — Chrome or Edge. Firefox and Safari can check and
compile a file and write the result into a folder, but cannot talk to the cable.

No key and no `.env` to write. Nothing is uploaded and nothing is stored: the
page is opened with a file and a cable, does its five steps, and is closed
again.

Getting content onto the talker is two steps and two pages. In the editor,
*Export this collection* in the `⋯` beside the collection's name, then *For the
talker*; then open this page, choose that file, and it checks it, compiles it
into what the talker reads and pushes it down the USB-C cable. Flash the
firmware once first; [docs/cable.md](docs/cable.md) is the wire, and
[adr/0011](adr/0011-editor-exports-the-talker-repository-sends.md) is why it is
two pages.

> **The one thing that is not here yet.** No board has run any of this. The
> loader page compiles a file into tiles and WAVs and pushes them down the
> cable, and every part of that is checked — against the Python it was ported
> from in [docs/browser-tts.md](docs/browser-tts.md) and
> [docs/tile-rendering.md](docs/tile-rendering.md), and against the firmware's
> own reader, compiled, in `tests/test_cable_format.py`. What none of it has
> met is a talker. What a first run has to show is the table at the end of
> [docs/cable.md](docs/cable.md).

## Working on it

TypeScript, bundled by Vite, with no framework: the interface is plain DOM. One
page, at the repository root, out of a directory that keeps the name it had when
it was a page under the editor's.

| | |
|---|---|
| `loader/` | the page: the checks, the compiler, the tile renderer, the `layout.bin` writer, the cable and the reader half of the device package — see [loader/README.md](loader/README.md) |
| `firmware/` | the talker itself. C++, Arduino, ESP32-S3 |
| `device/` | the conformance fixtures, owned by neither the browser nor the firmware — [ADR 0009](adr/0009-device-interface-fixtures.md) |
| `case/` | the enclosure, in OpenSCAD |

Two implementations of every device format live here and have to agree —
`layout.bin`, the cable protocol and the panel's text, each written in
TypeScript and read in C++. That is the whole of why the firmware and the
browser code share a repository ([ADR 0006](adr/0006-builder-and-hardware-one-repo.md)),
and it is what decided that the editor was the half that left rather than the
firmware.

| | |
|---|---|
| `npm run dev` | the page, with reloading |
| `npm run typecheck` | `tsc -b` over three projects — the browser, the config files, and the browser tests, which span both |
| `npm test` | vitest: the device fixtures, the package reader, the compile, and the cable's version handling |
| `npm run test:e2e` | Playwright: the page, built and opened in a real browser, under the base a project site is served from |
| `python3 tests/run.py` | the checks that need a C++ compiler — the firmware's own readers, compiled and fed the browser's bytes — plus the prose checks over every tracked file |

That last one is the only Python left, and it is not going anywhere:
`layout.bin`, the cable protocol and the panel's text each have two
implementations that have to agree, one of them C++.

`@lautstark/design` is a git dependency pinned by release tag — see
[docs/packages.md](docs/packages.md). It is the only one left here; the other
three answered questions the editor asks and went with it.

## What it is made of

An **ESP32-S3 Feather** drives five **Waveshare ScreenKeys** — 0.85 inch
displays with a built-in button — over a shared SPI bus, with a **MAX98357A**
and a 40 mm speaker for the sound and a LiPo for the power. The firmware is an
Arduino sketch.

The board it shows comes from a browser: pictograms from
[ARASAAC](https://arasaac.org), speech from piper or Azure, all of it in
vorlaut-editor. What arrives here is one file; this page turns it into RGB565
images and 16 kHz WAVs and either sends them down the cable or writes them into
a folder for `mklittlefs`.

That is this repository. It is one of several: an Android viewer opens the
packages the editor exports, and the shared libraries come in pinned by tag.
Which repositories there are, what each one does, and what passes between them
is [docs/repository-map.md](docs/repository-map.md).

## Languages

The **product** comes in German and English — the loader page's own words, its
build log and the labels on the device. This page has no language control: it
reads the choice the editor remembered, out of `vorlaut.language` in the
browser's storage, and falls back to what the browser asks for. Two GitHub Pages
project sites share an origin, which is what makes that work at all, and
[docs/split-crossings.md](docs/split-crossings.md) is where the edge is written
down. The **content** is untouched by any of it: what somebody typed stays as
they typed it. Code, comments, commit messages and `docs/` are English
throughout. The whole of it, including what the display's font can and cannot
draw, is in [docs/languages.md](docs/languages.md).

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
| [docs/device-interface.md](docs/device-interface.md) | The formats between the browser and the device, and the fixtures both are held against |
| [docs/repository-map.md](docs/repository-map.md) | The repositories in the family, what each one does, and the seams between them |
| [docs/split-crossings.md](docs/split-crossings.md) | What crossed the seam before the editor left, name by name, and what each crossing cost |
| [docs/packages.md](docs/packages.md) | The shared packages, how they are pinned, and what this repository asks of them |
| [docs/releases.md](docs/releases.md) | Which tag prefix releases what, and the commit convention release-please reads |
| [docs/frozen-references.md](docs/frozen-references.md) | What still checks the browser halves once the Python ones are deleted, and what does not |
| [adr/](adr/) | The decisions that would otherwise be "tidied up" later, and why each of them is not an oversight |

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
for: making communication material for the person you support. A 128×128 tile on
a display is the same object as a laminated card, and nobody thinks laminating
one is a licensing question.

Four boundaries keep it that way, and they are the same rule vorlaut already
follows for files:

- **Nothing this repository ships ever contains METACOM-derived pixels.** No
  example content, no CI artefact, no `.bin` in a release. That is the line that
  would actually be redistribution.
- **The symbols are read from your own licensed folder, and stay there.** The
  editor holds the folder and neither downloads nor copies it; what reaches this
  page is a `metacom:` reference and, for a device export alone, the source
  picture behind it.
- **The build runs on your machine and goes to your device.** Not through
  anybody's server.
- **A board you share stays a reference.** `.obf` and `.obz` are not picture
  containers, so a board sent to someone else
  carries the names of the symbols, and renders for them only if they hold a
  licence too. The device export is the one file that carries pixels, and it is
  the sideload the licence is for — it goes from your machine to your talker.

Building a talker **for somebody else** is a different question, and a per-person
licence is unlikely to cover it. That is not about the device: it would be the
same answer for printed cards. If you get there, ask
[the publisher](https://www.metacom-symbole.de) first.

Without your own METACOM licence none of this applies — the feature simply does
not work, and ARASAAC covers the whole device on its own.
