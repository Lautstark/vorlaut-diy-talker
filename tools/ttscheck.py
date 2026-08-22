#!/usr/bin/env python3
"""Measures the browser levelling against the one that already works.

    python3 tools/ttscheck.py                 # the whole batch, both voices
    python3 tools/ttscheck.py de              # German only
    python3 tools/ttscheck.py --keep out/     # leave the WAVs behind to listen to
    python3 tools/ttscheck.py --serve 8771    # hand the batch to a real browser
    python3 tools/ttscheck.py --browser dump/ # measure what that tab produced

The chain in @lautstark/stimmquelle is a second implementation of the ffmpeg
chain in tts.py, and a second implementation is only worth having if somebody
checks it. It is vendored under static/vendor/, shared with mitreden, and its
rules are CONTRACT.md - which tts.py now follows rather than approximates. The
sibling project found out what happens otherwise: ffmpeg.wasm looked like the
safe choice - the same filter string, the same code - and its loudnorm, three
years stale, came out 13.6 dB too quiet on half of all short sentences. The
files played. Nothing said anything.

So: one recording, both paths, and the loudness of each result measured by the
real ffmpeg, which is neither of them. What counts is the last column - how
far the browser lands from tts.py on the same sentence.

One recording, emphatically. piper is a VITS model with a stochastic duration
predictor and does not render the same sentence the same way twice - three
goes at one sentence here came out 155180, 154668 and 154156 bytes. Rendering
once per path would measure that and report it as a disagreement.

The three paths, and what each of them proves:

  python      piper on this machine, then ffmpeg     the oracle
  node        the same recording through level.js    is the arithmetic right
  browser     piper-wasm in a tab, then level.js     is the tab the same

The third one cannot run from here; it needs tools/ttscheck.html open in a
browser. --serve renders the batch, puts it where that page can fetch it and
serves the page, and the page hands its results back over PUT. Then:

    python3 tools/ttscheck.py --serve 8771        # leave this running
    open http://localhost:8771/tools/ttscheck.html
                                                  # press one of the batch buttons
    python3 tools/ttscheck.py --browser dump/     # in another shell

The same folder in both, and that is not incidental: it is where the
recordings the page was given are, and all three columns have to be about the
same recording.

Handing files back to a shell rather than measuring them in the page is the
point of the arrangement. The page cannot measure itself - the only ffmpeg it
could reach is the one that gets this wrong.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import tts  # noqa: E402

# Short and long together, and the short ones on purpose. A sentence of four
# words is where loudnorm has the least to work with, where the gating has
# almost nothing left after the pauses are dropped, and where the sibling
# project's ffmpeg.wasm went wrong. The first four are the ones in
# example/layout.json, i.e. what this project is actually used to say.
BATCH = {
    "de": [
        "Ja!",
        "Nein!",
        "Stopp",
        "Hilf mir",
        "Ich möchte noch nicht ins Bett.",
        "Können wir bitte nach draußen gehen?",
        "Das Essen schmeckt mir heute überhaupt nicht.",
        "Mir ist langweilig, ich hätte gern etwas anderes zu tun.",
        "Wo ist Mama?",
        "Mir tut der Bauch weh, und zwar schon seit heute Morgen ziemlich doll.",
        "Guten Morgen!",
        "Ich habe Durst und möchte etwas trinken, am liebsten Apfelsaft.",
    ],
    "en": [
        "Yes!",
        "No!",
        "Stop",
        "Help me",
        "I would like to go outside now.",
        "Could you please read that story to me again?",
        "I am not hungry, and I do not want to sit at the table any longer.",
        "Where is my bag?",
    ],
}

MODEL = {"de": "de_DE-thorsten-medium", "en": "en_US-kristin-medium"}

# What ffmpeg thought of a finished file. loudnorm in measurement mode prints
# what it found before it would change anything, which is the impartial answer
# to "do the two agree" - neither path gets to mark its own work.
MEASURE = f"loudnorm={tts.LOUDNORM}:print_format=json"


def measure(path: Path) -> dict:
    result = subprocess.run(
        [shutil.which("ffmpeg") or "ffmpeg", "-hide_banner", "-nostats",
         "-i", str(path), "-af", MEASURE, "-f", "null", "-"],
        capture_output=True, text=True)
    found = re.search(r"\{[^{}]*\}", result.stderr)
    if not found:
        raise SystemExit(f"ffmpeg said nothing measurable about {path.name}:\n"
                         f"{result.stderr.strip()[-600:]}")
    numbers = json.loads(found.group(0))
    return {
        "lufs": float(numbers["input_i"]),
        "peak": float(numbers["input_tp"]),
        "lra": float(numbers["input_lra"]),
    }


def node_level(raw: Path, target: Path) -> dict:
    """level.js on the same recording, run outside a browser.

    Not a stand-in for the browser: it is the same file, and the page proves
    separately that a tab runs it the same way. What this settles is whether
    the arithmetic agrees with ffmpeg, which is the part a tab cannot make
    easier to see.
    """
    node = shutil.which("node")
    if not node:
        raise SystemExit("This needs node to run the vendored chain outside a browser.")
    result = subprocess.run(
        [node, str(ROOT / "tools" / "ttscheck.mjs"), str(raw), str(target)],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"level.js failed on {raw.name}:\n{result.stderr.strip()[-600:]}")
    return json.loads(result.stdout)


def render(work: Path, browser: Path | None, languages: list[str]) -> list[dict]:
    rows = []
    for language in languages:
        model = MODEL[language]
        if model not in tts.piper_models():
            print(f"  no {model} on this machine - skipping {language}. "
                  f"Fetch it with: python3 tools/voices.py {language}")
            continue
        for index, text in enumerate(BATCH[language]):
            name = f"{language}-{index:02d}"
            raw = work / f"{name}-raw.wav"
            if not raw.exists():
                raw.write_bytes(tts.piper_synthesize(text, model))

            oracle = work / f"{name}-python.wav"
            tts.postprocess(raw.read_bytes(), oracle)

            node_out = work / f"{name}-node.wav"
            claimed = node_level(raw, node_out)

            row = {
                "id": name,
                "text": text,
                "python": measure(oracle),
                "node": measure(node_out),
                "claimed": claimed,
            }
            # The page names its files the same way, so a dump folder lines up
            # with this batch without anything having to be matched up by hand.
            if browser is not None:
                from_tab = browser / f"{name}-browser.wav"
                if from_tab.exists():
                    row["browser"] = measure(from_tab)
            rows.append(row)
            print(f"  {name}  {text[:44]}")
    return rows


def table(rows: list[dict], with_browser: bool) -> None:
    head = f"{'id':<7} {'text':<30} {'tts.py':>10} {'node':>8} {'Δ':>7}"
    if with_browser:
        head += f" {'browser':>8} {'Δ':>7}"
    head += f" {'TP node':>8} {'LRA':>5}"
    print("\n" + head)
    print("-" * len(head))
    worst = 0.0
    over = []
    for row in rows:
        shown = row["text"] if len(row["text"]) <= 30 else row["text"][:27] + "..."
        delta = row["node"]["lufs"] - row["python"]["lufs"]
        worst = max(worst, abs(delta))
        line = (f"{row['id']:<7} {shown:<30} {row['python']['lufs']:>10.2f}"
                f" {row['node']['lufs']:>8.2f} {delta:>+7.2f}")
        if with_browser:
            if "browser" in row:
                bdelta = row["browser"]["lufs"] - row["python"]["lufs"]
                line += f" {row['browser']['lufs']:>8.2f} {bdelta:>+7.2f}"
            else:
                line += f" {'-':>8} {'-':>7}"
        line += f" {row['node']['peak']:>8.2f} {row['python']['lra']:>5.2f}"
        print(line)
        # The ceiling is not a target that can be missed by a little. Above it
        # the recording clips on a device whose amplifier has no headroom.
        if row["node"]["peak"] > -1.5 + 0.05:
            over.append(row["id"])

    # Where the two part company is not random, and the last column says so.
    # ffmpeg normalises linearly until the gain would breach the ceiling and
    # compresses after that; level.js never compresses. A sentence with no
    # loudness range gives its compressor nothing to do, and the two agree to
    # the second decimal. So the honest summary is two numbers, not one.
    flat = [r for r in rows if r["python"]["lra"] == 0]
    ranged = [r for r in rows if r["python"]["lra"] > 0]
    off = lambda group: max((abs(r["node"]["lufs"] - r["python"]["lufs"])
                             for r in group), default=0.0)
    print(f"\n  worst difference from tts.py: {worst:.2f} LU over {len(rows)} sentences")
    print(f"    of the {len(flat)} with no loudness range to compress: {off(flat):.2f} LU")
    print(f"    of the {len(ranged)} with some:                        {off(ranged):.2f} LU"
          if ranged else "    none of them had any")
    if over:
        print(f"  ABOVE THE -1.5 dBTP CEILING: {', '.join(over)}")
    else:
        print("  every result at or under the -1.5 dBTP ceiling")


# --- Handing the batch to a browser ------------------------------------------

def serve(port: int, work: Path, languages: list[str]) -> int:
    """Renders the batch, then serves it and the page that levels it.

    http.server cannot take a file, and the page has to give twenty of them
    back. So: everything under the repository is served as it is, and /dump/
    is the one place that also accepts PUT.
    """
    work.mkdir(parents=True, exist_ok=True)
    listing = []
    for language in languages:
        model = MODEL[language]
        if model not in tts.piper_models():
            print(f"  no {model} here - skipping {language}")
            continue
        for index, text in enumerate(BATCH[language]):
            name = f"{language}-{index:02d}"
            raw = work / f"{name}-raw.wav"
            if not raw.exists():
                raw.write_bytes(tts.piper_synthesize(text, model))
            listing.append({"id": name, "text": text, "model": model})
    if not listing:
        print("Nothing to serve - no models.")
        return 1
    (work / "batch.json").write_text(json.dumps(listing, indent=2, ensure_ascii=False),
                                     encoding="utf-8")
    print(f"  {len(listing)} sentences in {work}")

    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            clean = path.split("?", 1)[0].split("#", 1)[0]
            if clean.startswith("/dump/"):
                # Only the name, never a path from outside: this listens on
                # localhost, but a page in another tab can still reach it.
                return str(work / Path(clean[len("/dump/"):]).name)
            return super().translate_path(path)

        def do_PUT(self):
            name = Path(self.path).name
            if not self.path.startswith("/dump/") or not name:
                self.send_error(403, "PUT only into /dump/")
                return
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            (work / name).write_bytes(body)
            self.send_response(204)
            self.end_headers()
            sys.stderr.write(f"  <- dump/{name} ({len(body)} bytes)\n")

        def end_headers(self):
            # The page is edited while it is open more often than not.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

    print(f"\n  http://localhost:{port}/tools/ttscheck.html")
    print(f"  then: python3 tools/ttscheck.py --browser {work}\n")
    ThreadingHTTPServer(("127.0.0.1", port),
                        lambda *a: Handler(*a, directory=str(ROOT))).serve_forever()
    return 0


def main(argv: list[str]) -> int:
    keep = None
    browser = None
    port = 0
    rest = []
    index = 0
    while index < len(argv):
        if argv[index] == "--keep" and index + 1 < len(argv):
            keep = Path(argv[index + 1]); index += 2
        elif argv[index] == "--browser" and index + 1 < len(argv):
            browser = Path(argv[index + 1]); index += 2
        elif argv[index] == "--serve" and index + 1 < len(argv):
            port = int(argv[index + 1]); index += 2
        else:
            rest.append(argv[index]); index += 1

    languages = [a for a in rest if a in BATCH] or list(BATCH)
    unknown = [a for a in rest if a not in BATCH]
    if unknown:
        print(f"Unknown: {', '.join(unknown)}. Available: {', '.join(BATCH)}")
        return 2

    if not tts.piper_binary():
        print("No piper here. This compares against the real chain, so it needs one.")
        return 1

    # The page fetches /dump/ by absolute path, so the folder it reads is the
    # repository's own dump/ unless somebody says otherwise. Gitignored.
    if port:
        return serve(port, keep or ROOT / "dump", languages)

    with tempfile.TemporaryDirectory() as tmp:
        # --browser names the folder --serve rendered into, so that is where
        # the work happens too. Rendering somewhere else would give the
        # Python side and the browser two different recordings of each sentence
        # - and piper does not render one sentence the same way twice, so the
        # table would show that noise in the browser column and call it a
        # difference between the two paths. Found by doing exactly that.
        work = keep or browser or Path(tmp)
        work.mkdir(parents=True, exist_ok=True)
        print(f"Rendering into {work}")
        rows = render(work, browser, languages)
        if not rows:
            return 1
        table(rows, browser is not None)
        (work / "ttscheck.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False),
                                            encoding="utf-8")
        print(f"\n  numbers in {work / 'ttscheck.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
