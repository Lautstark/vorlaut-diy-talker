#!/usr/bin/env python3
"""Checks the two things in tts.py that break without saying so.

Both are about strings the module derives rather than stores, and both fail
quietly rather than loudly.

The fingerprint names every cached WAV. Whatever goes into it can rename the
whole cache, and a renamed cache is not an error anywhere - the old files stay
on disk, unread, and every sentence is spoken again. So the fingerprint must
hold what changes how a sentence sounds, and nothing else. The region does
not: Azure returns the same audio wherever it synthesised it. It used to be in
there all the same, which was survivable while it took an .env edit and a
restart to move - and stopped being survivable when the settings page learned
to write it live, one click, no restart, four silent example keys.

The SSML is the request body Azure reads. Everything in it is interpolated
from outside, and the voice is only ever checked for its piper:/azure:
prefix - so a quotation mark in a voice id reaches the XML. What comes back
then is a rejected request, blamed on the key or the network.

The .env of whoever runs this is deliberately out of the way: this asks what
tts.py does with a region, not what region the machine happens to be set to.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import config  # noqa: E402
import tts  # noqa: E402

VOICE = "azure:de-DE-GiselaNeural"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def with_region(where: str, env_file: Path) -> None:
    """Sets the region the way the settings page does, through .env."""
    config.write({"AZURE_SPEECH_REGION": where}, env_file)


def main() -> int:
    with tempfile.TemporaryDirectory() as folder:
        env_file = Path(folder) / ".env"
        config.ENV_FILE = env_file
        os.environ.pop("AZURE_SPEECH_REGION", None)

        # --- the fingerprint against a moving region ----------------------
        with_region("germanywestcentral", env_file)
        before = tts.voice_config(VOICE)
        names = {text: tts.fingerprint(text, VOICE)
                 for text in ("Ja!", "Nein!", "Stopp", "Hilf mir")}

        with_region("westeurope", env_file)
        # First that the region really did move. Without this the rest of the
        # section would pass just as well on a region nobody can change, and
        # would be proving nothing.
        check("the region follows .env without a restart",
              tts.region() == "westeurope", tts.region())
        check("the voice configuration does not move with it",
              tts.voice_config(VOICE) == before)
        check("and the region is not one of its keys",
              "region" not in tts.voice_config(VOICE),
              ", ".join(sorted(tts.voice_config(VOICE))))
        check("so every cached name stays what it was",
              all(tts.fingerprint(text, VOICE) == key
                  for text, key in names.items()))

        # The environment beats the file, and the settings page is not the
        # only way in - a container hands the region over like this.
        os.environ["AZURE_SPEECH_REGION"] = "northeurope"
        check("an environment variable moves it no further",
              tts.region() == "northeurope"
              and tts.voice_config(VOICE) == before)
        del os.environ["AZURE_SPEECH_REGION"]

        # --- and is still sensitive to what does change the audio ---------
        # The other half of the same claim: a fingerprint that ignored the
        # region because it ignores everything would pass all of the above.
        check("a different voice still renames",
              tts.fingerprint("Ja!", "azure:de-DE-KatjaNeural")
              != names["Ja!"])
        check("a different backend too",
              tts.fingerprint("Ja!", "piper:de_DE-thorsten-medium")
              != names["Ja!"])
        check("and a different text",
              tts.fingerprint("Ja", VOICE) != names["Ja!"])
        check("the rate is still in there",
              "rate" in tts.voice_config(VOICE))

        # --- SSML that survives a hostile voice id ------------------------
        for label, voice in (("a plain voice", "de-DE-GiselaNeural"),
                             ("a quote in the voice id", 'de-DE-X"Neural'),
                             ("an angle bracket", "de-DE-<script>"),
                             ("an ampersand", "de-DE-A&B")):
            ssml = tts.build_ssml("Ja!", voice)
            try:
                root = ElementTree.fromstring(ssml)
            except ElementTree.ParseError as exc:
                check(f"{label} gives well formed SSML", False, str(exc))
                continue
            spoken = root.find(
                ".//{http://www.w3.org/2001/10/synthesis}voice")
            check(f"{label} gives well formed SSML", True)
            check(f"{label} arrives whole",
                  spoken is not None and spoken.get("name") == voice,
                  repr(spoken.get("name")) if spoken is not None else "no voice")

        markup = tts.build_ssml('Ja & <nein> "so"', "de-DE-GiselaNeural")
        parsed = ElementTree.fromstring(markup)
        check("markup in the text is spoken, not read as XML",
              "".join(parsed.itertext()) == 'Ja & <nein> "so"',
              repr("".join(parsed.itertext())))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
