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
//  Coordinates: y points up, z = 0 is the OUTSIDE of the front plate and +z
//  points BACKWARDS, into the case. Those two together already fix x, and not
//  the way one tends to read it: the child stands in FRONT of the device and
//  looks along +z, so for the child +x runs to their LEFT. Every x/y sketch
//  in this file is therefore the view from BEHIND - which is the view you
//  have with the tub's opening towards you, so it is also the view you
//  assemble in and the view the parts are printed in.
//
//  Origin = the corner of the component rectangle (127.12 x 80.59 mm) at
//  x = 0, y = 0. That is the bottom left of the sketches in this file and the
//  child's bottom RIGHT. Seen from the front everything reads mirrored, and
//  the front is the side docs/hardware.md describes: speaker top left, set
//  key below it, the four speech keys as a 2x2 block to the right of them.
//
//  Where a comment below says left or right without saying whose, it is the
//  CHILD'S - the model's x is named explicitly as +x or -x. The model was
//  once built the other way round, from a comment that claimed x ran right
//  for a viewer at the front while +z ran away from them; both halves cannot
//  be true at once, and a plate got printed mirrored before anyone noticed.
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
sk_total_depth        = 23.00;  // [M] cap front face to the back of the PCB,
                                //     key not pressed
sk_total_depth_pressed = 20.00; // [M] the same with the key pressed
sk_cap_travel = sk_total_depth - sk_total_depth_pressed;   // [G] 3.00

// Threaded spacers stand off the back of the PCB. THEY are what the mid plate
// bolts to, and they are the reason there is nothing printed in that gap: the
// module brings its own standoffs and they are 8 mm long.
sk_spacer_l   =  8.00;  // [M] length of the threaded spacers

// How far the cap stands proud of the front. Not a property of the module on
// its own - it follows from how deep the module is mounted, and the mounting
// depth is set by the mid plate and the spacers. 8.60 was what the first build
// came out at, screwed to bosses on the front plate, and it read as too sunken.
// Hung off the mid plate instead, the same module stands 1.0 mm further out.
sk_cap_overhang =  9.60;  // [K] and everything behind it follows

// How far the MOVING cap body reaches behind the front plate. That space has
// to stay clear over its whole depth, otherwise the key jams. When in doubt
// set it too large — this is the worst case (the whole module).
sk_cap_depth  = sk_total_depth - sk_cap_overhang;   // [G] 13.40
sk_image             = 15.21;  // [M] visible display area (for reference only)

// >>> THE number that is most likely wrong once the parts are unpacked. <<<
// Offset of the cap centre against the board centre, positive = upwards.
// In the product photos the pin header and the FPC connector sit at the
// bottom; if the cap is therefore offset upwards, enter the measured value
// here. All front cutouts, the logo and the checks follow along automatically.
cap_offset_y     =  0.00;  // [A] 0 = the cap sits centred
cap_offset_x     =  0.00;  // [A] the same sideways

// Mounting holes in the four board corners. Measured centre to centre on the
// module itself, not worked out from a margin off the board edge - that was
// the earlier guess (2.00 mm all round, so 21.94 x 31.29) and it was out by
// about a millimetre across and two thirds of one up. It is also not a single
// margin: 20 x 30 on a 25.94 x 35.29 board leaves 2.97 mm at the sides and
// 2.645 mm at top and bottom.
sk_hole_pitch_x   = 20.00;  // [M] spacing of the module's poles, across
sk_hole_pitch_y   = 30.00;  // [M] ... and up
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
// 12.00 is the floor, and two independent rules land almost on top of each
// other there. A child's hand wants at least 12 mm between caps or it presses
// two at once. And the BOARDS underneath want pitch_y > sk_board_h + 2, which
// is 11.99 - at gap 12 the ScreenKey PCBs are 2.01 mm apart.
//
// 14.00 is what is set, and the two millimetres are bought deliberately. At
// the floor three separate clearances on the carrier sat within 60 microns of
// their limits at once - board to board 2.010, ScreenKey screw to support post
// 0.509, Feather pad to peg hole 0.561 - and a first layer running 0.1 mm fat
// moves all of them together. Two millimetres of case width doubles the worst
// of those and adds half again to the board gap. The last millimetre of width
// costs every remaining margin in the part.
gap_block     = 14.00;  // [K] air between two speech caps, both directions
// The step out to the set key has its own absolute floor of 20 mm, separate
// from the ratio rule below - so it is written as the number, not as a
// multiple. 20/12 is still 1.67x the air inside the block.
gap_set_block = 20.00;                // [K] set cap to the nearest speech cap
pitch_x       = sk_cap_b + gap_block; // [G] 42.0  centre spacing across
pitch_y       = sk_cap_h + gap_block; // [G] 45.3  centre spacing up
gap_spk_set        =  5.00;  // [M] speaker to set board

/* --- the component rectangle follows from that ---
   The chain across runs the opposite way from the way the child reads the
   front, because +x points to the child's LEFT (see the header). So the block
   of four sits at the -x end and the speaker with the set key under it at the
   +x end - and from the front that is what docs/hardware.md describes:
   speaker top left, set key below it, the block to the right of them. */
env_h  = spk_frame + gap_spk_set + sk_board_h;             // [G] 80.59
// The two columns of the block are numbered the way the CHILD reads them,
// left to right - and in the file's x that runs downwards, so blk_mx1 is the
// larger of the two. Column 2 is the outer one; its board finishes flush with
// x = 0, which is what puts the rectangle's edge there.
blk_mx2 = sk_board_b/2;                                      // [G] 12.97
blk_mx1 = blk_mx2 + pitch_x;                                  // [G] 54.97
blk_my1 = sk_board_h/2;                                      // [G] 17.645  (flush at the bottom)
blk_my2 = blk_my1 + pitch_y;                                  // [G] 62.945
// Set key: gap_set_block of cap gap out from the near column of the block.
// A sideways cap offset cancels out, because ALL caps are offset the same way
// - the distance stays as it is.
set_mx = blk_mx1 + sk_cap_b + gap_set_block;                // [G] 106.97
set_my = sk_board_h/2;                                       // [G] 17.645
// The speaker's outer edge is the far edge of the rectangle.
env_b   = set_mx + spk_frame/2;                              // [G] 127.12

