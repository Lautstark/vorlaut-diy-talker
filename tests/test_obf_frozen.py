#!/usr/bin/env python3
"""Checks src/data/obf.ts against what obf.py said, without obf.py.

The converter existed twice, and tests/test_obf_js.py held the two together
while both were here; the Python half went on 2026-08-22 and took the live
test with it. This is the half that outlives them: everything in
tests/reference/obf.lock.json was written by obf.py and layout.py through
tools/obffreeze.py, and nothing below imports any of them. Node and the
lock file are the whole of what it needs.

One thing about that tool, because it is the odd one out of the five: it is
still in tools/, kept as the record of how the lock was made, and it can no
longer run - everything it imports, obf.py and layout.py first among them,
went with the Python half. Its presence is not a way to regenerate the lock.
The lock is the record, nothing in the repository can write it again, and a
deliberate change to the mapping means restoring the oracle and its imports
from git for as long as a refreeze takes (docs/frozen-references.md, "The
board as a document").

Which matters more here than for the other three subsystems, because there is
no second opinion to fall back on. Tile rendering has Pillow, layout.bin has
the firmware's own C reader compiled at test time, the speech chain has
ffmpeg. A board is a mapping this project invented, so obf.py was the only
thing that ever knew whether src/data/obf.ts was right - and a mapping compared
against nothing passes for ever.

Five comparisons:

  the helpers      every small rule on the arguments that bite, including the
                   ones obf.py refused.
  layout -> board  the document each layout becomes, field for field.
  board -> layout  the layout each document becomes - the exporter's own, and
                   the foreign ones where the mapping is actually hard.
  the licence      the documents that must be refused, and the sentence.
  the container    the .obz the browser writes, opened with Python's own
                   zipfile and compared member by member with what write_obz()
                   put in; and the files obf.py packed, read back by the
                   browser. Not the compressed bytes - zlib and
                   CompressionStream are two compressors, and only what comes
                   out of the members can be identical.

What this cannot do is answer for a case nobody recorded. If the mapping grows
a field, this file cannot say what the new right answer is; obf.py has to come
back to say it. See docs/frozen-references.md.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The browser half is TypeScript now, so plain `node` cannot run these
# harnesses. vite-node can - it is vitest's own loader, already installed, and
# it resolves imports exactly the way the bundle does. Deliberately no build
# step in between: a frozen reference compared against compiled output has
# stopped measuring the source it names.
#
# The binary rather than `npx vite-node`, because npx reads its first argument
# as a command name and would try to execute the harness itself.
JS_RUNNER = str(ROOT / "node_modules" / ".bin" / "vite-node")


def have_js() -> bool:
    """Whether the loader is installed. `npm install` puts it there."""
    return Path(JS_RUNNER).exists()

REFERENCE = ROOT / "tests" / "reference"
LOCK = REFERENCE / "obf.lock.json"
MODULE = ROOT / "src" / "data" / "obf.ts"
DRIVER = ROOT / "tests" / "obf_node.mjs"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def difference(want, got, path: str = "") -> str | None:
    """Where two answers stop agreeing, as one line naming the field.

    The same function tests/test_obf_js.py has, written out again rather than
    imported: that file imports obf, and the whole point of this one is that
    it runs when there is no obf to import.
    """
    where = path or "the answer"
    if isinstance(want, dict) and isinstance(got, dict):
        for key in sorted(set(want) | set(got)):
            if key not in want:
                return f"{where}: JavaScript adds {key!r}"
            if key not in got:
                return f"{where}: JavaScript is missing {key!r}"
            found = difference(want[key], got[key], f"{path}.{key}" if path else key)
            if found:
                return found
        return None
    if isinstance(want, list) and isinstance(got, list):
        if len(want) != len(got):
            return f"{where}: {len(want)} entries frozen, {len(got)} in JavaScript"
        for index, (one, two) in enumerate(zip(want, got)):
            found = difference(one, two, f"{path}[{index}]")
            if found:
                return found
        return None
    if want != got:
        return f"{where}: {want!r} frozen, {got!r} in JavaScript"
    return None


def ask_node(jobs: dict) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                     encoding="utf-8") as handle:
        json.dump(jobs, handle)
        payload = handle.name
    try:
        result = subprocess.run([JS_RUNNER, str(DRIVER), payload],
                                capture_output=True, text=True)
    finally:
        Path(payload).unlink(missing_ok=True)
    if result.returncode != 0:
        raise SystemExit("src/data/obf.ts does not run:\n" + result.stderr)
    # A zero exit with nothing on stdout used to reach json.loads and come back
    # as "Expecting value: line 1 column 1", which says nothing about what
    # happened. Whatever the loader put on stderr is the actual explanation.
    if not result.stdout.strip():
        raise SystemExit(
            "the harness exited cleanly and printed nothing.\n" + result.stderr)
    return json.loads(result.stdout)


def compare(name: str, want: dict, answer: dict) -> None:
    """One frozen answer against one from the JavaScript.

    Both are {"value": ...} or {"error": "..."}, so a case obf.py refused is
    compared as a refusal and its sentence, not merely as "something went
    wrong". A converter that throws where the oracle answered is as broken as
    one that answers differently.
    """
    if "error" in want and "error" in answer:
        same = want["error"] == answer["error"]
        check(name, same, "" if same else
              f"frozen {want['error']!r}, JavaScript says {answer['error']!r}")
        return
    if "error" in want:
        check(name, False,
              f"obf.py refused it ({want['error']}), JavaScript did not")
        return
    if "error" in answer:
        check(name, False, f"JavaScript refused it: {answer['error']}")
        return
    found = difference(want["value"], answer["value"])
    check(name, found is None, found or "")


def check_the_module_still_says_the_format(lock: dict) -> None:
    """The one constant a document is stamped with.

    Read out of the text rather than out of node, and against the lock rather
    than against obf.py, so that it keeps working when there is no obf.py. A
    format string that moved would make every frozen document wrong in a way
    the field comparison would report as forty failures.
    """
    found = re.search(r'^export const FORMAT = "([^"]+)";',
                      MODULE.read_text(encoding="utf-8"), re.M)
    check("src/data/obf.ts declares FORMAT", found is not None)
    if found:
        agrees = found.group(1) == lock["format"]
        check("and it is the format the answers were frozen under", agrees,
              "" if agrees else f"js {found.group(1)} vs frozen {lock['format']}")


def check_the_fixtures_are_intact(lock: dict) -> None:
    """The frozen answers are about these files and no others."""
    bad = []
    for entry in lock["containers"]:
        path = REFERENCE / entry["file"]
        if not path.is_file():
            bad.append(entry["file"] + " (gone)")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            bad.append(entry["file"])
    check("every frozen file is the one that was read", not bad,
          "" if not bad else
          f"changed: {', '.join(bad)} - restore them from git rather than "
          f"editing. tools/obffreeze.py cannot rewrite them: it is still in "
          f"tools/, but what it imports went with the Python half - "
          f"docs/frozen-references.md, under The board as a document")


def check_the_written_zips(lock: dict, answers: list) -> None:
    """What the browser packs, against what write_obz() packed.

    Byte-identical zips are not available: two deflate implementations agree
    about the format and not about the output. So the file is opened with
    Python's own zipfile - which is not going anywhere - and what is inside it
    is compared, along with the fixed timestamp and mode that make the same
    document the same file twice.
    """
    for entry, answer in zip(lock["zips"], answers):
        name = entry["name"]
        if "error" in answer:
            check(f"{name}: the zip was written", False,
                  f"JavaScript refused it: {answer['error']}")
            continue
        path = REFERENCE / "written.obz.tmp"
        path.write_bytes(base64.b64decode(answer["value"]))
        try:
            with zipfile.ZipFile(path) as bundle:
                got = [{"name": info.filename,
                        "text": bundle.read(info.filename).decode("utf-8"),
                        "date_time": list(info.date_time),
                        "external_attr": info.external_attr,
                        "compress_type": info.compress_type}
                       for info in bundle.infolist()]
        except (zipfile.BadZipFile, UnicodeDecodeError) as exc:
            check(f"{name}: the zip opens and holds text", False, str(exc))
            path.unlink()
            continue
        path.unlink()
        names = [one["name"] for one in got]
        wanted = [one["name"] for one in entry["members"]]
        if names != wanted:
            check(f"{name}: the same members in the same order", False,
                  f"{wanted} vs {names}")
            continue
        found = difference(entry["members"], got)
        check(f"{name}: {len(wanted)} member(s), byte for byte and stamp for "
              f"stamp", found is None, found or "")


def main() -> int:
    if not LOCK.is_file():
        print(f"  {LOCK} is missing - restore it from git. It is frozen "
              f"obf.py output, and tools/obffreeze.py cannot write it again: "
              f"the tool is still in tools/, but what it imports went with "
              f"the Python half. There is nothing to compare against "
              f"without it.")
        return 1
    if not MODULE.is_file():
        print(f"  {MODULE} is missing")
        return 1
    lock = json.loads(LOCK.read_text(encoding="utf-8"))

    check_the_module_still_says_the_format(lock)
    check_the_fixtures_are_intact(lock)

    if not have_js():
        print("  skipped: node is not installed, so src/data/obf.ts was not run. "
              "Only the format and the fixtures were checked.")
        return 1 if failures else 0

    answers = ask_node({
        "helpers": [{"call": one["call"], "args": one["args"]}
                    for one in lock["helpers"]],
        "exports": [one["layout"] for one in lock["exports"]],
        "imports": [one["document"] for one in lock["imports"]],
        "licensing": [one["document"] for one in lock["licensing"]],
        "obz": [one["layout"] for one in lock["zips"]],
        "unobz": [{"name": Path(one["file"]).name,
                   "base64": base64.b64encode(
                       (REFERENCE / one["file"]).read_bytes()).decode("ascii")}
                  for one in lock["containers"]],
    })

    print("\n--- the helpers, on the arguments that bite --------------------")
    for one, answer in zip(lock["helpers"], answers["helpers"]):
        name = f"{one['call']}({', '.join(repr(a) for a in one['args'])})"
        compare(name[:87] + "...)" if len(name) > 90 else name, one, answer)

    print("\n--- a layout becomes the frozen document -----------------------")
    for one, answer in zip(lock["exports"], answers["exports"]):
        compare(one["name"], {"value": one["document"]}, answer)

    print("\n--- and a document the frozen layout ---------------------------")
    for one, answer in zip(lock["imports"], answers["imports"]):
        compare(one["name"], one, answer)

    print("\n--- METACOM cannot be handed over as pixels --------------------")
    for one, answer in zip(lock["licensing"], answers["licensing"]):
        compare(one["name"], one, answer)

    print("\n--- the zip the browser writes ---------------------------------")
    check_the_written_zips(lock, answers["obz"])

    print("\n--- and the files Python packed --------------------------------")
    for one, answer in zip(lock["containers"], answers["unobz"]):
        name = one["name"]
        if "error" in one:
            if one["wording"]:
                compare(name, one, answer)
            else:
                # Both refuse; the reason inside the message is zipfile's on
                # one side and the browser's on the other, and holding one
                # library's wording against the other's would be a test about
                # error strings rather than about a document.
                check(f"{name}: refused, as it was when frozen",
                      "error" in answer,
                      answer.get("error", "JavaScript read it anyway"))
            continue
        if "error" in answer:
            check(name, False, f"JavaScript refused it: {answer['error']}")
            continue
        got = answer["value"]
        found = difference(one["document"],
                           {k: v for k, v in got.items() if k != "layout"})
        check(f"{name}: the same document", found is None, found or "")
        found = difference(one["layout"], got["layout"])
        check(f"{name}: and the same layout", found is None, found or "")

    # The whole way round, through the real container: the browser's own zip,
    # read by the browser. Circular on its own, and not circular after the
    # comparison above - those members are known to be the ones Python packed.
    print("\n--- the browser's own file, back through its own reader --------")
    written = [{"name": f"{one['name']}.obz", "base64": answer["value"]}
               for one, answer in zip(lock["zips"], answers["obz"])
               if "error" not in answer]
    if written:
        for one, answer in zip(lock["zips"],
                               ask_node({"unobz": written})["unobz"]):
            # A layout with no sets is a document with no board in it, and
            # that is a file neither implementation will read back - obf.py
            # refuses the one it wrote itself. So the empty case is held to
            # refusing rather than to answering.
            if not one["layout"]["sets"]:
                check(f"{one['name']}: has no board in it, and says so",
                      "error" in answer,
                      answer.get("error", "JavaScript read it anyway"))
                continue
            if "error" in answer:
                check(one["name"], False, f"refused its own file: {answer['error']}")
                continue
            found = difference(one["layout"], answer["value"]["layout"])
            check(f"{one['name']}: comes back as the layout that went in",
                  found is None, found or "")

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures[:6])}"
              + (" ..." if len(failures) > 6 else ""))
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
