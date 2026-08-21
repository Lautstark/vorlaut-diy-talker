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
//  (117.12 x 80.59 mm), seen from the front, y points up. z = 0 is the
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
   1.  BAUTEILMASSE
   ===================================================================== */

/* --- Waveshare ScreenKey (5x) --- */
sk_board_b        = 25.94;  // [M] Platine breit
sk_board_h        = 35.29;  // [M] Platine hoch
sk_board_d        = 1.60;   // [A] Platinendicke, typisch FR4
sk_cap_b          = 22.00;  // [M] Tastenkappe breit
sk_cap_h          = 25.30;  // [M] Tastenkappe hoch
sk_cap_overhang =  8.60;  // [M] wie weit die Kappe vor der Front steht
sk_total_depth      = 24.00;  // [M] cap front face to module back
// How far the MOVING cap body reaches behind the front plate. That space has
// to stay clear over its whole depth, otherwise the key jams. When in doubt
// set it too large — this is the worst case (the whole module).
sk_cap_depth      = 15.40;  // [A] = sk_total_depth - sk_cap_overhang
sk_image             = 15.21;  // [M] visible display area (for reference only)

// >>> DIE Zahl, die nach dem Auspacken wahrscheinlich falsch ist. <<<
// Offset of the cap centre against the board centre, positive = upwards.
// Auf den Produktbildern liegen Stiftleiste und FPC-Stecker unten; wenn die
// Kappe deshalb nach oben versetzt sitzt, hier den gemessenen Wert eintragen.
// All front cutouts, the logo and the checks follow along automatically.
cap_offset_y     =  0.00;  // [A] 0 = Kappe sitzt mittig
cap_offset_x     =  0.00;  // [A] dito waagerecht

// Mounting holes in the four board corners
sk_hole_margin        =  2.00;  // [A] Lochmitte von der Platinenkante
sk_hole_d           =  2.20;  // [A] Lochdurchmesser (M2)

/* --- Lautsprecher 40 mm --- */
spk_frame           = 40.30;  // [M] quadratischer Rahmen
spk_depth            = 25.30;  // [M]
spk_cone_d        = 32.70;  // [M]
spk_hole_diagonal   = 46.20;  // [M] diagonal across the four mounting holes
spk_hole_a           = spk_hole_diagonal / sqrt(2);  // [G] = 32.67 mm edge dimension
spk_screw_d       =  2.90;  // [A] clearance hole for M2.5

/* --- Adafruit ESP32-S3 Feather --- */
feather_l           = 50.80;  // [R] 2,0"
feather_b           = 22.80;  // [R] 0,9"
feather_h           =  8.00;  // [A] total height with soldered headers
feather_pcb_d       =  1.60;  // [A] Platinendicke, typisch FR4
feather_hole_l      = 45.72;  // [R] hole spacing lengthwise (Feather spec: 0.1" margin)
feather_hole_b      = 17.78;  // [R] Lochabstand quer
feather_hole_d      =  2.50;  // [R]
// USB-C socket: sits centred on one short side, body approx. 9.0 x 3.2 mm,
// protrudes approx. 1.5 mm beyond the board edge.
usb_buchse_b        =  9.00;  // [R]
usb_buchse_h        =  3.20;  // [R]
usb_overhang      =  1.50;  // [A] how far the socket protrudes past the edge
usb_centre_above_pcb =  1.60;  // [A] socket centre above the board top

/* --- LiPo --- */
battery_b              = 63.00;  // [M]
battery_h              = 50.30;  // [M]
battery_d              =  8.10;  // [M]
// 52 g — das schwerste Einzelteil. Position siehe Abschnitt 3.

/* --- Amplifier MAX98357A (Adafruit 3006) --- */
amp_b               = 19.40;  // [R] adafruit.com/product/3006
amp_h               = 17.80;  // [R]
amp_d               =  3.00;  // [R] ohne Stiftleiste


/* =====================================================================
   2.  ANORDNUNG DER BEDIENTEILE  (festgelegt, siehe docs/hardware.md)
   ===================================================================== */

pitch_x            = 37.00;  // [M] Mittenabstand der Sprechtasten waagerecht
pitch_y            = 45.30;  // [M] Mittenabstand senkrecht
gap_set_block     = 25.00;  // [M] set key cap to the nearest speech cap
gap_spk_set        =  5.00;  // [M] Lautsprecher bis Set-Platine

/* --- daraus folgt das Bauteil-Rechteck --- */
env_h  = spk_frame + gap_spk_set + sk_board_h;             // [G] 80,59
// Set-Platine sitzt waagerecht mittig unter dem Lautsprecher
set_mx = spk_frame/2;                                          // [G] 20,15
set_my = sk_board_h/2;                                       // [G] 17,645
// Linke Spalte des Viererblocks: Kappenspalt 25 mm zur Set-Kappe
// Kappenspalt 25 mm zur Set-Kappe. Ein waagerechter Kappenversatz hebt sich
// heraus, weil ALLE Kappen gleich versetzt sind — der Abstand bleibt gleich.
blk_mx1 = set_mx + sk_cap_b + gap_set_block;                // [G] 67,15
blk_mx2 = blk_mx1 + pitch_x;                                  // [G] 104,15
blk_my1 = sk_board_h/2;                                      // [G] 17.645  (flush at the bottom)
blk_my2 = blk_my1 + pitch_y;                                  // [G] 62,945
env_b   = blk_mx2 + sk_board_b/2;                            // [G] 117,12

