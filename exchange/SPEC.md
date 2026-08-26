# Lautstark Board Package — exchange format specification

**Version 1.2.0** · status: **draft, not ratified** · 2026-08-26

> No `exchange-v1.2.0` tag is cut, and none will be, until a real board has
> been built, exported, and opened on a tablet. Until then this document is a
> proposal with fixtures attached: pin a commit if you need to build against
> it, and expect it to move.

The format a Lautstark board builder writes and the Lautstark Android viewer
reads. It is a constrained profile of [Open Board Format][obf] 0.1 (`.obz`).

[obf]: https://www.openboardformat.org/

This document is meant to be sufficient on its own. Someone implementing an
importer in Kotlin should not need to read the OBF specification, the builder's
source, or any other file in this repository — except the fixtures in
[`fixtures/`](fixtures/), which are normative where they and this prose disagree.

---

## 1. Scope

**In scope.** Packages moving from a board builder to the Lautstark Android
viewer. The viewer is a pure viewer: it imports a package and renders it. It
does not edit, does not search for symbols, and makes no network requests.

**Out of scope.** The DIY ESP32 talker. It has its own board model, its own
binary layout format and its own transfer path, and nothing in this document
describes it. In particular:

- The talker's `.obz` export is a different profile of OBF with a different
  extension namespace (`ext_vorlaut_*`) and a symbols-by-reference invariant.
  It is not a Lautstark Board Package and this specification does not govern it.
  See [`adr/0001-two-ext-namespaces.md`](../adr/0001-two-ext-namespaces.md).
- `layout.bin`, the 4-slots-per-set board model, and the 16 kHz device audio
  are talker concerns. Where this document mentions them it is to explain a
  shared upstream, never to impose a requirement.

**Also out of scope in v1**, and named here so it is not merely undefined:

- **Spelling and keyboard buttons** (OBF `+text` actions). See §7.4.
- **Reference-only packages.** A package whose images live at a URL or in an
  external symbol set is not a Lautstark Board Package. See §5.
- **Editing and re-export.** The viewer never writes a `.obz`, so this format
  has no round-trip requirement and importers need not preserve what they ignore.

### 1.1 Requirement levels

MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are as in RFC 2119. "Importer" means
the consumer reading a package; "builder" means the producer writing one.

---

## 2. The container

A package is a ZIP archive with the extension `.obz` and the media type
`application/zip`.

```
manifest.json           required, exactly one, at the archive root
boards/<id>.obf         required, one or more
images/<name>.<ext>     optional
sounds/<name>.<ext>     optional
```

Requirements:

- Member names MUST use `/` as separator, MUST be relative, and MUST NOT contain
  `..` or begin with `/`. An importer MUST reject a package containing such a
  name **without extracting it** — this is the zip-slip path-traversal case, and
  on Android it writes outside the app's storage.
- Member names MUST be UTF-8 and the archive SHOULD set the general purpose
  flag bit 11 to say so. An importer MUST decode names as UTF-8 and MUST NOT
  fall back to CP437 or a platform default.
- Member names MUST be in Unicode **NFC**, and an importer SHOULD normalise to
  NFC before comparing. This matters more than it looks: macOS filesystems hand
  out NFD, so a builder that names a member from a file on disk can write
  `cafe\u0301.png` while the board document refers to `caf\u00e9.png`. The two
  strings are the same word, are not equal byte for byte, and the image goes
  missing on a lookup that never normalises.
- Entries MAY be stored or deflated. No other compression method is permitted.
- The archive MUST NOT be encrypted and MUST NOT use Zip64.
- An importer MUST read the central directory. It MUST NOT recover members by
  scanning for local file headers: a package whose directory is unreadable is
  rejected whole. Fixture `malformed-zip` covers exactly this.
- An importer SHOULD bound the total uncompressed size it will extract and the
  compression ratio it will accept, and reject packages that exceed the bound.
  A 600-byte archive can expand to gigabytes; the viewer runs on a phone.

### 2.1 Size

A package SHOULD stay under 50 MB. This is not a conformance limit — it is the
point past which a package stops travelling well over the ways people actually
hand these to each other, and where a builder should say so.

---

## 3. `manifest.json`

```json
{
  "format": "open-board-0.1",
  "root": "boards/start.obf",
  "paths": {
    "boards": { "start": "boards/start.obf" },
    "images": { "img-food": "images/food.png" },
    "sounds": { "snd-food": "sounds/food.opus" }
  },
  "ext_lautstark_spec_version": "1.2.0",
  "ext_lautstark_package_id": "1f0a5c2e-0000-4000-8000-000000000001",
  "ext_lautstark_package_name": "Home",
  "ext_lautstark_modified": "2026-08-24T09:00:00Z",
  "ext_lautstark_symbol_source": "arasaac",
  "ext_lautstark_redistributable": true,
  "ext_lautstark_tts_voice": "en_GB-alba-medium",
  "ext_lautstark_first_column_gap": true
}
```

