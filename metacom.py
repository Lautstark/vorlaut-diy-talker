#!/usr/bin/env python3
"""Access to a licensed METACOM 9 collection.

The symbols stay where they are: they are neither copied into the project nor
versioned. All that gets configured is the path to the unpacked download:

    VORLAUT_METACOM_DIR=/Users/you/METACOM_9_Desktop

If the variable is empty or the folder is gone, everything behaves as before -
search returns ARASAAC only, and a layout referring to METACOM symbols shows
the usual placeholder tile instead of failing.

In the layout, METACOM symbols are written as "metacom:<name>", where <name>
is the file name without extension, i.e. exactly the identifier from the
keyword index.

Keywords come from the MetaSearch database. It lives inside the application
itself (Electron, app.asar) rather than as a loose file next to it, hence the
small detour through the archive format below. If the database cannot be
found, search falls back to file names - worse, but usable.
"""

from __future__ import annotations

import json
import re
import struct
import sys
import urllib.parse
import unicodedata
import zipfile

import config
from pathlib import Path

CACHE_FILE = config.CONTENT / "cache" / "metacom-index.json"

# Without a border, because the firmware draws one itself - otherwise two
# borders would sit inside each other.
SYMBOL_SUBDIR = Path("METACOM_Symbole") / "Symbole_PNG" / "PNG_ohne_Rahmen"
DB_IN_ASAR = ["assets", "db", "metacom-db.json"]
LANGUAGE = "deutsch"
CACHE_VERSION = 1        # bump when the cache layout changes

# SW = black and white, FB and _dh = further renditions of the same symbol,
# digits = alternatives. About half of the 17,114 files are such variants;
# unfiltered, a search for "essen" spills out 94 tiles.
VARIANT_SUFFIX = re.compile(r"(?:(?:SW|FB)|_(?:dh|sh|mh))$")
TRAILING_DIGITS = re.compile(r"\d+$")


def configured() -> str:
    """The configured path: environment first, then .env.

    Same order as for the Azure settings in tts.py - a set environment
    variable wins, so that a single run can try something different without
    touching the file.
    """
    return config.value("VORLAUT_METACOM_DIR")


def root() -> Path | None:
    """The package folder - or None when nothing is configured."""
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


# --- Keyword index -----------------------------------------------------------

def _asar_source() -> tuple[Path, str | None] | None:
    """Where the MetaSearch database sits: (file, entry inside the ZIP or None).

    Two cases: whoever installed MetaSearch has app.asar as a plain file in
    the package. Whoever only downloaded it has the ZIP.
    """
    base = root()
    if base is None:
        return None

    for asar in sorted((base / "MetaSearch").rglob("app.asar")):
        return (asar, None)

    # The running machine's platform first - the ZIP for one's own platform
    # is the one most likely to have been downloaded completely.
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
    """Fetch a single file out of an asar archive.

    asar is a JSON header with offsets, followed by the files in one block.
    The stream need not be seekable - out of a ZIP it is not - so if need be
    we read forward and discard instead of seeking.
    """
    head = stream.read(16)
    if len(head) < 16:
        raise ValueError("asar header incomplete.")
    json_len = struct.unpack("<I", head[12:16])[0]
    header = json.loads(stream.read(json_len).decode("utf-8"))

    start = 16 + json_len
    start += (4 - start % 4) % 4   # the data section starts 4-byte aligned

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
                raise ValueError("asar ends before the requested file.")
            position += len(chunk)

    data = b""
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            break
        data += chunk
    return data


def _load_database() -> list[dict] | None:
    """The German entries from metacom-db.json - or None."""
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
        # A different METACOM, a different packaging format - no reason to
        # halt the application. It carries on without keywords.
        return None

    for block in blocks if isinstance(blocks, list) else []:
        if isinstance(block, dict) and block.get("language") == LANGUAGE:
            symbols = block.get("symbols")
            return symbols if isinstance(symbols, list) else None
    return None


def _fingerprint() -> str:
    """Identifier of the source, so the cache does not go stale."""
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
    """File name without extension -> path relative to the symbol folder.

    Flat across all category folders rather than via the category from the
    index: that one matches the folder in only 87 % of cases, whereas the file
    name is unambiguous.
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
        # Fallback without the MetaSearch database: the file name is the only
        # keyword. Finds "wuetend", but not "Wut".
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
    """The search index, from cache or freshly built."""
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
        pass   # without a cache the start takes longer, nothing worse
    return _cache


def has_keywords() -> bool:
    return bool(index().get("keywords"))


def count() -> int:
    return len(index().get("entries") or [])


# --- Search ------------------------------------------------------------------

def _fold(value: str) -> str:
    """Lower case without umlauts, so that "Fuß" and "fuss" match the same."""
    value = value.strip().lower()
    for source, replacement in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        value = value.replace(source, replacement)
    value = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in value if not unicodedata.combining(ch))


def base_name(name: str) -> str:
    """The base symbol behind a variant: wuetendSW and wuetend2 -> wuetend."""
    stripped = VARIANT_SUFFIX.sub("", name)
    stripped = TRAILING_DIGITS.sub("", stripped)
    return (stripped or name).lower()


def is_variant(name: str) -> bool:
    return base_name(name) != name.lower()


def pretty(keyword: str) -> str:
    """METACOM writes multi-part keywords with underscores - for a text field
    that gets spoken aloud, spaces are the right thing."""
    return keyword.replace("_", " ").strip()


def label_for(name: str) -> str:
    """What works as a caption and as a suggested text."""
    for entry_name, keywords in index().get("entries") or []:
        if entry_name == name:
            if keywords:
                return pretty(keywords[0])
            break
    return pretty(name)


def resolve(name: str) -> Path | None:
    """The image file for a METACOM name - or None."""
    folder = symbols_dir()
    if folder is None or not name:
        return None
    relative = (index().get("files") or {}).get(name)
    if not relative:
        return None
    path = folder / relative
    # The name comes from the layout and therefore from outside: make sure it
    # stays inside the symbol folder.
    try:
        path.resolve().relative_to(folder.resolve())
    except ValueError:
        return None
    return path if path.exists() else None


def search(word: str, limit: int = 40) -> list[dict]:
    """Hits from the licensed collection, best first.

    Variants of the same symbol are collapsed - otherwise a single word fills
    the whole result list with renditions of itself.
    """
    needle = _fold(word)
    if not needle or not available():
        return []

    best: dict[str, tuple[int, str, str]] = {}
    for name, keywords in index().get("entries") or []:
        score = 0
        for position, keyword in enumerate(keywords):
            folded = _fold(keyword)
            # The first keyword is the symbol itself, every further one only
            # a related term. Without that distinction the lunch box beats the
            # meal, because both carry "essen". The gradient is chosen so that
            # a prefix match in the symbol's own keyword ("wut" in "wütend")
            # outranks someone else's synonym.
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

        # Show the plain symbol ahead of its renditions.
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
