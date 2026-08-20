// =====================================================================
//  mitreden — Gehäuse
//  Ein Talker mit fünf ScreenKeys, Lautsprecher, ESP32-S3 Feather
//  und LiPo. Für einen einfachen FDM-Drucker, eine Farbe, ohne Stützen.
//
//  WICHTIG: Fast alle Maße hier sind GERECHNET, nicht am fertigen
//  Aufbau nachgemessen. Jede Zahl trägt ein Kürzel, woher sie kommt:
//
//    [M]  gemessen (Stefanie, August 2026, siehe docs/hardware.md)
//    [R]  recherchiert (Hersteller-/Datenblattangabe)
//    [A]  ANNAHME — ungeprüft. Am echten Bauteil nachmessen!
//    [K]  Konstruktionsentscheidung — frei wählbar
//    [G]  gerechnet — NICHT von Hand ändern, folgt aus anderen Werten
//
//  Die wichtigste Stellschraube nach dem Auspacken der Teile ist
//  `kappe_versatz_y` (Abschnitt 1). Sitzt die Tastenkappe nicht mittig
//  auf der Platine, ändert man dort genau eine Zahl und alle fünf
//  Frontausschnitte wandern mit. Sonst nichts.
//
//  Koordinaten: Ursprung = linke untere Ecke des Bauteil-Rechtecks
//  (117,12 x 80,59 mm), Blick von vorn, y zeigt nach oben.
//  z = 0 ist die AUSSENSEITE der Frontplatte, +z zeigt nach hinten.
//  In dieser Lage werden alle drei Teile auch gedruckt.
// =====================================================================


/* ---------- 0.  Was soll gerendert werden ---------- */

// "wanne" | "traeger" | "deckel" | "montage" | "explosion" | "druckbett"
teil = "montage";

// Attrappen der Elektronik in der Montageansicht mitzeichnen
zeige_bauteile = true;

$fa = 3;
$fs = 0.4;


/* =====================================================================
   1.  BAUTEILMASSE
   ===================================================================== */

/* --- Waveshare ScreenKey (5x) --- */
sk_platine_b        = 25.94;  // [M] Platine breit
sk_platine_h        = 35.29;  // [M] Platine hoch
sk_platine_d        = 1.60;   // [A] Platinendicke, typisch FR4
sk_kappe_b          = 22.00;  // [M] Tastenkappe breit
sk_kappe_h          = 25.30;  // [M] Tastenkappe hoch
sk_kappe_ueberstand =  8.60;  // [M] wie weit die Kappe vor der Front steht
sk_gesamttiefe      = 24.00;  // [M] Kappenvorderkante bis Modulrückseite
// Wie tief der BEWEGLICHE Kappenkörper hinter die Frontplatte reicht. Dieser
// Raum muss über die ganze Tiefe frei bleiben, sonst klemmt die Taste. Im
// Zweifel zu groß ansetzen — hier steht der ungünstigste Fall (ganzes Modul).
sk_kappe_tiefe      = 15.40;  // [A] = sk_gesamttiefe - sk_kappe_ueberstand
sk_bild             = 15.21;  // [M] sichtbare Displayfläche (nur zur Kontrolle)

// >>> DIE Zahl, die nach dem Auspacken wahrscheinlich falsch ist. <<<
// Versatz der Kappenmitte gegenüber der Platinenmitte, positiv = nach oben.
// Auf den Produktbildern liegen Stiftleiste und FPC-Stecker unten; wenn die
// Kappe deshalb nach oben versetzt sitzt, hier den gemessenen Wert eintragen.
// Alle Frontausschnitte, das Logo und die Prüfungen rechnen automatisch mit.
kappe_versatz_y     =  0.00;  // [A] 0 = Kappe sitzt mittig
kappe_versatz_x     =  0.00;  // [A] dito waagerecht

// Befestigungslöcher in den vier Platinenecken
sk_loch_rand        =  2.00;  // [A] Lochmitte von der Platinenkante
sk_loch_d           =  2.20;  // [A] Lochdurchmesser (M2)

/* --- Lautsprecher 40 mm --- */
ls_rahmen           = 40.30;  // [M] quadratischer Rahmen
ls_tiefe            = 25.30;  // [M]
ls_membran_d        = 32.70;  // [M]
ls_loch_diagonale   = 46.20;  // [M] Diagonale über die vier Befestigungslöcher
ls_loch_a           = ls_loch_diagonale / sqrt(2);  // [G] = 32,67 mm Kantenmaß
ls_schraube_d       =  2.90;  // [A] Durchgangsloch für M2,5

/* --- Adafruit ESP32-S3 Feather --- */
feather_l           = 50.80;  // [R] 2,0"
feather_b           = 22.80;  // [R] 0,9"
feather_h           =  8.00;  // [A] Gesamthöhe mit aufgelöteten Stiftleisten
feather_pcb_d       =  1.60;  // [A] Platinendicke, typisch FR4
feather_loch_l      = 45.72;  // [R] Lochabstand längs (Feather-Spec: 0,1" Rand)
feather_loch_b      = 17.78;  // [R] Lochabstand quer
feather_loch_d      =  2.50;  // [R]
// USB-C-Buchse: sitzt mittig auf einer Schmalseite, Gehäuse ca. 9,0 x 3,2 mm,
// steht ca. 1,5 mm über die Platinenkante hinaus.
usb_buchse_b        =  9.00;  // [R]
usb_buchse_h        =  3.20;  // [R]
usb_ueberstand      =  1.50;  // [A] wie weit die Buchse über die Kante ragt
usb_mitte_ueber_pcb =  1.60;  // [A] Buchsenmitte über der Platinenoberseite

/* --- LiPo --- */
akku_b              = 63.00;  // [M]
akku_h              = 50.30;  // [M]
akku_d              =  8.10;  // [M]
// 52 g — das schwerste Einzelteil. Position siehe Abschnitt 3.

/* --- Verstärker MAX98357A (Adafruit 3006) --- */
amp_b               = 19.40;  // [R] adafruit.com/product/3006
amp_h               = 17.80;  // [R]
amp_d               =  3.00;  // [R] ohne Stiftleiste


/* =====================================================================
   2.  ANORDNUNG DER BEDIENTEILE  (festgelegt, siehe docs/hardware.md)
   ===================================================================== */