| Field | Required | Rule |
|---|---|---|
| `format` | yes | MUST be exactly `"open-board-0.1"`. Any other value: reject the package. |
| `root` | yes | Archive path of the root board. MUST appear as a value in `paths.boards`. |
| `paths.boards` | yes | Board id → archive path. MUST be non-empty and MUST include `root`. |
| `paths.images` | if images exist | Image id → archive path. |
| `paths.sounds` | if sounds exist | Sound id → archive path. |

`paths` is the authority on where a member lives. Where a board's `images[].path`
and `paths.images` disagree, the importer MUST use `paths`, and SHOULD warn
(`path_conflict`).

---

## 4. Extension fields

OBF has no room for eight things this format needs. Each is prefixed
`ext_lautstark_`, which is the OBF-sanctioned way to add a field, and each is
listed below with the reason it cannot be expressed in plain OBF.

### 4.1 Manifest extensions

| Field | Type | Required | Why it exists |
|---|---|---|---|
| `ext_lautstark_spec_version` | string | yes | OBF's `format` pins the OBF version, not this profile's. Without it an importer cannot tell a v1 package from a v2 one that happens to still parse. Semantic version; see §12. |
| `ext_lautstark_package_id` | string | yes | **OBF identifies boards, never packages.** The viewer stores and replaces whole packages, so it needs a package identity. See §8. |
| `ext_lautstark_package_name` | string | yes | Likewise: OBF's `name` is per board. A package with three pages has three names and no name. This is what the viewer lists. Not an identifier — two packages may share it. |
| `ext_lautstark_modified` | string | yes | RFC 3339 UTC timestamp, e.g. `2026-08-24T09:00:00Z`. OBF has no modification time anywhere, so without it a re-import cannot be told from a downgrade. See §8. |
| `ext_lautstark_symbol_source` | string | yes | One of `arasaac`, `metacom`, `none`. OBF permits per-image symbol sets and so cannot state a package-wide invariant. See §5.1. |
| `ext_lautstark_redistributable` | boolean | yes | Whether the package may be passed on. OBF's per-image `license` block describes a licence but carries no instruction, and the METACOM case needs one. See §5.2. |
| `ext_lautstark_tts_voice` | string | no | Preferred voice for synthesised speech. OBF has no voice concept — it assumes recorded audio or the platform default. A hint only: the importer falls back to the platform default when the voice is unavailable, and MUST NOT fail. |
| `ext_lautstark_first_column_gap` | boolean | no, default `false` | When true the viewer draws extra space between the first column and the second, on every board. **OBF has no gutter of its own**, and the one implementation that comes closest — AsTeRICS Grid — has a single `elementMargin` applied uniformly, so a gap in one place cannot be asked for. What the gap says is that the leftmost column is always reachable: MetaTalk sets that column apart because its buttons stay put while the pages behind them change. The persistence itself needs no field — a builder repeats those buttons on every board — but a repeated column that looks like every other column reads as four boards that happen to start the same way. A hint, like the voice above: an importer that ignores it renders a correct board with the wrong emphasis, and MUST NOT fail. A value that is not a boolean MUST be treated as absent. |

### 4.2 Board extensions

| Field | Type | Required | Why it exists |
|---|---|---|---|
| `ext_lautstark_board_color` | string | no | `#RRGGBB`. A whole-page colour, which OBF has no field for — it colours buttons individually. Pages are told apart by colour before they are read, which matters for a user who does not read. |

### 4.3 Button extensions

| Field | Type | Required | Why it exists |
|---|---|---|---|
| `ext_lautstark_speak_immediately` | boolean | no, default `false` | When true the button speaks at once instead of appending to the message bar. **OBF cannot express this.** Its model is that a button either appends or performs an action, with no "speak this now and leave the bar alone". Interjections need it: `Ouch!`, `stop that`, a greeting. Composing those into a sentence first defeats their purpose. |
| `ext_lautstark_append_on_navigate` | boolean | no, default `false` | When true a navigating button appends its entry to the message bar before it navigates. **OBF cannot express this either.** `load_board` is the whole of a button's behaviour there rather than one of two things it does, and no OBF action appends a button's own text — `+text` is spelling, which §7.4 puts out of scope for v1. The carrier phrase needs it: a button reading `I want …` that opens the food board with the sentence already begun. See §7.3. |

That is the whole list. Eleven fields, eight of them in the manifest. Anything
else beginning `ext_lautstark_` is not part of v1 and MUST be ignored.

---

## 5. Images and symbols

