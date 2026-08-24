# Lautstark Board Package — spec and conformance fixtures

The exchange format between a Lautstark board builder and the Lautstark Android
viewer, plus the fixtures an importer is checked against.

| | |
|---|---|
| [`SPEC.md`](SPEC.md) | The specification. Version 1.0.0, **draft**. |
| [`fixtures/`](fixtures/) | 13 `.obz` packages, each with an `.expected.json`. |
| [`fixtures/index.json`](fixtures/index.json) | Machine-readable list of them. |
| [`fixtures/source/`](fixtures/source/) | German fixture content, kept out of the generator. |
| [`assets/`](assets/) | The images and audio the packages embed, committed. |
| [`../adr/`](../adr/) | Decisions that will otherwise be "tidied up" later. They live at the top of the repository, not here: several of them decide things wider than this format. |
| [`tools/make_fixtures.mjs`](tools/make_fixtures.mjs) | Regenerates `fixtures/`. Pure node. |
| [`tools/make_assets.mjs`](tools/make_assets.mjs) | Re-renders `assets/`. Needs ffmpeg. |

**Where the prose and a fixture disagree, the fixture wins** and the prose has a
bug. This is stated in SPEC.md §13 and repeated here because it decides what a
consumer repo should treat as authoritative.

---

## Pinning this from a consumer repo

Fixtures are released as git tags, matching the convention used for the other
Lautstark packages: **a release is a tag**, and consumers pin the tag rather
than a branch.

Tags are named `exchange-vMAJOR.MINOR.PATCH` and track `SPEC.md`'s version.

> **No tag exists yet.** The spec is a draft and stays one until a real board
> round-trips to a tablet, so `exchange-v1.0.0` is not cut. Pin a **commit
> SHA** in the meantime, and expect the fixtures to move under you.

### As a submodule

```bash
git submodule add https://github.com/Lautstark/vorlaut-diy-talker.git third_party/vorlaut
```

```bash
git -C third_party/vorlaut checkout exchange-v1.0.0
```

Only `exchange/` is of interest; the rest of the repository comes along and can
be ignored. Commit the submodule pointer, and treat moving it as a deliberate
change with a test run attached — never as a routine bump.

### As a downloaded archive

If a submodule is unwelcome, fetch the tag and verify what arrived:

```bash
curl -sSL https://github.com/Lautstark/vorlaut-diy-talker/archive/refs/tags/exchange-v1.0.0.tar.gz -o exchange.tar.gz
```

```bash
shasum -a 256 exchange.tar.gz
```

Record the digest in the consumer repo and check it on every fetch. An unpinned
download of a moving target is not a pin.

**Do not copy the fixtures into the consumer repo.** A copy stops tracking the
spec the moment either side changes, and a stale fixture passes forever — the
failure this whole directory exists to avoid.

---

## Running them

There is no test runner here, and deliberately so: the fixtures are data, and a
runner living beside them would only ever be exercised by a mock importer. The
consumer repo writes the runner in its own language, against its real importer.

The contract:

1. Read `fixtures/index.json` for the list.
2. For each fixture, feed `<name>.obz` to the importer **as bytes** — not
   unzipped first, since `malformed-zip` tests the unzipping.
3. Compare the result against `<name>.expected.json`.
4. Import order matters for one group only: `identity-a`, then `identity-b`,
   then `identity-a-v2`, into shared storage. Everything else is independent and
   SHOULD start from empty storage.

A conformant importer produces the stated outcome for all 13.

### What `.expected.json` says

