# Editing and building content

## On the computer

| | what for |
|---|---|
| Python 3.9 or newer | web interface and build |
| ffmpeg | trimming and normalising speech files |
| Pillow | converting images (`requirements.txt`) |
| arduino-cli or Arduino IDE | compiling and flashing the firmware |
| ESP32 core 3.x | for the Feather |

Alternatively the web interface runs in the included Docker image — then only
the Arduino tools for flashing are needed locally.

## For the speech output

Currently **Azure Speech** with the voice `de-DE-GiselaNeural`. That needs a key
of your own; the free F0 tier includes 0.5 million characters a month, which is
plenty for a talker.

> A variant without a cloud account is planned (offline TTS), so the project
> can be rebuilt without a Microsoft account. Not implemented yet.

## Web interface

`app.py` starts on <http://localhost:8771> and looks like the device: tabs for
the sets on top, below them the set tile and the four speech keys in a 2x2
grid. The border of each tile has the colour of the set.

- **Clicking a symbol** opens the search. Clicking a result loads the PNG into
  `content/symbols/` and enters it into `content/layout.json`. The same dialog
  holds **Eigenes Bild** — that lets you upload a photo or a drawing of your
  own. Anything Pillow can read (PNG, JPG, HEIC export, GIF …) is converted to
  PNG and put into `content/symbols/`. Existing files are never overwritten,
  identical names get `-2` appended. At most 10 MB per image.

  Non-square images are **cropped to square, centred**, so they fill the tile
  edge to edge — otherwise a white bar would remain on two sides. With a
  portrait image a piece is lost at the top and bottom. If the framing matters,
  crop the photo to square in the Photos app first; then it stays untouched.

  Large images are scaled down to a **500 pixel long edge** on acceptance
  (`SYMBOL_MAX_PX` in `app.py`) — the same size in which ARASAAC delivers its
  pictograms. A phone photo at 3024x4032 then weighs a few kilobytes instead of
  several megabytes. That is intentional, and the device renders only 116x116
  pixels anyway.
- **Text field**: what Gisela says. It may differ from the symbol's word — the
  symbol shows "anhalten", what gets said is "Stopp".
- **▶** previews the sentence (goes through Azure, so it needs the key).
- **Freigeben** at the top right runs the build and shows the log. It is
  the only button in the header, and it is the only moment that costs
  anything: this is where new sentences go to Azure.

**Device preview:** the toggle at the top additionally shows below each tile how
it arrives on the device — scaled to 116x116, rounded to RGB565, with the border
the firmware draws, and at the size of the actually visible area of
**15.21 x 15.21 mm**. A detailed pictogram can become unreadable at that size;
better to see it before picking than afterwards.

The large tile stays the source image in full sharpness — it is there for
picking.

**Reordering by dragging:** every speech key has a grip (⠿) at the top right.
Drag it onto another key and the two **swap** places — in the fixed 2x2 grid
that is less ambiguous than inserting. The tabs at the top can be dragged as
well; their order determines how the set key cycles on the device.

Reordering costs nothing: the speech files hang off the text in the cache, not
off the position. So nothing gets re-spoken.

Changes are saved to `content/layout.json` automatically, a second after the
last keystroke. There is no save button, and closing the tab with something
outstanding asks first.

**Saving and releasing are two different things**, and deliberately so.
Saving is free and happens by itself. Releasing renders the tiles and sends
new sentences to Azure, and that must not happen while somebody is still
typing - with automatic releasing, "I want to go outside" would cost a call
for `I`, one for `I want`, one for `I want to go`, for text nobody ever meant
to say.

So the button says what it does for the device, not what the computer does
internally: it makes this state available. The device fetches it when it
fetches. Until it can do that by itself, the same state also goes over the
cable with `build.py --fs-image`.

---

## layout.json

The single source of truth. Exactly 4 slots per set.