**All images MUST be baked into the package as files.** An importer MUST NOT
resolve any image reference: not a `url`, not a `data_url`, not a
`symbol`/`filename` pair pointing into a symbol set. The viewer makes no network
requests and ships no symbol library.

Consequently:

- An image entry MUST carry `path`, and that path MUST resolve to a member of
  the archive.
- An image entry MUST NOT carry `url` or `data_url`. If one is present the
  importer MUST ignore it, use `path`, and warn (`image_reference_ignored`).
- An entry carrying `symbol` but no usable `path` is a **button-level fault**:
  the button renders without a picture and is marked degraded (§9).
- `data` (a base64 data URI in the image entry itself) is permitted but
  discouraged — it inflates the `.obf` and defeats deduplication. An importer
  MUST accept it. A builder SHOULD NOT write it.

### 5.1 One symbol source per package

`ext_lautstark_symbol_source` MUST be one of `arasaac`, `metacom` or `none`, and
every symbol in the package MUST come from that one source.

Mixing sources within a package is forbidden. Two collections drawn to different
conventions, sitting side by side on one board, are harder to read than either
alone — and in practice a mixed package has always meant a builder bug rather
than a deliberate choice. Making it unrepresentable is cheaper than detecting it.

An importer MUST NOT verify this — it has no symbol library to check against.
It records the value, shows it, and passes it on. Enforcement is the builder's.

### 5.2 METACOM and redistribution

METACOM is licensed per person. Baking METACOM pixels into a file that then
travels hands the collection over.

The builder's talker export refuses to write METACOM pixels at all. This format
takes one narrow step past that, and the scope of the step is the whole point:

> A METACOM licensee may bake their own METACOM symbols into a package **for
> the person they support**, and put it on that person's device by sideload.

That is a licensee preparing communication material for one named person, which
is what the licence is for. It is **not** a permission to publish, to share
boards with other families, to upload them anywhere, or to hand a package to
another licensee. Whether a given use is within the licence is between the
licensee and METACOM; this specification does not grant anything, and nothing
here is legal advice. What it does is make the narrow case expressible and the
broad case structurally hard.

Rules:

- A package with `ext_lautstark_symbol_source: "metacom"` MUST set
  `ext_lautstark_redistributable: false`.
- A package with `symbol_source: "metacom"` and `redistributable: true` is
  malformed. The importer MUST reject it (`licence_inconsistent`).
- The importer MUST store the flag with the package. It is not an import-time
  check that can be discarded once the package is in: the constraint has to
  outlive the import, because the feature that would violate it does not exist
  yet and will be written by someone who was not here for this decision.
- A non-redistributable package MUST NOT be offered for export, sharing,
  backup upload, or any other path that moves its bytes off the device. The
  viewer has no such path in v1; this rule is what makes adding one a decision
  rather than an accident.
- The viewer MUST show the package as non-redistributable where the person
  managing it can see it. A constraint nobody can see is one nobody can honour.

`arasaac` (CC BY-NC-SA 4.0) and `none` MAY set `redistributable: true`.

**On the builder side**, an app-package export that bakes pixels MUST be a
separate entry point from the talker export — a different function, not the
same one behind a flag. The talker's guarantee is that it never writes a symbol
as pixels, and a guarantee enforced by an argument is one flag away from being
untrue. Keep it structural.

This is a licensing decision rather than a technical one, and it was taken
deliberately. Do not relax it in an implementation, and do not widen the
sentence in the block quote above without asking the person who owns the
licence.

### 5.3 Format and size

| | Rule |
|---|---|
| Format, builder | MUST write PNG. |
| Format, importer | MUST accept PNG and JPEG. MAY accept WebP. MUST treat any other format as a button-level fault. |
| Colour | 8 bits per channel. PNG SHOULD be truecolour with alpha. |
| Maximum | **1024 × 1024 pixels.** |
| Recommended | 512 × 512, which is what ARASAAC ships and what a button needs. |

**Why 1024.** The constraint is decoded bitmap memory, not file size. Android
decodes to `ARGB_8888` at 4 bytes per pixel, so an image at the cap costs 4 MiB
in memory — and a board is a grid, so a page of thirty buttons at the cap would
be 120 MiB of bitmap. That exceeds the per-app heap on the mid-range devices
this viewer is for. At the recommended 512 the same page costs 30 MiB, which
fits. 1024 is set where it is because it is the largest a single button can
usefully be — a 3-column grid on a 10-inch tablet at xxhdpi gives a button of
roughly 960 px — so nothing legitimate is refused, while the pathological cases
are.

**Why PNG.** Symbols are line art on transparency. JPEG has no alpha channel and
its ringing artefacts land hardest on exactly this kind of image. JPEG is
accepted on import because photographs — a real cup, a real person — are a
normal thing to put on a board and compress badly as PNG.