// Lautsprecher oben links
spk_mx = spk_frame/2;                                           // [G] 20,15
spk_my = env_h - spk_frame/2;                                   // [G] 60,44

// Centre points of all five boards
sk_pos = [ [set_mx , set_my ],      // 0 = Set-Taste
           [blk_mx1, blk_my1],      // 1 = unten links
           [blk_mx2, blk_my1],      // 2 = unten rechts
           [blk_mx1, blk_my2],      // 3 = oben links
           [blk_mx2, blk_my2] ];    // 4 = oben rechts


/* =====================================================================
   3.  CASE — design parameters
   ===================================================================== */

/* --- Wall thicknesses and radii --- */
wall          = 2.40;   // [K] 6 passes with a 0.4 nozzle — stiff, prints reliably
front_d       = 2.40;   // [K] Frontplatte
lid_d      = 3.00;   // [K] lid thicker: carries the countersunk screws
carrier_d     = 2.40;   // [K] Zwischenboden
standoff        = 2.00;   // [K] Wandverdickung in der Platinenebene.
                        //     Creates the surrounding ledge for the carrier.
lip         = 1.20;   // [K] remaining outer skin above the lid rebate
corner_r        = 6.00;   // [K] outer corner radius — nothing sharp for the child
chamfer_front     = 1.20;   // [K] 45°-Fase rundum an der Frontkante
chamfer_rear   = 0.60;   // [K]
chamfer_lid   = 0.80;   // [K] Fase an der Deckeloberkante

/* --- Verschraubung des Deckels --- */
// Screws instead of snap hooks. The reasoning is in building.md.
// false = selbstschneidende M3 direkt ins Plastik (braucht kein Werkzeug
//         but a screwdriver, lasts a prototype's lifetime)
// true  = M3 heat-set threaded inserts (Ø4.0 x 5 mm). Only needed when the
//         case gets opened often. The bosses and with them the whole case
//         grow a little automatically.
threaded_insert = false;  // [K]
boss_d     = threaded_insert ? 8.00 : 6.00;   // [G] outer diameter of the lid boss
boss_core  = threaded_insert ? 4.20 : 2.50;   // [G] Kernloch
csink_d    = 6.20;   // [K] Kopfdurchmesser M3-Senkschraube
csink_t    = 1.80;   // [K] Senktiefe
boss_clearance  = 1.00;   // [K] Abstand Domkante zum Bauteil-Rechteck

// Clearance between the component rectangle and the inner wall at carrier
// height. The value is NOT freely chosen but set by the lid bosses: they sit
// against the inner wall and must not touch a board. Lower limit 7.0 mm,
// damit in der Platinenebene noch inner_margin - standoff = 5,0 mm bleiben —
// der Wert aus docs/hardware.md.
inner_margin    = max(7.00, boss_d + boss_clearance);   // [G] 7,0 bzw. 9,0

/* --- Tiefenaufbau --- */
sk_behind_front = sk_total_depth - sk_cap_overhang;   // [G] 15,40
cable_space       = 6.00;   // [K] behind the ScreenKey back: header,
                          //     FPC-Stecker und Litzen. Ohne diesen Abstand
                          //     the battery presses on the connector pins.
part_clearance    = 0.60;   // [K] clearance between the tallest part and the lid
feather_support = 2.00;   // [K] Distanzsockel unter dem Feather. Nicht kleiner
                          //     make: the solder pins of the
                          //     Stiftleisten ab.
amp_support     = 2.00;   // [K] same under the amplifier

sk_board_z_v  = sk_behind_front - sk_board_d;         // [G] 13,80 Vorderseite
carrier_z_bottom     = sk_behind_front + cable_space;            // [G] 21.40 carrier underside
carrier_z_top     = carrier_z_bottom + carrier_d;                // [G] 23.80 carrier top side

// How high the inner space above the carrier has to be is set by the TALLEST
// part on the carrier — and that is not the battery but the Feather
// auf seinen Distanzsockeln. Genau das war im ersten Entwurf falsch: dort
// stand nur der Akku im Budget, der Feather ragte 1,3 mm in den Deckel.
stapel_battery     = battery_d;                       // [G]  8,10
stack_feather  = feather_support + feather_h;  // [G] 10.00  <- the governing one
stapel_amp      = amp_support + amp_d;          // [G]  5,00
stapel_max      = max(stapel_battery, stack_feather, stapel_amp);   // [G] 10,00

inner_z_h       = carrier_z_top + stapel_max + part_clearance;  // [G] 34,40
outer_t        = inner_z_h + lid_d;                     // [G] 37,40 Gesamttiefe

