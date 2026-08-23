# Hardware: parts, wiring, case

## Parts

| Part | Qty | Source | Unit price |
|------|----:|--------|-----------:|
| Adafruit ESP32-S3 Feather, 8 MB flash, no PSRAM | 1 | [Eckstein](https://eckstein-shop.de/Adafruit-ESP32-S3-Feather-8MB-Flash-No-PSRAM-with-STEMMA-QT-Qwiic) | 24,95 € |
| Waveshare ScreenKey, 0.85" IPS, 128×128, ST7735 | 5 | [BerryBase](https://www.berrybase.de/waveshare-screenkey-lcd-modul-0-85-zoll-ips-display-128-x-128-pixel-st7735-schwarz-3-3v/version-vollstaendiger-screenkey) | |
| Adafruit MAX98357A, I2S 3W class D | 1 | [Eckstein](https://eckstein-shop.de/AdafruitI2S3WClassDAmplifierBreakout-MAX98357A) | 7,95 € |
| Speaker 40 mm, 4 Ω, 5 W | 1 | [Eckstein](https://eckstein-shop.de/40mm-15-Internal-Magnetic-4Ohm-5W-Bass-Multimedia-Speaker) | 3,95 € |
| LiPo 3.7 V 2500 mAh, JST-PHR-2, 63 × 50.3 × 8.1 mm, 52 g | 1 | [Eckstein](https://eckstein-shop.de/LiPo-Akku-Lithium-Ion-Polymer-Batterie-37V-2500mAh-mit-JST-PHR-2-Stecker-LP785060) | 9,95 € |

Prices as of August 2026, case not included. For the ScreenKey, pick the
**"complete ScreenKey"** version — the module also comes without the key
mechanism, and that mechanism is half the point here: display and button in
one.

**The Feather is not freely interchangeable.** Two things depend on it:

- It charges the LiPo over USB-C and has the matching JST-PH connector for it.
  That is why the device needs neither a charging socket nor a switch. A board
  without charging circuitry — an Arduino Nano form factor, say — needs an
  extra charging module.
- The whole pin assignment below is cut to fit it, the buttons in particular:
  they have to sit on GPIO 0 to 21, otherwise they will not wake the chip from
  deep sleep.

Deliberately not provided for: a volume control and an on/off switch. The
device falls asleep by itself and wakes on a key press; the volume is set by
the normalisation during the build.

That is also why the speaker's bottom end is worth knowing rather than
guessing: with no volume control, what the driver cannot carry it cannot
carry, and a 40 mm cone in a small sealed chamber gives out somewhere. It is
the one figure here that no datasheet settles — stage 5 of
[bring-up.md](bring-up.md) sweeps 200 to 2000 Hz, and where the sweep goes
thin is the answer. **Lower limit: no thinning heard anywhere between 200 and
2000 Hz on 2026-08-22** — which is not yet the answer, because that run was on
a bare driver. The figure this section wants is the one the driver gives in
its own chamber, and that measurement is still owed.

Note that the chamber grew when the case did: **about 78 cm³ net**, not the
41.5 cm³ this section was written around. That moves the answer downwards, and
in the right direction — a bigger sealed box behind a small driver puts its
resonance lower.

## Wiring

![Wiring](wiring.png)

Drawn by `tools/wiring.py` from the assignment below — if something turns
out differently on the real modules, change it there and run the script again:

```bash
python3 tools/wiring.py
```

## Pin assignment (proposed)

| Function                | GPIO | Label on the Feather |
|-------------------------|-----:|----------------------|
| SPI SCK (all displays)  |   36 | SCK                  |
| SPI MOSI (all)          |   35 | MO                   |
| Display DC (all)        |    9 | D9                   |
| Display RST (all)       |   10 | D10                  |
| Backlight (all)         |    3 | SDA                  |
| CS display 1            |   11 | D11                  |
| CS display 2            |   12 | D12                  |
| CS display 3            |   37 | MI (MISO)            |
| CS display 4            |    5 | D5                   |
| CS display 5 (set)      |    6 | D6                   |
| Button 1                |   18 | A0                   |
| Button 2                |   17 | A1                   |
| Button 3                |   16 | A2                   |
| Button 4                |   15 | A3                   |
| Button 5 (set)          |   14 | A4                   |
| I2S BCLK                |    8 | A5                   |
| I2S LRCLK (WS)          |   38 | RX                   |
| I2S DIN                 |   39 | TX                   |
| MAX98357A SD            |    4 | SCL                  |

Why exactly these button pins: waking from deep sleep on the ESP32-S3 works
through GPIO 0 to 21 only. GPIO 14 to 18 fall inside that range and are cleanly
broken out on the Feather as A0-A4.

**Wiring notes:**

- Buttons against **GND**, the internal pull-ups are active. Pressed = LOW.
- MISO carries CS for display 3. On the Feather, GPIO 13 is the built-in red
  LED and therefore stays free — during first bring-up it is the first sign of
  life. Nothing is read from the displays anyway.
- `SD` on the MAX98357A hangs off GPIO 4: the amplifier is muted except while
  a word is playing. That saves power and the faint hiss at rest.
- The backlight of all five displays on one GPIO only works if the BL input of
  the ScreenKeys is a logic input. If it draws the LED current directly, a
  small MOSFET belongs in between — five backlights are more than one GPIO may
  drive.
- When soldering, check the actual ScreenKey pinout; the table above describes
  the Feather's side.

If the picture is off by a few pixels or a margin remains: adjust
`PANEL_COL_OFFSET` and `PANEL_ROW_OFFSET` in `firmware/vorlaut/pins.h`, which
is also where `PANEL_INITR` says which panel variant these are. All three are
settled in stage 2 of [bring-up.md](bring-up.md).

## Case

Measured parts: ScreenKey board 25.94 x 35.29 mm, mounting holes
**20 x 30 mm** centre to centre, key cap 22.00 x 25.30 mm, whole module 23.0 mm
deep (20.0 pressed) with 8.0 mm threaded spacers behind it, visible picture
only **15.21 x 15.21 mm**. Speaker 40.3 x 40.3 x 25.3 mm.

The cap's overhang is not in that list because it is not a property of the
module: it follows from how deep the module is mounted. See
[case/building.md](../case/building.md) — it comes out at 9.6 mm.

| | Dimension |
|---|---|
| Grid of the four speech keys | 42.0 x 45.3 mm |
| Gap between the caps | 20 mm, the same on all four sides |
| Distance set key to the block of four | 30 mm = 1.5 x the gap inside the block |
| Gap speaker to set key | 5 mm |
| Components in total | 127 x 81 mm |
| Case outside | 145.9 x 99.4 x 51.4 mm, no feet — it lies on its flat back |

Arrangement: speaker top left, the set key below it, the four speech keys to
the right as a 2x2 block. The set key and the lower key row finish flush at the
bottom — that works out exactly, because speaker + 5 mm + set board come to
80.6 mm and the block is also 80.6 mm high at this grid.

**Important:** the boards must not touch. There would then be only
25.94 - 22.00 = 3.9 mm sideways between the caps, and a child's hand would hit
two keys at once.

### How the ScreenKeys are held

**From behind, off the intermediate carrier — not off the front plate.** The
thread is in the module itself, so a screw needs material *behind* the board to
pull against, and the standoff that gets it there comes with the module too:
four **threaded spacers, 8 mm long**, off the back of each PCB. The carrier
lies against the ends of those and an **M2 × 6 countersunk** goes through it
into each spacer. The case contributes twenty clearance holes and twenty
countersinks and nothing else — no printed poles, no printed threads.

The five modules and the carrier are assembled as one piece on the bench and
lowered into the tub together.

That also sets how far the caps stand out, because the module can only sit
where the spacers put it:

```
cap face to PCB back          23.0 mm   (20.0 with the key pressed)
threaded spacers            +  8.0 mm
                            = 31.0 mm from cap face to the mid plate
mid plate sits at             21.4 mm behind the front face
                     -> cap stands 9.6 mm proud, 6.6 mm pressed
```

The first build, with bosses on the front plate, gave 8.6 mm and the keys read
as sunken. The 1.0 mm came back with the change itself.

### What fits behind the front

The ScreenKey PCBs sit **13.4 mm** behind the front plate (23.0 total minus
9.6 cap overhang) and their spacers reach another 8.0 mm to the mid plate at
21.4 mm. The speaker needs **25.3 mm**. The rest is decided by the battery and
the Feather.

The battery is **63 × 50.3 × 8.1 mm**. Behind the key block (62.9 × 80.6 mm) it
fits only **turned sideways** — lengthwise it misses by a tenth of a
millimetre. Sideways it leaves 12.6 mm free at the side and 17.6 mm at the top.

The Feather is 22.8 mm wide and therefore does **not** fit into the 12.6 mm
next to the battery. It has to go above it, so stacked:

```
key 13.4 + spacer 8.0  +  battery 8.1  +  Feather 8.0  =  37.5 mm
speaker alone:                                           25.3 mm
```

That means the depth is no longer set by the speaker but by the stack:
**about 32 mm inside, roughly 36 mm outside** — and then the first real build
added **14 mm** on top of that. Not because a part was measured wrong, but
because the stack-up counts parts and not wiring: the battery lead, the JST
plug and the five ribbon cables coming up through the carrier all want a bend
radius, and the lid was pressing on them. The extra depth goes entirely above
the carrier; the carrier itself did not move, and neither did anything in front
of it. **46 mm inside, 51.4 mm outside.**

When stacking, remember that the Feather's USB-C socket has to reach an edge of
the case — otherwise it cannot be charged.

The battery weighs **52 g** and is thus the heaviest single part. Where it sits
decides how the device feels in the hand.

### How the speaker is held

The driver is **not screwed down**. Four guide ribs on the front plate locate
it, a strip of foam or sealing tape goes between its rim and the plate, and a
block of **open-cell** foam fills the chamber left behind the magnet. The lid
compresses that block when its six M3 are tightened, and that is what holds the
driver. Since the case got deeper there are **20.7 mm** behind the magnet, not
6.7 — cut the block to roughly 40 × 40 × 22 mm.

Bolting it through the front plate would have cost three things at once: four
countersunk heads on the face of a device that otherwise shows no hardware, a
nut inside a chamber that can only be reopened by taking the driver out again —
2.4 mm of PLA holds no thread — and four 2.9 mm holes straight through into a
volume that is supposed to be sealed. Pressing the rim onto its seal was the
only real job those screws had, and the lid does that already.

Open-cell foam only: acoustically that is stuffing. A closed-cell block would
take roughly 11 cm³ straight out of the chamber and lift the resonance with
it — and with the chamber now around 78 cm³ net, a bigger block of the wrong
foam would waste most of what the extra depth just bought.

The four holes come back with `spk_front_screws = true` in the model, for which
you then need four M2.5 × 8 with nuts.

### No feet

There were four pads, 10 mm across and 1.6 mm proud, near the corners of the
lid. They are gone, because the thing they were fixing is gone.

The lid is the back of the device, so whatever stands proudest of it is what
the device lies on. The logo used to stand 0.8 mm proud there, which meant the
device lay on a 70 mm speech bubble and nothing else: it rocked, and the
embossing was the first surface to wear through. Feet taller than the logo were
the fix. Cutting the logo **into** the lid instead removes the problem rather
than compensating for it — nothing stands proud, so the device lies on the
whole flat back, 144 × 97 mm of it.

Bare PLA still slides. Four self-adhesive rubber discs near the corners land on
a flat face just as well, and they are now optional rather than structural.

Both decisions, and everything else needed to print and assemble the three
parts, are in [case/building.md](../case/building.md).

Still to check on the modules: whether the spacer thread is **M2** as assumed
(`sk_screw_d` and `sk_csink_d` both follow it), and how far into the spacer the
screw should go (`sk_screw_engage`, assumed 4 of the 8 mm).

Whether the key cap sits centred on its board is still worth measuring
(`cap_offset_y`), but it is no longer critical: nothing in front of the board
holds it, so there is nothing an off-centre cap can foul, and the only limit is
that it stays over its own board.

---
