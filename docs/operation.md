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

More sensible than a computer that is only sometimes on. Nothing is cloned and
nothing is built — one downloaded file and one command:

```bash
mkdir -p vorlaut/data && cd vorlaut
curl -O https://raw.githubusercontent.com/SteffiPeTaffy/vorlaut/main/docker-compose.yml
docker compose up -d --wait
```

Then open `http://<NAS>:8771`.

`--wait` comes back when the interface really answers, not when the container
has started — the image carries a healthcheck, so nothing has to guess how
long the first run takes. It needs Compose 2.1 or newer; an older one does not
know the flag, and `docker compose logs -f` is the way to watch instead.

That leaves two things in the folder, and they are different in kind:

- **`docker-compose.yml`** — replaceable. Download it again whenever it
  changes; nothing of yours is in it.
- **`data/`** — everything that is yours: `layout.json`, `symbols/`, the spoken
  sentences in `cache/`, and the `.env` with the Azure key. **This is the
  folder to back up, and the only one.**

**The code is not in there.** It comes from the image and nothing is mounted
over it, so the version that was pulled is the version that runs. Updating is
therefore the whole of:

```bash
docker compose pull && docker compose up -d --wait
```

### Two things about that data/ folder

**It has to exist before the first start.** That is what the `mkdir` above is
for. What a missing one does depends on the Docker: some refuse to start the
container at all — *bind source path does not exist* — and others create the
folder as root, which the container, not being root, then cannot write into.
The second is the worse of the two, because it looks like it worked. Making
the folder yourself, first, avoids both.

**The container has to be told which id you are.** It runs as `1000:1000`,
which is right on an ordinary Linux and on Docker Desktop, and wrong on a
Synology, which numbers its people differently. Ask the NAS over SSH:

```bash
id -u; id -g
```

and if those are not 1000 and 1000, put them in an `.env` **next to the
compose file**:

```
VORLAUT_UID=1026
VORLAUT_GID=100
```

There is no elegant way around this. Which id owns the files on the NAS is a
fact about the NAS, and nothing inside the container can find it out — the
choice is between asking for these two lines and going back to running as
root, where every file the app writes belongs to root and cannot be edited
over the network share without `sudo`. Two lines is the better end of that.

Get them wrong and the first start fails on writing into `data/`, and says so
in `docker compose logs` rather than quietly later.

> That `.env` next to the compose file is **Compose's own** — `VORLAUT_PORT`,
> `VORLAUT_UID`, `VORLAUT_GID`, nothing the app ever reads. The app's `.env`,
> the one with the Azure key, is `data/.env`, and the interface writes it
> itself. Two files, two readers, and neither has to know about the other.

### A licensed METACOM collection

Optional, and set up by hand because it is licensed and lives outside all of
this. Two lines, in a `docker-compose.override.yml` next to the compose file —
Compose reads a file of that name by itself, so it survives downloading
`docker-compose.yml` again:

```yaml
services:
  vorlaut:
    environment:
      - VORLAUT_METACOM_DIR=/metacom
    volumes:
      - /volume1/Bilder/METACOM_9_Desktop:/metacom:ro
```

The path on the left is yours; `/metacom` on the right is fixed, so the same
setup works on a Mac and on a NAS. Read-only — the collection is never
changed.

Both lines or neither. The variable alone points at a folder that is not
there, and the settings sheet then reports a collection it cannot read, which
reads like a fault and is not one. With neither, the search runs on ARASAAC
alone and the gear says so.

It is deliberately not in `docker-compose.yml` with some default path. There
used to be one — `${VORLAUT_METACOM_DIR:-./example}` — and it only ever worked
because a clone had an `example/` folder to fall back on. Without the clone it
points at nothing, and pointing a bind mount at nothing is not reliably an
error: depending on the Docker it is either a refusal to start or a silently
invented empty folder. Neither is a METACOM collection, and only one of them
says so.

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

### What is in the image

