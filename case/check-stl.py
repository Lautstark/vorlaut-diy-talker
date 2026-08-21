#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Checks the exported STL files against the dimensions from the .scad.

`verify.py` checks the numbers before OpenSCAD touches them. This script
checks what OpenSCAD made of them: outer dimensions and whether the decisive
places really hold material or air. That catches mistakes
that stay invisible at parameter level - a cutout with the wrong
depth, or a boss cut away by another solid.

    openscad -o /tmp/tub.stl   -D 'part="tub"'   case/vorlaut-case.scad
    openscad -o /tmp/carrier.stl -D 'part="carrier"' case/vorlaut-case.scad
    openscad -o /tmp/lid.stl  -D 'part="lid"'  case/vorlaut-case.scad
    python3 case/check-stl.py /tmp/tub.stl /tmp/carrier.stl /tmp/lid.stl

About the point probes: they are tested by casting a ray upwards (+z).
Points exactly on a cylinder axis or on a tessellation seam give
random results there - so every probe shoots three slightly offset rays and
lets the majority decide. Whoever adds a new probe should for the same reason
avoid round coordinates.
"""

import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify import load_parameters, SCAD          # noqa: E402


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
    votes = [_inside(tris, (pt[0] + dx, pt[1] + dy, pt[2]))
               for dx, dy in ((0.0, 0.0), (0.11, -0.07), (-0.09, 0.13))]
    return sum(votes) >= 2


class Run:
    def __init__(self):
        self.failed = 0

    def measure(self, what, actual, target, tol=0.05):
        ok = abs(actual - target) <= tol
        self.failed += 0 if ok else 1
        print('  %s %-46s %9.3f  expected %9.3f'
              % ('ok  ' if ok else 'FAIL', what, actual, target))

    def probe(self, tris, what, pt, expect_material):
        actual = material(tris, pt)
        ok = actual == expect_material
        self.failed += 0 if ok else 1
        print('  %s %-46s (%7.2f,%6.2f,%5.2f) %-8s expected %s'
              % ('ok  ' if ok else 'FAIL', what, pt[0], pt[1], pt[2],
                 'material' if actual else 'air',
                 'material' if expect_material else 'air'))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    p = load_parameters(SCAD)
    G = p.get
    L = Run()
    parts = {}
    for path in sys.argv[1:]:
        name = os.path.splitext(os.path.basename(path))[0].lower()
        for k in ('tub', 'carrier', 'lid'):
            if k in name:
                parts[k] = load_stl(path)

    print('\nOuter dimensions')
    print('----------------')
    if 'tub' in parts:
        b = bbox(parts['tub'])
        # The logo on the bottom edge stands 0.6 mm proud of the wall -
        # it is part of the piece, but not part of the case's size.
        L.measure('tub width', b[3] - b[0], G('outer_b'))
        L.measure('tub height (with logo at the bottom edge)', b[4] - b[1],
               G('outer_h') + G('logo_side_h'))
        L.measure('tub depth', b[5] - b[2], G('outer_t'))
    if 'carrier' in parts:
        b = bbox(parts['carrier'])
        L.measure('carrier width', b[3] - b[0],
               G('inner_b') - G('carrier_play'))
        L.measure('carrier height', b[4] - b[1], G('inner_h') - G('carrier_play'))
        L.measure('carrier build height', b[5] - b[2], G('carrier_d') + G('battery_d') + 0.2)
    if 'lid' in parts:
        b = bbox(parts['lid'])
        L.measure('lid width', b[3] - b[0],
               G('outer_b') - 2 * G('lip') - G('lid_play'))
        L.measure('lid height', b[4] - b[1],
               G('outer_h') - 2 * G('lip') - G('lid_play'))
        L.measure('lid build height', b[5] - b[2],
               G('lid_d') + G('logo_lid_h'))

    if 'tub' in parts:
        w = parts['tub']
        print('\nPoint probes in the tub')
        print('----------------------')
        zf = G('front_d') / 2
        sk = [(G('set_mx'), G('set_my')),
              (G('blk_mx1'), G('blk_my1')), (G('blk_mx2'), G('blk_my1')),
              (G('blk_mx1'), G('blk_my2')), (G('blk_mx2'), G('blk_my2'))]
        for i, (x, y) in enumerate(sk):
            x += G('cap_offset_x')
            y += G('cap_offset_y')
            L.probe(w, 'key cutout %d is open' % i, (x + .37, y + .29, zf), False)
            L.probe(w, 'front next to cutout %d is solid' % i,
                    (x + G('sk_cap_b') / 2 + G('gap_cap') + 1.5, y + .29, zf), True)
        L.probe(w, 'front between the key pairs',
                ((G('blk_mx1') + G('blk_mx2')) / 2 + .37, G('blk_my1') + .37, zf), True)
        L.probe(w, 'Lautsprecher-Gitterloch offen', (G('spk_mx') + .17, G('spk_my') + .11, zf), False)
        L.probe(w, 'web next to the grille hole',
                (G('spk_mx') + G('grille_pitch') / 2 + .05, G('spk_my') + .11, zf), True)
        yc = G('feather_y') + G('feather_b') / 2
        xw = -G('inner_margin') - G('wall') / 2 + .11
        L.probe(w, 'USB-Fenster offen', (xw, yc + .37, G('usb_z')), False)
        L.probe(w, 'wall below the USB window', (xw, yc + .37, G('usb_z') - 4.5), True)
        L.probe(w, 'wall next to the USB window', (xw, yc + 12, G('usb_z')), True)
        d = (G('blk_mx1') + G('sk_hole_dx'), G('blk_my1') + G('sk_hole_dy'))
        L.probe(w, 'ScreenKey boss has material', (d[0] + 1.06, d[1] + 1.06, 8.0), True)
        L.probe(w, 'next to the ScreenKey boss is air', (d[0] + 4.0, d[1] + 4.0, 8.0), False)
        L.probe(w, 'lid boss bottom centre stands',
                (G('env_b') / 2 + 2.0, -G('boss_e') + 0.5, 10.0), True)
        L.probe(w, 'chamber wall stands',
                (G('chamber_x') + G('chamber_wall') / 2, 60.11, 20.0), True)
        L.probe(w, 'chamber is hollow inside', (20.11, 60.07, 30.0), False)
        L.probe(w, 'inner space is hollow', (G('env_b') / 2 + .37, G('env_h') / 2 + .29, 28.0), False)

    print()
    if L.failed:
        print('%d check(s) failed.' % L.failed)
    else:
        print('All checks passed.')
    return 1 if L.failed else 0


if __name__ == '__main__':
    sys.exit(main())
