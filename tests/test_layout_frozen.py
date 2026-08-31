#!/usr/bin/env python3
"""Checks the browser's layout.bin writer against frozen bytes and the firmware.

One of a pair with tests/test_layout_format.py, and the difference was what
each needed installed:

  test_layout_format.py   wrote every case with layout_format.py as well,
                          and compared all three. The most thorough check
                          there was, and it went with the Python half,
                          2026-08-22.
  this one                needs the lock file, node and a C compiler - which
                          is why it is the one still here. No layout.py, no
                          layout_format.py, no tiles.py.

That distinction is the whole reason this file exists. The C reader really is
independent of Python - it is firmware/vorlaut/layout_format.h, the header
vorlaut.ino includes, calling the parseLayout the device calls - so the
instinct is that the layout check survives on its own. It does not. The reader
survives; what it was compared against did not. normalize_layout() built the
inputs, expected() built the fields, and render_layout_bin() was the only
opinion on whether the JavaScript bytes were right.

So tools/layoutfreeze.py wrote all three down while they were still here to
ask. The tool imported what it froze, so it went with the Python half and only
git history has it now; the lock is what remains, and nothing in the
repository can write it again. If the format ever changes on purpose,
refreezing means restoring layout.py, layout_format.py and the tool from git
for as long as that takes, not editing the lock by hand
(docs/frozen-references.md, "The layout binary"). What is left to ask is the
question that matters afterwards: does the browser still write the bytes the
firmware reads, and does the firmware still read them into the same fields?

Two independent things have to agree for this to pass, which is what keeps it
from being a mirror. The bytes are checked against a value frozen from the
Python writer - that is a captured answer, and on its own it would only say
that the browser has not changed. The C reader then parses those same bytes
and its output is checked field by field. That half is not captured from
anything the browser did: it is compiled from the firmware's source on the
machine running the test, and it is the reason a frozen byte string means
something rather than merely being self-consistent.

One case is set aside rather than compared - see THE_FILTER_IS_GONE. Every
remaining case is then put through two transformations before it is compared:
two bytes per set come out (THE_COLOUR_IS_GONE) and twenty-eight go back in
(THE_KEYS_ARE_FIVE). The lock is not touched and is not refrozen in any of the
three cases; what changes is what gets compared.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# --- what the lock can no longer answer for ----------------------------------

THE_FILTER_IS_GONE = """the active/inactive distinction.

render_layout_bin() used to write the *active* sets, and a set carried an
`active` flag saying whether it was one. Sammlungen replaced that: a Sammlung
is the selection, it ships all its sets, and the flag was deleted rather than
migrated. So the writer writes every set the layout holds.

One frozen case is about the filter and nothing else - a three-set layout with
the middle one switched off, frozen as the 384 bytes of the two that survived
it. Its right answer now is three sets, and this file cannot say what those
bytes are: `label`, `images` and `sounds` were frozen per *active* set, so the
middle set has no tile and no sound names in the fixture to write with. That is
the lock's own limit, stated at the top of docs/frozen-references.md - a fixture
answers for what was recorded, and nobody recorded this.

It is an anticipated loss rather than a surprise: the lock's invalidated_by
names "a change to render_layout_bin() in layout_format.py", and removing the
filter is one. It cannot be won back - layout_format.py and
tools/layoutfreeze.py went with the Python half, so there is nothing left to
re-freeze from, and re-deriving the bytes from loader/src/layout_format.ts would
be the browser compared against itself.

The other sixteen cases are untouched and keep their full value: the bytes, the
C reader's fields, the strides and the pre-language file are all still held to
what layout_format.py said."""


THE_COLOUR_IS_GONE = """the two bytes a set entry opened with.

A set carried a colour and the firmware drew it as a border round all five
displays. That is gone - the editor has no swatches, layout.bin has no colour
and drawTile() blacks those six pixels out instead. So the set entry is 184
bytes where it was 186, and the version byte is 2 where it was 1, and every
frozen case in this lock is bytes that no writer here will ever produce again.

**The lock is not refrozen, because there is nothing left to freeze from.** The
lock's own invalidated_by names "a change to the structure in
firmware/vorlaut/layout_format.h" and "a change to render_layout_bin() in
layout_format.py", so this is an anticipated invalidation rather than a cheat -
but anticipated is not the same as answerable. layout_format.py,
tools/layoutfreeze.py and normalize_layout() went with the Python half on
2026-08-22, and docs/frozen-references.md is explicit that re-deriving the
bytes from loader/src/layout_format.ts would leave the browser compared against
itself, which is the one thing these files exist to stop.