raster_x            = 37.00;  // [M] Mittenabstand der Sprechtasten waagerecht
raster_y            = 45.30;  // [M] Mittenabstand senkrecht
spalt_set_block     = 25.00;  // [M] Kappe der Set-Taste bis nächste Sprechkappe
spalt_ls_set        =  5.00;  // [M] Lautsprecher bis Set-Platine

/* --- daraus folgt das Bauteil-Rechteck --- */
env_h  = ls_rahmen + spalt_ls_set + sk_platine_h;             // [G] 80,59
// Set-Platine sitzt waagerecht mittig unter dem Lautsprecher
set_mx = ls_rahmen/2;                                          // [G] 20,15
set_my = sk_platine_h/2;                                       // [G] 17,645
// Linke Spalte des Viererblocks: Kappenspalt 25 mm zur Set-Kappe
// Kappenspalt 25 mm zur Set-Kappe. Ein waagerechter Kappenversatz hebt sich
// heraus, weil ALLE Kappen gleich versetzt sind — der Abstand bleibt gleich.
blk_mx1 = set_mx + sk_kappe_b + spalt_set_block;                // [G] 67,15
blk_mx2 = blk_mx1 + raster_x;                                  // [G] 104,15
blk_my1 = sk_platine_h/2;                                      // [G] 17,645  (unten bündig)
blk_my2 = blk_my1 + raster_y;                                  // [G] 62,945
env_b   = blk_mx2 + sk_platine_b/2;                            // [G] 117,12

// Lautsprecher oben links
ls_mx = ls_rahmen/2;                                           // [G] 20,15
ls_my = env_h - ls_rahmen/2;                                   // [G] 60,44

// Mittelpunkte aller fünf Platinen
sk_pos = [ [set_mx , set_my ],      // 0 = Set-Taste
           [blk_mx1, blk_my1],      // 1 = unten links
           [blk_mx2, blk_my1],      // 2 = unten rechts
           [blk_mx1, blk_my2],      // 3 = oben links
           [blk_mx2, blk_my2] ];    // 4 = oben rechts


/* =====================================================================
   3.  GEHÄUSE — Konstruktionsparameter
   ===================================================================== */

/* --- Wandstärken und Radien --- */
wand          = 2.40;   // [K] 6 Bahnen bei 0,4er Düse — steif, druckt sicher
front_d       = 2.40;   // [K] Frontplatte
deckel_d      = 3.00;   // [K] Deckel dicker: trägt die Senkschrauben
traeger_d     = 2.40;   // [K] Zwischenboden
sockel        = 2.00;   // [K] Wandverdickung in der Platinenebene.
                        //     Erzeugt die umlaufende Auflage für den Träger.
lippe         = 1.20;   // [K] verbleibende Außenhaut über dem Deckelfalz
ecke_r        = 6.00;   // [K] Eckenradius außen — nichts Scharfes fürs Kind
fase_vorn     = 1.20;   // [K] 45°-Fase rundum an der Frontkante
fase_hinten   = 0.60;   // [K]
fase_deckel   = 0.80;   // [K] Fase an der Deckeloberkante

/* --- Verschraubung des Deckels --- */
// Schrauben statt Schnapphaken. Begründung steht in bauanleitung.md.
// false = selbstschneidende M3 direkt ins Plastik (braucht kein Werkzeug
//         außer einem Schraubendreher, hält ein Prototypenleben lang)
// true  = M3-Gewindeeinsätze zum Einschmelzen (Ø4,0 x 5 mm). Nur nötig,
//         wenn das Gehäuse oft geöffnet wird. Die Dome und damit das
//         ganze Gehäuse werden dadurch automatisch etwas größer.
gewindeeinsatz = false;  // [K]
dom_d     = gewindeeinsatz ? 8.00 : 6.00;   // [G] Außendurchmesser Deckeldom
dom_kern  = gewindeeinsatz ? 4.20 : 2.50;   // [G] Kernloch
senk_d    = 6.20;   // [K] Kopfdurchmesser M3-Senkschraube
senk_t    = 1.80;   // [K] Senktiefe
dom_luft  = 1.00;   // [K] Abstand Domkante zum Bauteil-Rechteck

// Luft zwischen Bauteil-Rechteck und Innenwand auf Trägerhöhe. Der Wert
// wird NICHT frei gewählt, sondern von den Deckeldomen bestimmt: die stehen
// an der Innenwand und dürfen keine Platine berühren. Untergrenze 7,0 mm,
// damit in der Platinenebene noch innen_rand - sockel = 5,0 mm bleiben —
// der Wert aus docs/hardware.md.
innen_rand    = max(7.00, dom_d + dom_luft);   // [G] 7,0 bzw. 9,0

/* --- Tiefenaufbau --- */
sk_hinter_front = sk_gesamttiefe - sk_kappe_ueberstand;   // [G] 15,40
kabelraum       = 6.00;   // [K] hinter der ScreenKey-Rückseite: Stiftleiste,
                          //     FPC-Stecker und Litzen. Ohne diesen Abstand
                          //     drückt der Akku auf die Steckerpins.
bauteil_luft    = 0.60;   // [K] Luft zwischen dem höchsten Bauteil und dem Deckel
feather_stuetze = 2.00;   // [K] Distanzsockel unter dem Feather. Nicht kleiner
                          //     machen: darunter stehen die Lötstifte der
                          //     Stiftleisten ab.
amp_stuetze     = 2.00;   // [K] dito unter dem Verstärker

sk_platine_z_v  = sk_hinter_front - sk_platine_d;         // [G] 13,80 Vorderseite
traeger_z_u     = sk_hinter_front + kabelraum;            // [G] 21,40 Trägerunterkante
traeger_z_o     = traeger_z_u + traeger_d;                // [G] 23,80 Trägeroberkante

// Wie hoch der Innenraum über dem Träger sein muss, bestimmt das HÖCHSTE
// Bauteil auf dem Träger — und das ist nicht der Akku, sondern der Feather
// auf seinen Distanzsockeln. Genau das war im ersten Entwurf falsch: dort
// stand nur der Akku im Budget, der Feather ragte 1,3 mm in den Deckel.
stapel_akku     = akku_d;                       // [G]  8,10
stapel_feather  = feather_stuetze + feather_h;  // [G] 10,00  <- der Maßgebliche
stapel_amp      = amp_stuetze + amp_d;          // [G]  5,00
stapel_max      = max(stapel_akku, stapel_feather, stapel_amp);   // [G] 10,00

