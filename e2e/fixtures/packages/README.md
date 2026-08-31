# The four packages `loader.spec.ts` is fed

Committed binaries, which this repository otherwise avoids. What follows is the
provenance and the recipe, because a fixture nothing can regenerate and nothing
explains is the failure mode
[`frozen-references.md`](../../../docs/frozen-references.md) is a whole document
about.

## Where they came from

They are the **editor's own writer's output** — `buildDevicePackage()` and
`devicePackageBytes()` in `src/data/device_package.ts` — taken on the day of the
split, from the last commit of `vorlaut-diy-talker` that still held that module.
Nothing about their shape is this directory's opinion.

That writer is now `vorlaut-editor`'s. It is not here, and
[`docs/split-crossings.md`](../../../docs/split-crossings.md) names a vendored
copy of it as the edit that must not happen — a second opinion about the format
inside the repository that reads it. So these are files rather than a function,
and [ADR 0014](../../../adr/0014-device-fixtures-cover-the-package-too.md) is
the same move made once already: a reader held against committed packages rather
than against a writer standing beside it.

## What each one is

| file | what is wrong with it |
|---|---|
| `board.obz` | Nothing. Two sets, eight keys, seven filled, two distinct pictures, four recordings. One picture reference resolves to nothing, on purpose — the compiler draws its grey cross for it. One key carries a word the package has no recording for, so it is the silent key. |
| `sound-at-the-wrong-rate.obz` | One recording at 24 kHz. Written **past** the writer's own refusal, which is the point: the device does not refuse one either, it plays it at 16 and the word comes out at the wrong pitch. The file this page has to be ready for is one the editor did not write. |
| `picture-that-will-not-decode.obz` | `wide.png`'s member is four bytes that are not an image. Whether a source decodes is a question only a browser answers, and the answer must be a note and a grey cross rather than a failure. |

## The one that went

`too-many-sets.obz` held six sets, on the strength of `MAX_SETS` being five.
[ADR 0020](../../../adr/0020-every-key-says-what-it-does.md) made it 64 on
2026-08-31, and six sets became an ordinary package. Replacing it would mean a
package of 65 boards, which is fifty kilobytes of binary and — more to the
point — a file **nothing here can write**: the writer these four came from is
`vorlaut-editor`'s, and a copy of it in this repository is the edit
`split-crossings.md` forbids. So the file went, and the question it asked moved
to [`tests/unit/validate_limits.test.ts`](../../../tests/unit/validate_limits.test.ts),
where `check()` is handed a plan of 65 sets directly.

That is the cost this directory's own warning predicted, arriving: **a fixture
nothing here regenerates cannot be adjusted when the rule underneath it moves.**
It can only be kept, or dropped and replaced with something at a level this
repository can reach.

## Regenerating them

In a checkout of `Lautstark/vorlaut-editor`, where the writer lives. The layout,
the two PNGs and the WAV helper this used are in that repository's history at
`e2e/package.ts`, in the commit before the split removed it — `git log --diff-filter=D
-- e2e/package.ts` in `vorlaut-diy-talker` finds the removal, and the version
before it is the recipe in full. The four files are that module's `packageBytes()`
called four times:

```js
packageBytes()                                    // board.obz
packageBytes((input) => {                         // too-many-sets.obz
  while (input.layout.sets.length <= MAX_SETS) {
    input.layout.sets.push({
      ...structuredClone(input.layout.sets[0]), name: `Extra ${input.layout.sets.length}`,
    });
  }
})
packageBytes(() => {}, (pkg) => {                 // sound-at-the-wrong-rate.obz
  const path = [...pkg.files.keys()].find((one) => one.startsWith("sounds/"));
  pkg.files.set(path, wav(0.6, 24000));
})
packageBytes((input) => {                         // picture-that-will-not-decode.obz
  const one = input.sources.get("wide.png");
  input.sources.set("wide.png", { ...one, bytes: new Uint8Array([1, 2, 3, 4]) });
})
```

## What they do not prove

They are inputs, not references: nothing here compares bytes against them, so
they are not under `docs/frozen-references.md`'s rule and re-cutting them breaks
no lock. What they cannot do is notice the editor's writer changing shape. That
is the cost of the fixture answer, and the reason it is affordable is that
[`device/fixtures/package/`](../../../device/fixtures/) holds the loader's
**reader** to the format independently of these four files — a stale fixture
here stops being a case worth running, and cannot become the format.