/* --- Outer dimensions --- */
inner_b  = env_b + 2*inner_margin;      // [G] 131,12
inner_h  = env_h + 2*inner_margin;      // [G]  94,59
outer_b = inner_b + 2*wall;          // [G] 135,92
outer_h = inner_h + 2*wall;          // [G]  99,39
centre_x  = env_b/2;                   // [G]
centre_y  = env_h/2;                   // [G]

/* --- Toleranzen --- */
gap_cap   = 0.60;   // [K] Luft rundum um die Tastenkappe im Frontausschnitt.
                        //     Large enough that the key never jams; too narrow
                        //     for a child's finger to get in.
chamfer_key    = 0.80;   // [K] Fase am Rand des Tastenausschnitts
cap_r       = 2.00;   // [K] Eckenradius des Tastenausschnitts
lid_play  = 0.40;   // [K] Gesamtspiel des Deckels im Falz
carrier_play = 0.40;   // [K] total play of the carrier

/* --- Befestigung der ScreenKeys --- */
sk_boss_d    = 4.50;  // [K] ScreenKey boss outer diameter
sk_boss_core = 1.60;  // [K] pilot hole for self-tapping M2
sk_boss_foot = 1.50;  // [K] 45° foot cone, so the boss does not snap off
sk_boss_wall = 1.00;  // [K] minimum wall around the pilot hole. If a boss fails
                     //     den Kappen-Freiraum darunter, wird er weggelassen
                     //     statt angeschnitten — siehe sk_dome().
sk_boss_h    = sk_board_z_v - front_d;   // [G] 11,40

/* --- Lautsprecherkammer --- */
// As closed a volume as possible behind the driver. The chamber is formed by
// the front plate, two inset walls, two outer walls and the
// Deckel gebildet.
chamber_wall  = 2.00;   // [K]
chamber_clearance  = 2.00;   // [K] Luft zwischen Chassis und Kammerwand
chamber_x     = spk_frame + chamber_clearance;              // [G] 42.30 inner face on the right
chamber_y     = env_h - spk_frame - chamber_clearance - 1.0;// [G] 37.29 inner face at the bottom
                                                      //     (1,0 mm extra Abstand
                                                      //      zur Set-Platine)
grille_hole_d = 4.00;  // [K] sound outlet: holes, no child can get in
grille_pitch = 6.00;  // [K]
grille_field_d = 34.50; // [K] slightly larger than the cone

/* --- Positionen im Innenraum (linke untere Ecke der Bauteile) --- */
// All in component coordinates. The checks in section 4 verify that nothing
// overlaps — whoever moves something here gets
// beim Rendern sofort eine Fehlermeldung statt eines kaputten Drucks.
// Akku: rechts der Lautsprecherkammer. Waagerecht wiegt er den Lautsprecher
// (oben links) auf; senkrecht sitzt er so tief, wie der untere Mitteldom es
// allows — its retaining ribs must not touch the boss. Result: centre of
// gravity practically at the middle of the case, see the echo in section 4.
battery_x    =  52.00;  // [K]
battery_y    =   2.50;  // [K]

// Feather: board edge flush against the left inner wall, so the USB-C socket
// reaches the case edge. Vertically into the lower
// Streifen, unterhalb der Lautsprecherkammer.
feather_x =  -inner_margin;   // [G]
feather_y =   8.00;         // [K]

// Amplifier: to the right of the chamber wall, above the battery. The runs
// to the speaker are short there and the carrier is not cut away.
// (In the first draft it sat bottom left — there its bed protruded 1.9 mm
//  beyond the carrier edge and hit the case wall.)
amp_x     =  49.00;  // [K]
amp_y     =  58.50;  // [K]

// Retaining ribs on the carrier. The same numbers are used by the checks in
// Abschnitt 4 und die Module in Abschnitt 8 — sonst laufen sie auseinander.
rib_b       = 2.00;  // [K] Dicke einer Halterippe
part_play = 0.40;  // [K] Luft zwischen Bauteil und Rippe
bed_margin          = rib_b + part_play;   // [G] 2,40 Zuschlag ringsum

/* --- Deckeldome: 4 Ecken + Mitte oben + Mitte unten --- */
boss_e = inner_margin - boss_d/2;   // [G] 4,0 — Domachse von der Innenwand weg
boss_pos = [
  [ -boss_e        , -boss_e        ],   // links unten
  [ env_b + boss_e , -boss_e        ],   // rechts unten
  [ -boss_e        , env_h + boss_e ],   // links oben (liegt in der Kammer)
  [ env_b + boss_e , env_h + boss_e ],   // rechts oben
  [ env_b/2       , -boss_e        ],   // Mitte unten
  [ env_b/2       , env_h + boss_e ]    // Mitte oben
];

/* --- Carrier supports: short posts with locating pegs --- */
support_d    = 8.00;   // [K]
peg_d     = 3.00;   // [K]
peg_h     = carrier_d - 0.40;  // [G] ends just below the carrier top side,
                                  //     so nothing presses on the battery