**What is done instead is a deletion, not a guess.** Nothing new has to be
known: every byte of the new answer is already in the lock, and the new answer
is the old one with two bytes struck out of each set entry and the version byte
raised. That transformation is written below, in one function, by hand - so the
reference still says what Python said about the name, the label, the four
slots, the hashes, the language and the sleep timeout. Only the colour is
dropped, and it is dropped from a stated offset.

It is worth being clear about how much independence survives that. If the two
bytes were struck from the wrong place here *and* in layout_format.h and
layout_format.ts in the same way, all three would agree and this file would
pass. What makes that unlikely rather than merely hoped for is the C reader:
it is compiled from the header the device includes, and everything after the
colour shifts if the offset is wrong - the name would come back as two bytes of
a hash, and the label and all sixteen slot hashes with it. The frozen fields
still hold every one of those to what Python said. A wrong offset is a
comparison that fails loudly, not one that passes quietly.

Two cases keep their names and lose their subject: "five sets, long names,
extreme colours" and "colours that still need normalizing" were frozen for what
the writer made of a colour, and there is no colour to make anything of. They
are not set aside, because neither is *wrong* - what they still exercise is
five sets, names at and past the 32-byte cut, and a file the firmware has to
take. The names are the lock's and the lock is not edited, so they stay as they
are and this paragraph is the correction.

What is lost outright is the older file. `older_file` was a layout.bin from
before the language byte, frozen to show that byte 7 being reserved-and-zero
kept it readable. Version 2 ends that on purpose - see the note on
LAYOUT_VERSION in the header - so what it is held to now is the opposite and
the check is written that way below: it must be refused, and refused for the
version rather than for its length."""

THE_KEYS_ARE_FIVE = """the twenty-eight bytes a set entry gained.

Version 3, on 2026-08-31. A set held a name, a label hash and four slots of 34
bytes; it holds a name and five KEYS of 36 now. Every key carries what it does
- speak, speak and go, or go - and which set it goes to, and the set key is a
key like the other four rather than a picture with nothing behind it. adr/0020
is the decision and docs/format-freeze.md is where it was priced.

**The lock is not refrozen**, for the reason THE_COLOUR_IS_GONE gives at
length: there is nothing left to freeze from. What is done instead is the same
thing done there and it is worth being exact about the difference, because it
runs the other way.

The colour was a DELETION from a stated offset: every byte of the new answer
was already in the lock. This is an INSERTION, and an insertion cannot be
derived from the lock alone - somebody has to say what goes in the gap. So
what is inserted is stated here, in one place, and every one of the inserted
bytes is either a zero or a number the set count decides:

    the set key      the label hash, which the lock holds; sixteen zero bytes
                     where a sound would be, because no set key had one; the
                     has-audio flag as 0; LAYOUT_KEY_GO; and the next set,
                     round to the first from the last.
    each speech key  its 34 bytes unchanged, and two more: LAYOUT_KEY_SPEAK,
                     which is zero, and a target of zero.

That is not a guess about what the writer does. It is the statement that
version 3 wrote down what version 2 did in arithmetic: `(current + 1) %
setCount` in vorlaut.ino is where the ring lived, and a speech key spoke
because there was nothing else it could do. If the writer ever stops agreeing
with that, this file goes red - which is the point.

