# Running it: from a phone, on a NAS

### Editing from a phone

By default the server listens on this machine only. For access from your own
Wi-Fi:

```bash
.venv/bin/python app.py --host 0.0.0.0
```

At start-up it prints the address to put into the phone, something like
`http://192.168.0.25:8771`. The interface reflows on narrow screens: the set
tile across the full width on top, the four speech keys as a 2x2 below it.

**Putting it on the home screen.** The page ships a web manifest, so it can be
placed like an app: in Safari *Share → Add to Home Screen*, in Chrome through
the menu. After that it starts full screen without an address bar.

Deliberately **without a service worker**, so without an offline cache. Without
the server the interface can do nothing anyway — neither save nor preview nor
build. A cache would only serve up stale versions and be more of a fault source
than a benefit.

**This has no authentication.** Anyone on the same Wi-Fi can change the content
and spend Azure quota through the preview button. Fine at home, not in a
foreign or public network.

### Running it on a NAS

More sensible than a computer that is only sometimes on. A `Dockerfile` and a
`docker-compose.yml` are included:

```bash
docker compose up -d
```

Whoever does not want to build it themselves pulls the ready-made image — it is
built for amd64 and arm64 on every change to `Dockerfile` or
`requirements.txt`:

```
ghcr.io/steffipetaffy/vorlaut:latest
```

For that, replace `build: .` in `docker-compose.yml` with
`image: ghcr.io/steffipetaffy/vorlaut:latest`. On a NAS with ARM that saves
several minutes of build time.

The image brings only Python, ffmpeg and Pillow. The project directory itself
is passed in — `content/layout.json`, `content/symbols/` and `content/cache/`
therefore stay on the NAS and are covered by its backup.

Verified: Azure speech, ffmpeg (7.1.5 in the image), ARASAAC search and
`build.py` all run inside the container.

#### Starting

```bash
./start.sh
```

Rebuilds if needed, replaces a running container, waits until the interface
really answers and prints the address. A different port works with
`./start.sh 8798`.

At heart there is a single command behind it — the script only takes care of
the handling around it:

```bash
docker compose up -d --build
```

#### Stopping

```bash
./stop.sh
```

Stops the container and says whether a directly started `app.py` is still
sitting on the port next to it — Docker does not know about that one and will
not stop it either.

Where is anything running at all?

```bash
docker ps                 # running containers
pgrep -fl app.py          # directly started servers
```

`docker compose down` and `docker compose logs` only work from inside the
project folder. From anywhere:

```bash
docker stop vorlaut
docker logs -f vorlaut
```

#### Trying it locally first

Worth doing before wrestling with DSM — same file, same container:

```bash
docker compose up -d --build
docker compose logs -f          # what the container says
docker compose down             # gone again
```

If an `app.py` is already running on 8771, the container can take a different
port on the machine:

```bash
VORLAUT_PORT=8798 docker compose up -d --build
```

Careful: the container and `app.py` work on the **same files**. Running both at
once is possible, but only one of them should ever be operated.

Verified with `docker compose` 2.x and the older `docker-compose` 1.29 — both
accept the file.

> Pitfall: `docker compose` reads the `.env` in the project folder for its own
> variables. If anything other than `KEY=VALUE` is in there, it aborts with
> *"Can't separate key from value"*.

#### On a Synology

1. Create a shared folder, `docker` is customary, with `vorlaut` inside — the
   path is then `/volume1/docker/vorlaut`.
2. Copy the project there, easiest over the network share in Finder. **The
   `.env` does not belong in the repo and has to come along by hand.**
3. Open **Container Manager** (DSM 7.2 and newer; before that the package is
   called *Docker*) -> *Project* -> *Create* -> pick the folder as the path.
   The `docker-compose.yml` is recognised, the image is built there.
4. Reach it at `http://<NAS>:8771`.

That puts the whole set of content on the NAS, covered by its backup. Mount the
same share on the computer and carry on there with git — it is a single folder,
not a second copy.

What tends to go wrong first, from experience:

- **File permissions.** The container runs as root, everything it creates
  belongs to root afterwards, and over the network share you cannot get at it
  any more. There is a commented-out `user:` line in `docker-compose.yml` for
  that; `id` over SSH gives you your own.
- **Older DSM.** The old *Docker* package ships Compose 1 and wants a line
  `version: "3.8"` at the very top of `docker-compose.yml`. Container Manager
  does not need it.
- **ARM models** build the image noticeably more slowly than the Intel ones.
  Once, then it runs.

Things to bear in mind:

- **No authentication.** Anyone who reaches the port can change the content.
  Fine on a home network, but **do not forward it in the router**. For being
  out and about, a private network such as Tailscale is the better answer —
  then no authentication is needed.
- The Azure key deliberately is **not** in the image — `.dockerignore` excludes
  `.env`. At run time it comes from the mounted folder.
- Flashing still happens from the computer — that needs USB.

The interface does not belong on the open internet: it needs a running Python
process, writes files and holds the Azure key. That is also why it does not run
on GitHub Pages — that is pure delivery of finished files, with no server
behind it.

Without an Azure key everything except the sound can already be used: searching
symbols, editing the layout, building images.

---
