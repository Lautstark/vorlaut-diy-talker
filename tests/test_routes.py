#!/usr/bin/env python3
"""The route table, and the routes driven without a socket.

do_GET and do_POST used to be 205 and 154 lines of "if path == ..." against a
median function of twelve. Nothing enumerated the API, adding a route meant
editing a method, and no handler could be reached at all except through a
live connection, because every one of them was a method on the request
handler reading self.rfile.

They are a table now, so this file can do two things nothing could do before.

First, enumerate. EXPECTED below is the whole API, written out; a route that
silently stopped being registered fails here rather than in whatever part of
the interface happened to use it. The other tests all drive the server over a
real socket, which is the right way to test the wire - but only for the
handful of paths they touch, and a path nobody covers would have gone quiet
unnoticed.

Second, call a handler directly. Anything the routes need from the request
handler goes through about a dozen small methods, so a stand-in that records
what was sent is enough to run one - no port, no threads, no waiting for a
server to come up. What that buys is visible in check_pairing() below, which
plays a whole pairing through in-process in a few microseconds; the socket
version of the same thing is tests/test_pairing.py and takes seconds.

Which of the two is right depends on what is being checked. The wire format,
the content-type refusals and the layout lock all need a real server and stay
where they are. What is checked here is the part underneath: that the table
says what it should, and that each handler does the right thing when it is
handed a request.
"""

from __future__ import annotations

import io
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Before app is imported: config resolves the content root and .env once, at
# import time. Never the .env of whoever is running this - check_settings()
# reads an Azure key back out of it.
WORKSPACE = tempfile.mkdtemp(prefix="vorlaut-routes-")
os.environ["VORLAUT_CONTENT"] = str(Path(WORKSPACE) / "content")
os.environ["VORLAUT_ENV_FILE"] = str(Path(WORKSPACE) / "test.env")
os.environ["VORLAUT_DEVICE_TOKEN"] = "test-token-not-a-secret"
os.environ.pop("AZURE_SPEECH_KEY", None)        # no calls out of a test
os.environ.pop("VORLAUT_METACOM_DIR", None)

sys.path.insert(0, str(ROOT))
import app                                      # noqa: E402

TOKEN = os.environ["VORLAUT_DEVICE_TOKEN"]
DEVICE = "aabbccddeeff"
SECRET = "0123456789abcdef0123456789abcdef"
CODE = "04071"          # leading zero on purpose - it must survive

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


# --- The table ---------------------------------------------------------------
# Written out rather than derived from app.ROUTES, which would only check that
# the table equals itself. Adding a route means adding a line here, and that
# is the point: this list is what the interface may ask for.

EXPECTED = {
    # The page and what a browser fetches alongside it
    ("GET", "/"),
    ("GET", "/index.html"),
    ("GET", "/icon.svg"),
    ("GET", "/icon-192.png"),
    ("GET", "/icon-512.png"),
    ("GET", "/manifest.webmanifest"),
    ("GET", "/symbols/"),               # by prefix - the rest is the reference
    ("GET", "/static/"),                # likewise - the stylesheet and the modules
    # The layout, and what goes into it
    ("GET", "/api/layout"),
    ("POST", "/api/layout"),
    ("GET", "/api/search"),
    ("GET", "/api/sources"),
    ("POST", "/api/pick"),
    ("POST", "/api/upload"),
    ("GET", "/api/preview"),
    ("GET", "/api/thumb"),
    # Speech
    ("GET", "/api/voices"),
    ("GET", "/api/voices/fetch"),
    ("POST", "/api/voices/fetch"),
    ("POST", "/api/speak"),
    ("POST", "/api/build"),
    # Settings
    ("GET", "/api/settings"),
    ("POST", "/api/settings"),
    # Pairing, and the device's own half of it
    ("GET", "/api/pair"),
    ("POST", "/api/pair/confirm"),
    ("POST", "/api/device/pair"),
    ("POST", "/api/device/pair/poll"),
    ("GET", "/api/device/manifest"),
    ("GET", "/api/device/file"),
}