Requirements on the importer:

- It MUST determine dimensions from the decoded image, **not** from
  `images[].width` and `height`. Those fields are declarations and OBF does not
  guarantee they are true. Fixture `oversized-image` includes an image that
  declares 512 and is 2048.
- It MUST make the size decision from the image header, before allocating a full
  bitmap. Decoding a deliberately huge image in order to discover it is too big
  is the crash the cap exists to prevent.
- An oversized image MUST be refused, **not downscaled**. Downscaling would make
  the cap advisory, and the memory it is protecting is spent at decode time —
  before any downscale can help.

---

## 6. Audio

| | Rule |
|---|---|
| Format, builder | MUST write Ogg Opus. |
| Format, importer | MUST accept Ogg Opus and 16 kHz mono 16-bit PCM WAV. |
| Channels | Mono. |
| Encoder input rate | 24 kHz. |
| Bitrate | 24–32 kbit/s VBR. |
| Maximum duration | **30 seconds** per clip. |
| Extension / type | `.opus`, `audio/ogg` · `.wav`, `audio/wav` |

**A note that will otherwise cost somebody an afternoon:** Opus always decodes
at 48 kHz. The 24 kHz above is the rate fed to the *encoder*; `OpusHead` records
it as an informational input-rate field, and every decoder still outputs 48 kHz.
A conformance check that asserts a 24 kHz decoded stream will fail on correct
files. Fixture `minimal` carries such a clip and `ffprobe` reports 48000 for it.

**Why Opus.** Royalty-free, which matters for an open-source project shipping an
AAC decoder it would have to think about. Decoded natively by Android since
API 21. At 24 kbit/s mono it is transparent for speech, where MP3 is not. A
1.5-second utterance is about 4.5 kB against 48 kB as 16 kHz WAV — roughly a
tenth, and a vocabulary is hundreds of utterances.

**Why 24 kHz in and mono.** Speech from a single synthesised or recorded voice
has nothing above ~10 kHz worth keeping, and 24 kHz is the Opus input rate that
covers it without the resampling that 22.05 kHz forces. Phone and tablet
speakers are mono; a stereo file doubles the size to be downmixed on playback.

**Why WAV is tolerated on import.** Hand-made packages and phone-recorded clips
will arrive, and a caregiver who recorded their own voice should not be told to
transcode. 16 kHz mono matches what the upstream synthesis pipeline already
produces for other consumers, so it is the one legacy shape worth accepting.

**Why a duration cap and not a byte cap.** A byte cap is a proxy for the thing
that actually matters and a bad one: it varies with bitrate, so the same
utterance passes or fails depending on how it was encoded, and it gives a
confusing message about a file whose problem is that it is thirty minutes long.
30 seconds is well past any utterance a button should hold. An importer that
cannot determine duration without decoding MAY accept the clip and check on
first playback.

### 6.1 Deriving audio

The upstream pipeline keeps one synthesised master per `text + voice`, at the
voice's native rate — 22.05 or 24 kHz depending on the voice. App packages are
encoded from that master to Ogg Opus. The talker's 16 kHz WAVs are downsampled
from the same master.

Recorded from the master, not from each other: transcoding an Opus file to WAV
or the reverse stacks two lossy stages for no reason. This paragraph is
background for builder authors; an importer needs none of it.

---

## 7. Boards and buttons

### 7.1 Board document

```json
{
  "format": "open-board-0.1",
  "id": "start",
  "locale": "en",
  "name": "Start",
  "buttons": [ ... ],
  "grid": { "rows": 2, "columns": 3, "order": [["b1","b2","b3"],["b4",null,null]] },
  "images": [ ... ],
  "sounds": [ ... ],
  "ext_lautstark_board_color": "#3B5BDB"
}
```

- `id` MUST be unique within the package. It is **not** unique across packages,
  and an importer MUST NOT key stored boards on it alone. Fixture `identity-b`
  covers this: two different packages both contain a board with id `nursery`.
- `locale` MUST be present. It selects the TTS voice when
  `ext_lautstark_tts_voice` is unavailable.
- `grid.order` is row-major. Each cell holds a button id or `null` for an empty
  cell. A button id appearing in `buttons[]` but not in `order` MUST NOT be
  rendered. An id in `order` with no matching button is a button-level fault:
  render the cell empty and warn (`button_missing`).
- `order` MUST have exactly `rows` rows and each row exactly `columns` cells.
  A mismatch is a **package-level** fault (`grid_malformed`) — the grid is the
  board's structure, and a viewer guessing at it would place buttons somewhere
  other than where the builder put them, which for a user navigating by position
  is worse than no board at all.

### 7.2 Button

