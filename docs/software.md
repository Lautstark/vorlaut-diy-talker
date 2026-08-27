# How the software works

The file formats and the reasoning behind them: how content reaches the device,
how the build and the speech output work, and what the repository does and does
not hold.

The cable that carries the content has a document of its own,
[cable.md](cable.md), and so does putting the firmware on a board,
[firmware.md](firmware.md).

## How content reaches the device

Down the USB-C cable, pushed by the page. The protocol, the diff, the order the
files go in and why `layout.bin` is last are all in [cable.md](cable.md); this
section exists so that nobody looks for them here.

There used to be a great deal here instead. The device found the computer with
a UDP broadcast on port 8771, proved it was the one in the room by showing five
digits on its displays, was given a token it kept in NVS, and then pulled a
manifest and fetched what it did not have. Three sections of this document
described it, `discover.h`, `networks.h`, `sync.h`, `pairing.h` and
`pair_format.h` implemented it, and `tests/test_pair_format.py` held the last of
those against the browser.

All of it is gone, and the reason is worth keeping. The editor became a page
with nothing behind it, and a page cannot be a server for a device to fetch
from — so the direction had to reverse, and the only wire left between the two
was the cable that charges the battery. For a while both paths were compiled in,
on the argument that the Wi-Fi one was a working way to get content onto a
device while the cable was unproven. That argument expired quietly when `app.py`
was deleted: the device could still connect to a network, and there was nothing
on it to connect to. What was left was a radio, a captive portal, a stored
password and a pairing token, all serving a path with no other end.

Removing it took about 850 KB of program space and 24 KB of RAM with it — the
sketch went from 39% of flash to 14% — and the five digits went from both sides
at once, which they had to: they proved physical presence over a wire that
anybody on the network shares, and a cable is that proof by itself.

**The talker has no radio at all now.** Not "off by default": there is no
`WiFi.begin()` in the firmware. That is a smaller claim than it sounds for
battery life, because the radio was already only powered up while somebody
stood at the menu asking for content — but it is a much larger one for what the
device is, and it is the sentence the privacy notice now makes.

---

## Building

Two pages and a file between them. The editor exports the Sammlung as an
`.obz` for the talker — sources, negation flags and the 16 kHz WAVs — and
[`loader/`](../loader/README.md) compiles that file into what the device reads
and sends it. What the compile produces is what the rest of this section
describes; where the files go afterwards is [cable.md](cable.md), and
[ADR 0011](../adr/0011-editor-exports-loader-sends.md) is why it is two pages.

There is one other way out of the compile, and it exists because the cable is
the only way in: *Write into a folder instead*, on the same page, puts the same
files on a disk. `tools/serialcheck.html` can send that folder and `mklittlefs`
can turn it into an image, so a cable that turns out wrong on hardware is not
the end of the road.

It used to be `build.py`, writing into `firmware/vorlaut/data/`. Then it was
`runBuild()` in the editor, writing into IndexedDB. It is `compileDevice()` now
and answers with a map of files rather than writing anywhere — but the names
have never changed, and the device reads them the same way it always has:

| File            | Content                                     |
|-----------------|---------------------------------------------|
| `a<hash>.wav`   | spoken sentence, 16 kHz mono 16 bit         |
| `t<hash>.bin`   | 128x128 symbol area, RGB565 big-endian      |

plus `layout.bin` — a compact table with the number of sets, their names, the
sleep timeout and the hashes saying which file belongs to which key.

**That table sits with the content, not in the firmware.** Creating or renaming
a set therefore changes nothing about the program — nothing has to be
recompiled and nothing flashed over a cable. The firmware is the same for
everyone.

**The file names are hashes of the content, not of the position.** That has two
consequences:

- If the same symbol or the same sentence appears in several sets, it still
  sits on the device only **once**. Several entries simply point at the same
  file.
- A file cannot go stale without its name changing along with it. So a name can
  never point at the wrong content.