**What is lost, and it is worth naming.** The lock cannot say anything about
the bytes it never held. Nine of the inserted bytes per set are the new
fields, and their only independent check is elsewhere: device/fixtures/layout/
holds keys-that-go, key-does-past-the-table and key-goes-past-the-last-set,
authored from the strides rather than captured from either end, and the two
runners meet them from opposite sides. What this file still holds to the
Python is every byte that was already there - the name, the label, the four
slots, sixteen hashes, the language and the sleep timeout - and that the
firmware's own reader, compiled here, finds all of them in the same places
after the entry grew by 28 bytes. A wrong offset moves every one of them."""

# The colour sat at the front of a set entry, two bytes, little-endian.
COLOUR_BYTES = 2

# What version 3 inserted. Stated here rather than imported: this file is one
# of the two ends, and reading the strides out of the module under test is the
# thing docs/frozen-references.md is about.
NAME_BYTES = 32
HASH_BYTES = 16
SLOTS_PER_SET = 4
V2_SLOT_BYTES = 34
V3_KEY_BYTES = 36
V3_SET_BYTES = NAME_BYTES + (SLOTS_PER_SET + 1) * V3_KEY_BYTES   # 212
LAYOUT_KEY_SPEAK = 0
LAYOUT_KEY_GO = 2


def without_the_colour(frozen: bytes, header_bytes: int, set_bytes: int) -> bytes:
    """The frozen bytes as the writer produces them now - THE_COLOUR_IS_GONE.

    The header keeps its length and gains a version, and each set entry loses
    the two bytes it opened with. Driven by the set count in the header rather
    than by the case's own fields, so a case whose name is not text still goes
    through it.
    """
    sets = frozen[5]
    assert len(frozen) == header_bytes + sets * set_bytes, frozen[:8].hex()
    out = bytearray(frozen[:header_bytes])
    out[4] = 2
    for i in range(sets):
        at = header_bytes + i * set_bytes
        out += frozen[at + COLOUR_BYTES:at + set_bytes]
    return bytes(out)


def fields_without_the_colour(fields: list[str]) -> list[str]:
    """The C reader's frozen output, without the field it no longer prints."""
    return [re.sub(r"^(set \d+) color [0-9a-f]{4} ", r"\1 ", line)
            for line in fields]


def with_the_five_keys(frozen: bytes, header_bytes: int,
                       set_bytes: int) -> bytes:
    """The version-2 bytes as the writer produces them now - THE_KEYS_ARE_FIVE.

    Takes what without_the_colour() answered, so `set_bytes` is 184. The header
    keeps its length and gains a version; each set entry keeps its name and
    every hash exactly where it had them, and grows by 28 bytes: the label
    becomes a whole key, and each of the four slots gains the two fields that
    say what it does and where it goes.
    """
    sets = frozen[5]
    assert len(frozen) == header_bytes + sets * set_bytes, frozen[:8].hex()
    out = bytearray(frozen[:header_bytes])
    out[4] = 3
    for i in range(sets):
        at = header_bytes + i * set_bytes
        entry = frozen[at:at + set_bytes]
        out += entry[:NAME_BYTES]
        # The set key: the label hash it always had, no sound because no set
        # key could have one, and the ring vorlaut.ino used to do in
        # arithmetic - on to the next set, round to the first from the last.
        out += entry[NAME_BYTES:NAME_BYTES + HASH_BYTES]
        out += bytes(HASH_BYTES)
        out += bytes([0, LAYOUT_KEY_GO, (i + 1) % sets, 0])
        slots = entry[NAME_BYTES + HASH_BYTES:]
        for j in range(SLOTS_PER_SET):
            # The 34 bytes as they stand - image, audio, has-audio and the
            # spare byte - then the two that are new. A speech key that says
            # nothing about what it does speaks, which is zero, and goes to a
            # set it will never be asked about, which is zero too.
            out += slots[j * V2_SLOT_BYTES:(j + 1) * V2_SLOT_BYTES]
            out += bytes([LAYOUT_KEY_SPEAK, 0])
    assert len(out) == header_bytes + sets * V3_SET_BYTES
    return bytes(out)


def fields_with_the_five_keys(fields: list[str], sets: int) -> list[str]:
    """The C reader's frozen output as the reader prints it now.

    The set line loses its label to a key line of its own, and every slot line
    becomes a key line with the two new fields and the two answers they mean.
    Both halves of both, which is what layout_dump.cpp prints - a reader that
    repaired an unknown value would give the right meaning and the wrong field.
    """
    out: list[str] = []
    for line in fields:
        head = re.fullmatch(r"set (\d+) name (.*) label ([0-9a-f]{32})", line)
        if head:
            at, name, label = int(head[1]), head[2], head[3]
            goes = (at + 1) % sets
            out.append(f"set {at} name {name}")
            out.append(f"key {at} set image {label} audio {'00' * HASH_BYTES} "
                       f"has 0 does {LAYOUT_KEY_GO} target {goes} speaks 0 "
                       f"to {goes}")
            continue
        slot = re.fullmatch(
            r"slot (\d+) (\d+) image ([0-9a-f]{32}) audio ([0-9a-f]{32}) "
            r"has ([01])", line)
        if slot:
            out.append(f"key {slot[1]} {slot[2]} image {slot[3]} "
                       f"audio {slot[4]} has {slot[5]} "
                       f"does {LAYOUT_KEY_SPEAK} target 0 speaks 1 to -1")
            continue
        out.append(line)
    return out


