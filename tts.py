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
import time
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

import config
import texts

ROOT = Path(__file__).resolve().parent
CACHE_DIR = config.CONTENT / "cache" / "tts"
INDEX_FILE = CACHE_DIR / "index.json"

_index_lock = threading.Lock()

# Reading .env lives in config.py, which also writes it - see there for why
# that is one place and not four.
setting = config.value


# --- Voice configuration -----------------------------------------------------
# Which voice speaks is not settled here: it stands in layout.json next to the
# menu language, so the page can change it and the next sentence is already
# spoken differently. Everything in this file is what stays the same no matter
# which voice was chosen.
#
# Configurable through .env or environment variables:
#   AZURE_SPEECH_REGION   must match the region of the key
#   AZURE_SPEECH_RATE     speaking rate, e.g. -5% or +10%
# Asked for when it is needed, not once at import: the page can write a new
# one into .env, and a key that arrives together with a region has to reach
# that region straight away. Frozen here, the key would work and point at the
# wrong endpoint until somebody restarted the server.
def region() -> str:
    return setting("AZURE_SPEECH_REGION", "germanywestcentral")

# The rate stays frozen at import, deliberately the other way round: it does
# change how a sentence sounds and so belongs in the fingerprint, and reading
# it live would rename every cached WAV the moment somebody edited the file.
# Nothing in the interface writes this one - it takes a hand edit and a
# restart, and the restart is what keeps the cache and the setting in step.
RATE = setting("AZURE_SPEECH_RATE", "-5%")

# From the time before layout.json knew about voices. An entry here decides
# which voice an existing installation carries over on the first start; after
# that layout.json answers the question and this is not read again.
SEED_VOICE = setting("AZURE_SPEECH_VOICE", "")

# Piper models are looked for here, first match wins. VORLAUT_VOICES comes
# first for whoever keeps their models somewhere of their own; the container
# used to set it to /voices, and it is kept because the reason outlived the
# container. Then content/voices, so a voice put next to the rest of the
# content is found and is backed up along with it, and only then the copy
# next to the code.
VOICE_DIRS = [d for d in dict.fromkeys(
    [Path(os.environ["VORLAUT_VOICES"]) if os.environ.get("VORLAUT_VOICES") else None,
     config.CONTENT / "voices", ROOT / "voices"]) if d is not None]

# Which languages the Azure catalogue is trimmed to. Azure offers 556 voices,
# and a picker holding all of them is not a picker. German and English are
# what this is for; "de" would take every German locale, "de-DE" only that one.
AZURE_LANGUAGES = tuple(
    part.strip() for part in setting("AZURE_SPEECH_LANGUAGES", "de-DE,en-US").split(",")
    if part.strip()
)

# The list is asked of Azure rather than written down here: a hand-typed one
# goes stale, and it costs a request on every page load otherwise.
AZURE_CACHE_DAYS = 7
AZURE_VOICE_CACHE = config.CONTENT / "cache" / "azure-voices.json"

# The program that reads a piper model. Comes with the piper-tts package.
PIPER_BINARY = setting("VORLAUT_PIPER_BINARY", "piper")


def piper_binary() -> str:
    """The piper program, or "" when there is none.

    Not shutil.which() alone: pip puts the program next to the interpreter
    that installed it, and the README starts the server as .venv/bin/python
    app.py - without activating anything. Then .venv/bin is not in PATH, and
    piper would be there and still count as missing.
    """
    beside = Path(sys.executable).parent / PIPER_BINARY
    if beside.is_file() and os.access(beside, os.X_OK):
        return str(beside)
    return shutil.which(PIPER_BINARY) or ""


# What a voice is called when there is none to be had: no model on disk, no
# key. Nothing can be spoken with it - but the sentences that were spoken
# before this project could choose a voice were fingerprinted under exactly
# this name, and they stay usable from the cache.
FALLBACK_VOICE = f"azure:{SEED_VOICE or 'de-DE-GiselaNeural'}"

SAMPLE_RATE = 16000

