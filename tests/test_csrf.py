#!/usr/bin/env python3
"""Checks that another site's page cannot write anything here.

The interface has no sign-in - whoever reaches the port may change the
content, and that is the deal. What was not part of the deal is that a page
somewhere else could reach the port through the browser of whoever is sitting
in front of it. The gear writes .env, .env holds the Azure key, and the check
that guards the key asks whether the request came from 127.0.0.1 - which is
precisely where that browser is. So the answer was yes, and this worked:

    curl -X POST http://127.0.0.1:8814/api/settings \\
      -H 'Content-Type: text/plain;charset=UTF-8' \\
      -H 'Origin: https://evil.example' \\
      --data '{"azureKey":"stolen"}'

text/plain is one of the three content types a page may send to another site
without asking first. application/json is not, so requiring it makes the
browser ask, and this server answers no such question.

Checked here: the exploit above is refused and .env is untouched, a foreign
Origin is refused on its own, a made-up Content-Length is refused before
anything is read, and the interface's own request still goes through. Plus
the three endpoints that do not read JSON at all - the two the device speaks
to and the upload - because a fix in the JSON path must not take those with
it.

Last, the layout lock: the version check in do_POST reads, compares and
writes, and the server answers in threads. Several tabs saving at once must
end with one winner, not several.

The server is the real one, started the way tests/test_pairing.py starts it,
against a temp .env that is nobody's own.
"""

from __future__ import annotations

import base64
import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8814
HERE = f"127.0.0.1:{PORT}"
ELSEWHERE = "https://evil.example"

# What .env holds before anybody tries anything.
ORIGINAL = "original-secret-key-value"

# 8x8 red, so the upload has something Pillow can open.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGM8oaHBgA0w"
    "YRUdtBIA4DgBKJ8lCQoAAAAASUVORK5CYII=")

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


# --- Requests ----------------------------------------------------------------
# Written on http.client rather than urllib, because two of these are only
# interesting if the headers are wrong on purpose: a Content-Length that lies
# about the body is not something urllib will send.

def post(path: str, body: bytes, headers: dict[str, str],
         announced: int | None = None) -> tuple[int, bytes]:
    """One POST, exactly as spelled here. Returns status and answer.

    Status 0 means no answer came. A server that believes an announced 50 MB
    sits there waiting for the rest of a four-byte body, and that is a failed
    check like any other rather than a test that hangs.
    """
    connection = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    try:
        connection.putrequest("POST", path, skip_accept_encoding=True)
        for name, value in headers.items():
            connection.putheader(name, value)
        connection.putheader("Content-Length",
                             str(len(body) if announced is None else announced))
        connection.endheaders()
        if body:
            connection.send(body)
        answer = connection.getresponse()
        return answer.status, answer.read()
    except (TimeoutError, OSError, http.client.HTTPException):
        return 0, b""
    finally:
        connection.close()


def as_json(path: str, payload: dict, origin: str | None = None,
            kind: str = "application/json") -> tuple[int, bytes]:
    headers = {"Content-Type": kind}
    if origin:
        headers["Origin"] = origin
    return post(path, json.dumps(payload).encode("utf-8"), headers)


def get(path: str):
    return urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=10)


def env_key(env_file: Path) -> str:
    """The Azure key as it stands in the file right now."""
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("AZURE_SPEECH_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    return ""


def serve(content: Path, env_file: Path):
    environment = dict(os.environ, VORLAUT_CONTENT=str(content))
    environment.pop("AZURE_SPEECH_KEY", None)     # no calls out of a test
    environment.pop("VORLAUT_METACOM_DIR", None)
    # Never the .env of whoever is running this: this test writes to the file
    # it is pointed at, and one of the things it writes is an Azure key.
    environment["VORLAUT_ENV_FILE"] = str(env_file)
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "app.py"), "--port", str(PORT)],
        cwd=ROOT, env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            get("/api/pair").close()
            return process
        except Exception:
            time.sleep(0.2)
    process.terminate()
    raise SystemExit("the server did not come up")


# --- The cases ---------------------------------------------------------------