innen_z_h       = traeger_z_o + stapel_max + bauteil_luft;  // [G] 34,40
aussen_t        = innen_z_h + deckel_d;                     // [G] 37,40 Gesamttiefe

/* --- Außenmaße --- */
innen_b  = env_b + 2*innen_rand;      // [G] 131,12
innen_h  = env_h + 2*innen_rand;      // [G]  94,59
aussen_b = innen_b + 2*wand;          // [G] 135,92
aussen_h = innen_h + 2*wand;          // [G]  99,39
mitte_x  = env_b/2;                   // [G]
mitte_y  = env_h/2;                   // [G]

/* --- Toleranzen --- */
spalt_kappe   = 0.60;   // [K] Luft rundum um die Tastenkappe im Frontausschnitt.
                        //     Groß genug, dass die Taste nie klemmt; zu schmal,
                        //     als dass ein Kinderfinger hineinkäme.
fase_taste    = 0.80;   // [K] Fase am Rand des Tastenausschnitts
kappe_r       = 2.00;   // [K] Eckenradius des Tastenausschnitts
deckel_spiel  = 0.40;   // [K] Gesamtspiel des Deckels im Falz
traeger_spiel = 0.40;   // [K] Gesamtspiel des Trägers

/* --- Befestigung der ScreenKeys --- */
sk_dom_d    = 4.50;  // [K] ScreenKey-Dom außen
sk_dom_kern = 1.60;  // [K] Kernloch für selbstschneidende M2
sk_dom_fuss = 1.50;  // [K] 45°-Fußkegel, damit der Dom nicht abbricht
sk_dom_wand = 1.00;  // [K] Mindestwand um das Kernloch. Fällt ein Dom durch
                     //     den Kappen-Freiraum darunter, wird er weggelassen
                     //     statt angeschnitten — siehe sk_dome().
sk_dom_h    = sk_platine_z_v - front_d;   // [G] 11,40

/* --- Lautsprecherkammer --- */
// Möglichst geschlossenes Volumen hinter dem Chassis. Die Kammer wird von
// der Frontplatte, zwei eingezogenen Wänden, zwei Außenwänden und dem
// Deckel gebildet.
kammer_wand  = 2.00;   // [K]
kammer_luft  = 2.00;   // [K] Luft zwischen Chassis und Kammerwand
kammer_x     = ls_rahmen + kammer_luft;              // [G] 42,30 Innenfläche rechts
kammer_y     = env_h - ls_rahmen - kammer_luft - 1.0;// [G] 37,29 Innenfläche unten
                                                      //     (1,0 mm extra Abstand
                                                      //      zur Set-Platine)
gitter_loch_d = 4.00;  // [K] Schallaustritt: Löcher, kein Kind kommt hinein
gitter_raster = 6.00;  // [K]
gitter_feld_d = 34.50; // [K] etwas größer als die Membran

/* --- Positionen im Innenraum (linke untere Ecke der Bauteile) --- */
// Alle in Bauteil-Koordinaten. Die Prüfungen in Abschnitt 4 rechnen nach,
// dass sich nichts überschneidet — wer hier etwas verschiebt, bekommt
// beim Rendern sofort eine Fehlermeldung statt eines kaputten Drucks.
// Akku: rechts der Lautsprecherkammer. Waagerecht wiegt er den Lautsprecher
// (oben links) auf; senkrecht sitzt er so tief, wie der untere Mitteldom es
// zulässt — seine Halterippen dürfen den Dom nicht berühren. Ergebnis:
// Schwerpunkt praktisch in der Gehäusemitte, siehe Echo in Abschnitt 4.
akku_x    =  52.00;  // [K]
akku_y    =   2.50;  // [K]

// Feather: Platinenkante bündig an der linken Innenwand, damit die
// USB-C-Buchse die Gehäusekante erreicht. Senkrecht in den unteren
// Streifen, unterhalb der Lautsprecherkammer.
feather_x =  -innen_rand;   // [G]
feather_y =   8.00;         // [K]

// Verstärker: rechts neben der Kammerwand, oberhalb des Akkus. Dort sind
// die Wege zum Lautsprecher kurz und der Träger ist nicht ausgeschnitten.
// (Im ersten Entwurf saß er unten links — dort ragte sein Bett 1,9 mm
//  über die Trägerkante hinaus und stieß gegen die Gehäusewand.)
amp_x     =  49.00;  // [K]
amp_y     =  58.50;  // [K]

// Halterippen auf dem Träger. Dieselben Zahlen benutzen die Prüfungen in
// Abschnitt 4 und die Module in Abschnitt 8 — sonst laufen sie auseinander.
rippe_b       = 2.00;  // [K] Dicke einer Halterippe
bauteil_spiel = 0.40;  // [K] Luft zwischen Bauteil und Rippe
bett          = rippe_b + bauteil_spiel;   // [G] 2,40 Zuschlag ringsum

/* --- Deckeldome: 4 Ecken + Mitte oben + Mitte unten --- */
dom_e = innen_rand - dom_d/2;   // [G] 4,0 — Domachse von der Innenwand weg
dom_pos = [
  [ -dom_e        , -dom_e        ],   // links unten
  [ env_b + dom_e , -dom_e        ],   // rechts unten
  [ -dom_e        , env_h + dom_e ],   // links oben (liegt in der Kammer)
  [ env_b + dom_e , env_h + dom_e ],   // rechts oben
  [ env_b/2       , -dom_e        ],   // Mitte unten
  [ env_b/2       , env_h + dom_e ]    // Mitte oben
];

/* --- Trägerstützen: kurze Pfosten mit Zentrierzapfen --- */
stuetze_d    = 8.00;   // [K]
zapfen_d     = 3.00;   // [K]
zapfen_h     = traeger_d - 0.40;  // [G] endet knapp unter der Trägeroberseite,
                                  //     damit nichts auf den Akku drückt