# Post-processing. Bump the version when the ffmpeg chain changes.
#
# 3 because the trim moved onto the shared contract - see SILENCE_THRESHOLD
# below. Every recording ever made here was named under the old numbers, so
# every one of them is re-rendered once.
PIPELINE_VERSION = 3
# Which piper rendered a recording. It belongs in the fingerprint because
# piper is what makes the audio, and a release that changed how a voice sounds
# would otherwise leave old recordings in the cache under names claiming they
# match new ones - two sentences on one device, in two different voices.
#
# Written down rather than read from the installed package, which would be the
# obvious way and is the wrong one: voice_config() promises to derive a name
# from the voice id alone, no disk and no network, so that a machine which
# cannot render a WAV still knows what it would have been called. Ask the
# installed piper and a computer without piper gets a different answer, and
# the device fetches a cache it already has.
#
# So it is a constant, kept in step with the version doctor.py tells people to
# install, by tests/test_piper_version.py. Bump both together, and expect every
# piper-spoken sentence to be rendered again.
PIPER_VERSION = "1.7.0"
# These four are not ours any more. They are CONTRACT.md §1 and §2 in
# static/vendor/stimmquelle/, which mitreden keeps too, and the whole point of
# a shared contract is that neither product edits its copy alone.
# tests/test_browser_tts.py reads the contract out of the vendored package and
# fails if these drift from it.
#
# They used to be -45 dB keeping 60/100 ms. That was not a considered
# difference from anything, it was simply what this file happened to say, and
# the contract calls it drift and settles it at -50 keeping 50/50. Adopting it
# is why PIPELINE_VERSION went to 3.
SILENCE_THRESHOLD = "-50dB"
LOUDNORM = "I=-16:TP=-1.5:LRA=11"
KEEP_HEAD = 0.05   # seconds of silence kept before the word
KEEP_TAIL = 0.05   # seconds kept after it

# These two are ours, and the contract says so: "permitted device extras",
# off unless a consumer asks. Neither changes measured loudness. They are here
# because of the amplifier this thing has - a class-D MAX98357A, which clicks
# when a waveform starts away from zero and cuts off mid-syllable when the
# signal simply stops.
FADE = 0.012       # short fade at both ends against clicks
TAIL_PAD = 0.06    # quiet at the end, before the amplifier switches off

def azure_endpoint() -> str:
    return (f"https://{region()}.tts.speech.microsoft.com"
            "/cognitiveservices/v1")


def azure_voice_list() -> str:
    return (f"https://{region()}.tts.speech.microsoft.com"
            "/cognitiveservices/voices/list")
AZURE_FORMAT = "riff-16khz-16bit-mono-pcm"


class TTSError(RuntimeError):
    """Same idea as build.BuildError: a key and its values, not a sentence.

    str() renders English for the command line, message(lang) renders for the
    web interface.
    """

    def __init__(self, key: str, **params):
        self.key = key
        self.params = params
        super().__init__(texts.t(key, **params))

    def message(self, lang: str) -> str:
        return texts.t(self.key, lang, **self.params)


# --- Key ---------------------------------------------------------------------

def get_speech_key() -> str:
    """A set environment variable wins, otherwise .env.

    Both of those are config.value()'s job, and it did them here twice: this
    used to check os.environ itself first, from before there was one place
    that reads .env. The two orders agreed, so nothing was ever wrong - the
    lines simply stopped doing anything.
    """
    key = config.value("AZURE_SPEECH_KEY")
    if not key:
        raise TTSError("tts.err.no_key")
    return key


def have_key() -> bool:
    try:
        get_speech_key()
        return True
    except TTSError:
        return False


# --- The catalogue -----------------------------------------------------------
# A voice is named by one string: "piper:de_DE-thorsten-medium" or
# "azure:de-DE-GiselaNeural". That is what stands in layout.json, and
# everything else about the voice is derived from it.

def piper_models() -> dict[str, Path]:
    """Every piper model on this machine, by name.

    The .onnx.json next to a model is piper's own description of it and has to
    be there, so a lone .onnx is not a usable voice.
    """
    found: dict[str, Path] = {}
    for directory in VOICE_DIRS:
        if not directory.is_dir():
            continue
        for file in sorted(directory.glob("*.onnx")):
            if file.with_suffix(".onnx.json").exists() and file.stem not in found:
                found[file.stem] = file
    return found