```json
{
  "sleep_timeout_seconds": 600,
  "language": "de",
  "sets": [
    {
      "name": "Grundset",
      "active": true,
      "symbol": "start.png",
      "color": "#4A90D9",
      "slots": [
        { "text": "Ja",       "symbol": "ja.png" },
        { "text": "Nein",     "symbol": "nein.png" },
        { "text": "Stopp",    "symbol": "stopp.png" },
        { "text": "Hilf mir", "symbol": "hilfe.png" }
      ]
    }
  ]
}
```

`language` is the language of the whole thing: the web interface, the build
log, and the four menu labels the device draws itself. Available are `en` and
`de`; if the field is absent it is `en`. The picker in the header sets it - it
saves and reloads the page.

It is deliberately one setting and not two. A talker whose menu says "back"
while the computer it is edited on says "zurück" would be one thing to keep in
step for no gain.

What it does **not** touch is the content. Set names, the words on the keys and
what gets spoken are whatever somebody typed - switching the interface to
English leaves a German set German. The voice is picked separately in `.env`
(`AZURE_SPEECH_VOICE`).

For the device it travels in `layout.bin`, so a change needs a rebuild and an
upload - but no reflashing of the program. One and the same firmware image
speaks every language.

Adding a language is one block in [`texts.py`](../texts.py) and, if the device
is to speak it too, one in
[`firmware/vorlaut/texts.h`](../firmware/vorlaut/texts.h) plus an entry in
`LANGUAGE_CODES` in `build.py`. `tests/test_ui_texts.py` and
`tests/test_texts.py` check that the tables stay in step.

`active` decides whether a set goes onto the device. If the field is absent it
counts as active — that keeps older layouts valid unchanged.

Up to 25 sets may be created (`MAX_SETS` in `build.py`), **at most 5 active at
once** (`MAX_ACTIVE_SETS` there, the same number as `MAX_SETS` in
`firmware/vorlaut/layout_format.h`). The 5 is not arbitrary: a fully filled set
costs around 300 KiB and the file area on the ESP32 holds 1536 KiB.

The point: sets for the holidays, for grandma, for the swimming pool can be
prepared and left lying around without anything getting lost. Switching happens
on the computer, followed by a rebuild and a flash — the device itself cannot
change the selection.

Switching costs no duplicated work: tiles and audio sit content-addressed in the
cache under `content/cache/`. Turning a set back on weeks later therefore costs
neither compute time nor an Azure call.

`color` is the colour rendered as a border around all five images — so that she
recognises from the colour impression which set she is currently in. New sets
get a colour from `DEFAULT_PALETTE` in `build.py` in turn; the web interface
fetches the same list from there.

An empty `text` means: this key stays silent. An empty `symbol` yields a
placeholder tile with a grey cross.

A `symbol` is either a file name from `content/symbols/` or a reference of the
form `metacom:<name>` — see the next section.

---

## METACOM (optional)

Whoever has a METACOM licence can add the collection. It is **not** copied into
the project and not versioned; all that gets configured is the path to the
unpacked download:

```
VORLAUT_METACOM_DIR=/Users/you/METACOM_9_Desktop
```

Expected underneath it are `METACOM_Symbole/Symbole_PNG/PNG_ohne_Rahmen`
(without a border, because the firmware draws one itself) and the MetaSearch
application, which the keywords come from. On the first start a search index is
built from that under `content/cache/metacom-index.json`; it is rebuilt as soon
as the path or the MetaSearch file changes.

In the layout, METACOM symbols appear as `"symbol": "metacom:trinken"`. The name
is the file name without extension.

If the variable is not set, everything runs as before: search returns ARASAAC
only, and `metacom:` references yield the placeholder tile instead of an abort.
That keeps the same `layout.json` usable on a computer without a licence.

For the container this is already set up: `docker-compose.yml` mounts the path
from `.env` read-only under `/metacom` and points `VORLAUT_METACOM_DIR` there.
So the same line in `.env` as for running without a container is enough. On a
NAS you enter the NAS path there — inside the container it is always
`/metacom`, the rest stays the same.

If nothing is set, the mount points at `example/` instead; the METACOM
structure is missing there and the integration switches itself off.

