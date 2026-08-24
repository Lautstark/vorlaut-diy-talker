# Bring-up in stages

Solder everything together, flash it, and if nothing works you have eight
possible causes at once: panel profile, offset, CS assignment, button pins,
I2S, amplifier, backlight, partition scheme.

Staggered, it is one at a time. Each stage is a small sketch under
`firmware/tests/` that checks exactly one thing and says in the serial monitor
what to look out for.

They all use the same `pins.h` as the real firmware — otherwise you end up
checking something other than what will later be running.

```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/tests/test1_board
arduino-cli upload -p /dev/cu.usbmodemXXXX --fqbn esp32:esp32:adafruit_feather_esp32s3_nopsram:PartitionScheme=default_8MB firmware/tests/test1_board
arduino-cli monitor -p /dev/cu.usbmodemXXXX -c baudrate=115200
```

**These three lines are the same at every stage.** Only the last path segment
changes — `test1_board`, then `test2_display`, and so on down the page. They
are not repeated below: scroll back up here and edit that one word.

---

**Solder as you go, not all at once.** Every stage adds one thing to what the
stage before it needed: the Feather on its own for stage 1, display 1 for
stage 2, the other four for stage 3, the buttons for stage 4, amplifier and
speaker for stage 5, nothing further after that. Wiring the lot up front puts
back exactly the eight causes at once that these stages exist to take apart.

## Stage 1 — Is the board alive?

`test1_board` — the Feather alone, nothing connected.

The red LED blinks once a second, a line runs through the monitor every two
seconds. If that does not work, there is no point looking at the wiring yet.

If the monitor stays silent: *Tools > USB CDC On Boot* to **Enabled** — that
is the Arduino IDE. With `arduino-cli` that setting is already the default for
this board, so look at the port instead: the S3 re-enumerates when it resets
and can come back under a different `/dev/cu.usbmodem…`. `arduino-cli board
list` says which one it is now.

## Stage 2 — One display

`test2_display` — connect display 1 only, CS on D11.

This is where the **two unknowns that cannot be worked out on paper** get
settled:

- **Panel profile.** It shows red, green, blue in turn and names each one in
  the monitor as it sends it, so there is something to hold the panel against.
  If red appears as blue, the colour channels are swapped — then try a
  different `initR` variant. Trying one costs no edit: add `--build-property
  "compiler.cpp.extra_flags=-DPANEL_INITR=INITR_BLACKTAB"` to the compile
  line. Once a variant is right, that is the answer — write it into
  `PANEL_INITR` in `pins.h`, which is where stages 3 and 4 and the real
  firmware read it from. Until it is written there they all keep using the
  default, and stage 3 will look like a CS fault.
- **Inversion.** A swap is not the only way colours come out wrong, and it was
  not the way these panels did. If every colour shows as its own *complement*
  — red as cyan, green as violet, blue as yellow — nothing is swapped: the
  panel is an IPS type that wants `INVON`, and the library's init sequence
  sends `INVOFF`. That is `PANEL_INVERT` in `pins.h`, and it is **1** for the
  real ScreenKeys, settled on hardware on 2026-08-22. It hides the offset
  check as well, because an inverted black background is white and the white
  border on it is black — so there is no border to judge until this is right.
- **Offset.** After that a white border exactly at the outermost edge, with a
  coloured square in every corner and a crosshair. If the border is equally
  wide all round and all four corners are complete, `PANEL_COL_OFFSET` and
  `PANEL_ROW_OFFSET` in `pins.h` are right. If something is missing at the top
  or left and a strip remains at the bottom or right, adjust them there. The
  calculated 2 and 3 turned out to be correct on hardware — border even all
  round, all four corners whole — so they are measured now, not guessed.

If it stays black: check CLK, DIN, DC, RST and the power supply.

## Stage 3 — All five

`test3_displays` — only once stage 2 ran cleanly.

Each display permanently shows its number on its own colour: **1 red, 2 green,
3 blue, 4 yellow, S violet**. The arrangement has to match the drawing in
[hardware.md](hardware.md) — 1 and 2 on top, 3 and 4 below, S on the left under
the speaker.

If it does not match, the CS lines are swapped. Resolder or change the order in
`pins.h`; both are right, they just have to agree.

- One display black → its CS line.
- All black although stage 2 ran → usually RST or the power supply.
- **Which way up is each one?** Not the same question as which number is
  where. Five panels can each show their own number in the right place with
  one of them mounted a half turn out, and nothing above would notice. The
  numbers are drawn upright, so a turned panel is obvious once looked for -
  and `PANEL_TURN` in `pins.h` is where the answer goes, per display.

### What the first real run found, 2026-08-24

**Display 4 was dark and the Feather was innocent.** Swapping the CS wires at
the board between `D5` and `D6` moved which pin drove which panel, and the
darkness stayed with the panel - so the fault was in its own wiring, not the
GPIO. Driving it alone with stage 2 and `PANEL_INDEX=3` showed it backlit but
never initialised: powered, lit, receiving nothing. Reflowing its joints fixed
it. Both those tools exist because of this.