def pretty_piper(stem: str) -> str:
    """de_DE-thorsten-medium -> Thorsten.

    The quality tier belongs to the file, not to the voice - whoever picks a
    voice does not need to know it.
    """
    rest = stem.split("-", 1)[1] if "-" in stem else stem
    return rest.partition("-")[0].replace("_", " ").title()


# --- Fetching a voice --------------------------------------------------------
# Which voices can be had and where they come from. Here rather than in
# tools/voices.py because two things fetch them now: the command line and the
# page, and a second copy of this list would go out of step with the first.

VOICE_SOURCE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

# Two German and two English voices, one male and one female each. All four
# are public domain - which is what lets them be handed on. Most of piper's
# better known English voices are not; before adding one, read its MODEL_CARD
# next to the model, not the file name.
#
# ljspeech would be the obvious English pick and is public domain too, but it
# is the name of a dataset, and in a list of first names it reads like an
# error. Kristin is just as free and sits better among the others.
#
# Two of these four cannot be spoken in a browser, which matters because the
# app half is being rewritten as a static site. Kerstin is published as "low"
# only, and the phonemizer the browser build uses cannot read a low model's
# symbol table; John is fetched fine by this code and is missing from the
# table of paths that build ships, so it cannot fetch it at all. That leaves
# Thorsten and Kristin - and no German female voice anywhere in piper, because
# all three it publishes are low or x_low.
#
# The list below is deliberately not trimmed for that. Both voices work here,
# and here is what this list is for: what tts.py downloads and speaks with. What a browser can speak with is a different list with different
# reasons behind it, and it is the catalogue in the shared package - one
# list per question rather than one list that answers neither. What keeps them
# from drifting apart is tests/test_browser_tts.py, which fails if a voice is
# added here without an answer over there. The measurements are in
# docs/browser-tts.md.
VOICE_CATALOGUE = {
    "de": [
        "de/de_DE/thorsten/medium/de_DE-thorsten-medium",
        "de/de_DE/kerstin/low/de_DE-kerstin-low",
    ],
    "en": [
        "en/en_US/kristin/medium/en_US-kristin-medium",
        "en/en_US/john/medium/en_US-john-medium",
    ],
}

# A model is only usable together with its .onnx.json - that file is piper's
# own description of the voice, and without it the model is just a blob.
MODEL_PARTS = (".onnx", ".onnx.json")

DOWNLOAD_TRIES = 5


def voice_target() -> Path:
    """Where a fetched voice belongs.

    The first entry of VOICE_DIRS is where the search looks first, so a voice
    put there is the one that gets found.
    """
    return VOICE_DIRS[0]


def missing_voices(lang: str = "") -> list[str]:
    """The catalogue entries that are not on this machine yet."""
    folder = voice_target()
    wanted = VOICE_CATALOGUE.get(lang, []) if lang else [
        entry for entries in VOICE_CATALOGUE.values() for entry in entries]
    return [entry for entry in wanted
            if not all((folder / f"{entry.rsplit('/', 1)[-1]}{part}").exists()
                       for part in MODEL_PARTS)]


def download_voice(entry: str, note=None) -> None:
    """Fetches one voice - both its parts - into the voice folder.

    This hangs off somebody else's server. A single failed request used to be
    enough to leave half a voice on the disk, so it retries, and writes each
    file only once it arrived whole.
    """
    folder = voice_target()
    folder.mkdir(parents=True, exist_ok=True)
    name = entry.rsplit("/", 1)[-1]
    for part in MODEL_PARTS:
        target = folder / f"{name}{part}"
        if target.exists():
            continue
        last: Exception | None = None
        for attempt in range(1, DOWNLOAD_TRIES + 1):
            try:
                with urllib.request.urlopen(
                        f"{VOICE_SOURCE}/{entry}{part}", timeout=60) as response:
                    data = response.read()
                # A half file next to a whole .onnx.json looks like a usable
                # voice and is not one.
                interim = target.with_suffix(target.suffix + ".part")
                interim.write_bytes(data)
                interim.replace(target)
                last = None
                break
            except (urllib.error.URLError, OSError) as exc:
                last = exc
                if note:
                    note(f"{name}{part}: attempt {attempt} of "
                         f"{DOWNLOAD_TRIES} failed")
        if last is not None:
            raise TTSError("tts.err.voice_download", name=name, reason=str(last))