# The three that read their own body. _body() is where the content-type and
# Origin checks live, so this set is a security boundary and not a detail of
# how the table is built: one of these routed through _body() would stop
# working, and - the direction that matters - a JSON route added to this set
# would quietly lose the checks that keep another site from writing .env.
# tests/test_csrf.py checks the same boundary from the outside, over a socket.
EXPECTED_RAW = {
    ("POST", "/api/upload"),            # raw image bytes
    ("POST", "/api/device/pair"),       # the device's line format
    ("POST", "/api/device/pair/poll"),
}

EXPECTED_PREFIX = {("GET", "/symbols/"), ("GET", "/static/")}


def check_table() -> None:
    registered = set(app.ROUTES)
    missing = EXPECTED - registered
    extra = registered - EXPECTED
    check("every route this interface uses is registered", not missing,
          ", ".join(f"{m} {p}" for m, p in sorted(missing)))
    check("and nothing is registered that is not written down here", not extra,
          ", ".join(f"{m} {p}" for m, p in sorted(extra)))

    raw = {key for key, entry in app.ROUTES.items() if entry.raw}
    check("exactly three routes read their own body", raw == EXPECTED_RAW,
          ", ".join(f"{m} {p}" for m, p in sorted(raw)))

    prefix = {key for key, entry in app.ROUTES.items() if entry.prefix}
    check("and exactly two are matched by prefix", prefix == EXPECTED_PREFIX,
          ", ".join(f"{m} {p}" for m, p in sorted(prefix)))


def check_lookup() -> None:
    found = app.find_route("GET", "/api/layout")
    check("an exact path finds its route",
          found is not None and found.handler is app.get_layout)

    # The same path under the other method is a different route, and one of
    # them not existing must not fall through to the other.
    check("a path registered for GET is not reachable by POST",
          app.find_route("POST", "/api/search") is None)
    check("and one registered for POST is not reachable by GET",
          app.find_route("GET", "/api/speak") is None)

    check("an unknown path finds nothing",
          app.find_route("GET", "/api/nonsense") is None)

    # /api/device/pair and /api/device/pair/poll are both exact. If either
    # were ever made a prefix the poll would answer as the pair.
    poll = app.find_route("POST", "/api/device/pair/poll")
    check("the device poll is its own route, not the pairing one",
          poll is not None and poll.handler is app.device_pair_poll)

    for path in ("/symbols/bild.png", "/symbols/metacom:hallo",
                 "/symbols/with%20a%20space.png"):
        found = app.find_route("GET", path)
        check(f"{path} is matched by prefix",
              found is not None and found.handler is app.symbol_file)

    check("a path that only looks like the prefix is not matched",
          app.find_route("GET", "/symbols") is None)


# --- A stand-in for the request handler --------------------------------------

class Recorder:
    """Everything a route needs from the handler, with nothing underneath.

    The real Handler answers by writing to a socket. This one writes to
    itself, which is what makes a route callable from a test at all. The
    method names carry their leading underscore because that is what the
    routes call - renaming them here would only mean this is not the thing
    they talk to.
    """

    def __init__(self, *, local: bool = True, device_ok: bool = True,
                 body: bytes = b"", headers: dict | None = None,
                 route_path: str = "/"):
        self.route_path = route_path
        self.headers = dict(headers or {})
        self.rfile = io.BytesIO(body)
        self.client_address = ("127.0.0.1", 51000)
        self._local = local
        self._device_ok = device_ok
        # What the route did. code is None until it answers, which is how the
        # device gate is checked: it must answer and the route must not.
        self.code: int | None = None
        self.payload = None         # the JSON, for _json
        self.raw: bytes = b""       # the bytes, for _send
        self.content_type = ""
        self.extra: dict = {}
        self.error_key = ""         # the key, for _error - not the sentence
        self.lines: list[str] = []  # for _pair_answer

    # -- what the routes call --

    def _send(self, code, body, content_type, extra=None):
        self.code, self.raw = code, body
        self.content_type, self.extra = content_type, dict(extra or {})

    def _json(self, payload, code=200, extra=None):
        self.code, self.payload = code, payload
        self.content_type = "application/json; charset=utf-8"
        self.extra = dict(extra or {})

    def _error(self, key, code=400, **params):
        self.code, self.error_key = code, key
        self.payload = {"error": key, **params}

    def _failed(self, exc, code=400):
        self.code = code
        self.payload = {"error": str(exc)}

    def _pair_answer(self, lines, code=200):
        self.code, self.lines = code, list(lines)

    def _lines_body(self):
        return app.parse_lines(self.rfile.read().decode("utf-8", "replace"))

    def _language(self):
        return "en"

    def _may_set_secrets(self):
        return self._local

    def _device_allowed(self):
        if not self._device_ok:
            self._error("err.bad_token", 401)
            return False
        return True


