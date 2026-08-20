#!/usr/bin/env python3
"""Anbindung an eine lizenzierte METACOM-9-Sammlung.

Die Symbole bleiben, wo sie liegen: sie werden weder ins Projekt kopiert noch
versioniert. Gesetzt wird nur der Pfad auf den entpackten Download:

    VORLAUT_METACOM_DIR=/Users/du/METACOM_9_Desktop

Ist die Variable leer oder der Ordner nicht da, verhält sich alles wie vorher -
die Suche liefert nur ARASAAC, und ein Layout, das METACOM-Symbole nennt, zeigt
die übliche Platzhalter-Kachel statt abzubrechen.

Im Layout stehen METACOM-Symbole als "metacom:<name>", wobei <name> der
Dateiname ohne Endung ist, also genau der Bezeichner aus dem Stichwortindex.

Stichwörter kommen aus der Datenbank von MetaSearch. Die liegt im Programm
selbst (Electron, app.asar) und nicht als lose Datei daneben, deshalb der
kleine Umweg über das Archivformat weiter unten. Findet sich die Datenbank
nicht, fällt die Suche auf die Dateinamen zurück - schlechter, aber nutzbar.
"""

from __future__ import annotations

import json
import os
import re
import struct
import sys
import urllib.parse
import unicodedata
import zipfile
from pathlib import Path

# Bewusst dieselbe Zeile wie in build.py, statt build zu importieren: build
# importiert dieses Modul, und ein Kreis daraus wäre lästiger als die
# doppelte Zeile.
CONTENT = Path(os.environ.get("VORLAUT_CONTENT") or
               Path(__file__).resolve().parent / "content").resolve()
CACHE_FILE = CONTENT / "cache" / "metacom-index.json"

# Ohne Rahmen, denn den zeichnet die Firmware selbst - sonst säßen zwei
# Rahmen ineinander.
SYMBOL_SUBDIR = Path("METACOM_Symbole") / "Symbole_PNG" / "PNG_ohne_Rahmen"
DB_IN_ASAR = ["assets", "db", "metacom-db.json"]
LANGUAGE = "deutsch"
CACHE_VERSION = 1        # hochzählen, wenn sich der Aufbau des Zwischenspeichers ändert

# SW = schwarz-weiß, FB und _dh = weitere Fassungen desselben Symbols, Ziffern
# = Alternativen. Rund die Hälfte der 17.114 Dateien sind solche Varianten;
# ungefiltert schüttet eine Suche nach "essen" 94 Kacheln aus.
VARIANT_SUFFIX = re.compile(r"(?:(?:SW|FB)|_(?:dh|sh|mh))$")
TRAILING_DIGITS = re.compile(r"\d+$")


def configured() -> str:
    """Der eingestellte Pfad: erst die Umgebung, dann .env.

    Dieselbe Reihenfolge wie bei den Azure-Einstellungen in tts.py - eine
    gesetzte Umgebungsvariable gewinnt, damit sich für einen einzelnen Lauf
    etwas anderes ausprobieren lässt.
    """
    value = (os.environ.get("VORLAUT_METACOM_DIR") or "").strip()
    if value:
        return value
    try:
        import tts   # erst hier, damit das Modul auch ohne tts nutzbar bleibt
        return (tts.load_env_file().get("VORLAUT_METACOM_DIR") or "").strip()
    except Exception:
        return ""


def root() -> Path | None:
    """Der Paketordner - oder None, wenn nichts eingestellt ist."""
    raw = configured()
    if not raw:
        return None
    path = Path(raw).expanduser()
    return path if path.is_dir() else None


def symbols_dir() -> Path | None:
    base = root()
    if base is None:
        return None
    folder = base / SYMBOL_SUBDIR
    return folder if folder.is_dir() else None


def available() -> bool:
    return symbols_dir() is not None


# --- Stichwortindex ----------------------------------------------------------

def _asar_source() -> tuple[Path, str | None] | None:
    """Wo die MetaSearch-Datenbank steckt: (Datei, Eintrag im ZIP oder None).

    Zwei Fälle: Wer MetaSearch installiert hat, hat app.asar als normale Datei
    im Paket liegen. Wer es nur heruntergeladen hat, hat das ZIP.
    """
    base = root()
    if base is None:
        return None

    for asar in sorted((base / "MetaSearch").rglob("app.asar")):
        return (asar, None)

    # Die Plattform des laufenden Rechners zuerst - das ZIP der eigenen
    # Plattform ist am ehesten vollständig heruntergeladen.
    order = {"darwin": "Mac", "win32": "Windows"}.get(sys.platform, "Linux")
    folders = sorted((base / "MetaSearch").glob("*"),
                     key=lambda p: (p.name != order, p.name))
    for folder in folders:
        for archive in sorted(folder.glob("*.zip")):
            try:
                with zipfile.ZipFile(archive) as bundle:
                    for name in bundle.namelist():
                        if name.endswith("app.asar"):
                            return (archive, name)
            except (zipfile.BadZipFile, OSError):
                continue
    return None


