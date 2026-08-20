#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prüft die exportierten STL-Dateien gegen die Maße aus der .scad.

`nachrechnen.py` prüft die Zahlen, bevor OpenSCAD sie anfasst. Dieses
Skript prüft, was OpenSCAD daraus gemacht hat: Außenmaße und ob an den
entscheidenden Stellen wirklich Material bzw. Luft ist. Das fängt Fehler,
die auf Parameterebene unsichtbar sind — ein Ausschnitt, der die falsche
Tiefe hat, oder ein Dom, der von einem anderen Körper weggeschnitten wurde.

    openscad -o /tmp/wanne.stl   -D 'teil="wanne"'   gehaeuse/mitreden-gehaeuse.scad
    openscad -o /tmp/traeger.stl -D 'teil="traeger"' gehaeuse/mitreden-gehaeuse.scad
    openscad -o /tmp/deckel.stl  -D 'teil="deckel"'  gehaeuse/mitreden-gehaeuse.scad
    python3 gehaeuse/check-stl.py /tmp/wanne.stl /tmp/traeger.stl /tmp/deckel.stl

Zu den Punktproben: getestet wird per Strahlensatz nach oben (+z). Punkte
genau auf einer Zylinderachse oder auf einer Tessellierungsnaht liefern
dabei Zufallsergebnisse — deshalb schießt jede Probe drei leicht versetzte
Strahlen und lässt die Mehrheit entscheiden. Wer eine neue Probe ergänzt,
sollte aus demselben Grund keine glatten Koordinaten wählen.
"""

import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nachrechnen import load_parameters, SCAD          # noqa: E402


def load_stl(path):
    with open(path, 'rb') as f:
        d = f.read()
    if d[:5].lower() == b'solid' and b'facet' in d[:2000]:
        vs = [tuple(float(x) for x in m.groups())
              for m in re.finditer(rb'vertex\s+(\S+)\s+(\S+)\s+(\S+)', d)]
        return [tuple(vs[i:i + 3]) for i in range(0, len(vs), 3)]
    n = struct.unpack('<I', d[80:84])[0]
    tris, off = [], 84
    for _ in range(n):
        v = struct.unpack('<12f', d[off:off + 48])
        tris.append(((v[3], v[4], v[5]), (v[6], v[7], v[8]),
                     (v[9], v[10], v[11])))
        off += 50
    return tris


def bbox(tris):
    xs = [p[0] for t in tris for p in t]
    ys = [p[1] for t in tris for p in t]
    zs = [p[2] for t in tris for p in t]
    return min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)


def _inside(tris, pt):
    px, py, pz = pt
    hits = 0
    for a, b, c in tris:
        d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1])
        d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1])
        d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])
        if (d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0):
            continue
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        nx = u[1] * v[2] - u[2] * v[1]
        ny = u[2] * v[0] - u[0] * v[2]
        nz = u[0] * v[1] - u[1] * v[0]
        if abs(nz) < 1e-12:
            continue
        zs = a[2] + (nx * (a[0] - px) + ny * (a[1] - py)) / nz
        if zs > pz + 1e-9:
            hits += 1
    return hits % 2 == 1


def material(tris, pt):
    """Drei leicht versetzte Strahlen, Mehrheit entscheidet."""
    stimmen = [_inside(tris, (pt[0] + dx, pt[1] + dy, pt[2]))
               for dx, dy in ((0.0, 0.0), (0.11, -0.07), (-0.09, 0.13))]
    return sum(stimmen) >= 2


class Lauf:
    def __init__(self):
        self.fehl = 0

    def measure(self, was, ist, soll, tol=0.05):
        ok = abs(ist - soll) <= tol
        self.fehl += 0 if ok else 1
        print('  %s %-46s %9.3f  soll %9.3f'
              % ('ok  ' if ok else 'FEHL', was, ist, soll))

    def probe(self, tris, was, pt, soll_material):
        ist = material(tris, pt)
        ok = ist == soll_material
        self.fehl += 0 if ok else 1
        print('  %s %-46s (%7.2f,%6.2f,%5.2f) %-8s soll %s'
              % ('ok  ' if ok else 'FEHL', was, pt[0], pt[1], pt[2],
                 'Material' if ist else 'Luft',
                 'Material' if soll_material else 'Luft'))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    p = load_parameters(SCAD)
    G = p.get
    L = Lauf()
    teile = {}
    for path in sys.argv[1:]:
        name = os.path.splitext(os.path.basename(path))[0].lower()
        for k in ('wanne', 'traeger', 'deckel'):
            if k in name:
                teile[k] = load_stl(path)

    print('\nAussenmasse')
    print('-----------')
    if 'wanne' in teile:
        b = bbox(teile['wanne'])
        # Das Logo an der Unterkante steht 0,6 mm vor die Wand — es gehoert
        # zum Bauteil, aber nicht zum Gehaeusemass.
        L.measure('Wanne Breite', b[3] - b[0], G('aussen_b'))
        L.measure('Wanne Hoehe (mit Logo an der Unterkante)', b[4] - b[1],
               G('aussen_h') + G('logo_seite_h'))
        L.measure('Wanne Tiefe', b[5] - b[2], G('aussen_t'))
    if 'traeger' in teile:
        b = bbox(teile['traeger'])
        L.measure('Traeger Breite', b[3] - b[0],
               G('innen_b') - G('traeger_spiel'))
        L.measure('Traeger Hoehe', b[4] - b[1], G('innen_h') - G('traeger_spiel'))
        L.measure('Traeger Bauhoehe', b[5] - b[2], G('traeger_d') + G('akku_d') + 0.2)
    if 'deckel' in teile:
        b = bbox(teile['deckel'])
        L.measure('Deckel Breite', b[3] - b[0],
               G('aussen_b') - 2 * G('lippe') - G('deckel_spiel'))
        L.measure('Deckel Hoehe', b[4] - b[1],
               G('aussen_h') - 2 * G('lippe') - G('deckel_spiel'))
        L.measure('Deckel Bauhoehe', b[5] - b[2],
               G('deckel_d') + G('logo_deckel_h'))

    if 'wanne' in teile:
        w = teile['wanne']
        print('\nPunktproben in der Wanne')
        print('------------------------')
        zf = G('front_d') / 2
        sk = [(G('set_mx'), G('set_my')),
              (G('blk_mx1'), G('blk_my1')), (G('blk_mx2'), G('blk_my1')),
              (G('blk_mx1'), G('blk_my2')), (G('blk_mx2'), G('blk_my2'))]
        for i, (x, y) in enumerate(sk):
            x += G('kappe_versatz_x')
            y += G('kappe_versatz_y')
            L.probe(w, 'Tastenausschnitt %d ist offen' % i, (x + .37, y + .29, zf), False)
            L.probe(w, 'Front neben Ausschnitt %d ist massiv' % i,
                    (x + G('sk_kappe_b') / 2 + G('spalt_kappe') + 1.5, y + .29, zf), True)
        L.probe(w, 'Front zwischen den Tastenpaaren',
                ((G('blk_mx1') + G('blk_mx2')) / 2 + .37, G('blk_my1') + .37, zf), True)
        L.probe(w, 'Lautsprecher-Gitterloch offen', (G('ls_mx') + .17, G('ls_my') + .11, zf), False)
        L.probe(w, 'Steg neben dem Gitterloch',
                (G('ls_mx') + G('gitter_raster') / 2 + .05, G('ls_my') + .11, zf), True)
        yc = G('feather_y') + G('feather_b') / 2
        xw = -G('innen_rand') - G('wand') / 2 + .11
        L.probe(w, 'USB-Fenster offen', (xw, yc + .37, G('usb_z')), False)
        L.probe(w, 'Wand unter dem USB-Fenster', (xw, yc + .37, G('usb_z') - 4.5), True)
        L.probe(w, 'Wand neben dem USB-Fenster', (xw, yc + 12, G('usb_z')), True)
        d = (G('blk_mx1') + G('sk_loch_dx'), G('blk_my1') + G('sk_loch_dy'))
        L.probe(w, 'ScreenKey-Dom hat Fleisch', (d[0] + 1.06, d[1] + 1.06, 8.0), True)
        L.probe(w, 'neben dem ScreenKey-Dom ist Luft', (d[0] + 4.0, d[1] + 4.0, 8.0), False)
        L.probe(w, 'Deckeldom Mitte unten steht',
                (G('env_b') / 2 + 2.0, -G('dom_e') + 0.5, 10.0), True)
        L.probe(w, 'Kammerwand steht',
                (G('kammer_x') + G('kammer_wand') / 2, 60.11, 20.0), True)
        L.probe(w, 'Kammer ist innen hohl', (20.11, 60.07, 30.0), False)
        L.probe(w, 'Innenraum ist hohl', (G('env_b') / 2 + .37, G('env_h') / 2 + .29, 28.0), False)

    print()
    if L.fehl:
        print('%d Pruefung(en) gefallen.' % L.fehl)
    else:
        print('Alle Pruefungen bestanden.')
    return 1 if L.fehl else 0


if __name__ == '__main__':
    sys.exit(main())