# --- The routes themselves ---------------------------------------------------

def check_settings() -> None:
    """The read hands out less than it used to.

    The write was gated on _may_set_secrets() and the read was not, so the
    last four characters of the Azure key went to anybody who reached the
    port. They now go only to a client that could set the key anyway.
    """
    app.config.write({"AZURE_SPEECH_KEY": "0123456789abcdef",
                      "AZURE_SPEECH_REGION": "germanywestcentral"})

    here = Recorder(local=True)
    app.get_settings(here, {})
    check("a local read is answered", here.code == 200, f"HTTP {here.code}")
    check("and gets the hint", here.payload["azureKey"]["hint"] == "cdef",
          repr(here.payload["azureKey"]["hint"]))

    phone = Recorder(local=False)
    app.get_settings(phone, {})
    check("a read from the network is answered too", phone.code == 200,
          f"HTTP {phone.code}")
    check("but gets no hint", phone.payload["azureKey"]["hint"] == "",
          repr(phone.payload["azureKey"]["hint"]))
    # The rest of it still has to arrive, or the gear renders empty on a phone.
    check("it is still told that a key is set",
          phone.payload["azureKey"]["set"] is True)
    check("and told it may not set one", phone.payload["local"] is False)
    check("the region still arrives",
          phone.payload["azureRegion"] == "germanywestcentral",
          phone.payload["azureRegion"])
    check("and the METACOM entry is whole",
          set(phone.payload["metacom"])
          == {"path", "ok", "count", "keywords", "fixed"},
          str(sorted(phone.payload["metacom"])))

    # The write answers with the same state, so it needs the same treatment.
    phone = Recorder(local=False)
    app.post_settings(phone, {"azureRegion": "westeurope"})
    check("a write from the network is allowed the region",
          phone.code == 200, f"HTTP {phone.code}")
    check("and its answer carries no hint either",
          phone.payload["azureKey"]["hint"] == "",
          repr(phone.payload["azureKey"]["hint"]))

    phone = Recorder(local=False)
    app.post_settings(phone, {"azureKey": "stolen"})
    check("but not the key", phone.code == 403, f"HTTP {phone.code}")
    check("and nothing was written",
          app.config.value("AZURE_SPEECH_KEY") == "0123456789abcdef")

    # --- a setting the environment hands in is not ours to write -----------
    # The container case, and it used to break the container. The field shows
    # VORLAUT_METACOM_DIR, which docker-compose.yml sets to /metacom - the
    # path *inside* the container - and reads back for the host side of the
    # mount. Saving the sheet untouched wrote that into .env, which then said
    # "bind source path does not exist: /metacom" at the next start. Nothing
    # on screen changed at the time, because the environment still won the
    # read.
    env_file = app.config.ENV_FILE
    before = env_file.read_text(encoding="utf-8")
    os.environ["VORLAUT_METACOM_DIR"] = "/metacom"
    try:
        recorder = Recorder(local=True)
        app.post_settings(recorder, {"metacom": "/metacom"})
        check("saving a handed-in path is answered normally",
              recorder.code == 200, f"HTTP {recorder.code}")
        check("but leaves .env exactly as it was",
              env_file.read_text(encoding="utf-8") == before)
        check("and the sheet says where the path comes from",
              recorder.payload["metacom"]["fixed"] is True)
    finally:
        os.environ.pop("VORLAUT_METACOM_DIR", None)

    # Without one handed in it is an ordinary setting again.
    recorder = Recorder(local=True)
    app.post_settings(recorder, {"metacom": "/somewhere/METACOM_9_Desktop"})
    check("a path of one's own is still written",
          app.config.value("VORLAUT_METACOM_DIR")
          == "/somewhere/METACOM_9_Desktop",
          app.config.value("VORLAUT_METACOM_DIR"))
    check("and that one is not called fixed",
          recorder.payload["metacom"]["fixed"] is False)
    app.post_settings(Recorder(local=True), {"metacom": ""})