**And the stage lied about it twice**, which cost more than the fault did. It
drew once in `setup()` and then sat in `delay(1000)`, and a panel keeps its
picture in its own memory - so two correct wire swaps in a row looked like
nothing had changed, and the search went off in the wrong direction. It
redraws every three seconds now. Before touching a wire, check that something
is actually redrawing; a still picture and a dead bus look identical.

## Stage 4 — Buttons

`test4_buttons` — each display shows its own button: dark = open, green =
pressed.

- Does pressing light up the display of **that same** key? If another one
  reacts, KEY and CS lines are sorted differently.
- Does one not react at all → KEY line and GND.
- Do all react at once → GND is probably missing.
- If one permanently shows "pressed" without anyone touching it, the input
  sits hard on GND.

### What the first real run found, 2026-08-24

Passed first time, and worth saying how it was checked: the sketch prints
every press with its GPIO, so the serial log is the answer rather than five
opinions about what lit up. Pressed in physical order 1, 2, 3, 4, set, the
board saw GPIO 18, 17, 16, 15, 14 in that order - one press, one release, no
bursts. That clears three faults at once: no crossed wires, no stuck input,
no contact bounce.

**Count your presses.** Reading a log of ten presses proves ten registered; it
says nothing about whether you made twelve. That gap wasted an evening later
on, and one key pressed a known number of times is what closed it.

## Stage 5 — Sound

`test5_sound` — 440 Hz for two seconds, then a sweep from 200 to 2000 Hz, over
and over until you pull the plug.

**A pass is a clean 440 Hz at a usable volume and a sweep that runs through
without breaking up.** The last two questions below are not pass conditions: a
click at switch-off is fixed in the firmware, not in the wiring, and the low
limit is a measurement. Neither of them holds up stage 6.

- Does anything come out at all? Otherwise check BCLK, LRC, DIN, the supply
  and especially **SD** — if that sits LOW it stays silent.
- Is it distorted? Then the level is too high or the supply too weak.
- **Where does the sweep get thin?** That is the lower limit of the speaker.
  It matters because the device has no volume control: what comes out is what
  comes out.

### What the first real run found, 2026-08-22

The sweep ran through cleanly with no thinning anywhere between 200 and
2000 Hz — but on a bare driver, not one in its chamber, so it is not the
figure `hardware.md` is waiting for. Two other things came out of it.

**The stage was driving the tone far too hard.** At amplitude 0.5 it is about
7 dB above where normalised speech sits, and the first person to hold the
speaker said so immediately. It is `AMPLITUDE` in the sketch now, at 0.22, so
the stage sounds like the device instead of like a test. At the corrected
level the volume was judged right for a talker a child holds — which means the
loudness was the test, and the MAX98357A's gain needs nothing done to it.

**The click is the I2S stream running dry, not the amplifier.** This is worth
setting out at length, because the amplifier is the obvious suspect, this
document used to name it, and it is wrong.

A phone recording of the loop settles it. The tone body sits at a rock-steady
−25.3 dBFS — no distortion, no dropouts, the audio path is sound. Around it:

| moment | peak | above the tone |
|---|---|---|
| onset of the 440 Hz tone | −11.7 dBFS | +13.6 dB |
| **end** of the 440 Hz tone | −7.4 dBFS | **+18 dB** |
| onset of the sweep | −13.7 dBFS | +14 dB |

The loudest thing in the whole recording is the click at the *end* of the
tone, 18 dB above the tone it follows. And that recording was made with `SD`
held permanently high, so the amplifier's muting cannot be what produced it.

Four things were tried on the bench, in this order:

| change | click |
|---|---|
| reset the sine's phase, so a sound starts at zero | **no difference at all** |
| hold `SD` high instead of switching it per sound | quieter, still clearly there |
| both together | same as holding `SD` alone |
| keep writing silence to I2S in the gaps instead of `delay()` | **much better, only a faint click left** |

So the phase discontinuity — the tidy explanation, and the first one tried —
is not a cause, and no phase reset was kept. The `SD` switching is a real but
secondary contributor. What dominates is that the sketch writes 50 ms of
silence and then sits in `delay(1500)` feeding the bus nothing, so the DMA
underruns between sounds and the discontinuity lands at both edges.

**The firmware has the same gap**, and on a talker it is minutes rather than
1.5 seconds: `playWav()` pushes its silence, drops `SD` and returns, and
nothing writes to I2S until the next key press.

**Judged on 2026-08-24, once stage 7 had run: nothing needs doing.** Nobody
hears it, because the amplifier is switched off across exactly the gaps where
the bus is starving. The underrun is real and inaudible, and the two facts are
the same fact.

That is worth stating as a coupling rather than a fix, because it is the sort
of thing that is rediscovered expensively. **The amplifier may not be held on
until I2S is fed continuously.** Holding it on is otherwise attractive - it
would cure the pop at switch-on, the quiet start to every word while the
MAX98357A comes up, and a fragment cut short being mostly ramp. It was tried
on 2026-08-24 and the device hissed audibly between words. That hiss was this
click, amplified for the first time. Feeding the bus is the price of the
amplifier, and it is not a line moved: `loop()` has several return paths and a
`delay(1500)` in the cable branch, so it means silence written in place of
every wait, or audio on a task of its own.