def check_settings(env_file: Path) -> None:
    # --- the exploit as it was reported -------------------------------
    status, _ = post(
        "/api/settings",
        b'{"azureKey":"ATTACKER-CONTROLLED","metacom":"/tmp/pwned"}',
        {"Content-Type": "text/plain;charset=UTF-8", "Origin": ELSEWHERE})
    check("the reported exploit is refused", 400 <= status < 500, f"HTTP {status}")
    check("and .env still holds the original key", env_key(env_file) == ORIGINAL,
          env_key(env_file))

    # --- each half of it on its own -----------------------------------
    # No Origin at all, only the content type: this is what the page of
    # another site can send without being asked anything.
    status, _ = as_json("/api/settings", {"azureKey": "text-plain"},
                        kind="text/plain;charset=UTF-8")
    check("a text/plain body is refused", status == 415, f"HTTP {status}")

    for kind in ("application/x-www-form-urlencoded", "multipart/form-data",
                 ""):
        status, _ = as_json("/api/settings", {"azureKey": "form"}, kind=kind)
        check(f"a {kind or 'missing'} content type is refused",
              status == 415, f"HTTP {status}")

    # Correct content type, wrong origin. The browser sends this header by
    # itself and cannot be talked out of it.
    status, _ = as_json("/api/settings", {"azureKey": "foreign"},
                        origin=ELSEWHERE)
    check("a foreign Origin is refused", status == 403, f"HTTP {status}")

    status, _ = as_json("/api/settings", {"azureKey": "null-origin"},
                        origin="null")
    check("an opaque Origin is refused", status == 403, f"HTTP {status}")

    check("none of that reached .env", env_key(env_file) == ORIGINAL,
          env_key(env_file))

    # --- a made-up length ---------------------------------------------
    # 50 MB announced, four bytes sent. Nothing may be allocated for that,
    # and nothing may wait for the rest of it either - the timeout in post()
    # is what would catch a server that tries to read it.
    status, _ = post("/api/settings", b"{}",
                     {"Content-Type": "application/json"},
                     announced=50 * 1024 * 1024)
    check("an over-large Content-Length is refused", status == 413,
          f"HTTP {status}")

    status, _ = post("/api/settings", b"{}", {"Content-Type": "application/json",
                                              "Content-Length": "not-a-number"})
    check("a Content-Length that is not a number is refused",
          400 <= status < 500, f"HTTP {status}")

    # --- and the interface itself -------------------------------------
    # The page sends Origin along on every POST, so this is the shape that
    # has to keep working.
    status, answer = as_json("/api/settings", {"azureKey": "set-from-the-page"},
                             origin=f"http://{HERE}")
    payload = json.loads(answer) if status == 200 else {}
    check("the interface's own request goes through", status == 200,
          f"HTTP {status}")
    check("the key is written", env_key(env_file) == "set-from-the-page",
          env_key(env_file))
    check("and it is answered as local", payload.get("local") is True,
          str(payload.get("local")))

    # curl on the machine itself sends no Origin. That is not a browser and
    # not the hole, so it stays allowed.
    status, _ = as_json("/api/settings", {"azureKey": ORIGINAL})
    check("a request without an Origin still goes through", status == 200,
          f"HTTP {status}")
    check("the original key is back", env_key(env_file) == ORIGINAL,
          env_key(env_file))


def check_other_endpoints() -> None:
    """The three that do not read JSON. None of them go through _body()."""
    # The device speaks lines and sends no content type at all.
    status, body = post(
        "/api/device/pair",
        b"device aabbccddeeff\ncode 04071\nsecret "
        b"0123456789abcdef0123456789abcdef\n", {})
    # Without a device key that is 503, with one it is 200 - either way it
    # got through to the endpoint instead of being turned away at the door.
    check("the device pairing endpoint still answers",
          status in (200, 503) and b"error bad_request" not in body,
          f"HTTP {status}")

    status, body = post("/api/device/pair/poll",
                        b"device aabbccddeeff\nsecret "
                        b"0123456789abcdef0123456789abcdef\n", {})
    check("the poll endpoint still answers",
          status in (200, 404, 503) and b"error bad_request" not in body,
          f"HTTP {status}")

    # The upload sends raw image bytes, also without a content type.
    status, body = post("/api/upload?name=test-bild", PNG, {})
    named = json.loads(body).get("symbol", "") if status == 200 else ""
    check("the upload still works", status == 200 and named.endswith(".png"),
          named or f"HTTP {status}")


def check_layout_race() -> None:
    """Several tabs saving at once end with one winner.

    All of them send the same X-Layout-Version, so the first one through
    makes the rest stale. Without a lock around the read-compare-write they
    all read the version before any of them writes, all find it current, and
    several write - which is the loss the version exists to prevent.
    """
    answer = get("/api/layout")
    version = answer.headers.get("X-Layout-Version")
    layout = json.loads(answer.read())
    answer.close()

    results: list[int] = []
    guard = threading.Lock()
    ready = threading.Barrier(6)

    def save(number: int) -> None:
        wanted = json.loads(json.dumps(layout))
        # Each one writes something different, so the file's fingerprint
        # really does change under the others.
        wanted["sleep_timeout_seconds"] = 300 + number
        ready.wait(timeout=10)
        status, _ = post("/api/layout", json.dumps(wanted).encode("utf-8"),
                         {"Content-Type": "application/json",
                          "Origin": f"http://{HERE}",
                          "X-Layout-Version": version})
        with guard:
            results.append(status)

    threads = [threading.Thread(target=save, args=(number,))
               for number in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    winners = results.count(200)
    check("exactly one of six simultaneous saves wins", winners == 1,
          f"{winners} of {len(results)}: {sorted(results)}")
    check("the others are told their page is stale",
          results.count(409) == len(results) - 1, str(sorted(results)))


def main() -> int:
    with tempfile.TemporaryDirectory() as folder:
        content = Path(folder) / "content"
        content.mkdir()
        env_file = Path(folder) / "test.env"
        env_file.write_text(
            "# A temporary file, not anybody's own .env\n"
            f"AZURE_SPEECH_KEY={ORIGINAL}\n", encoding="utf-8")

        process = serve(content, env_file)
        try:
            check_settings(env_file)
            check_other_endpoints()
            check_layout_race()
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