def check_device_gate() -> None:
    """_device_allowed() answers by itself, and the route stops there.

    The gate returning False is not enough on its own - what matters is that
    nothing follows it. A route that carried on would answer twice, and the
    second answer would be the file.
    """
    for name, handler, data in (
        ("the manifest", app.device_manifest, {}),
        ("a file", app.device_file, {"name": ["layout.bin"]}),
    ):
        refused = Recorder(device_ok=False)
        handler(refused, data)
        check(f"{name} is refused without the key", refused.code == 401,
              f"HTTP {refused.code}")
        check(f"and {name} sent nothing else", refused.raw == b"",
              f"{len(refused.raw)} bytes")

    # Past the gate, a file that is not there is still a 404 and not a stack
    # trace - the name comes from outside.
    missing = Recorder()
    app.device_file(missing, {"name": ["../../etc/passwd"]})
    check("a name with a path in it does not escape data/",
          missing.code == 404, f"HTTP {missing.code}")


def check_upload() -> None:
    """The upload reads its own body, so it can be handed one."""
    empty = Recorder(headers={"Content-Length": "0"})
    app.upload(empty, {})
    check("an empty upload is refused", empty.error_key == "err.no_image_data",
          empty.error_key)

    huge = Recorder(headers={"Content-Length": str(app.MAX_UPLOAD + 1)})
    app.upload(huge, {})
    check("an over-large upload is refused before it is read",
          huge.error_key == "err.image_too_big", huge.error_key)
    check("and nothing was read from the body", huge.rfile.tell() == 0,
          f"{huge.rfile.tell()} bytes")


def check_pairing() -> None:
    """A whole pairing, in-process.

    Same protocol as tests/test_pairing.py plays over a socket. That one is
    the wire and stays; this one is what the routes do with it, and it runs
    without a port because the routes are functions now.
    """
    body = f"device {DEVICE}\ncode {CODE}\nsecret {SECRET}\n".encode("utf-8")
    starting = Recorder(body=body)
    app.device_pair(starting, {})
    check("the device announces its code", starting.code == 200,
          f"HTTP {starting.code}")
    check("and is told how long it is good for",
          f"expires {app.PAIR_LIFETIME}" in starting.lines,
          str(starting.lines))

    poll_body = f"device {DEVICE}\nsecret {SECRET}\n".encode("utf-8")
    waiting = Recorder(body=poll_body)
    app.device_pair_poll(waiting, {})
    check("nobody has typed it yet", waiting.lines == ["state waiting"],
          str(waiting.lines))

    # The interface sees it waiting, which is what the five boxes hang on.
    listing = Recorder()
    app.get_pair(listing, {})
    check("the interface is offered the device",
          [w["device"] for w in listing.payload["waiting"]] == [DEVICE],
          str(listing.payload["waiting"]))

    wrong = Recorder()
    app.post_pair_confirm(wrong, {"code": "00000"})
    check("a wrong code is refused", wrong.code == 400, f"HTTP {wrong.code}")
    check("and counts down", wrong.payload.get("left") == app.PAIR_ATTEMPTS - 1,
          str(wrong.payload.get("left")))

    typed = Recorder()
    app.post_pair_confirm(typed, {"code": CODE})
    check("the right code is taken", typed.code == 200, f"HTTP {typed.code}")
    check("and names the device", typed.payload.get("device") == DEVICE,
          str(typed.payload.get("device")))

    ready = Recorder(body=poll_body)
    app.device_pair_poll(ready, {})
    check("the device is handed the key",
          ready.lines == ["state ready", f"token {TOKEN}"], str(ready.lines))

    # Once, and only once. A second poll finds the pairing gone.
    again = Recorder(body=poll_body)
    app.device_pair_poll(again, {})
    check("and only once", again.code == 404, f"HTTP {again.code}")


