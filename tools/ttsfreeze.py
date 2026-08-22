#!/usr/bin/env python3
"""Freezes what real ffmpeg says about the speech chain, before it is gone.

    python3 tools/ttsfreeze.py            # rewrite tests/reference/tts.lock.json
    python3 tools/ttsfreeze.py --check    # measure again, change nothing, report

static/tts/level.js is the browser's copy of the ffmpeg chain in tts.py, and
until now nothing in the suite ran it. tests/test_browser_tts.py reads the
constants out of it and compares them with tts.py - correct constants over
wrong arithmetic passes every one of those checks. The arithmetic was only
ever measured by hand, through tools/ttscheck.py, and the result lives as a
table in docs/browser-tts.md that nothing regenerates.

That was survivable while tts.py was here. It stops being survivable the day
the Python half goes, because then level.js is the only implementation left
and there is nothing outside it to hold it to. A test that can only compare a
thing against itself passes forever - which is the shape of the failure the
sibling project found in ~/Code/mitreden: its browser audio tests measured the
output with the same function that had decided the gain.

So this runs while there is still an ffmpeg and a tts.py to run, and writes
down what they said. tests/browser/level.test.mjs then checks level.js against
those numbers without needing either. The numbers are an outside opinion,
frozen; if they and level.js ever disagree, the fault is in level.js.

Three kinds of reference, and each answers a different question:

  tones        does the ruler read true? integratedLufs() is what decides the
               gain, so measuring the output with it proves nothing. ffmpeg's
               loudnorm reads the same tones and is nobody's friend here.

  peaks        is the peak found between the samples? truePeakDb() sets the
               headroom, and a naive maximum over the samples is 3 dB wrong on
               a signal whose peaks fall between two of them.

  utterances   does the whole chain land where tts.py lands? Each input WAV
               goes through tts.postprocess() - real ffmpeg, the oracle - and
               the finished file is measured. level.js has to reach the same
               place from the same bytes.

The tone parameters are frozen rather than the tone files: a sine is four
numbers and generating it is one line, so there is nothing for two generators
to disagree about. The utterances are frozen as bytes, because their shape is
not a one-liner and because what the trim does to them depends on the actual
samples. Their sha256 is in the lock file, so an edited fixture is a failure
rather than a quietly wrong reference.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import tts  # noqa: E402

REFERENCE = ROOT / "tests" / "reference"
FIXTURES = REFERENCE / "tts"
LOCK = REFERENCE / "tts.lock.json"

# The rate the loudness filters are defined at. level.js resamples to it
# before measuring, so anything frozen for integratedLufs() is at this rate.
MEASURE_RATE = 48000
# What piper speaks at, and therefore the rate the chain actually gets handed.
PIPER_RATE = 22050


# --- The signals -------------------------------------------------------------

# Why these and not four convenient ones. Each is somewhere the K weighting is
# doing something different, so a filter that is merely plausible fails at
# least one of them:
#
#   1000 Hz   the anchor. K weighting is flat here by construction, so this
#             one is really a check that the gating and the -0.691 offset are
#             right, and a wrong filter can still pass it.
#   440 Hz    deliberately not flat, and mitreden froze the same tone for the
#             same reason. Keeping the two projects on one number matters more
#             than picking a prettier one.
#   60 Hz     the second stage is a high pass, and this is the only tone here
#             far enough down its skirt to notice whether it exists.
#   10000 Hz  the first stage is a head shelf, and this is where it has fully
#             taken effect. A chain missing the shelf reads this 3.4 dB low.
#
# Two amplitudes at 1000 Hz, 14 dB apart, because a measurement can be right
# about the shape of a signal and wrong about its size.
TONES = [
    {"name": "1000 Hz at 0.1", "freq": 1000, "amp": 0.1,
     "why": "the anchor: K weighting is flat here, so this checks the gating"},
    {"name": "1000 Hz at 0.5", "freq": 1000, "amp": 0.5,
     "why": "the same tone 14 dB louder - level, not just shape"},
    {"name": "440 Hz at 0.2", "freq": 440, "amp": 0.2,
     "why": "K weighting is deliberately not flat here; mitreden froze it too"},
    {"name": "60 Hz at 0.5", "freq": 60, "amp": 0.5,
     "why": "down the high pass skirt - the stage nothing else here touches"},
    {"name": "10000 Hz at 0.2", "freq": 10000, "amp": 0.2,
     "why": "up on the head shelf - a chain without it reads this low"},
]
TONE_SECONDS = 3.0

# A sine at a quarter of the sample rate, offset by an eighth of a cycle, is
# the worst case for a peak meter: every sample lands at cos(45 degrees) of
# the real peak, so the waveform is 3 dB louder than any sample in it. 16 kHz
# because that is the rate the finished file is written at, and truePeakDb()
# is called on it there.
PEAKS = [
    {"name": "4000 Hz at 0.5, sampled off the peaks", "amp": 0.5},
    {"name": "4000 Hz at 0.25, sampled off the peaks", "amp": 0.25},
]
PEAK_RATE = 16000
PEAK_SECONDS = 2.0

# Down from piper's rate to the device's, which is the resampling the chain
# actually does, and the two things that can go wrong with it.
#
# A tone below the new Nyquist rate has to come through at the level it went
# in at: a resampler that forgets to normalise its kernel changes the loudness
# of every sentence and nothing downstream would say so.
#
# A tone above it has to disappear. 10 kHz cannot exist in a 16 kHz file, so a
# correct resampler throws it away and a naive one folds it back to 6050 Hz at
# very nearly full level. The gap between those two answers is about 50 dB,
# which is not a tolerance question.
RESAMPLING = [
    {"name": "1000 Hz survives the way down", "freq": 1000, "amp": 0.2,
     "expect": "kept",
     "why": "well under the new Nyquist rate, so the level must not move"},
    {"name": "10000 Hz cannot survive it", "freq": 10000, "amp": 0.2,
     "expect": "gone",
     "why": "above the new Nyquist rate; a resampler without a low pass "
            "folds it back to 6050 Hz instead of removing it"},
]
RESAMPLE_FROM, RESAMPLE_TO, RESAMPLE_SECONDS = PIPER_RATE, 16000, 3.0


def tone(freq: float, amp: float, seconds: float, rate: int,
         phase: float = 0.0) -> list[float]:
    return [amp * math.sin(2 * math.pi * freq * i / rate + phase)
            for i in range(round(seconds * rate))]


def utterance(seconds: float, lead: float, tail: float, amp: float,
              burst: tuple[float, float] | None = None,
              spike: float | None = None, rate: int = PIPER_RATE) -> list[float]:
    """A sentence-shaped noise: something that starts, wobbles and stops.

    Speech is not two sine waves, but what is being checked is level, trim and
    headroom, and for those a signal with no randomness in it is the harder
    test - there is nowhere for a difference to hide, and piper could not have
    provided one anyway. It renders the same sentence differently every time.

    The slow envelope is not decoration: without it every 400 ms block has the
    same power, the relative gate has nothing to drop, and a chain that
    ignored the gate entirely would still get the right answer.
    """
    total = round((lead + seconds + tail) * rate)
    x = [0.0] * total
    first, last = round(lead * rate), round((lead + seconds) * rate)
    for i in range(first, last):
        t = (i - first) / rate
        x[i] = (amp * (math.sin(2 * math.pi * 220 * t)
                       + 0.5 * math.sin(2 * math.pi * 440 * t))
                * (0.6 + 0.4 * math.sin(2 * math.pi * 3 * t)))
    if burst is not None:
        loud, length = burst
        start = round((lead + seconds * 0.45) * rate)
        end = min(start + round(length * rate), last)
        for i in range(start, end):
            shape = math.sin(math.pi * (i - start) / (end - start)) ** 2
            x[i] += loud * shape * math.sin(2 * math.pi * 1800 * (i - start) / rate)
    if spike is not None:
        x[round((lead + seconds / 2) * rate)] = spike
    return x


# Short body, short silences: every one of these is a fixture in the
# repository, and a second of 22 kHz audio is 44 kB whether it is earning its
# place or not.
UTTERANCES = {
    "quiet": {
        "why": "thirty decibels of gain and nothing in the way of it",
        "signal": dict(seconds=0.9, lead=0.2, tail=0.2, amp=0.01),
        "compare": True,
    },
    "loud": {
        "why": "the gain the other way round, so a sign error cannot hide",
        "signal": dict(seconds=0.9, lead=0.2, tail=0.2, amp=0.6),
        "compare": True,
    },
    "short": {
        "why": "shorter than the 400 ms block BS.1770 wants, which is the "
               "path with no standard behind it - 'Ja!' trimmed hard",
        "signal": dict(seconds=0.25, lead=0.2, tail=0.2, amp=0.08),
        "compare": True,
    },
    "burst": {
        "why": "a consonant loud enough that reaching the target would "
               "breach the ceiling: the gain has to give way, and this is "
               "the only case where truePeakDb decides the answer",
        "signal": dict(seconds=0.9, lead=0.2, tail=0.2, amp=0.008,
                       burst=(0.85, 0.03)),
        "compare": True,
    },
    "spike": {
        # Kept, and kept out of the comparison. See "disagreements" in the
        # lock file: one sample at full scale is not a sound, and the two
        # implementations answer it differently by 3.3 LU. What is worth
        # checking is that neither of them clips or crashes.
        "why": "one sample at full scale - a click, not a sound. Properties "
               "only; ffmpeg and level.js do not agree here",
        "signal": dict(seconds=0.9, lead=0.2, tail=0.2, amp=0.01, spike=0.98),
        "compare": False,
    },
}


# --- WAV, and measuring it ---------------------------------------------------

def wav16(samples: list[float], rate: int) -> bytes:
    """16 bit PCM mono, rounded exactly the way level.js encodeWav does.

    The asymmetry is deliberate there and copied here: -1 has an integer and
    +1 does not, so rounding +1 to 32768 wraps to the loudest possible
    negative sample. Writing fixtures a different way would put a click in
    them that only one of the two implementations could see.
    """
    body = bytearray()
    for v in samples:
        v = max(-1.0, min(1.0, v))
        body += struct.pack("<h", round(v * 32768) if v < 0 else round(v * 32767))
    return (b"RIFF" + struct.pack("<I", 36 + len(body)) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(body)) + bytes(body))


def ffmpeg_binary() -> str:
    found = shutil.which("ffmpeg")
    if not found:
        raise SystemExit(
            "This freezes what real ffmpeg says, so it needs a real ffmpeg.\n"
            "Without one there is nothing to write down - and the numbers "
            "already in tests/reference/tts.lock.json are the point of the "
            "exercise, so they are not regenerated from anything else.")
    return found


def ffmpeg_version() -> str:
    out = subprocess.run([ffmpeg_binary(), "-version"], capture_output=True,
                         text=True).stdout
    return out.splitlines()[0].strip() if out else "unknown"


# Two instruments, on purpose, and which one is right depends on the question.
#
# ebur128 is BS.1770 and nothing else, and it is what mitreden froze its three
# tones with. The tones and the peaks below are the same measurement in both
# projects, so they are read the same way here - a reference that differed by
# 0.05 LU between two repositories for no reason anybody could name would be
# worse than no shared reference at all.
#
# loudnorm in measurement mode is what tools/ttscheck.py already uses, and it
# is the right one for a finished file: it reports what the filter tts.py runs
# found before it would have changed anything. The utterances go through that.
#
# Both print more digits into metadata than into their summary, and the
# tolerances downstream are tight enough to want them.
def ebur128(path: Path) -> dict:
    """Integrated loudness and true peak, straight out of BS.1770."""
    result = subprocess.run(
        [ffmpeg_binary(), "-hide_banner", "-nostats", "-i", str(path),
         "-af", "ebur128=peak=true:metadata=1,ametadata=print:file=-",
         "-f", "null", "-"], capture_output=True, text=True)
    # The running values, one set per 100 ms frame. The last set is the
    # answer for the whole file, which is what "integrated" means.
    lufs = re.findall(r"lavfi\.r128\.I=(-?[\d.]+|-?inf)", result.stdout)
    peak = re.findall(r"lavfi\.r128\.true_peak=([\d.]+)", result.stdout)
    if not lufs:
        raise SystemExit(f"ffmpeg said nothing measurable about {path.name}:\n"
                         f"{result.stderr.strip()[-600:]}")
    linear = float(peak[-1]) if peak else 0.0
    return {"lufs": float(lufs[-1]),
            "peak": round(20 * math.log10(linear), 3) if linear else -float("inf")}


MEASURE = f"loudnorm={tts.LOUDNORM}:print_format=json"


def measure(path: Path) -> dict:
    """What the filter in tts.py found, before it would have changed anything."""
    result = subprocess.run(
        [ffmpeg_binary(), "-hide_banner", "-nostats", "-i", str(path),
         "-af", MEASURE, "-f", "null", "-"], capture_output=True, text=True)
    found = re.search(r"\{[^{}]*\}", result.stderr)
    if not found:
        raise SystemExit(f"ffmpeg said nothing measurable about {path.name}:\n"
                         f"{result.stderr.strip()[-600:]}")
    numbers = json.loads(found.group(0))
    return {"lufs": float(numbers["input_i"]),
            "peak": float(numbers["input_tp"]),
            "lra": float(numbers["input_lra"])}


def resampled_by_ffmpeg(source: Path, target: Path, rate: int) -> None:
    subprocess.run([ffmpeg_binary(), "-y", "-hide_banner", "-loglevel", "error",
                    "-i", str(source), "-ar", str(rate), "-ac", "1",
                    "-c:a", "pcm_s16le", str(target)], check=True)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --- Building the lock -------------------------------------------------------

def build(work: Path) -> dict:
    ffmpeg = ffmpeg_version()
    print(f"  measuring with {ffmpeg}")

    tones = []
    for spec in TONES:
        path = work / f"tone-{spec['freq']}-{spec['amp']}.wav"
        path.write_bytes(wav16(tone(spec["freq"], spec["amp"], TONE_SECONDS,
                                    MEASURE_RATE), MEASURE_RATE))
        read = ebur128(path)
        tones.append({**spec, "rate": MEASURE_RATE, "seconds": TONE_SECONDS,
                      "lufs": read["lufs"]})
        print(f"    {spec['name']:<24} {read['lufs']:>8.2f} LUFS")

    peaks = []
    for spec in PEAKS:
        # A quarter of the rate, an eighth of a cycle along.
        freq = PEAK_RATE / 4
        path = work / f"peak-{spec['amp']}.wav"
        path.write_bytes(wav16(tone(freq, spec["amp"], PEAK_SECONDS, PEAK_RATE,
                                    math.pi / 4), PEAK_RATE))
        read = ebur128(path)
        # Two more opinions, and they are worth having next to ffmpeg's.
        # The waveform is a sine, so its real peak is its amplitude and needs
        # no measuring at all; and the loudest sample is what a peak meter
        # that never resampled would report.
        peaks.append({
            **spec, "freq": freq, "rate": PEAK_RATE, "seconds": PEAK_SECONDS,
            "phase": "pi/4",
            "ffmpeg_peak_dbtp": read["peak"],
            "analytic_peak_dbtp": round(20 * math.log10(spec["amp"]), 2),
            "sample_peak_dbfs": round(
                20 * math.log10(spec["amp"] * math.cos(math.pi / 4)), 2),
        })
        print(f"    {spec['name']:<24} ffmpeg {read['peak']:>7.2f} dBTP, "
              f"samples {peaks[-1]['sample_peak_dbfs']:>7.2f} dBFS")

    # Each tone measured before and after ffmpeg's own resampler has taken it
    # down to the device's rate. ffmpeg's resampler is not level.js's and the
    # two will not agree to the decimal in the stopband - what is frozen here
    # is which side of a fifty decibel gap each tone ends up on.
    resampling = []
    for spec in RESAMPLING:
        raw = work / f"resample-{spec['freq']}-raw.wav"
        raw.write_bytes(wav16(tone(spec["freq"], spec["amp"], RESAMPLE_SECONDS,
                                   RESAMPLE_FROM), RESAMPLE_FROM))
        down = work / f"resample-{spec['freq']}-down.wav"
        resampled_by_ffmpeg(raw, down, RESAMPLE_TO)
        entry = {**spec, "from": RESAMPLE_FROM, "to": RESAMPLE_TO,
                 "seconds": RESAMPLE_SECONDS,
                 "lufs_before": ebur128(raw)["lufs"],
                 "lufs_after": ebur128(down)["lufs"]}
        resampling.append(entry)
        print(f"    {spec['freq']:>5} Hz {RESAMPLE_FROM}->{RESAMPLE_TO}: "
              f"{entry['lufs_before']:>7.2f} -> {entry['lufs_after']:>7.2f} LUFS")

    utterances = []
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for name, spec in UTTERANCES.items():
        fixture = FIXTURES / f"{name}.wav"
        data = wav16(utterance(**spec["signal"]), PIPER_RATE)
        fixture.write_bytes(data)
        entry = {"name": name, "why": spec["why"], "rate": PIPER_RATE,
                 "file": f"tts/{name}.wav", "bytes": len(data),
                 "sha256": sha256(data), "compare": spec["compare"]}
        if spec["compare"]:
            # The oracle: the same bytes through the real chain, measured.
            done = work / f"{name}-python.wav"
            tts.postprocess(data, done)
            read = measure(done)
            entry |= {"tts_py": {"lufs": read["lufs"], "peak": read["peak"],
                                 "lra": read["lra"]}}
            print(f"    {name:<10} tts.py lands at {read['lufs']:>7.2f} LUFS, "
                  f"peak {read['peak']:>6.2f} dBTP")
        else:
            print(f"    {name:<10} properties only, not compared")
        utterances.append(entry)

    return {
        "what": "What real ffmpeg said about the inputs in tests/reference/tts/, "
                "frozen so that static/tts/level.js can be checked against "
                "something other than itself.",
        "produced_by": "tools/ttsfreeze.py",
        "produced_on": date.today().isoformat(),
        "ffmpeg": ffmpeg,
        "tts_py": {"loudnorm": tts.LOUDNORM,
                   "silence_threshold": tts.SILENCE_THRESHOLD,
                   "sample_rate": tts.SAMPLE_RATE,
                   "keep_head": tts.KEEP_HEAD, "keep_tail": tts.KEEP_TAIL,
                   "fade": tts.FADE, "tail_pad": tts.TAIL_PAD},
        "invalidated_by": [
            "any change to the filter chain in tts.py - the numbers under "
            "tts_py are what that chain produced, not what it ought to",
            "any change to the fixtures under tests/reference/tts/, which is "
            "why their sha256 is here",
            "a different ffmpeg, if it moves the numbers: rerun and compare "
            "before accepting, because a shifted reference is indistinguishable "
            "from a broken level.js unless somebody looks",
        ],
        "not_invalidated_by": [
            "changes to static/tts/level.js - that is the thing being checked, "
            "and regenerating these numbers to make it pass is the one move "
            "this file exists to prevent",
        ],
        "measure_rate": MEASURE_RATE,
        "tone_command": "amp * sin(2*pi*freq*i/rate), i from 0",
        "tones": tones,
        "peaks": peaks,
        "resampling": resampling,
        "utterances": utterances,
        "disagreements": [
            {"where": "peaks", "size": "about 0.55 dB",
             "what": "ffmpeg reads these true peaks high. The waveform is a "
                     "sine, so the real peak is exactly its amplitude - "
                     "analytic_peak_dbtp - and ffmpeg's 4x interpolator "
                     "overshoots it. level.js lands on the analytic value. "
                     "Both are far above sample_peak_dbfs, which is the thing "
                     "that actually matters."},
            {"where": "the spike utterance", "size": "3.3 LU",
             "what": "one sample at full scale drives ffmpeg's loudnorm into "
                     "its dynamic mode and it hands back a file 3.3 LU "
                     "quieter than level.js does. Neither answer is audible "
                     "and neither is wrong; a click is not a sound. Left out "
                     "of the comparison on purpose rather than left out "
                     "silently."},
        ],
    }


def main(argv: list[str]) -> int:
    check = "--check" in argv
    with tempfile.TemporaryDirectory() as tmp:
        print("Measuring." if check else "Measuring and freezing.")
        fresh = build(Path(tmp))

    if not check:
        REFERENCE.mkdir(parents=True, exist_ok=True)
        LOCK.write_text(json.dumps(fresh, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        print(f"\n  written to {LOCK.relative_to(ROOT)}")
        return 0

    if not LOCK.exists():
        print(f"\n  {LOCK.relative_to(ROOT)} does not exist yet - run without "
              f"--check to write it")
        return 1
    old = json.loads(LOCK.read_text(encoding="utf-8"))
    moved = []
    for tone_old, tone_new in zip(old["tones"], fresh["tones"]):
        if abs(tone_old["lufs"] - tone_new["lufs"]) > 0.005:
            moved.append(f"{tone_new['name']}: {tone_old['lufs']} -> "
                         f"{tone_new['lufs']}")
    for a, b in zip(old["utterances"], fresh["utterances"]):
        if a.get("tts_py") and b.get("tts_py") and \
                abs(a["tts_py"]["lufs"] - b["tts_py"]["lufs"]) > 0.005:
            moved.append(f"{b['name']}: {a['tts_py']['lufs']} -> "
                         f"{b['tts_py']['lufs']}")
    if moved:
        print("\n  the reference has moved since it was frozen:")
        for line in moved:
            print(f"    {line}")
        print("\n  Work out why before rewriting it. A moved reference and a "
              "broken level.js look the same from here.")
        return 1
    print("\n  unchanged - this ffmpeg says what the lock file says")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