// Speaker at the +x end, and the set board sits sideways centred under it.
// From the front the two of them are the left-hand column, speaker on top.
spk_mx = set_mx;                                                // [G] 106.97
spk_my = env_h - spk_frame/2;                                   // [G] 60.44

// Centre points of all five boards. Left and right in the labels are the
// child's, as in docs/hardware.md - in the file's own x they are swapped.
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
boss_thread_l = 14.00;  // [K] how far the M3 bites into the boss. Not the
                     //     whole boss: a 46 mm pilot hole would be a pipe.
boss_clearance  = 1.00;   // [K] boss edge to the component rectangle

// Clearance between the component rectangle and the inner wall at carrier
// height. The value is NOT freely chosen but set by the lid bosses: they sit
// against the inner wall and must not touch a board. Lower limit 7.0 mm, so
// that inner_margin - standoff = 5.0 mm is left in the board plane - the
// value from docs/hardware.md.
inner_margin    = max(7.00, boss_d + boss_clearance);   // [G] 7.0 or 9.0

/* --- Depth budget --- */
sk_behind_front = sk_total_depth - sk_cap_overhang;   // [G] 13.40
// The gap between the back of the module and the mid plate is not a choice any
// more: it is exactly as long as the threaded spacers the module brings with
// it. Header, FPC connector and wires live in that same band, around the
// spacers - which is what the 6.00 mm here used to be reserving room for.
cable_space   = sk_spacer_l;   // [G] 8.00
part_clearance    = 0.60;   // [K] clearance between the tallest part and the lid
// The Feather's HEADER PINS go through the mid plate instead of the board
// standing off it. It used to be the tallest thing back here - 8.0 mm of board
// on 2.0 mm of standoff, reaching z 33.8 - and it, not the battery, set the
// depth of the case.
//
// The standoff was only ever there to give the pin tails somewhere to go. Give
// them a hole through the plate instead and the board lies straight on the
// plate's top face: top at z 31.8, just under the battery's 31.9, and the
// battery governs. That is the whole 1.9 mm.
//
// Worth being exact about, because the first attempt at this got it wrong in a
// way that looked right: it sank the board into a well on 1.2 mm pads. Same
// 1.9 mm, but the screw then had three threads of PLA to bite and the pads
// were the plate's bottom layers. The saving was never the sinking - it was
// deleting the standoff - so the pads are full plate thickness now and the M2
// gets six threads, which is what the lid bosses already rely on.
feather_pins_through = true;  // [K] false = back to standing on feather_support
feather_pad_d   = 4.50;   // [K] pad round each mounting hole. Deliberately
                          //     small: the nearest header pin is not far from
                          //     the corner hole. Dry-fit before printing five.
feather_screw_core = 1.60;  // [K] pilot for self-tapping M2, as sk_boss_core
                          //     was. NOT 2.10 - that is a clearance hole and
                          //     nothing would bite in it.

feather_support = 2.00;   // [K] standoff under the Feather. Do not make it
                          //     smaller: the solder pins of the headers
                          //     stick out that far underneath.
amp_support     = 2.00;   // [K] same under the amplifier

sk_board_z_v  = sk_behind_front - sk_board_d;         // [G] 11.80 front face
carrier_z_bottom     = sk_behind_front + cable_space;            // [G] 21.40 carrier underside
carrier_z_top     = carrier_z_bottom + carrier_d;                // [G] 23.80 carrier top side

// How high the inner space above the carrier has to be is set by the TALLEST
// part on the carrier - and that is not the battery but the Feather on its
// standoffs. Exactly that was wrong in the first draft: only the battery was
// in the budget there, and the Feather reached 1.3 mm into the lid.
// Measured as absolute z now, not as heights above the carrier, because the
// Feather no longer starts from the carrier's top face - it hangs INTO the
// plate. Mixing the two datums is how the first draft lost 1.3 mm into the lid.
feather_z_bottom = feather_pins_through ? carrier_z_top
                                        : carrier_z_top + feather_support;  // [G] 23.80
top_battery = carrier_z_top + battery_d;                  // [G] 31.90 <- governs
top_feather = feather_z_bottom + feather_h;               // [G] 30.60
top_amp     = carrier_z_top + amp_support + amp_d;        // [G] 28.80
parts_top   = max(top_battery, top_feather, top_amp);     // [G] 31.90

// Room ON TOP of what the parts themselves need. Measured on the first
// build: with the wiring actually in it the parts do not lie as flat as the
// stack-up says - the battery lead, the JST plug and the ribbon cables coming
// up through the carrier all want their bend radius, and the lid pressed on
// them. The carrier stays exactly where it is; the case grows backwards only.
// Was 14.00 after the first build, measured with the Feather standing proud on
// 2 mm standoffs and every cable running over the top of it. Sunk into the
// plate, the tallest thing left above the plate is the battery at 8.1 mm and
// the cables have somewhere flatter to lie. 6.00 is the estimate that replaces
// it - and it is the one number here still owed a measurement, because every
// millimetre of it is a millimetre of case.
extra_above_carrier =  6.00;  // [A] re-measure with the wiring actually in

inner_z_h       = parts_top + part_clearance
                  + extra_above_carrier;                // [G] 38.50
outer_t        = inner_z_h + lid_d;                     // [G] 41.50 total depth

/* --- Outer dimensions --- */
inner_b  = env_b + 2*inner_margin;      // [G] 141.12
inner_h  = env_h + 2*inner_margin;      // [G]  94.59
outer_b = inner_b + 2*wall;          // [G] 145.92
outer_h = inner_h + 2*wall;          // [G]  99.39
centre_x  = env_b/2;                   // [G]
centre_y  = env_h/2;                   // [G]

/* --- Tolerances --- */
gap_cap   = 0.30;   // [M] air all round the key cap in the front cutout.
                        //     0.60 came out visibly loose on the first build -
                        //     the cap floated in its hole. Still large enough
                        //     that the key never jams, still too narrow for a
                        //     child's finger to get in.
