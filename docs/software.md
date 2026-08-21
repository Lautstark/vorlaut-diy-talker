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

Two routes, and the choice is made per installation:

**piper** — local, offline, free, no account anywhere. Two German and two
English voices, all four public domain. Once:

```bash
pip install piper-tts
python3 tools/voices.py
```

The models can also be fetched from the interface, which is the route that
does not ask anybody to open a terminal: the voice picker in the header offers
it whenever something from the catalogue is missing, and says how far it has
got while it runs. Same catalogue, same files, same folder — see
[piper](#piper) below.

**Azure Speech** — needs a key of your own; the free F0 tier includes 0.5
million characters a month, which is plenty for a talker. More voices and
better ones, at the price of an account and a network.

Neither is required for editing. Without any voice the interface works, the
build works, and what is already in the cache still goes onto the device —
only new sentences stay silent and say so.

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
- **Text field**: what gets spoken. It may differ from the symbol's word — the
  symbol shows "anhalten", what gets said is "Stopp".
- **▶** previews the sentence in the chosen voice. With piper that costs
  nothing; with Azure it is a request like any other.
- **Freigeben** at the top right runs the build and shows the log. It is
  the only button in the header, and with an Azure voice it is the only
  moment that costs anything: this is where new sentences go to Azure.

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
English leaves a German set German. The voice is picked separately and stands
as `"voice"` in `layout.json`.

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

## Pairing on the server

The device's half of this is in `firmware/vorlaut/pairing.h`, the wire format
in `pair_format.h`, and the whole protocol under [Pairing](#pairing) below.
The server's half sits in `app.py`:

`pair_start`, `pair_poll`, `pair_waiting` and `pair_confirm` hold the pending
pairings in memory behind one lock — deliberately not on disk. A pairing lives
about three minutes; a server restart in the middle of one is rare, and
starting again at the device is a shorter way back than any file would be.

Two decisions worth keeping:

**An unknown device and a wrong secret answer the same 404.** The device id is
the Wi-Fi MAC, which anybody on the network can read out of an ARP table; if a
wrong secret said something different, that would tell an attacker which ids
are worth guessing at.

**A wrong code counts against every pairing that is waiting.** The person is
standing at one device typing what they see, so with one on the table that is
exactly right, and it stops a wrong code from being retried against each
pending pairing in turn.

`tests/test_pairing.py` starts the real server and plays a pairing through
from both ends, including the parts a mistake would be quiet in: the key
handed over only once, leading zeros in a code surviving, and nothing being
handed out at all while `VORLAUT_DEVICE_TOKEN` is unset.

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

**Nobody types that key into the device.** It used to be pasted into `.env` and
then entered character by character into a captive portal on a phone, which was
the worst step in the whole setup — see [Pairing](#pairing) below.

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

## Pairing

How the key gets onto the device without anybody typing it.

The device shows **five digits, one per display**, and whoever is standing in
front of it types them into the web interface. That is the whole idea: a device
that has never been paired holds no shared secret, so it cannot prove anything
to the server — but somebody who can read its displays is in the room with it.
Physical presence is the proof, which is why **the device makes the code up and
the browser confirms it**, and not the other way round.

```
   device                          server                        browser

   1  POST /api/device/pair  ---->  remembers id, code, secret
      id, code, secret

   2  five digits on the
      displays

   3                                <----  POST /api/pair/confirm   somebody
                                                                    types the
                                                                    five digits

   4  POST /api/device/pair/poll -> hands out VORLAUT_DEVICE_TOKEN
      id, secret            <----   token
```

The device stores the token in NVS next to the Wi-Fi credentials, so it
survives a reflash and pairing happens exactly once.

### The digits sit where the keys sit

The five digits are shown in the arrangement of the keys — 1 and 2 on top, 3
and 4 below, the set key on the left under the speaker, the same drawing as in
[hardware.md](hardware.md). **The web interface has to lay its five boxes out
the same way.** Then nobody has to be told an order: each box gets what the
display in that position shows.

As one string the code runs `key1 key2 key3 key4 setkey` — that order is the
only part of the arrangement the two sides have to agree on in writing.

Leading zeros are kept, so a code is always five characters. Otherwise one of
the five displays would stay empty and nobody could tell which.

### The two device endpoints

Lines, not JSON, and no key — this is where a device that has no key yet comes
to get one. Same reasoning as the manifest: a JSON parser on the ESP32 means a
library, a heap and a class of failure a fixed line format does not have. A
reader skips keywords it does not know, so either side can gain a field without
the other falling over.

```
POST /api/device/pair
     device <12 hex>        the Wi-Fi MAC, stable across a reflash
     code <5 digits>        what is on the displays
     secret <32 hex>        16 random bytes, never shown anywhere

  200 ok 1
      expires 180
      interval 3
```

```
POST /api/device/pair/poll
     device <12 hex>
     secret <32 hex>

  200 state waiting                    nobody has typed it yet
  200 state ready
      token <VORLAUT_DEVICE_TOKEN>     confirmed
  200 state expired                    the code was too old
  200 state denied                     too many wrong attempts
```

Status codes both endpoints may answer with: **503** when the server has no
`VORLAUT_DEVICE_TOKEN` to hand out at all, **404** or **410** for a pairing the
server does not know or no longer holds, **429** when too many pairings are
being started at once. The device turns each of those into one word on its
displays.

**The secret is not the code.** Without it the poll would be authenticated by
the device id alone — and that is the Wi-Fi MAC, which anybody on the network
can read out of an ARP table. They could then poll along and take the token in
the moment it is confirmed. Sixteen random bytes close that, and the secret
never appears on a display or in the interface.

### The two browser endpoints

JSON, like the rest of the interface — this side has a parser.

```
GET  /api/pair
     → {"waiting": [{"device": "aabbccddeeff", "since": 12}]}

POST /api/pair/confirm   {"code": "12345"}
     → {"ok": true, "device": "aabbccddeeff"}
     → 400 {"error": "err.pair_wrong_code", "left": 3}
     → 410 {"error": "err.pair_expired"}
```

`GET /api/pair` is what lets the interface offer the five boxes only when a
device is actually waiting. `since` is seconds, so the page can show how much
of the code's life is left.

The user types five digits and nothing else — no device is picked. The server
looks for the pending pairing carrying that code. A code matching none of them
is a wrong attempt and counts against every pairing currently waiting, which
with one device on the table is exactly right.

### Expiry and attempts

**A code lives about three minutes and dies after a handful of wrong
attempts.** Both are on the server, because the server is the side that can be
guessed at: five digits are a hundred thousand possibilities, which is plenty
against somebody typing and nothing at all against a script.

The device carries its own end of the same limit: it takes the `expires` the
server sends but never keeps a code up for more than 200 seconds, and it polls
no faster than every 2 and no slower than every 10 seconds whatever `interval`
says. A server that answers with a year must not be able to park the device in
a pairing for a year — the same reason the setup portal gives up after three
minutes. **A device that hangs in setup no longer speaks**, and speaking is the
one thing it is for.

Holding the set key ends the pairing at the device. Deliberately the same
400 ms as everywhere else, so brushing past it does not throw away a code
somebody has already started typing.

### The token is not tied to an address

The device stores the token and the address of the computer as two separate
things. Carried to another network where the computer has a different address,
only the address changes — the key stays valid and nothing has to be paired
again. That is why the token is a plain secret and carries no host in it.

The other way round is handled too: a stored key the server does not know is
worth nothing, and since the portal no longer has a field to correct it in, the
device throws it away and pairs once more by itself. That is the way back when
`VORLAUT_DEVICE_TOKEN` on the server has been replaced.

### What this does not do

All of it runs over plain HTTP on the home network, exactly like the sync it
sets up. Somebody already listening on that network sees the token go past —
but they would see it on every sync afterwards as well, so pairing does not
make that better or worse. What pairing does close is the case of a second
machine on the network claiming to be the device, which the secret and the
five digits together prevent.

`firmware/vorlaut/pair_format.h` holds the device's side of the format with no
Arduino dependency, and `tests/test_pair_format.py` compiles it here and checks
it against the answers described above — including the ones that are easy to
get wrong, such as `state ready` arriving without a token.

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

`tts.py` speaks either locally through **piper** or through the **Azure Speech
REST API**. Which one is not a setting of its own: it follows from the voice.

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

They are deliberately not in the repository — together about 130 MB, and they
are somebody else's files. `python3 tools/voices.py` fetches them; `de` or `en`
as an argument narrows it down. All four shipped ones are public domain, which
is what lets them be handed on. Most of piper's better known English voices are
not, so read the MODEL_CARD next to a model before adding one.

Which voices exist and where they come from stands in `tts.py`
(`VOICE_CATALOGUE`, `download_voice`), not in the tool — the page fetches them
too, and one list in two places would go out of step. `tools/voices.py` is the
command line over it, `POST /api/voices/fetch` the interface; both write the
same files into the same folder, and both skip what is already there.

In the container `piper-tts` is installed but the voices are not: the project
is handed in as a directory anyway, so they live in `content/voices/` on the
NAS, get backed up with the rest of the content, and a fifth voice does not
mean building the image again.

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
a different reason: they are 130 MB of somebody else's files, fetched rather
than copied along.
