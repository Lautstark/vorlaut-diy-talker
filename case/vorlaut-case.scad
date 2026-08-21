// =====================================================================
//  vorlaut — case
//  A talker with five ScreenKeys, speaker, ESP32-S3 Feather and LiPo.
//  For a simple FDM printer, one colour, no supports.
//
//  IMPORTANT: almost every dimension here is CALCULATED, not measured on a
//  finished build. Every number carries a tag saying where it comes from:
//
//    [M]  measured (Stefanie, August 2026, see docs/hardware.md)
//    [R]  researched (manufacturer or datasheet figure)
//    [A]  ASSUMPTION — unverified. Measure on the real part!
//    [K]  design decision — freely choosable
//    [G]  computed — do NOT edit by hand, follows from other values
//
//  The most important adjustment after unpacking the parts is
//  `cap_offset_y` (section 1). If the key cap does not sit centred on the
//  board, one number changes there and all five front cutouts move with
//  it. Nothing else.
//
//  Coordinates: origin = lower left corner of the component rectangle
//  (127.12 x 80.59 mm), seen from the front, y points up. z = 0 is the
//  OUTSIDE of the front plate, +z points backwards. All three parts are
//  printed in that orientation too.
// =====================================================================


/* ---------- 0.  What to render ---------- */

// "tub" | "carrier" | "lid" | "assembly" | "exploded" | "printbed"
part = "assembly";

// Draw dummy electronics in the assembly view
show_parts = true;

$fa = 3;
$fs = 0.4;


/* =====================================================================
   1.  COMPONENT DIMENSIONS
   ===================================================================== */

/* --- Waveshare ScreenKey (5x) --- */
sk_board_b        = 25.94;  // [M] board width
sk_board_h        = 35.29;  // [M] board height
sk_board_d        = 1.60;   // [A] board thickness, typical FR4
sk_cap_b          = 22.00;  // [M] key cap width
sk_cap_h          = 25.30;  // [M] key cap height
sk_cap_overhang =  8.60;  // [M] how far the cap stands proud of the front
sk_total_depth      = 24.00;  // [M] cap front face to module back
// How far the MOVING cap body reaches behind the front plate. That space has
// to stay clear over its whole depth, otherwise the key jams. When in doubt
// set it too large — this is the worst case (the whole module).
sk_cap_depth      = 15.40;  // [A] = sk_total_depth - sk_cap_overhang
sk_image             = 15.21;  // [M] visible display area (for reference only)

// >>> THE number that is most likely wrong once the parts are unpacked. <<<
// Offset of the cap centre against the board centre, positive = upwards.
// In the product photos the pin header and the FPC connector sit at the
// bottom; if the cap is therefore offset upwards, enter the measured value
// here. All front cutouts, the logo and the checks follow along automatically.
cap_offset_y     =  0.00;  // [A] 0 = the cap sits centred
cap_offset_x     =  0.00;  // [A] the same sideways

// Mounting holes in the four board corners
sk_hole_margin        =  2.00;  // [A] hole centre from the board edge
sk_hole_d           =  2.20;  // [A] hole diameter (M2)

/* --- Speaker 40 mm --- */
spk_frame           = 40.30;  // [M] square frame
spk_depth            = 25.30;  // [M]
spk_cone_d        = 32.70;  // [M]
spk_hole_diagonal   = 46.20;  // [M] diagonal across the four mounting holes
spk_hole_a           = spk_hole_diagonal / sqrt(2);  // [G] = 32.67 mm edge dimension
spk_screw_d       =  2.90;  // [A] clearance hole for M2.5
// Does the driver get bolted through the front plate? Four countersunk heads
// are then visible on the face, the front plate carries four 2.9 mm holes
// straight into the sealed chamber, and because the plate holds no thread
// every screw needs a nut INSIDE that chamber - a chamber that can only be
// reopened by taking the driver out again.
// Off instead: the four guide ribs locate the driver, sealing foam goes in
// front of its rim, a block of open-cell foam fills the space behind it, and
// the lid clamps the lot when its six M3 are pulled down. That is the same job
// the four screws were doing - pressing the rim onto the seal - only without
// visible hardware and without a loose nut in a closed volume. It also drops
// the question of whether the driver's own frame holes carry a thread, which
// nobody can answer until the part is unpacked.
// One word turns them back on if the driver rattles. Open-cell foam only:
// that is stuffing, closed-cell would eat real volume out of the box.
spk_front_screws  = false;  // [K]

/* --- Adafruit ESP32-S3 Feather --- */
feather_l           = 50.80;  // [R] 2.0"
feather_b           = 22.80;  // [R] 0.9"
feather_h           =  8.00;  // [A] total height with soldered headers
feather_pcb_d       =  1.60;  // [A] board thickness, typical FR4
feather_hole_l      = 45.72;  // [R] hole spacing lengthwise (Feather spec: 0.1" margin)
feather_hole_b      = 17.78;  // [R] hole spacing across
feather_hole_d      =  2.50;  // [R]
// USB-C socket: sits centred on one short side, body approx. 9.0 x 3.2 mm,
// protrudes approx. 1.5 mm beyond the board edge.
usb_socket_b        =  9.00;  // [R]
usb_socket_h        =  3.20;  // [R]
usb_overhang      =  1.50;  // [A] how far the socket protrudes past the edge
usb_centre_above_pcb =  1.60;  // [A] socket centre above the board top

/* --- LiPo --- */
battery_b              = 63.00;  // [M]
battery_h              = 50.30;  // [M]
battery_d              =  8.10;  // [M]
// 52 g — the heaviest single part. Position: see section 3.

/* --- Amplifier MAX98357A (Adafruit 3006) --- */
amp_b               = 19.40;  // [R] adafruit.com/product/3006
amp_h               = 17.80;  // [R]
amp_d               =  3.00;  // [R] without the pin header


/* =====================================================================
   2.  LAYOUT OF THE CONTROLS  (fixed, see docs/hardware.md)
   ===================================================================== */

// The four speech keys are ONE group, the set key is not part of it. What
// makes that legible is not a single spacing but the RATIO between two: inside
// the block the air is gap_block, from the block to the set key it is 1.5
// times as much. Both pitches come from the same number, so the block has
// equal air on all four sides and reads as a square. Before, it was 15 mm
// across and 20 mm up - four keys that read as two rows, not as one block.
gap_block     = 20.00;  // [K] air between two speech caps, both directions
gap_set_block = 1.5 * gap_block;      // [G] 30.0  set cap to the nearest speech cap
pitch_x       = sk_cap_b + gap_block; // [G] 42.0  centre spacing across
pitch_y       = sk_cap_h + gap_block; // [G] 45.3  centre spacing up
gap_spk_set        =  5.00;  // [M] speaker to set board

