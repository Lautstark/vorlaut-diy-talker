#!/usr/bin/env python3
"""Checks the pairing wire format the way the device will really read it.

Pairing replaces the key that used to be typed into a captive portal: the
device shows five digits, one per display, and the browser confirms them. Two
pieces of that are easy to get quietly wrong and impossible to see from the
outside once a device is standing on the table:

  * The five digits. A code that drops a leading zero fills four displays
    instead of five, and one that is drawn with a plain modulo hands out the
    lower codes slightly more often than the higher ones.
  * The answer from the server. It arrives as lines, like the manifest, and a
    reader that mistakes "state ready" without a token for a finished pairing
    stores an empty key - after which every sync blames the key.

So this compiles pair_format.h from the sketch with the same code the firmware
uses and checks what the device would really make of the answers app.py sends.
"""

from __future__ import annotations

import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build_reader(target: Path) -> None:
    result = subprocess.run(
        ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(ROOT / "tests" / "pair_dump.cpp")],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit("pair_dump does not compile:\n" + result.stderr)


def fields(output: str) -> dict[str, str]:
    out = {}
    for line in output.strip().split("\n"):
        key, _, value = line.partition(" ")
        out[key] = value
    return out


def check_limits(reader: Path, problems: list[str]) -> dict[str, str]:
    """The constants both sides of the pairing have to agree on.

    They are written down in docs/software.md as the contract with app.py. If
    one of them moves here, it has to move there too - a device drawing six
    digits and an interface offering five boxes is not something either side
    can notice on its own.
    """
    got = fields(subprocess.run([str(reader), "limits"], capture_output=True,
                                text=True, check=True).stdout)
    expected = {"digits": "5", "range": "100000", "limit": "4294900000",
                "secret_chars": "32", "device_chars": "12", "token_max": "96"}
    for key, value in expected.items():
        if got.get(key) != value:
            problems.append(f"{key} is {got.get(key)}, the contract says {value}")
    return got


def check_codes(reader: Path, problems: list[str]) -> int:
    """Every code is five digits, and it is the ones Python would name.

    Leading zeros included: 7 has to come out as "00007", because otherwise
    one of the five displays stays empty and nobody knows which.
    """
    drawn = [0, 7, 99999, 100000, 100001, 4294900000 - 1, 4294900000,
             4294967295]
    drawn += [random.getrandbits(32) for _ in range(200)]

    for number in drawn:
        got = fields(subprocess.run([str(reader), "code", str(number)],
                                    capture_output=True, text=True,
                                    check=True).stdout)
        want = f"{number % 100000:05d}"
        if got["code"] != want:
            problems.append(f"{number} becomes {got['code']}, expected {want}")
        if len(got["code"]) != 5:
            problems.append(f"{number} becomes {len(got['code'])} digits, not 5")
        # Below the limit the number may be used as it is; at or above it the
        # device has to draw again, or the lower codes come up more often.
        if got["usable"] != ("1" if number < 4294900000 else "0"):
            problems.append(f"{number} usable {got['usable']} - the rejection "
                            f"bound is wrong")
    return len(drawn)


# What the server sends, and what the device has to make of it. The awkward
# ones are here on purpose: CRLF because a different HTTP stack may send it,
# the unknown keyword because the server is allowed to gain fields, and
# "ready" without a token because that is the one that would store an empty
# key.
ANSWERS = [
    ("the pairing request was accepted",
     "ok 1\nexpires 180\ninterval 3\n",
     {"accepted": "1", "expires": "180", "interval": "3", "state": "unknown"}),
    ("nobody has typed the code yet",
     "state waiting\n",
     {"state": "waiting", "complete": "0", "token": ""}),
    ("confirmed, with the key",
     "state ready\ntoken n0tAr3alTok3n_but32characters00\n",
     {"state": "ready", "complete": "1",
      "token": "n0tAr3alTok3n_but32characters00"}),
    ("confirmed over CRLF",
     "state ready\r\ntoken abc\r\n",
     {"state": "ready", "complete": "1", "token": "abc"}),
    ("no newline at the end",
     "state ready\ntoken abc",
     {"state": "ready", "complete": "1", "token": "abc"}),
    ("the code was too old",
     "state expired\n",
     {"state": "expired", "complete": "0"}),
    ("too many wrong attempts",
     "state denied\n",
     {"state": "denied", "complete": "0"}),
    ("a keyword from a newer server is skipped",
     "state waiting\nhint press-the-button\nexpires 90\n",
     {"state": "waiting", "expires": "90", "complete": "0"}),
    ("a state this firmware does not know means keep waiting",
     "state dithering\n",
     {"state": "unknown", "complete": "0"}),
    ("ready without a token is not ready",
     "state ready\n",
     {"state": "ready", "complete": "0", "token": ""}),
    ("an empty token is not a token",
     "state ready\ntoken \n",
     {"state": "ready", "complete": "0", "token": ""}),
    ("nothing at all",
     "",
     {"state": "unknown", "complete": "0", "accepted": "0"}),
    ("a keyword with no value is ignored, not read past",
     "state\ntoken\nstate ready\ntoken abc\n",
     {"state": "ready", "complete": "1", "token": "abc"}),
    ("blank lines do no harm",
     "\n\nstate waiting\n\n",
     {"state": "waiting"}),
    ("a number that is not one comes out as zero",
     "state waiting\nexpires soon\n",
     {"state": "waiting", "expires": "0"}),
]


def check_answers(reader: Path, problems: list[str]) -> int:
    for name, body, expected in ANSWERS:
        got = fields(subprocess.run([str(reader), "parse"], input=body,
                                    capture_output=True, text=True,
                                    check=True).stdout)
        for key, value in expected.items():
            if got.get(key) != value:
                problems.append(f"{name}: {key} is {got.get(key)!r}, "
                                f"expected {value!r}")
    return len(ANSWERS)


def check_long_token(reader: Path, problems: list[str]) -> None:
    """A token longer than the buffer is cut off, and not written past it.

    Half a key stored under a whole key's name would look like a wrong key
    forever after, so the point is that it is cut cleanly - and that the
    reader is still standing afterwards.
    """
    huge = "z" * 400
    got = fields(subprocess.run([str(reader), "parse"],
                                input=f"state ready\ntoken {huge}\n",
                                capture_output=True, text=True,
                                check=True).stdout)
    if len(got["token"]) != 95:      # PAIR_TOKEN_MAX minus the terminating zero
        problems.append(f"a 400 character token came out as {len(got['token'])} "
                        f"characters, expected 95")


def main() -> int:
    random.seed(7)          # the same cases every run
    problems: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        reader = Path(tmp) / "pair_dump"
        build_reader(reader)
        check_limits(reader, problems)
        codes = check_codes(reader, problems)
        answers = check_answers(reader, problems)
        check_long_token(reader, problems)

    if problems:
        for problem in problems:
            print(f"  FAIL  {problem}")
        print(f"\n  {len(problems)} problem(s)")
        return 1
    print(f"  {codes} codes and {answers} answers read the way the device "
          f"will read them")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
