#!/usr/bin/env python3
"""Checks the cable wire format the way both ends will really read it.

The cable is what replaces the Wi-Fi sync once there is no server left to sync
with: the browser pushes content down the USB-C cable the device is charged
through anyway. docs/cable.md has the protocol and the reasoning; this checks
that the three places it is written down agree.

Those places are firmware/vorlaut/cable_format.h, which the device reads and
writes with, and tools/cable.js, which the browser reads and writes with. A
protocol whose two halves are only ever run against their own author's idea of
the other one is not tested, it is asserted - so the check that matters here
is the one in the middle:

  * The browser client is driven through whole sessions against the mock in
    tools/cable_mock.js, and every byte it wrote is recorded.
  * Those exact bytes are then handed to the C reader out of the sketch,
    compiled here, which starts empty and can only be reached through the
    wire.
  * Both are then asked what files they are holding, and the answers have to
    match down to the checksums.

The other direction is closed the same way: the C formatters print one of
every line the device can send, and the browser client is made to read them
back. What neither can prove without hardware is anything to do with time -
giving up on a transfer that stopped arriving, and finding the way back into
line mode afterwards. Those are marked as such below rather than faked.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build_reader(target: Path) -> None:
    result = subprocess.run(
        ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(ROOT / "tests" / "cable_dump.cpp")],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit("cable_dump does not compile:\n" + result.stderr)


def node_or_stop() -> str:
    node = shutil.which("node")
    if not node:
        raise SystemExit(
            "Node is needed to check the browser client against the firmware, "
            "and is not on the PATH.")
    return node


def run_scenario(node: str, name: str, stdin: bytes = b"") -> dict:
    """One scenario out of tests/cable_node.mjs, as its report."""
    result = subprocess.run([node, str(ROOT / "tests" / "cable_node.mjs"), name],
                            input=stdin, capture_output=True)
    if result.returncode != 0:
        raise SystemExit(f"the browser client would not run ({name}):\n"
                         + result.stderr.decode())
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        raise SystemExit(f"the browser client said nothing usable ({name}):\n"
                         + result.stdout.decode()[:2000])


def fields(output: str) -> dict[str, str]:
    out = {}
    for line in output.strip().split("\n"):
        key, _, value = line.partition(" ")
        out[key] = value
    return out


# --- The constants -----------------------------------------------------------

def check_limits(reader: Path, problems: list[str]) -> None:
    """What both sides have to agree on before a single byte is sent.

    The two sigils are the ones worth guarding hardest. This stream is shared
    with the device's serial log, and if the browser stopped marking its lines
    the device would start taking its own debug output for commands.
    """
    got = fields(subprocess.run([str(reader), "limits"], capture_output=True,
                                text=True, check=True).stdout)
    expected = {"version": "1", "line_max": "128", "name_max": "63",
                "host_sigil": ">", "device_sigil": "<", "part": "/.part",
                "version_file": "/version"}
    for key, value in expected.items():
        if got.get(key) != value:
            problems.append(f"{key} is {got.get(key)}, the contract says {value}")

    # The client has to carry the same version, or a device that answers
    # "vorlaut 2" would be driven with a protocol it no longer speaks.
    source = (ROOT / "tools" / "cable.js").read_text(encoding="utf-8")
    if f"export const CABLE_VERSION = {got.get('version')};" not in source:
        problems.append("tools/cable.js does not carry the same CABLE_VERSION "
                        f"as the firmware ({got.get('version')})")


# --- Names -------------------------------------------------------------------

# Which names the device is willing to touch. The point of most of these is
# that they are silent on a device: a file written into a folder nobody sweeps
# is not an error, it is 40 KB that never comes back.
NAMES = [
    ("an image", "t3bd7a1c045e29f8b6d0a4e17c93f5028.bin", True),
    ("a recording", "a8c1e9b0d4f2a6c3b7e5d1908a4c2f6b.wav", True),
    ("the layout", "layout.bin", True),
    ("nothing at all", "", False),
    ("a folder", "sets/layout.bin", False),
    ("the way out of the folder", "../layout.bin", False),
    ("a bare walk up", "..", False),
    ("the half-written file", ".part", False),
    ("anything hidden", ".hidden", False),
    ("the Wi-Fi sync's own note", "version", False),
    ("a space in it", "two words.bin", False),
    ("a tab in it", "tab\there.bin", False),
    ("a byte above ASCII", "tile\u00ff.bin", False),
    ("64 characters", "x" * 64, False),
    ("63 characters", "x" * 63, True),
]


def check_names(reader: Path, problems: list[str]) -> int:
    """Both ways in: the validator on its own, and a whole command.

    Separately, because they refuse different things and each can hide a fault
    in the other. A command with two words is refused for its word count
    before the name is ever looked at, so an empty name never reaches the
    validator that way - and cable.h calls the validator directly on every
    entry of the directory, where nothing has counted words first.
    """
    # The names are newline-separated, so a name containing one cannot be
    # asked about this way. It cannot arrive over the wire either: a newline
    # ends the command.
    asked = [name for _, name, _ in NAMES if "\n" not in name]
    answers = subprocess.run([str(reader), "names"],
                             input="".join(n + "\n" for n in asked),
                             capture_output=True, text=True,
                             check=True).stdout.split()
    if len(answers) != len(asked):
        raise SystemExit(f"the validator answered {len(answers)} of "
                         f"{len(asked)} names")
    direct = dict(zip(asked, answers))

    for what, name, allowed in NAMES:
        if direct.get(name, "ok" if allowed else "no") != ("ok" if allowed else "no"):
            problems.append(f"{what} ({name!r}): the validator says "
                            f"{direct[name]}, expected "
                            f"{'ok' if allowed else 'no'}")
        got = subprocess.run([str(reader), "parse"], input=f"> rm {name}\n",
                             capture_output=True, text=True, check=True).stdout
        complete = got.split()[1] == "1"
        if complete != allowed:
            problems.append(f"{what} ({name!r}): as a command the device would "
                            f"{'take' if complete else 'refuse'} it, expected "
                            f"the other")
    return len(NAMES)


# --- The checksum ------------------------------------------------------------

def check_crc(reader: Path, problems: list[str]) -> int:
    """The same CRC-32 as zlib, and the same one in the browser.

    It has to be a checksum of its own because the file names cannot serve as
    one: they are hashes of the input that produced a file - the source image
    and the pipeline version, the text and the voice - not of the bytes that
    come out. A name proves which content was meant, never which arrived.
    """
    cases = [b"", b"v", b"vorlaut", bytes(range(256)), os.urandom(4095),
             os.urandom(4096), os.urandom(4097), os.urandom(300000)]
    for payload in cases:
        got = fields(subprocess.run([str(reader), "crc"], input=payload,
                                    capture_output=True, check=True)
                     .stdout.decode())
        want = f"{zlib.crc32(payload):08x}"
        if got["crc"] != want:
            problems.append(f"{len(payload)} bytes checksum to {got['crc']}, "
                            f"zlib says {want}")
    return len(cases)


# --- Reading a command -------------------------------------------------------

# What the browser sends, and what the device has to make of it. The awkward
# ones are here on purpose: an unmarked line because the serial log shares this
# wire, a verb from a newer browser because that must not be silently ignored,
# and a size that does not fit in 32 bits because a size that wrapped would
# open a file and then wait for bytes nobody is sending.
COMMANDS = [
    ("hello", "> hello", ("hello", "1", "-", "0")),
    ("list", "> list", ("list", "1", "-", "0")),
    ("done", "> done", ("done", "1", "-", "0")),
    ("a file on its way", "> put layout.bin 942 1a2b3c4d",
     ("put", "1", "layout.bin", "942")),
    ("a checksum asked for", "> crc layout.bin", ("crc", "1", "layout.bin", "0")),
    ("a file thrown away", "> rm layout.bin", ("rm", "1", "layout.bin", "0")),
    ("an empty file is still a file", "> put layout.bin 0 00000000",
     ("put", "1", "layout.bin", "0")),

    ("the serial log is not a command", "menu opened", ("none", "0", "-", "0")),
    ("nor is a bare word", "hello", ("none", "0", "-", "0")),
    ("nor is the device's own answer", "< end hello", ("none", "0", "-", "0")),
    ("nor is the sigil without a space", ">hello", ("none", "0", "-", "0")),
    ("an empty line", "", ("none", "0", "-", "0")),

    ("a verb from a newer browser is refused, not ignored",
     "> reboot", ("unknown", "0", "-", "0")),
    ("put without a checksum", "> put layout.bin 942", ("put", "0", "-", "0")),
    ("put without a size", "> put layout.bin", ("put", "0", "-", "0")),
    ("put with no arguments at all", "> put", ("put", "0", "-", "0")),
    ("a size that is not a number", "> put layout.bin many 1a2b3c4d",
     ("put", "0", "-", "0")),
    ("a size with something after it", "> put layout.bin 942x 1a2b3c4d",
     ("put", "0", "-", "0")),
    ("a size past 32 bits", "> put layout.bin 4294967296 1a2b3c4d",
     ("put", "0", "-", "0")),
    ("the largest size that fits", "> put layout.bin 4294967295 1a2b3c4d",
     ("put", "1", "layout.bin", "4294967295")),
    ("a checksum of seven digits", "> put layout.bin 942 1a2b3c4",
     ("put", "0", "-", "0")),
    ("a checksum of nine digits", "> put layout.bin 942 1a2b3c4d5",
     ("put", "0", "-", "0")),
    ("a checksum that is not hex", "> put layout.bin 942 zzzzzzzz",
     ("put", "0", "-", "0")),
    ("rm with no name", "> rm", ("rm", "0", "-", "0")),
    ("a name the device will not touch", "> rm ../secrets",
     ("rm", "0", "-", "0")),

    ("a terminal that sends CRLF", "> hello\r", ("hello", "1", "-", "0")),
    ("two spaces are not one", "> put  layout.bin 942 1a2b3c4d",
     ("put", "0", "-", "0")),
    ("something after hello is ignored, not refused",
     "> hello 2 please", ("hello", "1", "-", "0")),
]


def check_commands(reader: Path, problems: list[str]) -> int:
    body = "".join(line + "\n" for _, line, _ in COMMANDS)
    out = subprocess.run([str(reader), "parse"], input=body, capture_output=True,
                         text=True, check=True).stdout.strip().split("\n")
    if len(out) != len(COMMANDS):
        raise SystemExit(f"the reader answered {len(out)} lines for "
                         f"{len(COMMANDS)} commands")
    for (what, line, expected), got in zip(COMMANDS, out):
        verb, complete, name, size, _crc = got.split(" ")
        if (verb, complete, name, size) != expected:
            problems.append(f"{what} ({line!r}): read as "
                            f"{(verb, complete, name, size)}, expected {expected}")

    # An upper-case checksum has to mean the same as a lower-case one - the
    # device writes lower case, but nothing stops a browser sending either.
    got = subprocess.run([str(reader), "parse"],
                         input="> put layout.bin 942 1A2B3C4D\n",
                         capture_output=True, text=True, check=True).stdout
    if got.split()[4] != "1a2b3c4d":
        problems.append("an upper-case checksum is not read as the same value")

    # A line longer than the device's buffer. It gets cut off before the
    # reader ever sees it, so what matters is that a cut-off line is refused
    # rather than acted on with half a name.
    long_name = "t" + "0" * 200 + ".bin"
    got = subprocess.run([str(reader), "parse"], input=f"> rm {long_name}\n",
                         capture_output=True, text=True, check=True).stdout
    if got.split()[1] != "0":
        problems.append("a name longer than the buffer was accepted")
    return len(COMMANDS) + 2


# --- Writing an answer -------------------------------------------------------

# Every line the device can send, exactly as it composes it. Written out here
# rather than derived, because this is the half tools/cable.js has to read and
# a change on either side should have to be made twice on purpose.
ANSWERS = """\
< vorlaut 1
< total 1441792
< free 1146880
< files 37
< end hello
< file t3bd7a1c045e29f8b6d0a4e17c93f5028.bin 26912
< end list 37
< crc layout.bin 1a2b3c4d
< go
< ok a8c1e9b0d4f2a6c3b7e5d1908a4c2f6b.wav 41008
< gone layout.bin
< bye 12 3 486400
< err nospace
< err crc layout.bin
< crc layout.bin deadbeef
< crc layout.bin 0000beef
"""


def check_answers(reader: Path, problems: list[str]) -> str:
    got = subprocess.run([str(reader), "say"], capture_output=True, text=True,
                         check=True).stdout
    if got != ANSWERS:
        for want, is_ in zip(ANSWERS.split("\n"), got.split("\n")):
            if want != is_:
                problems.append(f"the device would send {is_!r}, expected {want!r}")
    return got


def check_readback(node: str, problems: list[str], answers: str) -> None:
    """The browser reads back what the firmware wrote.

    Handing it the C harness's own output rather than a copy typed in here is
    the point: if the formatter changes, this fails, and it fails on the side
    that would really have stopped understanding.
    """
    report = run_scenario(node, "readback", answers.encode())
    if not report["ok"]:
        problems.append(f"the browser client could not read the firmware's "
                        f"answers: {report.get('error')}")
        return
    seen = report["detail"]
    expected = {
        "hello": {"version": 1, "total": 1441792, "free": 1146880, "files": 37},
        "list": [{"name": "t3bd7a1c045e29f8b6d0a4e17c93f5028.bin", "size": 26912}],
        "crc": "1a2b3c4d",
        # The one where a signed shift would turn eight digits into eleven.
        "big": "deadbeef",
        # And the one that a lost zero padding would shorten to four.
        "padded": "0000beef",
    }
    for key, want in expected.items():
        if seen.get(key) != want:
            problems.append(f"reading back {key}: the browser made {seen.get(key)!r} "
                            f"of it, expected {want!r}")


# --- Whole sessions ----------------------------------------------------------

SESSIONS = [
    ("fresh", "a device with nothing on it, everything has to go across"),
    ("incremental", "one symbol and one sentence changed - almost nothing moves"),
    ("noise", "the device chattering into the same wire the whole time"),
    ("tight", "no room for the old content and the new at once"),
]


def walk(raw: bytes) -> list[tuple[str, str, int]]:
    """The transcript as the device reads it: lines, and after a put exactly
    as many raw bytes as it said.

    Parsed rather than searched for. A file's content is followed immediately
    by the next command with no newline between them, so anything looking for
    "> put" at a line start misses the command after every file - and a plain
    substring search would instead find one inside a WAV sooner or later.
    Counting the bytes is the only reading that is exactly right, and getting
    the same answer the device gets is itself worth checking: if this walk runs
    off the end, the stream is not framed the way both sides believe.
    """
    out: list[tuple[str, str, int]] = []
    at = 0
    while at < len(raw):
        end = raw.find(b"\n", at)
        if end < 0:
            break
        line = raw[at:end].decode("utf-8", "replace")
        at = end + 1
        if not line.startswith("> "):
            continue
        parts = line[2:].split(" ")
        verb = parts[0]
        if verb == "put":
            size = int(parts[2])
            out.append(("put", parts[1], size))
            at += size                      # the content, exactly as promised
        else:
            out.append((verb, parts[1] if len(parts) > 1 else "", 0))
    return out


def check_order(name: str, raw: bytes, problems: list[str]) -> None:
    """layout.bin last, and the sweep wholly on one side of the sending.

    Read off the wire rather than out of the plan the client made, because
    what protects the device is the order the bytes really went in. layout.bin
    is the commit: until it lands the device reads the old layout, and every
    file the old layout names is still there. Sending it early, or deleting
    before sending, both leave a window in which the device would come up with
    silent keys - and neither shows up as an error anywhere.

    A session at a time, since one transcript may hold several.
    """
    steps = walk(raw)
    if not steps:
        problems.append(f"{name}: nothing could be read off the wire at all")
        return
    if steps[0][0] != "hello":
        problems.append(f"{name}: the first thing said was {steps[0][0]!r}, "
                        f"not hello")

    session: list[tuple[str, str, int]] = []
    sessions = []
    for step in steps:
        if step[0] == "hello" and session:
            sessions.append(session)
            session = []
        session.append(step)
    sessions.append(session)

    for part in sessions:
        puts = [name_ for verb, name_, _ in part if verb == "put"]
        order = [verb for verb, _, _ in part if verb in ("put", "rm")]
        if not puts:
            continue
        if puts.count("layout.bin") != 1:
            problems.append(f"{name}: layout.bin was sent "
                            f"{puts.count('layout.bin')} times in one session")
        elif puts[-1] != "layout.bin":
            problems.append(
                f"{name}: layout.bin was not the last thing sent ({puts[-1]} "
                f"was) - it is the commit, and sending it early points the "
                f"device at files that have not arrived")
        # Which side the sweep falls on is the plan's choice, but it has to be
        # wholly on one side: interleaved, it would delete a file the layout
        # currently on the device still names.
        squashed = []
        for v in order:
            if not squashed or squashed[-1] != v:
                squashed.append(v)
        if len(squashed) > 2:
            problems.append(f"{name}: sending and sweeping are interleaved "
                            f"({'-'.join(squashed)})")


def check_sessions(reader: Path, node: str, problems: list[str]) -> list[str]:
    """The check this file exists for.

    The browser client is run against the mock, every byte it wrote is kept,
    and the C reader out of the sketch is then made to replay exactly those
    bytes from an empty file system. If the two ends disagree about anything -
    a keyword, a byte count, where a file's content starts - they end up
    holding different files, and that is what is compared.
    """
    notes = []
    for name, what in SESSIONS:
        report = run_scenario(node, name)
        if not report["ok"]:
            problems.append(f"{name}: the browser client failed - {report.get('error')}")
            continue

        raw = base64.b64decode(report["transcript"])
        check_order(name, raw, problems)
        result = subprocess.run([str(reader), "session"], input=raw,
                                capture_output=True)
        held = sorted(
            (parts[2], int(parts[3]), parts[4])
            for parts in (line.split() for line in
                          result.stdout.decode().splitlines())
            if parts and parts[0] == "#")
        wanted = sorted((f["name"], f["size"], f["crc"]) for f in report["holds"])

        if held != wanted:
            only_c = [f for f in held if f not in wanted]
            only_js = [f for f in wanted if f not in held]
            problems.append(
                f"{name}: the two ends disagree about what the device is now "
                f"holding. The firmware has {len(held)} file(s), the browser "
                f"expected {len(wanted)}."
                + (f" Only the firmware has: {only_c}." if only_c else "")
                + (f" Only the browser expected: {only_js}." if only_js else ""))
            continue

        plan = report["plan"]
        notes.append(f"{name}: {len(raw)} bytes over the wire, "
                     f"{len(plan['put'])} sent, {len(plan['remove'])} removed, "
                     f"{len(plan['keep'])} left alone"
                     + (", cleared out first" if plan["tight"] else "")
                     + f" - {what}")

    # The whole point of content-addressed names: the second time round, the
    # files that did not change must not be sent again.
    report = run_scenario(node, "incremental")
    if report["ok"] and len(report["plan"]["keep"]) < 3:
        problems.append("an incremental push sent nearly everything again - "
                        "the file names are supposed to make that unnecessary")
    return notes


# --- What only one end can be asked about ------------------------------------

CLIENT_ONLY = [
    ("badcrc", "a file that arrived wrong is refused, and says so"),
    ("cancelLast", "aborting on the last step still never sends done"),
    ("timings", "the device's gap and stall arrive, and are stepped over"),
    ("short", "a transfer that stopped leaves the session shut until hello"),
    ("nospace", "a device with no room refuses before a byte is sent"),
    ("truncated", "a file of the wrong length is sent again, not kept for its name"),
    ("cancel", "an abort stops between files and never sends done"),
]


def check_client_only(node: str, problems: list[str]) -> list[str]:
    """The failures, which only the browser end can be examined for here.

    The C harness has no clock, so it cannot be made to give up on a transfer
    that stopped arriving - and that timeout, and finding the way back into
    line mode after it, is the one part of this protocol that cannot be shown
    to work without a board on the bench. It is written down in docs/cable.md
    as exactly that.
    """
    notes = []
    for name, what in CLIENT_ONLY:
        report = run_scenario(node, name)
        if not report["ok"]:
            problems.append(f"{name}: {report.get('error')}")
        else:
            notes.append(f"{name}: {what}")
    return notes


def main() -> int:
    problems: list[str] = []
    node = node_or_stop()
    with tempfile.TemporaryDirectory() as tmp:
        reader = Path(tmp) / "cable_dump"
        build_reader(reader)
        check_limits(reader, problems)
        names = check_names(reader, problems)
        sums = check_crc(reader, problems)
        commands = check_commands(reader, problems)
        answers = check_answers(reader, problems)
        check_readback(node, problems, answers)
        sessions = check_sessions(reader, node, problems)
        client = check_client_only(node, problems)

    if problems:
        for problem in problems:
            print(f"  FAIL  {problem}")
        print(f"\n  {len(problems)} problem(s)")
        return 1

    print(f"  {commands} commands and {names} names read the way the device "
          f"will read them")
    print(f"  {sums} checksums agree with zlib, and "
          f"{len(ANSWERS.strip().splitlines())} answers with the browser")
    print("\n  Whole sessions, browser client against the compiled firmware "
          "reader:")
    for note in sessions:
        print(f"    {note}")
    print("\n  And the failures, on the browser's side only:")
    for note in client:
        print(f"    {note}")
    print("\n  Not covered here, and not coverable without hardware: giving up "
          "on a\n  transfer that stopped arriving, and the drain back into "
          "line mode after it.")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