// Positions: in the gaps between the boards, that is where there is room.
support_pos = [
  [ (blk_mx1 + blk_mx2)/2, blk_my1 ],   // 85,65 / 17,645
  [ (blk_mx1 + blk_mx2)/2, env_h/2 ],   // 85,65 / 40,295
  [ (blk_mx1 + blk_mx2)/2, blk_my2 ],   // 85,65 / 62,945
  // In der Luecke zwischen Set-Platine und Viererblock. Nicht hoeher
  // legen: bei y = 8 lag das Zapfenloch im Traeger 0,73 mm unter einem
  // Distanzsockel des Feathers, der Sockel haette ueber der Lochkante
  // angefangen zu drucken.
  [ (set_mx + blk_mx1)/2, 4.0 ]                        // 43,65 / 4
];

/* --- Logo --- */
// Speech bubble with two eyes and a smile, rebuilt from assets/icon.svg
// nachgebaut (nicht importiert — siehe building.md).
logo_lid_b   = 70.00;  // [K] Breite der Sprechblase auf dem Deckel
logo_lid_h   =  0.80;  // [K] embossing height, 4 layers at 0.2 mm
logo_side_on   = true;   // [K] kleines Logo an der Unterkante
logo_side_b    = 20.00;  // [K]
logo_side_h    =  0.60;  // [K]


/* =====================================================================
   4.  NACHRECHNEN
   Wenn hier etwas rot wird, stimmt die Geometrie nicht — dann nicht
   drucken, sondern erst die Zahl finden, die schuld ist.
   ===================================================================== */

/* --- Cap spacing in the plane --- */
gap_cap_x = pitch_x - sk_cap_b;      // soll 15,0
gap_cap_y = pitch_y - sk_cap_h;      // soll 20,0
gap_pcb_x   = pitch_x - sk_board_b;    // soll 11,06 > 0
gap_pcb_y   = pitch_y - sk_board_h;    // soll 10,01 > 0

assert(gap_cap_x > 8,
  "Sprechtasten stehen seitlich zu eng - eine Kinderhand trifft zwei auf einmal.");
assert(gap_cap_y > 8,
  "Sprechtasten stehen senkrecht zu eng.");
assert(gap_pcb_x > 2 && gap_pcb_y > 2,
  "Die ScreenKey-Platinen beruehren sich. Raster vergroessern.");

/* --- Kappen-Freiraum gegen ScreenKey-Dome ---------------------------
   Das ist die empfindlichste Stelle des ganzen Entwurfs.

   Die Tastenkappe ist 22,00 x 25,30 mm, die Platine 25,94 x 35,29 mm.
   Senkrecht liegen zwischen Kappenkante (12,65 von der Mitte) und
   Lochmitte (15,645) nur 2,995 mm. Ein Dom mit Kernloch 1,6 und 1,0 mm
   Wand braucht davon 1,8 mm, der Luftspalt um die Kappe 0,6 mm.
   About 0.6 mm remain — that is the ENTIRE budget by which the
   Kappe aus der Platinenmitte wandern darf, bevor die Ecken-Dome
   nicht mehr passen.

   The design catches that without anyone having to recalculate:
   `cap_clearance()` schneidet die Kappenbahn frei, und `sk_dome()`
   drops every boss that would be cut into. If a key pair ends up
   ein Tastenpaar ohne Halt da, meldet sich der Assert weiter unten.   */

clear_hb = (sk_cap_b + 2*gap_cap)/2;      // [G] 11,60
clear_hh = (sk_cap_h + 2*gap_cap)/2;      // [G] 13,25
sk_hole_dx  = sk_board_b/2 - sk_hole_margin;       // [G] 10,97
sk_hole_dy  = sk_board_h/2 - sk_hole_margin;       // [G] 15,645
boss_noetig  = sk_boss_core/2 + sk_boss_wall;         // [G]  1,80

// Wie weit steht ein Dom vom Freiraum ab? Der Dom bleibt stehen, sobald er
// in EINER Achse aus dem Rechteck herausragt — deshalb max() statt min().
function boss_frei(sx, sy) =
  max(abs(sk_hole_dx*sx - cap_offset_x) - clear_hb,
      abs(sk_hole_dy*sy - cap_offset_y) - clear_hh);

boss_da      = [ for (sx=[-1,1], sy=[-1,1]) if (boss_frei(sx,sy) >= boss_noetig) 1 ];
dome_pro_key = len(boss_da);

// Budget for cap_offset_y before the first boss is dropped
offset_y_max = sk_hole_dy - clear_hh - boss_noetig;   // [G] 0,595

assert(dome_pro_key >= 2,
  str("Bei cap_offset_y = ", cap_offset_y, " mm bleiben nur ",
      dome_pro_key, " von 4 Domen je ScreenKey stehen. Zulaessig sind ",
      round(offset_y_max*100)/100, " mm. Mehr Versatz heisst: die Ecken-",
      "loecher der Platine liegen zu dicht an der Kappe. Dann NICHT die ",
      "Zahl kleinerreden, sondern sk_hole_margin am echten Modul nachmessen ",
      "- vielleicht sitzen die Loecher ganz woanders."));

/* --- Tiefenbudget --- */
inner_t = inner_z_h - front_d;    // nutzbare Innentiefe
assert(inner_t >= spk_depth + 0.5,
  str("Innentiefe ", inner_t, " mm reicht nicht fuer den Lautsprecher (",
      spk_depth, " mm)."));
