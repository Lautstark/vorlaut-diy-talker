#!/usr/bin/env python3
"""Checks whether everything vorlaut needs is present - and says what is not.

    python3 doctor.py

Deliberately runs on bare Python without dependencies, so that it still says
something useful when nothing has been set up yet.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

import config
import metacom
import tts

ROOT = Path(__file__).resolve().parent
SYSTEM = platform.system()

GRUEN, GELB, ROT, AUS = "\033[32m", "\033[33m", "\033[31m", "\033[0m"
if not sys.stdout.isatty() or os.environ.get("NO_COLOR"):
    GRUEN = GELB = ROT = AUS = ""

missing_required = 0
missing_optional = 0


def report(name: str, ok: bool, detail: str = "", hint: str = "",
          required: bool = True) -> None:
    global missing_required, missing_optional
    if ok:
        mark, colour = "ok", GRUEN
    elif required:
        mark, colour = "FEHLT", ROT
        missing_required += 1
    else:
        mark, colour = "--", GELB
        missing_optional += 1
    print(f"  {colour}{mark:5}{AUS} {name:38} {detail}")
    if not ok and hint:
        for line in hint.strip().split("\n"):
            print(f"         {line}")


def hint_for(mac: str, linux: str, windows: str = "") -> str:
    if SYSTEM == "Darwin":
        return mac
    if SYSTEM == "Linux":
        return linux
    return windows or mac


def version_of(programm: str, *args: str) -> str:
    try:
        result = subprocess.run([programm, *args], capture_output=True,
                                  text=True, timeout=20)
        erste = (result.stdout or result.stderr).strip().split("\n")[0]
        return erste[:60]
    except Exception:
        return ""


def check_python() -> None:
    v = sys.version_info
    report("Python 3.9 or newer", v >= (3, 9), f"{v.major}.{v.minor}.{v.micro}",
          "Nothing here runs without it. python.org or your package manager.")


def check_pillow() -> None:
    try:
        from PIL import Image  # noqa: F401
        import PIL
        report("Pillow", True, PIL.__version__)
    except ImportError:
        report("Pillow", False, "", 
              "pip install -r requirements.txt\n"
              "(am besten in einer Umgebung: python3 -m venv .venv)")


def check_ffmpeg() -> None:
    path = shutil.which("ffmpeg")
    report("ffmpeg", bool(path), version_of("ffmpeg", "-version") if path else "",
          hint_for("brew install ffmpeg",
                   "sudo apt install ffmpeg",
                   "winget install ffmpeg"))


def check_piper() -> None:
    """The offline route. With a model on disk the device speaks without an
    account anywhere, so this is checked before the key."""
    program = tts.piper_binary()
    models = tts.piper_models()
    detail = ""
    if program and models:
        detail = ", ".join(sorted(models))
    elif program:
        detail = "program present, no voice"
    report("piper", bool(program and models), detail,
          "Local voices, German and English, no key and no network.\n"
          "  pip install piper-tts\n"
          "  python3 tools/voices.py",
          required=False)


def check_azure_key() -> None:
    key = config.value("AZURE_SPEECH_KEY")
    source = ("the environment" if os.environ.get("AZURE_SPEECH_KEY", "").strip()
              else ".env")
    report("Azure key", bool(key),
          f"from {source}" if key else "",
          "Only needed for the Azure voices - with a piper voice the device\n"
          "speaks without one. cp .env.example .env  and enter your own key.\n"
          "A free account is enough (tier F0).",
          required=False)


def check_arduino() -> None:
    path = shutil.which("arduino-cli")
    report("arduino-cli", bool(path),
          version_of("arduino-cli", "version") if path else "",
          "Only needed for compiling the firmware. Whoever takes the ready-made\n"
          "image from CI needs esptool only.\n"
          + hint_for("brew install arduino-cli",
                     "see arduino.github.io/arduino-cli"),
          required=False)
    if not path:
        return
    cores = version_of("arduino-cli", "core", "list")
    hat = subprocess.run(["arduino-cli", "core", "list"], capture_output=True,
                         text=True).stdout
    report("  ESP32 core", "esp32:esp32" in hat, "",
          "arduino-cli core install esp32:esp32\n"
          "(add the package source first, see docs/firmware.md)",
          required=False)
    libs = subprocess.run(["arduino-cli", "lib", "list"], capture_output=True,
                          text=True).stdout
    for name in ("Adafruit GFX Library", "Adafruit ST7735"):
        report(f"  {name}", name in libs, "",
              f'arduino-cli lib install "{name}"', required=False)


def tool_in_core(name: str) -> Path | None:
    for base in (Path.home() / "Library/Arduino15/packages/esp32/tools",
                  Path.home() / ".arduino15/packages/esp32/tools"):
        folder = base / ("esptool_py" if name == "esptool" else name)
        if folder.exists():
            hits = sorted(folder.glob(f"*/{name}"))
            if hits:
                return hits[-1]
    return None


def check_flash_tools() -> None:
    for name, purpose in (("esptool", "for flashing"),
                          ("mklittlefs", "for the file system image")):
        im_pfad = shutil.which(name)
        im_core = tool_in_core(name)
        ort = "im PATH" if im_pfad else (f"in the ESP32 core" if im_core else "")
        report(f"{name} ({purpose})", bool(im_pfad or im_core), ort,
              "Comes with the ESP32 core of the Arduino IDE.\n"
              + (hint_for("brew install esptool", "pip install esptool")
                 if name == "esptool" else ""),
              required=False)


def check_docker() -> None:
    path = shutil.which("docker")
    report("Docker", bool(path), version_of("docker", "--version") if path else "",
          "Only needed if the interface is meant to run in a container.\n"
          "Without Docker this works too:  python app.py",
          required=False)


def check_metacom() -> None:
    """The licensed METACOM collection is optional - without it the web
    interface searches ARASAAC only."""
    configured = metacom.configured()
    if not configured:
        report("METACOM collection", False, "VORLAUT_METACOM_DIR not set",
               "Only needed if you have a METACOM licence.\n"
               "Point it at the unpacked download - in .env\n"
               "or as an environment variable:\n"
               "  VORLAUT_METACOM_DIR=~/METACOM_9_Desktop",
               required=False)
        return
    # Two different faults, and the difference is the whole point: a path
    # that is not there at all used to be reported as a missing subfolder,
    # which sends somebody looking inside a folder that does not exist.
    if metacom.root() is None:
        report("METACOM collection", False, "no folder at that path",
               f"VORLAUT_METACOM_DIR points at {configured},\n"
               "and there is nothing there. It has to be a path on this\n"
               "machine even when the interface runs in the container:\n"
               "docker-compose.yml mounts what this names, and /metacom is\n"
               "only where it arrives on the inside.\n"
               "  VORLAUT_METACOM_DIR=~/METACOM_9_Desktop",
               required=False)
        return
    if not metacom.available():
        report("METACOM collection", False, "folder not readable",
               f"VORLAUT_METACOM_DIR points at {configured},\n"
               f"{metacom.SYMBOL_SUBDIR} is missing underneath it.",
               required=False)
        return
    art = "with keywords" if metacom.has_keywords() else "file names only"
    report("METACOM collection", True, f"{metacom.count()} symbols, {art}",
           required=False)
    if not metacom.has_keywords():
        print("         The MetaSearch database was not found -")
        print("         search falls back to file names and finds less.")


def check_device_token() -> None:
    """Without a key the talker cannot fetch any content."""
    import app
    if app.device_token():
        report("Key for the talker", True, "from the environment or .env",
               required=False)
    else:
        report("Key for the talker", False, "VORLAUT_DEVICE_TOKEN not set",
               "Only needed if the device is meant to fetch content by itself.\n"
               "Generate one and put it into .env:\n"
               "  python -c \"import secrets; print(secrets.token_urlsafe(24))\"",
               required=False)


def check_content() -> None:
    content = Path(os.environ.get("VORLAUT_CONTENT") or ROOT / "content")
    layout = content / "layout.json"
    if layout.exists():
        try:
            import json
            sets = len(json.loads(layout.read_text(encoding="utf-8")).get("sets", []))
            report("Content", True, f"{content.name}/, {sets} set(s)")
        except Exception as exc:
            report("Content", False, "", f"layout.json cannot be read: {exc}")
    else:
        report("Content", True, "none yet - created on the first start")


def main() -> int:
    print(f"\nvorlaut – {platform.system()} {platform.release()}, "
          f"{platform.machine()}\n")
    print(" For the web interface and the build")
    check_python()
    check_pillow()
    check_ffmpeg()
    check_content()
    print("\n For the speech output")
    check_piper()
    check_azure_key()
    print("\n For the firmware")
    check_arduino()
    check_flash_tools()
    print("\n Optional")
    check_docker()
    check_metacom()
    check_device_token()

    print()
    if missing_required:
        print(f"  {ROT}{missing_required} thing(s) missing{AUS} that it cannot run without.")
        return 1
    if missing_optional:
        print(f"  Everything essential is here. {missing_optional} thing(s) missing for "
              f"some areas - see above.")
    else:
        print(f"  {GRUEN}Everything is here.{AUS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
