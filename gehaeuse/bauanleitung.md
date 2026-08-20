# Gehäuse bauen

Drei gedruckte Teile, sechs Schrauben, ein Abend Arbeit. Die Maße stehen
alle in [`mitreden-gehaeuse.scad`](mitreden-gehaeuse.scad); diese Datei
erklärt, was man damit macht.

> **Ungetestet.** Zum Zeitpunkt dieser Zeilen war noch kein Bauteil in der
> Hand — alle Maße stammen aus `docs/hardware.md`, aus Datenblättern oder
> sind begründete Annahmen. Was vor dem ersten Druck nachzumessen ist,
> steht unten unter [Vorher nachmessen](#vorher-nachmessen).

## Die drei Teile

| Teil | Was es tut | Außenmaß |
|---|---|---|
| **Wanne** | Frontplatte, Wände, Lautsprecherkammer, alle Dome | 135,9 × 99,4 × 37,4 mm |
| **Träger** | Zwischenboden, trennt Verkabelung von Akku | 130,7 × 94,2 × 10,7 mm |
| **Deckel** | Rückwand mit Logo | 133,1 × 96,6 × 3,8 mm |

Alle drei Maße sind am exportierten STL nachgemessen, nicht nur gerechnet.
Der Platzbedarf der Wanne auf dem Bett ist 136,0 × 100,0 mm — das Logo an
der Unterkante steht 0,6 mm vor die Wand.

```bash
openscad -o wanne.stl -D 'teil="wanne"' gehaeuse/mitreden-gehaeuse.scad
```

Dasselbe mit `traeger` und `deckel`. `teil="montage"` zeigt alles
zusammengesetzt, `teil="explosion"` auseinandergezogen, `teil="druckbett"`
alle drei in Drucklage nebeneinander.

Läuft OpenSCAD nicht — unter macOS blockiert Gatekeeper die App beim
Start aus dem Finder —, hilft einmaliges Öffnen über *Rechtsklick →
Öffnen*. Für die Maßkontrolle braucht man OpenSCAD aber gar nicht:

```bash
python3 gehaeuse/nachrechnen.py
```

Das Skript liest die Maße aus der `.scad` und prüft sie unabhängig nach —
Tastenabstände, Tiefenbudget, Kollisionen, Wandstärken, Druckbett,
Schwerpunkt. Rückgabewert 0 heißt: alles geht auf.

Und wenn die STL-Dateien da sind, prüft ein zweites Skript, was OpenSCAD
tatsächlich gebaut hat — Außenmaße und ob an den entscheidenden Stellen
Material bzw. Luft ist:

```bash
python3 gehaeuse/pruefe-stl.py wanne.stl traeger.stl deckel.stl
```

Das fängt Fehler, die auf Parameterebene unsichtbar bleiben: einen
Ausschnitt mit falscher Tiefe etwa, oder einen Dom, den ein anderer Körper
weggeschnitten hat. Beide Skripte brauchen nichts außer Python 3.

## Drucken

Einfacher FDM-Drucker, eine Farbe, **keine Stützstruktur**. Der Entwurf
kommt ohne aus: der Innenraum wird nach hinten stufenweise weiter, jede
Stufe ist damit eine nach oben zeigende Auflage statt eines Überhangs.
Alle Fasen sind 45°.

| Einstellung | Wert | Warum |
|---|---|---|
| Düse | 0,4 mm | Die Wandstärken sind ganze Vielfache davon |
| Schichthöhe | 0,2 mm | Platten sind ganze Vielfache davon |
| Perimeter | 3 | 3 × 0,4 = 1,2 mm je Seite, Wand 2,4 mm ist damit massiv |
| Boden / Deckel | 5 / 5 Lagen | 1,0 mm — die Frontplatte trägt die Tasten |
| Füllung | 25 % Gitter | Mehr bringt nichts, weniger federt |
| Material | PLA oder PETG | PETG ist zäher, PLA maßhaltiger |
| Stützen | **aus** | werden nicht gebraucht |
| Brim | 5 mm bei der Wanne | 136 mm flache Fläche neigt zum Ablösen |

Kein ABS: das Gerät liegt bei einem Kleinkind herum, und ABS-Kanten
splittern, wenn etwas herunterfällt.

### Ausrichtung auf dem Bett

Alle drei Teile drucken **genau so, wie sie in der `.scad` stehen** —
`teil="druckbett"` zeigt es. Nicht drehen, das ist kein Zufall:

- **Wanne**: Frontfläche auf dem Bett, Öffnung nach oben. Die Frontplatte
  wird dadurch glatt (Bettseite), und alle Dome wachsen nach oben. Anders
  herum wären die Tastenausschnitte Überhänge und die Dome bräuchten
  Stützen.
- **Träger**: flach, Rippen nach oben.
- **Deckel**: **Innenseite auf dem Bett, Logo nach oben.** Die Prägung ist
  dann reine Aufwärtsgeometrie und gelingt auch auf einem müden Drucker.
  Andersherum wäre sie ein Überhang und würde verschmieren.

Die einzige freitragende Stelle ist die Oberkante des USB-Fensters:
**8,4 mm Brücke** in einer senkrechten Wand. Das schafft jeder Drucker;
wenn die erste Lage darüber durchhängt, Lüfter hoch.

### Was schiefgehen kann

- **Tastenausschnitte zu eng.** Ist der Drucker etwas breit unterwegs,
  klemmt die Kappe. Der Luftspalt beträgt 0,6 mm ringsum
  (`spalt_kappe`) — bei einem Testdruck der Frontplatte prüfen, bevor
  das ganze Teil läuft.
- **Elefantenfuß an der Wanne.** Die Frontfläche liegt auf dem Bett; ein
  ausgequetschte erste Lage macht die Tastenausschnitte kleiner. In der
  Slicer-Einstellung *elephant foot compensation* auf 0,2 mm.
- **Dome brechen ab.** Nur beim Vorbohren-Wollen. Nicht vorbohren, die
  Kernlöcher sind schon drin.

## Toleranzen

Alle Spiele stehen als benannte Variablen in Abschnitt 3 der `.scad`.

| Wo | Variable | Wert | Gedacht für |
|---|---|---|---|
| Um die Tastenkappe | `spalt_kappe` | 0,60 mm | Taste darf nie klemmen — aber kein Kinderfinger hinein |
| Deckel im Falz | `deckel_spiel` | 0,40 mm | Deckel soll fallen, nicht klemmen |
| Träger | `traeger_spiel` | 0,40 mm | dito |
| Um Akku und Verstärker | `bauteil_spiel` | 0,40 mm | Bauteil einlegen ohne Gewalt |
| Um das Lautsprecherchassis | `kammer_luft` | 2,00 mm | Chassis sitzt nie stramm im Rahmen |

Druckt der Drucker grundsätzlich zu fett, **nicht** hier herumschrauben,
sondern den Extrusionsfaktor kalibrieren. Diese Zahlen sind Konstruktions-
maße, keine Druckerkorrektur.

## Schrauben statt Schnappverschlüsse

Sechs **M3 × 12 Senkkopf**, von hinten durch den Deckel in die Dome der
Wanne. Dazu vier **M2 × 6** je ScreenKey (20 Stück) und vier **M2,5 × 8**
für den Lautsprecher.

Warum keine Schnapphaken:

- Ein Schnapphaken ist eine dünne, biegsame Nase. Genau so etwas bricht
  ab und liegt dann als verschluckbares Kleinteil im Gerät — bei einem
  Dreieinhalbjährigen das Ausschlusskriterium.
- Gedruckte Schnapphaken ermüden. Dieses Gehäuse ist ein Prototyp; es
  wird oft geöffnet, nicht einmal.
- Ein Haken zieht die Fuge nicht zu. Für den Lautsprecher brauchen wir
  hinten aber ein möglichst dichtes Volumen, und das heißt: Deckel fest
  angezogen auf eine plane Auflage.

Voreingestellt sind **selbstschneidende M3 direkt ins Plastik**
(`dom_kern = 2,5`). Das braucht kein Werkzeug außer einem Schraubendreher
und hält für ein Prototypenleben. Wer das Gehäuse oft öffnet, setzt oben
in der `.scad`

```
gewindeeinsatz = true;
```

und bekommt Dome für **M3-Gewindeeinsätze zum Einschmelzen** (Ø 4,0 × 5 mm).
Die Dome werden dadurch 8 statt 6 mm dick, und weil sie an der Innenwand
stehen, wächst das Gehäuse automatisch auf 139,9 × 103,4 mm mit. Das ist
kein Versehen, sondern abgeleitet: `innen_rand` folgt der Domgröße.

## Zusammenbau

Reihenfolge ist nicht beliebig — von vorn nach hinten, weil jede Lage die
darunter festhält.

1. **Grate brechen.** Einmal mit dem Finger über alle Kanten. Die
   Frontkante hat eine 1,2-mm-Fase, die Tastenausschnitte 0,8 mm; bleibt
   trotzdem ein Faden stehen, weg damit.

2. **Lautsprecher in die Wanne.** Von innen gegen die Frontplatte, in die
   vier Führungsrippen. Vier M2,5 durch die Frontplatte, Senkung ist von
   außen vorgesehen. **Vorher einen Streifen Dichtband oder Moosgummi
   zwischen Chassisrand und Frontplatte** — sonst pfeift die Luft um das
   Chassis herum und das geschlossene Volumen ist keins. Litzen durch den
   Durchlass in der Kammerwand nach rechts herausführen.

3. **Kammerdurchlass abdichten.** Der Kabeldurchlass ist bewusst großzügig
   (7 × 5 mm). Nach dem Durchfädeln mit Heißkleber zu — das ist die
   einzige verbleibende Undichtigkeit der Kammer.

4. **Fünf ScreenKeys einsetzen.** Von innen in die Ausschnitte, Modulkörper
   flach gegen die Frontplatte, je vier M2 in die Dome. Nicht überdrehen,
   das sind gedruckte Gewinde. **Jetzt prüfen: drückt sich jede Taste
   sauber und federt zurück?** Wenn nicht, sitzt sie am Ausschnitt an —
   dann anhalten und unten [Vorher nachmessen](#vorher-nachmessen) lesen.

5. **Verkabeln.** Alles nach `docs/hardware.md`. Die Litzen so legen, dass
   sie im 6 mm hohen Kabelraum hinter den Platinen bleiben und nicht über
   die Trägerauflage ragen.

6. **Träger einlegen.** Fällt auf die vier Zentrierzapfen und den Absatz
   ringsum. Er wird nicht verschraubt — der Deckel hält ihn. Kabel durch
   die Schlitze nach oben.

7. **Feather auf den Träger.** Auf die vier Distanzsockel, USB-C-Buchse in
   das Fenster der linken Wand. Die Buchse muss die Wand **erreichen** und
   nicht darin klemmen: Seitenkräfte am Kabel soll die Wand aufnehmen, nicht
   die aufgelötete Buchse.

8. **Verstärker.** In das Rippenbett rechts neben der Kammerwand, mit einem
   Streifen doppelseitigem Klebeband. Zwei Schraublöcher wären Ratespiel,
   solange die Lochlage nicht nachgemessen ist.

9. **Akku.** Flach in die vier Eckwinkel, JST-Stecker an den Feather.
   Der Akku wird **nicht** verklebt — er ist das Teil, wegen dem sich das
   Gehäuse öffnen lässt. Kabel nicht unter den Akku legen.

10. **Deckel drauf, sechs M3 anziehen.** Über Kreuz und nur handfest.

## Vorher nachmessen

Diese Zahlen sind Annahmen. Stimmen sie nicht, ändert sich der Entwurf —
teilweise erheblich.

### Sitzt die Tastenkappe mittig auf der Platine?

**Die größte offene Unbekannte.** Auf den Produktbildern liegen Stiftleiste
und FPC-Stecker im unteren Bereich der Platine; sitzt die Kappe deshalb
nach oben versetzt, wandern alle fünf Frontausschnitte mit.

Dafür ist genau **eine Zahl** vorgesehen:

```
kappe_versatz_y = 0.00;   // Versatz der Kappenmitte, positiv = nach oben
```

Messen: Abstand Kappenoberkante zur Platinenoberkante, minus Abstand
Kappenunterkante zur Platinenunterkante, geteilt durch zwei. Eintragen,
fertig — Ausschnitte, Fasen, Logo und alle Prüfungen rechnen mit.

**Aber das Budget ist klein: 0,595 mm.** Das ist keine Bequemlichkeit,
sondern die Geometrie des Moduls. Zwischen Kappenkante (12,65 mm von der
Mitte) und Lochmitte (15,645 mm) liegen nur 2,995 mm. Davon braucht der
Dom 1,8 mm und der Luftspalt 0,6 mm. Der Rest ist der Spielraum.

Wird mehr eingetragen, lässt der Entwurf die Dome weg, die sonst
angeschnitten würden — angeschnittene Dome mit 0,3 mm Restwand brechen
beim ersten Schrauben ab und liegen dann lose im Gerät. Ab etwa 0,6 mm
Versatz bleiben zwei Dome je Taste, und die Platine hängt an **einer**
Kante. Dann meldet sich beim Rendern eine Warnung.

Ist der Versatz wirklich groß, ist die Antwort nicht, die Zahl
kleinerzureden, sondern:

```bash
python3 gehaeuse/nachrechnen.py --versatz 2.0
```

anzusehen und dann `sk_loch_rand` am echten Modul nachzumessen. Womöglich
sitzen die Löcher ganz woanders, als hier angenommen — dann stimmt das
Budget wieder.

### Die übrigen Annahmen

| Variable | Angenommen | Prüfen |
|---|---|---|
| `sk_loch_rand` | 2,00 mm | Wo sitzen die Befestigungslöcher wirklich? Gibt es überhaupt welche? |
| `sk_loch_d` | 2,20 mm | Lochdurchmesser |
| `sk_platine_d` | 1,60 mm | Platinendicke |
| `sk_kappe_tiefe` | 15,40 mm | Wie tief reicht der **bewegliche** Kappenkörper hinter die Front? |
| `feather_h` | 8,00 mm | Höchstes Bauteil auf dem Feather — bestimmt die Gehäusetiefe |
| `usb_ueberstand` | 1,50 mm | Wie weit steht die Buchse über die Platinenkante? |
| `usb_mitte_ueber_pcb` | 1,60 mm | Höhe der Buchsenmitte über der Platine |
| `amp_b`, `amp_h` | 19,4 × 17,8 | Maße des MAX98357A-Breakouts |
| `ls_loch_diagonale` | 46,20 mm | Lochkreis des Lautsprechers |

Nach dem Nachmessen einmal

```bash
python3 gehaeuse/nachrechnen.py
```

laufen lassen. Was nicht mehr aufgeht, steht dann als `FEHL` da — mit Ist-
und Sollwert, damit man sieht, wie weit es fehlt.

## Das Logo

Sprechblase mit zwei Augen und einem Lächeln, aus
[`assets/icon.svg`](../assets/icon.svg) nachgebaut — nicht importiert.
Ein `import()` der SVG hätte die Datei an einen zweiten Pfad gebunden und
bei jeder Änderung am Icon stillschweigend das Gehäuse mitverändert.
Stattdessen stehen die SVG-Koordinaten unverändert in der `.scad`
(512er-Kasten, y nach unten), sodass ein Blick in beide Dateien zum
Vergleichen genügt.

Es sitzt zweimal am Gerät:

- **Auf dem Deckel**, 70 mm breit, **0,8 mm erhaben** — vier Lagen bei
  0,2 mm. Weniger gibt ein abgenutzter Drucker nicht mehr sauber wieder;
  bei 0,4 mm verschwimmt die Kontur mit der Umgebung. Die obere Stufe ist
  0,4 mm schmaler als die untere: eine gedruckte Fase, damit die Kante
  nicht ausbricht und sich für Kinderhände nicht scharf anfühlt.
- **An der Unterkante**, 20 mm breit, 0,6 mm erhaben — dort, wo man das
  Gerät anfasst.

Erhaben statt vertieft, weil eine Vertiefung bei einer Farbe nur als
Schatten sichtbar ist und sich mit Dreck zusetzt. Erhaben fühlt man es
auch — was bei einem Gerät für ein Kind, das nicht spricht, kein Nachteil ist.