def short_azure(name: str) -> str:
    """de-DE-GiselaNeural -> Gisela, de-DE-FlorianMultilingualNeural ->
    Florian Multilingual. The locale is in every entry already, and so is the
    word Neural."""
    if name.count("-") < 2:
        return name
    base = name.split("-")[-1]
    if base.endswith("Neural"):
        base = base[: -len("Neural")]
    out = ""
    for index, char in enumerate(base):
        if index and char.isupper() and base[index - 1].islower():
            out += " "
        out += char
    return out


def lang_of(tag: str) -> str:
    """de_DE-thorsten-medium, de-DE-GiselaNeural, de-DE -> de"""
    return tag.replace("_", "-").split("-")[0].lower() if tag else ""


def locale_of(name: str) -> str:
    """The language Azure is told to read in: de-DE-GiselaNeural -> de-DE."""
    parts = name.split("-")
    return "-".join(parts[:2]) if len(parts) >= 3 else "de-DE"


def label_of(name: str, backend: str, lang: str = "") -> str:
    """Name, where it comes from, which language it speaks - the three things
    that tell two entries in a picker apart."""
    return " \u00b7 ".join(part for part in (name, backend, lang) if part)


def piper_voices() -> list[dict]:
    """The local voices. Needs no key and no network.

    A model without the program that reads it is a voice nobody can use, so
    it is not offered either.
    """
    if not piper_binary():
        return []
    return [
        {
            "id": f"piper:{stem}",
            "label": label_of(pretty_piper(stem), "piper", lang_of(stem)),
            "backend": "piper",
            "lang": lang_of(stem),
        }
        for stem in piper_models()
    ]


def azure_voice_names() -> list[str]:
    """The Azure voices for the configured languages.

    Asked of Azure rather than written down here: a typed list goes stale, and
    it would offer German voices to someone who set up French. The answer is
    cached for a week - this runs on every page load, and a slightly old list
    is better than a request each time.
    """
    want = [w.lower() for w in AZURE_LANGUAGES]
    try:
        age = time.time() - AZURE_VOICE_CACHE.stat().st_mtime
        if age < AZURE_CACHE_DAYS * 86400:
            known = json.loads(AZURE_VOICE_CACHE.read_text(encoding="utf-8"))
            if known.get("want") == want:
                return known["voices"]
    except (OSError, ValueError, KeyError):
        pass
    request = urllib.request.Request(
        azure_voice_list(), headers={"Ocp-Apim-Subscription-Key": get_speech_key()})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            catalogue = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        # No list is not an error: the configured voice keeps working, only
        # the choice of others is missing until Azure answers again.
        return []
    names = sorted(
        entry["ShortName"] for entry in catalogue
        if any(entry.get("Locale", "").lower() == w
               or entry.get("Locale", "").lower().startswith(w + "-")
               for w in want)
    )
    try:
        AZURE_VOICE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        AZURE_VOICE_CACHE.write_text(
            json.dumps({"want": want, "voices": names}), encoding="utf-8")
    except OSError:
        pass
    return names


def available_voices() -> list[dict]:
    """What this installation can speak with, right now.

    A voice nobody can use is worse than no choice at all: it turns into a
    silent slot at build time. So an Azure voice appears only once the key is
    there, and a piper voice only once its model lies on disk.
    """
    voices = piper_voices()
    if have_key():
        voices += [
            {
                "id": f"azure:{name}",
                "label": label_of(short_azure(name), "azure", lang_of(name)),
                "backend": "azure",
                "lang": lang_of(name),
            }
            for name in azure_voice_names()
        ]
    return voices