/* --- the component rectangle follows from that --- */
env_h  = spk_frame + gap_spk_set + sk_board_h;             // [G] 80.59
// The set board sits sideways centred under the speaker
set_mx = spk_frame/2;                                          // [G] 20.15
set_my = sk_board_h/2;                                       // [G] 17.645
// Left column of the block of four: gap_set_block of cap gap to the set cap.
// A sideways cap offset cancels out, because ALL caps are offset the same way
// - the distance stays as it is.
blk_mx1 = set_mx + sk_cap_b + gap_set_block;                // [G] 72.15
blk_mx2 = blk_mx1 + pitch_x;                                  // [G] 114.15
blk_my1 = sk_board_h/2;                                      // [G] 17.645  (flush at the bottom)
blk_my2 = blk_my1 + pitch_y;                                  // [G] 62.945
env_b   = blk_mx2 + sk_board_b/2;                            // [G] 127.12

// Speaker top left
spk_mx = spk_frame/2;                                           // [G] 20.15
spk_my = env_h - spk_frame/2;                                   // [G] 60.44

// Centre points of all five boards
sk_pos = [ [set_mx , set_my ],      // 0 = set key
           [blk_mx1, blk_my1],      // 1 = bottom left
           [blk_mx2, blk_my1],      // 2 = bottom right
           [blk_mx1, blk_my2],      // 3 = top left
           [blk_mx2, blk_my2] ];    // 4 = top right


/* =====================================================================
   3.  CASE — design parameters
   ===================================================================== */

/* --- Wall thicknesses and radii --- */
wall          = 2.40;   // [K] 6 passes with a 0.4 nozzle — stiff, prints reliably
front_d       = 2.40;   // [K] front plate
lid_d      = 3.00;   // [K] lid thicker: carries the countersunk screws
carrier_d     = 2.40;   // [K] carrier, the intermediate floor
standoff        = 2.00;   // [K] wall thickening in the board plane.
                        //     Creates the surrounding ledge for the carrier.
lip         = 1.20;   // [K] remaining outer skin above the lid rebate
corner_r        = 6.00;   // [K] outer corner radius — nothing sharp for the child
chamfer_front     = 1.20;   // [K] 45° chamfer all round the front edge
chamfer_rear   = 0.60;   // [K]
chamfer_lid   = 0.80;   // [K] chamfer on the lid top edge

/* --- Lid fixings --- */
// Screws instead of snap hooks. The reasoning is in building.md.
// false = self-tapping M3 straight into the plastic (needs no tooling
//         but a screwdriver, lasts a prototype's lifetime)
// true  = M3 heat-set threaded inserts (Ø4.0 x 5 mm). Only needed when the
//         case gets opened often. The bosses and with them the whole case
//         grow a little automatically.
threaded_insert = false;  // [K]
boss_d     = threaded_insert ? 8.00 : 6.00;   // [G] outer diameter of the lid boss
boss_core  = threaded_insert ? 4.20 : 2.50;   // [G] pilot hole
csink_d    = 6.20;   // [K] head diameter, M3 countersunk screw
csink_t    = 1.80;   // [K] countersink depth
boss_clearance  = 1.00;   // [K] boss edge to the component rectangle

// Clearance between the component rectangle and the inner wall at carrier
// height. The value is NOT freely chosen but set by the lid bosses: they sit
// against the inner wall and must not touch a board. Lower limit 7.0 mm, so
// that inner_margin - standoff = 5.0 mm is left in the board plane - the
// value from docs/hardware.md.
inner_margin    = max(7.00, boss_d + boss_clearance);   // [G] 7.0 or 9.0

/* --- Depth budget --- */
sk_behind_front = sk_total_depth - sk_cap_overhang;   // [G] 15.40
cable_space       = 6.00;   // [K] behind the ScreenKey back: header,
                          //     FPC connector and wires. Without this gap
                          //     the battery presses on the connector pins.
part_clearance    = 0.60;   // [K] clearance between the tallest part and the lid
feather_support = 2.00;   // [K] standoff under the Feather. Do not make it
                          //     smaller: the solder pins of the headers
                          //     stick out that far underneath.
amp_support     = 2.00;   // [K] same under the amplifier

sk_board_z_v  = sk_behind_front - sk_board_d;         // [G] 13.80 front face
carrier_z_bottom     = sk_behind_front + cable_space;            // [G] 21.40 carrier underside
carrier_z_top     = carrier_z_bottom + carrier_d;                // [G] 23.80 carrier top side

// How high the inner space above the carrier has to be is set by the TALLEST
// part on the carrier - and that is not the battery but the Feather on its
// standoffs. Exactly that was wrong in the first draft: only the battery was
// in the budget there, and the Feather reached 1.3 mm into the lid.
stack_battery  = battery_d;                    // [G]  8.10
stack_feather  = feather_support + feather_h;  // [G] 10.00  <- the governing one
stack_amp      = amp_support + amp_d;          // [G]  5.00
stack_max      = max(stack_battery, stack_feather, stack_amp);   // [G] 10.00

inner_z_h       = carrier_z_top + stack_max + part_clearance;  // [G] 34.40
outer_t        = inner_z_h + lid_d;                     // [G] 37.40 total depth

/* --- Outer dimensions --- */
inner_b  = env_b + 2*inner_margin;      // [G] 141.12
inner_h  = env_h + 2*inner_margin;      // [G]  94.59
outer_b = inner_b + 2*wall;          // [G] 145.92
outer_h = inner_h + 2*wall;          // [G]  99.39
centre_x  = env_b/2;                   // [G]
centre_y  = env_h/2;                   // [G]

/* --- Tolerances --- */
gap_cap   = 0.60;   // [K] air all round the key cap in the front cutout.
                        //     Large enough that the key never jams; too narrow
                        //     for a child's finger to get in.
chamfer_key    = 0.80;   // [K] chamfer on the edge of the key cutout
cap_r       = 2.00;   // [K] corner radius of the key cutout
lid_play  = 0.40;   // [K] total play of the lid in the rebate
carrier_play = 0.40;   // [K] total play of the carrier