// Positionen: in den Lücken zwischen den Platinen, dort ist Platz.
stuetze_pos = [
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
// Sprechblase mit zwei Augen und einem Lächeln, aus assets/icon.svg
// nachgebaut (nicht importiert — siehe bauanleitung.md).
logo_deckel_b   = 70.00;  // [K] Breite der Sprechblase auf dem Deckel
logo_deckel_h   =  0.80;  // [K] Prägehöhe, 4 Lagen bei 0,2 mm
logo_seite_an   = true;   // [K] kleines Logo an der Unterkante
logo_seite_b    = 20.00;  // [K]
logo_seite_h    =  0.60;  // [K]


/* =====================================================================
   4.  NACHRECHNEN
   Wenn hier etwas rot wird, stimmt die Geometrie nicht — dann nicht
   drucken, sondern erst die Zahl finden, die schuld ist.
   ===================================================================== */

/* --- Kappenabstände in der Ebene --- */
spalt_kappe_x = raster_x - sk_kappe_b;      // soll 15,0
spalt_kappe_y = raster_y - sk_kappe_h;      // soll 20,0
spalt_pcb_x   = raster_x - sk_platine_b;    // soll 11,06 > 0
spalt_pcb_y   = raster_y - sk_platine_h;    // soll 10,01 > 0

assert(spalt_kappe_x > 8,
  "Sprechtasten stehen seitlich zu eng - eine Kinderhand trifft zwei auf einmal.");
assert(spalt_kappe_y > 8,
  "Sprechtasten stehen senkrecht zu eng.");
assert(spalt_pcb_x > 2 && spalt_pcb_y > 2,
  "Die ScreenKey-Platinen beruehren sich. Raster vergroessern.");

/* --- Kappen-Freiraum gegen ScreenKey-Dome ---------------------------
   Das ist die empfindlichste Stelle des ganzen Entwurfs.

   Die Tastenkappe ist 22,00 x 25,30 mm, die Platine 25,94 x 35,29 mm.
   Senkrecht liegen zwischen Kappenkante (12,65 von der Mitte) und
   Lochmitte (15,645) nur 2,995 mm. Ein Dom mit Kernloch 1,6 und 1,0 mm
   Wand braucht davon 1,8 mm, der Luftspalt um die Kappe 0,6 mm.
   Übrig bleiben rund 0,6 mm — das ist das GESAMTE Budget, um das die
   Kappe aus der Platinenmitte wandern darf, bevor die Ecken-Dome
   nicht mehr passen.

   Der Entwurf fängt das ab, ohne dass man etwas nachrechnen muss:
   `kappen_freiraum()` schneidet die Kappenbahn frei, und `sk_dome()`
   lässt jeden Dom weg, der dadurch angeschnitten würde. Steht am Ende
   ein Tastenpaar ohne Halt da, meldet sich der Assert weiter unten.   */

freiraum_hb = (sk_kappe_b + 2*spalt_kappe)/2;      // [G] 11,60
freiraum_hh = (sk_kappe_h + 2*spalt_kappe)/2;      // [G] 13,25
sk_loch_dx  = sk_platine_b/2 - sk_loch_rand;       // [G] 10,97
sk_loch_dy  = sk_platine_h/2 - sk_loch_rand;       // [G] 15,645
dom_noetig  = sk_dom_kern/2 + sk_dom_wand;         // [G]  1,80

// Wie weit steht ein Dom vom Freiraum ab? Der Dom bleibt stehen, sobald er
// in EINER Achse aus dem Rechteck herausragt — deshalb max() statt min().
function dom_frei(sx, sy) =
  max(abs(sk_loch_dx*sx - kappe_versatz_x) - freiraum_hb,
      abs(sk_loch_dy*sy - kappe_versatz_y) - freiraum_hh);

dom_da      = [ for (sx=[-1,1], sy=[-1,1]) if (dom_frei(sx,sy) >= dom_noetig) 1 ];
dome_pro_taste = len(dom_da);

// Budget für kappe_versatz_y, bevor der erste Dom wegfällt
versatz_y_max = sk_loch_dy - freiraum_hh - dom_noetig;   // [G] 0,595

assert(dome_pro_taste >= 2,
  str("Bei kappe_versatz_y = ", kappe_versatz_y, " mm bleiben nur ",
      dome_pro_taste, " von 4 Domen je ScreenKey stehen. Zulaessig sind ",
      round(versatz_y_max*100)/100, " mm. Mehr Versatz heisst: die Ecken-",
      "loecher der Platine liegen zu dicht an der Kappe. Dann NICHT die ",
      "Zahl kleinerreden, sondern sk_loch_rand am echten Modul nachmessen ",
      "- vielleicht sitzen die Loecher ganz woanders."));

/* --- Tiefenbudget --- */
innen_t = innen_z_h - front_d;    // nutzbare Innentiefe
assert(innen_t >= ls_tiefe + 0.5,
  str("Innentiefe ", innen_t, " mm reicht nicht fuer den Lautsprecher (",
      ls_tiefe, " mm)."));
assert(innen_z_h - traeger_z_o >= akku_d,
  "Ueber dem Traeger ist kein Platz fuer den Akku.");
// Der Feather steht auf Distanzsockeln - die gehoeren mit ins Budget.
// Genau diese Zeile fehlte im ersten Entwurf; der Feather ragte 1,3 mm
// in den Deckel, ohne dass ein Assert angeschlagen haette.
assert(innen_z_h - traeger_z_o >= feather_stuetze + feather_h,
  str("Ueber dem Traeger ist kein Platz fuer den Feather: ",
      innen_z_h - traeger_z_o, " mm frei, ",
      feather_stuetze + feather_h, " mm noetig."));
assert(innen_z_h - traeger_z_o >= amp_stuetze + amp_d,
  "Ueber dem Traeger ist kein Platz fuer den Verstaerker.");

/* --- Was auf dem Träger liegt, darf sich nicht ins Gehege kommen ------
   Statt einzelner Handprüfungen ("Akku links vom Amp?") steht hier eine
   Liste von Rechtecken - Bauteil samt Halterippen - und ein stumpfer
   Paarvergleich. Wer eine Position verschiebt, bekommt die Kollision
   beim Rendern genannt, mit Namen, statt sie im Druck zu finden.
   Die Lautsprecherkammer und die Deckeldome stehen als feste Hindernisse
   mit in derselben Liste.                                              */

function ueberlappt(a, b) =
  a[0] < b[2] - 0.001 && b[0] < a[2] - 0.001 &&
  a[1] < b[3] - 0.001 && b[1] < a[3] - 0.001;

// beweglich = frei platzierbar, jede Zahl davon steht in Abschnitt 3
traeger_teile = [
  ["Akku",        [akku_x - bett,    akku_y - bett,
                   akku_x + akku_b + bett,    akku_y + akku_h + bett]],
  ["Feather",     [feather_x,        feather_y,
                   feather_x + feather_l,     feather_y + feather_b]],
  ["Verstaerker", [amp_x - bett,     amp_y - bett,
                   amp_x + amp_b + bett,      amp_y + amp_h + bett]] ];

// fest = ergibt sich aus dem Gehäuse selbst. Dass der linke obere Deckeldom
// INNERHALB der Lautsprecherkammer steht, ist Absicht (dort ist ohnehin nur
// Luft), deshalb werden die festen Hindernisse nicht gegeneinander geprüft.
hindernisse = concat(
  [ ["Kammer",  [-innen_rand, kammer_y, kammer_x + kammer_wand, env_h + innen_rand]] ],
  [ for (i = [0:len(dom_pos)-1])
      [ str("Deckeldom ", i), [dom_pos[i][0] - dom_d/2, dom_pos[i][1] - dom_d/2,
                               dom_pos[i][0] + dom_d/2, dom_pos[i][1] + dom_d/2] ] ]);

kollisionen = concat(
  [ for (i = [0:len(traeger_teile)-2], j = [i+1:len(traeger_teile)-1])
      if (ueberlappt(traeger_teile[i][1], traeger_teile[j][1]))
        str(traeger_teile[i][0], " <-> ", traeger_teile[j][0]) ],
  [ for (b = traeger_teile, h = hindernisse)
      if (ueberlappt(b[1], h[1])) str(b[0], " <-> ", h[0]) ]);

assert(len(kollisionen) == 0,
  str("Auf dem Traeger ueberschneiden sich: ", kollisionen));

// ... und alles muss innerhalb der Innenwand bleiben.
draussen = [ for (b = traeger_teile)
               if (b[1][0] < -innen_rand - 0.001 || b[1][1] < -innen_rand - 0.001 ||
                   b[1][2] > env_b + innen_rand + 0.001 ||
                   b[1][3] > env_h + innen_rand + 0.001) b[0] ];
assert(len(draussen) == 0,
  str("Ragt ueber die Innenwand hinaus: ", draussen));

/* --- USB-C-Fenster muss zwischen Träger und Deckel passen --- */
usb_z    = traeger_z_o + feather_stuetze + feather_pcb_d + usb_mitte_ueber_pcb;
usb_fen_h = usb_buchse_h + 1.4;
assert(usb_z - usb_fen_h/2 > traeger_z_o + 1.0,
  "USB-Fenster schneidet in die Traegerauflage.");
assert(usb_z + usb_fen_h/2 < innen_z_h - 1.0,
  "USB-Fenster schneidet in den Deckelfalz.");

/* --- Deckeldome dürfen keine Platine berühren --- */
dom_abstand_min = min([ for (p = dom_pos)
                        min([ for (s = sk_pos)
                              max( abs(p[0]-s[0]) - sk_platine_b/2,
                                   abs(p[1]-s[1]) - sk_platine_h/2 )
                              - dom_d/2 ]) ]);
assert(dom_abstand_min > 0,
  str("Ein Deckeldom beruehrt eine ScreenKey-Platine (", dom_abstand_min, " mm)."));

/* --- Schwerpunkt in der Ebene (nur Akku + Lautsprecher, die zwei Brocken) --- */
m_akku = 52;   // [M] g
m_ls   = 35;   // [A] g, geschätzt
sp_x = (m_akku*(akku_x+akku_b/2) + m_ls*ls_mx) / (m_akku + m_ls);
sp_y = (m_akku*(akku_y+akku_h/2) + m_ls*ls_my) / (m_akku + m_ls);

echo(str("--- mitreden Gehaeuse ------------------------------------"));
echo(str("Bauteil-Rechteck : ", env_b, " x ", env_h, " mm"));
echo(str("Gehaeuse aussen  : ", aussen_b, " x ", aussen_h, " x ", aussen_t, " mm"));
echo(str("Innenraum        : ", innen_b, " x ", innen_h, " x ", innen_t, " mm"));
echo(str("Kappenspalt      : ", spalt_kappe_x, " mm quer / ",
         spalt_kappe_y, " mm hoch"));
echo(str("Platinenspalt    : ", spalt_pcb_x, " / ", spalt_pcb_y, " mm"));
echo(str("Traeger liegt bei z = ", traeger_z_u, " .. ", traeger_z_o));
echo(str("USB-C-Mitte bei z = ", usb_z));
echo(str("Kammervolumen brutto ca. ",
         round((kammer_x+innen_rand)*(env_h+innen_rand-kammer_y)*innen_t/100)/10,
         " cm3, abzueglich Chassis ca. ",
         round(((kammer_x+innen_rand)*(env_h+innen_rand-kammer_y)*innen_t
                - ls_rahmen*ls_rahmen*ls_tiefe)/100)/10, " cm3"));
echo(str("Schwerpunkt Akku+Lautsprecher: x=", round(sp_x*10)/10,
         " (Mitte ", round(mitte_x*10)/10, "), y=", round(sp_y*10)/10,
         " (Mitte ", round(mitte_y*10)/10, ")"));
echo(str("Kappenversatz    : ", kappe_versatz_y, " mm eingetragen, ",
         round(versatz_y_max*1000)/1000, " mm sind das Budget -> ",
         dome_pro_taste, " von 4 Domen je ScreenKey"));
if (dome_pro_taste < 4)
  echo(str("!! ACHTUNG: nur ", dome_pro_taste, " Dome je ScreenKey. Die Platine ",
           "haengt dann an EINER Kante und kann kippeln. Vor dem Drucken ",
           "pruefen, ob sk_loch_rand wirklich stimmt."));
echo(str("Schrauben        : ", gewindeeinsatz ? "M3-Gewindeeinsaetze" :
         "M3 selbstschneidend", ", Dom ", dom_d, " mm, Kernloch ", dom_kern));
echo(str("Wand ", wand, " mm = ", wand/0.4, " Bahnen bei 0,4er Duese"));
echo(str("Druckbett noetig : Wanne ", aussen_b, " x ", aussen_h,
         " mm, hoch ", aussen_t, " mm"));
echo(str("Hoechster Stapel auf dem Traeger: ",
         stapel_max == stapel_feather ? "Feather" :
         stapel_max == stapel_akku ? "Akku" : "Verstaerker",
         " mit ", stapel_max, " mm, frei sind ", innen_z_h - traeger_z_o));
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

// Prisma mit 45°-Fase an der Unterseite (druckt ohne Stütze)
module rprism_fase_u(b, h, r, t, f) {
  hull() {
    linear_extrude(0.02) rrect(b - 2*f, h - 2*f, max(0.4, r - f));
    translate([0, 0, f]) linear_extrude(0.02) rrect(b, h, r);
  }
  translate([0, 0, f]) rprism(b, h, r, t - f);
}

// Prisma mit 45°-Fase an der Oberseite
module rprism_fase_o(b, h, r, t, f) {
  rprism(b, h, r, t - f);
  translate([0, 0, t - f]) hull() {
    linear_extrude(0.02) rrect(b, h, r);
    translate([0, 0, f - 0.02]) linear_extrude(0.02)
      rrect(b - 2*f, h - 2*f, max(0.4, r - f));
  }
}


/* =====================================================================
   6.  LOGO
   Sprechblase, zwei Augen, ein Lächeln — nachgebaut aus assets/icon.svg.
   Die SVG-Koordinaten (512er-Kasten, y nach unten) sind unverändert
   übernommen, damit ein Blick in die Datei genügt, um zu vergleichen.
   ===================================================================== */

function bez(t, p0, p1, p2, p3) =
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
    for (i = [0 : n-1]) hull() {                        // Lächeln, Strich 26
      translate(bez(i/n,      laecheln[0],laecheln[1],laecheln[2],laecheln[3]))
        circle(13);
      translate(bez((i+1)/n,  laecheln[0],laecheln[1],laecheln[2],laecheln[3]))
        circle(13);
    }
  }
}

