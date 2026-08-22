#!/usr/bin/env python3
"""Freezes the name a METACOM file is filed under, before metacom.py goes.

    python3 tools/symbolfreeze.py            # rewrite tests/reference/symbols.lock.json
    python3 tools/symbolfreeze.py --check    # index again, change nothing, report

A symbol lives in layout.json as `metacom:essen`, and two halves have to agree
on where that name comes from. metacom.py keys the collection by the file's
stem - _scan_files(), `files.setdefault(path.stem, ...)` - and obf.py reads it
back the same way. The browser gets a path out of the vendored bildquelle
package instead, and static/symbols.js turns it into the same reference.

If those two ever disagree, every layout that exists points at symbols nobody
can find, the build fails on boards that used to build, and neither half would
say a word about it.

tests/test_symbol_reference.py has checked this all along, and its oracle is
`"metacom:" + Path(path).stem` - a restatement of metacom.py's rule, written
out by hand next to it. That is fine while metacom.py is here to be read, and
it is two things worth separating once it is not:

  * a paraphrase can drift from what the code does. This one already has -
    _scan_files() globs "*.png" and nothing else, so for the .jpeg and .webp
    cases in that test metacom.py has no opinion at all, while the paraphrase
    confidently supplies one.
  * when metacom.py goes, the paraphrase stays and passes for ever, because
    both sides of it are then in the browser's half.

So this asks the real indexer rather than restating it: a folder is built with
one file per case, metacom._scan_files() runs over it, and what it keyed each
file under is what gets written down. Where it keys nothing, that is recorded
as nothing rather than filled in.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

REFERENCE = ROOT / "tests" / "reference"
LOCK = REFERENCE / "symbols.lock.json"

# Paths as the vendored package reports them: relative to whichever folder
# somebody chose, nested, and with the shapes METACOM really ships. The
# adapter throws the folders away and keeps the stem, so what each case is
# really about is a way for that to go wrong.
CASES = [
    ("Apfel.png",
     "the plain case, and the only one where every wrong rule still passes"),
    ("METACOM_Symbole/Symbole_PNG/PNG_ohne_Rahmen/essen.png",
     "the full path from the top of a real collection - four folders to discard"),
    ("PNG_ohne_Rahmen/wuetend.png",
     "one folder, which is what the picker usually hands over"),
    ("PNG_ohne_Rahmen/wuetendSW.png",
     "the black-and-white rendition: a variant suffix that is part of the name"),
    ("PNG_ohne_Rahmen/wuetend2.png",
     "an alternative of the same symbol, numbered rather than suffixed"),
    ("PNG_ohne_Rahmen/wuetend_dh.png",
     "a skin-tone variant - VARIANT_SUFFIX knows these, and the reference "
     "still keeps the whole name rather than the base"),
    ("PNG_ohne_Rahmen/Guten_Morgen.png",
     "an underscore, and a capital in the middle of a reference"),
    ("PNG_ohne_Rahmen/zwei.punkte.png",
     "a dot that is not the extension: only the last suffix comes off, so a "
     "rule that cut at the first dot loses half the name"),
    ("PNG_ohne_Rahmen/.versteckt.png",
     "a leading dot. The extension is still .png and the name keeps its dot"),
    ("a/b/c/tief_verschachtelt.webp",
     "not a PNG, so metacom.py never files it at all - and the browser can be "
     "handed one, because the package searches a folder it did not choose"),
    ("PNG_ohne_Rahmen/gross.jpeg",
     "the same, with the extension length that catches a rule cutting four "
     "characters instead of finding the dot"),
]


def indexed_names(paths: list[str]) -> dict[str, str | None]:
    """What metacom.py keys each of these files under, if anything.

    One file per case in a folder shaped like a real collection, then the real
    _scan_files() over it. Its answer is a stem to a relative path; what is
    wanted here is the other direction, so the file names are made unique
    first - two cases sharing a stem would collide in setdefault(), and which
    of them won would depend on the order rglob happened to walk the disk in.
    That is a real property of the collection and it is not what this is about.
    """
    import metacom

    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        # symbols_dir() looks for the folder METACOM keeps its PNGs in, so the
        # files have to sit where a real collection would put them.
        folder = root / "METACOM_Symbole" / "Symbole_PNG" / "PNG_ohne_Rahmen"
        folder.mkdir(parents=True, exist_ok=True)
        for path in paths:
            (folder / Path(path).name).write_bytes(b"")
        os.environ["VORLAUT_METACOM_DIR"] = str(root)
        found = metacom._scan_files()

    # stem -> relative path, inverted onto the case list by file name.
    by_file = {value: key for key, value in found.items()}
    return {path: by_file.get(Path(path).name) for path in paths}


def freeze() -> dict:
    # The prefix belongs to tiles.py, which is what actually splits a
    # reference back apart. Taken from there rather than written out again -
    # this file is about not restating rules.
    from tiles import METACOM_PREFIX

    paths = [path for path, _ in CASES]
    keys = indexed_names(paths)

    entries = []
    for path, why in CASES:
        key = keys[path]
        # Where _scan_files() reached the file, its own answer is used. Where
        # the glob did not reach it there is still a Python opinion to be had,
        # and it is worth being exact about what it is: metacom.py files a
        # symbol with `files.setdefault(path.stem, ...)`, so path.stem *is*
        # the rule, and only the "*.png" in front of it kept this file out.
        # Calling Path(...).stem here is therefore the same expression that
        # module runs, not a restatement of it - and it stops being available
        # on the same day.
        stem = key if key is not None else Path(path).stem
        entries.append({
            "path": path,
            "why": why,
            # What _scan_files() filed it under, or None where its glob never
            # saw the file. Kept apart from the reference on purpose.
            "indexed_as": key,
            "indexed": key is not None,
            "reference": METACOM_PREFIX + stem,
        })
        print(f"  {path:<52} -> {entries[-1]['reference']}")

    unindexed = [e["path"] for e in entries if not e["indexed"]]
    return {
        "what": "The reference metacom.py files a symbol under, for paths the "
                "vendored bildquelle package can hand the adapter in "
                "static/symbols.js. Frozen so the two halves can still be held "
                "to each other once metacom.py is gone.",
        "produced_by": "tools/symbolfreeze.py",
        "produced_on": date.today().isoformat(),
        "python": sys.version.split()[0],
        "oracle": "metacom._scan_files(), run over a folder built for the "
                  "purpose - not a restatement of what it does",
        "prefix": METACOM_PREFIX,
        "invalidated_by": [
            "a change to _scan_files() in metacom.py, or to the glob it uses",
            "a change to how obf.py or layout.json spell a symbol reference",
            "a new case here, which has to be frozen rather than guessed",
        ],
        "not_invalidated_by": [
            "changes to static/symbols.js or to the vendored bildquelle - "
            "that is the half being checked, and refreezing to make it pass "
            "would leave the adapter agreeing with itself",
        ],
        "unindexed": {
            "paths": unindexed,
            "what": "metacom._scan_files() globs '*.png' and nothing else, so "
                    "its index never sees these. The browser can still be "
                    "handed such a path, because the package searches "
                    "whatever folder it was pointed at. Their reference is "
                    "still frozen, and from Python: path.stem is the rule "
                    "metacom.py applies - it is the expression in "
                    "_scan_files() - and only the glob in front of it kept "
                    "these out. So the name is checked; what is not checked "
                    "is that anything resolves, because nothing does. A "
                    "reference built from one of these renders as the "
                    "placeholder, which is the honest outcome and not a bug "
                    "in the adapter.",
            "why_it_matters": "these are also the only cases whose extension "
                              "is not four characters long. Every PNG makes "
                              "'strip the last suffix' and 'drop four "
                              "characters' agree, so without them a rule "
                              "doing the latter passes everything.",
        },
        "cases": entries,
    }


def main(argv: list[str]) -> int:
    check = "--check" in argv
    print("Indexing." if check else "Indexing and freezing.")
    fresh = freeze()

    if not check:
        REFERENCE.mkdir(parents=True, exist_ok=True)
        LOCK.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        print(f"\n  {len(fresh['cases'])} cases in {LOCK.relative_to(ROOT)}")
        return 0

    if not LOCK.exists():
        print("\n  nothing frozen yet - run without --check")
        return 1
    old = json.loads(LOCK.read_text(encoding="utf-8"))
    was = {c["path"]: c["reference"] for c in old["cases"]}
    moved = [c["path"] for c in fresh["cases"] if was.get(c["path"]) != c["reference"]]
    if len(old["cases"]) != len(fresh["cases"]):
        print(f"\n  {len(old['cases'])} cases frozen, {len(fresh['cases'])} now")
        return 1
    if moved:
        print(f"\n  metacom.py files {len(moved)} of them differently now: "
              f"{', '.join(moved)}")
        print("  Work out why before refreezing. A moved reference and a "
              "broken adapter look the same from here.")
        return 1
    print("\n  unchanged - metacom.py still files these under the frozen names")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