chamfer_key    = 0.80;   // [K] chamfer on the edge of the key cutout
cap_r       = 2.00;   // [K] corner radius of the key cutout
lid_play  = 0.40;   // [K] total play of the lid in the rebate
carrier_play = 0.40;   // [K] total play of the carrier
feather_play = 0.30;   // [K] air round the Feather in its well. Tighter than
                       //     the rest because the well has 25.00 mm to thread
                       //     between the set key's two rows of screws and the
                       //     board is 22.80 of it.

/* --- ScreenKey fixings -------------------------------------------------
   The modules screw from BEHIND, and the case contributes nothing to that but
   twenty holes. The thread is in the ScreenKey, the standoff is the module's
   own 8 mm threaded spacer, and the mid plate is simply what the screw pulls
   against: screw in from the lid side, through the plate, into the spacer.

   Two earlier attempts are worth remembering, because both were wrong in the
   same way - they had the case supplying something the module already brings.
   First the poles stood on the FRONT PLATE and the screw was meant to
   self-tap into printed plastic; that needs clearance holes in the board and
   the board has none. Then the poles moved to the mid plate and reached
   forward across the gap; but the gap is where the spacers are, so those
   poles were bridging a bridge. There is nothing printed here at all now, and
   the mid plate goes back to being a flat plate.                          */
sk_screw_d   = 2.40;  // [A] clearance hole for M2. MEASURE the spacer thread -
                     //     if it is M2.5 this and sk_csink_d both move.
sk_pad_d     = 5.00;  // [K] plate that has to stay round each hole: the
                     //     countersink plus half a millimetre of material
// The battery lies flat on the carrier, so the screw head has to disappear
// into it. 4.00 is a DIN 965 M2 head (3.8) plus clearance, and the depth is
// NOT free: at (d_head - d_shank)/2 the pocket is a 90 degree cone, which is
// the angle the head already has. Any deeper and the head only touches the
// mouth with its top edge, which on printed plastic is a line load on a sharp
// rim rather than a cone seating on a cone.
sk_csink_d   = 4.00;  // [K]
sk_csink_t   = (sk_csink_d - sk_screw_d)/2;   // [G] 0.80
sk_pad_wall  = (sk_pad_d - sk_csink_d)/2;     // [G] 0.50
sk_screw_engage = 4.00;  // [A] how deep the screw goes into the spacer.
                        //     Not more than sk_spacer_l, obviously.
sk_screw_l   = carrier_d + sk_screw_engage;   // [G] 6.40 -> M2x6

/* --- Carrier against the speaker chamber -------------------------------
   The horizontal chamber wall runs the full height of the inner space, so it
   passes straight THROUGH the carrier plane. The carrier has to stop short of
   it - and in the first draft it did not: its cutout started at
   chamber_y + chamber_wall + 0.2, which is 0.2 mm past the FAR side of that
   wall, so the plate ran through 2 mm of solid wall and the carrier would not
   go in. Measured on the first build; this is the number that fixes it.   */
carrier_chamber_gap = 2.80;  // [M] air below the horizontal chamber wall
carrier_chamber_x   = 0.80;  // [K] air beside the vertical chamber wall

/* --- Speaker chamber --- */
// As closed a volume as possible behind the driver. The chamber is formed by
// the front plate, two inset walls, two outer walls and the lid.
chamber_wall  = 2.00;   // [K]
chamber_clearance  = 2.00;   // [K] clearance between driver and chamber wall
// The chamber is at the +x end, with the speaker: chamber_x is its inner
// face at the -x side, the one the wall stands against, and from there it
// runs out to the inner wall.
chamber_x     = env_b - spk_frame - chamber_clearance;      // [G] 84.82 inner face towards -x
chamber_b     = env_b + inner_margin - chamber_x;           // [G] 49.30 inner width of the chamber
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

/* --- Positions inside (the -x, -y corner of each component) --- */
// All in component coordinates. The checks in section 4 verify that nothing
// overlaps - whoever moves something here gets an error message while
// rendering instead of a ruined print.
// Battery: on the other side of the speaker chamber from the speaker, so at
// the -x end, under the block of four. Sideways it balances the speaker;
// vertically it sits as low as the lower middle boss allows — its retaining
// ribs must not touch the boss. Result: centre of gravity practically at the
// middle of the case, see the echo in section 4.
battery_x    =  -3.00;  // [K] the counterweight belongs at whichever end the
                     //     speaker is not, and the block of four is the wider
                     //     end - 9 mm of case width to balance out again
battery_y    =   2.50;  // [K]

// Feather: board edge flush against the +x inner wall, so the USB-C socket
// reaches the case edge. That is the wall the speaker and the set key are
// nearest, the child's left-hand side, and it is the only wall this board
// can reach. Vertically into the lower strip, below the speaker chamber.
feather_x = env_b + inner_margin - feather_l;   // [G] 83.32
// Not free: the well has to pass BETWEEN the set key's two rows of screw pads.
// They leave 25.00 mm clear and the well is 23.40, so there are 0.8 mm of play
// each side and this number sits in the middle of them. verify.py holds it.
feather_y =   6.25;         // [K]

// Amplifier: on the -x side of the chamber wall, above the battery. The runs
// to the speaker are short there and the carrier is not cut away.
// (In the first draft it sat down in a corner — there its bed protruded
//  1.9 mm beyond the carrier edge and hit the case wall.)
amp_x     =  40.00;  // [K]
amp_y     =  58.50;  // [K]

// Retaining ribs on the carrier. The same numbers are used by the checks in
// section 4 and by the modules in section 8 - otherwise they drift apart.
rib_b     = 2.00;  // [K] thickness of one retaining rib
part_play = 0.40;  // [K] clearance between the component and the rib
bed_margin = rib_b + part_play;   // [G] 2.40 added all round