`python doctor.py` shows under "Wahlweise" whether the collection was found and
whether the keywords could be read.

---

## Finding the server

The device used to be told where the computer is: an address field in the setup
portal, typed in on a phone. That is right until the router hands out a
different number, and it is wrong from the start as soon as the device is
carried into another network.

So it asks instead. One UDP packet to the broadcast address of the local
network, port 8771:

```
vorlaut? 1
```

and whoever runs `app.py` answers, straight back to where the packet came from:

```
vorlaut 1
port 8771
name vorlaut
```

**The answer deliberately carries no address.** It arrived from one, and the
device reads it off the envelope — that is the one address it is certain to be
able to reach the server at, which is more than the server could promise about
any address it named itself. A machine with Wi-Fi and a cable has several, and
which of them is the useful one depends on who is asking.

Lines again, and unknown keywords skipped, for the same reason as the
manifest: on the other end sits an ESP32 without a parser.

**The port asked on is fixed; the port in the answer is not.** UDP 8771 is the
one number both sides have to agree on in advance. What the answer carries is
where the web interface really listens, so `--port 8798` stays findable.

Three attempts, 400 ms each, and then the device gives up. What counts, in this
order:

| | |
|---|---|
| an address typed into the portal | beats everything — for networks where a broadcast goes nowhere |
| whoever answered the search | … and is kept for next time |
| whoever answered the time before | so one bad day on the network costs nothing |

A search that finds nothing is not an error, it is a guest network. Nothing
here may hang and nothing here may stop the device speaking: the content is on
LittleFS and works with no network at all.

**`vorlaut.local` comes out of the same work.** `discovery.py` also answers
mDNS queries for that name, so the interface can be bookmarked as
<http://vorlaut.local:8771> instead of as a number that changes. That one is
for the person — the device has its search and needs no resolver.

It claims the name without asking, which a complete mDNS implementation would
not do: there is no probing and no conflict detection. If something else on the
network is already called `vorlaut`, both answer and the quicker one wins. For
one of these on a home network that has not been worth the rest of the
protocol.

**Whoever is on the network can answer a search.** The endpoints stay behind
the key, but a device asking who has the content will hand its key to whatever
says "me" first. That is the same trust the project already places in the local
network — the interface has no sign-in either — but it is worth knowing before
the device goes into a network that is not yours. An address typed into the
portal takes the search out of the loop.

The two sides are `firmware/vorlaut/discover.h` and `discovery.py`;
`tests/test_discovery.py` plays the answers through.

## Sync with the talker

So the device can fetch its content by itself, the server exposes two
endpoints. Both require a key:

```
GET /api/device/manifest        version stamp and file list
GET /api/device/file?name=<n>   one file from data/
```

The key sits in `.env` as `VORLAUT_DEVICE_TOKEN` and is sent as the header
`X-Vorlaut-Token` — **not** in the URL, because URLs end up in logs. Comparison
uses `hmac.compare_digest`, so the response time gives nothing away about the
key.

**Without a key set, both endpoints answer with 503.** Deliberately that way
round: what lies in `data/` are the recordings and pictures of your child, and a
sync nobody set up should not hand anything out. Generating a key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

The sync is simple because a file name always means the same content: the
device fetches the manifest, compares the version stamp with the stored one,
and on a mismatch fetches only the files it does not have and throws away what
is no longer in the list. `layout.bin` always has the same name and is fetched
every time.

To be precise, the names are hashes of the **input** - source image plus
pipeline version, or text plus voice configuration - not of the output bytes.
Same input, same name, so a file is transferred once no matter how many sets
it appears in. `TILE_PIPELINE` in `build.py` is what keeps that honest: bump it
when the rendering changes, and every name changes with it.

**The version stamp describes the files, not the layout.** That distinction
matters more than it looks. It used to be derived from `layout.json`, and the
effect only showed in use: edit without releasing, and the manifest advertised
a new version over the old files. The device fetched them and stored the new
stamp - and after the release the stamp did not move any more, because the
layout had not changed since. From then on the device saw its own version,
believed it was up to date, and never fetched anything again. The manifest also
carries `current`, which says whether what lies there is still what the layout
asks for.

