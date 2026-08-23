# Compiling the firmware and getting it onto the device

`firmware/vorlaut/vorlaut.ino`, Arduino framework.

The sketch lives in a subfolder of its own, because Arduino requires the folder
to have the same name as the `.ino` file — and because the LittleFS uploader
looks for `data/` right next to it. Both point at the same structure.

## What is needed

- **Arduino ESP32 Core 3.x** (board: *Adafruit Feather ESP32-S3 No PSRAM*)
- Libraries: `Adafruit GFX Library`, `Adafruit ST7735 and ST7789 Library`
- `mklittlefs` and `esptool` if you want to write the file area from a
  computer — both come with the ESP32 core. Content does not normally go that
  way: the editor pushes it down the cable, see [cable.md](cable.md). The
  folder to image is the one *Device → Write the build into a folder*
  writes in the editor's settings.

Board setting: USB CDC On Boot **enabled**.

## Getting it onto the device

These are two separate things that go into separate flash areas: the
**program** (the sketch) and the **data** (images and sounds). If only a word
or a symbol changes, the program does not have to be reflashed — steps 3 and 4
are enough then.

**Steps 3 and 4 are the rare route, not the normal one.** Content reaches a
device from the editor over the cable, in one press — [cable.md](cable.md) —
and nothing here has to be done for it. What is below is for the case where
that is not available: a file area written straight from a computer.

**A device flashed from a release comes up empty**, showing *no content* on
all five displays, and that is correct rather than a fault. Releases used to
carry four example sentences so the very first flash could be checked on its
own; that went with the Python build, and the reasoning is in the release notes
of any tag from v0.2 on. What an empty first flash still shows is most of it —
the displays, the partition scheme and the file system, the last of these
through **Info** in the menu.

**1. Find the port.** Plug in the Feather over USB-C, then look at what
appeared:

```bash
ls /dev/cu.usbmodem*        # macOS
ls /dev/ttyACM*             # Linux
```

You are looking for something like `/dev/cu.usbmodem1101`. Use that port below
wherever `/dev/cu.usbmodemXXXX` appears. On Windows it is not a path at all:
the Feather turns up in the Device Manager under *Ports (COM & LPT)* as `COM3`
or some other number, and that is what goes in instead.

On Linux the port belongs to the group `dialout` and a fresh account is not in
it — that is the permission error on the first flash, not a broken cable. Add
yourself once with `sudo usermod -aG dialout $USER`, then log out and back in.

Whoever has `arduino-cli` gets the same list with the board name beside it,
which settles which of several ports is the Feather:

```bash
arduino-cli board list
```

**2a. Without Arduino: take a ready-made image.**

