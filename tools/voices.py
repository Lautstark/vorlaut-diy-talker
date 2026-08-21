#!/usr/bin/env python3
"""Fetches the offline voices for vorlaut.

    python3 tools/voices.py            # all four
    python3 tools/voices.py de         # German only
    python3 tools/voices.py --list     # what is already there

The models land in content/voices/ next to the rest of the content, so they
are backed up with it and survive every rebuild of the container - unlike
inside the image, where every new voice would mean building it again.

Deliberately not in the repository: together they are about 130 MB, and they
are somebody else's files, downloaded fresh rather than copied along.
"""

from __future__ import annotations

import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tts  # noqa: E402

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

# Two German and two English voices, one male and one female each. All four
# are public domain - which is what lets them be handed on. Most of piper's
# better known English voices are not; before adding one, read its MODEL_CARD
# next to the model, not the file name.
#
# ljspeech would be the obvious English pick and is public domain too, but it
# is the name of a dataset, and in a list of first names it reads like an
# error. Kristin is just as free and sits better among the others.
VOICES = {
    "de": [
        "de/de_DE/thorsten/medium/de_DE-thorsten-medium",
        "de/de_DE/kerstin/low/de_DE-kerstin-low",
    ],
    "en": [
        "en/en_US/kristin/medium/en_US-kristin-medium",
        "en/en_US/john/medium/en_US-john-medium",
    ],
}

# A model is only usable together with its .onnx.json - that file is piper's
# own description of the voice, and without it the model is just a blob.
PARTS = (".onnx", ".onnx.json")

TRIES = 5


def target_dir() -> Path:
    """Where a fetched voice belongs.

    The first entry of VOICE_DIRS is where tts.py looks first, so a voice put
    there is the one that gets found.
    """
    return tts.VOICE_DIRS[0]


def fetch(url: str, target: Path) -> None:
    """Downloads one file, and does not give up on the first hiccup.

    This hangs off somebody else's server. A single failed request used to be
    enough to leave half a voice on the disk.
    """
    last: Exception | None = None
    for attempt in range(1, TRIES + 1):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read()
            # Write only once it is complete: a half file next to a whole
            # .onnx.json looks like a usable voice and is not one.
            part = target.with_suffix(target.suffix + ".part")
            part.write_bytes(data)
            part.replace(target)
            return
        except (urllib.error.URLError, OSError) as exc:
            last = exc
            print(f"    attempt {attempt} of {TRIES} failed: {exc}")
    raise SystemExit(f"  {target.name} could not be fetched: {last}")


def main(argv: list[str]) -> int:
    if "--list" in argv:
        found = tts.piper_models()
        if not found:
            print("No voice here yet. Fetch them with:  python3 tools/voices.py")
            return 1
        for stem, path in found.items():
            print(f"  {stem:28} {path}")
        return 0

    wanted = [a for a in argv if not a.startswith("-")] or list(VOICES)
    unknown = [w for w in wanted if w not in VOICES]
    if unknown:
        print(f"Unknown: {', '.join(unknown)}. Available: {', '.join(VOICES)}")
        return 2

    folder = target_dir()
    folder.mkdir(parents=True, exist_ok=True)
    for language in wanted:
        for voice in VOICES[language]:
            name = voice.rsplit("/", 1)[-1]
            if all((folder / f"{name}{part}").exists() for part in PARTS):
                print(f"  {name} is already there")
                continue
            print(f"  {name}")
            for part in PARTS:
                fetch(f"{BASE}/{voice}{part}", folder / f"{name}{part}")

    print(f"\nIn {folder}:")
    for stem in tts.piper_models():
        print(f"  {stem}")
    print("\nPick one on the page, or with:  python3 tts.py --voices")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
