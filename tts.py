#!/usr/bin/env python3
"""Azure text-to-speech for vorlaut.

Renders a sentence with the voice de-DE-GiselaNeural, trims silence at both
ends, normalises loudness and stores the result as a 16 kHz mono 16 bit WAV in
the cache.

Re-rendering happens only when the text or the voice configuration changed
(the fingerprint covers both).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Same root as in build.py - the reasoning is over there.
CONTENT = Path(os.environ.get("VORLAUT_CONTENT") or ROOT / "content").resolve()
CACHE_DIR = CONTENT / "cache" / "tts"
INDEX_FILE = CACHE_DIR / "index.json"
ENV_FILE = ROOT / ".env"

_index_lock = threading.Lock()

def load_env_file(path: Path = ENV_FILE) -> dict[str, str]:
    """Reads .env as a plain KEY=VALUE file. Lines starting with # are ignored."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def setting(name: str, standard: str) -> str:
    """Value from the environment, else from .env, else the default.

    A set environment variable wins - that way a single run can try something
    different without touching the file.
    """
    value = os.environ.get(name, "").strip()
    if value:
        return value
    value = load_env_file().get(name, "").strip()
    return value or standard


# --- Voice configuration -----------------------------------------------------
# Everything here feeds into the fingerprint: change one value and the
# affected WAVs get re-rendered on the next build.
#
# Configurable through .env or environment variables:
#   AZURE_SPEECH_REGION   must match the region of the key
#   AZURE_SPEECH_VOICE    e.g. de-DE-KatjaNeural, list them with --voices
#   AZURE_SPEECH_RATE     speaking rate, e.g. -5% or +10%
REGION = setting("AZURE_SPEECH_REGION", "germanywestcentral")
VOICE = setting("AZURE_SPEECH_VOICE", "de-DE-GiselaNeural")
RATE = setting("AZURE_SPEECH_RATE", "-5%")

# The language sits inside the voice name: de-DE-GiselaNeural -> de-DE
_teile = VOICE.split("-")
LOCALE = "-".join(_teile[:2]) if len(_teile) >= 3 else "de-DE"

SAMPLE_RATE = 16000

# Post-processing. Bump the version when the ffmpeg chain changes.
PIPELINE_VERSION = 2
SILENCE_THRESHOLD = "-45dB"
LOUDNORM = "I=-16:TP=-1.5:LRA=11"
# Do not trim down to the last audible sample: a little room tone stays, or
# short words like "Ja" end up sounding clipped.
KEEP_HEAD = 0.06   # Sekunden Stille vor dem Wort
KEEP_TAIL = 0.10   # Sekunden nach dem Wort, damit es ausklingen darf
FADE = 0.012       # kurze Blende an beiden Rändern gegen Knackser
TAIL_PAD = 0.06    # Ruhe am Ende, bevor der Verstärker abschaltet

AZURE_ENDPOINT = f"https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
AZURE_FORMAT = "riff-16khz-16bit-mono-pcm"


class TTSError(RuntimeError):
    pass


# --- Key ---------------------------------------------------------------------

def get_speech_key() -> str:
    """A set environment variable wins, otherwise .env."""
    key = os.environ.get("AZURE_SPEECH_KEY", "").strip()
    if key:
        return key
    key = load_env_file().get("AZURE_SPEECH_KEY", "").strip()
    if not key:
        raise TTSError(
            "AZURE_SPEECH_KEY fehlt. Entweder als Umgebungsvariable setzen "
            "oder in die Datei .env schreiben (Vorlage: .env.example)."
        )
    return key


def have_key() -> bool:
    try:
        get_speech_key()
        return True
    except TTSError:
        return False


# --- Fingerprint -------------------------------------------------------------

def voice_config() -> dict:
    return {
        "voice": VOICE,
        "locale": LOCALE,
        "region": REGION,
        "rate": RATE,
        "sample_rate": SAMPLE_RATE,
        "azure_format": AZURE_FORMAT,
        "pipeline": PIPELINE_VERSION,
        "silence_threshold": SILENCE_THRESHOLD,
        "loudnorm": LOUDNORM,
    }