def about_the_filter(case: dict) -> bool:
    """Whether a frozen case exists to exercise the switched-off set.

    By what the case holds rather than by its name: a layout with a set the
    writer was meant to leave out is exactly the case that has no answer now,
    and there is precisely one. Anything else in the lock still gets compared.
    """
    return any(entry.get("active") is False
               for entry in case["layout"].get("sets", []))

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

LOCK = ROOT / "tests" / "reference" / "layout.lock.json"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def build_reader(target: Path) -> bool:
    """The firmware's own reader, compiled here.

    Not frozen and deliberately not: a frozen binary would only say that the
    bytes have not changed. Compiling the header the device includes is what
    makes this an outside opinion, and it is also the only thing that would
    notice the structure being changed underneath a fleet that is already
    reading it.
    """
    compiler = shutil.which("g++") or shutil.which("clang++")
    if not compiler:
        return False
    result = subprocess.run(
        [compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(ROOT / "tests" / "layout_dump.cpp")],
        capture_output=True, text=True)
    if result.returncode != 0:
        check("the firmware's reader compiles", False, result.stderr.strip()[:400])
        return False
    check("the firmware's reader compiles", True)
    return True


def read_back(reader: Path, tmp: Path, name: str, data: bytes) -> list[str] | str:
    """What the firmware's reader makes of these bytes.

    Decoded leniently, because one of the frozen cases cuts a name in the
    middle of a character on purpose. The device draws those 32 bytes as they
    are, so the reader here takes them rather than falling over them.
    """
    path = tmp / name
    path.write_bytes(data)
    result = subprocess.run([str(reader), str(path)], capture_output=True)
    output = result.stdout.decode("utf-8", "replace")
    if result.returncode != 0:
        return f"the C reader reports {output.strip()}"
    return [l for l in output.strip().split("\n") if not l.startswith("bytes")]


def render_with_node(cases: list[dict]) -> list[bytes | str] | None:
    """Every frozen layout, written by loader/src/layout_format.ts.

    All of them in one run: starting node costs more than writing every case.
    A case the writer refused comes back as its message instead of as bytes,
    so one bad case reads as one failure rather than as a missing line for
    every case after it.
    """
    node = JS_RUNNER
    if not node:
        return None
    payload = [{"layout": c["layout"], "label": c["label"],
                "images": c["images"], "sounds": c["sounds"]} for c in cases]
    result = subprocess.run([node, str(ROOT / "tests" / "layout_node.mjs")],
                            input=json.dumps(payload), capture_output=True,
                            text=True)
    if result.returncode != 0:
        check("the JavaScript writer runs", False, result.stderr.strip()[:400])
        return []
    check("the JavaScript writer runs", True)
    lines = result.stdout.strip().split("\n")
    if len(lines) != len(cases):
        check("it answers once per case", False,
              f"{len(lines)} lines for {len(cases)} cases")
        return []
    return [line if line.startswith("error ") else bytes.fromhex(line)
            for line in lines]


def difference(frozen: bytes, js: bytes | str) -> str | None:
    """What is wrong with what JavaScript wrote, or None if nothing is."""
    if isinstance(js, str):
        return f"the writer refused it - {js[6:]}"
    if js == frozen:
        return None
    if len(js) != len(frozen):
        return f"{len(js)} bytes instead of {len(frozen)}"
    for i, (a, b) in enumerate(zip(frozen, js)):
        if a != b:
            return (f"first difference at byte {i}: frozen {a:02x}, "
                    f"JavaScript {b:02x}")
    return None


