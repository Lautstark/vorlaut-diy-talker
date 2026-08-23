# Building the case

Three printed parts, six screws, an evening's work. All the dimensions are in
[`vorlaut-case.scad`](vorlaut-case.scad); this file explains what to do with
them.

> **Once built.** The first set of parts was printed and assembled in August
> 2026, and five things came back from it: the carrier fouled the speaker
> chamber wall, the ScreenKeys turned out to screw from behind and not into
> bosses on the front plate, the key cutouts were a touch loose, the case was
> too shallow above the carrier, and the raised logo wanted feet it no longer
> needs. All five are in the model now. What is still assumption rather than
> measurement is below under [Measure first](#measure-first).

## The three parts

| Part | What it does | Outer size |
|---|---|---|
| **Tub** | front plate, walls, speaker chamber, lid bosses | 145.9 × 99.4 × 51.4 mm |
| **Carrier** | holds the five ScreenKeys, separates wiring from battery | 140.7 × 94.2 × 10.7 mm |
| **Lid** | back panel with the logo cut into it | 143.1 × 96.6 × 3.0 mm |

All three sizes are measured on the exported STL, not merely calculated. The
tub's footprint on the bed is exactly 145.9 × 99.4 mm — with the logo cut in
rather than raised, nothing stands proud of the walls any more.

The carrier changed job without changing shape. It used to be a floor; it is
now also the plate the five ScreenKeys hang off — but it holds them with
nothing but twenty holes, because each module brings its own 8 mm threaded
spacers. So it is still the same flat plate, and it still prints flat.

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

That survived the ScreenKeys moving onto the carrier, and it was worth
insisting on. A draft in between had printed poles standing off the carrier to
reach the boards, which put geometry on both faces and would have needed
support under the plate. The modules already carry 8 mm threaded spacers — the
poles were bridging a bridge.

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
  smooth that way (bed side), and the lid bosses grow upwards. The other way
  round the key cutouts would be overhangs and the bosses would need support.
- **Carrier**: flat, ribs upwards. The face that goes down is the one the
  ScreenKeys bolt against, so it wants to be the bed side: flat and true, which
  is what sets how far the key caps stand out of the front.
- **Lid**: **inside on the bed, logo upwards.** The logo is a pocket that only
  ever widens going up, so it is no overhang at all — the same reasoning the
  screw countersinks are already built on. Nothing stands proud of this face
  any more, so the lid is 3.0 mm on the bed instead of 4.6.

The only unsupported span is the top edge of the USB window: an **8.4 mm
bridge** in a vertical wall. Every printer manages that; if the first layer
above it sags, turn the fan up.

### What can go wrong

- **Key cutouts too tight.** If the printer runs a little wide, the cap jams.
  The air gap is 0.3 mm all round (`gap_cap`) — half what it was, so this is
  now worth a test print of one corner of the front plate before committing to
  the whole part.
- **Elephant foot on the tub.** The front face lies on the bed; a squashed
  first layer makes the key cutouts smaller. Set *elephant foot compensation*
  to 0.2 mm in the slicer.
- **Lid bosses break off.** Only if you insist on pre-drilling. Do not
  pre-drill, the pilot holes are already there. The ScreenKey holes in the
  carrier are a different matter — those are *clearance* holes, not pilot
  holes, because their screw goes into the module's spacer and not into
  plastic. Nothing to drill there at all.
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
| Around the key cap | `gap_cap` | 0.30 mm | the key must never jam — but no child's finger in it |
| Lid in the rebate | `lid_play` | 0.40 mm | the lid should drop in, not jam |
| Carrier | `carrier_play` | 0.40 mm | same |
| Around battery and amplifier | `part_play` | 0.40 mm | insert the part without force |
| Around the speaker frame | `chamber_clearance` | 2.00 mm | the driver never sits tight in the frame |

`gap_cap` was 0.60 mm on the first build and the caps visibly floated in their
holes. 0.30 mm is what it is now: still four times the layer width, still far
too narrow for a finger, and no longer readable as a gap from across the room.

If the printer generally prints fat, do **not** fiddle here but calibrate the
extrusion multiplier. These numbers are design dimensions, not printer
corrections.

## Screws instead of snap fits

Six **M3 × 12 countersunk**, from the back through the lid into the bosses of
the tub. Plus four **M2 × 6 countersunk** per ScreenKey (20 pieces), from the
back of the carrier into the module's own spacers. **Nothing for the speaker** —
see below.

The ScreenKey screws went into printed bosses on the front plate until the
modules were in hand, and that was wrong twice over. **The thread is in the
module, not in the case**, so a screw needs material *behind* the board to pull
against — and the only thing behind the board is the carrier. And the standoff
that gets it there is not something the case has to supply either: each module
carries **threaded spacers, 8 mm**, off the back of its PCB. Those are the
poles. The carrier's whole contribution is twenty clearance holes and twenty
countersinks.

Getting that wrong in the other direction is worth recording, because the model
briefly did: poles printed onto the carrier, reaching forward to the boards
across a gap that the spacers already fill. Two standoffs in series, and a part
that no longer printed flat.

Screw length follows and the `.scad` prints it: 2.4 mm of plate + about 4 mm
into the spacer = 6.4 mm, so **M2 × 6**. If the spacer thread turns out to be
M2.5 rather than M2, `sk_screw_d` and `sk_csink_d` both move.

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
slightly more volume, not less. A closed-cell block would take 11 cm³ straight
out of the box and lift the resonance with it.

The block got a good deal thicker when the case did. There are now **20.7 mm**
of chamber behind the magnet, not 6.7 — cut the foam to roughly 40 × 40 × 22 mm
so it still goes in with a little compression. The chamber came out at about
78 cm³ net instead of 41.5, which is the one side effect of the extra depth
that is pure gain: a bigger sealed box behind a small driver puts its
resonance lower, not higher.

If the driver rattles once it is playing, set

```
spk_front_screws = true;
```

and the four countersunk holes come back, along with `verify.py` checking the
countersink depth against the front plate. You then need four **M2.5 × 8** with
nuts — and it is worth checking first whether the driver's own frame holes
carry a thread, in which case the nuts are spare.

## No feet on the lid

There used to be four pads, 10 mm across and 1.6 mm proud, near the corners.
They are gone, and the argument that removed them is the one that put them
there in the first place.

The lid is the back of the device, so whatever stands proudest of it is what
the device lies on. With the logo embossed 0.8 mm proud, that was a 70 mm
speech bubble and nothing else: the thing rocked on a table and the embossing
was the first surface to wear through. Four pads taller than the logo fixed
that, at the cost of four pads.

Cut the logo **in** instead and the problem does not need fixing. Nothing
stands proud of the lid, so the device lies on the whole of its flat back —
144 × 97 mm of bearing surface instead of four 10 mm discs. It cannot rock,
there is no embossing left to wear through, and the lid is 3.0 mm on the bed
instead of 4.6.

Bare PLA still slides on a table. Four self-adhesive rubber discs near the
corners land on a flat face just as well as on a printed pad, and now they are
optional rather than structural.

Both decisions are one word each, and both checks stay in place:

```
logo_recessed = false;   // back to the raised logo
feet_on       = true;    // and then the feet are needed again
```

`verify.py` refuses the combination that does not work — raised logo, no feet —
rather than letting it through quietly.

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

4. **Five ScreenKeys onto the carrier — outside the case.** This is the step
   that changed. The modules do not go into the tub on their own any more:
   they bolt to the carrier first, on the bench, where you can see what you are
   doing. Each module stands on its own four **8 mm threaded spacers**; the
   carrier lies against the ends of those, and four **M2 × 6 countersunk** per
   key go in from the carrier's back side, heads down into their countersinks.
   Metal thread into metal thread, so these may be pulled up properly — nothing
   printed is being clamped.

5. **Wire it up, still outside the case.** Everything according to
   `docs/hardware.md`. Far easier now than it used to be: the five boards sit
   on a flat plate on the bench instead of in the bottom of a box. Bring the
   cables up through the slots in the carrier as you go, and leave enough slack
   that the 6 mm between board and carrier is where the connectors live.

6. **Lower the carrier assembly into the tub.** All five caps go through their
   cutouts from the inside at once, so bring it down square and take it slowly.
   It comes to rest on the step all round; the two locating pegs it still meets
   keep it from wandering sideways. The caps should stand **9.6 mm** out of the
   front face, 6.6 mm with a key held down. **Check now: does every key press
   cleanly and spring back?** If a key is stiff it is catching on its cutout —
   stop and read [Measure first](#measure-first) below.

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
    expected, it is what clamps the speaker. The lid no longer touches the
    carrier on its way past: there are 24.6 mm above the carrier now, and the
    carrier is held where it is by its step and by the five modules bearing on
    the front plate.

## Measure first

These numbers are assumptions. If they are wrong, the design changes — in part
considerably.

### How far do the caps stand out?

**The number the whole stack now hangs off.** Three measured figures set it and
nothing else does:

| | |
|---|---|
| `sk_total_depth` | 23.0 mm — cap face to the back of the PCB, key not pressed |
| `sk_total_depth_pressed` | 20.0 mm — the same with the key held down, so 3.0 mm of travel |
| `sk_spacer_l` | 8.0 mm — the threaded spacers off the back of the PCB |

The mid plate lies against the ends of those spacers, so the plate sits
23.0 − 9.6 + 8.0 = **21.4 mm** behind the front face, and the caps stand
**9.6 mm** proud — 6.6 mm with a key pressed. That is 1.0 mm further out than
the first build managed with bosses on the front plate, which is exactly the
"too sunken" complaint, fixed by the change rather than tuned away.

If you want them further out or further in, `sk_cap_overhang` is the one
number: the mid plate and its ledge in the tub follow it. `verify.py` refuses
to let the plate and the spacers disagree, and it also refuses a cap that would
sit less than 3 mm proud when pressed — a key a child has to find with a
fingernail is not a key.

### Does the key cap sit centred on the board?

It used to be the biggest open unknown, with a budget of 0.595 mm before the
design started dropping bosses. **That budget no longer exists.** Nothing in
front of the board holds it any more — the module hangs off the mid plate on
its own spacers — so there is nothing an off-centre cap can foul.

The number is still there and still worth measuring:

```
cap_offset_y = 0.00;   // offset of the cap centre, positive = upwards
```

Measure: distance from cap top edge to board top edge, minus distance from cap
bottom edge to board bottom edge, divided by two. Enter it, done — the five
front cutouts and their chamfers move with it and nothing else has to change.

The only limit left is the obvious one: the cap has to stay over its own board.
That leaves roughly 5 mm of room vertically and 2 mm sideways, and `verify.py`
says so if it runs out.

### The remaining assumptions

| Variable | Assumed | Check |
|---|---|---|
| `sk_hole_margin` | 2.00 mm | where do the mounting holes really sit? They set the twenty screw positions |
| `sk_screw_d` | 2.40 mm | is the spacer thread M2? If it is M2.5, this and `sk_csink_d` both move |
| `sk_screw_engage` | 4.00 mm | how far into the spacer the screw goes — it sets the screw length |
| `sk_hole_d` | 2.20 mm | hole diameter |
| `sk_board_d` | 1.60 mm | board thickness |
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

It sits on the device twice, and it is **cut in** both times:

- **On the lid**, 70 mm wide, **0.8 mm deep** — four layers at 0.2 mm. Less
  than that a worn printer no longer reproduces cleanly; more and it starts
  eating into a 3 mm plate. The floor of the pocket is 0.4 mm narrower than its
  mouth: the same printed chamfer as before, turned over, so the edge is not
  sharp and the pocket only ever widens going up.
- **On the bottom edge**, 20 mm wide, 0.6 mm deep — where the device is picked
  up. That leaves 1.8 mm of the 2.4 mm wall standing.

Raised was the earlier decision, and the case against recessing it was that a
recess in a single colour reads only as a shadow and collects dirt. Both are
still true. What outweighed them is what the raised version cost: the lid is
the back of the device, so a 0.8 mm bubble was the only thing the device stood
on, and it took four printed feet to stop it rocking on its own logo. Cut in,
the device lies flat on all of its back, the feet are unnecessary, and there is
nothing left that can wear through — a shadow that stays a shadow beats an
embossing that rubs off. Feeling it out with a finger works either way; a
groove is as legible to a hand as a ridge.

One word puts it back, and the feet come with it:

```
logo_recessed = false;
feet_on       = true;
```
