# The split, rehearsed once on a copy

[`split-crossings.md`](split-crossings.md) costs the boundary by reading the
code. This page is the other half of that: the move was **carried out**, on a
throwaway clone, to find what reading does not.

Nothing was published and nothing was renamed. The rehearsal ran in a scratch
directory against a clone of this repository at `e411935`, and the clone was
discarded. This repository was not touched, which is the same property that
makes the real move safe —
[`repository-map.md`](repository-map.md#what-the-move-costs) has the argument.

---

## What it proves, and what it does not

**Proves:** that `git filter-repo` produces a usable editor history, and what
breaks when `src/` stands alone — by observation rather than by grep.

**Does not prove:** that the editor builds. It cannot yet, and that is expected:
the bill in [`split-crossings.md`](split-crossings.md) is not paid. The value
here is the *list*, not a green suite.

---

## 1. The history rewrite is cheap, and blame survives

805 commits in, 496 out, in 0.25 seconds. The editor's history is real history:
`git blame` on a line of `src/` reaches the commit that wrote it, with its
message intact, which is the whole reason
[`repository-map.md`](repository-map.md#what-the-move-costs) argues for a
rewritten copy over an empty repository.

The commits that drop out are the ones that touched no editor path. That is
correct and worth stating, because it is also the bill ADR 0006 predicted: a
path-filtered commit keeps its whole message while keeping half its diff, and a
merge whose diff falls entirely outside the path set disappears.

## 2. Nineteen import sites break, in six targets

Thirteen files, all reaching into `loader/`:

| Target | Sites |
|---|---|
| `loader/src/tiles.js` | 7 |
| `loader/src/layout_format.js` | 6 |
| `loader/tools/cable.js` | 2 |
| `loader/src/cable.js` | 2 |
| `loader/src/folder.js` | 1 |
| `loader/src/compile.js` | 1 |

Six of those sites are in `src/` and are the ones
[`layers.test.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/tests/unit/layers.test.ts) already pins. **The rest are
tests**, which that file does not watch — it guards `src/` only, and says so.

## 3. Eight of thirty-two unit tests cross — the count checks out

`build_export`, `cable_version`, `device_fixtures`, `device_roundtrip`,
`empty_slot`, `layers`, `negation`, `reachable`.
[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) says eight, and
eight is what a rehearsal finds. That number was asserted; now it is measured.

## 4. `e2e/` divides file by file too, and nothing said so

[ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md) records that
`tests/unit/` divides file by file rather than as a directory. The same is true
of `e2e/` and it is not written down anywhere: `e2e/loader.spec.ts` tests the
loader page and reaches for `device/fixtures/layout/sets` and
`loader/tools/cable_mock.js`, and `e2e/device_export.spec.ts` imports
`loader/src/layout_format.js`.

`loader.spec.ts` is the talker's outright. The rule ADR 0012 draws for
`tests/unit/` extends here unchanged; only the sentence was missing.

## 5. The Python division as written is wrong

[`repository-map.md`](repository-map.md#what-the-move-costs) said the editor
*keeps* `test_links.py` and `test_language.py` and that this is all the Python
it needs. Half of that holds. The correction is in that paragraph now, and the
finding is this:

- **`test_language.py` is needed by both halves.** It does not read the
  firmware — it **allowlists** `firmware/vorlaut/texts.h` as a file permitted to
  hold German. After the split that entry is dead in the editor, and the talker
  keeping `firmware/` with no copy of the check would lose the German-word rule
  over exactly the files the rule was written for.
- **`test_links.py` is needed by both, and more by the talker.** It checks prose
  links and paths written out in comments — 187 of them at the last run. `adr/`
  and `docs/` go with the talker, so the bulk of what it checks does.
- **`test_texts.py` is the talker's, not the editor's.** It reads
  `device/fixtures/language.expected.json` and `loader/src/layout_format.ts`.

Two copies of a check are not two implementations of a format, so nothing here
asks for a fixture set — but they are two copies, and
[`packages.md`](packages.md) is the family's standing answer to that when it
matters. It does not matter yet at two.

## 6. Build configuration names the other half

`vite.config.ts` names `loader/index.html` as its second entry point, and
`tsconfig.app.json` names `loader/src/cable.ts` and `loader/tools/cable.js`.
Both are expected — the second entry point is
[ADR 0011](../adr/0011-editor-exports-the-talker-repository-sends.md)'s doing —
and both are listed here because they are edits to make rather than to discover.
They are separate from the three places
[`repository-map.md`](repository-map.md#what-the-move-costs) already names for
the base path.

## 7. The editor already reaches for `device/fixtures/`

`src/data/audio_format.ts`, `src/data/obf.ts` and `src/data/device_package.ts`
all cite it. That is
[`split-crossings.md`](split-crossings.md)'s Direction one arriving early: the
editor becomes a pinned consumer of a directory that belongs to neither half,
and [ADR 0012](../adr/0012-the-repository-splits-editor-leaves.md)'s Why is what
makes that consumption rather than ownership.

---

## 8. Rehearsed a second time, with the bill paid

Run again at `f28a245`, once
[ADR 0013](../adr/0013-the-device-preview-moves-to-the-loader-page.md) had moved
the preview and [ADR 0014](../adr/0014-device-fixtures-cover-the-package-too.md)
had fixtured the package. This time the crossings were **answered rather than
counted**: the seven constants and `thumbnailSize` were extracted into editor-local
modules, the five imports rewired, and `loader/`, `firmware/`, `device/` and
`case/` deleted.

**`src/` → `loader/` went to zero.** Every crossing resolved the way
[`split-crossings.md`](split-crossings.md) said it would, which is the result
that matters: the bill was costed by reading and it holds up under doing.

### `thumbnailSize()` does not travel alone

One thing only the doing found:

```
src/device/thumbnail.ts: error TS2304: Cannot find name 'TILE_SIZE'
```

`thumbnailSize(width, height, max = TILE_SIZE)` takes `TILE_SIZE` as a **default
argument**. It is the one name [`layers.test.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/tests/unit/layers.test.ts)
still allows out of `tiles.ts`, and copying it verbatim does not compile.

Nothing is wrong with the allowed list. The dependency is *inside* the module
rather than an import, and a rule that reads import statements cannot see it —
the same blind spot that file already documents about element ids, in its own
words: *"an element id is a dependency the module graph cannot see."* This is
the arithmetic version of it.

**The fix is one line and it has to be deliberate.**
[`src/data/app_assets.ts`](https://github.com/Lautstark/vorlaut-editor/blob/main/src/data/app_assets.ts) always passes `IMAGE_SIZE`
explicitly, so the default never fires in the editor and the copy can simply drop
it. What must not happen is `TILE_SIZE` being duplicated to satisfy a compiler:
that is the second copy of the device's tile geometry that
[ADR 0013](../adr/0013-the-device-preview-moves-to-the-loader-page.md) was
written to prevent, arriving through the back door with a plausible reason.

**What this run does not prove.** The editor's *suite* was not made to pass. The
`tsconfig` was edited crudely to drop `loader/`, which pulled test files into the
app build and produced errors that are artefacts of the rehearsal rather than
findings. The typecheck of `src/` itself is the result; the rest of that output
is noise and is not evidence of anything.

---

## What to do with this

Work it alongside [`split-crossings.md`](split-crossings.md)'s bill rather than
instead of it. The bill says what each crossing costs; this says which files
carry them and what the move touches beyond imports.

Both rehearsals cost under a second. There is no reason for the real move to be
the first time any of this is attempted.
