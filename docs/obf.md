# layout.json as an Open Board Format document

What every field of `layout.json` becomes in a `.obf`/`.obz` and what comes
back, why each decision went the way it did, and what has deliberately been
left undone.

The converter is [`obf.py`](../obf.py); the round trip is
[`tests/test_obf.py`](../tests/test_obf.py). This document is the argument,
that file is the part of it a machine can check.

## Why change format at all

`content/layout.json` is a shape invented here. It has exactly one reader —
this project — and a document that only one program can open is a document
that dies with the program. The [Open Board
Format](https://www.openboardformat.org) is what the rest of the AAC world
writes boards in: a `.obf` is one board as JSON, a `.obz` is a zip of many of
them with a `manifest.json` naming the root. Boards can be handed to a
therapist, opened in another editor, and read in ten years by something nobody
has written yet.

Size is not a reason against it. CommuniKate 12, a real vocabulary, is 81
linked boards and about 330 KB of JSON in total. Five sets of four keys is
noise next to that.

## What does not change

**The device.** `layout.bin` stays exactly what
[`layout_format.py`](../layout_format.py) writes — a fixed binary structure the
firmware reads field by field. There is no JSON parser on the ESP32 and there
is not going to be one; the reasons are in
[software.md](software.md#building) and none of them have got weaker. OBF
replaces the document somebody edits, not the file that gets flashed.

**The build.** Symbols still become 116×116 RGB565 tiles, sentences still
become 16 kHz WAVs, and the manifest the device fetches is still lines rather
than JSON.

So the pipeline gains one hop at the front and loses nothing at the back:

```
.obz  ->  layout (in memory)  ->  tiles + WAVs + layout.bin  ->  LittleFS
```

## The shape: a set is a board

Each vorlaut set becomes one board. The set key becomes a button with a
`load_board` pointing at the next set, and the last set links back to the
first — which is what the key on the device actually does.

```
set-1  --set key-->  set-2  --set key-->  set-3
  ^                                          |
  +------------------------------------------+
```

**Switched-off sets are boards too, and stay in the ring.** A set with
`"active": false` is part of the collection somebody made; only the build
takes the active ones, exactly as `active_sets()` in
[`layout.py`](../layout.py) is applied when the device image is packed and not
when the file is read. `ext_vorlaut_active` records the flag.

The alternative — linking only the active sets — was rejected because it makes
every switched-off set an orphan, and then the one useful thing orphan
detection could say about a document is "yes, on purpose". A rule that fires
on the normal case is not a rule.

## Field by field

### The document

| `layout.json` | OBF | notes |
|---|---|---|
| `sleep_timeout_seconds` | `ext_vorlaut_sleep_timeout_seconds` on the **root board** | not in the manifest — see below |
| `language` | `locale` on every board | `"de"`, `"en"`; `de-DE` reads back as `de` |
| `voice` | `ext_vorlaut_voice` on the root board | `piper:…` or `azure:…` |
| `sets[]` | one board each, in order | root is the first |

Document-wide settings sit on the root board rather than in `manifest.json`.
The manifest is an index of a zip: it is written by whoever packed the file and
rebuilt by any tool that touches it, and an index is the last place to put
something you need to survive. A board is the document. It also means a single
`.obf` exported on its own still knows how long to stay awake and which voice
to speak in.

`locale` is not quite `language`. On this device that byte reaches only the
four menu labels the firmware draws itself — the words on the keys are
whatever somebody typed, in whatever language. `locale` is nonetheless the
right home for it: for any other reader of the file it is the only field that
means "what language is this board in", and a second `ext_vorlaut_language`
saying the same thing would be two fields to disagree. On a phone profile the
same field also picks the voice.

### A set

| `layout.json` | OBF | notes |
|---|---|---|
| `name` | board `name` | also the set button's `label`, which is derived and ignored on import |
| `color` | `ext_vorlaut_color` | `#3B5BDB`, kept verbatim |
| | every button's `border_color` | derived, `rgb(59, 91, 219)`, ignored on import |
| `active` | `ext_vorlaut_active` | |
| `symbol` | the set button's `image_id` | |
| `slots[]` | four buttons, in grid order | |

The colour belongs to the set — the firmware draws it as a border around all
five displays — and OBF has nowhere to put a colour that belongs to a board.
So it lives in `ext_vorlaut_color`, and `border_color` is written next to it
purely so a foreign renderer has something to draw. Hex is the authoritative
copy because it is the one that survives byte for byte: `#3B5BDB` through
`rgb()` and back has to come out identical twice or a file looks changed when
nothing was.

### A speech key

| `layout.json` | OBF | notes |
|---|---|---|
| `slots[i].text` | `vocalization` **and** `label` | the same sentence in both |
| `slots[i].symbol` | `image_id` → `images[]` `symbol{set,filename}` | a reference, never pixels |
| — | `sound_id` → `sounds[]` | build output, written only when asked for |

The text goes in both fields on purpose. `label` is what any other editor
draws on the key, and a button with no label is a blank square. `vocalization`
is what gets spoken, and stating it explicitly is what keeps the spoken half
right if somebody later shortens the label to fit. Coming back, the
`vocalization` wins and the `label` stands in when there is none — which is
the common case in boards written elsewhere.

### The grid

Two rows of three, with the top-left cell empty:

```
 .        key 1    key 2
 set      key 3    key 4
```

That is where the keys really are — [hardware.md](hardware.md): *speaker top
left, the set key below it, the four speech keys to the right as a 2×2 block*.
A grid with a hole in it is what `grid.order`'s nulls are for, and it beats a
tidy 1×5 that no renderer could turn back into the thing on the table.

Nothing on import depends on it. The set key is found by having a
`load_board`, the speech keys by not having one, both in grid order — so a
board drawn somewhere else with some other geometry still comes in.

### Ids

Stable, so that a re-export of an unchanged document is byte-identical.

| what | form | example |
|---|---|---|
| board | `set-<n>`, 1-based, file order | `set-2` |
| board file | `boards/set-<n>.obf` | `boards/set-2.obf` |
| speech key | `<board>-key-<n>` | `set-2-key-3` |
| set key | `<board>-set` | `set-2-set` |
| image | `img-<8 hex of the reference>` | `img-0e8e58bd` |
| sound | `snd-<TTS fingerprint>` | `snd-4a194c7e…` |

An image id is derived from the symbol reference and from nothing else, so the
same picture in two differently coloured sets gets the same id in both — the
same reasoning [`tiles.py`](../tiles.py) uses to make it exactly one file on
the device.

Zip entries carry a fixed timestamp and are written in sorted order, so the
same document always produces the same bytes. "Has anything actually changed"
should be answerable with `cmp`.

## Symbols stay references

This is the hard one, and it is a licence condition rather than a preference.

`layout.json` writes a symbol two ways: a bare file name, resolved against
`content/symbols/`, and `metacom:<name>`, resolved against a licensed METACOM
collection that lives outside the project entirely (see
[`metacom.py`](../metacom.py)). Both become `images[].symbol`, a pair of
collection and name:

| `layout.json` | OBF |
|---|---|
| `"ja.png"` | `{"set": "vorlaut", "filename": "ja.png"}` |
| `"metacom:essen"` | `{"set": "metacom", "filename": "essen"}` |

The rule generalises in both directions: **a bare name means the collection
that is yours, and `<set>:<name>` means that collection.** The `metacom:`
prefix that already exists is the general form with one value filled in, so a
board that draws on some third collection reads back as `arasaac:2349` rather
than being flattened into nothing.

**A METACOM board must be structurally impossible to store as pixels.** The
licence is per person; a file carrying the pixels has already handed the
collection to whoever received it. So:

- the exporter never writes `data`, `url` or `path` on a METACOM image;
- embedding your own symbols (`--images`) skips them — the reference stays, the
  pixels do not travel, and the person at the other end resolves it against
  their own licensed copy or sees a placeholder;
- `write_obz()` calls `check_licensing()` first, whatever the caller thinks it
  is doing, and raises rather than warns. There is exactly one door out of this
  module so that the invariant can stand next to it.

All three are checked in [`tests/test_obf.py`](../tests/test_obf.py), because a
licence condition that holds by convention holds until somebody is in a hurry.

By default nothing at all is embedded — a `.obz` is the document, and the
pictures are references. `--images` is the opt-in for handing a board to
somebody who has no `content/symbols/`.

## Licences per image

`images[].license` is where the attribution the project already owes can
actually travel. The README says it once for the repository; a document handed
to somebody else can only say it per file.

| collection | `license.type` | author |
|---|---|---|
| `vorlaut` | `CC BY-NC-SA 4.0` | Sergio Palao, ARASAAC |
| `metacom` | `Proprietary` | Annette Kitzinger |

**The known flaw:** every symbol in `content/symbols/` gets the ARASAAC line,
including a photograph of your own kitchen that was uploaded rather than
searched for. `layout.json` records where a symbol came from nowhere at all —
only a file name — and the fix is provenance recorded when the file is
written, not a guess here from the shape of the name. `arasaac_download()` in
`app.py` writes `<label>-<id>.png`, so the id is sitting right there in the
name; reading it back out would be exactly the kind of inference that
eventually attributes `haus-12.png` to a pictogram nobody downloaded. See
[What is missing](#what-is-missing).

`layout_to_document(image_license=…)` overrides it for an export that knows
better.

## Sound: the text is the source of truth

A sentence is what somebody typed. The WAV is what a build made of it, named
by a fingerprint of the text and the whole voice configuration (`tts.py`).
That relationship is not negotiable and the mapping follows it:

- **Export** writes `sounds[]` and `sound_id` only when asked (`--sounds`), and
  only for sentences that are already in the TTS cache. Nothing is spoken by
  the converter.
- Each sound carries `duration` read out of the file's own header,
  `ext_vorlaut_voice` (which voice made it, so a second machine can tell
  whether the recording still matches its settings) and `ext_vorlaut_bytes` (so
  the size estimate can answer without unpacking the zip).
- **Import ignores `sounds[]` entirely.** A missing recording is a build that
  has not run, not a document that is broken.

## The complete `ext_vorlaut_*` list

`ext_*` is the spec's own extension mechanism — a field it has no opinion
about, carried without breaking anything that does not know it. These are all
of them, and the list is meant to stay short: anything that fits an OBF field
belongs in the OBF field.

| field | on | what |
|---|---|---|
| `ext_vorlaut_sleep_timeout_seconds` | root board | seconds before the device sleeps |
| `ext_vorlaut_voice` | root board | `piper:…` / `azure:…` |
| `ext_vorlaut_color` | board | the set colour, `#RRGGBB` |
| `ext_vorlaut_active` | board | goes on the device |
| `ext_vorlaut_voice` | sound | which voice rendered this WAV |
| `ext_vorlaut_bytes` | sound | its size, for the flash estimate |

## Target profiles

The ESP32 is one target and the strictest by a distance: five boards, four
keys, everything rendered in advance, the whole lot inside the 1536 KiB
LittleFS partition (`FS_SIZE` in [`flashing.py`](../flashing.py)). A phone
companion app with the same designer in front of it has none of those limits,
a real text-to-speech engine, and boards the size of a screen.

Both are the same document. What differs is what is allowed to be in it, and
that is a `Profile` rather than a scattering of questions about which device we
are on:

| | `esp32` | `phone` |
|---|---|---|
| boards on the target | 5 | any |
| speech keys per board | 4 | any |
| grid | exactly 2×3 | any |
| links out per board | exactly 1 (a ring) | any |
| audio | pre-rendered files | run time |
| budget | `FS_SIZE` | none |

`validate(document, profile)` returns **all** the findings rather than the
first: somebody who has drawn eleven boards for a device that holds five wants
the count, not the earliest board over the line. Each finding is a message key
and its values — the same arrangement as `BuildError`, so a check reads in
German in the interface and in English on the command line.

`estimate_bytes()` is a **floor, not a promise**. It counts distinct symbols
(a tile depends on its symbol alone, so the same picture in two sets is one
file — [`tiles.py`](../tiles.py)'s rule, and using a different one here would
make the number wrong in the reassuring direction) plus whatever the sounds
declare. A document with no sounds contributes no audio, which is exactly why
it is a floor. `flashing.py` does the real check against files that exist.

## The board graph

Once boards link to boards it is a directed graph, and the interesting
questions stop being about any one board. None of these come up while there
are five sets in a ring; all of them come up on a phone, and the time to find
out whether the model can express them is before that exists.

| | |
|---|---|
| `links()` | board → the boards it reaches in one press |
| `reachable()` | everything you can get to from the root |
| `orphans()` | boards nothing links to — what deleting a set from the middle leaves |
| `broken_links()` | links to a board that is not there — what deleting one without fixing what pointed at it leaves |
| `subtree()` | a board and everything it can reach, as its own document, deep-copied |

`subtree()` keeps ids as they are. Renaming on copy is the caller's problem
and has to be, because whether a collision matters depends on where it is
going.

A `load_board` is resolved by `id`, then by `path` inside the zip, then by
`name` if exactly one board answers to it. Documents whose board ids are not
their file names are common enough that believing only the id would reject
half of what is out there.

## What survives a round trip, and what does not

`layout.json → .obz → layout.json` is exact. That is the test that matters and
it runs on a deliberately awkward layout — a switched-off set, a set with no
symbol, a key with a picture and no words, a key with words and no picture, a
METACOM reference beside a plain file name, umlauts, a set with fewer slots
than there are keys — and on `example/layout.json`, because a converter that
only ever meets its own test data has never met real content.

The other direction is lossy, knowingly, and only where `layout.json` has
nowhere to put something:

| in the document | becomes |
|---|---|
| a third row of keys | `BuildError` — dropping 56 keys silently is worse than stopping |
| `action` on a button | dropped; the ESP32 profile reports it |
| `hidden` | dropped; reported |
| an image carried as `data`/`url`/`path` with no `symbol` | no symbol, the placeholder tile, and a finding saying which image |
| a locale that is not `de` or `en` | `en`, the same fallback `normalize_layout()` already makes |
| a board with several links out | the first is the set key; the rest are unreachable and reported |
| anything else unknown | kept in the board dictionary and written back out |

That last row is why boards are held as the plain dictionaries they were
parsed from rather than as objects: a field this project has never heard of is
copied along instead of being dropped by a class that has no attribute for it.

## Using it

```bash
python3 obf.py export boards.obz              # references only
python3 obf.py export boards.obz --images --sounds
python3 obf.py check boards.obz               # against the esp32 profile
python3 obf.py check boards.obz --profile phone
python3 obf.py import boards.obz              # print what it would become
python3 obf.py import boards.obz --save       # write content/layout.json
```

`import` does not write unless asked. Reading somebody else's document to see
what it would become is the common case, and it should not cost the file you
already had.

## What is missing

Named rather than quietly left out.

**Symbol provenance.** The licence line per image is a document-level
declaration wearing a per-file costume. `content/symbols/` should record where
each file came from — pictogram id, or "uploaded" — at the moment it is
written, and then `symbol{set,filename}` could say `arasaac`/`2349` truthfully
and the licence would follow the file rather than the folder.

**Importing pixels.** A foreign board whose images are files in the zip could
have them unpacked into `content/symbols/` and referenced by name. Today they
come in as no symbol. This is a feature of the editor rather than of the
format, which is why it is not here.

**The phone profile has no consumer.** It is a set of limits and nothing
validates against a real app, so it will be wrong in small ways until one
exists. It is written down anyway because the alternative is a model shaped
entirely by the tightest target it will ever have, which is how a five-key
device ends up as an assumption in forty places.

**Nesting deeper than a ring.** The model carries an arbitrary graph and the
tools answer questions about one; the editor still draws a flat list of sets,
because that is what the device has.
