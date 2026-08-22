#!/usr/bin/env python3
"""Checks that the piper version is written down the same way in both places.

It has to be in two: the Dockerfile pins what gets installed, and tts.py names
what the fingerprint counts. Neither can read the other. The Dockerfile is not
running when a fingerprint is computed, and tts.py must not ask the installed
package - voice_config() promises a name derived from the voice id alone, so
that a computer which cannot render a WAV still knows what it would have been
called. Ask the installed piper, and a machine without piper disagrees about
every name and the device fetches a cache it already has.

Two places, no link, and the drift would be silent both ways round:

  * pin bumped, constant left behind - the new piper speaks, the recordings
    keep the old names, and the cache mixes two voices under one fingerprint
  * constant bumped, pin left behind - every sentence is rendered again by the
    piper that made the old ones, for nothing

So this test is the link. It reads the pin out of the Dockerfile and compares.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import tts  # noqa: E402

failures: list[str] = []

PIN = re.compile(r"piper-tts\s*==\s*([0-9][0-9A-Za-z.\-]*)")


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def pinned_in_dockerfile() -> str | None:
    """The version the image installs, or None if it is not pinned at all."""
    text = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    found = PIN.search(text)
    return found.group(1) if found else None


def main() -> int:
    pinned = pinned_in_dockerfile()

    # An unpinned install is its own failure: the image would then take
    # whatever is current on build day, and no constant here could describe it.
    check("the Dockerfile pins piper-tts to an exact version",
          pinned is not None,
          "found no piper-tts==... line" if pinned is None else pinned)

    if pinned is not None:
        check("tts.PIPER_VERSION matches the pin",
              tts.PIPER_VERSION == pinned,
              f"tts.py says {tts.PIPER_VERSION!r}, Dockerfile says {pinned!r}")

    # --- and that it actually reaches the fingerprint --------------------
    # Naming it in a constant nobody reads would look exactly like this test
    # passing, so check the value is in the dictionary the name is built from.
    piper = tts.voice_config("piper:de_DE-thorsten-medium")
    check("a piper voice carries the version in its config",
          piper.get("piper") == tts.PIPER_VERSION,
          f"got {piper.get('piper')!r}")

    # --- and that Azure is untouched by it -------------------------------
    # Azure synthesises on somebody else's machine. Which piper is installed
    # here says nothing about how those recordings came out, and putting the
    # version in the shared part would have renamed every one of them -
    # including the four in example/speech/, which are Azure.
    azure = tts.voice_config("azure:de-DE-GiselaNeural")
    check("an Azure voice does not carry it", "piper" not in azure,
          f"unexpected key: {sorted(azure)}")

    # --- the fingerprint moves with it, and only for piper ---------------
    before_piper = tts.fingerprint("Ja!", "piper:de_DE-thorsten-medium")
    before_azure = tts.fingerprint("Ja!", "azure:de-DE-GiselaNeural")
    original = tts.PIPER_VERSION
    try:
        tts.PIPER_VERSION = original + "-test"
        check("a different piper renames the piper recordings",
              tts.fingerprint("Ja!", "piper:de_DE-thorsten-medium") != before_piper)
        check("and leaves the Azure ones where they are",
              tts.fingerprint("Ja!", "azure:de-DE-GiselaNeural") == before_azure)
    finally:
        tts.PIPER_VERSION = original

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