def voice_name(vid: str) -> str:
    """The label of one voice.

    A voice can be gone from here and still be the one a sentence was spoken
    with - another machine, a key that was withdrawn, a deleted model. The
    name is then built from the id, because nobody should have to read
    "azure:de-DE-GiselaNeural".
    """
    for voice in available_voices():
        if voice["id"] == vid:
            return voice["label"]
    kind, _, rest = vid.partition(":")
    if kind == "piper" and rest:
        return label_of(pretty_piper(rest), "piper", lang_of(rest))
    if kind == "azure" and rest:
        return label_of(short_azure(rest), "azure", lang_of(rest))
    return vid


def default_voice(lang: str = "") -> str:
    """The voice for a layout that names none.

    Deliberately without asking Azure for its catalogue. This answer goes into
    the fingerprint of the build, and a list that is there on one page load and
    gone on the next would make the interface announce a release that nobody
    caused.

    An installation that already named a voice keeps it - an update must not
    quietly change how a device in use sounds. Otherwise a local voice, it
    speaks without a key and without a network, and among several the one that
    speaks the language the device is set to. And if there is nothing at all,
    still the voice this project spoke with before it could choose, so that
    everything recorded back then stays findable in the cache.
    """
    if SEED_VOICE and have_key():
        return f"azure:{SEED_VOICE}"
    local = piper_voices()
    if local:
        wanted = lang_of(lang)
        return sorted(local, key=lambda v: v["lang"] != wanted)[0]["id"]
    return FALLBACK_VOICE


def can_speak() -> bool:
    """Whether anything new can be spoken here at all.

    Deliberately without asking Azure for its catalogue: a key and a network
    hiccup should not read as "no voice".
    """
    return bool(piper_voices()) or have_key()


# --- Fingerprint -------------------------------------------------------------

def voice_config(vid: str) -> dict:
    """Everything about a voice that changes how a sentence comes out.

    Derived from the id alone - no disk, no network. A WAV that was rendered
    once has to keep its name on a machine that could not render it, or a
    device re-downloads a cache it already has.
    """
    shared = {
        "sample_rate": SAMPLE_RATE,
        "pipeline": PIPELINE_VERSION,
        "silence_threshold": SILENCE_THRESHOLD,
        "loudnorm": LOUDNORM,
    }
    kind, _, rest = vid.partition(":")
    if kind == "piper":
        # The name of the model, never its path: the same voice sits under
        # VORLAUT_VOICES on one machine and in content/voices on another, and
        # both have to arrive at the same fingerprint.
        #
        # The piper version is here and not in shared, so that bumping it
        # renames the recordings piper made and leaves Azure's alone. Azure
        # synthesises on somebody else's machine; which piper is installed
        # here says nothing about how those came out.
        return {"backend": "piper", "model": rest,
                "piper": PIPER_VERSION, **shared}
    # Azure keeps exactly the shape it had before there was anything to
    # choose. Adding a key here would rename every WAV ever spoken.
    #
    # Which is why the region is not in here. Azure hands back the same audio
    # for the same voice whichever region synthesised it - the region is
    # routing and billing, not rendering. It used to sit in this dictionary,
    # where it cost an .env edit and a restart to move; now that the settings
    # page writes it live, one click would rename the whole cache, unseat the
    # recordings in example/speech/ and have every sentence synthesised - and
    # billed - a second time to come out byte for byte the same.
    return {
        "voice": rest,
        "locale": locale_of(rest),
        "rate": RATE,
        "azure_format": AZURE_FORMAT,
        **shared,
    }


def fingerprint(text: str, vid: str) -> str:
    payload = json.dumps(
        {"text": text.strip(), **voice_config(vid)},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def cache_path(text: str, vid: str) -> Path:
    return CACHE_DIR / f"{fingerprint(text, vid)}.wav"


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


def remember(text: str, vid: str) -> None:
    key = fingerprint(text, vid)
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

def build_ssml(text: str, voice: str) -> str:
    """The request body Azure reads: text and voice wrapped in SSML.

    Everything interpolated here comes from outside - the text from a slot,
    the voice from layout.json, the rate from .env - and only the voice is
    checked at all, for its piper:/azure: prefix. A quotation mark in any of
    them would close the attribute it stands in and produce XML Azure rejects,
    so quoteattr sets the quotes rather than the format string. It picks the
    quote character itself, which is why there are none around it below.
    """
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f"xml:lang={quoteattr(locale_of(voice))}>"
        f"<voice name={quoteattr(voice)}>"
        f"<prosody rate={quoteattr(RATE)}>{escape(text.strip())}</prosody>"
        "</voice></speak>"
    )


