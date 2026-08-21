#!/usr/bin/env python3
"""Checks that writing .env leaves the file readable.

.env is not only configuration, it is the documentation of its own settings:
every entry in .env.example carries the paragraph explaining it. The interface
writes this file now, so the thing worth checking is not that a value arrives -
that is easy - but that everything around it survives.

The dangerous mistakes are quiet ones: a comment paragraph left pointing at a
line that moved to the bottom, a key written twice so the second silently wins,
a value with a space in it that reads back short.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import config  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


SAMPLE = """\
# Azure Speech: key and region have to match each other.
AZURE_SPEECH_KEY=old-key

# Region of the key. Shown in the Azure portal.
AZURE_SPEECH_REGION=germanywestcentral

# Optional. Path to a licensed METACOM collection (the unpacked download).
# The symbols are only referenced, never copied into the project.
#VORLAUT_METACOM_DIR=/Users/you/METACOM_9_Desktop
"""


def main() -> int:
    with tempfile.TemporaryDirectory() as folder:
        env = Path(folder) / ".env"

        # --- reading -----------------------------------------------------
        env.write_text(SAMPLE, encoding="utf-8")
        values = config.read(env)
        check("a live entry is read", values.get("AZURE_SPEECH_KEY") == "old-key")
        check("a commented entry counts as unset",
              "VORLAUT_METACOM_DIR" not in values)

        # --- replacing in place ------------------------------------------
        config.write({"AZURE_SPEECH_KEY": "new-key"}, env)
        text = env.read_text(encoding="utf-8")
        check("the value is replaced",
              config.read(env).get("AZURE_SPEECH_KEY") == "new-key")
        check("only once", text.count("AZURE_SPEECH_KEY=") == 1)
        check("the paragraph above it stays",
              "# Azure Speech: key and region have to match each other." in text)
        check("and stays directly above it",
              "# Azure Speech: key and region have to match each other.\n"
              "AZURE_SPEECH_KEY=new-key\n" in text)

        # --- waking a commented entry ------------------------------------
        config.write({"VORLAUT_METACOM_DIR": "/srv/metacom"}, env)
        text = env.read_text(encoding="utf-8")
        check("a commented entry is woken where it stands",
              "\n# The symbols are only referenced, never copied into the "
              "project.\nVORLAUT_METACOM_DIR=/srv/metacom\n" in text)
        check("and not appended a second time",
              text.count("VORLAUT_METACOM_DIR") == 1)

        # --- something genuinely new -------------------------------------
        config.write({"VORLAUT_DEVICE_TOKEN": "abc123"}, env)
        check("a new entry is added",
              config.read(env).get("VORLAUT_DEVICE_TOKEN") == "abc123")
        check("the file still ends with one newline",
              env.read_text(encoding="utf-8").endswith("\n")
              and not env.read_text(encoding="utf-8").endswith("\n\n"))

        # --- removing ------------------------------------------------------
        config.write({"VORLAUT_DEVICE_TOKEN": ""}, env)
        check("an emptied entry is gone",
              "VORLAUT_DEVICE_TOKEN" not in config.read(env))
        check("but stays in the file as an example",
              "#VORLAUT_DEVICE_TOKEN=abc123" in env.read_text(encoding="utf-8"))

        # --- values that need care -----------------------------------------
        config.write({"AZURE_SPEECH_KEY": " spaced "}, env)
        check("a value with spaces survives",
              config.read(env).get("AZURE_SPEECH_KEY") == " spaced ",
              repr(config.read(env).get("AZURE_SPEECH_KEY")))

        config.write({"AZURE_SPEECH_KEY": "a=b=c"}, env)
        check("a value with = in it survives",
              config.read(env).get("AZURE_SPEECH_KEY") == "a=b=c")

        # --- everything else is untouched ----------------------------------
        before = env.read_text(encoding="utf-8")
        config.write({}, env)
        check("writing nothing changes nothing",
              env.read_text(encoding="utf-8") == before)

        # --- no file yet -----------------------------------------------------
        fresh = Path(folder) / "sub" / ".env"
        config.write({"AZURE_SPEECH_KEY": "first"}, fresh)
        check("a missing file is created",
              config.read(fresh).get("AZURE_SPEECH_KEY") == "first")
        check("and nothing is left half written",
              not list(fresh.parent.glob("*.part")))

        # --- the environment wins ------------------------------------------
        import os
        config.ENV_FILE = env
        config.write({"AZURE_SPEECH_REGION": "westeurope"}, env)
        os.environ["AZURE_SPEECH_REGION"] = "northeurope"
        check("a set environment variable beats the file",
              config.value("AZURE_SPEECH_REGION") == "northeurope")
        del os.environ["AZURE_SPEECH_REGION"]
        check("and without it the file answers",
              config.value("AZURE_SPEECH_REGION") == "westeurope")

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