assert(inner_z_h - carrier_z_top >= battery_d,
  "No room above the carrier for the battery.");
// Der Feather steht auf Distanzsockeln - die gehoeren mit ins Budget.
// Genau diese Zeile fehlte im ersten Entwurf; der Feather ragte 1,3 mm
// in den Deckel, ohne dass ein Assert angeschlagen haette.
assert(inner_z_h - carrier_z_top >= feather_support + feather_h,
  str("No room above the carrier for the Feather: ",
      inner_z_h - carrier_z_top, " mm free, ",
      feather_support + feather_h, " mm needed."));
assert(inner_z_h - carrier_z_top >= amp_support + amp_d,
  "No room above the carrier for the amplifier.");

/* --- What sits on the carrier must not get in each other's way --------
   Instead of individual hand checks ("battery left of the amp?") there is
   Liste von Rechtecken - Bauteil samt Halterippen - und ein stumpfer
   Paarvergleich. Wer eine Position verschiebt, bekommt die Kollision
   beim Rendern genannt, mit Namen, statt sie im Druck zu finden.
   Die Lautsprecherkammer und die Deckeldome stehen als feste Hindernisse
   mit in derselben Liste.                                              */

function overlaps(a, b) =
  a[0] < b[2] - 0.001 && b[0] < a[2] - 0.001 &&
  a[1] < b[3] - 0.001 && b[1] < a[3] - 0.001;

// beweglich = frei platzierbar, jede Zahl davon steht in Abschnitt 3
carrier_items = [
  ["battery",        [battery_x - bed_margin,    battery_y - bed_margin,
                   battery_x + battery_b + bed_margin,    battery_y + battery_h + bed_margin]],
  ["Feather",     [feather_x,        feather_y,
                   feather_x + feather_l,     feather_y + feather_b]],
  ["amplifier", [amp_x - bed_margin,     amp_y - bed_margin,
                   amp_x + amp_b + bed_margin,      amp_y + amp_h + bed_margin]] ];

// fixed = follows from the case itself. That the top left lid boss
// INNERHALB der Lautsprecherkammer steht, ist Absicht (dort ist ohnehin nur
// clearance), so the fixed obstacles are not checked against each other.
hindernisse = concat(
  [ ["chamber",  [-inner_margin, chamber_y, chamber_x + chamber_wall, env_h + inner_margin]] ],
  [ for (i = [0:len(boss_pos)-1])
      [ str("Deckeldom ", i), [boss_pos[i][0] - boss_d/2, boss_pos[i][1] - boss_d/2,
                               boss_pos[i][0] + boss_d/2, boss_pos[i][1] + boss_d/2] ] ]);

collisions = concat(
  [ for (i = [0:len(carrier_items)-2], j = [i+1:len(carrier_items)-1])
      if (overlaps(carrier_items[i][1], carrier_items[j][1]))
        str(carrier_items[i][0], " <-> ", carrier_items[j][0]) ],
  [ for (b = carrier_items, h = hindernisse)
      if (overlaps(b[1], h[1])) str(b[0], " <-> ", h[0]) ]);

assert(len(collisions) == 0,
  str("On the carrier these overlap: ", collisions));

// ... und alles muss innerhalb der Innenwand bleiben.
draussen = [ for (b = carrier_items)
               if (b[1][0] < -inner_margin - 0.001 || b[1][1] < -inner_margin - 0.001 ||
                   b[1][2] > env_b + inner_margin + 0.001 ||
                   b[1][3] > env_h + inner_margin + 0.001) b[0] ];
assert(len(draussen) == 0,
  str("Ragt ueber die Innenwand hinaus: ", draussen));

/* --- USB-C window has to fit between carrier and lid --- */
usb_z    = carrier_z_top + feather_support + feather_pcb_d + usb_centre_above_pcb;
usb_fen_h = usb_buchse_h + 1.4;
assert(usb_z - usb_fen_h/2 > carrier_z_top + 1.0,
  "USB window cuts into the carrier ledge.");
assert(usb_z + usb_fen_h/2 < inner_z_h - 1.0,
  "USB-Fenster schneidet in den Deckelfalz.");

/* --- Lid bosses must not touch a board --- */
boss_spacing_min = min([ for (p = boss_pos)
                        min([ for (s = sk_pos)
                              max( abs(p[0]-s[0]) - sk_board_b/2,
                                   abs(p[1]-s[1]) - sk_board_h/2 )
                              - boss_d/2 ]) ]);
assert(boss_spacing_min > 0,
  str("Ein Deckeldom beruehrt eine ScreenKey-Platine (", boss_spacing_min, " mm)."));

/* --- Schwerpunkt in der Ebene (nur Akku + Lautsprecher, die zwei Brocken) --- */
m_battery = 52;   // [M] g
m_spk   = 35;   // [A] g, estimated
sp_x = (m_battery*(battery_x+battery_b/2) + m_spk*spk_mx) / (m_battery + m_spk);
sp_y = (m_battery*(battery_y+battery_h/2) + m_spk*spk_my) / (m_battery + m_spk);

