# Compiling the firmware and getting it onto the device

## Firmware

`firmware/vorlaut/vorlaut.ino`, Arduino framework.

The sketch lives in a subfolder of its own, because Arduino requires the folder
to have the same name as the `.ino` file — and because the LittleFS uploader
looks for `data/` right next to it. Both point at the same structure.

### What is needed

- **Arduino ESP32 Core 3.x** (board: *Adafruit Feather ESP32-S3 No PSRAM*)
- Libraries: `Adafruit GFX Library`, `Adafruit ST7735 and ST7789 Library`,
  `WiFiManager`
- `mklittlefs` and `esptool` for the file area — both come with the ESP32
  core, `build.py --fs-image` finds them by itself

Board setting: USB CDC On Boot **enabled**.

### Getting it onto the device

These are two separate things that go into separate flash areas: the
**program** (the sketch) and the **data** (images and sounds). If only a word
or a symbol changes, the program does not have to be reflashed — steps 3 and 4
are enough then.

**For a first flash from a release, steps 3 and 4 can be skipped.** The
ready-made image under 2a carries the example content already, so the device
speaks as soon as it starts: one set with *Ja!*, *Nein!*, *Stopp* and *Hilf
mir*. That is there so the very first flash can be checked on its own — if the
keys speak, the partition scheme, the file system, the audio path and the
displays are all right. Your own content comes afterwards, through steps 3
and 4 or over Wi-Fi.

**1. Find the port.** Plug in the Feather over USB-C, then:

```bash
arduino-cli board list
```

You are looking for something like `/dev/cu.usbmodem1101`. Use that port below
wherever `/dev/cu.usbmodemXXXX` appears.

**2a. Without Arduino: take a ready-made image.**

