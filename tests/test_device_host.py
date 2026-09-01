#!/usr/bin/env python3
"""Runs device/fixtures/ against the firmware's own readers, compiled here.

The other half of tests/unit/device_fixtures.test.ts, and the two never meet.
Each end is held against the fixture and never against the other end, which is
what a fixture set is for: the browser's writer and the device's reader can be
in two repositories, or in two hands, and still be held to one thing.

What this compiles is tests/device_host.cpp, and every reader in it is the one
the device runs - parseLayout out of layout_format.h, seekToWavData out of
wav_format.h, tileReadRow out of tile_format.h, hashPath out of name_format.h,
cableNameOk and cableParse out of cable_format.h, setLanguage out of texts.h.
Nothing is reimplemented; this file only compares.

This does NOT replace tests/test_layout_frozen.py or tests/test_cable_format.py.
Those hold the two implementations against EACH OTHER, live, on the same run -
the browser's bytes go straight into the compiled C - and that is a stronger
statement than either can make against a fixture. docs/device-interface.md
section 5 is about what would be left if the two ever stopped sharing a
repository; they have not, so this is a third check beside them rather than a
replacement for either.

Needs g++ or clang++, and nothing else. No node: that is the point of the
split.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "device" / "fixtures"

failures: list[str] = []
counts: dict[str, int] = {}
# Every walk that ran, so that the set of them can be asked at the end whether
# it says anything. See the check under main().
walked: list[tuple[str, list[dict]]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def counted(kind: str) -> None:
    counts[kind] = counts.get(kind, 0) + 1


def build(target: Path) -> bool:
    """The firmware's readers, compiled here.

    Not frozen and deliberately not: a frozen binary would only say that the
    bytes have not changed. Compiling the headers the device includes is what
    makes this an outside opinion of the fixtures.
    """
    compiler = shutil.which("g++") or shutil.which("clang++")
    if not compiler:
        print("  skipped: no C++ compiler, so the firmware's readers were not "
              "built. Nothing below ran.")
        return False
    result = subprocess.run(
        [compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(ROOT / "tests" / "device_host.cpp")],
        capture_output=True, text=True)
    if result.returncode != 0:
        check("the firmware's readers compile", False,
              result.stderr.strip()[:600])
        return False
    check("the firmware's readers compile", True)
    return True


def run(reader: Path, args: list[str], stdin: bytes = b"") -> str:
    result = subprocess.run([str(reader), *args], input=stdin,
                            capture_output=True)
    if result.returncode != 0:
        raise SystemExit(f"device_host {' '.join(args)} fell over:\n"
                         + result.stderr.decode()[:2000])
    return result.stdout.decode("utf-8", "replace")


def fields(output: str) -> dict[str, str]:
    """The single-value lines, as a mapping. Repeated keys are the caller's
    business and are read off the lines instead."""
    out: dict[str, str] = {}
    for line in output.strip().split("\n"):
        key, _, value = line.partition(" ")
        if key and key not in out:
            out[key] = value
    return out


# --- layout.bin --------------------------------------------------------------

def key_line(at: str, one: dict) -> str:
    """One key as the firmware's reader prints it.

    Six things, and the last two are the first two read: `does` and `target`
    are the bytes the file holds, `speaks` and `to` are what they mean. Both
    halves for the reason sleep_seconds and idle_seconds are both halves - a
    reader that quietly repaired a value it did not know would give the right
    meaning and the wrong field, and a fixture holding only the meaning could
    not tell anybody.
    """
    return (f"key {at} image {one['image']} audio {one['audio']} "
            f"has {1 if one['has_audio'] else 0} does {one['does']} "
            f"target {one['target']} speaks {1 if one['speaks'] else 0} "
            f"to {one['goes_to']}")


def check_layout(reader: Path, name: str, path: Path, want: dict) -> None:
    got = run(reader, ["layout", str(path)])
    lines = got.strip().split("\n")
    said = fields(got)

    if want["result"] != "ok":
        # Held to the reason as well as to the refusal. A file refused for its
        # length where the version was meant would mean the version check had
        # stopped running, and the suite would stay green.
        check(f"{name}: refused as {want['result']}",
              said.get("result") == want["result"], said.get("result", got))
        counted("layout")
        return

    check(f"{name}: the firmware accepts it",
          said.get("result") == "ok", said.get("result", got))
    if said.get("result") != "ok":
        counted("layout")
        return

    for key, value in (("sets", want["sets"]), ("language", want["language"]),
                       ("sleep", want["sleep_seconds"]),
                       # The field, and the length of time it means. Both, and
                       # separately, because that pair is the whole of L1: a
                       # reader that clamped inside parseLayout would give the
                       # right idle_seconds and the wrong sleep_seconds, and
                       # layout.lock.json cannot say so - the two cases holding
                       # the values that move are kind "bytes", whose reader
                       # lines it records and never compares. This is the check
                       # that catches it.
                       ("idle_seconds", want["idle_seconds"])):
        check(f"{name}: {key} is {value}",
              said.get(key) == str(value), said.get(key, "-"))

    wanted: list[str] = []
    for i, entry in enumerate(want["entries"]):
        wanted.append(f"set {i} name {entry['name']}")
        wanted.append(key_line(f"{i} set", entry["key"]))
        for j, one in enumerate(entry["slots"]):
            wanted.append(key_line(f"{i} {j}", one))
    body = [l for l in lines if l.startswith(("set ", "key "))]
    check(f"{name}: and reads it into the same {len(wanted)} fields",
          body == wanted,
          "" if body == wanted else
          "\n".join(f"      fixture: {a}\n      firmware: {b}"
                    for a, b in zip(wanted, body) if a != b)
          or f"{len(body)} lines for {len(wanted)}")
    counted("layout")


# --- A layout, pressed -------------------------------------------------------

def check_walk(reader: Path, name: str, path: Path, want: dict) -> None:
    """The joining game played into the firmware's own reader.

    The fixture's presses go in as key indices and what comes back is one line
    per press: which set it was made on, whether a recording was really played
    and which one, where the key led, and which set the device is on
    afterwards. Compared as a block for the same reason the layout fields are -
    a walk that agreed on eight lines out of ten and diverged on the ninth is a
    device that goes somewhere plausible, and the first line that differs is
    the one worth printing.

    The last two of those - where it led and where it ended up - are the whole
    of why this exists beside the key-by-key fields above. Those say what one
    key means; this says what a device does with several in a row, which is
    where being off by one, or reading the answer off the set the press started
    on, or quietly falling back to set 0 all stop being invisible.
    """
    presses = want["presses"]
    asked = "".join(f"{one['key']}\n" for one in presses).encode()
    got = run(reader, ["walk", str(path)], asked)
    said = fields(got)

    check(f"{name}: the walk starts on set {want['starts_at']}",
          said.get("starts_at") == str(want["starts_at"]),
          said.get("starts_at", "-"))

    wanted = [
        f"press {one['press']} set {one['on_set']} key {one['key']} "
        f"plays {one['plays'] or '-'} goes {one['goes_to']} "
        f"now {one['now_on_set']}"
        for one in presses
    ]
    body = [l for l in got.strip().split("\n") if l.startswith("press ")]
    same = body == wanted
    check(f"{name}: and the firmware answers all {len(wanted)} presses the "
          f"same way", same,
          "" if same else
          "\n".join(f"      fixture:  {a}\n      firmware: {b}"
                     for a, b in zip(wanted, body) if a != b)
          or f"{len(body)} lines for {len(wanted)}")
    counted("walk")
    walked.append((name, presses))


# --- What a press does -------------------------------------------------------

def check_press(reader: Path, want: dict) -> None:
    """The timings, and the order of the steps after a board change.

    No file and no layout, the same way the sleep timeout has none: this is a
    rule the device applies, and the fixture states it from the reasons rather
    than from the header.
    """
    got = run(reader, ["press"])
    said = fields(got)

    check(f"the set key is key {want['set_key_index']} of a set",
          said.get("set_key_index") == str(want["set_key_index"]),
          said.get("set_key_index", "-"))
    counted("press")

    holds = {}
    for line in got.strip().split("\n"):
        parts = line.split(" ")
        if parts[0] == "hold":
            holds[int(parts[1])] = int(parts[2])
    for one in want["holds"]:
        check(f"{one['what']} has to be held for {one['ms']} ms",
              holds.get(one["key"]) == one["ms"], str(holds.get(one["key"])))
        counted("press")

    after = want["after_a_key_that_goes"]
    check(f"a key that goes somewhere waits {after['pause_ms']} ms after the "
          f"word before anything moves",
          said.get("pause_ms") == str(after["pause_ms"]),
          said.get("pause_ms", "-"))
    check(f"and hears nothing for {after['deaf_ms']} ms once the board has "
          f"changed",
          said.get("deaf_ms") == str(after["deaf_ms"]),
          said.get("deaf_ms", "-"))
    counted("press")
    counted("press")

    # The order, which is the half that is not a number. It is an enumeration
    # in key_press.h that vorlaut.ino walks rather than four statements in a
    # row, which is what lets this be checked at all: a .ino is the one file no
    # test can include, and the order is exactly the thing that goes wrong in
    # it.
    order = [l.split(" ")[2] for l in got.strip().split("\n")
             if l.startswith("step ")]
    check("and it pauses, waits for her finger, shows the new board and only "
          "then listens again - in that order",
          order == after["order"], " then ".join(order) or "-")
    counted("press")


# --- t<hash>.bin -------------------------------------------------------------

def check_tile(reader: Path, name: str, path: Path, want: dict) -> None:
    probes = want["read"].get("probes", [])
    asked = "".join(f"{p['x']} {p['y']}\n" for p in probes).encode()
    got = run(reader, ["tile", str(path)], asked)
    said = fields(got)
    g = want["geometry"]

    check(f"{name}: the firmware's tile is {g['width']} square",
          said.get("width") == str(g["width"])
          and said.get("height") == str(g["height"]),
          f"{said.get('width')}x{said.get('height')}")
    check(f"{name}: which is {g['conforming_bytes']} bytes",
          said.get("conforming_bytes") == str(g["conforming_bytes"])
          and said.get("row_bytes") == str(g["row_bytes"]),
          said.get("conforming_bytes", "-"))

    r = want["read"]
    # Which form the firmware took it for, and whether it took it at all.
    # Both matter and they are two questions: a compressed file read as a raw
    # one draws a palette as though it were pixels, which is a full panel of
    # plausible noise rather than an error.
    check(f"{name}: the firmware {'accepts' if r['accepts'] else 'refuses'} it",
          said.get("accepts") == ("1" if r["accepts"] else "0"),
          said.get("accepts", "-"))
    if not r["accepts"]:
        counted("tile")
        return
    if "form" in want:
        check(f"{name}: as the {want['form']} form",
              said.get("form") == want["form"], said.get("form", "-"))
    if "palette" in want:
        check(f"{name}: with {want['palette']['colours']} colour(s) in the "
              f"palette",
              said.get("colours") == str(want["palette"]["colours"]),
              said.get("colours", "-"))
    for key in ("complete_rows", "partial_row", "bytes_in_partial_row",
                "blank_rows_from", "bytes_read"):
        if key in r:
            check(f"{name}: {key} is {r[key]}",
                  said.get(key) == str(r[key]), said.get(key, "-"))

    drawn = {}
    for line in got.strip().split("\n"):
        if line.startswith("pixel "):
            _, x, y, _, at, _, value = line.split(" ")
            drawn[(int(x), int(y))] = (int(at), value)
    for probe in probes:
        at, value = drawn.get((probe["x"], probe["y"]), (-1, "-"))
        check(f"{name}: pixel ({probe['x']}, {probe['y']}) is {probe['value']} "
              f"at byte {probe['byte']}",
              at == probe["byte"] and value == probe["value"],
              f"{value} at {at}")
    counted("tile")


# --- a<hash>.wav -------------------------------------------------------------

def check_audio(reader: Path, name: str, path: Path, want: dict) -> None:
    said = fields(run(reader, ["audio", str(path)]))
    r = want["read"]
    check(f"{name}: the firmware {'accepts' if r['accepts'] else 'refuses'} it",
          said.get("accepts") == ("1" if r["accepts"] else "0"),
          said.get("accepts", "-"))
    if not r["accepts"]:
        counted("audio")
        return

    if "data_offset" in r:
        check(f"{name}: the samples start at byte {r['data_offset']}",
              said.get("data_offset") == str(r["data_offset"]),
              said.get("data_offset", "-"))
    declared = r.get("data_bytes", r.get("data_bytes_declared"))
    check(f"{name}: and the data chunk says {declared} bytes",
          said.get("data_bytes") == str(declared), said.get("data_bytes", "-"))
    if "data_bytes_available" in r:
        check(f"{name}: with only {r['data_bytes_available']} really there",
              said.get("data_bytes_available") == str(r["data_bytes_available"]),
              said.get("data_bytes_available", "-"))

    if want.get("write"):
        w = want["write"]
        check(f"{name}: the firmware plays at {w['sample_rate']} Hz, "
              f"{w['channels']} channel, {w['bits_per_sample']}-bit",
              said.get("sample_rate") == str(w["sample_rate"])
              and said.get("channels") == str(w["channels"])
              and said.get("bits_per_sample") == str(w["bits_per_sample"]),
              f"{said.get('sample_rate')} Hz")
    counted("audio")


# --- The name rule -----------------------------------------------------------

def check_names(reader: Path, want: dict) -> None:
    cases = want["cases"]
    asked = "".join(f"name {one['name']}\n" for one in cases).encode()
    answers = [l.split(" ", 1)[1] for l in
               run(reader, ["names"], asked).strip().split("\n")]
    if len(answers) != len(cases):
        raise SystemExit(f"the validator answered {len(answers)} of "
                         f"{len(cases)} names")

    for one, said in zip(cases, answers):
        wanted = "ok" if one["stored"] else "no"
        check(f"a name for {one['what']}: the device "
              f"{'stores' if one['stored'] else 'refuses'} it",
              said == wanted, said)
        counted("name")

    # The rule the three statements of the name were never held to. It is
    # written as an implication rather than as a list because that is what it
    # is: a builder may emit fewer names than the device will take, and the
    # one direction that must never happen is the other.
    broken = [one["name"] for one, said in zip(cases, answers)
              if one["emitted"] and said != "ok"]
    check("every name a builder may emit is one the device will store",
          not broken,
          "" if not broken else
          f"the device refuses {broken} - each of those is a file that "
          f"silently never arrives, with no error at either end")

    # And the other half of the spelling: hashPath() has to build the name the
    # builder emits, out of the sixteen bytes layout.bin carries for it.
    hashed = [one for one in cases if one["hash"] and one["path"]]
    asked = "".join(f"path {one['name'][0]} {one['hash']}\n"
                    for one in hashed).encode()
    built = [l.split(" ", 1)[1] for l in
             run(reader, ["names"], asked).strip().split("\n")]
    for one, said in zip(hashed, built):
        check(f"the device builds {one['path']} out of its sixteen bytes",
              said == one["path"], said)
        counted("name")


# --- The language enumeration ------------------------------------------------

def check_language(reader: Path, want: dict) -> None:
    got = run(reader, ["language"])
    said = fields(got)
    check(f"the device has a table for each of the "
          f"{len(want['languages'])} languages",
          said.get("count") == str(len(want["languages"])),
          f"texts.h knows {said.get('count')}")
    check(f"and its default is index {want['default_index']}",
          said.get("default") == str(want["default_index"]),
          said.get("default", "-"))

    renders = {}
    for line in got.strip().split("\n"):
        parts = line.split(" ")
        if parts[0] in ("index", "past"):
            renders[int(parts[1])] = int(parts[3])
    for one in want["languages"]:
        check(f"index {one['index']} is {one['code']} and renders itself",
              renders.get(one["index"]) == one["index"],
              str(renders.get(one["index"])))
        counted("language")
    for past in (len(want["languages"]), 7, 255):
        check(f"index {past} has no table and falls back to "
              f"{want['unknown_index_falls_back_to']}",
              renders.get(past) == want["unknown_index_falls_back_to"],
              str(renders.get(past)))
        counted("language")


# --- The sleep timeout -------------------------------------------------------

def check_sleep(reader: Path, want: dict) -> None:
    asked = "".join(f"{one['sleep_seconds']}\n" for one in want["cases"])
    got = run(reader, ["sleep"], asked.encode())
    said = fields(got)

    for key in ("min", "max", "default"):
        check(f"the device's sleep {key} is {want[key]}",
              said.get(key) == str(want[key]), said.get(key, "-"))
        counted("sleep")

    waits = {}
    for line in got.strip().split("\n"):
        parts = line.split(" ")
        if parts[0] == "idle":
            waits[int(parts[1])] = int(parts[2])

    for one in want["cases"]:
        field, wanted = one["sleep_seconds"], one["idle_seconds"]
        check(f"a timeout of {field} - {one['what']} - is a wait of {wanted}",
              waits.get(field) == wanted, str(waits.get(field)))
        counted("sleep")

    # The rule the two statements of the range were never held to. An
    # implication rather than a list, the same way the name rule is written: a
    # builder may emit fewer timeouts than the device honours, and the one
    # direction that must never happen is a builder emitting a number the
    # device quietly waits a different length of time for.
    broken = [one["sleep_seconds"] for one in want["cases"]
              if one["emitted"]
              and waits.get(one["sleep_seconds"]) != one["sleep_seconds"]]
    check("every timeout a builder may emit is one the device waits exactly",
          not broken,
          "" if not broken else
          f"the device turns {broken} into something else - each of those is a "
          f"device sleeping at a time nobody asked for, with no error at "
          f"either end")


# --- Several collections -----------------------------------------------------

def check_collections(reader: Path, want: dict) -> None:
    """Everything collections.h decides, asked one question at a time.

    One process and a little command language rather than one run per case,
    because the questions share state: the listing is built up by offering
    files, and choosing is what falls back through the order it came out in.
    """
    asked: list[str] = ["limits"]
    for one in want["names"]:
        asked.append(f"name {one['name']}")
    for one in want["heads"]:
        asked.append(f"head {one['head']}")
    for one in want["menu"]:
        asked.append(f"menu {one['name']}")
    asked.append("clear")
    for one in want["offering"]:
        asked.append(f"offer {one['file']} {one['head']}")
    asked.append("list")
    asked.append("clear")
    for name in want["over_the_limit"]["files"]:
        asked.append(f"offer {name} {want['over_the_limit']['head']}")
    asked.append("list")
    asked.append("clear")
    for one in want["listing"]["given"]:
        asked.append(f"offer {one['file']} {one['head']}")
    asked.append("list")
    for one in want["choosing"]:
        asked.append(f"choose {one['asked']}")
    for one in want["paging"]:
        asked.append(f"page {one['count']}")

    said = run(reader, ["collections"],
               ("\n".join(asked) + "\n").encode()).split("\n")
    at = 0

    def take() -> str:
        nonlocal at
        line = said[at]
        at += 1
        return line

    limits = {}
    for _ in range(7):
        key, _, value = take().partition(" ")
        limits[key] = value
    check("the collection prefix is the letter the name rule states",
          limits["prefix"] == want["name_rule"]["prefix"], limits["prefix"])
    check("and the suffix, the legacy name and the room are what it states",
          limits["suffix"] == want["name_rule"]["suffix"]
          and limits["legacy"] == want["name_rule"]["legacy"]
          and int(limits["max"]) == want["max"]
          and int(limits["head_bytes"]) == want["head_bytes"]
          and int(limits["menu_max_chars"]) == want["menu_max_chars"]
          and int(limits["keys"]) == want["keys"],
          str(limits))
    counted("collections")

    for one in want["names"]:
        got = take().split(" ", 1)[1]
        check(f"{one['what']} is {one['kind']}", got == one["kind"], got)
        counted("collections")

    for one in want["heads"]:
        got = take()
        wanted = ("head no" if one["name"] is None
                  else "head ok " + one["name"].encode().hex())
        check(f"a head for {one['what']}: "
              + ("no name" if one["name"] is None
                 else f"the name {one['name']!r}"),
              got == wanted, got)
        counted("collections")

    for one in want["menu"]:
        got = take().split(" ", 1)[1] if " " in said[at] else take()
        wanted = f"{one['first']}|{one['second']}"
        check(f"{one['name']!r} on a key: {one['first']!r} over "
              f"{one['second']!r}", got == wanted, got)
        counted("collections")

    take()                                   # clear
    for one in want["offering"]:
        got = take().split(" ", 1)[1]
        check(f"offering {one['what']}: {one['taken']}",
              got == one["taken"], got)
        counted("collections")
    count = int(take().split(" ")[1])
    refused = int(take().split(" ")[1])
    taken = [one for one in want["offering"] if one["taken"] == "taken"]
    while said[at].startswith("at "):
        take()
    check("a list holds what was taken into it and counts what was not",
          count == len(taken) and refused == 1, f"{count} held, {refused} refused")
    counted("collections")

    take()                                   # clear
    for _ in want["over_the_limit"]["files"]:
        take()
    count = int(take().split(" ")[1])
    refused = int(take().split(" ")[1])
    while said[at].startswith("at "):
        take()
    check(f"{len(want['over_the_limit']['files'])} collections offered where "
          f"there is room for {want['max']}",
          count == want["over_the_limit"]["taken"]
          and refused == want["over_the_limit"]["refused"],
          f"{count} held, {refused} refused")
    counted("collections")

    take()                                   # clear
    for _ in want["listing"]["given"]:
        take()
    take()                                   # count
    take()                                   # refused
    order = []
    while said[at].startswith("at "):
        order.append(take().split(" ")[2])
    check("the menu lists them by the name shown and then by the file",
          order == want["listing"]["order"],
          " ".join(order))
    counted("collections")

    for one in want["choosing"]:
        _, outcome, file = take().split(" ")
        check(f"choosing when {one['what']}: {one['outcome']}, {one['chose']}",
              outcome == one["outcome"] and file == one["chose"],
              f"{outcome} {file}")
        counted("collections")

    for one in want["paging"]:
        head = take().split(" ")
        rows = [take().split(" ")[1:] for _ in one["keys"]]
        check(f"{one['count']} collections: {one['per_page']} to a screen, "
              f"{one['pages']} {'screen' if one['pages'] == 1 else 'screens'}",
              int(head[1]) == one["count"] and int(head[3]) == one["per_page"]
              and int(head[5]) == one["pages"]
              and [[int(k) for k in row] for row in rows] == one["keys"],
              f"{head} {rows}")
        counted("collections")

    # What the paging is worth, asked of all of it at once. A device that put
    # four names on every screen would satisfy every case where there are four
    # or fewer, and one that always paged would satisfy the rest.
    pers = {one["per_page"] for one in want["paging"]}
    check("the cases cover a screen that pages and one that does not",
          len(pers) > 1, f"{sorted(pers)} names to a screen")


# --- The cable ---------------------------------------------------------------

def wire(want: dict) -> bytes:
    """The transcript as the device receives it.

    The preload first, then the host's half of the conversation. A file's
    content follows its command line with no newline in front of it and none
    after it, which is why this is assembled by walking the steps rather than
    by joining lines.
    """
    out = bytearray()
    for held in want["device_starts_with"]:
        content = base64.b64decode(held["content"])
        out += f"preload {held['name']} {len(content)}\n".encode()
        out += content
    out += b"wire\n"
    for step in want["steps"]:
        if step["from"] != "host":
            continue
        if "raw" in step:
            out += base64.b64decode(step["raw"])
        else:
            out += (step["line"] + "\n").encode()
    return bytes(out)


class Loose(list):
    """A run of device lines whose order the format does not specify."""


def device_groups(steps: list[dict]) -> list[list[str]]:
    groups: list[list[str]] = []
    for step in steps:
        if step["from"] != "device" or "line" not in step:
            continue        # a file coming back is not a line - see check_cable
        if step.get("any_order") and groups and isinstance(groups[-1], Loose):
            groups[-1].append(step["line"])
        elif step.get("any_order"):
            groups.append(Loose([step["line"]]))
        else:
            groups.append([step["line"]])
    return groups


def spoken_and_raw(out: bytes) -> tuple[list[str], list[bytes], str]:
    """The device's half, split the way a browser has to split it.

    Lines up to a newline - except after a "data" line, where the next `size`
    bytes are a file coming back and are not text at all. Counted rather than
    searched for, because that is the whole of the framing: anything looking
    for the next line at a newline finds one inside a picture sooner or later.

    Anything that is not marked is the harness's own trailing report, which
    the caller reads separately.
    """
    lines: list[str] = []
    raws: list[bytes] = []
    at = 0
    while at < len(out):
        cut = out.find(b"\n", at)
        if cut < 0:
            break
        line = out[at:cut].decode("utf-8", "replace")
        at = cut + 1
        lines.append(line)
        if line.startswith("< data "):
            size = int(line.split()[-2])
            raws.append(out[at:at + size])
            at += size
    return ([l for l in lines if l.startswith("< ")], raws,
            "\n".join(l for l in lines if not l.startswith("< ")))


def check_cable(reader: Path, name: str, want: dict) -> None:
    result = subprocess.run(
        [str(reader), "cable", str(want["capacity"]), str(want["window"]),
         want["device_firmware"], want["device_tiles"],
         str(want["device_collections"])],
        input=wire(want), capture_output=True)
    if result.returncode != 0:
        raise SystemExit(f"device_host cable fell over:\n"
                         + result.stderr.decode()[:2000])
    spoken, raws, got = spoken_and_raw(result.stdout)
    groups = device_groups(want["steps"])
    wanted = [line for group in groups for line in group]

    # And the bytes the device sent back, if any. A `get` is the one place
    # where what the device says is not all text, and a transcript that stated
    # only the lines would be satisfied by a device that sent the right head
    # and the wrong file.
    sent = [base64.b64decode(step["raw"]) for step in want["steps"]
            if step["from"] == "device" and "raw" in step]
    if sent or raws:
        check(f"{name}: and hands back exactly the bytes the transcript holds",
              raws == sent,
              f"{[len(r) for r in raws]} against {[len(r) for r in sent]}")
        counted("cable")

    # Walked group by group rather than line by line, so that the one run the
    # format leaves unordered is compared as a multiset and everything else is
    # compared in its place.
    same = len(spoken) == len(wanted)
    if same:
        at = 0
        for group in groups:
            said = spoken[at:at + len(group)]
            same = sorted(said) == sorted(group) if isinstance(group, Loose) \
                else said == group
            if not same:
                break
            at += len(group)

    check(f"{name}: the device says exactly what the transcript says it does",
          same,
          "" if same else
          "\n".join(f"      transcript: {a}\n      firmware:   {b}"
                    for a, b in zip(wanted, spoken) if a != b)
          or f"{len(spoken)} lines for {len(wanted)}")
    counted("cable")

    end = want.get("device_ends_with")
    if not end:
        return
    held = sorted((p[2], int(p[3]), p[4]) for p in
                  (l.split() for l in got.splitlines())
                  if p and p[0] == "#" and p[1] == "holds")
    expected = sorted((f["name"], f["size"], f["crc"]) for f in end["files"])
    check(f"{name}: and is left holding what the transcript says",
          held == expected,
          "" if held == expected else
          f"firmware has {held}, transcript says {expected}")

    tally = [l.split() for l in got.splitlines()
             if l.startswith("# tally")]
    if tally:
        got_tally = (int(tally[0][2]), int(tally[0][3]), int(tally[0][4]))
        want_tally = (end["stored"], end["removed"], end["bytes"])
        # Only where the session never said goodbye: after a "done" the device
        # zeroes its counters, and the bye line has already been compared.
        if want["steps"][-1]["from"] != "device" or not any(
                s.get("line", "").startswith("< bye") for s in want["steps"]):
            check(f"{name}: and counted {want_tally[0]} stored, "
                  f"{want_tally[1]} removed, {want_tally[2]} bytes",
                  got_tally == want_tally, str(got_tally))


# -----------------------------------------------------------------------------

def main() -> int:
    index = json.loads((FIXTURES / "index.json").read_text(encoding="utf-8"))
    listed = index["fixtures"]
    check("the fixture index is there and lists something",
          bool(listed),
          f"{len(listed)} fixtures, device interface "
          f"{index['device_interface_version']}")

    with tempfile.TemporaryDirectory() as tmp:
        reader = Path(tmp) / "device_host"
        if not build(reader):
            return 1

        for one in listed:
            want = json.loads(
                (FIXTURES / one["expected"]).read_text(encoding="utf-8"))
            kind = one["kind"]
            if kind == "layout":
                check_layout(reader, one["fixture"], FIXTURES / one["file"],
                             want["read"])
                if want.get("walk"):
                    check_walk(reader, one["fixture"],
                               FIXTURES / one["file"], want["walk"])
            elif kind == "tile":
                check_tile(reader, one["fixture"], FIXTURES / one["file"], want)
            elif kind == "audio":
                check_audio(reader, one["fixture"], FIXTURES / one["file"], want)
            elif kind == "names":
                check_names(reader, want)
            elif kind == "language":
                check_language(reader, want)
            elif kind == "sleep":
                check_sleep(reader, want)
            elif kind == "press":
                check_press(reader, want)
            elif kind == "collections":
                check_collections(reader, want)
            elif kind == "package":
                # The other boundary, and neither of its ends is the device:
                # a device package is the .obz the editor writes and the
                # loader page reads, and what reaches a talker is what comes
                # out of compiling one. adr/0014 is why it is in this index at
                # all, and tests/unit/device_package_{writer,reader}.test.ts
                # are its two halves. There is nothing here for a C++ reader
                # to be pointed at, and saying so out loud is the difference
                # between a kind that is skipped and one that is forgotten.
                print(f"  --    {one['fixture']}: the device package, which "
                      f"this end never sees")
            elif kind == "cable":
                if "device" in want["ends"]:
                    check_cable(reader, one["fixture"], want)
                else:
                    # The browser's half. A device formatter cannot produce a
                    # keyword the device does not have, so a fixture about
                    # skipping one can only be asked of the end that reads it.
                    print(f"  --    {one['fixture']}: the browser's end only "
                          f"({', '.join(want['ends'])})")
            else:
                check(f"{one['fixture']}: this runner knows the kind "
                      f"{kind!r}", False)

    # What the walks are worth, asked of all of them at once.
    #
    # A single walk proves less than it looks. One whose presses never left the
    # set they started on would be satisfied by a device that ignores `target`
    # altogether; one where every press moved would be satisfied by a device
    # that moves on any press at all; and one that only ever went forwards
    # would be satisfied by the arithmetic ring the firmware used to do. So the
    # set of walks has to contain all three, and this says so out loud rather
    # than leaving it to whoever writes the next one - the same argument the
    # cable transcripts make about a verdict that is not constant.
    moved = [(name, one) for name, presses in walked for one in presses
             if one["goes_to"] >= 0]
    stayed = [one for _, presses in walked for one in presses
              if one["goes_to"] < 0]
    reached = {(name, one["now_on_set"]) for name, one in moved}
    backwards = [one for _, one in moved if one["now_on_set"] <= one["on_set"]]
    check("the walks contain presses that move and presses that do not",
          bool(moved) and bool(stayed),
          f"{len(moved)} moved, {len(stayed)} stayed")
    check("they reach more than two sets between them",
          len({at for _, at in reached}) > 2,
          f"sets {sorted({at for _, at in reached})}")
    check("and at least one of them goes somewhere that is not the next set "
          "along, which the ring the firmware used to compute never did",
          bool(backwards),
          f"{len(backwards)} press(es) that go back or stay level")

    if failures:
        print(f"\n  {len(failures)} problem(s):")
        for name in failures:
            print(f"    {name}")
        return 1
    print("\n  " + ", ".join(f"{n} {k} check(s)" for k, n in
                             sorted(counts.items())))
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