```json
{
  "id": "b1",
  "label": "Apple",
  "vocalization": "an apple",
  "image_id": "img-apple",
  "sound_id": "snd-apple",
  "background_color": "rgb(255, 255, 255)",
  "border_color": "rgb(59, 91, 219)",
  "ext_lautstark_speak_immediately": false
}
```

- `label` is what the button shows. `vocalization` is what it speaks. When
  `vocalization` is absent the label is spoken.
- A button with neither `label` nor `vocalization` nor `image_id` renders as an
  empty cell.
- `hidden: true` means the button is not rendered. The cell stays empty.
- Colours are CSS `rgb(r, g, b)` or `#RRGGBB`. An unparseable colour falls back
  to the viewer default and warns (`color_unparseable`); it is not a fault.

### 7.3 The message bar

The viewer has a message bar and behaves like MetaTalk: buttons compose a
sentence which is then spoken.

The bar holds **entries**, not words. One button press contributes one entry,
whatever its length — a button whose vocalization is `an apple` puts a single
entry into the bar.

**An entry shows its vocalization**, falling back to the label when the button
has no vocalization. A button whose label is one word and whose vocalization is
a phrase therefore puts the *phrase* into the bar, so the bar reads as the
sentence it is about to say rather than as the row of keys that built it.
Fixture `message-bar` asserts this on its `w3` button; per §13 the fixture is
the authority, and earlier drafts of this paragraph had it backwards.

Activating a button:

| Condition | Behaviour |
|---|---|
| `load_board` present | Navigate. MUST NOT touch the bar — unless the button also carries `ext_lautstark_append_on_navigate`, below. |
| `action` or `actions` present | §7.4. |
| `ext_lautstark_speak_immediately: true` | Speak the button's own audio at once. MUST NOT touch the bar. |
| otherwise | Append one entry to the bar. This is the default and the common case. |

`load_board` takes precedence over an action if both are somehow present.

**Appending on the way through.** `ext_lautstark_append_on_navigate: true` on a
button that navigates — one carrying `load_board`, or `action: ":home"` — means:
append one entry exactly as the last row of the table does, **then** navigate.
Both from one press, and in that order. The entry MUST be in the bar by the time
the new board is drawn, because what the button is for is that the sentence has
already begun when the next word is chosen.

The flag is a modifier rather than a fifth row of the table. It does not decide
*which* navigation happens, and it changes nothing else: the entry shows what
§7.3 says an entry shows, one press is still one entry, and `:backspace` takes
that entry back whole like any other.

**On a button that does not navigate, the flag is ignored** — no warning, no
fault, and the button keeps behaving as its row of the table says. An appending
button already appends; a `speak_immediately` button carrying it meant something
the format has no way to say. A button disabled under §7.4 appends nothing
either, because doing nothing is what disabled means.

What it is for is the carrier phrase, which every grid system able to express it
builds the same way: `I want …` puts the opening of the sentence in the bar and
opens the board the next word is on. Without it that is two presses on two
boards, and the second of them has to be found after leaving the page that named
it.

### 7.4 Actions

An importer MUST implement exactly these:

| Action | Behaviour |
|---|---|
| `:clear` | Empty the bar. Speak nothing. |
| `:backspace` | Remove the **last entry**, not the last character. |
| `:speak` | Speak the whole bar. Leave it standing — `:speak` does not clear. |
| `:home` | Navigate to the board named by `manifest.root`. MUST NOT touch the bar — the one exception is `ext_lautstark_append_on_navigate` (§7.3), which appends before this action navigates. |

Navigation between boards is `load_board`, not an action:

```json
"load_board": { "id": "essen", "name": "Food", "path": "boards/food.obf" }
```

`path` MUST resolve within the archive. `load_board.url` and
`load_board.data_url` MUST be ignored — they are references, and the viewer
resolves nothing.

**Everything else is unimplemented**, including OBF's `+text` spelling actions,
`:space`, and any vendor action. On encountering one the importer MUST:

1. Render the button **visibly disabled**, and
2. record a warning (`action_unsupported`).

It MUST NOT silently do nothing. A button that looks live and ignores the person
pressing it teaches them the device ignores them — the one failure mode a
communication aid cannot afford. A visibly dead button is at least honest.

If `actions` (an array) contains any unimplemented action, the **whole button**
is disabled. An importer MUST NOT run the prefix it understands: the sequence
was authored as one thing, and half-running it is a wrong outcome rather than a
partial one. Fixture `unknown-action`, button `u3`, is exactly this case.

Spelling is out of scope for v1 rather than undefined. A future version adding it
will bump the minor version and older importers will keep disabling those
buttons, which is the correct behaviour for a viewer that cannot spell.

---

## 8. Package identity and re-import