/* --- ScreenKey fixings --- */
sk_boss_d    = 4.50;  // [K] ScreenKey boss outer diameter
sk_boss_core = 1.60;  // [K] pilot hole for self-tapping M2
sk_boss_foot = 1.50;  // [K] 45° foot cone, so the boss does not snap off
sk_boss_wall = 1.00;  // [K] minimum wall around the pilot hole. A boss that
                     //     would fall below it next to the cap clearance is
                     //     left out instead of cut into - see sk_boss().
sk_boss_h    = sk_board_z_v - front_d;   // [G] 11.40

/* --- Speaker chamber --- */
// As closed a volume as possible behind the driver. The chamber is formed by
// the front plate, two inset walls, two outer walls and the lid.
chamber_wall  = 2.00;   // [K]
chamber_clearance  = 2.00;   // [K] clearance between driver and chamber wall
chamber_x     = spk_frame + chamber_clearance;              // [G] 42.30 inner face on the right
chamber_y     = env_h - spk_frame - chamber_clearance - 1.0;// [G] 37.29 inner face at the bottom
                                                      //     (1.0 mm extra clearance
                                                      //      to the set board)
// Sound outlet. Three things pull against each other here: open enough that
// the driver is not choked, fine enough that nothing gets poked through onto
// the cone, and printable. 3.0 mm at a 4.6 mm pitch leaves 1.6 mm of web
// (4 passes with a 0.4 nozzle) and 31 % open area over the cone - far
// more than a voice needs. The earlier 4.0 mm let a child's pencil reach the
// cone, and the cone is the one part of this device that cannot be repaired.
grille_hole_d = 3.00;  // [K] sound outlet: holes, no child can get in
grille_pitch = 4.60;  // [K]
grille_field_d = 34.50; // [K] slightly larger than the cone

/* --- Positions inside (bottom left corner of the components) --- */
// All in component coordinates. The checks in section 4 verify that nothing
// overlaps - whoever moves something here gets an error message while
// rendering instead of a ruined print.
// Battery: to the right of the speaker chamber. Sideways it balances the
// speaker (top left); vertically it sits as low as the lower middle boss
// allows — its retaining ribs must not touch the boss. Result: centre of
// gravity practically at the middle of the case, see the echo in section 4.
battery_x    =  61.00;  // [K] follows the wider block of four - the battery
                     //     is the counterweight to the speaker, and 9 mm of
                     //     case width has to be balanced out again
battery_y    =   2.50;  // [K]

// Feather: board edge flush against the left inner wall, so the USB-C socket
// reaches the case edge. Vertically into the lower strip, below the
// speaker chamber.
feather_x =  -inner_margin;   // [G]
feather_y =   8.00;         // [K]

// Amplifier: to the right of the chamber wall, above the battery. The runs
// to the speaker are short there and the carrier is not cut away.
// (In the first draft it sat bottom left — there its bed protruded 1.9 mm
//  beyond the carrier edge and hit the case wall.)
amp_x     =  49.00;  // [K]
amp_y     =  58.50;  // [K]

// Retaining ribs on the carrier. The same numbers are used by the checks in
// section 4 and by the modules in section 8 - otherwise they drift apart.
rib_b     = 2.00;  // [K] thickness of one retaining rib
part_play = 0.40;  // [K] clearance between the component and the rib
bed_margin = rib_b + part_play;   // [G] 2.40 added all round

/* --- Lid bosses: 4 corners + middle top + middle bottom --- */
boss_e = inner_margin - boss_d/2;   // [G] 4.0 - boss axis away from the inner wall
boss_pos = [
  [ -boss_e        , -boss_e        ],   // bottom left
  [ env_b + boss_e , -boss_e        ],   // bottom right
  [ -boss_e        , env_h + boss_e ],   // top left (sits inside the chamber)
  [ env_b + boss_e , env_h + boss_e ],   // top right
  [ env_b/2       , -boss_e        ],   // middle bottom
  [ env_b/2       , env_h + boss_e ]    // middle top
];

/* --- Carrier supports: short posts with locating pegs --- */
support_d    = 8.00;   // [K]
peg_d     = 3.00;   // [K]
peg_h     = carrier_d - 0.40;  // [G] ends just below the carrier top side,
                                  //     so nothing presses on the battery
// Positions: in the gaps between the boards, that is where there is room.
support_pos = [
  [ (blk_mx1 + blk_mx2)/2, blk_my1 ],   // 93.15 / 17.645
  [ (blk_mx1 + blk_mx2)/2, env_h/2 ],   // 93.15 / 40.295
  [ (blk_mx1 + blk_mx2)/2, blk_my2 ],   // 93.15 / 62.945
  // In the gap between the set board and the block of four. Do not put it
  // higher: at y = 8 the peg hole in the carrier sat 0.73 mm under one of the
  // Feather's standoffs, and the standoff would have started printing over
  // the edge of the hole.
  [ (set_mx + blk_mx1)/2, 4.0 ]                        // 46.15 / 4
];

/* --- Feet on the lid --- */
// The lid is the BACK of the device, and the logo stands 0.8 mm proud of it.
// Without feet the thing lies on its speech bubble and nothing else: it rocks,
// and the logo is the first thing to wear through. Four pads, taller than the
// logo, on the SAME face - so they print upward in the lid's print orientation
// (inside on the bed, logo up) and need no support.
feet_on      = true;    // [K]
feet_d       = 10.00;   // [K]
feet_h       =  1.60;   // [K] 8 layers - leaves 0.8 mm of air under the logo
feet_x       = 58.00;   // [K] from the lid centre. Clear of the corner screws
feet_y       = 38.00;   // [K] and clear of the logo - checked in section 4.
feet_chamfer =  0.40;   // [K] broken edge, so the pad does not peel

/* --- Logo --- */
// Speech bubble with two eyes and a smile, rebuilt from assets/icon.svg
// (not imported - see building.md).
logo_lid_b   = 70.00;  // [K] width of the speech bubble on the lid
logo_lid_h   =  0.80;  // [K] embossing height, 4 layers at 0.2 mm
logo_side_on   = true;   // [K] small logo on the bottom edge
logo_side_b    = 20.00;  // [K]
logo_side_h    =  0.60;  // [K]


/* =====================================================================
   4.  CHECKS
   If anything here turns red the geometry is wrong - then do not print,
   but find the number that is to blame first.
   ===================================================================== */