```jsonc
{
  "fixture": "minimal",
  "file": "minimal.obz",
  "spec_version": "1.0.0",
  "summary": "…",

  "outcome": "accepted",        // or "rejected"
  "rejection": { "code": "…", "detail": "…" },   // rejected only

  "package": { "id": "…", "name": "…", "modified": "…",
               "symbol_source": "…", "redistributable": true,
               "tts_voice": "…", "root_board": "…" },
  "boards":  [ { "id": "…", "name": "…", "rows": 1, "columns": 1, "color": "…" } ],
  "buttons": [ { "board": "…", "id": "…", "label": "…", "vocalization": "…",
                 "on_activate": "…", "image": "…", "audio": "…",
                 "state": "…", "reason": "…" } ],
  "warnings": [ { "code": "…", "board": "…", "button": "…", "detail": "…" } ],

  "notes": [ "…" ]
}
```

`on_activate` is one of `append`, `speak_immediately`, `speak_bar`, `clear`,
`backspace`, `home`, `navigate:<board id>`, `disabled`.

`state` is `normal`, `degraded` or `disabled`.

`audio` is an archive path, or `"tts"` when the button falls back to synthesis,
or absent when the button makes no sound.

Four fields appear only where they apply:

| Field | In | Meaning |
|---|---|---|
| `scenario` | `message-bar` | An ordered walk through button presses with the bar contents after each. |
| `ignored` | `unknown-ext` | Fields that must be parsed past with no effect and no warning. |
| `after_importing` | `identity-*` | Which packages must be on the device after a stated import sequence. |
| `reimport` | `identity-a-v2` | Which stored package this matches and how it must resolve. |

`notes` is prose for a human reading a failure. Some of it explains why a
plausible-looking implementation fails the fixture — worth reading before
arguing with a red test.

### Matching

Compare `outcome`, `rejection.code`, `package`, `boards` and `buttons`. Do not
compare `warning.detail`, `reason` or `notes` textually; they are for humans and
their wording will drift.

**Compare `warnings` as an ordered list**, by `(code, board, button)` — not as a
set. The sequence is specified in SPEC.md §9.5 and `warning-order` exists to
pin it: this list is caregiver-facing, and one that reshuffles between imports
cannot be compared against what somebody saw last week. An earlier draft of this
README said to compare them as a set, which let exactly that through.

Order within `boards` and `buttons` is not significant. `scenario` and
`warnings` order is.

---

### Inspecting a fixture by hand

`multipage.obz` and `nfd-normalization.obz` contain a member named
`images/café.png` — in NFC and NFD respectively. The `unzip` shipped
with macOS is Info-ZIP, whose UTF-8 support predates the flag it is being told
to read; it mangles that name to `caf+?.png` and reports a truncated file. The
archive is correct — bit 11 is set and the name is UTF-8 NFC. Use a reader that
handles it:

```bash
python3 -c "import zipfile;z=zipfile.ZipFile('exchange/fixtures/multipage.obz');print('\n'.join(z.namelist()))"
```

Java's `ZipFile` and Android's are UTF-8 by default and need no special handling.

## Regenerating

```bash
node exchange/tools/make_fixtures.mjs
```

Needs nothing but node — no ffmpeg, no npm install. **It is byte-reproducible:**
running it on any machine produces exactly the files that are committed, and
[`tests/test_exchange_fixtures.py`](../tests/test_exchange_fixtures.py) holds it
to that in CI by regenerating into a temporary copy and comparing. If that check
is red, either a fixture changed and was not committed, or the generator stopped
being reproducible.

Two tricks buy that, and both look odd until you know why:

- **Nothing is really compressed.** The deflate streams in the zip are made of
  *stored blocks*, because zlib's output depends on the zlib build rather than
  on the input. Stored blocks are valid method-8 data, so an importer's inflate
  path is still exercised; `manifest.json` is stored outright, so both methods
  appear in every package.
- **Images and audio are not generated.** PNG's IDAT goes through zlib and Opus
  through libopus, so neither is reproducible from a script. They are rendered
  once into [`assets/`](assets/) and committed, and the generator only reads
  them. This is also what keeps the packages small — compressing once at asset
  time rather than storing raw pixels.

To change a picture or a clip:

```bash
node exchange/tools/make_assets.mjs
```