`ext_lautstark_package_id` MUST be a string that is stable for the life of a
package, unique across packages, and opaque to the importer. A UUID is
recommended.

Rules the **builder** MUST follow:

- Generate the id **once**, when the package is first created.
- Never change it: not on rename, not on edit, not on re-export.
- **Duplicating a package MUST mint a fresh id.** This is the rule that gets
  forgotten, and forgetting it is destructive: a duplicated-then-edited package
  that kept its id will silently overwrite the original on the viewer, taking
  with it a vocabulary somebody depends on.

Rules the **importer** MUST follow, on importing a package with id *P* and
timestamp *T*:

| Stored state | Behaviour |
|---|---|
| no package with id *P* | Install as new. Two packages may share a name; that is not a conflict. |
| package *P* stored, its timestamp < *T* | **Replace** it. |
| package *P* stored, its timestamp ≥ *T* | MUST NOT silently replace. Skip, or ask. Never treat an older package as an update. |

Replacement is wholesale, not a merge: content the new package does not contain
MUST be gone afterwards. A merge leaves behind buttons the builder deleted, and
a deleted button is usually deleted for a reason.

Replacement MUST be atomic — a failure partway MUST leave the previously stored
package intact. The device must never end an import with no working vocabulary.

Fixtures `identity-a`, `identity-b` and `identity-a-v2` cover all three rows.

---

## 9. Faults, warnings and degradation

The importer is **strict about packages and lenient about buttons**.

### 9.1 Package-level faults — reject the whole package

Nothing is imported, and anything already stored is left untouched.

| Code | Condition |
|---|---|
| `package_unreadable` | Not a zip; unreadable central directory; encrypted; Zip64. |
| `path_unsafe` | A member name that is absolute or escapes the archive root. |
| `manifest_missing` | No `manifest.json` at the archive root. |
| `manifest_invalid` | Unparseable, or a required field of §3 or §4.1 missing. |
| `format_unsupported` | `format` is not `open-board-0.1`. |
| `spec_version_unsupported` | Major version above what the importer implements (§12). |
| `root_missing` | `root` names a board not in `paths.boards`, or absent from the archive. |
| `board_invalid` | A board document is unparseable. |
| `grid_malformed` | `order` does not match `rows`×`columns` (§7.1). |
| `licence_inconsistent` | `symbol_source: "metacom"` with `redistributable: true`. |

A rejection MUST be reported to the person importing, naming the package and the
reason. It does not go to the persistent warning list — nothing was imported, so
there is nothing for a warning to hang on.

### 9.2 Button-level faults — degrade, keep going

The package imports. The affected button still renders, with whatever survives,
and is **visibly marked as degraded**.

| Code | Condition | What survives |
|---|---|---|
| `image_missing` | `image_id` resolves to nothing | Label, colour, action |
| `image_oversized` | Decoded image over 1024×1024 | Label, colour, action |
| `image_undecodable` | Unsupported or corrupt image data | Label, colour, action |
| `sound_missing` | `sound_id` resolves to nothing | Everything; speech falls back to TTS |
| `sound_undecodable` | Unsupported or corrupt audio | Everything; speech falls back to TTS |
| `sound_too_long` | Over 30 seconds | Everything; speech falls back to TTS |
| `action_unsupported` | An action outside §7.4 | Label, colour, image; button is disabled |
| `button_missing` | `order` names a button that does not exist | Nothing; cell is empty |

The marking MUST be visible in the UI, not merely logged. The person importing a
package is usually not the person who later notices a button has gone quiet, and
a caregiver needs to see at a glance which buttons are incomplete.

**A button with no audio at all is not degraded.** A board built without recorded
audio is a normal board, and TTS is its designed path rather than a fallback from
failure. Only a button whose audio was *promised and missing* is marked. An
importer that marks every TTS button degraded puts a fault marker on every button
of every TTS-only board and thereby makes the marker useless. Fixture
`missing-audio` separates the two cases and is the one that catches this.

### 9.3 The warning list

Warnings MUST be **persisted with the imported package** and reachable later —
from settings, or wherever the package is managed. A toast at import time is not
sufficient, for the same reason as above: the person importing is often not the
person who finds out something is missing, and by then the toast is long gone.

Each warning MUST carry its code, the board and button it concerns, and enough
detail to act on. Unknown fields MUST NOT produce warnings (§10.3).

---

### 9.4 Warnings that do not degrade

Not every warning marks a button. These record a defect worth fixing upstream
where nothing the user sees is actually wrong, so the button stays `normal`:

| Code | Condition |
|---|---|
| `path_normalization` | An archive member name is not NFC (§2). The importer normalised and found the file. |
| `path_conflict` | `paths` and a board's `images[].path` disagree; `paths` won (§3). |
| `image_reference_ignored` | An image entry carried `url` or `data_url` alongside a usable `path` (§5). |
| `color_unparseable` | A colour did not parse; the viewer default was used (§7.2). |