/* --- Lid bosses: 4 corners + middle top + middle bottom --- */
boss_e = inner_margin - boss_d/2;   // [G] 4.0 - boss axis away from the inner wall
// Left and right are the child's here too, so -x is their right.
boss_pos = [
  [ -boss_e        , -boss_e        ],   // bottom right
  [ env_b + boss_e , -boss_e        ],   // bottom left
  [ -boss_e        , env_h + boss_e ],   // top right
  [ env_b + boss_e , env_h + boss_e ],   // top left (sits inside the chamber)
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
  [ (blk_mx1 + blk_mx2)/2, blk_my1 ],   // 33.97 / 17.645
  [ (blk_mx1 + blk_mx2)/2, env_h/2 ],   // 33.97 / 40.295
  [ (blk_mx1 + blk_mx2)/2, blk_my2 ],   // 33.97 / 62.945
  // In the gap between the set board and the block of four. Do not put it
  // higher: at y = 8 the peg hole in the carrier sat 0.73 mm under one of the
  // Feather's standoffs, and the standoff would have started printing over
  // the edge of the hole.
  [ (set_mx + blk_mx1)/2, 4.0 ]                        // 80.97 / 4
];

/* --- Cable passages in the carrier --- */
// Rectangles [x1, y1, x2, y2]. These used to live inside carrier_outline().
// They are out here because the checks in section 4 have to know where they
// are: a ScreenKey screw that lands on one has nothing to pull against.
//
// There used to be a fourth, running up the gap between the set key and the
// block. The Feather's well occupies that gap now and is a far bigger opening
// than the slot ever was, so the slot went rather than being squeezed into the
// 5 mm of plate left beside it.
carrier_slots = [
  [ (blk_mx1+blk_mx2)/2 - 2.5, blk_my1 - 13,
    (blk_mx1+blk_mx2)/2 + 2.5, blk_my1 + 13 ],
  [ (blk_mx1+blk_mx2)/2 - 2.5, blk_my2 - 13,
    (blk_mx1+blk_mx2)/2 + 2.5, blk_my2 + 13 ],
  [ env_b/2 - 4, env_h + inner_margin - 6, env_b/2 + 4, env_h + inner_margin + 2 ]
];


/* --- Feet on the lid --- */
// The feet only ever existed because the logo stood proud of the lid: without
// them the device lay on a 70 mm speech bubble and nothing else, rocked, and
// wore the embossing through. The logo is cut INTO the lid now (see below),
// so the lid is a flat face again and rests on all of itself. The feet have
// nothing left to do - and a flat back is the better back for a device a
// child pushes around a table.
// One word brings them back: the geometry and every check below still stand.
feet_on      = false;   // [K]
feet_d       = 10.00;   // [K]
feet_h       =  1.60;   // [K] 8 layers - leaves 0.8 mm of air under the logo
feet_x       = 58.00;   // [K] from the lid centre. Clear of the corner screws
feet_y       = 38.00;   // [K] and clear of the logo - checked in section 4.
feet_chamfer =  0.40;   // [K] broken edge, so the pad does not peel

/* --- Logo --- */
// Speech bubble with two eyes and a smile, rebuilt from assets/icon.svg
// (not imported - see building.md).
//
// Cut IN, not standing out. Proud was the earlier decision, and it cost the
// four feet to make it work at all - the lid is the back of the device, and
// whatever stands proudest of it is what the device lies on. Recessed, the
// lid is flat again, nothing wears through, and the feet go away with it.
// The two numbers below stop being heights and become depths; nothing else
// about them changes.
logo_recessed = true;   // [K] false = the old raised logo, feet needed again
logo_lid_b   = 70.00;  // [K] width of the speech bubble on the lid
logo_lid_h   =  0.80;  // [K] depth of the engraving, 4 layers at 0.2 mm
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

/* --- The ScreenKey screw holes ---------------------------------------
   This used to be the most delicate place in the whole design, and it is not
   any more. Worth knowing why, because the reasoning is now the other way up.

   While the bosses stood on the FRONT PLATE they sat between plate and board,
   right beside the moving cap. The cap is 25.30 mm high, its holes 15.645 mm
   off centre: 2.995 mm between cap edge and hole centre, of which the boss
   wanted 1.8 mm and the air gap 0.6 mm. That left 0.595 mm of budget for
   cap_offset_y before a boss had to be dropped, and a whole apparatus to drop
   it with.

   There is no boss anywhere now. The module hangs off the mid plate on its
   own threaded spacers and the case contributes twenty holes, all of them
   behind the board, in a place the cap never reaches. cap_offset_y has no
   budget left to run out of - it only has to keep the cap over its own board,
   which is the assert below.

   What the holes have to clear instead is what else is on the CARRIER: the
   cable slots, the lid bosses, the carrier's own support posts and the
   cut-away over the speaker chamber. All four are checked further down, where
   the rest of the carrier is checked.                                    */

// Half-sizes of the front cutout. Nothing structural hangs off them any more
// - they are here because the echo and verify.py report them.
clear_hb = (sk_cap_b + 2*gap_cap)/2;      // [G] 11.30
clear_hh = (sk_cap_h + 2*gap_cap)/2;      // [G] 12.95
sk_hole_dx  = sk_hole_pitch_x/2;                   // [G] 10.00
sk_hole_dy  = sk_hole_pitch_y/2;                   // [G] 15.00
sk_pad_r    = sk_pad_d/2;                          // [G]  2.50

// All twenty screw positions, in component coordinates.
sk_pole_pos = [ for (p = sk_pos, sx = [-1,1], sy = [-1,1])
                  [ p[0] + sx*sk_hole_dx, p[1] + sy*sk_hole_dy ] ];

// The spacers are the standoff, so the mid plate has to land exactly one
// spacer behind the module. Both sides of this come from measurements, and if
// they stop agreeing the caps stand at the wrong depth.
assert(abs(carrier_z_bottom - (sk_behind_front + sk_spacer_l)) < 0.001,
  str("The mid plate sits at ", carrier_z_bottom, " mm but the module plus ",
      "its ", sk_spacer_l, " mm spacers reaches ", sk_behind_front + sk_spacer_l,
      " mm. The screws would have to pull the plate ",
      carrier_z_bottom - sk_behind_front - sk_spacer_l, " mm out of place."));

