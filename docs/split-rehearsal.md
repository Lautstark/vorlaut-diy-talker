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
[`layers.test.ts`](../tests/unit/layers.test.ts) already pins. **The rest are
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

## What to do with this

Work it alongside [`split-crossings.md`](split-crossings.md)'s bill rather than
instead of it. The bill says what each crossing costs; this says which files
carry them and what the move touches beyond imports.

**Rehearse again once the bill is paid.** A second run against a tree where the
crossings are answered is what turns this into a green suite rather than a list,
and it costs under a second.
