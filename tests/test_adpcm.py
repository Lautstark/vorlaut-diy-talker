#!/usr/bin/env python3
"""The browser compresses a recording and the firmware plays the same word back.

The four words in example/speech/ are what the recording chain synthesised
while there was still a Python half to ask, and they are the only real speech
this repository holds. What they are used for here is a third opinion that
neither implementation of the *codec* had a hand in: the browser encodes them,
the firmware's own decoder - compiled from firmware/vorlaut/adpcm_format.h on
the machine running this - reads what it wrote, and the original samples say
whether the word came back.

That is the shape tests/test_tile_compression.py has, and the same thing makes
it worth running: neither half is compared against itself. An encoder checked
only by its own decoder agrees with itself no matter what it does, and IMA
ADPCM is exactly the format where that goes wrong quietly - the predictor is
carried from one sample to the next, so two tables that differ in one entry
produce a word that drifts into noise over its own length rather than one that
fails at the first byte.

  the round trip     encodeAdpcmWav() in loader/src/audio_encode.ts, then
                     seekToWavData() and adpcmDecodeBlock() out of
                     wav_format.h and adpcm_format.h, against the recording
                     that went in. Needs node and a C++ compiler.
  the two rules      that the compressed form is about a quarter of the size,
                     and that a file the device was already reading still
                     reads as PCM - the tag in fmt is the only thing that says
                     which form a recording is in.

What the *container* does with a file that is truncated, not a RIFF, or at the
wrong rate is not here. That is device/fixtures/audio/, where the rest of this
boundary's behaviour is already stated.
"""

from __future__ import annotations

import math
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEECH = ROOT / "example" / "speech"
JS_RUNNER = ROOT / "node_modules" / ".bin" / "vite-node"

WAV_FORMAT_PCM = 0x0001
WAV_FORMAT_IMA_ADPCM = 0x0011
BLOCK_BYTES = 256
BLOCK_SAMPLES = 1 + (BLOCK_BYTES - 4) * 2

# What the quantiser is allowed to cost, in dB of signal to noise, measured on
# these four words on 2026-09-01: "Ja!" 15.0, "Stopp" 17.7, "Nein!" 18.2, "Hilf
# mir" 28.3. Those are low-looking numbers and they are what this codec does on
# this material rather than a fault - ffmpeg's own adpcm_ima_wav encoder, asked
# the same question on the same day with the same block size, answers 14.9,
# 18.1, 18.7 and 28.2. The three loud short words are transients: "Ja!" jumps
# 17167 between two neighbouring samples, and four bits a sample cannot follow
# that without the step size climbing behind it.
#
# The bound is 12 rather than the worst of them because of what it is for. It
# catches a codec that has broken - one wrong entry in either table takes this
# to single digits or below zero within a syllable - and it does not freeze
# four numbers that a different block size would move for a good reason.
# Whether 15 dB is good enough to be understood is not a question a test
# answers; it is why the form is chosen per file and why adr/0021 says a
# collection that is spoken to somebody should stay in PCM.
SNR_FLOOR_DB = 12.0

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def build(target: Path) -> bool:
    """The firmware's decoder, compiled here rather than frozen."""
    compiler = shutil.which("g++") or shutil.which("clang++")
    if not compiler:
        return False
    result = subprocess.run(
        [compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", "-O1",
         "-o", str(target), str(ROOT / "tests" / "adpcm_dump.cpp")],
        capture_output=True, text=True)
    if result.returncode != 0:
        check("the firmware's decoder compiles", False,
              result.stderr.strip()[:600])
        return False
    check("the firmware's decoder compiles", True)
    return True


def encoded_by_the_browser() -> dict[str, tuple[bytes, bytes]] | None:
    """Every example recording, run through loader/src/audio_encode.ts.

    Answers name -> (the compressed WAV, the PCM the browser reads back out of
    it). The second half is what makes a disagreement legible: if the two
    decoders differ, this says which of them moved.
    """
    if not JS_RUNNER.exists():
        return None
    result = subprocess.run([str(JS_RUNNER), str(ROOT / "tests" / "adpcm_node.mjs")],
                            capture_output=True, text=True, cwd=ROOT)
    if result.returncode != 0:
        check("the browser's encoder runs", False, result.stderr.strip()[:600])
        return {}
    check("the browser's encoder runs", True)

    files: dict[str, bytes] = {}
    pcm: dict[str, bytes] = {}
    for line in result.stdout.splitlines():
        kind, _, rest = line.partition(" ")
        name, _, payload = rest.partition(" ")
        if kind == "file":
            files[name] = bytes.fromhex(payload)
        elif kind == "pcm":
            pcm[name] = b"" if payload == "NOTADPCM" else bytes.fromhex(payload)
    return {name: (files[name], pcm.get(name, b"")) for name in files}


def said_by_the_firmware(reader: Path, wav: bytes, work: Path) -> dict[str, str]:
    """One file through tests/adpcm_dump.cpp - what the device would play."""
    path = work / "one.wav"
    path.write_bytes(wav)
    out = subprocess.run([str(reader), str(path)], capture_output=True, text=True)
    said: dict[str, str] = {}
    for line in out.stdout.splitlines():
        key, _, value = line.partition(" ")
        said[key] = value
    return said