echo(str("--- vorlaut Gehaeuse ------------------------------------"));
echo(str("Bauteil-Rechteck : ", env_b, " x ", env_h, " mm"));
echo(str("Gehaeuse outer  : ", outer_b, " x ", outer_h, " x ", outer_t, " mm"));
echo(str("Innenraum        : ", inner_b, " x ", inner_h, " x ", inner_t, " mm"));
echo(str("Kappenspalt      : ", gap_cap_x, " mm quer / ",
         gap_cap_y, " mm hoch"));
echo(str("Platinenspalt    : ", gap_pcb_x, " / ", gap_pcb_y, " mm"));
echo(str("Carrier sits at z = ", carrier_z_bottom, " .. ", carrier_z_top));
echo(str("USB-C-Mitte bei z = ", usb_z));
echo(str("Kammervolumen brutto ca. ",
         round((chamber_x+inner_margin)*(env_h+inner_margin-chamber_y)*inner_t/100)/10,
         " cm3, abzueglich Chassis ca. ",
         round(((chamber_x+inner_margin)*(env_h+inner_margin-chamber_y)*inner_t
                - spk_frame*spk_frame*spk_depth)/100)/10, " cm3"));
echo(str("Schwerpunkt Akku+Lautsprecher: x=", round(sp_x*10)/10,
         " (Mitte ", round(centre_x*10)/10, "), y=", round(sp_y*10)/10,
         " (Mitte ", round(centre_y*10)/10, ")"));
echo(str("Kappenversatz    : ", cap_offset_y, " mm eingetragen, ",
         round(offset_y_max*1000)/1000, " mm sind das Budget -> ",
         dome_pro_key, " von 4 Domen je ScreenKey"));
if (dome_pro_key < 4)
  echo(str("!! ACHTUNG: nur ", dome_pro_key, " Dome je ScreenKey. Die Platine ",
           "haengt dann an EINER Kante und kann kippeln. Vor dem Drucken ",
           "pruefen, ob sk_hole_margin wirklich stimmt."));
echo(str("Schrauben        : ", threaded_insert ? "M3-Gewindeeinsaetze" :
         "M3 selbstschneidend", ", Dom ", boss_d, " mm, Kernloch ", boss_core));
echo(str("Wand ", wall, " mm = ", wall/0.4, " Bahnen bei 0,4er Duese"));
echo(str("Druckbett noetig : Wanne ", outer_b, " x ", outer_h,
         " mm, hoch ", outer_t, " mm"));
echo(str("Hoechster Stapel auf dem Traeger: ",
         stapel_max == stack_feather ? "Feather" :
         stapel_max == stapel_battery ? "Akku" : "Verstaerker",
         " mit ", stapel_max, " mm, frei sind ", inner_z_h - carrier_z_top));
echo(str("---------------------------------------------------------"));


/* =====================================================================
   5.  HILFSMODULE
   ===================================================================== */

module rrect(b, h, r) {            // 2D, um den Ursprung zentriert
  offset(r = r) square([b - 2*r, h - 2*r], center = true);
}

module rprism(b, h, r, t) {        // 3D, zentriert, z = 0 .. t
  linear_extrude(height = t) rrect(b, h, r);
}

// Prism with a 45° chamfer underneath (prints without support)
module rprism_chamfer_u(b, h, r, t, f) {
  hull() {
    linear_extrude(0.02) rrect(b - 2*f, h - 2*f, max(0.4, r - f));
    translate([0, 0, f]) linear_extrude(0.02) rrect(b, h, r);
  }
  translate([0, 0, f]) rprism(b, h, r, t - f);
}