/* --- Cap spacing in the plane --- */
gap_cap_x = pitch_x - sk_cap_b;      // should be 20.0
gap_cap_y = pitch_y - sk_cap_h;      // should be 20.0
gap_pcb_x   = pitch_x - sk_board_b;    // should be 16.06 > 0
gap_pcb_y   = pitch_y - sk_board_h;    // should be 10.01 > 0

assert(gap_cap_x > 8,
  "Speech keys sit too close sideways - a child's hand hits two at once.");
assert(gap_cap_y > 8,
  "Speech keys sit too close vertically.");
assert(gap_pcb_x > 2 && gap_pcb_y > 2,
  "The ScreenKey boards touch each other. Widen the grid.");
// The block only reads as a block while the air inside it is the same in both
// directions. Whoever changes one pitch without the other gets told here.
assert(abs(gap_cap_x - gap_cap_y) < 0.01,
  str("The block of four is not square: ", gap_cap_x, " mm across, ",
      gap_cap_y, " mm up. Both pitches come from gap_block - do not set them ",
      "by hand."));
// ... and while the step out to the set key is clearly bigger than the air
// inside the block. Below about 1.3x the five keys read as one field.
assert(gap_set_block >= 1.3 * gap_block,
  str("Set key too close to the block: ", gap_set_block, " mm against ",
      gap_block, " mm inside the block. The five keys then read as one row ",
      "of five instead of one plus a group of four."));

/* --- Cap clearance against the ScreenKey bosses ---------------------
   This is the most delicate place in the whole design.

   The key cap is 22.00 x 25.30 mm, the board 25.94 x 35.29 mm. Vertically
   there are only 2.995 mm between the cap edge (12.65 from the centre) and
   the hole centre (15.645). A boss with a 1.6 pilot hole and 1.0 mm of wall
   needs 1.8 mm of that, and the air gap around the cap 0.6 mm.
   About 0.6 mm remain - that is the ENTIRE budget by which the cap may sit
   off the board centre before the corner bosses no longer fit.

   The design catches that without anyone having to recalculate:
   `cap_clearance()` cuts the cap's path free, and `sk_boss()` drops every
   boss that would be cut into. If a key pair ends up with nothing holding
   it, the assert below says so.                                        */

clear_hb = (sk_cap_b + 2*gap_cap)/2;      // [G] 11.60
clear_hh = (sk_cap_h + 2*gap_cap)/2;      // [G] 13.25
sk_hole_dx  = sk_board_b/2 - sk_hole_margin;       // [G] 10.97
sk_hole_dy  = sk_board_h/2 - sk_hole_margin;       // [G] 15.645
boss_needed = sk_boss_core/2 + sk_boss_wall;         // [G]  1.80

// How far does a boss stand clear of the cap's path? It survives as soon as
// it sticks out of the rectangle in ONE axis - hence max() and not min().
function boss_clear(sx, sy) =
  max(abs(sk_hole_dx*sx - cap_offset_x) - clear_hb,
      abs(sk_hole_dy*sy - cap_offset_y) - clear_hh);

boss_kept      = [ for (sx=[-1,1], sy=[-1,1]) if (boss_clear(sx,sy) >= boss_needed) 1 ];
bosses_per_key = len(boss_kept);

// Budget for cap_offset_y before the first boss is dropped
offset_y_max = sk_hole_dy - clear_hh - boss_needed;   // [G] 0.595

assert(bosses_per_key >= 2,
  str("At cap_offset_y = ", cap_offset_y, " mm only ", bosses_per_key,
      " of 4 bosses per ScreenKey are left. Allowed are ",
      round(offset_y_max*100)/100, " mm. More offset means the corner holes ",
      "of the board sit too close to the cap. Then do NOT talk the number ",
      "down, but measure sk_hole_margin on the real module - the holes may ",
      "sit somewhere else entirely."));

/* --- Depth budget --- */
inner_t = inner_z_h - front_d;    // usable inner depth
assert(inner_t >= spk_depth + 0.5,
  str("Inner depth ", inner_t, " mm is not enough for the speaker (",
      spk_depth, " mm)."));
assert(inner_z_h - carrier_z_top >= battery_d,
  "No room above the carrier for the battery.");
// The Feather stands on standoffs - those belong in the budget. Exactly this
// line was missing in the first draft; the Feather reached 1.3 mm into the
// lid without any assert going off.
assert(inner_z_h - carrier_z_top >= feather_support + feather_h,
  str("No room above the carrier for the Feather: ",
      inner_z_h - carrier_z_top, " mm free, ",
      feather_support + feather_h, " mm needed."));
assert(inner_z_h - carrier_z_top >= amp_support + amp_d,
  "No room above the carrier for the amplifier.");

/* --- What sits on the carrier must not get in each other's way --------
   Instead of individual hand checks ("battery left of the amp?") there is a
   list of rectangles - component plus retaining ribs - and a blunt pairwise
   comparison. Whoever moves a position gets the collision named while
   rendering, by name, instead of finding it in the print. The speaker
   chamber and the lid bosses are in the same list as fixed obstacles. */

function overlaps(a, b) =
  a[0] < b[2] - 0.001 && b[0] < a[2] - 0.001 &&
  a[1] < b[3] - 0.001 && b[1] < a[3] - 0.001;

// movable = freely placeable; every one of these numbers is in section 3
carrier_items = [
  ["battery",        [battery_x - bed_margin,    battery_y - bed_margin,
                   battery_x + battery_b + bed_margin,    battery_y + battery_h + bed_margin]],
  ["Feather",     [feather_x,        feather_y,
                   feather_x + feather_l,     feather_y + feather_b]],
  ["amplifier", [amp_x - bed_margin,     amp_y - bed_margin,
                   amp_x + amp_b + bed_margin,      amp_y + amp_h + bed_margin]] ];

// fixed = follows from the case itself. The top left lid boss standing
// INSIDE the speaker chamber is intended (there is nothing but clearance
// there anyway), so the fixed obstacles are not checked against each other.
obstacles = concat(
  [ ["chamber",  [-inner_margin, chamber_y, chamber_x + chamber_wall, env_h + inner_margin]] ],
  [ for (i = [0:len(boss_pos)-1])
      [ str("lid boss ", i), [boss_pos[i][0] - boss_d/2, boss_pos[i][1] - boss_d/2,
                               boss_pos[i][0] + boss_d/2, boss_pos[i][1] + boss_d/2] ] ]);