def azure_synthesize(text: str, voice: str) -> bytes:
    """Calls the Azure Speech REST API and returns raw WAV bytes."""
    request = urllib.request.Request(
        azure_endpoint(),
        data=build_ssml(text, voice).encode("utf-8"),
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
            raise TTSError("tts.err.rejected", region=region()) from exc
        raise TTSError("tts.err.azure", code=exc.code, detail=detail) from exc
    except urllib.error.URLError as exc:
        raise TTSError("tts.err.unreachable", reason=exc.reason) from exc


# --- piper -------------------------------------------------------------------

def piper_synthesize(text: str, model: str) -> bytes:
    """Renders on this machine - offline, free, and without an account
    anywhere. Piper writes at the sample rate of its model; what comes out of
    here is handed to ffmpeg like Azure's answer and ends up at 16 kHz mono
    either way.
    """
    path = piper_models().get(model)
    if path is None:
        raise TTSError("tts.err.no_model", model=model)
    binary = piper_binary()
    if not binary:
        raise TTSError("tts.err.no_piper")
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "piper.wav"
        result = subprocess.run(
            [binary, "-m", str(path), "-f", str(target)],
            input=text.strip().encode("utf-8"),
            capture_output=True,
        )
        if result.returncode != 0 or not target.exists():
            raise TTSError(
                "tts.err.piper",
                reason=result.stderr.decode("utf-8", "replace").strip()[:400],
            )
        return target.read_bytes()


# --- ffmpeg ------------------------------------------------------------------

def _ffmpeg_binary() -> str:
    binary = shutil.which("ffmpeg")
    if not binary:
        raise TTSError("tts.err.no_ffmpeg")
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
            raise TTSError("tts.err.ffmpeg", reason=result.stderr.strip()[:400])
        shutil.copyfile(output, target)


# --- Public interface --------------------------------------------------------

def synthesize(text: str, vid: str = "", force: bool = False) -> Path:
    """Returns the path to a finished WAV for this text in this voice.

    Renders only when no file for that fingerprint exists in the cache yet -
    and the voice is part of the fingerprint, so switching it re-records
    everything instead of leaving the old recordings lying around.
    """
    text = (text or "").strip()
    if not text:
        raise TTSError("tts.err.empty")
    vid = vid or default_voice()
    target = cache_path(text, vid)
    remember(text, vid)
    if target.exists() and not force:
        return target
    kind, _, rest = vid.partition(":")
    raw = (piper_synthesize(text, rest) if kind == "piper"
           else azure_synthesize(text, rest))
    postprocess(raw, target)
    return target


def list_voices() -> int:
    """Shows every voice this installation can speak with.

    Piper needs nothing but its model; the Azure part of the list stays empty
    until a key is there.
    """
    catalogue = available_voices()
    if not catalogue:
        print("No voice available here. Either fetch a piper voice with\n"
              "  python3 tools/voices.py\n"
              "or put an AZURE_SPEECH_KEY into .env (template: .env.example).")
        return 1
    print(f"{len(catalogue)} voices:")
    for voice in catalogue:
        print(f"  {voice['id']:36} {voice['label']}")
    print("\nThe voice is chosen on the page, or written into layout.json:\n"
          f'  "voice": "{catalogue[0]["id"]}"')
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[1] == "--voices":
        try:
            return list_voices()
        except TTSError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
    if len(argv) < 2:
        print("Usage: python3 tts.py \"the sentence\" [target.wav]\n"
              "       python3 tts.py --voices\n"
              "The voice comes from layout.json; VORLAUT_VOICE overrules it "
              "for one run.", file=sys.stderr)
        return 2
    text = argv[1]
    try:
        path = synthesize(text, os.environ.get("VORLAUT_VOICE", "").strip())
    except TTSError as exc:
        print(f"Error: {exc}", file=sys.stderr)
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