assert(sk_screw_engage <= sk_spacer_l,
  str("The screw is meant to go ", sk_screw_engage, " mm into a spacer only ",
      sk_spacer_l, " mm long."));

assert(sk_pad_wall >= 0.4,
  str("Only ", sk_pad_wall, " mm of plate left round the countersink mouth. ",
      "Widen sk_pad_d."));

assert(sk_hole_dx + sk_screw_d/2 <= sk_board_b/2 &&
       sk_hole_dy + sk_screw_d/2 <= sk_board_h/2,
  str("The screw holes run off the edge of the ScreenKey board: the pitch is ",
      sk_hole_pitch_x, " x ", sk_hole_pitch_y, " on a board ", sk_board_b,
      " x ", sk_board_h, ". One of the two was measured on the wrong thing."));

assert(sk_csink_t <= carrier_d - 0.8,
  str("The countersink is ", sk_csink_t, " mm deep in a ", carrier_d,
      " mm plate - less than 0.8 mm of plate left under the screw head."));

// The key has to still be a key when it is pressed all the way in.
assert(sk_cap_overhang - sk_cap_travel >= 3.0,
  str("Pressed all the way, the cap stands only ",
      sk_cap_overhang - sk_cap_travel, " mm out of the front plate. A child ",
      "finds that with a fingernail, not with a hand."));

// The one thing cap_offset_y still has to do.
assert(sk_board_h/2 - (sk_cap_h/2 + abs(cap_offset_y)) >= 0.5 &&
       sk_board_b/2 - (sk_cap_b/2 + abs(cap_offset_x)) >= 0.5,
  str("At cap_offset = [", cap_offset_x, ", ", cap_offset_y, "] the cap hangs ",
      "over the edge of its own board. That is no longer a question of what ",
      "holds it - measure the module again."));

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
   Instead of individual hand checks ("is the battery beside the amp?") there is a
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

