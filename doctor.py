#!/usr/bin/env python3
"""Prüft, ob alles da ist, was mitreden braucht - und sagt, was fehlt.

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

fehlt_pflicht = 0
fehlt_kuer = 0


def melde(name: str, ok: bool, angabe: str = "", rat: str = "",
          pflicht: bool = True) -> None:
    global fehlt_pflicht, fehlt_kuer
    if ok:
        zeichen, farbe = "ok", GRUEN
    elif pflicht:
        zeichen, farbe = "FEHLT", ROT
        fehlt_pflicht += 1
    else:
        zeichen, farbe = "--", GELB
        fehlt_kuer += 1
    print(f"  {farbe}{zeichen:5}{AUS} {name:38} {angabe}")
    if not ok and rat:
        for zeile in rat.strip().split("\n"):
            print(f"         {zeile}")


def rat_fuer(mac: str, linux: str, windows: str = "") -> str:
    if SYSTEM == "Darwin":
        return mac
    if SYSTEM == "Linux":
        return linux
    return windows or mac


def version_von(programm: str, *args: str) -> str:
    try:
        ergebnis = subprocess.run([programm, *args], capture_output=True,
                                  text=True, timeout=20)
        erste = (ergebnis.stdout or ergebnis.stderr).strip().split("\n")[0]
        return erste[:60]
    except Exception:
        return ""


def pruefe_python() -> None:
    v = sys.version_info
    melde("Python 3.9 oder neuer", v >= (3, 9), f"{v.major}.{v.minor}.{v.micro}",
          "Ohne das läuft hier nichts. python.org oder der Paketverwalter.")


def pruefe_pillow() -> None:
    try:
        from PIL import Image  # noqa: F401
        import PIL
        melde("Pillow", True, PIL.__version__)
    except ImportError:
        melde("Pillow", False, "", 
              "pip install -r requirements.txt\n"
              "(am besten in einer Umgebung: python3 -m venv .venv)")


def pruefe_ffmpeg() -> None:
    pfad = shutil.which("ffmpeg")
    melde("ffmpeg", bool(pfad), version_von("ffmpeg", "-version") if pfad else "",
          rat_fuer("brew install ffmpeg",
                   "sudo apt install ffmpeg",
                   "winget install ffmpeg"))


def pruefe_schluessel() -> None:
    schluessel = os.environ.get("AZURE_SPEECH_KEY", "").strip()
    quelle = "Umgebungsvariable"
    env = ROOT / ".env"
    if not schluessel and env.exists():
        for zeile in env.read_text(encoding="utf-8").splitlines():
            if zeile.startswith("AZURE_SPEECH_KEY="):
                schluessel = zeile.split("=", 1)[1].strip()
                quelle = ".env"
    melde("Azure-Schlüssel", bool(schluessel),
          f"aus {quelle}" if schluessel else "",
          "Ohne Schlüssel bleibt das Gerät stumm, alles andere geht.\n"
          "cp .env.example .env  und den eigenen Schlüssel eintragen.\n"
          "Ein kostenloses Konto reicht (Stufe F0).",
          pflicht=False)


def pruefe_arduino() -> None:
    pfad = shutil.which("arduino-cli")
    melde("arduino-cli", bool(pfad),
          version_von("arduino-cli", "version") if pfad else "",
          "Nur zum Übersetzen der Firmware nötig. Wer das fertige Abbild aus\n"
          "CI nimmt, braucht nur esptool.\n"
          + rat_fuer("brew install arduino-cli",
                     "siehe arduino.github.io/arduino-cli"),
          pflicht=False)
    if not pfad:
        return
    kerne = version_von("arduino-cli", "core", "list")
    hat = subprocess.run(["arduino-cli", "core", "list"], capture_output=True,
                         text=True).stdout
    melde("  ESP32-Core", "esp32:esp32" in hat, "",
          "arduino-cli core install esp32:esp32\n"
          "(vorher die Paketquelle eintragen, siehe docs/firmware.md)",
          pflicht=False)
    libs = subprocess.run(["arduino-cli", "lib", "list"], capture_output=True,
                          text=True).stdout
    for name in ("Adafruit GFX Library", "Adafruit ST7735"):
        melde(f"  {name}", name in libs, "",
              f'arduino-cli lib install "{name}"', pflicht=False)


def werkzeug_im_core(name: str) -> Path | None:
    for basis in (Path.home() / "Library/Arduino15/packages/esp32/tools",
                  Path.home() / ".arduino15/packages/esp32/tools"):
        ordner = basis / ("esptool_py" if name == "esptool" else name)
        if ordner.exists():
            treffer = sorted(ordner.glob(f"*/{name}"))
            if treffer:
                return treffer[-1]
    return None


def pruefe_flash_werkzeuge() -> None:
    for name, wofuer in (("esptool", "zum Flashen"),
                         ("mklittlefs", "für das Dateisystem-Abbild")):
        im_pfad = shutil.which(name)
        im_core = werkzeug_im_core(name)
        ort = "im PATH" if im_pfad else (f"im ESP32-Core" if im_core else "")
        melde(f"{name} ({wofuer})", bool(im_pfad or im_core), ort,
              "Kommt mit dem ESP32-Core der Arduino-IDE.\n"
              + (rat_fuer("brew install esptool", "pip install esptool")
                 if name == "esptool" else ""),
              pflicht=False)


def pruefe_docker() -> None:
    pfad = shutil.which("docker")
    melde("Docker", bool(pfad), version_von("docker", "--version") if pfad else "",
          "Nur nötig, wenn die Oberfläche im Container laufen soll.\n"
          "Ohne Docker geht auch:  python app.py",
          pflicht=False)


def pruefe_inhalte() -> None:
    inhalt = Path(os.environ.get("MITREDEN_CONTENT") or ROOT / "content")
    layout = inhalt / "layout.json"
    if layout.exists():
        try:
            import json
            sets = len(json.loads(layout.read_text(encoding="utf-8")).get("sets", []))
            melde("Inhalte", True, f"{inhalt.name}/, {sets} Set(s)")
        except Exception as exc:
            melde("Inhalte", False, "", f"layout.json ist nicht lesbar: {exc}")
    else:
        melde("Inhalte", True, "noch keine - werden beim ersten Start angelegt")


def main() -> int:
    print(f"\nmitreden – {platform.system()} {platform.release()}, "
          f"{platform.machine()}\n")
    print(" Für die Weboberfläche und den Bauvorgang")
    pruefe_python()
    pruefe_pillow()
    pruefe_ffmpeg()
    pruefe_inhalte()
    print("\n Für die Sprachausgabe")
    pruefe_schluessel()
    print("\n Für die Firmware")
    pruefe_arduino()
    pruefe_flash_werkzeuge()
    print("\n Wahlweise")
    pruefe_docker()

    print()
    if fehlt_pflicht:
        print(f"  {ROT}{fehlt_pflicht} Sache(n) fehlen{AUS}, ohne die es nicht läuft.")
        return 1
    if fehlt_kuer:
        print(f"  Alles Nötige ist da. {fehlt_kuer} Sache(n) fehlen für "
              f"Teilbereiche – siehe oben.")
    else:
        print(f"  {GRUEN}Alles da.{AUS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