What was done instead, and was enough: `AMP_WAKE_MS` is 50 ms rather than 5,
so a word no longer starts inside the amplifier's ramp, and the silence after
a word is 96 ms rather than 256. No click, no hiss, and ten presses in ten
speak.

A faint click survived all four bench experiments and was never accounted for.
It has not been heard on the finished device.

## Stage 6 — Content over the cable

No sketch of its own, and that is the point: the real firmware answers a
browser without anything being chosen on the device, so this stage is the
firmware from stage 7 with a cable in it. Flash it, open the editor, press
*Send to the device*. All five displays should show **Kabel** with a count
climbing, and the talker should come back by itself afterwards holding the new
content.

Stages 6 and 7 used to be **Wi-Fi** and **Fetching content** — `test6_wlan`
opened a captive portal and `test7_sync` pulled a manifest off `app.py`. Both
sketches are gone with the radio and the server they talked to. What replaced
them is one wire and [cable.md](cable.md), which has the bench for driving it
without the editor, and the list of what a first run has to show.

### What the first real run found, 2026-08-23

Stage 6 failed on the first file, every time, with `short` — and the word is
misleading enough to be worth writing down. It reads as though the browser
stopped talking, and the device says exactly that. The browser had not: its
console showed all seven chunks of a 26912 byte file written and resolved
inside a second. The bytes were leaving and not arriving.

`Serial.begin()` was being called without `setRxBufferSize()`, so the receive
buffer was the default 256 bytes. USB fills an empty buffer at about 490 KB/s,
and the loop disappears into `file.write()` for up to 60 ms at a time, reading
nothing. Everything landing in that window has nowhere to go, and the interrupt
discards it. CDC cannot report an overflow, so the loss is perfectly silent at
both ends: the browser reports success on every chunk, the device is quietly
short, and four seconds later it blames the browser.

The size is arithmetic, not taste: 490 KB/s against a 60 ms stall is 30 KB
that has to sit somewhere. 16 KB was tried on the way and lost 214 bytes of
26912 — small enough to look like noise, fatal all the same, because a file is
whole or it is not. `CABLE_RX_BUFFER` is 64 KB.

**Three things this stage should be trusted to catch, and did not:**

- **`tests/cable_format.py` passes either way.** It hands `cable.js` a Node
  stream, where every byte written is a byte delivered — there is no buffer to
  overflow in a test harness. Its own closing note says the case is *"not
  coverable without hardware"*, and this was it.
- **`short` names the symptom at the wrong end.** The device knows how many
  bytes it got; it now says so, and `short after 26698 of 26912` is the line
  that turned a guess into arithmetic. A count is cheap and a word is not
  enough.
- **The invented payload's `layout.bin` is 942 random bytes.** A transfer that
  works still ends in `layout.bin unusable (reason 2)` and five displays saying
  no content. That is correct, and it looks exactly like failure. Prove the
  transport with the bench; prove the device with real content from the editor.

## Stage 7 — The real firmware


Only now. The procedure is in [firmware.md](firmware.md).

**Flashed from a release the device comes up empty**, with *no content* on
all five displays. That is correct: the image is the program and nothing else,
and it formats its own file area on the first start. Releases used to carry
four example sentences, which made this stage a check of everything at once;
they went with the Python build. So the sound and the keys are checked here by
sending a board of your own — which is stage 6, and is why it comes first.

Your own content comes afterwards, and it is one press: the editor's *Send to the
device*, which builds the board and pushes it down the cable. There
is nothing to set up first — no network, no portal, no five digits — because
there is nothing to prove to a device you are holding. Stage 6 is that press;
this stage is everything else working at the same time as it.

**"keine Inhalte" on all five displays** means the file area is empty, and
after any flash that is correct rather than a fault — a release, the artifact
from *Actions* and `arduino-cli upload` all carry the program alone. It is only
worth looking into once a transfer has run and the displays still say it. Then
**Info** in the menu is the thing to read: it says whether LittleFS is mounted
at all. If it is not, the partition scheme is the first suspect — the board
default creates the data area as `ffat`, `LittleFS.begin()` wants one called
`spiffs`, and formatting cannot invent a partition that is not there.

Worth trying, and the whole point of the exercise: transfer at the desk, then
take the device somewhere else entirely and use it for an afternoon. Nothing it
does depends on being near a computer — the content is on its own file system,
and there is no longer anything it could try to reach and fail to find.

---

## What to write down along the way

These values are calculated, not measured — all but the last, which had
nothing to calculate from. Whatever turns out differently in stages 2 to 5
belongs back in the repo:

| | where |
|---|---|
| Panel profile and offset | `firmware/vorlaut/pins.h` — `PANEL_INVERT` is 1 |
| Order of the CS and KEY lines | `firmware/vorlaut/pins.h` — both correct as written |
| Which way up each panel is | `firmware/vorlaut/pins.h` — `PANEL_TURN`, all alike |
| Actual component dimensions | `docs/hardware.md`, `tools/wiring.py` |
| Where the sweep goes thin — the speaker's lower limit | `docs/hardware.md` |