// Erhabenes Logo, zweistufig: die obere Stufe ist 0,4 mm schmaler.
// Das ist eine gedruckte Fase — die Kante bricht nicht aus und fühlt
// sich für Kinderhände nicht scharf an.
module logo_3d(breite, hoehe) {
  st = min(0.4, hoehe/2);
  linear_extrude(hoehe - st) logo_2d(breite);
  translate([0,0,hoehe - st]) linear_extrude(st) offset(r = -0.4) logo_2d(breite);
}


/* =====================================================================
   7.  WANNE  (Frontplatte + Wände + alles, was daran hängt)
   Druckt in genau dieser Lage: Frontfläche auf dem Druckbett,
   Öffnung nach oben. Kein Überhang steiler als 45°.
   ===================================================================== */

module aussenkoerper() {
  translate([mitte_x, mitte_y, 0]) {
    rprism_fase_u(aussen_b, aussen_h, ecke_r, aussen_t - fase_hinten, fase_vorn);
    translate([0,0,aussen_t - fase_hinten]) hull() {
      linear_extrude(0.02) rrect(aussen_b, aussen_h, ecke_r);
      translate([0,0,fase_hinten - 0.02]) linear_extrude(0.02)
        rrect(aussen_b - 2*fase_hinten, aussen_h - 2*fase_hinten,
              ecke_r - fase_hinten);
    }
  }
}