collisions = concat(
  [ for (i = [0:len(carrier_items)-2], j = [i+1:len(carrier_items)-1])
      if (overlaps(carrier_items[i][1], carrier_items[j][1]))
        str(carrier_items[i][0], " <-> ", carrier_items[j][0]) ],
  [ for (b = carrier_items, h = obstacles)
      if (overlaps(b[1], h[1])) str(b[0], " <-> ", h[0]) ]);

assert(len(collisions) == 0,
  str("On the carrier these overlap: ", collisions));

// ... and everything has to stay inside the inner wall.
outside = [ for (b = carrier_items)
               if (b[1][0] < -inner_margin - 0.001 || b[1][1] < -inner_margin - 0.001 ||
                   b[1][2] > env_b + inner_margin + 0.001 ||
                   b[1][3] > env_h + inner_margin + 0.001) b[0] ];
assert(len(outside) == 0,
  str("Sticks out past the inner wall: ", outside));

/* --- USB-C window has to fit between carrier and lid --- */
usb_z    = carrier_z_top + feather_support + feather_pcb_d + usb_centre_above_pcb;
usb_win_h = usb_socket_h + 1.4;
assert(usb_z - usb_win_h/2 > carrier_z_top + 1.0,
  "USB window cuts into the carrier ledge.");
assert(usb_z + usb_win_h/2 < inner_z_h - 1.0,
  "USB window cuts into the lid rebate.");

/* --- Lid bosses must not touch a board --- */
boss_spacing_min = min([ for (p = boss_pos)
                        min([ for (s = sk_pos)
                              max( abs(p[0]-s[0]) - sk_board_b/2,
                                   abs(p[1]-s[1]) - sk_board_h/2 )
                              - boss_d/2 ]) ]);
assert(boss_spacing_min > 0,
  str("A lid boss touches a ScreenKey board (", boss_spacing_min, " mm)."));

/* --- Feet clear of the screws, and taller than the logo --- */
// A foot no taller than the logo does nothing at all, and one that grows into
// a countersink stops the screw sitting flush.
feet_to_screw = min([ for (p = boss_pos)
                      norm([abs(p[0] - centre_x) - feet_x,
                            abs(p[1] - centre_y) - feet_y]) ])
                - feet_d/2 - csink_d/2;
assert(!feet_on || feet_h > logo_lid_h + 0.3,
  str("The feet (", feet_h, " mm) do not stand clear of the logo (",
      logo_lid_h, " mm) - the device would go on rocking on the bubble."));
assert(!feet_on || feet_to_screw > 0,
  str("A lid foot runs into a countersink (", feet_to_screw, " mm)."));

/* --- Centre of gravity in the plane (battery + speaker, the two lumps) --- */
m_battery = 52;   // [M] g
m_spk   = 35;   // [A] g, estimated
sp_x = (m_battery*(battery_x+battery_b/2) + m_spk*spk_mx) / (m_battery + m_spk);
sp_y = (m_battery*(battery_y+battery_h/2) + m_spk*spk_my) / (m_battery + m_spk);

echo(str("--- vorlaut case ----------------------------------------"));
echo(str("component rectangle : ", env_b, " x ", env_h, " mm"));
echo(str("case outside        : ", outer_b, " x ", outer_h, " x ", outer_t, " mm"));
echo(str("inner space         : ", inner_b, " x ", inner_h, " x ", inner_t, " mm"));
echo(str("cap gap             : ", gap_cap_x, " mm across / ",
         gap_cap_y, " mm up"));
echo(str("board gap           : ", gap_pcb_x, " / ", gap_pcb_y, " mm"));
echo(str("carrier sits at z = ", carrier_z_bottom, " .. ", carrier_z_top));
echo(str("USB-C centre at z = ", usb_z));
echo(str("chamber volume gross approx. ",
         round((chamber_x+inner_margin)*(env_h+inner_margin-chamber_y)*inner_t/100)/10,
         " cm3, less the driver approx. ",
         round(((chamber_x+inner_margin)*(env_h+inner_margin-chamber_y)*inner_t
                - spk_frame*spk_frame*spk_depth)/100)/10, " cm3"));
echo(str("centre of gravity battery+speaker: x=", round(sp_x*10)/10,
         " (middle ", round(centre_x*10)/10, "), y=", round(sp_y*10)/10,
         " (middle ", round(centre_y*10)/10, ")"));
echo(str("cap offset          : ", cap_offset_y, " mm entered, ",
         round(offset_y_max*1000)/1000, " mm is the budget -> ",
         bosses_per_key, " of 4 bosses per ScreenKey"));
if (bosses_per_key < 4)
  echo(str("!! CAREFUL: only ", bosses_per_key, " bosses per ScreenKey. The ",
           "board then hangs off ONE edge and can wobble. Check whether ",
           "sk_hole_margin is really right before printing."));
echo(str("speaker fixing      : ", spk_front_screws ?
         "4 x M2.5 through the front, heads visible, nut in the chamber" :
         "none - foam behind the driver, the lid clamps it"));
echo(str("lid feet            : ", feet_on ?
         str(feet_h, " mm proud, ", feet_h - logo_lid_h, " mm clear of the logo")
         : "none - the device rests on its logo"));
echo(str("screws              : ", threaded_insert ? "M3 threaded inserts" :
         "M3 self-tapping", ", boss ", boss_d, " mm, pilot hole ", boss_core));
echo(str("wall ", wall, " mm = ", wall/0.4, " passes with a 0.4 nozzle"));
echo(str("print bed needed    : tub ", outer_b, " x ", outer_h,
         " mm, ", outer_t, " mm tall"));
echo(str("tallest stack on the carrier: ",
         stack_max == stack_feather ? "Feather" :
         stack_max == stack_battery ? "battery" : "amplifier",
         " with ", stack_max, " mm, free are ", inner_z_h - carrier_z_top));
echo(str("---------------------------------------------------------"));


/* =====================================================================
   5.  HELPER MODULES
   ===================================================================== */

module rrect(b, h, r) {            // 2D, centred on the origin
  offset(r = r) square([b - 2*r, h - 2*r], center = true);
}

module rprism(b, h, r, t) {        // 3D, centred, z = 0 .. t
  linear_extrude(height = t) rrect(b, h, r);
}

// Prism with a 45° chamfer underneath (prints without support)
module rprism_chamfer_bottom(b, h, r, t, f) {
  hull() {
    linear_extrude(0.02) rrect(b - 2*f, h - 2*f, max(0.4, r - f));
    translate([0, 0, f]) linear_extrude(0.02) rrect(b, h, r);
  }
  translate([0, 0, f]) rprism(b, h, r, t - f);
}