**There is no border, and the symbol has the pixels it used to take.** The file
is the whole 128x128 display. Six pixels around a 116x116 tile were once the
set's own colour, drawn by the firmware rather than baked into the file so that
the same symbol in a blue and in a green set stayed one file. The per-set colour
has gone — from the editor, from this table and from the firmware — and nothing
replaced it, so the six pixels were being blacked out to say nothing. A symbol
gets them: about a tenth wider in each direction on a key 15.21 mm across, for
22% more bytes a file. A set is told apart by the picture and the name on its
set key, which is what the set key was always for.

Files from earlier runs that are no longer needed are cleared away by the build
itself: anything in the store that this run did not produce goes.

There are no switches. `build.py` had `--no-audio` and `--force-audio`, and
neither survived the move: nothing is re-rendered that has not changed, because
a WAV is named for the text, the voice and the pipeline version that made it, so
"force" is what changing any of those already does.

---

## Speech output

`tts.py` speaks either locally through **piper** or through the **Azure Speech
REST API**. Which one is not a setting of its own: it follows from the voice.
Choosing between the two and getting one working is a different question, and
it is answered in [browser-tts.md](browser-tts.md).

### One voice has one name

A voice is named by one string, and that string says which of the two speaks
it:

```
piper:de_DE-thorsten-medium
azure:de-DE-GiselaNeural
```

It stands as `"voice"` in `layout.json`, next to the menu language, and is
chosen on the page. An empty entry is the normal case for a fresh layout —
then whatever is on offer here answers, a local voice first, and among equals
one that speaks the language the device is set to.

What is on offer:

```bash
.venv/bin/python tts.py --voices
```

Only voices that actually work show up there. An Azure voice appears once the
key is there, a piper voice once its model lies on disk — a voice that would
turn into a silent key at build time is worse than no choice at all.

### piper

The models sit in `content/voices/`, two files each: `de_DE-thorsten-medium.onnx`
and the `.onnx.json` beside it, which is piper's own description of the voice.
A lone `.onnx` is not a usable voice and is not offered.

Three places are searched, in this order, and the first match wins:
`$VORLAUT_VOICES`, then `content/voices/`, then `voices/` next to the code.

They are deliberately not in the repository — together about 250 MB, 63 MB
apiece with the `low` one no smaller than the rest, and they are somebody
else's files. `python3 tools/voices.py` fetches them; `de` or `en` as an
argument narrows it down. All four shipped ones are public domain, which is
what lets them be handed on. Most of piper's better known English voices are
not, so read the MODEL_CARD next to a model before adding one. Which licence
each of the four carries, and what sits underneath it, is written out in
[`voices/LIZENZ.md`](../voices/LIZENZ.md).

Which voices exist and where they come from stands in `tts.py`
(`VOICE_CATALOGUE`, `download_voice`), not in the tool — the page fetches them
too, and one list in two places would go out of step. `tools/voices.py` is the
command line over it, `POST /api/voices/fetch` the interface; both write the
same files into the same folder, and both skip what is already there.

**In the container they are already there.** The image bakes all four in at
`/voices` and sets `VORLAUT_VOICES` to it, so a fresh container speaks the
moment it starts instead of waiting for somebody to press Fetch voices. They
are fetched during the build by `tools/voices.py` itself, so the catalogue
stays the one place that says where a voice comes from.

Deliberately kept out of the way of the source tree: a mount over it
folder over that path for developing, and the mount replaces the directory
wholesale. A voice baked into `/app/voices` would be invisible the moment such
a container ran, and would look exactly like a download that never happened.
`/voices` is outside the mount.

None of that closes the folder on the NAS. The search carries on into
`content/voices/`, so a fifth voice still drops in there, is still found, is
still backed up with the rest of the content, and still does not mean building
the image again.

### Azure

Key and region go into `.env`. **The region is not a matter of taste** — it has
to match the one the key was created in, otherwise Azure answers with 401.

```
AZURE_SPEECH_REGION=westeurope
AZURE_SPEECH_RATE=-10%
AZURE_SPEECH_LANGUAGES=de-DE,en-US
```