def data_chunk(wav: bytes) -> tuple[int, bytes]:
    """The format tag and the data chunk of a WAV, by walking it.

    A third reader of the container, and deliberately so: the browser's and the
    firmware's are the two under test, and a test that used either of them to
    say what went in would be quoting one of the answers back at itself.
    """
    tag = WAV_FORMAT_PCM
    data = b""
    at = 12
    while at + 8 <= len(wav):
        name = wav[at:at + 4].decode("latin1")
        size = struct.unpack("<I", wav[at + 4:at + 8])[0]
        if name == "fmt " and size >= 16:
            tag = struct.unpack("<H", wav[at + 8:at + 10])[0]
        elif name == "data":
            data = wav[at + 8:at + 8 + min(size, len(wav) - at - 8)]
        at += 8 + size + (size % 2)
    return tag, data


def samples_of(data: bytes) -> list[int]:
    return list(struct.unpack(f"<{len(data) // 2}h", data[:len(data) // 2 * 2]))


def snr_db(original: list[int], heard: list[int]) -> float:
    """How far the word that comes out is from the word that went in."""
    n = min(len(original), len(heard))
    signal = sum(float(s) * s for s in original[:n])
    noise = sum((float(a) - b) ** 2 for a, b in zip(original[:n], heard[:n]))
    if noise == 0:
        return math.inf
    return 10 * math.log10(signal / noise) if signal else -math.inf


def main() -> int:
    print("The browser compresses a recording and the firmware plays it back")

    recordings = sorted(SPEECH.glob("*.wav"))
    check("there are recordings to run this on", bool(recordings),
          f"{len(recordings)} in example/speech/")
    if not recordings:
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        reader = work / "adpcm_dump"
        if not build(reader):
            print("\nNo C++ compiler - skipping.")
            return 0

        # The plain form first, and it is not a formality. seekToWavData() grew
        # a fmt reader for this task, and every talker in the field depends on
        # it walking past exactly the same bytes it always did.
        for one in recordings:
            said = said_by_the_firmware(reader, one.read_bytes(), work)
            tag, data = data_chunk(one.read_bytes())
            check(f"{one.stem[:8]}: the firmware still reads the recording as PCM",
                  said.get("accepts") == "1"
                  and said.get("format_tag") == str(WAV_FORMAT_PCM)
                  and said.get("pcm", "") == data.hex(),
                  f"tag {said.get('format_tag', '-')}, "
                  f"{said.get('samples', '-')} samples")
            check(f"{one.stem[:8]}: and it is the 16 kHz mono PCM the build writes",
                  tag == WAV_FORMAT_PCM)

        made = encoded_by_the_browser()
        if made is None:
            print("\nNo vite-node - skipping the browser's half.")
            return 1 if failures else 0
        if not made:
            return 1

        for one in recordings:
            name = one.stem
            if name not in made:
                check(f"{name[:8]}: the browser encoded it", False)
                continue
            encoded, browser_pcm = made[name]
            was = one.read_bytes()
            original = samples_of(data_chunk(was)[1])

            tag, blocks = data_chunk(encoded)
            check(f"{name[:8]}: it comes out as WAVE format tag 0x11",
                  tag == WAV_FORMAT_IMA_ADPCM, f"0x{tag:04x}")
            check(f"{name[:8]}: and as whole blocks of {BLOCK_BYTES} bytes",
                  len(blocks) > 0 and len(blocks) % BLOCK_BYTES == 0,
                  f"{len(blocks)} bytes")

            said = said_by_the_firmware(reader, encoded, work)
            check(f"{name[:8]}: the firmware accepts it and sees the tag",
                  said.get("accepts") == "1"
                  and said.get("format_tag") == str(WAV_FORMAT_IMA_ADPCM)
                  and said.get("block_align") == str(BLOCK_BYTES),
                  f"tag {said.get('format_tag', '-')}, "
                  f"block {said.get('block_align', '-')}")

            device_pcm = bytes.fromhex(said.get("pcm", ""))
            # The check this whole file exists for, and it is exact rather
            # than "close enough": the two decoders are the same arithmetic
            # written twice, so anything but identical samples is one of them
            # having drifted.
            # The browser hands back a whole WAV and the firmware hands back
            # the samples, so the container comes off before they are compared.
            browser_samples = data_chunk(browser_pcm)[1] if browser_pcm else b""
            check(f"{name[:8]}: both decoders produce the same samples, byte for byte",
                  device_pcm == browser_samples,
                  f"{len(device_pcm)} against {len(browser_samples)} bytes")

            heard = samples_of(device_pcm)
            check(f"{name[:8]}: the whole word comes back",
                  len(heard) >= len(original),
                  f"{len(heard)} samples for {len(original)}")
            # Every block states its own first sample verbatim in its header,
            # so those come back untouched however the quantiser did in
            # between - which is the one place the round trip is lossless.
            exact = all(heard[at] == original[at]
                        for at in range(0, min(len(heard), len(original)), BLOCK_SAMPLES))
            check(f"{name[:8]}: and every block's first sample is exact", exact)

            quality = snr_db(original, heard)
            check(f"{name[:8]}: it is still the word, at {SNR_FLOOR_DB:.0f} dB or better",
                  quality >= SNR_FLOOR_DB, f"{quality:.1f} dB")

            factor = len(was) / len(encoded)
            check(f"{name[:8]}: and it is about a quarter of the size",
                  factor > 3.5, f"factor {factor:.2f}")

    if failures:
        print(f"\n{len(failures)} failed:")
        for one in failures:
            print(f"  {one}")
        return 1
    print("\nAll good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