// Prism with a 45 degree chamfer on the top face
module rprism_chamfer_top(b, h, r, t, f) {
  rprism(b, h, r, t - f);
  translate([0, 0, t - f]) hull() {
    linear_extrude(0.02) rrect(b, h, r);
    translate([0, 0, f - 0.02]) linear_extrude(0.02)
      rrect(b - 2*f, h - 2*f, max(0.4, r - f));
  }
}


/* =====================================================================
   6.  LOGO
   Speech bubble, two eyes, a smile — rebuilt from assets/icon.svg. The SVG
   coordinates (512 box, y downwards) are taken over unchanged, so a glance at
   the file is enough to compare.
   ===================================================================== */

function bezier(t, p0, p1, p2, p3) =
  pow(1-t,3)*p0 + 3*pow(1-t,2)*t*p1 + 3*(1-t)*t*t*p2 + t*t*t*p3;

module logo_2d(width) {
  s = width / 360;      // 360 = bubble width in SVG units (436 - 76)
  smile = [[190,226],[190,288],[322,288],[322,226]];  // cubic Bezier
  n = 14;
  mirror([0,1]) scale(s) translate([-256, -242]) difference() {
    union() {
      hull() for (p = [[128,128],[384,128],[384,272],[128,272]])
        translate(p) circle(52);
      polygon([[314,310],[256,408],[198,310]]);        // tail of the bubble
    }
    translate([200,178]) circle(22);                    // left eye
    translate([312,178]) circle(22);                    // right eye
    for (i = [0 : n-1]) hull() {                        // smile, stroke 26
      translate(bezier(i/n,      smile[0],smile[1],smile[2],smile[3]))
        circle(13);
      translate(bezier((i+1)/n,  smile[0],smile[1],smile[2],smile[3]))
        circle(13);
    }
  }
}

// Raised logo in two steps: the upper step is 0.4 mm narrower. That is a
// printed chamfer - the edge does not break out and does not feel sharp to a
// child's hands.
module logo_3d(width, height) {
  step = min(0.4, height/2);
  linear_extrude(height - step) logo_2d(width);
  translate([0,0,height - step]) linear_extrude(step) offset(r = -0.4) logo_2d(width);
}


/* =====================================================================
   7.  TUB  (front plate + walls + everything hanging off them)
   Prints in exactly this orientation: front face on the print bed, opening
   upwards. No overhang steeper than 45°.
   ===================================================================== */

module outer_body() {
  translate([centre_x, centre_y, 0]) {
    rprism_chamfer_bottom(outer_b, outer_h, corner_r, outer_t - chamfer_rear, chamfer_front);
    translate([0,0,outer_t - chamfer_rear]) hull() {
      linear_extrude(0.02) rrect(outer_b, outer_h, corner_r);
      translate([0,0,chamfer_rear - 0.02]) linear_extrude(0.02)
        rrect(outer_b - 2*chamfer_rear, outer_h - 2*chamfer_rear,
              corner_r - chamfer_rear);
    }
  }
}

// The inner space gets WIDER towards the back in steps. Every step leaves an
// upward-facing bearing surface — that prints by itself. The other way round
// (narrower towards the back) every step would be an overhang.
module cavity() {
  translate([centre_x, centre_y, 0]) {
    // a) board plane, thick wall
    translate([0,0,front_d])
      rprism(inner_b - 2*standoff, inner_h - 2*standoff,
             corner_r - wall - standoff, carrier_z_bottom - front_d);
    // b) carrier level, thin wall — the 2 mm step is the carrier ledge
    translate([0,0,carrier_z_bottom])
      rprism(inner_b, inner_h, corner_r - wall, inner_z_h - carrier_z_bottom);
    // c) rebate for the lid
    translate([0,0,inner_z_h])
      rprism(outer_b - 2*lip + lid_play, outer_h - 2*lip + lid_play,
             corner_r - lip, outer_t - inner_z_h + 1);
  }
}

/* --- Clearance for the key caps ------------------------------------
   ONE solid for everything that could get in the moving cap's way. It cuts
   the front opening, breaks its outer edge and clears the path behind it over
   the full cap depth.

   The first draft had only a flat hole through the front plate here and left
   the boss foot cones standing. Recalculated, those reached 0.755 mm into the
   cap - the key would have jammed, and at all five places at once.

   Because this solid moves along with cap_offset_y, the path stays clear
   whatever is entered there. That is half of what makes the "one number"
   work; the other half is sk_boss(), which leaves out the bosses that would
   be in the way.                                                        */
module cap_clearance() {
  ob = sk_cap_b + 2*gap_cap;
  oh = sk_cap_h + 2*gap_cap;
  for (p = sk_pos) translate([p[0] + cap_offset_x, p[1] + cap_offset_y, 0]) {
    translate([0,0,-1]) rprism(ob, oh, cap_r, 1 + front_d + sk_cap_depth);
    // Chamfer on the outer edge, so no sharp edge remains
    translate([0,0,-0.01]) hull() {
      linear_extrude(0.02)
        rrect(ob + 2*chamfer_key, oh + 2*chamfer_key, cap_r + chamfer_key);
      translate([0,0,chamfer_key]) linear_extrude(0.02) rrect(ob, oh, cap_r);
    }
  }
}

/* --- ScreenKey mounting bosses --- */
// A boss only appears if it keeps enough material next to the cap clearance.
// Bosses cut into with a 0.3 mm remaining wall are worse than none: they snap
// off at the first screw and then lie loose inside the device.
module sk_boss() {
  for (p = sk_pos) translate([p[0], p[1], front_d])
    for (sx = [-1,1], sy = [-1,1])
      if (boss_clear(sx, sy) >= boss_needed)
        translate([sx*sk_hole_dx, sy*sk_hole_dy, 0]) {
          cylinder(d = sk_boss_d, h = sk_boss_h);
          cylinder(d1 = sk_boss_d + 2*sk_boss_foot, d2 = sk_boss_d, h = sk_boss_foot);
        }
}

module sk_dome_core() {
  for (p = sk_pos) translate([p[0], p[1], 0])
    for (sx = [-1,1], sy = [-1,1])
      if (boss_clear(sx, sy) >= boss_needed)
        translate([sx*sk_hole_dx, sy*sk_hole_dy, front_d + 1.0])
          cylinder(d = sk_boss_core, h = sk_boss_h);
}

