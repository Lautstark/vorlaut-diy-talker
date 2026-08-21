#!/usr/bin/env python3
"""Checks that the pre-rendered example sentences still match their names.

example/speech/ holds the four sentences from example/layout.json, already
spoken. They are what makes a freshly flashed device talk instead of showing
"keine Inhalte", and what lets CI build a release image with sound without an
Azure key.

The catch is that a file in there is found by its name, and the name is the
fingerprint of the text *and* the voice configuration. Change
AZURE_SPEECH_VOICE, AZURE_SPEECH_RATE or PIPELINE_VERSION in tts.py and the
files stop matching - silently. The build then produces the same layout with
four silent keys, and nothing in its output says why.

So this compares the names against what tts.fingerprint() produces today. If
it fails, the fix is to re-record the four sentences and update index.json,
not to change this test.

voice.json records the configuration the files were made with, so a failure
can say which setting moved rather than only that the names no longer match.
That matters locally, where a developer's own .env may set a different voice:
then it is their setting that is talking, not a broken repository.
"""

from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(ROOT))
import tts  # noqa: E402
from layout import (EXAMPLE, EXAMPLE_SPEECH, example_voice,  # noqa: E402
                    load_layout)

# What the device plays: 16 kHz mono 16 bit. The firmware feeds I2S from it
# without converting, so a stray 44.1 kHz file would come out at the wrong
# pitch rather than not at all.
EXPECTED_RATE = 16000
EXPECTED_CHANNELS = 1
EXPECTED_WIDTH = 2


def sentences() -> list[str]:
    layout = load_layout(EXAMPLE / "layout.json")
    return [slot["text"] for entry in layout["sets"]
            for slot in entry["slots"] if slot["text"]]


def main() -> int:
    speech = EXAMPLE_SPEECH
    failures: list[str] = []

    # First, so that everything after it can be read in the right light: if
    # the voice configuration has moved, every name below moves with it and
    # the individual failures are all the same one failure.
    recorded = json.loads((speech / "voice.json").read_text(encoding="utf-8"))
    # Which voice these were made with is derived from the recording
    # itself - since piper there is more than one backend, and the id
    # decides the shape of the configuration.
    voice = example_voice() or (
        f"piper:{recorded.get('model', '')}"
        if recorded.get("backend") == "piper"
        else f"azure:{recorded.get('voice', '')}")
    current = tts.voice_config(voice)
    moved = sorted(k for k in set(recorded) | set(current)
                   if recorded.get(k) != current.get(k))
    if moved:
        print("  The voice configuration is not the one these files were "
              "made with:")
        for key in moved:
            print(f"    {key}: recorded {recorded.get(key)!r}, "
                  f"now {current.get(key)!r}")
        print("\n  Either a local .env is setting it, or tts.py changed. In "
              "the second case")
        print("  the four sentences need re-recording; voice.json and "
              "index.json go with them.")
        return 1

    texts = sentences()
    if not texts:
        print("  example/layout.json has no sentences at all")
        return 1

    wanted: dict[str, str] = {}
    for text in texts:
        key = tts.fingerprint(text, voice)
        wanted[key] = text
        file = speech / f"{key}.wav"
        if not file.exists():
            failures.append(
                f'"{text}" has no recording - expected {file.name}')
            continue
        try:
            with wave.open(str(file)) as handle:
                rate = handle.getframerate()
                channels = handle.getnchannels()
                width = handle.getsampwidth()
                frames = handle.getnframes()
        except (wave.Error, OSError) as exc:
            failures.append(f"{file.name} is not a readable WAV: {exc}")
            continue
        if (rate, channels, width) != (EXPECTED_RATE, EXPECTED_CHANNELS,
                                       EXPECTED_WIDTH):
            failures.append(
                f"{file.name} is {rate} Hz, {channels} channel(s), "
                f"{width * 8} bit - expected {EXPECTED_RATE} Hz, mono, 16 bit")
        if not frames:
            failures.append(f"{file.name} contains no audio at all")

    # Files nobody asks for. Not fatal on their own, but they are dead weight
    # in the image and usually the leftovers of a changed sentence.
    for file in sorted(speech.glob("*.wav")):
        if file.stem not in wanted:
            failures.append(
                f"{file.name} belongs to no sentence in example/layout.json")

    # index.json is what makes the hashed names readable again, and build.py
    # copies it into the cache. An entry that names the wrong text would put
    # a wrong sentence into somebody's cache index.
    index_file = speech / "index.json"
    if not index_file.exists():
        failures.append("index.json is missing")
    else:
        index = json.loads(index_file.read_text(encoding="utf-8"))
        for key, text in sorted(wanted.items()):
            if index.get(key) != text:
                failures.append(
                    f'index.json says {index.get(key)!r} for {key}, '
                    f'expected "{text}"')
        for key in sorted(set(index) - set(wanted)):
            failures.append(f"index.json has a leftover entry for {key}")

    if failures:
        for line in failures:
            print(f"  {line}")
        print(f"\n  {len(failures)} problem(s) with the example recordings.")
        print("  Re-record them and update index.json - the voice "
              "configuration decides the names.")
        return 1

    total = sum(f.stat().st_size for f in speech.glob("*.wav"))
    print(f"  {len(wanted)} example sentence(s) recorded, "
          f"{total / 1024:.0f} KiB, voice {tts.voice_name(voice)}")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
