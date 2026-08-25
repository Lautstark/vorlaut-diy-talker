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
    """Three slightly offset rays, the majority decides."""
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
        # A raised logo on the bottom edge stands 0.6 mm proud of the wall -
        # part of the piece, but not part of the case's size. Cut in, it takes
        # nothing away from the bounding box either.
        L.measure('tub width', b[3] - b[0], G('outer_b'))
        L.measure('tub height', b[4] - b[1],
               G('outer_h') + (0.0 if G('logo_recessed') else G('logo_side_h')))
        L.measure('tub depth', b[5] - b[2], G('outer_t'))
    if 'carrier' in parts:
        b = bbox(parts['carrier'])
        L.measure('carrier width', b[3] - b[0],
               G('inner_b') - G('carrier_play'))
        L.measure('carrier height', b[4] - b[1], G('inner_h') - G('carrier_play'))
        # Plate plus battery brackets, and nothing below the plate - the
        # modules stand off it on their own spacers, so this part is still
        # flat on one side and still prints without support.
        # Plate, plus the battery brackets above it and - when the Feather
        # stands - the bracket hanging below. That last one is why this part
        # no longer prints without support.
        L.measure('carrier build height', b[5] - b[2],
               (G('feather_br_l') if G('feather_standing') else 0.0)
               + G('carrier_d') + G('battery_d') + 0.2)
    if 'lid' in parts:
        b = bbox(parts['lid'])
        L.measure('lid width', b[3] - b[0],
               G('outer_b') - 2 * G('lip') - G('lid_play'))
        L.measure('lid height', b[4] - b[1],
               G('outer_h') - 2 * G('lip') - G('lid_play'))
        # Whichever stands proudest of the lid sets its build height - the
        # logo, or the feet if there are any. A logo that is cut in stands
        # proud of nothing, and then the lid is just a plate.
        L.measure('lid build height', b[5] - b[2],
               G('lid_d') + max(0.0 if G('logo_recessed') else G('logo_lid_h'),
                                G('feet_h') if G('feet_on') else 0.0))

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
        L.probe(w, 'speaker grille hole is open', (G('spk_mx') + .17, G('spk_my') + .11, zf), False)
        L.probe(w, 'web next to the grille hole',
                (G('spk_mx') + G('grille_pitch') / 2 + .05, G('spk_my') + .11, zf), True)
        # Which wall, and where up it, both follow from how the board is
        # mounted. Standing, the socket is on a short edge at the -x wall and
        # halfway up the board; flat, it is on the +x wall above the plate.
        yc = (G('feather_y') + G('feather_pcb_d') / 2 if G('feather_standing')
              else G('feather_y') + G('feather_b') / 2)
        # The USB window is in the +x wall - the wall the speaker and the set
        # key are nearest, so the child's left.
        xw = (-G('inner_margin') - G('wall') / 2 - .11 if G('feather_standing')
              else G('env_b') + G('inner_margin') + G('wall') / 2 + .11)
        L.probe(w, 'USB window is open', (xw, yc + .37, G('usb_z')), False)
        L.probe(w, 'wall below the USB window',
                (xw, yc + .37, G('usb_z') - G('usb_win_z') / 2 - 2.0), True)
        L.probe(w, 'wall next to the USB window',
                (xw, yc + (-12 if G('feather_standing') else 12), G('usb_z')), True)
        # Nothing of the ScreenKey fixing is left in the tub. Where a boss
        # used to stand there has to be air now, and the band between the back
        # of the board and the carrier has to be clear over its whole depth -
        # that is where the module's threaded spacers sit.
        d = (G('blk_mx1') + G('sk_hole_dx'), G('blk_my1') + G('sk_hole_dy'))
        L.probe(w, 'no ScreenKey boss left in the tub',
                (d[0] + 1.06, d[1] + 1.06, 8.0), False)
        L.probe(w, 'the spacer band through the tub is clear',
                (d[0] + 1.06, d[1] + 1.06,
                 (G('sk_behind_front') + G('carrier_z_bottom')) / 2), False)
        L.probe(w, 'lid boss bottom centre stands',
                (G('env_b') / 2 + 2.0, -G('boss_e') + 0.5, 10.0), True)
        L.probe(w, 'chamber wall stands',
                (G('chamber_x') - G('chamber_wall') / 2, 60.11, 20.0), True)
        L.probe(w, 'chamber is hollow inside',
                (G('spk_mx') + .11, 60.07, 30.0), False)
        # The icon is fixed geometry, so it can be probed exactly. This pair
        # proves both that the mark was cut and that it is an OUTLINE: the
        # stroke is air, the bubble's middle a few mm inside it is not.
        if G('front_mark_on'):
            iy = G('mark_y') + G('mark_icon_h') * (166.0 / 332.0) \
                 - G('mark_stroke') / 2
            L.probe(w, 'the icon outline is cut into the front',
                    (G('mark_icon_x') + .11, iy, G('mark_depth') / 2), False)
            L.probe(w, 'and the bubble inside it is not',
                    (G('mark_icon_x') + .11, iy - 3.0, G('mark_depth') / 2), True)
            L.probe(w, 'front plate left behind the marks',
                    (G('mark_icon_x') + .11, iy,
                     G('mark_depth') + (G('front_d') - G('mark_depth')) / 2), True)

        L.probe(w, 'inner space is hollow', (G('env_b') / 2 + .37, G('env_h') / 2 + .29, 28.0), False)

    if 'carrier' in parts:
        c = parts['carrier']
        print('\nPoint probes in the carrier')
        print('--------------------------')
        # In the carrier's own STL z = 0 is the lowest point of the part -
        # the bottom of the Feather bracket when there is one, otherwise the
        # underside of the plate.
        z0 = G('feather_br_l') if G('feather_standing') else 0.0
        z_plate = z0 + G('carrier_d') / 2
        z_csink = z0 + G('carrier_d') - 0.1
        d = (G('blk_mx1') + G('sk_hole_dx'), G('blk_my1') + G('sk_hole_dy'))
        L.probe(c, 'plate around the screw hole is plate',
                (d[0] + 4.07, d[1] + 4.11, z_plate), True)
        L.probe(c, 'screw hole through the plate is open',
                (d[0] + 0.09, d[1] + 0.13, z_plate), False)
        # A pair that only comes out right if the countersink is really there:
        # 1.8 mm off the axis is material down in the plate and air up at the
        # back face, where the cone has opened out to 3.8 mm.
        L.probe(c, 'below the countersink is solid plate',
                (d[0] + 1.27, d[1] + 1.29, z_plate), True)
        L.probe(c, 'countersink has opened out at the back face',
                (d[0] + 1.27, d[1] + 1.29, z_csink), False)

        # The two upper screws of the set key reach into the chamber cutout
        # and each keeps a tab of plate under it. The probe has to sit above
        # the edge of the cutout to be testing that tab and not simply the
        # plate below it: the cutout starts at chamber_y - carrier_chamber_gap
        # and the pad reaches sk_pad_d / 2 past the screw, so 2.2 mm up from
        # the screw is inside both.
        t = (G('set_mx') - G('sk_hole_dx'), G('set_my') + G('sk_hole_dy'))
        cut_y = G('chamber_y') - G('carrier_chamber_gap')
        assert t[1] + 2.2 > cut_y, 'the tab probe fell below the cutout'
        L.probe(c, 'tab under the set key screw', (t[0] + 0.53, t[1] + 2.2,
                                                   z_plate), True)
        # ... and this is the one that would have caught the first build. The
        # horizontal chamber wall sits between chamber_y and chamber_y +
        # chamber_wall. The carrier used to have material right there and
        # therefore would not go in.
        L.probe(c, 'carrier is cut away where the chamber wall is',
                (G('spk_mx') + .11, G('chamber_y') + G('chamber_wall') / 2,
                 z_plate), False)
        # The Feather's well, and the four pads in its floor. The pads are the
        # plate's own bottom layers, so the pair below is the whole test: air
        # up at plate level, material down at the pads' height, on the same
        # (x, y). Anything else means the well cut through them or they were
        # never there.
        if G('feather_standing'):
            # The bay is a clean hole through the plate, and the bracket hangs
            # off the strip of plate just below it. The pair below is the
            # whole test: air in the bay at plate level, material in the strip.
            bx = G('feather_bay_x') + G('feather_bay_l') / 2
            by = G('feather_bay_y') + G('feather_bay_w') / 2
            L.probe(c, 'the Feather bay is open through the plate',
                    (bx + 0.37, by + 0.29, z_plate), False)
            L.probe(c, 'plate left below it for the bracket',
                    (bx + 0.37, G('feather_bay_y') - G('feather_br_wall') / 2,
                     z_plate), True)
            # ... and the bracket itself hangs under that strip.
            L.probe(c, 'the bracket hangs below the plate',
                    (bx + 0.37, G('feather_y') - G('feather_br_wall') / 2,
                     (z0 - G('feather_br_l') / 2)), True)
            L.probe(c, 'and the board slot between its walls is clear',
                    (bx + 0.37, G('feather_y') + G('feather_br_slot') / 2,
                     (z0 - G('feather_br_l') / 2)), False)
        elif G('feather_pins_through'):
            fx = G('feather_x') + G('feather_l') / 2
            fy = G('feather_y') + G('feather_b') / 2
            z_seat = z_plate
            L.probe(c, 'the Feather well is open at plate level',
                    (fx + 0.37, fy + 0.29, z_plate), False)
            L.probe(c, 'and open right through, between the pads',
                    (fx + 0.37, fy + 0.29, z_seat), False)
            s0 = (fx - G('feather_hole_l') / 2, fy - G('feather_hole_b') / 2)
            # The pad is ordinary plate now, full thickness, so it is
            # material all the way through - that is the point of it.
            L.probe(c, 'a Feather pad carries material',
                    (s0[0] + 1.11, s0[1] - 1.07, z_seat), True)
            L.probe(c, 'and it is plate all the way down',
                    (s0[0] + 1.11, s0[1] - 1.07, z0 + 0.3), True)
            L.probe(c, 'the pilot hole through that pad is open',
                    (s0[0] + 0.09, s0[1] + 0.13, z_seat), False)
            # The well has to reach the plate edge, or the USB socket has no
            # notch to sit in.
            edge = G('env_b') + G('inner_margin') - G('carrier_play') / 2
            L.probe(c, 'the well reaches the plate edge (USB notch)',
                    (edge - 1.07, fy + 0.29, z_plate), False)

        L.probe(c, 'carrier is cut away under the speaker',
                (G('spk_mx') + .11, G('spk_my') + 0.07, z_plate), False)

    print()
    if L.failed:
        print('%d check(s) failed.' % L.failed)
    else:
        print('All checks passed.')
    return 1 if L.failed else 0


if __name__ == '__main__':
    sys.exit(main())
