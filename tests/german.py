#!/usr/bin/env python3
"""Recognises German in files that are supposed to be English.

Two tests need this and both used to guess at it separately, so it lives here
rather than in either of them. It is not run by tests/run.py: the folder is the
list of tests, and the list is files named test_*.py.

What went wrong before
----------------------
The first check looked for umlauts. Most German has none:

    // [M] wie weit die Kappe vor der Front steht

and the transliterated kind has none by construction - `Traeger`, `Gehaeuse`,
`Hoehe` are what you write when the display cannot draw an umlaut, and a whole
half-translated file passed on the strength of that.

The second check counted function words and wanted two on a line. That holds
up for a sentence, and it is still the rule for code, where a line is mostly
identifiers and data and one stray match means nothing. But a comment is prose
and comes in short pieces, and half a translated sentence is exactly the shape
that leaves one word behind:

    # No connection is made - the kernel only reveals which
    # Schnittstelle er hinauswollte.

So the rule now depends on where the line is. In a comment one word is enough,
which is why COMMENT_WORDS below holds no word that is also English - `die`,
`was` and `man` are German, and an English comment says them by accident all
day long. In code the older threshold of two still applies, against the wider
WORDS list, because a line of code is not a sentence.

What this does not catch
------------------------
A German identifier - `echtgross`, `pille`, `quellen`. There is nothing
structural to find: one token, no umlaut, no function words, and no letter
pattern that separates `feld` from `field` or `pille` from `pile`. Both were
tried. A character-trigram classifier trained on this repo's own German and
English scored `schalter` and `aktiv` as German but put `echtgross`, `feld`,
`quellen` and `pille` below `audio`, `total` and `line` - no threshold divides
them. A word list would only hold the ones somebody already found.

So German identifiers are a review matter, not a test matter, and saying so
here is worth more than a check that passes while covering none of it.
"""

from __future__ import annotations

import re
from pathlib import Path

# Line comments and block comments, by file extension. Markdown has no comment
# syntax because the whole file is prose - docs/ is English by the same rule
# the code is, so every line of it is read as a comment.
LINE_COMMENT = {
    ".py": "#", ".sh": "#", ".yml": "#", ".yaml": "#", ".toml": "#",
    ".cfg": "#", ".env": "#", "": "#",
    ".js": "//", ".mjs": "//", ".c": "//", ".h": "//", ".cpp": "//",
    ".ino": "//", ".scad": "//",
}
BLOCK_COMMENT = {
    ".js": ("/*", "*/"), ".mjs": ("/*", "*/"), ".css": ("/*", "*/"),
    ".c": ("/*", "*/"), ".h": ("/*", "*/"), ".cpp": ("/*", "*/"),
    ".ino": ("/*", "*/"), ".scad": ("/*", "*/"),
    ".html": ("<!--", "-->"),
}
ALL_PROSE = {".md"}

# Words that are German and are not also English words, so one of them in a
# comment is enough. Everything here was checked against the whole repo: no
# line of English prose in it contains any of these. `er` is the shortest and
# the one worth naming - it is what is left of a German sentence often enough
# to be worth having, and an English comment that says "er" is a person
# clearing their throat, which nobody writes down.
COMMENT_WORDS = (
    r"der|das|dem|den|des|und|oder|nicht|kein|keine|eine|einen|einem|eines|"
    r"einer|ist|sind|wird|werden|wurde|wurden|kann|muss|soll|sollte|darf|"
    r"damit|dann|wenn|weil|aber|auch|noch|schon|nur|hier|dort|steht|liegt|"
    r"gibt|macht|fehlt|sich|vom|zum|zur|beim|bei|aus|nach|fuer|für|durch|"
    r"gegen|ohne|hinter|zwischen|ihre|seine|diese|dieser|dieses|statt|welche|"
    r"welcher|wollte|wollen|dass|sowie|jede|jeder|jedes|etwa|immer|wieder|"
    r"mehr|er|sie|wie|selbst|leicht|gerade|zwei|drei|vier|fuenf|fünf|sechs|"
    r"sieben|acht|neun|zehn|Gerät|Geraet|Datei|Ordner|Rechner|können|koennen"
)

# The wider list, for lines that are not comments. It may hold words that are
# also English, because two of them on one line is still not an accident -
# `die` and `man` and `um` are all over English prose one at a time and never
# two at a time. `mit` is only here and not above because of the MIT licence,
# which every other file mentions and which matches it exactly.
WORDS = (COMMENT_WORDS
         + r"|die|man|im|um|als|ein|hat|mit|zu|auf|von|dies|alle|alles|"
           r"seiner|ihrer|einige")

COMMENT_RE = re.compile(rf"\b({COMMENT_WORDS})\b", re.I)
WORDS_RE = re.compile(rf"\b({WORDS})\b", re.I)
UMLAUT_RE = re.compile(r"[äöüßÄÖÜ]")

# Addresses are not prose. German domains and paths are full of short German
# words, and every one of them is a false positive: `.../LiPo-Akku-mit-JST-...`
# is a link to a battery, not a sentence.
URL_RE = re.compile(r"https?://\S+|\bwww\.\S+")