// Der Innenraum wird nach hinten stufenweise WEITER. Jede Stufe hinterlässt
// eine nach oben zeigende Auflagefläche — die druckt sich von selbst.
// Andersherum (nach hinten enger) wäre jede Stufe ein Überhang.
module hohlraum() {
  translate([mitte_x, mitte_y, 0]) {
    // a) Platinenebene, dicke Wand
    translate([0,0,front_d])
      rprism(innen_b - 2*sockel, innen_h - 2*sockel,
             ecke_r - wand - sockel, traeger_z_u - front_d);
    // b) Trägerebene, dünne Wand — die 2 mm Absatz sind die Trägerauflage
    translate([0,0,traeger_z_u])
      rprism(innen_b, innen_h, ecke_r - wand, innen_z_h - traeger_z_u);
    // c) Falz für den Deckel
    translate([0,0,innen_z_h])
      rprism(aussen_b - 2*lippe + deckel_spiel, aussen_h - 2*lippe + deckel_spiel,
             ecke_r - lippe, aussen_t - innen_z_h + 1);
  }
}

/* --- Freiraum für die Tastenkappen ---------------------------------
   EIN Körper für alles, was der beweglichen Kappe im Weg stehen könnte.
   Er schneidet den Frontausschnitt, bricht dessen Außenkante und räumt
   die Bahn dahinter über die volle Kappentiefe frei.

   Der erste Entwurf hatte hier nur ein flaches Loch durch die Frontplatte
   und liess die Dom-Fusskegel stehen. Nachgerechnet ragten die 0,755 mm in
   die Kappe hinein - die Taste haette geklemmt, und zwar an allen fuenf
   Stellen gleichzeitig.

   Weil dieser Koerper mit kappe_versatz_y mitwandert, bleibt die Bahn frei,
   egal was dort eingetragen wird. Das ist die halbe Miete fuer die "eine
   Zahl"; die andere Haelfte ist sk_dome(), das weichende Dome weglaesst. */
