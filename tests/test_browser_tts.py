#!/usr/bin/env python3
"""Keeps the browser's copy of the speech pipeline in step with this one.

static/tts/level.js is a second implementation of the ffmpeg chain in tts.py,
and static/tts/voices.json is a second voice list next to VOICE_CATALOGUE.
Both exist for the same reason - a page with no server behind it cannot call
ffmpeg and cannot download the voices this can - and both would drift the same
way: silently, because nothing in either half reads the other.

What drift would look like:

  * KEEP_TAIL changed here, not there - the browser leaves a different amount
    of room at the end of a word than the container does, and two recordings
    of the same sentence differ while claiming the same fingerprint
  * a voice added to VOICE_CATALOGUE that no browser can speak with - it works
    for whoever added it, on the server, and turns into a silent slot for
    whoever opens the page
  * a low voice added to the browser list - vits-web dies on those, and the
    error is about a symbol table rather than about the voice

So this reads both files and compares. tests/test_piper_version.py is the same
idea for the piper pin.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import tts  # noqa: E402

LEVEL = ROOT / "static" / "tts" / "level.js"
VOICES = ROOT / "static" / "tts" / "voices.json"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    """Unlike its twin in test_piper_version.py, the detail is only printed
    when something failed: most of the checks below are one line each per
    voice, and their details are sentences about what to do rather than the
    value that was read."""
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"\n          {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def constants(source: str) -> dict[str, float]:
    """The exported numbers out of level.js, without running any JavaScript."""
    return {name: float(value) for name, value in
            re.findall(r"export const (\w+) = (-?[0-9.]+);", source)}


def main() -> int:
    source = LEVEL.read_text(encoding="utf-8")
    js = constants(source)

    # --- the filter chain, number by number ------------------------------
    # tts.SILENCE_THRESHOLD is a string with a unit on it because ffmpeg reads
    # it; level.js does the arithmetic itself and holds a number. Same value,
    # two shapes, and this is where they meet.
    threshold = float(tts.SILENCE_THRESHOLD.removesuffix("dB"))
    for name, here in [
        ("SAMPLE_RATE", tts.SAMPLE_RATE),
        ("SILENCE_THRESHOLD_DB", threshold),
        ("KEEP_HEAD", tts.KEEP_HEAD),
        ("KEEP_TAIL", tts.KEEP_TAIL),
        ("FADE", tts.FADE),
        ("TAIL_PAD", tts.TAIL_PAD),
    ]:
        check(f"level.js {name} matches tts.py",
              name in js and abs(js[name] - here) < 1e-9,
              f"level.js says {js.get(name)!r}, tts.py says {here!r}")

    # --- and the two halves of LOUDNORM ----------------------------------
    loudnorm = dict(part.split("=", 1) for part in tts.LOUDNORM.split(":"))
    check("level.js TARGET_LUFS matches the I in tts.LOUDNORM",
          abs(js.get("TARGET_LUFS", 0) - float(loudnorm["I"])) < 1e-9,
          f"level.js {js.get('TARGET_LUFS')!r}, tts.py {loudnorm['I']!r}")
    check("level.js TARGET_PEAK_DBTP matches the TP in tts.LOUDNORM",
          abs(js.get("TARGET_PEAK_DBTP", 0) - float(loudnorm["TP"])) < 1e-9,
          f"level.js {js.get('TARGET_PEAK_DBTP')!r}, tts.py {loudnorm['TP']!r}")

    # --- the voice list ---------------------------------------------------
    catalogue = json.loads(VOICES.read_text(encoding="utf-8"))
    usable = {v["id"]: v for v in catalogue["voices"]}
    rejected = {v["id"]: v for v in catalogue["rejected"]}

    check("no voice is both usable and rejected",
          not (usable.keys() & rejected.keys()),
          ", ".join(sorted(usable.keys() & rejected.keys())))

    for vid, voice in usable.items():
        missing = [f for f in ("name", "lang", "quality", "bytes", "licence", "proof")
                   if not voice.get(f)]
        check(f"{vid} says everything a picker needs", not missing,
              f"missing: {', '.join(missing)}")

    # The rule the spike measured: vits-web phonemizes against one fixed
    # symbol table, and every low and x_low model has a smaller one. Listing
    # such a voice as usable is not a judgement call that can go either way.
    for vid, voice in usable.items():
        check(f"{vid} is a quality vits-web can speak",
              voice["quality"] in ("medium", "high"),
              f"quality is {voice['quality']!r}")

    for vid, voice in rejected.items():
        check(f"{vid} says why it is out",
              voice.get("why") in ("quality", "reach", "licence"),
              f"why is {voice.get('why')!r}")

    # --- the link to VOICE_CATALOGUE --------------------------------------
    # The one that matters. Adding a voice to the container's catalogue is
    # easy and looks harmless; whether a browser can speak with it is a
    # separate question that nothing else asks.
    shipped = [entry.rsplit("/", 1)[-1]
               for entries in tts.VOICE_CATALOGUE.values() for entry in entries]
    for vid in shipped:
        check(f"VOICE_CATALOGUE's {vid} has an answer in voices.json",
              vid in usable or vid in rejected,
              "not mentioned either way - add it, or say why it cannot work")

    # And the finding this list was written for, asserted rather than left in
    # a document: two of the four voices the container ships cannot be spoken
    # in a browser, and one of them is the only German female voice there.
    unusable = [v for v in shipped if v in rejected]
    check("the browser list still knows which shipped voices it cannot speak",
          len(unusable) == 2 and set(unusable) == {"de_DE-kerstin-low", "en_US-john-medium"},
          f"expected kerstin-low and john-medium, found {unusable}")

    german_female = [v for v in usable.values()
                     if v["lang"] == "de" and v.get("gender") == "female"]
    check("there is still no German female voice for the browser",
          not german_female,
          "there is one now - update docs/browser-tts.md, which says there is not: "
          + ", ".join(v["id"] for v in german_female))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