def _read_asar_entry(stream, parts: list[str]) -> bytes:
    """Eine einzelne Datei aus einem asar-Archiv holen.

    asar ist ein JSON-Kopf mit Offsets, danach die Dateien am Stück. Der Strom
    muss nicht spulbar sein - aus einem ZIP heraus ist er das nicht -, deshalb
    wird notfalls vorgelesen und verworfen statt gesprungen.
    """
    head = stream.read(16)
    if len(head) < 16:
        raise ValueError("asar-Kopf unvollständig.")
    json_len = struct.unpack("<I", head[12:16])[0]
    header = json.loads(stream.read(json_len).decode("utf-8"))

    start = 16 + json_len
    start += (4 - start % 4) % 4   # der Datenteil beginnt auf 4 Byte ausgerichtet

    node = header
    for part in parts:
        node = node["files"][part]
    offset, size = int(node["offset"]), int(node["size"])

    target = start + offset
    position = 16 + json_len
    if hasattr(stream, "seekable") and stream.seekable():
        stream.seek(target)
    else:
        while position < target:
            chunk = stream.read(min(1 << 20, target - position))
            if not chunk:
                raise ValueError("asar endet vor der gesuchten Datei.")
            position += len(chunk)

    data = b""
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            break
        data += chunk
    return data


def _load_database() -> list[dict] | None:
    """Die deutschen Einträge aus metacom-db.json - oder None."""
    found = _asar_source()
    if found is None:
        return None
    container, member = found
    try:
        if member is None:
            with container.open("rb") as stream:
                raw = _read_asar_entry(stream, DB_IN_ASAR)
        else:
            with zipfile.ZipFile(container) as bundle:
                with bundle.open(member) as stream:
                    raw = _read_asar_entry(stream, DB_IN_ASAR)
        blocks = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError, KeyError, json.JSONDecodeError, zipfile.BadZipFile):
        # Ein anderes METACOM, ein anderes Verpackungsformat - kein Grund,
        # die Anwendung anzuhalten. Es geht ohne Stichwörter weiter.
        return None

    for block in blocks if isinstance(blocks, list) else []:
        if isinstance(block, dict) and block.get("language") == LANGUAGE:
            symbols = block.get("symbols")
            return symbols if isinstance(symbols, list) else None
    return None


def _fingerprint() -> str:
    """Kennung der Quelle, damit der Zwischenspeicher nicht veraltet."""
    folder = symbols_dir()
    if folder is None:
        return ""
    found = _asar_source()
    parts = [str(folder)]
    if found is not None:
        container, member = found
        try:
            stat = container.stat()
            parts += [str(container), member or "", str(stat.st_size), str(int(stat.st_mtime))]
        except OSError:
            pass
    return "|".join(parts)


def _scan_files() -> dict[str, str]:
    """Dateiname ohne Endung -> Pfad relativ zum Symbolordner.

    Flach über alle Kategorieordner statt über die Kategorie aus dem Index:
    die stimmt nur in 87 % der Fälle mit dem Ordner überein, der Dateiname
    dagegen ist eindeutig.
    """
    folder = symbols_dir()
    if folder is None:
        return {}
    files: dict[str, str] = {}
    for path in folder.rglob("*.png"):
        files.setdefault(path.stem, str(path.relative_to(folder)))
    return files


def _build_index() -> dict:
    files = _scan_files()
    database = _load_database()

    entries = []
    if database:
        for symbol in database:
            name = symbol.get("name")
            if not name or name not in files:
                continue
            keywords = [k for k in (symbol.get("keywords") or []) if isinstance(k, str)]
            entries.append([name, keywords])
    else:
        # Rückfall ohne MetaSearch-Datenbank: der Dateiname ist das einzige
        # Stichwort. Findet "wuetend", aber eben nicht "Wut".
        entries = [[name, []] for name in sorted(files)]

    return {
        "version": CACHE_VERSION,
        "fingerprint": _fingerprint(),
        "keywords": bool(database),
        "files": files,
        "entries": entries,
    }


_cache: dict | None = None


