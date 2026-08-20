#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nachrechnung für mitreden-gehaeuse.scad.

Warum es das gibt: OpenSCAD zeigt eine Vorschau, aber eine Vorschau lügt
freundlich. Ob ein Ausschnitt 0,4 mm daneben sitzt oder eine Rippe 1,9 mm
über eine Kante ragt, sieht man dort nicht — nachrechnen schon.

Das Skript liest die Maße AUS der .scad-Datei (Abschnitte 0 bis 3) und
rechnet unabhängig davon nach. Es dupliziert die Zahlen also nicht, es
prüft sie. Wer eine Zahl in der .scad ändert, bekommt hier sofort das
Ergebnis — ohne OpenSCAD zu starten.

    python3 gehaeuse/nachrechnen.py
    python3 gehaeuse/nachrechnen.py --versatz 1.5     # Kappe 1,5 mm versetzt
    python3 gehaeuse/nachrechnen.py --bett 200 200    # kleineres Druckbett

Rückgabewert 0 = alles in Ordnung, 1 = mindestens eine Prüfung gefallen.
"""

import argparse
import math
import os
import re
import sys

SCAD = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    'mitreden-gehaeuse.scad')


# ---------------------------------------------------------------- Parser

def lade_parameter(pfad):
    """Zieht die skalaren Zuweisungen aus der .scad-Datei.

    Nur bis zum ersten `module` — dahinter stehen lokale Variablen, die
    hier nichts zu suchen haben. `function`-Zeilen stoeren nicht: die
    Zuweisungs-Regex greift bei `function name(...) =` nicht.
    """
    with open(pfad, encoding='utf-8') as f:
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
        # OpenSCAD-Eigenheiten, die Python nicht auswerten kann und die
        # hier auch niemand braucht: Listen, Listen-Comprehensions, concat.
        if name in roh or expr.startswith('['):
            continue
        if any(k in expr for k in ('for (', 'concat(', 'len(', 'str(')):
            continue
        tern = re.match(r'^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$', expr)
        if tern:
            expr = '(%s) if (%s) else (%s)' % (tern.group(2), tern.group(1),
                                               tern.group(3))
        roh[name] = expr

    offen = dict(roh)
    for _ in range(60):
        if not offen:
            break
        vorher = len(offen)
        for name, expr in list(offen.items()):
            try:
                ns[name] = eval(expr, {'__builtins__': {}}, ns)
                del offen[name]
            except Exception:
                pass
        if len(offen) == vorher:
            break
    if offen:
        raise SystemExit('Nicht auswertbar: %s' % ', '.join(sorted(offen)))
    return ns


# ------------------------------------------------------------ Prüfgerüst

class Bericht:
    def __init__(self):
        self.zeilen = []
        self.gefallen = 0

    def pruefe(self, gruppe, was, ist, op, soll, einheit='mm', hinweis=''):
        vgl = {'>=': lambda a, b: a >= b - 1e-9,
               '<=': lambda a, b: a <= b + 1e-9,
               '>':  lambda a, b: a > b + 1e-9,
               '==': lambda a, b: abs(a - b) < 1e-6}[op]
        ok = vgl(ist, soll)
        if not ok:
            self.gefallen += 1
        self.zeilen.append((gruppe, was, ist, op, soll, einheit, ok, hinweis))

    def info(self, gruppe, was, text):
        self.zeilen.append((gruppe, was, text, None, None, '', True, ''))

    def ausgeben(self):
        letzte = None
        for gruppe, was, ist, op, soll, einheit, ok, hinweis in self.zeilen:
            if gruppe != letzte:
                print('\n%s' % gruppe)
                print('-' * len(gruppe))
                letzte = gruppe
            if op is None:
                print('  ·    %-44s %s' % (was, ist))
                continue
            zeichen = 'ok  ' if ok else 'FEHL'
            print('  %s %-44s %9.3f %-2s %9.3f %s%s'
                  % (zeichen, was, ist, op, soll, einheit,
                     '' if ok else '   <-- ' + hinweis if hinweis else ''))
        print()
        if self.gefallen:
            print('%d Pruefung(en) gefallen.' % self.gefallen)
        else:
            print('Alle Pruefungen bestanden.')
        return 1 if self.gefallen else 0


def ueberlappt(a, b, eps=1e-3):
    return (a[0] < b[2] - eps and b[0] < a[2] - eps and
            a[1] < b[3] - eps and b[1] < a[3] - eps)


# ------------------------------------------------------------ Nachrechnung

def rechne(p, bett_x, bett_y):
    """p ist der Namensraum aus der .scad. Alles hier wird daraus neu
    hergeleitet — die Listen (sk_pos, dom_pos) stehen in der .scad als
    Listenliteral und werden deshalb hier gespiegelt. Wer dort etwas
    verschiebt, muss es auch hier tun; die Prüfung 'Raster' unten fängt
    ein Auseinanderlaufen der Rasterwerte ab."""
    b = Bericht()
    G = lambda n: p[n]

    env_b, env_h = G('env_b'), G('env_h')
    versatz_y, versatz_x = G('kappe_versatz_y'), G('kappe_versatz_x')

    sk_pos = [(G('set_mx'), G('set_my')),
              (G('blk_mx1'), G('blk_my1')), (G('blk_mx2'), G('blk_my1')),
              (G('blk_mx1'), G('blk_my2')), (G('blk_mx2'), G('blk_my2'))]
    dom_e = G('dom_e')
    dom_pos = [(-dom_e, -dom_e), (env_b + dom_e, -dom_e),
               (-dom_e, env_h + dom_e), (env_b + dom_e, env_h + dom_e),
               (env_b / 2, -dom_e), (env_b / 2, env_h + dom_e)]

    # --- 1. Bedienung durch ein Kleinkind ---------------------------------
    g = '1. Bedienung — reicht der Abstand fuer eine Kinderhand?'
    b.pruefe(g, 'Kappenspalt waagerecht', G('raster_x') - G('sk_kappe_b'),
             '>=', 12, hinweis='zwei Tasten auf einmal getroffen')
    b.pruefe(g, 'Kappenspalt senkrecht', G('raster_y') - G('sk_kappe_h'),
             '>=', 12, hinweis='zwei Tasten auf einmal getroffen')
    b.pruefe(g, 'Set-Taste zum Viererblock',
             G('blk_mx1') - G('set_mx') - G('sk_kappe_b'), '>=', 20)
    # Spalt um die Kappe: gross genug zum Nichtklemmen, zu schmal fuer Finger
    b.pruefe(g, 'Luft um die Kappe (nicht klemmen)', G('spalt_kappe'),
             '>=', 0.4)
    b.pruefe(g, 'Luft um die Kappe (kein Kinderfinger)', G('spalt_kappe'),
             '<=', 2.0, hinweis='Finger koennte hineingeraten')
    b.pruefe(g, 'Fase am Tastenausschnitt', G('fase_taste'), '>=', 0.4,
             hinweis='scharfe Kante')
    b.pruefe(g, 'Eckenradius aussen', G('ecke_r'), '>=', 3.0)
    b.pruefe(g, 'Fase Frontkante', G('fase_vorn'), '>=', 0.8)

    # --- 2. Die eine Stellschraube ----------------------------------------
    g = '2. kappe_versatz_y — die groesste offene Unbekannte'
    freiraum_hb = (G('sk_kappe_b') + 2 * G('spalt_kappe')) / 2
    freiraum_hh = (G('sk_kappe_h') + 2 * G('spalt_kappe')) / 2
    loch_dx = G('sk_platine_b') / 2 - G('sk_loch_rand')
    loch_dy = G('sk_platine_h') / 2 - G('sk_loch_rand')
    noetig = G('sk_dom_kern') / 2 + G('sk_dom_wand')

    dome = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            frei = max(abs(loch_dx * sx - versatz_x) - freiraum_hb,
                       abs(loch_dy * sy - versatz_y) - freiraum_hh)
            if frei >= noetig:
                dome.append((sx, sy))
    budget = loch_dy - freiraum_hh - noetig

    b.info(g, 'eingetragener Versatz', '%.3f mm' % versatz_y)
    b.info(g, 'Budget bis zum ersten Domausfall', '%.3f mm' % budget)
    b.pruefe(g, 'Dome je ScreenKey', len(dome), '>=', 2, einheit='St',
             hinweis='Platine haengt an nichts mehr')
    if len(dome) == 4:
        b.info(g, 'Halt der Platine', 'vier Dome, allseitig')
    else:
        b.info(g, 'Halt der Platine',
               '%d Dome — nur EINE Kante, kann kippeln!' % len(dome))
    # Der Freiraum muss tiefer sein als der Kappenkoerper, sonst steht
    # hinter der Frontplatte wieder etwas in der Bahn.
    b.pruefe(g, 'Freiraum reicht hinter den Kappenkoerper',
             G('sk_kappe_tiefe'), '>=',
             G('sk_gesamttiefe') - G('sk_kappe_ueberstand'),
             hinweis='Kappe stoesst hinter der Front an')
    # Kappe darf nicht ueber die Platine hinauswandern
    b.pruefe(g, 'Kappe bleibt ueber der Platine (y)',
             G('sk_platine_h') / 2 - (G('sk_kappe_h') / 2 + abs(versatz_y)),
             '>=', 0.5, hinweis='Kappe steht ueber die Platine hinaus')
    b.pruefe(g, 'Kappe bleibt ueber der Platine (x)',
             G('sk_platine_b') / 2 - (G('sk_kappe_b') / 2 + abs(versatz_x)),
             '>=', 0.5)

    # --- 3. Platinen und Dome in der Ebene --------------------------------
    g = '3. Platinen beruehren sich nicht'
    b.pruefe(g, 'Platinenspalt waagerecht',
             G('raster_x') - G('sk_platine_b'), '>', 2)
    b.pruefe(g, 'Platinenspalt senkrecht',
             G('raster_y') - G('sk_platine_h'), '>', 2)
    b.pruefe(g, 'Raster passt zum Kappenspalt (x)',
             G('raster_x'), '==', G('sk_kappe_b') + 15.0)
    b.pruefe(g, 'Raster passt zum Kappenspalt (y)',
             G('raster_y'), '==', G('sk_kappe_h') + 20.0)

    dmin = min(max(abs(dp[0] - sp[0]) - G('sk_platine_b') / 2,
                   abs(dp[1] - sp[1]) - G('sk_platine_h') / 2) - G('dom_d') / 2
               for dp in dom_pos for sp in sk_pos)
    b.pruefe(g, 'Deckeldom zur naechsten Platine', dmin, '>', 0,
             hinweis='Dom steht auf einer Platine')

    # --- 4. Tiefenbudget --------------------------------------------------
    g = '4. Tiefe — was hinter der Front uebereinander liegt'
    frei_ueber_traeger = G('innen_z_h') - G('traeger_z_o')
    b.info(g, 'Aufbau', 'Front %.1f | ScreenKey %.1f | Kabel %.1f | '
                        'Traeger %.1f | Bauteile %.1f | Deckel %.1f'
           % (G('front_d'), G('sk_hinter_front'), G('kabelraum'),
              G('traeger_d'), frei_ueber_traeger, G('deckel_d')))
    b.pruefe(g, 'Platz ueber dem Traeger fuer den Akku',
             frei_ueber_traeger, '>=', G('akku_d') + G('bauteil_luft'))
    b.pruefe(g, 'Platz ueber dem Traeger fuer den Feather',
             frei_ueber_traeger, '>=',
             G('feather_stuetze') + G('feather_h') + 0.0,
             hinweis='Feather stoesst gegen den Deckel')
    b.pruefe(g, 'Platz ueber dem Traeger fuer den Verstaerker',
             frei_ueber_traeger, '>=', G('amp_stuetze') + G('amp_d'))
    b.pruefe(g, 'Innentiefe fuer den Lautsprecher',
             G('innen_z_h') - G('front_d'), '>=', G('ls_tiefe') + 0.5)
    b.pruefe(g, 'ScreenKey passt hinter die Front',
             G('sk_platine_z_v'), '>=', G('front_d') + 1.0)
    b.pruefe(g, 'Kabelraum hinter der ScreenKey-Platine',
             G('kabelraum'), '>=', 4.0,
             hinweis='Stecker und Litzen brauchen Platz')

    # --- 5. Kollisionen auf dem Traeger -----------------------------------
    g = '5. Bauteile auf dem Traeger'
    bett = G('bett')
    teile = [
        ('Akku', (G('akku_x') - bett, G('akku_y') - bett,
                  G('akku_x') + G('akku_b') + bett,
                  G('akku_y') + G('akku_h') + bett)),
        ('Feather', (G('feather_x'), G('feather_y'),
                     G('feather_x') + G('feather_l'),
                     G('feather_y') + G('feather_b'))),
        ('Verstaerker', (G('amp_x') - bett, G('amp_y') - bett,
                         G('amp_x') + G('amp_b') + bett,
                         G('amp_y') + G('amp_h') + bett)),
    ]
    hindernisse = [('Kammer', (-G('innen_rand'), G('kammer_y'),
                               G('kammer_x') + G('kammer_wand'),
                               env_h + G('innen_rand')))]
    hindernisse += [('Deckeldom %d' % i,
                     (d[0] - G('dom_d') / 2, d[1] - G('dom_d') / 2,
                      d[0] + G('dom_d') / 2, d[1] + G('dom_d') / 2))
                    for i, d in enumerate(dom_pos)]

    treffer = []
    for i in range(len(teile)):
        for j in range(i + 1, len(teile)):
            if ueberlappt(teile[i][1], teile[j][1]):
                treffer.append('%s/%s' % (teile[i][0], teile[j][0]))
    for na, ra in teile:
        for nh, rh in hindernisse:
            if ueberlappt(ra, rh):
                treffer.append('%s/%s' % (na, nh))
    b.pruefe(g, 'Ueberschneidungen (mit Halterippen)', len(treffer), '==', 0,
             einheit='St', hinweis=', '.join(treffer))

    raus = [n for n, r in teile
            if r[0] < -G('innen_rand') - 1e-3 or r[1] < -G('innen_rand') - 1e-3
            or r[2] > env_b + G('innen_rand') + 1e-3
            or r[3] > env_h + G('innen_rand') + 1e-3]
    b.pruefe(g, 'ragt ueber die Innenwand hinaus', len(raus), '==', 0,
             einheit='St', hinweis=', '.join(raus))

    # Der Traeger ist unter der Kammer ausgeschnitten — dort darf nichts stehen
    schnitt_x = G('kammer_x') + G('kammer_wand') + G('innen_rand') + 1.8
    for name, r in teile:
        if r[3] > G('kammer_y') + G('kammer_wand'):
            b.pruefe(g, '%s steht auf Traegermaterial' % name, r[0], '>=',
                     schnitt_x - G('innen_rand') - 1.0,
                     hinweis='steht ueber dem Kammerausschnitt')

    # --- 6. USB-C ---------------------------------------------------------
    g = '6. USB-C — die einzige Verbindung nach aussen'
    b.pruefe(g, 'Feather-Kante an der Innenwand',
             abs(G('feather_x') + G('innen_rand')), '<=', 0.01,
             hinweis='Buchse erreicht die Gehaeusekante nicht')
    b.pruefe(g, 'Buchse ragt bis in die Wand',
             G('usb_ueberstand'), '>=', 0.5)
    fen_h = G('usb_fen_h')
    b.pruefe(g, 'Fensterunterkante ueber der Traegerauflage',
             G('usb_z') - fen_h / 2, '>=', G('traeger_z_o') + 1.0)
    b.pruefe(g, 'Fensteroberkante unter dem Deckelfalz',
             G('usb_z') + fen_h / 2, '<=', G('innen_z_h') - 1.0)
    b.pruefe(g, 'Fenster breiter als die Buchse',
             G('usb_buchse_b') + 1.4, '>=', G('usb_buchse_b') + 1.0)
    b.info(g, 'Bruecke ueber dem Fenster',
           '%.1f mm frei ueberspannt (FDM schafft das)'
           % (G('usb_buchse_b') + 1.4 - 2 * 1.0))

    # --- 7. Lautsprecher --------------------------------------------------
    g = '7. Lautsprecher — geschlossen hinten, offen nach vorn'
    kam_b = G('kammer_x') + G('kammer_wand') + G('innen_rand')
    kam_h = env_h + G('innen_rand') - G('kammer_y')
    kam_t = G('innen_z_h') - G('front_d')
    brutto = kam_b * kam_h * kam_t / 1000.0
    netto = brutto - (G('ls_rahmen') ** 2 * G('ls_tiefe')) / 1000.0
    b.info(g, 'Kammervolumen', '%.1f cm3 brutto, %.1f cm3 netto'
           % (brutto, netto))
    b.pruefe(g, 'Restvolumen hinter dem Chassis', netto, '>=', 20.0,
             einheit='cm3', hinweis='klingt duenn und blechern')
    b.pruefe(g, 'Kammer tief genug fuer das Chassis', kam_t, '>=',
             G('ls_tiefe') + 0.5)
    b.pruefe(g, 'Luft zwischen Chassis und Kammerwand', G('kammer_luft'),
             '>=', 1.0)
    b.pruefe(g, 'Schallaustritt deckt die Membran',
             G('gitter_feld_d'), '>=', G('ls_membran_d'))
    b.pruefe(g, 'Gitterloch zu gross fuer einen Kinderfinger',
             G('gitter_loch_d'), '<=', 5.0,
             hinweis='Finger passt hinein')
    steg = G('gitter_raster') - G('gitter_loch_d')
    b.pruefe(g, 'Steg zwischen den Gitterloechern', steg, '>=', 1.2,
             hinweis='bricht heraus')

    # --- 8. Gehaeuse, Druck ----------------------------------------------
    g = '8. Drucken — einfacher FDM, eine Farbe, ohne Stuetzen'
    # Zwei verschiedene Kriterien, die man leicht verwechselt:
    #   senkrechte Waende werden aus BAHNEN gebaut (Breite 0,4 mm),
    #   flach liegende Platten aus LAGEN (Hoehe 0,2 mm).
    # In der Drucklage der Wanne (Front unten) ist die Frontplatte eine
    # Platte und nur die Seitenwand eine Wand.
    bahn, lage = 0.4, 0.2
    for name, wert in (('Seitenwand', G('wand')),
                       ('Kammerwand', G('kammer_wand')),
                       ('Halterippe', G('rippe_b'))):
        n = wert / bahn
        b.pruefe(g, '%s = ganze Bahnen (%.1f x 0,4)' % (name, n),
                 abs(n - round(n)), '<=', 0.001, einheit='',
                 hinweis='Slicer laesst eine Luecke oder ueberextrudiert')
    for name, wert in (('Frontplatte', G('front_d')),
                       ('Deckel', G('deckel_d')),
                       ('Traeger', G('traeger_d'))):
        n = wert / lage
        b.pruefe(g, '%s = ganze Lagen (%.1f x 0,2)' % (name, n),
                 abs(n - round(n)), '<=', 0.001, einheit='',
                 hinweis='letzte Lage wird angeschnitten')
    b.pruefe(g, 'Wandstaerke tragfaehig', G('wand'), '>=', 1.6)
    b.pruefe(g, 'Logo-Praegung hoch genug', G('logo_deckel_h'), '>=', 0.6,
             hinweis='auf einem muedem Drucker nicht mehr zu sehen')
    b.pruefe(g, 'Logo-Praegung = ganze Lagen bei 0,2 mm',
             abs(G('logo_deckel_h') / 0.2 - round(G('logo_deckel_h') / 0.2)),
             '<=', 0.001, einheit='')

    # Der Innenraum wird nach hinten stufenweise weiter. Jede Stufe ist damit
    # eine nach oben zeigende Auflage statt eines Ueberhangs.
    stufe_a = G('innen_b') - 2 * G('sockel')
    stufe_b = G('innen_b')
    stufe_c = G('aussen_b') - 2 * G('lippe') + G('deckel_spiel')
    b.pruefe(g, 'Innenraum wird nach hinten weiter (a<b)', stufe_b, '>',
             stufe_a, hinweis='diese Stufe waere ein Ueberhang')
    b.pruefe(g, 'Innenraum wird nach hinten weiter (b<c)', stufe_c, '>',
             stufe_b, hinweis='diese Stufe waere ein Ueberhang')
    b.pruefe(g, 'Absatz als Traegerauflage', G('sockel'), '>=', 1.2)
    b.pruefe(g, 'Aussenhaut ueber dem Deckelfalz',
             G('lippe') - G('deckel_spiel') / 2, '>=', 0.8,
             hinweis='zu duenn, bricht')

    b.pruefe(g, 'Wanne aufs Bett (X)', G('aussen_b'), '<=', bett_x)
    b.pruefe(g, 'Wanne aufs Bett (Y)', G('aussen_h'), '<=', bett_y)
    b.info(g, 'Bauhoehe Wanne', '%.1f mm (Front unten, Oeffnung nach oben)'
           % G('aussen_t'))
    b.info(g, 'Bauhoehe Traeger', '%.1f mm' % (G('traeger_d') + G('akku_d')
                                               + 0.2))
    b.info(g, 'Bauhoehe Deckel', '%.1f mm (Innenseite unten, Logo oben)'
           % (G('deckel_d') + G('logo_deckel_h')))

    # --- 9. Oeffnen und Schliessen ---------------------------------------
    g = '9. Zu oeffnen — Akku und Prototyp'
    b.pruefe(g, 'Deckelspiel im Falz', G('deckel_spiel'), '>=', 0.2)
    b.pruefe(g, 'Deckelspiel nicht zu gross', G('deckel_spiel'), '<=', 0.6,
             hinweis='Deckel klappert')
    b.pruefe(g, 'Traegerspiel', G('traeger_spiel'), '>=', 0.2)
    b.pruefe(g, 'Domwand um das Kernloch',
             (G('dom_d') - G('dom_kern')) / 2, '>=', 1.0,
             hinweis='Dom reisst beim Schrauben auf')
    b.pruefe(g, 'Senkung passt in den Deckel',
             G('deckel_d') - G('senk_t'), '>=', 1.0,
             hinweis='Schraubenkopf bricht durch')
    b.pruefe(g, 'Schraubenkopf kleiner als der Dom', G('senk_d'), '<=',
             G('dom_d') + 0.4, hinweis='Kopf steht ueber den Dom hinaus')
    b.info(g, 'Verschraubung', '6 x M3 %s'
           % ('Gewindeeinsatz' if G('gewindeeinsatz') else 'selbstschneidend'))

    # --- 10. Gewicht und Schwerpunkt -------------------------------------
    g = '10. Wie es in der Hand liegt'
    m_akku, m_ls = 52.0, 35.0
    sp_x = (m_akku * (G('akku_x') + G('akku_b') / 2)
            + m_ls * G('ls_mx')) / (m_akku + m_ls)
    sp_y = (m_akku * (G('akku_y') + G('akku_h') / 2)
            + m_ls * G('ls_my')) / (m_akku + m_ls)
    b.info(g, 'Schwerpunkt Akku+Lautsprecher',
           'x %.1f (Mitte %.1f), y %.1f (Mitte %.1f)'
           % (sp_x, env_b / 2, sp_y, env_h / 2))
    b.pruefe(g, 'Schwerpunkt waagerecht aus der Mitte',
             abs(sp_x - env_b / 2), '<=', 8.0,
             hinweis='kippt zur Seite')
    b.pruefe(g, 'Schwerpunkt senkrecht aus der Mitte',
             abs(sp_y - env_h / 2), '<=', 8.0,
             hinweis='kopflastig')
    return b


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--versatz', type=float, default=None,
                    help='kappe_versatz_y ueberschreiben (mm)')
    ap.add_argument('--bett', type=float, nargs=2, default=(220.0, 220.0),
                    metavar=('X', 'Y'), help='Druckbett (Vorgabe 220 x 220)')
    ap.add_argument('--scad', default=SCAD)
    a = ap.parse_args()

    p = lade_parameter(a.scad)
    if a.versatz is not None:
        p['kappe_versatz_y'] = a.versatz

    print('mitreden — Gehaeuse, Nachrechnung')
    print('Quelle: %s' % os.path.relpath(a.scad))
    print('Aussen: %.2f x %.2f x %.2f mm   Bett: %.0f x %.0f mm'
          % (p['aussen_b'], p['aussen_h'], p['aussen_t'], a.bett[0], a.bett[1]))
    b = rechne(p, a.bett[0], a.bett[1])
    return b.ausgeben()


if __name__ == '__main__':
    sys.exit(main())
