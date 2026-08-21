# Running it: from a phone, on a NAS

## Editing from a phone

By default the server listens on this machine only. For access from your own
Wi-Fi:

```bash
.venv/bin/python app.py --host 0.0.0.0
```

At start-up it prints the address to put into the phone, something like
`http://192.168.0.25:8771`. The interface reflows on narrow screens: the set
tile across the full width on top, the four speech keys as a 2x2 below it.

It prints <http://vorlaut.local:8771> as well, and that is the one worth
bookmarking: it still points at the right machine after the router has handed
out a different number. Not every phone looks a name like that up — Android is
the usual disappointment — and then the address above still works.

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

## Running it on a NAS

More sensible than a computer that is only sometimes on. A
`docker-compose.yml` is included and one command is the whole of it:

```bash
docker compose up -d
```

**Nothing is built for that.** `docker-compose.yml` names the ready-made image,
which is built for amd64 and arm64 on every change to `Dockerfile` or
`requirements.txt`:

```
ghcr.io/steffipetaffy/vorlaut:latest
```

The first start fetches it, which takes a few minutes — it is about a
gigabyte; every one after that has it already. On a NAS with ARM that is
where the several minutes of building used to go, and this is the whole
reason the published image is built for two architectures.

### Building the image yourself

Only needed for working on the image itself — `Dockerfile` or
`requirements.txt`. The project folder is mounted into the container, so
changed Python is in there without any build; a restart picks it up.

`docker-compose.build.yml` puts the `build:` back:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml build
docker compose up -d
```

`./start.sh --build` is the same thing in one step.

What is built carries the name of the published image, so the plain
`docker compose up -d` afterwards runs what was just built rather than fetching
anything. `docker compose pull` puts the published image back over it.

It is a file of its own rather than a line in `docker-compose.yml`, because
that file is the one everybody else runs: a `build:` in it means Compose builds
whenever the image is not already there, which is exactly the wait on an ARM
NAS that the published image exists to avoid. And it is deliberately **not**
called `docker-compose.override.yml` — Compose reads a file of that name
without being asked, so building would quietly be the default again for anybody
who has it lying around.

The image brings the runtime — Python, ffmpeg, Pillow — and the four piper
voices along with it, so a fresh container speaks the moment it starts, without
an Azure key and without fetching anything. The voices are most of the size.

They sit at `/voices`, outside the mounted project folder, because the mount
replaces `/app` wholesale and anything baked in underneath it would be gone the
moment the container runs. A fifth voice still belongs in `content/voices/` on
the NAS, where the backup covers it — that one needs no new image.

The project directory itself is passed in — `content/layout.json`,
`content/symbols/` and `content/cache/` therefore stay on the NAS and are
covered by its backup.

Verified: Azure speech, ffmpeg (7.1.5 in the image), ARASAAC search and
`build.py` all run inside the container.

### Being found by the device

The device is not told where the server is — it asks the network and takes the
answer, see [software.md](software.md#finding-the-server). A container makes
that harder than a plain install does: the question arrives as a broadcast,
and whether Docker carries one through a published port into a bridge network
depends on the host. On the Mac it was written on it did; on a Synology it may
not.

`docker-compose.yml` publishes the UDP port for it and passes
`VORLAUT_PUBLIC_PORT`, so the answer names the port the NAS publishes and not
the one inside the container. If the device still does not find it, there are
two ways on, and the first is usually enough:

1. **Type the address of the NAS into the setup portal.** That field is there
   for exactly this case and beats the search. Nothing else changes — the sync
   runs over the published port as before.
2. **Give the container the host's network** — `network_mode: host`, commented
   out in `docker-compose.yml`. Then it is found like anything else on the
   network. In exchange the published ports stop applying: the interface sits
   on port 8771 of the NAS itself, and `VORLAUT_PORT` does nothing.

For `vorlaut.local` it has to be the second one. Multicast is not something a
published port carries.

### Starting

```bash
./start.sh
```

Fetches the image if it is not there yet, replaces a running container, waits
until the interface really answers and prints the address. A different port
works with `./start.sh 8798`, and `./start.sh --build` builds the image here
instead of taking the published one.

At heart there is a single command behind it — the script only takes care of
the handling around it:

```bash
docker compose up -d
```

### Stopping

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

### Trying it locally first

Worth doing before wrestling with DSM — same file, same container:

```bash
docker compose up -d
docker compose logs -f          # what the container says
docker compose down             # gone again
```

If an `app.py` is already running on 8771, the container can take a different
port on the machine:

```bash
VORLAUT_PORT=8798 docker compose up -d
```

Careful: the container and `app.py` work on the **same files**. Running both at
once is possible, but only one of them should ever be operated.

Verified with `docker compose` 2.x and the older `docker-compose` 1.29 — both
accept the file.

> Pitfall: `docker compose` reads the `.env` in the project folder for its own
> variables. If anything other than `KEY=VALUE` is in there, it aborts with
> *"Can't separate key from value"*.

### On a Synology

1. Create a shared folder, `docker` is customary, with `vorlaut` inside — the
   path is then `/volume1/docker/vorlaut`.
2. Copy the project there, easiest over the network share in Finder. **The
   `.env` does not belong in the repo and has to come along by hand.**
3. Open **Container Manager** (DSM 7.2 and newer; before that the package is
   called *Docker*) -> *Project* -> *Create* -> pick the folder as the path.
   The `docker-compose.yml` is recognised and the image is fetched — the NAS
   builds nothing.
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
- **ARM models** used to build the image noticeably more slowly than the Intel
  ones. They fetch it now, and the published one covers arm64 as well — the
  slow build only comes back if you ask for one with `--build`.

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