// fixed = follows from the case itself. Lid boss 3 standing INSIDE the
// speaker chamber is intended (there is nothing but clearance there anyway),
// so the fixed obstacles are not checked against each other.
// The chamber rectangle runs from the outer face of its wall out to the +x
// inner wall - the same band chamber_walls() builds.
obstacles = concat(
  [ ["chamber",  [chamber_x - chamber_wall, chamber_y, env_b + inner_margin, env_h + inner_margin]] ],
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

/* --- The ScreenKey screws against the rest of the carrier -------------
   Twenty places on this plate have to be plate: a clearance hole through, a
   countersink in the back face, and material all round both. So every one of
   them is held against everything else that is cut out of, or stands on, that
   plate.                                                                */

carrier_cut_y = chamber_y - carrier_chamber_gap;                // [G] 34.49
// The cutout stops carrier_chamber_x short of the wall's outer face. The wall
// is on the -x side of the chamber, so the cutout is everything ABOVE and
// BEYOND this x, not below it.
carrier_cut_x = chamber_x - chamber_wall - carrier_chamber_x;   // [G] 82.02

carrier_plate = [ centre_x - (inner_b - carrier_play)/2,
                  centre_y - (inner_h - carrier_play)/2,
                  centre_x + (inner_b - carrier_play)/2,
                  centre_y + (inner_h - carrier_play)/2 ];

function pad_rect(q) = [ q[0] - sk_pad_r, q[1] - sk_pad_r,
                         q[0] + sk_pad_r, q[1] + sk_pad_r ];

// a) a screw over a cable slot has nothing to pull against
poles_on_slots = [ for (q = sk_pole_pos, sl = carrier_slots)
                     if (overlaps(pad_rect(q), sl))
                       str("[", q[0], ", ", q[1], "]") ];
assert(len(poles_on_slots) == 0,
  str("These ScreenKey screws land on a cable slot in the carrier: ",
      poles_on_slots, ". Move the slot in carrier_slots, not the screw - the ",
      "positions come from the module."));

// b) the cut-away over the speaker chamber. The set key sits low enough that
//    its two upper screws reach into that cutout, so the cutout keeps a tab
//    under each of them (see carrier_outline()). A tab is only allowed as
//    long as it still stops short of the chamber wall.
pole_tabs = [ for (q = sk_pole_pos)
                if (q[0] + sk_pad_r > carrier_cut_x && q[1] + sk_pad_r > carrier_cut_y)
                  q[1] + sk_pad_r ];
tab_top = len(pole_tabs) > 0 ? max(pole_tabs) : carrier_cut_y;
assert(tab_top <= chamber_y - 1.0,
  str("A tab under a ScreenKey screw reaches to y = ", tab_top,
      " and the chamber wall starts at ", chamber_y,
      ". That is the collision the carrier was rebuilt to get rid of - the ",
      "plate would run into the wall again."));

// c) lid bosses. The carrier is relieved around each of them by 0.6 mm, and
//    that relief must not eat into the material round a screw.
pole_to_boss = min([ for (q = sk_pole_pos, d = boss_pos)
                       norm([q[0]-d[0], q[1]-d[1]]) - sk_pad_r - (boss_d + 1.2)/2 ]);
assert(pole_to_boss >= 0.2,
  str("A ScreenKey screw and the relief round a lid boss are ", pole_to_boss,
      " mm apart. Below that the countersink breaks into the relief."));

// d) the carrier's own support posts. Their locating pegs come up through the
//    same plate the screws go down through.
pole_to_support = min([ for (q = sk_pole_pos, sp = support_pos)
                          norm([q[0]-sp[0], q[1]-sp[1]]) - sk_pad_r - support_d/2 ]);
assert(pole_to_support >= 0.5,
  str("A ScreenKey screw and a carrier support post are ", pole_to_support,
      " mm apart in plan. They overlap."));

// e) the Feather's well. It is by far the biggest hole in this plate and it
//    lands right under the set key, so it is the one most likely to swallow a
//    screw. Found by hand at feather_y = 8.00, which ate the set key's two
//    upper pads - this is the check that would have said so.
feather_well = [ feather_x - feather_play, feather_y - feather_play,
                 feather_x + feather_l + feather_play,
                 feather_y + feather_b + feather_play ];
poles_in_well = [ for (q = sk_pole_pos)
                    if (feather_pins_through && overlaps(pad_rect(q), feather_well))
                      str("[", q[0], ", ", q[1], "]") ];
assert(len(poles_in_well) == 0,
  str("The Feather's well swallows these ScreenKey screws: ", poles_in_well,
      ". The well has to thread between the set key's two rows of screws - ",
      "move feather_y, not the screws."));

// f) ... and the pads the Feather rests on have to hang off real plate, so
//    they must not sit inside a cable slot either.
feather_seats = [ for (sx = [-1,1], sy = [-1,1])
                    [ feather_x + feather_l/2 + sx*feather_hole_l/2,
                      feather_y + feather_b/2 + sy*feather_hole_b/2 ] ];
seats_on_slots = [ for (q = feather_seats, sl = carrier_slots)
                     if (feather_pins_through && overlaps(pad_rect(q), sl))
                       str("[", q[0], ", ", q[1], "]") ];
assert(len(seats_on_slots) == 0,
  str("These Feather seat pads sit over a cable slot: ", seats_on_slots,
      ". A pad with nothing round it is an island in a hole - it does not ",
      "print and it holds nothing."));

// e) and all twenty have to be ON the plate in the first place
poles_off_plate = [ for (q = sk_pole_pos)
                      if (q[0] - sk_pad_r < carrier_plate[0] ||
                          q[1] - sk_pad_r < carrier_plate[1] ||
                          q[0] + sk_pad_r > carrier_plate[2] ||
                          q[1] + sk_pad_r > carrier_plate[3])
                        str("[", q[0], ", ", q[1], "]") ];
assert(len(poles_off_plate) == 0,
  str("These ScreenKey screws sit over the edge of the carrier: ",
      poles_off_plate));

/* --- USB-C window has to fit between carrier and lid --- */
// Measured off the BOARD, wherever the board happens to sit. With the Feather
// sunk that is 3.2 mm lower than it used to be, which puts the window level
// with the mid plate rather than above it - so the plate is notched there.
// It gets that notch for free: the Feather's own cutout reaches the plate edge.
usb_z    = feather_z_bottom + feather_pcb_d + usb_centre_above_pcb;
usb_win_h = usb_socket_h + 1.4;
// The board lies on the plate's top face whichever way it is mounted, so the
// window is above the plate either way - it just sits 2.0 mm lower without the
// standoff under it, and that is the whole clearance there is to check.
assert(usb_z - usb_win_h/2 > carrier_z_top + 0.6,
  str("The USB window runs from z = ", usb_z - usb_win_h/2, " to ",
      usb_z + usb_win_h/2, " and the mid plate sits at ", carrier_z_bottom,
      " .. ", carrier_z_top, ". The socket would have to cut the plate ",
      "somewhere it is not notched."));
// ... and the well has to run out to the plate edge, or the plate stands in
// front of the socket instead of the wall doing it.
assert(!feather_pins_through ||
       feather_x + feather_l + feather_play >= env_b + inner_margin - carrier_play/2,
  str("The Feather's well stops ",
      env_b + inner_margin - carrier_play/2 - (feather_x + feather_l + feather_play),
      " mm short of the carrier edge, so the plate is not notched at the USB ",
      "window and the socket runs into it."));
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

/* --- What the device lies on -----------------------------------------
   The lid is the back, so whatever stands proudest of it is what the device
   rests on. There are two ways to be right about that and one way to be
   wrong. Right: the logo is cut in and the lid is flat (feet pointless), or
   the logo stands proud and feet stand higher still. Wrong: a raised logo and
   no feet - then the thing rocks on its speech bubble and wears it through.*/
assert(logo_recessed || feet_on,
  str("A raised logo and no feet: the device would lie on the speech bubble, ",
      "rock on the table and wear the embossing through. Either set ",
      "logo_recessed = true, or feet_on = true."));

// A foot no taller than the logo does nothing at all, and one that grows into
// a countersink stops the screw sitting flush.
feet_to_screw = min([ for (p = boss_pos)
                      norm([abs(p[0] - centre_x) - feet_x,
                            abs(p[1] - centre_y) - feet_y]) ])
                - feet_d/2 - csink_d/2;
assert(!feet_on || logo_recessed || feet_h > logo_lid_h + 0.3,
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
         round(chamber_b*(env_h+inner_margin-chamber_y)*inner_t/100)/10,
         " cm3, less the driver approx. ",
         round((chamber_b*(env_h+inner_margin-chamber_y)*inner_t
                - spk_frame*spk_frame*spk_depth)/100)/10, " cm3"));
echo(str("centre of gravity battery+speaker: x=", round(sp_x*10)/10,
         " (middle ", round(centre_x*10)/10, "), y=", round(sp_y*10)/10,
         " (middle ", round(centre_y*10)/10, ")"));
echo(str("cap offset          : ", cap_offset_x, " / ", cap_offset_y,
         " mm - free, nothing in front of the board holds it. Room left over ",
         "the board: ", round((sk_board_h/2 - sk_cap_h/2 - abs(cap_offset_y))*100)/100,
         " mm up, ",
         round((sk_board_b/2 - sk_cap_b/2 - abs(cap_offset_x))*100)/100,
         " mm across"));
echo(str("ScreenKey fixing    : 4 x M2 per key from the mid plate side into ",
         "the module's own ", sk_spacer_l, " mm spacers, screw ", sk_screw_l,
         " mm -> M2x6. Nothing printed in that gap."));
echo(str("ScreenKey hole grid : ", sk_hole_pitch_x, " x ", sk_hole_pitch_y,
         " mm, leaving ", round((sk_board_b - sk_hole_pitch_x)/2*1000)/1000,
         " mm at the sides and ",
         round((sk_board_h - sk_hole_pitch_y)/2*1000)/1000,
         " mm top and bottom of the board"));
echo(str("key cap             : ", sk_cap_overhang, " mm proud, ",
         sk_cap_overhang - sk_cap_travel, " mm pressed (travel ",
         sk_cap_travel, " mm)"));
echo(str("speaker fixing      : ", spk_front_screws ?
         "4 x M2.5 through the front, heads visible, nut in the chamber" :
         "none - foam behind the driver, the lid clamps it"));