/* --- Speaker: grille, screws, locating ribs --- */
// Only WHOLE holes. The first draft cut the hex field with a cylinder
// (intersection), and at the rim that left crescent-shaped slivers a fraction
// of a millimetre wide: ugly, and at the front face - the face that lies on
// the print bed - the thin ones tear off and stay on the sheet. Keeping a hole
// only when it fits inside the field completely costs three or four holes and
// gives a clean, even grille.
module spk_grille() {
  n = ceil(grille_field_d / grille_pitch) + 1;
  r_max = grille_field_d/2 - grille_hole_d/2;
  translate([spk_mx, spk_my, -1])
    for (i = [-n:n], j = [-n:n]) {
      x = i * grille_pitch + (abs(j) % 2) * grille_pitch/2;
      y = j * grille_pitch * 0.866;
      if (sqrt(x*x + y*y) <= r_max)
        translate([x, y, 0]) cylinder(d = grille_hole_d, h = front_d + 2);
    }
}

module spk_screws() {
  if (spk_front_screws)
  for (sx = [-1,1], sy = [-1,1])
    translate([spk_mx + sx*spk_hole_a/2, spk_my + sy*spk_hole_a/2, 0]) {
      translate([0,0,-1]) cylinder(d = spk_screw_d, h = front_d + 2);
      // Countersink from the front: wide at the face, narrower towards the
      // back - printable that way round.
      translate([0,0,-0.01]) cylinder(d1 = csink_d, d2 = spk_screw_d,
                                      h = (csink_d - spk_screw_d)/2 + 0.01);
    }
}

module spk_ribs() {   // four short walls guiding the driver sideways
  s = spk_frame + 0.6;
  translate([spk_mx, spk_my, front_d]) difference() {
    rprism(s + 2*1.6, s + 2*1.6, 1.0, 8.0);
    translate([0,0,-1]) rprism(s, s, 0.6, 10);
    // four passages at the corners for the wires
    for (a = [45, 135, 225, 315]) rotate([0,0,a]) translate([0, s/2, -1])
      cube([10, 6, 12], center = true);
  }
}

/* --- Speaker chamber --- */
module chamber_walls() {
  h = inner_z_h - front_d;
  // vertical wall right of the chamber, thickened at the bottom (carrier ledge)
  translate([chamber_x, chamber_y, front_d])
    cube([chamber_wall, env_h + inner_margin - chamber_y, h]);
  translate([chamber_x, chamber_y, front_d])
    cube([chamber_wall + standoff, env_h + inner_margin - chamber_y,
          carrier_z_bottom - front_d]);
  // horizontal wall under the speaker
  translate([-inner_margin, chamber_y, front_d])
    cube([chamber_x + chamber_wall + inner_margin, chamber_wall, h]);
}

module chamber_cable() {   // passage for the speaker wires
  translate([chamber_x - 1, chamber_y + 6, front_d + 2])
    cube([chamber_wall + standoff + 2, 7, 5]);
}

/* --- Lid bosses --- */
module lid_dome() {
  for (p = boss_pos) translate([p[0], p[1], front_d])
    cylinder(d = boss_d, h = inner_z_h - front_d);
}
module lid_dome_core() {
  for (p = boss_pos) translate([p[0], p[1], inner_z_h - 14])
    cylinder(d = boss_core, h = 15);
}

/* --- Carrier supports --- */
module carrier_supports() {
  for (p = support_pos) translate([p[0], p[1], front_d]) {
    cylinder(d = support_d, h = carrier_z_bottom - front_d);
    translate([0,0,carrier_z_bottom - front_d]) cylinder(d = peg_d, h = peg_h);
  }
}

/* --- USB-C window in the left wall --- */
// Deliberately tight: the wall takes the side loads, not the soldered socket.
// The cable bend rests on the outside, that is the strain relief.
module usb_window() {
  fb = usb_socket_b + 1.4;
  fh = usb_win_h;
  yc = feather_y + feather_b/2;
  translate([-inner_margin - wall - 2, yc, usb_z]) rotate([0,90,0])
    linear_extrude(wall + 4) rrect(fh, fb, 1.0);
  // local wall pocket, so the socket can move into the opening
  translate([-inner_margin - 1.2, yc, usb_z]) rotate([0,90,0])
    linear_extrude(1.4) rrect(fh + 4, fb + 5, 1.5);
}

/* --- Logo on the bottom edge --- */
module logo_bottom_edge() {
  if (logo_side_on)
    translate([centre_x, -inner_margin - wall, outer_t/2])
      rotate([90,0,0]) rotate([0,0,180]) mirror([1,0,0])
        logo_3d(logo_side_b, logo_side_h);
}

module tub() {
  union() {
    difference() {
      union() {
        difference() { outer_body(); cavity(); }
        sk_boss();
        lid_dome();
        carrier_supports();
        chamber_walls();
        spk_ribs();
      }
      cap_clearance();
      spk_grille();
      spk_screws();
      sk_dome_core();
      lid_dome_core();
      usb_window();
      chamber_cable();
    }
    logo_bottom_edge();
  }
}

/* =====================================================================
   8.  CARRIER  (intermediate floor)
   Separates the ScreenKey wiring from the battery - a LiPo must never
   press on connector pins. Prints flat, ribs upwards.
   ===================================================================== */

module carrier_outline() {
  difference() {
    translate([centre_x, centre_y])
      rrect(inner_b - carrier_play, inner_h - carrier_play, corner_r - wall);
    // cutout for the speaker chamber (the carrier rests on its step)
    translate([-inner_margin - 1, chamber_y + chamber_wall + 0.2])
      square([chamber_x + chamber_wall + inner_margin + 1 - 0.2 + 1,
              env_h + inner_margin - chamber_y + 2]);
    // reliefs around the lid bosses
    for (p = boss_pos) translate(p) circle(d = boss_d + 1.2);
    // holes over the locating pegs
    for (p = support_pos) translate(p) circle(d = peg_d + 0.4);
    // cable passages: slots in the gaps between the boards
    for (y = [blk_my1, blk_my2]) translate([(blk_mx1+blk_mx2)/2, y])
      square([5, 26], center = true);
    translate([(set_mx + blk_mx1)/2 - 3, 20]) square([6, 30]);
    translate([env_b/2 - 4, env_h + inner_margin - 6]) square([8, 8]);
  }
}

