#!/usr/bin/env python3
"""Plays a whole pairing through, from both sides.

Pairing is how the key gets onto the device without anybody typing it: the
device shows five digits, one per display, and whoever stands in front of it
types them into the web interface. The protocol is in docs/software.md, the
device's half of the wire format in firmware/vorlaut/pair_format.h.

tests/test_pair_format.py checks that the device reads the answers correctly.
This one checks that the server writes them correctly, and that the parts a
mistake would be quiet in hold:

  * without a VORLAUT_DEVICE_TOKEN there is nothing to hand out, and the
    endpoints say so instead of pairing anybody
  * the token is handed over exactly once - a second poll finds nothing
  * a wrong secret is answered exactly like a device nobody knows, because
    the device id is the Wi-Fi MAC and anybody on the network can read it
  * a wrong code counts down and does not hand anything over
  * the answers are the line format the device parses, not JSON

The server is the real one, started the way tests/test_device_sync.py starts
it - a pairing that only works against a mock is not worth much.
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8802
TOKEN = "test-token-not-a-secret"

DEVICE = "aabbccddeeff"
SECRET = "0123456789abcdef0123456789abcdef"
CODE = "04071"          # leading zero on purpose - it must survive

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def lines(path: str, body: str) -> tuple[int, str]:
    """A device request: lines in, lines out, and no key anywhere."""
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}",
                                     data=body.encode("utf-8"), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as answer:
            return answer.status, answer.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def sent(path: str, payload: dict) -> tuple[int, dict]:
    """A browser request: JSON, like the rest of the interface."""
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as answer:
            return answer.status, json.loads(answer.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def asked(path: str) -> dict:
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}",
                                timeout=10) as answer:
        return json.loads(answer.read())


def serve(content: Path, token: str | None):
    environment = dict(os.environ, VORLAUT_CONTENT=str(content))
    environment.pop("AZURE_SPEECH_KEY", None)     # no calls out of a test
    if token:
        environment["VORLAUT_DEVICE_TOKEN"] = token
    else:
        environment.pop("VORLAUT_DEVICE_TOKEN", None)
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "app.py"), "--port", str(PORT)],
        cwd=ROOT, env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/pair", timeout=1)
            return process
        except Exception:
            time.sleep(0.2)
    process.terminate()
    raise SystemExit("the server did not come up")


def start(code: str = CODE, device: str = DEVICE, secret: str = SECRET):
    return lines("/api/device/pair",
                 f"device {device}\ncode {code}\nsecret {secret}\n")


def poll(device: str = DEVICE, secret: str = SECRET):
    return lines("/api/device/pair/poll", f"device {device}\nsecret {secret}\n")


def main() -> int:
    with tempfile.TemporaryDirectory() as folder:
        content = Path(folder) / "content"
        content.mkdir()

        # --- nothing to hand out ---------------------------------------
        process = serve(content, None)
        try:
            status, _ = start()
            check("without a key the device is not paired", status == 503,
                  f"HTTP {status}")
        finally:
            process.terminate()
            process.wait(timeout=10)

        process = serve(content, TOKEN)
        try:
            # --- the device announces its code -------------------------
            status, body = start()
            check("the pairing is accepted", status == 200 and "ok 1" in body)
            check("the answer says how long the code lives",
                  "expires " in body and "interval " in body, body.split("\n")[1])

            # --- nobody has typed it yet -------------------------------
            status, body = poll()
            check("state is waiting", body.strip() == "state waiting")

            waiting = asked("/api/pair")["waiting"]
            check("the interface is told a device is waiting",
                  [w["device"] for w in waiting] == [DEVICE])

            # --- a wrong secret must look like an unknown device -------
            status, body = poll(secret=secrets.token_hex(16))
            check("a wrong secret is answered like an unknown device",
                  status == 404, f"HTTP {status}")

            # --- a wrong code ------------------------------------------
            status, payload = sent("/api/pair/confirm", {"code": "99999"})
            check("a wrong code is refused", status == 400, f"HTTP {status}")
            check("and says how many tries are left", payload.get("left") == 4,
                  str(payload.get("left")))
            status, body = poll()
            check("a wrong code hands nothing over",
                  body.strip() == "state waiting")

            # --- the right code ----------------------------------------
            status, payload = sent("/api/pair/confirm", {"code": CODE})
            check("the right code is accepted",
                  status == 200 and payload.get("device") == DEVICE)

            status, body = poll()
            check("the device is given the key",
                  body.strip().split("\n") == ["state ready", f"token {TOKEN}"])

            # --- exactly once ------------------------------------------
            status, body = poll()
            check("the key is handed over only once", status == 404,
                  f"HTTP {status}")

            # --- rubbish -----------------------------------------------
            status, _ = lines("/api/device/pair", "device zz\ncode 1\nsecret x\n")
            check("a malformed pairing is refused", status == 400,
                  f"HTTP {status}")

            # --- a code nobody is waiting for --------------------------
            status, _ = sent("/api/pair/confirm", {"code": "12345"})
            check("a code with nothing waiting is refused",
                  status in (400, 410), f"HTTP {status}")

            # --- the leading zero ---------------------------------------
            start(code="00001", device="112233445566",
                  secret="abcdefabcdefabcdefabcdefabcdefab")
            status, payload = sent("/api/pair/confirm", {"code": "00001"})
            check("a code with leading zeros is not a number",
                  status == 200 and payload.get("device") == "112233445566")
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