echo(str("logo                : ", logo_recessed ?
         str(logo_lid_h, " mm deep, cut into the lid") :
         str(logo_lid_h, " mm proud of the lid")));
echo(str("lid feet            : ", feet_on ?
         str(feet_h, " mm proud") :
         logo_recessed ? "none - the lid is flat and lies on all of itself"
                       : "none - the device rests on its logo!"));
echo(str("screws              : ", threaded_insert ? "M3 threaded inserts" :
         "M3 self-tapping", ", boss ", boss_d, " mm, pilot hole ", boss_core));
echo(str("wall ", wall, " mm = ", wall/0.4, " passes with a 0.4 nozzle"));
echo(str("print bed needed    : tub ", outer_b, " x ", outer_h,
         " mm, ", outer_t, " mm tall"));
echo(str("carrier printing    : flat, ribs up, no support"));
echo(str("Feather             : ", feather_pins_through ?
         str("pins through the plate, board flat on it at z = ",
             feather_z_bottom, ", top at ", top_feather,
             ", M2 into ", carrier_d, " mm of plate")
       : str("standing on ", feather_support, " mm standoffs, top at ",
             top_feather)));
echo(str("what governs the depth: ",
         parts_top == top_battery ? "battery" :
         parts_top == top_feather ? "Feather" : "amplifier",
         ", top at z = ", parts_top, ", then ", part_clearance,
         " mm clearance + ", extra_above_carrier, " mm cable headroom"));
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

// The same shape as a pocket, to be subtracted. The two steps survive, turned
// over: narrow at the floor, full width at the MOUTH. That is also the
// printable way round - the void only ever widens going up, so every layer of
// material stands on a layer that had more of it. Exactly the argument the
// screw countersinks in the lid are already built on.
// The mouth is extruded 0.02 mm proud so the difference() has no coplanar
// faces to argue about.
module logo_pocket(width, depth) {
  step = min(0.4, depth/2);
  linear_extrude(depth - step) offset(r = -0.4) logo_2d(width);
  translate([0,0,depth - step]) linear_extrude(step + 0.02) logo_2d(width);
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

   The first draft had only a flat hole through the front plate here, and back
   then there were also boss foot cones standing in the way - recalculated,
   those reached 0.755 mm into the cap and the key would have jammed at all
   five places at once. The bosses are gone from the tub entirely now, but the
   solid stays: the cap still has to be able to move.

   It moves along with cap_offset, so the path stays clear whatever is entered
   there. Nothing else in the tub depends on that number any more.       */
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

/* --- The ScreenKeys are NOT held by the tub --------------------------
   There is deliberately nothing here. The five modules hang off the carrier
   (section 8) and the front plate only gives their caps a hole to come
   through. What the tub still owes them is clearance, and that is
   cap_clearance() above.                                                */

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
  // vertical wall on the -x side of the chamber, thickened at the bottom
  // (carrier ledge). The thickening grows away from the chamber, into the
  // board plane, the same way the ledge steps in all round.
  translate([chamber_x - chamber_wall, chamber_y, front_d])
    cube([chamber_wall, env_h + inner_margin - chamber_y, h]);
  translate([chamber_x - chamber_wall - standoff, chamber_y, front_d])
    cube([chamber_wall + standoff, env_h + inner_margin - chamber_y,
          carrier_z_bottom - front_d]);
  // horizontal wall under the speaker
  translate([chamber_x - chamber_wall, chamber_y, front_d])
    cube([chamber_b + chamber_wall, chamber_wall, h]);
}

module chamber_cable() {   // passage for the speaker wires
  translate([chamber_x - chamber_wall - standoff - 1, chamber_y + 6, front_d + 2])
    cube([chamber_wall + standoff + 2, 7, 5]);
}

/* --- Lid bosses --- */
module lid_dome() {
  for (p = boss_pos) translate([p[0], p[1], front_d])
    cylinder(d = boss_d, h = inner_z_h - front_d);
}
module lid_dome_core() {
  for (p = boss_pos) translate([p[0], p[1], inner_z_h - boss_thread_l])
    cylinder(d = boss_core, h = boss_thread_l + 1);
}

/* --- Carrier supports --- */
module carrier_supports() {
  for (p = support_pos) translate([p[0], p[1], front_d]) {
    cylinder(d = support_d, h = carrier_z_bottom - front_d);
    translate([0,0,carrier_z_bottom - front_d]) cylinder(d = peg_d, h = peg_h);
  }
}

/* --- USB-C window in the +x wall --- */
// The same wall the speaker and the set key are nearest, so from the front
// the socket is on the child's left. The Feather lies against that wall and
// no other, which is what puts the window here.
// Deliberately tight: the wall takes the side loads, not the soldered socket.
// The cable bend rests on the outside, that is the strain relief.
module usb_window() {
  fb = usb_socket_b + 1.4;
  fh = usb_win_h;
  yc = feather_y + feather_b/2;
  translate([env_b + inner_margin - 2, yc, usb_z]) rotate([0,90,0])
    linear_extrude(wall + 4) rrect(fh, fb, 1.0);
  // local wall pocket, so the socket can move into the opening
  translate([env_b + inner_margin - 0.2, yc, usb_z]) rotate([0,90,0])
    linear_extrude(1.4) rrect(fh + 4, fb + 5, 1.5);
}

/* --- Logo on the bottom edge --- */
// Placed the same way round whether it stands out or is cut in; only the
// solid changes. The pocket starts logo_side_h further INTO the wall, so that
// what ends up on the outer face is its mouth and not its floor.
module logo_bottom_edge() {
  if (logo_side_on)
    translate([centre_x,
               -inner_margin - wall + (logo_recessed ? logo_side_h : 0),
               outer_t/2])
      rotate([90,0,0]) rotate([0,0,180]) mirror([1,0,0]) {
        if (logo_recessed) logo_pocket(logo_side_b, logo_side_h);
        else               logo_3d(logo_side_b, logo_side_h);
      }
}

