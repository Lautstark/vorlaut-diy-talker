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

---

## Stage 1 — Is the board alive?

`test1_board` — the Feather alone, nothing connected.

The red LED blinks once a second, a line runs through the monitor every two
seconds. If that does not work, there is no point looking at the wiring yet.

If the monitor stays silent: *Tools > USB CDC On Boot* to **Enabled**.

## Stage 2 — One display

`test2_display` — connect display 1 only, CS on D11.

This is where the **two unknowns that cannot be worked out on paper** get
settled:

- **Panel profile.** It shows red, green, blue in turn. If red appears as
  blue, the colour channels are swapped — then try a different `initR`
  variant. The profile can be overridden at compile time with
  `-DPANEL_INITR=INITR_BLACKTAB` without editing the sketch.
- **Offset.** After that a white border exactly at the outermost edge, with a
  coloured square in every corner and a crosshair. If the border is equally
  wide all round and all four corners are complete, `PANEL_COL_OFFSET` and
  `PANEL_ROW_OFFSET` in `pins.h` are right. If something is missing at the top
  or left and a strip remains at the bottom or right, adjust them there.

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

## Stage 4 — Buttons

`test4_buttons` — each display shows its own button: dark = open, green =
pressed.

- Does pressing light up the display of **that same** key? If another one
  reacts, KEY and CS lines are sorted differently.
- Does one not react at all → KEY line and GND.
- Do all react at once → GND is probably missing.
- If one permanently shows "pressed" without anyone touching it, the input
  sits hard on GND.

## Stage 5 — Sound

`test5_sound` — 440 Hz for two seconds, then a sweep from 200 to 2000 Hz.

- Does anything come out at all? Otherwise check BCLK, LRC, DIN, the supply
  and especially **SD** — if that sits LOW it stays silent.
- Is it distorted? Then the level is too high or the supply too weak.
- Does it click when the amplifier is switched on and off? Then lengthen the
  quiet before switching off in the firmware (`TAIL_PAD` in `tts.py`, and the
  silence in `playWav`).
- **Where does the sweep get thin?** That is the lower limit of the speaker.
  It matters because the device has no volume control: what comes out is what
  comes out.

## Stage 6 — Wi-Fi

`test6_wlan` — only needed if the device is meant to fetch content by itself.

Without stored credentials it opens an access point called
**"vorlaut einrichten"**. Connect with a phone, enter network and password;
after that the ESP32 remembers them itself. The serial monitor reports the IP
address and signal strength, then a status line every five seconds.

Switch the network off for a moment: it should report the loss and keep
trying. The setup portal runs into a time limit after three minutes and gives
up — a talker that hangs during setup no longer speaks.

## Stage 7 — Fetching content

`test7_sync` — the sync and nothing else. No displays, no sound, no sleep, so
that a problem here is this one problem and not one of six at the same time.

It needs the key from `VORLAUT_DEVICE_TOKEN` in `.env`, asked for in the same
portal as the Wi-Fi and kept afterwards. **The address it finds by itself:**
one UDP broadcast, and whoever runs `app.py` answers with the port it listens
on — the address is the one the answer came from. The monitor shows the search
before the sync.

If nothing answers, the network is not carrying the broadcast; a guest network
usually does not, and neither does a container behind a bridge network (see
[operation.md](operation.md)). The device then falls back on whatever answered
last time, and the portal still has a field to type an address into, which
beats the search whenever it is filled in. How it all fits together is in
[software.md](software.md).

What should happen: **the first run fetches everything, the second fetches
`layout.bin` only.** That difference is the whole point of the design — the
file names are hashes of their input, so anything already there can stay. If
the second run fetches everything again, the fault is on the device side; the
server side has been played through by `tests/test_device_sync.py` since before
this sketch existed.

Worth trying while you are here: switch a set off in the web interface,
release, sync again. The device should delete the files that fell out of the
manifest and say so.

Also worth trying, since this is the stage where it is cheap: **restart the
computer's server on a different port** (`--port 8798`). The device should find
it anyway — the port it asks on is fixed, the port it fetches from is whatever
the answer said.

## Stage 8 — The real firmware

Only now. The procedure is in [firmware.md](firmware.md).

**Flashed from a release, the device speaks straight away**: the image carries
the example content, so after the first start there is one set with *Ja!*,
*Nein!*, *Stopp* and *Hilf mir*. That makes this stage a real check rather than
a formality — if the four keys speak and the fifth switches sets, then the
partition scheme, the file system, the audio path and all five displays are
right at once. Everything the earlier stages tested separately, now together.

Your own content comes afterwards: through the menu (hold the set key and key 2
for five seconds), **Inhalte holen** does what stage 7 did, this time with the
displays showing progress. Or over USB, `build.py --fs-image` and step 4 in
[firmware.md](firmware.md).

**"keine Inhalte" on all five displays** means the file area is empty. That is
correct and not a fault after flashing a program-only image — the artifact from
*Actions* is one, and so is `arduino-cli upload`. **From a release it is not**,
and then it is worth looking: **Info** in the menu says whether LittleFS is
mounted at all. If it is not, the partition scheme is the first suspect — the
board default creates the data area as `ffat`, and `LittleFS.begin()` wants one
called `spiffs`.

---

## What to write down along the way

These values are calculated, not measured. Whatever turns out differently in
stages 2 to 5 belongs back in the repo:

| | where |
|---|---|
| Panel profile and offset | `firmware/vorlaut/pins.h` |
| Order of the CS and KEY lines | `firmware/vorlaut/pins.h` |
| Actual component dimensions | `docs/hardware.md`, `tools/wiring.py` |