The runtime — Python, ffmpeg, Pillow — the four piper voices, and the
project's own code. So a fresh container speaks the moment it starts, without
an Azure key and without fetching anything. The voices are most of the roughly
one gigabyte, and the first pull is where that time goes; every start after
that has it already. It is built for amd64 and arm64, which is why a NAS with
ARM pulls rather than builds.

The voices sit at `/voices`, outside `/app`. That matters for the developer
mount below, which replaces `/app` wholesale — anything baked in underneath it
would be gone the moment such a container ran. A fifth voice still belongs in
`data/voices/` on the NAS, where the backup covers it; that one needs no new
image.

**It does not run as root.** There is a `vorlaut` user in the image and
everything runs as it, which is what the id lines above are for. `/app` stays
root-owned and the app only reads it: an interface anybody on the Wi-Fi can
reach has no business being able to rewrite its own code.

**It runs without the compose file.** The image knows that its content goes to
`/data` because the Dockerfile says so, not because something outside remembers
to tell it — which is what makes the one-line `docker run` under *Trying it
locally first* below a working server. It was the other way round once: the two variables lived in
`docker-compose.yml` alone, and without that file the app fell back to a folder
under root-owned `/app` and stopped on *Permission denied* before it served
anything.

Verified: Azure speech, ffmpeg, ARASAAC search and `build.py` all run inside
the container.

### Building the image yourself

Only for working on the project itself. `docker-compose.build.yml` adds two
things that belong together — the `build:`, and the source mount that
puts this folder back over `/app` so a changed `app.py` needs a restart rather
than a build:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

`./start.sh --build` is the same thing in one step.

What is built carries the name of the published image, so a plain
`docker compose up -d` afterwards runs what was just built rather than fetching
anything. `docker compose pull` puts the published image back over it.

Both of those are out of `docker-compose.yml` on purpose, and the mount is the
more important of the two. With `./:/app` in the file everybody else runs, the
code that runs is never the code that was pulled — the image would be
overwritten by whatever happens to lie in the folder it was started from, and
"which version am I on" would have no answer. It would also force a git clone
for something that is otherwise one downloaded file.

The `build:` is out of there for a second reason: with it, Compose builds
whenever the image is not already there, which is exactly the wait on an ARM
NAS that the published image exists to avoid.

And the file is deliberately **not** called `docker-compose.override.yml` —
Compose reads a file of that name without being asked, so both would quietly
be the default again for anybody who has it lying around.

A third entry in that file stands apart from the pair: it repeats the port
`docker-compose.yml` already publishes. That is a repair, not an oversight.
A Compose from before it learned to tell the protocols apart deduplicates the
merged list on the published number alone — and the web interface and the
device's UDP discovery are both on 8771, so one of them was dropped. The last
one seen won, that was the UDP entry, and the two-file path came up with a
container reporting healthy and nothing answering on the host. Repeating the
TCP port makes it the survivor instead.

What that costs on such a Compose, and only at the default port, is the UDP
publish in this path: the device cannot find the server by asking, and the
address field in the setup portal is the way in — which is what that field
is for, and discovery was never allowed to matter. Start on any other port
(`./start.sh 8798`) and the two no longer collide, so both are published. On a
current Compose the repeated line changes nothing at all: 5.5.0 publishes both
with it and without it.

### start.sh and stop.sh — for the clone only

**Not the way in.** An install has the compose file and nothing else, and
`docker compose up -d --wait` is the whole of starting it. These two live in
the repository and exist for whoever is working on it, where starting and
stopping happens twenty times an afternoon.

```bash
./start.sh              # port 8771
./start.sh 8798         # another port
./start.sh --build      # build the image here instead of pulling it
./stop.sh
```

What they add over the plain command is the handling around it: `start.sh`
makes `data/` first, refuses to start if a directly launched `app.py` already
holds the port, and clears away a leftover container of the same name that
Docker would otherwise refuse. `stop.sh` says whether such an `app.py` is
still sitting there afterwards — Docker does not know about that one and will
not stop it either.

### Where is anything running