def fingerprint(text: str) -> str:
    payload = json.dumps(
        {"text": text.strip(), **voice_config()},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def cache_path(text: str) -> Path:
    return CACHE_DIR / f"{fingerprint(text)}.wav"


def load_index() -> dict:
    """Fingerprint -> spoken text.

    The file names in the cache are hashes and therefore unreadable. This
    index makes them readable again - and records what was spoken once, even
    after it disappears from layout.json.
    """
    if not INDEX_FILE.exists():
        return {}
    try:
        data = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def remember(text: str) -> None:
    key = fingerprint(text)
    with _index_lock:
        index = load_index()
        if index.get(key) == text:
            return
        index[key] = text
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        INDEX_FILE.write_text(
            json.dumps(index, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )


# --- Azure -------------------------------------------------------------------

def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build_ssml(text: str) -> str:
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xml:lang="{LOCALE}">'
        f'<voice name="{VOICE}">'
        f'<prosody rate="{RATE}">{_xml_escape(text.strip())}</prosody>'
        "</voice></speak>"
    )


def azure_synthesize(text: str) -> bytes:
    """Calls the Azure Speech REST API and returns raw WAV bytes."""
    request = urllib.request.Request(
        AZURE_ENDPOINT,
        data=build_ssml(text).encode("utf-8"),
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": get_speech_key(),
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": AZURE_FORMAT,
            "User-Agent": "vorlaut",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        if exc.code == 401:
            raise TTSError(
                "Azure lehnt den Key ab (401). Stimmen Key und Region "
                f"({REGION}) zusammen?"
            ) from exc
        raise TTSError(f"Azure-Fehler {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise TTSError(f"Azure nicht erreichbar: {exc.reason}") from exc


# --- ffmpeg ------------------------------------------------------------------

def _ffmpeg_binary() -> str:
    binary = shutil.which("ffmpeg")
    if not binary:
        raise TTSError("ffmpeg nicht gefunden. Unter macOS: brew install ffmpeg")
    return binary


def _filter_chain() -> str:
    """Builds the ffmpeg filter chain.

    Order: trim and fade in the leading silence, reverse the signal, do the
    same for the (now leading) tail, reverse back, append a little quiet at
    the end, normalise last.
    """

    def trim(keep: float) -> str:
        return (
            "silenceremove=start_periods=1:start_duration=0"
            f":start_silence={keep}"
            f":start_threshold={SILENCE_THRESHOLD}:detection=peak"
        )

    fade = f"afade=t=in:st=0:d={FADE}"
    return ",".join(
        [
            trim(KEEP_HEAD),
            fade,
            "areverse",
            trim(KEEP_TAIL),
            fade,
            "areverse",
            f"apad=pad_dur={TAIL_PAD}",
            f"loudnorm={LOUDNORM}",
        ]
    )


def postprocess(raw_wav: bytes, target: Path) -> None:
    """Trims silence, normalises and writes 16 kHz mono 16 bit."""
    ffmpeg = _ffmpeg_binary()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "in.wav"
        source.write_bytes(raw_wav)
        output = Path(tmp) / "out.wav"
        result = subprocess.run(
            [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(source),
                "-af", _filter_chain(),
                "-ar", str(SAMPLE_RATE),
                "-ac", "1",
                "-c:a", "pcm_s16le",
                str(output),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not output.exists():
            raise TTSError(f"ffmpeg fehlgeschlagen: {result.stderr.strip()[:400]}")
        shutil.copyfile(output, target)


# --- Public interface --------------------------------------------------------

def synthesize(text: str, force: bool = False) -> Path:
    """Returns the path to a finished WAV for this text.

    Renders only when no file for that fingerprint exists in the cache yet.
    """
    text = (text or "").strip()
    if not text:
        raise TTSError("Leerer Text lässt sich nicht sprechen.")
    target = cache_path(text)
    remember(text)
    if target.exists() and not force:
        return target
    raw = azure_synthesize(text)
    postprocess(raw, target)
    return target


def list_voices() -> int:
    """Shows which voices one's own key offers in this region."""
    url = f"https://{REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list"
    request = urllib.request.Request(
        url, headers={"Ocp-Apim-Subscription-Key": get_speech_key()})
    try:
        with urllib.request.urlopen(request, timeout=30) as antwort:
            voices = json.loads(antwort.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(f"Azure antwortet mit {exc.code}. Passen Schlüssel und Region "
              f"({REGION}) zusammen?", file=sys.stderr)
        return 1
    language = LOCALE.split("-")[0]
    matching = [v for v in voices if v.get("Locale", "").startswith(language)]
    print(f"Region {REGION}, Sprache {language}: {len(matching)} Stimmen")
    for v in sorted(matching, key=lambda x: x["ShortName"]):
        styles = ", ".join(v.get("StyleList") or []) or "-"
        marker = " <- eingestellt" if v["ShortName"] == VOICE else ""
        print(f"  {v['ShortName']:32} {v.get('Gender',''):7} Stile: {styles}{marker}")
    print("\nAndere wählen: AZURE_SPEECH_VOICE in .env eintragen.")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[1] == "--voices":
        try:
            return list_voices()
        except TTSError as exc:
            print(f"Fehler: {exc}", file=sys.stderr)
            return 1
    if len(argv) < 2:
        print("Aufruf: python3 tts.py \"Der Satz\" [target.wav]\n"
              "        python3 tts.py --voices", file=sys.stderr)
        return 2
    text = argv[1]
    try:
        path = synthesize(text)
    except TTSError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    if len(argv) >= 3:
        destination = Path(argv[2])
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        path = destination
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
