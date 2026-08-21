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
import threading
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

        config.write({"AZURE_SPEECH_KEY": "line\nbreak"}, env)
        check("a value with a line break in it stays on one line",
              config.read(env).get("AZURE_SPEECH_KEY") == "linebreak",
              repr(config.read(env).get("AZURE_SPEECH_KEY")))
        orphans = [line for line in env.read_text(encoding="utf-8").splitlines()
                   if line.strip() and not line.lstrip().startswith("#")
                   and not config.LINE.match(line)]
        check("and leaves no half line behind it", not orphans, repr(orphans))

        # --- a key that stands in the file twice ---------------------------
        # The shape people arrive with: the commented example from
        # .env.example, and their own live line added underneath it. read()
        # answers with the live one, so that is the one a save has to reach.
        twice = Path(folder) / "twice.env"
        twice.write_text(
            "# Optional. Path to a licensed METACOM collection.\n"
            "#VORLAUT_METACOM_DIR=/Users/you/METACOM_9_Desktop\n"
            "\n"
            "VORLAUT_METACOM_DIR=/my/real/path\n", encoding="utf-8")
        config.write({"VORLAUT_METACOM_DIR": "/typed/just/now"}, twice)
        check("the value written under an example is the one read back",
              config.read(twice).get("VORLAUT_METACOM_DIR") == "/typed/just/now",
              repr(config.read(twice).get("VORLAUT_METACOM_DIR")))
        check("and the example above it is still an example",
              "#VORLAUT_METACOM_DIR=/Users/you/METACOM_9_Desktop"
              in twice.read_text(encoding="utf-8"))

        twice.write_text("AZURE_SPEECH_KEY=first\n"
                         "AZURE_SPEECH_KEY=second\n", encoding="utf-8")
        config.write({"AZURE_SPEECH_KEY": "third"}, twice)
        text = twice.read_text(encoding="utf-8")
        standing = [line for line in text.splitlines()
                    if line.startswith("AZURE_SPEECH_KEY=")]
        check("two live copies leave one",
              config.read(twice).get("AZURE_SPEECH_KEY") == "third"
              and len(standing) == 1, repr(text))
        check("and the copy above it goes back to being an example",
              "#AZURE_SPEECH_KEY=first" in text)

        twice.write_text("AZURE_SPEECH_KEY=one\n"
                         "AZURE_SPEECH_KEY=two\n", encoding="utf-8")
        config.write({"AZURE_SPEECH_KEY": ""}, twice)
        check("removing takes every copy with it",
              "AZURE_SPEECH_KEY" not in config.read(twice),
              repr(twice.read_text(encoding="utf-8")))

        # --- two saves at the same moment ----------------------------------
        # The interface answers on a threading server. Without a lock both
        # saves read the file as it was before either of them, and the slower
        # one writes the other one out again.
        crowd = Path(folder) / "crowd.env"
        crowd.write_text("# Ten saves at once.\n", encoding="utf-8")
        names = [f"VORLAUT_TEST_{number}" for number in range(10)]
        together = threading.Barrier(len(names))

        def save(name: str) -> None:
            together.wait()
            config.write({name: name.lower()}, crowd)

        savers = [threading.Thread(target=save, args=(name,)) for name in names]
        for saver in savers:
            saver.start()
        for saver in savers:
            saver.join()
        arrived = config.read(crowd)
        check("ten saves at once all arrive",
              all(arrived.get(name) == name.lower() for name in names),
              f"{sum(name in arrived for name in names)} of {len(names)}")

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