That one needs `ffmpeg` with `libopus` (last rendered with 9.0.1) and its output
*will* differ between ffmpeg builds. Re-run it only on purpose, then re-run the
fixture generator and commit both.

Two properties worth preserving:

The generator writes each `.obz` and its `.expected.json` from **one literal**.
Splitting them would let an expectation drift from the package it describes, and
a drifted expectation passes whatever the importer does.

The generator never reads a `.obz` back. It has no parser and must not grow one:
a generator that checked its own output would be comparing a thing against
itself, which is the failure mode
[`docs/frozen-references.md`](../docs/frozen-references.md) exists to record.

### German fixture content

`message-bar` is a German board — umlauts in three labels, an eszett in a
fourth — because that is what real boards look like and an importer that mangles
UTF-8 has to fail on the text that ships, not pass on an ASCII stand-in.

The strings live in [`fixtures/source/labels.de.json`](fixtures/source/labels.de.json)
and the generator refers to them by key, so `make_fixtures.mjs` itself stays
English like the rest of the code. `exchange/fixtures/` is exempt from the
repository's code-language check for this reason; the generator is not.

---

## What the fixtures cover

| Fixture | Outcome | Covers |
|---|---|---|
| `minimal` | accepted | One board, one button, baked image and Opus |
| `multipage` | accepted | `load_board` navigation, `:home`, a shared image, a non-ASCII member |
| `nfd-normalization` | accepted | An NFD member name against an NFC reference |
| `warning-order` | accepted | The one warning sequence SPEC.md §9.5 allows |
| `message-bar` | accepted | Append, `:speak`, `:clear`, `:backspace`, speak-immediately |
| `unknown-action` | accepted | Unimplemented actions disable their button, visibly |
| `missing-audio` | accepted | TTS as design vs TTS as fallback; tolerated WAV |
| `unknown-ext` | accepted | Unknown extensions ignored, `ext_vorlaut_*` included |
| `malformed-zip` | **rejected** | Broken central directory; no salvaging |
| `oversized-image` | accepted | 1024 cap, and a lying `width`/`height` |
| `identity-a` | accepted | Baseline for the identity group |
| `identity-b` | accepted | Same name, different id — must not overwrite |
| `identity-a-v2` | accepted | Same id, newer timestamp — must replace |

## What they do not cover

Said plainly, in the spirit of
[`docs/frozen-references.md`](../docs/frozen-references.md), because a fixture
set that overstates itself is worse than a small one.

1. **No importer has ever run these.** Every expectation is an assertion about
   what an importer should do, written before any importer existed. They are a
   specification in executable form, not a result. The first real run will find
   mistakes in them, and those are bugs in this directory.
2. **No builder has ever written one of these packages.** They were generated,
   field by field, from SPEC.md. Whether a real builder emits this shape is
   untested in both directions.
3. **No other OBF software has opened them.** These are a *profile* of OBF, and
   whether a package is also readable by other AAC software is a claim, not a
   result — the same gap `docs/frozen-references.md` records for the talker's
   export. It needs no code: open one in something else that reads OBF.
4. **The audio is synthetic.** Sine tones. They exercise the container, the
   codec and the fallback rules, and say nothing about whether speech sounds
   right. `piper` is not installed here and is not deterministic anyway.
5. **Rendering is not covered.** Grid geometry, colour, and what a degraded
   button looks like are asserted as data and cannot be checked from a fixture.
   Whether the degraded marking is actually visible to a caregiver is a question
   only a person looking at a screen can answer.
6. **No performance or memory bound is tested.** `oversized-image` asserts the
   cap is enforced, not that an importer stays inside the heap it protects.
   `oversized-image` also cannot tell a header-first importer from one that
   decodes fully and then measures — both produce the same expected output, and
   only one of them survives a hostile package.
7. **Concurrency is untested.** Nothing here exercises a second import starting
   while one is in flight, and SPEC.md §8's atomicity requirement is not
   observable from these files.
