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
  folder to image is the one *Write the build into a folder* writes - in the
  `⋯` beside the Sammlung's name in the editor.

Board setting: USB CDC On Boot **enabled**.

## The loader page can do it, if a release exists

[The loader page](https://talker.lautstark.tech/) writes the firmware as well
as the content — [ADR 0017](../adr/0017-the-loader-page-writes-the-firmware.md).
Under *The firmware on the device* it says which build it carries, asks the
talker which build **it** carries, and offers to write one of two things: the
whole image for a device that answers nothing, or the program alone for one
that is only behind, which leaves the content where it is.

Three things it needs, and the first is the one that decides: **there has to be
a `v*` release**, because the deploy takes the image from the newest one and
this repository has cut none yet — until then the section is not there at all.
Then Chrome or Edge, because it is WebSerial like the cable. And the board has
to be put into write mode by hand: **hold BOOT, tap RESET, release BOOT**, and
then choose the port that has just appeared. That last one is not a rough edge
waiting to be smoothed — the Feather's USB is the S3's own, so entering the
bootloader makes the old port disappear and a new one appear, and the ADR's
last section is about why a page that promised one press would be worse.

What follows is the command line, which is the general answer: it works in
every browser, on a machine with no network, and for a board that is not this
one.

## Getting it onto the device

These are two separate things that go into separate flash areas: the
**program** (the sketch) and the **data** (images and sounds). If only a word
or a symbol changes, the program does not have to be reflashed — steps 3 and 4
are enough then.

**Steps 3 and 4 are the rare route, not the normal one.** Content reaches a
device over the cable: the editor exports the collection as a file, the loader
page checks it, compiles it, connects and sends — [cable.md](cable.md) — and
nothing here has to be done for it. What is below is for the case where
that is not available: a file area written straight from a computer.

**A device flashed from a release comes up empty**, showing *no content* on
all five displays, and that is correct rather than a fault. The image used to
carry four example sentences so the very first flash could be checked on its
own — `build.py` rendered them into the file area — and that went with the
Python build: the build runs in a browser now, and a workflow cannot press a
button in one. This sentence used to send readers to "the release notes of any
tag from v0.2 on", which was a place that has never existed: `v0.4` is the
first firmware release this repository has published, and the numbers below it
were never cut here. What an empty first flash still shows is most of it —
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

Under [Releases](https://github.com/Lautstark/vorlaut-diy-talker/releases) every tag
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
> it — and gets it back by sending the same exported file again. To update only the
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
with the ESP32 core, and the folder to pack is the one *Write the build into
a folder* writes - in the `⋯` beside the Sammlung's name in the editor:

```bash
~/Library/Arduino15/packages/esp32/tools/mklittlefs/*/mklittlefs \
  -c <the folder> -b 4096 -p 256 -s 7208960 littlefs.bin
```

`7208960` is 7040 KiB, the size of the `spiffs` partition. It is written down
in exactly one place — the `spiffs` line of
[`firmware/vorlaut/partitions.csv`](../firmware/vorlaut/partitions.csv) — and
the firmware does not carry a copy of it: it asks `LittleFS.totalBytes()`, and
the cable's `hello` says what that answered. So this number here is the only
one that has to be kept in step by hand, and an image built with the wrong one
does not mount. The block and page sizes are what the ESP32 core's
LittleFS is built with; with different ones the image mounts as empty.
`mklittlefs -l` on the result lists what went in, which is worth a look before
writing it.

**4. Write the data:**

```bash
~/Library/Arduino15/packages/esp32/tools/esptool_py/*/esptool \
  --chip esp32s3 --port /dev/cu.usbmodemXXXX \
  write-flash 0x120000 littlefs.bin
```

The address `0x120000` is the start of the `spiffs` partition in
[`partitions.csv`](../firmware/vorlaut/partitions.csv). It was `0x670000` for
as long as the board's `default_8MB` scheme was in use, and a device still
carrying that older table wants the old address — with the wrong one of the two
the data lands in the wrong place, silently.

**Reading along with what the device says:**

```bash
arduino-cli monitor -p /dev/cu.usbmodemXXXX -c baudrate=115200
```

At start-up it says which set was loaded, which key was pressed and whether
LittleFS could be mounted.

## The flash layout, and the one flash that has to be whole

The table is [`firmware/vorlaut/partitions.csv`](../firmware/vorlaut/partitions.csv),
in the sketch folder, and the ESP32 core prefers it over whatever the FQBN's
`PartitionScheme` names. 8 MB of flash, divided:

| | at | size | |
|---|---|---|---|
| `nvs` | `0x9000` | 20 KiB | the volume, and nothing else — `loadVolume()` |
| — | `0xe000` | 8 KiB | no partition. `boot_app0.bin` is written here anyway, see below |
| `app0` | `0x10000` | 1024 KiB | the program, which is 482 KiB of it |
| `coredump` | `0x110000` | 64 KiB | what the panic handler writes |
| `spiffs` | `0x120000` | **7040 KiB** | the file area. LittleFS, despite the name |

**It was the board's `default_8MB` until 2026-08-31, and the file area was
1536 KiB.** That scheme is an OTA layout: two app slots of 3264 KiB so that a
program arriving over the air can be written into the one that is not running,
and an `otadata` saying which of the two is current. This device has had no
radio since 2026-08-23, and a program only ever arrives over the cable in the
bootloader, which writes `app0` directly. So `app1` and `otadata` were 3272 KiB
that nothing could reach, and `app0` was 3264 KiB for a 482 KiB program. Both
went to the file area. [ADR 0018](../adr/0018-the-file-area-takes-the-ota-slot.md)
is the decision, and what it costs.

**The name `spiffs` is not a leftover to tidy up.** `LittleFS.begin()` looks a
partition up by that name and does not care what file system is on it; a table
that called it `littlefs` would mount nothing and the device would come up with
black displays. The board's own default calls it `ffat`, which is the same
failure — [bring-up.md](bring-up.md) says so from the other end.

**`boot_app0.bin` still gets written to `0xe000`,** by the core's upload recipe
and into every merged image, although no partition covers that address any
more. It is 8 KiB and it lands in the gap between the end of `nvs` and the
start of `app0`, where nothing reads it. That gap is why `nvs` stays 20 KiB
rather than growing to fill the space `otadata` left: an upload would write
over the end of it.

### This one takes a whole flash, once

**A partition table cannot be sent down the cable, and it does not come with a
program-only update.** It is at `0x8000`, the program is at `0x10000`, and both
routes that write only the program — `write-flash 0x10000 vorlaut.ino.bin`, and
the loader page when the talker answers — leave whatever table the device
already has exactly where it is. A talker flashed before this change and
updated that way keeps a 1536 KiB file area, keeps `app0` at 3264 KiB, and
works: the program is the same program and it asks the partition table how big
the file area is. It simply never gets the room.

To actually get it, the whole image has to go on once, and **this is the
`esptool` line rather than the page**:

```bash
esptool --chip esp32s3 --port /dev/cu.usbmodemXXXX write-flash 0x0 vorlaut.ino.merged.bin
```

The page cannot do this one. It offers the whole image only where nothing
answered — a board with no firmware on it — and the program alone to a talker
that answers, which is [ADR 0017](../adr/0017-the-loader-page-writes-the-firmware.md)'s
design and a good one for every case but this: writing everything is the case
that costs somebody their content, so it is not what a device that is merely
behind gets offered. A talker already running this firmware always answers.

**Writing the whole image erases the content**, because the file area is inside
it and it is erased there — the same as any whole flash, and the content comes
back by sending the collection again from the editor. It also takes the volume
setting with it, since `nvs` is inside the image too.

The first start afterwards is slower than usual and the displays stay dark for
it: `LittleFS.begin(true)` finds an erased partition and formats it, and it is
now formatting 7040 KiB rather than 1536. Nobody has timed it on hardware.

## What is in the images, and what is not

`arduino-cli compile --output-dir` produces both of them. `vorlaut.ino.bin` is
the program; `vorlaut.ino.merged.bin` is the whole flash — bootloader,
partition table, program, and the file area padded out as 7040 KiB of `0xFF`.

**Nothing fills that area in.** `build.py --fs-image` and `--merge-into` used
to, packing `firmware/vorlaut/data/` with `mklittlefs` and writing it into the
merged image at the file area's address so a release could ship content. Both went with the
Python: the build runs in a browser now, and no workflow can press a button in
one.

So the file area arrives erased, and **the firmware formats it on the first
start** — `LittleFS.begin(true)` in `vorlaut.ino`. That is what makes a
program-only image usable at all: a partition that will not mount is a device
the cable cannot write to either, and the cable is the only way content gets
on. A build that did not pick up `partitions.csv` still fails, because then
there is no `spiffs` partition to format.

The four example sentences are still in the repo, already spoken, under
[`example/speech/`](../example/speech/) — see
[`LIZENZ.md`](../example/speech/LIZENZ.md) for where the recordings come from.
Nothing on the release path reads them any more; they are example content for
somebody starting a board, not payload for an image.

Compiling:

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/vorlaut
```

> **The partition scheme is still not optional, even though the table is
> ours.** `firmware/vorlaut/partitions.csv` overrides whatever the FQBN names,
> but only for a build that reaches the ESP32 core's prebuild hook — and the
> scheme is still what arduino-cli compares the sketch's size against. Leaving
> `PartitionScheme=` off picks the board's default, *tinyuf2*, which brings a
> bootloader of its own and writes it over the file area. In the Arduino IDE
> set *Tools > Partition Scheme* to **"Default (3MB APP/1.5MB SPIFFS)"**, on
> the command line append `PartitionScheme=default_8MB`. The name is a
> leftover either way: what it selects is a `default_8MB.csv` that is copied
> in and then immediately overwritten by ours.

Tested with ESP32 core 3.3.11, Adafruit GFX 1.12.0, ST7735 1.11.0, measured
again on 2026-08-31: **482 KiB program (47 % of `app0`'s 1024 KiB), 107 KiB of
static RAM (33 %)**.

It was 1304 KB and 82 KB while the Wi-Fi path was compiled in, and this
document said so, with a note that the radio was what made it big — the sketch
without it had been measured at 472 KB. Removing it landed almost exactly
there. Two of the three numbers have moved since, for different reasons. The
percentage moved because `app0` did: 3264 KiB under the board's scheme, 1024
KiB under ours, still a shade over twice what the program needs. **The RAM
figure moved because the sketch did** — it stood at 58 KB here and the same
build now measures 107 KiB. That has nothing to do with the partition table;
it was simply not measured again for a while.

The file area holds 7040 KiB. A full layout with five sets takes around
630 KiB of that, so under a tenth. The device has room for 64 sets since
2026-08-31 ([ADR 0020](../adr/0020-every-key-says-what-it-does.md)), and it is
the file area rather than the set count that runs out first: a set whose keys
share nothing with any other — a round of the joining game — costs near 190 KiB,
so the partition holds somewhere between thirty-five and forty of those.

> The sketch has **run on real hardware**: flashed, fed a board over the cable
> and heard, first on 2026-08-27. Check the pin assignment against your own
> boards before the first flash anyway — that is the part which is about your
> soldering rather than about this sketch, and
> [bring-up.md](bring-up.md) takes it apart one stage at a time.

## Behaviour

- **Awake:** all five displays are on continuously. She has to be able to see
  what is on offer.
- **Every key, all five:** what it does is in `layout.bin` — it says its own
  word, or says it and then goes to another set, or goes without saying
  anything. The current set survives sleep.
- **After `sleep_timeout_seconds` without input:** displays off, deep sleep.

### What a key does, and where it goes

There is no fifth key that is special any more. Since `layout.bin` version 3
every key of a set carries two things — what it **does** and which set it
**goes to** — and the set key is a key like the other four, with a picture, a
word and a target of its own. The ring the firmware used to compute (1→2→3→4→5→1)
is what a talker's builder writes into those targets; nothing in the sketch
adds one.

That matters because of what the device is for. A **joining game** is a set per
round: the set key shows a tile split down the diagonal with the two halves of
a compound word on it and says them out loud, and one of the four keys below
carries the word those halves make. The right key is not marked as right
anywhere — **it is simply the only key on the board that goes anywhere.** The
other three say their own word and the board stays put, and there is no round
counter, no score and no way to be stuck: whatever is pressed, the device is
still on a board with a way out of it.

Between the word and the next board, three things in this order:

1. **A whole second** after the word has finished. The moment a child works out
   that she was right happens in it, and it is the only thing this device gives
   back for getting it right. 200 ms would be enough to look smooth and would
   land the next board while she is still listening.
2. **Wait until she has let go.** Her finger is still on the key that did it,
   and drawing the next round underneath it puts a different picture beneath a
   finger that has not moved.
3. **Then 400 ms in which nothing is heard at all** — a press made in it is
   thrown away rather than answered late. A finger bouncing back, or a second
   press meant for the board that has gone, must not answer the new one.

The numbers and that order are in
[`key_press.h`](../firmware/vorlaut/key_press.h) rather than in the sketch, so
that `device/fixtures/press.expected.json` can hold the device to them —
`vorlaut.ino` is the one file no test can include. `device/fixtures/layout/four-rounds`
is a whole small game walked press by press from both ends.

**There is deliberately no gesture to skip a round.** With four answers on the
board, trying is what gets a child through, and the only hidden gesture this
device has is the menu.

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
needed first. The keys wear a grey frame, which a talker key has
none of, so one sees at a glance that this is not the talker.

**After 30 seconds without input it returns by itself.** A device stuck in the
menu no longer speaks — that must not happen.

## Waking up

Any of the five keys wakes the device (EXT1 on all button pins).

**The press that wakes it triggers nothing** — no word, no switching. It only
brings the displays back. After that the firmware waits until the key has been
released before reacting to input again. Otherwise the device would speak a
word she never meant to say: with dark displays she is pressing blind.

Debouncing works through a minimum press duration: **80 ms** for the speech
keys, **400 ms** for the set key (`DEBOUNCE_MS` and `SET_HOLD_MS` in
[`key_press.h`](../firmware/vorlaut/key_press.h), which is where they moved
from the sketch so that a test could read them). The set key needs longer
because an accidental switch takes away the word she was about to say — she
then has to find her way back first. That is more annoying than hitting the
wrong word, and it is the same worry the 400 ms of deafness after a board
change answers from the other side.
