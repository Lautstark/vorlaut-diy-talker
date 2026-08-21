#!/usr/bin/env python3
"""Fetches the offline voices for vorlaut.

    python3 tools/voices.py            # all four
    python3 tools/voices.py de         # German only
    python3 tools/voices.py --list     # what is already there

The models land wherever tts.voice_target() points - the first entry of
tts.VOICE_DIRS, normally content/voices/ next to the rest of the content, so
they are backed up with it and survive every rebuild. With VORLAUT_VOICES set
they follow that instead, which is how the Dockerfile bakes the same four into
the image at /voices: this file rather than a curl of its own, so that where a
voice comes from is written down once.

Deliberately not in the repository: together they are about 250 MB - four
times 63 MB, the "low" one no smaller than the others - and they are somebody
else's files, downloaded fresh rather than copied along. Where they come from
and under which licence is in voices/LIZENZ.md.

The catalogue itself and the downloading live in tts.py, because the page
fetches voices too - one list, one place.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tts  # noqa: E402


def main(argv: list[str]) -> int:
    if "--list" in argv:
        found = tts.piper_models()
        if not found:
            print("No voice here yet. Fetch them with:  python3 tools/voices.py")
            return 1
        for stem, path in found.items():
            print(f"  {stem:28} {path}")
        return 0

    wanted = [a for a in argv if not a.startswith("-")] or list(tts.VOICE_CATALOGUE)
    unknown = [w for w in wanted if w not in tts.VOICE_CATALOGUE]
    if unknown:
        print(f"Unknown: {', '.join(unknown)}. "
              f"Available: {', '.join(tts.VOICE_CATALOGUE)}")
        return 2

    for language in wanted:
        missing = set(tts.missing_voices(language))
        for entry in tts.VOICE_CATALOGUE[language]:
            name = entry.rsplit("/", 1)[-1]
            if entry not in missing:
                print(f"  {name} is already there")
                continue
            print(f"  {name}")
            try:
                tts.download_voice(entry, note=lambda line: print(f"    {line}"))
            except tts.TTSError as exc:
                print(f"  {exc}")
                return 1

    print(f"\nIn {tts.voice_target()}:")
    for stem in tts.piper_models():
        print(f"  {stem}")
    print("\nPick one on the page, or with:  python3 tts.py --voices")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
