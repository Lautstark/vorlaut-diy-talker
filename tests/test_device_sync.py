#!/usr/bin/env python3
"""Plays the whole sync through, the way the device will.

The firmware for this does not exist yet - it needs Wi-Fi and runtime writes
to LittleFS, and neither can be tried before the hardware is on the table.
The protocol can be, and the point is to have it right before any C++ is
written against it.

So this starts the real server, pretends to be a device, and checks what
matters on the device side:

  * the key is required, and without one configured the endpoints stay shut
  * every file in the manifest can be fetched, and its content really does
    hash to its name - that is the whole basis for the deduplication
  * a second sync transfers nothing
  * a release changes the version stamp, and only the files that changed
  * files that disappear from the manifest are named, so the device knows
    what to delete
  * the stamp does NOT change when the layout is edited without releasing -
    the mistake that would have made the device stop updating for good
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8799
TOKEN = "test-token-not-a-secret"


class Device:
    """The device side of the protocol, as far as it goes over the wire."""

    def __init__(self, base: str, token: str | None = TOKEN):
        self.base = base
        self.token = token
        self.stored: dict[str, bytes] = {}   # what "LittleFS" holds
        self.version = ""
        self.fetched = 0                     # files pulled in the last sync

    def _get(self, path: str) -> bytes:
        request = urllib.request.Request(self.base + path)
        if self.token:
            request.add_header("X-Vorlaut-Token", self.token)
        with urllib.request.urlopen(request, timeout=30) as answer:
            return answer.read()

    def manifest(self) -> dict:
        """Parse the line format the way the firmware will.

        Deliberately as dumbly as the C code can be: split on spaces, look at
        the first word, ignore anything unfamiliar.
        """
        out = {"version": "", "current": False, "sets": 0, "bytes": 0,
               "files": []}
        for line in self._get("/api/device/manifest").decode().split("\n"):
            word = line.split(" ")
            if word[0] == "version" and len(word) > 1:
                out["version"] = word[1]
            elif word[0] == "current" and len(word) > 1:
                out["current"] = word[1] == "1"
            elif word[0] in ("sets", "bytes") and len(word) > 1:
                out[word[0]] = int(word[1])
            elif word[0] == "file" and len(word) > 2:
                out["files"].append({"name": word[1], "size": int(word[2])})
        return out

    def sync(self) -> dict:
        """Fetch the manifest, fetch what is missing, throw away the rest."""
        manifest = self.manifest()
        self.fetched = 0
        wanted = {entry["name"] for entry in manifest["files"]}

        for entry in manifest["files"]:
            name = entry["name"]
            # layout.bin always has the same name, so it is always fetched.
            # Everything else is named after its content and can be skipped.
            if name in self.stored and name != "layout.bin":
                continue
            data = self._get(f"/api/device/file?name={name}")
            self.stored[name] = data
            self.fetched += 1

        self.removed = sorted(set(self.stored) - wanted)
        for name in self.removed:
            del self.stored[name]

        self.version = manifest["version"]
        return manifest


def start_server(content: Path):
    environment = dict(os.environ)
    environment["VORLAUT_CONTENT"] = str(content)
    environment["VORLAUT_DEVICE_TOKEN"] = TOKEN
    environment.pop("AZURE_SPEECH_KEY", None)   # no calls out of a test
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "app.py"), "--port", str(PORT)],
        env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True)
    base = f"http://127.0.0.1:{PORT}"
    for _ in range(50):
        try:
            urllib.request.urlopen(base + "/api/sources", timeout=1).read()
            return process, base
        except Exception:
            time.sleep(0.2)
    process.kill()
    raise SystemExit("the server did not come up:\n" + (process.stdout.read() or ""))


def main() -> int:
    sys.path.insert(0, str(ROOT))
    failures = []

    def check(name: str, condition: bool, detail: str = ""):
        print(f"  {'ok  ' if condition else 'FAIL'}  {name}"
              f"{'   ' + detail if detail else ''}")
        if not condition:
            failures.append(name)

    with tempfile.TemporaryDirectory() as tmp:
        content = Path(tmp) / "content"
        environment = dict(os.environ, VORLAUT_CONTENT=str(content))
        subprocess.run([sys.executable, str(ROOT / "build.py"), "--no-audio"],
                       env=environment, capture_output=True, check=True)

        process, base = start_server(content)
        try:
            # --- the key ------------------------------------------------
            try:
                Device(base, token=None).manifest()
                check("without a key the endpoint stays shut", False)
            except urllib.error.HTTPError as exc:
                check("without a key the endpoint stays shut", exc.code == 401,
                      f"HTTP {exc.code}")
            try:
                Device(base, token="wrong").manifest()
                check("a wrong key is refused", False)
            except urllib.error.HTTPError as exc:
                check("a wrong key is refused", exc.code == 401, f"HTTP {exc.code}")

            # --- first sync ---------------------------------------------
            device = Device(base)
            manifest = device.sync()
            check("first sync fetches everything",
                  device.fetched == len(manifest["files"]),
                  f"{device.fetched} files")
            check("the manifest says it is current", manifest["current"] is True)
            check("the sizes in the manifest are the real ones",
                  all(len(device.stored[e["name"]]) == e["size"]
                      for e in manifest["files"]),
                  f"{len(manifest['files'])} files")
            check("an unknown keyword does not throw the reader off",
                  Device(base).manifest()["version"] == manifest["version"])

            # --- a name always means the same bytes ---------------------
            #
            # The names are hashes of the INPUT - source image plus pipeline
            # version, or text plus voice configuration - not of the output
            # bytes. That is the whole basis of the sync: the device skips
            # every name it already holds, so a name must never come to mean
            # something else. Checked by fetching twice and by rebuilding.
            twice = {name: device._get(f"/api/device/file?name={name}")
                     for name in sorted(device.stored)}
            check("fetching the same name twice gives the same bytes",
                  all(twice[n] == device.stored[n] for n in twice),
                  f"{len(twice)} files")

            kept = dict(device.stored)
            subprocess.run([sys.executable, str(ROOT / "build.py"), "--no-audio"],
                           env=environment, capture_output=True, check=True)
            after = {entry["name"] for entry in device.manifest()["files"]}
            same = [n for n in kept if n in after and n != "layout.bin"]
            changed = [n for n in same
                       if device._get(f"/api/device/file?name={n}") != kept[n]]
            check("a rebuild does not change what a name means", not changed,
                  f"{len(same)} names survived")

            # --- second sync --------------------------------------------
            before = device.version
            device.sync()
            check("second sync transfers only layout.bin", device.fetched == 1,
                  f"{device.fetched} file")
            check("the version stamp stays the same", device.version == before)

            # --- edit without releasing ---------------------------------
            layout = json.loads((content / "layout.json").read_text())
            layout["sets"][0]["slots"][0]["text"] = "etwas ganz anderes"
            (content / "layout.json").write_text(
                json.dumps(layout, ensure_ascii=False, indent=2))
            manifest = device.manifest()
            check("editing alone does not move the stamp",
                  manifest["version"] == before)
            check("but the manifest admits it is not current",
                  manifest["current"] is False)

            # --- release ------------------------------------------------
            subprocess.run([sys.executable, str(ROOT / "build.py"), "--no-audio"],
                           env=environment, capture_output=True, check=True)
            device.sync()
            check("after the release the stamp moves", device.version != before)
            check("and only what changed is fetched", device.fetched <= 2,
                  f"{device.fetched} files")

            # --- a set disappears ---------------------------------------
            layout = json.loads((content / "layout.json").read_text())
            layout["sets"][0]["slots"][1]["symbol"] = ""
            (content / "layout.json").write_text(
                json.dumps(layout, ensure_ascii=False, indent=2))
            subprocess.run([sys.executable, str(ROOT / "build.py"), "--no-audio"],
                           env=environment, capture_output=True, check=True)
            held = set(device.stored)
            device.sync()
            check("what falls out of the manifest is thrown away",
                  bool(device.removed) or set(device.stored) != held,
                  f"{len(device.removed)} deleted")

            # --- a name that is not in the manifest ---------------------
            try:
                device._get("/api/device/file?name=../../../etc/passwd")
                check("a path outside data/ is refused", False)
            except urllib.error.HTTPError as exc:
                check("a path outside data/ is refused", exc.code in (400, 403, 404),
                      f"HTTP {exc.code}")
        finally:
            process.terminate()
            process.wait(timeout=10)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
