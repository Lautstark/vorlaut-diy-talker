#!/usr/bin/env python3
"""Prüft, ob alles da ist, was vorlaut braucht - und sagt, was fehlt.

    python3 doctor.py

Läuft absichtlich mit blankem Python ohne Abhängigkeiten, damit es auch dann
etwas Sinnvolles sagt, wenn noch gar nichts eingerichtet ist.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

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
    report("Python 3.9 oder neuer", v >= (3, 9), f"{v.major}.{v.minor}.{v.micro}",
          "Ohne das läuft hier nichts. python.org oder der Paketverwalter.")


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


def check_azure_key() -> None:
    key = os.environ.get("AZURE_SPEECH_KEY", "").strip()
    source = "Umgebungsvariable"
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("AZURE_SPEECH_KEY="):
                key = line.split("=", 1)[1].strip()
                source = ".env"
    report("Azure-Schlüssel", bool(key),
          f"aus {source}" if key else "",
          "Ohne Schlüssel bleibt das Gerät stumm, alles andere geht.\n"
          "cp .env.example .env  und den eigenen Schlüssel eintragen.\n"
          "Ein kostenloses Konto reicht (Stufe F0).",
          required=False)


def check_arduino() -> None:
    path = shutil.which("arduino-cli")
    report("arduino-cli", bool(path),
          version_of("arduino-cli", "version") if path else "",
          "Nur zum Übersetzen der Firmware nötig. Wer das fertige Image aus\n"
          "CI nimmt, braucht nur esptool.\n"
          + hint_for("brew install arduino-cli",
                     "siehe arduino.github.io/arduino-cli"),
          required=False)
    if not path:
        return
    cores = version_of("arduino-cli", "core", "list")
    hat = subprocess.run(["arduino-cli", "core", "list"], capture_output=True,
                         text=True).stdout
    report("  ESP32-Core", "esp32:esp32" in hat, "",
          "arduino-cli core install esp32:esp32\n"
          "(vorher die Paketquelle eintragen, siehe docs/firmware.md)",
          required=False)
    libs = subprocess.run(["arduino-cli", "lib", "list"], capture_output=True,
                          text=True).stdout
    for name in ("Adafruit GFX Library", "Adafruit ST7735"):
        report(f"  {name}", name in libs, "",
              f'arduino-cli lib install "{name}"', required=False)


def tool_in_core(name: str) -> Path | None:
    for basis in (Path.home() / "Library/Arduino15/packages/esp32/tools",
                  Path.home() / ".arduino15/packages/esp32/tools"):
        ordner = basis / ("esptool_py" if name == "esptool" else name)
        if ordner.exists():
            hits = sorted(ordner.glob(f"*/{name}"))
            if hits:
                return hits[-1]
    return None


def check_flash_tools() -> None:
    for name, wofuer in (("esptool", "zum Flashen"),
                         ("mklittlefs", "für das Filesystem-Image")):
        im_pfad = shutil.which(name)
        im_core = tool_in_core(name)
        ort = "im PATH" if im_pfad else (f"im ESP32-Core" if im_core else "")
        report(f"{name} ({wofuer})", bool(im_pfad or im_core), ort,
              "Kommt mit dem ESP32-Core der Arduino-IDE.\n"
              + (hint_for("brew install esptool", "pip install esptool")
                 if name == "esptool" else ""),
              required=False)


def check_docker() -> None:
    path = shutil.which("docker")
    report("Docker", bool(path), version_of("docker", "--version") if path else "",
          "Nur nötig, wenn die Oberfläche im Container laufen soll.\n"
          "Ohne Docker geht auch:  python app.py",
          required=False)


def check_content() -> None:
    content = Path(os.environ.get("VORLAUT_CONTENT") or ROOT / "content")
    layout = content / "layout.json"
    if layout.exists():
        try:
            import json
            sets = len(json.loads(layout.read_text(encoding="utf-8")).get("sets", []))
            report("Inhalte", True, f"{content.name}/, {sets} Set(s)")
        except Exception as exc:
            report("Inhalte", False, "", f"layout.json ist nicht lesbar: {exc}")
    else:
        report("Inhalte", True, "noch keine - werden beim ersten Start angelegt")


def main() -> int:
    print(f"\nvorlaut – {platform.system()} {platform.release()}, "
          f"{platform.machine()}\n")
    print(" Für die Weboberfläche und den Build")
    check_python()
    check_pillow()
    check_ffmpeg()
    check_content()
    print("\n Für die Sprachausgabe")
    check_azure_key()
    print("\n Für die Firmware")
    check_arduino()
    check_flash_tools()
    print("\n Wahlweise")
    check_docker()

    print()
    if missing_required:
        print(f"  {ROT}{missing_required} Sache(n) fehlen{AUS}, ohne die es nicht läuft.")
        return 1
    if missing_optional:
        print(f"  Alles Nötige ist da. {missing_optional} Sache(n) fehlen für "
              f"Teilbereiche – siehe oben.")
    else:
        print(f"  {GRUEN}Alles da.{AUS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