module kappen_freiraum() {
  ob = sk_kappe_b + 2*spalt_kappe;
  oh = sk_kappe_h + 2*spalt_kappe;
  for (p = sk_pos) translate([p[0] + kappe_versatz_x, p[1] + kappe_versatz_y, 0]) {
    translate([0,0,-1]) rprism(ob, oh, kappe_r, 1 + front_d + sk_kappe_tiefe);
    // Fase an der Außenkante, damit keine scharfe Kante stehen bleibt
    translate([0,0,-0.01]) hull() {
      linear_extrude(0.02)
        rrect(ob + 2*fase_taste, oh + 2*fase_taste, kappe_r + fase_taste);
      translate([0,0,fase_taste]) linear_extrude(0.02) rrect(ob, oh, kappe_r);
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
      if (dom_frei(sx, sy) >= dom_noetig)
        translate([sx*sk_loch_dx, sy*sk_loch_dy, 0]) {
          cylinder(d = sk_dom_d, h = sk_dom_h);
          cylinder(d1 = sk_dom_d + 2*sk_dom_fuss, d2 = sk_dom_d, h = sk_dom_fuss);
        }
}

module sk_dome_kern() {
  for (p = sk_pos) translate([p[0], p[1], 0])
    for (sx = [-1,1], sy = [-1,1])
      if (dom_frei(sx, sy) >= dom_noetig)
        translate([sx*sk_loch_dx, sy*sk_loch_dy, front_d + 1.0])
          cylinder(d = sk_dom_kern, h = sk_dom_h);
}

/* --- Lautsprecher: Gitter, Schrauben, Positionierrippen --- */
module ls_gitter() {
  n = ceil(gitter_feld_d / gitter_raster) + 1;
  translate([ls_mx, ls_my, -1])
    intersection() {
      cylinder(d = gitter_feld_d, h = front_d + 2);
      union() for (i = [-n:n], j = [-n:n]) {
        x = i * gitter_raster + (abs(j) % 2) * gitter_raster/2;
        y = j * gitter_raster * 0.866;
        translate([x, y, 0]) cylinder(d = gitter_loch_d, h = front_d + 2);
      }
    }
}

module ls_schrauben() {
  for (sx = [-1,1], sy = [-1,1])
    translate([ls_mx + sx*ls_loch_a/2, ls_my + sy*ls_loch_a/2, 0]) {
      translate([0,0,-1]) cylinder(d = ls_schraube_d, h = front_d + 2);
      // Senkung von vorn: Loch unten weit, nach hinten enger — druckbar
      translate([0,0,-0.01]) cylinder(d1 = senk_d, d2 = ls_schraube_d,
                                      h = (senk_d - ls_schraube_d)/2 + 0.01);
    }
}

module ls_rippen() {   // vier kurze Wände, die das Chassis seitlich führen
  s = ls_rahmen + 0.6;
  translate([ls_mx, ls_my, front_d]) difference() {
    rprism(s + 2*1.6, s + 2*1.6, 1.0, 8.0);
    translate([0,0,-1]) rprism(s, s, 0.6, 10);
    // vier Durchlässe an den Ecken für die Litzen
    for (a = [45, 135, 225, 315]) rotate([0,0,a]) translate([0, s/2, -1])
      cube([10, 6, 12], center = true);
  }
}

/* --- Lautsprecherkammer --- */
module kammer_waende() {
  h = innen_z_h - front_d;
  // senkrechte Wand rechts der Kammer, unten verdickt (Trägerauflage)
  translate([kammer_x, kammer_y, front_d])
    cube([kammer_wand, env_h + innen_rand - kammer_y, h]);
  translate([kammer_x, kammer_y, front_d])
    cube([kammer_wand + sockel, env_h + innen_rand - kammer_y,
          traeger_z_u - front_d]);
  // waagerechte Wand unter dem Lautsprecher
  translate([-innen_rand, kammer_y, front_d])
    cube([kammer_x + kammer_wand + innen_rand, kammer_wand, h]);
}

module kammer_kabel() {   // Durchlass für die Lautsprecherlitzen
  translate([kammer_x - 1, kammer_y + 6, front_d + 2])
    cube([kammer_wand + sockel + 2, 7, 5]);
}

/* --- Deckeldome --- */
module deckel_dome() {
  for (p = dom_pos) translate([p[0], p[1], front_d])
    cylinder(d = dom_d, h = innen_z_h - front_d);
}
module deckel_dome_kern() {
  for (p = dom_pos) translate([p[0], p[1], innen_z_h - 14])
    cylinder(d = dom_kern, h = 15);
}

/* --- Trägerstützen --- */
module traeger_stuetzen() {
  for (p = stuetze_pos) translate([p[0], p[1], front_d]) {
    cylinder(d = stuetze_d, h = traeger_z_u - front_d);
    translate([0,0,traeger_z_u - front_d]) cylinder(d = zapfen_d, h = zapfen_h);
  }
}

/* --- USB-C-Fenster in der linken Wand --- */
// Bewusst knapp: die Wand nimmt die Seitenkräfte auf, nicht die aufgelötete
// Buchse. Der Kabelknick liegt außen an, das ist die Zugentlastung.
module usb_fenster() {
  fb = usb_buchse_b + 1.4;
  fh = usb_fen_h;
  yc = feather_y + feather_b/2;
  translate([-innen_rand - wand - 2, yc, usb_z]) rotate([0,90,0])
    linear_extrude(wand + 4) rrect(fh, fb, 1.0);
  // örtliche Wandtasche, damit die Buchse in die Öffnung einfahren kann
  translate([-innen_rand - 1.2, yc, usb_z]) rotate([0,90,0])
    linear_extrude(1.4) rrect(fh + 4, fb + 5, 1.5);
}

/* --- Logo an der Unterkante --- */
module logo_unterkante() {
  if (logo_seite_an)
    translate([mitte_x, -innen_rand - wand, aussen_t/2])
      rotate([90,0,0]) rotate([0,0,180]) mirror([1,0,0])
        logo_3d(logo_seite_b, logo_seite_h);
}

module wanne() {
  union() {
    difference() {
      union() {
        difference() { aussenkoerper(); hohlraum(); }
        sk_dome();
        deckel_dome();
        traeger_stuetzen();
        kammer_waende();
        ls_rippen();
      }
      kappen_freiraum();
      ls_gitter();
      ls_schrauben();
      sk_dome_kern();
      deckel_dome_kern();
      usb_fenster();
      kammer_kabel();
    }
    logo_unterkante();
  }
}

/* =====================================================================
   8.  TRÄGER  (Zwischenboden)
   Trennt die Verkabelung der ScreenKeys vom Akku — ein LiPo darf nie
   auf Steckerpins drücken. Druckt flach, Rippen nach oben.
   ===================================================================== */

module traeger_umriss() {
  difference() {
    translate([mitte_x, mitte_y])
      rrect(innen_b - traeger_spiel, innen_h - traeger_spiel, ecke_r - wand);
    // Aussparung für die Lautsprecherkammer (Träger liegt auf ihrem Absatz auf)
    translate([-innen_rand - 1, kammer_y + kammer_wand + 0.2])
      square([kammer_x + kammer_wand + innen_rand + 1 - 0.2 + 1,
              env_h + innen_rand - kammer_y + 2]);
    // Freistiche um die Deckeldome
    for (p = dom_pos) translate(p) circle(d = dom_d + 1.2);
    // Löcher über den Zentrierzapfen
    for (p = stuetze_pos) translate(p) circle(d = zapfen_d + 0.4);
    // Kabeldurchlässe: Schlitze in den Lücken zwischen den Platinen
    for (y = [blk_my1, blk_my2]) translate([(blk_mx1+blk_mx2)/2, y])
      square([5, 26], center = true);
    translate([(set_mx + blk_mx1)/2 - 3, 20]) square([6, 30]);
    translate([env_b/2 - 4, env_h + innen_rand - 6]) square([8, 8]);
  }
}

// Vier Eckwinkel, die den Akku in der Ebene halten. Kein Deckel darüber —
// der Akku soll sich zum Tauschen nach oben herausnehmen lassen.
//
// Jeder Winkel ist EIN Polygon. Vorher waren es zwei Quader, die sich nur
// an einer Kante berührten; daraus wurde beim Export ein nicht-2-mannig-
// faltiger Körper, den ein Slicer stillschweigend falsch repariert.
module akku_rippen() {
  h  = akku_d + 0.2;              // etwas höher als der Akku
  l  = 14;                        // Schenkellänge
  b  = rippe_b;
  ix = akku_b + 2*bauteil_spiel;  // Innenmaß zwischen den Winkeln
  iy = akku_h + 2*bauteil_spiel;
  cx = akku_x + akku_b/2;
  cy = akku_y + akku_h/2;
  for (mx = [0,1], my = [0,1])
    translate([cx, cy, 0]) mirror([mx,0,0]) mirror([0,my,0])
      translate([-ix/2 - b, -iy/2 - b, 0])
        linear_extrude(h)
          polygon([[0,0], [l,0], [l,b], [b,b], [b,l], [0,l]]);
}

module feather_sockel() {
  for (sx = [-1,1], sy = [-1,1])
    translate([feather_x + feather_l/2 + sx*feather_loch_l/2,
               feather_y + feather_b/2 + sy*feather_loch_b/2, 0])
      difference() {
        cylinder(d = 5.0, h = feather_stuetze);
        translate([0,0,-0.5]) cylinder(d = 2.10, h = feather_stuetze + 1);
      }
}

module amp_bett() {
  h = amp_stuetze + 2.5;  b = rippe_b;  s = bauteil_spiel;
  // drei Rippen: der Verstärker wird eingeschoben und mit einem Streifen
  // doppelseitigem Klebeband gesichert. Zwei Löcher wären Ratespiel,
  // solange die Lochlage nicht nachgemessen ist.
  translate([amp_x - s - b, amp_y - s - b, 0]) cube([b, amp_h + 2*s + 2*b, h]);
  translate([amp_x - s - b, amp_y - s - b, 0]) cube([amp_b + 2*s + 2*b, b, h]);
  translate([amp_x + amp_b + s, amp_y - s - b, 0]) cube([b, amp_h + 2*s + 2*b, h]);
}

// Alles, was oben auf dem Träger steht, wird auf dessen Außenkontur
// beschnitten. Ohne das ragten die Distanzsockel des Feathers 0,16 mm
// über die Kante — der Träger hätte sich beim Einlegen an der Gehäuse-
// wand verhakt, und der Sockel hätte über der Kante in der Luft gedruckt.
// Beschnitten wird nur an der AUSSENkontur, nicht an den Löchern darin.
module traeger_aufbauten() {
  intersection() {
    union() {
      akku_rippen();
      feather_sockel();
      amp_bett();
    }
    linear_extrude(100) translate([mitte_x, mitte_y])
      rrect(innen_b - traeger_spiel, innen_h - traeger_spiel, ecke_r - wand);
  }
}

module traeger() {
  translate([0, 0, traeger_z_u]) {
    linear_extrude(traeger_d) traeger_umriss();
    translate([0, 0, traeger_d]) traeger_aufbauten();
  }
}


/* =====================================================================
   9.  DECKEL
   Flache Platte, innen völlig glatt. Druckt mit der Innenseite auf dem
   Bett und dem Logo nach oben — so ist die Prägung eine reine
   Aufwärtsgeometrie und gelingt auch auf einem müden Drucker.
   ===================================================================== */

module deckel() {
  db = aussen_b - 2*lippe - deckel_spiel;
  dh = aussen_h - 2*lippe - deckel_spiel;
  translate([mitte_x, mitte_y, innen_z_h]) difference() {
    union() {
      rprism_fase_o(db, dh, ecke_r - lippe, deckel_d, fase_deckel);
      translate([0, 0, deckel_d]) logo_3d(logo_deckel_b, logo_deckel_h);
    }
    for (p = dom_pos) translate([p[0] - mitte_x, p[1] - mitte_y, 0]) {
      translate([0,0,-1]) cylinder(d = dom_kern + 0.9, h = deckel_d + 2);
      // Senkung von außen: nach oben weiter werdend, also druckbar
      translate([0,0,deckel_d - senk_t])
        cylinder(d1 = dom_kern + 0.9, d2 = senk_d, h = senk_t + 0.01);
      translate([0,0,deckel_d]) cylinder(d = senk_d, h = 5);
    }
  }
}


/* =====================================================================
   10.  ATTRAPPEN  (nur zur Anschauung, nicht drucken)
   ===================================================================== */

module attrappen() {
  color("#333") for (p = sk_pos) {
    translate([p[0], p[1], sk_platine_z_v])
      linear_extrude(sk_platine_d) square([sk_platine_b, sk_platine_h], center=true);
    translate([p[0] + kappe_versatz_x, p[1] + kappe_versatz_y, -sk_kappe_ueberstand])
      linear_extrude(sk_gesamttiefe - 6)
        square([sk_kappe_b, sk_kappe_h], center = true);
  }
  color("#555") translate([ls_mx, ls_my, front_d])
    linear_extrude(ls_tiefe) square([ls_rahmen, ls_rahmen], center = true);
  color("#7a5") translate([akku_x, akku_y, traeger_z_o]) cube([akku_b, akku_h, akku_d]);
  color("#25a") translate([feather_x, feather_y, traeger_z_o + feather_stuetze])
    cube([feather_l, feather_b, feather_h]);
  color("#a52") translate([amp_x, amp_y, traeger_z_o + amp_stuetze])
    cube([amp_b, amp_h, amp_d]);
}


/* =====================================================================
   11.  AUSGABE
   ===================================================================== */

if (teil == "wanne")        wanne();
else if (teil == "traeger") translate([0,0,-traeger_z_u]) traeger();
else if (teil == "deckel")  translate([0,0,-innen_z_h]) deckel();
else if (teil == "montage") {
  color("#dcd8e8") wanne();
  color("#c8c0e0") traeger();
  color("#b8aed8") deckel();
  if (zeige_bauteile) attrappen();
}
else if (teil == "explosion") {
  color("#dcd8e8") wanne();
  if (zeige_bauteile) attrappen();
  color("#c8c0e0") translate([0,0,28]) traeger();
  color("#b8aed8") translate([0,0,60]) deckel();
}
else if (teil == "druckbett") {
  // alle drei Teile nebeneinander, jedes in seiner Drucklage
  wanne();
  translate([0, aussen_h + 8, -traeger_z_u]) traeger();
  translate([0, 2*aussen_h + 16, -innen_z_h]) deckel();
}