def check_plain_routes() -> None:
    """The ones with nothing behind them but an answer."""
    nothing = Recorder()
    app.search(nothing, {})
    check("a search for nothing is an empty list", nothing.payload == [],
          str(nothing.payload))

    listing = Recorder()
    app.sources(listing, {})
    check("the sources are reported",
          set(listing.payload) == {"metacom", "metacomKeywords", "metacomCount"},
          str(sorted(listing.payload)))

    icon = Recorder(route_path="/icon.svg")
    app.icon(icon, {})
    check("the icon is served as SVG", icon.content_type == "image/svg+xml",
          icon.content_type)
    check("and is the file on disk",
          icon.raw == (app.ASSETS / "icon.svg").read_bytes())

    png = Recorder(route_path="/icon-192.png")
    app.icon(png, {})
    check("the same function serves the PNGs", png.content_type == "image/png",
          png.content_type)

    web = Recorder()
    app.webmanifest(web, {})
    check("the web manifest names its icons",
          [i["src"] for i in web.payload["icons"]]
          == ["/icon-192.png", "/icon-512.png", "/icon-512.png"],
          str([i["src"] for i in web.payload["icons"]]))

    gone = Recorder(route_path="/symbols/not-a-real-symbol.png")
    app.symbol_file(gone, {})
    check("a symbol that is not there is a 404", gone.code == 404,
          f"HTTP {gone.code}")


def check_static() -> None:
    """The stylesheet and the modules, and the ways out of static/.

    One prefix route serves a whole directory, so what it refuses matters as
    much as what it serves. resolve() follows ".." and symlinks alike, and the
    question asked afterwards is whether the answer is still inside static/ -
    not whether the name looked suspicious on the way in.
    """
    css = Recorder(route_path="/static/ui.css")
    app.static_file(css, {})
    check("the stylesheet is served as CSS",
          css.content_type == "text/css; charset=utf-8", css.content_type)
    check("and is the file on disk",
          css.raw == (app.STATIC / "ui.css").read_bytes())

    module = Recorder(route_path="/static/main.js")
    app.static_file(module, {})
    check("a module is served as JavaScript",
          module.content_type == "text/javascript; charset=utf-8",
          module.content_type)

    # Every module, not just main.js: one that 404s is a page that loads and
    # then does nothing, which no other check here would notice.
    served = []
    for module in sorted(app.STATIC.glob("*.js")):
        out = Recorder(route_path=f"/static/{module.name}")
        app.static_file(out, {})
        served.append((module.name, out.code, out.content_type))
    check(f"all {len(served)} modules are served as JavaScript",
          served and all(code == 200 and kind == "text/javascript; charset=utf-8"
                         for _, code, kind in served),
          ", ".join(f"{n} HTTP {c}" for n, c, k in served
                    if c != 200 or k != "text/javascript; charset=utf-8"))

    for path in ("/static/../app.py",
                 "/static/..%2fapp.py",
                 "/static/../../etc/passwd",
                 "/static/nope.js",
                 "/static/"):
        out = Recorder(route_path=path)
        app.static_file(out, {})
        check(f"{path} is refused", out.code == 404, f"HTTP {out.code}")

    # Not a whitelisted suffix. An editor backup next to a module must not be
    # handed out just because it is in the folder.
    stray = app.STATIC / "scratch.txt"
    stray.write_text("not for serving", encoding="utf-8")
    try:
        out = Recorder(route_path="/static/scratch.txt")
        app.static_file(out, {})
        check("a file with an unknown suffix is refused", out.code == 404,
              f"HTTP {out.code}")
    finally:
        stray.unlink()


def main() -> int:
    try:
        check_table()
        check_lookup()
        check_settings()
        check_device_gate()
        check_upload()
        check_pairing()
        check_plain_routes()
        check_static()
    finally:
        # Not a TemporaryDirectory: it has to outlive the import above, which
        # is where config reads the paths out of the environment.
        shutil.rmtree(WORKSPACE, ignore_errors=True)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print(f"\n  {len(app.ROUTES)} routes, all of them written down.")
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
