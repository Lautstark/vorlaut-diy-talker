# Setting up and editing content

What happens on the computer: what has to be installed, how the web interface
works, what the fields in `layout.json` mean, and where the settings live.

How the pieces work underneath — how the device finds the server, how it is
paired, how content reaches it, how a sentence becomes a WAV — is a separate
document, [software.md](software.md).

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
[piper](software.md#piper).

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

The page itself is `ui.html`, beside `app.py`, with its stylesheet and its
JavaScript in `static/`. All of it is read on every request, so a change shows
on a reload without restarting the server.

`static/main.js` is the only script `ui.html` names; everything else arrives
because something imports it. They are plain ES modules, loaded by the browser
itself — there is no bundler and no build step, and there is not meant to be
one. `static/state.js` says which values are shared between them and why the
rest are not.

The one thing `app.py` puts into the page is a JSON block, `#bootstrap`: the
language, the text table for that language, the list of languages, the palette
and the set limits. It used to be five placeholders substituted into live
script, which was safe only for as long as every value happened to be trusted
— `json.dumps` does not escape `</script>`. It is now data rather than script,
and `<` is escaped on the way in. See `app.bootstrap()` and `static/boot.js`.

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

What the build writes, and why the file names are hashes, is under
[Building](software.md#building).

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
`LANGUAGE_CODES` in [`layout.py`](../layout.py). `tests/test_ui_texts.py` and
`tests/test_texts.py` check that the tables stay in step.

`active` decides whether a set goes onto the device. If the field is absent it
counts as active — that keeps older layouts valid unchanged.

Up to 25 sets may be created (`MAX_SETS` in [`layout.py`](../layout.py)), **at
most 5 active at once** (`MAX_ACTIVE_SETS` there, the same number as `MAX_SETS`
in `firmware/vorlaut/layout_format.h`). The 5 is not arbitrary: a fully filled
set costs around 300 KiB and the file area on the ESP32 holds 1536 KiB.

The point: sets for the holidays, for grandma, for the swimming pool can be
prepared and left lying around without anything getting lost. Switching happens
on the computer, followed by a rebuild and a flash — the device itself cannot
change the selection.

Switching costs no duplicated work: tiles and audio sit content-addressed in the
cache under `content/cache/`. Turning a set back on weeks later therefore costs
neither compute time nor an Azure call.

`color` is the colour rendered as a border around all five images — so that she
recognises from the colour impression which set she is currently in. New sets
get a colour from `DEFAULT_PALETTE` in [`layout.py`](../layout.py) in turn; the web interface
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

## Settings from the interface

The gear next to the name opens a sheet: the voice, an Azure key, the METACOM
folder. The voice goes into `layout.json` with the content — it is a property
of what is being said. The other two go into `.env`, because they belong to
this installation and not to the sentences.

`config.py` is the only thing that touches `.env`, reading and writing both.
The writing is why it exists: that file is also the documentation of its own
settings, so a value is replaced where it stands, a commented-out entry is
woken up under the paragraph that explains it, and an emptied one goes back to
being an example instead of disappearing. `tests/test_config.py` checks the
quiet ways that can go wrong.

**The Azure key can only be set from the machine itself.** Editing content
from a phone is the point of `--host 0.0.0.0`, and none of that is worth
protecting from the household — but the key is somebody's bill, and it can be
read back out. So `/api/settings` refuses to write it unless the request came
from loopback, and the sheet says why instead of hiding the field. In a
container the question cannot be answered — what arrives is the bridge
gateway — so there it is allowed.

The key is never sent to the page. What comes back is whether one is stored
and its last four characters, which is enough to recognise it by and not
enough to use.