Under [Releases](https://github.com/SteffiPeTaffy/vorlaut/releases) every tag
carries a finished `vorlaut.ino.merged.bin`. That is the convenient route: an
ordinary link, no GitHub account needed, and it stays put.

Whoever needs the very latest state of `main` gets it from *Actions*: the
*Firmware build* workflow attaches the image as the artifact `firmware`. That
requires signing in, and after 90 days it is gone. **That one is the program
only** — the example content is merged in by the release workflow, not by the
CI build.

`vorlaut.ino.merged.bin` from a release contains bootloader, partition table,
program and the example content in a single file, written at address 0:

```bash
esptool --chip esp32s3 --port /dev/cu.usbmodemXXXX write-flash 0x0 vorlaut.ino.merged.bin
```

That needs neither the Arduino core nor the libraries — only esptool. The
partition scheme is already inside the image, so it cannot be set wrongly
either.

> **The image is 8 MB and covers the whole flash**, file area included. On a
> device that already carries your content it replaces it with the example.
> To update only the program and leave the content alone, write the app on its
> own — the release carries it as `vorlaut.ino.bin`, and `0x10000` is where
> `app0` starts:
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

**3. Pack the data:**

```bash
.venv/bin/python build.py --fs-image
```

**4. Write the data** — step 3 prints the command with the full path:

```bash
~/Library/Arduino15/packages/esp32/tools/esptool_py/*/esptool \
  --chip esp32s3 --port /dev/cu.usbmodemXXXX \
  write-flash 0x670000 firmware/vorlaut/littlefs.bin
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

### How the image comes about

`build.py --fs-image` packs `firmware/vorlaut/data/` with `mklittlefs` into an
image of 1536 KiB — exactly the size of the `spiffs` partition. If the data
does not fit, it stops with a clear message instead of producing an oversized
image.

The image itself is gitignored: it is recreated from `data/` in seconds.

**Into one file:** `build.py --merge-into IMAGE` writes that image into a
whole-flash image at `0x670000`, which is what the release workflow does with
`vorlaut.ino.merged.bin`. It works because `arduino-cli` already pads that file
out to the full 8 MB — the file area is in there, as 1536 KiB of `0xFF`, and
filling it in changes nothing around it. The offset lives in `build.py` next to
`FS_SIZE`, so it is written down once and both paths use the same number.

It refuses if that range is not blank. Then either the partition scheme is a
different one or the program has grown into it, and writing anyway would
produce an image that flashes cleanly and boots wrong — which is the one
failure the whole arrangement exists to avoid.

**Where the sound in the release comes from:** the four example sentences are
in the repo, already spoken, under `example/speech/`. So the release can build
content with sound without an Azure key, and so can a fresh clone —
`ensure_content()` copies them into the TTS cache along with the example
layout. The file name is the fingerprint of the text and the voice
configuration, so changing the voice makes them stop matching;
`tests/test_example_speech.py` is what notices, and
`build.py --require-audio` turns a silent key from a warning into a failed
build. See [`example/speech/LIZENZ.md`](../example/speech/LIZENZ.md) for where
that recording comes from.

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

Tested with ESP32 core 3.3.11, Adafruit GFX 1.12.0, ST7735 1.11.0,
WiFiManager 2.0.17: 1288 KB program (39 % of 3 MB), 82 KB RAM (25 %).

Wi-Fi is what makes that big — without it the sketch was 472 KB. The 3 MB app
partition still has room to spare, but it is worth knowing where it went.

The file area holds 1536 KiB. A full layout with five sets takes around
630 KiB of that, so a good 40 %.

> The sketch **compiles** but has never run on real hardware. Check the pin
> assignment against the actual boards before the first flash.

### Behaviour

- **Awake:** all five displays are on continuously. She has to be able to see
  what is on offer.
- **Keys 1-4:** the corresponding WAV is played.
- **Key 5:** next set (1→2→3→4→5→1), all displays are redrawn. The current set
  survives sleep.
- **After `sleep_timeout_seconds` without input:** displays off, deep sleep.

### Menu

**Hold the set key and key 2 together for five seconds.** Those two sit
diagonally furthest apart — hard to hit at the same time with a child's hand.
While holding, all displays count down; letting go cancels without anything
happening.

In the menu the keys label themselves. Currently:

| Key | |
|---|---|
| 1 | **Info** — number of sets, is the file system there |
| 2 | **Fetch content** — bring up Wi-Fi and sync with the web interface |
| 3 | **new Wi-Fi** — open the setup portal and teach it another network |
| Set | **back** to normal operation |

The rest stay empty. Entries appear once the function behind them exists.

### Fetching content

**Wi-Fi is off during normal use.** The device wakes on a key press and has to
speak immediately; bringing up a radio on every wake would cost seconds and
most of the battery, for something that is needed once a week at most. So it
comes up only when somebody asks for it here, and goes off again straight
afterwards.

**Setting up is its own key.** `new Wi-Fi` opens the portal: join the network
**"vorlaut einrichten"** with a phone and enter the Wi-Fi and the key from
`VORLAUT_DEVICE_TOKEN`. Both are kept in NVS and survive a reflash. The portal
gives up after three minutes — a device stuck in a portal no longer speaks.

What is entered there does not replace what is stored: the network joins the
list, so home and the grandparents' both keep working. Press `new Wi-Fi` again
at the next place.

**The address of the computer is not asked for.** Once the Wi-Fi is up the
device shouts one UDP packet into the network and takes the answer, so a new
address from the router changes nothing and the same device works in another
household. That takes about a second, with `searching` on the displays. The
portal keeps a field for an address anyway, for the networks that swallow
broadcasts — filled in, it beats the search. The whole of it is in
[software.md](software.md).

`Fetch content` never opens the portal. It used to, whenever it found no
network, and while the device stood in one place that was the same thing as
setting it up. It is not the same thing for a talker that travels: an access
point that stays up for three minutes in the middle of a kindergarten, because
somebody pressed the wrong key, is exactly what must not happen. Without a
known network it now says `no Wi-Fi` and is back in the menu in a few seconds.

While it runs, all five displays show the same thing: `Wi-Fi`, then `loading`
with a count, then `done` with the number of files. On failure they show
`failed` and, underneath, the reason in one word:

| | |
|---|---|
| `no Wi-Fi` | the network was not reached, or the portal timed out |
| `no server` | nobody answered the search, and nothing was remembered or typed in |
| `wrong key` | the key does not match `VORLAUT_DEVICE_TOKEN` |
| `shut` | no key set on the server, so the endpoints answer 503 |
| `no answer` | nothing at that address — usually the editor is not running, or this is a network it is not on |

The serial monitor gets the same in a full sentence. The one-word version
exists because the alternative is fetching a USB cable to find out that a
character is missing from a key that was typed on a phone.

New content is loaded straight after a successful sync, so the device shows it
without a restart.

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

### Several networks

The talker goes to kindergarten, to the grandparents, on holiday. It stores
**four networks**, most recently used first; a fifth pushes out the one nobody
has connected to for longest. Every trip through `new Wi-Fi` adds one, it does
not replace what is there — home keeps working after the grandparents' has
been added.

The ESP32 itself remembers exactly one network and WiFiManager hands it
exactly one, so the list lives in
[`networks.h`](../firmware/vorlaut/networks.h), next to the address of the
computer. Connecting scans first and takes the strongest network it knows out
of the ones really in the air — at home that is home, at the grandparents'
theirs, and neither needs a decision from anybody. A network that is somewhere
else costs nothing: it is not in the scan.

**Where the editor is not, nothing happens.** The address of the computer is
one setting, not one per network, so away from home the sync usually finds
nobody at it. That is a no-op and not a fault: the reason word appears for a
few seconds, the device goes back to being a talker, and everything it can
already say it can still say — the content is on the file system, not on the
network. Connecting is bounded (a scan plus one attempt), and so is reaching
the computer (four seconds), so the whole detour costs seconds rather than the
minute the defaults would take.

### Waking up

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