These MAY be package-scoped rather than button-scoped — `board` and `button`
are then null. `path_normalization` is the case that is: it is a property of
the archive, not of any one button.

They go in the same persisted list as §9.2's, because the person who can fix
them is the person who built the package, and they will not see a warning that
was only ever a toast on somebody else's tablet.

### 9.5 The order warnings come in

The warning list is **ordered, and the order is part of the format.** Two
importers reading the same package MUST produce the same sequence, and the same
importer MUST produce it again on re-import.

1. **Package-scoped warnings first** — those with `board` null (§9.4).
2. **Then board by board:** the root board first, then every other board id in
   code point order. Root first because it is the page the user actually opens;
   code point rather than `paths.boards` order because JSON object key order is
   not something an importer should have to rely on.
3. **Within a board:** board-scoped warnings (`button` null) first, then
   warnings per button in **`grid.order` row-major order** — reading order, not
   the order buttons happen to appear in `buttons[]`.
4. **Ties** — several warnings on one button — in code point order of `code`.

This is not fussiness. The list is caregiver-facing and it is how somebody finds
out which buttons on a child's device are incomplete. If it reshuffles between
imports, a person comparing it against what they saw last week cannot tell a new
fault from a moved line, and the list stops being read. A stable order costs an
importer one sort.

Fixture `warning-order` pins it, and is built so that the obvious wrong answers
disagree: its board ids do not sort into root-first order, and its grid places
buttons in an order that is not their id order.

## 10. OBF fields

### 10.1 Used

**Manifest:** `format`, `root`, `paths.boards`, `paths.images`, `paths.sounds`

**Board:** `format`, `id`, `locale`, `name`, `buttons`, `grid.rows`,
`grid.columns`, `grid.order`, `images`, `sounds`

**Button:** `id`, `label`, `vocalization`, `image_id`, `sound_id`, `action`,
`actions`, `load_board.id`, `load_board.path`, `background_color`,
`border_color`, `hidden`

**Image:** `id`, `path`, `data`, `content_type`

**Sound:** `id`, `path`, `data`, `content_type`, `duration`

### 10.2 Present in OBF, ignored on import

Ignored means: parsed past without error, no warning, no effect.

| Field | Why |
|---|---|
| `description_html` | The viewer renders no HTML. |
| `license` (board, image, sound) | Recorded upstream; §5.2 is what the viewer acts on. |
| `url`, `data_url` (board) | References. The viewer resolves nothing. |
| `image.url`, `image.data_url` | Same — but these *do* warn (`image_reference_ignored`, §5), because the button will be missing a picture. |
| `image.symbol` | The symbol library is not shipped. |
| `image.width`, `image.height` | Declarations, not measurements. §5.3. |
| `sound.url`, `sound.data_url` | References. |
| `button.top`, `left`, `width`, `height` | Absolute positioning. The viewer lays out on `grid` only. |
| `button.border_width`, `button.text_color` | Not in the v1 rendering model. |
| `grid.order` cells beyond `rows`×`columns` | Unreachable — but see `grid_malformed` (§7.1), which fires first. |
| `default_layout` | Not in the v1 rendering model. |
| `ext_vorlaut_*` | The talker's namespace. Treated as any other vendor's — see below and `adr/0001`. |

### 10.3 Unknown fields

An importer **MUST ignore any field it does not recognise, and MUST NOT fail**.
This applies to unknown plain OBF fields, unknown `ext_lautstark_*` fields, and
any other vendor's `ext_*` fields.

Unknown fields MUST NOT produce warnings. An unknown field is the format working
as designed; warning about it would fill the caregiver-facing warning list with
noise and train people to ignore it.

The viewer never re-exports, so there is **no requirement to preserve** unknown
fields. An importer MAY discard them entirely.

**`ext_vorlaut_*` gets no special handling.** It is the talker's namespace and an
app importer must treat it exactly as it treats any other vendor's extension —
ignore it. In particular `ext_vorlaut_color` MUST NOT be read as a colour, even
though it looks like one and holds a plausible value. The two namespaces are
deliberately not unified; see [`adr/0001`](../adr/0001-two-ext-namespaces.md).

**The one exception is actions.** An unrecognised *action* is not an unknown
field: it disables its button and warns (§7.4). The difference is that ignoring
an unknown field loses nothing a user would notice, whereas ignoring an unknown
action leaves a button that looks alive and is not.

---

## 11. Import, end to end

Normative order. Steps 1–7 may reject; from step 8 on, faults are button-level.