The last one decides which voices the picker offers. Azure has 556, and a list
of all of them is not a picker; German and English are what it stays at. The
answer is asked of Azure itself rather than written down here — a typed list
goes stale — and cached for a week under `content/cache/azure-voices.json`.

`AZURE_SPEECH_VOICE` is from the time before the voice stood in `layout.json`.
It still decides which voice an existing installation carries over on the first
start; after that the page answers the question.

### Both the same way afterwards

Piper writes at the sample rate of its model, Azure answers at 16 kHz — what
comes back goes through the same ffmpeg chain either way: silence at the
beginning and end removed, then
`loudnorm I=-16:TP=-1.5:LRA=11`, output as a 16 kHz mono 16 bit WAV. That makes
all keys equally loud — important, because the device has no volume control.

The key comes from the environment variable `AZURE_SPEECH_KEY`, alternatively
from `.env`. A set environment variable wins.

Only what changed gets rendered: a fingerprint is formed over the text and the
voice, finished files sit under `content/cache/tts/`. Whoever changes the voice
or the ffmpeg chain changes the fingerprint too — then everything is re-spoken
automatically.

That fingerprint is derived from the voice **name** alone, never from the path
of a model: the same voice sits at `/voices` in a container and in
`content/voices` on a laptop, and both have to arrive at the same file name, or
the device re-downloads a cache it already has.

Testing a single sentence works as well:

```bash
.venv/bin/python tts.py "Ich moechte nach draussen" probe.wav
VORLAUT_VOICE=piper:en_US-john-medium .venv/bin/python tts.py "Let us go out"
```

---

## Tests

```bash
python3 tests/run.py            # all of them
python3 tests/run.py cable      # only the matching ones
```

Every file called `tests/test_*.py` runs, and that is the whole rule — the
folder is the list, so a test that was just written runs without being entered
anywhere. Each one also still works on its own, which is how they are referred
to throughout this document:

```bash
python3 tests/test_language.py
```

What a test is for is in its own docstring. A few of them compile C from the
sketch to check that the firmware reads a format the way the build writes it,
so those need a compiler; the rest need only what the web interface needs
anyway.

**Adding a test or a fixture? `git add` first, then run.** `test_language.py`
and `test_links.py` ask `git ls-files` what exists, so an untracked file is one
they cannot see - the suite passes, and then fails on the very next commit,
which looks like the commit broke something. The reasoning is in the docstring
of `tests/run.py`.

---

## What is in the repo and what is not

The repo holds **code and documentation only**. Everything concerning a child —
layout, symbols, photos, spoken sentences — sits under `content/` and is
deliberately not versioned.

```
content/                 your own content, gitignored
├── layout.json
├── symbols/
└── cache/
    ├── tts/             spoken sentences
    ├── tiles/           rendered symbol areas
    ├── thumbs/          search previews
    └── layout-backups/  the last 60 states of layout.json

example/                 neutral sample content, in the repo
├── layout.json
└── symbols/
```

On the first start `content/` is filled from `example/`. A freshly cloned
project therefore shows a set with four keys right away, without anyone having
to create anything.

The location can be moved, onto a network share for instance:

```bash
VORLAUT_CONTENT=/volume1/talker/content .venv/bin/python app.py
```

The built output follows along: with `VORLAUT_CONTENT` set, `build.py` writes
into `<content>/data/` instead of `firmware/vorlaut/data/`. That is deliberate
- whoever points the content somewhere else is usually working on a copy, and
a build must not then overwrite the real device data. `VORLAUT_DATA` overrides
both if the two really do belong apart.

**`content/` has to be backed up separately.** All the work is in there, and git
deliberately no longer catches it. On a NAS it is covered by the NAS backup; on
a computer it belongs in your usual backup.

Also not in the repo: `firmware/vorlaut/data/`, `layout.h` and the LittleFS
image — those are recreated from `content/` in seconds. And `.env` with the
Azure key. The piper models under `content/voices/` are not in it either, for
a different reason: they are 250 MB of somebody else's files, fetched rather
than copied along — by you, or by the image build, which puts the same four at
`/voices`.
