#!/usr/bin/env python3
"""Keeps tts.py in step with the recording contract it now shares.

The speech chain used to exist twice in this repository: once as an ffmpeg
filter string in tts.py and once as JavaScript in static/tts/. It exists twice
still, but the second copy is no longer ours - it is @lautstark/stimmquelle,
vendored under static/vendor/ and shared with mitreden, and its rules are
written down in CONTRACT.md rather than inferred from whichever file somebody
read first.

That makes this test simpler and stricter at once. It no longer compares two
sets of constants we own and could change together by accident. It reads the
contract out of the vendored package and checks that tts.py obeys it - and the
package is a copy of somebody else's repository, so the only way to make this
pass is to actually agree.

What drift would look like, and why none of it is loud on its own:

  * tts.py trimmed at -45 dB and kept 60/100 ms for a long time, against the
    contract's -50 and 50/50. Nothing broke. The device simply recorded
    slightly differently from mitreden, for no reason anyone had decided
  * a contract refresh that moves §1 or §2 while tts.py stays put - same thing,
    arriving from the other direction, and a vendored file is exactly the kind
    of thing that gets refreshed without reading
  * PIPELINE_VERSION left behind when either moves: recordings made under the
    old rules keep names claiming they match the new ones, and a device syncs
    a cache it already has

tests/test_piper_version.py is the same idea for the piper pin.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import tts  # noqa: E402

VENDOR = ROOT / "static" / "vendor" / "stimmquelle"
BUNDLE = VENDOR / "index.js"
CATALOGUE = VENDOR / "voices.json"
CONTRACT = VENDOR / "CONTRACT.md"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"\n          {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def contract_numbers() -> dict[str, float]:
    """The contract's constants, read out of the vendored bundle.

    Out of the built JavaScript rather than CONTRACT.md's prose: the prose is
    for people and the bundle is what the browser actually runs, so the bundle
    is the one that can disagree with tts.py in a way that matters. esbuild
    leaves the object literal intact, which is what makes this readable at all.
    """
    text = BUNDLE.read_text(encoding="utf-8")
    found: dict[str, float] = {}
    trim = re.search(r"thresholdDb:\s*(-?[\d.]+),\s*keepHeadSec:\s*([\d.]+),"
                     r"\s*keepTailSec:\s*([\d.]+)", text)
    if trim:
        found["thresholdDb"] = float(trim.group(1))
        found["keepHeadSec"] = float(trim.group(2))
        found["keepTailSec"] = float(trim.group(3))
    for name in ("TARGET_LUFS", "TARGET_PEAK_DBTP"):
        hit = re.search(rf"{name}\s*=\s*(-?[\d.]+)", text)
        if hit:
            found[name] = float(hit.group(1))
    return found


def main() -> int:
    for name, path in (("bundle", BUNDLE), ("catalogue", CATALOGUE), ("contract", CONTRACT)):
        check(f"the vendored {name} is there", path.is_file(),
              f"{path} is missing - see static/vendor/stimmquelle/VENDORED.md")
    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1

    contract = contract_numbers()
    check("the contract's numbers could be read out of the bundle",
          len(contract) == 5, f"found {sorted(contract)}")

    # --- §2, the trim -----------------------------------------------------
    threshold = float(tts.SILENCE_THRESHOLD.removesuffix("dB"))
    for label, here, there in (
        ("SILENCE_THRESHOLD", threshold, contract.get("thresholdDb")),
        ("KEEP_HEAD", tts.KEEP_HEAD, contract.get("keepHeadSec")),
        ("KEEP_TAIL", tts.KEEP_TAIL, contract.get("keepTailSec")),
    ):
        check(f"tts.{label} matches the contract",
              there is not None and abs(here - there) < 1e-9,
              f"tts.py says {here!r}, the contract says {there!r}")

    # --- §1, the levelling ------------------------------------------------
    loudnorm = dict(part.split("=", 1) for part in tts.LOUDNORM.split(":"))
    check("the I in tts.LOUDNORM matches the contract's target",
          abs(float(loudnorm["I"]) - contract.get("TARGET_LUFS", 0)) < 1e-9,
          f"tts.py {loudnorm['I']!r}, contract {contract.get('TARGET_LUFS')!r}")
    check("the TP in tts.LOUDNORM matches the contract's ceiling",
          abs(float(loudnorm["TP"]) - contract.get("TARGET_PEAK_DBTP", 0)) < 1e-9,
          f"tts.py {loudnorm['TP']!r}, contract {contract.get('TARGET_PEAK_DBTP')!r}")

    # --- the device extras, which are ours and must stay ours -------------
    # The contract permits these and leaves them off. If they ever vanish from
    # here the device gets clicks and cut-off syllables, and nothing upstream
    # would notice, because upstream is right not to care.
    check("the fade against amplifier clicks is still applied", tts.FADE > 0)
    check("the tail pad for the MAX98357A is still applied", tts.TAIL_PAD > 0)
    chain = tts._filter_chain()
    check("and both are actually in the filter chain",
          f"afade=t=in:st=0:d={tts.FADE}" in chain
          and f"apad=pad_dur={tts.TAIL_PAD}" in chain,
          chain)
    check("the chain still trims before it levels",
          chain.index("silenceremove") < chain.index("loudnorm"),
          "leading silence drags the integrated loudness down - CONTRACT.md §2")

    # --- the fingerprint --------------------------------------------------
    # A contract change that does not reach the fingerprint is the worst of
    # the three failures: the audio changes and the names do not.
    config = tts.voice_config("piper:de_DE-thorsten-medium")
    for key, value in (("silence_threshold", tts.SILENCE_THRESHOLD),
                       ("loudnorm", tts.LOUDNORM),
                       ("pipeline", tts.PIPELINE_VERSION)):
        check(f"the fingerprint carries {key}", config.get(key) == value,
              f"got {config.get(key)!r}, expected {value!r}")

    # --- the catalogue ----------------------------------------------------
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    voices = {v["id"]: v for v in catalogue["voices"]}
    check("the catalogue has voices in it", bool(voices))

    shipped = [entry.rsplit("/", 1)[-1]
               for entries in tts.VOICE_CATALOGUE.values() for entry in entries]
    for vid in shipped:
        check(f"VOICE_CATALOGUE's {vid} is in the shared catalogue", vid in voices,
              "the container fetches a voice the shared list has never heard of")

    # The finding that started all this, still asserted rather than left in a
    # document: two of the four voices this fetches cannot be spoken in a
    # browser, and one of them is the only German female voice there is.
    unusable = [v for v in shipped if v in voices and voices[v].get("browser") != "ok"]
    check("the browser still cannot speak two of the four voices this fetches",
          sorted(unusable) == ["de_DE-kerstin-low", "en_US-john-medium"],
          f"expected kerstin-low and john-medium, found {sorted(unusable)}")

    german_female = [v for v in voices.values()
                     if v["lang"] == "de" and v.get("gender") == "female"
                     and v.get("browser") == "ok"]
    # The day this fails is a good day: it means the phoneme remap got wired
    # up and Kerstin came back.
    check("there is still no German female voice for the browser",
          not german_female,
          "there is one now - say so in docs/browser-tts.md, which still says "
          "there is not: " + ", ".join(v["id"] for v in german_female))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