```bash
docker ps                 # running containers
pgrep -fl app.py          # directly started servers
```

`docker compose down` and `docker compose logs` only work from the folder the
compose file is in. From anywhere:

```bash
docker stop vorlaut
docker logs -f vorlaut
```

### Trying it locally first

Worth doing before wrestling with DSM. Nothing has to be downloaded or created
for a look — a named volume is made by Docker, and it inherits `/data`'s owner
from the image, so there is no folder to get the permissions wrong on:

```bash
docker run -d --name vorlaut -p 8771:8771 -p 8771:8771/udp \
  -v vorlaut-data:/data ghcr.io/steffipetaffy/vorlaut:latest
docker logs -f vorlaut          # what the container says
docker rm -f vorlaut            # gone again
docker volume rm vorlaut-data   # and its content with it
```

That is the whole of trying it, and it is deliberately not the way to keep it:
a named volume lives wherever Docker keeps its volumes, which is not a place a
NAS backup looks. For that, the same file and the same container as the NAS
gets:

```bash
mkdir -p data
docker compose up -d --wait
docker compose logs -f          # what the container says
docker compose down             # gone again
```

`--wait` again needs Compose 2.1 or newer — `docker compose version` says which
one this is. On an older one it is not ignored but refused, *unknown flag:
--wait*, and nothing starts; drop it and watch `docker compose logs -f`
instead. (`./start.sh` in the clone handles that difference itself.)

If an `app.py` is already running on 8771, the container can take a different
port on the machine:

```bash
VORLAUT_PORT=8798 docker compose up -d --wait
```

The container and a directly started `app.py` no longer share files — the
container works in `data/`, a plain `app.py` in `content/`. Running both is
fine; they simply do not see each other.

### On a Synology

1. Create a shared folder, `docker` is customary, with `vorlaut` inside — the
   path is then `/volume1/docker/vorlaut`, and a `data` folder inside that.
2. Put `docker-compose.yml` in it, easiest over the network share in Finder.
   Nothing else — no clone, no `.env`, no code.
3. If `id -u` over SSH is not 1000, add the `.env` with `VORLAUT_UID` and
   `VORLAUT_GID` from further up.
4. Open **Container Manager** (DSM 7.2 and newer; before that the package is
   called *Docker*) -> *Project* -> *Create* -> pick the folder as the path.
   The `docker-compose.yml` is recognised and the image is fetched — the NAS
   builds nothing.
5. Reach it at `http://<NAS>:8771`.

That puts the whole set of content on the NAS, covered by its backup, in
`data/`. Mount the same share on the computer to get at it from there — it is
a single folder, not a second copy.

What tends to go wrong first, from experience:

- **File permissions**, still, but now it is one wrong number rather than
  everything belonging to root: `VORLAUT_UID` and `VORLAUT_GID` have to match
  what `id` says over SSH, and `data/` has to exist before the first start.
- **Older DSM.** The old *Docker* package ships Compose 1 and wants a line
  `version: "3.8"` at the very top of `docker-compose.yml`. Container Manager
  does not need it. Compose 1 also does not know `--wait`.
- **ARM models** used to build the image noticeably more slowly than the Intel
  ones. They fetch it now, and the published one covers arm64 as well — the
  slow build only comes back if you ask for one with `--build`.

Things to bear in mind:

- **No authentication.** Anyone who reaches the port can change the content.
  Fine on a home network, but **do not forward it in the router**. For being
  out and about, a private network such as Tailscale is the better answer —
  then no authentication is needed.
- The Azure key deliberately is **not** in the image — `.dockerignore` excludes
  `.env`. At run time it comes from `data/.env`, which the interface writes
  itself.
- Flashing still happens from the computer — that needs USB.

The interface does not belong on the open internet: it needs a running Python
process, writes files and holds the Azure key. That is also why it does not run
on GitHub Pages — that is pure delivery of finished files, with no server
behind it.

Without an Azure key everything except the sound can already be used: searching
symbols, editing the layout, building images.

---