1. Open the archive. Read the **central directory**.
2. Check every member name for traversal and absoluteness. → `path_unsafe`
3. Check compression method, encryption, Zip64, and the extraction bound.
4. Read and parse `manifest.json`. → `manifest_missing`, `manifest_invalid`
5. Check `format`, then `ext_lautstark_spec_version` (§12).
6. Check the §4.1 required fields and the §5.2 licence consistency.
7. Parse every board in `paths.boards`; check `root` resolves; check each grid.
8. Resolve identity (§8) and decide install / replace / skip.
9. For each board: resolve images and sounds, apply §5.3 and §6 constraints,
   classify actions, collect warnings.
10. Commit atomically. Persist the warning list with the package.

---

## 12. Versioning

`ext_lautstark_spec_version` is `MAJOR.MINOR.PATCH`.

- **MAJOR** changes when a package valid under the old version would be
  misread under the new one. An importer MUST reject a package whose major
  version exceeds the one it implements (`spec_version_unsupported`).
- **MINOR** adds fields or actions. An importer MUST accept a higher minor
  version and fall back on §10.3 for what it does not know — which is why
  unknown fields are ignored silently and unknown actions disable their button.
- **PATCH** is wording only. No behavioural change.

A builder MUST write the version it targets, not the version it happens to fit.

---

## 13. Conformance

An importer is conformant at v1.2.0 when it produces, for **every** fixture
listed in [`fixtures/index.json`](fixtures/index.json), the outcome in the
matching `.expected.json`. That index is the authoritative list; no count
appears in this document, because a number restated in prose drifts from the
directory it describes and has twice already. See [`README.md`](README.md) for
how to pin and run them.

Where this prose and a fixture disagree, **the fixture is normative** and the
disagreement is a bug in this document. Report it.

---

## 14. Changelog

### 1.2.0 — 2026-08-26

Adds `ext_lautstark_append_on_navigate` (§4.3, §7.3): a navigating button may
append its entry to the message bar before it navigates. Minor, per §12 — an
importer written against 1.1.0 ignores the field under §10.3 and navigates
without writing, which is the behaviour every earlier version of this document
required and is a sentence the user can still finish by hand.

**Why the rule it relaxes was wrong.** 1.0.0 said navigation MUST NOT touch the
bar, and read as a whole-button rule that came from OBF, where `load_board` is
everything a button does. It is not how boards are actually built. The carrier
phrase — `I want …`, `can I have …`, `I am …` — is the first thing a grid
teaches, and the systems that can express it do so as an ordered pair of things
on one cell: write, then jump. A format that cannot say it makes every sentence
starter into two presses, the second of them on the far side of a navigation.

**A flag rather than an action list**, which was the other shape considered.
OBF's `actions` array could hold `[":append", ":home"]` and nothing else would
be needed — except that §7.4 makes an unimplemented action disable its whole
button, so a 1.1.0 importer meeting `:append` would render a *dead* sentence
starter rather than a plain navigation. The flag degrades the other way, which
is the direction a communication aid has to fail in. There is also no `:append`
in OBF to reach for: `+text` spells a character, and spelling is out of scope.

**It rides on `:home` too**, which is the one place this document adds behaviour
to an action rather than to `load_board`. Both are navigation and a builder has
no way to tell a user why one of them may carry a sentence and the other may
not — a `please` button that adds the word and returns to the core board is an
ordinary board convention, not an edge case.

**What it is not.** It is not a general "do two things" mechanism, and no field
here composes actions. It says one thing: append before navigating. A button
that needs a third behaviour is a button this format cannot describe, and that
stays true on purpose.

### 1.1.0 — 2026-08-25

Adds `ext_lautstark_first_column_gap` (§4.1), a package-wide layout hint: draw
extra space after the first column. Minor, per §12 — an importer written against
1.0.0 ignores the field under §10.3 and renders the board without the gap, which
is the right thing for a viewer that does not know what the space would mean.

**A boolean rather than a column count**, which was the other shape considered.
The count is the more general field and generality is what makes it wrong here:
the thing being expressed is the MetaTalk convention of one always-reachable
column, so `2` and `3` would be values no builder writes and every importer has
to decide something about — including the reading where the number is a column
index rather than a count, which is the same field meaning two things. §5.1 made
the same trade for symbol sources: a shape that cannot express the case nobody
wants is cheaper than prose forbidding it. If a second separated column ever has
a reason, it arrives as its own field and its own minor bump.

**What the field is not.** It does not make a column persistent, and no field
does. A button that stays reachable across pages is a button the builder wrote
onto every board, which plain OBF expresses already; this hint is only the gap
that tells a reader those buttons are the ones that stay.

### 1.0.0 — 2026-08-24

Initial draft. Not yet ratified; no package has been produced by a builder or
read by a viewer against it, and no release tag exists.