Under [Releases](https://github.com/Lautstark/vorlaut/releases) every tag
carries a finished `vorlaut.ino.merged.bin`. That is the convenient route: an
ordinary link, no GitHub account needed, and it stays put.

Whoever needs the very latest state of `main` gets it from *Actions*: the
*Firmware build* workflow attaches the image as the artifact `firmware`. That
requires signing in, and after 90 days it is gone. Both are the program only:
neither carries content, and the two differ in nothing else.

**`esptool` is what writes it**, and on this route nothing else brings it
along. It is a Python program and installs in one line:

```bash
pip install esptool
```

Inside the project's virtual environment that is
`.venv/bin/pip install esptool`, and the command is then `.venv/bin/esptool`.

`vorlaut.ino.merged.bin` from a release contains bootloader, partition table
and program in a single file, written at address 0:

```bash
esptool --chip esp32s3 --port /dev/cu.usbmodemXXXX write-flash 0x0 vorlaut.ino.merged.bin
```

That needs neither the Arduino core nor the libraries — only the esptool from
above. The partition scheme is already inside the image, so it cannot be set
wrongly either.

> **The image is 8 MB and covers the whole flash**, file area included. It
> leaves that area erased, so a device that already carries your content loses
> it — and gets it back in one press from the editor. To update only the
> program and leave the content alone, write the app on its own — the release
> carries it as `vorlaut.ino.bin`, and `0x10000` is where `app0` starts:
>
> ```bash
> esptool --chip esp32s3 --port /dev/cu.usbmodemXXXX write-flash 0x10000 vorlaut.ino.bin
> ```

**2b. Compile and write it yourself:**

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/vorlaut
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/vorlaut
```

If the upload reports that it cannot find the board: hold **BOOT**, tap
**RESET** briefly, release **BOOT**. The Feather then sits in the bootloader
and the command goes through. Press RESET once afterwards.

**3. Pack the data** — only if the cable is not an option. `mklittlefs` comes
with the ESP32 core, and the folder to pack is the one *Device → Write the
build into a folder* writes in the editor's settings:

```bash
~/Library/Arduino15/packages/esp32/tools/mklittlefs/*/mklittlefs \
  -c <the folder> -b 4096 -p 256 -s 1572864 littlefs.bin
```

`1572864` is 1536 KiB, the size of the `spiffs` partition — the same number as
`FS_SIZE` in the firmware. The block and page sizes are what the ESP32 core's
LittleFS is built with; with different ones the image mounts as empty.
`mklittlefs -l` on the result lists what went in, which is worth a look before
writing it.

**4. Write the data:**

```bash
~/Library/Arduino15/packages/esp32/tools/esptool_py/*/esptool \
  --chip esp32s3 --port /dev/cu.usbmodemXXXX \
  write-flash 0x670000 littlefs.bin
```

The address `0x670000` is the start of the `spiffs` partition from
`default_8MB.csv`. It holds for this partition scheme only — with a different
one the data lands in the wrong place.

**Reading along with what the device says:**

```bash
arduino-cli monitor -p /dev/cu.usbmodemXXXX -c baudrate=115200
```

At start-up it says which set was loaded, which key was pressed and whether
LittleFS could be mounted.

## What is in the images, and what is not

`arduino-cli compile --output-dir` produces both of them. `vorlaut.ino.bin` is
the program; `vorlaut.ino.merged.bin` is the whole flash — bootloader,
partition table, program, and the file area padded out as 1536 KiB of `0xFF`.

**Nothing fills that area in.** `build.py --fs-image` and `--merge-into` used
to, packing `firmware/vorlaut/data/` with `mklittlefs` and writing it into the
merged image at `0x670000` so a release could ship content. Both went with the
Python: the build runs in a browser now, and no workflow can press a button in
one.

So the file area arrives erased, and **the firmware formats it on the first
start** — `LittleFS.begin(true)` in `vorlaut.ino`. That is what makes a
program-only image usable at all: a partition that will not mount is a device
the cable cannot write to either, and the cable is the only way content gets
on. A wrong partition scheme still fails, because then there is no `spiffs`
partition to format.

The four example sentences are still in the repo, already spoken, under
[`example/speech/`](../example/speech/) — see
[`LIZENZ.md`](../example/speech/LIZENZ.md) for where the recordings come from.
Nothing on the release path reads them any more; they are example content for
somebody starting a board, not payload for an image.

Compiling:

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/vorlaut
```

> **The partition scheme is not optional.** The board's default is called
> *tinyuf2* and creates the data area as `ffat` — but `LittleFS.begin()` looks
> for a partition named `spiffs` and fails on it. The device then boots with
> black displays. In the Arduino IDE set *Tools > Partition Scheme* to
> **"Default (3MB APP/1.5MB SPIFFS)"**, on the command line append
> `PartitionScheme=default_8MB`.

Tested with ESP32 core 3.3.11, Adafruit GFX 1.12.0, ST7735 1.11.0:
**467 KB program (14 % of 3 MB), 58 KB RAM (18 %)**.

It was 1304 KB and 82 KB while the Wi-Fi path was compiled in, and this
document said so, with a note that the radio was what made it big — the sketch
without it had been measured at 472 KB. Removing it landed almost exactly
there. The 3 MB app partition now has a great deal of room to spare.

The file area holds 1536 KiB. A full layout with five sets takes around
630 KiB of that, so a good 40 %.

> The sketch **compiles** but has never run on real hardware. Check the pin
> assignment against the actual boards before the first flash.

## Behaviour

- **Awake:** all five displays are on continuously. She has to be able to see
  what is on offer.
- **Keys 1-4:** the corresponding WAV is played.
- **Key 5:** next set (1→2→3→4→5→1), all displays are redrawn. The current set
  survives sleep.
- **After `sleep_timeout_seconds` without input:** displays off, deep sleep.

## Menu

**Hold the set key and key 2 together for five seconds.** Those two sit
diagonally furthest apart — hard to hit at the same time with a child's hand.
While holding, all displays count down; letting go cancels without anything
happening.

In the menu the keys label themselves. Currently:

| Key | |
|---|---|
| 1 | **Info** — number of sets, is the file system there |
| Set | **back** to normal operation |

The other three stay dark. They were *Fetch content*, *new Wi-Fi* and *Pair*,
and all three went with the radio: content arrives over the cable now, and
nothing about that is chosen here. A transfer can start while the menu is open
or closed — the device answers a browser either way.

## Fetching content

Over the cable, and there is nothing to choose on the device: the browser
starts talking and the device answers. [cable.md](cable.md) is the whole of it.

While a transfer runs, all five displays show `cable` with a count climbing,
and `done` with the number of files at the end. **Holding the set key stops
it** — the same 400 ms as everywhere else. A transfer that is interrupted, by
that key or by the cable coming out, leaves a fragment under `/.part` and never
a half-written file under a real name.

New content is read in as soon as the browser says it has finished, so the
device shows it without a restart.

There was a page and a half here about the other way: bringing up Wi-Fi,
finding the computer with a UDP broadcast, five digits on the displays to prove
somebody was standing in front of the device, a token in NVS, and seven
one-word reasons a sync could fail. None of it exists any more —
[software.md](software.md#how-content-reaches-the-device) says what it was and
why it went.

All of those labels sit in [`texts.h`](../firmware/vorlaut/texts.h), one table
per language, and the device picks one by the `language` field from
`layout.bin`. English is the default and the fallback — an empty device shows
English, because the language comes from the content and an empty device has
none.

**Nine characters per line, two lines.** Text size 2 is 12 pixels per
character and a display is 128 wide; anything longer is drawn past the edge.
`tests/test_texts.py` checks every entry against that, so a translation that
does not fit fails on the computer.

**Not every letter can be drawn.** The built-in font is not Unicode: it draws
one byte as one glyph, using code page 437. `panel_text.h` translates UTF-8
into it — that covers the western European accents, so `ä ö ü ß é à ñ ç` are
fine, but `ł ő ş` and anything Cyrillic are not. Those need a font of their own
(a `GFXfont`), which is a separate job. The test reports what is missing rather
than letting a question mark appear on the device.

The menu draws itself without files, from text and rectangles. So it works on a
freshly flashed device with nothing on it yet — and that is exactly where it is
needed first. The frame is grey instead of the set colour, so one sees at a
glance that this is not the talker.

**After 30 seconds without input it returns by itself.** A device stuck in the
menu no longer speaks — that must not happen.

## Waking up

Any of the five keys wakes the device (EXT1 on all button pins).

**The press that wakes it triggers nothing** — no word, no switching. It only
brings the displays back. After that the firmware waits until the key has been
released before reacting to input again. Otherwise the device would speak a
word she never meant to say: with dark displays she is pressing blind.

Debouncing works through a minimum press duration: **80 ms** for the speech
keys, **400 ms** for the set key (`DEBOUNCE_MS` and `SET_HOLD_MS` in the
sketch). The set key needs longer because an accidental switch takes away the
word she was about to say — she then has to find her way back first. That is
more annoying than hitting the wrong word.