def main() -> int:
    if not LOCK.is_file():
        print(f"  {LOCK} is missing - restore it from git. It is frozen "
              f"layout_format.py output, the tool that wrote it went with "
              f"the Python half, and there is nothing to compare against "
              f"without it.")
        return 1
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    cases = lock["cases"]

    # The frozen bytes are the reference, so they have to be the bytes that
    # were measured. A hex string is easy to hand-edit into agreement with
    # whatever is failing, which is exactly the move this file exists to catch.
    tampered = [c["name"] for c in cases
                if hashlib.sha256(bytes.fromhex(c["bytes"])).hexdigest() != c["sha256"]]
    check("every frozen case still hashes to what was frozen", not tampered,
          "" if not tampered else
          f"changed: {', '.join(tampered)} - restore the lock from git "
          f"rather than editing. Refreezing means restoring layout.py, "
          f"layout_format.py and tools/layoutfreeze.py from git for as "
          f"long as that takes - docs/frozen-references.md, under The "
          f"layout binary")

    # THE_FILTER_IS_GONE, and set aside only after the hash check above, so
    # that hand-editing this case into agreement is still caught rather than
    # skipped along with it.
    for name in [c["name"] for c in cases if about_the_filter(c)]:
        print(f"  --    {name}: set aside, its subject no longer exists "
              f"(THE_FILTER_IS_GONE)")
    cases = [c for c in cases if not about_the_filter(c)]

    # THE_COLOUR_IS_GONE, and after the hash check above for the same reason:
    # what is derived here is derived from bytes that have been shown to be
    # the ones that were frozen.
    print(f"  --    every case: two bytes per set struck out, the colour "
          f"having gone (THE_COLOUR_IS_GONE)")
    print(f"  --    every case: twenty-eight bytes per set put back and the "
          f"version raised, the set key having become a key "
          f"(THE_KEYS_ARE_FIVE)")
    v2_set_bytes = lock["set_bytes"] - COLOUR_BYTES
    set_bytes = V3_SET_BYTES

    from_js = render_with_node(cases)
    if from_js is None:
        print("  skipped: node is not installed, so the browser writer was "
              "not run. That is the half this file is about, so nothing "
              "below means much without it.")
        from_js = []

    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        reader = tmp / "layout_dump"
        have_reader = build_reader(reader)
        if not have_reader:
            print("  skipped: no C++ compiler, so the firmware's reader was "
                  "not built. The frozen bytes were still checked, but "
                  "nothing independent confirmed what they mean.")

        for index, case in enumerate(cases):
            frozen = with_the_five_keys(
                without_the_colour(bytes.fromhex(case["bytes"]),
                                   lock["header_bytes"], lock["set_bytes"]),
                lock["header_bytes"], v2_set_bytes)

            if from_js:
                problem = difference(frozen, from_js[index])
                check(f"{case['name']}: JavaScript writes the frozen "
                      f"{len(frozen)} bytes", problem is None, problem or "")

            if not have_reader:
                continue

            # The firmware on the bytes JavaScript just wrote, not on the
            # frozen copy of them: if the two differ the line above has
            # already said so, and reading the frozen bytes instead would
            # quietly make this check about nothing.
            subject = from_js[index] if from_js and isinstance(from_js[index], bytes) \
                else frozen
            got = read_back(reader, tmp, "case.bin", subject)
            if isinstance(got, str):
                check(f"{case['name']}: the firmware accepts them", False, got)
                continue
            if case["kind"] == "fields":
                want = fields_with_the_five_keys(
                    fields_without_the_colour(case["fields"]),
                    len(case["label"]))
                check(f"{case['name']}: and reads them into the same "
                      f"{len(want)} fields",
                      got == want,
                      "" if got == want else
                      "\n".join(f"      frozen: {a}\n      reader: {b}"
                                for a, b in zip(want, got) if a != b))
            else:
                # A name cut mid-character is not text any more, so there is
                # nothing to compare field by field. What has to hold is that
                # the firmware takes the file at all - a length or a set count
                # that did not add up would be refused here.
                check(f"{case['name']}: the firmware takes them", True,
                      f"{len(subject)} bytes")

        if have_reader:
            # THE_COLOUR_IS_GONE, last paragraph: this file used to be readable
            # and is now refused, which is what the version byte is for. Held
            # to the reason as well as to the refusal - LAYOUT_BAD_VERSION is
            # third in the enum, and a file rejected for its length instead
            # would mean the version check had stopped running.
            older = lock["older_file"]
            got = read_back(reader, tmp, "old.bin", bytes.fromhex(older["bytes"]))
            want = "the C reader reports ERROR 3"
            check("a layout.bin from before the colour went is refused for "
                  "its version, not misread",
                  got == want, "" if got == want else str(got))

        # The structure is a sum, and the sum is the thing that has to keep
        # agreeing. Checked against the frozen strides rather than against
        # layout_format.py, so it still means something without one.
        for case in cases:
            if case["kind"] != "fields":
                continue
            sets = len(case["label"])
            want = lock["header_bytes"] + sets * set_bytes
            grew = V3_SET_BYTES - lock["set_bytes"] + COLOUR_BYTES
            got_length = case["length"] - sets * COLOUR_BYTES + sets * grew
            if got_length != want:
                check(f"{case['name']}: {sets} sets is {want} bytes", False,
                      f"frozen at {case['length']}, {got_length} once the "
                      f"colour is out and the keys are in")
        check(f"every frozen length is {lock['header_bytes']} + sets * "
              f"{set_bytes} once the colour is out and the keys are in", True)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
