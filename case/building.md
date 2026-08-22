# Building the case

Three printed parts, six screws, an evening's work. All the dimensions are in
[`vorlaut-case.scad`](vorlaut-case.scad); this file explains what to do with
them.

> **Untested.** At the time of writing not a single component was in hand — all
> dimensions come from `docs/hardware.md`, from datasheets, or are reasoned
> assumptions. What to measure before the first print is below under
> [Measure first](#measure-first).

## The three parts

| Part | What it does | Outer size |
|---|---|---|
| **Tub** | front plate, walls, speaker chamber, all bosses | 145.9 × 99.4 × 37.4 mm |
| **Carrier** | intermediate floor, separates wiring from battery | 140.7 × 94.2 × 10.7 mm |
| **Lid** | back panel with logo and feet | 143.1 × 96.6 × 4.6 mm |

All three sizes are measured on the exported STL, not merely calculated. The
tub's footprint on the bed is 145.9 × 100.0 mm — the logo at the bottom edge
stands 0.6 mm proud of the wall.

```bash
openscad -o tub.stl -D 'part="tub"' case/vorlaut-case.scad
```

The same with `carrier` and `lid`. `part="assembly"` shows everything put
together, `part="exploded"` pulled apart, `part="printbed"` all three side by
side in print orientation.

If OpenSCAD does not start — on macOS Gatekeeper blocks the app when launched
from Finder — opening it once via *right click → Open* helps. For checking the
dimensions you do not need OpenSCAD at all:

```bash
python3 case/verify.py
```

The script reads the dimensions from the `.scad` and checks them independently
— key spacing, depth budget, collisions, wall thicknesses, print bed, centre of
gravity. Exit code 0 means everything works out.

And once the STL files exist, a second script checks what OpenSCAD actually
built — outer dimensions and whether the decisive places hold material or air:

```bash
python3 case/check-stl.py tub.stl carrier.stl lid.stl
```

That catches mistakes which stay invisible at parameter level: a cutout with
the wrong depth, say, or a boss that another solid has cut away. Both scripts
need nothing but Python 3.

> **Read what OpenSCAD says, not just its exit code.** A misspelled module is
> not an error:
>
> ```
> WARNING: Ignoring unknown module 'carrier_umriss' in file vorlaut-case.scad
> ```
>
> It leaves that part out, warns, and writes an STL anyway. Renaming a module
> and missing one call site cost the tub 12400 of its 30990 triangles once,
> and the exit code stayed 0. So after every rename, compare the geometry -
> triangle count, volume and bounding box - against the previous render.
>
> Byte comparison does not work for that: OpenSCAD does not order the
> triangles deterministically, and two runs of the same file give different
> checksums. Volume via the divergence theorem and the bounding box are
> independent of the order.

## Printing

Simple FDM printer, one colour, **no support material**. The design does
without: the inner space gets wider towards the back in steps, so every step is
an upward-facing bearing surface instead of an overhang. All chamfers are 45°.

| Setting | Value | Why |
|---|---|---|
| Nozzle | 0.4 mm | the wall thicknesses are whole multiples of it |
| Layer height | 0.2 mm | plates are whole multiples of it |
| Perimeters | 3 | 3 × 0.4 = 1.2 mm per side, a 2.4 mm wall is then solid |
| Bottom / top | 5 / 5 layers | 1.0 mm — the front plate carries the keys |
| Infill | 25 % grid | more gains nothing, less flexes |
| Material | PLA or PETG | PETG is tougher, PLA holds size better |
| Supports | **off** | not needed |
| Brim | 5 mm on the tub | 146 mm of flat surface tends to lift |

No ABS: the device lies around near a small child, and ABS edges splinter when
something is dropped.

### Orientation on the bed

Print all three parts **exactly as they sit in the `.scad`** — `part="printbed"`
shows it. Do not rotate them, that is no accident:

- **Tub**: front face on the bed, opening upwards. The front plate becomes
  smooth that way (bed side), and all bosses grow upwards. The other way round
  the key cutouts would be overhangs and the bosses would need support.
- **Carrier**: flat, ribs upwards.
- **Lid**: **inside on the bed, logo upwards.** The embossing is then pure
  upward geometry and succeeds even on a tired printer. The other way round it
  would be an overhang and would smear. The four feet sit on that same face and
  print the same way.

The only unsupported span is the top edge of the USB window: an **8.4 mm
bridge** in a vertical wall. Every printer manages that; if the first layer
above it sags, turn the fan up.

### What can go wrong

- **Key cutouts too tight.** If the printer runs a little wide, the cap jams.
  The air gap is 0.6 mm all round (`gap_cap`) — check it on a test print of the
  front plate before running the whole part.
- **Elephant foot on the tub.** The front face lies on the bed; a squashed
  first layer makes the key cutouts smaller. Set *elephant foot compensation*
  to 0.2 mm in the slicer.
- **Bosses break off.** Only if you insist on pre-drilling. Do not pre-drill,
  the pilot holes are already there.
- **Speaker grille.** 37 holes of 3.0 mm at a 4.6 mm pitch — 1.6 mm of web, four
  passes with a 0.4 nozzle, and about 31 % open area over the cone. Do not make
  the holes bigger to "let more through": 31 % is already far more than a voice
  needs, and from about 4 mm a child's pencil reaches the cone. The cone is the
  one part of this device that cannot be repaired. `verify.py` holds both ends
  of that — the web and the open area.
  Only whole holes are placed, never part-holes cut off at the rim: those come
  out as slivers a fraction of a millimetre wide and stay behind on the print
  bed, because the front face is the face that lies on it.

## Tolerances

All clearances are named variables in section 3 of the `.scad`.

| Where | Variable | Value | Meant for |
|---|---|---|---|
| Around the key cap | `gap_cap` | 0.60 mm | the key must never jam — but no child's finger in it |
| Lid in the rebate | `lid_play` | 0.40 mm | the lid should drop in, not jam |
| Carrier | `carrier_play` | 0.40 mm | same |
| Around battery and amplifier | `part_play` | 0.40 mm | insert the part without force |
| Around the speaker frame | `chamber_clearance` | 2.00 mm | the driver never sits tight in the frame |

If the printer generally prints fat, do **not** fiddle here but calibrate the
extrusion multiplier. These numbers are design dimensions, not printer
corrections.

## Screws instead of snap fits

Six **M3 × 12 countersunk**, from the back through the lid into the bosses of
the tub. Plus four **M2 × 6** per ScreenKey (20 pieces). **Nothing for the speaker** —
see below.

Why no snap hooks:

- A snap hook is a thin, flexible tongue. Exactly that kind of thing breaks off
  and then lies inside the device as a swallowable small part — with a
  three-and-a-half-year-old that is the deciding factor.
- Printed snap hooks fatigue. This case is a prototype; it gets opened often,
  not once.
- A hook does not pull the joint closed. For the speaker we need as sealed a
  volume as possible at the back, and that means: lid tightened firmly onto a
  flat bearing surface.

The default is **self-tapping M3 straight into the plastic**
(`boss_core = 2.5`). That needs no tool but a screwdriver and lasts a
prototype's lifetime. Whoever opens the case often sets, at the top of the
`.scad`,

```
threaded_insert = true;
```

and gets bosses for **M3 heat-set threaded inserts** (Ø 4.0 × 5 mm). The bosses
grow to 8 instead of 6 mm, and because they sit against the inner wall the case
grows along with them to 149.9 × 103.4 mm. That is not an oversight but
derived: `inner_margin` follows the boss size.

## The speaker is not screwed down

`spk_front_screws = false` in the `.scad`. The driver is located sideways by
the four guide ribs, sealed against the front plate with tape or foam, and
pressed onto that seal by a block of open-cell foam behind it that the lid
compresses. No fastener, and nothing visible on the face of the device.

That is not laziness. Bolting through the front plate costs three things at
once:

- Four countersunk heads sit on the front, next to the grille, and they are the
  only visible hardware on an otherwise plain face.
- The front plate is 2.4 mm of PLA and holds no thread, so each screw needs a
  **nut inside the chamber** — a chamber that can only be reopened by taking
  the driver out again. A nut that works loose in there rattles against the
  cone.
- Four 2.9 mm holes go straight through the front plate into the sealed volume.
  The chamber is meant to be closed; those are four leaks that no amount of
  hot glue on the cable passage makes up for.

Pressing the rim onto the seal was the only real job those screws had, and the
lid already does that — its six M3 pull the whole stack together, which is the
same reasoning that ruled out snap hooks.

**Open-cell foam only.** That is stuffing, and acoustically it behaves like
slightly more volume, not less. A closed-cell block would take 11 cm³ out of a
41.5 cm³ box and lift the resonance with it.

If the driver rattles once it is playing, set

```
spk_front_screws = true;
```

and the four countersunk holes come back, along with `verify.py` checking the
countersink depth against the front plate. You then need four **M2.5 × 8** with
nuts — and it is worth checking first whether the driver's own frame holes
carry a thread, in which case the nuts are spare.

## Feet on the lid

Four pads, 10 mm across and **1.6 mm proud**, near the corners of the lid.

The lid is the back of the device, and the logo stands 0.8 mm proud of it. So
without feet the device lies on a 70 mm speech bubble and nothing else: it
rocks on a table, and the embossing is the first thing to wear through. The
feet clear the logo by 0.8 mm and stand on 81 % of the case width, which is
enough that pressing a corner key does not tip it.

They sit on the same face as the logo, so in the lid's print orientation
(inside on the bed, logo up) they are pure upward geometry — no support, no
second setup. They do make the lid 4.6 mm tall on the bed instead of 3.8.

Bare PLA slides on a table. A self-adhesive rubber disc on each pad fixes that
and costs nothing; the pads are flat and 10 mm across so a standard 10 mm
bumper lands on them exactly.

## Assembly

The order is not arbitrary — front to back, because each layer holds down the
one beneath it.

1. **Deburr.** Run a finger over all edges once. The front edge has a 1.2 mm
   chamfer, the key cutouts 0.8 mm; if a string is still hanging, remove it.

2. **Speaker into the tub.** From the inside against the front plate, into the
   four guide ribs — they locate it, nothing is screwed. **First put a strip of
   sealing tape or foam between the driver rim and the front plate** —
   otherwise air whistles around the driver and the closed volume is not one.
   Then cut a block of **open-cell** foam to roughly 40 × 40 × 8 mm and lay it
   in behind the magnet: 6.7 mm of chamber depth are free there, so it goes in
   with a little compression. That block is what holds the driver — the lid
   presses on it in step 10. Lead the wires out to the right through the
   passage in the chamber wall.

3. **Seal the chamber passage.** The cable passage is deliberately generous
   (7 × 5 mm). After threading, close it with hot glue — that is the only
   remaining leak of the chamber.

4. **Insert five ScreenKeys.** From the inside into the cutouts, module body
   flat against the front plate, four M2 into the bosses each. Do not
   overtighten, these are printed threads. **Check now: does every key press
   cleanly and spring back?** If not, it is catching on the cutout — then stop
   and read [Measure first](#measure-first) below.

5. **Wire it up.** Everything according to `docs/hardware.md`. Lay the wires so
   they stay in the 6 mm cable space behind the boards and do not stick out
   over the carrier ledge.

6. **Lay in the carrier.** It drops onto the four locating pegs and the step
   all round. It is not screwed down — the lid holds it. Cables up through the
   slots.

7. **Feather onto the carrier.** Onto the four standoffs, USB-C socket into the
   window of the left wall. The socket has to **reach** the wall and not jam in
   it: side loads on the cable should be taken by the wall, not by the soldered
   socket.

8. **Amplifier.** Into the rib bed to the right of the chamber wall, with a
   strip of double-sided tape. Two screw holes would be guesswork as long as
   the hole positions have not been measured.

9. **Battery.** Flat into the four corner brackets, JST connector to the
   Feather. The battery is **not** glued — it is the part the case can be
   opened for. Do not lay cables under the battery.

10. **Lid on, tighten six M3.** Crosswise and hand tight only. Going down, the
    lid meets the foam block behind the driver first — that resistance is
    expected, it is what clamps the speaker.

## Measure first

These numbers are assumptions. If they are wrong, the design changes — in part
considerably.

### Does the key cap sit centred on the board?

**The biggest open unknown.** In the product photos the pin header and FPC
connector are in the lower area of the board; if the cap therefore sits offset
upwards, all five front cutouts move with it.

Exactly **one number** is provided for that:

```
cap_offset_y = 0.00;   // offset of the cap centre, positive = upwards
```

Measure: distance from cap top edge to board top edge, minus distance from cap
bottom edge to board bottom edge, divided by two. Enter it, done — cutouts,
chamfers, logo and all checks follow along.

**But the budget is small: 0.595 mm.** That is not laziness but the geometry of
the module. Between the cap edge (12.65 mm from the centre) and the hole centre
(15.645 mm) there are only 2.995 mm. Of those the boss needs 1.8 mm and the air
gap 0.6 mm. The rest is the margin.

If more is entered, the design drops the bosses that would otherwise be cut
into — bosses cut into with a 0.3 mm remaining wall snap off at the first screw
and then lie loose inside the device. From about 0.6 mm of offset, two bosses
per key remain and the board hangs off **one** edge. A warning then appears
while rendering.

If the offset really is large, the answer is not to talk the number down, but
to look at

```bash
python3 case/verify.py --offset 2.0
```

and then measure `sk_hole_margin` on the real module. Possibly the holes sit
somewhere else entirely from what is assumed here — then the budget works out
after all.

### The remaining assumptions

| Variable | Assumed | Check |
|---|---|---|
| `sk_hole_margin` | 2.00 mm | where do the mounting holes really sit? Are there any at all? |
| `sk_hole_d` | 2.20 mm | hole diameter |
| `sk_board_d` | 1.60 mm | board thickness |
| `sk_cap_depth` | 15.40 mm | how far does the **moving** cap body reach behind the front? |
| `feather_h` | 8.00 mm | tallest component on the Feather — sets the case depth |
| `usb_overhang` | 1.50 mm | how far does the socket protrude past the board edge? |
| `usb_centre_above_pcb` | 1.60 mm | height of the socket centre above the board |
| `amp_b`, `amp_h` | 19.4 × 17.8 | dimensions of the MAX98357A breakout |
| `spk_hole_diagonal` | 46.20 mm | bolt circle of the speaker — only matters with `spk_front_screws = true` |
| `spk_depth` | 25.30 mm | sets how much foam fits behind the driver (6.7 mm at this figure) |

After measuring, run

```bash
python3 case/verify.py
```

once. Whatever no longer works out shows up as `FAIL` — with actual and target
value, so you can see how far off it is.

## The logo

Speech bubble with two eyes and a smile, rebuilt from
[`assets/icon.svg`](../public/icon.svg) — not imported. An `import()` of the
SVG would have tied the file to a second path and silently changed the case
with every change to the icon. Instead the SVG coordinates sit unchanged in the
`.scad` (512 box, y downwards), so a glance at both files is enough to compare.

It sits on the device twice:

- **On the lid**, 70 mm wide, **0.8 mm proud** — four layers at 0.2 mm. Less
  than that a worn printer no longer reproduces cleanly; at 0.4 mm the contour
  blurs into its surroundings. The upper step is 0.4 mm narrower than the lower
  one: a printed chamfer, so the edge does not break out and does not feel
  sharp to a child's hands.
- **On the bottom edge**, 20 mm wide, 0.6 mm proud — where the device is
  picked up.

Proud instead of recessed, because a recess in a single colour is visible only
as a shadow and clogs with dirt. Proud can also be felt — which for a device
made for a child who does not speak is no disadvantage.