// Four corner brackets holding the battery in the plane. No lid over it -
// the battery should lift straight out when it needs replacing.
//
// Each bracket is ONE polygon. Before, they were two cuboids that only
// touched along one edge; on export that became a non-two-manifold solid,
// which a slicer silently repairs the wrong way.
module battery_ribs() {
  h  = battery_d + 0.2;              // slightly taller than the battery
  l  = 14;                        // leg length
  b  = rib_b;
  ix = battery_b + 2*part_play;  // inner dimension between the brackets
  iy = battery_h + 2*part_play;
  cx = battery_x + battery_b/2;
  cy = battery_y + battery_h/2;
  for (mx = [0,1], my = [0,1])
    translate([cx, cy, 0]) mirror([mx,0,0]) mirror([0,my,0])
      translate([-ix/2 - b, -iy/2 - b, 0])
        linear_extrude(h)
          polygon([[0,0], [l,0], [l,b], [b,b], [b,l], [0,l]]);
}

module feather_standoff() {
  for (sx = [-1,1], sy = [-1,1])
    translate([feather_x + feather_l/2 + sx*feather_hole_l/2,
               feather_y + feather_b/2 + sy*feather_hole_b/2, 0])
      difference() {
        cylinder(d = 5.0, h = feather_support);
        translate([0,0,-0.5]) cylinder(d = 2.10, h = feather_support + 1);
      }
}

module amp_bed() {
  h = amp_support + 2.5;  b = rib_b;  s = part_play;
  // three ribs: the amplifier is slid in and secured with a strip of
  // double-sided tape. Two holes would be guesswork as long as the hole
  // positions have not been measured.
  translate([amp_x - s - b, amp_y - s - b, 0]) cube([b, amp_h + 2*s + 2*b, h]);
  translate([amp_x - s - b, amp_y - s - b, 0]) cube([amp_b + 2*s + 2*b, b, h]);
  translate([amp_x + amp_b + s, amp_y - s - b, 0]) cube([b, amp_h + 2*s + 2*b, h]);
}

// Everything standing on top of the carrier is clipped to its outer contour.
// Without that the Feather's standoffs stuck out 0.16 mm beyond the edge -
// the carrier would have caught on the case wall while being inserted, and
// the standoff would have printed in mid-air over the edge. Clipping happens
// on the OUTER contour only, not on the holes in it.
module carrier_additions() {
  intersection() {
    union() {
      battery_ribs();
      feather_standoff();
      amp_bed();
    }
    linear_extrude(100) translate([centre_x, centre_y])
      rrect(inner_b - carrier_play, inner_h - carrier_play, corner_r - wall);
  }
}

module carrier() {
  translate([0, 0, carrier_z_bottom]) {
    linear_extrude(carrier_d) carrier_outline();
    translate([0, 0, carrier_d]) carrier_additions();
  }
}


/* =====================================================================
   9.  LID
   Flat plate, completely smooth on the inside. Prints with the inside on the
   bed and the logo upwards — that way the embossing is pure upward geometry
   and succeeds even on a tired printer.
   ===================================================================== */

// Four pads on the outside of the lid, chamfered at the top edge.
module lid_feet() {
  if (feet_on)
    for (sx = [-1,1], sy = [-1,1])
      translate([sx*feet_x, sy*feet_y, lid_d]) {
        cylinder(d = feet_d, h = feet_h - feet_chamfer);
        translate([0, 0, feet_h - feet_chamfer])
          cylinder(d1 = feet_d, d2 = feet_d - 2*feet_chamfer, h = feet_chamfer);
      }
}

module lid() {
  db = outer_b - 2*lip - lid_play;
  dh = outer_h - 2*lip - lid_play;
  translate([centre_x, centre_y, inner_z_h]) difference() {
    union() {
      rprism_chamfer_top(db, dh, corner_r - lip, lid_d, chamfer_lid);
      translate([0, 0, lid_d]) logo_3d(logo_lid_b, logo_lid_h);
      lid_feet();
    }
    for (p = boss_pos) translate([p[0] - centre_x, p[1] - centre_y, 0]) {
      translate([0,0,-1]) cylinder(d = boss_core + 0.9, h = lid_d + 2);
      // countersink from outside: widening upwards, therefore printable
      translate([0,0,lid_d - csink_t])
        cylinder(d1 = boss_core + 0.9, d2 = csink_d, h = csink_t + 0.01);
      translate([0,0,lid_d]) cylinder(d = csink_d, h = 5);
    }
  }
}


/* =====================================================================
   10.  DUMMIES  (for looking at only, not for printing)
   ===================================================================== */

module dummies() {
  color("#333") for (p = sk_pos) {
    translate([p[0], p[1], sk_board_z_v])
      linear_extrude(sk_board_d) square([sk_board_b, sk_board_h], center=true);
    translate([p[0] + cap_offset_x, p[1] + cap_offset_y, -sk_cap_overhang])
      linear_extrude(sk_total_depth - 6)
        square([sk_cap_b, sk_cap_h], center = true);
  }
  color("#555") translate([spk_mx, spk_my, front_d])
    linear_extrude(spk_depth) square([spk_frame, spk_frame], center = true);
  color("#7a5") translate([battery_x, battery_y, carrier_z_top]) cube([battery_b, battery_h, battery_d]);
  color("#25a") translate([feather_x, feather_y, carrier_z_top + feather_support])
    cube([feather_l, feather_b, feather_h]);
  color("#a52") translate([amp_x, amp_y, carrier_z_top + amp_support])
    cube([amp_b, amp_h, amp_d]);
}


/* =====================================================================
   11.  OUTPUT
   ===================================================================== */

if (part == "tub")        tub();
else if (part == "carrier") translate([0,0,-carrier_z_bottom]) carrier();
else if (part == "lid")  translate([0,0,-inner_z_h]) lid();
else if (part == "assembly") {
  color("#dcd8e8") tub();
  color("#c8c0e0") carrier();
  color("#b8aed8") lid();
  if (show_parts) dummies();
}
else if (part == "exploded") {
  color("#dcd8e8") tub();
  if (show_parts) dummies();
  color("#c8c0e0") translate([0,0,28]) carrier();
  color("#b8aed8") translate([0,0,60]) lid();
}
else if (part == "printbed") {
  // all three parts side by side, each in its print orientation
  tub();
  translate([0, outer_h + 8, -carrier_z_bottom]) carrier();
  translate([0, 2*outer_h + 16, -inner_z_h]) lid();
}