# Lines that look German but are not - a quoted example, a character table, a
# regular expression. Matched as a substring, so each entry says exactly what
# it forgives.
ALLOWED = [
    # Transliteration tables: data, not prose.
    ('("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")', "the umlaut table"),
    ("replacement", "the transliteration table in slugify"),
    # English prose quoting a German word as its example.
    ('"Fuß" and "fuss"', "an example in a docstring"),
    ('("wut" in "wütend")', "an example in a comment"),
    ('for "ü", so the', "explains the encoding bug"),
    ('"zurück" came out as "zur├╝ck"', "explains the encoding bug"),
    ('says "zurück" would be', "explains why one setting, not two"),
    ("`ä ö ü ß é à ñ ç`", "which letters the font has"),
    # Test data that is German on purpose.
    ("Ein sehr langer Name", "a name with umlauts, to test the encoding"),
    # The Wi-Fi captive portal: what a parent reads on their phone. That is
    # product text, not code, so it follows the product language. It moves
    # into texts.h when Wi-Fi lands in the main firmware.
    ("Damit der Talker neue Inhalte holen kann", "the captive portal"),
    ("Es bleibt gespeichert, diese Seite kommt", "the captive portal"),
    # docs/languages.md quotes the two German words that made the encoding
    # bug visible. Explaining it without them would not explain it.
    ("`zurück` would have ended", "the encoding bug, quoted"),
    ("`zur├╝ck`", "the encoding bug, quoted with the wrong glyphs"),
    ("`back` while the computer next to it says `zurück`",
     "why one setting, not two"),
    # The device speaks German, so English prose about the device quotes it.
    # These are what somebody reads off the five displays while setting it up.
    ('"keine Inhalte"', "what an empty device shows, quoted in English prose"),
    ("`kein WLAN`", "what the device shows without a network"),
    ("`nicht da`", "what the device says for a missing file"),
    ('"Ich moechte nach draussen"', "German input for a speech probe"),
    ('"Wahlweise"', "a heading doctor.py prints in German"),
    # Regular expressions and word lists that match German.
    ('re.search(r"[äöüßÄÖÜ]"', "a check for German"),
    ('re.search(r"[äöüß]"', "a check for German"),
    ('r"[A-Za-zÄÖÜäöüß]"', "a check for letters"),
]


def comment_fragments(text: str, suffix: str) -> dict[int, str]:
    """The comment on each line, by line number.

    Only the comment part, so that a German word in a string on the same line
    is judged by the stricter rule for code rather than the looser one for
    prose.
    """
    found: dict[int, str] = {}
    opener = LINE_COMMENT.get(suffix)
    block = BLOCK_COMMENT.get(suffix)
    open_tag, close_tag = block if block else (None, None)
    inside = False

    for number, raw in enumerate(text.split("\n"), start=1):
        line = URL_RE.sub(" ", raw)
        if suffix in ALL_PROSE:
            found[number] = line
            continue
        fragment = ""
        if inside:
            fragment = line
            if close_tag in line:
                fragment = line[:line.index(close_tag)]
                inside = False
        else:
            starts = []
            if open_tag and open_tag in line:
                starts.append(line.index(open_tag))
            if opener and opener in line:
                starts.append(line.index(opener))
            if starts:
                cut = min(starts)
                fragment = line[cut:]
                if (open_tag and fragment.startswith(open_tag)
                        and close_tag not in fragment[len(open_tag):]):
                    inside = True
        if fragment.strip():
            found[number] = fragment
    return found


def allowed(line: str) -> bool:
    """Whether this line is one of the quoted examples above."""
    return any(fragment in line for fragment, _ in ALLOWED)


def looks_german(line: str) -> bool:
    """Whether a single line of prose reads as German.

    The loose rule - an umlaut, or one German-only word - because what this is
    asked about is a message meant for somebody to read. For a line out of a
    file use findings() instead, which knows whether the line is a comment and
    applies the stricter rule to code.
    """
    if allowed(line):
        return False
    line = URL_RE.sub(" ", line)
    return bool(UMLAUT_RE.search(line) or COMMENT_RE.search(line))


def findings(path: Path, text: str) -> list[tuple[int, str, str]]:
    """Every German line in this file, as (line number, line, why).

    Three ways in: an umlaut anywhere, one German-only word in a comment, or
    two German words on a line of code.
    """
    prose = comment_fragments(text, path.suffix)
    out: list[tuple[int, str, str]] = []
    for number, raw in enumerate(text.split("\n"), start=1):
        if allowed(raw):
            continue
        line = URL_RE.sub(" ", raw)
        if UMLAUT_RE.search(line):
            out.append((number, raw.strip(), "umlaut"))
            continue
        fragment = prose.get(number, "")
        hit = COMMENT_RE.search(fragment) if fragment else None
        if hit:
            out.append((number, raw.strip(),
                        f"German word in a comment: {hit.group(0)!r}"))
            continue
        words = WORDS_RE.findall(line)
        if len(words) >= 2:
            out.append((number, raw.strip(),
                        "German words: "
                        + ", ".join(sorted({w.lower() for w in words}))))
    return out