// Prisma mit 45°-Fase an der Oberseite
module rprism_chamfer_o(b, h, r, t, f) {
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

module logo_2d(breite) {
  s = breite / 360;      // 360 = Blasenbreite in SVG-Einheiten (436 - 76)
  laecheln = [[190,226],[190,288],[322,288],[322,226]];  // kubische Bezier
  n = 14;
  mirror([0,1]) scale(s) translate([-256, -242]) difference() {
    union() {
      hull() for (p = [[128,128],[384,128],[384,272],[128,272]])
        translate(p) circle(52);
      polygon([[314,310],[256,408],[198,310]]);        // Schwanz der Blase
    }
    translate([200,178]) circle(22);                    // Auge links
    translate([312,178]) circle(22);                    // Auge rechts
    for (i = [0 : n-1]) hull() {                        // smile, stroke 26
      translate(bezier(i/n,      laecheln[0],laecheln[1],laecheln[2],laecheln[3]))
        circle(13);
      translate(bezier((i+1)/n,  laecheln[0],laecheln[1],laecheln[2],laecheln[3]))
        circle(13);
    }
  }
}

// Erhabenes Logo, zweistufig: die obere Stufe ist 0,4 mm schmaler.
// This is a printed chamfer — the edge does not break out and does not feel
// sharp to a child's hands.
module logo_3d(breite, hoehe) {
  st = min(0.4, hoehe/2);
  linear_extrude(hoehe - st) logo_2d(breite);
  translate([0,0,hoehe - st]) linear_extrude(st) offset(r = -0.4) logo_2d(breite);
}


/* =====================================================================
   7.  TUB  (front plate + walls + everything hanging off them)
   Prints in exactly this orientation: front face on the print bed, opening
   upwards. No overhang steeper than 45°.
   ===================================================================== */

module outer_body() {
  translate([centre_x, centre_y, 0]) {
    rprism_chamfer_u(outer_b, outer_h, corner_r, outer_t - chamfer_rear, chamfer_front);
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
module hohlraum() {
  translate([centre_x, centre_y, 0]) {
    // a) Platinenebene, dicke Wand
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

   Der erste Entwurf hatte hier nur ein flaches Loch durch die Frontplatte
   und liess die Dom-Fusskegel stehen. Nachgerechnet ragten die 0,755 mm in
   die Kappe hinein - die Taste haette geklemmt, und zwar an allen fuenf
   Stellen gleichzeitig.

   Weil dieser Koerper mit cap_offset_y mitwandert, bleibt die Bahn frei,
   egal was dort eingetragen wird. Das ist die halbe Miete fuer die "eine
   Zahl"; die andere Haelfte ist sk_dome(), das weichende Dome weglaesst. */
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

/* --- ScreenKey-Befestigungsdome --- */
// Ein Dom entsteht nur, wenn er neben dem Kappen-Freiraum genug Fleisch
// behaelt. Angeschnittene Dome mit 0,3 mm Restwand sind schlimmer als gar
// keine: sie brechen beim ersten Schrauben ab und liegen dann lose im Geraet.
module sk_dome() {
  for (p = sk_pos) translate([p[0], p[1], front_d])
    for (sx = [-1,1], sy = [-1,1])
      if (boss_frei(sx, sy) >= boss_noetig)
        translate([sx*sk_hole_dx, sy*sk_hole_dy, 0]) {
          cylinder(d = sk_boss_d, h = sk_boss_h);
          cylinder(d1 = sk_boss_d + 2*sk_boss_foot, d2 = sk_boss_d, h = sk_boss_foot);
        }
}

module sk_dome_core() {
  for (p = sk_pos) translate([p[0], p[1], 0])
    for (sx = [-1,1], sy = [-1,1])
      if (boss_frei(sx, sy) >= boss_noetig)
        translate([sx*sk_hole_dx, sy*sk_hole_dy, front_d + 1.0])
          cylinder(d = sk_boss_core, h = sk_boss_h);
}

/* --- Lautsprecher: Gitter, Schrauben, Positionierrippen --- */
module spk_grille() {
  n = ceil(grille_field_d / grille_pitch) + 1;
  translate([spk_mx, spk_my, -1])
    intersection() {
      cylinder(d = grille_field_d, h = front_d + 2);
      union() for (i = [-n:n], j = [-n:n]) {
        x = i * grille_pitch + (abs(j) % 2) * grille_pitch/2;
        y = j * grille_pitch * 0.866;
        translate([x, y, 0]) cylinder(d = grille_hole_d, h = front_d + 2);
      }
    }
}

module spk_schrauben() {
  for (sx = [-1,1], sy = [-1,1])
    translate([spk_mx + sx*spk_hole_a/2, spk_my + sy*spk_hole_a/2, 0]) {
      translate([0,0,-1]) cylinder(d = spk_screw_d, h = front_d + 2);
      // Senkung von front: Loch unten weit, nach hinten enger — druckbar
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

/* --- Lautsprecherkammer --- */
module chamber_waende() {
  h = inner_z_h - front_d;
  // vertical wall right of the chamber, thickened at the bottom (carrier ledge)
  translate([chamber_x, chamber_y, front_d])
    cube([chamber_wall, env_h + inner_margin - chamber_y, h]);
  translate([chamber_x, chamber_y, front_d])
    cube([chamber_wall + standoff, env_h + inner_margin - chamber_y,
          carrier_z_bottom - front_d]);
  // waagerechte Wand unter dem Lautsprecher
  translate([-inner_margin, chamber_y, front_d])
    cube([chamber_x + chamber_wall + inner_margin, chamber_wall, h]);
}

module chamber_cable() {   // passage for the speaker wires
  translate([chamber_x - 1, chamber_y + 6, front_d + 2])
    cube([chamber_wall + standoff + 2, 7, 5]);
}

/* --- Deckeldome --- */
module lid_dome() {
  for (p = boss_pos) translate([p[0], p[1], front_d])
    cylinder(d = boss_d, h = inner_z_h - front_d);
}
module lid_dome_core() {
  for (p = boss_pos) translate([p[0], p[1], inner_z_h - 14])
    cylinder(d = boss_core, h = 15);
}

/* --- Carrier supports --- */
module carrier_stuetzen() {
  for (p = support_pos) translate([p[0], p[1], front_d]) {
    cylinder(d = support_d, h = carrier_z_bottom - front_d);
    translate([0,0,carrier_z_bottom - front_d]) cylinder(d = peg_d, h = peg_h);
  }
}

/* --- USB-C-Fenster in der linken Wand --- */
// Deliberately tight: the wall takes the side loads, not the soldered socket.
// The cable bend rests on the outside, that is the strain relief.
module usb_fenster() {
  fb = usb_buchse_b + 1.4;
  fh = usb_fen_h;
  yc = feather_y + feather_b/2;
  translate([-inner_margin - wall - 2, yc, usb_z]) rotate([0,90,0])
    linear_extrude(wall + 4) rrect(fh, fb, 1.0);
  // local wall pocket, so the socket can move into the opening
  translate([-inner_margin - 1.2, yc, usb_z]) rotate([0,90,0])
    linear_extrude(1.4) rrect(fh + 4, fb + 5, 1.5);
}

/* --- Logo an der Unterkante --- */
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
        difference() { outer_body(); hohlraum(); }
        sk_dome();
        lid_dome();
        carrier_stuetzen();
        chamber_waende();
        spk_ribs();
      }
      cap_clearance();
      spk_grille();
      spk_schrauben();
      sk_dome_core();
      lid_dome_core();
      usb_fenster();
      chamber_cable();
    }
    logo_bottom_edge();
  }
}

/* =====================================================================
   8.  CARRIER  (intermediate floor)
   Trennt die Verkabelung der ScreenKeys vom Akku — ein LiPo darf nie
   press on connector pins. Prints flat, ribs upwards.
   ===================================================================== */

module carrier_umriss() {
  difference() {
    translate([centre_x, centre_y])
      rrect(inner_b - carrier_play, inner_h - carrier_play, corner_r - wall);
    // cutout for the speaker chamber (the carrier rests on its step)
    translate([-inner_margin - 1, chamber_y + chamber_wall + 0.2])
      square([chamber_x + chamber_wall + inner_margin + 1 - 0.2 + 1,
              env_h + inner_margin - chamber_y + 2]);
    // Freistiche um die Deckeldome
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

// Four corner brackets holding the battery in the plane. No lid over it —
// der Akku soll sich zum Tauschen nach oben herausnehmen lassen.
//
// Jeder Winkel ist EIN Polygon. Vorher waren es zwei Quader, die sich nur
// touched along one edge; on export that became a non-two-manifold solid,
// which a slicer silently repairs the wrong way.
module battery_rippen() {
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
  // double-sided tape. Two holes would be guesswork,
  // solange die Lochlage nicht nachgemessen ist.
  translate([amp_x - s - b, amp_y - s - b, 0]) cube([b, amp_h + 2*s + 2*b, h]);
  translate([amp_x - s - b, amp_y - s - b, 0]) cube([amp_b + 2*s + 2*b, b, h]);
  translate([amp_x + amp_b + s, amp_y - s - b, 0]) cube([b, amp_h + 2*s + 2*b, h]);
}

// Everything standing on top of the carrier is clipped to its outer contour
// beschnitten. Ohne das ragten die Distanzsockel des Feathers 0,16 mm
// beyond the edge — the carrier would have caught on the case wall while
// being inserted, and the standoff would have printed in mid-air over the
// edge. Clipping happens on the OUTER contour only, not on the holes in it.
module carrier_aufbauten() {
  intersection() {
    union() {
      battery_rippen();
      feather_standoff();
      amp_bed();
    }
    linear_extrude(100) translate([centre_x, centre_y])
      rrect(inner_b - carrier_play, inner_h - carrier_play, corner_r - wall);
  }
}

module carrier() {
  translate([0, 0, carrier_z_bottom]) {
    linear_extrude(carrier_d) carrier_umriss();
    translate([0, 0, carrier_d]) carrier_aufbauten();
  }
}


/* =====================================================================
   9.  DECKEL
   Flat plate, completely smooth on the inside. Prints with the inside on the
   bed and the logo upwards — that way the embossing is pure upward geometry
   and succeeds even on a tired printer.
   ===================================================================== */

module lid() {
  db = outer_b - 2*lip - lid_play;
  dh = outer_h - 2*lip - lid_play;
  translate([centre_x, centre_y, inner_z_h]) difference() {
    union() {
      rprism_chamfer_o(db, dh, corner_r - lip, lid_d, chamfer_lid);
      translate([0, 0, lid_d]) logo_3d(logo_lid_b, logo_lid_h);
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
   10.  ATTRAPPEN  (nur zur Anschauung, nicht drucken)
   ===================================================================== */

module attrappen() {
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
   11.  AUSGABE
   ===================================================================== */

if (part == "tub")        tub();
else if (part == "carrier") translate([0,0,-carrier_z_bottom]) carrier();
else if (part == "lid")  translate([0,0,-inner_z_h]) lid();
else if (part == "assembly") {
  color("#dcd8e8") tub();
  color("#c8c0e0") carrier();
  color("#b8aed8") lid();
  if (show_parts) attrappen();
}
else if (part == "exploded") {
  color("#dcd8e8") tub();
  if (show_parts) attrappen();
  color("#c8c0e0") translate([0,0,28]) carrier();
  color("#b8aed8") translate([0,0,60]) lid();
}
else if (part == "printbed") {
  // alle drei Teile nebeneinander, jedes in seiner Drucklage
  tub();
  translate([0, outer_h + 8, -carrier_z_bottom]) carrier();
  translate([0, 2*outer_h + 16, -inner_z_h]) lid();
}