module tub() {
  difference() {
    union() {
      difference() { outer_body(); cavity(); }
      lid_dome();
      carrier_supports();
      chamber_walls();
      spk_ribs();
      if (!logo_recessed) logo_bottom_edge();
    }
    cap_clearance();
    spk_grille();
    spk_screws();
    lid_dome_core();
    usb_window();
    chamber_cable();
    if (logo_recessed) logo_bottom_edge();
  }
}

/* =====================================================================
   8.  CARRIER  (intermediate floor)
   Separates the ScreenKey wiring from the battery - a LiPo must never press
   on connector pins - and, since the first build, HOLDS the five ScreenKeys.
   It does that second job with nothing but holes: the modules stand off it on
   their own 8 mm threaded spacers, so this is still a flat plate with ribs on
   one side, and it still prints flat with no support anywhere.
   ===================================================================== */

// The footprint that has to stay behind under every screw: the countersink
// mouth plus a little material. Used to keep the chamber cutout from eating
// into one - see the tabs in carrier_outline().
module sk_pole_pads_2d() {
  for (q = sk_pole_pos) translate(q) circle(d = sk_pad_d);
}

module carrier_outline() {
  difference() {
    translate([centre_x, centre_y])
      rrect(inner_b - carrier_play, inner_h - carrier_play, corner_r - wall);
    // Cutout for the speaker chamber. It stops BELOW the horizontal chamber
    // wall now. It used to stop 0.2 mm past the far side of that wall, which
    // is a place the wall itself already occupies - so the plate ran through
    // 2 mm of solid PLA and the carrier simply would not go in.
    // The two upper screws of the set key reach into this region, so the
    // cutout gives each of them its pad back. Without that, the cut would run
    // straight through their countersinks.
    difference() {
      translate([carrier_cut_x, carrier_cut_y])
        square([env_b + inner_margin + 1 - carrier_cut_x,
                env_h + inner_margin - carrier_cut_y + 2]);
      sk_pole_pads_2d();
    }
    // reliefs around the lid bosses
    for (p = boss_pos) translate(p) circle(d = boss_d + 1.2);
    // holes over the locating pegs
    for (p = support_pos) translate(p) circle(d = peg_d + 0.4);
    // cable passages: slots in the gaps between the boards
    for (sl = carrier_slots)
      translate([sl[0], sl[1]]) square([sl[2] - sl[0], sl[3] - sl[1]]);
    // The well the Feather's pins drop through: its footprint, less the four
    // pads it rests and screws on. Those are ordinary plate, full thickness -
    // they are what is LEFT of the plate, not something added back to it.
    if (feather_pins_through)
      difference() {
        translate([feather_x - feather_play, feather_y - feather_play])
          square([feather_l + 2*feather_play, feather_b + 2*feather_play]);
        feather_pads_2d();
      }
    // and the pilot holes through those pads
    if (feather_pins_through)
      for (q = feather_seats) translate(q) circle(d = feather_screw_core);
  }
}

/* --- What the Feather rests and screws on -----------------------------
   A pad at each mounting hole, hulled outward to the edge of the well so it
   hangs off the surrounding plate rather than floating in the hole. The board
   lies on these, its pin tails go through the well beside them, and an M2
   self-taps down into 2.4 mm of plate.                                   */
module feather_pads_2d() {
  for (sx = [-1,1], sy = [-1,1])
    translate([feather_x + feather_l/2 + sx*feather_hole_l/2,
               feather_y + feather_b/2 + sy*feather_hole_b/2])
      hull() {
        circle(d = feather_pad_d);
        translate([0, sy*4.0]) circle(d = 3.0);
      }
}

/* --- The ScreenKey screw holes ---------------------------------------
   All the carrier contributes to holding five modules: twenty clearance holes
   and twenty countersinks. The standoff is the module's own threaded spacer,
   so there is nothing to print here - which is also why this part still lies
   flat on the bed.

   The countersink goes in the BACK face, because the battery lies flat on
   that face and a proud head would press into it. Cut before the retaining
   ribs go on, so a rib that happens to cross a countersink bridges it instead
   of being slotted through its whole height - two of the four battery
   brackets do exactly that.                                              */
module sk_screw_holes() {
  for (q = sk_pole_pos) translate([q[0], q[1], 0]) {
    translate([0, 0, -1]) cylinder(d = sk_screw_d, h = carrier_d + 2);
    translate([0, 0, carrier_d - sk_csink_t])
      cylinder(d1 = sk_screw_d, d2 = sk_csink_d, h = sk_csink_t + 0.01);
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
      // Only when the board stands off the plate. With its pins going through
      // it, the board lies straight on the plate and these would lift it back
      // up by exactly the 2.0 mm the change was made to remove.
      if (!feather_pins_through) feather_standoff();
      amp_bed();
    }
    linear_extrude(100) translate([centre_x, centre_y])
      rrect(inner_b - carrier_play, inner_h - carrier_play, corner_r - wall);
  }
}

module carrier() {
  translate([0, 0, carrier_z_bottom]) {
    difference() {
      linear_extrude(carrier_d) carrier_outline();
      sk_screw_holes();
    }
    translate([0, 0, carrier_d]) carrier_additions();
  }
}


/* =====================================================================
   9.  LID
   Flat plate, completely smooth on the inside. Prints with the inside on the
   bed and the logo upwards. Cut in rather than raised, the logo asks even
   less of the printer than the embossing did: it is a pocket that only ever
   widens going up, so there is no overhang anywhere on this part and nothing
   at all standing proud of the outer face.
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
      if (!logo_recessed) translate([0, 0, lid_d]) logo_3d(logo_lid_b, logo_lid_h);
      lid_feet();
    }
    if (logo_recessed)
      translate([0, 0, lid_d - logo_lid_h]) logo_pocket(logo_lid_b, logo_lid_h);
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
  color("#c8c0e0") translate([0,0,45]) carrier();
  color("#b8aed8") translate([0,0,85]) lid();
}
else if (part == "printbed") {
  // all three parts side by side, each in its print orientation
  tub();
  translate([0, outer_h + 8, -carrier_z_bottom]) carrier();
  translate([0, 2*outer_h + 16, -inner_z_h]) lid();
}