`tests/test_device_sync.py` plays the whole thing through against a real
server. It was written before the firmware side existed, which is how the
version-stamp mistake above was found.

The manifest comes as **lines, not JSON**:

```
version 3f2a...
current 1
sets 5
bytes 949888
file t3bd7....bin 26912
file a8c1....wav 41008
```

Same reason `layout.bin` is binary: a JSON parser on the ESP32 means a
library, a heap and a class of failure that a fixed line format does not have.
A reader is meant to skip keywords it does not know, so a field can be added
later without a device already in the field falling over.

The device side is `firmware/vorlaut/sync.h`, shared by the real firmware and
by `firmware/tests/test7_sync`, which does nothing but this. Files land under
`/.part` first and are renamed only once they are complete — a transfer that
breaks off leaves a fragment behind, not half a file under a name that
promises whole content.

---

## Building

```bash
.venv/bin/python build.py
```

Writes into `firmware/vorlaut/data/` (gitignored, uploaded to the device):

| File            | Content                                     |
|-----------------|---------------------------------------------|
| `a<hash>.wav`   | spoken sentence, 16 kHz mono 16 bit         |
| `t<hash>.bin`   | 116x116 symbol area, RGB565 big-endian      |

plus `layout.bin` — a compact table with the number of sets, colours, sleep
timeout and the hashes saying which file belongs to which key.

**That table sits with the content, not in the firmware.** Creating, renaming
or recolouring a set therefore changes nothing about the program — nothing has
to be recompiled and nothing flashed over a cable. The firmware is the same for
everyone.

**The file names are hashes of the content, not of the position.** That has two
consequences:

- If the same symbol or the same sentence appears in several sets, it still
  sits on the device only **once**. Several entries simply point at the same
  file.
- A file cannot go stale without its name changing along with it. So a name can
  never point at the wrong content.

**The coloured border is not in the image.** The file contains only the 116x116
symbol area; the six pixels of border are drawn by the firmware itself from
`SET_COLORS`. Otherwise the image would depend on the set it currently sits in
— the same symbol would be two different files in a blue and in a green set,
and a colour change would rewrite every image of a set. This way a colour change
costs **zero** image data.

Files from earlier runs that are no longer needed are cleared away by `build.py`
itself.

Useful switches:

```bash
.venv/bin/python build.py --no-audio      # images and layout only
.venv/bin/python build.py --force-audio   # re-render all WAVs
```

---

## Speech output

`tts.py` speaks through the Azure Speech REST API. The defaults are
**de-DE-GiselaNeural** in the region **germanywestcentral** at a speaking rate
of **-5 %**.

All three can be changed in `.env`:

```
AZURE_SPEECH_REGION=westeurope
AZURE_SPEECH_VOICE=de-DE-KatjaNeural
AZURE_SPEECH_RATE=-10%
```

**The region is not a matter of taste** — it has to match the one the key was
created in, otherwise Azure answers with 401. Which voices your own key offers
is shown by:

```bash
.venv/bin/python tts.py --voices
```

The language is derived from the voice name, so `de-DE-GiselaNeural` yields
`de-DE`. An English voice works just the same.

Changing the voice changes the fingerprint, so on the next build everything is
re-spoken automatically.

After that through ffmpeg: silence at the beginning and end removed, then
`loudnorm I=-16:TP=-1.5:LRA=11`, output as a 16 kHz mono 16 bit WAV. That makes
all keys equally loud — important, because the device has no volume control.

The key comes from the environment variable `AZURE_SPEECH_KEY`, alternatively
from `.env`. A set environment variable wins.

Only what changed gets rendered: a fingerprint is formed over the text and the
voice configuration, finished files sit under `content/cache/tts/`. Whoever
changes the voice or the ffmpeg chain changes the fingerprint too — then
everything is re-rendered automatically.

Testing a single sentence works as well:

```bash
.venv/bin/python tts.py "Ich moechte nach draussen" probe.wav
```

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
Azure key.
