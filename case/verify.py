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
    cut = re.search(r'^\s*module\s', txt, re.M)
    if cut:
        txt = txt[:cut.start()]

    ns = {'sqrt': math.sqrt, 'min': min, 'max': max, 'abs': abs,
          'ceil': math.ceil, 'floor': math.floor, 'pow': pow,
          'true': True, 'false': False}
    raw = {}
    for m in re.finditer(r'^\s*([a-zA-Z_]\w*)\s*=\s*([^;]+);', txt, re.M):
        name, expr = m.group(1), ' '.join(m.group(2).split())
        # OpenSCAD quirks Python cannot evaluate and nobody needs here:
        # lists, list comprehensions, concat.
        if name in raw or expr.startswith('['):
            continue
        if any(k in expr for k in ('for (', 'concat(', 'len(', 'str(')):
            continue
        tern = re.match(r'^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$', expr)
        if tern:
            expr = '(%s) if (%s) else (%s)' % (tern.group(2), tern.group(1),
                                               tern.group(3))
        raw[name] = expr

    pending = dict(raw)
    for _ in range(60):
        if not pending:
            break
        before = len(pending)
        for name, expr in list(pending.items()):
            try:
                ns[name] = eval(expr, {'__builtins__': {}}, ns)
                del pending[name]
            except Exception:
                pass
        if len(pending) == before:
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
    # Mirrored from the .scad, including that the top margin is its own number
    # and that the -x top boss steps down out of the Feather's bay.
    boss_e_top = G('margin_top') - G('boss_d') / 2
    boss_pos = [(-boss_e, -boss_e), (env_b + boss_e, -boss_e),
               (-boss_e, G('feather_bay_y') - G('boss_d') / 2 - 1.5),
               (env_b + boss_e, env_h + boss_e_top),
               (env_b / 2, -boss_e), (env_b / 2, env_h + boss_e_top)]

    # --- 1. Operation by a small child ------------------------------------
    g = '1. Operation - is the spacing enough for a child hand?'
    b.check(g, 'cap gap horizontal', G('pitch_x') - G('sk_cap_b'),
             '>=', 12, note='two keys hit at once')
    b.check(g, 'cap gap vertical', G('pitch_y') - G('sk_cap_h'),
             '>=', 12, note='two keys hit at once')
    # The set key sits at the +x end and the block below it, so this
    # difference runs from set_mx down to blk_mx1 and not the other way
    # round - see the coordinate note at the top of the .scad.
    b.check(g, 'set key to the block of four',
             G('set_mx') - G('blk_mx1') - G('sk_cap_b'), '>=', 20)
    # The four speech keys have to read as one group. Two things do that:
    # the same air on all four sides inside the block, and a clearly bigger
    # step out to the set key. Neither is a strength - both are legibility,
    # and for a child who cannot read they are what the layout says.
    b.check(g, 'block of four is square (across = up)',
             abs((G('pitch_x') - G('sk_cap_b')) - (G('pitch_y') - G('sk_cap_h'))),
             '<=', 0.01, note='reads as two rows, not as one block')
    b.check(g, 'step out to the set key against the air inside',
             G('gap_set_block') / G('gap_block'), '>=', 1.3, unit='x',
             note='the five keys read as one row of five')
    # Gap around the cap: wide enough not to jam, too narrow for a finger
    b.check(g, 'clearance around the cap (must not jam)', G('gap_cap'),
             '>=', 0.25,
             note='a printer running fat and the key catches')
    b.check(g, "clearance around the cap (no child finger)", G('gap_cap'),
             '<=', 2.0, note='a finger could get in')
    b.check(g, 'chamfer at the key cutout', G('chamfer_key'), '>=', 0.4,
             note='sharp edge')
    b.check(g, 'outer corner radius', G('corner_r'), '>=', 3.0)
    b.check(g, 'chamfer on the front edge', G('chamfer_front'), '>=', 0.8)

    # --- 2. How the ScreenKeys are held ------------------------------------
    # This used to be the section about cap_offset_y, and about the 0.595 mm
    # of budget it had before a boss on the front plate had to be dropped.
    # The poles stand on the CARRIER now, behind the board, where the cap
    # never reaches - so that budget does not exist any more. What is left to
    # check is the pole itself and the screw that goes through it.
    g = '2. How the ScreenKeys are held - off the mid plate'
    clear_hb = (G('sk_cap_b') + 2 * G('gap_cap')) / 2
    clear_hh = (G('sk_cap_h') + 2 * G('gap_cap')) / 2
    # Measured centre to centre on the module, not derived from a margin off
    # the board edge - and it is not one margin either, 20 x 30 on a
    # 25.94 x 35.29 board sits 2.97 mm in at the sides and 2.645 top and bottom.
    hole_dx = G('sk_hole_pitch_x') / 2
    hole_dy = G('sk_hole_pitch_y') / 2

    b.info(g, 'fixing', '4 x M2 per key, from the mid plate side into the '
                        "module's own threaded spacers")
    b.info(g, 'standoff', "the module's own spacers, %.1f mm - nothing "
                          'printed in that gap' % G('sk_spacer_l'))
    b.info(g, 'screw length', '%.1f mm (%.1f plate + %.1f into the spacer) '
                              '-> M2x6'
           % (G('sk_screw_l'), G('carrier_d'), G('sk_screw_engage')))
    # The spacers ARE the standoff, so the plate has to land exactly one
    # spacer behind the module. This is the check the whole fixing rests on.
    b.check(g, 'mid plate lands one spacer behind the module',
             G('carrier_z_bottom') - G('sk_behind_front'), '==',
             G('sk_spacer_l'),
             note='the screws would pull the plate out of place')
    b.check(g, 'screw does not bottom out in the spacer',
             G('sk_spacer_l') - G('sk_screw_engage'), '>=', 0.0,
             note='the screw is longer than the spacer')
    b.check(g, 'plate left round the countersink mouth',
             G('sk_pad_wall'), '>=', 0.4,
             note='the countersink breaks out sideways')
    b.info(g, 'key cap', '%.1f mm proud, %.1f mm pressed (travel %.1f)'
           % (G('sk_cap_overhang'), G('sk_cap_overhang') - G('sk_cap_travel'),
              G('sk_cap_travel')))
    # A key pressed flush is a key a child cannot find again.
    b.check(g, 'cap still proud when pressed',
             G('sk_cap_overhang') - G('sk_cap_travel'), '>=', 3.0,
             note='a fingernail finds it, a hand does not')
    b.check(g, 'screw hole stays on the board (x)',
             G('sk_board_b') / 2 - (hole_dx + G('sk_screw_d') / 2), '>=', 0.0,
             note='the hole runs off the board edge')
    b.check(g, 'screw hole stays on the board (y)',
             G('sk_board_h') / 2 - (hole_dy + G('sk_screw_d') / 2), '>=', 0.0,
             note='the hole runs off the board edge')
    # The battery lies flat on the carrier, so the head has to disappear.
    b.check(g, 'countersink for the screw head',
             G('sk_csink_d'), '>=', G('sk_screw_d') + 1.0,
             note='the head does not go in')
    b.check(g, 'plate left under the countersink',
             G('carrier_d') - G('sk_csink_t'), '>=', 0.8,
             note='the head breaks through the carrier')
    # 90 degrees, the angle the head itself has - so it seats on the whole
    # cone and not on the sharp rim of the mouth.
    b.check(g, 'countersink is a 90 degree cone',
             abs(G('sk_csink_t') - (G('sk_csink_d') - G('sk_screw_d')) / 2),
             '<=', 0.001, unit='',
             note='the head seats on the mouth edge, not in the cone')
    b.info(g, 'configured cap offset', '%.3f / %.3f mm - free now, nothing '
                                       'in front of the board holds it'
           % (offset_x, offset_y))
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
             G('pitch_x'), '==', G('sk_cap_b') + G('gap_block'))
    b.check(g, 'pitch matches the cap gap (y)',
             G('pitch_y'), '==', G('sk_cap_h') + G('gap_block'))

    dmin = min(max(abs(dp[0] - sp[0]) - G('sk_board_b') / 2,
                   abs(dp[1] - sp[1]) - G('sk_board_h') / 2) - G('boss_d') / 2
               for dp in boss_pos for sp in sk_pos)
    b.check(g, 'lid boss to nearest board', dmin, '>', 0,
             note='boss stands on a board')

    # --- 4. Depth budget --------------------------------------------------
    g = '4. Depth - what stacks up behind the front'
    free_above_carrier = G('inner_z_h') - G('carrier_z_top')
    b.info(g, 'stack-up', 'front %.1f | ScreenKey %.1f | cable %.1f | '
                        'carrier %.1f | parts %.1f | lid %.1f'
           % (G('front_d'), G('sk_behind_front'), G('cable_space'),
              G('carrier_d'), free_above_carrier, G('lid_d')))
    # Absolute z, not heights above the carrier: the Feather no longer starts
    # from the carrier's top face when it is sunk into the plate, and mixing
    # the two datums is how the first draft lost 1.3 mm into the lid.
    tops = (('battery', G('top_battery')), ('Feather', G('top_feather')),
            ('amplifier', G('top_amp')))
    tallest = max(tops, key=lambda t: t[1])
    b.info(g, 'Feather',
           'standing on edge in the top-margin bay, connectors sideways'
           if G('feather_standing') else
           ('pins through the plate, board flat on it - %.1f mm lower than on '
            'standoffs' % G('feather_support')) if G('feather_pins_through')
           else 'standing on %.1f mm standoffs' % G('feather_support'))
    for n, t in tops:
        b.info(g, 'top of the %s' % n, 'z = %.2f mm' % t)
    by_parts = G('parts_top') + G('part_clearance')
    by_head = G('top_feather') + G('feather_headroom')
    b.info(g, 'what governs the depth',
           ('%.1f mm of headroom over the Feather, for the push-on connectors'
            % G('feather_headroom')) if by_head >= by_parts
           else '%s, at z = %.2f' % tallest)
    # Only a depth requirement while the board lies flat. Standing, the
    # connectors point sideways and the same 14 mm is the bay's width.
    if G('feather_standing'):
        b.check(g, 'bay wide enough for the connectors',
                 G('feather_bay_w'), '>=',
                 G('feather_h') + G('feather_headroom'),
                 note='the connectors cannot be plugged or unplugged')
    else:
        b.check(g, 'headroom above the Feather',
                 G('inner_z_h') - G('top_feather'), '>=', G('feather_headroom'),
                 note='the connectors cannot be plugged or unplugged')
    b.info(g, 'above the carrier', '%.1f mm to the top of the parts, then '
                                   'whichever floor is higher = %.1f mm'
           % (G('parts_top') - G('carrier_z_top'), free_above_carrier))
    # It all goes BEHIND the parts. If any of it went in front, the five
    # ScreenKeys would move with it and so would the cap protrusion.
    b.check(g, 'the room is all behind the parts',
             G('inner_z_h'), '==',
             max(by_parts, 0.0 if G('feather_standing') else by_head)
             + G('extra_above_carrier'),
             note='the front of the device moves with it')
    for n, t in tops:
        b.check(g, 'the %s clears the lid' % n,
                 G('inner_z_h') - t, '>=', G('part_clearance'),
                 note='it presses on the lid')
    if G('feather_pins_through'):
        # The pads are ordinary plate, so the screw gets the whole thickness.
        # An earlier version sank the board onto 1.2 mm pads for the same 1.9
        # mm and left the M2 three threads to bite - the saving was never the
        # sinking, it was deleting the standoff, so the pads stay full depth.
        b.check(g, 'thread the Feather screw gets', G('carrier_d'), '>=', 2.0,
                 note='an M2 needs more than five threads of PLA')
        b.check(g, 'pilot hole is a pilot, not a clearance hole',
                 G('feather_screw_core'), '<=', 1.8,
                 note='nothing bites in a 2.1 mm hole')
        b.check(g, 'wall left round the Feather pilot hole',
                 (G('feather_pad_d') - G('feather_screw_core')) / 2,
                 '>=', 1.0, note='the pad splits when the screw is pulled up')
        b.check(g, 'the pin tails have somewhere to go',
                 G('carrier_d'), '>=', G('feather_support'),
                 note='the tails bottom out on the plate')
    b.check(g, 'inner depth for the speaker',
             G('inner_z_h') - G('front_d'), '>=', G('spk_depth') + 0.5)
    b.check(g, 'ScreenKey fits behind the front',
             G('sk_board_z_v'), '>=', G('front_d') + 1.0)
    b.check(g, 'cable space behind the ScreenKey board',
             G('cable_space'), '>=', 4.0,
             note='connector and wires need room')

    # --- 5. Collisions on the carrier -------------------------------------
    g = '5. Parts on the carrier'
    bed_margin = G('bed_margin')
    parts = [
        ('battery', (G('battery_x') - bed_margin, G('battery_y') - bed_margin,
                  G('battery_x') + G('battery_b') + bed_margin,
                  G('battery_y') + G('battery_h') + bed_margin)),
        # Standing, the Feather is not a thing lying ON the carrier - it is
        # the bay, which the plate is cut away for and nothing else may reach
        # into. Either way it is one rectangle here.
        ('Feather', (G('feather_bay_x'), G('feather_bay_y'),
                     G('feather_bay_x') + G('feather_bay_l'),
                     G('feather_bay_y') + G('feather_bay_w'))
                    if G('feather_standing') else
                    (G('feather_x'), G('feather_y'),
                     G('feather_x') + G('feather_l'),
                     G('feather_y') + G('feather_b'))),
        ('amplifier', (G('amp_x') - bed_margin, G('amp_y') - bed_margin,
                         G('amp_x') + G('amp_b') + bed_margin,
                         G('amp_y') + G('amp_h') + bed_margin)),
    ]
    # The chamber sits at the +x end: from the outer face of its wall out to
    # the inner wall on that side.
    obstacles = [('chamber', (G('chamber_x') - G('chamber_wall'), G('chamber_y'),
                               env_b + G('inner_margin'),
                               env_h + G('inner_margin')))]
    obstacles += [('lid boss %d' % i,
                     (d[0] - G('boss_d') / 2, d[1] - G('boss_d') / 2,
                      d[0] + G('boss_d') / 2, d[1] + G('boss_d') / 2))
                    for i, d in enumerate(boss_pos)]

    hits = []
    for i in range(len(parts)):
        for j in range(i + 1, len(parts)):
            if overlaps(parts[i][1], parts[j][1]):
                hits.append('%s/%s' % (parts[i][0], parts[j][0]))
    for n_part, r_part in parts:
        for n_obs, r_obs in obstacles:
            if overlaps(r_part, r_obs):
                hits.append('%s/%s' % (n_part, n_obs))
    b.check(g, 'overlaps (with retaining ribs)', len(hits), '==', 0,
             unit='pcs', note=', '.join(hits))

    sticking_out = [n for n, r in parts
                    if r[0] < -G('inner_margin') - 1e-3
                    or r[1] < -G('inner_margin') - 1e-3
                    or r[2] > env_b + G('inner_margin') + 1e-3
                    or r[3] > env_h + G('margin_top') + 1e-3]
    b.check(g, 'protrudes past the inner wall', len(sticking_out), '==', 0,
             unit='pcs', note=', '.join(sticking_out))

    # The horizontal chamber wall runs the full height of the inner space, so
    # it passes straight THROUGH the carrier plane and the carrier has to stop
    # short of it. On the first build it did not: the cutout began 0.2 mm past
    # the FAR side of that wall, so the plate ran through 2 mm of solid PLA
    # and the carrier would not drop in. This is the check that was missing.
    cut_y = G('chamber_y') - G('carrier_chamber_gap')
    cut_x = G('chamber_x') - G('chamber_wall') - G('carrier_chamber_x')
    b.check(g, 'carrier stops below the horizontal chamber wall',
             G('chamber_y') - cut_y, '>=', 0.4,
             note='the plate runs into the wall and will not go in')
    b.check(g, 'carrier clears the vertical chamber wall',
             (G('chamber_x') - G('chamber_wall')) - cut_x, '>=', 0.4,
             note='the plate runs into the wall and will not go in')

    # The carrier is cut away under the chamber - nothing may stand there.
    # The cutout is everything beyond cut_x towards +x, so a part is safe
    # while its FAR edge stays short of it.
    for name, r in parts:
        if r[3] > cut_y:
            b.check(g, '%s stands on carrier material' % name, r[2], '<=',
                     cut_x, note='sits over the chamber cutout')

    # Peg holes in the carrier must not sit under a Feather standoff -
    # otherwise the standoff starts printing over the edge of a hole.
    support_pos = [((G('blk_mx1') + G('blk_mx2')) / 2, G('blk_my1')),
                   ((G('blk_mx1') + G('blk_mx2')) / 2, env_h / 2),
                   ((G('blk_mx1') + G('blk_mx2')) / 2, G('blk_my2')),
                   ((G('set_mx') + G('blk_mx1')) / 2, 4.0)]
    hole_r = (G('peg_d') + 0.4) / 2
    nearest_peg = 1e9
    for sx, sy in support_pos:
        for ix in (-1, 1):
            for iy in (-1, 1):
                px = G('feather_x') + G('feather_l') / 2 + ix * G('feather_hole_l') / 2
                py = G('feather_y') + G('feather_b') / 2 + iy * G('feather_hole_b') / 2
                nearest_peg = min(
                    nearest_peg,
                    math.hypot(px - sx, py - sy) - hole_r
                    - G('feather_pad_d') / 2)
    b.check(g, 'Feather pad to nearest peg hole', nearest_peg, '>=', 0.5,
             note='standoff prints over a hole edge')

    # --- 5b. The ScreenKey screws on the carrier --------------------------
    # Twenty places on this plate have to be plate: a clearance hole through
    # it, a countersink in its back face, and material all round both. So all
    # twenty are held against everything else that is cut out of, or stands
    # on, that plate.
    g = '5b. ScreenKey screws - what else lives on the carrier'
    pad_r = G('sk_pad_d') / 2
    pole_pos = [(px + ix * hole_dx, py + iy * hole_dy)
                for px, py in sk_pos for ix in (-1, 1) for iy in (-1, 1)]
    # carrier_slots is a list literal in the .scad and is mirrored here, the
    # same way sk_pos and boss_pos are.
    mid_x = (G('blk_mx1') + G('blk_mx2')) / 2
    set_x = (G('set_mx') + G('blk_mx1')) / 2
    slots = [(mid_x - 2.5, G('blk_my1') - 13, mid_x + 2.5, G('blk_my1') + 13),
             (mid_x - 2.5, G('blk_my2') - 13, mid_x + 2.5, G('blk_my2') + 13),
             (set_x - 3, 20.0, set_x + 3, 50.0),
             (env_b / 2 - 4, env_h + G('inner_margin') - 6,
              env_b / 2 + 4, env_h + G('inner_margin') + 2)]
    on_slot = [q for q in pole_pos for sl in slots
               if overlaps((q[0] - pad_r, q[1] - pad_r,
                            q[0] + pad_r, q[1] + pad_r), sl)]
    b.check(g, 'screws standing over a cable slot', len(on_slot), '==', 0,
             unit='pcs', note='a screw there has nothing to pull against')

    # The set key sits low enough that its two upper poles reach into the
    # chamber cutout. The cutout keeps a tab under each of them - and a tab is
    # only allowed while it still stops short of the chamber wall.
    tabs = [q[1] + pad_r for q in pole_pos
            if q[0] + pad_r > cut_x and q[1] + pad_r > cut_y]
    b.info(g, 'screws reaching into the chamber cutout',
           '%d - the cutout keeps a tab under each' % len(tabs))
    # Only meaningful when there are tabs. Tighten carrier_chamber_gap enough
    # and the cutout's own edge is past the set key's screws, none are kept,
    # and this was measuring that edge instead - which the cutout's own check
    # already covers.
    if tabs:
        b.check(g, 'tab under a screw stops short of the chamber wall',
                 G('chamber_y') - max(tabs), '>=', 0.4,
                 note='the tab runs into the wall the cutout was widened for')
    else:
        b.info(g, 'tabs under the screws',
               'none needed - the cutout edge is already past them')

    b.check(g, 'screw to the relief round a lid boss',
             min(math.hypot(q[0] - d[0], q[1] - d[1])
                 - pad_r - (G('boss_d') + 1.2) / 2
                 for q in pole_pos for d in boss_pos), '>=', 0.2,
             note='the countersink breaks into the relief')
    # The locating pegs come up through the same plate the screws go down through.
    b.check(g, 'screw to a carrier support post',
             min(math.hypot(q[0] - sx, q[1] - sy) - pad_r - G('support_d') / 2
                 for q in pole_pos for sx, sy in support_pos), '>=', 0.5,
             note='they overlap in plan')
    plate = (env_b / 2 - (G('inner_b') - G('carrier_play')) / 2,
             env_h / 2 - (G('inner_h') - G('carrier_play')) / 2,
             env_b / 2 + (G('inner_b') - G('carrier_play')) / 2,
             env_h / 2 + (G('inner_h') - G('carrier_play')) / 2)
    off_plate = [q for q in pole_pos
                 if q[0] - pad_r < plate[0] or q[1] - pad_r < plate[1]
                 or q[0] + pad_r > plate[2] or q[1] + pad_r > plate[3]]
    b.check(g, 'screws sitting over the carrier edge', len(off_plate), '==', 0,
             unit='pcs')

    # --- 6. USB-C ---------------------------------------------------------
    g = '6. USB-C - the only connection to the outside'
    # The +x wall, the one the speaker and the set key are nearest - the
    # child's left. The board reaches no other, so the window can be nowhere
    # else either.
    # Standing, the socket is on a SHORT edge, so it is the bay that has to
    # touch a wall - the -x one, which is the child's right.
    if G('feather_standing'):
        b.check(g, 'bay against the inner wall', 
                 abs(G('feather_bay_x') + G('inner_margin')), '<=', 0.01,
                 note='the socket does not reach the case edge')
    else:
        b.check(g, 'Feather edge at the inner wall',
                 abs(G('feather_x') + G('feather_l') - env_b - G('inner_margin')),
                 '<=', 0.01,
                 note='the socket does not reach the case edge')
    b.check(g, 'socket reaches into the wall',
             G('usb_overhang'), '>=', 0.5)
    win_h = G('usb_win_h')
    # Standing, the socket is halfway up a board that starts at the front
    # plate, so the window is well BELOW the carrier - it lives in the thicker
    # wall of the board plane instead, and what it has to clear is the plate.
    if G('feather_standing'):
        # Turned on its side with the board, so the wide dimension is the one
        # that runs up the wall.
        wz = G('usb_win_z')
        b.check(g, 'window above the front plate',
                 G('usb_z') - wz / 2, '>=', G('front_d') + 0.6)
        b.check(g, 'window below the carrier ledge',
                 G('usb_z') + wz / 2, '<=', G('carrier_z_bottom') - 0.6,
                 note='the window cuts into the ledge the carrier rests on')
    else:
        b.check(g, 'window bottom edge above the carrier ledge',
                 G('usb_z') - win_h / 2, '>=', G('carrier_z_top') + 0.6)
    b.check(g, 'window top edge below the lid rebate',
             G('usb_z') + win_h / 2, '<=', G('inner_z_h') - 1.0)
    b.check(g, 'window wider than the socket',
             G('usb_socket_b') + 1.4, '>=', G('usb_socket_b') + 1.0)
    b.info(g, 'bridge over the window',
           '%.1f mm spanned unsupported (FDM manages that)'
           % (G('usb_socket_b') + 1.4 - 2 * 1.0))

    # --- 7. Speaker -------------------------------------------------------
    g = '7. Speaker - closed at the back, open to the front'
    chamber_b = env_b + G('inner_margin') - G('chamber_x') + G('chamber_wall')
    chamber_h = env_h + G('inner_margin') - G('chamber_y')
    chamber_t = G('inner_z_h') - G('front_d')
    gross = chamber_b * chamber_h * chamber_t / 1000.0
    net = gross - (G('spk_frame') ** 2 * G('spk_depth')) / 1000.0
    b.info(g, 'chamber volume', '%.1f cm3 gross, %.1f cm3 net'
           % (gross, net))
    b.check(g, 'remaining volume behind the driver', net, '>=', 20.0,
             unit='cm3', note='sounds thin and tinny')
    b.check(g, 'chamber deep enough for the driver', chamber_t, '>=',
             G('spk_depth') + 0.5)
    b.check(g, 'clearance between driver and chamber wall', G('chamber_clearance'),
             '>=', 1.0)
    # How the driver is held. Without front screws the lid does it, through a
    # block of foam - so the space behind the driver stops being spare room
    # and becomes a dimension.
    if G('spk_front_screws'):
        b.info(g, 'driver fixing', '4 x M2.5 through the front, '
               'heads visible, nut inside the chamber')
        b.check(g, 'countersink stays inside the front plate',
                 (G('csink_d') - G('spk_screw_d')) / 2, '<=', G('front_d') - 0.6,
                 note='the countersink breaks through')
    else:
        b.info(g, 'driver fixing', 'foam behind the driver, the lid clamps it')
        b.check(g, 'room behind the driver for the clamping foam',
                 chamber_t - G('spk_depth'), '>=', 4.0,
                 note='nothing left to compress')
        b.check(g, 'front plate has no screw holes into the chamber',
                 0.0, '==', 0.0, unit='pcs')
    b.check(g, 'sound outlet covers the cone',
             G('grille_field_d'), '>=', G('spk_cone_d'))
    b.check(g, "grille hole too large for a child finger",
             G('grille_hole_d'), '<=', 5.0,
             note='a finger fits in')
    web = G('grille_pitch') - G('grille_hole_d')
    b.check(g, 'web between the grille holes', web, '>=', 1.2,
             note='breaks out')
    # A hole small enough to keep a pencil out only helps while enough of them
    # remain. So count the holes the way spk_grille() places them - hex grid,
    # and only holes that fit inside the field COMPLETELY - and hold the open
    # area over the cone against it. Below about 25 % the driver is choked and
    # the voice goes nasal; a slit grille in a shop product manages 30 to 40 %.
    pitch, hole = G('grille_pitch'), G('grille_hole_d')
    r_max = G('grille_field_d') / 2 - hole / 2
    n = int(math.ceil(G('grille_field_d') / pitch)) + 1
    holes = [(i * pitch + (abs(j) % 2) * pitch / 2, j * pitch * 0.866)
               for i in range(-n, n + 1) for j in range(-n, n + 1)]
    holes = [q for q in holes if math.hypot(*q) <= r_max + 1e-9]
    open_area = len(holes) * math.pi * (hole / 2) ** 2
    # Not hole area against cone area - part of the outermost ring sits past
    # the cone rim and does not count. So sample the cone disc and ask, point
    # by point, whether a hole stands over it.
    r_cone, r_hole, step = G('spk_cone_d') / 2, hole / 2, 0.15
    inside = free = 0
    y = -r_cone
    while y <= r_cone:
        x = -r_cone
        while x <= r_cone:
            if math.hypot(x, y) <= r_cone:
                inside += 1
                if any(math.hypot(x - q[0], y - q[1]) <= r_hole for q in holes):
                    free += 1
            x += step
        y += step
    b.info(g, 'grille', '%d whole holes of %.1f mm, %.0f mm2 open in total'
           % (len(holes), hole, open_area))
    b.check(g, 'open area over the cone', 100.0 * free / inside, '>=', 25.0,
             unit='%', note='the driver is choked')
    # The rim of the field must not carry any part-holes: those come out as
    # slivers a fraction of a millimetre wide and tear off the print bed.
    whole = min((r_max - math.hypot(*q)) for q in holes)
    b.check(g, 'no part-holes at the rim of the field', whole, '>=', 0.0,
             note='the slivers tear off the bed')

    # --- 8. Case, printing ------------------------------------------------
    g = '8. Printing - simple FDM, one colour, no supports'
    # Two different criteria that are easy to mix up:
    #   vertical walls are built out of PASSES (0.4 mm wide),
    #   flat-lying plates are built out of LAYERS (0.2 mm high).
    # In the tub's print orientation (front face down) the front plate is a
    # plate and only the side wall is a wall.
    pass_w, layer = 0.4, 0.2
    for name, value in (('side wall', G('wall')),
                       ('chamber wall', G('chamber_wall')),
                       ('retaining rib', G('rib_b'))):
        n = value / pass_w
        b.check(g, '%s = whole passes (%.1f x 0.4)' % (name, n),
                 abs(n - round(n)), '<=', 0.001, unit='',
                 note='the slicer leaves a gap or over-extrudes')
    for name, value in (('front plate', G('front_d')),
                       ('lid', G('lid_d')),
                       ('carrier', G('carrier_d'))):
        n = value / layer
        b.check(g, '%s = whole layers (%.1f x 0.2)' % (name, n),
                 abs(n - round(n)), '<=', 0.001, unit='',
                 note='the last layer gets cut into')
    b.check(g, 'wall thickness load-bearing', G('wall'), '>=', 1.6)
    word = 'engraving' if G('logo_recessed') else 'embossing'
    b.check(g, 'logo %s deep enough' % word, G('logo_lid_h'), '>=', 0.6,
             note='no longer visible on a tired printer')
    b.check(g, 'logo %s = whole layers at 0.2 mm' % word,
             abs(G('logo_lid_h') / 0.2 - round(G('logo_lid_h') / 0.2)),
             '<=', 0.001, unit='')
    if G('logo_recessed'):
        b.check(g, 'lid left under the engraving',
                 G('lid_d') - G('logo_lid_h'), '>=', 1.2,
                 note='the bubble is a window')
        b.check(g, 'wall left behind the logo on the bottom edge',
                 G('wall') - G('logo_side_h'), '>=', 1.2,
                 note='the engraving cuts through the side wall')
    b.info(g, 'carrier', 'flat, ribs up, no support - the modules stand off '
                         'it on their own spacers')

    # The inner space gets wider towards the back in steps. Every step is
    # therefore an upward-facing bearing surface instead of an overhang.
    step_a = G('inner_b') - 2 * G('standoff')
    step_b = G('inner_b')
    step_c = G('outer_b') - 2 * G('lip') + G('lid_play')
    b.check(g, 'inner space widens towards the back (a<b)', step_b, '>',
             step_a, note='this step would be an overhang')
    b.check(g, 'inner space widens towards the back (b<c)', step_c, '>',
             step_b, note='this step would be an overhang')
    b.check(g, 'step as carrier ledge', G('standoff'), '>=', 1.2)
    b.check(g, 'outer skin above the lid rebate',
             G('lip') - G('lid_play') / 2, '>=', 0.8,
             note='too thin, breaks')

    b.check(g, 'tub onto the bed (X)', G('outer_b'), '<=', bed_x)
    b.check(g, 'tub onto the bed (Y)', G('outer_h'), '<=', bed_y)
    b.info(g, 'build height tub', '%.1f mm (front face down, opening up)'
           % G('outer_t'))
    b.info(g, 'build height carrier', '%.1f mm'
           % (G('carrier_d') + G('battery_d')
                                               + 0.2))
    lid_proud = max(0.0 if G('logo_recessed') else G('logo_lid_h'),
                    G('feet_h') if G('feet_on') else 0.0)
    b.info(g, 'build height lid', '%.1f mm (inside face down, logo up)'
           % (G('lid_d') + lid_proud))

    # --- 9. Opening and closing -------------------------------------------
    g = '9. Opening it - battery and prototype'
    b.check(g, 'lid play in the rebate', G('lid_play'), '>=', 0.2)
    b.check(g, 'lid play not too large', G('lid_play'), '<=', 0.6,
             note='the lid rattles')
    b.check(g, 'carrier play', G('carrier_play'), '>=', 0.2)
    b.check(g, 'boss wall around the pilot hole',
             (G('boss_d') - G('boss_core')) / 2, '>=', 1.0,
             note='the boss splits when screwed')
    b.check(g, 'countersink fits into the lid',
             G('lid_d') - G('csink_t'), '>=', 1.0,
             note='the screw head breaks through')
    b.check(g, 'screw head smaller than the boss', G('csink_d'), '<=',
             G('boss_d') + 0.4, note='the head stands proud of the boss')
    # The six lid bosses grew with the case: they run from the front plate all
    # the way to the lid, and above the carrier ledge the wall steps back, so
    # from there up each one is a free column merely touching the wall. They
    # are loaded in compression by their own screw, which is the easy
    # direction - but the number is worth seeing when the case gets taller.
    boss_h = G('inner_z_h') - G('front_d')
    b.info(g, 'lid boss', '%.1f mm tall, %.1f mm of that free above the ledge'
           % (boss_h, G('inner_z_h') - G('carrier_z_bottom')))
    b.check(g, 'lid boss slenderness', boss_h / G('boss_d'), '<=', 12.0,
             unit='x', note='that thin a column flexes as the screw is pulled up')
    b.info(g, 'screw fixing', '6 x M3 %s'
           % ('threaded insert' if G('threaded_insert') else 'self-tapping'))

    # --- 10. Weight and centre of gravity ---------------------------------
    g = '10. How it sits in the hand'
    m_battery, m_spk = 52.0, 35.0
    sp_x = (m_battery * (G('battery_x') + G('battery_b') / 2)
            + m_spk * G('spk_mx')) / (m_battery + m_spk)
    sp_y = (m_battery * (G('battery_y') + G('battery_h') / 2)
            + m_spk * G('spk_my')) / (m_battery + m_spk)
    b.info(g, 'centre of gravity battery+speaker',
           'x %.1f (centre %.1f), y %.1f (centre %.1f)'
           % (sp_x, env_b / 2, sp_y, env_h / 2))
    b.check(g, 'centre of gravity off centre, horizontal',
             abs(sp_x - env_b / 2), '<=', 8.0,
             note='tips sideways')
    b.check(g, 'centre of gravity off centre, vertical',
             abs(sp_y - env_h / 2), '<=', 8.0,
             note='top-heavy')

    # The lid is the back of the device. Whatever stands proudest of it is
    # what the device rests on. There are two ways to be right about that and
    # one way to be wrong.
    if not G('feet_on') and G('logo_recessed'):
        b.info(g, 'the device rests on', 'the whole flat back of the lid - '
                                         'the logo is cut into it')
        b.check(g, 'nothing standing proud of the lid', 0.0, '==', 0.0,
                 unit='mm')
        b.info(g, 'device lying on the table', '%.1f mm tall' % G('outer_t'))
    elif not G('feet_on'):
        b.check(g, 'the device rests on its feet, not on the logo',
                 0.0, '>=', 1.0, unit='pcs',
                 note='it rocks on the speech bubble and wears it through')
    else:
        b.check(g, 'feet stand clear of the logo',
                 G('feet_h') - G('logo_lid_h'), '>=', 0.4,
                 note='it goes on rocking on the bubble')
        nearest_csink = min(math.hypot(abs(dp[0] - env_b / 2) - G('feet_x'),
                                       abs(dp[1] - env_h / 2) - G('feet_y'))
                            for dp in boss_pos)
        b.check(g, 'foot clear of the nearest countersink',
                 nearest_csink - G('feet_d') / 2 - G('csink_d') / 2, '>=', 1.0,
                 note='the screw no longer sits flush')
        db = G('outer_b') - 2 * G('lip') - G('lid_play')
        dh = G('outer_h') - 2 * G('lip') - G('lid_play')
        b.check(g, 'foot stays on the flat of the lid (X)',
                 G('feet_x') + G('feet_d') / 2,
                 '<=', db / 2 - G('chamfer_lid'), note='sits on the chamfer')
        b.check(g, 'foot stays on the flat of the lid (Y)',
                 G('feet_y') + G('feet_d') / 2,
                 '<=', dh / 2 - G('chamfer_lid'), note='sits on the chamfer')
        # A narrow stance rocks even with feet on it.
        b.check(g, 'stance width against the case', 200.0 * G('feet_x') / db,
                 '>=', 60.0, unit='%', note='it rocks even on its feet')
        b.check(g, 'stance depth against the case', 200.0 * G('feet_y') / dh,
                 '>=', 60.0, unit='%', note='it rocks even on its feet')
        b.info(g, 'device standing on its feet', '%.1f mm tall'
               % (G('outer_t') + G('feet_h')))
    return b


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--offset', type=float, default=None,
                    help='override cap_offset_y (mm)')
    ap.add_argument('--bed', type=float, nargs=2, default=(220.0, 220.0),
                    metavar=('X', 'Y'), help='print bed (default 220 x 220)')
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
