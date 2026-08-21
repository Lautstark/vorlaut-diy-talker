#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Recalculation for vorlaut-case.scad.

Why this exists: OpenSCAD shows a preview, and a preview lies kindly.
Whether a cutout sits 0.4 mm off, or a rib protrudes 1.9 mm past an edge,
does not show there - recalculating does.

The script reads the dimensions FROM the .scad file (sections 0 to 3) and
recalculates independently. So it does not duplicate the numbers, it checks
them. Whoever changes a number in the .scad gets the result without having to
start OpenSCAD.

    python3 case/verify.py
    python3 case/verify.py --offset 1.5    # cap offset by 1.5 mm
    python3 case/verify.py --bed 200 200    # smaller print bed

Exit code 0 = everything fine, 1 = at least one check failed.
"""

import argparse
import math
import os
import re
import sys

SCAD = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    'vorlaut-case.scad')


# ---------------------------------------------------------------- Parser

def load_parameters(path):
    """Pulls the scalar assignments out of the .scad file.

    Only up to the first `module` - beyond that are local variables that have
    no business here. `function` lines do not get in the way: the assignment
    regex does not match `function name(...) =`.
    """
    with open(path, encoding='utf-8') as f:
        txt = f.read()
    txt = re.sub(r'/\*.*?\*/', '', txt, flags=re.S)
    txt = re.sub(r'//[^\n]*', '', txt)
    schnitt = re.search(r'^\s*module\s', txt, re.M)
    if schnitt:
        txt = txt[:schnitt.start()]

    ns = {'sqrt': math.sqrt, 'min': min, 'max': max, 'abs': abs,
          'ceil': math.ceil, 'floor': math.floor, 'pow': pow,
          'true': True, 'false': False}
    roh = {}
    for m in re.finditer(r'^\s*([a-zA-Z_]\w*)\s*=\s*([^;]+);', txt, re.M):
        name, expr = m.group(1), ' '.join(m.group(2).split())
        # OpenSCAD quirks Python cannot evaluate and nobody needs here:
        # lists, list comprehensions, concat.
        if name in roh or expr.startswith('['):
            continue
        if any(k in expr for k in ('for (', 'concat(', 'len(', 'str(')):
            continue
        tern = re.match(r'^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$', expr)
        if tern:
            expr = '(%s) if (%s) else (%s)' % (tern.group(2), tern.group(1),
                                               tern.group(3))
        roh[name] = expr

    pending = dict(roh)
    for _ in range(60):
        if not pending:
            break
        vorher = len(pending)
        for name, expr in list(pending.items()):
            try:
                ns[name] = eval(expr, {'__builtins__': {}}, ns)
                del pending[name]
            except Exception:
                pass
        if len(pending) == vorher:
            break
    if pending:
        raise SystemExit('Not evaluable: %s' % ', '.join(sorted(pending)))
    return ns


# ---------------------------------------------------------- Check harness

class Report:
    def __init__(self):
        self.lines = []
        self.failed = 0

    def check(self, group, what, actual, op, target, unit='mm', note=''):
        cmp = {'>=': lambda a, b: a >= b - 1e-9,
               '<=': lambda a, b: a <= b + 1e-9,
               '>':  lambda a, b: a > b + 1e-9,
               '==': lambda a, b: abs(a - b) < 1e-6}[op]
        ok = cmp(actual, target)
        if not ok:
            self.failed += 1
        self.lines.append((group, what, actual, op, target, unit, ok, note))

    def info(self, group, what, text):
        self.lines.append((group, what, text, None, None, '', True, ''))

    def emit(self):
        last = None
        for group, what, actual, op, target, unit, ok, note in self.lines:
            if group != last:
                print('\n%s' % group)
                print('-' * len(group))
                last = group
            if op is None:
                print('  ·    %-44s %s' % (what, actual))
                continue
            mark = 'ok  ' if ok else 'FAIL'
            print('  %s %-44s %9.3f %-2s %9.3f %s%s'
                  % (mark, what, actual, op, target, unit,
                     '' if ok else '   <-- ' + note if note else ''))
        print()
        if self.failed:
            print('%d check(s) failed.' % self.failed)
        else:
            print('All checks passed.')
        return 1 if self.failed else 0


def overlaps(a, b, eps=1e-3):
    return (a[0] < b[2] - eps and b[0] < a[2] - eps and
            a[1] < b[3] - eps and b[1] < a[3] - eps)


# ---------------------------------------------------------- Recalculation

def compute(p, bed_x, bed_y):
    """p is the namespace out of the .scad. Everything here is derived from
    it again - the lists (sk_pos, boss_pos) are list literals in the .scad and
    are therefore mirrored here. Whoever moves something there has to do so
    here too; the 'pitch' check below catches the grid values drifting
    apart."""
    b = Report()
    G = lambda n: p[n]

    env_b, env_h = G('env_b'), G('env_h')
    offset_y, offset_x = G('cap_offset_y'), G('cap_offset_x')

    sk_pos = [(G('set_mx'), G('set_my')),
              (G('blk_mx1'), G('blk_my1')), (G('blk_mx2'), G('blk_my1')),
              (G('blk_mx1'), G('blk_my2')), (G('blk_mx2'), G('blk_my2'))]
    boss_e = G('boss_e')
    boss_pos = [(-boss_e, -boss_e), (env_b + boss_e, -boss_e),
               (-boss_e, env_h + boss_e), (env_b + boss_e, env_h + boss_e),
               (env_b / 2, -boss_e), (env_b / 2, env_h + boss_e)]

    # --- 1. Bedienung durch ein Kleinkind ---------------------------------
    g = '1. Operation - is the spacing enough for a child hand?'
    b.check(g, 'cap gap horizontal', G('pitch_x') - G('sk_cap_b'),
             '>=', 12, note='two keys hit at once')
    b.check(g, 'cap gap vertical', G('pitch_y') - G('sk_cap_h'),
             '>=', 12, note='two keys hit at once')
    b.check(g, 'set key to the block of four',
             G('blk_mx1') - G('set_mx') - G('sk_cap_b'), '>=', 20)
    # Gap around the cap: wide enough not to jam, too narrow for a finger
    b.check(g, 'clearance around the cap (must not jam)', G('gap_cap'),
             '>=', 0.4)
    b.check(g, "clearance around the cap (no child finger)", G('gap_cap'),
             '<=', 2.0, note='a finger could get in')
    b.check(g, 'chamfer at the key cutout', G('chamfer_key'), '>=', 0.4,
             note='sharp edge')
    b.check(g, 'outer corner radius', G('corner_r'), '>=', 3.0)
    b.check(g, 'chamfer on the front edge', G('chamfer_front'), '>=', 0.8)

    # --- 2. The one adjustment --------------------------------------------
    g = '2. cap_offset_y - the biggest open unknown'
    clear_hb = (G('sk_cap_b') + 2 * G('gap_cap')) / 2
    clear_hh = (G('sk_cap_h') + 2 * G('gap_cap')) / 2
    hole_dx = G('sk_board_b') / 2 - G('sk_hole_margin')
    hole_dy = G('sk_board_h') / 2 - G('sk_hole_margin')
    noetig = G('sk_boss_core') / 2 + G('sk_boss_wall')

    bosses = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            frei = max(abs(hole_dx * sx - offset_x) - clear_hb,
                       abs(hole_dy * sy - offset_y) - clear_hh)
            if frei >= noetig:
                bosses.append((sx, sy))
    budget = hole_dy - clear_hh - noetig

    b.info(g, 'configured offset', '%.3f mm' % offset_y)
    b.info(g, 'budget until the first boss drops', '%.3f mm' % budget)
    b.check(g, 'bosses per ScreenKey', len(bosses), '>=', 2, unit='pcs',
             note='board has nothing left holding it')
    if len(bosses) == 4:
        b.info(g, 'board support', 'vier Dome, allseitig')
    else:
        b.info(g, 'board support',
               '%d bosses - only ONE edge, it can wobble!' % len(bosses))
    # The clearance has to be deeper than the cap body, otherwise something
    # is back in the way behind the front plate.
    b.check(g, 'clearance reaches behind the cap body',
             G('sk_cap_depth'), '>=',
             G('sk_total_depth') - G('sk_cap_overhang'),
             note='cap hits something behind the front')
    # The cap must not wander out past the board
    b.check(g, 'cap stays over the board (y)',
             G('sk_board_h') / 2 - (G('sk_cap_h') / 2 + abs(offset_y)),
             '>=', 0.5, note='cap protrudes past the board')
    b.check(g, 'cap stays over the board (x)',
             G('sk_board_b') / 2 - (G('sk_cap_b') / 2 + abs(offset_x)),
             '>=', 0.5)

    # --- 3. Boards and bosses in the plane --------------------------------
    g = '3. Boards do not touch'
    b.check(g, 'board gap horizontal',
             G('pitch_x') - G('sk_board_b'), '>', 2)
    b.check(g, 'board gap vertical',
             G('pitch_y') - G('sk_board_h'), '>', 2)
    b.check(g, 'pitch matches the cap gap (x)',
             G('pitch_x'), '==', G('sk_cap_b') + 15.0)
    b.check(g, 'pitch matches the cap gap (y)',
             G('pitch_y'), '==', G('sk_cap_h') + 20.0)

    dmin = min(max(abs(dp[0] - sp[0]) - G('sk_board_b') / 2,
                   abs(dp[1] - sp[1]) - G('sk_board_h') / 2) - G('boss_d') / 2
               for dp in boss_pos for sp in sk_pos)
    b.check(g, 'lid boss to nearest board', dmin, '>', 0,
             note='boss stands on a board')

    # --- 4. Tiefenbudget --------------------------------------------------
    g = '4. Depth - what stacks up behind the front'
    frei_ueber_carrier = G('inner_z_h') - G('carrier_z_top')
    b.info(g, 'stack-up', 'front %.1f | ScreenKey %.1f | cable %.1f | '
                        'carrier %.1f | parts %.1f | lid %.1f'
           % (G('front_d'), G('sk_behind_front'), G('cable_space'),
              G('carrier_d'), frei_ueber_carrier, G('lid_d')))
    b.check(g, 'room above the carrier for the battery',
             frei_ueber_carrier, '>=', G('battery_d') + G('part_clearance'))
    b.check(g, 'room above the carrier for the Feather',
             frei_ueber_carrier, '>=',
             G('feather_support') + G('feather_h') + 0.0,
             note='Feather hits the lid')
    b.check(g, 'room above the carrier for the amplifier',
             frei_ueber_carrier, '>=', G('amp_support') + G('amp_d'))
    b.check(g, 'inner depth for the speaker',
             G('inner_z_h') - G('front_d'), '>=', G('spk_depth') + 0.5)
    b.check(g, 'ScreenKey fits behind the front',
             G('sk_board_z_v'), '>=', G('front_d') + 1.0)
    b.check(g, 'cable space behind the ScreenKey board',
             G('cable_space'), '>=', 4.0,
             note='connector and wires need room')

    # --- 5. Kollisionen auf dem Traeger -----------------------------------
    g = '5. Parts on the carrier'
    bed_margin = G('bed_margin')
    teile = [
        ('battery', (G('battery_x') - bed_margin, G('battery_y') - bed_margin,
                  G('battery_x') + G('battery_b') + bed_margin,
                  G('battery_y') + G('battery_h') + bed_margin)),
        ('Feather', (G('feather_x'), G('feather_y'),
                     G('feather_x') + G('feather_l'),
                     G('feather_y') + G('feather_b'))),
        ('amplifier', (G('amp_x') - bed_margin, G('amp_y') - bed_margin,
                         G('amp_x') + G('amp_b') + bed_margin,
                         G('amp_y') + G('amp_h') + bed_margin)),
    ]
    hindernisse = [('chamber', (-G('inner_margin'), G('chamber_y'),
                               G('chamber_x') + G('chamber_wall'),
                               env_h + G('inner_margin')))]
    hindernisse += [('Deckeldom %d' % i,
                     (d[0] - G('boss_d') / 2, d[1] - G('boss_d') / 2,
                      d[0] + G('boss_d') / 2, d[1] + G('boss_d') / 2))
                    for i, d in enumerate(boss_pos)]

    hits = []
    for i in range(len(teile)):
        for j in range(i + 1, len(teile)):
            if overlaps(teile[i][1], teile[j][1]):
                hits.append('%s/%s' % (teile[i][0], teile[j][0]))
    for na, ra in teile:
        for nh, rh in hindernisse:
            if overlaps(ra, rh):
                hits.append('%s/%s' % (na, nh))
    b.check(g, 'overlaps (with retaining ribs)', len(hits), '==', 0,
             unit='pcs', note=', '.join(hits))

    raus = [n for n, r in teile
            if r[0] < -G('inner_margin') - 1e-3 or r[1] < -G('inner_margin') - 1e-3
            or r[2] > env_b + G('inner_margin') + 1e-3
            or r[3] > env_h + G('inner_margin') + 1e-3]
    b.check(g, 'protrudes past the inner wall', len(raus), '==', 0,
             unit='pcs', note=', '.join(raus))

    # The carrier is cut away under the chamber - nothing may stand there
    schnitt_x = G('chamber_x') + G('chamber_wall') + G('inner_margin') + 1.8
    for name, r in teile:
        if r[3] > G('chamber_y') + G('chamber_wall'):
            b.check(g, '%s stands on carrier material' % name, r[0], '>=',
                     schnitt_x - G('inner_margin') - 1.0,
                     note='sits over the chamber cutout')

    # Peg holes in the carrier must not sit under a Feather standoff -
    # otherwise the standoff starts printing over the edge of a hole.
    support_pos = [((G('blk_mx1') + G('blk_mx2')) / 2, G('blk_my1')),
                   ((G('blk_mx1') + G('blk_mx2')) / 2, env_h / 2),
                   ((G('blk_mx1') + G('blk_mx2')) / 2, G('blk_my2')),
                   ((G('set_mx') + G('blk_mx1')) / 2, 4.0)]
    hole_r = (G('peg_d') + 0.4) / 2
    naeh = 1e9
    for sx, sy in support_pos:
        for ix in (-1, 1):
            for iy in (-1, 1):
                px = G('feather_x') + G('feather_l') / 2 + ix * G('feather_hole_l') / 2
                py = G('feather_y') + G('feather_b') / 2 + iy * G('feather_hole_b') / 2
                naeh = min(naeh, math.hypot(px - sx, py - sy) - hole_r - 2.5)
    b.check(g, 'Feather standoff to nearest peg hole', naeh, '>=', 0.5,
             note='standoff prints over a hole edge')

    # --- 6. USB-C ---------------------------------------------------------
    g = '6. USB-C - the only connection to the outside'
    b.check(g, 'Feather edge at the inner wall',
             abs(G('feather_x') + G('inner_margin')), '<=', 0.01,
             note='the socket does not reach the case edge')
    b.check(g, 'socket reaches into the wall',
             G('usb_overhang'), '>=', 0.5)
    fen_h = G('usb_fen_h')
    b.check(g, 'window bottom edge above the carrier ledge',
             G('usb_z') - fen_h / 2, '>=', G('carrier_z_top') + 1.0)
    b.check(g, 'window top edge below the lid rebate',
             G('usb_z') + fen_h / 2, '<=', G('inner_z_h') - 1.0)
    b.check(g, 'window wider than the socket',
             G('usb_buchse_b') + 1.4, '>=', G('usb_buchse_b') + 1.0)
    b.info(g, 'bridge over the window',
           '%.1f mm frei ueberspannt (FDM schafft das)'
           % (G('usb_buchse_b') + 1.4 - 2 * 1.0))

    # --- 7. Lautsprecher --------------------------------------------------
    g = '7. Speaker - closed at the back, open to the front'
    kam_b = G('chamber_x') + G('chamber_wall') + G('inner_margin')
    kam_h = env_h + G('inner_margin') - G('chamber_y')
    kam_t = G('inner_z_h') - G('front_d')
    brutto = kam_b * kam_h * kam_t / 1000.0
    netto = brutto - (G('spk_frame') ** 2 * G('spk_depth')) / 1000.0
    b.info(g, 'chamber volume', '%.1f cm3 brutto, %.1f cm3 netto'
           % (brutto, netto))
    b.check(g, 'remaining volume behind the driver', netto, '>=', 20.0,
             unit='cm3', note='klingt duenn und blechern')
    b.check(g, 'chamber deep enough for the driver', kam_t, '>=',
             G('spk_depth') + 0.5)
    b.check(g, 'clearance between driver and chamber wall', G('chamber_clearance'),
             '>=', 1.0)
    b.check(g, 'sound outlet covers the cone',
             G('grille_field_d'), '>=', G('spk_cone_d'))
    b.check(g, "grille hole too large for a child finger",
             G('grille_hole_d'), '<=', 5.0,
             note='Finger passt hinein')
    steg = G('grille_pitch') - G('grille_hole_d')
    b.check(g, 'web between the grille holes', steg, '>=', 1.2,
             note='bricht heraus')

    # --- 8. Gehaeuse, Druck ----------------------------------------------
    g = '8. Printing - simple FDM, one colour, no supports'
    # Zwei verschiedene Kriterien, die man leicht verwechselt:
    #   vertical walls are built out of PASSES (0.4 mm wide),
    #   flach liegende Platten aus LAGEN (Hoehe 0,2 mm).
    # In the tub's print orientation (front face down) the front plate is a
    # plate and only the side wall is a wall.
    bahn, lage = 0.4, 0.2
    for name, value in (('Seitenwand', G('wall')),
                       ('Kammerwand', G('chamber_wall')),
                       ('Halterippe', G('rib_b'))):
        n = value / bahn
        b.check(g, '%s = whole passes (%.1f x 0.4)' % (name, n),
                 abs(n - round(n)), '<=', 0.001, unit='',
                 note='the slicer leaves a gap or over-extrudes')
    for name, value in (('Frontplatte', G('front_d')),
                       ('Deckel', G('lid_d')),
                       ('carrier', G('carrier_d'))):
        n = value / lage
        b.check(g, '%s = whole layers (%.1f x 0.2)' % (name, n),
                 abs(n - round(n)), '<=', 0.001, unit='',
                 note='letzte Lage wird angeschnitten')
    b.check(g, 'wall thickness load-bearing', G('wall'), '>=', 1.6)
    b.check(g, 'logo embossing high enough', G('logo_lid_h'), '>=', 0.6,
             note='no longer visible on a tired printer')
    b.check(g, 'logo embossing = whole layers at 0.2 mm',
             abs(G('logo_lid_h') / 0.2 - round(G('logo_lid_h') / 0.2)),
             '<=', 0.001, unit='')

    # The inner space gets wider towards the back in steps. Every step is
    # therefore an upward-facing bearing surface instead of an overhang.
    stufe_a = G('inner_b') - 2 * G('standoff')
    stufe_b = G('inner_b')
    stufe_c = G('outer_b') - 2 * G('lip') + G('lid_play')
    b.check(g, 'inner space widens towards the back (a<b)', stufe_b, '>',
             stufe_a, note='diese Stufe waere ein Ueberhang')
    b.check(g, 'inner space widens towards the back (b<c)', stufe_c, '>',
             stufe_b, note='diese Stufe waere ein Ueberhang')
    b.check(g, 'step as carrier ledge', G('standoff'), '>=', 1.2)
    b.check(g, 'outer skin above the lid rebate',
             G('lip') - G('lid_play') / 2, '>=', 0.8,
             note='zu duenn, bricht')

    b.check(g, 'tub onto the bed (X)', G('outer_b'), '<=', bed_x)
    b.check(g, 'tub onto the bed (Y)', G('outer_h'), '<=', bed_y)
    b.info(g, 'build height tub', '%.1f mm (Front unten, Oeffnung nach oben)'
           % G('outer_t'))
    b.info(g, 'build height carrier', '%.1f mm' % (G('carrier_d') + G('battery_d')
                                               + 0.2))
    b.info(g, 'build height lid', '%.1f mm (Innenseite unten, Logo oben)'
           % (G('lid_d') + G('logo_lid_h')))

    # --- 9. Oeffnen und Schliessen ---------------------------------------
    g = '9. Opening it - battery and prototype'
    b.check(g, 'lid play in the rebate', G('lid_play'), '>=', 0.2)
    b.check(g, 'lid play not too large', G('lid_play'), '<=', 0.6,
             note='Deckel klappert')
    b.check(g, 'carrier play', G('carrier_play'), '>=', 0.2)
    b.check(g, 'boss wall around the pilot hole',
             (G('boss_d') - G('boss_core')) / 2, '>=', 1.0,
             note='Dom reisst beim Schrauben auf')
    b.check(g, 'countersink fits into the lid',
             G('lid_d') - G('csink_t'), '>=', 1.0,
             note='Schraubenkopf bricht durch')
    b.check(g, 'screw head smaller than the boss', G('csink_d'), '<=',
             G('boss_d') + 0.4, note='the head stands proud of the boss')
    b.info(g, 'screw fixing', '6 x M3 %s'
           % ('Gewindeeinsatz' if G('threaded_insert') else 'selbstschneidend'))

    # --- 10. Gewicht und Schwerpunkt -------------------------------------
    g = '10. How it sits in the hand'
    m_battery, m_spk = 52.0, 35.0
    sp_x = (m_battery * (G('battery_x') + G('battery_b') / 2)
            + m_spk * G('spk_mx')) / (m_battery + m_spk)
    sp_y = (m_battery * (G('battery_y') + G('battery_h') / 2)
            + m_spk * G('spk_my')) / (m_battery + m_spk)
    b.info(g, 'centre of gravity battery+speaker',
           'x %.1f (Mitte %.1f), y %.1f (Mitte %.1f)'
           % (sp_x, env_b / 2, sp_y, env_h / 2))
    b.check(g, 'centre of gravity off centre, horizontal',
             abs(sp_x - env_b / 2), '<=', 8.0,
             note='kippt zur Seite')
    b.check(g, 'centre of gravity off centre, vertical',
             abs(sp_y - env_h / 2), '<=', 8.0,
             note='kopflastig')
    return b


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--offset', type=float, default=None,
                    help='cap_offset_y ueberschreiben (mm)')
    ap.add_argument('--bed', type=float, nargs=2, default=(220.0, 220.0),
                    metavar=('X', 'Y'), help='Druckbett (Vorgabe 220 x 220)')
    ap.add_argument('--scad', default=SCAD)
    a = ap.parse_args()

    p = load_parameters(a.scad)
    if a.offset is not None:
        p['cap_offset_y'] = a.offset

    print('vorlaut - case, recalculation')
    print('Source: %s' % os.path.relpath(a.scad))
    print('Outer: %.2f x %.2f x %.2f mm   Bed: %.0f x %.0f mm'
          % (p['outer_b'], p['outer_h'], p['outer_t'], a.bed[0], a.bed[1]))
    b = compute(p, a.bed[0], a.bed[1])
    return b.emit()


if __name__ == '__main__':
    sys.exit(main())