def index() -> dict:
    """Der Suchindex, aus dem Zwischenspeicher oder frisch erzeugt."""
    global _cache
    if not available():
        return {"version": CACHE_VERSION, "fingerprint": "", "keywords": False,
                "files": {}, "entries": []}

    want = _fingerprint()
    if _cache is not None and _cache.get("fingerprint") == want:
        return _cache

    if CACHE_FILE.exists():
        try:
            stored = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
            if (stored.get("version") == CACHE_VERSION
                    and stored.get("fingerprint") == want):
                _cache = stored
                return _cache
        except (OSError, json.JSONDecodeError):
            pass

    _cache = _build_index()
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(
            json.dumps(_cache, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass   # ohne Zwischenspeicher dauert der Start länger, mehr nicht
    return _cache


def has_keywords() -> bool:
    return bool(index().get("keywords"))


def count() -> int:
    return len(index().get("entries") or [])


# --- Suche -------------------------------------------------------------------

def _fold(value: str) -> str:
    """Kleinschreibung ohne Umlaute, damit "Fuß" und "fuss" dasselbe treffen."""
    value = value.strip().lower()
    for source, replacement in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        value = value.replace(source, replacement)
    value = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in value if not unicodedata.combining(ch))


def base_name(name: str) -> str:
    """Das Grundsymbol hinter einer Variante: wuetendSW und wuetend2 -> wuetend."""
    stripped = VARIANT_SUFFIX.sub("", name)
    stripped = TRAILING_DIGITS.sub("", stripped)
    return (stripped or name).lower()


def is_variant(name: str) -> bool:
    return base_name(name) != name.lower()


def pretty(keyword: str) -> str:
    """METACOM schreibt mehrteilige Stichwörter mit Unterstrich - für ein
    Textfeld, das vorgelesen wird, sind Leerzeichen richtig."""
    return keyword.replace("_", " ").strip()


def label_for(name: str) -> str:
    """Was als Beschriftung und als Textvorschlag taugt."""
    for entry_name, keywords in index().get("entries") or []:
        if entry_name == name:
            if keywords:
                return pretty(keywords[0])
            break
    return pretty(name)


def resolve(name: str) -> Path | None:
    """Die Bilddatei zu einem METACOM-Namen - oder None."""
    folder = symbols_dir()
    if folder is None or not name:
        return None
    relative = (index().get("files") or {}).get(name)
    if not relative:
        return None
    path = folder / relative
    # Der Name kommt aus dem Layout und damit von außen: sicherstellen, dass
    # er im Symbolordner bleibt.
    try:
        path.resolve().relative_to(folder.resolve())
    except ValueError:
        return None
    return path if path.exists() else None


def search(word: str, limit: int = 40) -> list[dict]:
    """Treffer aus der lizenzierten Sammlung, beste zuerst.

    Varianten desselben Symbols werden zusammengefasst - sonst füllt ein
    einziges Wort die ganze Ergebnisliste mit Fassungen seiner selbst.
    """
    needle = _fold(word)
    if not needle or not available():
        return []

    best: dict[str, tuple[int, str, str]] = {}
    for name, keywords in index().get("entries") or []:
        score = 0
        for position, keyword in enumerate(keywords):
            folded = _fold(keyword)
            # Das erste Stichwort ist das Symbol selbst, jedes weitere nur ein
            # verwandter Begriff. Ohne diesen Unterschied steht die Asiabox
            # vor dem Essen, weil beide "essen" führen. Das Gefälle ist so
            # gewählt, dass ein Wortanfang im eigenen Stichwort ("wut" in
            # "wütend") vor einem fremden Synonym liegt.
            weight = 1.0 if position == 0 else 0.6
            if folded == needle:
                score = max(score, round(100 * weight))
            elif folded.startswith(needle):
                score = max(score, round(70 * weight))
            elif needle in folded:
                score = max(score, round(40 * weight))
        folded_name = _fold(name)
        if folded_name == needle:
            score = max(score, 90)
        elif needle in folded_name:
            score = max(score, 30)
        if not score:
            continue

        # Das schlichte Symbol vor seinen Fassungen zeigen.
        if not is_variant(name):
            score += 15

        stem = base_name(name)
        label = pretty(keywords[0] if keywords else name)
        current = best.get(stem)
        if current is None or score > current[0]:
            best[stem] = (score, name, label)

    ranked = sorted(best.values(), key=lambda item: (-item[0], item[1]))
    return [
        {
            "source": "metacom",
            "ref": f"metacom:{name}",
            "label": label,
            "url": "/symbols/" + urllib.parse.quote(f"metacom:{name}"),
        }
        for _, name, label in ranked[:limit]
    ]
